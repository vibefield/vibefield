import { type ReactElement, useLayoutEffect, useRef } from "react";
import { OsMark } from "../../godview/os-marks";
import type { InstallCard, PageAct } from "./plugins-install";
import {
  CARD_WORDS,
  COMMUNITY_WORDS,
  INSTALL_WORDS,
  PAGE_WORDS,
  SHELF_WORDS,
  showWords,
  UPDATE_WORDS,
} from "./plugins-words";

// A PAGE'S ACT, AND THE INSTALL CARD, AS DRAWN (O2-C; DESIGN.md §8 "Real progress" and the act
// drawn under it, "Every install asks first"): where a page's act stands — Installed, Install,
// Downloading…, the card, Installing… or a failure with Try again — and the card that grows there
// after the download, read from the plugin downloaded. Its numbers are §8's, in `plugins.css`; its
// words are `plugins-words.ts`'s. The view holds no state: the controller (`Plugins.tsx`) owns the
// install under way and the keys (↵ presses the act or the card's Install, Esc the card's Cancel).
// MK-O3D (James's MK-O1 pick B; §8 "The community tile", "Once on each desktop"): at this
// desktop's first community install, the community statement stands where the card would, in its
// chrome, with the tile's ask's acts; its Continue brings the card.
// MK-UC's UC-C: the update card is this card (one card, never a second drawing), its ask, its lead
// and its act's word its own, and the objects it would leave missing under its powers; a page whose
// update waits says Update where Installed stood; and Updates' rows draw their acts and their card
// with the same two parts (`PluginsUpdates.tsx`).
// MK-4d: after Installed, Show them on the pegboard for a set the board hangs (DESIGN.md §8 "The
// pegboard", "After an install"), the act's own look; a press hands the board the set.

/** A page's act, the foot's act's look, ↵ printed on it; one that takes no press says so in
 * tertiary ink. MK-UC: an Updates row that is not the hot one prints no ↵ (`printed`). */
export function ActButton({
  words,
  live,
  onPress,
  printed = true,
}: {
  words: string;
  live: boolean;
  onPress: () => void;
  printed?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      className="vf-plugins-act"
      aria-keyshortcuts={printed ? "Enter" : undefined}
      disabled={!live}
      onClick={onPress}
    >
      {words}
      {printed && <kbd className="vf-plugins-act-key">↵</kbd>}
    </button>
  );
}

export function InstallCardView({
  card,
  live,
  onConfirm,
  onCancel,
}: {
  card: InstallCard;
  live: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  return (
    <section className="vf-plugins-card" aria-label={card.ask}>
      <h3 className="vf-plugins-card-ask">{card.ask}</h3>
      {card.adds !== null && (
        <div className="vf-plugins-card-part">
          <p className="vf-plugins-card-line">{card.adds}</p>
          <ul className="vf-plugins-card-items">
            {card.objects.map((object) => (
              <li key={object.key}>{object.words}</li>
            ))}
          </ul>
        </div>
      )}
      {card.tools !== null && <p className="vf-plugins-card-line">{card.tools}</p>}
      {/* MK-UC: an update card that names no new power has no such part */}
      {(card.can !== null || card.powers.length > 0) && (
        <div className="vf-plugins-card-part">
          {card.can !== null && <p className="vf-plugins-card-line">{card.can}</p>}
          {card.powers.length > 0 && (
            <ul className="vf-plugins-card-items">
              {card.powers.map((power) => (
                <li key={power.key}>
                  {power.words}
                  {power.under !== null && (
                    <span className="vf-plugins-page-under">{power.under}</span>
                  )}
                  {power.whose !== null && (
                    <span className="vf-plugins-page-under">{power.whose}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {/* MK-UC: what an update leaves missing stands under its powers, one card saying both */}
      {card.missing !== undefined && card.missing !== null && (
        <p className="vf-plugins-card-line">{card.missing}</p>
      )}
      {card.reaches !== null && (
        <div className="vf-plugins-card-part">
          <p className="vf-plugins-card-line">{card.reaches}</p>
          {card.desktops.length > 0 && (
            <ul className="vf-plugins-card-items">
              {card.desktops.map((desktop) => (
                <li key={desktop.key} className="vf-plugins-card-desktop">
                  <OsMark os={desktop.os} size={12} />
                  {desktop.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="vf-plugins-card-acts">
        <button type="button" className="vf-plugins-card-cancel" onClick={onCancel}>
          {CARD_WORDS.cancel}
        </button>
        <ActButton words={card.confirm ?? SHELF_WORDS.install} live={live} onPress={onConfirm} />
      </div>
    </section>
  );
}

/** The community statement at this desktop's first community install (MK-O3D; James's MK-O1 pick
 * B): in the card's place and chrome, its heading as the card's ask, the statement word for word,
 * and the tile's ask's two acts — no ↵ printed, and the keyboard on Cancel as it stands, since
 * going on to code nothing isolates is a press, never a key typed in the field. */
function StatementView({
  heading,
  live,
  takeFocus,
  onGoOn,
  onCancel,
}: {
  heading: string;
  live: boolean;
  takeFocus: boolean;
  onGoOn: () => void;
  onCancel: () => void;
}): ReactElement {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (takeFocus) cancelRef.current?.focus({ preventScroll: true });
  }, [takeFocus]);
  return (
    <section className="vf-plugins-card" aria-label={heading}>
      <h3 className="vf-plugins-card-ask">{heading}</h3>
      <p className="vf-plugins-community-statement">{COMMUNITY_WORDS.statement}</p>
      <div className="vf-plugins-community-acts">
        <button ref={cancelRef} type="button" className="vf-plugins-act" onClick={onCancel}>
          {COMMUNITY_WORDS.cancel}
        </button>
        <button type="button" className="vf-plugins-act" disabled={!live} onClick={onGoOn}>
          {INSTALL_WORDS.goOn}
        </button>
      </div>
    </section>
  );
}

export function PageActView({
  act,
  onShow,
  onInstall,
  onConfirm,
  onCancel,
  onGoOn,
  takeFocus,
}: {
  act: PageAct;
  /** MK-4d: Show them on the pegboard — hands the board the set's objects it hangs */
  onShow: (types: readonly string[]) => void;
  /** Install, Update, or Try again: download it (again) */
  onInstall: () => void;
  /** the card's Install, or its Update */
  onConfirm: () => void;
  /** the card's Cancel, and the community statement's */
  onCancel: () => void;
  /** MK-O3D: the community statement's Continue */
  onGoOn: () => void;
  /** MK-O3D: whether the statement takes the keyboard to its Cancel; a plate's does not */
  takeFocus: boolean;
}): ReactElement | null {
  switch (act.kind) {
    case "none":
      return null;
    case "installed": {
      // words, not a control (VF-PM 13:56:27Z, 4); then (MK-4d) Show them on the pegboard, 12 after
      // them in the act's row, for a set the board hangs
      const set = act.show;
      return (
        <>
          <p className="vf-plugins-page-act">{PAGE_WORDS.installed}</p>
          {set.length > 0 && (
            <ActButton words={showWords(set.length)} live onPress={() => onShow(set)} />
          )}
        </>
      );
    }
    case "needs-newer":
      return <p className="vf-plugins-page-act">{SHELF_WORDS.needsNewer}</p>;
    case "downloading":
      return <p className="vf-plugins-page-act">{INSTALL_WORDS.downloading}</p>;
    case "statement":
      return (
        <StatementView
          heading={act.heading}
          live={act.live}
          takeFocus={takeFocus}
          onGoOn={onGoOn}
          onCancel={onCancel}
        />
      );
    case "installing":
      return <p className="vf-plugins-page-act">{act.words}</p>;
    case "install":
      return (
        <div className="vf-plugins-page-act-stack">
          <ActButton words={SHELF_WORDS.install} live={act.live} onPress={onInstall} />
          {act.note !== null && <p className="vf-plugins-page-note">{act.note}</p>}
        </div>
      );
    case "update":
      return (
        <div className="vf-plugins-page-act-stack">
          <ActButton
            words={act.asks ? UPDATE_WORDS.updateAsks : UPDATE_WORDS.update}
            live={act.live}
            onPress={onInstall}
          />
        </div>
      );
    case "failed":
      return (
        <div className="vf-plugins-page-act-stack">
          <ActButton words={INSTALL_WORDS.tryAgain} live={act.live} onPress={onInstall} />
          <p className="vf-plugins-page-refused">{act.words}</p>
        </div>
      );
    case "card":
      return (
        <InstallCardView
          card={act.card}
          live={act.live}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );
  }
}
