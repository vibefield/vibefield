import type {
  MonitorCapabilities,
  MonitorTheme,
  StageGeometry,
  ViewReport,
} from "@vibecook/puppeteer-view-sdk";
import {
  frameScheduler,
  keepStage,
  MonitorViewHost,
  viewWantsHistory,
} from "@vibecook/puppeteer-view-sdk/host";
import type { MonitorEndedRow } from "@vibecook/puppeteer-view-sdk/model";
import { ProfileGlyph } from "@vibecook/puppeteer-view-sdk/react";
import {
  type AccountUsagePort,
  BarControl,
  ChromeBoundary,
  type HistoryPort,
  InstrumentBar,
  MONITOR_STAGE_CLASS,
  MONITOR_VIEWS,
  type MonitorParameters,
  UsageColumn,
  useMonitorPalette,
} from "@vibecook/puppeteer-views";
import type { AgentProfileSet } from "@vibefield/contracts";
import {
  memo,
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
import {
  type GodviewFindDoor,
  type LiveFilters,
  type LiveFindAgent,
  publishGodviewFindDoor,
} from "../frame/find-door";
import type { GodviewTheme } from "./GodviewTuningPanel";
import { monitorAgentCounts } from "./monitor/agents";
import { type ChromeRun, NO_RUNS, useChromeKey } from "./monitor/chrome-facts";
import { choiceNote, type DeviceChoice } from "./monitor/device-filter";
import { useMonitorFeed } from "./monitor/GodviewAgentsProvider";
import { setMonitorHoldsKeys } from "./monitor/launcher-keys";
import { useMonitorHistory } from "./monitor/monitor-history";
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

/** What makes Live now's rows the same: every fact the find model reads or
 * the Peek draws — never a token count or an evidence tick (M19). */
function liveRowsKey(rows: readonly LiveFindAgent[]): string {
  return rows
    .map((row) =>
      [
        row.id,
        row.status,
        row.project,
        row.detail,
        row.agent?.provider.id ?? "",
        row.agent?.provider.label ?? "",
        row.agent?.model ?? "",
        row.agent?.branch ?? "",
        row.agent?.account ?? "",
        row.agent?.nativeSessionId ?? "",
        row.agent?.monitor?.statusSince ?? "",
        row.agent?.monitor?.session?.startedAt ?? "",
        row.floorSessionId ?? "",
        row.desk.id,
        row.desk.name,
        row.desk.os,
      ].join("\u0001"),
    )
    .join("\n");
}

/** With no deck there is no daemon to ask: search's Live now says the
 * transcript search is off, and invents no answer. */
const NO_TRANSCRIPTS: HistoryPort = {
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

/** M195 — the bar renders only when one of its own inputs moves. The monitor
 * renders on every model publish (about once a frame while agents work), and
 * every control on the bar is a tip with its own handlers: rendered inline it
 * was rebuilt with each publish, and each view the registry adds (spend) cost
 * one more tip per frame. Its inputs below keep their identity while what they
 * say is the same, so the memo holds. */
const MonitorBar = memo(InstrumentBar);

/** `value`, or the one held while `key` says nothing in it changed: a stable
 * identity for a value the window rebuilds on every publish. */
function useHeldWhileSame<T>(value: T, key: string): T {
  const held = useRef({ key, value });
  if (held.current.key !== key) held.current = { key, value };
  return held.current.value;
}

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
  /** P2 — whether this stage lends the frame's Peek its Live now
   * (`find-door.ts`): the window's own Godview does; a catalog's stages, of
   * which a page mounts several, do not. */
  publishesFind?: boolean;
  /** The catalog's: a profile chosen from the first render (a stage whose
   * search is not the window's has no other way to be filtered). */
  initialProfile?: string | null;
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
  publishesFind = false,
  initialProfile = null,
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

  // AR-S5 — THE PROFILE FILTER (the agents-settings record's T3; GV-D3 moved
  // its tabs into search's Live now, P2). The feed is the one Settings reads,
  // held only while this stage is (PF6). A chosen profile keeps its sessions
  // and recedes every other one. Terminal creation is independent of it: a new
  // terminal's profile is the spawn bloom's to choose (SB-3), never the filter's.
  const [profileSets, setProfileSets] = useState<readonly AgentProfileSet[]>([]);
  /** Whether the feed has answered at all: until it has, the spawn menu's
   * desktop is `reading` — an empty list is an answer, and not the same one. */
  const [profileSetsRead, setProfileSetsRead] = useState(false);
  const [profileTab, setProfileTab] = useState<string | null>(initialProfile);
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
  // default). A desktop that leaves the board falls back to all. It is chosen
  // in search's Live now since P2 (GV-D3), which offers it only when there is
  // a choice to make — two desktops or more.
  const [deviceChoice, setDeviceChoice] = useState<string | null>(null);
  /** P2 — whether the Peek listens for Live now's rows (the find door's
   * `subscribeRows`): the find join is made only while it does. */
  const [findWanted, setFindWanted] = useState(false);
  // MV-3b — THE WINDOW on the replica (`useMonitorAgents`): the backend's rows
  // through this window's one door, joined with the deck's panes, the chosen
  // profile and the chosen desktop; list and rain as SDK views on the window's
  // cut of it (MV-4…MV-6); Live now's rows alone adapt its local chrome facts
  // (M19).
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
    here,
  } = useMonitorAgents({
    palette,
    door,
    ...(panes ? { panes } : {}),
    profiles: profileSets,
    profilesRead: profileSetsRead,
    hasProfiles: profilesPort !== undefined,
    chosenProfile: chosenId,
    device: deviceChoice,
    find: findWanted,
  });
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
  // MV-5 (W5) — what the mounted view says about itself (`commands.report`):
  // what it paints with, where its simulation runs, and whether it holds the
  // keys. Never read off its DOM; the slot clears it when the view changes.
  const [viewReport, setViewReport] = useState<ViewReport>(NO_REPORT);
  /** Read by the Peek's ⌘F at event time (SB-3): a report lands between renders. */
  const viewHoldsKeysRef = useRef(false);
  const onReport = useCallback((report: ViewReport): void => {
    viewHoldsKeysRef.current = report.keysHeld === true;
    setViewReport(report);
  }, []);
  // TL (docket v9; B-D6 (a); TIMELINE SHAPES v2) — the record's past for the
  // mounted view whose manifest declares `history`, the backend's through this
  // window's door, read only while that view is mounted (PF6: this stage
  // unmounts with Godview). An ended lane does exactly what a live row does
  // under each filter (the MV lead's ruling, 2026-10-10): the scope row's
  // desktop NARROWS — lanes elsewhere leave before the past is lent — and the
  // profile tab RECEDES, where a run whose profile is unknown recedes.
  const wantsHistory = viewWantsHistory(view.view);
  const pastReceded = useCallback(
    (lane: MonitorEndedRow): boolean =>
      chosenId !== undefined && !(lane.device.self && lane.profileSet === chosenId),
    [chosenId],
  );
  const history = useMonitorHistory({
    port: door?.pastLanes,
    wants: wantsHistory,
    rows: agents,
    here,
    palette,
    receded: pastReceded,
    desk: deviceChosen,
  });
  const viewCapabilities = useMemo<MonitorCapabilities>(
    () => (history === undefined ? capabilities : { ...capabilities, history }),
    [capabilities, history],
  );
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
  /** A profile chosen with no sessions under it says so over the stage; with
   * no sessions at all the view's own empty state speaks instead. */
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
  // list, the timeline and spend as the stage's `insets.left` and `insets.top` (M58);
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
      const measured: StageGeometry = {
        width: Math.round(stageRect.width),
        height: Math.round(stageRect.height),
        insets: { top: bottom, right: 0, bottom: 0, left: chromeRight },
        obstacles: [rect(chromeRect), ...(claimsRect.height === 0 ? [] : [rect(claimsRect)])],
      };
      // M176 item 1: every tick measures a fresh object; one that measures the
      // same keeps the stage held (the SDK's own rule), so it renders nothing
      setStageGeometry((current) => keepStage(current, measured));
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
  // for the keys: its `report`, MV-D8) the monitor holds them (QL-D2's other
  // half): the deck's launchers stand aside. A HOLD's bloom needs no hold: its
  // ⎋ is the swarm field's own, heard with the focus on the field.
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
      profileTab: chosenId ?? "all",
      shownAgents: shown.length,
      history: history?.state ?? "absent",
      endedLanes: history?.ended.length ?? 0,
      runs,
    });
  }, [
    agents,
    view.id,
    sources,
    swarmPhysics,
    swarmRenderer,
    usageTiles,
    chosenId,
    shown,
    history,
    runs,
  ]);

  // The stage binds no key of its own any more. FC-D18 (ruled 2026-10-01)
  // removed the counters' ⌘1–⌘3 (⌘1–⌘4 are the frame's views, One Frame FR-1);
  // P2 moved ⌘F to the frame's Peek (a product chord, `product-chords.ts`), and
  // docket PK4 (a, 2026-10-09) retired ⌥0–⌥9 with the profile tabs they chose:
  // the profiles are chosen in search's Live now (GV-D3), so ⌥ and every digit
  // reach the pane — a fresh pane's launcher keeps its own ⌥n (QL-D2).

  // P2 — WHAT THE PEEK READS (`find-door.ts`): the live runs this stage shows
  // (its desktop and its profile, GV-D3 — they filter the view and search's
  // Live now alike), rosetta's words through the deck's door, the view's own
  // select (what the find sheet's pick did), the two filters, which the scope
  // row sets, and the stage's two key facts. The rows are computed ONLY while
  // the Peek listens (open on Live now) and handed on only when their content
  // moves (MV's after-MV list: "Find re-renders on every publish"): the door
  // itself is the same object while its filters are, so a closed Peek renders
  // nothing for a model publish.
  const rowListeners = useRef(new Set<() => void>());
  const liveRowsRef = useRef<readonly LiveFindAgent[] | null>(null);
  const shownKey = findWanted ? shown.map((row) => row.id).join("\n") : "";
  const liveRowsNow = useMemo<readonly LiveFindAgent[] | null>(() => {
    if (!findWanted) return null;
    const ids = new Set(shownKey === "" ? [] : shownKey.split("\n"));
    return findAgents.filter((row) => ids.has(row.id));
  }, [findWanted, findAgents, shownKey]);
  const liveRows = useHeldWhileSame(
    liveRowsNow,
    liveRowsNow === null ? "\u0000none" : liveRowsKey(liveRowsNow),
  );
  useEffect(() => {
    liveRowsRef.current = liveRows;
    for (const listener of [...rowListeners.current]) listener();
  }, [liveRows]);
  const readRows = useCallback(() => liveRowsRef.current, []);
  const subscribeRows = useCallback((listener: () => void) => {
    rowListeners.current.add(listener);
    if (rowListeners.current.size === 1) setFindWanted(true);
    return () => {
      rowListeners.current.delete(listener);
      if (rowListeners.current.size === 0) setFindWanted(false);
    };
  }, []);
  // QL-D2: the Peek over the stage holds the keys while it is open, as the
  // find sheet did — its Escape is the Peek's, never a fresh pane's launcher's
  const holdKeys = useCallback(() => {
    setMonitorHoldsKeys(true);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      setMonitorHoldsKeys(false);
    };
  }, []);
  // SB-3: read at event time — a view's report lands between renders
  const readViewHoldsKeys = useCallback(() => viewHoldsKeysRef.current, []);
  const liveFilters = useHeldWhileSame<LiveFilters>(
    {
      desks:
        devices.length > 1
          ? devices.map((device) => ({
              id: device.id,
              name: device.name,
              os: device.os,
              here: device.here,
              note: choiceNote(device),
              quiet: device.state !== "live",
            }))
          : [],
      desk: deviceChosen,
      profiles: showTabs ? tabs : [],
      profile: chosenId ?? null,
    },
    JSON.stringify([devices, deviceChosen, showTabs ? tabs : null, chosenId ?? null]),
  );
  const transcripts = door?.transcripts ?? NO_TRANSCRIPTS;
  const findDoor = useMemo<GodviewFindDoor>(
    () => ({
      rows: readRows,
      subscribeRows,
      transcripts,
      select: (rowId) => commands.select(rowId),
      filters: liveFilters,
      setDesk: setDeviceChoice,
      setProfile: setProfileTab,
      holdKeys,
      viewHoldsKeys: readViewHoldsKeys,
    }),
    [readRows, subscribeRows, transcripts, commands, liveFilters, holdKeys, readViewHoldsKeys],
  );
  useEffect(() => {
    if (!publishesFind) return;
    publishGodviewFindDoor(findDoor);
  }, [publishesFind, findDoor]);
  useEffect(() => {
    if (!publishesFind) return;
    return () => publishGodviewFindDoor(null);
  }, [publishesFind]);

  // M195 — the bar's inputs, each the same object while what it says is the
  // same, so `MonitorBar` renders for a count, the view, the theme or System
  // control — never for a publish that moved none.
  const { idle, working, blocked } = counts;
  const barCounts = useMemo(() => ({ idle, working, blocked }), [idle, working, blocked]);
  const selectView = useCallback((viewId: string) => onSelectView?.(viewId), [onSelectView]);
  const toggleTuning = useCallback(() => onToggleTuning?.(), [onToggleTuning]);
  const barLeading = useMemo(
    () => (
      <>
        {reserveWindowControls ? (
          <span className="vf-godview-native-controls-space" aria-hidden="true" />
        ) : null}
        <span className="vf-godview-header-notice" aria-live="polite">
          {notice ?? ""}
        </span>
      </>
    ),
    [reserveWindowControls, notice],
  );
  // GV-D3 (P2): the desktops and the profiles left the bar's centre for
  // search's scope row, and PK2 (a) took FIND off its end: the frame's search
  // button stands at the head's right end (DESIGN.md §8 "Search — the Peek"),
  // beside System control.
  const barTrailing = useMemo(
    () => (
      <BarControl
        mark="tune"
        label="SYSTEM CONTROL"
        ariaLabel="System control"
        controls="vf-godview-tweak-panel"
        on={tuningOpen}
        onClick={toggleTuning}
      />
    ),
    [tuningOpen, toggleTuning],
  );

  return (
    <>
      <ChromeBoundary name="Monitor controls">
        <MonitorBar
          counts={barCounts}
          onSelectStatus={noStatusCycle}
          views={MONITOR_VIEWS}
          viewId={view.id}
          onSelectView={selectView}
          theme={theme}
          onThemeChange={noThemeSwitch}
          leading={barLeading}
          trailing={barTrailing}
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
          capabilities={viewCapabilities}
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
              <span>
                Only this profile's sessions show — the search button's × shows them all again.
              </span>
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
