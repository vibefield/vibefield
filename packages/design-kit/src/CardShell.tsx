/**
 * iOS-style card chrome — the v3 stand-in for v1's CardFrame/CardChrome
 * (rounded clip, hairline ring, soft drop shadow, drag lift, overlap glow).
 * v1 rendered this INSIDE createCardWidget for every card; in v3 chrome is the
 * app's concern, so each widgetlab view wraps its body in <CardShell>.
 *
 * Adaptations (deliberate, reported at integration):
 *  - LIFT: v1 lifted on its drag state; v3 signal = a live `Grab` rider on the
 *    entity (present exactly while a move gesture holds the widget).
 *  - OVERLAP GLOW + RIM: v1's hot-point inner glow AND the edge-rim glow
 *    (CardChrome.tsx rim — radial gradient at the hot point, masked to the
 *    border ring), both restored 2026-07-13 (James: "add the same hover card
 *    edge glow effect like v1"). The hot point is v1's derivation verbatim
 *    (interaction.ts:423): the CENTROID of dragged-rect ∩ this card,
 *    normalized to card-local [0,1] — derived from the live
 *    `Grab`bed widget's rect (no new ECS state). CSS-var knobs (--ic-glow-*,
 *    --ic-rim-*) stay live for the settings panel.
 * Signals are change-driven; only the active overlap hot point samples at
 * 60 ms. No ECS writes.
 */
import type { Entity, World } from "@vibecook/ice";
import type { CSSProperties, ReactNode } from "react";
import { OVERLAP_FEEDBACK_DEFAULTS } from "./card-appearance";
import { useCardChromeProjection } from "./chrome-projection";

const rgbChannels = (hex: string): string => {
  const packed = Number.parseInt(hex.slice(1), 16);
  return `${(packed >> 16) & 0xff}, ${(packed >> 8) & 0xff}, ${packed & 0xff}`;
};

// CSS tokens supply the active theme. These light-theme values are the honest
// standalone fallback when a CardShell consumer has not loaded tokens.css.
const FALLBACK_GLOW_CHANNELS = rgbChannels(OVERLAP_FEEDBACK_DEFAULTS.colors.glowLight);
const FALLBACK_RIM_CHANNELS = rgbChannels(OVERLAP_FEEDBACK_DEFAULTS.colors.rimLight);

/** Card corner radius — exported so folder minis can scale the same silhouette. */
export const CARD_RADIUS = 22;

/** The default card surface when a view passes no gradient of its own. */
export const CARD_BG = "#1C1C1E";

/**
 * Selection ring (2026-07-17, James: chrome must track the card's VISUAL size
 * and sit on top): drawn INSIDE the scaled base div, so the lift transform
 * carries it for free — pixel-locked to the card through the 180ms scale ease,
 * riding the P3 lifted plane during drags. Shows only for a SOLE selection;
 * two or more selected cards share the engine's P4 union box instead
 * (selectionChrome policy, same date).
 */
export const RING_COLOR = "#4A90D9";

/**
 * Drag-lift fade (2026-07-16, James): a lifted card drops to 75 % opacity for
 * the whole hold+drag and restores on release. GL cards fade their floating
 * 3D content in lockstep — GlLiftGroup feeds the SAME value to
 * `useIslandOpacity` (the composite-quad ease runs the same 180ms/ease pair
 * as the CSS transition below).
 */
export const LIFT_OPACITY = 0.75;

export function CardShell({
  world,
  entity,
  background = CARD_BG,
  children,
}: {
  world: World;
  entity: Entity;
  background?: string;
  /** Omitted for GL cards — their content floats in the island above (GlCardChrome). */
  children?: ReactNode;
}) {
  // Lift signal + scale: the shared hook (use-drag-lift.ts, 2026-07-18) —
  // Grab-or-armed-hold truth, ChromeSettings.liftScale for the number.
  const { lift, soleSelected, overlap, hot } = useCardChromeProjection(world, entity);
  const { lifted, scale } = lift;

  const baseShadow = lifted
    ? "0 30px 60px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06)"
    : "0 20px 40px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)";

  const base: CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    borderRadius: `${CARD_RADIUS}px`,
    overflow: "hidden",
    background,
    boxShadow: baseShadow,
    transform: lifted ? `scale(${scale})` : "scale(1)",
    transformOrigin: "center center",
    opacity: lifted ? LIFT_OPACITY : 1,
    transition:
      "transform 180ms cubic-bezier(0.2, 0.9, 0.3, 1.2), box-shadow 220ms ease, opacity 180ms ease",
  };

  const tier = overlap === "accept" ? "t" : "c";
  const tierIndex = tier === "t" ? 1 : 0;
  // v1 CardChrome verbatim: the inset glow's offset puts the bright spot on
  // the hot-point side (−(hot−0.5)·16 → ±8px), and the rim is a radial
  // gradient anchored AT the hot point, masked to the border ring.
  const offsetX = -(hot.x - 0.5) * 16;
  const offsetY = -(hot.y - 0.5) * 16;
  const glow: CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    borderRadius: "inherit",
    boxShadow: `inset ${offsetX}px ${offsetY}px var(--ic-glow-size-${tier}, ${OVERLAP_FEEDBACK_DEFAULTS.glowSize[tierIndex]}px) rgba(var(--ic-glow-color, ${FALLBACK_GLOW_CHANNELS}), var(--ic-glow-alpha-${tier}, ${OVERLAP_FEEDBACK_DEFAULTS.glowAlpha[tierIndex]}))`,
    opacity: overlap !== "none" ? 1 : 0,
    transition: "opacity 220ms ease, box-shadow 220ms ease",
  };

  const rimColor = `rgba(var(--ic-rim-color, ${FALLBACK_RIM_CHANNELS}), var(--ic-rim-alpha-${tier}, ${OVERLAP_FEEDBACK_DEFAULTS.rimAlpha[tierIndex]}))`;
  const rim: CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    borderRadius: "inherit",
    padding: `var(--ic-rim-width, ${OVERLAP_FEEDBACK_DEFAULTS.rimWidth}px)`,
    background: `radial-gradient(var(--ic-rim-radius, ${OVERLAP_FEEDBACK_DEFAULTS.rimRadius}px) circle at ${hot.x * 100}% ${hot.y * 100}%, ${rimColor}, transparent 40%)`,
    WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
    WebkitMaskComposite: "xor",
    mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
    maskComposite: "exclude",
    opacity: overlap !== "none" ? 1 : 0,
    transition: "opacity 220ms ease, background 220ms ease",
  };

  const ring: CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    borderRadius: "inherit",
    border: `1.5px solid ${RING_COLOR}`,
    opacity: soleSelected ? 1 : 0,
    transition: "opacity 120ms ease",
  };

  return (
    <div style={base}>
      {children}
      <div style={glow} />
      <div style={rim} />
      <div style={ring} data-card-ring={soleSelected ? "on" : "off"} />
    </div>
  );
}
