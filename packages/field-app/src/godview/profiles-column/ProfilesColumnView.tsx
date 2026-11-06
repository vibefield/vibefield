import type { AgentProfileSet } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import type { ReactElement, ReactNode } from "react";
import { PROFILES_WORDS } from "../../setup/profiles-words";
import { bandsGeometry } from "../../usage/bands";
import type { ProfileMeters } from "../../usage/meters";
import { BandsCircle } from "./BandsCircle";
import { ProfilePopoverView } from "./ProfilePopoverView";
import "./profiles-column.css";

// UM-3 (DESIGN.md §8 "Godview's profiles column"; UM-D21, UM-D22 and UM-D19 A, UM-D12 carried, SE-D2's ring) — YOUR
// METERS AT THE STAGE'S TOP LEFT, one Bands circle per Agent Profile in a pill of the Line's glass (Chat's composer
// turned upright), and the add at its foot. With one profile it is This Mac, a plain button that opens its popover;
// with several each circle is the profile lens (a toggle, pressed on the chosen profile), the one filter the search
// field's token and the search button's token share. Controller-free: the stage's controller (`ProfilesColumn.tsx`)
// hands it every profile's meters, the lens, what is open and every act, so the catalog mounts this face itself.

/** The pointer's target for the add (its card), beside the profiles' ids. */
export const ADD_TARGET = "\u0000add";

/** One circle: a profile and its meters (`planMeters`, UM-D15's order). */
export interface ColumnCircle {
  set: AgentProfileSet;
  meters: ProfileMeters;
}

export interface ProfilesColumnViewProps {
  /** the profiles in Settings' order, This Mac first (a draft no agent signed in to has none, ruling 7) */
  circles: readonly ColumnCircle[];
  /** several profiles: each circle is the lens (UM-D19); one, a plain button (UM-D12) */
  lens: boolean;
  /** the lens's profile: the stage's profile filter */
  chosen: string | null;
  /** the profile whose popover stands open, pointed at or pinned */
  open: string | null;
  /** the open popover was clicked open (it holds the keys; Esc closes it) */
  pinned: boolean;
  /** the plan the pointer is on in the open popover (its meter key) */
  focus: string | null;
  /** the open popover's head: the reading's age, or "Reading usage…" */
  read: string;
  /** the pointer is on the add: its card shows, unless the limit moment stands in its place */
  addOpen: boolean;
  /** Settings can be opened from here (it is not open already) */
  canAdd: boolean;
  /** the limit moment (UM-D23), beside the add while it is due; it says nothing when it is not */
  moment?: ReactNode;
  /** the pointer came onto a circle (its profile's id) or the add (`ADD_TARGET`), or left them (null) */
  onPoint: (target: string | null) => void;
  onCircle: (setId: string) => void;
  onClose: () => void;
  onFocusPlan: (key: string | null) => void;
  onAdd: () => void;
  onOpenProfile: (setId: string) => void;
  onRetry: (profileIds: readonly string[]) => void;
}

/** The column's circle size (§8: "a 40 round button holding the profile's Bands circle at 40"). */
export const COLUMN_CIRCLE = 40;

/** A circle in words (§9 "Said and not drawn"): "Work, tightest 42%", and with several profiles its lens. */
export function circleWords(circle: ColumnCircle, lens: boolean, chosen: boolean): string {
  const tightest = circle.meters.tightest;
  const read =
    tightest === undefined ? "" : `, tightest ${Math.round(tightest.tightest.line.usedPercent)}%`;
  const toggle = !lens
    ? ""
    : chosen
      ? ", showing only its sessions"
      : ", click to show only its sessions";
  return `${circle.set.label}${read}${toggle}`;
}

export function ProfilesColumnView({
  circles,
  lens,
  chosen,
  open,
  pinned,
  focus,
  read,
  addOpen,
  canAdd,
  moment,
  onPoint,
  onCircle,
  onClose,
  onFocusPlan,
  onAdd,
  onOpenProfile,
  onRetry,
}: ProfilesColumnViewProps): ReactElement {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a column of buttons — the profiles and the add — not a fieldset of form inputs
    <div className="vf-profiles-column" role="group" aria-label="Agent profiles">
      {circles.map((circle) => {
        const id = circle.set.id;
        const isChosen = lens && chosen === id;
        const isOpen = open === id;
        return (
          // the pointer on a circle or its popover shows the popover; the circle is the control
          <div
            key={id}
            className="vf-profiles-item"
            data-profile={id}
            {...(isOpen && pinned ? { "data-pinned": "" } : {})}
            onPointerEnter={() => onPoint(id)}
            onPointerLeave={() => onPoint(null)}
          >
            <button
              type="button"
              className="vf-profiles-circle"
              aria-label={circleWords(circle, lens, isChosen)}
              {...(lens ? { "aria-pressed": isChosen } : {})}
              {...(isOpen ? { "data-open": "" } : {})}
              onClick={() => onCircle(id)}
            >
              <BandsCircle
                geometry={bandsGeometry(COLUMN_CIRCLE, circle.meters.entries, {
                  centre: "glyph",
                  hotDot: true,
                })}
                profile={circle.set}
              />
            </button>
            {isOpen ? (
              <ProfilePopoverView
                circle={circle}
                lens={lens}
                chosen={isChosen}
                focus={focus}
                read={read}
                onClose={onClose}
                onFocusPlan={onFocusPlan}
                onOpenProfile={onOpenProfile}
                onRetry={onRetry}
              />
            ) : null}
          </div>
        );
      })}
      {/* the pointer on the add shows its card; the add is the control */}
      <div
        className="vf-profiles-item vf-profiles-add-item"
        onPointerEnter={() => onPoint(ADD_TARGET)}
        onPointerLeave={() => onPoint(null)}
      >
        <button
          type="button"
          className="vf-profiles-add"
          aria-label={PROFILES_WORDS.add}
          disabled={!canAdd}
          onClick={onAdd}
        >
          <FieldGlyph name="plus" size={17} />
        </button>
        {addOpen ? (
          <div className="vf-profiles-addcard" role="tooltip">
            <b>{PROFILES_WORDS.add}</b>
            <p>{`${PROFILES_WORDS.offer} ${PROFILES_WORDS.fact}`}</p>
            <span className="vf-profiles-addcard-foot">
              <FieldGlyph name="gear" size={11} />
              Opens Settings → Agent Profiles on New profile…
            </span>
          </div>
        ) : null}
        <div className="vf-profiles-moment">{moment}</div>
      </div>
    </div>
  );
}
