import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { AgentIcon, ProfileGlyph } from "@vibefield/puppeteer-view-sdk/react";
import { MONITOR_STAGE_CLASS } from "@vibefield/puppeteer-views";
import { type CSSProperties, type ReactElement, useLayoutEffect, useRef, useState } from "react";
import { UsageTimeline } from "../../panels/agents/ProfilesView";
import { bandsGeometry } from "../../usage/bands";
import type { PlanMeter, ProfileMeters } from "../../usage/meters";
import { BandsCircle, BandsKey } from "./BandsCircle";
import type { ColumnCircle } from "./ProfilesColumnView";

// UM-3 (DESIGN.md §8 "Godview's profiles column", the popover; §9 "The meters' words") — ONE PROFILE'S METERS, OPENED
// beside its circle: the circle at 212 with its arcs answering the pointer and the bands key under it, and one row per
// plan in the circle's order (UM-D15), each its agent's mark, the plan as Agent Profiles names it, the right words
// (the forecast while it runs ahead, UM-D4, else the reset) and Settings' own C1 line for its tightest window
// (UM-D13) — the shipping `UsageTimeline`, never a copy (UM-D3: one meter everywhere). Controller-free: what it opens,
// reads again or closes is handed back. Wave 1 (UM-D14's interim, ruling 23): a plan's row takes no click.

/** The popover's open size (§8: "the circle at 212 in a 212 column"). */
export const POPOVER_CIRCLE = 212;

/** How long ago the newest reading was taken, in the popover head's words (§9: "Read a minute ago"), or "Reading
 * usage…" while the first is on its way; nothing when nothing reads and nothing is coming. */
export function readWords(meters: ProfileMeters, now: Date): string {
  let newest = Number.NEGATIVE_INFINITY;
  for (const entry of meters.entries) {
    if (entry.kind === "reading") newest = Math.max(newest, Date.parse(entry.fetchedAt));
  }
  if (!Number.isFinite(newest)) {
    return meters.entries.some((entry) => entry.kind === "first-read") ? "Reading usage…" : "";
  }
  const minutes = Math.max(0, Math.round((now.getTime() - newest) / 60_000));
  if (minutes === 0) return "Read just now";
  if (minutes === 1) return "Read a minute ago";
  if (minutes < 60) return `Read ${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "Read an hour ago" : `Read ${hours} hours ago`;
}

export interface ProfilePopoverViewProps {
  circle: ColumnCircle;
  /** several profiles: the column is the lens, and the foot says so */
  lens: boolean;
  /** this profile is the lens's */
  chosen: boolean;
  /** the plan the pointer is on (its meter key): the others dim */
  focus: string | null;
  /** the head's words for the reading's age (`readWords`) */
  read: string;
  onClose: () => void;
  onFocusPlan: (key: string | null) => void;
  /** Settings → Agent Profiles on this profile's page (Sign in, Agent Profiles…) */
  onOpenProfile: (setId: string) => void;
  /** read these sign-ins' usage again (Retry) */
  onRetry: (profileIds: readonly string[]) => void;
}

/** A row's act: what a plan that needs you asks for. A sign-in under way asks nothing. */
function NeedAct({
  entry,
  setId,
  onOpenProfile,
  onRetry,
}: {
  entry: Extract<PlanMeter, { kind: "needs-you" }>;
  setId: string;
  onOpenProfile: (setId: string) => void;
  onRetry: (profileIds: readonly string[]) => void;
}): ReactElement | null {
  if (entry.need === "signing-in") return null;
  const retry = entry.need === "retry";
  return (
    <button
      type="button"
      className="vf-profiles-row-act"
      onClick={() => {
        if (!retry) onOpenProfile(setId);
        else if (entry.profileId !== undefined) onRetry([entry.profileId]);
      }}
    >
      {retry ? "Retry" : "Sign in"}
    </button>
  );
}

/** One plan on the circle: its mark, its title, its right words, and its tightest window's C1 line. */
function PlanRow({
  entry,
  setId,
  focused,
  onFocusPlan,
  onOpenProfile,
  onRetry,
}: {
  entry: Exclude<PlanMeter, { kind: "no-meter" }>;
  setId: string;
  focused: boolean;
  onFocusPlan: (key: string | null) => void;
  onOpenProfile: (setId: string) => void;
  onRetry: (profileIds: readonly string[]) => void;
}): ReactElement {
  const right = entry.right;
  return (
    // pointing at a row only lights its arc, as pointing at the arc does; nothing is chosen (wave 1)
    <div
      className="vf-profiles-row"
      data-plan={entry.key}
      data-kind={entry.kind}
      {...(focused ? { "data-focus": "" } : {})}
      {...(entry.kind === "reading" && entry.stale ? { "data-stale": "" } : {})}
      onPointerEnter={() => onFocusPlan(entry.key)}
      onPointerLeave={() => onFocusPlan(null)}
    >
      <span className="vf-profiles-row-mark" aria-hidden="true">
        <AgentIcon providerId={entry.provider} />
      </span>
      <span className="vf-profiles-row-head">
        <b className="vf-profiles-row-title">{entry.title}</b>
        <span className="vf-profiles-row-right" {...(right.hot ? { "data-hot": "" } : {})}>
          {right.icon ? <FieldGlyph name="reset" size={9} /> : null}
          {right.words}
        </span>
      </span>
      {entry.kind === "reading" ? (
        <span className="vf-profiles-row-meter">
          <UsageTimeline lines={[entry.tightest.line]} label={entry.title} />
        </span>
      ) : entry.kind === "first-read" ? (
        <span className="vf-profiles-row-meter vf-profiles-row-waiting" aria-hidden="true" />
      ) : (
        <NeedAct entry={entry} setId={setId} onOpenProfile={onOpenProfile} onRetry={onRetry} />
      )}
    </div>
  );
}

/** The words a plan with no meter says, in a line of its own; a plan whose usage cannot be read says that. */
function noneWords(entry: Extract<PlanMeter, { kind: "no-meter" }>): string {
  return entry.why === "unavailable"
    ? `${entry.agent}: usage unavailable`
    : `${entry.agent} shows no meter`;
}

/** The lens's words at the popover's foot (§9 "The popover"), with several profiles; wave 1 says none with one. */
function lensWords(label: string, chosen: boolean): string {
  return chosen
    ? `Showing only ${label}'s sessions · click it again for all`
    : `Click it to show only ${label}'s sessions`;
}

export function ProfilePopoverView({
  circle,
  lens,
  chosen,
  focus,
  read,
  onClose,
  onFocusPlan,
  onOpenProfile,
  onRetry,
}: ProfilePopoverViewProps): ReactElement {
  const { set, meters } = circle;
  const geometry = bandsGeometry(POPOVER_CIRCLE, meters.entries, {
    hit: true,
    ...(focus !== null ? { focus } : {}),
  });
  // lifted as far as it must be to stay inside the stage (§8), measured once it stands
  const ref = useRef<HTMLDivElement>(null);
  const [lift, setLift] = useState(0);
  useLayoutEffect(() => {
    const pop = ref.current;
    const stage = pop?.closest(`.${MONITOR_STAGE_CLASS}`);
    if (!pop || !stage) return;
    const over = pop.getBoundingClientRect().bottom + lift - stage.getBoundingClientRect().bottom;
    const next = Math.max(0, Math.ceil(over));
    if (next !== lift) setLift(next);
  });
  const rows = meters.entries.filter(
    (entry): entry is Exclude<PlanMeter, { kind: "no-meter" }> => entry.kind !== "no-meter",
  );
  const none = meters.entries.filter(
    (entry): entry is Extract<PlanMeter, { kind: "no-meter" }> => entry.kind === "no-meter",
  );
  return (
    <div
      ref={ref}
      className="vf-profiles-pop"
      role="dialog"
      aria-label={set.label}
      style={{ "--vf-profiles-pop-lift": `${lift}px` } as CSSProperties}
    >
      <div className="vf-profiles-pop-head">
        <ProfileGlyph glyph={set.glyph} kind={set.kind} filled={set.default} size={15} />
        <b className="vf-profiles-pop-name">{set.label}</b>
        {lens && set.default ? <span className="vf-profiles-pop-tag">default</span> : null}
        {read !== "" ? <span className="vf-profiles-pop-age">{read}</span> : null}
        <button
          type="button"
          className="vf-profiles-pop-close"
          aria-label="Close"
          onClick={onClose}
        >
          <FieldGlyph name="close" size={11} />
        </button>
      </div>
      <div className="vf-profiles-pop-body">
        <div className="vf-profiles-pop-circle">
          <BandsCircle geometry={geometry} labelled onFocusPlan={onFocusPlan} />
          <BandsKey />
        </div>
        <div className="vf-profiles-rows">
          {rows.map((entry) => (
            <PlanRow
              key={entry.key}
              entry={entry}
              setId={set.id}
              focused={focus === entry.key}
              onFocusPlan={onFocusPlan}
              onOpenProfile={onOpenProfile}
              onRetry={onRetry}
            />
          ))}
          {none.map((entry) => (
            <p key={entry.key} className="vf-profiles-none">
              <span className="vf-profiles-none-mark" aria-hidden="true">
                <AgentIcon providerId={entry.provider} />
              </span>
              {noneWords(entry)}
            </p>
          ))}
        </div>
      </div>
      <div className="vf-profiles-pop-foot">
        {lens ? <span className="vf-profiles-pop-lens">{lensWords(set.label, chosen)}</span> : null}
        <button
          type="button"
          className="vf-profiles-pop-open"
          onClick={() => onOpenProfile(set.id)}
        >
          Agent Profiles…
        </button>
      </div>
    </div>
  );
}
