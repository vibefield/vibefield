import { EmptyState, UiPill } from "@vibefield/design-kit";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import type { KeyboardEvent, ReactElement, ReactNode, RefObject } from "react";
import type {
  FootSentence,
  InstalledRow,
  PluginPage,
  PluginsLayout,
  PluginsTab,
  ShelfState,
} from "./plugins-model";
import { PLUGINS_TABS } from "./plugins-model";
import {
  NO_REGISTRY,
  noMatchWords,
  PAGE_WORDS,
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
// owns the read, the tab, the page, the hot row and the keyboard. MK-4c: each
// of Installed's rows is a press that opens its page (the field keeps ↑ ↓ ↵, as
// the Peek's does, so a row is no stop of Tab), a plugin's page reads only, and
// Updates carries the Me row's count.

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
  /** Installed's hot row */
  hot: number;
  /** The page shown in the body, and the tab it opened from; null: the tab's own body */
  page: PluginPage | null;
  pageFrom: PluginsTab;
  /** Updates' count, the Me row's (null or 0: none) */
  updates: number | null;
  inputRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLUListElement | null>;
  onQuery: (query: string) => void;
  onTab: (tab: PluginsTab) => void;
  onClose: () => void;
  onShowInstalled: () => void;
  onOpenPage: (id: string) => void;
  onBack: () => void;
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

function InstalledList({
  rows,
  hot,
  listRef,
  onOpen,
}: {
  rows: readonly InstalledRow[];
  hot: number;
  listRef: RefObject<HTMLUListElement | null>;
  onOpen: (id: string) => void;
}): ReactElement {
  return (
    <ul ref={listRef} className="vf-plugins-list" aria-label={PLUGINS_TAB_WORDS.installed}>
      {rows.map((row, index) => (
        <li key={row.id}>
          <button
            type="button"
            tabIndex={-1}
            className="vf-plugins-row"
            data-hot={index === hot ? "true" : undefined}
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
              <span className="vf-plugins-line">{row.line}</span>
            </span>
            <FieldGlyph name="chevron" size={12} className="vf-plugins-chevron" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One section of a page: its head, then its lines. */
function PageSection({ head, children }: { head: string; children: ReactNode }): ReactElement {
  return (
    <section className="vf-plugins-page-section">
      <h3 className="vf-plugins-page-head">{head}</h3>
      {children}
    </section>
  );
}

/** A plugin's page, read only (MK-4c; DESIGN.md §8 "Read only first"): its back
 * row, then two columns — the plugin's own words and What it adds; its head,
 * "Installed" where its act will stand (words, never a control), What it can do,
 * Made by and Version. */
function PageView({
  page,
  from,
  onBack,
}: {
  page: PluginPage;
  from: PluginsTab;
  onBack: () => void;
}): ReactElement {
  return (
    <div className="vf-plugins-page">
      <button
        type="button"
        className="vf-plugins-back"
        aria-label={PAGE_WORDS.back(PLUGINS_TAB_WORDS[from])}
        onClick={onBack}
      >
        <FieldGlyph name="chevron" size={12} turn={180} />
        {PLUGINS_TAB_WORDS[from]}
      </button>
      <div className="vf-plugins-page-columns">
        <div className="vf-plugins-page-column">
          {page.summary !== null && <p className="vf-plugins-page-words">{page.summary}</p>}
          <PageSection head={PAGE_WORDS.adds}>
            <ul className="vf-plugins-page-lines">
              {page.adds.map((line) => (
                <li key={line.key}>{line.words}</li>
              ))}
            </ul>
          </PageSection>
        </div>
        <div className="vf-plugins-page-column" data-column="second">
          <div className="vf-plugins-page-top">
            <div className="vf-plugins-page-name">
              <span className="vf-plugins-slot" aria-hidden="true">
                <FieldGlyph name="plugin" size={16} />
              </span>
              <div className="vf-plugins-page-name-text">
                <h2 className="vf-plugins-page-title">{page.title}</h2>
                <span className="vf-plugins-page-pills">
                  <UiPill className="vf-plugins-source">{page.source}</UiPill>
                  {page.community && (
                    <UiPill className="vf-plugins-source">{SOURCE_WORDS.community}</UiPill>
                  )}
                </span>
              </div>
            </div>
            {/* where its act will stand: words, not a control (VF-PM 13:56:27Z, 4) */}
            <p className="vf-plugins-page-act">{PAGE_WORDS.installed}</p>
          </div>
          <PageSection head={PAGE_WORDS.can}>
            {page.nothing !== null ? (
              <p className="vf-plugins-page-lines">{page.nothing}</p>
            ) : (
              <ul className="vf-plugins-page-lines">
                {page.powers.map((power) => (
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
          </PageSection>
          {page.madeBy !== null && (
            <PageSection head={PAGE_WORDS.madeBy}>
              <p className="vf-plugins-page-lines">{page.madeBy}</p>
            </PageSection>
          )}
          <PageSection head={PAGE_WORDS.version}>
            <p className="vf-plugins-page-lines">{page.version}</p>
          </PageSection>
        </div>
      </div>
    </div>
  );
}

export function PluginsView(props: PluginsViewProps): ReactElement {
  const { open, layout, tab, query, shelf, foot, installed, installedFoot, inputRef } = props;
  const { hot, page, pageFrom, updates, listRef } = props;
  const { onQuery, onTab, onClose, onShowInstalled, onOpenPage, onBack, onKeyDown } = props;
  const body =
    page !== null ? (
      <PageView page={page} from={pageFrom} onBack={onBack} />
    ) : tab === "installed" ? (
      installed === null ? (
        <State title={READING_YOURS} />
      ) : installed.length === 0 && query.trim() !== "" ? (
        <State title={noMatchWords(query)} />
      ) : (
        <InstalledList rows={installed} hot={hot} listRef={listRef} onOpen={onOpenPage} />
      )
    ) : (
      shelfBody(tab, shelf)
    );
  const said = tab === "installed" ? installedFoot : (foot?.words ?? null);
  const act = page === null && tab === "discover" && shelf.kind === "unconfigured";
  const count = updates !== null && updates > 0 ? updates : null;
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
                  aria-label={
                    which === "updates" && count !== null
                      ? `${PLUGINS_TAB_WORDS[which]} ${count}`
                      : undefined
                  }
                  onClick={() => onTab(which)}
                >
                  {PLUGINS_TAB_WORDS[which]}
                  {which === "updates" && count !== null && (
                    <span className="vf-plugins-count">{count}</span>
                  )}
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
