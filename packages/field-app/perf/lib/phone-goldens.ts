import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentView,
  FrameScheduler,
  MonitorAgentRow,
  MonitorModelChange,
  MonitorModelSnapshot,
} from "@vibefield/puppeteer-view-sdk/model";
import {
  approachRecede,
  deviceWord,
  everyReceded,
  formatClock,
  formatPercent,
  formatShort,
  formatWords,
  RECEDE_MS,
  RECEDED_EMPTY_OPACITY,
  RECEDED_OPACITY,
  recedeTarget,
  STATE_WORDS,
  stateTone,
  THIS_DESKTOP,
} from "@vibefield/puppeteer-view-sdk/toolkit";
import {
  bubbleModel,
  DEFAULT_SWARM_PARAMETERS,
  MONITOR_VIEWS,
  type SwarmBubbleModel,
  workingShares,
} from "@vibefield/puppeteer-views";
import { keepsFailure } from "../../src/godview/monitor/failed-bodies";
import { createGodviewMonitorFeed } from "../../src/godview/monitor/model-replica";
import type { ModelBoardPort } from "../../src/godview/monitor/remote-door";
import { boardJoins, boardJoinsKey } from "../../src/godview/monitor/window-local";
import { createRowOrder, createWindowRows } from "../../src/godview/monitor/window-rows";

/**
 * PG-3a (Q-J1 (a), James 2026-11-01 03:55Z) — THE PHONE'S GOLDENS, COMPUTED: what the home's
 * window draws over the witness wire goldens, row for row, which the phone's Swift fold, replica
 * and body model (PG-3d, PG-3e) transcribe and are held to through the kit's byte-identical copies.
 *
 * The pipeline is the window's own, never a hand wiring of its parts: the REAL
 * `createGodviewMonitorFeed` (BoardScreen → the contract parse → `ModelBoardFold` →
 * `createMonitorReplica`) over a scripted `ModelBoardPort` that answers the witness open and then
 * hands it the frames one at a time, then J1 (a)'s step, the window's rows (`createWindowRows` and
 * `createRowOrder`, one instance of each across every step, with `boardJoins(...).sessionByRow`),
 * then puppeteer-views' body model as the swarm calls it (`AgentSwarm`: `bubbleModel` with each
 * row's working share, at the base scale). J1 (a): the phone equals its home's window, so home rows
 * are self and keep their owner's stale, and a peer greys by its desktop's standing.
 *
 * The phone has no panes, so this is the window with none: the replica's local join is the
 * window's visibility rule and nothing else (no attachments, no active pane, no visual ids), and
 * the order has no pane or floor sessions. The rule is `useMonitorAgents`': a row is drawn while it
 * is alive, or while it is a failure this desktop has a terminal join for (`keepsFailure` over
 * `boardJoins(...).sessionByRow`, Q06; `phoneVisible`), and the window hands the replica a new
 * predicate when the joins move: on the render the feed's own publish causes (the open's `live`),
 * before the replica's frame, so the open publishes once; and on the render a delta's publication
 * causes, which can publish again (`rejoined`). Exact for a window with no deck panes, which is the
 * honest limit of "row for row".
 *
 * Each step is a cut after ONE frame, as the window would draw if its frame landed there; two
 * frames the owner sends back to back are two steps (a peer's re-attach is its snapshot and then
 * its live state, fieldd `mesh-board.ts` `#onUpstream`), and 3d reproduces the cut without
 * designing for it.
 *
 * Deterministic: no clock value is recorded. The fold stamps `asOf` for a desktop first heard by a
 * snapshot (never recorded), the replica's clock stamps only window-joined terminal activity (none
 * joined). A bare terminal IS running here (`pty-h2` at the open), and the window draws its elapsed
 * line from its own first sight of the foreground job (`AgentSwarm`'s `runningSinceMs`); that is a
 * clock value, like `asOf`, so the body model is called without it and the line is left out, said in
 * the body golden's note. `nowMs` is a constant for the rest (a birth's opening; none here).
 */

const FIELD_APP = join(import.meta.dirname, "..", "..");
export const PHONE_GOLDENS_DIR = join(FIELD_APP, "test", "fixtures", "phone-godview");
export const PHONE_FOLD_GOLDEN = "phone-fold.golden.json";
export const PHONE_BODY_GOLDEN = "phone-body.golden.json";
export const PHONE_WITNESS_INPUTS = [
  "agent-remote-mesh-open.witness.json",
  "agent-remote-mesh-frames.witness.json",
  "agent-remote-mesh-open.resync.json",
] as const;
/** PG-1c — the whole-mesh resync is delivered after this frame (the live chains' last), before the
 * old chain's delta that is the run's gap */
export const PHONE_RESYNC_AFTER = 7;
export const PHONE_GOLDENS_COMMAND = "pnpm --filter @vibefield/field-app phone:goldens";

/** PG-4s — what a view lane's file exports (`perf/lib/phone-goldens-<view>.ts`): its golden's note and its compute.
 * The header around them is this file's (`phoneAllGoldenFiles`), so a lane writes only these two. */
export interface PhoneViewGolden {
  /** the golden's "//": what it records, how, and by which paths; it says "never over a defect" */
  note: string;
  /** the golden's `steps`: JSON-safe and deterministic, each step keyed by its `at` as the fold's are */
  compute(input: PhoneViewInput): unknown | Promise<unknown>;
}
/** What a view's compute reads: the window's drawn rows at every step of the witness run, and the clock. */
export interface PhoneViewInput {
  steps: readonly PhoneWindowStep[];
  nowMs: number;
}
/** One step's drawn rows, whole, as the window hands them to its view. Named apart from the fold step's `drawn` (its
 * ids) so `goldens.windowRows` and `step.drawn` cannot be misread (the design check's N2). */
export interface PhoneWindowStep {
  at: "open" | "resync" | number;
  frame?: FrameKind;
  gap?: true;
  rows?: readonly AgentView[];
}
/** The registry's shape: a view's manifest id → its lane file, imported lazily (no ESM cycle with this file). */
export type PhoneViewGoldens = Readonly<Record<string, () => Promise<{ golden: PhoneViewGolden }>>>;
/** PG-4s — THE PER-VIEW GOLDENS. One line per view lane (PG-5…8), its key the view's manifest id, which is the kit's
 * `GodviewViewChoice` raw value. `tsc` checks each literal path (`tsconfig.json` includes `perf`). */
export const PHONE_VIEW_GOLDENS: PhoneViewGoldens = {
  // list: () => import("./phone-goldens-list"),
  rain: () => import("./phone-goldens-rain"),
};
export const phoneViewGoldenName = (view: string): string => `phone-${view}.golden.json`;
/** where every view's golden and the toolkit's golden are mirrored: FieldHomeTests, where the views' suites run */
export const PHONE_VIEW_MIRROR = "apps/ios/VibeFieldKit/Tests/FieldHomeTests/Fixtures";
/** PG-4s (Q-S3 (a)) — the shared toolkit words, as the SDK says them over a fixed vector */
export const PHONE_TOOLKIT_GOLDEN = "phone-toolkit.golden.json";
/** PG-4t (Q3 (a)) — the views' faces as the registry's manifests carry them: what the phone's Stories row draws */
export const PHONE_MARKS_GOLDEN = "phone-marks.golden.json";
/** this folder: where a view lane's `phone-goldens-<view>.ts` lives */
export const PHONE_GOLDENS_LIB_DIR = import.meta.dirname;

/** where the kit's copies live: PG-3c's, PG-3d's parity suite in FieldProductTests, and PG-3e's body parity suite in
 * FieldMeshTests, where the mapping from a drawn row to its bubble lives (`scripts/check-ios-fixtures.mjs`
 * OTHER_ORIGINS compares them). (Corrected 2026-11-02, PG-3e: the body golden was named for FieldAgentsTests, a
 * bundle that holds no copy and whose target reads no FieldProduct, so it could never run the golden.) PG-4s: the
 * toolkit's golden and every registered view's, in FieldHomeTests, derived from the registry; `views` is for the
 * parity test's probe. */
export function phoneGoldenMirrors(
  views: PhoneViewGoldens = PHONE_VIEW_GOLDENS,
): Readonly<Record<string, readonly string[]>> {
  return {
    [PHONE_FOLD_GOLDEN]: [
      "apps/ios/VibeFieldKit/Tests/FieldMeshTests/Fixtures",
      "apps/ios/VibeFieldKit/Tests/FieldProductTests/Fixtures",
    ],
    [PHONE_BODY_GOLDEN]: ["apps/ios/VibeFieldKit/Tests/FieldMeshTests/Fixtures"],
    [PHONE_TOOLKIT_GOLDEN]: [PHONE_VIEW_MIRROR],
    [PHONE_MARKS_GOLDEN]: [PHONE_VIEW_MIRROR],
    ...Object.fromEntries(
      Object.keys(views).map((view) => [phoneViewGoldenName(view), [PHONE_VIEW_MIRROR]]),
    ),
  };
}
/** The mirrors of the registry as it stands; declared after it (a `const` read before its declaration is in its
 * temporal dead zone). */
export const PHONE_GOLDEN_MIRRORS = phoneGoldenMirrors();
/** the body model's clock: a constant. It would date a birth's opening (none here); a running
 * terminal's elapsed line reads `runningSinceMs`, which is not passed (a clock value, never compared) */
export const PHONE_BODY_NOW_MS = 1_790_803_300_000;

/** The three puppeteer packages the goldens are computed by, read by path: puppeteer-views'
 * exports map has no `./package.json`, so no import can read its version. */
export function puppeteerVersions(): { monitor: string; "view-sdk": string; views: string } {
  const version = (name: string): string =>
    (
      JSON.parse(
        readFileSync(join(FIELD_APP, "node_modules", "@vibefield", name, "package.json"), "utf8"),
      ) as { version: string }
    ).version;
  return {
    monitor: version("puppeteer-monitor"),
    "view-sdk": version("puppeteer-view-sdk"),
    views: version("puppeteer-views"),
  };
}

/**
 * The window's visibility rule (`useMonitorAgents`, Q06): a row is drawn while it is alive, or while
 * it is a failure this desktop has a terminal join for (`keepsFailure` over the board's joins). The
 * ONE predicate the computation hands the replica, and `PHONE_VISIBLE` is how the fold golden's
 * header states it (the parity test holds the two together).
 */
export function phoneVisible(
  sessionByRow: ReadonlyMap<string, string>,
): (row: MonitorAgentRow) => boolean {
  return (row) => row.alive || keepsFailure(row, sessionByRow);
}
export const PHONE_VISIBLE = {
  alive: true,
  keepsFailure: "boardJoins(held, here).sessionByRow",
} as const;

/** One delivery after the open: a per-device frame (its index in the frames golden), or the
 * whole-mesh resync, which the door delivers as a `snapshot` (PG-1c). */
export type WitnessDelivery = { at: number; frame: unknown } | { at: "resync"; resync: unknown };

export function readWitnessInputs(): { open: unknown; deliveries: readonly WitnessDelivery[] } {
  const read = (name: string): unknown =>
    JSON.parse(readFileSync(join(FIELD_APP, "..", "contracts", "fixtures", name), "utf8"));
  const frames = read(PHONE_WITNESS_INPUTS[1]) as unknown[];
  const deliveries: WitnessDelivery[] = [];
  for (const [index, frame] of frames.entries()) {
    deliveries.push({ at: index, frame });
    if (index === PHONE_RESYNC_AFTER)
      deliveries.push({ at: "resync", resync: read(PHONE_WITNESS_INPUTS[2]) });
  }
  return { open: read(PHONE_WITNESS_INPUTS[0]), deliveries };
}

type FrameKind = "delta" | "snapshot" | "state" | "resync";
type Publication = { added: string[]; updated: string[]; removed: string[] };

/** One drawn row as the fold golden records it. */
export interface PhoneFoldRow {
  id: string;
  /** the board key it rode in on (`runtimeRunId`): 3d keeps it beside the model id */
  key: string;
  device: string;
  self: boolean;
  unread: boolean;
  stale: boolean;
  cost: { usd: number; coverage: string; burnPerHour?: number } | null;
}

export interface PhoneFoldStep {
  at: "open" | "resync" | number;
  frame?: FrameKind;
  /** the replica's next publication's frame could not be followed: the window re-opens (M23) */
  gap?: true;
  /** the fold's own chain: the revision of the last update it handed the replica */
  foldRevision?: number;
  /** the replica's published `model.revision`: behind the fold's after a frame that changed nothing */
  modelRevision?: number;
  devices?: { device: string; state: string }[];
  /** what the fold handed the replica for this frame, by model id; null: nothing */
  fold?: { upserts: string[]; removed: string[] } | null;
  /** the replica's publication for this frame; null: it published nothing */
  changes?: Publication | null;
  /** the publication of the window's re-join when the board's joins moved (a new visibility
   * predicate: a kept failure shown); null: the joins did not move, or nothing re-joined */
  rejoined?: Publication | null;
  /** `model.agents`, the contract's order (agents by birth, then terminals, ties by id) */
  ids?: string[];
  /** J1 (a): the window's order (this desktop's agents by birth, its terminals, then each desktop in place) */
  drawn?: string[];
  rows?: PhoneFoldRow[];
}

/** A copy line: its key and text, `italic` where the style is (a configured effort, launch intent),
 * and the state line's mark (`icon`). */
export interface PhoneCopyLine {
  key: string;
  text: string;
  italic?: true;
  icon?: string;
}

export interface PhoneBody {
  id: string;
  state: SwarmBubbleModel["state"];
  appearance: SwarmBubbleModel["appearance"];
  radius: number;
  copy: PhoneCopyLine[];
  top: { text: string; hot: boolean; none: boolean } | null;
  bottom: { text: string; none: boolean } | null;
  burn: { lit: number; priced: boolean } | null;
  light: string | null;
  ring: { percent: number; hot: boolean } | null;
  unread: boolean;
  stale: boolean;
  hollow: boolean;
  running: boolean;
  blockerKind: string | null;
}

export interface PhoneBodyStep {
  at: "open" | "resync" | number;
  frame?: FrameKind;
  gap?: true;
  bodies?: PhoneBody[];
}

export interface PhoneGoldens {
  fold: PhoneFoldStep[];
  body: PhoneBodyStep[];
  /** PG-4s — the window's drawn rows at every step, whole: what a view's golden computes from. Never printed in the
   * fold or body golden. */
  windowRows: PhoneWindowStep[];
}

/** A frame scheduler drained by hand, once per step (the window's is the browser's frame). */
function manualFrame(): FrameScheduler & { flush(): void } {
  const queue: Array<{ work: () => void; cancelled: boolean }> = [];
  return {
    request(work) {
      const entry = { work, cancelled: false };
      queue.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    flush() {
      while (queue.length > 0) {
        const entry = queue.shift();
        if (entry && !entry.cancelled) entry.work();
      }
    },
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function frameKind(frame: unknown): FrameKind {
  const value = frame as Record<string, unknown>;
  return "delta" in value ? "delta" : "snapshot" in value ? "snapshot" : "state";
}

/**
 * The row's cost as the backend priced it, without its series. (Corrected 2026-11-02, PG-3d: this
 * said the series was "a drawing fact the phone keeps none of". The kit's replica keeps it, pinned
 * beside this golden by RemoteMeshCopyTests.costKeepsItsSeries, and the phone's spend view (PG-5…8)
 * is the reader that will draw it. The golden leaves it out: its parity rows do not compare it.)
 */
function costOf(row: AgentView): PhoneFoldRow["cost"] {
  const cost = row.cost;
  if (cost === undefined) return null;
  return {
    usd: cost.usd,
    coverage: cost.coverage,
    ...(cost.burnPerHour !== undefined ? { burnPerHour: cost.burnPerHour } : {}),
  };
}

function bodyOf(model: SwarmBubbleModel): PhoneBody {
  const top = model.figures?.top;
  const bottom = model.figures?.bottom;
  return {
    id: model.id,
    state: model.state,
    appearance: model.appearance,
    radius: model.radius,
    copy: model.copy.map((line) => ({
      key: line.key,
      text: line.text,
      ...(line.style.italic === true ? { italic: true as const } : {}),
      ...(line.key === "state" && line.lead?.kind === "icon" && line.lead.icon !== undefined
        ? { icon: line.lead.icon }
        : {}),
    })),
    top: top === undefined ? null : { text: top.text, hot: top.hot, none: top.none },
    bottom: bottom === undefined ? null : { text: bottom.text, none: bottom.none },
    burn: model.burn ?? null,
    light: model.light ?? null,
    ring: model.ring === undefined ? null : { percent: model.ring.percent, hot: model.ring.hot },
    unread: model.unread,
    stale: model.stale,
    hollow: model.hollow,
    running: model.running,
    blockerKind: model.blockerKind ?? null,
  };
}

/** The window's bodies for its drawn rows, as `AgentSwarm` builds them, at scale 1 (fit is a layout
 * fact), without `runningSinceMs` (the window's own first-sight clock) or a profile line (the
 * window's spawn menu names it; the phone has none). */
function bodiesOf(rows: readonly AgentView[]): PhoneBody[] {
  const shares = workingShares(rows);
  return rows.map((agent) =>
    bodyOf(
      bubbleModel({
        agent,
        parameters: DEFAULT_SWARM_PARAMETERS,
        nowMs: PHONE_BODY_NOW_MS,
        unread: agent.unread,
        workingShare: shares.get(agent.id) ?? 0,
      }),
    ),
  );
}

/**
 * The goldens' steps over a witness open and its frames: one step for the open and one per frame,
 * the run ending at the first gap (the window asks again, M23, and the fresh open is another run).
 */
export async function computePhoneGoldens(input: {
  open: unknown;
  deliveries: readonly WitnessDelivery[];
}): Promise<PhoneGoldens> {
  const scheduler = manualFrame();
  let sink: ((payload: unknown, kind?: "snapshot" | "delta") => void) | null = null;
  let opens = 0;
  const port: ModelBoardPort = {
    subscribe: async (onFrame) => {
      opens += 1;
      // the re-open a gap asks for: this run ends there
      if (opens > 1) return new Promise(() => undefined);
      sink = onFrame;
      return {
        snapshot: structuredClone(input.open),
        unsubscribe: () => {
          if (sink === onFrame) sink = null;
        },
      };
    },
    reportShown: async () => ({ reported: true }),
  };
  const feed = createGodviewMonitorFeed({ board: port, scheduler });
  const { replica } = feed;
  // What the fold hands the replica, observed at the replica's door: the fold's own chain (its
  // revision moves on a frame whose rows are all as they were, which the replica then does not publish).
  let handed: MonitorModelSnapshot | MonitorModelChange | null = null;
  const apply = replica.apply.bind(replica);
  replica.apply = (update) => {
    handed = update;
    return apply(update);
  };
  let published: Publication | null = null;
  const offPublished = replica.subscribe(() => {
    const { changes } = replica.getSnapshot();
    published = {
      added: [...changes.added],
      updated: [...changes.updated],
      removed: [...changes.removed],
    };
  });
  // The window's visibility (`phoneVisible`), handed to the replica anew whenever the board's joins
  // move, as the window's memo does.
  let joinsKey: string | null = null;
  const rejoin = (): boolean => {
    const held = feed.heldRows();
    const here = feed.here();
    const key = boardJoinsKey(held, here);
    if (key === joinsKey) return false;
    joinsKey = key;
    const sessionByRow = boardJoins(held, here).sessionByRow;
    replica.setLocal({
      attachments: new Map(),
      activeIds: new Set(),
      spawnHints: new Map(),
      visible: phoneVisible(sessionByRow),
    });
    return true;
  };
  rejoin();
  // The render the feed's own publish causes (`useMonitorAgents` subscribes to the feed: the open's
  // `live`, a desktop's standing): it reads the fold's joins and re-joins before the replica's frame
  // is drawn, so the open publishes once with every kept failure in it. The window's open is a race
  // that render usually wins against the frame; 3d holds `drawn`, not the order of publications.
  // After a delta only the replica's own publication causes a render (`settleStep`'s re-join).
  const offFeed = feed.subscribe(() => {
    rejoin();
  });
  /** what the replica published since the last read; null: nothing */
  const take = (): Publication | null => {
    const was = published;
    published = null;
    return was;
  };
  const windowRows = createWindowRows();
  const orderFor = createRowOrder();
  let foldRevision = 0;

  /** After a delivery: the frame's publication, then the window's re-join if the joins moved. */
  const settleStep = (): { changes: Publication | null; rejoined: Publication | null } => {
    scheduler.flush();
    const changes = take();
    if (!rejoin()) return { changes, rejoined: null };
    scheduler.flush();
    return { changes, rejoined: take() };
  };

  const step = (
    at: "open" | "resync" | number,
    kind: FrameKind | undefined,
    heard: { changes: Publication | null; rejoined: Publication | null },
  ): [PhoneFoldStep, PhoneBodyStep, PhoneWindowStep] => {
    const update = handed as MonitorModelSnapshot | MonitorModelChange | null;
    if (update !== null) foldRevision = update.revision;
    const fold =
      update === null
        ? null
        : "rows" in update
          ? { upserts: update.rows.map((row) => row.id), removed: [] }
          : { upserts: update.upserts.map((row) => row.id), removed: [...update.removed] };
    const { model } = replica.getSnapshot();
    const held = feed.heldRows();
    const here = feed.here();
    const devices = feed.devices();
    const rows = windowRows.rowsFor(model, {
      standing: new Map(devices.map((entry) => [entry.device, entry.state] as const)),
      order: orderFor(held, here, { sessionIds: [] }),
      sessionByRow: boardJoins(held, here).sessionByRow,
      visualIds: undefined,
    });
    const frame = kind === undefined ? {} : { frame: kind };
    const foldStep: PhoneFoldStep = {
      at,
      ...frame,
      foldRevision,
      modelRevision: model.revision,
      devices: devices.map((entry) => ({ device: entry.device, state: entry.state })),
      fold,
      changes: heard.changes,
      rejoined: heard.rejoined,
      ids: model.agents.map((row) => row.id),
      drawn: rows.map((row) => row.id),
      rows: rows.map((row) => {
        const kept = feed.held(row.id);
        // a drawn row the fold no longer holds would lose its key: a defect, never a fallback
        if (kept === undefined)
          throw new Error(`step ${at}: drawn ${row.id} is not held by the fold`);
        return {
          id: row.id,
          key: kept.board.runtimeRunId,
          device: row.device.id,
          self: row.device.self,
          unread: row.unread,
          stale: row.stale,
          cost: costOf(row),
        };
      }),
    };
    handed = null;
    // the rows whole, for a view's golden: cloned, so a later step can never rewrite an earlier one (Q-S9)
    const windowStep: PhoneWindowStep = { at, ...frame, rows: structuredClone(rows) };
    return [foldStep, { at, ...frame, bodies: bodiesOf(rows) }, windowStep];
  };

  const fold: PhoneFoldStep[] = [];
  const body: PhoneBodyStep[] = [];
  const windowSteps: PhoneWindowStep[] = [];
  try {
    await settle();
    const opened = settleStep();
    const state = feed.state();
    if (state.state !== "live")
      throw new Error(`the witness open was not read: ${JSON.stringify(state)}`);
    let [foldStep, bodyStep, windowStep] = step("open", undefined, opened);
    fold.push(foldStep);
    body.push(bodyStep);
    windowSteps.push(windowStep);
    for (const delivery of input.deliveries) {
      const deliver = sink as ((payload: unknown, kind?: "snapshot" | "delta") => void) | null;
      if (deliver === null) throw new Error(`step ${delivery.at}: the board closed before it`);
      // the door hands a per-device frame as a delta, and PG-1c's whole mesh as a snapshot
      const kind: FrameKind = "resync" in delivery ? "resync" : frameKind(delivery.frame);
      if ("resync" in delivery) deliver(structuredClone(delivery.resync), "snapshot");
      else deliver(structuredClone(delivery.frame), "delta");
      const heard = settleStep();
      if (opens > 1) {
        fold.push({ at: delivery.at, frame: kind, gap: true });
        body.push({ at: delivery.at, frame: kind, gap: true });
        windowSteps.push({ at: delivery.at, frame: kind, gap: true });
        break;
      }
      [foldStep, bodyStep, windowStep] = step(delivery.at, kind, heard);
      fold.push(foldStep);
      body.push(bodyStep);
      windowSteps.push(windowStep);
    }
  } finally {
    offPublished();
    offFeed();
    feed.dispose();
  }
  return { fold, body, windowRows: windowSteps };
}

const FOLD_NOTE =
  "PG-3a — the phone's fold parity golden (Q-J1 (a), James 2026-11-01: the phone equals its home's window row for row). GENERATED by packages/field-app/perf/phone-goldens.generate.perf.ts (pnpm --filter @vibefield/field-app phone:goldens) from contracts' agent-remote-mesh-{open,frames}.witness.json and agent-remote-mesh-open.resync.json (PG-1c's whole mesh, delivered as a snapshot after frame 7) through the window's own feed (createGodviewMonitorFeed: BoardScreen → the parse → ModelBoardFold → createMonitorReplica) and its rows (createWindowRows, createRowOrder, boardJoins), as a window with no deck panes. visible (the header's field): a row is drawn while alive, or while it is a failure with a terminal join here (keepsFailure over boardJoins' sessionByRow, Q06), the predicate handed anew when the joins move: on the render the feed's own publish causes (the open's live, a desktop's standing), before the replica's frame, and after a delta's publication. The window's open is a race that render usually wins against the frame, so the open publishes once with every kept failure in it; 3d holds drawn, not the order of publications. Each step is a cut after ONE frame, as the window draws if its frame lands there: step 4's grey Loft is mesh-board's own order (fieldd mesh-board.ts #onUpstream broadcasts a re-attached peer's snapshot, then its live state), a cut 3d reproduces and does not design for. Per step: foldRevision (the fold's chain) and modelRevision (the replica's publication; behind after a frame that changed nothing), each desktop's standing, what the fold handed the replica, what the replica published (changes; null: nothing) and what the window's re-join published (rejoined; null: none), ids (the contract's order) and drawn (the window's order), and each drawn row's key, self, unread, stale and cost (no series). Never asOf. Pinned byte for byte by packages/field-app/test/phone-parity.test.ts, the kit's copy by pnpm check:ios-fixtures (OTHER_ORIGINS). Never edit by hand; a regeneration is a re-bless, said in its commit (step, field, cause), and never over a defect (PG-3a0's rule).";

const BODY_NOTE =
  "PG-3a — the phone's body golden (the IOS-6a method): puppeteer-views' bubbleModel over the window's drawn rows of phone-fold.golden.json, per step, at scale 1 with each row's working share. Per body: id, state, appearance, the base radius, copy as {key, text, italic (a configured effort's launch intent), icon (the state line's mark)}, the top figure {text, hot, none}, the bottom figure {text, none} and the burn (working bodies only; null otherwise), light, the ring {percent, hot}, unread, stale, hollow, running, blockerKind. Not here: accent (the theme's; the phone's colour is ProjectLedger's); ariaLabel and title (they carry the burn's unit, Q-J3, 3e's); a running terminal's elapsed line (the window's own clock from its first sight of the foreground job, AgentSwarm's runningSinceMs: a clock value, never compared, like asOf; the phone keeps its own); and a terminal's profile line (AgentSwarm's terminalProfile, named from the window's spawn menu; the phone has none). GENERATED by packages/field-app/perf/phone-goldens.generate.perf.ts (pnpm --filter @vibefield/field-app phone:goldens); pinned byte for byte by packages/field-app/test/phone-parity.test.ts, the kit's copy by pnpm check:ios-fixtures. A puppeteer EL8 moves it: regenerate and copy to the kit in the same commit. Never edit by hand; a regeneration is a re-bless, said in its commit, and never over a defect.";

/** JSON with one object per line inside every array, the objects inside a step printed whole on
 * their line, so a diff reads row by row. */
function printed(value: unknown, depth: number, indent: string): string {
  const flat =
    value === null ||
    typeof value !== "object" ||
    (Array.isArray(value)
      ? value.every((item) => item === null || typeof item !== "object")
      : depth >= 3);
  if (flat) return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((item) => `${inner}${printed(item, depth + 1, inner)}`).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, item]) => item !== undefined,
  );
  return `{\n${entries
    .map(([key, item]) => `${inner}${JSON.stringify(key)}: ${printed(item, depth + 1, inner)}`)
    .join(",\n")}\n${indent}}`;
}

/** The two goldens' bytes, as the generator writes them and the parity test compares them. */
export function phoneGoldenFiles(goldens: PhoneGoldens): Record<string, string> {
  const versions = puppeteerVersions();
  const { radiusIdle, radiusWorking, radiusWorkingMax, radiusBlocked } = DEFAULT_SWARM_PARAMETERS;
  return {
    [PHONE_FOLD_GOLDEN]: `${printed(
      {
        "//": FOLD_NOTE,
        versions,
        self: "home",
        visible: PHONE_VISIBLE,
        inputs: [...PHONE_WITNESS_INPUTS],
        steps: goldens.fold,
      },
      0,
      "",
    )}\n`,
    [PHONE_BODY_GOLDEN]: `${printed(
      {
        "//": BODY_NOTE,
        versions,
        self: "home",
        parameters: { radiusIdle, radiusWorking, radiusWorkingMax, radiusBlocked },
        nowMs: PHONE_BODY_NOW_MS,
        inputs: [...PHONE_WITNESS_INPUTS],
        steps: goldens.body,
      },
      0,
      "",
    )}\n`,
  };
}

const TOOLKIT_NOTE =
  'PG-4s (Q-S3 (a)) — the phone Godview\'s shared toolkit words, as puppeteer-view-sdk\'s ./toolkit says them over a fixed vector, one entry per call: STATE_WORDS verbatim (five groups, 14 words); the recede constants and THIS_DESKTOP; and under calls, formatShort, formatWords, formatClock, formatPercent, deviceWord, stateTone (status × kind × unread), recedeTarget, everyReceded and approachRecede, each {inputs…, out}. A non-JSON input is a tagged string (in: "NaN", "Infinity", "-Infinity", "undefined"). formatClock reads the LOCAL zone, so it is pinned zone-free: each entry names wall components [year, month, day, hours, minutes, seconds, ms] and a fraction of a ms, the instant is built from them in the computing host\'s own zone and never recorded, and the dates are mid-month weekdays (no zone\'s transition day) at hours outside 01:00-03:59. The kit\'s Godview/Toolkit (FieldHome) is held to it by FieldHomeTests\' copy (GodviewToolkitParityTests), the copy by pnpm check:ios-fixtures. GENERATED by packages/field-app/perf/phone-goldens.generate.perf.ts (pnpm --filter @vibefield/field-app phone:goldens). A puppeteer EL8 moves it: regenerate and copy to the kit in the same commit. Never edit by hand; a regeneration is a re-bless, said in its commit, and never over a defect.';

/** A number the toolkit takes, as the golden can carry it: JSON's own, or a tag for what JSON cannot hold. */
type Tagged = number | "NaN" | "Infinity" | "-Infinity" | "undefined";
function untag(value: Tagged): number | undefined {
  if (value === "undefined") return undefined;
  if (value === "NaN") return Number.NaN;
  if (value === "Infinity") return Number.POSITIVE_INFINITY;
  if (value === "-Infinity") return Number.NEGATIVE_INFINITY;
  return value;
}

/** The vector: lengths in ms (the ties 499/500 and 59 499/59 500, the negative clamp, the hour edges, absurd and
 * non-finite inputs). */
const SHORT_MS: readonly Tagged[] = [
  0,
  499,
  500,
  1_000,
  44_999,
  59_499,
  59_500,
  60_000,
  659_000,
  3_599_999,
  3_600_000,
  3_660_000,
  8_040_000,
  7_200_000,
  259_200_001,
  -500,
  -5_000,
  1e25,
  2 ** 60,
  "NaN",
  "Infinity",
  "-Infinity",
];
const WORDS_MS: readonly Tagged[] = [
  0,
  29_999,
  30_000,
  60_000,
  89_999,
  90_000,
  120_000,
  3_570_000,
  3_600_000,
  3_660_000,
  3_720_000,
  7_200_000,
  7_260_000,
  90_000_000,
  -60_000,
  1e25,
  "NaN",
  "Infinity",
];
/** Wall components [y, mo, d, h, mi, s, ms] and a fraction of a ms (TimeClip truncates it). Mid-month weekdays, at
 * hours outside 01:00-03:59, so no zone's transition can move them (the design check's N4). */
const CLOCK_WALLS: ReadonlyArray<{
  wall: readonly [number, number, number, number, number, number, number];
  frac: number;
}> = [
  { wall: [2026, 11, 11, 14, 5, 9, 0], frac: 0 },
  { wall: [2026, 7, 15, 0, 0, 0, 0], frac: 0 },
  { wall: [2026, 5, 20, 23, 59, 59, 999], frac: 0.75 },
  { wall: [2026, 10, 13, 9, 7, 3, 500], frac: 0.25 },
  { wall: [2026, 2, 17, 12, 30, 0, 999], frac: 0.999 },
  { wall: [2025, 12, 16, 18, 45, 59, 0], frac: 0 },
];
const PERCENTS: ReadonlyArray<{ in: Tagged; missing?: string }> = [
  { in: 0 },
  { in: 42.9 },
  { in: 99.99 },
  { in: 100 },
  { in: 140.5 },
  { in: -0.5 },
  { in: 7 },
  { in: "undefined" },
  { in: "NaN" },
  { in: "Infinity" },
  { in: "-Infinity" },
  { in: "undefined", missing: "n/a" },
  { in: "NaN", missing: "" },
  { in: 12.5, missing: "n/a" },
];

/** PG-4s — the toolkit's golden: the SDK's own words over a fixed vector, one entry per call. */
export function phoneToolkitGolden(): Record<string, unknown> {
  const statuses = ["idle", "working", "blocked"] as const;
  const kinds = ["agent", "terminal"] as const;
  const bools = [false, true] as const;
  return {
    "//": TOOLKIT_NOTE,
    versions: puppeteerVersions(),
    STATE_WORDS,
    constants: { RECEDED_OPACITY, RECEDED_EMPTY_OPACITY, RECEDE_MS, THIS_DESKTOP },
    calls: {
      formatShort: SHORT_MS.map((ms) => ({ in: ms, out: formatShort(untag(ms) as number) })),
      formatWords: WORDS_MS.map((ms) => ({ in: ms, out: formatWords(untag(ms) as number) })),
      formatClock: CLOCK_WALLS.flatMap(({ wall, frac }) => {
        const [year, month, day, hours, minutes, seconds, ms] = wall;
        const at = new Date(year, month - 1, day, hours, minutes, seconds, ms).getTime() + frac;
        return bools.map((withSeconds) => ({
          wall: [...wall],
          frac,
          withSeconds,
          out: formatClock(at, withSeconds),
        }));
      }),
      formatPercent: PERCENTS.map((entry) => ({
        ...entry,
        out:
          entry.missing === undefined
            ? formatPercent(untag(entry.in))
            : formatPercent(untag(entry.in), entry.missing),
      })),
      deviceWord: [
        { self: true, name: "Studio" },
        { self: false, name: "Loft" },
        { self: false, name: "" },
      ].map((device) => ({ ...device, out: deviceWord(device) })),
      stateTone: statuses.flatMap((status) =>
        kinds.flatMap((kind) =>
          bools.map((unread) => ({
            status,
            kind,
            unread,
            out: stateTone({ status, kind, unread }),
          })),
        ),
      ),
      recedeTarget: bools.flatMap((receded) =>
        bools.map((every) => ({ receded, every, out: recedeTarget(receded, every) })),
      ),
      everyReceded: [[], [false], [true, false], [true, true]].map((receded) => ({
        in: receded,
        out: everyReceded(receded.map((value) => ({ receded: value }))),
      })),
      approachRecede: [
        { current: 1, target: RECEDED_OPACITY, deltaMs: 16 },
        { current: RECEDED_OPACITY, target: 1, deltaMs: 16 },
        { current: 0.99, target: 1, deltaMs: 16 },
        { current: 1, target: 1, deltaMs: 16 },
        { current: 0.5, target: 1, deltaMs: -16 },
        { current: RECEDED_OPACITY, target: RECEDED_EMPTY_OPACITY, deltaMs: 240 },
      ].map((entry) => ({
        ...entry,
        out: approachRecede(entry.current, entry.target, entry.deltaMs),
      })),
    },
  };
}

const MARKS_NOTE =
  "PG-4t (Q3 (a)) — the Godview views' faces as puppeteer-views' registry carries them (MONITOR_VIEWS, in its order, the phone's Stories row's): each view's manifest id, its label, and its mark {viewBox, paths}, the paths the filled outlines puppeteer-view-sdk's mark-outline writes (MV-D6). The kit's FieldHome/Godview/GodviewViewMarks.swift transcribes every mark once, in its authoring form, and writes the same outlines: FieldHomeTests' copy holds it to them (GodviewViewMarksTests, M1), the copy by pnpm check:ios-fixtures. GENERATED by packages/field-app/perf/phone-goldens.generate.perf.ts (pnpm --filter @vibefield/field-app phone:goldens). A puppeteer EL8 moves it: regenerate and copy to the kit in the same commit. Never edit by hand; a regeneration is a re-bless, said in its commit, and never over a defect.";

/** PG-4t — the marks golden: every registered view's face, in the registry's order. */
export function phoneMarksGolden(): Record<string, unknown> {
  return {
    "//": MARKS_NOTE,
    versions: puppeteerVersions(),
    views: MONITOR_VIEWS.map(({ id, label, mark }) => ({
      id,
      label,
      mark: { viewBox: mark.viewBox, paths: [...mark.paths] },
    })),
  };
}

/** PG-4s — ONE WRITER OF EVERY PHONE GOLDEN: the fold and body goldens, the toolkit's, and one per registered view
 * (`views` is for the parity test's probe). The generator writes exactly these, and the parity test compares them.
 * A view's file is this file's header around its lane's note and compute's steps, over the window's rows cloned
 * (a compute cannot reach the goldens it shares them with). */
export async function phoneAllGoldenFiles(
  goldens: PhoneGoldens,
  views: PhoneViewGoldens = PHONE_VIEW_GOLDENS,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {
    ...phoneGoldenFiles(goldens),
    [PHONE_TOOLKIT_GOLDEN]: `${printed(phoneToolkitGolden(), 0, "")}\n`,
    [PHONE_MARKS_GOLDEN]: `${printed(phoneMarksGolden(), 0, "")}\n`,
  };
  for (const [view, load] of Object.entries(views)) {
    const { golden } = await load();
    const steps = await golden.compute({
      steps: structuredClone(goldens.windowRows),
      nowMs: PHONE_BODY_NOW_MS,
    });
    files[phoneViewGoldenName(view)] = `${printed(
      {
        "//": golden.note,
        versions: puppeteerVersions(),
        self: "home",
        view,
        nowMs: PHONE_BODY_NOW_MS,
        inputs: [...PHONE_WITNESS_INPUTS],
        steps,
      },
      0,
      "",
    )}\n`;
  }
  return files;
}

/** PG-4s — a lane file (`phone-goldens-<view>.ts`) in `dir` whose view the registry does not name: a golden no
 * one writes. */
export function unregisteredViewFiles(
  dir: string,
  views: PhoneViewGoldens = PHONE_VIEW_GOLDENS,
): string[] {
  return readdirSync(dir)
    .filter((name) => /^phone-goldens-[a-z0-9-]+\.ts$/.test(name))
    .filter((name) => !Object.hasOwn(views, name.slice("phone-goldens-".length, -".ts".length)))
    .sort();
}

/** PG-4s — a `phone-*.golden.json` in `dir` that `files` (the one writer's map) does not write: a golden committed
 * and left behind. */
export function orphanGoldens(dir: string, files: Readonly<Record<string, string>>): string[] {
  return readdirSync(dir)
    .filter((name) => /^phone-.+\.golden\.json$/.test(name) && !Object.hasOwn(files, name))
    .sort();
}

/** What moved between a committed golden and the computation: one line per step and field, for
 * the re-bless the commit must say. */
export function goldenChanges(before: string, after: string): string[] {
  if (before === after) return [];
  type File = Record<string, unknown> & { steps?: Array<Record<string, unknown>> };
  let was: File;
  let now: File;
  try {
    was = JSON.parse(before) as File;
    now = JSON.parse(after) as File;
  } catch {
    return ["the file does not parse: rewritten whole"];
  }
  const lines: string[] = [];
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (key === "steps") continue;
    if (JSON.stringify(was[key]) !== JSON.stringify(now[key])) lines.push(`header: ${key}`);
  }
  // steps pair by their `at`, so a step added or dropped reads as one, never as every step after it
  const byAt = (steps: Array<Record<string, unknown>>) =>
    new Map(steps.map((entry, index) => [String(entry["at"] ?? index), entry]));
  const wasSteps = byAt(was.steps ?? []);
  const nowSteps = byAt(now.steps ?? []);
  for (const at of new Set([...wasSteps.keys(), ...nowSteps.keys()])) {
    const left = wasSteps.get(at);
    const right = nowSteps.get(at);
    if (left === undefined || right === undefined) {
      lines.push(`step ${at}: ${left === undefined ? "a new step" : "the step is gone"}`);
      continue;
    }
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (JSON.stringify(left[key]) !== JSON.stringify(right[key]))
        lines.push(`step ${at}: ${key}`);
    }
  }
  return lines;
}
