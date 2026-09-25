import {
  AgentIcon,
  PROFILE_GLYPHS,
  ProfileGlyph,
  profileGlyphName,
  ServiceMark,
  suggestProfileGlyph,
} from "@vibecook/puppeteer-views";
import type { AgentProfileSet, AgentSignInRoute, AgentSignInService } from "@vibefield/contracts";
import { EmptyState, InlineNotice, UiButton, UiSwitch } from "@vibefield/design-kit/primitives";
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { SettingsSubpage } from "../SettingsDialog";
import { borderCls, fieldCls, labelCls, SettingsRow, SettingsSection } from "../settings-ui";
import type { AgentsNotice } from "./AgentsView";
import {
  defaultSwitchWords,
  deleteWords,
  emptyProfileWords,
  inOnWords,
  type PlanBadge,
  type PlanCard,
  type ProfileAgentRow,
  type ProfilePageModel,
  signInLines,
  signOutWords,
  USAGE_NOW_FLARE,
  USAGE_NOW_WIDTH,
  type UsageLine,
  usageFigurePlace,
  usageLines,
  usageNowPath,
} from "./profiles-model";

// Agent Profiles' views — controller-free, so the catalog mounts the shipping
// composition with fixture data (UI_SYSTEM.md). The design record is R1, pass
// 16: "Agent Profiles are places". A profile's page holds its agents (each a
// sign-in kept in the profile's folder), its settings (name, glyph, the
// default, the folder) and its deletion behind the P7 two-step confirm; one
// agent inside a profile has its subscription — or, for an agent whose folder
// holds several, its sign-ins — its folder and its sign-out; a new profile is
// a name, a glyph and a switch. Every act is a design-kit button; a sign-in
// runs in a terminal ON the page (the controller hands that card in as
// `signIn`).
//
// AR-S2c (pass 19, P2 — "plans on top"): above the agents, one CARD per plan
// the profile runs on, with every usage window as a C1 line; each agent row
// wears BADGES, the cards in small (filled: the one it runs on; outlined: its
// other sign-ins; dashed: a key). Hovering a card or a badge lights its
// partners with a selection ring; nothing moves.

/* ── marks ────────────────────────────────────────────────────────────────── */

/** A profile's mark: its glyph, filled when it is the default; the laptop for This Mac. */
export function ProfileMark({
  set,
  size = 18,
  title,
}: {
  set: Pick<AgentProfileSet, "kind" | "glyph" | "default">;
  size?: number;
  title?: string;
}): ReactElement {
  return (
    <ProfileGlyph
      className="vf-profiles-glyph"
      kind={set.kind}
      glyph={set.glyph}
      filled={set.default}
      size={size}
      {...(title === undefined ? {} : { title })}
    />
  );
}

function AgentTile({ provider }: { provider: string }): ReactElement {
  return (
    <span className="vf-agents-mark vf-agents-mark--row" aria-hidden="true">
      <AgentIcon providerId={provider} />
    </span>
  );
}

/** A service on a tile: the company whose plan it is (Claude's mark for Anthropic). */
function ServiceTile({
  service,
  size = "row",
}: {
  service: AgentSignInService;
  size?: "row" | "card";
}): ReactElement {
  return (
    <span
      className={size === "card" ? "vf-profiles-plan-mark" : "vf-agents-mark vf-agents-mark--row"}
      aria-hidden="true"
    >
      <ServiceMark service={service} />
    </span>
  );
}

function Chevron(): ReactElement {
  return (
    <svg className="vf-agents-chevron" viewBox="0 0 20 20" aria-hidden="true">
      <path d="m7.5 5 5 5-5 5" />
    </svg>
  );
}

function PlusIcon(): ReactElement {
  return (
    <svg className="vf-profiles-plus" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 4.5v11M4.5 10h11" />
    </svg>
  );
}

function ResetIcon(): ReactElement {
  return (
    <svg className="vf-profiles-reset" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M14.5 3.5v3h-3" />
    </svg>
  );
}

function DownIcon(): ReactElement {
  return (
    <svg className="vf-profiles-down" viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5.5 8 4.5 4.5L14.5 8" />
    </svg>
  );
}

/** How the page of one agent inside a profile names itself in the header: the
 * agent, and the profile it is in (its mark beside its name). */
export function profileAgentSubpage(
  set: AgentProfileSet,
  agentLabel: string,
  onBack: () => void,
): SettingsSubpage {
  return {
    title: agentLabel,
    description: (
      <span className="vf-profiles-subhead">
        <ProfileMark set={set} size={12} />
        {set.label}
      </span>
    ),
    backLabel: `Back to ${set.label}`,
    onBack,
  };
}

/* ── the C1 timeline: Line · Glow · Halo (pass 22) ─────────────────────────── */

/** The track's height before it is measured (the stylesheet's 14 px). */
const TRACK_HEIGHT = 14;

/** One window's line. The figure's place is laid out in pixels, so the
 * track and the figure are measured, and again whenever either resizes. */
function UsageLineView({ line }: { line: UsageLine }): ReactElement {
  const track = useRef<HTMLSpanElement | null>(null);
  const figure = useRef<HTMLSpanElement | null>(null);
  const [size, setSize] = useState({ track: 0, figure: 0, height: TRACK_HEIGHT });
  useLayoutEffect(() => {
    const trackEl = track.current;
    const figureEl = figure.current;
    if (trackEl === null || figureEl === null) return;
    const measure = () => {
      const next = {
        track: trackEl.clientWidth,
        figure: figureEl.offsetWidth,
        height: trackEl.clientHeight || TRACK_HEIGHT,
      };
      setSize((held) =>
        held.track === next.track && held.figure === next.figure && held.height === next.height
          ? held
          : next,
      );
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(trackEl);
    observer.observe(figureEl);
    return () => observer.disconnect();
  }, []);
  const used = Math.min(100, Math.max(0, line.usedPercent));
  const place = usageFigurePlace({
    track: size.track,
    figure: size.figure,
    used: line.usedPercent,
    elapsed: line.elapsedPercent,
  });
  const nowWidth = USAGE_NOW_WIDTH + 2 * USAGE_NOW_FLARE;
  const words = `${line.group !== undefined ? `${line.group.label}, ` : ""}${line.label}: ${Math.round(
    line.usedPercent,
  )}% used${line.reset !== undefined ? `, resets in ${line.reset}` : ""}${
    line.hot ? ", ahead of pace" : ""
  }`;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a row of the timeline's grid; see UsageTimeline
    <div
      role="listitem"
      aria-label={words}
      className={`vf-profiles-usage-line${line.hot ? " is-hot" : ""}`}
    >
      <span className="vf-profiles-usage-label" aria-hidden="true">
        {line.label}
      </span>
      <span ref={track} className="vf-profiles-usage-track" aria-hidden="true">
        <span className="vf-profiles-usage-fill" style={{ width: `${used}%` }} />
        {line.elapsedPercent !== undefined && (
          // the line is geometry, clipped to its outline, and painted by the stylesheet
          <span
            className={`vf-profiles-usage-now${place.lineGives ? " gives" : ""}`}
            data-outline={usageNowPath(size.height)}
            style={{
              left: `calc(${line.elapsedPercent}% - ${nowWidth / 2}px)`,
              width: nowWidth,
              height: size.height,
              clipPath: `path("${usageNowPath(size.height)}")`,
            }}
          />
        )}
        <span
          ref={figure}
          className={`vf-profiles-usage-pct${place.inside ? " is-inside" : ""}`}
          // before the first measure (and in a layout-free test DOM) the figure waits after the head
          style={{ left: size.track > 0 ? `${place.x}px` : `calc(${used}% + 5px)` }}
        >
          {Math.round(line.usedPercent)}%
        </span>
      </span>
      <span className="vf-profiles-usage-reset tabular-nums" aria-hidden="true">
        {line.resets && <ResetIcon />}
        {line.reset ?? ""}
      </span>
    </div>
  );
}

/** One line per usage window (pass 10, C1; pass 22, Line · Glow · Halo): the
 * track is the window's time, the fill is use with its head lit, the % rides
 * the head and never moves for the now line — the line gives way to it — and
 * the reset closes the track. Windows that meter part of the plan sit under a
 * heading in the provider's words (pass 20). Orange only when ahead of pace
 * (or over, or near the limit when pace is unknown). */
export function UsageTimeline({
  lines,
  label,
  variant = "row",
}: {
  lines: readonly UsageLine[];
  /** what these windows belong to, for a screen reader */
  label: string;
  /** on a plan card the lines take the card's width (pass 19: 34 · track · 66) */
  variant?: "row" | "card";
}): ReactElement | null {
  if (lines.length === 0) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: the lines share one grid's columns (display: contents rows), which a <ul> of <li> would lose
    <div
      className={`vf-profiles-usage${variant === "card" ? " vf-profiles-usage--card" : ""}`}
      role="list"
      aria-label={`${label} usage`}
    >
      {lines.map((line, index) => {
        const group = line.group;
        const heads = group !== undefined && group.id !== lines[index - 1]?.group?.id;
        return (
          <UsageGroupLine key={line.id} heading={heads ? group.label : undefined} line={line} />
        );
      })}
    </div>
  );
}

/** A line, with its group's heading above it when it opens the group. The
 * heading is said in each line's own words, so it is hidden from the list. */
function UsageGroupLine({ heading, line }: { heading?: string | undefined; line: UsageLine }) {
  return (
    <>
      {heading !== undefined && (
        <span className="vf-profiles-usage-group" aria-hidden="true">
          {heading}
        </span>
      )}
      <UsageLineView line={line} />
    </>
  );
}

/** Pending meters keep their shape without inventing window labels or percentages. */
function UsageLoading({
  label,
  hasReading = false,
  variant = "row",
}: {
  label: string;
  hasReading?: boolean;
  variant?: "row" | "card";
}): ReactElement {
  if (hasReading) {
    return <span className="sr-only" role="status" aria-label={`${label}: Refreshing usage`} />;
  }
  return (
    <div
      className={`vf-profiles-usage-loading${variant === "card" ? " vf-profiles-usage-loading--card" : ""}`}
      role="status"
      aria-label={`${label}: Loading usage`}
    >
      <div className="vf-profiles-usage-placeholder" aria-hidden="true">
        {[0, 1].map((row) => (
          <div className="vf-profiles-usage-placeholder-row" key={row}>
            <span className="vf-profiles-usage-placeholder-label" />
            <span className="vf-profiles-usage-placeholder-track" />
            <span className="vf-profiles-usage-placeholder-reset" />
          </div>
        ))}
      </div>
      {variant === "row" && (
        <span className="vf-profiles-usage-loading-caption" aria-hidden="true">
          <span className="vf-profiles-usage-loading-dot" />
          Loading usage…
        </span>
      )}
    </div>
  );
}

/* ── plans (pass 19, P2): cards on top, badges on the agents ─────────────── */

/** Which plan the pointer is on, shared by a page's cards and badges. */
export interface PlanLight {
  lit: string | null;
  onLight: (plan: string | null) => void;
}

/** One plan the profile runs on: the company's mark, the plan and whose it is,
 * then every usage window as a C1 line — or one sentence — and at its foot the
 * agents that spend it. One act when the plan needs one. */
export function PlanCardView({
  card,
  now,
  light,
  busy = false,
  refreshingUsage = false,
  onAct,
}: {
  card: PlanCard;
  now: Date;
  light?: PlanLight | undefined;
  busy?: boolean;
  refreshingUsage?: boolean;
  onAct?: ((card: PlanCard) => void) | undefined;
}): ReactElement {
  const lines = usageLines(card.metrics, now);
  const loading =
    refreshingUsage && card.named && card.namedBy !== undefined && card.act?.kind !== "reauth";
  const titleId = useId();
  return (
    <article
      className={`vf-profiles-plan${light?.lit === card.id ? " is-lit" : ""}${
        card.sentence?.attention !== undefined ? " is-lapsed" : ""
      }`}
      data-plan={card.id}
      aria-labelledby={titleId}
      onPointerEnter={() => light?.onLight(card.id)}
      onPointerLeave={() => light?.onLight(null)}
    >
      <header className="vf-profiles-plan-head">
        <ServiceTile service={card.service} size="card" />
        {loading && lines.length > 0 && (
          <span
            className="vf-profiles-plan-refresh"
            role="status"
            aria-label={`${card.title}: Refreshing usage`}
            title="Refreshing usage…"
          >
            <span className="vf-profiles-usage-loading-dot" aria-hidden="true" />
          </span>
        )}
        <div className="vf-profiles-plan-name">
          <h4 id={titleId} className="vf-profiles-plan-title">
            {card.title}
          </h4>
          <p className="vf-profiles-plan-account">{card.account}</p>
        </div>
        {card.act !== undefined && onAct !== undefined && (
          <UiButton
            className="vf-profiles-plan-act"
            disabled={busy}
            aria-label={card.act.description}
            onClick={() => onAct(card)}
          >
            {card.act.label}
          </UiButton>
        )}
      </header>
      {card.note !== undefined && <p className="vf-profiles-plan-note">{card.note}</p>}
      <div
        className={`vf-profiles-plan-usage${loading && lines.length === 0 ? " is-loading" : ""}`}
      >
        {lines.length > 0 ? (
          <UsageTimeline lines={lines} label={card.title} variant="card" />
        ) : card.sentence !== undefined ? (
          // Preserve the sentence's space while the skeleton replaces it,
          // including wrapped failure messages on narrow cards.
          <p className="vf-profiles-plan-sentence" aria-hidden={loading || undefined}>
            {card.sentence.attention !== undefined && (
              <span className="vf-profiles-attention">{card.sentence.attention} </span>
            )}
            {card.sentence.text}
          </p>
        ) : null}
        {loading && lines.length === 0 && <UsageLoading label={card.title} variant="card" />}
      </div>
      <footer className="vf-profiles-plan-foot">
        <span className="vf-profiles-plan-users" aria-hidden="true">
          {card.users.map((user) => (
            <span key={user.provider} className="vf-profiles-plan-user">
              <AgentIcon providerId={user.provider} />
            </span>
          ))}
        </span>
        <span className="vf-profiles-plan-names">
          {card.users.map((user) => user.label).join(", ")}
        </span>
        {card.alsoIn.length > 0 && <span className="vf-profiles-plan-also">{card.alsoIn}</span>}
      </footer>
    </article>
  );
}

/** A badge: the card in small — the same mark, the same name. */
function PlanBadgeView({
  badge,
  hot,
  light,
}: {
  badge: PlanBadge;
  hot: boolean;
  light?: PlanLight | undefined;
}): ReactElement {
  const plan = badge.planId;
  return (
    // biome-ignore lint/a11y/useSemanticElements: one item of the row's badge list (see there)
    <span
      role="listitem"
      className={`vf-profiles-badge${badge.runsOn ? " is-on" : ""}${badge.payAsYouGo ? " is-key" : ""}${
        plan !== undefined && light?.lit === plan ? " is-lit" : ""
      }`}
      data-plan={plan}
      title={badge.payAsYouGo ? "Pay as you go — not a subscription" : undefined}
      onPointerEnter={plan === undefined ? undefined : () => light?.onLight(plan)}
      onPointerLeave={plan === undefined ? undefined : () => light?.onLight(null)}
    >
      <ServiceMark service={badge.service} />
      <span>{badge.title}</span>
      {badge.runsOn && <span className="sr-only">, runs on this</span>}
      {badge.expired ? (
        <em className="vf-profiles-badge-expired">expired</em>
      ) : (
        hot && (
          <i className="vf-profiles-badge-hot" title="Near its limit">
            <span className="sr-only">, near its limit</span>
          </i>
        )
      )}
    </span>
  );
}

/* ── a menu under a button (island material, Esc closes) ─────────────────── */

export interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
}

export function MenuButton({
  label,
  items,
  heading,
  empty,
  variant = "quiet",
  icon,
  align = "end",
  disabled = false,
  onPick,
}: {
  label: string;
  items: readonly MenuItem[];
  heading?: string;
  /** said in the menu when there is nothing to pick */
  empty?: string;
  variant?: "quiet" | "primary";
  icon?: ReactNode;
  align?: "end" | "center";
  disabled?: boolean;
  onPick: (key: string) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent): void => {
      if (wrap.current !== null && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    // the first item takes focus as the menu opens — or, with nothing to pick,
    // the menu itself, so Escape closes the menu and never the Settings sheet
    (
      wrap.current?.querySelector<HTMLElement>("[role=menuitem]") ??
      wrap.current?.querySelector<HTMLElement>("[role=menu]")
    )?.focus();
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const entries = [...(wrap.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      entries[(at + step + entries.length) % entries.length]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="vf-profiles-menu-wrap" ref={wrap}>
      <UiButton
        ref={trigger}
        variant={variant}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="vf-profiles-menu-trigger"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon}
        {label}
      </UiButton>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={heading ?? label}
          tabIndex={-1}
          className={`vf-profiles-menu vf-profiles-menu--${align}`}
          onKeyDown={onMenuKey}
        >
          {heading !== undefined && (
            <div className="vf-profiles-menu-heading" aria-hidden="true">
              {heading}
            </div>
          )}
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="vf-profiles-menu-item"
              onClick={() => {
                close(true);
                onPick(item.key);
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
          {items.length === 0 && empty !== undefined && (
            <div className="vf-profiles-menu-empty" role="none">
              {empty}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── the glyph, chosen ────────────────────────────────────────────────────── */

/** The eleven glyphs in a row, one chosen (the New agent profile page). */
export function GlyphChoice({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (glyph: string) => void;
  label: string;
}): ReactElement {
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const at = PROFILE_GLYPHS.indexOf(value as (typeof PROFILE_GLYPHS)[number]);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = PROFILE_GLYPHS[(at + step + PROFILE_GLYPHS.length) % PROFILE_GLYPHS.length]!;
    onChange(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-glyph="${next}"]`)?.focus();
  };
  return (
    // eleven drawn glyphs, not labelled inputs: buttons in the radio role carry the choice and the arrow keys
    <div role="radiogroup" aria-label={label} className="vf-profiles-glyphs" onKeyDown={onKey}>
      {PROFILE_GLYPHS.map((glyph) => (
        // biome-ignore lint/a11y/useSemanticElements: a drawn glyph in the radio role (see the group above)
        <button
          key={glyph}
          type="button"
          role="radio"
          aria-checked={glyph === value}
          aria-label={glyph}
          tabIndex={glyph === value ? 0 : -1}
          data-glyph={glyph}
          className="vf-profiles-glyph-option"
          onClick={() => onChange(glyph)}
        >
          <ProfileGlyph glyph={glyph} size={20} />
        </button>
      ))}
    </div>
  );
}

/** A pop-up button that shows the profile's glyph and opens the eleven. */
export function GlyphPopUp({
  set,
  disabled = false,
  onChange,
}: {
  set: AgentProfileSet;
  disabled?: boolean;
  onChange: (glyph: string) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = profileGlyphName(set.glyph);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent): void => {
      if (wrap.current !== null && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    wrap.current?.querySelector<HTMLElement>(`[data-glyph="${current}"]`)?.focus();
    return () => document.removeEventListener("pointerdown", away);
  }, [open, current]);

  const pick = (glyph: string): void => {
    setOpen(false);
    trigger.current?.focus();
    if (glyph !== current) onChange(glyph);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const options = [...(wrap.current?.querySelectorAll<HTMLElement>("[role=option]") ?? [])];
    const at = options.indexOf(document.activeElement as HTMLElement);
    const columns = 6;
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    };
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    } else if (moves[event.key] !== undefined) {
      event.preventDefault();
      const next = Math.min(options.length - 1, Math.max(0, at + moves[event.key]!));
      options[next]?.focus();
    }
  };

  return (
    <div className="vf-profiles-menu-wrap" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="vf-profiles-popup"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Glyph: ${current}`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <ProfileMark set={set} size={18} />
        <DownIcon />
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Glyphs"
          className="vf-profiles-menu vf-profiles-menu--end vf-profiles-glyph-grid"
          onKeyDown={onKey}
        >
          {PROFILE_GLYPHS.map((glyph) => (
            <button
              key={glyph}
              type="button"
              role="option"
              aria-selected={glyph === current}
              aria-label={glyph}
              tabIndex={-1}
              data-glyph={glyph}
              className="vf-profiles-glyph-option"
              onClick={() => pick(glyph)}
            >
              <ProfileGlyph glyph={glyph} size={20} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── the two-step confirm (P7) ────────────────────────────────────────────── */

/** A row with an explanation and one act; the act asks first, in place: the
 * question, exactly what goes, the act again, Cancel. Red is text only. */
export function ConfirmRow({
  title,
  description,
  action,
  question,
  what,
  confirm,
  danger = false,
  disabled = false,
  busy = false,
  onConfirm,
}: {
  title: string;
  description: ReactNode;
  /** the row's button ("Delete…", "Sign out…") */
  action: string;
  question: string;
  what: string;
  /** the confirming act ("Delete Work", "Sign out") */
  confirm: string;
  danger?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
}): ReactElement {
  const [armed, setArmed] = useState(false);
  const act = useRef<HTMLButtonElement>(null);
  const arm = useRef<HTMLButtonElement>(null);
  const wasArmed = useRef(false);
  const questionId = useId();
  useEffect(() => {
    if (armed) act.current?.focus();
    // disarmed (Cancel, Escape): focus goes back to the button that armed it
    else if (wasArmed.current) arm.current?.focus();
    wasArmed.current = armed;
  }, [armed]);
  useEffect(() => {
    if (disabled) setArmed(false);
  }, [disabled]);
  return (
    <div className={`vf-profiles-confirm${armed ? " is-armed" : ""}`}>
      <SettingsRow title={title} description={description} divider={false}>
        {!armed && (
          <UiButton
            ref={arm}
            variant={danger ? "danger" : "quiet"}
            disabled={disabled || busy}
            onClick={() => setArmed(true)}
          >
            {action}
          </UiButton>
        )}
      </SettingsRow>
      {armed && (
        <fieldset
          className="vf-profiles-confirm-box"
          aria-labelledby={questionId}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setArmed(false);
            }
          }}
        >
          <p id={questionId} className="vf-profiles-confirm-question">
            {question}
          </p>
          <p className={`vf-profiles-confirm-what ${labelCls}`}>{what}</p>
          <div className="vf-profiles-confirm-acts">
            <UiButton
              ref={act}
              variant={danger ? "danger" : "quiet"}
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? "Working…" : confirm}
            </UiButton>
            <UiButton disabled={busy} onClick={() => setArmed(false)}>
              Cancel
            </UiButton>
          </div>
        </fieldset>
      )}
    </div>
  );
}

/* ── a profile's page ─────────────────────────────────────────────────────── */

export interface ProfilePageViewProps {
  page: ProfilePageModel;
  refreshingUsage?: boolean | undefined;
  onRefreshUsage?: (() => void) | undefined;
  /** "now" for the usage lines (the catalog pins it) */
  now?: Date | undefined;
  notice?: AgentsNotice | null | undefined;
  /** an act in flight: "name" · "glyph" · "default" · "reveal" · "delete" · `add:<provider>` */
  busy?: string | null | undefined;
  /** the sign-in terminal, when one runs on this page */
  signIn?: ReactNode;
  /** AR-S4b — the profile's MCP servers and skills, beneath its agents */
  extensions?: ReactNode;
  revealLabel?: string | undefined;
  onAdd: (provider: string) => void;
  onOpenAgent: (provider: string) => void;
  onSignIn: (provider: string) => void;
  /** end a sign-in whose terminal this page does not show (opened elsewhere,
   * or before the page was left); absent, a signing-in row offers nothing */
  onCancelSignIn?: ((provider: string) => void) | undefined;
  /** answers whether the name was taken (a refused one is put back) */
  onRename: (label: string) => Promise<boolean> | undefined;
  onGlyph: (glyph: string) => void;
  onMakeDefault: () => void;
  onReveal: () => void;
  onDelete: () => void;
  /** a plan card's act: sign its account's agent in again, or a borrower in with its own login */
  onPlanAct?: ((card: PlanCard) => void) | undefined;
}

export function ProfilePageView({
  page,
  refreshingUsage = false,
  onRefreshUsage,
  now,
  notice = null,
  busy = null,
  signIn,
  extensions,
  revealLabel = "Show in Finder",
  onAdd,
  onOpenAgent,
  onSignIn,
  onCancelSignIn,
  onRename,
  onGlyph,
  onMakeDefault,
  onReveal,
  onDelete,
  onPlanAct,
}: ProfilePageViewProps): ReactElement {
  const { set, rows } = page;
  const managed = set.kind === "managed";
  const [lit, setLit] = useState<string | null>(null);
  const light: PlanLight = { lit, onLight: setLit };
  const at = now ?? new Date();
  // a plan near its limit puts a dot on every badge of it: one allowance, spent together
  const hot = new Set(
    page.plans
      .filter((card) => usageLines(card.metrics, at).some((line) => line.hot))
      .map((card) => card.id),
  );
  const addItems: MenuItem[] = page.addable.map((agent) => ({
    key: agent.provider,
    label: agent.label,
    icon: <AgentTile provider={agent.provider} />,
  }));
  const addMenu = (variant: "quiet" | "primary", align: "end" | "center") => (
    <MenuButton
      label="Add agent…"
      variant={variant}
      align={align}
      icon={variant === "quiet" ? <PlusIcon /> : undefined}
      heading={`Sign in to an agent ${page.inOn}`}
      empty="Every installed agent is signed in here."
      items={addItems}
      disabled={busy?.startsWith("add:") === true}
      onPick={onAdd}
    />
  );
  const empty = emptyProfileWords(set);
  const removal = deleteWords(page);
  return (
    <div className="vf-agents vf-agents-page vf-profiles-page" data-profile={set.id}>
      <header className="vf-agents-hero vf-profiles-hero">
        <span className="vf-agents-mark vf-agents-mark--hero" aria-hidden="true">
          <ProfileMark set={set} size={28} />
        </span>
        <div className="vf-agents-hero-text">
          <h2 className="vf-agents-hero-name" tabIndex={-1} data-agents-page-title="">
            {set.label}
          </h2>
          <p className="vf-agents-hero-fact">{page.facts}</p>
        </div>
        {rows.length > 0 && onRefreshUsage !== undefined && (
          <UiButton disabled={refreshingUsage} aria-busy={refreshingUsage} onClick={onRefreshUsage}>
            {refreshingUsage ? "Refreshing…" : "Refresh usage"}
          </UiButton>
        )}
      </header>

      {notice !== null && (
        <InlineNotice tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </InlineNotice>
      )}

      {rows.length === 0 ? (
        <EmptyState
          className="vf-agents-empty vf-profiles-empty"
          visual={
            <span className="vf-profiles-empty-mark">
              <ProfileMark set={set} size={22} />
            </span>
          }
          title={empty.title}
          description={empty.description}
          actions={addMenu("primary", "center")}
        />
      ) : null}

      {page.plans.length > 0 && (
        <section className="vf-profiles-plans" aria-labelledby={`vf-profiles-plans-${set.id}`}>
          <div className="vf-profiles-plans-head">
            <h3
              id={`vf-profiles-plans-${set.id}`}
              className="text-[13px] font-semibold tracking-[-0.01em] text-black/85 dark:text-white/85"
            >
              Subscriptions
            </h3>
            <span className={labelCls}>What {set.label} runs on</span>
          </div>
          <div className="vf-profiles-plan-grid">
            {page.plans.map((card) => (
              <PlanCardView
                key={card.id}
                card={card}
                now={at}
                light={light}
                busy={busy !== null}
                refreshingUsage={refreshingUsage}
                onAct={onPlanAct}
              />
            ))}
          </div>
        </section>
      )}

      {signIn}

      {rows.length > 0 && (
        <SettingsSection title="Agents" action={addMenu("quiet", "end")}>
          <div className="vf-agents-list">
            {rows.map((row) => (
              <ProfileAgentRowView
                key={row.provider}
                row={row}
                now={now}
                light={light}
                hot={hot}
                busy={busy}
                onOpen={() => onOpenAgent(row.provider)}
                onSignIn={() => onSignIn(row.provider)}
                onCancelSignIn={
                  onCancelSignIn === undefined ? undefined : () => onCancelSignIn(row.provider)
                }
              />
            ))}
          </div>
        </SettingsSection>
      )}

      {extensions}

      <SettingsSection title="Profile">
        {managed && (
          <SettingsRow title="Name">
            <NameField
              value={set.label}
              disabled={busy === "name"}
              onCommit={(label) => (label !== set.label ? onRename(label) : undefined)}
            />
          </SettingsRow>
        )}
        {managed && (
          <SettingsRow title="Glyph">
            <GlyphPopUp set={set} disabled={busy === "glyph"} onChange={onGlyph} />
          </SettingsRow>
        )}
        <SettingsRow title="Use for new sessions" description={defaultSwitchWords(set.default)}>
          <UiSwitch
            checked={set.default}
            // there is always exactly one default: it only ever moves TO a profile
            disabled={set.default || busy === "default"}
            label="Use for new sessions"
            onChange={(on) => {
              if (on) onMakeDefault();
            }}
          />
        </SettingsRow>
        {managed ? (
          <SettingsRow
            title="Folder"
            description={
              set.folder === undefined ? (
                "Made with its first sign-in"
              ) : (
                <span className="vf-agents-path">{set.folder}</span>
              )
            }
            divider={false}
          >
            <UiButton
              onClick={onReveal}
              disabled={set.folder === undefined || busy === "reveal"}
              aria-label={`${revealLabel}: ${set.label}’s folder`}
            >
              {revealLabel}
            </UiButton>
          </SettingsRow>
        ) : (
          <SettingsRow
            title="Folders"
            description="Each agent keeps its own, shown on the agent's page"
            divider={false}
          >
            {null}
          </SettingsRow>
        )}
      </SettingsSection>

      {managed && (
        <section className={`${borderCls} vf-profiles-danger`}>
          <ConfirmRow
            title="Delete this agent profile"
            description={removal.description}
            action="Delete…"
            question={removal.question}
            what={removal.what}
            confirm={`Delete ${set.label}`}
            danger
            disabled={removal.blocked}
            busy={busy === "delete"}
            onConfirm={onDelete}
          />
        </section>
      )}
    </div>
  );
}

function ProfileAgentRowView({
  row,
  now,
  light,
  hot,
  busy,
  onOpen,
  onSignIn,
  onCancelSignIn,
}: {
  row: ProfileAgentRow;
  now?: Date | undefined;
  light?: PlanLight | undefined;
  /** the plans near their limit */
  hot?: ReadonlySet<string> | undefined;
  busy: string | null;
  onOpen: () => void;
  onSignIn: () => void;
  onCancelSignIn?: (() => void) | undefined;
}): ReactElement {
  const factId = `vf-profiles-fact-${row.persona.profileId}`;
  // pass 19: a row that wears badges leaves its plan's usage to the plan's card
  const badged = row.badges.length > 0 && (row.state === "signed-in" || row.state === "expired");
  // Usage may arrive before the identity that places it on a plan. Keep it
  // for that card instead of briefly moving the meters into the agent row.
  const lines = badged || row.state === "unread" ? [] : usageLines(row.usage, now ?? new Date());
  let action: ReactNode = null;
  if (row.state === "expired") {
    action = (
      <UiButton
        onClick={onSignIn}
        disabled={busy !== null}
        aria-label={`Sign in to ${row.label} again`}
      >
        Sign in again
      </UiButton>
    );
  } else if (row.state === "signed-out") {
    action = (
      <UiButton onClick={onSignIn} disabled={busy !== null} aria-label={`Sign in to ${row.label}`}>
        Sign in
      </UiButton>
    );
  } else if (row.state === "signing-in" && onCancelSignIn !== undefined) {
    action = (
      <UiButton onClick={onCancelSignIn} aria-label={`Cancel ${row.label}'s sign-in`}>
        Cancel sign-in
      </UiButton>
    );
  }
  return (
    <div
      className={`vf-agents-row vf-profiles-row${lines.length > 0 ? " has-usage" : ""}${
        badged ? " has-badges" : ""
      }`}
      data-provider={row.provider}
    >
      <AgentTile provider={row.provider} />
      <div className="vf-agents-row-text">
        <button
          type="button"
          className="vf-agents-row-open"
          aria-describedby={factId}
          onClick={onOpen}
        >
          {row.label}
        </button>
        {badged ? (
          // biome-ignore lint/a11y/useSemanticElements: badges wrap as one flowing line; a <ul> would add list chrome to reset
          <span id={factId} className="vf-profiles-badges" role="list" aria-label="Subscriptions">
            {row.badges.map((badge) => (
              <PlanBadgeView
                key={badge.key}
                badge={badge}
                hot={badge.planId !== undefined && hot?.has(badge.planId) === true}
                light={light}
              />
            ))}
            {row.unnamed !== undefined && (
              <span className="vf-profiles-badges-note">{row.unnamed}</span>
            )}
          </span>
        ) : (
          <span id={factId} className="vf-agents-row-fact">
            {row.state === "expired" ? (
              <>
                <span className="vf-profiles-attention">Sign-in expired</span>
                {row.fact.replace(/^Sign-in expired/u, "")}
              </>
            ) : (
              row.fact
            )}
          </span>
        )}
        <UsageTimeline lines={lines} label={row.label} />
      </div>
      <div className="vf-agents-row-actions">{action}</div>
      <Chevron />
    </div>
  );
}

/** A name edited in place; it is written when the field is left or Return is
 * pressed, never per keystroke, and an empty name puts the old one back. */
function NameField({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  /** answers whether the name was taken; a refused one is put back */
  onCommit: (label: string) => Promise<boolean> | undefined;
}): ReactElement {
  const [draft, setDraft] = useState(value);
  // the last name sent: Return and then leaving the field send it once
  const sent = useRef(value);
  useEffect(() => {
    sent.current = value;
    setDraft(value);
  }, [value]);
  const commit = (): void => {
    const label = draft.trim();
    if (label.length === 0) {
      setDraft(value);
      return;
    }
    if (label === sent.current) return;
    sent.current = label;
    void onCommit(label)?.then((taken) => {
      if (taken) return;
      sent.current = value;
      setDraft(value);
    });
  };
  return (
    <input
      className={`${fieldCls} vf-profiles-name`}
      value={draft}
      maxLength={64}
      spellCheck={false}
      aria-label="Profile name"
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.stopPropagation();
          setDraft(value);
        }
      }}
    />
  );
}

/* ── one agent inside a profile ───────────────────────────────────────────── */

export interface ProfileAgentPageViewProps {
  set: AgentProfileSet;
  row: ProfileAgentRow;
  refreshingUsage?: boolean | undefined;
  onRefreshUsage?: (() => void) | undefined;
  /** the shared app's installed version, for the row that leads to it */
  appVersion?: string | undefined;
  /** This Mac's sign-out needs the agent's own command; a profile's always works */
  canSignOut: boolean;
  now?: Date | undefined;
  notice?: AgentsNotice | null | undefined;
  /** "signin" · "reveal" · "signout" */
  busy?: string | null | undefined;
  signIn?: ReactNode;
  revealLabel?: string | undefined;
  onSignIn: () => void;
  /** end a sign-in whose terminal this page does not show; absent, nothing */
  onCancelSignIn?: (() => void) | undefined;
  onReveal: () => void;
  onSignOut: () => void;
  onOpenApp: () => void;
  /** the profile's plan cards, which this agent's sign-ins are on (pass 19) */
  plans?: readonly PlanCard[] | undefined;
  /** the ways to add a sign-in, for an agent whose folder holds several */
  routes?: readonly AgentSignInRoute[] | undefined;
  /** add a sign-in by one of the agent's routes, or by its default login */
  onAddSignIn?: ((route?: string) => void) | undefined;
}

export function ProfileAgentPageView({
  set,
  row,
  refreshingUsage = false,
  onRefreshUsage,
  appVersion,
  canSignOut,
  now,
  notice = null,
  busy = null,
  signIn,
  revealLabel = "Show in Finder",
  onSignIn,
  onCancelSignIn,
  onReveal,
  onSignOut,
  onOpenApp,
  plans = [],
  routes,
  onAddSignIn,
}: ProfileAgentPageViewProps): ReactElement {
  const at = now ?? new Date();
  const lines = usageLines(row.usage, at);
  const identity = row.persona.identity;
  const signedIn = row.state === "signed-in" || row.state === "expired";
  // a vendor agent's one sign-in is on its company's plan: the card says it best
  const card = row.several
    ? undefined
    : plans.find((candidate) => candidate.id === row.holds[0]?.planId);
  const title =
    card?.title ?? (signedIn && identity?.plan !== undefined ? identity.plan : row.label);
  const email = identity?.account ?? identity?.email ?? identity?.organization;
  const who =
    card !== undefined
      ? `${card.account}${card.alsoIn.length > 0 ? ` · ${card.alsoIn}` : ""}`
      : (email ?? "Signed in");
  const detail =
    row.state === "signed-in"
      ? lines.length > 0
        ? who
        : `${who}${row.usageUnsupported && !refreshingUsage ? ` · usage isn't reported by ${row.label}` : ""}`
      : row.fact;
  const inOn = inOnWords(set);
  const words = signOutWords(set, row.label, row.several ? row.holds : undefined);
  // a borrowed sign-in (the GitHub CLI's, for one) offers the agent's own login instead
  const own = row.state === "signed-in" && card?.act?.kind === "own" ? card.act : undefined;
  const act =
    row.state === "signing-in" ? (
      onCancelSignIn === undefined ? null : (
        <UiButton onClick={onCancelSignIn}>Cancel sign-in</UiButton>
      )
    ) : (
      <UiButton onClick={onSignIn} disabled={busy !== null} aria-label={own?.description}>
        {own !== undefined
          ? own.label
          : row.state === "signed-in"
            ? "Switch account…"
            : row.state === "expired" || row.state === "unverifiable"
              ? "Sign in again"
              : "Sign in"}
      </UiButton>
    );
  const addSignIn = (variant: "quiet" | "primary") =>
    routes !== undefined && routes.length > 0 ? (
      <MenuButton
        label="Add a sign-in…"
        variant={variant}
        align={variant === "primary" ? "center" : "end"}
        icon={variant === "quiet" ? <PlusIcon /> : undefined}
        heading={`Add a sign-in to ${row.label} ${inOn}`}
        // a route to one named service before the catch-all ("Another provider…")
        items={[...routes]
          .sort((a, b) => Number(a.service === undefined) - Number(b.service === undefined))
          .map((route) => ({
            key: route.id,
            label: route.label,
            icon:
              route.service === undefined ? (
                <span className="vf-agents-mark vf-agents-mark--row" aria-hidden="true">
                  <PlusIcon />
                </span>
              ) : (
                <ServiceTile service={route.service} />
              ),
          }))}
        disabled={busy !== null || row.state === "signing-in"}
        onPick={(route) => onAddSignIn?.(route)}
      />
    ) : (
      <UiButton
        variant={variant}
        disabled={busy !== null || row.state === "signing-in"}
        onClick={() => onAddSignIn?.()}
      >
        {variant === "quiet" && <PlusIcon />}
        Add a sign-in…
      </UiButton>
    );
  let first: ReactNode;
  if (row.several && row.state === "signed-out") {
    first = (
      <EmptyState
        className="vf-agents-empty vf-profiles-empty"
        visual={
          <span className="vf-profiles-empty-mark">
            <AgentIcon providerId={row.provider} />
          </span>
        }
        title={`${row.label} isn't signed in to anything ${inOn}`}
        description={`Add a sign-in to any service it supports. It stays in ${row.label}'s folder ${inOn}.`}
        actions={addSignIn("primary")}
      />
    );
  } else if (row.several && row.holds.length > 0) {
    first = (
      <SettingsSection
        title="Sign-ins"
        action={
          <div className="vf-agents-row-actions">
            {onRefreshUsage !== undefined && (
              <UiButton
                disabled={refreshingUsage}
                aria-busy={refreshingUsage}
                onClick={onRefreshUsage}
              >
                {refreshingUsage ? "Refreshing…" : "Refresh usage"}
              </UiButton>
            )}
            {row.state === "signing-in" && onCancelSignIn !== undefined ? (
              <UiButton onClick={onCancelSignIn}>Cancel sign-in</UiButton>
            ) : (
              addSignIn("quiet")
            )}
          </div>
        }
      >
        <div className="vf-agents-list vf-profiles-signins">
          {signInLines(row, plans).map((line) => {
            const windows = usageLines(line.metrics, at);
            const plan = plans.find((candidate) => candidate.id === line.planId);
            const loading =
              refreshingUsage &&
              row.state === "signed-in" &&
              plan?.named === true &&
              plan.namedBy === row.persona.profileId;
            return (
              <div
                key={line.key}
                className={`vf-agents-row vf-profiles-row vf-profiles-signin-line${
                  windows.length > 0 || loading ? " has-usage" : ""
                }`}
                data-plan={line.planId}
              >
                <ServiceTile service={line.service} />
                <div className="vf-agents-row-text">
                  <span className="vf-profiles-subscription-title">
                    {line.title}
                    {line.inUse && <span className="vf-profiles-tag">in use</span>}
                  </span>
                  <span className="vf-agents-row-fact">{line.fact}</span>
                  <UsageTimeline lines={windows} label={line.title} />
                  {loading && <UsageLoading label={line.title} hasReading={windows.length > 0} />}
                </div>
              </div>
            );
          })}
        </div>
      </SettingsSection>
    );
  } else {
    first = (
      <SettingsSection
        title={row.several ? "Sign-ins" : "Subscription"}
        action={
          onRefreshUsage !== undefined && (
            <UiButton
              disabled={refreshingUsage}
              aria-busy={refreshingUsage}
              onClick={onRefreshUsage}
            >
              {refreshingUsage ? "Refreshing…" : "Refresh usage"}
            </UiButton>
          )
        }
      >
        <div
          className={`vf-agents-row vf-profiles-row vf-profiles-subscription${
            lines.length > 0 || (refreshingUsage && row.state === "signed-in") ? " has-usage" : ""
          }`}
        >
          {card !== undefined ? (
            <ServiceTile service={card.service} />
          ) : (
            <AgentTile provider={row.provider} />
          )}
          <div className="vf-agents-row-text">
            <span className="vf-profiles-subscription-title">{title}</span>
            <span className="vf-agents-row-fact">
              {row.state === "expired" ? (
                <>
                  <span className="vf-profiles-attention">Sign-in expired</span>
                  {email !== undefined ? ` · ${email}` : ""}
                </>
              ) : (
                detail
              )}
            </span>
            {own !== undefined && card?.note !== undefined && (
              <p className="vf-profiles-plan-note">{card.note}</p>
            )}
            <UsageTimeline lines={lines} label={row.label} />
            {refreshingUsage && row.state === "signed-in" && (
              <UsageLoading label={title} hasReading={lines.length > 0} />
            )}
          </div>
          <div className="vf-agents-row-actions">{act}</div>
        </div>
      </SettingsSection>
    );
  }
  return (
    <div className="vf-agents vf-agents-page vf-profiles-agent-page" data-profile={set.id}>
      {/* The page's focus target (the dialog's h1 names it too). */}
      <h2 className="sr-only" tabIndex={-1} data-agents-page-title="">
        {row.label} in {set.label}
      </h2>
      {notice !== null && (
        <InlineNotice tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </InlineNotice>
      )}
      {first}

      {signIn}

      <section className={`${borderCls} vf-profiles-more`}>
        <SettingsRow
          title="Folder"
          description={
            row.persona.folder === undefined ? undefined : (
              <span className="vf-agents-path">{row.persona.folder}</span>
            )
          }
          divider={canSignOut}
        >
          <UiButton
            onClick={onReveal}
            disabled={busy === "reveal"}
            aria-label={`${revealLabel}: ${row.label}’s folder ${set.kind === "native" ? "on This Mac" : `in ${set.label}`}`}
          >
            {revealLabel}
          </UiButton>
        </SettingsRow>
        {canSignOut && (
          <ConfirmRow
            title={words.title}
            description={words.description}
            action="Sign out…"
            question={words.question}
            what={words.what}
            confirm="Sign out"
            busy={busy === "signout"}
            onConfirm={onSignOut}
          />
        )}
      </section>

      <section className={`${borderCls} vf-profiles-app`}>
        <div className="vf-agents-row">
          <AgentTile provider={row.provider} />
          <div className="vf-agents-row-text">
            <button type="button" className="vf-agents-row-open" onClick={onOpenApp}>
              {row.label}
              {appVersion !== undefined && (
                <span className="vf-profiles-app-version tabular-nums"> {appVersion}</span>
              )}
            </button>
            <span className="vf-agents-row-fact">
              The app itself · shared by every agent profile
            </span>
          </div>
          <span />
          <Chevron />
        </div>
      </section>
    </div>
  );
}

/* ── a new profile ────────────────────────────────────────────────────────── */

export interface NewProfileViewProps {
  busy?: boolean | undefined;
  notice?: AgentsNotice | null | undefined;
  onCancel: () => void;
  onCreate: (profile: { label: string; glyph: string; isDefault: boolean }) => void;
}

export function NewProfileView({
  busy = false,
  notice = null,
  onCancel,
  onCreate,
}: NewProfileViewProps): ReactElement {
  const [label, setLabel] = useState("");
  const [glyph, setGlyph] = useState<string | null>(null);
  const [isDefault, setIsDefault] = useState(false);
  const name = useRef<HTMLInputElement>(null);
  useEffect(() => name.current?.focus(), []);
  // the name suggests a glyph until one is chosen
  const shown = glyph ?? suggestProfileGlyph(label.trim().length > 0 ? label : "profile");
  const ready = label.trim().length > 0;
  return (
    <form
      className="vf-agents vf-agents-page vf-profiles-new"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !busy) onCreate({ label: label.trim(), glyph: shown, isDefault });
      }}
    >
      <h2 className="sr-only" tabIndex={-1} data-agents-page-title="">
        New agent profile
      </h2>
      {notice !== null && (
        <InlineNotice tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </InlineNotice>
      )}
      {/* The header names the page and says what it makes; the form is one card. */}
      <section className={borderCls}>
        <SettingsRow title="Name">
          <input
            ref={name}
            className={`${fieldCls} vf-profiles-name`}
            value={label}
            maxLength={64}
            spellCheck={false}
            placeholder="Work, Personal, a client…"
            aria-label="Name"
            onChange={(event) => setLabel(event.target.value)}
          />
        </SettingsRow>
        <SettingsRow
          title="Glyph"
          description={glyph === null ? "Suggested from the name" : "Its mark wherever it appears"}
          align="start"
        >
          <GlyphChoice value={shown} onChange={setGlyph} label="Glyph" />
        </SettingsRow>
        <SettingsRow
          title="Use for new sessions"
          description="Spawns and the Godview launcher start here"
          divider={false}
        >
          <UiSwitch checked={isDefault} label="Use for new sessions" onChange={setIsDefault} />
        </SettingsRow>
      </section>
      <div className="vf-profiles-foot">
        <UiButton onClick={onCancel} disabled={busy}>
          Cancel
        </UiButton>
        <UiButton type="submit" variant="primary" disabled={!ready || busy}>
          {busy ? "Creating…" : "Create profile"}
        </UiButton>
      </div>
    </form>
  );
}

/* ── the sign-in card's frame ─────────────────────────────────────────────── */

/** The terminal a sign-in runs in, on the page (pass 16): its title bar says
 * which agent, in which profile, and when it closes; under it, where the
 * sign-in lands and the way to cancel. The terminal itself is the child. */
export function SignInCard({
  agentLabel,
  where,
  note,
  onCancel,
  cancelling = false,
  children,
}: {
  agentLabel: string;
  where: string;
  note: string;
  onCancel: () => void;
  cancelling?: boolean;
  children: ReactNode;
}): ReactElement {
  const cancel = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  return (
    <section className="vf-profiles-signin" aria-label={`${agentLabel} sign-in`}>
      <div className="vf-agents-output vf-profiles-signin-card">
        <header className="vf-agents-output-head">
          <span className="vf-profiles-signin-title">
            {agentLabel} · sign in · {where}
          </span>
          <span className="vf-agents-output-state">closes when the sign-in is known</span>
        </header>
        {/* The terminal takes every key, Tab and Escape included, so a login can
            use them; Shift-Tab (which no login asks for) is the way back out,
            caught before the terminal sees it. */}
        <div
          className="vf-profiles-signin-body"
          aria-describedby={hintId}
          onKeyDownCapture={(event) => {
            if (
              event.key === "Tab" &&
              event.shiftKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey
            ) {
              event.preventDefault();
              event.stopPropagation();
              cancel.current?.focus();
            }
          }}
        >
          {children}
        </div>
        <span id={hintId} className="sr-only">
          Shift-Tab leaves the terminal.
        </span>
      </div>
      <div className="vf-profiles-signin-row">
        <span className={labelCls}>{note}</span>
        <UiButton ref={cancel} onClick={onCancel} disabled={cancelling}>
          {cancelling ? "Cancelling…" : "Cancel"}
        </UiButton>
      </div>
    </section>
  );
}
