import {
  CameraLimits,
  type CanvasEngine,
  defineQuery,
  type Entity,
  type GridConfig,
  guardedTransaction,
  Opacity,
  PrefabId,
  SnapConfig,
  widgets,
  writeRuntimeResource,
} from "@vibecook/ice";
import type { DesktopShellState, SettingsUndoResult, ShellPlatform } from "@vibefield/contracts";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { lazy, type ReactElement, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AccountSection } from "./AccountSection";
import { DesktopSection } from "./DesktopSection";
import { MeshSection } from "./MeshSection";
import { PluginsSection } from "./PluginsSection";
import { SystemSection } from "./SystemSection";
import {
  buttonCls,
  fieldCls,
  labelCls,
  SettingsPill,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "./settings-ui";
import { TerminalAppearanceSection } from "./TerminalAppearanceSection";
import { TerminalSection } from "./TerminalSection";
import type { OverlapGlowConfig, OverlapGlowThemeColors, ThemeColors } from "./types";

const LazyDiagnosticsSection = lazy(() =>
  import("./DiagnosticsSection").then((module) => ({
    default: module.DiagnosticsSection,
  })),
);

interface SettingsPanelProps {
  engine: CanvasEngine;
  gridConfig: GridConfig;
  onGridChange: (config: GridConfig) => void;
  themeColors: ThemeColors;
  onThemeColorsChange: (colors: ThemeColors) => void;
  overlapGlow: OverlapGlowConfig;
  onOverlapGlowChange: (config: OverlapGlowConfig) => void;
  overlapGlowThemeColors: OverlapGlowThemeColors;
  onOverlapGlowThemeColorsChange: (colors: OverlapGlowThemeColors) => void;
  stressWidgetType?: string;
  platform?: ShellPlatform;
  desktopState?: DesktopShellState | null;
  dark?: boolean;
  onToggleTheme?: () => void;
  diagnosticsRequest?: number;
  diagnosticsInitiallyOpen?: boolean;
  onClose: () => void;
}

type SettingsPage =
  | "account"
  | "general"
  | "appearance"
  | "canvas"
  | "plugins"
  | "mesh"
  | "terminal"
  | "diagnostics"
  | "advanced";

interface PageMeta {
  id: SettingsPage;
  label: string;
  description: string;
  icon: "person" | "sliders" | "sun" | "canvas" | "plugin" | "mesh" | "terminal" | "pulse" | "code";
}

const PAGES: readonly PageMeta[] = [
  {
    id: "account",
    label: "Account",
    description: "Who this field belongs to, and the devices it reaches.",
    icon: "person",
  },
  {
    id: "general",
    label: "General",
    description: "Desktop behavior and synced preference history.",
    icon: "sliders",
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, canvas palette, and interaction feedback.",
    icon: "sun",
  },
  {
    id: "canvas",
    label: "Canvas",
    description: "Navigation, snapping, cards, and the world grid.",
    icon: "canvas",
  },
  {
    id: "plugins",
    label: "Plugins",
    description: "Installed extensions and their preferences.",
    icon: "plugin",
  },
  {
    id: "mesh",
    label: "Mesh",
    description: "Connected devices and document synchronization.",
    icon: "mesh",
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "Configuration every terminal on this device loads.",
    icon: "terminal",
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    description: "System health, logs, and support tooling.",
    icon: "pulse",
  },
  {
    id: "advanced",
    label: "Advanced",
    description: "Developer previews and canvas stress tools.",
    icon: "code",
  },
] as const;

const NAV_GROUPS: ReadonlyArray<{ label: string; pages: readonly SettingsPage[] }> = [
  { label: "Account", pages: ["account"] },
  { label: "Preferences", pages: ["general", "appearance", "canvas"] },
  { label: "Workspace", pages: ["plugins", "mesh", "terminal"] },
  { label: "Support", pages: ["diagnostics", "advanced"] },
];

const PAGE_BY_ID = new Map(PAGES.map((page) => [page.id, page]));
const widgetQuery = defineQuery([PrefabId]);

function PageIcon({ name }: { name: PageMeta["icon"] }): ReactElement {
  if (name === "person") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="6.8" r="3.3" />
        <path d="M3.8 16.8a6.2 6.2 0 0 1 12.4 0" />
      </svg>
    );
  }
  if (name === "sliders") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M4 5h12M4 10h12M4 15h12M7 3v4M13 8v4M9 13v4" />
      </svg>
    );
  }
  if (name === "sun") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="3.1" />
        <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
      </svg>
    );
  }
  if (name === "canvas") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="3" y="3" width="14" height="14" rx="2.5" />
        <path d="M7 3v14M13 3v14M3 7h14M3 13h14" />
      </svg>
    );
  }
  if (name === "plugin") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M8 3h4v3a2 2 0 1 0 0 4v7H8v-3a2 2 0 1 0-4 0v-4h3a2 2 0 1 0 0-4H4V3h4Z" />
      </svg>
    );
  }
  if (name === "mesh") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="5" cy="5" r="2" />
        <circle cx="15" cy="6" r="2" />
        <circle cx="10" cy="15" r="2" />
        <path d="m6.8 5.4 6.2.4M6.2 6.8l2.7 6.3M13.9 7.7l-2.8 5.5" />
      </svg>
    );
  }
  if (name === "terminal") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="2.5" y="4" width="15" height="12" rx="2.5" />
        <path d="m6 8.5 2.5 2L6 13M10.5 13h3.5" />
      </svg>
    );
  }
  if (name === "pulse") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M2.5 10h3l1.6-4.5 3.2 9 2.2-6 1.3 1.5h3.7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m7 5-4 5 4 5M13 5l4 5-4 5M11.5 3.5l-3 13" />
    </svg>
  );
}

function NumberField({
  label,
  value,
  onChange,
  onBlur,
  step,
  min,
  max,
  width = "w-24",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onBlur?: () => void;
  step?: number | string;
  min?: number;
  max?: number;
  width?: string;
}): ReactElement {
  return (
    <label className="flex items-center gap-2">
      <span className={labelCls}>{label}</span>
      <input
        type="number"
        aria-label={label}
        className={`${fieldCls} ${width} text-right tabular-nums`}
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
        onBlur={onBlur}
      />
    </label>
  );
}

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  disabled = false,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  display: string;
  onChange: (value: number) => void;
}): ReactElement {
  return (
    <div className="flex w-[min(280px,40vw)] items-center gap-3">
      <input
        type="range"
        aria-label={label}
        className="min-w-0 flex-1 accent-black disabled:opacity-40 dark:accent-white"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="w-12 text-right text-[12px] tabular-nums text-black/50 dark:text-white/50">
        {display}
      </span>
    </div>
  );
}

function ColorControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <label className="flex items-center gap-2">
      <input
        type="color"
        aria-label={label}
        className="h-8 w-8 cursor-pointer rounded-full border-0 bg-transparent p-0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="w-[76px] text-right text-[11px] tabular-nums text-black/45 dark:text-white/45">
        {value.toUpperCase()}
      </span>
    </label>
  );
}

function HistoryIcon({ direction }: { direction: "undo" | "redo" }): ReactElement {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={direction === "redo" ? "scale-x-[-1]" : undefined}
    >
      <path d="M7.2 5.2 3.5 8.8l3.7 3.7M4 8.8h6.3a5.2 5.2 0 0 1 5.2 5.2v.5" />
    </svg>
  );
}

function historyReason(direction: "undo" | "redo", reason: SettingsUndoResult["reason"]): string {
  if (reason === "horizon") return "Settings history limit reached";
  if (reason === "not-undoable") return "That change is not part of synced settings history";
  return direction === "undo" ? "Nothing left to undo" : "Nothing left to redo";
}

export function SettingsPanel({
  engine,
  gridConfig,
  onGridChange,
  themeColors,
  onThemeColorsChange,
  overlapGlow,
  onOverlapGlowChange,
  overlapGlowThemeColors,
  onOverlapGlowThemeColorsChange,
  stressWidgetType,
  platform = "other",
  desktopState = null,
  dark = false,
  onToggleTheme,
  diagnosticsRequest = 0,
  diagnosticsInitiallyOpen = false,
  onClose,
}: SettingsPanelProps): ReactElement {
  const client = useFielddClient();
  const dialogRef = useRef<HTMLDivElement>(null);
  const handledDiagnosticsRequest = useRef(diagnosticsRequest);
  const [activePage, setActivePage] = useState<SettingsPage>(
    diagnosticsInitiallyOpen ? "diagnostics" : "general",
  );
  const [historyBusy, setHistoryBusy] = useState(false);
  const [undoAvailable, setUndoAvailable] = useState(true);
  const [redoAvailable, setRedoAvailable] = useState(true);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const [settingsRevision, setSettingsRevision] = useState(0);

  const cameraLimits = engine.world.getResource(CameraLimits);
  const [minZoom, setMinZoom] = useState(cameraLimits?.minZoom ?? 0.1);
  const [maxZoom, setMaxZoom] = useState(cameraLimits?.maxZoom ?? 4);
  const snapConfig = engine.world.getResource(SnapConfig);
  const [snapEnabled, setSnapEnabled] = useState(snapConfig?.enabled ?? true);
  const [snapThreshold, setSnapThreshold] = useState(snapConfig?.thresholdPx ?? 5);
  const [cardOpacity, setCardOpacity] = useState(1);
  const [breakpointMicro, setBreakpointMicro] = useState(80);
  const [breakpointCompact, setBreakpointCompact] = useState(160);
  const [breakpointNormal, setBreakpointNormal] = useState(320);
  const [breakpointExpanded, setBreakpointExpanded] = useState(640);

  useEffect(() => {
    if (diagnosticsRequest <= handledDiagnosticsRequest.current) return;
    handledDiagnosticsRequest.current = diagnosticsRequest;
    setActivePage("diagnostics");
  }, [diagnosticsRequest]);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (dialog === null) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const runHistory = useCallback(
    async (direction: "undo" | "redo"): Promise<void> => {
      if (historyBusy) return;
      setHistoryBusy(true);
      setHistoryNote(null);
      try {
        const result = (await client.request(
          `storage.settings.${direction}`,
          {},
        )) as SettingsUndoResult;
        if (result.applied) {
          setSettingsRevision((revision) => revision + 1);
          setUndoAvailable(true);
          setRedoAvailable(true);
          setHistoryNote(direction === "undo" ? "Last synced change undone" : "Change restored");
        } else {
          if (direction === "undo") setUndoAvailable(false);
          else setRedoAvailable(false);
          setHistoryNote(historyReason(direction, result.reason));
        }
      } catch (caught) {
        setHistoryNote(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setHistoryBusy(false);
      }
    },
    [client, historyBusy],
  );

  useEffect(() => {
    const onHistoryKey = (event: KeyboardEvent): void => {
      if (
        (event.key !== "z" && event.key !== "Z") ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      void runHistory(event.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", onHistoryKey, true);
    return () => window.removeEventListener("keydown", onHistoryKey, true);
  }, [runHistory]);

  const markSettingsChanged = useCallback((undoable: boolean): void => {
    if (!undoable) return;
    setUndoAvailable(true);
    setRedoAvailable(false);
    setHistoryNote("Synced change saved");
  }, []);

  const applyZoom = (): void => {
    writeRuntimeResource(engine.world, CameraLimits, { minZoom, maxZoom });
  };

  const applySnap = (enabled: boolean, thresholdPx: number): void => {
    setSnapEnabled(enabled);
    setSnapThreshold(thresholdPx);
    writeRuntimeResource(engine.world, SnapConfig, { enabled, thresholdPx });
  };

  const applyCardOpacity = (opacity: number): void => {
    setCardOpacity(opacity);
    const session = engine.docs.current();
    if (session === undefined || session.readOnly) return;
    const targets: Entity[] = [];
    engine.world.query(widgetQuery).each((batch) => {
      for (const row of batch) {
        const entity = batch.entity(row);
        const type = engine.world.get(entity, PrefabId)?.id;
        if (typeof type === "string" && widgets.get(type) !== undefined) targets.push(entity);
      }
    });
    guardedTransaction(
      session.store,
      engine.world,
      (transaction) => {
        for (const entity of targets) {
          if (engine.world.get(entity, Opacity) === undefined) {
            transaction.addComponent(entity, Opacity, { a: opacity });
          } else {
            transaction.edit(entity).set(Opacity, { a: opacity });
          }
        }
      },
      { undoable: false },
    );
  };

  function setGrid<K extends keyof GridConfig>(key: K, value: GridConfig[K]): void {
    onGridChange({ ...gridConfig, [key]: value });
  }

  function setGridTuple<K extends keyof GridConfig>(key: K, index: number, value: number): void {
    const tuple = [...(gridConfig[key] as number[])];
    tuple[index] = value;
    onGridChange({ ...gridConfig, [key]: tuple as never });
  }

  function setGlow<K extends keyof OverlapGlowConfig>(key: K, value: OverlapGlowConfig[K]): void {
    onOverlapGlowChange({ ...overlapGlow, [key]: value });
  }

  function setGlowTuple<K extends keyof OverlapGlowConfig>(
    key: K,
    index: number,
    value: number,
  ): void {
    const tuple = [...(overlapGlow[key] as number[])];
    tuple[index] = value;
    onOverlapGlowChange({ ...overlapGlow, [key]: tuple });
  }

  const resetOverlapGlow = (): void => {
    onOverlapGlowChange({
      glowColor: [0.5, 0.5, 0.5],
      glowAlpha: [0.25, 0.45],
      glowSize: [60, 80],
      rimColor: [0.5, 0.5, 0.5],
      rimWidth: 1,
      rimAlpha: [0.3, 0.5],
      rimRadius: 40,
    });
    onOverlapGlowThemeColorsChange({
      glowLight: "#808080",
      glowDark: "#FFFFFF",
      rimLight: "#808080",
      rimDark: "#FFFFFF",
    });
  };

  const spawnStressWidgets = (count: number): void => {
    if (stressWidgetType === undefined || engine.docs.current() === undefined) return;
    const columns = Math.ceil(Math.sqrt(count));
    for (let index = 0; index < count; index++) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      engine.ops.spawnWidget(stressWidgetType, {
        x: column * 270 + Math.random() * 20 - 10,
        y: row * 200 + Math.random() * 20 - 10,
      });
    }
    engine.ops.zoomToFit();
  };

  let pageContent: ReactElement;
  if (activePage === "account") {
    pageContent = <AccountSection onSettingsChanged={markSettingsChanged} />;
  } else if (activePage === "general") {
    pageContent = (
      <div className="space-y-4">
        <DesktopSection
          platform={platform}
          desktopState={desktopState}
          onSettingsChanged={markSettingsChanged}
        />
        <SettingsSection
          title="Settings history"
          description="User preferences are stored in the synced Loro settings document."
        >
          <SettingsRow
            title="Synced preference history"
            description="Undo and redo restore your own user-scope preference edits without rolling back remote changes. Device settings, secrets, plugin grants, and live canvas tuning are excluded."
            divider={false}
          >
            <SettingsPill>Loro-backed</SettingsPill>
          </SettingsRow>
        </SettingsSection>
      </div>
    );
  } else if (activePage === "appearance") {
    const paletteRows = [
      ["Canvas background · Light", "bgLight"],
      ["Canvas background · Dark", "bgDark"],
      ["Grid dots · Light", "dotLight"],
      ["Grid dots · Dark", "dotDark"],
    ] as const;
    const glowColorRows = [
      ["Glow · Light", "glowLight"],
      ["Glow · Dark", "glowDark"],
      ["Rim · Light", "rimLight"],
      ["Rim · Dark", "rimDark"],
    ] as const;
    pageContent = (
      <div className="space-y-4">
        <SettingsSection
          title="Theme"
          description="Set the color mode used by app chrome and cards."
        >
          <SettingsRow
            title="Appearance"
            description="The canvas palette below follows the selected light or dark mode."
            divider={false}
          >
            <div className="flex rounded-full bg-black/5 p-1 dark:bg-white/10">
              {([false, true] as const).map((nextDark) => {
                const selected = dark === nextDark;
                return (
                  <button
                    key={nextDark ? "dark" : "light"}
                    type="button"
                    aria-pressed={selected}
                    disabled={onToggleTheme === undefined}
                    className={`h-8 rounded-full px-4 text-[12px] font-medium transition-[background-color,color,box-shadow] ${
                      selected
                        ? "bg-white text-black shadow-sm dark:bg-white dark:text-black"
                        : "text-black/45 hover:text-black/75 dark:text-white/45 dark:hover:text-white/75"
                    }`}
                    onClick={() => {
                      if (!selected) onToggleTheme?.();
                    }}
                  >
                    {nextDark ? "Dark" : "Light"}
                  </button>
                );
              })}
            </div>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          title="Canvas palette"
          description="Fine-tune the field background and grid dots for each color mode."
        >
          {paletteRows.map(([title, key]) => (
            <SettingsRow key={key} title={title}>
              <ColorControl
                label={title}
                value={themeColors[key]}
                onChange={(value) => onThemeColorsChange({ ...themeColors, [key]: value })}
              />
            </SettingsRow>
          ))}
        </SettingsSection>

        <SettingsSection
          title="Overlap feedback"
          description="Tune the glow and rim used to distinguish a dragged card from its overlap target."
        >
          {glowColorRows.map(([title, key]) => (
            <SettingsRow key={key} title={title}>
              <ColorControl
                label={title}
                value={overlapGlowThemeColors[key]}
                onChange={(value) =>
                  onOverlapGlowThemeColorsChange({ ...overlapGlowThemeColors, [key]: value })
                }
              />
            </SettingsRow>
          ))}
          {(
            [
              ["Glow opacity", "glowAlpha", 0, 1, 0.02],
              ["Glow size", "glowSize", 0, 200, 2],
              ["Rim opacity", "rimAlpha", 0, 1, 0.02],
            ] as const
          ).map(([title, key, min, max, step]) => (
            <SettingsRow
              key={key}
              title={title}
              description="Candidate is the card being moved; target is the card beneath it."
            >
              <div className="flex items-end gap-3">
                <NumberField
                  label="Candidate"
                  value={overlapGlow[key][0]}
                  min={min}
                  max={max}
                  step={step}
                  width="w-20"
                  onChange={(value) => setGlowTuple(key, 0, value)}
                />
                <NumberField
                  label="Target"
                  value={overlapGlow[key][1]}
                  min={min}
                  max={max}
                  step={step}
                  width="w-20"
                  onChange={(value) => setGlowTuple(key, 1, value)}
                />
              </div>
            </SettingsRow>
          ))}
          <SettingsRow
            title="Rim shape"
            description="Width controls the edge line; radius controls its falloff."
          >
            <div className="flex items-end gap-3">
              <NumberField
                label="Width"
                value={overlapGlow.rimWidth}
                min={0}
                max={6}
                step={0.1}
                width="w-20"
                onChange={(value) => setGlow("rimWidth", value)}
              />
              <NumberField
                label="Radius"
                value={overlapGlow.rimRadius}
                min={50}
                max={2000}
                step={20}
                width="w-24"
                onChange={(value) => setGlow("rimRadius", value)}
              />
            </div>
          </SettingsRow>
          <SettingsRow
            title="Restore interaction feedback"
            description="Return every overlap glow and rim value to the reviewed defaults."
            divider={false}
          >
            <button type="button" className={buttonCls} onClick={resetOverlapGlow}>
              Reset to defaults
            </button>
          </SettingsRow>
        </SettingsSection>
      </div>
    );
  } else if (activePage === "canvas") {
    pageContent = (
      <div className="space-y-4">
        <SettingsSection
          title="Navigation"
          description="Set the camera range and quickly reframe the current canvas."
        >
          <SettingsRow
            title="Zoom range"
            description="The camera will not zoom beyond these world-scale limits."
          >
            <div className="flex items-center gap-3">
              <NumberField
                label="Minimum"
                value={minZoom}
                step={0.01}
                width="w-20"
                onChange={setMinZoom}
                onBlur={applyZoom}
              />
              <NumberField
                label="Maximum"
                value={maxZoom}
                step={0.1}
                width="w-20"
                onChange={setMaxZoom}
                onBlur={applyZoom}
              />
            </div>
          </SettingsRow>
          <SettingsRow
            title="Current view"
            description="Frame all cards, or return from the current nested layer."
            divider={false}
          >
            <div className="flex items-center gap-2">
              <button type="button" className={buttonCls} onClick={() => engine.ops.zoomToFit()}>
                Zoom to fit
              </button>
              <button
                type="button"
                className={buttonCls}
                disabled={engine.nav.depth() === 0}
                onClick={() => engine.ops.exitContainer()}
              >
                Exit layer
              </button>
            </div>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          title="Card behavior"
          description="Live controls for card alignment and visibility on the open document."
        >
          <SettingsRow
            title="Snap cards"
            description="Show alignment guides and settle nearby card edges into place."
          >
            <SettingsSwitch
              label="Snap cards"
              checked={snapEnabled}
              onChange={(enabled) => applySnap(enabled, snapThreshold)}
            />
          </SettingsRow>
          <SettingsRow
            title="Snap range"
            description="Distance in screen pixels at which guides engage."
          >
            <SliderControl
              label="Snap range"
              value={snapThreshold}
              min={1}
              max={20}
              step={1}
              disabled={!snapEnabled}
              display={`${snapThreshold}px`}
              onChange={(value) => applySnap(snapEnabled, value)}
            />
          </SettingsRow>
          <SettingsRow
            title="All card opacity"
            description="Applies immediately to every widget in the current document. This live tuning change is not part of settings history."
            divider={false}
          >
            <SliderControl
              label="All card opacity"
              value={cardOpacity}
              min={0.1}
              max={1}
              step={0.05}
              display={cardOpacity.toFixed(2)}
              onChange={applyCardOpacity}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          title="World grid"
          description="Control grid density, dot appearance, and the zoom fade curve."
        >
          <SettingsRow
            title="Grid spacing"
            description="Fine, medium, and coarse intervals in world pixels."
          >
            <div className="flex items-center gap-3">
              {(["Fine", "Medium", "Coarse"] as const).map((label, index) => (
                <NumberField
                  key={label}
                  label={label}
                  value={gridConfig.spacings[index] ?? 0}
                  step={1}
                  width="w-20"
                  onChange={(value) => setGridTuple("spacings", index, value)}
                />
              ))}
            </div>
          </SettingsRow>
          <SettingsRow
            title="Dot size"
            description="The constant on-screen radius of every grid dot."
          >
            <SliderControl
              label="Grid dot size"
              value={gridConfig.dotRadius[0]}
              min={0}
              max={3}
              step={0.05}
              display={gridConfig.dotRadius[0].toFixed(2)}
              onChange={(value) => onGridChange({ ...gridConfig, dotRadius: [value, value] })}
            />
          </SettingsRow>
          <SettingsRow
            title="Dot opacity"
            description="Base visibility before zoom-level weighting."
          >
            <SliderControl
              label="Grid dot opacity"
              value={gridConfig.dotAlpha}
              min={0}
              max={1}
              step={0.01}
              display={gridConfig.dotAlpha.toFixed(2)}
              onChange={(value) => setGrid("dotAlpha", value)}
            />
          </SettingsRow>
          <SettingsRow
            title="Fade in"
            description="CSS-pixel range over which grid dots become visible."
          >
            <div className="flex items-center gap-3">
              <NumberField
                label="Start"
                value={gridConfig.fadeIn[0]}
                step={1}
                width="w-20"
                onChange={(value) => setGridTuple("fadeIn", 0, value)}
              />
              <NumberField
                label="End"
                value={gridConfig.fadeIn[1]}
                step={1}
                width="w-20"
                onChange={(value) => setGridTuple("fadeIn", 1, value)}
              />
            </div>
          </SettingsRow>
          <SettingsRow
            title="Fade out"
            description="CSS-pixel range over which grid dots disappear."
          >
            <div className="flex items-center gap-3">
              <NumberField
                label="Start"
                value={gridConfig.fadeOut[0]}
                step={10}
                width="w-20"
                onChange={(value) => setGridTuple("fadeOut", 0, value)}
              />
              <NumberField
                label="End"
                value={gridConfig.fadeOut[1]}
                step={10}
                width="w-20"
                onChange={(value) => setGridTuple("fadeOut", 1, value)}
              />
            </div>
          </SettingsRow>
          <SettingsRow
            title="Level weight"
            description="Base weight and per-level step used to blend grid scales."
            divider={false}
          >
            <div className="flex items-center gap-3">
              <NumberField
                label="Base"
                value={gridConfig.levelWeight[0]}
                step={0.1}
                width="w-20"
                onChange={(value) => setGridTuple("levelWeight", 0, value)}
              />
              <NumberField
                label="Step"
                value={gridConfig.levelWeight[1]}
                step={0.1}
                width="w-20"
                onChange={(value) => setGridTuple("levelWeight", 1, value)}
              />
            </div>
          </SettingsRow>
        </SettingsSection>
      </div>
    );
  } else if (activePage === "plugins") {
    pageContent = (
      <PluginsSection settingsRevision={settingsRevision} onSettingsChanged={markSettingsChanged} />
    );
  } else if (activePage === "mesh") {
    pageContent = <MeshSection />;
  } else if (activePage === "terminal") {
    // Two owners, in the order a reader meets them: how this viewer draws the
    // deck, then the device-wide file every terminal loads (GT-D12).
    pageContent = (
      <div className="space-y-4">
        <TerminalAppearanceSection />
        <TerminalSection />
      </div>
    );
  } else if (activePage === "diagnostics") {
    pageContent = (
      <div className="space-y-4">
        <SystemSection />
        <SettingsSection
          title="Diagnostics viewer"
          description="Inspect logs, crashes, debug leases, and support bundle contents."
        >
          <Suspense fallback={<div className={labelCls}>Loading diagnostics…</div>}>
            <LazyDiagnosticsSection />
          </Suspense>
        </SettingsSection>
      </div>
    );
  } else {
    const breakpoints = [
      ["Micro", breakpointMicro, setBreakpointMicro],
      ["Compact", breakpointCompact, setBreakpointCompact],
      ["Normal", breakpointNormal, setBreakpointNormal],
      ["Expanded", breakpointExpanded, setBreakpointExpanded],
    ] as const;
    pageContent = (
      <div className="space-y-4">
        <SettingsSection
          title="Breakpoint preview"
          description="Preview-only thresholds for future card level-of-detail tuning. The current renderer uses reviewed constants, so these values are local to this panel."
        >
          <SettingsRow
            title="Screen-pixel thresholds"
            description="Use these fields to compare prospective micro, compact, normal, and expanded breakpoints."
            divider={false}
          >
            <div className="grid grid-cols-2 gap-3">
              {breakpoints.map(([label, value, setter]) => (
                <NumberField
                  key={label}
                  label={label}
                  value={value}
                  width="w-20"
                  onChange={setter}
                />
              ))}
            </div>
          </SettingsRow>
        </SettingsSection>
        <SettingsSection
          title="Canvas stress test"
          description="Spawn a grid of test widgets in the current document, then zoom to fit."
        >
          <SettingsRow
            title="Add test widgets"
            description={
              stressWidgetType === undefined
                ? "No stress-test widget type is registered in this build."
                : "This changes the current document and may take a moment at higher counts."
            }
            divider={false}
          >
            <div className="flex items-center gap-2">
              {[50, 200, 500].map((count) => (
                <button
                  key={count}
                  type="button"
                  className={buttonCls}
                  disabled={stressWidgetType === undefined}
                  onClick={() => spawnStressWidgets(count)}
                >
                  +{count}
                </button>
              ))}
            </div>
          </SettingsRow>
        </SettingsSection>
      </div>
    );
  }

  const currentPage: PageMeta = PAGE_BY_ID.get(activePage) ?? PAGES[0]!;

  return (
    <div
      className="vf-settings-backdrop fixed inset-0 z-[65] flex items-center justify-center p-4 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vf-settings-title"
        tabIndex={-1}
        data-settings-page={activePage}
        className="vf-settings-dialog grid h-[min(84vh,760px)] min-h-[540px] w-[min(94vw,1080px)] grid-cols-[224px_minmax(0,1fr)] overflow-hidden rounded-[22px] outline-none"
      >
        <aside className="vf-settings-sidebar flex min-h-0 flex-col border-r border-black/5 p-3 dark:border-white/10">
          <div className="flex h-[58px] items-center gap-2.5 px-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-black text-white shadow-sm dark:bg-white dark:text-black">
              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
                className="h-4 w-4 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]"
              >
                <circle cx="10" cy="10" r="2.3" />
                <path d="M15.8 11.8a1.3 1.3 0 0 0 .3 1.4l.1.1-2.3 2.3-.1-.1a1.3 1.3 0 0 0-1.4-.3 1.3 1.3 0 0 0-.8 1.2v.2H8.4v-.2a1.3 1.3 0 0 0-.8-1.2 1.3 1.3 0 0 0-1.4.3l-.1.1-2.3-2.3.1-.1a1.3 1.3 0 0 0 .3-1.4A1.3 1.3 0 0 0 3 11H2.8V8H3a1.3 1.3 0 0 0 1.2-.8 1.3 1.3 0 0 0-.3-1.4l-.1-.1 2.3-2.3.1.1a1.3 1.3 0 0 0 1.4.3A1.3 1.3 0 0 0 8.4 3v-.2h3.2V3a1.3 1.3 0 0 0 .8 1.2 1.3 1.3 0 0 0 1.4-.3l.1-.1 2.3 2.3-.1.1a1.3 1.3 0 0 0-.3 1.4 1.3 1.3 0 0 0 1.2.8h.2v3H17a1.3 1.3 0 0 0-1.2.8Z" />
              </svg>
            </span>
            <span
              id="vf-settings-title"
              className="vf-settings-sidebar-title text-[15px] font-semibold tracking-[-0.02em] text-black/85 dark:text-white/90"
            >
              Settings
            </span>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto py-2" aria-label="Settings categories">
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="mb-4 last:mb-0">
                <div className="vf-settings-nav-group mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-black/30 dark:text-white/30">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.pages.map((pageId) => {
                    const page = PAGE_BY_ID.get(pageId);
                    if (page === undefined) return null;
                    const selected = page.id === activePage;
                    return (
                      <button
                        key={page.id}
                        type="button"
                        aria-current={selected ? "page" : undefined}
                        aria-label={`${page.label} settings`}
                        className={`vf-settings-nav-item flex h-9 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[12px] font-medium transition-[background-color,color,transform] active:scale-[0.98] ${
                          selected
                            ? "bg-black/[0.075] text-black dark:bg-white/[0.12] dark:text-white"
                            : "text-black/50 hover:bg-black/[0.04] hover:text-black/80 dark:text-white/50 dark:hover:bg-white/[0.07] dark:hover:text-white/80"
                        }`}
                        onClick={() => setActivePage(page.id)}
                      >
                        <span className="h-[18px] w-[18px] flex-none [&>svg]:h-full [&>svg]:w-full [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.5]">
                          <PageIcon name={page.icon} />
                        </span>
                        <span className="vf-settings-nav-label truncate">{page.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="vf-settings-sidebar-note border-t border-black/5 px-3 pt-3 text-[10px] leading-4 text-black/30 dark:border-white/10 dark:text-white/30">
            Synced settings keep a local undo history.
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col">
          <header className="flex min-h-[76px] shrink-0 items-center justify-between gap-4 border-b border-black/5 px-8 dark:border-white/10">
            <div className="min-w-0 py-3">
              <h1 className="truncate text-[17px] font-semibold tracking-[-0.025em] text-black/90 dark:text-white/90">
                {currentPage.label}
              </h1>
              <p className={`truncate ${labelCls}`}>{currentPage.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="vf-settings-history flex items-center rounded-full bg-black/[0.045] p-1 dark:bg-white/[0.08]">
                <button
                  type="button"
                  aria-label="Undo settings change"
                  title="Undo synced settings change (⌘Z)"
                  disabled={historyBusy || !undoAvailable}
                  className="vf-settings-history-button flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium text-black/55 transition-[background-color,color,transform] hover:bg-white hover:text-black active:scale-95 disabled:pointer-events-none disabled:opacity-30 dark:text-white/55 dark:hover:bg-white/10 dark:hover:text-white"
                  onClick={() => void runHistory("undo")}
                >
                  <span className="h-4 w-4 [&>svg]:h-full [&>svg]:w-full [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.6]">
                    <HistoryIcon direction="undo" />
                  </span>
                  <span className="vf-settings-history-label">Undo</span>
                </button>
                <button
                  type="button"
                  aria-label="Redo settings change"
                  title="Redo synced settings change (⇧⌘Z)"
                  disabled={historyBusy || !redoAvailable}
                  className="vf-settings-history-button flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium text-black/55 transition-[background-color,color,transform] hover:bg-white hover:text-black active:scale-95 disabled:pointer-events-none disabled:opacity-30 dark:text-white/55 dark:hover:bg-white/10 dark:hover:text-white"
                  onClick={() => void runHistory("redo")}
                >
                  <span className="h-4 w-4 [&>svg]:h-full [&>svg]:w-full [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.6]">
                    <HistoryIcon direction="redo" />
                  </span>
                  <span className="vf-settings-history-label">Redo</span>
                </button>
              </div>
              <button
                type="button"
                aria-label="Close settings"
                title="Close settings (Esc)"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-black/[0.045] text-black/45 transition-[background-color,color,transform] hover:bg-black/[0.08] hover:text-black active:scale-95 dark:bg-white/[0.08] dark:text-white/45 dark:hover:bg-white/[0.13] dark:hover:text-white"
                onClick={onClose}
              >
                <svg
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                  className="h-4 w-4 fill-none stroke-current [stroke-linecap:round] [stroke-width:1.6]"
                >
                  <path d="m5 5 10 10M15 5 5 15" />
                </svg>
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
            {historyNote !== null && (
              <div
                aria-live="polite"
                className="mb-4 flex items-center justify-between gap-3 rounded-[14px] bg-black/[0.03] px-3 py-2 text-[11px] text-black/45 dark:bg-white/[0.05] dark:text-white/45"
              >
                <span>{historyNote}</span>
                <span>Synced settings only</span>
              </div>
            )}
            <div className="mx-auto w-full max-w-[760px] pb-2">{pageContent}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
