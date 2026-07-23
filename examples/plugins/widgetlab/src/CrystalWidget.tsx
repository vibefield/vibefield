/**
 * `CrystalWidget` — GL (R3F) card ported from the v1 playground
 * (`apps/playground/src/widgets/CrystalWidget.tsx`).
 *
 * v1 preset: `small` (155×155). v1 `withCard: false` — rendered WITHOUT card
 * chrome (no background gradient). v3 GL islands have no implicit chrome, so
 * this matches the v1 look directly.
 *
 * Continuous animation. v1 `useWidgetAnimation(entityId, true)` +
 * `useFrame` → v3 `useIslandFrame` (the only path that drives island repaints;
 * plain useFrame in a portal can't be attributed to an island). Two required
 * adaptations to the frame math: (a) `useIslandFrame` hands back `dtMs`
 * (milliseconds), whereas v1's useFrame `dt` was seconds — converted via
 * `dtMs / 1000`; (b) there is no `state.clock`, so the idle-bob's elapsed time
 * is accumulated locally. Scene JSX (lights, icosahedron, physical material)
 * is verbatim; size comes from the live `Size` instead of render props.
 */
import { Size } from "@vibecook/ice";
import { useIslandFrame } from "@vibecook/ice/r3f";
import { useWidgetProps, useWorldComponent, type WidgetComponentProps } from "@vibecook/ice/react";
import { GlLiftGroup } from "@vibefield/shell-ui";
import { type ReactElement, useRef } from "react";
import type { Mesh } from "three";

const TYPE = "widgetlab.crystal";

/** v1 `small` preset. */
export const SIZE = { w: 155, h: 155 } as const;

type CrystalProps = { tint: string };

function CrystalView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<CrystalProps>(world, entity, TYPE);
  // Explicit S: the published d.ts keeps ValueOf<> unevaluated, so inference lands on unknown.
  const sz = useWorldComponent<{ w: number; h: number }>(world, entity, Size);
  const meshRef = useRef<Mesh>(null);
  const elapsed = useRef(0);

  const tint = props?.tint ?? "#9AE5FF";
  const width = sz?.w ?? SIZE.w;
  const height = sz?.h ?? SIZE.h;
  const size = Math.min(width, height);

  useIslandFrame((dtMs) => {
    const m = meshRef.current;
    if (m === null) return;
    const dt = dtMs / 1000;
    elapsed.current += dt;
    m.rotation.y += dt * 0.4;
    m.rotation.x += dt * 0.15;
    // Gentle idle bob.
    m.position.y = Math.sin(elapsed.current * 0.8) * 2;
  });

  const lightDistance = size * 2;

  return (
    <GlLiftGroup world={world} entity={entity}>
      <pointLight
        position={[size * 0.3, size * 0.4, size * 0.6]}
        intensity={180}
        distance={lightDistance}
        decay={1.4}
        color="#FFFFFF"
      />
      <pointLight
        position={[-size * 0.3, -size * 0.3, size * 0.3]}
        intensity={80}
        distance={lightDistance}
        decay={1.6}
        color="#CBDFFF"
      />
      <ambientLight intensity={0.4} />
      <mesh ref={meshRef}>
        <icosahedronGeometry args={[size * 0.3, 0]} />
        {/* Glass WITHOUT `transmission` (2026-07-14): transmission makes three
            run renderTransmissionPass — a second full scene render into a
            mipmapped RT every paint (Firefox warns on its lazy-init) — to
            refract what's BEHIND the mesh, and this island's behind is empty
            transparent black. The refraction contributed nothing; opacity +
            clearcoat + IBL reads the same here at zero extra passes. */}
        <meshPhysicalMaterial
          color={tint}
          roughness={0.08}
          transparent
          opacity={0.9}
          clearcoat={1}
          clearcoatRoughness={0.05}
        />
      </mesh>
    </GlLiftGroup>
  );
}

// C1b·2: the defineWidget call is GONE — the host builds the prefab from the
// canonical manifest (§12.2). This module ships only the component.
export const CRYSTAL_TYPE = TYPE;
export { CrystalView };
