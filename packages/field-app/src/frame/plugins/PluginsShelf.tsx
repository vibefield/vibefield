import { EmptyState, UiPill } from "@vibefield/design-kit";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import type { ReactElement, RefObject } from "react";
import type { Shelf, ShelfTile, TileAct } from "./plugins-shelf";
import { PAGE_WORDS, SHELF_WORDS, SOURCE_WORDS } from "./plugins-words";

// DISCOVER'S SHELF, AS DRAWN (MK-4e; DESIGN.md §8 "Plugins — the frame's second popup", Discover):
// the grid of sets, the featured one taking its first row whole, each tile one press that opens its
// page (the field keeps the keys, as Installed's rows do, so a tile is no stop of Tab). A mat holds
// the `plugin` glyph and the set's count until a picture reaches the window (main's plugin scheme).
// Its numbers are §8's, in `plugins.css`; its words are `plugins-words.ts`'s. The view holds no
// state: the controller owns the hot tile and the columns. A tile carries its plugin's id as
// `data-plugin`, never on screen, for the market's smoke rows (MK-6) to find a set by.

const ACT_WORDS: Readonly<Record<TileAct, string>> = {
  install: SHELF_WORDS.install,
  installed: PAGE_WORDS.installed,
  "needs-newer": SHELF_WORDS.needsNewer,
};

function Tile({
  tile,
  featured,
  hot,
  onOpen,
}: {
  tile: ShelfTile;
  featured: boolean;
  hot: boolean;
  onOpen: (id: string) => void;
}): ReactElement {
  return (
    <li
      className="vf-plugins-tile-item"
      data-plugin={tile.id}
      data-hot={hot ? "true" : undefined}
      data-featured={featured ? "true" : undefined}
    >
      <button
        type="button"
        tabIndex={-1}
        className="vf-plugins-tile"
        onClick={() => onOpen(tile.id)}
      >
        <span className="vf-plugins-mat">
          <span className="vf-plugins-mat-glyph" aria-hidden="true">
            <FieldGlyph name="plugin" size={24} />
          </span>
          {tile.count !== null && <span className="vf-plugins-mat-count">{tile.count}</span>}
        </span>
        <span className="vf-plugins-tile-text">
          <span className="vf-plugins-tile-head">
            <span className="vf-plugins-tile-title">{tile.title}</span>
            <span className="vf-plugins-tile-act">{ACT_WORDS[tile.act]}</span>
          </span>
          {tile.summary !== null && <span className="vf-plugins-tile-summary">{tile.summary}</span>}
          <span className="vf-plugins-tile-pills">
            <UiPill className="vf-plugins-source">{tile.source}</UiPill>
            {tile.community && (
              <UiPill className="vf-plugins-source">{SOURCE_WORDS.community}</UiPill>
            )}
          </span>
          {tile.has !== null && <span className="vf-plugins-tile-has">{tile.has}</span>}
        </span>
      </button>
    </li>
  );
}

export function PluginsShelf({
  shelf,
  hot,
  columns,
  listRef,
  label,
  onOpen,
}: {
  shelf: Shelf;
  /** the hot tile, in the walk's order (the featured tile first) */
  hot: number;
  columns: number;
  listRef: RefObject<HTMLUListElement | null>;
  /** the grid's name to assistive tech: the tab's word */
  label: string;
  onOpen: (id: string) => void;
}): ReactElement {
  const first = shelf.featured === null ? 0 : 1;
  return (
    <div className="vf-plugins-shelf" data-none={shelf.none !== null ? "true" : undefined}>
      {shelf.none !== null ? (
        // none found is one state, centred as Installed's is (§8 "Empty / degraded states")
        <div className="vf-plugins-state">
          <EmptyState title={shelf.none} />
        </div>
      ) : (
        // its columns are the controller's (`shelfColumns`), set inline as the popup's size moves
        <ul
          ref={listRef}
          className="vf-plugins-grid"
          aria-label={label}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {shelf.featured !== null && (
            <Tile tile={shelf.featured} featured hot={hot === 0} onOpen={onOpen} />
          )}
          {shelf.tiles.map((tile, index) => (
            <Tile
              key={tile.id}
              tile={tile}
              featured={false}
              hot={hot === index + first}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
      {shelf.communityOff !== null && <p className="vf-plugins-shelf-note">{shelf.communityOff}</p>}
    </div>
  );
}
