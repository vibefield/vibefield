import { EmptyState, UiPill, UiSwitch } from "@vibefield/design-kit";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import type { KeyboardEvent, ReactElement, ReactNode, RefObject } from "react";
import type {
  FootSentence,
  InstalledRow,
  PluginPage,
  PluginsLayout,
  PluginsTab,
  Refusal,
  ShelfState,
} from "./plugins-model";
import { PLUGINS_TABS, switchKey } from "./plugins-model";
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
  SWITCH_WORDS,
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
// Updates carries the Me row's count. MK-4c2a: a Built in or Development
// plugin's one switch stands on its row, beside the row's press and never inside
// it, with a stop of Tab of its own, and again on its page beside "Installed";
// its powers' switches stand at their lines' ends. Each switch is the kit's,
// named by what it turns and never by its state. MK-4c2b: a page's settings
// section stands in its first column, after What it adds; the controller
// mounts it and hands it here.

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
  /** MK-4c2b: the page's settings section, which the controller mounts and owns; null: none */
  pageSettings?: ReactNode;
  pageFrom: PluginsTab;
  /** Updates' count, the Me row's (null or 0: none) */
  updates: number | null;
  /** fieldd isn't answering: no switch takes a press */
  away: boolean;
  /** the switches whose request is out, by key */
  under: ReadonlySet<string>;
  /** the switches fieldd refused, by key, with the way each was turning */
  refused: ReadonlyMap<string, Refusal>;
  onTurn: (id: string, on: boolean) => void;
  onTurnPower: (id: string, capability: string, on: boolean) => void;
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
  away,
  under,
  refused,
  onOpen,
  onTurn,
}: {
  rows: readonly InstalledRow[];
  hot: number;
  listRef: RefObject<HTMLUListElement | null>;
  away: boolean;
  under: ReadonlySet<string>;
  refused: ReadonlyMap<string, Refusal>;
  onOpen: (id: string) => void;
  onTurn: (id: string, on: boolean) => void;
}): ReactElement {
  return (
    <ul ref={listRef} className="vf-plugins-list" aria-label={PLUGINS_TAB_WORDS.installed}>
      {rows.map((row, index) => {
        const turning = refused.get(switchKey.one(row.id))?.turningOn;
        return (
          <li
            key={row.id}
            className="vf-plugins-item"
            data-hot={index === hot ? "true" : undefined}
            data-switch={row.onOff !== null ? "true" : undefined}
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
                {turning === undefined ? (
                  <span className="vf-plugins-line">{row.line}</span>
                ) : (
                  <span className="vf-plugins-line" data-tone="attention">
                    {SWITCH_WORDS.refused(turning)}
                  </span>
                )}
              </span>
              {/* a row with no switch keeps its chevron in its press, as MK-4c built it */}
              {row.onOff === null && (
                <FieldGlyph name="chevron" size={12} className="vf-plugins-chevron" />
              )}
            </button>
            {row.onOff !== null && (
              <>
                <UiSwitch
                  checked={row.onOff}
                  disabled={away || under.has(switchKey.one(row.id))}
                  label={row.title}
                  className="vf-plugins-switch"
                  onChange={(on) => onTurn(row.id, on)}
                />
                {/* the press is its picture, title and line (§8): this chevron is no control */}
                <FieldGlyph name="chevron" size={12} className="vf-plugins-chevron" />
              </>
            )}
          </li>
        );
      })}
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
  settings,
  from,
  away,
  under,
  refused,
  onBack,
  onTurn,
  onTurnPower,
}: {
  page: PluginPage;
  settings: ReactNode;
  from: PluginsTab;
  away: boolean;
  under: ReadonlySet<string>;
  refused: ReadonlyMap<string, Refusal>;
  onBack: () => void;
  onTurn: (id: string, on: boolean) => void;
  onTurnPower: (id: string, capability: string, on: boolean) => void;
}): ReactElement {
  const turning = refused.get(switchKey.one(page.id))?.turningOn;
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
          {/* MK-4c2b: its settings, 20 after What it adds (the column's gap) */}
          {settings}
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
            <div className="vf-plugins-page-act-row">
              {/* where its act will stand: words, not a control (VF-PM 13:56:27Z, 4) */}
              <p className="vf-plugins-page-act">{PAGE_WORDS.installed}</p>
              {page.onOff !== null && (
                <UiSwitch
                  checked={page.onOff}
                  disabled={away || under.has(switchKey.one(page.id))}
                  label={page.title}
                  className="vf-plugins-switch"
                  onChange={(on) => onTurn(page.id, on)}
                />
              )}
            </div>
            {turning !== undefined && (
              <p className="vf-plugins-page-refused">{SWITCH_WORDS.refused(turning)}</p>
            )}
            {away && (page.onOff !== null || page.powersLive) && (
              <p className="vf-plugins-page-note">{PLUGINS_AWAY}</p>
            )}
            {page.readOnly !== null && <p className="vf-plugins-page-note">{page.readOnly}</p>}
            {page.elsewhere !== null && <p className="vf-plugins-page-note">{page.elsewhere}</p>}
          </div>
          <PageSection head={PAGE_WORDS.can}>
            {page.offLine !== null && <p className="vf-plugins-page-under">{page.offLine}</p>}
            {page.nothing !== null ? (
              <p className="vf-plugins-page-lines">{page.nothing}</p>
            ) : (
              <ul className="vf-plugins-page-lines">
                {page.powers.map((power) => {
                  const key = switchKey.power(page.id, power.key);
                  const powerTurning = refused.get(key)?.turningOn;
                  return (
                    <li key={power.key} className="vf-plugins-power">
                      <span className="vf-plugins-power-text">
                        {power.words}
                        {power.under !== null && (
                          <span className="vf-plugins-page-under">{power.under}</span>
                        )}
                        {power.whose !== null && (
                          <span className="vf-plugins-page-under">{power.whose}</span>
                        )}
                        {power.cant !== null && (
                          <span className="vf-plugins-page-under">{power.cant}</span>
                        )}
                        {powerTurning !== undefined && (
                          <span className="vf-plugins-page-refused">
                            {SWITCH_WORDS.refused(powerTurning)}
                          </span>
                        )}
                      </span>
                      {power.switch !== null && (
                        <UiSwitch
                          checked={power.switch}
                          disabled={away || !page.powersLive || under.has(key)}
                          label={power.words}
                          className="vf-plugins-switch"
                          onChange={(on) => onTurnPower(page.id, power.key, on)}
                        />
                      )}
                    </li>
                  );
                })}
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
  const { hot, page, pageFrom, updates, listRef, away, under, refused } = props;
  const { pageSettings = null } = props;
  const { onQuery, onTab, onClose, onShowInstalled, onOpenPage, onBack, onKeyDown } = props;
  const { onTurn, onTurnPower } = props;
  const body =
    page !== null ? (
      <PageView
        page={page}
        settings={pageSettings}
        from={pageFrom}
        away={away}
        under={under}
        refused={refused}
        onBack={onBack}
        onTurn={onTurn}
        onTurnPower={onTurnPower}
      />
    ) : tab === "installed" ? (
      installed === null ? (
        <State title={READING_YOURS} />
      ) : installed.length === 0 && query.trim() !== "" ? (
        <State title={noMatchWords(query)} />
      ) : (
        <InstalledList
          rows={installed}
          hot={hot}
          listRef={listRef}
          away={away}
          under={under}
          refused={refused}
          onOpen={onOpenPage}
          onTurn={onTurn}
        />
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
