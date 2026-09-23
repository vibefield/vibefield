import {
  type CSSProperties,
  type PointerEvent,
  type ReactElement,
  useId,
  useInsertionEffect,
  useMemo,
  useRef,
} from "react";
import "./face.css";

// The face (DESIGN.md §2.8; users-and-accounts UA-D17) — the ONE drawing of a
// user, for every surface that shows one: the Me menu, the Settings head, the
// Account page, the Setup Assistant. A user is known by form, never by hue, so
// nothing here takes a colour: the only colour on a face is its emoji, and the
// frame is the chrome's own paper or pewter (tokens.css §2.8).
//
// Two frames. The STICKER (the default) is the emoji as its own frame — a
// die-cut paper edge, a stable per-user tilt, a soft shadow, and a lift under
// the pointer. The COIN (a user's own choice) mints the same emoji in pewter,
// and its detail switches on by size.
//
// Which emoji a user wears, and who may wear it, is policy and lives in
// `@vibefield/contracts` (`effectiveFaces`, `faceProblem`); this module only
// draws what it is handed.

export type UserFaceFrame = "sticker" | "coin";

/** DESIGN.md §2.8 — the size, in px, from which each piece of detail shows. */
export const FACE_THRESHOLDS = Object.freeze({
  /** A sticker lifts under the pointer from here up; smaller ones stay flat. */
  lift: 20,
  /** Below this every sticker sits straight, so a list of faces lines up. */
  tilt: 40,
  beading: 44,
  reeding: 56,
  /** The coin catches the light of the pointer. */
  light: 72,
  /** The coin's engraved name · tailnet. */
  legend: 96,
});

/** Put this on the control that HOLDS a face (a button, a row): hovering or
 * focusing the host lifts the sticker inside it, the way a card lifts (§7). */
export const faceLiftHostClass = "vf-face-host";

/** 32-bit FNV-1a over UTF-16 code units. The SAME hash as contracts'
 * `fnv1a32` — the deal and the tilt are one recipe across both planes (and
 * iOS ports it) — kept local so the kit does not depend on the wire package. */
function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The sticker's stable angle in degrees: ±2–5° from the user id — a second
 * colourless cue for telling one person's users apart (I-2) — and straight
 * below 40px. Magnitude `2 + h mod 4`, sign from bit 7. */
export function faceTilt(seed: string, size: number): number {
  if (size < FACE_THRESHOLDS.tilt) return 0;
  const hash = fnv1a32(seed);
  const magnitude = 2 + (hash % 4);
  return (hash >>> 7) & 1 ? magnitude : -magnitude;
}

/** The die-cut edge: 3.2% of the size, rounded, at least 1px (1px at 16px,
 * 5px at 144px), and one filter per whole pixel up to 8. */
export function stickerEdgePx(size: number): number {
  return Math.max(1, Math.min(8, Math.round(size * 0.032)));
}

const FILTER_HOST_ID = "vf-face-filters";
const SVG_NS = "http://www.w3.org/2000/svg";

/** The die-cut as an SVG filter, one per edge width, defined ONCE per document
 * and shared by every sticker in it. The glyph's alpha is THRESHOLDED before
 * it is dilated (slope 4, intercept −2): an emoji bitmap carries faint
 * anti-aliased pixels at its corners, and a plain dilation grows them into
 * grey squares that show only on a dark ground. Then a 1px cut line beyond the
 * paper, which is what keeps a white edge visible on white chrome. */
function dieCutFilter(edge: number): string {
  return `<filter id="vf-face-die-${edge}" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">
  <feComponentTransfer in="SourceAlpha" result="solid"><feFuncA type="linear" slope="4" intercept="-2"/></feComponentTransfer>
  <feMorphology in="solid" operator="dilate" radius="${edge + 1}"/><feGaussianBlur stdDeviation="0.5" result="cutShape"/>
  <feFlood style="flood-color: var(--vf-sticker-cut)"/><feComposite in2="cutShape" operator="in" result="cut"/>
  <feMorphology in="solid" operator="dilate" radius="${edge}"/><feGaussianBlur stdDeviation="0.5" result="edgeShape"/>
  <feFlood style="flood-color: var(--vf-sticker-edge)"/><feComposite in2="edgeShape" operator="in" result="edge"/>
  <feMerge><feMergeNode in="cut"/><feMergeNode in="edge"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>`;
}

function ensureFaceFilters(doc: Document): void {
  if (doc.getElementById(FILTER_HOST_ID) !== null || doc.body === null) return;
  const host = doc.createElementNS(SVG_NS, "svg");
  host.setAttribute("id", FILTER_HOST_ID);
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("focusable", "false");
  host.setAttribute("width", "0");
  host.setAttribute("height", "0");
  host.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
  host.innerHTML = `<defs>${Array.from({ length: 8 }, (_, i) => dieCutFilter(i + 1)).join("")}</defs>`;
  doc.body.appendChild(host);
}

const px = (value: number): string => `${Math.round(value * 100) / 100}px`;

export interface UserFaceViewProps {
  /** The emoji — one grapheme, already validated by whoever wrote it. */
  emoji: string;
  /** An absent frame is a sticker (UA-D17). */
  frame?: UserFaceFrame | undefined;
  /** Rendered edge length in px. */
  size: number;
  /** The user id: seeds the sticker's tilt, so a user sits at one angle
   * everywhere they appear. */
  seed: string;
  /** The coin's engraving, name · tailnet — shown from 96px. Never a user
   * number: nobody knows theirs (§2.8). */
  legend?: string | undefined;
  /** The accessible name ("James, 🦊"). Omit it where the face sits beside the
   * name already — a decorative face is hidden from assistive tech (I-4). */
  label?: string | undefined;
  /** Hold the lifted pose — the Me menu's face while its menu is open. */
  held?: boolean;
  className?: string;
}

export function UserFaceView({
  emoji,
  frame = "sticker",
  size,
  seed,
  legend,
  label,
  held = false,
  className = "",
}: UserFaceViewProps): ReactElement {
  if (frame === "coin") {
    return (
      <CoinFace
        emoji={emoji}
        size={size}
        legend={legend}
        label={label}
        held={held}
        className={className}
      />
    );
  }
  return (
    <StickerFace
      emoji={emoji}
      size={size}
      seed={seed}
      label={label}
      held={held}
      className={className}
    />
  );
}

function a11y(label: string | undefined): {
  role?: "img";
  "aria-label"?: string;
  "aria-hidden"?: true;
} {
  return label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label };
}

function StickerFace({
  emoji,
  size,
  seed,
  label,
  held,
  className,
}: {
  emoji: string;
  size: number;
  seed: string;
  label: string | undefined;
  held: boolean;
  className: string;
}): ReactElement {
  // Insertion-time, before layout and paint, so the first frame a sticker is
  // ever drawn already has its edge.
  useInsertionEffect(() => {
    if (typeof document !== "undefined") ensureFaceFilters(document);
  }, []);
  const tilt = faceTilt(seed, size);
  const style = {
    "--vf-face-size": `${size}px`,
    "--vf-face-tilt": `${tilt}deg`,
    "--vf-face-tilt-held": `${Math.round(tilt * 35) / 100}deg`,
    "--vf-face-die": `url(#vf-face-die-${stickerEdgePx(size)})`,
    "--vf-face-shadow-y": px(size * 0.03),
    "--vf-face-shadow-blur": px(size * 0.045),
    "--vf-face-shadow-y-held": px(size * 0.07),
    "--vf-face-shadow-blur-held": px(size * 0.09),
  } as CSSProperties;
  return (
    <span
      {...a11y(label)}
      className={`vf-face ${className}`.trim()}
      data-frame="sticker"
      data-lift={size >= FACE_THRESHOLDS.lift ? "" : undefined}
      data-held={held ? "" : undefined}
      style={style}
    >
      <span className="vf-face-figure">
        <span className="vf-face-glyph">{emoji}</span>
      </span>
    </span>
  );
}

/** The coin's engraved marks as one SVG: reeding round the edge, beading just
 * inside the rim (the §2.1 canvas dots, in the coin's ink), and the legend on
 * the top arc. Built once per size and legend. */
function coinMarks(
  size: number,
  rimWidth: number,
  legend: string | null,
  legendId: string,
): ReactElement[] {
  const c = size / 2;
  const marks: ReactElement[] = [];
  if (size >= FACE_THRESHOLDS.reeding) {
    const outer = c - size * 0.005;
    const inner = c - size * 0.024;
    let d = "";
    for (let i = 0; i < 112; i++) {
      const a = (i / 112) * 2 * Math.PI;
      d += `M${(c + inner * Math.cos(a)).toFixed(2)} ${(c + inner * Math.sin(a)).toFixed(2)}L${(c + outer * Math.cos(a)).toFixed(2)} ${(c + outer * Math.sin(a)).toFixed(2)}`;
    }
    marks.push(
      <path
        key="reeding"
        className="vf-face-reed"
        d={d}
        strokeWidth={Math.max(0.5, size * 0.006)}
      />,
    );
  }
  if (size >= FACE_THRESHOLDS.beading) {
    const ring = c - rimWidth - size * 0.04;
    const count = Math.max(12, Math.round((2 * Math.PI * ring) / (size * 0.045)));
    const r = Math.max(0.55, size * 0.0095);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * 2 * Math.PI;
      marks.push(
        <circle
          key={`bead-${i}`}
          className="vf-face-bead"
          cx={(c + ring * Math.cos(a)).toFixed(2)}
          cy={(c + ring * Math.sin(a)).toFixed(2)}
          r={r.toFixed(2)}
        />,
      );
    }
  }
  if (legend !== null) {
    const radius = c - rimWidth / 2;
    const fontSize = rimWidth * 0.5;
    // The top half-circle, left to right, holds the whole legend; a name too
    // long for it is shortened rather than squashed.
    const budget = Math.max(4, Math.floor((Math.PI * radius) / (fontSize * 0.86)));
    const text = legend.length > budget ? `${legend.slice(0, budget - 1).trimEnd()}…` : legend;
    marks.push(
      <path
        key="legend-arc"
        id={legendId}
        d={`M${(c - radius).toFixed(2)} ${c.toFixed(2)}A${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 1 ${(c + radius).toFixed(2)} ${c.toFixed(2)}`}
        fill="none"
      />,
      <text key="legend" className="vf-face-legend" fontSize={fontSize.toFixed(2)}>
        <textPath
          href={`#${legendId}`}
          startOffset="50%"
          textAnchor="middle"
          dominantBaseline="central"
        >
          {text}
        </textPath>
      </text>,
    );
  }
  return marks;
}

function CoinFace({
  emoji,
  size,
  legend,
  label,
  held,
  className,
}: {
  emoji: string;
  size: number;
  legend: string | undefined;
  label: string | undefined;
  held: boolean;
  className: string;
}): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);
  const legendId = `vf-face-legend-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const engraved =
    legend !== undefined && legend.trim().length > 0 && size >= FACE_THRESHOLDS.legend
      ? legend.trim().toUpperCase()
      : null;
  const rimWidth = size * (engraved === null ? 0.085 : 0.15);
  const marks = useMemo(
    () => (size >= FACE_THRESHOLDS.beading ? coinMarks(size, rimWidth, engraved, legendId) : []),
    [size, rimWidth, engraved, legendId],
  );
  const catchesLight = size >= FACE_THRESHOLDS.light;
  const style = {
    "--vf-face-size": `${size}px`,
    "--vf-face-rim-width": px(rimWidth),
    "--vf-face-figure-scale": size <= 20 ? 0.66 : 0.58,
    "--vf-face-coin-shadow": `0 ${px(size * 0.05)} ${px(size * 0.12)} var(--vf-coin-shadow), 0 ${px(size * 0.012)} ${px(size * 0.025)} var(--vf-coin-shadow-contact)`,
    "--vf-face-coin-inset": `inset 0 ${px(size * 0.02)} ${px(size * 0.045)} var(--vf-coin-inset)`,
    "--vf-face-relief": `drop-shadow(0 ${px(Math.max(0.5, size * 0.014))} ${px(Math.max(0.5, size * 0.02))} var(--vf-coin-relief))`,
  } as CSSProperties;

  // The light follows the pointer across a large coin (§2.8) — written straight
  // to the element, because a re-render per pointer move would be the whole
  // cost of a decorative highlight.
  const onPointerMove = (event: PointerEvent<HTMLSpanElement>): void => {
    const node = ref.current;
    if (node === null) return;
    const box = node.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const x = ((event.clientX - box.left) / box.width) * 100;
    const y = ((event.clientY - box.top) / box.height) * 100;
    node.style.setProperty("--vf-face-light-x", `${x.toFixed(1)}%`);
    node.style.setProperty("--vf-face-light-y", `${y.toFixed(1)}%`);
  };
  const onPointerLeave = (): void => {
    ref.current?.style.removeProperty("--vf-face-light-x");
    ref.current?.style.removeProperty("--vf-face-light-y");
  };

  return (
    <span
      {...a11y(label)}
      ref={ref}
      className={`vf-face ${className}`.trim()}
      data-frame="coin"
      data-held={held ? "" : undefined}
      data-light={catchesLight ? "" : undefined}
      style={style}
      onPointerMove={catchesLight ? onPointerMove : undefined}
      onPointerLeave={catchesLight ? onPointerLeave : undefined}
    >
      <span className="vf-face-rim" />
      <span className="vf-face-field" />
      <span className="vf-face-figure">
        <span className="vf-face-glyph">{emoji}</span>
      </span>
      {marks.length > 0 && (
        <svg className="vf-face-marks" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          {marks}
        </svg>
      )}
      <span className="vf-face-light" />
    </span>
  );
}
