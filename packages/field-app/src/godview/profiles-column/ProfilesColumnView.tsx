import type { AgentProfileSet } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { type KeyboardEvent, type ReactElement, type ReactNode, type Ref, useId } from "react";
import { PROFILES_WORDS } from "../../setup/profiles-words";
import { bandsGeometry, bandsLabel } from "../../usage/bands";
import type { ProfileMeters } from "../../usage/meters";
import { BandsCircle } from "./BandsCircle";
import { CardStand } from "./CardStand";
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
  /** Settings can be opened on one profile's page (it is not open already): a popover's Sign in and Agent Profiles… */
  canOpen: boolean;
  /** the usage door can read a sign-in again: a popover's Retry */
  canRetry: boolean;
  /** the limit moment (UM-D23), beside the add while it is due; it says nothing when it is not */
  moment?: ReactNode;
  /** the stage's cards layer (§8 "Where the cards stand"), over the terminals; absent, the cards stand in place */
  cardLayer?: HTMLElement | null | undefined;
  /** the column's own element: the controller finds a circle through it to hand the keyboard home */
  columnRef?: Ref<HTMLDivElement> | undefined;
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

/** What a circle holds, in words: "Work, tightest 42%"; with nothing on it, the Bands circle's own words for that
 * (`bandsLabel`, §8 "Honest states"), "Work: usage unavailable" or "No meters" after its name; and its name alone while
 * its plans are on their way or need you (unruled, ‹for James›). */
function circleState({ set, meters }: ColumnCircle): string {
  const tightest = meters.tightest;
  if (tightest !== undefined) {
    return `${set.label}, tightest ${Math.round(tightest.tightest.line.usedPercent)}%`;
  }
  if (meters.entries.some((entry) => entry.kind !== "no-meter")) return set.label;
  const said = bandsLabel(meters.entries);
  return said === "No meters" ? `${set.label}, no meters` : said;
}

/** A circle in words (§9 "Said and not drawn"): what it holds, and with several profiles its lens. */
export function circleWords(circle: ColumnCircle, lens: boolean, chosen: boolean): string {
  const toggle = !lens
    ? ""
    : chosen
      ? ", showing only its sessions"
      : ", click to show only its sessions";
  return `${circleState(circle)}${toggle}`;
}

/** Tab across the portal (§8 "Pinned"): the card leaves the circle's DOM once it stands in the layer, so its Tab order
 * is carried by hand, forward from the circle onto the card's first control that can act, and back from that control.
 * Key events bubble through the portal to the circle's item, which holds this. No layer, the DOM's own order holds. */
function tabAcrossPortal(
  event: KeyboardEvent<HTMLElement>,
  layer: HTMLElement | null | undefined,
): void {
  if (event.key !== "Tab" || !layer) return;
  const first = layer.querySelector<HTMLElement>(".vf-profiles-stand button:not(:disabled)");
  const circle = event.currentTarget.querySelector<HTMLElement>(".vf-profiles-circle");
  if (!first || !circle) return;
  if (!event.shiftKey && event.target === circle) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && event.target === first) {
    event.preventDefault();
    circle.focus();
  }
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
  canOpen,
  canRetry,
  moment,
  cardLayer,
  columnRef,
  onPoint,
  onCircle,
  onClose,
  onFocusPlan,
  onAdd,
  onOpenProfile,
  onRetry,
}: ProfilesColumnViewProps): ReactElement {
  const popoverId = useId();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a column of buttons — the profiles and the add — not a fieldset of form inputs
    <div ref={columnRef} className="vf-profiles-column" role="group" aria-label="Agent profiles">
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
            onKeyDown={isOpen ? (event) => tabAcrossPortal(event, cardLayer) : undefined}
          >
            <button
              type="button"
              className="vf-profiles-circle"
              aria-label={circleWords(circle, lens, isChosen)}
              {...(lens ? { "aria-pressed": isChosen } : {})}
              aria-expanded={isOpen}
              {...(isOpen ? { "aria-controls": popoverId } : {})}
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
              <CardStand layer={cardLayer} profile={id}>
                <ProfilePopoverView
                  id={popoverId}
                  circle={circle}
                  lens={lens}
                  chosen={isChosen}
                  focus={focus}
                  read={read}
                  canOpen={canOpen}
                  canRetry={canRetry}
                  onClose={onClose}
                  onFocusPlan={onFocusPlan}
                  onOpenProfile={onOpenProfile}
                  onRetry={onRetry}
                />
              </CardStand>
            ) : null}
          </div>
        );
      })}
      <div className="vf-profiles-item vf-profiles-add-item">
        {/* the pointer on the add shows its card; the add is the control. The limit card beside it is not the add. */}
        <div
          className="vf-profiles-add-zone"
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
          {addOpen && canAdd ? (
            <CardStand layer={cardLayer} card="add">
              <div className="vf-profiles-addcard" role="tooltip">
                <b>{PROFILES_WORDS.add}</b>
                <p>{`${PROFILES_WORDS.offer} ${PROFILES_WORDS.fact}`}</p>
                <span className="vf-profiles-addcard-foot">
                  <FieldGlyph name="gear" size={11} />
                  Opens Settings → Agent Profiles on New profile…
                </span>
              </div>
            </CardStand>
          ) : null}
        </div>
        <div className="vf-profiles-moment">{moment}</div>
      </div>
    </div>
  );
}
