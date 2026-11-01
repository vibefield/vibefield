import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentView,
  FrameScheduler,
  MonitorModelChange,
  MonitorModelSnapshot,
} from "@vibefield/puppeteer-view-sdk/model";
import {
  bubbleModel,
  DEFAULT_SWARM_PARAMETERS,
  type SwarmBubbleModel,
  workingShares,
} from "@vibefield/puppeteer-views";
import { createGodviewMonitorFeed } from "../../src/godview/monitor/model-replica";
import type { ModelBoardPort } from "../../src/godview/monitor/remote-door";
import { boardJoins } from "../../src/godview/monitor/window-local";
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
 * The phone has no panes, so this is the window with none: the replica's local join is VibeField's
 * `visible: row => row.alive` and nothing else (no attachments, no active pane, no visual ids), and
 * the order has no pane or floor sessions. Exact for a window with no deck panes, which is the
 * honest limit of "row for row".
 *
 * Deterministic: no clock is read. The fold stamps `asOf` for a desktop first heard by a snapshot
 * (never recorded here), the replica's clock stamps only window-joined terminal activity (none),
 * and the body model reads `nowMs` only for a terminal's elapsed time or a birth's opening (none);
 * it is a constant all the same.
 */

const FIELD_APP = join(import.meta.dirname, "..", "..");
export const PHONE_GOLDENS_DIR = join(FIELD_APP, "test", "fixtures", "phone-godview");
export const PHONE_FOLD_GOLDEN = "phone-fold.golden.json";
export const PHONE_BODY_GOLDEN = "phone-body.golden.json";
export const PHONE_WITNESS_INPUTS = [
  "agent-remote-mesh-open.witness.json",
  "agent-remote-mesh-frames.witness.json",
] as const;
export const PHONE_GOLDENS_COMMAND = "pnpm --filter @vibefield/field-app phone:goldens";
/** where PG-3c puts the kit's copies (`scripts/check-ios-fixtures.mjs` OTHER_ORIGINS compares them) */
export const PHONE_GOLDEN_MIRRORS: Readonly<Record<string, readonly string[]>> = {
  [PHONE_FOLD_GOLDEN]: ["apps/ios/VibeFieldKit/Tests/FieldMeshTests/Fixtures"],
  [PHONE_BODY_GOLDEN]: ["apps/ios/VibeFieldKit/Tests/FieldAgentsTests/Fixtures"],
};
/** the body model's clock: read by no body these goldens draw (no running terminal, no birth) */
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

export function readWitnessInputs(): { open: unknown; frames: readonly unknown[] } {
  const read = (name: string): unknown =>
    JSON.parse(readFileSync(join(FIELD_APP, "..", "contracts", "fixtures", name), "utf8"));
  return {
    open: read(PHONE_WITNESS_INPUTS[0]),
    frames: read(PHONE_WITNESS_INPUTS[1]) as unknown[],
  };
}

type FrameKind = "delta" | "snapshot" | "state";

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
  at: "open" | number;
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
  changes?: { added: string[]; updated: string[]; removed: string[] } | null;
  /** `model.agents`, the contract's order (agents by birth, then terminals, ties by id) */
  ids?: string[];
  /** J1 (a): the window's order (this desktop's agents by birth, its terminals, then each desktop in place) */
  drawn?: string[];
  rows?: PhoneFoldRow[];
}

export interface PhoneBody {
  id: string;
  state: SwarmBubbleModel["state"];
  appearance: SwarmBubbleModel["appearance"];
  radius: number;
  copy: [string, string][];
  top: string | null;
  bottom: { text: string; none: boolean } | null;
  burn: { lit: number; priced: boolean } | null;
  light: string | null;
  ring: number | null;
  unread: boolean;
  stale: boolean;
  hollow: boolean;
  running: boolean;
  blockerKind: string | null;
}

export interface PhoneBodyStep {
  at: "open" | number;
  frame?: FrameKind;
  gap?: true;
  bodies?: PhoneBody[];
}

export interface PhoneGoldens {
  fold: PhoneFoldStep[];
  body: PhoneBodyStep[];
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

/** The row's cost as the backend priced it, without its series (a drawing fact the phone keeps none of). */
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
  const bottom = model.figures?.bottom;
  return {
    id: model.id,
    state: model.state,
    appearance: model.appearance,
    radius: model.radius,
    copy: model.copy.map((line) => [line.key, line.text]),
    top: model.figures?.top?.text ?? null,
    bottom: bottom === undefined ? null : { text: bottom.text, none: bottom.none },
    burn: model.burn ?? null,
    light: model.light ?? null,
    ring: model.ring?.percent ?? null,
    unread: model.unread,
    stale: model.stale,
    hollow: model.hollow,
    running: model.running,
    blockerKind: model.blockerKind ?? null,
  };
}

/** The window's bodies for its drawn rows, as `AgentSwarm` builds them (scale 1: fit is a layout fact). */
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
  frames: readonly unknown[];
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
  let published: { added: string[]; updated: string[]; removed: string[] } | null = null;
  const offPublished = replica.subscribe(() => {
    const { changes } = replica.getSnapshot();
    published = {
      added: [...changes.added],
      updated: [...changes.updated],
      removed: [...changes.removed],
    };
  });
  replica.setLocal({
    attachments: new Map(),
    activeIds: new Set(),
    spawnHints: new Map(),
    visible: (row) => row.alive,
  });
  const windowRows = createWindowRows();
  const orderFor = createRowOrder();
  let foldRevision = 0;

  const step = (at: "open" | number, kind?: FrameKind): [PhoneFoldStep, PhoneBodyStep] => {
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
      changes: published,
      ids: model.agents.map((row) => row.id),
      drawn: rows.map((row) => row.id),
      rows: rows.map((row) => ({
        id: row.id,
        key: feed.held(row.id)?.board.runtimeRunId ?? row.id,
        device: row.device.id,
        self: row.device.self,
        unread: row.unread,
        stale: row.stale,
        cost: costOf(row),
      })),
    };
    handed = null;
    published = null;
    return [foldStep, { at, ...frame, bodies: bodiesOf(rows) }];
  };

  const fold: PhoneFoldStep[] = [];
  const body: PhoneBodyStep[] = [];
  try {
    await settle();
    scheduler.flush();
    const state = feed.state();
    if (state.state !== "live")
      throw new Error(`the witness open was not read: ${JSON.stringify(state)}`);
    let [foldStep, bodyStep] = step("open");
    fold.push(foldStep);
    body.push(bodyStep);
    for (const [index, frame] of input.frames.entries()) {
      const deliver = sink as ((payload: unknown, kind?: "snapshot" | "delta") => void) | null;
      if (deliver === null) throw new Error(`frame ${index}: the board closed before it`);
      deliver(structuredClone(frame), "delta");
      scheduler.flush();
      if (opens > 1) {
        fold.push({ at: index, frame: frameKind(frame), gap: true });
        body.push({ at: index, frame: frameKind(frame), gap: true });
        break;
      }
      [foldStep, bodyStep] = step(index, frameKind(frame));
      fold.push(foldStep);
      body.push(bodyStep);
    }
  } finally {
    offPublished();
    feed.dispose();
  }
  return { fold, body };
}

const FOLD_NOTE =
  "PG-3a — the phone's fold parity golden (Q-J1 (a), James 2026-11-01: the phone equals its home's window row for row). GENERATED by packages/field-app/perf/phone-goldens.generate.perf.ts (pnpm --filter @vibefield/field-app phone:goldens) from contracts' agent-remote-mesh-{open,frames}.witness.json through the window's own feed (createGodviewMonitorFeed: BoardScreen → the parse → ModelBoardFold → createMonitorReplica, visible = alive) and its rows (createWindowRows, createRowOrder, boardJoins), as a window with no deck panes. Per step: foldRevision (the fold's chain) and modelRevision (the replica's publication; behind after a frame that changed nothing), each desktop's standing, what the fold handed the replica, what the replica published (null: nothing), ids (the contract's order) and drawn (the window's order), and each drawn row's key, self, unread, stale and cost (no series). Never asOf. Pinned byte for byte by packages/field-app/test/phone-parity.test.ts, the kit's copy by pnpm check:ios-fixtures (OTHER_ORIGINS). Never edit by hand; a regeneration is a re-bless, said in its commit (step, field, cause), and never over a defect (PG-3a0's rule).";

const BODY_NOTE =
  "PG-3a — the phone's body golden (the IOS-6a method): puppeteer-views' bubbleModel over the window's drawn rows of phone-fold.golden.json, as AgentSwarm calls it (each row's working share, scale 1), per step. Per body: id, state, appearance, the base radius, copy as [key, text], the top and bottom figures and the burn (working bodies only; null otherwise), light, the ring's percent, unread, stale, hollow, running, blockerKind. Not here: accent (the theme's; the phone's colour is ProjectLedger's), ariaLabel and title (they carry the burn's unit, Q-J3, 3e's). GENERATED by packages/field-app/perf/phone-goldens.generate.perf.ts (pnpm --filter @vibefield/field-app phone:goldens); pinned byte for byte by packages/field-app/test/phone-parity.test.ts, the kit's copy by pnpm check:ios-fixtures. A puppeteer EL8 moves it: regenerate and copy to the kit in the same commit. Never edit by hand; a regeneration is a re-bless, said in its commit, and never over a defect.";

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
        visible: "alive",
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
  const wasSteps = was.steps ?? [];
  const nowSteps = now.steps ?? [];
  for (let index = 0; index < Math.max(wasSteps.length, nowSteps.length); index += 1) {
    const left = wasSteps[index] ?? {};
    const right = nowSteps[index] ?? {};
    const at = String(right["at"] ?? left["at"] ?? index);
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (JSON.stringify(left[key]) !== JSON.stringify(right[key]))
        lines.push(`step ${at}: ${key}`);
    }
  }
  return lines;
}
