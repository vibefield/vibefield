import type { MonitorTheme, StageGeometry, ViewReport } from "@vibecook/puppeteer-view-sdk";
import { frameScheduler, MonitorViewHost } from "@vibecook/puppeteer-view-sdk/host";
import { ProfileGlyph } from "@vibecook/puppeteer-view-sdk/react";
import {
  type AccountUsagePort,
  BarControl,
  ChromeBoundary,
  type FindAgent,
  FindSheet,
  type HistoryPort,
  InstrumentBar,
  MONITOR_STAGE_CLASS,
  MONITOR_VIEWS,
  type MonitorParameters,
  ProfileTabs,
  UsageColumn,
  useMonitorPalette,
} from "@vibecook/puppeteer-views";
import type { AgentProfileSet } from "@vibefield/contracts";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { emitGodviewMonitorMarker, type GodviewMonitorRunFacts } from "../development-console";
import { DeviceFilterChip } from "./DeviceFilterChip";
import type { GodviewTheme } from "./GodviewTuningPanel";
import { monitorAgentCounts } from "./monitor/agents";
import { type ChromeRun, NO_RUNS, useChromeKey } from "./monitor/chrome-facts";
import type { DeviceChoice } from "./monitor/device-filter";
import { useMonitorFeed } from "./monitor/GodviewAgentsProvider";
import { launcherOwnsKeyEvent, setMonitorHoldsKeys } from "./monitor/launcher-keys";
import { chosenProfile, showsProfileTabs } from "./monitor/profile-tabs";
import type { MonitorDoor, MonitorFeedState } from "./monitor/remote-door";
import type { MonitorViewEntry } from "./monitor/types";
import {
  type MonitorPaneFacts,
  type MonitorSourceCounts,
  useMonitorAgents,
} from "./monitor/useMonitorAgents";
import { OsMark } from "./os-marks";

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

/** The desktops other than this one that are running agents on the stage. */
export function otherDesktops(devices: readonly DeviceChoice[]): readonly DeviceChoice[] {
  return devices.filter((device) => !device.here && device.agents > 0);
}

/** Other desktops' agents, counted where they live (DS-3): the desktop's NAME
 * when there is one (DS §11's witness — "the chip reads a device name"),
 * how many desktops when there are several, and the chip draws their marks
 * before the words. No chip at all when there are none — DESIGN.md's sync
 * law, that quiet is the honesty when there are no facts. */
export function remoteClaim(
  sources: MonitorSourceCounts,
  devices: readonly DeviceChoice[] = [],
): string | null {
  if (sources.remote === 0) return null;
  const agents = `${sources.remote} agent${sources.remote === 1 ? "" : "s"}`;
  const others = otherDesktops(devices);
  const [only] = others;
  if (others.length === 1 && only !== undefined) return `${agents} on ${only.name}`;
  return `${agents} on ${sources.hosts} desktop${sources.hosts === 1 ? "" : "s"}`;
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
 *
 * *Correction 2026-09-30 (DS-3):* "the ordinary state on a machine whose mesh
 * flag is off" was the poll's — ghosttea's host ask, refused or thrown. The
 * mesh board is this desktop's own fieldd answering, and a desktop alone
 * answers it with itself: no claim at all. This sentence now speaks only when
 * the board could not be READ — the daemon refused it, or a frame did not
 * parse — and the reason is fieldd's or the reader's own.
 */
export function remoteUnavailableClaim(sources: MonitorSourceCounts): string | null {
  if (sources.remoteState !== "unavailable") return null;
  return sources.remoteReason === undefined || sources.remoteReason === ""
    ? "mesh unavailable"
    : `mesh unavailable · ${sources.remoteReason}`;
}

/**
 * AR-7 — this desktop's runs as the marker names them: every run, whether the
 * stage draws it or not. The pane is the run's own join (`terminal`, a LOCAL
 * row only — a peer's session id names no pane here), the provenance is the
 * row's word with the contract's default (absent reads `app`), and `drawn` is
 * asked of the RUNS the stage actually shows (MV-3b: the model's rows, each
 * joined to its run through the board row it rode in on). The model carries
 * neither the PTY join, nor the provenance, nor the exit a smoke reads here
 * (M19): MV-3d reads them off each run's row of the model board, the chrome's
 * facts beside the model (`local`), where the fold's `full` row used to be.
 */
export function monitorRunFacts(
  runs: readonly ChromeRun[],
  drawnRuns: ReadonlySet<string>,
): GodviewMonitorRunFacts[] {
  return runs.map((run) => {
    const terminal = run.terminal?.hosted === "local" ? run.terminal.runtimeSessionId : undefined;
    return {
      run: run.runtimeRunId,
      provider: run.kind,
      ...(terminal !== undefined && terminal !== "" ? { terminal } : {}),
      spawnedBy: run.local?.spawnedBy ?? "app",
      status: run.status,
      exited: run.local?.exited === true,
      observed: run.local?.mirror !== undefined,
      drawn: drawnRuns.has(run.runtimeRunId),
    };
  });
}

const NO_DRAWN: ReadonlySet<string> = new Set();

/** What the marker states of the runs before `drawn` is joined: a key, so the
 * stage renders again for a marker fact and never for a token count. */
function markerRunsKey(runs: readonly ChromeRun[]): string {
  return JSON.stringify(monitorRunFacts(runs, NO_DRAWN));
}

/** What a view has said about itself before it says anything. */
const NO_REPORT: ViewReport = Object.freeze({});

/** The stage before it is measured: no size, no chrome. */
const EMPTY_STAGE: StageGeometry = Object.freeze({
  width: 0,
  height: 0,
  insets: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
  obstacles: Object.freeze([]),
});

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

/** The counters select nothing any more (FC-D18): the bar still asks for an
 * answer, and its group is hidden (godview.css) until the views package draws
 * counters only for a host that passes counts. */
const noStatusCycle = (): void => undefined;

/** Godview follows the app's theme (FC-D7): the bar's ☼◐ switch changes
 * nothing. The views package draws it whatever a host passes, so it is hidden
 * (godview.css) until the package draws it only for a host that hands it a
 * handler — the ask on record, beside the counters'. */
const noThemeSwitch = (): void => undefined;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function reducedMotionQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(REDUCED_MOTION)
    : null;
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = reducedMotionQuery();
  if (query === null) return () => undefined;
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const readReducedMotion = (): boolean => reducedMotionQuery()?.matches ?? false;

/** MV-W4 — the viewer's reduced-motion preference, live: a change reaches the
 * mounted view without waiting for the stage to render for another reason. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
}

export interface GodviewMonitorProps {
  view: MonitorViewEntry;
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
  /** MV-W4 — the stage's animations switch, the value its owner hands
   * `GodviewStage` (GT-3p: the lab's kill switch; the catalog's still stage).
   * Off, a ported view's loop holds still, as the stage's CSS loops do under
   * the attribute the stage writes from the same value. */
  animations?: boolean;
  onSelectView?: (viewId: string) => void;
  onToggleTuning?: () => void;
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
  animations = true,
  onSelectView,
  onToggleTuning,
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
  const reducedMotion = usePrefersReducedMotion();

  // AR-S5 — THE PROFILE TABS (the agents-settings record's T3). The feed is
  // the one Settings reads, held only while this stage is (PF6). A chosen tab
  // keeps its profile's sessions and recedes every other one, the counters
  // count what it shows. Terminal creation is independent of the chosen tab:
  // a new terminal's profile is the spawn bloom's to choose (SB-3), never the
  // tab's.
  const [profileSets, setProfileSets] = useState<readonly AgentProfileSet[]>([]);
  /** Whether the feed has answered at all: until it has, the spawn menu's
   * desktop is `reading` — an empty list is an answer, and not the same one. */
  const [profileSetsRead, setProfileSetsRead] = useState(false);
  const [profileTab, setProfileTab] = useState<string | null>(null);
  const profilesPort = door?.profiles;
  useEffect(() => {
    setProfileSetsRead(false);
    if (profilesPort === undefined) {
      setProfileSets([]);
      return;
    }
    return profilesPort.subscribe((sets) => {
      setProfileSets(sets);
      setProfileSetsRead(true);
    });
  }, [profilesPort]);
  const showTabs = showsProfileTabs(profileSets);
  const chosen = useMemo(() => chosenProfile(profileSets, profileTab), [profileSets, profileTab]);
  const chosenId = chosen?.id;

  // DS-3 — THE DEVICE FILTER: one desktop's rows, or every desktop's (the
  // default). A desktop that leaves the board falls back to all. The chip is
  // drawn only when there is a choice to make — two desktops or more — and
  // while its menu is open the stage holds the keys (QL-D2, as the find sheet
  // does), so a launcher in the focused pane never takes its ⎋.
  const [deviceChoice, setDeviceChoice] = useState<string | null>(null);
  // MV-3b — THE WINDOW on the replica (`useMonitorAgents`): the backend's rows
  // through this window's one door, joined with the deck's panes, the chosen
  // tab and the chosen desktop; list and rain as SDK views on the window's cut
  // of it (MV-4…MV-6); Find alone adapts its local chrome facts (M19).
  const {
    viewReplica,
    commands,
    capabilities,
    agents,
    shown,
    findAgents,
    runByRow,
    sources,
    acknowledgement,
    clearAcknowledgement,
    devices,
    deviceChosen,
    tabs,
  } = useMonitorAgents({
    palette,
    door,
    ...(panes ? { panes } : {}),
    profiles: profileSets,
    profilesRead: profileSetsRead,
    hasProfiles: profilesPort !== undefined,
    chosenProfile: chosenId,
    device: deviceChoice,
  });
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  // Held only while the chip is DRAWN and says its menu is open: the chip is
  // drawn for two desktops or more, and one unmounted with its menu open used
  // to leave the keys held until Godview closed (2026-10-01).
  const deviceMenuHolds = deviceMenuOpen && devices.length > 1;
  useEffect(() => {
    if (!deviceMenuHolds) return;
    setMonitorHoldsKeys(true);
    return () => setMonitorHoldsKeys(false);
  }, [deviceMenuHolds]);
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
  // A failed column is tried again only for a fact that can fix it. The column
  // reads its port and nothing else, so the facts are a new port: a new door,
  // or the viewer's Retry. Never the model's rows (keyed on them, a persistent
  // failure remounted on every publish, M176), and never the host update that
  // follows the failure itself (the tile count it observes changes with it).
  // A new port inside the boundary's window waits for its end (the backoff).
  const usageRetryKey = columnUsagePort;
  useEffect(() => {
    setUsageState({ state: usagePort === undefined ? "no-door" : "loading" });
    return usagePort?.subscribeState?.(setUsageState);
  }, [usagePort]);
  const claimsRef = useRef<HTMLDivElement>(null);
  // M49 — the claims behind their own boundary, INSIDE the strip: the strip
  // stays measured (its rectangle is the stage's top inset and an obstacle),
  // and the acknowledgement keeps its voice. They try again for the facts they
  // state, never for the stage geometry a failure republishes (M176).
  const claimsRetryKey = useMemo(
    () => ({ sources, devices, usageState }),
    [sources, devices, usageState],
  );
  const [findOpen, setFindOpen] = useState(false);
  // QL-D2's other half: while the find sheet is up, its Escape is the sheet's,
  // not a fresh pane's launcher's (`launcher-keys.ts`).
  useEffect(() => {
    if (!findOpen) return;
    setMonitorHoldsKeys(true);
    return () => setMonitorHoldsKeys(false);
  }, [findOpen]);
  // MV-5 (W5) — what the mounted view says about itself (`commands.report`):
  // what it paints with, where its simulation runs, and whether it holds the
  // keys. Never read off its DOM; the slot clears it when the view changes.
  const [viewReport, setViewReport] = useState<ViewReport>(NO_REPORT);
  /** Read by the capture listeners at event time: a report lands between renders. */
  const viewHoldsKeysRef = useRef(false);
  const onReport = useCallback((report: ViewReport): void => {
    viewHoldsKeysRef.current = report.keysHeld === true;
    setViewReport(report);
  }, []);
  /** AR-5: what the swarm paints with — `starting` while its physics runs and its device has not answered. */
  const swarmRenderer =
    viewReport.renderer ?? (viewReport.physics !== undefined ? "starting" : "none");
  /** GT-3c: where its physics runs — `worker`, the honest `inline`, or `none` for a view with none. */
  const swarmPhysics = viewReport.physics ?? "none";
  const viewHoldsKeys = viewReport.keysHeld === true;
  /** The usage column's tiles, counted off the chrome slot (AR-5); -1 unmounted. */
  const [usageTiles, setUsageTiles] = useState(-1);
  const counts = useMemo(() => monitorAgentCounts(shown), [shown]);
  // AR-7 — this desktop's runs for the marker, handed on as the SAME object
  // until a fact the marker states moves: a working agent's row moves several
  // times a second, and a token count is no news to this line (the identity
  // rule the deck's frame facts follow in `GodviewAgentsProvider`). MV-3d: the
  // runs are the chrome's (`chrome-facts.ts`), and the stage hears them only
  // when the marker's own key moves. `drawn` is asked of the runs behind the
  // agent rows the stage shows, through the board's join (`runByRow`) —
  // observed or not.
  const chrome = useMonitorFeed()?.chrome ?? null;
  const markerKey = useChromeKey(chrome, markerRunsKey);
  const drawnRunIds = shown.flatMap((row) => {
    const run = row.kind !== "agent" ? undefined : runByRow.get(row.id);
    return run === undefined ? [] : [run];
  });
  const drawnKey = JSON.stringify(drawnRunIds);
  // Row objects move with token counts; membership does not. Reuse the join
  // until either the drawn ids or a fact the marker actually states changes.
  const drawnRuns = useMemo(() => new Set(drawnRunIds), [drawnKey]);
  const runs = useMemo(
    () => monitorRunFacts(chrome?.runs() ?? NO_RUNS, drawnRuns),
    [chrome, markerKey, drawnRuns],
  );
  /** A tab with no sessions under it says so over the stage; with no sessions
   * at all the view's own empty state speaks instead. */
  const emptyUnder =
    chosen !== undefined && agents.length > 0 && shown.length === 0 ? chosen : undefined;

  // MV-D19 — the view host's stage: the chrome measured below, as plain data.
  // Every view reads it (MV-4…MV-6): the list's and the timeline's band and
  // gutter are its insets, the swarm steers around its obstacles. The CSS
  // variables the legacy views read off the stage are gone with them.
  const [stageGeometry, setStageGeometry] = useState<StageGeometry>(EMPTY_STAGE);
  // MV-W4 — the motion a view may make: none while the viewer asks for reduced
  // motion, and none while the stage's animations switch is off (the lab's
  // kill switch, the catalog's still stage). A view's loop stops on either
  // (the rain draws once per change instead, the swarm holds still and pauses
  // its physics). Both are known at the first render, so a view mounted under
  // a still stage never starts its loop.
  const monitorTheme = useMemo<MonitorTheme>(
    () => ({ scheme: theme, tokens: palette, reducedMotion, animations }),
    [theme, palette, reducedMotion, animations],
  );

  // Views that lay out in flow clear the chrome with these two insets — the
  // list and the timeline as the stage's `insets.left` and `insets.top` (M58);
  // the swarm instead steers its bodies around the chrome's rectangles, the
  // stage's `obstacles` (MV-D19).
  //
  // The LEFT inset is the usage column's right edge: the column down the
  // stage's left edge is host chrome, and a view learns it as geometry, never
  // by finding the host's DOM. The TOP inset is the same for the strip above —
  // and it is VibeField's to publish because the strip is VibeField's: AR-3's
  // claims are not in the reference host at all, so the package's `list.css`
  // reserved nothing for them and its toolbar laid out at y=11px, under a
  // strip pinned at y=11px. James's 2026-09-13 pass
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
      const chromeRect = chrome.getBoundingClientRect();
      const chromeRight = Math.round(chromeRect.right - stageRect.left);
      // A strip with nothing to say takes no room: it publishes 0, and the
      // view's own band then measures from the stage's top exactly as before.
      // The GAP is not published — the list's own stylesheet adds its band to
      // the inset, and the timeline starts at it (M63) — so no new spacing
      // number is invented here (docs/UI_SYSTEM.md: a visual constant belongs
      // in DESIGN.md and the token sheet, never loose in a component).
      //
      // "Nothing to say" is read off the HEIGHT, not off the child count: the
      // strip always carries its `aria-live` acknowledgement span, empty or
      // not, so counting children would reserve a band for a silent strip.
      const claimsRect = claims.getBoundingClientRect();
      const bottom = claimsRect.height === 0 ? 0 : Math.round(claimsRect.bottom - stageRect.top);
      // the same measurement as the view host's stage (MV-D19): the chrome's
      // right edge as the left inset, the strip's bottom as the top one, both
      // elements as obstacles — unrounded, the rectangles the swarm measured
      // off these two elements itself before it ported, so its bodies steer
      // exactly as they did
      const rect = (box: DOMRect) => ({
        x: box.left - stageRect.left,
        y: box.top - stageRect.top,
        width: box.width,
        height: box.height,
      });
      setStageGeometry({
        width: Math.round(stageRect.width),
        height: Math.round(stageRect.height),
        insets: { top: bottom, right: 0, bottom: 0, left: chromeRight },
        obstacles: [rect(chromeRect), ...(claimsRect.height === 0 ? [] : [rect(claimsRect)])],
      });
    };
    const observer = new ResizeObserver(publish);
    observer.observe(chrome);
    observer.observe(claims);
    // the stage itself too: a window that resizes moves the stage's size
    // without resizing the column or the strip
    observer.observe(stage);
    publish();
    return () => observer.disconnect();
  }, []);

  // SB-3 — while the view holds the keys (the spawn bloom held open, or opened
  // for the keys: its `report`, MV-D8) the monitor holds them, as it does while
  // the find sheet is up (QL-D2's other half): the deck's launchers stand aside,
  // and the stage's own chords below yield. A HOLD's bloom needs no hold: its ⎋
  // is the swarm field's own, heard with the focus on the field.
  useEffect(() => {
    if (!viewHoldsKeys) return;
    setMonitorHoldsKeys(true);
    return () => setMonitorHoldsKeys(false);
  }, [viewHoldsKeys]);

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
    emitGodviewMonitorMarker({
      viewId: view.id,
      agents: agents.length,
      agentBacked: agents.filter((agent) => agent.kind === "agent").length,
      localClaim: localClaim(sources),
      localAgents: sources.local,
      terminals: sources.terminals,
      localState: sources.localState,
      ...(sources.localReason !== undefined ? { localReason: sources.localReason } : {}),
      remoteSessions: sources.remote,
      remoteHosts: sources.hosts,
      remoteState: sources.remoteState,
      ...(sources.remoteReason !== undefined ? { remoteReason: sources.remoteReason } : {}),
      swarmPhysics,
      swarmRenderer,
      usageTiles,
      findSheet: findOpen ? "open" : "closed",
      profileTab: chosenId ?? "all",
      shownAgents: shown.length,
      runs,
    });
  }, [
    agents,
    view.id,
    sources,
    swarmPhysics,
    swarmRenderer,
    usageTiles,
    findOpen,
    chosenId,
    shown,
    runs,
  ]);

  const closeFind = useCallback((): void => setFindOpen(false), []);

  // FC-D18 (ruled 2026-10-01): the counters and their ⌘1–⌘3 are removed —
  // ⌘1–⌘4 are the frame's views now (One Frame FR-1), and a third digit family
  // would throw a missed ⌥ out of Godview. Blocked agents still show where they
  // are: an orange body in the swarm, a list row naming what it waits on. The
  // bar's counters group is hidden by godview.css until the views package
  // draws it only for a host that passes counts (the ask, One Frame §21).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
      // SB-3: a view that holds the keys (a spawn bloom with the keyboard) holds every key
      if (viewHoldsKeysRef.current) return;
      // ⌘F summons Find (AR-5, D6): the sheet over the stage, the reference's chord.
      if (event.code === "KeyF") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setFindOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // AR-S5 — ⌥0 is All, ⌥1…⌥n the tabs, while the strip is drawn: captured
  // like the chords above, and only for the digits that have a tab, so ⌥ and
  // any other digit still reach the pane. QL-D2: a key routed into a pane
  // whose launcher holds the keys is the launcher's (⌥n launches there), so
  // the strip yields and leaves that event untouched — and only that one: with
  // the focus anywhere else the strip keeps its digits.
  const tabKey = profileSets.map((set) => set.id).join(" ");
  useEffect(() => {
    if (!showTabs) return;
    const ids: (string | null)[] = [null, ...tabKey.split(" ")];
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (launcherOwnsKeyEvent(event)) return;
      // SB-3: nor does it take ⌥-digits from a view that holds the keys
      if (viewHoldsKeysRef.current) return;
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

  return (
    <>
      <ChromeBoundary name="Monitor controls">
        <InstrumentBar
          counts={counts}
          onSelectStatus={noStatusCycle}
          views={MONITOR_VIEWS}
          viewId={view.id}
          onSelectView={(viewId) => onSelectView?.(viewId)}
          theme={theme}
          onThemeChange={noThemeSwitch}
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
          {...(showTabs || devices.length > 1
            ? {
                centre: (
                  <>
                    {devices.length > 1 ? (
                      <DeviceFilterChip
                        devices={devices}
                        selected={deviceChosen}
                        onSelect={setDeviceChoice}
                        onOpenChange={setDeviceMenuOpen}
                      />
                    ) : null}
                    {showTabs ? (
                      <ProfileTabs
                        tabs={tabs}
                        selected={chosenId ?? null}
                        onSelect={setProfileTab}
                        shortcuts
                      />
                    ) : null}
                  </>
                ),
              }
            : {})}
          trailing={
            <>
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
      </ChromeBoundary>

      {/* Find tries again for the agents it searches, as Godview's does (M192);
          the bar above and the profile notice read only the window's own
          state, so they stay unavailable until the monitor mounts again. */}
      <ChromeBoundary name="Find" retryKey={findAgents}>
        <FindSheet
          open={findOpen}
          agents={findAgents}
          history={door?.history ?? NO_HISTORY}
          onClose={closeFind}
          onSelect={(agent: FindAgent) => {
            commands.select(agent.id);
            setFindOpen(false);
          }}
        />
      </ChromeBoundary>

      <section
        ref={stageRef}
        className={MONITOR_STAGE_CLASS}
        aria-label={
          sources.remote === 0 ? "Agent monitor" : "Agent monitor — local and remote sessions"
        }
      >
        {/* One SDK view reads this window's model, on the host's one frame
            scheduler. Each view owns its styles, effects and resources. */}
        <MonitorViewHost
          replica={viewReplica}
          view={view.view}
          stage={stageGeometry}
          theme={monitorTheme}
          parameters={parameters}
          capabilities={capabilities}
          commands={commands}
          onReport={onReport}
          scheduler={frameScheduler}
          className="vf-monitor-view-slot"
        />
        {emptyUnder !== undefined ? (
          <ChromeBoundary name="Profile">
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
              <span>This tab shows sessions using this profile.</span>
            </div>
          </ChromeBoundary>
        ) : null}
        {/* The chrome slot: the usage column down the stage's left edge (record
            §05), the package's own; the swarm steers around it. */}
        <div ref={chromeRef} className="vf-monitor-chrome">
          <ChromeBoundary name="Usage" retryKey={usageRetryKey}>
            <UsageColumn port={columnUsagePort} />
          </ChromeBoundary>
        </div>
        {/* The claims: VibeField's, on their own strip — also solid to the swarm. */}
        <div ref={claimsRef} className="vf-monitor-claims">
          <ChromeBoundary name="Agent counts" retryKey={claimsRetryKey}>
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
            {remoteClaim(sources, devices) !== null ? (
              <span className="vf-monitor-remote-chip">
                {otherDesktops(devices).map((device) => (
                  <OsMark key={device.id} os={device.os} size={8} />
                ))}
                {remoteClaim(sources, devices)}
              </span>
            ) : null}
            {remoteUnavailableClaim(sources) !== null ? (
              <span
                className="vf-monitor-remote-unavailable-chip"
                title={sources.remoteReason ?? "the mesh could not be asked"}
              >
                {remoteUnavailableClaim(sources)}
              </span>
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
          </ChromeBoundary>
          <span className="vf-monitor-ack" aria-live="polite">
            {acknowledgement?.message ?? ""}
          </span>
        </div>
      </section>
    </>
  );
}
