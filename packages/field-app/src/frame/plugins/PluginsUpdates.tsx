import { UiPill } from "@vibefield/design-kit";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import type { ReactElement, RefObject } from "react";
import { ActButton, InstallCardView } from "./InstallCard";
import type { RowAct, UpdateRow } from "./plugins-updates";
import {
  INSTALL_WORDS,
  PLUGINS_TAB_WORDS,
  SHELF_WORDS,
  SOURCE_WORDS,
  UPDATE_WORDS,
} from "./plugins-words";

// UPDATES, AS DRAWN (MK-UC's UC-C; DESIGN.md §8 "Updates", drawn 2026-11-14, ‹draft›): its head —
// how many updates and when the list was read, with Update all at its end — then its rows, each
// with Installed's shape: a press that opens its page (its picture slot, its title and pill, its
// line and what it changes in the set), its act at its end, and the update card under its lines
// while one stands; then the tab's note. Its numbers are §8's, in `plugins.css`; its words are
// `plugins-words.ts`'s. The view holds no state: the controller (`Plugins.tsx`) owns the updates
// under way, the hot row and the keys; the card is the install card's own (`InstallCard.tsx`).

/** What stands at a row's end: its act, a step's words, or nothing while its card stands. */
function RowEnd({
  act,
  hot,
  onUpdate,
}: {
  act: RowAct;
  hot: boolean;
  onUpdate: () => void;
}): ReactElement | null {
  switch (act.kind) {
    case "update":
      return (
        <ActButton
          words={act.asks ? UPDATE_WORDS.updateAsks : UPDATE_WORDS.update}
          live={act.live}
          onPress={onUpdate}
          printed={hot}
        />
      );
    case "failed":
      return (
        <ActButton
          words={INSTALL_WORDS.tryAgain}
          live={act.live}
          onPress={onUpdate}
          printed={hot}
        />
      );
    case "needs-newer":
      return <p className="vf-plugins-page-act">{SHELF_WORDS.needsNewer}</p>;
    case "downloading":
      return <p className="vf-plugins-page-act">{INSTALL_WORDS.downloading}</p>;
    case "updating":
      return <p className="vf-plugins-page-act">{UPDATE_WORDS.updating}</p>;
    case "card":
    case "updated":
      return null;
  }
}

export function PluginsUpdates({
  head,
  all,
  rows,
  acts,
  hot,
  listRef,
  onAll,
  onOpen,
  onUpdate,
  onConfirm,
  onCancel,
}: {
  /** "1 update · checked 14:02", or "Everything is up to date · checked 14:02" */
  head: string;
  /** Update all, or Update all…, and whether it takes a press; null while none can be taken */
  all: { readonly words: string; readonly live: boolean } | null;
  rows: readonly UpdateRow[];
  /** each row's act, by plugin id */
  acts: ReadonlyMap<string, RowAct>;
  hot: number;
  listRef: RefObject<HTMLUListElement | null>;
  onAll: () => void;
  /** a row's press: its plugin's page, from Updates */
  onOpen: (id: string) => void;
  /** a row's Update, or its Try again */
  onUpdate: (id: string) => void;
  /** a card's Update */
  onConfirm: () => void;
  /** a card's Cancel */
  onCancel: () => void;
}): ReactElement {
  return (
    <div className="vf-plugins-updates">
      <div className="vf-plugins-updates-head">
        <span className="vf-plugins-updates-said">{head}</span>
        {all !== null && (
          <button
            type="button"
            className="vf-plugins-updates-all"
            disabled={!all.live}
            onClick={onAll}
          >
            {all.words}
          </button>
        )}
      </div>
      {rows.length > 0 && (
        <ul ref={listRef} className="vf-plugins-list" aria-label={PLUGINS_TAB_WORDS.updates}>
          {rows.map((row, index) => {
            const act: RowAct = acts.get(row.id) ?? { kind: "updated" };
            const failed = act.kind === "failed";
            return (
              <li
                key={row.id}
                className="vf-plugins-item vf-plugins-update"
                data-hot={index === hot ? "true" : undefined}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  className="vf-plugins-row"
                  onClick={() => onOpen(row.id)}
                >
                  <span className="vf-plugins-slot" aria-hidden="true">
                    <FieldGlyph name="plugin" size={16} />
                  </span>
                  <span className="vf-plugins-row-text">
                    <span className="vf-plugins-row-head">
                      <span className="vf-plugins-title">{row.title}</span>
                      <UiPill className="vf-plugins-source">{row.source}</UiPill>
                      {row.community && (
                        <UiPill className="vf-plugins-source">{SOURCE_WORDS.community}</UiPill>
                      )}
                    </span>
                    {row.done !== null ? (
                      <span className="vf-plugins-line">{UPDATE_WORDS.updated(row.done)}</span>
                    ) : failed ? (
                      <span className="vf-plugins-line" data-tone="attention">
                        {UPDATE_WORDS.failed(row.title)}
                      </span>
                    ) : (
                      <>
                        <span className="vf-plugins-line vf-plugins-update-line">{row.line}</span>
                        {row.changes !== null && (
                          <span className="vf-plugins-update-changes">{row.changes}</span>
                        )}
                      </>
                    )}
                  </span>
                </button>
                <div className="vf-plugins-update-act">
                  <RowEnd act={act} hot={index === hot} onUpdate={() => onUpdate(row.id)} />
                </div>
                {act.kind === "card" && (
                  <div className="vf-plugins-update-card">
                    <InstallCardView
                      card={act.card}
                      live={act.live}
                      onConfirm={onConfirm}
                      onCancel={onCancel}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="vf-plugins-updates-note">{UPDATE_WORDS.note}</p>
    </div>
  );
}
