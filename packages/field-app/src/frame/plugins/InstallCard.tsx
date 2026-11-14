import type { ReactElement } from "react";
import { OsMark } from "../../godview/os-marks";
import type { InstallCard, PageAct } from "./plugins-install";
import { CARD_WORDS, INSTALL_WORDS, PAGE_WORDS, SHELF_WORDS } from "./plugins-words";

// A PAGE'S ACT, AND THE INSTALL CARD, AS DRAWN (O2-C; DESIGN.md §8 "Real progress" and the act
// drawn under it, "Every install asks first"): where a page's act stands — Installed, Install,
// Downloading…, the card, Installing… or a failure with Try again — and the card that grows there
// after the download, read from the plugin downloaded. Its numbers are §8's, in `plugins.css`; its
// words are `plugins-words.ts`'s. The view holds no state: the controller (`Plugins.tsx`) owns the
// install under way and the keys (↵ presses the act or the card's Install, Esc the card's Cancel).

/** A page's act, the foot's act's look, ↵ printed on it; one that takes no press says so in
 * tertiary ink. */
function ActButton({
  words,
  live,
  onPress,
}: {
  words: string;
  live: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className="vf-plugins-act"
      aria-keyshortcuts="Enter"
      disabled={!live}
      onClick={onPress}
    >
      {words}
      <kbd className="vf-plugins-act-key">↵</kbd>
    </button>
  );
}

function InstallCardView({
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
      <div className="vf-plugins-card-part">
        <p className="vf-plugins-card-line">{card.can}</p>
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
        <ActButton words={SHELF_WORDS.install} live={live} onPress={onConfirm} />
      </div>
    </section>
  );
}

export function PageActView({
  act,
  onInstall,
  onConfirm,
  onCancel,
}: {
  act: PageAct;
  /** Install, or Try again: download it (again) */
  onInstall: () => void;
  /** the card's Install */
  onConfirm: () => void;
  /** the card's Cancel */
  onCancel: () => void;
}): ReactElement | null {
  switch (act.kind) {
    case "none":
      return null;
    case "installed":
      // words, not a control (VF-PM 13:56:27Z, 4)
      return <p className="vf-plugins-page-act">{PAGE_WORDS.installed}</p>;
    case "needs-newer":
      return <p className="vf-plugins-page-act">{SHELF_WORDS.needsNewer}</p>;
    case "downloading":
      return <p className="vf-plugins-page-act">{INSTALL_WORDS.downloading}</p>;
    case "installing":
      return <p className="vf-plugins-page-act">{act.words}</p>;
    case "install":
      return (
        <div className="vf-plugins-page-act-stack">
          <ActButton words={SHELF_WORDS.install} live={act.live} onPress={onInstall} />
          {act.note !== null && <p className="vf-plugins-page-note">{act.note}</p>}
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
