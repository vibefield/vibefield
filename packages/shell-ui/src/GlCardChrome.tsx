/**
 * DOM chrome for GL cards — v1's CardChrome-beneath-the-canvas sandwich,
 * restored (2026-07-13, James: "we do dom card everywhere [in v1] … that way
 * they share the same css effects and also the hover glow border effects").
 *
 * The engine portals a GL widget's `chrome` component into its CONTENT-plane
 * host (P1), which stacks UNDER the GL canvas (P2): the card body is the SAME
 * `<CardShell>` DOM widgets use — one CSS source for the gradient, rounded
 * clip, hairline ring, drop shadow, the 180ms lift spring and the overlap
 * glow — while the island renders ONLY the floating 3D content above it.
 * The composite-quad lift (GlLiftGroup) runs the same curve engine-side, so
 * card and model rise in lockstep. This file replaces the in-scene
 * `GlCardBackplate` gradient plane (which also depth-clipped rotating models
 * and could never share CSS effects).
 */
import type { WidgetComponentProps } from "@vibecook/ice/react";
import type { ComponentType, ReactElement } from "react";
import { CardShell } from "./CardShell";

export interface GradientStop {
  /** 0..1 along the 135° diagonal (top-left → bottom-right). */
  readonly offset: number;
  readonly color: string;
}

/** The v1 card gradient, as CSS (the canvas-texture path drew the same 135° ramp). */
export const gradientCss = (stops: readonly GradientStop[]): string =>
  `linear-gradient(135deg, ${stops.map((s) => `${s.color} ${(s.offset * 100).toFixed(0)}%`).join(", ")})`;

/** Build a widget `chrome` component: CardShell with this card's gradient. */
export function makeGlCardChrome(
  stops: readonly GradientStop[],
): ComponentType<WidgetComponentProps> {
  const background = gradientCss(stops);
  return function GlCardChrome({ entity, world }: WidgetComponentProps): ReactElement {
    return <CardShell world={world} entity={entity} background={background} />;
  };
}
