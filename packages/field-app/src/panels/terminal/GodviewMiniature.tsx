import { PaneFrameChrome, paneFrameModel } from "@vibecook/puppeteer-views";
import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { DeckAppearance } from "../../godview/deck-appearance";
import { godviewBackdropStyle } from "../../godview/deck-theme";
import { GodviewStage } from "../../godview/GodviewStage";
import { storedStageParameters } from "../../godview/monitor/monitor-tuning";
import {
  SCANLINE_DENSITY_KEY,
  SCANLINE_OPACITY_KEY,
  VIGNETTE_OPACITY_KEY,
} from "../../godview/monitor/stage-parameters";
import { type PreviewMode, type PreviewTheme, withAlpha } from "./theme-view";

// Settings → Terminal's preview: Godview in miniature (GT-7).
//
// What ships is mounted, not redrawn: the stage is `GodviewStage` itself — its
// backdrop (`godviewBackdropStyle`, the one projection the overlay reads), its
// CRT lines and vignette at the values the user tuned — and each pane wears the
// views package's `PaneFrameChrome`, the frame the deck portals into every pane
// (record §07). Three things are stand-ins, said so here: the CANVAS behind
// (the field's CSS ground and two content cards — Godview holds the real one
// still while it covers it), the monitor's BODIES (the real swarm is a WebGPU
// view; these are its surface and ink, as circles), and the TERMINAL TEXT
// (ghosttea draws on a canvas; this is DOM text in the same palette). The
// effects are CSS approximations of the WGSL ports, and the caption says so.

type Segment = readonly [text: string, style?: SegmentStyle];
interface SegmentStyle {
  fg?: number;
  bg?: number;
  bold?: boolean;
  selected?: boolean;
  cursor?: boolean;
}

/** The selected pane: a bare shell (its badge is the folder and nothing else). */
const SHELL: readonly (readonly Segment[])[] = [
  [
    ["~/Projects/vibe-field", { fg: 4, bold: true }],
    [" on "],
    ["main", { fg: 5, bold: true }],
    [" ⇡2 !3", { fg: 1 }],
  ],
  [["❯ ", { fg: 2 }], ["pnpm verify"]],
  [
    [" PASS ", { bg: 2, fg: 0, bold: true }],
    [" field-app "],
    ["958 tests", { fg: 8 }],
    ["  21.4s", { fg: 8 }],
  ],
  [[" FAIL ", { bg: 1, fg: 15, bold: true }], [" biome     "], ["2 errors", { fg: 1 }]],
  [
    ["  src/panels/terminal/LookTab.tsx", { fg: 6 }],
    [":128:9", { fg: 8 }],
  ],
  [["  lint/style/useTemplate ", { fg: 3 }], ["use a template literal"]],
  [["❯ ", { fg: 2 }], ["git log --oneline -1"]],
  [
    ["0e321805", { fg: 3, selected: true }],
    [" AR-S2c: plans in the profile", { selected: true }],
  ],
  [["❯ ", { fg: 2 }], ["ls packages/"]],
  [
    ["❯ ", { fg: 2 }],
    [" ", { cursor: true }],
  ],
];

/** The resting pane: an agent's, so its readout and meter have something to say. */
const AGENT: readonly (readonly Segment[])[] = [
  [["› ", { fg: 8 }], ["tighten the ledger reader"]],
  [
    ["• ", { fg: 2 }],
    ["Read ", { bold: true }],
    ["packages/ledger/src/read.ts", { fg: 8 }],
  ],
  [["  └ 214 lines", { fg: 8 }]],
  [
    ["• ", { fg: 2 }],
    ["Edit ", { bold: true }],
    ["read.ts "],
    ["+12", { fg: 2 }],
    [" −4", { fg: 1 }],
  ],
  [["• ", { fg: 2 }], ["Run ", { bold: true }], ["pnpm test ledger"]],
  [
    ["  ✓ 38 passed", { fg: 2 }],
    ["  1.2s", { fg: 8 }],
  ],
  [["› ", { fg: 8 }], ["now the writer"]],
  [
    ["• ", { fg: 2 }],
    ["Read ", { bold: true }],
    ["src/write.ts", { fg: 8 }],
  ],
  [[""]],
  [
    ["◦ ", { fg: 6 }],
    ["Working ", { fg: 6 }],
    ["0:41 · esc to interrupt", { fg: 8 }],
  ],
];

/** The monitor's bodies, packed about the stage's middle (offsets in px). */
const BODIES: readonly {
  name: string;
  meta?: string;
  x: number;
  y: number;
  d: number;
  context?: number;
  selected?: boolean;
  waiting?: boolean;
  empty?: boolean;
  far?: boolean;
}[] = [
  { name: "study", x: -157, y: 20, d: 42, far: true },
  { name: "vibe-field", meta: "running · 0:12", x: -98, y: -4, d: 72, selected: true },
  { name: "rosetta", meta: "gpt-5-codex", x: -28, y: 10, d: 68, context: 0.12 },
  { name: "truffle", meta: "? allow Bash", x: 37, y: -10, d: 62, waiting: true },
  { name: "ref", meta: "haiku 4.5", x: 96, y: 12, d: 54, context: 0.55 },
  { name: "notes", meta: "empty", x: 148, y: -12, d: 46, empty: true, far: true },
];

/** A fixed clock, so the readout never ticks in a preview. */
const NOW = Date.parse("2026-09-24T21:00:00.000Z");

const SHELL_FRAME = paneFrameModel({
  session: { id: "settings-shell", exited: false, cwd: "/Users/you/Projects/vibe-field" },
  nowMs: NOW,
});
const AGENT_FRAME = paneFrameModel({
  session: { id: "settings-agent", exited: false, cwd: "/Users/you/Projects/rosetta" },
  agent: {
    providerId: "codex",
    providerLabel: "Codex",
    status: "working",
    alive: true,
    project: "rosetta",
    model: "gpt-5-codex",
    contextPercent: 12,
  },
  nowMs: NOW,
});
/** The resting pane's project colour, in the deck's own tint recipe (record §02). */
const AGENT_COLOR = "oklch(var(--tint-l) var(--tint-c) 150)";

const LINE_HEIGHT = 19;
const SIZES = {
  window: { monitor: 100, deck: 250 },
  thumb: { monitor: 100, deck: 212, width: 600 },
  deck: { monitor: 0, deck: 250 },
} as const;

export type MiniatureVariant = keyof typeof SIZES;

export interface GodviewMiniatureProps {
  variant?: MiniatureVariant;
  mode: PreviewMode;
  theme: PreviewTheme;
  /** the sixteen program colours this Mac's sessions paint with */
  palette: readonly string[];
  appearance: Pick<
    DeckAppearance,
    | "opacity"
    | "opacityCells"
    | "shaderEffects"
    | "shaderAnimate"
    | "backdropOpacity"
    | "backdropBlur"
  >;
  /** a line under the picture */
  caption?: ReactNode;
}

function Screen({
  lines,
  rows,
  theme,
  palette,
  opacity,
  cells,
  vhs,
}: {
  lines: readonly (readonly Segment[])[];
  rows: number;
  theme: PreviewTheme;
  palette: readonly string[];
  opacity: number;
  cells: boolean;
  vhs: boolean;
}): ReactElement {
  const shown = lines.slice(Math.max(0, lines.length - rows));
  return (
    <div
      className={`vf-ts-mini-screen${vhs ? " is-vhs" : ""}`}
      style={{ color: theme.foreground, height: rows * LINE_HEIGHT }}
    >
      {shown.map((line, lineIndex) => (
        <span className="vf-ts-mini-line" key={lineIndex}>
          {line.map(([text, style = {}], index) => {
            if (style.cursor) {
              return (
                <span
                  key={index}
                  className="vf-ts-mini-cursor"
                  style={{ background: withAlpha(theme.cursor, theme.cursorAlpha) }}
                >
                  {text}
                </span>
              );
            }
            const css: CSSProperties = {};
            if (style.fg !== undefined) css.color = palette[style.fg];
            if (style.bg !== undefined) {
              const ground = palette[style.bg] ?? theme.background;
              css.background = cells ? withAlpha(ground, opacity) : ground;
            }
            if (style.selected) {
              css.background = withAlpha(theme.selection, theme.selectionAlpha);
              css.color = theme.selectionForeground;
            }
            return (
              <span key={index} style={css}>
                {style.bold ? <b>{text}</b> : text}
              </span>
            );
          })}
        </span>
      ))}
    </div>
  );
}

function Effects({ stack, animate }: { stack: readonly string[]; animate: boolean }): ReactElement {
  return (
    <>
      {stack.includes("ghosttea:crt") && <i className="vf-ts-mini-fx is-crt" />}
      {stack.includes("ghosttea:better-crt") && <i className="vf-ts-mini-fx is-better-crt" />}
      {stack.includes("ghosttea:vhs") && (
        <i className={`vf-ts-mini-fx is-vhs${animate ? " is-running" : ""}`} />
      )}
      {stack.includes("ghosttea:sparks-from-fire") && (
        <i className={`vf-ts-mini-fx is-sparks${animate ? " is-running" : ""}`} />
      )}
    </>
  );
}

function Monitor(): ReactElement {
  return (
    <div className="vf-godview-monitor-stage vf-ts-mini-monitor">
      {BODIES.map((body) => (
        <div
          key={body.name}
          className={[
            "vf-ts-mini-body",
            body.selected ? "is-selected" : "",
            body.waiting ? "is-waiting" : "",
            body.empty ? "is-empty" : "",
            body.far ? "is-far" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={
            {
              "--x": `${body.x}px`,
              "--y": `${body.y}px`,
              "--d": `${body.d}px`,
              "--ctx": body.context ?? 0,
              "--name": `${Math.max(6.5, body.d * 0.125)}px`,
              "--meta": `${Math.max(5.5, body.d * 0.09)}px`,
            } as CSSProperties
          }
        >
          {body.context !== undefined && (
            <>
              <i className="vf-ts-mini-body-ring" />
              <span className="vf-ts-mini-body-pct">{Math.round(body.context * 100)}%</span>
            </>
          )}
          <b>{body.name}</b>
          {body.meta !== undefined && body.d >= 44 && <small>{body.meta}</small>}
        </div>
      ))}
    </div>
  );
}

function Field(): ReactElement {
  return (
    <div className="vf-ts-mini-field">
      <div className="vf-ts-mini-card is-note">
        <span>Note</span>
        <p>Polish the space between the controls.</p>
      </div>
      <div className="vf-ts-mini-card is-deep">
        <span>Terminal</span>
        <p>
          ~/vibe-field
          <br />$ pnpm dev
        </p>
      </div>
    </div>
  );
}

/** The thumbnail's scale: the window drawn at a fixed width, fitted to its box. */
function useFitScale(
  width: number,
  enabled: boolean,
): [(node: HTMLDivElement | null) => void, number] {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.55);
  useEffect(() => {
    if (!enabled || node === null || typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined && entry.contentRect.width > 0)
        setScale(entry.contentRect.width / width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, node, width]);
  return [setNode, scale];
}

export function GodviewMiniature({
  variant = "window",
  mode,
  theme,
  palette,
  appearance,
  caption,
}: GodviewMiniatureProps): ReactElement {
  const size = SIZES[variant];
  const thumb = variant === "thumb";
  const [fitRef, scale] = useFitScale(SIZES.thumb.width, thumb);
  // The CRT the user tuned in Godview's system controls, read once — the
  // preview draws Godview as it is, and never writes Godview's settings.
  const stage = useMemo(() => storedStageParameters(), []);
  const rows = Math.floor((size.deck - 24 - 30 - 4) / LINE_HEIGHT);
  const height = size.monitor + size.deck;
  const stack = appearance.shaderEffects;
  const reduced =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animate = appearance.shaderAnimate && !reduced;
  const pane = (active: boolean, lines: typeof SHELL): ReactElement => (
    <div
      className={`ghostty-pane vf-ts-mini-pane${active ? " is-active" : " is-side"}`}
      {...(active ? {} : { "data-pane-accent": "" })}
      style={
        {
          background: withAlpha(theme.background, appearance.opacity),
          ...(active ? {} : { "--ghostty-pane-color": AGENT_COLOR }),
        } as CSSProperties
      }
    >
      <Screen
        lines={lines}
        rows={rows}
        theme={theme}
        palette={palette}
        opacity={appearance.opacity}
        cells={appearance.opacityCells}
        vhs={stack.includes("ghosttea:vhs")}
      />
      <Effects stack={stack} animate={animate} />
      <PaneFrameChrome
        sessionId={active ? "settings-shell" : "settings-agent"}
        model={active ? SHELL_FRAME : AGENT_FRAME}
        {...(active ? {} : { color: AGENT_COLOR })}
        zoomed={false}
        stopping={false}
        verbs={{}}
        onStop={() => undefined}
        onResume={() => undefined}
        onZoom={() => undefined}
      />
    </div>
  );
  const picture = (
    <div
      className={`vf-ts-mini is-${variant}`}
      style={{
        height,
        ...(thumb ? { width: SIZES.thumb.width, transform: `scale(${scale})` } : {}),
      }}
      role="img"
      aria-label={`Godview in ${mode} mode: a terminal in ${theme.name} at ${Math.round(appearance.opacity * 100)}% opacity${
        appearance.backdropOpacity < 1
          ? `, your canvas showing through the backdrop at ${Math.round(appearance.backdropOpacity * 100)}%${
              appearance.backdropBlur > 0 ? `, blurred ${appearance.backdropBlur} px` : ""
            }`
          : ""
      }`}
    >
      <div className="vf-ts-mini-inert" aria-hidden="true" inert>
        <Field />
        <GodviewStage
          open
          theme={mode}
          tuningOpen={false}
          animations={false}
          className="vf-ts-mini-stage"
          style={
            {
              ...godviewBackdropStyle(appearance),
              "--vf-scanline-density": `${stage[SCANLINE_DENSITY_KEY] ?? 2}px`,
              "--vf-scanline-opacity": stage[SCANLINE_OPACITY_KEY] ?? 0.4,
              "--vf-vignette-opacity": stage[VIGNETTE_OPACITY_KEY] ?? 1,
              "--vf-godview-terminal-ink": theme.foreground,
            } as CSSProperties
          }
          {...(size.monitor > 0 ? { monitor: <Monitor /> } : {})}
          deck={
            <div
              className="vf-deck-framed vf-ts-mini-deck"
              style={{ "--vf-godview-terminal-ink": theme.foreground } as CSSProperties}
            >
              {pane(true, SHELL)}
              {variant !== "deck" && pane(false, AGENT)}
            </div>
          }
        />
      </div>
    </div>
  );
  return (
    <figure className="vf-ts-mini-figure">
      {thumb ? (
        <div ref={fitRef} className="vf-ts-mini-fit" style={{ height: Math.round(height * scale) }}>
          {picture}
        </div>
      ) : (
        picture
      )}
      {caption !== undefined && <figcaption className="vf-ts-mini-caption">{caption}</figcaption>}
    </figure>
  );
}

export const MINIATURE_PANE_ROWS = (variant: MiniatureVariant): number =>
  Math.floor((SIZES[variant].deck - 24 - 30 - 4) / LINE_HEIGHT);
