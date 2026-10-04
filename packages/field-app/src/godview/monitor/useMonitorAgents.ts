import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import type { AgentMonitorState } from "@vibecook/puppeteer-core";
import type { MonitorCapabilities, MonitorViewInput } from "@vibecook/puppeteer-view-sdk";
import {
  type LegacyMonitorView,
  legacyView,
  type MonitorReplicaLike,
  type ViewSlotCommands,
} from "@vibecook/puppeteer-view-sdk/host";
import type {
  AgentView,
  ModelChanges,
  MonitorAgentRow,
  MonitorModel,
} from "@vibecook/puppeteer-view-sdk/model";
import { projectColourFor } from "@vibecook/puppeteer-view-sdk/toolkit";
import {
  type AgentMonitorProps,
  type AgentMonitorView,
  EMPTY_STATUS_LEDGER,
  endStatusLane,
  type MonitorHistoryBook,
  type MonitorPalette,
  type MonitorParameters,
  observeStatuses,
  type ProfileTab,
  type StatusLedger,
  SwarmPhysicsProvider,
  seedStatusHistory,
  statusHistoryBook,
  type MonitorAgent as ViewsMonitorAgent,
} from "@vibecook/puppeteer-views";
import { toMonitorAgent } from "@vibecook/puppeteer-views/legacy";
import type { AgentProfileSet } from "@vibefield/contracts";
import {
  type ComponentType,
  createElement,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createSwarmPhysicsDriver } from "../views/swarm/swarm-physics-driver";
import type { MonitorFloorRecord } from "./agents";
import { type DeviceChoice, standingChoice } from "./device-filter";
import { deviceFacet, useDeviceRoster } from "./devices";
import { useAgentFold, useMonitorFeed } from "./GodviewAgentsProvider";
import type { HeldModelRow } from "./model-board";
import type { GodviewMonitorFeed, MonitorFeedState } from "./model-replica";
import { instrumentedMonitorView } from "./perf/instrumented-view";
import { profileTabs, recedeOutside } from "./profile-tabs";
import type { LocalMountOutcome, MonitorDoor } from "./remote-door";
import { spawnMenuOf, targetsHere } from "./spawn-menu";
import type { MonitorActions, MonitorAgent, MonitorSpawnMenu, MonitorSpawnTarget } from "./types";
import {
  type BoardJoins,
  boardJoins,
  boardJoinsKey,
  paneFactsKey,
  windowLocal,
} from "./window-local";
import {
  createWindowRows,
  deviceOfRow,
  narrowToDevice,
  rowOrder,
  VIBEFIELD_SHIM,
  type WindowRowFacts,
} from "./window-rows";

/**
 * THE WINDOW (MV-3b; MV-D18, MV-D22). What is left of the seam once the
 * backend computes every business fact beside the runtime (`design-mv.md` §1):
 *
 *   · THE REPLICA — the window's copy of the backend's model, fed by
 *     `GodviewAgentsProvider` through the door's model port (`model-replica.ts`,
 *     one subscription per window, PF6). The views draw it through the view
 *     host's legacy bridge (L6, L9): the shim's rows in VibeField's words
 *     (`window-rows.ts`), one update per frame.
 *   · THE LOCAL JOIN — what only this window knows, handed to the replica
 *     (`setLocal`): its panes and the colour each wears, the pane the person is
 *     working in, the row they pointed at, where they asked terminals to be
 *     born, what each pane's terminal is doing (M28), which rows the chosen
 *     profile tab recedes, and which rows this window shows at all (M3: the
 *     live ones, and none whose pane has exited).
 *   · THE VERBS — every one through the DOOR the deck built (`MonitorDoor`): a
 *     local row's select mounts its PTY in the active pane, a peer's attaches
 *     its terminal there, create opens an empty terminal — and every outcome is
 *     said out loud, in fieldd's own words. The views still see actions; the
 *     window sees promises.
 *   · THE SCREEN — what the active pane shows, reported to the backend
 *     (`reportShown`, L5), which keeps the unread marks.
 *   · THE STATUS LEDGER (L10) — fed through the shim until MV-6, exactly as the
 *     seam fed it, with fieldd's history laid under it once the board is live.
 *
 * What left: the fold's assembly (`agents.ts`), the usage and unread ledgers and
 * the project colours (the backend's, L4/L5/L11), the mesh board's second reader
 * (`mesh-field.ts`; the one door carries peers), and the localStorage caches.
 */

export interface UseMonitorAgentsOptions {
  /** §2.6's accents, live from the tokens: the replica's theme colour (L7). */
  palette: MonitorPalette;
  /** The deck's verbs (GT-D17, AR-3) and its model port. Null before a deck
   * exists — this host has no terminal bridge, or the overlay has not built one
   * yet — and the stage is then empty, honestly and without placeholders. */
  door?: MonitorDoor | null;
  /** The sessions the deck's panes are showing, and the one the user is in.
   * Facts, published by the deck; the monitor reads them and drives nothing. */
  panes?: MonitorPaneFacts;
  /** AR-S5 — the Agent Profiles as the stage's feed last had them: the tabs,
   * the spawn menu, and what the acknowledgements call a birth's profile
   * ("opened under Work"). Empty while there is no feed. */
  profiles?: readonly AgentProfileSet[];
  /** Whether the profiles feed has answered at all: until it has, the spawn
   * menu's desktop is `reading` — an empty list is an answer, and not the same one. */
  profilesRead?: boolean;
  /** Whether the door has a profiles feed at all: a host with none offers no
   * menu, and a hold creates at once, as before (SB-3). */
  hasProfiles?: boolean;
  /** AR-S5 — the chosen profile tab's set id; every other row of this desktop
   * recedes (it keeps its place). Undefined: All. */
  chosenProfile?: string | undefined;
  /** DS-3 — the chosen desktop's id, as the chip holds it; null is every
   * desktop, and a desktop that left the board falls back to all. */
  device?: string | null;
}

export interface MonitorPaneFacts {
  terminalVisualIds?: ReadonlyMap<string, string>;
  sessionIds: readonly string[];
  activeSessionId?: string;
  /** The panes themselves, parallel to `sessionIds` (AR-5): a pane owns a
   * colour, and the session wears it while mounted there (record §02). */
  paneIds?: readonly string[];
  /** Dealt once by the deck; the same colours its terminal frames wear. */
  paneColors?: ReadonlyMap<string, string>;
  activePaneId?: string;
  /** The floor summaries of those panes' sessions (ghosttea's, as the deck
   * holds them): what tells the window a pane has EXITED (its row is hidden)
   * and what each pane's terminal is doing (M28). */
  sessions?: readonly SessionSummary[];
  /** GT-6b — the UI roster the deck last read (`terminal.roster`, TP-D4). The
   * backend lists the floor's PTYs itself now; the window reads this only for
   * the ORDER the floor's terminals are drawn in. */
  floor?: readonly MonitorFloorRecord[];
  /** SB-3 — which shells were born under which Agent Profile. The backend reads
   * fieldd's bindings record itself; kept on the deck's facts for the catalog's
   * fixtures, read by nothing here. */
  profileSets?: ReadonlyMap<string, string>;
}

export interface MonitorAgentsResult {
  /** The window's replica, for the view host; an empty one while there is no feed. */
  replica: MonitorReplicaLike;
  /** The model as the replica last published it. */
  model: MonitorModel;
  /** A view through the legacy bridge (L6): the same bridge for the same view
   * while its component stands (a perf probe installed or removed rebuilds it). */
  viewFor(view: AgentMonitorView): LegacyMonitorView;
  /** The view host's commands: select and create route to this window's door. */
  commands: ViewSlotCommands;
  /** What the backend lends a view beyond the model (MV-D4): today's spawn menu. */
  capabilities: MonitorCapabilities;
  /** Every row the window holds, as the views read it (no device filter): the
   * claims count these, the tabs light their dots from them. */
  agents: readonly MonitorAgent[];
  /** The rows the stage shows: the chosen desktop's, the chosen profile's unreceded. */
  shown: readonly MonitorAgent[];
  /** The rows the find sheet reads: the window's rows joined with the fold's
   * native session ids and mirrors (the chrome's own reader, M19). */
  findAgents: readonly MonitorAgent[];
  /** The run behind each of this desktop's agent rows (`BoardJoins.runByRow`):
   * the marker's join, observed or not (the shim omits the mirror until the
   * runtime has spoken, so a row's run is never read off it). */
  runByRow: ReadonlyMap<string, string>;
  actions: MonitorActions;
  /** How many rows each source contributed, so the stage can scope its claims
   * to the right ones (GT-D17) rather than labeling the whole field. */
  sources: MonitorSourceCounts;
  /** What the last verb answered, for the stage to say out loud. Cleared by
   * the stage; carried here because the actions are what produce it. */
  acknowledgement: MonitorAcknowledgement | null;
  clearAcknowledgement(): void;
  /** DS-3 — every desktop on the board, this one first, each with its
   * standing and how many agents it runs: the device filter's choices. */
  devices: readonly DeviceChoice[];
  /** DS-3 — the chosen desktop as the board still has it (null = all). */
  deviceChosen: string | null;
  /** AR-S5 — the tabs, in the feed's order, each with its orange dot. */
  tabs: readonly ProfileTab[];
  /** SB-3 — what a new terminal can be born under; undefined without a feed. */
  spawnMenu: MonitorSpawnMenu | undefined;
  /** The model board's honest state (`no-door` · `connecting` · `live` · `unavailable`). */
  feed: MonitorFeedState;
}

/** The package's book with this host's rows: every row the ledger holds came
 * from this hook's own rows, so `ended` is Godview's `MonitorAgent`. */
export interface GodviewHistoryBook extends MonitorHistoryBook {
  readonly ended: readonly MonitorAgent[];
}

/** The local half's honest state, in the marker's words (`GodviewMonitorFacts.localState`). */
export type LocalFieldState = "no-door" | "live" | "unavailable";
/** The mesh half's honest state, in the marker's words (`GodviewMonitorFacts.remoteState`). */
export type MeshFieldState = "no-door" | "serving" | "unavailable";

export interface MonitorSourceCounts {
  /** Managed sessions this desktop contributed. */
  local: number;
  /** This desktop's bare terminals. */
  terminals: number;
  /** Other desktops' runs the board contributed (DS-3). */
  remote: number;
  /** The other desktops behind those rows. */
  hosts: number;
  /** The board's honest state for this desktop's rows — `unavailable` carries fieldd's own reason. */
  localState: LocalFieldState;
  localReason?: string;
  /** The board's honest state for the other desktops' rows — the same board, the mesh's words. */
  remoteState: MeshFieldState;
  remoteReason?: string;
}

export interface MonitorAcknowledgement {
  /** Bumped per event so a repeat of the same gesture still reads as one. */
  nonce: number;
  message: string;
}

/** SB-3 — a create in flight: where it was asked for (as given, unrounded), the
 * terminal rows that stood when it started, and the row that has taken its position. */
interface PendingSpawn {
  readonly position: { x: number; y: number };
  readonly known: ReadonlySet<string>;
  claimed?: string;
}

const NO_PANES: MonitorPaneFacts = { sessionIds: [] };
const NO_PROFILES: readonly AgentProfileSet[] = [];
const NO_IDS: readonly string[] = Object.freeze([]);
const NO_HELD: readonly HeldModelRow[] = Object.freeze([]);
const NO_CHANGES: ModelChanges = Object.freeze({ added: NO_IDS, updated: NO_IDS, removed: NO_IDS });
const EMPTY_MODEL: MonitorModel = Object.freeze({
  revision: 0,
  agents: Object.freeze([]),
  byId: new Map<string, AgentView>(),
});
const EMPTY_SNAPSHOT = Object.freeze({ model: EMPTY_MODEL, changes: NO_CHANGES });
/** The replica a stage with no feed draws: nothing, and never a frame of invented rows. */
const EMPTY_REPLICA: MonitorReplicaLike = Object.freeze({
  getSnapshot: () => EMPTY_SNAPSHOT,
  subscribe: () => () => undefined,
});

/** AR-4b — how many times a replacement's hand-over is retried before the
 * row is left as it is and the last reason stands. */
const REMOUNT_ATTEMPTS = 3;

/** The replica's theme key (L7): the same tint and ramp are the same colours. */
function themeKey(tint: { l: number; c: number }, neutral: string): string {
  return `${tint.l}:${tint.c}:${neutral}`;
}

interface FeedFacts {
  state: MonitorFeedState;
  devices: ReturnType<GodviewMonitorFeed["devices"]>;
  here: string | undefined;
}

const NO_FEED: FeedFacts = { state: { state: "no-door" }, devices: [], here: undefined };

function readFeed(feed: GodviewMonitorFeed | null): FeedFacts {
  if (feed === null) return NO_FEED;
  return { state: feed.state(), devices: feed.devices(), here: feed.here() };
}

/** The board's state in the claims' two vocabularies (the marker's words). */
function localStateOf(
  state: MonitorFeedState,
): Pick<MonitorSourceCounts, "localState" | "localReason"> {
  if (state.state === "live") return { localState: "live" };
  if (state.state === "unavailable")
    return { localState: "unavailable", localReason: state.reason };
  return { localState: "no-door" };
}

function remoteStateOf(
  state: MonitorFeedState,
): Pick<MonitorSourceCounts, "remoteState" | "remoteReason"> {
  if (state.state === "live") return { remoteState: "serving" };
  if (state.state === "unavailable")
    return { remoteState: "unavailable", remoteReason: state.reason };
  return { remoteState: "no-door" };
}

/** The views' rows for a model, narrowed to the chosen desktop: one list per
 * (rows, device), so the bridge's rows keep their identity between frames. */
function createNarrowing(): (
  rows: readonly ViewsMonitorAgent[],
  device: string | null,
  here: string | undefined,
) => readonly ViewsMonitorAgent[] {
  let lastRows: readonly ViewsMonitorAgent[] | undefined;
  let lastDevice: string | null = null;
  let lastHere: string | undefined;
  let last: readonly ViewsMonitorAgent[] = Object.freeze([]);
  return (rows, device, here) => {
    if (rows === lastRows && device === lastDevice && here === lastHere) return last;
    last = narrowToDevice(rows, device, here);
    lastRows = rows;
    lastDevice = device;
    lastHere = here;
    return last;
  };
}

/** The swarm's physics lives in OUR worker (GT-D16); the package's view is
 * handed the driver through its context and never learns which. The bridge
 * re-provides it above the old view (L6: `wrap`). */
function wrapWithPhysics(view: ReactElement): ReactElement {
  return createElement(SwarmPhysicsProvider, { factory: createSwarmPhysicsDriver }, view);
}

export function useMonitorAgents({
  palette,
  door = null,
  panes = NO_PANES,
  profiles = NO_PROFILES,
  profilesRead = false,
  hasProfiles = false,
  chosenProfile,
  device = null,
}: UseMonitorAgentsOptions): MonitorAgentsResult {
  // ── the replica and the board's own facts ────────────────────────────────
  const feed = useMonitorFeed();
  const replica: MonitorReplicaLike = feed?.replica ?? EMPTY_REPLICA;
  const model = useSyncExternalStore(
    replica.subscribe,
    replica.getSnapshot,
    replica.getSnapshot,
  ).model;
  const [feedFacts, setFeedFacts] = useState<FeedFacts>(() => readFeed(feed));
  useEffect(() => {
    setFeedFacts(readFeed(feed));
    if (feed === null) return;
    return feed.subscribe(() => setFeedFacts(readFeed(feed)));
  }, [feed]);
  const roster = useDeviceRoster(door?.devices);
  /** Which desktop is HERE: the roster's own row when it has answered, else the board's first. */
  const here = roster.here ?? feedFacts.here;

  // L7 — the theme's colour function, set the moment the feed exists: the
  // backend deals each project a sequence, the replica joins the hue.
  const tintL = palette.tint.l;
  const tintC = palette.tint.c;
  const neutral = palette.neutral;
  useLayoutEffect(() => {
    if (feed === null) return;
    const tint = { l: tintL, c: tintC };
    feed.replica.setTheme({
      key: themeKey(tint, neutral),
      colourFor: projectColourFor({ tint, neutral }),
    });
  }, [feed, tintL, tintC, neutral]);

  // ── the window's joins, off the fold's board rows ────────────────────────
  // Read per render: the fold is updated by the frames that make the replica
  // publish, so a render the replica caused finds the joins at least as new as
  // its model. Memoized on what the joins are made of.
  const held = feed?.heldRows() ?? NO_HELD;
  const joinsKey = boardJoinsKey(held, here);
  const joins = useMemo<BoardJoins>(
    () => boardJoins(held, here),
    // the key stands for the held rows and `here`
    [joinsKey],
  );

  // ── the rows as the views read them ──────────────────────────────────────
  const windowRows = useMemo(createWindowRows, []);
  const standingKey = feedFacts.devices.map((entry) => `${entry.device}:${entry.state}`).join("\n");
  const orderKey = rowOrder(held, here, panes).join("\n");
  const visualKey = [...(panes.terminalVisualIds ?? [])].map(([a, b]) => `${a}:${b}`).join("\n");
  const rowFacts = useMemo<WindowRowFacts>(
    () => ({
      standing: new Map(feedFacts.devices.map((entry) => [entry.device, entry.state] as const)),
      order: orderKey === "" ? NO_IDS : orderKey.split("\n"),
      sessionByRow: joins.sessionByRow,
      visualIds: panes.terminalVisualIds,
    }),
    // keyed by the facts, never by the arrays the deck and the feed republish
    [standingKey, orderKey, joins, visualKey],
  );
  /** Every row, in the stage's order, patched for this window (no device filter). */
  const agents = windowRows.rowsFor(model, rowFacts);
  const rowFactsRef = useRef(rowFacts);
  rowFactsRef.current = rowFacts;

  // DS-3 — the device filter's choices and the choice as the board still has it
  const devices = useMemo<readonly DeviceChoice[]>(() => {
    const counts = new Map<string, number>();
    for (const row of agents) {
      if (row.agent === undefined) continue;
      const id = deviceOfRow(row, here);
      if (id === undefined) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const choices: DeviceChoice[] = [];
    for (const entry of feedFacts.devices) {
      const choice: DeviceChoice = {
        ...deviceFacet(entry.device, roster.byId, here),
        state: entry.state,
        agents: counts.get(entry.device) ?? 0,
      };
      if (choice.here) choices.unshift(choice);
      else choices.push(choice);
    }
    return choices;
  }, [agents, feedFacts.devices, roster.byId, here]);
  const deviceChosen = standingChoice(devices, device);
  const narrow = useMemo(createNarrowing, []);
  const placed = narrow(agents, deviceChosen, here);
  const shown = useMemo(
    () => (chosenProfile === undefined ? placed : placed.filter((row) => row.receded !== true)),
    [placed, chosenProfile],
  );

  // AR-S5 — the tabs and the spawn menu (SB-3), from the profiles feed and the rows
  const tabs = useMemo(() => profileTabs(profiles, agents), [profiles, agents]);
  const nextSpawnMenu = hasProfiles ? spawnMenuOf(profilesRead ? profiles : null, tabs) : undefined;
  const spawnMenuKey = nextSpawnMenu === undefined ? "" : JSON.stringify(nextSpawnMenu);
  const spawnMenuRef = useRef<{ key: string; menu: MonitorSpawnMenu | undefined }>({
    key: "",
    menu: undefined,
  });
  if (spawnMenuRef.current.key !== spawnMenuKey) {
    spawnMenuRef.current = { key: spawnMenuKey, menu: nextSpawnMenu };
  }
  const spawnMenu = spawnMenuRef.current.menu;
  const capabilities = useMemo<MonitorCapabilities>(
    () => (spawnMenu === undefined ? {} : { spawn: spawnMenu }),
    [spawnMenu],
  );

  // ── the window's own facts for the replica's join ────────────────────────
  /** Which row the user last pointed at — a preview highlight for a row no
   * pane is showing yet. Cleared when the row lands in a pane. */
  const [selectedId, setSelectedId] = useState<string>();
  /** SB-3 — where each born terminal was asked for, by the FLOOR SESSION the
   * door's answer named; a claim (`hintFor`) stands in until the answer. */
  const [spawnHints, setSpawnHints] = useState<ReadonlyMap<string, { x: number; y: number }>>(
    () => new Map(),
  );
  /** DS-4 — a peer row's local replica, by ROW id, from the attach that put it there. */
  const [links, setLinks] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [acknowledgement, setAcknowledgement] = useState<MonitorAcknowledgement | null>(null);

  // SB-3 — a new terminal's spawn hint, from its row's FIRST appearance. The
  // views' physics reads a row's `spawnHint` only when it CREATES the body, and
  // the new shell's row can reach the stage before the door answers — a hint
  // stamped only on the answer came too late. So while a create is in flight,
  // the first NEW terminal row seen after it started (one no row stood for then)
  // takes its position; the door's answer stamps the session it names, which
  // corrects a claim that was another's.
  const pendingSpawns = useRef<PendingSpawn[]>([]);
  const [spawnsVersion, setSpawnsVersion] = useState(0);
  const knownTerminals = useRef<ReadonlySet<string>>(new Set());
  knownTerminals.current = new Set([
    ...panes.sessionIds,
    ...(panes.floor ?? []).map((row) => row.sessionId),
    ...joins.terminalRows.map((id) => joins.sessionByRow.get(id) ?? id),
  ]);
  const hintFor = (sessionId: string): { x: number; y: number } | undefined => {
    const answered = spawnHints.get(sessionId);
    if (answered !== undefined) return answered;
    const spawns = pendingSpawns.current;
    const claim = spawns.find((spawn) => spawn.claimed === sessionId);
    if (claim !== undefined) return claim.position;
    const open = spawns.find((spawn) => spawn.claimed === undefined);
    if (open === undefined || open.known.has(sessionId)) return undefined;
    open.claimed = sessionId;
    return open.position;
  };
  const terminalSessionsKey = joins.terminalRows
    .map((id) => joins.sessionByRow.get(id) ?? id)
    .join("\n");
  const hints = useMemo(() => {
    const result = new Map<string, { x: number; y: number }>(spawnHints);
    for (const session of terminalSessionsKey === "" ? [] : terminalSessionsKey.split("\n")) {
      if (result.has(session)) continue;
      const hint = hintFor(session);
      if (hint !== undefined) result.set(session, hint);
    }
    return result;
    // the claims' own clock rides along: `hintFor` reads the claims it versions
  }, [spawnHints, terminalSessionsKey, spawnsVersion]);

  // The exited panes: a dead pane is the deck's face to draw, not a row — and a
  // managed agent whose pane exited is dropped with it, as the seam dropped it.
  const exitedKey = (panes.sessions ?? [])
    .filter((session) => session.exited)
    .map((session) => joins.rowBySession.get(session.id) ?? session.id)
    .sort()
    .join("\n");
  const visible = useMemo(() => {
    const exited = new Set(exitedKey === "" ? [] : exitedKey.split("\n"));
    return (row: MonitorAgentRow): boolean => row.alive && !exited.has(row.id);
  }, [exitedKey]);
  const receded = useMemo(
    () =>
      chosenProfile === undefined
        ? undefined
        : (row: MonitorAgentRow): boolean => !(row.device.self && row.profileSet === chosenProfile),
    [chosenProfile],
  );
  const kindOf = useCallback(
    (id: string): MonitorAgentRow["kind"] | undefined =>
      model.byId.get(id)?.kind ?? feed?.held(id)?.row.kind,
    [model, feed],
  );
  const panesKey = paneFactsKey(panes);
  const local = useMemo(
    () =>
      windowLocal({
        joins,
        kindOf,
        panes,
        links,
        previewSelectedId: selectedId,
        spawnHints: hints,
        receded,
        visible,
      }),
    // keyed by the pane facts the join reads, not by the array the deck republishes
    [joins, kindOf, panesKey, links, selectedId, hints, receded, visible],
  );
  useLayoutEffect(() => {
    feed?.replica.setLocal(local);
  }, [feed, local]);
  // L5 — a screen's shown rows are whatever its active pane shows (and the row
  // the person pointed at); the backend clears their marks.
  const shownKey = [...local.activeIds].sort().join("\n");
  useEffect(() => {
    feed?.reportShown(shownKey === "" ? [] : shownKey.split("\n"));
  }, [feed, shownKey]);

  // ── the status ledger (L10, TL-D8), fed through the shim until MV-6 ──────
  const statusRef = useRef<StatusLedger>(EMPTY_STATUS_LEDGER);
  /** Lane → when fieldd says the run exited, for the runs its ledger answered. */
  const exitsRef = useRef<ReadonlyMap<string, number>>(new Map());
  const historyRef = useRef<GodviewHistoryBook>(
    statusHistoryBook(EMPTY_STATUS_LEDGER) as GodviewHistoryBook,
  );
  const [historySeed, setHistorySeed] = useState(0);
  const colourFor = useMemo(
    () => projectColourFor({ tint: { l: tintL, c: tintC }, neutral }),
    [tintL, tintC, neutral],
  );
  /** TL-D6 — an ended run's last row, for the timeline's faint lane: the hidden
   * model row through the shim, coloured as its project was. */
  const endedRowOf = useCallback(
    (row: MonitorAgentRow): MonitorAgent =>
      toMonitorAgent(
        {
          ...row,
          colour: colourFor(row.project.seq),
          active: false,
          receded: false,
        },
        VIBEFIELD_SHIM,
      ),
    [colourFor],
  );
  /** A run fieldd says ended, still on the board but no longer drawn, keeps
   * its lane faint (TL-D6): named from its row, ended where fieldd saw it end. */
  const withEndedLanes = useCallback(
    (status: StatusLedger, current: MonitorModel): StatusLedger => {
      if (feed === null) return status;
      let next = status;
      for (const entry of feed.heldRows()) {
        if (current.byId.has(entry.row.id)) continue;
        const endedAtMs = exitsRef.current.get(entry.row.id);
        if (endedAtMs === undefined || !next.lanes.has(entry.row.id)) continue;
        next = endStatusLane(next, endedRowOf(entry.row), endedAtMs);
      }
      return next;
    },
    [feed, endedRowOf],
  );
  const foldLedger = useCallback(
    (current: MonitorModel): void => {
      const nowMs = Date.now();
      const rows = windowRows.rowsFor(current, rowFactsRef.current);
      const status = withEndedLanes(observeStatuses(statusRef.current, rows, nowMs), current);
      statusRef.current = status;
      historyRef.current = statusHistoryBook(status) as GodviewHistoryBook;
    },
    [windowRows, withEndedLanes],
  );
  useEffect(() => {
    if (feed === null) return;
    // folded once per published model, before the view host's update in the
    // same frame reads it (the slot's listener was subscribed first and defers
    // to the frame; this one runs in the publication)
    return feed.replica.subscribe(() => foldLedger(feed.replica.getSnapshot().model));
  }, [feed, foldLedger]);
  // fieldd's ledger, laid under what the window watched — asked once the board
  // is live, which is when Godview opens and again after fieldd comes back. A
  // fieldd from before the door refuses, and the record is then what this
  // window watched. Lanes are keyed by the ROW the run was dealt (M22: a
  // promoted shell's run carries the shell's id); a run no longer on the board
  // keeps its run id, which nothing joins.
  const statusPort = door?.statusHistory;
  const boardLive = feedFacts.state.state === "live";
  const joinsRef = useRef(joins);
  joinsRef.current = joins;
  useEffect(() => {
    if (statusPort === undefined || !boardLive) return;
    let alive = true;
    void statusPort
      .load()
      .then((runs) => {
        if (!alive) return;
        const nowMs = Date.now();
        const exits = new Map(exitsRef.current);
        let ledger = statusRef.current;
        for (const run of runs) {
          const recordedFromMs = Date.parse(run.recordedFrom);
          if (!Number.isFinite(recordedFromMs)) continue;
          const endedAtMs = run.exitedAt === undefined ? Number.NaN : Date.parse(run.exitedAt);
          const laneId = joinsRef.current.rowByRun.get(run.runtimeRunId) ?? run.runtimeRunId;
          ledger = seedStatusHistory(
            ledger,
            laneId,
            {
              recordedFromMs,
              changes: run.changes.map((change) => ({
                status: change.status,
                atMs: Date.parse(change.at),
                ...(change.blocker ? { blocker: change.blocker } : {}),
                ...(change.did ? { did: change.did } : {}),
              })),
              ...(Number.isFinite(endedAtMs) ? { endedAtMs } : {}),
            },
            nowMs,
          );
          if (Number.isFinite(endedAtMs)) exits.set(laneId, endedAtMs);
        }
        exitsRef.current = exits;
        // the runs the record says ended, named from the board's rows now —
        // the next publication would do it too, but there need not be one
        ledger = withEndedLanes(ledger, replica.getSnapshot().model);
        statusRef.current = ledger;
        historyRef.current = statusHistoryBook(ledger) as GodviewHistoryBook;
        setHistorySeed((seed) => seed + 1);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [statusPort, boardLive, replica, withEndedLanes]);

  // ── the verbs, through the door ──────────────────────────────────────────
  const announce = useCallback((message: string): void => {
    setAcknowledgement((current) => ({ nonce: (current?.nonce ?? 0) + 1, message }));
  }, []);

  /**
   * AR-4 — a run resumed into a new PTY. The board's row names the PTY it
   * replaced (`terminal.replaced`), and the pane that was showing the old one
   * is handed the new one through the door, once per replacement — so a
   * resume-when-idle never leaves a pane on a dead PTY. A replacement no pane
   * shows is not this hook's business: the row is enough.
   */
  const paneSessionKey = panes.sessionIds.join("\n");
  const paneSessionIds = useMemo(
    () => new Set(paneSessionKey === "" ? [] : paneSessionKey.split("\n")),
    [paneSessionKey],
  );
  const remounted = useRef(new Set<string>());
  const remounting = useRef(new Set<string>());
  const remountAttempts = useRef(new Map<string, number>());
  useEffect(() => {
    if (door === null) return;
    for (const { rowId, old, next } of joins.replacements) {
      const key = `${old}\u0000${next}`;
      if (remounted.current.has(key) || remounting.current.has(key)) continue;
      if (!paneSessionIds.has(old) || paneSessionIds.has(next)) continue;
      const name = feed?.held(rowId)?.row.project.name ?? rowId;
      // A key is recorded only when the mount LANDED (AR-4b): a failure — the
      // floor not listing a just-born PTY yet, the pane closing under the
      // wait — is retried on the next frame or pane change, a bounded number
      // of times, and every outcome is said out loud.
      const attempt = (remountAttempts.current.get(key) ?? 0) + 1;
      remountAttempts.current.set(key, attempt);
      remounting.current.add(key);
      void door.mountLocal(next, { replacing: old }).then(
        (outcome) => {
          remounting.current.delete(key);
          if (outcome.state === "mounted") {
            remounted.current.add(key);
            announce(`${name} resumed in its pane`);
            return;
          }
          const last = attempt >= REMOUNT_ATTEMPTS;
          if (last) remounted.current.add(key);
          if (outcome.state === "no-pane") {
            announce(`${name} resumed, but no pane was open to hand it to`);
            return;
          }
          announce(
            `${name} resumed, but its pane could not be handed the new terminal — ${outcome.reason}${last ? "" : "; trying again"}`,
          );
        },
        () => {
          remounting.current.delete(key);
        },
      );
    }
  }, [door, feed, joins, paneSessionIds, announce]);

  /**
   * THE DOOR, opened (GT-D17). A remote row's select is the reference app's
   * `MonitorActions.select` contract finally meaning what it always said:
   * "Mount this session in the active pane". The mechanics are the deck's —
   * `door.attach` is where the runtime and the workspace live — and the one
   * thing that crosses back is an outcome, said out loud.
   */
  const attachRemote = useCallback(
    async (agent: MonitorAgent): Promise<void> => {
      const remote = agent.remote;
      if (remote === undefined) return;
      if (door === null) {
        announce(`${remote.deviceName} cannot be attached yet — the deck has no connection`);
        return;
      }
      if (!remote.attachable) {
        // DS-4e — a run off the board is attachable when its owner names its
        // PTY; one that names none has nothing a pane can show.
        announce(`${agent.project} runs on ${remote.deviceName} — it names no terminal to open`);
        return;
      }
      // the run's PTY on ITS floor when the owner named one, the run otherwise
      const board = feed?.held(agent.id)?.board;
      const remoteSessionId =
        board === undefined ? agent.id : (board.terminal?.runtimeSessionId ?? board.runtimeRunId);
      const outcome = await door.attach({
        deviceId: remote.deviceId,
        deviceName: remote.deviceName,
        remoteSessionId,
      });
      if (outcome.state === "no-pane") {
        announce("no pane to attach to — open one in the deck first");
        return;
      }
      if (outcome.state === "failed") {
        announce(`${remote.deviceName} could not be attached — ${outcome.reason}`);
        return;
      }
      setLinks((current) => new Map(current).set(agent.id, outcome.sessionId));
      announce(
        outcome.readWrite
          ? `${agent.project} attached from ${remote.deviceName}`
          : `${agent.project} attached from ${remote.deviceName} — view only, the peer refuses writes`,
      );
    },
    [announce, door, feed],
  );

  /**
   * A LOCAL row's select (AR-3): a managed agent's PTY, or an unclaimed
   * terminal, mounted in the pane the user is in. A row already showing there
   * is acknowledged rather than re-mounted; a row whose PTY the board no longer
   * names has nothing to mount and says so.
   */
  const mountLocal = useCallback(
    async (agent: MonitorAgent): Promise<void> => {
      const sessionId = joinsRef.current.sessionByRow.get(agent.id);
      if (sessionId === undefined) {
        announce(`${agent.project} has no terminal here to mount`);
        return;
      }
      if (agent.active && panes.activeSessionId === sessionId) {
        announce(`${agent.project} is in the active pane`);
        return;
      }
      if (door === null) {
        announce(`${agent.project} cannot be mounted yet — the deck has no connection`);
        return;
      }
      const outcome = await door.mountLocal(sessionId);
      if (outcome.state === "no-pane") {
        announce("no pane to mount into — open one in the deck first");
        return;
      }
      if (outcome.state === "failed") {
        announce(`${agent.project} could not be mounted — ${outcome.reason}`);
        return;
      }
      setSelectedId(undefined);
      announce(`${agent.project} mounted in the active pane`);
    },
    [announce, door, panes.activeSessionId],
  );

  const select = useCallback(
    (agent: MonitorAgent): void => {
      if (agent.remote !== undefined) {
        void attachRemote(agent);
        return;
      }
      setSelectedId(agent.id);
      void mountLocal(agent);
    },
    [attachRemote, mountLocal],
  );

  /**
   * A new terminal, in the active pane (SB-3): under the Agent Profile the
   * spawn bloom or the list's menu chose, else unbound. The views match the
   * body they drew at the release point to the row by `spawnHint`, so the
   * position is kept as given. Every outcome is said, a refusal in fieldd's own
   * words; a create that opened nothing then REJECTS with the sentence it said,
   * so a view's pending body is put away at once rather than waiting its birth out.
   */
  const createAt = useCallback(
    async (position?: { x: number; y: number }, target?: MonitorSpawnTarget): Promise<void> => {
      /** Said, then thrown: nothing opened. */
      const refuse = (sentence: string): Error => {
        announce(sentence);
        return new Error(sentence);
      };
      if (door === null) {
        throw refuse("no terminal can be opened yet — the deck has no connection");
      }
      // SB-D9: this desktop alone takes a terminal from here, until SB-6.
      if (!targetsHere(target)) {
        throw refuse("that desktop cannot take a terminal from here yet");
      }
      const profileSet = target?.profileSet;
      const label =
        profileSet === undefined ? undefined : profiles.find((set) => set.id === profileSet)?.label;
      const under = label === undefined ? "" : ` under ${label}`;
      // SB-3: while in flight, the first new terminal row takes this position
      const spawn: PendingSpawn | undefined =
        position === undefined ? undefined : { position, known: knownTerminals.current };
      if (spawn !== undefined) pendingSpawns.current = [...pendingSpawns.current, spawn];
      const landed = (): void => {
        if (spawn === undefined) return;
        pendingSpawns.current = pendingSpawns.current.filter((pending) => pending !== spawn);
        setSpawnsVersion((version) => version + 1);
      };
      let outcome: LocalMountOutcome;
      try {
        outcome = await (profileSet === undefined
          ? door.createTerminal()
          : door.createTerminal({ profileSet }));
      } catch (cause) {
        landed();
        throw refuse(
          `terminal could not be opened${under} — ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      landed();
      if (outcome.state === "no-pane") {
        throw refuse("no pane to open a terminal in — open one in the deck first");
      }
      if (outcome.state === "failed") {
        throw refuse(`terminal could not be opened${under} — ${outcome.reason}`);
      }
      // the door's answer names the session: its row keeps the position from
      // here on, whichever row claimed it first
      if (position) setSpawnHints((current) => new Map(current).set(outcome.sessionId, position));
      if (profileSet !== undefined && outcome.profileSet === undefined) {
        // asked with a profile, answered without one: a daemon older than the
        // binding (SB-2) births unbound — the shell is kept
        announce(
          `terminal opened, but not under ${label ?? "that profile"} — this VibeField daemon cannot open terminals under a profile yet`,
        );
      } else if (outcome.profileSet !== undefined && profiles.length > 1) {
        announce(`terminal opened${under} in the active pane`);
      } else {
        // one profile is no choice, and the plain sentence says it all
        announce("terminal opened in the active pane");
      }
    },
    [announce, door, profiles],
  );

  const clearAcknowledgement = useCallback(() => setAcknowledgement(null), []);
  const actions = useMemo<MonitorActions>(() => ({ select, createAt }), [createAt, select]);

  // ── the views, through the legacy bridge (L6) ────────────────────────────
  // The bridge's `toProps` reads host state beside the input through `latest`,
  // so a view switch or a frame always finds this render's facts; a change of
  // those facts alone redraws the mounted view (`refresh`).
  const agentsById = useMemo(() => new Map(agents.map((row) => [row.id, row] as const)), [agents]);
  const historyFor = useCallback(
    (device: string | null, chosen: string | undefined): GodviewHistoryBook => {
      const book = historyRef.current;
      // TL — the record, its ended lanes narrowed exactly as the live rows are
      const ended = recedeOutside(narrowToDevice(book.ended, device, here), chosen);
      return ended === book.ended ? book : { ...book, ended };
    },
    [here],
  );
  const latest = useRef({
    viewRows: (current: MonitorModel) =>
      narrow(windowRows.rowsFor(current, rowFacts), deviceChosen, here),
    history: () => historyFor(deviceChosen, chosenProfile),
    actions,
    spawnMenu,
    agentsById,
    select,
    createAt,
  });
  latest.current = {
    viewRows: (current) => narrow(windowRows.rowsFor(current, rowFacts), deviceChosen, here),
    history: () => historyFor(deviceChosen, chosenProfile),
    actions,
    spawnMenu,
    agentsById,
    select,
    createAt,
  };
  /** What the views were last given, so a change of window facts alone can draw them again. */
  const given = useRef<{
    rows: readonly ViewsMonitorAgent[] | undefined;
    history: GodviewHistoryBook | undefined;
    spawnMenu: MonitorSpawnMenu | undefined;
  }>({ rows: undefined, history: undefined, spawnMenu: undefined });
  /** The old view's props from the bridge's input and this render's facts. */
  const toProps = useCallback((input: MonitorViewInput): AgentMonitorProps => {
    const rows = latest.current.viewRows(input.model);
    const history = latest.current.history();
    given.current = { rows, history, spawnMenu: latest.current.spawnMenu };
    return {
      agents: rows,
      parameters: input.parameters as MonitorParameters,
      actions: latest.current.actions,
      palette: input.theme.tokens as MonitorPalette,
      history,
      ...(latest.current.spawnMenu !== undefined ? { spawnMenu: latest.current.spawnMenu } : {}),
    };
  }, []);
  // One bridge per view, built when the stage first asks for it and kept while
  // its component stands — the registry's four, or whatever view a host hands
  // the stage. MV-0: the component is the view's own, or the lab's counting
  // wrapper around it while a perf probe is installed
  // (`monitor/perf/instrumented-view.tsx`); a probe installed or removed rebuilds.
  const bridges = useRef(
    new Map<string, { component: ComponentType<AgentMonitorProps>; view: LegacyMonitorView }>(),
  );
  const viewFor = useCallback(
    (view: AgentMonitorView): LegacyMonitorView => {
      const Component = instrumentedMonitorView(view);
      const held = bridges.current.get(view.id);
      if (held !== undefined && held.component === Component) return held.view;
      const bridged = legacyView<AgentMonitorProps>(view, Component, toProps, wrapWithPhysics);
      bridges.current.set(view.id, { component: Component, view: bridged });
      return bridged;
    },
    [toProps],
  );
  // The window facts the views read moved without the model moving (the device
  // filter, a desktop's standing, a transferred body, the spawn menu, fieldd's
  // history landing): a view whose props changed draws again (the bridge's
  // `refresh`, for host state beside the input).
  useLayoutEffect(() => {
    const was = given.current;
    if (was.rows === undefined) return;
    const rows = latest.current.viewRows(replica.getSnapshot().model);
    const history = latest.current.history();
    if (rows === was.rows && history === was.history && spawnMenu === was.spawnMenu) return;
    for (const held of bridges.current.values()) held.view.refresh();
  }, [replica, placed, spawnMenu, historySeed, chosenProfile, deviceChosen]);

  // The view host reads its commands through the latest props; these reach the latest window too.
  const commands = useMemo<ViewSlotCommands>(
    () => ({
      select(agentId) {
        const row = latest.current.agentsById.get(agentId);
        if (row !== undefined) latest.current.select(row);
      },
      create(at, target) {
        void latest.current.createAt(at, target).catch(() => undefined);
      },
    }),
    [],
  );

  // ── the chrome's facts (M19): the claims, the find sheet ─────────────────
  const sources = useMemo<MonitorSourceCounts>(
    () => ({
      // Counted off the window's rows: another desktop's run is an agent row
      // too (DS-3), and it is not one of this desktop's.
      local: agents.filter((row) => row.agent !== undefined && row.remote === undefined).length,
      terminals: agents.filter((row) => row.agent === undefined && row.remote === undefined).length,
      remote: agents.filter((row) => row.remote !== undefined).length,
      hosts: new Set(
        agents.flatMap((row) => (row.remote === undefined ? [] : [row.remote.deviceId])),
      ).size,
      ...localStateOf(feedFacts.state),
      ...remoteStateOf(feedFacts.state),
    }),
    [agents, feedFacts.state],
  );
  // The find sheet joins rosetta's hits by the provider-native session id and
  // scopes them from the mirror's clocks — facts the model does not carry
  // (M19): they come from the fold, joined by the run each row was dealt.
  const fold = useAgentFold();
  const foldJoinKey = fold.rows
    .map(
      (row) =>
        `${row.runtimeRunId}:${row.sessionId}:${row.monitor === undefined ? "-" : "m"}:${(row.monitor?.session as { startedAt?: string } | undefined)?.startedAt ?? ""}:${row.monitor?.statusSince ?? ""}`,
    )
    .join("\n");
  const findAgents = useMemo<readonly MonitorAgent[]>(() => {
    const byRun = new Map(fold.rows.map((row) => [row.runtimeRunId, row] as const));
    return agents.map((row) => {
      if (row.agent === undefined || row.remote !== undefined) return row;
      const run = joins.runByRow.get(row.id);
      const summary = run === undefined ? undefined : byRun.get(run);
      if (summary === undefined) return row;
      return {
        ...row,
        agent: {
          ...row.agent,
          nativeSessionId: summary.sessionId,
          ...(summary.monitor !== undefined
            ? { monitor: summary.monitor as unknown as AgentMonitorState }
            : {}),
        },
      };
    });
    // keyed by the fold facts the sheet reads, not by the fold's 16 ms frames
  }, [agents, joins, foldJoinKey]);

  return {
    replica,
    model,
    viewFor,
    commands,
    capabilities,
    agents,
    shown,
    findAgents,
    runByRow: joins.runByRow,
    actions,
    sources,
    acknowledgement,
    clearAcknowledgement,
    devices,
    deviceChosen,
    tabs,
    spawnMenu,
    feed: feedFacts.state,
  };
}
