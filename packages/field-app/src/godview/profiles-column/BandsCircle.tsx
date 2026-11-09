import type { AgentProfileSet } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { AgentIcon, ProfileGlyph } from "@vibefield/puppeteer-view-sdk/react";
import type { ReactElement, ReactNode } from "react";
import { arcPath, type BandsGeometry, type BandsMark, type BandsPaint } from "../../usage/bands";
import "./profiles-column.css";

// UM-3 (DESIGN.md §8 "The Bands circle"; UM-D16 = E, "Bands") — THE BANDS CIRCLE, DRAWN: every number is the meter
// model's geometry (`usage/bands.ts`, which the phone's BandsDial is held to by the usage bands golden), and nothing
// here measures, ranks or rounds a plan again. The arcs, notches, the dashed ring, the middle's words and the hot dot
// are one drawing surface; the marks and the profile's glyph are the toolkit's own (`AgentIcon`, `ProfileGlyph`), laid over it
// at the geometry's points, because a mark is never re-drawn (§13). Its paints are tones, mapped to the tokens of the
// ground it stands on (`--vf-bands-ink`, `--vf-bands-attention`, `--vf-bands-ground`, which its container sets), never
// literals; a first read's breath is its one loop, and it stands still under Reduce Motion (profiles-column.css).

/** A tone as a paint (§8 "Its paints are tones, never literals"). */
export function bandsPaint(paint: BandsPaint): string {
  switch (paint.tone) {
    case "ink":
      return `color-mix(in srgb, var(--vf-bands-ink) ${paint.percent}%, transparent)`;
    case "hot":
      return `color-mix(in srgb, var(--vf-orange) ${paint.percent}%, transparent)`;
    case "light":
      // white at a percent: the ink on a state's solid fill (§2.5), as the C1 line's own lit head
      return `color-mix(in srgb, var(--vf-state-on-solid) ${paint.percent}%, transparent)`;
    case "attention":
      return "var(--vf-bands-attention)";
  }
}

/** The one drawing surface: the circle's, and the bands key's small bands. */
function Drawing({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: ReactNode;
}): ReactElement {
  return (
    <svg
      className="vf-bands-drawing"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** What a circle that stands for one profile shows in its middle: the profile's mark. */
export type BandsProfile = Pick<AgentProfileSet, "kind" | "glyph" | "default">;

export interface BandsCircleProps {
  geometry: BandsGeometry;
  /** the profile whose glyph stands in the middle (a profile's circle, `centre: "glyph"`) */
  profile?: BandsProfile | undefined;
  /** said as an image in its own words (the popover's circle); absent, it is its control's picture */
  labelled?: boolean;
  /** the open size's per-plan pointer (`hit`): the plan the pointer is on, then null as it leaves */
  onFocusPlan?: ((key: string | null) => void) | undefined;
  /** UM-5a — which plans' arcs choose (`hit` only; a plan that needs you does not, §8 "Godview's profiles column") */
  choosable?: ReadonlySet<string> | undefined;
  /** UM-5a — a click on a choosable arc: the plan's key. Pointer only: the circle is one image to VoiceOver, and the
   * row's button is the keyboard's and VoiceOver's door to the same act. */
  onChoosePlan?: ((key: string) => void) | undefined;
}

const fixed = (value: number): number => Math.round(value * 100) / 100;

/** A mark (an agent's), its badge and the profile's glyph under it, laid over the drawing at the geometry's point. */
function Mark({ mark }: { mark: BandsMark }): ReactElement {
  return (
    <>
      <span
        className="vf-bands-mark"
        data-provider={mark.provider}
        style={{
          left: fixed(mark.x - mark.size / 2),
          top: fixed(mark.y - mark.size / 2),
          width: fixed(mark.size),
          height: fixed(mark.size),
          fontSize: fixed(mark.size),
          color: bandsPaint(mark.paint),
          opacity: mark.opacity,
        }}
      >
        <AgentIcon providerId={mark.provider} />
      </span>
      {mark.badge !== undefined ? (
        <span
          className="vf-bands-badge"
          data-need={mark.badge.need}
          style={{
            left: fixed(mark.badge.x - mark.badge.r),
            top: fixed(mark.badge.y - mark.badge.r),
            width: fixed(mark.badge.r * 2),
            height: fixed(mark.badge.r * 2),
            opacity: mark.opacity,
          }}
        >
          <FieldGlyph
            name={mark.badge.need === "sign-in" ? "key" : "exclaim"}
            size={fixed(mark.badge.r * 1.32)}
          />
        </span>
      ) : null}
      {mark.glyph !== undefined ? (
        <span
          className="vf-bands-glyph"
          style={{
            left: fixed(mark.glyph.x - mark.glyph.size / 2),
            top: fixed(mark.glyph.y - mark.glyph.size / 2),
            color: bandsPaint(mark.glyph.paint),
            opacity: mark.opacity,
          }}
        >
          <ProfileGlyph
            glyph={mark.glyph.profile.glyph}
            kind={mark.glyph.profile.kind}
            filled={mark.glyph.profile.filled}
            size={fixed(mark.glyph.size)}
          />
        </span>
      ) : null}
    </>
  );
}

export function BandsCircle({
  geometry,
  profile,
  labelled = false,
  onFocusPlan,
  choosable,
  onChoosePlan,
}: BandsCircleProps): ReactElement {
  const { size, centre } = geometry;
  const c = size / 2;
  const said = labelled
    ? { role: "img", "aria-label": geometry.label }
    : { "aria-hidden": true as const };
  const overlay: ReactElement[] = [];
  for (const plan of geometry.plans) {
    if (plan.mark !== undefined) overlay.push(<Mark key={`mark:${plan.key}`} mark={plan.mark} />);
  }
  centre.items.forEach((item, index) => {
    const key = `centre:${index}`;
    if (item.kind === "mark") overlay.push(<Mark key={key} mark={item} />);
    else if (item.kind === "glyph" && profile !== undefined) {
      overlay.push(
        <span
          key={key}
          className="vf-bands-glyph"
          style={{
            left: fixed(item.x - item.size / 2),
            top: fixed(item.y - item.size / 2),
            color: bandsPaint(item.paint),
          }}
        >
          <ProfileGlyph
            glyph={profile.glyph}
            kind={profile.kind}
            filled={profile.default}
            size={fixed(item.size)}
          />
        </span>,
      );
    }
  });
  return (
    <span
      className="vf-bands"
      data-level={geometry.level}
      style={{ width: size, height: size }}
      {...said}
    >
      <Drawing width={size} height={size}>
        {geometry.empty !== undefined ? (
          <circle
            data-part="empty"
            cx={c}
            cy={c}
            r={fixed(geometry.empty.r)}
            strokeWidth={geometry.empty.width}
            strokeDasharray={geometry.empty.dash.join(" ")}
            style={{ fill: "none", stroke: bandsPaint(geometry.empty.paint) }}
          />
        ) : null}
        {geometry.plans.map((plan) => (
          <g key={plan.key}>
            {plan.arcs.map((arc, index) => (
              <path
                // a plan's arcs are drawn in the geometry's order, which never moves among them
                key={index}
                data-part={arc.part}
                data-plan={plan.key}
                className={arc.part === "breath" ? "vf-bands-breath" : undefined}
                d={arcPath(c, arc)}
                strokeWidth={fixed(arc.width)}
                strokeLinecap={arc.cap}
                strokeDasharray={arc.dash?.join(" ")}
                style={{
                  fill: "none",
                  stroke: bandsPaint(arc.paint),
                  // the breath owns its opacity (the stylesheet's loop)
                  ...(arc.part === "breath" ? {} : { opacity: arc.opacity }),
                }}
              />
            ))}
            {plan.notches.map((notch, index) => (
              <line
                // a plan's notches are its windows', in order
                key={index}
                data-part="notch"
                data-plan={plan.key}
                x1={fixed(notch.x1)}
                y1={fixed(notch.y1)}
                x2={fixed(notch.x2)}
                y2={fixed(notch.y2)}
                strokeWidth={notch.width}
                style={{ stroke: bandsPaint(notch.paint), opacity: notch.opacity }}
              />
            ))}
          </g>
        ))}
        {centre.items.map((item, index) =>
          item.kind === "text" ? (
            <text
              // the middle's lines stand in their order
              key={index}
              data-role={item.role}
              x={fixed(item.x)}
              y={fixed(item.y)}
              textAnchor="middle"
              style={{
                fill: bandsPaint(item.paint),
                // the display stack is the system's own at this size (the desktop names no other)
                fontFamily: "var(--vf-font-sans)",
                fontSize: fixed(item.size),
                fontWeight: item.weight,
              }}
            >
              {item.text}
              {item.percent === true ? (
                <tspan
                  dx={fixed(item.size * 0.04)}
                  style={{ fontSize: fixed(item.size / 2), fontWeight: 700 }}
                >
                  %
                </tspan>
              ) : null}
            </text>
          ) : null,
        )}
        {geometry.hotDot !== undefined ? (
          <circle
            data-part="hot-dot"
            cx={fixed(geometry.hotDot.x)}
            cy={fixed(geometry.hotDot.y)}
            r={fixed(geometry.hotDot.r)}
            strokeWidth={geometry.hotDot.ring}
            style={{ fill: "var(--vf-orange)", stroke: "var(--vf-bands-ground)" }}
          />
        ) : null}
        {geometry.plans.map((plan) =>
          plan.hit === undefined ? null : (
            <path
              key={`hit:${plan.key}`}
              data-hit={plan.key}
              className="vf-bands-hit"
              d={arcPath(c, { r: plan.hit.r, from: plan.hit.from, to: plan.hit.to })}
              strokeWidth={fixed(plan.hit.width)}
              style={{ fill: "none", stroke: "transparent" }}
              {...(choosable?.has(plan.key) === true ? { "data-choosable": "" } : {})}
              onClick={() => {
                if (choosable?.has(plan.key) === true) onChoosePlan?.(plan.key);
              }}
              onPointerOver={() => onFocusPlan?.(plan.key)}
              onPointerOut={() => onFocusPlan?.(null)}
            />
          ),
        )}
      </Drawing>
      {overlay}
    </span>
  );
}

/** One band of the key drawn small (the drawing's `bkIcon`): the inner band, the outer, or the hairline beside both. */
function KeyBand({ which }: { which: "inner" | "outer" | "hairline" }): ReactElement {
  const on = bandsPaint({ tone: "ink", percent: 72 });
  const off = bandsPaint({ tone: "ink", percent: 16 });
  return (
    <span className="vf-profiles-key-band">
      <Drawing width={16} height={11}>
        <path
          d="M2.4 10.4A5.6 5.6 0 0 1 13.6 10.4"
          strokeWidth={2.2}
          style={{ fill: "none", stroke: which === "outer" ? on : off }}
        />
        <path
          d="M5.3 10.4A2.7 2.7 0 0 1 10.7 10.4"
          strokeWidth={2.2}
          style={{ fill: "none", stroke: which === "inner" ? on : off }}
        />
        {which === "hairline" ? (
          <path
            d="M.6 10.4A7.4 7.4 0 0 1 15.4 10.4"
            strokeWidth={1}
            style={{ fill: "none", stroke: on }}
          />
        ) : null}
      </Drawing>
    </span>
  );
}

/** THE BANDS KEY (§8 "Godview's profiles column", the popover's body; §9): which band is which, in Settings' own
 * window words, each word led by its band drawn small. */
export function BandsKey(): ReactElement {
  return (
    <p
      className="vf-profiles-key"
      // the key is a picture of the bands with their words, said as one line (§9)
      role="img"
      aria-label="Inside, the next five hours; outside, the week; a hairline, a model's own week"
    >
      <KeyBand which="inner" />
      {"5 hours"}
      <KeyBand which="outer" />
      {"7 days"}
      <KeyBand which="hairline" />
      {"a model's week"}
    </p>
  );
}
