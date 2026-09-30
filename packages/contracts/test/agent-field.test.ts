import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AgentDeskRow,
  AgentFieldDelta,
  AgentFieldRow,
  AgentFieldSlice,
  AgentFieldSnapshot,
  AgentInterruptResult,
  AgentMeshFrame,
  AgentMeshOpen,
  AgentSubscribeParams,
} from "../src/agent-field";
import { AGENT_FIELD } from "../src/registries";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const slice = AgentFieldSlice.parse(
  JSON.parse(readFileSync(join(FIXTURES, "agent-field-slice.valid.json"), "utf8")),
);

describe("MF-1 — the GOLDEN field row is content-free (§10.1)", () => {
  it("the golden carries no content key in any row", () => {
    // FIXTURE SANITY, and only that: this file is hand-authored, so what it
    // proves is that the goldens the phone decodes describe a content-free
    // row — never that fieldd produces one. The producer's own wall is an
    // ALLOWLIST derived from `AgentFieldRow.shape`
    // (`packages/fieldd/test/agent-field.test.ts`), and a row there asserts
    // this golden and that producer speak the same vocabulary, so the two
    // cannot drift apart in silence. Passthrough means a row COULD carry
    // these (the tolerant reader never drops what it does not know); what
    // must never happen is fieldd putting them there.
    const forbidden = ["lastAssistantMessage", "monitor", "title", "workspace"];
    for (const row of slice.rows) {
      for (const key of forbidden) {
        expect(Object.keys(row), `${row.runtimeRunId} carries ${key}`).not.toContain(key);
      }
      for (const blocker of row.blockers) {
        for (const key of ["input", "questions", "detail"]) {
          expect(Object.keys(blocker), `${blocker.id} carries ${key}`).not.toContain(key);
        }
      }
    }
  });

  it("EL7 B1 — the golden names FOLDERS, never paths", () => {
    // The slice reaches every tailnet node the app admits, and an absolute cwd
    // carried the OS username and the shape of a person's disk. A card draws
    // the folder, so the folder is all the row carries.
    for (const row of slice.rows) {
      if (row.project === undefined) continue;
      for (const key of Object.keys(row.project)) {
        expect(["name", "branch"], `${row.runtimeRunId}'s project carries ${key}`).toContain(key);
      }
      const name = (row.project as { name?: unknown }).name;
      if (name !== undefined) {
        expect(typeof name).toBe("string");
        expect(name as string, "a folder NAME has no separators").not.toMatch(/[/\\]/);
      }
    }
    // and nothing anywhere in the slice reads like a path out of someone's home
    expect(JSON.stringify(slice)).not.toMatch(/"\/Users\/|"\/home\/|"[A-Za-z]:\\\\/);
  });

  it("keeps a whole five-row board inside the phone's frame budget (§5)", () => {
    // The §5 target: five working agents steady at < 2 KB/s. One frame of the
    // whole board is the worst case a subscriber sees, and it lands far inside
    // the store's own 64 KB slice cap.
    const bytes = Buffer.byteLength(JSON.stringify(slice.rows), "utf8");
    expect(slice.rows).toHaveLength(5);
    expect(bytes).toBeLessThan(5 * 1024);
  });

  it("reads a permission blocker's tool and nothing else about it", () => {
    const blocked = slice.rows.find((row) => row.status === "blocked");
    expect(blocked?.blockers).toEqual([
      { id: "perm-9f2c", kind: "permission", since: "2026-09-13T18:42:11.000Z", tool: "Bash" },
    ]);
  });

  it("states the honest faces: a pending row is ALIVE and undriven, an ended PTY is not alive", () => {
    const pending = slice.rows.find((row) => row.pending !== undefined);
    expect(pending?.pending).toBe("resume-when-idle");
    // AR-4 (ruled 2026-09-13): its PTY is on the floor, so the run IS alive —
    // what it lacks is an observer, which is what `pending` says. A reader
    // draws `alive: false` as GONE, and dropping a live agent off a phone is
    // the failure this golden exists to prevent.
    expect(pending?.alive).toBe(true);
    expect(pending?.status).toBe("unknown");
    expect(pending?.terminal?.hosted).toBe("local");

    // and the row whose PTY is gone is the one that says so
    const exited = slice.rows.find((row) => row.terminal?.hosted === "none");
    expect(exited?.alive).toBe(false);
    expect(exited?.pending).toBeUndefined();
  });

  it("refuses a row that lost an identity field, and tolerates an unknown one", () => {
    const [first] = slice.rows;
    const { runtimeRunId: _dropped, ...missing } = first!;
    expect(AgentFieldRow.safeParse(missing).success).toBe(false);

    const future = AgentFieldRow.parse({ ...first, futureField: { mood: "green" } });
    expect((future as Record<string, unknown>)["futureField"]).toEqual({ mood: "green" });
  });
});

describe("MF-1h — a slice the cap trimmed", () => {
  const capped = AgentFieldSlice.parse(
    JSON.parse(readFileSync(join(FIXTURES, "agent-field-slice.capped.json"), "utf8")),
  );

  it("says how many rows it lost, and stays a slice in every other way", () => {
    // A populated row measures ≈725 B against a 64 KiB cap, so a board of
    // roughly ninety agents reaches it. The publisher trims from the END and
    // stamps the count rather than letting the floor refuse the whole write —
    // a refusal reads as mesh-down and retries forever, and the desktop
    // vanishes from every phone instead of arriving short.
    expect(capped.omitted).toBe(2);
    expect(capped.rows).toHaveLength(3);
    expect(capped.expiresAt).toBeGreaterThan(capped.publishedAt);
    // a WHOLE board says nothing at all — absence is the ordinary case
    expect(slice.omitted).toBeUndefined();
  });

  it("refuses a count that is not a positive whole number of rows", () => {
    for (const omitted of [0, -1, 1.5, "2"]) {
      expect(AgentFieldSlice.safeParse({ ...capped, omitted }).success, String(omitted)).toBe(
        false,
      );
    }
  });
});

describe("MF-1 — the subscription's options (§5)", () => {
  it("defaults to today's subscription when nothing is asked for", () => {
    // Absent projection = `full`: the desktop's renderer must not learn a new
    // frame shape to keep working.
    const parsed = AgentSubscribeParams.parse({});
    expect(parsed.projection).toBeUndefined();
    expect(parsed.minIntervalMs).toBeUndefined();
  });

  it("bounds the floor a caller may ask for", () => {
    expect(
      AgentSubscribeParams.safeParse({ projection: "field", minIntervalMs: 250 }).success,
    ).toBe(true);
    // faster than the fold's own tick is not a cadence anyone can be served
    expect(AgentSubscribeParams.safeParse({ minIntervalMs: 15 }).success).toBe(false);
    expect(AgentSubscribeParams.safeParse({ minIntervalMs: 60_001 }).success).toBe(false);
    expect(AgentSubscribeParams.safeParse({ projection: "mirror" }).success).toBe(false);
  });
});

const golden = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;

describe("DS-3 — the board's epoch (DS-L3), optional so the phone keeps parsing", () => {
  it("the goldens carry the chain's epoch, as fieldd now always sends it", () => {
    const snapshot = AgentFieldSnapshot.parse(golden("agent-field-snapshot.valid.json"));
    const delta = AgentFieldDelta.parse(golden("agent-field-delta.valid.json"));
    expect(snapshot.epoch).toBe("fieldd-5d1e2a7c90b3f418.1");
    // a delta applies on top of the snapshot's chain: one epoch, `since` its revision
    expect(delta.epoch).toBe(snapshot.epoch);
    expect(delta.since).toBe(snapshot.revision);
  });

  it("a frame from a daemon older than DS-3 carries none and still parses", () => {
    // A REQUIRED field on a shared schema has broken adoption before: a phone
    // on the tailnet can read a desktop that has not been updated yet.
    const { epoch: _dropped, ...older } = golden("agent-field-snapshot.valid.json") as Record<
      string,
      unknown
    >;
    expect(AgentFieldSnapshot.parse(older).epoch).toBeUndefined();
    expect(AgentFieldSnapshot.safeParse({ ...older, epoch: "" }).success).toBe(false);
  });
});

describe("DS-3 — the subscription's new options", () => {
  it("a mesh board is field or desk at a scope; today's callers ask none of it", () => {
    const parsed = AgentSubscribeParams.parse({ projection: "desk", scope: "mesh" });
    expect(parsed).toMatchObject({ projection: "desk", scope: "mesh" });
    expect(AgentSubscribeParams.parse({}).scope).toBeUndefined();
    expect(AgentSubscribeParams.safeParse({ scope: "world" }).success).toBe(false);
  });

  it("bounds the heartbeat a caller may ask for", () => {
    expect(AgentSubscribeParams.safeParse({ projection: "desk", heartbeatMs: 1_000 }).success).toBe(
      true,
    );
    expect(AgentSubscribeParams.safeParse({ heartbeatMs: 100 }).success).toBe(false);
    expect(AgentSubscribeParams.safeParse({ heartbeatMs: 60_001 }).success).toBe(false);
    // the mesh board's own ask sits inside the bounds, and stale is three of them
    expect(
      AgentSubscribeParams.safeParse({ heartbeatMs: AGENT_FIELD.MESH_HEARTBEAT_MS }).success,
    ).toBe(true);
    expect(AGENT_FIELD.MESH_STALE_BEATS).toBe(3);
  });
});

describe("DS-3 — the desk row: the field row plus what one person reads a run by", () => {
  const row = AgentDeskRow.parse(golden("agent-desk-row.valid.json"));

  it("carries the reply line, the blocker's question and the cost, each bounded", () => {
    expect(row.lastAssistantMessage?.text.length).toBeGreaterThan(0);
    expect(row.lastAssistantMessage?.text.length).toBeLessThanOrEqual(AGENT_FIELD.DESK_TEXT_CHARS);
    const question = row.blockers.find((blocker) => blocker.kind === "question")?.question;
    expect(question).toBeDefined();
    expect(question?.length).toBeLessThanOrEqual(AGENT_FIELD.DESK_TEXT_CHARS);
    expect(row.usage?.costUsd).toBe(4.04);
  });

  it("IS a field row: a field reader parses it and keeps the rest as passthrough", () => {
    const asField = AgentFieldRow.parse(golden("agent-desk-row.valid.json"));
    expect(asField.runtimeRunId).toBe(row.runtimeRunId);
    expect((asField as Record<string, unknown>)["lastAssistantMessage"]).toEqual(
      row.lastAssistantMessage,
    );
  });

  it("still names folders, never paths (EL7 B1 holds among one person's desktops too)", () => {
    expect(JSON.stringify(row)).not.toMatch(/"\/Users\/|"\/home\/|"[A-Za-z]:\\\\/);
  });
});

describe("DS-3 — the mesh board's open and frames (DS-D4, the base's rows shapes)", () => {
  // the parsed values are assignable to the written-out types a reader narrows on
  const open: AgentMeshOpen = AgentMeshOpen.parse(golden("agent-mesh-open.valid.json"));
  const frames: AgentMeshFrame[] = (golden("agent-mesh-frames.valid.json") as unknown[]).map(
    (frame) => AgentMeshFrame.parse(frame),
  );

  it("lists every device with its state; an asleep one keeps its last board (DS-L8)", () => {
    const byDevice = new Map(open.devices.map((entry) => [entry.device, entry]));
    expect([...byDevice.values()].map((entry) => entry.state)).toEqual([
      "live",
      "live",
      "asleep",
      "stale",
    ]);
    // asleep is a state, not an absence: the board stays, greyed by the reader
    expect(byDevice.get("dev-01HQA1RL4P")?.snapshot?.rows).toHaveLength(1);
    // a device that has never answered is LISTED, with nothing invented for it
    expect(byDevice.get("dev-01HQB3M1N1")?.snapshot).toBeUndefined();
  });

  it("keys rows by device: each board keeps its own epoch and revision chain", () => {
    const epochs = new Set(open.devices.flatMap((entry) => entry.snapshot?.epoch ?? []));
    expect(epochs.size).toBe(3);
    for (const entry of open.devices) {
      for (const row of entry.snapshot?.rows ?? []) expect(row.device).toBe(entry.device);
    }
  });

  it("a reader applying the frames in order ends where the owners are", () => {
    // The reference reader, in a dozen lines: a delta applies on top of its
    // own device's chain, a snapshot REPLACES that device only, a state change
    // moves the state and never the board.
    const boards = new Map(
      open.devices.map((entry) => [
        entry.device,
        {
          state: entry.state,
          epoch: entry.snapshot?.epoch,
          revision: entry.snapshot?.revision,
          rows: new Map((entry.snapshot?.rows ?? []).map((row) => [row.runtimeRunId, row])),
        },
      ]),
    );
    for (const frame of frames) {
      const board = boards.get(frame.device);
      if (board === undefined) throw new Error(`a frame for an unlisted device: ${frame.device}`);
      if ("delta" in frame) {
        expect(frame.delta.epoch).toBe(board.epoch);
        expect(frame.delta.since).toBe(board.revision);
        for (const row of frame.delta.upserts) board.rows.set(row.runtimeRunId, row);
        for (const id of frame.delta.removed) board.rows.delete(id);
        board.revision = frame.delta.revision;
      } else if ("snapshot" in frame) {
        board.epoch = frame.snapshot.epoch;
        board.revision = frame.snapshot.revision;
        board.rows = new Map(frame.snapshot.rows.map((row) => [row.runtimeRunId, row]));
      } else {
        board.state = frame.state;
      }
    }
    expect(boards.get("dev-01HQ9S7UD1")).toMatchObject({ state: "live", revision: 1 });
    expect([...(boards.get("dev-01HQ8ZK4M7")?.rows.keys() ?? [])]).toEqual([]);
    expect(boards.get("dev-01HQA1RL4P")?.state).toBe("live");
  });

  it("refuses a frame that names no device, and a relayed delta with no epoch", () => {
    expect(
      AgentMeshFrame.safeParse({ state: "live", asOf: "2026-09-30T21:00:00.000Z" }).success,
    ).toBe(false);
    const first = (golden("agent-mesh-frames.valid.json") as Array<Record<string, unknown>>)[0];
    const delta = first?.["delta"] as Record<string, unknown> | undefined;
    if (delta === undefined) throw new Error("the golden opens on a delta");
    const { epoch: _dropped, ...noEpoch } = delta;
    expect(AgentMeshFrame.safeParse({ device: "dev-01HQ9S7UD1", delta: noEpoch }).success).toBe(
      false,
    );
    expect(
      AgentMeshFrame.safeParse({ device: "dev-01HQ9S7UD1", state: "gone", asOf: "x" }).success,
    ).toBe(false);
  });
});

describe("AR-6-0 — the interrupt's answer", () => {
  it("discriminates on `accepted`, and a refusal must say why", () => {
    expect(AgentInterruptResult.parse({ accepted: true })).toEqual({ accepted: true });
    expect(AgentInterruptResult.safeParse({ accepted: false }).success).toBe(false);
    expect(
      AgentInterruptResult.parse({ accepted: false, reason: "no-terminal-host" }),
    ).toMatchObject({ accepted: false, reason: "no-terminal-host" });
  });
});
