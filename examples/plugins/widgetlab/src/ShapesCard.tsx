/**
 * `ShapesCard` — GL (R3F) card ported from the v1 playground
 * (`apps/playground/src/widgets/ShapesCard.tsx`), the RFC-006 exhibit for
 * in-widget pointer interaction against a private R3F scene.
 *
 * v1 preset: `large` (329×345). v1 `withCard: true` (card chrome), background
 * `linear-gradient(135deg, #1F2333 0%, #14161F 60%, #0A0B12 100%)`. v3 GL
 * islands have no implicit chrome — the lead decides chrome at integration.
 *
 * The swarm physics, palette, layout, tunables, collisions and integration are
 * ported VERBATIM. `event.point` is still island-local (origin centre, X right,
 * Y up) — exactly what v1's per-widget raycaster produced (RFC-006 §4c) — so
 * the repel math is unchanged.
 *
 * REQUIRED INTERACTION ADAPTATIONS (v3 GL router, design-004 §4):
 *  1. v1 repelled on HOVER (`onPointerMove` fired with no button). The v3
 *     router only dispatches `onPointerMove` (with a `point`) while a pointer
 *     is CAPTURED — a `stopPropagation()`-claimed `onPointerDown`. Buttonless
 *     hover yields only `onPointerOver`/`onPointerOut` (with `point:
 *     undefined`). So the backplate now CLAIMS `pointerdown`, and the swarm is
 *     parted by PRESS-DRAGGING over the card rather than by a buttonless hover.
 *  2. Because the full-bleed backplate claims the down, the card face is no
 *     longer engine-draggable/selectable (a claim is `surfaceHandled`, so the
 *     engine skips the gesture). v1 left the backplate down-transparent, so
 *     press-drag on the card moved the widget. Marquee-select from empty
 *     canvas still selects it; the lead may want chrome margin for grab-to-move.
 *  3. v3's router pairs ANY claimed down+up on the same object into a click
 *     (it does not check move distance, unlike R3F). To keep v1's "a drag
 *     never cycles the accent", the click is guarded by a local move-distance
 *     threshold.
 *
 * Frame math: v1 `dt` (seconds) → `dtMs / 1000`. Accent write: v1
 * `useUpdateWidget` → `useCommit` (the sanctioned durable widget-write path).
 */
import { Size, widgets } from "@vibecook/ice";
import { useIslandFrame } from "@vibecook/ice/r3f";
import {
  useCommit,
  useWidgetProps,
  useWorldComponent,
  type WidgetComponentProps,
} from "@vibecook/ice/react";
import { GlLiftGroup, type GradientStop, makeGlCardChrome } from "@vibefield/shell-ui";
import { type ReactElement, useMemo, useRef } from "react";
import { type Mesh, Vector3 } from "three";

const TYPE = "vibefield.widgetlab.shapes";

/** v1 `large` preset. */
export const SIZE = { w: 329, h: 345 } as const;

/** v1 card background: `linear-gradient(135deg, #1F2333 0%, #14161F 60%, #0A0B12 100%)`. */
export const BACKPLATE: readonly GradientStop[] = [
  { offset: 0, color: "#1F2333" },
  { offset: 0.6, color: "#14161F" },
  { offset: 1, color: "#0A0B12" },
];

const ACCENTS = ["#4060ff", "#20ffa0", "#ff4060", "#ffcc00"] as const;

type ShapeKind = "sphere" | "cube" | "tet" | "torus";
type BodyTone = "graphite" | "white" | "accent";

interface ShapeSpec {
  kind: ShapeKind;
  tone: BodyTone;
  radius: number; // collision radius in widget-local world units
  roughness: number;
}

const PALETTE: readonly ShapeSpec[] = [
  { kind: "sphere", tone: "graphite", radius: 36, roughness: 0.1 },
  { kind: "cube", tone: "graphite", radius: 36, roughness: 0.65 },
  { kind: "tet", tone: "graphite", radius: 36, roughness: 0.5 },
  { kind: "torus", tone: "white", radius: 36, roughness: 0.1 },
  { kind: "tet", tone: "white", radius: 36, roughness: 0.6 },
  { kind: "torus", tone: "white", radius: 36, roughness: 0.1 },
  { kind: "tet", tone: "accent", radius: 33, roughness: 0.1 },
  { kind: "torus", tone: "accent", radius: 36, roughness: 0.5 },
  { kind: "sphere", tone: "accent", radius: 36, roughness: 0.1 },
];

// Tunables. Units are widget-local world units (≈ pixels at 1× zoom).
const SPRING = 0.65;
const DAMPING = 3.6;
const POINTER_REPEL_RADIUS = 130;
const POINTER_REPEL_STRENGTH = 28000;
const COLLISION_STIFFNESS = 260;
const Z_RANGE = 30;
// v3-only: a claimed press that moves beyond this (island units) is a drag,
// not a click — so it must not cycle the accent (v1 got this from R3F's click
// synthesis; the v3 router pairs any down+up on the same object).
const CLICK_MOVE_THRESHOLD = 6;

interface BodyState {
  pos: Vector3;
  vel: Vector3;
  spin: Vector3;
}

/** Minimal shape of the router's synthetic event (satisfies R3F handler slots). */
type ShapesPointer = { point?: { x: number; y: number }; stopPropagation(): void };

type ShapesProps = { accentIdx: number };

function ShapesView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<ShapesProps>(world, entity, TYPE);
  // Explicit S: the published d.ts keeps ValueOf<> unevaluated, so inference lands on unknown.
  const sz = useWorldComponent<{ w: number; h: number }>(world, entity, Size);
  const commit = useCommit();

  const accentIdx = props?.accentIdx ?? 0;
  const width = sz?.w ?? SIZE.w;
  const height = sz?.h ?? SIZE.h;

  // Physics state — one body per palette entry. Stored in a ref so the frame
  // loop mutates without re-rendering React. Recompute layout on resize.
  const bodies = useMemo<BodyState[]>(() => {
    const N = PALETTE.length;
    return PALETTE.map((_, i) => {
      const angle = (i / N) * Math.PI * 2;
      const r = Math.min(width, height) * 0.32;
      const z = ((i % 3) - 1) * (Z_RANGE * 0.6);
      return {
        pos: new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z),
        vel: new Vector3(),
        spin: new Vector3(
          0.4 + 0.6 * Math.sin(i * 1.7),
          0.5 + 0.6 * Math.cos(i * 2.1),
          0.3 + 0.4 * Math.sin(i * 3.3),
        ),
      };
    });
  }, [width, height]);

  const meshRefs = useRef<(Mesh | null)[]>([]);
  const pointerRef = useRef<Vector3 | null>(null);
  // Click/drag discrimination (adaptation 3).
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(0);

  const setPointer = (e: ShapesPointer): void => {
    if (!e.point) return;
    if (!pointerRef.current) pointerRef.current = new Vector3();
    // Flatten Z to the swarm centre so a cursor anywhere in the plane pushes
    // nearby bodies regardless of their depth.
    pointerRef.current.set(e.point.x, e.point.y, 0);
    const last = lastPointRef.current;
    if (last) movedRef.current += Math.hypot(e.point.x - last.x, e.point.y - last.y);
    lastPointRef.current = { x: e.point.x, y: e.point.y };
  };

  // NO down claim (2026-07-12): a claimed down suppresses the engine gesture
  // entirely, making the card undraggable. Repel rides the router's HOVER
  // moves (buttonless point delivery); click rides the router's unclaimed
  // click pairing; dragging the card is the engine's press-drag
  // (interaction.dragOn "press" — 2026-07-17, all widgetlab cards).
  const onPointerDown = (e: ShapesPointer): void => {
    movedRef.current = 0;
    lastPointRef.current = e.point ? { x: e.point.x, y: e.point.y } : null;
    setPointer(e);
  };
  const onPointerMove = (e: ShapesPointer): void => {
    setPointer(e);
  };
  const clearPointer = (): void => {
    pointerRef.current = null;
    lastPointRef.current = null;
  };

  const onClick = (): void => {
    if (movedRef.current > CLICK_MOVE_THRESHOLD) return; // a drag, not a click
    // host registration precedes any mount at runtime, so the lookup is safe
    // here; still guarded because groups.find always returns T | undefined.
    const group = widgets.get(TYPE)?.groups.find((g) => g.name === "props");
    if (group === undefined) return;
    // A durable-write failure (e.g. no active doc) must never break the handler
    // or the router — the repel keeps working even if the accent can't persist.
    try {
      commit((tx) => {
        tx.edit(entity).set(group.component, {
          accentIdx: (accentIdx + 1) % ACCENTS.length,
        } as never);
      });
    } catch (err) {
      console.warn("[ShapesCard] accent commit failed", err);
    }
  };

  useIslandFrame((dtMs) => {
    const step = Math.min(dtMs / 1000, 0.033);
    const pointer = pointerRef.current;

    // Forces.
    for (const b of bodies) {
      b.vel.x += -b.pos.x * SPRING * step;
      b.vel.y += -b.pos.y * SPRING * step;
      b.vel.z += -b.pos.z * SPRING * step;

      if (pointer) {
        const dx = b.pos.x - pointer.x;
        const dy = b.pos.y - pointer.y;
        const dz = b.pos.z - pointer.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < POINTER_REPEL_RADIUS && d > 0.001) {
          const t = 1 - d / POINTER_REPEL_RADIUS;
          const f = (POINTER_REPEL_STRENGTH * t * t) / Math.max(d, 4);
          b.vel.x += (dx / d) * f * step;
          b.vel.y += (dy / d) * f * step;
          b.vel.z += (dz / d) * f * step * 0.4;
        }
      }
    }

    // Pairwise collisions (O(N²); N=9 so the cost is trivial).
    for (let i = 0; i < bodies.length; i++) {
      const ba = bodies[i];
      const specA = PALETTE[i];
      if (!ba || !specA) continue;
      const ra = specA.radius;
      for (let j = i + 1; j < bodies.length; j++) {
        const bb = bodies[j];
        const specB = PALETTE[j];
        if (!bb || !specB) continue;
        const rb = specB.radius;
        const dx = bb.pos.x - ba.pos.x;
        const dy = bb.pos.y - ba.pos.y;
        const dz = bb.pos.z - ba.pos.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const minD = ra + rb;
        if (d < minD && d > 0.001) {
          const overlap = minD - d;
          const nx = dx / d;
          const ny = dy / d;
          const nz = dz / d;
          const f = COLLISION_STIFFNESS * overlap * step;
          ba.vel.x -= nx * f;
          ba.vel.y -= ny * f;
          ba.vel.z -= nz * f;
          bb.vel.x += nx * f;
          bb.vel.y += ny * f;
          bb.vel.z += nz * f;
        }
      }
    }

    // Damping + integrate.
    const damp = Math.exp(-DAMPING * step);
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b) continue;
      b.vel.multiplyScalar(damp);
      b.pos.x += b.vel.x * step;
      b.pos.y += b.vel.y * step;
      b.pos.z += b.vel.z * step;

      // Soft Z clamp so the swarm stays close to the camera plane.
      if (b.pos.z > Z_RANGE) b.vel.z -= (b.pos.z - Z_RANGE) * step * 8;
      if (b.pos.z < -Z_RANGE) b.vel.z += (-Z_RANGE - b.pos.z) * step * 8;

      const m = meshRefs.current[i];
      if (m) {
        m.position.copy(b.pos);
        m.rotation.x += step * b.spin.x;
        m.rotation.y += step * b.spin.y;
        m.rotation.z += step * b.spin.z;
      }
    }
  });

  const accent = ACCENTS[accentIdx % ACCENTS.length] ?? ACCENTS[0];
  const colorFor = (tone: BodyTone): string =>
    tone === "graphite" ? "#3a3a3a" : tone === "white" ? "#ececec" : accent;

  const lightDist = Math.max(width, height) * 2;

  return (
    <GlLiftGroup world={world} entity={entity}>
      <ambientLight intensity={0.55} />
      <directionalLight position={[width, height, width]} intensity={1.1} />
      <pointLight
        position={[0, 0, Math.max(width, height) * 0.6]}
        intensity={140}
        distance={lightDist}
        decay={1.6}
        color={accent}
      />

      {/* The RFC-006 interaction claim surface (behind the swarm): press-drag
          parts the bodies, click (sub-threshold move) cycles the accent. The
          router reaches it through the body cloud — the bodies carry no
          handlers, so only this plane claims. The VISIBLE card moved to DOM
          chrome (GlCardChrome — shared CSS with DOM cards); this plane is now
          purely a raycast target: fully transparent, writes neither color nor
          depth, and three's raw Raycaster (the GL router's pick path) hits it
          regardless of paint. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: R3F mesh — onClick is a 3D raycast handler dispatched by the GL router, not a DOM click. */}
      <mesh
        position={[0, 0, -Math.max(40, 0.5 * Math.min(width, height))]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={clearPointer}
        onPointerOut={clearPointer}
        onClick={onClick}
      >
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>

      {PALETTE.map((spec, i) => (
        <mesh
          // biome-ignore lint/suspicious/noArrayIndexKey: PALETTE order is stable
          key={i}
          ref={(m) => {
            meshRefs.current[i] = m;
          }}
          castShadow
          receiveShadow
        >
          {spec.kind === "sphere" && <sphereGeometry args={[spec.radius, 28, 18]} />}
          {spec.kind === "cube" && (
            <boxGeometry args={[spec.radius * 1.4, spec.radius * 1.4, spec.radius * 1.4]} />
          )}
          {spec.kind === "tet" && <tetrahedronGeometry args={[spec.radius * 1.35]} />}
          {spec.kind === "torus" && (
            <torusGeometry args={[spec.radius * 0.78, spec.radius * 0.32, 14, 28]} />
          )}
          <meshStandardMaterial
            color={colorFor(spec.tone)}
            roughness={spec.roughness}
            metalness={0.18}
          />
        </mesh>
      ))}
    </GlLiftGroup>
  );
}

// C1b·2: the defineWidget call is GONE — the host builds the prefab from the
// canonical manifest (§12.2). This module ships the component and the DOM
// chrome binding (GL-only — the manifest carries no chrome data, only code).
// The module-level `ShapesCard.groups.find(...)` hazard (a defineWidget-
// produced object read from outside its own scope, before the type was
// necessarily registered) is gone with the call itself — onClick above now
// resolves its group through the live `widgets` registry at write time.
export const SHAPES_TYPE = TYPE;
export const SHAPES_CHROME = makeGlCardChrome(BACKPLATE);
export { ShapesView };
