import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import type { MonitorCapabilities } from "@vibecook/puppeteer-view-sdk";
import type { MonitorReplicaLike, ViewSlotCommands } from "@vibecook/puppeteer-view-sdk/host";
import type {
  AgentView,
  ModelChanges,
  MonitorAgentRow,
  MonitorModel,
} from "@vibecook/puppeteer-view-sdk/model";
import { projectColourFor, projectName } from "@vibecook/puppeteer-view-sdk/toolkit";
import type { MonitorPalette, ProfileTab } from "@vibecook/puppeteer-views";
import type { AgentProfileSet } from "@vibefield/contracts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { askGodviewDeckUp } from "../../frame/deck-door";
import type { LiveFindAgent } from "../../frame/find-door";
import type { MonitorFloorRecord } from "./agents";
import { NO_RUNS, useChromeKey } from "./chrome-facts";
import { type DeviceChoice, standingChoice } from "./device-filter";
import { deviceFacet, useDeviceRoster } from "./devices";
import { createFindAgents, findJoinKey } from "./find-agents";
import { useMonitorFeed } from "./GodviewAgentsProvider";
import type { HeldModelRow } from "./model-board";
import type { GodviewMonitorFeed, MonitorFeedState } from "./model-replica";
import { profileTabs } from "./profile-tabs";
import type { LocalMountOutcome, MonitorDoor } from "./remote-door";
import { spawnMenuOf, targetsHere } from "./spawn-menu";
import type { MonitorAgent, MonitorSpawnMenu, MonitorSpawnTarget } from "./types";
import {
  type BoardJoins,
  boardJoins,
  boardJoinsKey,
  paneFactsKey,
  windowKindsKey,
  windowLocal,
} from "./window-local";
import {
  createRowOrder,
  createWindowRows,
  deviceOfRow,
  narrowToDevice,
  sameVisualIds,
  visualIdsOf,
  type WindowRowFacts,
} from "./window-rows";
import { createWindowViewReplica, type WindowViewReplica } from "./window-view";

/**
 * THE WINDOW (MV-3b; MV-D18, MV-D22). What is left of the seam once the
 * backend computes every business fact beside the runtime (`design-mv.md` §1):
 *
 *   · THE REPLICA — the window's copy of the backend's model, fed by
 *     `GodviewAgentsProvider` through the door's model port (`model-replica.ts`,
 *     one subscription per window, PF6). All five views are SDK views — list
 *     and rain (MV-4), the swarm (MV-5), the timeline (MV-6) and spend (MV-7):
 *     they draw it as themselves, cut to the window's rows (`window-view.ts`),
 *     one update per frame. The chrome reads the model too; only Find joins
 *     its local facts into the shared sheet's rows (`find-agents.ts`, M19).
 *   · THE LOCAL JOIN — what only this window knows, handed to the replica
 *     (`setLocal`): its panes and the colour each wears, the pane the person is
 *     working in, the row they pointed at, where they asked terminals to be
 *     born, what each pane's terminal is doing (M28), the body each row
 *     continues (M59: a launcher's agent takes the shell's place), which rows
 *     the chosen profile tab recedes, and which rows this window shows at all
 *     (M3: the live ones, and none whose pane has exited).
 *   · THE VERBS — every one through the DOOR the deck built (`MonitorDoor`): a
 *     local row's select brings its PTY into the terminals, a peer's attaches
 *     its terminal there, create opens an empty terminal — each placed by the
 *     deck's one rule (GV-D4: in the focused pane, mirrored there when another
 *     pane shows it) — and every outcome is said out loud, in fieldd's own
 *     words. Views receive SDK commands; the window handles the door's
 *     promises.
 *   · THE SCREEN — what the active pane shows, reported to the backend
 *     (`reportShown`, L5), which keeps the unread marks.
 *
 * What left: the fold's assembly (`agents.ts`), the usage and unread ledgers and
 * the project colours (the backend's, L4/L5/L11), the mesh board's second reader
 * (`mesh-field.ts`; the one door carries peers), the localStorage caches, and
 * (MV-6, L10, MV-D13) the status ledger with fieldd's history laid under it:
 * Godview is runtime only, and the timeline draws births and current states.
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
  /** P2 — whether Live now's rows are wanted (the Peek listens): the find
   * join is made only then, never for a closed Peek. Default true. */
  find?: boolean;
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
  /** MV-4 — the replica cut to the rows the stage shows, for the view's
   * host (`window-view.ts`): the chosen desktop's, in the stage's order, peers
   * greyed by standing. */
  viewReplica: MonitorReplicaLike;
  /** The model as the replica last published it. */
  model: MonitorModel;
  /** The view host's commands: select and create route to this window's door. */
  commands: ViewSlotCommands;
  /** What the backend lends a view beyond the model (MV-D4): today's spawn menu. */
  capabilities: MonitorCapabilities;
  /** Every row the window holds, as the views read it (no device filter): the
   * claims count these, the tabs light their dots from them. */
  agents: readonly MonitorAgent[];
  /** The rows the stage shows: the chosen desktop's, the chosen profile's unreceded. */
  shown: readonly MonitorAgent[];
  /** The rows the Peek's Live now reads (P2; the find sheet's until then): the
   * window's rows joined with each run's native session id and mirror clocks
   * (the chrome's own reader, M19; MV-3d: off the chrome's facts,
   * `findAgentsOf`), where each runs and this desktop's floor session. */
  findAgents: readonly LiveFindAgent[];
  /** The run behind each of this desktop's agent rows (`BoardJoins.runByRow`):
   * the marker's join, observed or not. Runtime identity is a local chrome
   * fact, never inferred from a view's row. */
  runByRow: ReadonlyMap<string, string>;
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
  /** Which desktop is here (the roster's own row, else the board's first); undefined before either says. */
  here: string | undefined;
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
const NO_FIND_AGENTS: readonly LiveFindAgent[] = Object.freeze([]);
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

/** Model rows narrowed to the chosen desktop, retaining identity between frames. */
function createNarrowing(): (
  rows: readonly AgentView[],
  device: string | null,
  here: string | undefined,
) => readonly AgentView[] {
  let lastRows: readonly AgentView[] | undefined;
  let lastDevice: string | null = null;
  let lastHere: string | undefined;
  let last: readonly AgentView[] = Object.freeze([]);
  return (rows, device, here) => {
    if (rows === lastRows && device === lastDevice && here === lastHere) return last;
    last = narrowToDevice(rows, device, here);
    lastRows = rows;
    lastDevice = device;
    lastHere = here;
    return last;
  };
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
  find = true,
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
  const joinsRef = useRef(joins);
  joinsRef.current = joins;

  // ── the rows as the views read them ──────────────────────────────────────
  const windowRows = useMemo(createWindowRows, []);
  const standingKey = feedFacts.devices.map((entry) => `${entry.device}:${entry.state}`).join("\n");
  const orderFor = useMemo(createRowOrder, []);
  const orderKey = orderFor(held, here, panes).join("\n");
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
  // M59 — the body each row continues, for a view that places rows in space
  // (the swarm keys its bodies by `visualId ?? id`): the window rows' own rule
  // (a launcher's agent takes the fresh shell's body, `terminalVisualIds`; a
  // row keeps the body it wore), handed to the replica's join below. Computed
  // once per published model, and the SAME map while no row's body moved
  // (M64), so a state-only publish re-diffs no row in the join.
  const visualIdsRef = useRef<ReadonlyMap<string, string>>(new Map());
  const visualIds = useMemo(() => {
    const next = visualIdsOf(agents);
    if (!sameVisualIds(visualIdsRef.current, next)) visualIdsRef.current = next;
    return visualIdsRef.current;
  }, [agents]);

  // DS-3 — the device filter's choices and the choice as the board still has it
  const devices = useMemo<readonly DeviceChoice[]>(() => {
    const counts = new Map<string, number>();
    for (const row of agents) {
      if (row.kind !== "agent") continue;
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
  const kindsKey = windowKindsKey({ joins, kindOf, panes, spawnHints: hints });
  const local = useMemo(
    () =>
      windowLocal({
        joins,
        kindOf,
        panes,
        links,
        previewSelectedId: selectedId,
        spawnHints: hints,
        visualIds,
        receded,
        visible,
      }),
    // The kinds key covers every kindOf lookup the join makes. Model-only
    // publishes keep the local facts and do not re-diff the replica.
    [joins, kindsKey, panesKey, links, selectedId, hints, visualIds, receded, visible],
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
   * THE DOOR, opened (GT-D17). A remote row's select is what the reference
   * app's `commands.select` means: "Mount this session in the active pane" —
   * the deck's one rule (GV-D4, re-ruled 2026-10-18; from 2026-10-11 it opened
   * beside the focused pane): in the focused pane, mirrored there when another
   * pane shows it. The mechanics are the deck's — `door.attach` is where the
   * runtime and the workspace live — and the one thing that crosses back is an
   * outcome, said out loud.
   */
  const attachRemote = useCallback(
    async (agent: MonitorAgent): Promise<void> => {
      if (agent.device.self) return;
      const remote = agent.device;
      if (door === null) {
        announce(`${remote.name} cannot be attached yet — the deck has no connection`);
        return;
      }
      if (!agent.attachable) {
        // DS-4e — a run off the board is attachable when its owner names its
        // PTY; one that names none has nothing a pane can show.
        announce(`${projectName(agent)} runs on ${remote.name} — it names no terminal to open`);
        return;
      }
      // the run's PTY on ITS floor when the owner named one, the run otherwise
      const board = feed?.held(agent.id)?.board;
      const remoteSessionId =
        board === undefined ? agent.id : (board.terminal?.runtimeSessionId ?? board.runtimeRunId);
      const outcome = await door.attach({
        deviceId: remote.id,
        deviceName: remote.name,
        remoteSessionId,
      });
      if (outcome.state === "no-pane") {
        announce("no pane to attach to — open one in the deck first");
        return;
      }
      if (outcome.state === "failed") {
        announce(`${remote.name} could not be attached — ${outcome.reason}`);
        return;
      }
      setLinks((current) => new Map(current).set(agent.id, outcome.sessionId));
      announce(
        outcome.readWrite
          ? `${projectName(agent)} attached from ${remote.name}`
          : `${projectName(agent)} attached from ${remote.name} — view only, the peer refuses writes`,
      );
    },
    [announce, door, feed],
  );

  /**
   * A LOCAL row's select (AR-3): a managed agent's PTY, or an unclaimed
   * terminal, brought into the terminals by the deck's rule (GV-D4, re-ruled
   * 2026-10-18; `deck-placement.ts`): into the focused pane — the pane is an
   * observer, and the person chose it — mirrored there when another pane
   * shows it already. The door answers how, and the words follow. A row
   * already in the active pane is acknowledged without asking the door (the
   * rule would move nothing); a row whose PTY the board no longer names has
   * nothing to mount and says so.
   */
  const mountLocal = useCallback(
    async (agent: MonitorAgent): Promise<void> => {
      const sessionId = joinsRef.current.sessionByRow.get(agent.id);
      if (sessionId === undefined) {
        announce(`${projectName(agent)} has no terminal here to mount`);
        return;
      }
      if (agent.active && panes.activeSessionId === sessionId) {
        // the door is not asked, so the select is the call itself: with the
        // terminals away, this session brings them back too (GV-D6)
        askGodviewDeckUp();
        announce(`${projectName(agent)} is in the active pane`);
        return;
      }
      if (door === null) {
        announce(`${projectName(agent)} cannot be mounted yet — the deck has no connection`);
        return;
      }
      const outcome = await door.mountLocal(sessionId);
      if (outcome.state === "no-pane") {
        announce("no pane to mount into — open one in the deck first");
        return;
      }
      if (outcome.state === "failed") {
        announce(`${projectName(agent)} could not be mounted — ${outcome.reason}`);
        return;
      }
      setSelectedId(undefined);
      announce(
        outcome.placement === "focus"
          ? // the focused pane showed it already: nothing was mounted
            `${projectName(agent)} is in the active pane`
          : `${projectName(agent)} mounted in the active pane`,
      );
    },
    [announce, door, panes.activeSessionId],
  );

  const select = useCallback(
    (agent: MonitorAgent): void => {
      if (!agent.device.self) {
        void attachRemote(agent);
        return;
      }
      setSelectedId(agent.id);
      void mountLocal(agent);
    },
    [attachRemote, mountLocal],
  );

  /**
   * A new terminal (SB-3), placed by the deck's rule (GV-D4, re-ruled
   * 2026-10-18): in the focused pane, whose session runs on — under the
   * Agent Profile the spawn bloom or the list's menu chose, else unbound. The
   * views match the body they drew at the release point to the row by
   * `spawnHint`, so the position is kept as given. Every outcome is said, a
   * refusal in fieldd's own
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
      // GV-D4 (re-ruled 2026-10-18): it opened in the pane the person was in
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

  // The views read the window's model cut. Commands and reads find this
  // render's facts through one stable ref; a host-fact change refreshes the cut.
  const agentsById = useMemo(() => new Map(agents.map((row) => [row.id, row] as const)), [agents]);
  const latest = useRef({
    viewRows: (current: MonitorModel) =>
      narrow(windowRows.rowsFor(current, rowFacts), deviceChosen, here),
    agentsById,
    select,
    createAt,
  });
  latest.current = {
    viewRows: (current) => narrow(windowRows.rowsFor(current, rowFacts), deviceChosen, here),
    agentsById,
    select,
    createAt,
  };
  const viewReplica = useMemo<WindowViewReplica>(
    () => createWindowViewReplica(replica, (current) => latest.current.viewRows(current)),
    [replica],
  );
  useLayoutEffect(() => {
    viewReplica.refresh();
  }, [viewReplica, placed, chosenProfile, deviceChosen]);

  // The view host reads its commands through the latest props; these reach the latest window too.
  const commands = useMemo<ViewSlotCommands>(
    () => ({
      select(agentId) {
        const row = latest.current.agentsById.get(agentId);
        if (row !== undefined) latest.current.select(row);
      },
      // M59 — the host's REAL answer: the slot reads the create's fulfilment as
      // opened and its rejection (`createAt` refuses with the sentence it said)
      // as a refusal, so a view's birth waits for its row and gives up at once
      // when nothing opened (SB §2.6).
      create(at, target) {
        return latest.current.createAt(at, target);
      },
    }),
    [],
  );

  // ── the chrome's facts (M19): the claims, the find sheet ─────────────────
  const sources = useMemo<MonitorSourceCounts>(
    () => ({
      // Counted off the window's rows: another desktop's run is an agent row
      // too (DS-3), and it is not one of this desktop's.
      local: agents.filter((row) => row.kind === "agent" && row.device.self).length,
      terminals: agents.filter((row) => row.kind === "terminal" && row.device.self).length,
      remote: agents.filter((row) => !row.device.self).length,
      hosts: new Set(agents.flatMap((row) => (row.device.self ? [] : [row.device.id]))).size,
      ...localStateOf(feedFacts.state),
      ...remoteStateOf(feedFacts.state),
    }),
    [agents, feedFacts.state],
  );
  // The find sheet joins rosetta's hits by the provider-native session id and
  // scopes them from the mirror's clocks — facts the model does not carry
  // (M19). MV-3d: they ride each run's row of the model board (the chrome's
  // facts), joined by the run each row was dealt; the sheet's join moves only
  // when a fact it keys moves, and reads the newest of them when it does.
  const chrome = feed?.chrome ?? null;
  const findKey = useChromeKey(find ? chrome : null, findJoinKey);
  const findAgentsOf = useMemo(createFindAgents, []);
  const findAgents = useMemo<readonly LiveFindAgent[]>(
    () =>
      find
        ? findAgentsOf(agents, joins.runByRow, chrome?.runs() ?? NO_RUNS, joins.sessionByRow)
        : NO_FIND_AGENTS,
    // keyed by the facts the sheet joins on, not by every frame a run moves in
    [find, agents, joins, findKey, chrome, findAgentsOf],
  );

  return {
    replica,
    viewReplica,
    model,
    commands,
    capabilities,
    agents,
    shown,
    findAgents,
    runByRow: joins.runByRow,
    sources,
    acknowledgement,
    clearAcknowledgement,
    devices,
    deviceChosen,
    tabs,
    spawnMenu,
    feed: feedFacts.state,
    here,
  };
}
