/**
 * `TorusKnotCard` — GL (R3F) card ported from the v1 playground
 * (`apps/playground/src/widgets/TorusKnotCard.tsx`).
 *
 * v1 preset: `medium` (329×155). v1 `withCard: true` (card chrome), background
 * `linear-gradient(135deg, #2D1B5E 0%, #1A1240 55%, #0A0820 100%)`. v3 GL
 * islands have no implicit chrome — the lead decides chrome at integration.
 *
 * Continuous rotation. v1 `useWidgetAnimation` + `useFrame` → `useIslandFrame`;
 * v1's per-frame `dt` (seconds) becomes `dtMs / 1000`. No clock is used here.
 * Scene JSX (lights, torus-knot, iridescent physical material) is verbatim;
 * size comes from the live `Size`. `hue` is a `p.number` (0–360).
 */
import { Size } from "@vibecook/ice";
import { useIslandFrame } from "@vibecook/ice/r3f";
import { useWidgetProps, useWorldComponent, type WidgetComponentProps } from "@vibecook/ice/react";
import { GlLiftGroup, type GradientStop, makeGlCardChrome } from "@vibefield/shell-ui";
import { type ReactElement, useRef } from "react";
import type { Mesh } from "three";

const TYPE = "widgetlab.torus-knot";

/** v1 `medium` preset. */
export const SIZE = { w: 329, h: 155 } as const;

/** v1 card background: `linear-gradient(135deg, #2D1B5E 0%, #1A1240 55%, #0A0820 100%)`. */
export const BACKPLATE: readonly GradientStop[] = [
  { offset: 0, color: "#2D1B5E" },
  { offset: 0.55, color: "#1A1240" },
  { offset: 1, color: "#0A0820" },
];

type TorusKnotProps = { hue: number };

function TorusKnotView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<TorusKnotProps>(world, entity, TYPE);
  // Explicit S: the published d.ts keeps ValueOf<> unevaluated, so inference lands on unknown.
  const sz = useWorldComponent<{ w: number; h: number }>(world, entity, Size);
  const meshRef = useRef<Mesh>(null);

  const hue = props?.hue ?? 285;
  const width = sz?.w ?? SIZE.w;
  const height = sz?.h ?? SIZE.h;
  const size = Math.min(width, height);

  useIslandFrame((dtMs) => {
    const m = meshRef.current;
    if (m === null) return;
    const dt = dtMs / 1000;
    m.rotation.y += dt * 0.35;
    m.rotation.x += dt * 0.18;
  });

  const light = size * 2.2;

  return (
    <GlLiftGroup world={world} entity={entity}>
      <pointLight
        position={[size * 0.5, size * 0.5, size * 0.7]}
        intensity={220}
        distance={light}
        decay={1.4}
        color="#FFFFFF"
      />
      <pointLight
        position={[-size * 0.5, -size * 0.3, size * 0.5]}
        intensity={110}
        distance={light}
        decay={1.6}
        color={`hsl(${hue} 80% 70%)`}
      />
      <ambientLight intensity={0.2} />
      <mesh ref={meshRef} position={[0, 0, 6]}>
        <torusKnotGeometry args={[size * 0.18, size * 0.06, 180, 32]} />
        <meshPhysicalMaterial
          color={`hsl(${hue} 70% 58%)`}
          roughness={0.18}
          metalness={0.25}
          clearcoat={1}
          clearcoatRoughness={0.08}
          iridescence={1}
          iridescenceIOR={1.6}
          iridescenceThicknessRange={[100, 800]}
        />
      </mesh>
    </GlLiftGroup>
  );
}

// C1b·2: the defineWidget call is GONE — the host builds the prefab from the
// canonical manifest (§12.2). This module ships the component and the DOM
// chrome binding (GL-only — the manifest carries no chrome data, only code).
export const TORUS_KNOT_TYPE = TYPE;
export const TORUS_KNOT_CHROME = makeGlCardChrome(BACKPLATE);
export { TorusKnotView };
