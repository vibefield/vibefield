import {
  type AccountUsagePort,
  type AgentVisualStatus,
  BarControl,
  FindSheet,
  type HistoryPort,
  InstrumentBar,
  MONITOR_CHROME_ATTRIBUTE,
  MONITOR_STAGE_CLASS,
  MONITOR_VIEWS,
  type MonitorParameters,
  ProfileGlyph,
  ProfileTabs,
  SwarmPhysicsProvider,
  UsageColumn,
  useMonitorPalette,
  type MonitorAgent as ViewsMonitorAgent,
} from "@vibecook/puppeteer-views";
import type { AgentProfileSet } from "@vibefield/contracts";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { emitGodviewMonitorMarker, type GodviewMonitorRunFacts } from "../development-console";
import type { GodviewTheme } from "./GodviewTuningPanel";
import { managedRowId, monitorAgentCounts, nextMonitorAgentForStatus } from "./monitor/agents";
import type { AgentSessionSummary } from "./monitor/facet-types";
import { useAgentFold } from "./monitor/GodviewAgentsProvider";
import {
  chosenProfile,
  launchProfile,
  personaProfiles,
  profileTabs,
  recedeOutside,
  showsProfileTabs,
  spawnProfileLabel,
} from "./monitor/profile-tabs";
import {
  providerBadge,
  providerHistoryClaim,
  providerOptionText,
  providerPickerLabel,
  providerStartsSessions,
} from "./monitor/provider-picker";
import type { MonitorDoor, MonitorFeedState } from "./monitor/remote-door";
import type { AgentMonitorView, MonitorAgent } from "./monitor/types";
import {
  type MonitorPaneFacts,
  type MonitorSourceCounts,
  useMonitorAgents,
} from "./monitor/useMonitorAgents";
import {
  createSwarmPhysicsDriver,
  currentSwarmPhysicsMode,
} from "./views/swarm/swarm-physics-driver";

const ACKNOWLEDGEMENT_MS = 2_600;

/**
 * THE LOCAL CLAIM (AR-3), where the mock's label used to stand.
 *
 * GT-D13's law was that invented rows say so on screen. There are no invented
 * rows any more: the local half of the field is fieldd's fold, and the chip
 * counts what the daemon reports — managed agents on this device — or says
 * nothing when there are none (DESIGN.md's sync law: quiet is the honesty when
 * there are no facts, never a vacuous "no agents"). The one sentence that must
 * never be quiet is the degraded one below.
 */
export function localClaim(sources: MonitorSourceCounts): string | null {
  if (sources.localState !== "live" || sources.local === 0) return null;
  return `${sources.local} managed agent${sources.local === 1 ? "" : "s"}`;
}

/** The honest-states law for the local half: a fold that could not be read
 * is UNAVAILABLE with fieldd's reason, never a blank stage that looks idle. */
export function localUnavailableClaim(sources: MonitorSourceCounts): string | null {
  if (sources.localState !== "unavailable") return null;
  return sources.localReason === undefined || sources.localReason === ""
    ? "agents unavailable"
    : `agents unavailable · ${sources.localReason}`;
}

/** The real rows, counted with their peers. No chip at all when there are
 * none — DESIGN.md's sync law, that quiet is the honesty when there are no
 * facts, rather than a vacuous "no peers". */
export function remoteClaim(sources: MonitorSourceCounts): string | null {
  if (sources.remote === 0) return null;
  const sessions = `${sources.remote} remote session${sources.remote === 1 ? "" : "s"}`;
  return `${sessions} · ${sources.hosts} peer${sources.hosts === 1 ? "" : "s"}`;
}

/**
 * THE DEGRADED STATE, on the surface GT-D17 made responsible for it (GT-5c).
 *
 * `remoteClaim` above is null whenever there are no rows, which includes the
 * case where there are no rows BECAUSE THE MESH COULD NOT BE ASKED — so a mesh
 * that was on with its gateway down drew exactly what a healthy empty mesh
 * draws, at the one surface a decision declared to BE the door. The
 * honest-states law says a degraded plane surfaces as UNAVAILABLE with its
 * reason, never as a blank, and this is that sentence.
 *
 * It is the ordinary state on a machine whose mesh flag is off, which is why it
 * is worded and styled as a STATE and not a fault: quiet type, the floor's own
 * words, and no color from §2.5's status scale. Nothing is wrong with a machine
 * that is not on a mesh; what would be wrong is not saying so.
 *
 * `no-door` says nothing, deliberately: nobody has been asked yet, and a deck
 * that has not finished coming up is not a mesh that is down.
 */
export function remoteUnavailableClaim(sources: MonitorSourceCounts): string | null {
  if (sources.remoteState !== "unavailable") return null;
  return sources.remoteReason === undefined || sources.remoteReason === ""
    ? "mesh unavailable"
    : `mesh unavailable · ${sources.remoteReason}`;
}

/**
 * AR-7 — the fold's rows as the marker names them: every run, whether the
 * stage draws it or not. The pane is the fold's own join (`terminal`, a LOCAL
 * row only — a peer's session id names no pane here), the provenance is the
 * row's word with the contract's default (absent reads `app`), and `drawn` is
 * asked of the rows the stage actually assembled, by the run — the id every
 * managed row is keyed by (`managedRowId`).
 */
export function monitorRunFacts(
  rows: readonly AgentSessionSummary[],
  drawn: readonly Pick<MonitorAgent, "id" | "agent">[],
): GodviewMonitorRunFacts[] {
  const bodies = new Set(drawn.filter((row) => row.agent !== undefined).map((row) => row.id));
  return rows.map((row) => {
    const terminal = row.terminal?.hosted === "local" ? row.terminal.runtimeSessionId : undefined;
    return {
      run: row.runtimeRunId,
      provider: row.kind,
      ...(terminal !== undefined && terminal !== "" ? { terminal } : {}),
      spawnedBy: row.spawnedBy ?? "app",
      status: row.status,
      exited: row.continuation?.exited === true,
      observed: row.monitor !== undefined,
      drawn: bodies.has(managedRowId(row)),
    };
  });
}

/** With no deck there is no daemon to ask: the sheet says HISTORY OFF, the
 * column stays empty, and neither invents an answer. */
const NO_HISTORY: HistoryPort = {
  status: async () => ({
    reachable: false,
    detail: "no deck",
    checkedAt: new Date().toISOString(),
  }),
  facts: async () => [],
  search: async () => ({
    status: { reachable: false, detail: "no deck", checkedAt: new Date().toISOString() },
    answered: false,
    hits: [],
    clipped: false,
  }),
};
const NO_USAGE: AccountUsagePort = {
  snapshot: async () => ({ refreshedAt: new Date().toISOString(), entries: [] }),
  subscribe: () => () => undefined,
};

export interface GodviewMonitorProps {
  view: AgentMonitorView;
  parameters: MonitorParameters;
  theme?: GodviewTheme;
  notice?: string | null;
  tuningOpen?: boolean;
  /** The deck's verbs (GT-D17, AR-3), or null while there is no deck. The
   * stage passes it to the source and never calls it — a view is still a pure
   * function of its props, and this component is not a view. */
  door?: MonitorDoor | null;
  /** The deck's pane facts, read-only. */
  panes?: MonitorPaneFacts;
  /** The product shell overlays native macOS controls on the leading edge. */
  reserveWindowControls?: boolean;
  onSelectView?: (viewId: string) => void;
  onToggleTuning?: () => void;
  onThemeChange?: (theme: GodviewTheme) => void;
}

export function GodviewMonitor({
  view,
  parameters,
  theme = "light",
  notice = null,
  tuningOpen = false,
  door = null,
  panes,
  reserveWindowControls = false,
  onSelectView,
  onToggleTuning,
  onThemeChange,
}: GodviewMonitorProps): ReactElement {
  const stageRef = useRef<HTMLElement>(null);
  // The palette reads THIS stage's Godview root, never the document's first:
  // the catalog mounts two roots in two themes, and the order of its
  // specimens must not decide which theme the bodies wear (AR-5b). The ref
  // is filled in layout, before the palette's own effect reads it.
  const godviewRootRef = useRef<Element | null>(null);
  useLayoutEffect(() => {
    godviewRootRef.current = stageRef.current?.closest(".vf-godview") ?? null;
  }, []);
  const palette = useMonitorPalette(godviewRootRef);

  // AR-S5 — THE PROFILE TABS (the agents-settings record's T3). The feed is
  // the one Settings reads, held only while this stage is (PF6). A chosen tab
  // keeps its profile's sessions and recedes every other one, the counters
  // count what it shows, and a spawn from the bar runs under it. All — the
  // tab chosen on open — is the default profile, as before there were tabs.
  const [profileSets, setProfileSets] = useState<readonly AgentProfileSet[]>([]);
  const [profileTab, setProfileTab] = useState<string | null>(null);
  const profilesPort = door?.profiles;
  useEffect(() => {
    if (profilesPort === undefined) {
      setProfileSets([]);
      return;
    }
    return profilesPort.subscribe(setProfileSets);
  }, [profilesPort]);
  const showTabs = showsProfileTabs(profileSets);
  const chosen = useMemo(() => chosenProfile(profileSets, profileTab), [profileSets, profileTab]);
  const launch = useMemo(() => launchProfile(chosen), [chosen]);

  const {
    agents,
    actions,
    sources,
    providers,
    providerState,
    retryProviders,
    selectedProviderId,
    selectProvider,
    personaOptions,
    selectedPersonaId,
    selectPersona,
    spawnLaunch,
    spawn,
    acknowledgement,
    clearAcknowledgement,
  } = useMonitorAgents({
    palette,
    door,
    ...(panes ? { panes } : {}),
    launch,
  });
  const selectedProvider = providers.find((p) => p.id === selectedProviderId);
  // AC-4 — the chosen row's decision, read for the bar (and the marker) from
  // ONE module (`provider-picker.ts`), the same one the spawn verb asks. The
  // persona choices come from the hook that sends the spawn, so the control
  // drawn and the request sent cannot disagree (none under a chosen tab).
  const selectedLabel =
    selectedProvider === undefined ? undefined : providerPickerLabel(selectedProvider);
  const historyClaim =
    selectedProvider === undefined ? null : providerHistoryClaim(selectedProvider);
  const persona = personaOptions.find(
    (choice) => choice.value !== "" && choice.value === selectedPersonaId,
  );
  // A row that starts no new session (deprecated, or one that denies `spawn`)
  // has no SPAWN: the verb is withdrawn, not dimmed, because nothing the user
  // does on this device brings it back — the face of the picker says why.
  // With no row chosen the control stays, disabled, exactly as before.
  const offersSpawn = selectedProvider === undefined || providerStartsSessions(selectedProvider);
  const chromeRef = useRef<HTMLDivElement>(null);
  const usagePort = door?.usage;
  const [usageState, setUsageState] = useState<MonitorFeedState>({ state: "no-door" });
  const [usageAttempt, setUsageAttempt] = useState(0);
  // Rebind the subscription on retry without remounting the column: it keeps
  // the last good reading and the viewer's open usage popup while reconnecting.
  const columnUsagePort = useMemo<AccountUsagePort>(() => {
    const source = usagePort ?? NO_USAGE;
    return {
      snapshot: () => source.snapshot(),
      subscribe: (listener) => source.subscribe(listener),
    };
  }, [usagePort, usageAttempt]);
  useEffect(() => {
    setUsageState({ state: usagePort === undefined ? "no-door" : "loading" });
    return usagePort?.subscribeState?.(setUsageState);
  }, [usagePort]);
  const claimsRef = useRef<HTMLDivElement>(null);
  /** The picker's history state, which describes the picker (AC-4). */
  const historyId = useId();
  const [findOpen, setFindOpen] = useState(false);
  /** What the swarm is painting with, read off its own element (AR-5). */
  const [swarmRenderer, setSwarmRenderer] = useState("none");
  /** The usage column's tiles, counted off the chrome slot (AR-5); -1 unmounted. */
  const [usageTiles, setUsageTiles] = useState(-1);
  const personas = useMemo(() => personaProfiles(profileSets), [profileSets]);
  const chosenId = chosen?.id;
  /** The rows as the stage draws them: every one, the chosen profile's as
   * they are and the rest receded — still in the physics, in their places. */
  const staged = useMemo(
    () => recedeOutside(agents, chosenId, personas),
    [agents, chosenId, personas],
  );
  const shown = useMemo(
    () => (chosenId === undefined ? agents : staged.filter((agent) => agent.receded !== true)),
    [agents, chosenId, staged],
  );
  const counts = useMemo(() => monitorAgentCounts(shown), [shown]);
  // AR-7 — the fold's rows for the marker, handed on as the SAME object until
  // a fact the marker states moves: the fold sends a whole board at fieldd's
  // tick while an agent works, and a token count is no news to this line (the
  // identity rule the deck's frame facts follow in `GodviewAgentsProvider`).
  const fold = useAgentFold();
  const runFacts = useRef<{ key: string; runs: GodviewMonitorRunFacts[] }>({ key: "", runs: [] });
  const nextRuns = monitorRunFacts(fold.rows, agents);
  const runsKey = JSON.stringify(nextRuns);
  if (runsKey !== runFacts.current.key) runFacts.current = { key: runsKey, runs: nextRuns };
  const runs = runFacts.current.runs;
  const tabs = useMemo(
    () => profileTabs(profileSets, agents, personas),
    [profileSets, agents, personas],
  );
  /** A tab with no sessions under it says so over the stage; with no sessions
   * at all the view's own empty state speaks instead. */
  const emptyUnder =
    chosen !== undefined && agents.length > 0 && shown.length === 0 ? chosen : undefined;

  // Views that lay out in flow clear the chrome with these two insets (the
  // list's padding reads both); the swarm instead reads the chrome elements'
  // rects directly and steers bodies around them.
  //
  // The RIGHT inset is the package's own idea (`monitor/chrome.ts`): the usage
  // column down the left edge is host chrome, and a view that cares finds it
  // through the marker rather than by knowing what it is. The TOP inset is the
  // same bargain for the strip above — and it is VibeField's to publish because
  // the strip is VibeField's: AR-3's claims are not in the reference host at
  // all, so the package's `list.css` reserves nothing for them and its toolbar
  // laid out at y=11px, under a strip pinned at y=11px. James's 2026-09-13 pass
  // photographed the result: "1 MANAGED AGENT · MESH UNAVAILABLE…" and
  // "1 SESSIONS" printed over each other in the same corner. Two claims that
  // overlap are one unreadable claim, which is the failure GT-D17 names.
  //
  // Measured rather than assumed, and for a reason worth keeping: the strip's
  // height is not a constant. It carries between zero and four chips, the
  // floor's own refusal sentence can run long enough to wrap, and a viewer's
  // text scale moves all of it. A hardcoded band would be right on this
  // machine and wrong on the next.
  useEffect(() => {
    const stage = stageRef.current;
    const chrome = chromeRef.current;
    const claims = claimsRef.current;
    if (!stage || !chrome || !claims || typeof ResizeObserver === "undefined") return;
    const publish = (): void => {
      const stageRect = stage.getBoundingClientRect();
      stage.style.setProperty(
        "--vf-monitor-chrome-right",
        `${Math.round(chrome.getBoundingClientRect().right - stageRect.left)}px`,
      );
      // A strip with nothing to say takes no room: it publishes 0, and the
      // view's own band then measures from the stage's top exactly as before.
      // The GAP is not published — `godview.css` adds the package's own band to
      // whatever this says, so no new spacing number is invented here
      // (docs/UI_SYSTEM.md: a visual constant belongs in DESIGN.md and the
      // token sheet, never loose in a component).
      //
      // "Nothing to say" is read off the HEIGHT, not off the child count: the
      // strip always carries its `aria-live` acknowledgement span, empty or
      // not, so counting children would reserve a band for a silent strip.
      const claimsRect = claims.getBoundingClientRect();
      const bottom = claimsRect.height === 0 ? 0 : Math.round(claimsRect.bottom - stageRect.top);
      stage.style.setProperty("--vf-monitor-claims-bottom", `${bottom}px`);
    };
    const observer = new ResizeObserver(publish);
    observer.observe(chrome);
    observer.observe(claims);
    publish();
    return () => observer.disconnect();
  }, []);

  // The swarm says what painted on its section (`data-swarm-renderer`); the
  // marker repeats it. Observed rather than read once, because the device
  // answers after the mount.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof MutationObserver === "undefined") return;
    const read = (): void => {
      const painted = stage
        .querySelector("[data-swarm-renderer]")
        ?.getAttribute("data-swarm-renderer");
      setSwarmRenderer(painted ?? "none");
    };
    const observer = new MutationObserver(read);
    observer.observe(stage, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-swarm-renderer"],
    });
    read();
    return () => observer.disconnect();
  }, [view.id]);

  // The usage column's tiles, counted off the chrome slot the same way: the
  // column is the package's, its batch arrives on the door's schedule, and a
  // harness wants the count as a fact rather than a screenshot.
  useEffect(() => {
    const chrome = chromeRef.current;
    if (!chrome || typeof MutationObserver === "undefined") return;
    const read = (): void => {
      const column = chrome.querySelector(".vf-usage-column");
      setUsageTiles(column ? column.querySelectorAll(".vf-usage-tile").length : -1);
    };
    const observer = new MutationObserver(read);
    observer.observe(chrome, { subtree: true, childList: true });
    read();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (acknowledgement === null) return;
    const timer = window.setTimeout(clearAcknowledgement, ACKNOWLEDGEMENT_MS);
    return () => window.clearTimeout(timer);
  }, [acknowledgement, clearAcknowledgement]);

  useEffect(() => {
    // Read rather than passed down: the swarm chooses its physics home in its
    // own mount effect, and React runs a child's effects BEFORE its parent's —
    // so by the time this line is written the choice has already been made.
    emitGodviewMonitorMarker({
      viewId: view.id,
      agents: agents.length,
      agentBacked: agents.filter((agent) => agent.agent !== undefined).length,
      localClaim: localClaim(sources),
      localAgents: sources.local,
      terminals: sources.terminals,
      localState: sources.localState,
      ...(sources.localReason !== undefined ? { localReason: sources.localReason } : {}),
      remoteSessions: sources.remote,
      remoteHosts: sources.hosts,
      remoteState: sources.remoteState,
      ...(sources.remoteReason !== undefined ? { remoteReason: sources.remoteReason } : {}),
      swarmPhysics: currentSwarmPhysicsMode(),
      swarmRenderer,
      usageTiles,
      findSheet: findOpen ? "open" : "closed",
      profileTab: chosenId ?? "all",
      shownAgents: shown.length,
      picker: {
        rows: providers.map((provider) => ({ id: provider.id, badge: providerBadge(provider) })),
        selected: selectedProviderId,
        // the marker says what the bar DRAWS: a verb a person can use, not
        // the "no provider chosen" case that only announces a refusal
        spawn: selectedProvider !== undefined && providerStartsSessions(selectedProvider),
        history: historyClaim,
        personas: personaOptions.length,
      },
      runs,
    });
    // the picker's facts ride on primitives (and the door's own list), never
    // on the per-render arrays derived from them
  }, [
    agents,
    view.id,
    sources,
    swarmRenderer,
    usageTiles,
    findOpen,
    chosenId,
    shown,
    providers,
    selectedProviderId,
    offersSpawn,
    historyClaim,
    personaOptions.length,
    runs,
  ]);

  const closeFind = useCallback((): void => setFindOpen(false), []);

  const selectNextStatus = useCallback(
    (status: AgentVisualStatus): void => {
      // By ROW id: a managed row with no pane has no session, and a session
      // id of undefined matched the first sessionless row instead of cycling.
      // AR-S5: through what the chosen tab shows, as the counters count it.
      const currentId = shown.find((agent) => agent.active)?.id;
      const next = nextMonitorAgentForStatus(shown, status, currentId);
      if (next) actions.select(next);
    },
    [actions, shown],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
      // ⌘F summons Find (AR-5, D6): the sheet over the stage, the reference's chord.
      if (event.code === "KeyF") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setFindOpen((current) => !current);
        return;
      }
      const status = ({ Digit1: "blocked", Digit2: "working", Digit3: "idle" } as const)[
        event.code as "Digit1" | "Digit2" | "Digit3"
      ];
      if (!status) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      selectNextStatus(status);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [selectNextStatus]);

  // AR-S5 — ⌥0 is All, ⌥1…⌥n the tabs, while the strip is drawn: captured
  // like the chords above, and only for the digits that have a tab, so ⌥ and
  // any other digit still reach the pane.
  const tabKey = profileSets.map((set) => set.id).join(" ");
  useEffect(() => {
    if (!showTabs) return;
    const ids: (string | null)[] = [null, ...tabKey.split(" ")];
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const digit = /^Digit([0-9])$/.exec(event.code);
      if (digit === null) return;
      const index = Number(digit[1]);
      if (index >= ids.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setProfileTab(ids[index] ?? null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [showTabs, tabKey]);

  const MonitorView = view.Component;
  // Where SPAWN lands, in its tip's words: the profile the spawn names (the
  // hook's `spawnLaunch` — the chosen tab's, or none for a row that denies
  // personas), else the default profile's rule. A persona chosen under All
  // is its own sign-in, so the tip says "as" it and names no profile — not
  // the default's, which the spawn does not run under.
  const spawnUnder =
    selectedProvider === undefined || persona !== undefined
      ? undefined
      : spawnProfileLabel(
          profileSets,
          spawnLaunch === null ? undefined : chosen,
          selectedProvider.id,
        );

  return (
    <>
      {/* THE INSTRUMENT BAR (record §04), the package's recipe: counters left,
          the view marks and the theme switch right, and in the trailing slot
          VibeField's own tools — the birth (AR-3: the provider list is fieldd's
          answer, the spawn lands in the active pane; an uninstalled provider is
          listed and said to be so rather than hidden) and the surface lab.
          AC-4: each row says the catalog's decision in its own text, the
          chosen row's history state follows the picker in the deck's degraded
          idiom, and the persona choice and SPAWN appear only where the row
          claims them — the persona choice only under All, since a chosen
          profile tab decides the sign-in (AR-S5). */}
      <InstrumentBar
        counts={counts}
        onSelectStatus={selectNextStatus}
        views={MONITOR_VIEWS}
        viewId={view.id}
        onSelectView={(viewId) => onSelectView?.(viewId)}
        theme={theme}
        onThemeChange={(next) => onThemeChange?.(next)}
        leading={
          <>
            {reserveWindowControls ? (
              <span className="vf-godview-native-controls-space" aria-hidden="true" />
            ) : null}
            <span className="vf-godview-header-notice" aria-live="polite">
              {notice ?? ""}
            </span>
          </>
        }
        {...(showTabs
          ? {
              centre: (
                <ProfileTabs
                  tabs={tabs}
                  selected={chosenId ?? null}
                  onSelect={setProfileTab}
                  shortcuts
                />
              ),
            }
          : {})}
        trailing={
          <>
            <select
              className="vf-godview-bar-select"
              aria-label="Agent provider"
              {...(historyClaim !== null ? { "aria-describedby": historyId } : {})}
              value={selectedProviderId ?? ""}
              disabled={providers.length === 0}
              onChange={(event) => selectProvider(event.currentTarget.value)}
            >
              {providers.length === 0 ? (
                <option value="">
                  {providerState.state === "unavailable"
                    ? "providers unavailable"
                    : providerState.state === "ready"
                      ? "no providers"
                      : "loading providers…"}
                </option>
              ) : null}
              {providers.map((provider) => (
                <option
                  key={provider.id}
                  value={provider.id}
                  {...(provider.status !== undefined ? { "data-status": provider.status } : {})}
                >
                  {providerOptionText(provider)}
                </option>
              ))}
            </select>
            {historyClaim !== null ? (
              <span id={historyId} className="vf-godview-provider-history">
                {historyClaim}
              </span>
            ) : null}
            {personaOptions.length > 0 ? (
              <select
                className="vf-godview-bar-select"
                aria-label="Agent persona"
                value={selectedPersonaId}
                onChange={(event) => selectPersona(event.currentTarget.value)}
              >
                {personaOptions.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            ) : null}
            {offersSpawn ? (
              <button
                type="button"
                className="vf-godview-bar-control vf-godview-spawn"
                disabled={door === null || selectedProvider === undefined}
                title={
                  selectedProvider === undefined
                    ? "no agent provider is available on this device"
                    : selectedProvider.available
                      ? `spawn ${selectedLabel}${persona ? ` as ${persona.label}` : ""} in the active pane${
                          spawnUnder !== undefined ? `, under ${spawnUnder}` : ""
                        }`
                      : `${selectedLabel} is not installed on this device`
                }
                onClick={() => void spawn()}
              >
                SPAWN
              </button>
            ) : null}
            <BarControl
              mark="find"
              label="FIND"
              shortcut="⌘F"
              ariaLabel="Find an agent by what was said"
              {...(findOpen ? { controls: "vf-find-sheet" } : {})}
              on={findOpen}
              onClick={() => setFindOpen((current) => !current)}
            />
            <BarControl
              mark="tune"
              label="SYSTEM CONTROL"
              ariaLabel="System control"
              controls="vf-godview-tweak-panel"
              on={tuningOpen}
              onClick={() => onToggleTuning?.()}
            />
          </>
        }
      />

      <FindSheet
        open={findOpen}
        agents={agents}
        history={door?.history ?? NO_HISTORY}
        onClose={closeFind}
        onSelect={(agent: ViewsMonitorAgent) => {
          actions.select(agent as MonitorAgent);
          setFindOpen(false);
        }}
      />

      <section
        ref={stageRef}
        className={MONITOR_STAGE_CLASS}
        aria-label={
          sources.remote === 0 ? "Agent monitor" : "Agent monitor — local and remote sessions"
        }
      >
        {/* The swarm's physics lives in OUR worker (GT-D16); the package's view
            is handed the driver through its context and never learns which. */}
        <SwarmPhysicsProvider factory={createSwarmPhysicsDriver}>
          <MonitorView
            agents={staged}
            parameters={parameters}
            actions={actions}
            palette={palette}
          />
        </SwarmPhysicsProvider>
        {emptyUnder !== undefined ? (
          <div className="vf-monitor-profile-empty" role="status">
            <span className="vf-monitor-profile-empty-ring" aria-hidden="true">
              <ProfileGlyph
                glyph={emptyUnder.glyph}
                kind={emptyUnder.kind}
                filled={emptyUnder.default}
                size={16}
              />
            </span>
            <b>No sessions under {emptyUnder.label}</b>
            <span>A session started from this tab runs under this profile.</span>
          </div>
        ) : null}
        {/* The chrome slot: the usage column down the stage's left edge (record
            §05), the package's own; the swarm steers around it. */}
        <div ref={chromeRef} className="vf-monitor-chrome" {...{ [MONITOR_CHROME_ATTRIBUTE]: "" }}>
          <UsageColumn port={columnUsagePort} />
        </div>
        {/* The claims: VibeField's, on their own strip — also solid to the swarm. */}
        <div ref={claimsRef} className="vf-monitor-claims" {...{ [MONITOR_CHROME_ATTRIBUTE]: "" }}>
          {localClaim(sources) !== null ? (
            <span className="vf-monitor-local-chip">{localClaim(sources)}</span>
          ) : null}
          {localUnavailableClaim(sources) !== null ? (
            <span
              className="vf-monitor-remote-unavailable-chip"
              title={sources.localReason ?? "the agent fold could not be read"}
            >
              {localUnavailableClaim(sources)}
            </span>
          ) : null}
          {remoteClaim(sources) !== null ? (
            <span className="vf-monitor-remote-chip">{remoteClaim(sources)}</span>
          ) : null}
          {remoteUnavailableClaim(sources) !== null ? (
            <span
              className="vf-monitor-remote-unavailable-chip"
              title={sources.remoteReason ?? "the mesh could not be asked"}
            >
              {remoteUnavailableClaim(sources)}
            </span>
          ) : null}
          {providerState.state === "unavailable" ? (
            <button
              type="button"
              className="vf-monitor-feed-retry"
              title={providerState.reason}
              onClick={retryProviders}
            >
              Providers unavailable · Retry
            </button>
          ) : null}
          {usageState.state === "unavailable" ? (
            <button
              type="button"
              className="vf-monitor-feed-retry"
              title={usageState.reason}
              onClick={() => setUsageAttempt((attempt) => attempt + 1)}
            >
              Usage unavailable · Retry
            </button>
          ) : null}
          <span className="vf-monitor-ack" aria-live="polite">
            {acknowledgement?.message ?? ""}
          </span>
        </div>
      </section>
    </>
  );
}
