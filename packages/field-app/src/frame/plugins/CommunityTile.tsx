import { UiSwitch } from "@vibefield/design-kit";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CommunityStatementDoor, CommunityTile } from "./plugins-community";
import { COMMUNITY_WORDS, SWITCH_WORDS } from "./plugins-words";

// DISCOVER'S COMMUNITY TILE (MK-O3D, 2026-11-14; MK-D6, MK-E3; DESIGN.md §8 "The community
// tile", drawn 2026-11-14; §9 "Community plugins"): the switch James's J1 names, "Community
// plugins stay off until you turn them on, and the switch states once that nothing isolates
// their code". Pressing it on, at a desktop that has not shown the statement, never turns it on
// by itself: the ask stands in place, with trust-and-distribution §7's statement word for word,
// and only its "Turn on community plugins" sends the one request, and marks this desktop as one
// that has shown it. The statement is shown once on each desktop (James's MK-O1 pick B): fieldd
// keeps the mark, never synced, and a desktop with it turns them on as pressed. An off asks
// nothing. The switch moves only when fieldd's preferences do (the P5 law): under way it takes
// no press, a refusal is said in the plugins' switch words until a press or fieldd shows it the
// way it was turning, and while fieldd isn't answering it takes no press. Before the window has
// read the switch no tile stands (`communityTile`), and an ask standing as it goes unread goes
// with it. The controller (`Plugins.tsx`) holds this state through `useCommunitySwitch`, so Esc
// can answer the ask first; the view holds none.

/** What the tile's switch and its ask are doing. */
export interface CommunitySwitchControl {
  /** the ask stands, in place */
  readonly asking: boolean;
  /** whether the switch takes a press: read, fieldd answering, and a door to send through */
  readonly live: boolean;
  /** its one request is out: nothing takes a press */
  readonly under: boolean;
  /** fieldd refused it: the way it was turning; null when no refusal is said */
  readonly refused: boolean | null;
  /** whether this desktop has shown the statement (MK-O1 B); null until read, which asks */
  readonly shownHere: boolean | null;
  /** the switch pressed: an on asks first where the statement wasn't shown; an off is sent */
  turn(on: boolean): void;
  /** the ask's Cancel, or Esc, or leaving Discover: nothing is sent, nothing is marked */
  cancel(): void;
  /** the ask's Turn on community plugins: this desktop is marked, and the one request goes */
  confirm(): void;
  /** marks this desktop as one that has shown the statement, as a first community install's
   * Continue will (O3-D's install rider, after the page's Install); a mark that fails is no mark,
   * so it asks again */
  markShown(): void;
}

export function useCommunitySwitch({
  open,
  on,
  away,
  send,
  statement,
  markWanted,
  initialAsk = false,
}: {
  /** the popup stands: folding it takes the ask and a refusal away */
  open: boolean;
  /** the switch as fieldd says it; null before this window has read it */
  on: boolean | null;
  /** fieldd isn't answering this window */
  away: boolean;
  /** the switch's request (`communityDoor`); none on a plate that takes no press */
  send: ((on: boolean) => Promise<void>) | undefined;
  /** this desktop's mark (`statementDoor`); none on a plate, which asks each time */
  statement: CommunityStatementDoor | undefined;
  /** whether the mark matters now: the tile stands, or community plugins are on */
  markWanted: boolean;
  /** a plate drawn with the ask standing */
  initialAsk?: boolean;
}): CommunitySwitchControl {
  const [asking, setAsking] = useState(initialAsk);
  const [under, setUnder] = useState(false);
  // kept in a ref too, so a second press before React renders sends nothing
  const underRef = useRef(false);
  const [refused, setRefused] = useState<boolean | null>(null);
  const [shownHere, setShownHere] = useState<boolean | null>(null);
  // each opening starts with no ask, no refusal said and the mark unread
  useEffect(() => {
    if (open) return;
    setAsking(false);
    setRefused(null);
    setShownHere(null);
  }, [open]);
  // the mark is read once an opening needs it; a read that fails leaves it unread, which asks
  useEffect(() => {
    if (!open || !markWanted || statement === undefined || shownHere !== null) return;
    let current = true;
    statement.shownHere().then(
      (shown) => {
        if (current) setShownHere(shown);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [open, markWanted, statement, shownHere]);
  // shown the way it was turning, a refusal goes; turned on elsewhere, or unread (no tile stands
  // then), the ask goes, so no Esc answers an ask nobody sees
  useEffect(() => {
    if (on === null) {
      setAsking(false);
      return;
    }
    setRefused((was) => (was === on ? null : was));
    if (on) setAsking(false);
  }, [on]);
  const live = !away && send !== undefined && on !== null;
  const run = useCallback(
    (value: boolean) => {
      if (send === undefined || underRef.current) return;
      underRef.current = true;
      setUnder(true);
      setRefused(null);
      send(value)
        .then(
          () => undefined,
          () => setRefused(value),
        )
        .finally(() => {
          underRef.current = false;
          setUnder(false);
        });
    },
    [send],
  );
  const markShown = useCallback(() => {
    void statement?.markShown().then(
      () => setShownHere(true),
      () => undefined,
    );
  }, [statement]);
  const turn = useCallback(
    (value: boolean) => {
      if (!live || underRef.current) return;
      // an off is the safe way, sent as pressed; so is an on where the statement was shown
      if (!value || shownHere === true) {
        run(value);
        return;
      }
      setRefused(null);
      setAsking(true);
    },
    [live, run, shownHere],
  );
  const cancel = useCallback(() => setAsking(false), []);
  const confirm = useCallback(() => {
    if (!live || underRef.current) return;
    setAsking(false);
    markShown();
    run(true);
  }, [live, run, markShown]);
  return { asking, live, under, refused, shownHere, turn, cancel, confirm, markShown };
}

/** The tile as drawn (§8 "The tile", "The ask, in place"); its numbers are `plugins.css`'s. Its
 * root carries `data-community-tile` for the market's rows to find it by, never a word on
 * screen. */
export function CommunityTileView({
  tile,
  control,
  takeFocus,
}: {
  tile: CommunityTile;
  control: CommunitySwitchControl;
  /** whether the ask takes the keyboard as it stands; a plate's does not */
  takeFocus: boolean;
}): ReactElement {
  const askId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (control.asking && takeFocus) cancelRef.current?.focus({ preventScroll: true });
  }, [control.asking, takeFocus]);
  const pressable = control.live && !control.under;
  return (
    <div className="vf-plugins-community" data-community-tile="true">
      <div className="vf-plugins-community-head">
        <span className="vf-plugins-community-title">{COMMUNITY_WORDS.title}</span>
        <UiSwitch
          checked={tile.on}
          disabled={!pressable}
          label={COMMUNITY_WORDS.title}
          className="vf-plugins-switch"
          onChange={control.turn}
        />
      </div>
      {control.asking ? (
        <section className="vf-plugins-community-ask" aria-labelledby={askId}>
          <p id={askId} className="vf-plugins-community-question">
            {COMMUNITY_WORDS.ask}
          </p>
          <p className="vf-plugins-community-statement">{COMMUNITY_WORDS.statement}</p>
          <div className="vf-plugins-community-acts">
            <button
              ref={cancelRef}
              type="button"
              className="vf-plugins-act"
              onClick={control.cancel}
            >
              {COMMUNITY_WORDS.cancel}
            </button>
            <button
              type="button"
              className="vf-plugins-act"
              disabled={!pressable}
              onClick={control.confirm}
            >
              {COMMUNITY_WORDS.confirm}
            </button>
          </div>
        </section>
      ) : (
        <>
          <p className="vf-plugins-community-line">{tile.line}</p>
          <p className="vf-plugins-community-line">{tile.state}</p>
        </>
      )}
      {control.refused !== null && (
        <p className="vf-plugins-community-refused">{SWITCH_WORDS.refused(control.refused)}</p>
      )}
    </div>
  );
}
