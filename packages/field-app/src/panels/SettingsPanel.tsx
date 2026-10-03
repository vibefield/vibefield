import {
  CameraLimits,
  type CanvasEngine,
  defineQuery,
  type Entity,
  guardedTransaction,
  Opacity,
  PrefabId,
  SnapConfig,
  widgets,
  writeRuntimeResource,
} from "@vibecook/ice";
import {
  AgentsProfileSetsListResult,
  type DesktopShellState,
  type SettingsUndoResult,
  type ShellPlatform,
} from "@vibefield/contracts";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import {
  lazy,
  type ReactElement,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { refusalSentence, useAccountSnapshot } from "../account/use-account";
import { leaveFor } from "../boot/switch";
import type { MagnetGridGlyph } from "../field/canvas-appearance";
import { getHost } from "../host";
import { AccountSection } from "./AccountSection";
import { AppearanceSection } from "./AppearanceSection";
import { AgentsSection } from "./agents/AgentsSection";
import { type ProfilesRoute, ProfilesSection } from "./agents/ProfilesSection";
import { ProfileMark } from "./agents/ProfilesView";
import { profileNavItems } from "./agents/profiles-model";
import { DeskReadout } from "./DeskReadout";
import { DesktopSection } from "./DesktopSection";
import { MagnetGridSection } from "./MagnetGridSection";
import { MeshSection } from "./MeshSection";
import { PluginsSection } from "./PluginsSection";
import {
  type SettingsAccountHead,
  SettingsDialog,
  type SettingsPage,
  type SettingsProfilesNav,
  type SettingsSubpage,
} from "./SettingsDialog";
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
import { TerminalSettings } from "./terminal/TerminalSettings";

const LazyDiagnosticsSection = lazy(() =>
  import("./DiagnosticsSection").then((module) => ({
    default: module.DiagnosticsSection,
  })),
);

interface SettingsPanelProps {
  engine: CanvasEngine;
  stressWidgetType?: string;
  platform?: ShellPlatform;
  desktopState?: DesktopShellState | null;
  magnetGridGlyph: MagnetGridGlyph;
  onMagnetGridGlyphChange: (glyph: MagnetGridGlyph) => void;
  appearanceControlledByStudio?: boolean;
  diagnosticsRequest?: number;
  diagnosticsInitiallyOpen?: boolean;
  /** The page to open on when diagnostics was not asked for — the Me menu
   * opens Account from its name row (UA-D19). */
  initialPage?: SettingsPage;
  /** ICE's devtools, which left the corner for Settings → Advanced (One Frame
   * FC-D12): shown in development builds only, and only where a host lends
   * the switch. */
  devtools?: { open: boolean; onToggle: () => void };
  onClose: () => void;
}

const widgetQuery = defineQuery([PrefabId]);

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

function historyReason(direction: "undo" | "redo", reason: SettingsUndoResult["reason"]): string {
  if (reason === "horizon") return "Settings history limit reached";
  if (reason === "not-undoable") return "That change is not part of synced settings history";
  return direction === "undo" ? "Nothing left to undo" : "Nothing left to redo";
}

export function SettingsPanel({
  engine,
  stressWidgetType,
  platform = "other",
  desktopState = null,
  magnetGridGlyph,
  onMagnetGridGlyphChange,
  appearanceControlledByStudio = false,
  diagnosticsRequest = 0,
  diagnosticsInitiallyOpen = false,
  initialPage = "general",
  devtools,
  onClose,
}: SettingsPanelProps): ReactElement {
  const client = useFielddClient();
  const dialogRef = useRef<HTMLDivElement>(null);
  // UA-D19 — Settings is headed by whoever it belongs to. The same reading the
  // Me menu makes, so the corner and the head never disagree.
  const account = useAccountSnapshot();
  const [switching, setSwitching] = useState(false);
  const [switchRefusal, setSwitchRefusal] = useState<string | null>(null);
  const usersSwitch = getHost().usersSwitch;
  const accountHead: SettingsAccountHead | undefined =
    account.me === null
      ? undefined
      : {
          me: {
            userId: account.me.userId,
            name: account.me.name,
            face: account.me.face,
            detail: account.me.detail,
            detailIsLogin: account.me.detailIsLogin,
          },
          others: account.others,
          busy: switching,
          notice: switchRefusal,
          // THE RELOAD IS THE FEEDBACK (host.ts): a switch re-targets this
          // window and reloads it, so only a refusal ever comes back — and it
          // is said under the faces, in main's words. The switch (DESIGN.md
          // §8) carries the pressed face and asks main once it has converged.
          onSwitch:
            usersSwitch === undefined
              ? undefined
              : (userId, from) => {
                  const person = account.others.find((other) => other.userId === userId);
                  const name = person?.name ?? "that user";
                  setSwitching(true);
                  setSwitchRefusal(null);
                  void leaveFor(
                    person === undefined ? null : { userId, name, face: person.face },
                    from ?? null,
                    () => usersSwitch({ userId }),
                  ).catch((cause: unknown) => {
                    setSwitching(false);
                    setSwitchRefusal(refusalSentence(`Couldn't switch to ${name}`, cause));
                  });
                },
        };
  const handledDiagnosticsRequest = useRef(diagnosticsRequest);
  const [activePage, setActivePage] = useState<SettingsPage>(
    diagnosticsInitiallyOpen ? "diagnostics" : initialPage,
  );
  // A page below Agents (one agent's page) names itself in the header; a
  // press on a nav item — the current one included — returns to the page.
  const [agentsSubpage, setAgentsSubpage] = useState<SettingsSubpage | null>(null);
  const [pageRequest, setPageRequest] = useState(0);
  // an agent's app page asked for from elsewhere (a profile's app row); a nav
  // press is a plain visit, so it drops any such ask and the page opens on its list
  const [agentOpenRequest, setAgentOpenRequest] = useState<{ provider: string; n: number } | null>(
    null,
  );
  const selectPage = useCallback((page: SettingsPage): void => {
    setActivePage(page);
    setPageRequest((request) => request + 1);
    setAgentOpenRequest(null);
  }, []);
  // AR-S2 — Agent Profiles: the feed the sidebar lists on every page, the
  // profile page that is open, and the hops between an agent's app page and
  // its sign-ins (the Agents page opens an agent when asked to).
  const profilesFeed = useSubscription<unknown>("agents.profileSets.subscribe", {});
  const profileSets = useMemo(() => {
    const parsed = AgentsProfileSetsListResult.safeParse(profilesFeed.data);
    return parsed.success ? parsed.data : null;
  }, [profilesFeed.data]);
  const [profilesRoute, setProfilesRoute] = useState<ProfilesRoute>({
    kind: "profile",
    set: "native",
  });
  const [profilesSubpage, setProfilesSubpage] = useState<SettingsSubpage | null>(null);
  // GT-7: the theme browser, a page below Terminal.
  const [terminalSubpage, setTerminalSubpage] = useState<SettingsSubpage | null>(null);
  const openProfiles = useCallback((route: ProfilesRoute): void => {
    setProfilesRoute(route);
    setActivePage("profiles");
  }, []);
  const openAgentApp = useCallback((provider: string): void => {
    setActivePage("agents");
    setAgentOpenRequest((current) => ({ provider, n: (current?.n ?? 0) + 1 }));
  }, []);
  const profilesNav = useMemo<SettingsProfilesNav | undefined>(() => {
    if (profileSets === null) return undefined;
    return {
      items: profileNavItems(profileSets.sets).map((item) => ({
        id: item.id,
        label: item.label,
        mark: (
          <ProfileMark
            set={{ kind: item.kind, glyph: item.glyph, default: item.isDefault }}
            size={18}
          />
        ),
      })),
      current: profilesRoute.kind === "new" ? "new" : profilesRoute.set,
      onSelect: (id) => openProfiles({ kind: "profile", set: id }),
      onNew: () => openProfiles({ kind: "new" }),
    };
  }, [profileSets, profilesRoute, openProfiles]);
  const profilesHead = useMemo(() => {
    if (profilesRoute.kind === "new") {
      return {
        title: "New agent profile",
        description: "An empty folder for each agent. Nothing is signed in until you add one.",
      };
    }
    const set = profileSets?.sets.find((candidate) => candidate.id === profilesRoute.set);
    return set === undefined ? null : { title: set.label, description: "Agent profile" };
  }, [profileSets, profilesRoute]);
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
    // One Frame FC-D5: the SAME setting as the Me menu's Theme.
    pageContent = <AppearanceSection />;
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

        <MagnetGridSection
          glyph={magnetGridGlyph}
          onGlyphChange={onMagnetGridGlyphChange}
          controlledByStudio={appearanceControlledByStudio}
        />

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
      </div>
    );
  } else if (activePage === "agents") {
    pageContent = (
      <AgentsSection
        platform={platform}
        rootRequest={pageRequest}
        onSubpage={setAgentsSubpage}
        openRequest={agentOpenRequest}
        profiles={profileSets}
        onOpenSignIn={(set, provider) => openProfiles({ kind: "agent", set, provider })}
      />
    );
  } else if (activePage === "profiles") {
    pageContent = (
      <ProfilesSection
        platform={platform}
        feed={profileSets}
        route={profilesRoute}
        onRoute={openProfiles}
        onLeave={() => selectPage("agents")}
        onSubpage={setProfilesSubpage}
        onOpenApp={openAgentApp}
      />
    );
  } else if (activePage === "plugins") {
    pageContent = (
      <PluginsSection settingsRevision={settingsRevision} onSettingsChanged={markSettingsChanged} />
    );
  } else if (activePage === "mesh") {
    pageContent = <MeshSection />;
  } else if (activePage === "terminal") {
    // GT-7: one page over two owners — this window's look and this Mac's
    // config.ghostty — each section saying which it is (GT-D18).
    pageContent = <TerminalSettings rootRequest={pageRequest} onSubpage={setTerminalSubpage} />;
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
        {import.meta.env.DEV && devtools !== undefined && (
          // FC-D12: devtools left the corner (F12, "in every build") for a
          // section here, in development builds only.
          <SettingsSection
            title="Developer"
            description="Tools for working on VibeField itself. Development builds only."
          >
            {/* DK-3 (ruling 2): the desk's own numbers — no panel of ICE's */}
            <DeskReadout />
            <SettingsRow
              title="ICE devtools"
              description="The canvas engine's inspector — the world, the systems, the documents — docked over the canvas."
              divider={false}
            >
              <SettingsSwitch
                label="ICE devtools"
                checked={devtools.open}
                onChange={() => devtools.onToggle()}
              />
            </SettingsRow>
          </SettingsSection>
        )}
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

  return (
    <div
      className="vf-settings-backdrop fixed inset-0 z-[65] flex items-center justify-center p-4 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <SettingsDialog
        dialogRef={dialogRef}
        activePage={activePage}
        onSelectPage={selectPage}
        onClose={onClose}
        onUndo={() => void runHistory("undo")}
        onRedo={() => void runHistory("redo")}
        historyBusy={historyBusy}
        undoAvailable={undoAvailable}
        redoAvailable={redoAvailable}
        historyNote={historyNote}
        account={accountHead}
        profiles={profilesNav}
        head={activePage === "profiles" ? profilesHead : null}
        subpage={
          activePage === "agents"
            ? agentsSubpage
            : activePage === "profiles"
              ? profilesSubpage
              : activePage === "terminal"
                ? terminalSubpage
                : null
        }
      >
        {pageContent}
      </SettingsDialog>
    </div>
  );
}
