import { type ReactElement, useEffect, useMemo, useState } from "react";
import { DEFAULT_DECK_APPEARANCE, type DeckAppearance } from "../godview/deck-appearance";
import type { SettingsSubpage } from "../panels/SettingsDialog";
import {
  GHOSTTY_DEFAULT_PALETTE,
  MalformedManagedBlockError,
  type ManagedValues,
  managedBlockState,
  paletteIndicesSet,
  readManagedValues,
  writeManagedValues,
} from "../panels/terminal/config-text";
import type {
  DeviceState,
  TerminalPageModel,
  TerminalTab,
  ThemeBrowserTarget,
} from "../panels/terminal/page-model";
import { type SaveState, TerminalSettingsView } from "../panels/terminal/TerminalSettings";
import { themeBrowserTitle } from "../panels/terminal/ThemeBrowser";
import type { PreviewMode } from "../panels/terminal/theme-view";
import {
  FIXTURE_CONFIG_PATH,
  FIXTURE_SAVED_SNAPSHOT,
  FIXTURE_SAVED_TEXT,
  fixtureDraft,
  type TerminalFixtureState,
} from "./terminal-settings-fixtures";

// Settings → Terminal in the catalog (GT-7): the SHIPPING `TerminalSettingsView`
// over a fixture adapter — the documents and loader snapshots a fieldd would
// answer (terminal-settings-fixtures.ts). The look is held in local state, so
// playing with the catalog never restyles the developer's own deck; nothing
// here dials a daemon.

const inert = (): void => undefined;

export function TerminalSettingsPreview({
  state,
  onSubpage,
}: {
  state: TerminalFixtureState;
  onSubpage?: (subpage: SettingsSubpage | null) => void;
}): ReactElement {
  const opening = useMemo(() => fixtureDraft(state), [state]);
  const [appearance, setAppearance] = useState<DeckAppearance>({
    ...DEFAULT_DECK_APPEARANCE,
    ...(state === "pending"
      ? { shaderEffects: ["ghosttea:crt"], backdropOpacity: 0.6, backdropBlur: 18 }
      : {}),
  });
  const [previewMode, setPreviewMode] = useState<PreviewMode>("light");
  const [tab, setTab] = useState<TerminalTab>(
    state === "error" || state === "includes" ? "file" : "look",
  );
  const [query, setQuery] = useState("");
  const [browser, setBrowser] = useState<ThemeBrowserTarget | null>(null);
  const [draft, setDraft] = useState(opening.draft);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    if (onSubpage === undefined) return undefined;
    onSubpage(
      browser === null
        ? null
        : {
            title: themeBrowserTitle(browser),
            description: "Ghostty's themes.",
            backLabel: "Back to Terminal",
            onBack: () => setBrowser(null),
          },
    );
    return () => onSubpage(null);
  }, [browser, onSubpage]);

  const dirty = draft !== FIXTURE_SAVED_TEXT;
  const validation = dirty && draft === opening.draft ? opening.validation : null;
  const device: DeviceState =
    state === "unavailable"
      ? {
          kind: "unavailable",
          title: "The terminal service isn't answering",
          detail:
            "config.ghostty belongs to this Mac's terminal service, and it isn't answering right now.",
          retryable: true,
        }
      : {
          kind: "ready",
          path: FIXTURE_CONFIG_PATH,
          exists: true,
          savedText: FIXTURE_SAVED_TEXT,
          draft,
          dirty,
          snapshot: validation?.config ?? FIXTURE_SAVED_SNAPSHOT,
          savedSnapshot: FIXTURE_SAVED_SNAPSHOT,
          validation,
          checking: false,
          blockMalformed: managedBlockState(draft) === "malformed",
        };
  const snapshot = device.kind === "ready" ? device.snapshot : null;
  const palette = [...GHOSTTY_DEFAULT_PALETTE];
  for (const entry of snapshot?.palette ?? [])
    if (entry.index < 16) palette[entry.index] = entry.color;
  const paletteHere = paletteIndicesSet(draft);
  const paletteElsewhere = new Set(
    (snapshot?.palette ?? [])
      .map((entry) => entry.index)
      .filter((index) => index < 16 && !paletteHere.has(index)),
  );

  const model: TerminalPageModel = {
    appearance,
    setAppearance,
    previewMode,
    setPreviewMode,
    device,
    managed: readManagedValues(draft),
    setManaged: (values: ManagedValues) => {
      try {
        setDraft(writeManagedValues(draft, values));
      } catch (error) {
        if (!(error instanceof MalformedManagedBlockError)) throw error;
        setSave({
          kind: "notice",
          message: "The managed block's markers are broken — fix them in Config file first.",
        });
      }
    },
    setDraft,
    palette,
    paletteHere,
    paletteElsewhere,
    openThemes: setBrowser,
    onImport: inert,
    onExport: inert,
    onReveal: inert,
    retry: inert,
    highlight: null,
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
      onSave={() => setSave({ kind: "saved", changed: true, warnings: 0 })}
      onDiscard={() => {
        setDraft(FIXTURE_SAVED_TEXT);
        setSave({ kind: "idle" });
      }}
      onDismissSave={() => setSave({ kind: "idle" })}
      onTakeTheirs={inert}
      onSaveOverTheirs={inert}
      onReveal={(nextTab) => {
        setQuery("");
        setTab(nextTab);
      }}
    />
  );
}
