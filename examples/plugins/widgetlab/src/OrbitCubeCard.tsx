/**
 * `OrbitCubeCard` — GL (R3F) card ported from the v1 playground
 * (`apps/playground/src/widgets/OrbitCubeCard.tsx`), the RFC-008 exhibit for
 * "the mesh claims the drag, the engine stays out".
 *
 * v1 preset: `medium` (329×155). v1 `withCard: true` (card chrome), background
 * `linear-gradient(135deg, #102030 0%, #050a14 100%)`. v3 GL islands have no
 * implicit chrome — the lead decides chrome at integration.
 *
 * The cube orbits when you drag it and stays put while the engine handles the
 * card chrome — preserved. Adaptations to the v3 GL router (design-004 §4):
 *
 *  - CLAIM = IMPLICIT CAPTURE. v1 called `e.stopPropagation()` (stop R3F
 *    bubble) AND `e.target.setPointerCapture(e.pointerId)` (claim drag so the
 *    canvas adapter never saw the moves). In v3 a single `stopPropagation()`
 *    on `onPointerDown` does BOTH: it marks the event `surfaceHandled` (engine
 *    skips it) and the router captures the pointer to this island, routing all
 *    subsequent moves/up to the cube. So the `setPointerCapture` /
 *    `releasePointerCapture` calls are dropped (the router owns capture).
 *  - NATIVE FIELDS. The synthetic event exposes the browser event under
 *    `e.nativeEvent`, not merged at top level, so v1's `e.clientX` / `e.pointerId`
 *    become `e.nativeEvent.clientX` / `e.nativeEvent.pointerId`.
 *  - REPAINT ON DRAG. There is no animation loop — the mesh rotation is written
 *    imperatively in `onPointerMove`, then `useIslandInvalidate()` schedules the
 *    island repaint (the sanctioned path for content changing outside React's
 *    render). Hover-driven colour change repaints via an effect on `hovered`.
 *
 * NO V3 EQUIVALENT — RFC-008 click coexistence: v1's cube-click fired the mesh
 * `onClick` AND the engine's `click` (which selected the widget), because v1's
 * `stopPropagation` only halted the R3F bubble, not the InputManager. In v3 a
 * claimed `pointerdown` is `surfaceHandled`, so the engine skips the WHOLE
 * gesture — the cube still logs on click, but the engine does NOT also select
 * it. This coexistence is exactly what v3's single-input-path law removes.
 * (Hover highlight still coexists — over/out are synthesized independently.)
 * v3's router also pairs any claimed down+up on the same object into a click
 * regardless of move distance, so the log is guarded by a move threshold to
 * keep v1's "a drag is not a click".
 */
import {
  Size,
  useIslandInvalidate,
  useWidgetProps,
  useWorldComponent,
  type WidgetComponentProps,
} from "@vibefield/plugin-sdk/canvas";
import { GlLiftGroup, type GradientStop, makeGlCardChrome } from "@vibefield/plugin-sdk/ui";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import type { Mesh } from "three";

const TYPE = "vibefield.widgetlab.orbit-cube";

/** v1 `medium` preset. */
export const SIZE = { w: 329, h: 155 } as const;

/** v1 card background: `linear-gradient(135deg, #102030 0%, #050a14 100%)`. */
export const BACKPLATE: readonly GradientStop[] = [
  { offset: 0, color: "#102030" },
  { offset: 1, color: "#050a14" },
];

/** Minimal shape of the router's synthetic event (satisfies R3F handler slots). */
type GLPointer = { stopPropagation(): void; nativeEvent: PointerEvent };

// v3-only: a claimed press that moves beyond this (screen px) is a drag, not a
// click — so it must not log (v1 got this from R3F's click synthesis).
const CLICK_MOVE_THRESHOLD = 4;

type OrbitCubeProps = { hue: number };

function OrbitCubeView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<OrbitCubeProps>(world, entity, TYPE);
  // Explicit S: the published d.ts keeps ValueOf<> unevaluated, so inference lands on unknown.
  const sz = useWorldComponent<{ w: number; h: number }>(world, entity, Size);
  const invalidate = useIslandInvalidate();

  const meshRef = useRef<Mesh>(null);
  // Rotation tracked in refs so pointermove writes don't re-render mid-gesture.
  const rotation = useRef({ x: 0, y: 0 });
  const drag = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const moved = useRef(0);
  const [hovered, setHovered] = useState(false);

  const hue = props?.hue ?? 200;
  const width = sz?.w ?? SIZE.w;
  const height = sz?.h ?? SIZE.h;
  const size = Math.min(width, height) * 0.45;

  // Hover colour depends on React state → repaint the island once it commits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `hovered` is the trigger — the effect re-runs to repaint after the colour change commits, though its body doesn't read it.
  useEffect(() => {
    invalidate();
  }, [hovered, invalidate]);

  const onPointerDown = useCallback((e: GLPointer) => {
    // Claims the gesture (engine skips) AND captures the pointer to this island.
    e.stopPropagation();
    moved.current = 0;
    drag.current = {
      pointerId: e.nativeEvent.pointerId,
      lastX: e.nativeEvent.clientX,
      lastY: e.nativeEvent.clientY,
    };
  }, []);

  const onPointerMove = useCallback(
    (e: GLPointer) => {
      const d = drag.current;
      if (!d || d.pointerId !== e.nativeEvent.pointerId) return;
      const dx = e.nativeEvent.clientX - d.lastX;
      const dy = e.nativeEvent.clientY - d.lastY;
      moved.current += Math.abs(dx) + Math.abs(dy);
      // 1 px ≈ 0.6° rotation. Tactile without wraparound surprises.
      rotation.current.y += dx * 0.01;
      rotation.current.x += dy * 0.01;
      d.lastX = e.nativeEvent.clientX;
      d.lastY = e.nativeEvent.clientY;
      const m = meshRef.current;
      if (m) {
        m.rotation.y = rotation.current.y;
        m.rotation.x = rotation.current.x;
        invalidate(); // rotation written outside React's render → schedule a paint
      }
    },
    [invalidate],
  );

  const onPointerUp = useCallback((e: GLPointer) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.nativeEvent.pointerId) return;
    drag.current = null; // router releases capture on up
  }, []);

  const onClick = useCallback(() => {
    if (moved.current > CLICK_MOVE_THRESHOLD) return; // a drag, not a click
    console.debug("[OrbitCubeCard] mesh click", { hue });
  }, [hue]);

  const onPointerOver = useCallback(() => setHovered(true), []);
  const onPointerOut = useCallback(() => setHovered(false), []);

  const light = size * 3;

  return (
    <GlLiftGroup world={world} entity={entity}>
      <pointLight
        position={[size * 0.6, size * 0.6, size * 0.8]}
        intensity={200}
        distance={light}
        decay={1.4}
        color="#FFFFFF"
      />
      <pointLight
        position={[-size * 0.4, -size * 0.3, size * 0.5]}
        intensity={120}
        distance={light}
        decay={1.6}
        color={`hsl(${hue} 80% 70%)`}
      />
      <ambientLight intensity={0.25} />
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: R3F mesh — onClick is a 3D raycast handler dispatched by the GL router, not a DOM click. */}
      <mesh
        ref={meshRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
        onClick={onClick}
      >
        <boxGeometry args={[size, size, size]} />
        <meshPhysicalMaterial
          color={`hsl(${hue} ${hovered ? 90 : 65}% ${hovered ? 65 : 50}%)`}
          roughness={0.25}
          metalness={0.5}
          clearcoat={0.6}
          clearcoatRoughness={0.15}
        />
      </mesh>
    </GlLiftGroup>
  );
}

// C1b·2: the defineWidget call is GONE — the host builds the prefab from the
// canonical manifest (§12.2). This module ships the component and the DOM
// chrome binding (GL-only — the manifest carries no chrome data, only code).
export const ORBIT_CUBE_TYPE = TYPE;
export const ORBIT_CUBE_CHROME = makeGlCardChrome(BACKPLATE);
export { OrbitCubeView };
