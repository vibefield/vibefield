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
  /** UM-R-F (c3) — the profile whose card a click pinned, whether its card shows or another circle peeks over it;
   * absent, the open card's while `pinned` (the catalog) */
  pinnedProfile?: string | null | undefined;
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
  /** UM-5a — the chosen plan and its twins (union keys), or null: the popover's rows draw pressed, the others dim */
  chosenPlanFamily: readonly string[] | null;
  /** UM-5a — choose a plan by its union key (a row or an arc), or null to clear */
  onChoosePlan: (key: string | null) => void;
  /** the limit moment (UM-D23), beside the add while it is due; it says nothing when it is not */
  moment?: ReactNode;
  /** the stage's cards layer (§8 "Where the cards stand"), over the terminals; absent, the cards stand in place */
  cardLayer?: HTMLElement | null | undefined;
  /** the column's own element: the controller finds a circle through it to hand the keyboard home */
  columnRef?: Ref<HTMLDivElement> | undefined;
  /** the pointer came onto a circle (its profile's id) or the add (`ADD_TARGET`), or left them (null) */
  onPoint: (target: string | null) => void;
  /** UM-R-F (c4) — the keyboard came onto a circle or its card (its profile's id) or the add (`ADD_TARGET`), or left
   * them (null); absent (the catalog), focus shows nothing */
  onKeyboardTarget?: ((target: string | null) => void) | undefined;
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

/** Where Tab may land in the column after a card: a circle, or the add while it can act. */
const TAB_STOPS = ".vf-profiles-circle, .vf-profiles-add:not(:disabled)";

/** UM-R-F (c4; §8 "Focus is pointing"): whether the keyboard, going to `node`, stays with `target` — inside its item
 * (the circle, or the add's zone) or inside the stand that carries its card in the layer. Found by the stands' own
 * `dataset`, as `CSS.escape` is not ours to lean on under happy-dom. */
function keepsKeyboard(node: EventTarget | null, item: HTMLElement, target: string): boolean {
  if (!(node instanceof Element)) return false;
  if (item.contains(node)) return true;
  const stand = node.closest<HTMLElement>(".vf-profiles-stand");
  if (!stand) return false;
  return target === ADD_TARGET ? stand.dataset.card === "add" : stand.dataset.profile === target;
}

/** Tab across the portal (§8 "Pinned"): the card leaves the circle's DOM once it stands in the layer, so its Tab order
 * is carried by hand, forward from the circle onto the card's first control that can act, and back from that control.
 * Forward from its last control it goes on to the next circle, or the add while it can act, as if the card stood
 * after its circle (UM-R-F, c4: focus shows a card, so Tab on every circle enters its card, and the window's order
 * alone never reached a second circle). Key events bubble through the portal to the circle's item, which holds this.
 * No layer, the DOM's own order holds. */
function tabAcrossPortal(
  event: KeyboardEvent<HTMLElement>,
  layer: HTMLElement | null | undefined,
  id: string,
): void {
  if (event.key !== "Tab" || !layer) return;
  let stand: HTMLElement | undefined;
  for (const each of layer.querySelectorAll<HTMLElement>(".vf-profiles-stand")) {
    if (each.dataset.profile === id) {
      stand = each;
      break;
    }
  }
  const controls = [...(stand?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
  const first = controls[0];
  const last = controls[controls.length - 1];
  const circle = event.currentTarget.querySelector<HTMLElement>(".vf-profiles-circle");
  if (!first || !last || !circle) return;
  if (!event.shiftKey && event.target === circle) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && event.target === first) {
    event.preventDefault();
    circle.focus();
  } else if (!event.shiftKey && event.target === last) {
    const column = circle.closest(".vf-profiles-column");
    const stops = [...(column?.querySelectorAll<HTMLElement>(TAB_STOPS) ?? [])];
    const next = stops[stops.indexOf(circle) + 1];
    if (!next) return;
    event.preventDefault();
    next.focus();
  }
}

/** The keys an open card takes where the keyboard is: Esc closes a card the keyboard shows (UM-R-F, c4; a pinned
 * card's Esc is the window's, which takes it first), and Tab crosses the portal. With no card open there is no
 * handler, so Esc passes on to whatever holds it. */
function cardKeys(
  event: KeyboardEvent<HTMLElement>,
  layer: HTMLElement | null | undefined,
  id: string,
  pinned: boolean,
  onClose: () => void,
): void {
  if (event.key === "Escape") {
    if (pinned) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
    return;
  }
  tabAcrossPortal(event, layer, id);
}

export function ProfilesColumnView({
  circles,
  lens,
  chosen,
  open,
  pinned,
  pinnedProfile,
  focus,
  read,
  addOpen,
  canAdd,
  canOpen,
  canRetry,
  chosenPlanFamily,
  onChoosePlan,
  moment,
  cardLayer,
  columnRef,
  onPoint,
  onKeyboardTarget,
  onCircle,
  onClose,
  onFocusPlan,
  onAdd,
  onOpenProfile,
  onRetry,
}: ProfilesColumnViewProps): ReactElement {
  const popoverId = useId();
  // UM-R-F (c3; §8 "A circle"): the circle the pin holds wears the quiet tell, under a peek too
  const held = pinnedProfile !== undefined ? pinnedProfile : pinned ? open : null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a column of buttons — the profiles and the add — not a fieldset of form inputs
    <div ref={columnRef} className="vf-profiles-column" role="group" aria-label="Agent profiles">
      {circles.map((circle) => {
        const id = circle.set.id;
        const isChosen = lens && chosen === id;
        const isOpen = open === id;
        return (
          // the pointer or the keyboard on a circle or its popover shows the popover; the circle is the control
          <div
            key={id}
            className="vf-profiles-item"
            data-profile={id}
            {...(isOpen && pinned ? { "data-pinned": "" } : {})}
            onPointerEnter={() => onPoint(id)}
            onPointerLeave={() => onPoint(null)}
            onFocus={() => onKeyboardTarget?.(id)}
            onBlur={(event) => {
              if (!keepsKeyboard(event.relatedTarget, event.currentTarget, id)) {
                onKeyboardTarget?.(null);
              }
            }}
            onKeyDown={
              isOpen ? (event) => cardKeys(event, cardLayer, id, pinned, onClose) : undefined
            }
          >
            <button
              type="button"
              className="vf-profiles-circle"
              aria-label={circleWords(circle, lens, isChosen)}
              {...(lens ? { "aria-pressed": isChosen } : {})}
              aria-expanded={isOpen}
              {...(isOpen ? { "aria-controls": popoverId } : {})}
              {...(isOpen ? { "data-open": "" } : {})}
              {...(held === id ? { "data-pinned": "" } : {})}
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
                  chosenPlanFamily={chosenPlanFamily}
                  onChoosePlan={onChoosePlan}
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
        {/* the pointer or the keyboard on the add shows its card; the add is the control. The limit card beside it is
            not the add. */}
        <div
          className="vf-profiles-add-zone"
          onPointerEnter={() => onPoint(ADD_TARGET)}
          onPointerLeave={() => onPoint(null)}
          onFocus={() => onKeyboardTarget?.(ADD_TARGET)}
          onBlur={(event) => {
            if (!keepsKeyboard(event.relatedTarget, event.currentTarget, ADD_TARGET)) {
              onKeyboardTarget?.(null);
            }
          }}
          onKeyDown={
            addOpen && canAdd
              ? (event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  event.stopPropagation();
                  onClose();
                }
              : undefined
          }
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
