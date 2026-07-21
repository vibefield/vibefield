/**
 * `MatteSphereCard` — GL (R3F) card ported from the v1 playground
 * (`apps/playground/src/widgets/MatteSphereCard.tsx`).
 *
 * v1 preset: `small` (155×155). v1 `withCard: true` (card chrome), background
 * `linear-gradient(135deg, #FFB6C1 0%, #FF7E8A 55%, #C24A6B 100%)`. v3 GL
 * islands have no implicit chrome — the lead decides chrome at integration.
 *
 * Static widget: it does NOT opt into per-frame animation (v1 skipped
 * `useWidgetAnimation`), so `animated: false` and there is no `useIslandFrame`.
 * The compositor paints it once on mount and parks it. Scene JSX (lights,
 * sphere, material) is verbatim; the only adaptation is reading the widget's
 * live size from the world (`Size`) instead of v1's width/height render props.
 */
import { defineWidget, p, Size } from "@vibecook/ice";
import { useWidgetProps, useWorldComponent, type WidgetComponentProps } from "@vibecook/ice/react";
import { GlLiftGroup, type GradientStop, makeGlCardChrome } from "@vibefield/shell-ui";
import { type ReactElement, useRef } from "react";
import type { Mesh } from "three";

const TYPE = "widgetlab.sphere";

/** v1 `small` preset. */
export const SIZE = { w: 155, h: 155 } as const;

/** v1 card background: `linear-gradient(135deg, #FFB6C1 0%, #FF7E8A 55%, #C24A6B 100%)`. */
export const BACKPLATE: readonly GradientStop[] = [
  { offset: 0, color: "#FFB6C1" },
  { offset: 0.55, color: "#FF7E8A" },
  { offset: 1, color: "#C24A6B" },
];

type MatteSphereProps = { color: string };

function MatteSphereView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<MatteSphereProps>(world, entity, TYPE);
  // Explicit S: the published d.ts keeps ValueOf<> unevaluated, so inference lands on unknown.
  const sz = useWorldComponent<{ w: number; h: number }>(world, entity, Size);
  const meshRef = useRef<Mesh>(null);

  const color = props?.color ?? "#F5B8D0";
  const width = sz?.w ?? SIZE.w;
  const height = sz?.h ?? SIZE.h;
  const size = Math.min(width, height);

  const lightDistance = size * 1.5;

  return (
    <GlLiftGroup world={world} entity={entity}>
      <pointLight
        position={[size * 0.4, size * 0.4, size * 0.6]}
        intensity={160}
        distance={lightDistance}
        decay={1.4}
        color="#FFFFFF"
      />
      <pointLight
        position={[-size * 0.4, -size * 0.3, size * 0.4]}
        intensity={60}
        distance={lightDistance}
        decay={1.6}
        color="#8AB4FF"
      />
      <ambientLight intensity={0.25} />
      <mesh ref={meshRef} position={[0, 0, 4]}>
        <sphereGeometry args={[size * 0.32, 48, 48]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.05} />
      </mesh>
    </GlLiftGroup>
  );
}

export const MatteSphereCard = defineWidget({
  type: TYPE,
  props: { color: p.string({ default: "#F5B8D0" }) },
  surface: "gl",
  animated: false,
  component: MatteSphereView,
  chrome: makeGlCardChrome(BACKPLATE),
  sizeMode: "fixed",
  defaultSize: { w: SIZE.w, h: SIZE.h },
  minSize: { w: 120, h: 120 },
  interaction: { solid: true, dragOn: "press", selectable: true, movable: true, snap: "both" },
  provides: ["widget"], // drop-to-consume advertisement — CardContainer accepts ["widget"]
});
