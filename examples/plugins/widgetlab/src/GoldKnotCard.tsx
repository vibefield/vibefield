/**
 * `GoldKnotCard` — GL (R3F) card ported from the v1 playground
 * (`apps/playground/src/widgets/GoldKnotCard.tsx`).
 *
 * v1 preset: `large` (329×345). v1 `withCard: true` (card chrome), background
 * `linear-gradient(135deg, #4A2814 0%, #2A0E12 60%, #14080C 100%)`. v3 GL
 * islands have no implicit chrome — the lead decides chrome at integration.
 *
 * Continuous spin + tilt. v1 `useWidgetAnimation` + `useFrame` →
 * `useIslandFrame` (`dt` seconds → `dtMs / 1000`; the tilt term accumulates a
 * local elapsed clock in place of `state.clock.elapsedTime`).
 *
 * LIGHTING: v1 carried only an `ambientLight` and relied on the canvas-root
 * IBL (the v1 Compositor propagated it to every widget scene). v3 restores
 * that via `<GLViews environment>` — the App loads the same "apartment" HDR
 * and every island scene gets it as `scene.environment`, so the material is
 * v1-verbatim AND v1-lit. (An interim two-point studio rig lived here before
 * the seam existed; removed with it.)
 */
import { Size } from "@vibecook/ice";
import { useIslandFrame } from "@vibecook/ice/r3f";
import { useWidgetProps, useWorldComponent, type WidgetComponentProps } from "@vibecook/ice/react";
import { GlLiftGroup, type GradientStop, makeGlCardChrome } from "@vibefield/shell-ui";
import { type ReactElement, useRef } from "react";
import type { Mesh } from "three";

const TYPE = "vibefield.widgetlab.gold-knot";

/** v1 `large` preset. */
export const SIZE = { w: 329, h: 345 } as const;

/** v1 card background: `linear-gradient(135deg, #4A2814 0%, #2A0E12 60%, #14080C 100%)`. */
export const BACKPLATE: readonly GradientStop[] = [
  { offset: 0, color: "#4A2814" },
  { offset: 0.6, color: "#2A0E12" },
  { offset: 1, color: "#14080C" },
];

type GoldKnotMetal = "gold" | "chrome" | "copper";
type GoldKnotProps = { metal: GoldKnotMetal };

const METALS: Record<GoldKnotMetal, { color: string; roughness: number }> = {
  gold: { color: "#F5CE6E", roughness: 0.12 },
  chrome: { color: "#E8E8EE", roughness: 0.05 },
  copper: { color: "#D97B46", roughness: 0.18 },
};

function GoldKnotView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<GoldKnotProps>(world, entity, TYPE);
  // Explicit S: the published d.ts keeps ValueOf<> unevaluated, so inference lands on unknown.
  const sz = useWorldComponent<{ w: number; h: number }>(world, entity, Size);
  const meshRef = useRef<Mesh>(null);
  const elapsed = useRef(0);

  const metal = METALS[props?.metal ?? "gold"];
  const width = sz?.w ?? SIZE.w;
  const height = sz?.h ?? SIZE.h;
  const size = Math.min(width, height);

  useIslandFrame((dtMs) => {
    const m = meshRef.current;
    if (m === null) return;
    const dt = dtMs / 1000;
    elapsed.current += dt;
    m.rotation.y += dt * 0.4;
    m.rotation.x = Math.sin(elapsed.current * 0.5) * 0.2;
  });

  return (
    <GlLiftGroup world={world} entity={entity}>
      {/* v1-verbatim: ambient only — the shared island environment (GLViews
          environment seam) carries the metallic response, exactly like v1. */}
      <ambientLight intensity={0.15} />
      <mesh ref={meshRef} position={[0, 0, 6]}>
        <torusKnotGeometry args={[size * 0.18, size * 0.055, 220, 40]} />
        <meshPhysicalMaterial
          color={metal.color}
          roughness={metal.roughness}
          metalness={1}
          clearcoat={0.8}
          clearcoatRoughness={0.05}
          envMapIntensity={1.4}
        />
      </mesh>
    </GlLiftGroup>
  );
}

// C1b·2: the defineWidget call is GONE — the host builds the prefab from the
// canonical manifest (§12.2). This module ships the component and the DOM
// chrome binding (GL-only — the manifest carries no chrome data, only code).
export const GOLD_KNOT_TYPE = TYPE;
export const GOLD_KNOT_CHROME = makeGlCardChrome(BACKPLATE);
export { GoldKnotView };
