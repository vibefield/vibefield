import { EmptyState, UiPill } from "@vibefield/design-kit";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import type { KeyboardEvent, ReactElement, ReactNode, RefObject } from "react";
import type {
  FootSentence,
  InstalledRow,
  PluginsLayout,
  PluginsTab,
  ShelfState,
} from "./plugins-model";
import { PLUGINS_TABS } from "./plugins-model";
import {
  NO_REGISTRY,
  noMatchWords,
  PLUGINS_AWAY,
  PLUGINS_CLOSE,
  PLUGINS_NAME,
  PLUGINS_PLACEHOLDER,
  PLUGINS_SWITCH_NAME,
  PLUGINS_TAB_WORDS,
  READING,
  READING_YOURS,
  SOURCE_WORDS,
} from "./plugins-words";
import "./plugins.css";

// THE PLUGINS POPUP, AS DRAWN (MK-4a; DESIGN.md §8 "Plugins — the frame's
// second popup"): the scrim, and over it the popup in the Peek's materials —
// the field (the `plugin` glyph, the words, the switch, close with esc printed
// under it), the body, which scrolls, and the foot (one sentence, and the act
// with ↵ printed on it). Its numbers are §8's, in `plugins.css`; its words are
// `plugins-words.ts`'s. The view holds no state: the controller (`Plugins.tsx`)
// owns the read, the tab and the keyboard.

export interface PluginsViewProps {
  open: boolean;
  layout: PluginsLayout;
  tab: PluginsTab;
  query: string;
  shelf: ShelfState;
  /** Discover's and Updates' foot; null: nothing was read */
  foot: FootSentence | null;
  /** Installed's rows; null: the window holds no plugins yet */
  installed: readonly InstalledRow[] | null;
  installedFoot: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onQuery: (query: string) => void;
  onTab: (tab: PluginsTab) => void;
  onClose: () => void;
  onShowInstalled: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/** One state in the body, never a blank (§8 "Empty / degraded states"). */
function State({ title, description }: { title: string; description?: string }): ReactElement {
  return (
    <div className="vf-plugins-state">
      <EmptyState title={title} {...(description !== undefined ? { description } : {})} />
    </div>
  );
}

function shelfBody(tab: "discover" | "updates", shelf: ShelfState): ReactNode {
  switch (shelf.kind) {
    case "unconfigured":
      return tab === "discover" ? (
        <State title={NO_REGISTRY.title} description={NO_REGISTRY.description} />
      ) : (
        <State title={NO_REGISTRY.updates} />
      );
    case "reading":
      return <State title={READING} />;
    case "away":
      return <State title={PLUGINS_AWAY} />;
    case "no-list":
    case "counted":
      return <State title={shelf.words} />;
  }
}

function InstalledList({ rows }: { rows: readonly InstalledRow[] }): ReactElement {
  return (
    <ul className="vf-plugins-list" aria-label={PLUGINS_TAB_WORDS.installed}>
      {rows.map((row) => (
        <li key={row.id} className="vf-plugins-row">
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
            <span className="vf-plugins-line">{row.line}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PluginsView(props: PluginsViewProps): ReactElement {
  const { open, layout, tab, query, shelf, foot, installed, installedFoot, inputRef } = props;
  const { onQuery, onTab, onClose, onShowInstalled, onKeyDown } = props;
  const body =
    tab === "installed" ? (
      installed === null ? (
        <State title={READING_YOURS} />
      ) : installed.length === 0 && query.trim() !== "" ? (
        <State title={noMatchWords(query)} />
      ) : (
        <InstalledList rows={installed} />
      )
    ) : (
      shelfBody(tab, shelf)
    );
  const said = tab === "installed" ? installedFoot : (foot?.words ?? null);
  const act = tab === "discover" && shelf.kind === "unconfigured";
  return (
    <div className="vf-plugins" data-open={open ? "true" : "false"}>
      {/* the scrim is a pointer's way out; Esc is the keyboard's */}
      <div className="vf-plugins-scrim" aria-hidden="true" onClick={onClose} />
      {open && (
        // its size and place are the controller's (MK-E1), projected inline
        <div
          className="vf-plugins-pop"
          role="dialog"
          aria-modal="true"
          aria-label={PLUGINS_NAME}
          style={{ width: layout.width, height: layout.height, top: layout.top }}
          onKeyDown={onKeyDown}
        >
          <div className="vf-plugins-field">
            <FieldGlyph name="plugin" size={18} />
            <input
              ref={inputRef}
              type="text"
              aria-label={PLUGINS_PLACEHOLDER}
              spellCheck={false}
              autoComplete="off"
              placeholder={PLUGINS_PLACEHOLDER}
              value={query}
              onChange={(event) => onQuery(event.target.value)}
            />
            <div className="vf-plugins-seg" role="radiogroup" aria-label={PLUGINS_SWITCH_NAME}>
              {PLUGINS_TABS.map((which) => (
                // biome-ignore lint/a11y/useSemanticElements: a segment, as the kit's primitives draw it
                <button
                  key={which}
                  type="button"
                  role="radio"
                  aria-checked={tab === which}
                  onClick={() => onTab(which)}
                >
                  {PLUGINS_TAB_WORDS[which]}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="vf-plugins-esc"
              aria-label={PLUGINS_CLOSE}
              onClick={onClose}
            >
              <FieldGlyph name="close" size={12} />
              <kbd className="vf-plugins-key">esc</kbd>
            </button>
          </div>
          <div className="vf-plugins-body">{body}</div>
          <div className="vf-plugins-foot">
            <span
              className="vf-plugins-said"
              role="status"
              data-tone={tab !== "installed" && foot?.attention === true ? "attention" : undefined}
            >
              {said}
            </span>
            {act && (
              <button
                type="button"
                className="vf-plugins-act"
                aria-keyshortcuts="Enter"
                onClick={onShowInstalled}
              >
                {NO_REGISTRY.act}
                <kbd className="vf-plugins-act-key">↵</kbd>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
