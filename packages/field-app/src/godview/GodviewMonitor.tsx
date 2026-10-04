import {
  type AccountUsagePort,
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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { emitGodviewMonitorMarker, type GodviewMonitorRunFacts } from "../development-console";
import { DeviceFilterChip } from "./DeviceFilterChip";
import type { GodviewTheme } from "./GodviewTuningPanel";
import { managedRowId, monitorAgentCounts } from "./monitor/agents";
import { type DeviceChoice, filterByDevice, standingChoice } from "./monitor/device-filter";
import type { AgentSessionSummary } from "./monitor/facet-types";
import { useAgentFold } from "./monitor/GodviewAgentsProvider";
import {
  bloomOwnsKeyEvent,
  launcherOwnsKeyEvent,
  setMonitorHoldsKeys,
} from "./monitor/launcher-keys";
import { instrumentedMonitorView } from "./monitor/perf/instrumented-view";
import {
  chosenProfile,
  personaProfiles,
  profileTabs,
  recedeOutside,
  showsProfileTabs,
  withProfileSets,
} from "./monitor/profile-tabs";
import type { MonitorDoor, MonitorFeedState } from "./monitor/remote-door";
import { spawnMenuOf } from "./monitor/spawn-menu";
import type { AgentMonitorView, MonitorAgent, MonitorSpawnMenu } from "./monitor/types";
import {
  type MonitorPaneFacts,
  type MonitorSourceCounts,
  useMonitorAgents,
} from "./monitor/useMonitorAgents";
import { OsMark } from "./os-marks";
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

/** The counters select nothing any more (FC-D18): the bar still asks for an
 * answer, and its group is hidden (godview.css) until the views package draws
 * counters only for a host that passes counts. */
const noStatusCycle = (): void => undefined;

/** Godview follows the app's theme (FC-D7): the bar's ☼◐ switch changes
 * nothing. The views package draws it whatever a host passes, so it is hidden
 * (godview.css) until the package draws it only for a host that hands it a
 * handler — the ask on record, beside the counters'. */
const noThemeSwitch = (): void => undefined;

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

  const { agents, actions, sources, acknowledgement, clearAcknowledgement, devices, history } =
    useMonitorAgents({
      palette,
      door,
      ...(panes ? { panes } : {}),
      profiles: profileSets,
    });
  // DS-3 — THE DEVICE FILTER: one desktop's rows, or every desktop's (the
  // default). A desktop that leaves the board falls back to all. The chip is
  // drawn only when there is a choice to make — two desktops or more — and
  // while its menu is open the stage holds the keys (QL-D2, as the find sheet
  // does), so a launcher in the focused pane never takes its ⎋.
  const [deviceChoice, setDeviceChoice] = useState<string | null>(null);
  const deviceChosen = standingChoice(devices, deviceChoice);
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
  useEffect(() => {
    setUsageState({ state: usagePort === undefined ? "no-door" : "loading" });
    return usagePort?.subscribeState?.(setUsageState);
  }, [usagePort]);
  const claimsRef = useRef<HTMLDivElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  // QL-D2's other half: while the find sheet is up, its Escape is the sheet's,
  // not a fresh pane's launcher's (`launcher-keys.ts`).
  useEffect(() => {
    if (!findOpen) return;
    setMonitorHoldsKeys(true);
    return () => setMonitorHoldsKeys(false);
  }, [findOpen]);
  /** What the swarm is painting with, read off its own element (AR-5). */
  const [swarmRenderer, setSwarmRenderer] = useState("none");
  /** The usage column's tiles, counted off the chrome slot (AR-5); -1 unmounted. */
  const [usageTiles, setUsageTiles] = useState(-1);
  const personas = useMemo(() => personaProfiles(profileSets), [profileSets]);
  const chosenId = chosen?.id;
  /** SB-3 — every row says the profile it runs under (`profileSet`), the set
   * the tabs compute: the spawn bloom lights the rows under what it points at. */
  const rows = useMemo(() => withProfileSets(agents, personas), [agents, personas]);
  /** DS-3 — the chosen desktop's rows (all of them by default): the device
   * filter NARROWS what the swarm and the list are handed. */
  const placed = useMemo(() => filterByDevice(rows, deviceChosen), [rows, deviceChosen]);
  /** The rows as the stage draws them: every one, the chosen profile's as
   * they are and the rest receded — still in the physics, in their places. */
  const staged = useMemo(
    () => recedeOutside(placed, chosenId, personas),
    [placed, chosenId, personas],
  );
  const shown = useMemo(
    () => (chosenId === undefined ? placed : staged.filter((agent) => agent.receded !== true)),
    [placed, chosenId, staged],
  );
  /** TL — the record, its ended lanes narrowed exactly as the live rows are:
   * an ended run on another desktop, or under another profile, is drawn (or
   * receded) by the same rule as a live one. */
  const stagedHistory = useMemo(
    () => ({
      ...history,
      ended: recedeOutside(
        filterByDevice(withProfileSets(history.ended, personas), deviceChosen),
        chosenId,
        personas,
      ),
    }),
    [history, personas, deviceChosen, chosenId],
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
    () => profileTabs(profileSets, rows, personas),
    [profileSets, rows, personas],
  );
  /** SB-3 — what a new terminal can be born under, for the spawn bloom (and
   * the list's menu): this desktop and its Agent Profiles (SB-D9). A host with
   * no feed offers no menu, and a hold creates at once, as before. Handed on as
   * the SAME object until what it says changes. */
  const nextSpawnMenu =
    profilesPort === undefined
      ? undefined
      : spawnMenuOf(profileSetsRead ? profileSets : null, tabs);
  const spawnMenuKey = nextSpawnMenu === undefined ? "" : JSON.stringify(nextSpawnMenu);
  const spawnMenuRef = useRef<{ key: string; menu: MonitorSpawnMenu | undefined }>({
    key: "",
    menu: undefined,
  });
  if (spawnMenuRef.current.key !== spawnMenuKey) {
    spawnMenuRef.current = { key: spawnMenuKey, menu: nextSpawnMenu };
  }
  const spawnMenu = spawnMenuRef.current.menu;
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

  // SB-3 — while the spawn bloom is open the monitor holds the keys, as it does
  // while the find sheet is up (QL-D2's other half): the deck's launchers stand
  // aside, so a HOLD bloom's ⎋ — the swarm's own window listener, which does not
  // move the focus — is never first taken by a launcher in the focused pane.
  // Read off the bloom's own DOM (`data-bloom-state`), observed like the renderer.
  const [bloomOpen, setBloomOpen] = useState(false);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof MutationObserver === "undefined") return;
    const read = (): void => {
      setBloomOpen(stage.querySelector('.vf-bloom[data-bloom-state="open"]') !== null);
    };
    const observer = new MutationObserver(read);
    observer.observe(stage, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-bloom-state"],
    });
    read();
    return () => observer.disconnect();
  }, [view.id]);
  useEffect(() => {
    if (!bloomOpen) return;
    setMonitorHoldsKeys(true);
    return () => setMonitorHoldsKeys(false);
  }, [bloomOpen]);

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
      runs,
    });
  }, [agents, view.id, sources, swarmRenderer, usageTiles, findOpen, chosenId, shown, runs]);

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
      // SB-3: a spawn bloom that has the keyboard holds every key
      if (bloomOwnsKeyEvent(event)) return;
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
      // SB-3: nor does it take ⌥-digits from a spawn bloom that has the keyboard
      if (bloomOwnsKeyEvent(event)) return;
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

  // MV-0 — the view's own component, or the lab's counting wrapper around it
  // while a perf probe is installed (`monitor/perf/instrumented-view.tsx`)
  const MonitorView = instrumentedMonitorView(view);
  return (
    <>
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
            history={stagedHistory}
            {...(spawnMenu !== undefined ? { spawnMenu } : {})}
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
            <span>This tab shows sessions using this profile.</span>
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
          <span className="vf-monitor-ack" aria-live="polite">
            {acknowledgement?.message ?? ""}
          </span>
        </div>
      </section>
    </>
  );
}
