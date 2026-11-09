import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { AgentIcon, ProfileGlyph } from "@vibefield/puppeteer-view-sdk/react";
import type { ReactElement } from "react";
import { type UsageResetForm, UsageTimeline } from "../../panels/agents/ProfilesView";
import { bandsGeometry, bandsLabel } from "../../usage/bands";
import type { MeterWindow, PlanMeter, ProfileMeters } from "../../usage/meters";
import { resetForm } from "../../usage/rules";
import { BandsCircle, BandsKey } from "./BandsCircle";
import type { ColumnCircle } from "./ProfilesColumnView";

// UM-3 (DESIGN.md §8 "Godview's profiles column", the popover; §9 "The meters' words") — ONE PROFILE'S METERS, OPENED
// beside its circle: the circle at 212 with its arcs answering the pointer and the bands key under it, and one row per
// plan in the circle's order (UM-D15), each its agent's mark, the plan as Agent Profiles names it, the right words
// (the forecast while it runs ahead, UM-D4, else the reset) and Settings' own C1 line for its tightest window
// (UM-D13) — the shipping `UsageTimeline`, never a copy (UM-D3: one meter everywhere). Controller-free: what it opens,
// reads again or closes is handed back. A plan's row and its arc filter the field (UM-D14; UM-5a).

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
  /** names it for its circle's `aria-controls` */
  id?: string | undefined;
  circle: ColumnCircle;
  /** several profiles: the column is the lens, and the foot says so */
  lens: boolean;
  /** this profile is the lens's */
  chosen: boolean;
  /** the plan the pointer is on (its meter key): the others dim */
  focus: string | null;
  /** the head's words for the reading's age (`readWords`) */
  read: string;
  /** Settings can be opened on this profile's page (it is not open already): Sign in and Agent Profiles… */
  canOpen: boolean;
  /** the usage door can read a sign-in again: Retry */
  canRetry: boolean;
  /** UM-5a — the chosen plan and its twins (union keys, `‹set›/‹key›`), or null: its rows draw pressed, the others dim */
  chosenPlanFamily: readonly string[] | null;
  /** UM-5a — choose a plan by its union key, or null to clear */
  onChoosePlan: (key: string | null) => void;
  onClose: () => void;
  onFocusPlan: (key: string | null) => void;
  /** Settings → Agent Profiles on this profile's page (Sign in, Agent Profiles…) */
  onOpenProfile: (setId: string) => void;
  /** read these sign-ins' usage again (Retry) */
  onRetry: (profileIds: readonly string[]) => void;
}

/** What a plan's row may ask for, and whether each can be asked here (§8: "No act is inert"). */
interface RowActs {
  canOpen: boolean;
  canRetry: boolean;
  onOpenProfile: (setId: string) => void;
  onRetry: (profileIds: readonly string[]) => void;
}

/** A row's act: what a plan that needs you asks for. A sign-in under way asks nothing. */
function NeedAct({
  entry,
  setId,
  acts,
}: {
  entry: Extract<PlanMeter, { kind: "needs-you" }>;
  setId: string;
  acts: RowActs;
}): ReactElement | null {
  if (entry.need === "signing-in") return null;
  if (entry.need === "retry") {
    // Retry reads that one sign-in again: with no sign-in to name, or no door that reads again, none is offered
    const profileId = entry.profileId;
    if (!acts.canRetry || profileId === undefined) return null;
    return (
      <button
        type="button"
        className="vf-profiles-pop-row-act"
        onClick={() => acts.onRetry([profileId])}
      >
        Retry
      </button>
    );
  }
  // Sign in opens the profile's page; while Settings is open there is none to open, so it draws off, as the add
  return (
    <button
      type="button"
      className="vf-profiles-pop-row-act"
      disabled={!acts.canOpen}
      onClick={() => acts.onOpenProfile(setId)}
    >
      Sign in
    </button>
  );
}

/** How the C1 line says its window's reset, as Settings' line says it (the leaf's `resetForm`; UM-D3). */
function formOf(window: MeterWindow): Readonly<Record<string, UsageResetForm>> | undefined {
  const form = resetForm(window);
  return form === undefined ? undefined : { [window.line.id]: form };
}

/** What a plan with no meter says (§9 "What needs you"): "‹agent› shows no meter" is an agent that reports no
 * usage; a plan no agent named, or whose reading holds no window, says its title alone, as the phone does (UM-D3;
 * ‹for James›), since "shows no meter" would be false of an agent that meters. */
function noneWords(entry: Extract<PlanMeter, { kind: "no-meter" }>): string {
  return entry.why === "unreported" ? `${entry.agent} shows no meter` : entry.title;
}

/** One plan on the circle: its mark, its title, its right words, and its tightest window's C1 line. */
function PlanRow({
  entry,
  setId,
  focused,
  onFocusPlan,
  acts,
  pressed,
  dim,
  onToggle,
}: {
  entry: Exclude<PlanMeter, { kind: "no-meter" }>;
  setId: string;
  focused: boolean;
  onFocusPlan: (key: string | null) => void;
  acts: RowActs;
  /** this row's plan is the chosen one, or its twin */
  pressed: boolean;
  /** another plan is chosen */
  dim: boolean;
  onToggle: () => void;
}): ReactElement {
  const right = entry.right;
  const choosable = entry.kind !== "needs-you";
  return (
    // pointing at a row lights its arc, as pointing at the arc does; a click chooses it (UM-D14), through a button
    // stretched over the row so the row keeps its C1 line's list
    <div
      className="vf-profiles-pop-row"
      data-plan={entry.key}
      data-kind={entry.kind}
      {...(focused ? { "data-focus": "" } : {})}
      {...(entry.kind === "reading" && entry.stale ? { "data-stale": "" } : {})}
      {...(pressed ? { "data-pressed": "" } : {})}
      {...(dim ? { "data-dim": "" } : {})}
      onPointerEnter={() => onFocusPlan(entry.key)}
      onPointerLeave={() => onFocusPlan(null)}
    >
      {choosable ? (
        <button
          type="button"
          className="vf-profiles-pop-row-choose"
          aria-pressed={pressed}
          aria-label={`Show only ${entry.title}'s sessions`}
          onClick={onToggle}
        />
      ) : null}
      <span className="vf-profiles-pop-row-mark" aria-hidden="true">
        <AgentIcon providerId={entry.provider} />
      </span>
      <span className="vf-profiles-pop-row-head">
        <b className="vf-profiles-pop-row-title">{entry.title}</b>
        <span className="vf-profiles-pop-row-right" {...(right.hot ? { "data-hot": "" } : {})}>
          {right.icon ? <FieldGlyph name="reset" size={9} /> : null}
          {right.words}
        </span>
      </span>
      {entry.kind === "reading" ? (
        <span className="vf-profiles-pop-row-meter">
          <UsageTimeline
            lines={[entry.tightest.line]}
            resetForms={formOf(entry.tightest)}
            label={entry.title}
          />
        </span>
      ) : entry.kind === "first-read" ? (
        <span
          className="vf-profiles-pop-row-meter vf-profiles-pop-row-waiting"
          aria-hidden="true"
        />
      ) : (
        <NeedAct entry={entry} setId={setId} acts={acts} />
      )}
    </div>
  );
}

/** The lens's words at the popover's foot (§9 "The popover"), with several profiles. */
function lensWords(label: string, chosen: boolean): string {
  return chosen
    ? `Showing only ${label}'s sessions · click it again for all`
    : `Click it to show only ${label}'s sessions`;
}

/** The foot with one profile, which has no lens (§9): the plan filter's words (UM-D14). */
function planWords(chosen: boolean): string {
  return chosen
    ? "Showing one plan's sessions · click it again for all"
    : "Click a plan to show only its sessions";
}

export function ProfilePopoverView({
  id,
  circle,
  lens,
  chosen,
  focus,
  read,
  canOpen,
  canRetry,
  chosenPlanFamily,
  onChoosePlan,
  onClose,
  onFocusPlan,
  onOpenProfile,
  onRetry,
}: ProfilePopoverViewProps): ReactElement {
  const { set, meters } = circle;
  // a row hands back its union key (`meters.ts`'s `${set.id}/${entry.key}`); focus and the arcs stay on the bare key
  const unionKey = (key: string): string => `${set.id}/${key}`;
  const isPressed = (key: string): boolean => chosenPlanFamily?.includes(unionKey(key)) === true;
  const toggle = (key: string): void => onChoosePlan(isPressed(key) ? null : unionKey(key));
  const acts: RowActs = { canOpen, canRetry, onOpenProfile, onRetry };
  const geometry = bandsGeometry(POPOVER_CIRCLE, meters.entries, {
    hit: true,
    ...(focus !== null ? { focus } : {}),
  });
  const rows = meters.entries.filter(
    (entry): entry is Exclude<PlanMeter, { kind: "no-meter" }> => entry.kind !== "no-meter",
  );
  const none = meters.entries.filter(
    (entry): entry is Extract<PlanMeter, { kind: "no-meter" }> => entry.kind === "no-meter",
  );
  // while the usage cannot be read the profile says so once, in the Bands circle's words (§9: "‹profile›: usage
  // unavailable"), never a line per agent; an agent that meters nothing says so on a line of its own
  const unread = none.filter((entry) => entry.why === "unavailable");
  const quiet = none.filter((entry) => entry.why !== "unavailable");
  const choosable = new Set(rows.filter((row) => row.kind !== "needs-you").map((row) => row.key));
  // a row that needs you is not pressable, even while its plan is chosen (§8): the filter stands, its × is search's
  const drawnPressed = (key: string): boolean => choosable.has(key) && isPressed(key);
  const footWords = lens
    ? lensWords(set.label, chosen)
    : choosable.size > 0
      ? planWords(rows.some((row) => drawnPressed(row.key)))
      : null;
  return (
    <div id={id} className="vf-profiles-pop" role="dialog" aria-label={set.label}>
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
          <BandsCircle
            geometry={geometry}
            labelled
            onFocusPlan={onFocusPlan}
            choosable={choosable}
            onChoosePlan={toggle}
          />
          <BandsKey />
        </div>
        <div className="vf-profiles-pop-rows">
          {rows.map((entry) => (
            <PlanRow
              key={entry.key}
              entry={entry}
              setId={set.id}
              focused={focus === entry.key}
              onFocusPlan={onFocusPlan}
              acts={acts}
              pressed={drawnPressed(entry.key)}
              dim={chosenPlanFamily !== null && !isPressed(entry.key) && choosable.has(entry.key)}
              onToggle={() => toggle(entry.key)}
            />
          ))}
          {unread.length > 0 ? <p className="vf-profiles-pop-none">{bandsLabel(unread)}</p> : null}
          {quiet.map((entry) => (
            <p key={entry.key} className="vf-profiles-pop-none">
              <span className="vf-profiles-pop-none-mark" aria-hidden="true">
                <AgentIcon providerId={entry.provider} />
              </span>
              {noneWords(entry)}
            </p>
          ))}
        </div>
      </div>
      <div className="vf-profiles-pop-foot">
        {footWords !== null ? <span className="vf-profiles-pop-lens">{footWords}</span> : null}
        <button
          type="button"
          className="vf-profiles-pop-open"
          disabled={!canOpen}
          onClick={() => onOpenProfile(set.id)}
        >
          Agent Profiles…
        </button>
      </div>
    </div>
  );
}
