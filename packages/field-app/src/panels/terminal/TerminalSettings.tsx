import {
  TerminalConfigConflict,
  TerminalConfigDocument,
  TerminalConfigExportResult,
  TerminalConfigImportResult,
  type TerminalConfigSnapshot,
  TerminalConfigValidation,
  TerminalConfigWriteRefusal,
  TerminalConfigWriteResult,
} from "@vibefield/contracts";
import { UiButton } from "@vibefield/design-kit";
import { FielddRpcError } from "@vibefield/fieldd-client";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type DeckAppearance,
  deckThemeNameForMode,
  setDeckAppearance,
  useDeckAppearance,
} from "../../godview/deck-appearance";
import { storedGodviewTheme } from "../../godview/godview-theme";
import type { SettingsSubpage } from "../SettingsDialog";
import { labelCls } from "../settings-ui";
import { BehaviorTab, terminalLinksApplied } from "./BehaviorTab";
import { ConfigFileTab } from "./ConfigFileTab";
import {
  changedKeyCount,
  EMPTY_MANAGED_VALUES,
  GHOSTTY_DEFAULT_PALETTE,
  MalformedManagedBlockError,
  type ManagedValues,
  managedBlockState,
  paletteIndicesSet,
  readManagedValues,
  writeManagedValues,
} from "./config-text";
import { GodviewMiniature } from "./GodviewMiniature";
import { KEY_ENTRIES } from "./ghostty-key-groups";
import { KeyboardTab } from "./KeyboardTab";
import { actionLabel } from "./keyboard-model";
import { LookTab } from "./LookTab";
import type { DeviceState, TerminalPageModel, TerminalTab, ThemeBrowserTarget } from "./page-model";
import { HighlightContext } from "./parts";
import { ThemeBrowser, themeBrowserTitle } from "./ThemeBrowser";
import { type PreviewMode, previewTheme } from "./theme-view";

// Settings → Terminal (GT-7). Two owners on one page, and the page says which
// is which everywhere (GT-D18): THIS WINDOW's look lives in the viewer's own
// store and applies as you change it (GT-D12); THIS MAC's config.ghostty is
// the terminal service's document, reached through fieldd, and every change to
// it collects in one bar and lands with one Save — one reload for every
// terminal on the Mac, and one moment to review it.

const TABS: readonly { id: TerminalTab; label: string }[] = [
  { id: "look", label: "Look" },
  { id: "behavior", label: "Behavior" },
  { id: "keyboard", label: "Keyboard" },
  { id: "file", label: "Config file" },
];

/** How long a draft rests before the loader is asked about it — the same
 * pause ghosttea's own editor takes (`AdvancedConfigSettings`, 320 ms). */
const VALIDATE_AFTER_MS = 320;

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; changed: boolean; warnings: number }
  | { kind: "refused"; reason: "includes-changed" | "blocking-errors"; blocking: number }
  | { kind: "conflict"; current: TerminalConfigDocument }
  | { kind: "failed"; message: string }
  | { kind: "notice"; message: string };

export interface TerminalSettingsViewProps {
  readonly model: TerminalPageModel;
  readonly tab: TerminalTab;
  onTab(tab: TerminalTab): void;
  readonly browser: ThemeBrowserTarget | null;
  readonly query: string;
  onQuery(query: string): void;
  readonly save: SaveState;
  onSave(): void;
  onDiscard(): void;
  onDismissSave(): void;
  onTakeTheirs(): void;
  onSaveOverTheirs(): void;
  /** where a search result took the page (tab + anchor) */
  onReveal(tab: TerminalTab, anchor: string): void;
}

/** The pieces of the page a search can find. */
const SETTINGS_INDEX: readonly {
  anchor: string;
  tab: TerminalTab;
  title: string;
  where: string;
  terms: string;
}[] = [
  {
    anchor: "look-theme",
    tab: "look",
    title: "Theme",
    where: "Look · This window",
    terms: "theme color colour dark light mode ground foreground selection cursor",
  },
  {
    anchor: "look-glass",
    tab: "look",
    title: "Background opacity",
    where: "Look · Glass",
    terms: "opacity transparency transparent glass alpha see through pane",
  },
  {
    anchor: "look-glass",
    tab: "look",
    title: "Dim program backgrounds too",
    where: "Look · Glass",
    terms: "cell cells dim program background opacity",
  },
  {
    anchor: "look-glass",
    tab: "look",
    title: "Backdrop opacity",
    where: "Look · Glass · Godview's backdrop",
    terms: "backdrop stage godview canvas behind see through glass",
  },
  {
    anchor: "look-glass",
    tab: "look",
    title: "Background blur",
    where: "Look · Glass · Godview's backdrop",
    terms: "blur background frosted vibrancy soften backdrop canvas",
  },
  {
    anchor: "look-effects",
    tab: "look",
    title: "Effects",
    where: "Look · This window",
    terms: "shader shaders effect crt vhs sparks fire retro scanline animate",
  },
  {
    anchor: "look-palette",
    tab: "look",
    title: "Program colors",
    where: "Look · This Mac",
    terms: "palette ansi 16 colors colours program",
  },
  {
    anchor: "look-text",
    tab: "look",
    title: "Font & cursor",
    where: "Look · Read-only",
    terms: "font family typeface size text cursor block blink jetbrains",
  },
  {
    anchor: "behavior-history",
    tab: "behavior",
    title: "Scrollback",
    where: "Behavior · This Mac",
    terms: "scrollback history buffer lines bytes",
  },
  {
    anchor: "behavior-links",
    tab: "behavior",
    title: "Links",
    where: "Behavior · Next ghosttea",
    terms: "link links url urls click open",
  },
  {
    anchor: "behavior-sessions",
    tab: "behavior",
    title: "Sessions",
    where: "Behavior · Read-only",
    terms: "session sessions detach close pane lifetime restart quit",
  },
  {
    anchor: "keyboard",
    tab: "keyboard",
    title: "Shortcuts",
    where: "Keyboard · This Mac",
    terms: "keyboard keybind keybindings shortcut shortcuts chord keys",
  },
  {
    anchor: "file-editor",
    tab: "file",
    title: "config.ghostty",
    where: "Config file · This Mac",
    terms: "config file ghostty edit raw import export finder",
  },
  {
    anchor: "file-reference",
    tab: "file",
    title: "Every Ghostty key",
    where: "Config file",
    terms: "keys reference ghostty",
  },
];

/** The index as the pinned loader makes it: the Links row turns with its
 * section (GT-8a) — a switch on This Mac once ghosttea applies `link-url`. */
function settingsIndex(): typeof SETTINGS_INDEX {
  if (!terminalLinksApplied()) return SETTINGS_INDEX;
  return SETTINGS_INDEX.map((entry) =>
    entry.anchor === "behavior-links"
      ? { ...entry, title: "Find links in output", where: "Behavior · This Mac" }
      : entry,
  );
}

function matches(needle: string, ...haystacks: readonly string[]): boolean {
  const words = needle.toLowerCase().split(/\s+/u).filter(Boolean);
  const text = haystacks.join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}

function SearchResults({
  query,
  onReveal,
}: {
  query: string;
  onReveal: (tab: TerminalTab, anchor: string) => void;
}): ReactElement {
  const settings = settingsIndex().filter((entry) =>
    matches(query, entry.title, entry.terms, entry.where),
  );
  const keys = KEY_ENTRIES.filter((entry) => matches(query, entry.key, entry.group.label)).slice(
    0,
    24,
  );
  const actions = useMemo(() => {
    const seen = new Set<string>();
    return (
      [
        "copy_to_clipboard",
        "paste_from_clipboard",
        "clear_screen",
        "new_split",
        "goto_split",
        "new_tab",
        "close_surface",
        "toggle_split_zoom",
        "increase_font_size",
        "start_search",
        "select_all",
        "scroll_to_top",
      ] as const
    ).filter((action) => {
      if (seen.has(action)) return false;
      seen.add(action);
      return matches(query, actionLabel(action), action);
    });
  }, [query]);
  const empty = settings.length + keys.length + actions.length === 0;
  const row = (
    key: string,
    title: ReactNode,
    where: string,
    tab: TerminalTab,
    anchor: string,
  ): ReactElement => (
    <button key={key} type="button" className="vf-ts-result" onClick={() => onReveal(tab, anchor)}>
      <span className="vf-ts-result-title">{title}</span>
      <span className={labelCls}>{where}</span>
    </button>
  );
  return (
    <section className="vf-ts-results" aria-label="Search results">
      {settings.length > 0 && (
        <section aria-label="Settings">
          <div className="vf-ts-eyebrow">Settings</div>
          {settings.map((entry) =>
            row(
              `${entry.anchor}:${entry.title}`,
              entry.title,
              entry.where,
              entry.tab,
              entry.anchor,
            ),
          )}
        </section>
      )}
      {actions.length > 0 && (
        <section aria-label="Shortcuts">
          <div className="vf-ts-eyebrow">Shortcuts</div>
          {actions.map((action) =>
            row(action, actionLabel(action), "Keyboard", "keyboard", "keyboard"),
          )}
        </section>
      )}
      {keys.length > 0 && (
        <section aria-label="Ghostty keys">
          <div className="vf-ts-eyebrow">Ghostty keys</div>
          {keys.map((entry) =>
            row(
              entry.key,
              <code>{entry.key}</code>,
              `Config file · ${entry.group.label}`,
              "file",
              `ref-${entry.key}`,
            ),
          )}
        </section>
      )}
      {empty && (
        <p className={`vf-ts-empty ${labelCls}`}>Nothing about terminals matches “{query}”.</p>
      )}
    </section>
  );
}

function SaveBar({
  model,
  save,
  onSave,
  onDiscard,
  onDismiss,
  onTakeTheirs,
  onSaveOverTheirs,
}: {
  model: TerminalPageModel;
  save: SaveState;
  onSave: () => void;
  onDiscard: () => void;
  onDismiss: () => void;
  onTakeTheirs: () => void;
  onSaveOverTheirs: () => void;
}): ReactElement | null {
  const device = model.device;
  const dirty = device.kind === "ready" && device.dirty;
  if (!dirty && (save.kind === "idle" || save.kind === "saving")) return null;
  let body: ReactNode;
  let actions: ReactNode = null;
  let tone: "neutral" | "attention" | "error" = "neutral";
  if (save.kind === "conflict") {
    tone = "attention";
    body = "config.ghostty changed on disk since this page read it.";
    actions = (
      <>
        <UiButton onClick={onTakeTheirs}>Use the file's version</UiButton>
        <UiButton variant="primary" onClick={onSaveOverTheirs}>
          Save mine over it
        </UiButton>
      </>
    );
  } else if (device.kind === "ready" && device.dirty) {
    const count = changedKeyCount(device.savedText, device.draft);
    const blocking = device.validation?.blocking.length ?? 0;
    const includes = device.validation !== null && !device.validation.includesAllowed;
    tone = blocking > 0 || includes ? "attention" : "neutral";
    body = (
      <>
        <b>
          {count === 0 ? "Unsaved changes" : `${count} ${count === 1 ? "change" : "changes"}`} to
          config.ghostty
        </b>{" "}
        ·{" "}
        {device.checking
          ? "checking…"
          : includes
            ? "includes can't change here — see Config file"
            : blocking > 0
              ? `${blocking} ${blocking === 1 ? "error" : "errors"} to fix first — see Config file`
              : "every terminal on this Mac reloads when you save"}
        {save.kind === "failed" && <span className="vf-ts-savebar-error"> · {save.message}</span>}
        {save.kind === "refused" && (
          <span className="vf-ts-savebar-error">
            {" "}
            · the service refused it (
            {save.reason === "includes-changed"
              ? "includes changed"
              : `${save.blocking} ${save.blocking === 1 ? "error" : "errors"}`}
            )
          </span>
        )}
        {save.kind === "notice" && <span> · {save.message}</span>}
      </>
    );
    actions = (
      <>
        <UiButton onClick={onDiscard}>Discard</UiButton>
        <UiButton
          variant="primary"
          disabled={device.checking || blocking > 0 || includes || save.kind === "saving"}
          onClick={onSave}
        >
          {save.kind === "saving" ? "Saving…" : "Save"}
        </UiButton>
      </>
    );
  } else if (save.kind === "saved") {
    body = save.changed
      ? `Saved. Every terminal on this Mac reloaded${save.warnings > 0 ? `, with ${save.warnings} ${save.warnings === 1 ? "warning" : "warnings"}` : ""}.`
      : "Saved. Nothing a terminal uses changed.";
    actions = <UiButton onClick={onDismiss}>OK</UiButton>;
  } else if (save.kind === "failed") {
    tone = "error";
    body = save.message;
    actions = <UiButton onClick={onDismiss}>OK</UiButton>;
  } else if (save.kind === "notice") {
    body = save.message;
    actions = <UiButton onClick={onDismiss}>OK</UiButton>;
  } else {
    return null;
  }
  return (
    <div className="vf-ts-savebar" data-tone={tone} role="status" aria-live="polite">
      <span className="vf-ts-savebar-text">{body}</span>
      <span className="vf-ts-savebar-acts">{actions}</span>
    </div>
  );
}

/** The Look tab's preview, docked in the corner once the big one scrolls away. */
function DockedPreview({
  model,
  shown,
}: {
  model: TerminalPageModel;
  shown: boolean;
}): ReactElement {
  const [minimized, setMinimized] = useState(false);
  // The dock's miniature is a second Godview in small. Nothing mounts it until
  // the page first scrolls the big one away; then it stays, for the exit.
  const [everShown, setEverShown] = useState(shown);
  useEffect(() => {
    if (shown) setEverShown(true);
  }, [shown]);
  const theme = previewTheme(
    deckThemeNameForMode(model.appearance, model.previewMode),
    model.previewMode,
  );
  const toTop = (): void => {
    document
      .querySelector("[data-ts-preview]")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const open = shown && !minimized;
  return (
    <div className="vf-ts-dock-anchor">
      <button
        type="button"
        className="vf-ts-dock-pill"
        data-shown={shown && minimized ? "" : undefined}
        tabIndex={shown && minimized ? undefined : -1}
        aria-hidden={shown && minimized ? undefined : true}
        onClick={() => setMinimized(false)}
      >
        <span className="vf-ts-dock-dot" style={{ background: theme.background }}>
          <i style={{ background: model.palette[2] }} />
          <i style={{ background: model.palette[4] }} />
        </span>
        Preview
      </button>
      <section
        className="vf-ts-dock"
        data-shown={open ? "" : undefined}
        aria-label="Preview"
        aria-hidden={!open}
        inert={!open}
      >
        <div className="vf-ts-dock-head">
          <span className="vf-ts-eyebrow">Preview</span>
          <UiButton onClick={toTop}>Back to top</UiButton>
          <UiButton onClick={() => setMinimized(true)} aria-label="Minimize the preview">
            Hide
          </UiButton>
        </div>
        {everShown && (
          <GodviewMiniature
            variant="thumb"
            mode={model.previewMode}
            theme={theme}
            palette={model.palette}
            appearance={model.appearance}
          />
        )}
        <div className={`vf-ts-dock-foot ${labelCls}`}>
          <b>{theme.name}</b> · {Math.round(model.appearance.opacity * 100)}%
          {model.appearance.backdropOpacity < 1
            ? ` · backdrop ${Math.round(model.appearance.backdropOpacity * 100)}%`
            : ""}
          {model.appearance.backdropBlur > 0 && model.appearance.backdropOpacity < 1
            ? ` · blur ${model.appearance.backdropBlur} px`
            : ""}
          {model.appearance.shaderEffects.length > 0
            ? ` · ${model.appearance.shaderEffects.length} ${model.appearance.shaderEffects.length === 1 ? "effect" : "effects"}`
            : ""}
        </div>
      </section>
    </div>
  );
}

/** Controller-free: the whole page from a model and callbacks (the catalog
 * mounts exactly this with fixtures — docs/UI_SYSTEM.md). */
export function TerminalSettingsView(props: TerminalSettingsViewProps): ReactElement {
  const { model, tab, browser, query, save } = props;
  const [docked, setDocked] = useState(false);
  const previewWatch = useRef<IntersectionObserver | null>(null);
  const watchPreview = useCallback((node: HTMLDivElement | null) => {
    previewWatch.current?.disconnect();
    previewWatch.current = null;
    if (node === null || typeof IntersectionObserver !== "function") {
      setDocked(false);
      return;
    }
    const observer = new IntersectionObserver(
      // Docked once the preview has scrolled up and away — under a fifth of it
      // showing, and its top above the viewport's (a preview still BELOW the
      // fold has not been scrolled past).
      ([entry]) =>
        setDocked(
          entry !== undefined &&
            entry.intersectionRatio < 0.2 &&
            entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0),
        ),
      {
        threshold: [0, 0.2, 0.5, 1],
      },
    );
    observer.observe(node);
    previewWatch.current = observer;
  }, []);
  useEffect(() => () => previewWatch.current?.disconnect(), []);

  if (browser !== null) {
    return (
      <div className="vf-ts-page" data-subpage="themes">
        <ThemeBrowser model={model} target={browser} />
        <SaveBar
          model={model}
          save={save}
          onSave={props.onSave}
          onDiscard={props.onDiscard}
          onDismiss={props.onDismissSave}
          onTakeTheirs={props.onTakeTheirs}
          onSaveOverTheirs={props.onSaveOverTheirs}
        />
      </div>
    );
  }

  const searching = query.trim() !== "";
  const barShown =
    (model.device.kind === "ready" && model.device.dirty) ||
    (save.kind !== "idle" && save.kind !== "saving");
  return (
    <HighlightContext.Provider value={model.highlight}>
      <div className="vf-ts-page" data-tab={tab} {...(barShown ? { "data-savebar": "" } : {})}>
        <div className="vf-ts-head">
          <div className="vf-ts-tabs" role="tablist" aria-label="Terminal settings">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={!searching && entry.id === tab}
                className="vf-ts-tab-button"
                onClick={() => {
                  props.onQuery("");
                  props.onTab(entry.id);
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            className="vf-ui-field vf-ts-search"
            placeholder="Search terminal settings"
            value={query}
            aria-label="Search terminal settings"
            onChange={(event) => props.onQuery(event.currentTarget.value)}
          />
        </div>
        {searching ? (
          <SearchResults query={query} onReveal={props.onReveal} />
        ) : (
          <div role="tabpanel" aria-label={TABS.find((entry) => entry.id === tab)?.label}>
            {/* The PREVIEW is watched, not the tab: the tab is tall enough that
                under a fifth of it is on screen while the preview is fully in view. */}
            {tab === "look" && <LookTab model={model} previewRef={watchPreview} />}
            {tab === "behavior" && <BehaviorTab model={model} />}
            {tab === "keyboard" && <KeyboardTab model={model} />}
            {tab === "file" && <ConfigFileTab model={model} />}
          </div>
        )}
        {tab === "look" && !searching && <DockedPreview model={model} shown={docked} />}
        <SaveBar
          model={model}
          save={save}
          onSave={props.onSave}
          onDiscard={props.onDiscard}
          onDismiss={props.onDismissSave}
          onTakeTheirs={props.onTakeTheirs}
          onSaveOverTheirs={props.onSaveOverTheirs}
        />
      </div>
    </HighlightContext.Provider>
  );
}

/** A finished save state an edit answers — the next draft is a new question.
 * A conflict stays until the user picks a side; a save in flight stays. */
function settlesOnEdit(save: SaveState): boolean {
  return (
    save.kind === "saved" ||
    save.kind === "notice" ||
    save.kind === "failed" ||
    save.kind === "refused"
  );
}

/** The device state's words for a floor that cannot be asked. */
function unavailableFrom(error: unknown): DeviceState {
  if (error instanceof FielddRpcError && error.kind === "UNAVAILABLE") {
    const state =
      typeof error.details === "object" && error.details !== null && "state" in error.details
        ? String((error.details as { state: unknown }).state)
        : "";
    if (state === "no-overlay") {
      return {
        kind: "unavailable",
        title: "This terminal service has no config file",
        detail:
          "It was started without a path for config.ghostty, so there is nothing for Settings to edit.",
        retryable: false,
      };
    }
    if (state === "unsupported") {
      return {
        kind: "unavailable",
        title: "This terminal service can't edit its config",
        detail: "It predates configuration documents; the version VibeField ships can.",
        retryable: false,
      };
    }
    return {
      kind: "unavailable",
      title: "The terminal service isn't answering",
      detail:
        "config.ghostty belongs to this Mac's terminal service, and it isn't answering right now.",
      retryable: true,
    };
  }
  return {
    kind: "unavailable",
    title: "Can't read config.ghostty",
    detail: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

function paletteFrom(snapshot: TerminalConfigSnapshot | null): string[] {
  const palette = [...GHOSTTY_DEFAULT_PALETTE];
  for (const entry of snapshot?.palette ?? []) {
    if (entry.index < 16) palette[entry.index] = entry.color;
  }
  return palette;
}

/** The page, wired: fieldd for this Mac's document, the viewer's store for
 * this window's look. `onSubpage` hands the theme browser's head to the dialog. */
export function TerminalSettings({
  onSubpage,
  rootRequest = 0,
}: {
  onSubpage: (subpage: SettingsSubpage | null) => void;
  /** bumped by a press on the nav item: return from the theme browser to the page */
  rootRequest?: number;
}): ReactElement {
  const client = useFielddClient();
  const appearance = useDeckAppearance();
  const [previewMode, setPreviewMode] = useState<PreviewMode>(storedGodviewTheme);
  const [tab, setTab] = useState<TerminalTab>("look");
  const [query, setQuery] = useState("");
  const [browser, setBrowser] = useState<ThemeBrowserTarget | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [saved, setSaved] = useState<TerminalConfigDocument | null>(null);
  const [failure, setFailure] = useState<DeviceState | null>(null);
  const [draft, setDraft] = useState("");
  // The loader's answer about one draft text. `result: null` is a check that
  // could not run — the draft is no longer "checking", and a Save still asks the
  // service, which checks again before it writes.
  const [validation, setValidation] = useState<{
    text: string;
    result: TerminalConfigValidation | null;
  } | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const read = useCallback(async (): Promise<void> => {
    setFailure(null);
    try {
      const document = TerminalConfigDocument.parse(
        await client.request("terminal.config.read", {}),
      );
      setSaved(document);
      setDraft(document.text);
      setValidation(null);
    } catch (error) {
      setSaved(null);
      setFailure(unavailableFrom(error));
    }
  }, [client]);
  useEffect(() => {
    void read();
  }, [read]);

  // The dry run: a draft that rests is checked by the loader itself.
  const dirty = saved !== null && draft !== saved.text;
  useEffect(() => {
    if (!dirty) {
      setValidation(null);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(() => {
      void client
        .request("terminal.config.validate", { text: draft })
        .then((raw) => {
          if (live) setValidation({ text: draft, result: TerminalConfigValidation.parse(raw) });
        })
        .catch((error: unknown) => {
          if (!live) return;
          setValidation({ text: draft, result: null });
          setSave({
            kind: "failed",
            message: `Couldn't check the file: ${error instanceof Error ? error.message : String(error)}`,
          });
        });
    }, VALIDATE_AFTER_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, draft, dirty]);

  const checked = validation !== null && validation.text === draft ? validation : null;
  const current = checked?.result ?? null;
  const device: DeviceState = useMemo(() => {
    if (failure !== null) return failure;
    if (saved === null) return { kind: "loading" };
    const shown = dirty ? (current?.config ?? saved.config ?? null) : (saved.config ?? null);
    return {
      kind: "ready",
      path: saved.path,
      exists: saved.exists,
      savedText: saved.text,
      draft,
      dirty,
      snapshot: shown,
      savedSnapshot: saved.config ?? null,
      validation: dirty ? current : null,
      checking: dirty && checked === null,
      blockMalformed: managedBlockState(draft) === "malformed",
    };
  }, [failure, saved, draft, dirty, current, checked]);

  const managed = useMemo(
    () => (saved === null ? EMPTY_MANAGED_VALUES : readManagedValues(draft)),
    [saved, draft],
  );
  const shownSnapshot = device.kind === "ready" ? device.snapshot : null;
  const palette = useMemo(() => paletteFrom(shownSnapshot), [shownSnapshot]);
  const paletteHere = useMemo(() => paletteIndicesSet(draft), [draft]);
  const paletteElsewhere = useMemo(() => {
    const set = new Set<number>();
    for (const entry of shownSnapshot?.palette ?? [])
      if (entry.index < 16 && !paletteHere.has(entry.index)) set.add(entry.index);
    return set;
  }, [shownSnapshot, paletteHere]);

  // Computed here, not in a state updater: an updater runs during render, where
  // a malformed block's throw would escape this catch and take the page down.
  const setManaged = useCallback(
    (values: ManagedValues) => {
      let next: string;
      try {
        next = writeManagedValues(draft, values);
      } catch (error) {
        if (error instanceof MalformedManagedBlockError) {
          setSave({
            kind: "notice",
            message: "The managed block's markers are broken — fix them in Config file first.",
          });
          return;
        }
        throw error;
      }
      setDraft(next);
      if (settlesOnEdit(save)) setSave({ kind: "idle" });
    },
    [draft, save],
  );

  const write = useCallback(
    async (revision: string): Promise<void> => {
      setSave({ kind: "saving" });
      try {
        const result = TerminalConfigWriteResult.parse(
          await client.request("terminal.config.write", { text: draft, revision }),
        );
        setSaved({
          ...result.document,
          ...(result.config !== undefined ? { config: result.config } : {}),
        });
        setDraft(result.document.text);
        setValidation(null);
        setSave({
          kind: "saved",
          changed: result.effectiveChanged,
          warnings: result.diagnostics.filter((d) => d.severity === "warning").length,
        });
      } catch (error) {
        if (error instanceof FielddRpcError && error.kind === "CONFLICT") {
          const conflict = TerminalConfigConflict.safeParse(error.details);
          if (conflict.success) {
            setSave({ kind: "conflict", current: conflict.data.current });
            return;
          }
          setSave({
            kind: "failed",
            message: "config.ghostty changed on disk; reload the page to see it.",
          });
          return;
        }
        if (error instanceof FielddRpcError && error.kind === "PRECONDITION_FAILED") {
          const refusal = TerminalConfigWriteRefusal.safeParse(error.details);
          if (refusal.success) {
            setSave({
              kind: "refused",
              reason: refusal.data.reason,
              blocking: refusal.data.blocking.length,
            });
            return;
          }
        }
        setSave({
          kind: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [client, draft],
  );

  const onImport = useCallback(async (): Promise<void> => {
    try {
      const result = TerminalConfigImportResult.parse(
        await client.request("terminal.config.import", {}),
      );
      if (result.status === "cancelled") return;
      setDraft(result.text);
      setTab("file");
      setSave({
        kind: "notice",
        message: `Imported ${result.path.split(/[\\/]/u).pop()} — review it, then Save`,
      });
    } catch (error) {
      setSave({
        kind: "failed",
        message: `Couldn't import: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [client]);
  const onExport = useCallback(async (): Promise<void> => {
    try {
      const result = TerminalConfigExportResult.parse(
        await client.request("terminal.config.export", { text: draft }),
      );
      if (result.status === "exported")
        setSave({ kind: "notice", message: `Exported to ${result.path}` });
    } catch (error) {
      setSave({
        kind: "failed",
        message: `Couldn't export: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [client, draft]);
  const onReveal = useCallback(async (): Promise<void> => {
    try {
      await client.request("terminal.config.reveal", {});
    } catch (error) {
      setSave({
        kind: "failed",
        message: `Couldn't show the file: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [client]);

  useEffect(() => {
    setBrowser(null);
  }, [rootRequest]);

  // The theme browser is a subpage: the dialog's head names it and offers the way back.
  useEffect(() => {
    if (browser === null) {
      onSubpage(null);
      return;
    }
    onSubpage({
      title: themeBrowserTitle(browser),
      description:
        browser.kind === "palette"
          ? "Copy a theme's sixteen program colors to every terminal on this Mac, after you save."
          : "Ghostty's themes. Picking one applies to this window right away.",
      backLabel: "Back to Terminal",
      onBack: () => setBrowser(null),
    });
  }, [browser, onSubpage]);
  useEffect(() => () => onSubpage(null), [onSubpage]);

  const model: TerminalPageModel = {
    appearance,
    setAppearance: (next: DeckAppearance) => setDeckAppearance(next),
    previewMode,
    setPreviewMode,
    device,
    managed,
    setManaged,
    setDraft: (text: string) => {
      setDraft(text);
      if (settlesOnEdit(save)) setSave({ kind: "idle" });
    },
    palette,
    paletteHere,
    paletteElsewhere,
    openThemes: setBrowser,
    onImport: () => void onImport(),
    onExport: () => void onExport(),
    onReveal: () => void onReveal(),
    retry: () => void read(),
    highlight,
  };

  return (
    <TerminalSettingsView
      model={model}
      tab={tab}
      onTab={setTab}
      browser={browser}
      query={query}
      onQuery={setQuery}
      save={save}
      onSave={() => {
        if (saved !== null) void write(saved.revision);
      }}
      onDiscard={() => {
        if (saved !== null) setDraft(saved.text);
        setSave({ kind: "idle" });
      }}
      onDismissSave={() => setSave({ kind: "idle" })}
      // A CONFLICT's `current` is the document alone — no loader snapshot rides
      // with it (GT-7b) — so taking the file's version READS it again, snapshot
      // and all, rather than showing Ghostty's defaults until the page reopens.
      onTakeTheirs={() => {
        if (save.kind !== "conflict") return;
        setSave({ kind: "idle" });
        void read();
      }}
      // Saving over it keeps the last snapshot until the write answers with its
      // own (a refusal leaves the draft dirty, and its dry run replaces it).
      onSaveOverTheirs={() => {
        if (save.kind !== "conflict") return;
        const known = saved?.config;
        setSaved({ ...save.current, ...(known !== undefined ? { config: known } : {}) });
        void write(save.current.revision);
      }}
      onReveal={(nextTab, anchor) => {
        setQuery("");
        setTab(nextTab);
        setHighlight(anchor);
        requestAnimationFrame(() => {
          document
            .querySelector(`[data-ts-anchor="${CSS.escape(anchor)}"]`)
            ?.scrollIntoView({ block: "center", behavior: "smooth" });
        });
        setTimeout(() => setHighlight((current) => (current === anchor ? null : current)), 1800);
      }}
    />
  );
}
