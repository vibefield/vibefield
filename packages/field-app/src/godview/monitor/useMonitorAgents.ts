import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import type { MonitorUsageState } from "@vibecook/puppeteer-core";
import {
  EMPTY_UNREAD_LEDGER,
  EMPTY_USAGE_LEDGER,
  exportUsage,
  type MonitorPalette,
  type PaneAttachment,
  reconcileUnread,
  reconcileUsage,
  seedUsage,
  type UnreadLedger,
  USAGE_STEP_MS,
  type UsageLedger,
  type UsageLedgerKey,
} from "@vibecook/puppeteer-views";
import type { AgentProfileSet } from "@vibefield/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { blockerTool, projectKey, projectLabel } from "./agent-status";
import {
  assembleMonitorAgents,
  type MonitorFloorRecord,
  type MonitorManagedRecord,
  type MonitorRemoteRecord,
  type MonitorTerminalRecord,
  managedRowId,
} from "./agents";
import type { AgentSessionSummary } from "./facet-types";
import { useAgentFold } from "./GodviewAgentsProvider";
import type { LocalFieldState } from "./local-agent-field";
import {
  dealProjectSeqs,
  loadProjectLedger,
  type ProjectLedger,
  saveProjectLedger,
} from "./project-ledger";
import { type LocalMountOutcome, type MonitorDoor, remoteRowId } from "./remote-door";
import { useRemoteSessionField } from "./remote-session-field";
import { targetsHere } from "./spawn-menu";
import type { MonitorActions, MonitorAgent, MonitorSpawnTarget } from "./types";
import { createUsageHistoryCache } from "./usage-history-cache";

/**
 * Core's usage state, rebuilt from the mirror's row. The projection rides
 * the door verbatim (AR-D4), so every aggregate Core wrote is there under
 * its own name, past the two fields the contract spells; the sample ring is
 * read when it came through and empty when it did not — the ledger reads
 * the aggregates first and the last sample only as a fallback.
 */
function coreUsage(usage: Readonly<Record<string, unknown>>): MonitorUsageState {
  const num = (key: string): number | undefined => {
    const value = usage[key];
    return typeof value === "number" ? value : undefined;
  };
  const ring = usage.samples;
  const samples = Array.isArray(ring)
    ? ring.filter(
        (sample): sample is MonitorUsageState["samples"][number] =>
          typeof sample === "object" &&
          sample !== null &&
          typeof (sample as { cumulativeTokens?: unknown }).cumulativeTokens === "number",
      )
    : [];
  return {
    samples,
    cumulativeTokens: num("cumulativeTokens"),
    inputTokens: num("inputTokens"),
    outputTokens: num("outputTokens"),
    cacheReadTokens: num("cacheReadTokens"),
    cacheCreationTokens: num("cacheCreationTokens"),
    reasoningTokens: num("reasoningTokens"),
    burnRatePerMin: num("burnRatePerMin"),
  };
}

/** Where the renderer keeps what it dealt and what it counted (D3, D7): cache. */
const PROJECT_LEDGER_KEY = "vf-godview-projects-v1";
const USAGE_CACHE_KEY = "vf-godview-usage-history-v1";

/**
 * THE SEAM. The single subscription to everything a monitor view renders, and
 * the only module in this subsystem that knows where agents come from.
 *
 * It is a COMPOSITION (GT-D17), and since AR-3 both halves are real:
 *
 *   · THE FOLD — fieldd's `agent.subscribe`: every managed session on this
 *     device, one row per run, with puppeteer's monitor projection riding
 *     verbatim. It replaced `MockAgentField`, and the label that said the rows
 *     were invented went with it. Since GT-6 the stream itself belongs to
 *     `GodviewAgentsProvider` one level up, because the deck's pane frames read
 *     the same rows; this hook consumes the fold and stays a projection.
 *   · `RemoteSessionField` — REAL sessions on real peers, read from the mesh
 *     through the deck's own control connection, and mountable for real.
 *
 * Beside them, the deck's own panes: a pane no agent has claimed is an
 * unclaimed terminal row, the deck's fact and the deck's summary.
 *
 * Every verb goes through the DOOR the deck built (`MonitorDoor`): a local
 * row's select mounts its PTY in the active pane, a remote row's select
 * attaches the peer's session there, and create opens an empty terminal in it. The views still see actions; the source sees promises.
 *
 * PF6: the subscription and the poll are opened on mount and closed on
 * unmount, and the stage that owns this hook is mounted ONLY while the overlay
 * is open. A closed Godview therefore holds no monitor subscription at all.
 */

export interface UseMonitorAgentsOptions {
  /** §2.6's accents, live from the tokens. The projection needs them to assign
   * each session its stable relationship color. */
  palette: MonitorPalette;
  /** The deck's verbs (GT-D17, AR-3). Null before a deck exists — this host has
   * no terminal bridge, or the overlay has not built one yet — and both halves
   * of the field are then empty, honestly and without placeholders. */
  door?: MonitorDoor | null;
  /** The sessions the deck's panes are showing, and the one the user is in.
   * Facts, published by the deck; the monitor reads them and drives nothing. */
  panes?: MonitorPaneFacts;
  /** SB-3 — the Agent Profiles as the stage's feed last had them: what the
   * acknowledgements call a birth's profile ("opened under Work"). Empty while
   * there is no feed. */
  profiles?: readonly AgentProfileSet[];
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
   * holds them): what makes an unclaimed pane a terminal row, and what lets
   * a managed row carry its PTY's summary. */
  sessions?: readonly SessionSummary[];
  /** GT-6b — the UI roster the deck last read (`terminal.roster`, TP-D4): every
   * live PTY the floor holds, pane or no pane. The monitor keeps the ones no
   * pane is showing, so a session the deck displaced is still reachable. */
  floor?: readonly MonitorFloorRecord[];
  /** SB-3 — which shells were born under which Agent Profile: the pool's
   * record in fieldd's words (its create answers for births here, its roster
   * for the rest). The same map until it changes. */
  profileSets?: ReadonlyMap<string, string>;
}

export interface MonitorAgentsResult {
  agents: readonly MonitorAgent[];
  actions: MonitorActions;
  /** How many rows each source contributed, so the stage can scope its claims
   * to the right ones (GT-D17) rather than labeling the whole field. */
  sources: MonitorSourceCounts;
  /** What the last verb answered, for the stage to say out loud. Cleared by
   * the stage; carried here because the actions are what produce it. */
  acknowledgement: MonitorAcknowledgement | null;
  clearAcknowledgement(): void;
}

export interface MonitorSourceCounts {
  /** Managed sessions the fold contributed. */
  local: number;
  /** The deck's panes no agent has claimed. */
  terminals: number;
  remote: number;
  /** Online peers behind the remote rows. */
  hosts: number;
  /** The local field's honest state — `unavailable` carries fieldd's own reason. */
  localState: LocalFieldState;
  localReason?: string;
  /** The remote field's honest state — `unavailable` carries the floor's own
   * reason, which is the ordinary answer from a floor serving no mesh. */
  remoteState: "no-door" | "serving" | "unavailable";
  remoteReason?: string;
}

export interface MonitorAcknowledgement {
  /** Bumped per event so a repeat of the same gesture still reads as one. */
  nonce: number;
  message: string;
}

/** Where a remote row landed, remembered from the attach that put it there. */
interface RemoteLink {
  localSessionId: string;
}

/** SB-3 — a create in flight: where it was asked for (as given, unrounded), the
 * local sessions a terminal row stood for when it started, and the row that
 * has taken its position. */
interface PendingSpawn {
  readonly position: { x: number; y: number };
  readonly known: ReadonlySet<string>;
  claimed?: string;
}

const NO_PANES: MonitorPaneFacts = { sessionIds: [] };

/** AR-4b — how many times a replacement's hand-over is retried before the
 * row is left as it is and the last reason stands. */
const REMOUNT_ATTEMPTS = 3;

/** The damage gate's key: the facts the projection DRAWS from a row, per row
 * — the run and its epoch, the one derived status and when it changed, the
 * observation level, the terminal join (and the PTY it replaced), the
 * continuation's pending state, and from the mirror exactly what a view
 * reads (the headline, the blockers, the last assistant line, the model, the
 * context window, the cwd and branch, liveness) plus the mirror's own
 * revision. Cheap where `JSON.stringify` of the whole fold was not — the
 * mirror carries the subagent, workflow and team collections verbatim — at
 * one frame per 16 ms while an agent is active. */
function rowsKey(rows: readonly AgentSessionSummary[]): string {
  return rows
    .map((row) => {
      const monitor = row.monitor;
      const last = monitor?.lastAssistantMessage as { text?: unknown } | undefined;
      return [
        row.runtimeRunId,
        row.runtimeEpoch,
        row.sessionId,
        row.kind,
        row.label,
        row.profileId ?? "",
        row.profileSet ?? "",
        row.status,
        row.stateChangedAt,
        row.lastActivityAt ?? "",
        row.observationLevel,
        row.createdAt,
        row.title ?? "",
        row.terminal?.hosted ?? "",
        row.terminal?.runtimeSessionId ?? "",
        row.terminal?.replaced ?? "",
        row.terminal?.cellBootId ?? "",
        row.workspace?.sourcePath ?? "",
        row.workspace?.root ?? "",
        row.workspace?.branch ?? "",
        row.continuation?.pending ?? "",
        row.continuation?.reattached ? 1 : 0,
        monitor === undefined ? "-" : "m",
        monitor?.revision ?? "",
        monitor?.status ?? "",
        monitor?.alive === undefined ? "" : monitor.alive ? 1 : 0,
        monitor?.environment?.cwd ?? "",
        monitor?.environment?.git === undefined ? "?" : (monitor.environment.git?.branch ?? "null"),
        monitor?.model?.id ?? "",
        monitor?.model?.displayName ?? "",
        monitor?.context?.usedPercent ?? "",
        monitor?.context?.usedTokens ?? "",
        monitor?.context?.capacityTokens ?? "",
        typeof last?.text === "string" ? last.text : "",
        // The same nested read the detail line makes (`blockerTool`): keyed on
        // the root field, this gate was blind to the one thing the row draws
        // about a permission, so a blocker that changed only its tool never
        // re-rendered the list (GT-6 review — the defect had two homes).
        (monitor?.blockers ?? [])
          .map((blocker) => `${blocker.id}:${blocker.kind}:${blockerTool(blocker) ?? ""}`)
          .join(","),
      ].join("\u0001");
    })
    .join("\u0002");
}

const NO_PROFILES: readonly AgentProfileSet[] = [];

export function useMonitorAgents({
  palette,
  door = null,
  panes = NO_PANES,
  profiles = NO_PROFILES,
}: UseMonitorAgentsOptions): MonitorAgentsResult {
  /** Which row the user last pointed at — a preview highlight for a row no
   * pane is showing yet. Cleared when the row lands in a pane. */
  const [selectedId, setSelectedId] = useState<string>();
  const [spawnHints, setSpawnHints] = useState<ReadonlyMap<string, { x: number; y: number }>>(
    () => new Map(),
  );
  const [acknowledgement, setAcknowledgement] = useState<MonitorAcknowledgement | null>(null);
  /** Row id → the replica it was attached as. Kept per ROW rather than per
   * session because the row is what survives a refresh of the mesh. */
  const [links, setLinks] = useState<ReadonlyMap<string, RemoteLink>>(() => new Map());
  /** THE FOLD, from the window's one subscription (AR-6 §4.1, built at GT-6).
   * This hook used to own `agent.subscribe` itself; the stream moved up to
   * `GodviewAgentsProvider` so the deck's pane frames read the same rows in the
   * same tick, and what stays here is the monitor's pure projection of them. */
  const localField = useAgentFold();
  const remoteField = useRemoteSessionField({ door });

  /** GT-3p's damage gate, kept: the projection's INPUTS as JSON. A frame
   * that changed nothing anybody renders still arrives as a new object; the
   * comparison holds the previous rows and returns them unchanged so the memo
   * below sees the same reference. Cheap at this size. */
  const stableRows = useRef(localField.rows);
  const stableKey = useRef("");
  const key = rowsKey(localField.rows);
  if (key !== stableKey.current) {
    stableKey.current = key;
    stableRows.current = localField.rows;
  }
  const localRows = stableRows.current;

  /** The deck publishes a fresh array whenever anything about its panes moves,
   * and the projection below must not recompute on identity alone. The joined
   * string is the dependency and the set is derived FROM it, so the memo cannot
   * drift from what it depends on; NUL separates because no session id has one. */
  const paneSessionKey = panes.sessionIds.join("\0");
  const paneSessionIds = useMemo(
    () => new Set(paneSessionKey === "" ? [] : paneSessionKey.split("\0")),
    [paneSessionKey],
  );
  const paneSessions = panes.sessions;
  const paneSummaryKey = JSON.stringify(
    (paneSessions ?? []).map((s) => [s.id, s.exited, s.cwd, s.title, s.activity?.kind]),
  );
  const sessions = useMemo(() => {
    const map = new Map<string, SessionSummary>();
    for (const session of paneSessions ?? []) map.set(session.id, session);
    return map;
    // keyed by the facts a row draws, not by array identity (the deck
    // republishes at ghosttea's cadence): paneSummaryKey stands in for paneSessions
  }, [paneSummaryKey]);

  /**
   * The deck owns pane colours and keeps them while this monitor is closed.
   * A session wears its active pane's colour, or its first pane's when none of
   * its panes is active. Never deal a second ledger here: reopening the stage
   * must not change the bubble-to-frame association.
   */
  const paneIdsKey = (panes.paneIds ?? []).join("\0");
  const attachments = useMemo(() => {
    const paneIds = paneIdsKey === "" ? [] : paneIdsKey.split("\0");
    const bySession = new Map<string, string[]>();
    paneIds.forEach((paneId, index) => {
      const sessionId = panes.sessionIds[index];
      if (sessionId === undefined) return;
      const list = bySession.get(sessionId) ?? [];
      list.push(paneId);
      bySession.set(sessionId, list);
    });
    const result = new Map<string, PaneAttachment>();
    for (const [sessionId, ids] of bySession) {
      const activeIndex = panes.activePaneId === undefined ? -1 : ids.indexOf(panes.activePaneId);
      const primaryPaneId = ids[activeIndex >= 0 ? activeIndex : 0] as string;
      const color = panes.paneColors?.get(primaryPaneId);
      result.set(sessionId, {
        primaryPaneId,
        paneIds: [primaryPaneId, ...ids.filter((id) => id !== primaryPaneId)],
        ...(color ? { color } : {}),
      });
    }
    return result;
    // keyed by the facts, not by the array the deck republishes
  }, [paneIdsKey, paneSessionKey, panes.activePaneId, panes.paneColors]);

  /**
   * AR-5 — the projects' colours (record §02, D3): every managed row's project
   * is dealt a sequence the first time it is seen, persisted per device, and
   * the theme's tint turns it into a hue in `agents.ts`. Dealt here, above the
   * projection, so the projection stays pure.
   */
  const [projectLedger, setProjectLedger] = useState<ProjectLedger>(() =>
    loadProjectLedger(PROJECT_LEDGER_KEY),
  );
  const projectKeysKey = localRows.map((row) => projectKey(row) ?? "").join("\0");
  useEffect(() => {
    const keys = localRows.map(projectKey).filter((key): key is string => key !== undefined);
    const next = dealProjectSeqs(projectLedger, keys);
    if (next === projectLedger) return;
    saveProjectLedger(PROJECT_LEDGER_KEY, next);
    setProjectLedger(next);
    // the keys are the dependency; localRows rides along under its own key
  }, [projectKeysKey, projectLedger]);

  /**
   * AR-5 — the UI's own account of each agent's tokens (the package's ledger,
   * D7 for its cache): one series per run, the held total and the burn per
   * step, folded from the mirror's `usage` at every step boundary and every
   * frame. The views read this and never Core's moving estimate. Seeded from
   * the cache once per conversation, saved at every step and when the page
   * goes away.
   */
  const usageRef = useRef<UsageLedger>(EMPTY_USAGE_LEDGER);
  const [usageStep, setUsageStep] = useState(0);
  const usageSeedsRef = useRef(new Set<string>());
  const [usageSeed, setUsageSeed] = useState(0);
  const usageStore = useMemo(() => createUsageHistoryCache(USAGE_CACHE_KEY), []);
  useEffect(() => {
    let interval: number | undefined;
    // Aligned to the step boundaries, so every agent's bars shift together.
    const timeout = window.setTimeout(
      () => {
        setUsageStep((step) => step + 1);
        interval = window.setInterval(() => setUsageStep((step) => step + 1), USAGE_STEP_MS);
      },
      USAGE_STEP_MS - (Date.now() % USAGE_STEP_MS),
    );
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);
  const usageKeys = useMemo<UsageLedgerKey[]>(
    () =>
      localRows.flatMap((row) =>
        row.monitor === undefined
          ? []
          : [{ id: managedRowId(row), providerId: row.kind, nativeSessionId: row.sessionId }],
      ),
    [localRows],
  );
  useEffect(() => {
    let alive = true;
    // A seed is MARKED when it lands, not when it is asked for: a cleanup
    // that runs before the load answers (a double-invoked effect) unmarks
    // what it asked, so the next run asks again rather than never (AR-5b).
    const asked = new Set<string>();
    for (const key of usageKeys) {
      const seedKey = `${key.providerId} ${key.nativeSessionId}`;
      if (usageSeedsRef.current.has(seedKey)) continue;
      usageSeedsRef.current.add(seedKey);
      asked.add(seedKey);
      void usageStore
        .load({ providerId: key.providerId, nativeSessionId: key.nativeSessionId })
        .then((record) => {
          if (!alive) return;
          asked.delete(seedKey);
          if (!record) return;
          usageRef.current = seedUsage(usageRef.current, key.id, record, Date.now());
          setUsageSeed((seed) => seed + 1);
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
      for (const seedKey of asked) usageSeedsRef.current.delete(seedKey);
    };
  }, [usageKeys, usageStore]);
  useEffect(() => {
    const save = (): void => {
      const records = exportUsage(usageRef.current, usageKeys, Date.now());
      if (records.length > 0) void usageStore.save(records).catch(() => undefined);
    };
    save();
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, [usageKeys, usageStep, usageStore]);

  /** Unread is a fold over successive projections (the package's ledger). */
  const unreadRef = useRef<UnreadLedger>(EMPTY_UNREAD_LEDGER);
  const visualIdsRef = useRef<ReadonlyMap<string, string>>(new Map());

  /** A pane link is only true while a pane is actually showing the replica: the
   * user can close that pane, and a bubble still drawn as linked would be the
   * monitor remembering an event instead of reporting a state. */
  const remotes = useMemo<readonly MonitorRemoteRecord[]>(
    () =>
      remoteField.rows.map((row) => {
        const link = links.get(remoteRowId(row.host.deviceId, row.session.sessionId));
        if (link === undefined || !paneSessionIds.has(link.localSessionId)) return { row };
        return { row, localSessionId: link.localSessionId };
      }),
    [remoteField.rows, links, paneSessionIds],
  );

  const managed = useMemo<readonly MonitorManagedRecord[]>(
    () => localRows.map((summary) => ({ summary })),
    [localRows],
  );
  /** The deck's panes, as terminal rows: the projection drops the ones a
   * managed row claims. A pane whose session exited stays out (a dead pane is
   * the deck's face to draw, not a row). */
  /**
   * SB-3 — a new terminal's spawn hint, from its row's FIRST appearance. The
   * views' physics reads a row's `spawnHint` only when it CREATES the body, and
   * the new shell's row can reach the stage (a pane's summary, the roster)
   * before the door answers — a hint stamped only on the answer came too late,
   * and the body landed away from where it was asked for. So while a create is
   * in flight, the first NEW local terminal row seen after it started (one no
   * row stood for then) takes its position; the door's answer stamps the
   * session it names (`spawnHints`), which corrects a claim that was another's.
   */
  const pendingSpawns = useRef<PendingSpawn[]>([]);
  const [spawnsVersion, setSpawnsVersion] = useState(0);
  const localTerminalIds = useRef<ReadonlySet<string>>(new Set());
  localTerminalIds.current = new Set([
    ...paneSessionIds,
    ...(panes.floor ?? []).map((row) => row.sessionId),
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
  const terminals = useMemo<readonly MonitorTerminalRecord[]>(
    () =>
      [...sessions.values()]
        .filter((session) => !session.exited)
        .map((session) => {
          const spawnHint = hintFor(session.id);
          return { session, ...(spawnHint !== undefined ? { spawnHint } : {}) };
        }),
    // the claims' own clock rides along: `hintFor` reads the claims it versions
    [sessions, spawnHints, spawnsVersion],
  );
  /** GT-6b — the floor's live PTYs, as the deck last read them. Keyed on the
   * facts a row draws rather than on array identity, for the same reason the
   * pane summaries are: the deck republishes on its own cadence. */
  const floorKey = JSON.stringify(
    (panes.floor ?? []).map((row) => [row.sessionId, row.workloadClass, row.title ?? ""]),
  );
  const floor = useMemo<readonly MonitorFloorRecord[]>(
    () =>
      (panes.floor ?? []).map((row) => {
        // a new shell can reach the stage through the roster first (SB-3)
        const spawnHint = hintFor(row.sessionId);
        return spawnHint === undefined ? row : { ...row, spawnHint };
      }),
    // keyed by the facts above, not by the array the deck handed over
    [floorKey, spawnHints, spawnsVersion],
  );

  const agents = useMemo(() => {
    const nowMs = Date.now();
    // The usage ledger is folded before assembly so every view reads the held
    // total and the stepped burn, never Core's moving estimate. `usageStep` is
    // its clock; the fold itself reads the wall clock.
    const usage = reconcileUsage(
      usageRef.current,
      localRows.map((row) => ({
        id: managedRowId(row),
        ...(row.monitor?.usage ? { usage: coreUsage(row.monitor.usage) } : {}),
      })),
      nowMs,
    );
    usageRef.current = usage;
    const assembled = assembleMonitorAgents({
      managed,
      terminals,
      floor,
      remotes,
      colours: { tint: palette.tint, neutral: palette.neutral },
      projectSeqs: projectLedger.seqByKey,
      usage: usage.histories,
      sessions,
      attachments,
      ...(panes.profileSets !== undefined ? { profileSets: panes.profileSets } : {}),
      visualIds: panes.terminalVisualIds,
      previousVisualIds: visualIdsRef.current,
      nowMs,
      ...(panes.activeSessionId !== undefined ? { activeSessionId: panes.activeSessionId } : {}),
      ...(selectedId !== undefined ? { previewSelectedId: selectedId } : {}),
    });
    visualIdsRef.current = new Map(
      assembled.map((agent) => [agent.id, agent.visualId ?? agent.id]),
    );
    const ledger = reconcileUnread(
      unreadRef.current,
      assembled.map((agent) => {
        const statusSince = agent.agent?.monitor?.statusSince;
        const statusSinceMs = statusSince === undefined ? Number.NaN : Date.parse(statusSince);
        return {
          id: agent.id,
          status: agent.status,
          active: agent.active,
          hasAgent: agent.agent !== undefined,
          ...(Number.isFinite(statusSinceMs) ? { statusSinceMs } : {}),
        };
      }),
      nowMs,
    );
    unreadRef.current = ledger;
    return assembled.map((agent) =>
      ledger.unreadIds.has(agent.id) ? { ...agent, unread: true } : agent,
    );
  }, [
    palette.tint,
    palette.neutral,
    projectLedger,
    selectedId,
    localRows,
    managed,
    terminals,
    floor,
    remotes,
    sessions,
    attachments,
    panes.activeSessionId,
    panes.terminalVisualIds,
    panes.profileSets,
    usageStep,
    usageSeed,
  ]);

  const announce = useCallback((message: string): void => {
    setAcknowledgement((current) => ({ nonce: (current?.nonce ?? 0) + 1, message }));
  }, []);

  /**
   * AR-4 — a run resumed into a new PTY. The fold's row names the PTY it
   * replaced (`terminal.replaced`), and the pane that was showing the old one
   * is handed the new one through the door, once per replacement — so a
   * resume-when-idle never leaves a pane on a dead PTY. A replacement no pane
   * shows is not this hook's business: the row is enough.
   */
  const remounted = useRef(new Set<string>());
  const remounting = useRef(new Set<string>());
  const remountAttempts = useRef(new Map<string, number>());
  useEffect(() => {
    if (door === null) return;
    for (const row of localRows) {
      const next = row.terminal?.runtimeSessionId;
      const old = row.terminal?.replaced;
      if (next === undefined || old === undefined) continue;
      const key = `${old}\u0000${next}`;
      if (remounted.current.has(key) || remounting.current.has(key)) continue;
      if (!paneSessionIds.has(old) || paneSessionIds.has(next)) continue;
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
            announce(`${projectLabel(row)} resumed in its pane`);
            return;
          }
          const last = attempt >= REMOUNT_ATTEMPTS;
          if (last) remounted.current.add(key);
          if (outcome.state === "no-pane") {
            announce(`${projectLabel(row)} resumed, but no pane was open to hand it to`);
            return;
          }
          announce(
            `${projectLabel(row)} resumed, but its pane could not be handed the new terminal — ${outcome.reason}${last ? "" : "; trying again"}`,
          );
        },
        () => {
          remounting.current.delete(key);
        },
      );
    }
  }, [door, localRows, paneSessionIds, announce]);

  /**
   * THE DOOR, opened (GT-D17). A remote row's select is the reference app's
   * `MonitorActions.select` contract finally meaning what it always said:
   * "Mount this session in the active pane".
   *
   * The mechanics are the deck's, not this hook's — `door.attach` is where the
   * runtime and the workspace live, and the one thing that crosses back is an
   * outcome. Every outcome is said out loud, including the two that are not
   * failures: a deck with no panes has nowhere to put a session, and a peer
   * that hands over a READ-ONLY session has still handed over one worth
   * watching. (That clause said "refuses mirror-write" until TM-3 deleted
   * VibeField's mirror-write capability, 2026-09-14 — the outcome is the peer's
   * verdict either way, and the renderer never held such a key.)
   */
  const attachRemote = useCallback(
    async (agent: MonitorAgent): Promise<void> => {
      const remote = agent.remote;
      if (remote === undefined) return;
      if (door === null) {
        // The one outcome that used to be silent, and the only path where
        // clicking a row did nothing without saying so. A door is null when no
        // deck exists yet — the overlay is still coming up, or this host has no
        // terminal bridge at all — and a row the mesh put on the stage is worth
        // an answer either way.
        announce(`${remote.deviceName} cannot be attached yet — the deck has no connection`);
        return;
      }
      if (!remote.attachable) {
        announce(`${remote.deviceName} is not sharing ${agent.project} for attachment`);
        return;
      }
      const outcome = await door.attach({
        deviceId: remote.deviceId,
        deviceName: remote.deviceName,
        remoteSessionId: remote.remoteSessionId,
      });
      if (outcome.state === "no-pane") {
        announce("no pane to attach to — open one in the deck first");
        return;
      }
      if (outcome.state === "failed") {
        announce(`${remote.deviceName} could not be attached — ${outcome.reason}`);
        return;
      }
      setLinks((current) => {
        const next = new Map(current);
        next.set(agent.id, { localSessionId: outcome.sessionId });
        return next;
      });
      // Mirror-write, honest and in the same breath as the success: the pane is
      // real either way, and which of the two it is decides whether typing into
      // it does anything. The pane carries the library's own "View only" face;
      // this is the monitor saying the same thing where the gesture happened.
      announce(
        outcome.readWrite
          ? `${agent.project} attached from ${remote.deviceName}`
          : `${agent.project} attached from ${remote.deviceName} — view only, the peer refuses writes`,
      );
    },
    [announce, door],
  );

  /**
   * A LOCAL row's select (AR-3): a managed agent's PTY, or an unclaimed
   * terminal, mounted in the pane the user is in. A row already showing there
   * is acknowledged rather than re-mounted; a row whose PTY the fold no longer
   * names (hosted: none) has nothing to mount and says so.
   */
  const mountLocal = useCallback(
    async (agent: MonitorAgent): Promise<void> => {
      // Three ways a row can name a mountable PTY, in descending order of
      // what the host knows about it: the summary a pane gave it, the floor id
      // a roster-only row carries (GT-6b), and the terminal join the fold
      // named for a managed run.
      const sessionId =
        agent.session?.id ??
        agent.floorSessionId ??
        agent.agent?.summary.terminal?.runtimeSessionId;
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
   * spawn bloom or the list's menu chose, else unbound — a hold with no menu
   * creates exactly as before it. The views match the body they drew at the
   * release point to the row by `spawnHint`, so the position is kept as given.
   * Every outcome is said, a refusal in fieldd's own words; a shell an older
   * daemon could not bind is kept, and said to be unbound. A create that opened
   * nothing then REJECTS with the sentence it said, so a view's pending body is
   * put away at once rather than waiting its birth out.
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
        position === undefined ? undefined : { position, known: localTerminalIds.current };
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
  const sources = useMemo<MonitorSourceCounts>(
    () => ({
      // Counted off the ASSEMBLED rows rather than the field's records: the
      // projection drops an exited run, and a claim of N agents over N-1 drawn
      // ones would be its own small dishonesty.
      local: agents.filter((agent) => agent.agent !== undefined).length,
      terminals: agents.filter((agent) => agent.agent === undefined && agent.remote === undefined)
        .length,
      remote: remotes.length,
      hosts: remoteField.hosts,
      localState: localField.state,
      ...(localField.reason !== undefined ? { localReason: localField.reason } : {}),
      remoteState: remoteField.state,
      ...(remoteField.reason !== undefined ? { remoteReason: remoteField.reason } : {}),
    }),
    [agents, remotes, remoteField, localField],
  );

  return {
    agents,
    actions,
    sources,
    acknowledgement,
    clearAcknowledgement,
  };
}
