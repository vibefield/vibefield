import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AgentBoardKeyDelta,
  AgentBoardKeySnapshot,
  AgentBoardRowKey,
  AgentDeskRow,
  AgentDeskTerminalRow,
  AgentFieldDelta,
  AgentFieldRow,
  AgentFieldSlice,
  AgentFieldSnapshot,
  AgentInterruptResult,
  AgentMeshFrame,
  AgentMeshOpen,
  AgentModelBoardRow,
  AgentModelDeskRow,
  AgentModelLocalFacts,
  AgentModelMeshFrame,
  AgentModelMeshOpen,
  AgentProjection,
  AgentRemoteDelta,
  AgentRemoteMeshFrame,
  AgentRemoteMeshOpen,
  AgentRemoteRow,
  AgentRemoteSnapshot,
  AgentReportShownParams,
  AgentSubscribeParams,
  MONITOR_AUDIENCE,
  MonitorAgentRow,
  SCREEN_BOARDS,
} from "../src/agent-field";
import { ForwardEnvelope, KEYED_FORWARD_METHODS, OnBehalfOf } from "../src/forwarding";
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

describe("PJ-7 — the phone's row knows its conversation (Q3 (a))", () => {
  it("carries the provider-native id, and only the id — a row with none still parses", () => {
    const snapshot = AgentFieldSnapshot.parse(golden("agent-field-snapshot.native-session.json"));
    const [placed, unsaid] = snapshot.rows;
    expect(placed?.nativeSessionId).toBe("4f9c2d1e-7a3b-4c8d-9e0f-1a2b3c4d5e6f");
    expect(unsaid?.nativeSessionId).toBeUndefined();
    // the id, never the folder: no key of the row names a path (EL7 B1)
    expect(JSON.stringify(snapshot)).not.toContain('"cwd"');
    // the mirrored golden, from before PJ-7, carries none and still parses
    const older = AgentFieldSnapshot.parse(golden("agent-field-snapshot.valid.json"));
    expect(older.rows.every((row) => row.nativeSessionId === undefined)).toBe(true);
  });

  it("refuses an id that is not one rather than coercing it", () => {
    const row = AgentFieldSnapshot.parse(golden("agent-field-snapshot.native-session.json"))
      .rows[0] as Record<string, unknown>;
    for (const bad of ["", 42, { id: "x" }, "x".repeat(257)]) {
      expect(AgentFieldRow.safeParse({ ...row, nativeSessionId: bad }).success, String(bad)).toBe(
        false,
      );
    }
    // the desk row is a field row: it reads the same key the same way
    expect(AgentDeskRow.safeParse({ ...row, nativeSessionId: 42 }).success).toBe(false);
  });
});

describe("SP-1b — the row says whose session it is and who started it (track CO)", () => {
  it("carries the spark and the origin, and a row with neither still parses", () => {
    const snapshot = AgentFieldSnapshot.parse(golden("agent-field-snapshot.spark.json"));
    const [own, started, plain] = snapshot.rows;
    expect(own?.spark).toBe("sp-vela01");
    expect(own?.origin).toEqual({ by: "you" });
    expect(started?.spark).toBeUndefined();
    expect(started?.origin).toEqual({ by: "spark", spark: "sp-vela01" });
    expect(plain?.spark).toBeUndefined();
    expect(plain?.origin).toBeUndefined();
    // the goldens from before SP-1b carry neither, and still parse: the tolerant reader
    for (const name of [
      "agent-field-snapshot.valid.json",
      "agent-field-snapshot.native-session.json",
    ]) {
      const older = AgentFieldSnapshot.parse(golden(name));
      expect(
        older.rows.every((row) => row.spark === undefined && row.origin === undefined),
        name,
      ).toBe(true);
    }
  });

  it("refuses a spark that is not an id, and an origin that names no one, rather than coercing them", () => {
    const row = AgentFieldSnapshot.parse(golden("agent-field-snapshot.spark.json"))
      .rows[0] as Record<string, unknown>;
    expect(AgentFieldRow.safeParse(row).success).toBe(true);
    for (const bad of ["", "Vela", "sp-", 42]) {
      expect(AgentFieldRow.safeParse({ ...row, spark: bad }).success, String(bad)).toBe(false);
    }
    expect(AgentFieldRow.safeParse({ ...row, origin: { by: "" } }).success).toBe(false);
    expect(AgentFieldRow.safeParse({ ...row, origin: { spark: "sp-vela01" } }).success).toBe(false);
    // the desk row is a field row: it reads both the same way
    expect(AgentDeskRow.safeParse(row).success).toBe(true);
    expect(AgentDeskRow.safeParse({ ...row, spark: "Vela" }).success).toBe(false);
  });
});

describe("ST-D5 — a person's durable Stop rides the field row", () => {
  it("carries the Stop's clock and stage, in open words, and only on a row that holds one", () => {
    const snapshot = AgentFieldSnapshot.parse(golden("agent-field-snapshot.stop.json"));
    const [ending, unheard, heard] = snapshot.rows;
    expect(ending?.stop).toEqual({ sentAt: "2026-10-31T06:00:03.000Z", stage: "terminating" });
    expect(unheard?.stop?.unheardAt).toBe("2026-10-31T06:01:08.000Z");
    expect(heard?.stop).toMatchObject({ stage: "heard", heardBy: "status" });
    // content-free: no key of a Stop names a path or a word of the run
    expect(JSON.stringify(snapshot)).not.toContain('"cwd"');
    // the goldens from before ST carry none and still parse
    const older = AgentFieldSnapshot.parse(golden("agent-field-snapshot.valid.json"));
    expect(older.rows.every((row) => row.stop === undefined)).toBe(true);
  });

  it("takes a stage or a hearing it does not know, and an unknown key beside them, as the tolerant reader does", () => {
    const row = AgentFieldSnapshot.parse(golden("agent-field-snapshot.stop.json"))
      .rows[0] as Record<string, unknown>;
    const stop = {
      sentAt: "2026-10-31T06:00:03.000Z",
      stage: "paused",
      heardBy: "turn-stop",
      by: "x",
    };
    expect(AgentFieldRow.parse({ ...row, stop }).stop).toEqual(stop);
  });

  it("refuses a Stop that is not one rather than coercing it", () => {
    const row = AgentFieldSnapshot.parse(golden("agent-field-snapshot.stop.json"))
      .rows[0] as Record<string, unknown>;
    for (const bad of [
      "sent",
      { stage: "sent" },
      { sentAt: "2026-10-31T06:00:03.000Z" },
      { sentAt: "2026-10-31T06:00:03.000Z", stage: "" },
      { sentAt: "2026-10-31T06:00:03.000Z", stage: "x".repeat(33) },
      { sentAt: "2026-10-31T06:00:03.000Z", stage: "heard", heardBy: "" },
    ]) {
      expect(AgentFieldRow.safeParse({ ...row, stop: bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
    // the desk row is a field row: it reads the same key the same way
    expect(AgentDeskRow.safeParse({ ...row, stop: "sent" }).success).toBe(false);
  });
});

describe("DS-3 — the subscription's new options", () => {
  it("a mesh board is a board projection at a scope; today's callers ask none of it", () => {
    const parsed = AgentSubscribeParams.parse({ projection: "remote", scope: "mesh" });
    expect(parsed).toMatchObject({ projection: "remote", scope: "mesh" });
    expect(AgentSubscribeParams.parse({}).scope).toBeUndefined();
    expect(AgentSubscribeParams.safeParse({ scope: "world" }).success).toBe(false);
  });

  it("bounds the heartbeat a caller may ask for", () => {
    expect(
      AgentSubscribeParams.safeParse({ projection: "remote", heartbeatMs: 1_000 }).success,
    ).toBe(true);
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

describe("MV-3a — the model's row on the wire (MV-D22, MV-D18)", () => {
  const row = MonitorAgentRow.parse(golden("monitor-agent-row.valid.json"));
  const remote = AgentRemoteRow.parse(golden("agent-remote-row.valid.json"));
  const terminal = AgentDeskTerminalRow.parse(golden("agent-desk-terminal-row.valid.json"));

  it("carries every fact a screen draws, with epoch-millisecond clocks and the parts of a wait apart (M2)", () => {
    expect(row).toMatchObject({
      id: "run-studio-q",
      kind: "agent",
      status: "blocked",
      observed: true,
      wait: { kind: "question", header: "Sleeping desktops" },
      cost: { usd: 4.04, coverage: "complete" },
      project: { name: "vibe-field", branch: "ds/c", seq: 2 },
      device: { id: "dev-01HQ9S7UD1", name: "Studio", os: "mac" },
    });
    expect(Number.isInteger(row.createdAt)).toBe(true);
    expect(Number.isInteger(row.statusSince)).toBe(true);
    expect(row.cost?.series?.steps).toHaveLength(20);
    // reader-relative, never on the wire
    expect("self" in row.device).toBe(false);
  });

  it("a bare terminal is a row of its own kind, keyed by the model's id, and never a field row", () => {
    expect(terminal).toMatchObject({
      runtimeRunId: "pty-s4",
      kind: "terminal",
      terminal: { hosted: "local", runtimeSessionId: "pty-s4" },
      monitorRow: { id: "pty-s4", kind: "terminal", attachable: true },
    });
    expect(AgentFieldRow.safeParse(golden("agent-desk-terminal-row.valid.json")).success).toBe(
      false,
    );
    const asBoard = AgentModelBoardRow.parse(golden("agent-desk-terminal-row.valid.json"));
    expect(asBoard.kind).toBe("terminal");
  });

  it("the window's one door: this desktop's model board first (its terminal among its rows), peers' remote boards beside it (PG-2)", () => {
    const open: AgentModelMeshOpen = AgentModelMeshOpen.parse(
      golden("agent-model-mesh-open.valid.json"),
    );
    expect(open.devices.map((entry) => entry.state)).toEqual(["live", "live", "asleep"]);
    const own = open.devices[0]?.snapshot?.rows ?? [];
    expect(own.map((entry) => entry.kind)).toEqual(["claude", "terminal"]);
    const ownAgent = own[0];
    expect(
      ownAgent !== undefined && "monitorRow" in ownAgent && ownAgent.monitorRow?.project.seq,
    ).toBe(2);
    // a peer's row is its owner's remote cut: the model's row for a peer and the
    // joins, never the field half beside it, so it is no desk row (PG-2)
    const peer = AgentRemoteRow.parse(open.devices[1]?.snapshot?.rows[0]);
    expect(peer.monitorRow.project.seq).toBeUndefined();
    expect(peer.terminal?.runtimeSessionId).toBe("pty-l2");
    expect(AgentModelDeskRow.safeParse(peer).success).toBe(false);
    expect("status" in peer || "label" in peer || "lastAssistantMessage" in peer).toBe(false);
    // the field board's reader does not take a terminal row: the field stays the field
    expect(AgentMeshOpen.safeParse(golden("agent-model-mesh-open.valid.json")).success).toBe(false);
    const frames: AgentModelMeshFrame[] = (
      golden("agent-model-mesh-frames.valid.json") as unknown[]
    ).map((frame) => AgentModelMeshFrame.parse(frame));
    expect(frames.map((frame) => ("delta" in frame ? "delta" : "state"))).toEqual([
      "delta",
      "state",
      "delta",
    ]);
    const first = frames[0];
    if (first === undefined || !("delta" in first)) throw new Error("the first frame is a delta");
    expect(first.delta.removed).toEqual(["run-studio-q"]);
    expect(first.delta.upserts[0]?.kind).toBe("terminal");
  });

  it("`model` is a projection; the report names rows by model id and nothing else", () => {
    expect(AgentProjection.options).toContain("model");
    expect(AgentSubscribeParams.parse({ projection: "model", scope: "mesh" })).toMatchObject({
      projection: "model",
      scope: "mesh",
    });
    expect(AgentReportShownParams.parse(golden("agent-report-shown.valid.json")).ids).toEqual([
      "run-studio-q",
      "pty-s4",
    ]);
    expect(AgentReportShownParams.safeParse({ ids: [""] }).success).toBe(false);
    expect(AgentReportShownParams.safeParse({}).success).toBe(false);
  });

  // PG-3b (PG-D6 (a), J2 (a), 2026-11-01) — the report travels: routed by
  // `device` through the home like every federated call, and carried to the
  // owner with the home's forwarding envelope beside it (DS-L7)
  it("PG-3b — a report is routed by device, and the owner reads the reader it is for in the envelope", () => {
    const routed = AgentReportShownParams.parse(golden("agent-report-shown.routed.json"));
    expect(routed).toEqual({ ids: ["run-studio-q"], device: "dev-desktop-b" });
    // the routing key is declared, as on every federated params object
    expect(AgentReportShownParams.safeParse({ ids: [], device: "" }).success).toBe(false);
    expect(AgentReportShownParams.safeParse({ ids: [], device: 7 }).success).toBe(false);
    // the owner's view: the same params, the envelope beside them
    const forwarded = golden("agent-report-shown.forwarded.json") as {
      forward: { onBehalfOf: unknown };
    };
    expect(AgentReportShownParams.parse(forwarded)).toMatchObject({
      ids: ["run-studio-q"],
      device: "dev-desktop-b",
    });
    // the reader's window keys its screen on the owner (restrict-only)
    expect(OnBehalfOf.parse(forwarded.forward.onBehalfOf)).toMatchObject({
      clientKind: "ios",
      deviceId: "dev-desktop-a",
      windowId: "conn_7",
    });
    // the owner's door strips the envelope it reads: a carried report is a READ, keyed by no receipt
    const envelope = ForwardEnvelope.parse(forwarded);
    expect(envelope.forward?.idempotencyKey).toBeUndefined();
    const { forward: _forward, ...rest } = envelope;
    expect(AgentReportShownParams.parse(rest)).toEqual({
      ids: ["run-studio-q"],
      device: "dev-desktop-b",
    });
    expect(KEYED_FORWARD_METHODS.has("agent.reportShown")).toBe(false);
  });

  // PG-3b (the 3b review [1], 2026-11-01) — the owner's carried screens are bounded per peer connection
  it("PG-3b — a peer connection carries at most CARRIED_SCREENS_PER_PEER readers' screens", () => {
    expect(AGENT_FIELD.CARRIED_SCREENS_PER_PEER).toBe(64);
  });

  it("the model's texts name folders, never paths, on the agent row; a terminal's detail is its directory and stays home (L8)", () => {
    expect(JSON.stringify(row)).not.toMatch(/"\/Users\/|"\/home\/|"[A-Za-z]:\\\\/);
    // a terminal row is this desktop's windows' only: the path never leaves the device
    expect(terminal.monitorRow.detail).toBe("/Users/james/Projects/notes");
  });

  it("M41 — the row says its home desktop's write policy, and a row from an older daemon without it still parses", () => {
    // a declared fact, not passthrough: the home backend computed it (today it IS attachable's rule)
    expect(MonitorAgentRow.shape.writable).toBeDefined();
    expect(row).toMatchObject({ attachable: true, writable: true });
    expect(remote.monitorRow).toMatchObject({ attachable: true, writable: true });
    expect(terminal.monitorRow).toMatchObject({ attachable: true, writable: true });
    // the home desktop's own word, never re-derived on the way: the two may part
    expect(
      MonitorAgentRow.parse({
        ...(golden("monitor-agent-row.valid.json") as object),
        writable: false,
      }),
    ).toMatchObject({ attachable: true, writable: false });
    // the tolerant reader (an older peer's row has none): it parses, and stays absent here — the
    // window adapter fills it from `attachable`, the rule that daemon applied
    const { writable: _absent, ...older } = golden("monitor-agent-row.valid.json") as Record<
      string,
      unknown
    >;
    const parsed = MonitorAgentRow.parse(older);
    expect(parsed.writable).toBeUndefined();
    expect(parsed.attachable).toBe(true);
    expect(MonitorAgentRow.safeParse({ ...older, writable: "yes" }).success).toBe(false);
  });
});

describe("MV-3d — the chrome's facts ride this desktop's own rows of the model board (M35, M42)", () => {
  const own = AgentModelDeskRow.parse(golden("agent-model-desk-row.valid.json"));

  it("the window's run row carries the model's row whole and the chrome's facts beside it", () => {
    expect(own.monitorRow?.project.seq).toBe(2);
    expect(own.local).toEqual({
      nativeSessionId: "5f0d2c4e-8a1b-4e6f-9c3d-2b7a1e0f4d68",
      cwd: "/Users/james/Projects/project100/vibe-field",
      spawnedBy: "user-shell",
      stopKey: "escape",
      mirror: {
        alive: true,
        startedAt: "2026-09-30T20:51:42.000Z",
        lastEvidenceAt: "2026-09-30T21:14:02.000Z",
        contextSource: "provider",
      },
    });
    // the path rides beside the model, never in it (EL7 B1): the model's row names a folder
    expect(JSON.stringify(own.monitorRow)).not.toMatch(/"\/Users\//);
    // a model-board row is still a desk row and a field row to a reader that knows only those
    expect(AgentDeskRow.parse(golden("agent-model-desk-row.valid.json")).runtimeRunId).toBe(
      own.runtimeRunId,
    );
    expect(AgentFieldRow.safeParse(golden("agent-model-desk-row.valid.json")).success).toBe(true);
  });

  it("only this desktop's rows carry them: the remote cut and the peers' boards on the window's door carry none", () => {
    expect("local" in AgentRemoteRow.parse(golden("agent-remote-row.valid.json"))).toBe(false);
    expect("local" in AgentRemoteRow.parse(golden("agent-remote-row.terminal.json"))).toBe(false);
    const open: AgentModelMeshOpen = AgentModelMeshOpen.parse(
      golden("agent-model-mesh-open.valid.json"),
    );
    const [here, ...others] = open.devices;
    expect(AgentModelDeskRow.parse(here?.snapshot?.rows[0]).local?.cwd).toBe(
      "/Users/james/Projects/project100/vibe-field",
    );
    // a bare terminal's row carries none: no reader asks it anything beyond its row
    expect(here?.snapshot?.rows.filter((row) => "local" in row)).toHaveLength(1);
    for (const device of others) {
      for (const row of device.snapshot?.rows ?? []) expect("local" in row).toBe(false);
    }
  });

  it("the union keeps the facts through the board's reader, and the tolerant reader takes any part of them", () => {
    const asBoard = AgentModelBoardRow.parse(golden("agent-model-desk-row.valid.json"));
    expect(AgentModelDeskRow.parse(asBoard).local?.spawnedBy).toBe("user-shell");
    // every part optional: a run before its first state (no mirror), a fieldd
    // that says less, and a word this build never heard all parse
    expect(AgentModelLocalFacts.parse({})).toEqual({});
    expect(AgentModelLocalFacts.parse({ nativeSessionId: "n-1", exited: true })).toEqual({
      nativeSessionId: "n-1",
      exited: true,
    });
    const newer = AgentModelLocalFacts.parse({
      nativeSessionId: "n-1",
      laterFact: 3,
      mirror: { alive: false, laterWord: "x" },
    });
    expect(newer).toMatchObject({ laterFact: 3, mirror: { alive: false, laterWord: "x" } });
    // what it does refuse is a fact of the wrong kind, never a missing one
    expect(AgentModelLocalFacts.safeParse({ nativeSessionId: "" }).success).toBe(false);
    expect(AgentModelLocalFacts.safeParse({ exited: "yes" }).success).toBe(false);
    expect(AgentModelLocalFacts.safeParse({ mirror: { alive: "true" } }).success).toBe(false);
    // Q08 — the stop's key is open (puppeteer's word): one this build never heard still parses
    expect(AgentModelLocalFacts.parse({ stopKey: "ctrl-g" })).toEqual({ stopKey: "ctrl-g" });
    expect(AgentModelLocalFacts.safeParse({ stopKey: 27 }).success).toBe(false);
    // and a row with no facts at all is a row fieldd said nothing more about
    const { local: _none, ...bare } = golden("agent-model-desk-row.valid.json") as Record<
      string,
      unknown
    >;
    expect(AgentModelDeskRow.parse(bare).local).toBeUndefined();
  });
});

// PG-2 (PG-L1, PG-D1 (a), PG-D2 (a), PG-D5 (a), PG-D8 (a)) — THE REMOTE CUT:
// the model's row as its owner cuts it for every other screen, a peer's windows
// and the phone alike. Every golden here is parsed as the phone's door reads it
// and as a peer window's door reads it (EL9: the window takes a peer's remote
// frames verbatim through its own mesh board).
describe("PG-2 — the remote cut: the model's row for every other screen, cut by its owner", () => {
  const agent = AgentRemoteRow.parse(golden("agent-remote-row.valid.json"));
  const bare = AgentRemoteRow.parse(golden("agent-remote-row.terminal.json"));

  it("carries the model's row for a peer and the joins, and nothing of the field half", () => {
    expect(agent).toMatchObject({
      runtimeRunId: "run-studio-q",
      device: "dev-01HQ9S7UD1",
      terminal: { hosted: "local", runtimeSessionId: "pty-s9" },
      nativeSessionId: "5f0d2c4e-8a1b-4e6f-9c3d-2b7a1e0f4d68",
      monitorRow: { id: "run-studio-q", kind: "agent", cost: { usd: 4.04 } },
    });
    expect(agent.kind).toBeUndefined();
    // M16 — no colour sequence leaves its desktop; M21 — every text at the bound
    expect(agent.monitorRow.project.seq).toBeUndefined();
    for (const text of [agent.monitorRow.detail, agent.monitorRow.reply?.text]) {
      expect(text?.length).toBeLessThanOrEqual(AGENT_FIELD.DESK_TEXT_CHARS);
    }
    // §3 item 2 — every fact once: the field row's keys are not beside the model's
    const json = JSON.stringify(agent);
    const reply = agent.monitorRow.reply?.text ?? "";
    expect(json.split(JSON.stringify(reply)).length - 1).toBe(1);
    for (const key of ["status", "label", "tier", "blockers", "usage", "lastAssistantMessage"])
      expect(key in agent, key).toBe(false);
    // the field stays the field: neither reader takes the other's row
    expect(AgentFieldRow.safeParse(golden("agent-remote-row.valid.json")).success).toBe(false);
    expect(AgentModelDeskRow.safeParse(golden("agent-remote-row.valid.json")).success).toBe(false);
  });

  it("a bare terminal rides it too (PG-D5): the window's terminal row, its directory named by its folder (EL7 B1)", () => {
    expect(bare).toMatchObject({
      runtimeRunId: "pty-s4",
      kind: "terminal",
      terminal: { hosted: "local", runtimeSessionId: "pty-s4" },
      monitorRow: { id: "pty-s4", kind: "terminal", detail: "notes", project: { name: "notes" } },
    });
    // with its doors up it IS the row this desktop's own board carries for it
    expect(AgentDeskTerminalRow.parse(golden("agent-remote-row.terminal.json")).kind).toBe(
      "terminal",
    );
    expect(JSON.stringify(bare)).not.toMatch(/"\/Users\/|"\/home\/|"[A-Za-z]:\\\\/);
  });

  it("refuses a row with no model row, and a kind it does not know, rather than coercing them", () => {
    const { monitorRow: _none, ...keyOnly } = golden("agent-remote-row.valid.json") as Record<
      string,
      unknown
    >;
    expect(AgentRemoteRow.safeParse(keyOnly).success).toBe(false);
    expect(
      AgentRemoteRow.safeParse({ ...(golden("agent-remote-row.valid.json") as object), kind: "x" })
        .success,
    ).toBe(false);
    // the tolerant reader: a fact this build never heard rides along
    expect(
      AgentRemoteRow.parse({ ...(golden("agent-remote-row.valid.json") as object), later: 1 }),
    ).toMatchObject({ later: 1 });
  });

  it("the phone's mesh door: its home first, each desktop on its owner's chain; the frames apply in order", () => {
    const open: AgentRemoteMeshOpen = AgentRemoteMeshOpen.parse(
      golden("agent-remote-mesh-open.valid.json"),
    );
    expect(open.devices.map((entry) => entry.state)).toEqual(["live", "live", "asleep"]);
    expect(open.devices[0]?.snapshot?.rows.map((row) => row.runtimeRunId)).toEqual([
      "run-studio-q",
      "pty-s4",
    ]);
    const frames: AgentRemoteMeshFrame[] = (
      golden("agent-remote-mesh-frames.valid.json") as unknown[]
    ).map((frame) => AgentRemoteMeshFrame.parse(frame));
    const held = new Map(
      open.devices.map((entry) => [
        entry.device,
        new Map((entry.snapshot?.rows ?? []).map((row) => [row.runtimeRunId, row])),
      ]),
    );
    for (const frame of frames) {
      if ("delta" in frame) {
        const rows = held.get(frame.device);
        for (const row of frame.delta.upserts) rows?.set(row.runtimeRunId, row);
        for (const key of frame.delta.removed) rows?.delete(key);
      } else if ("snapshot" in frame) {
        held.set(frame.device, new Map(frame.snapshot.rows.map((row) => [row.runtimeRunId, row])));
      }
    }
    const home = held.get("dev-01HQ9S7UD1");
    expect([...(home?.keys() ?? [])]).toEqual(["run-studio-q"]);
    // ST-D5 — the person's Stop rides the remote row as it rides the field row
    expect(home?.get("run-studio-q")?.stop).toEqual({
      sentAt: "2026-09-30T21:14:30.000Z",
      stage: "heard",
      heardBy: "status",
    });
    // F-M4 — a desktop whose doors went down re-presents its board: no join, no promise
    const loft = held.get("dev-01HQ9S7XZ2")?.get("run-loft-w");
    expect(loft?.terminal).toBeUndefined();
    expect(loft?.monitorRow).toMatchObject({ attachable: false, writable: false });
    // the field board's reader does not take it: an older phone keeps reading `field`
    expect(AgentMeshOpen.safeParse(golden("agent-remote-mesh-open.valid.json")).success).toBe(
      false,
    );
  });

  it("a peer window's door takes every remote board and frame verbatim, as its own mesh relays them", () => {
    const asWindow = AgentModelMeshOpen.parse(golden("agent-remote-mesh-open.valid.json"));
    expect(asWindow.devices).toHaveLength(3);
    for (const frame of golden("agent-remote-mesh-frames.valid.json") as unknown[])
      expect(AgentModelMeshFrame.safeParse(frame).success).toBe(true);
    // and the local scope's pair, a peer daemon's upstream
    const home = (golden("agent-remote-mesh-open.valid.json") as AgentRemoteMeshOpen).devices[0];
    const snapshot = AgentRemoteSnapshot.parse(home?.snapshot);
    expect(snapshot.revision).toBe(61);
    const delta = (golden("agent-remote-mesh-frames.valid.json") as Array<{ delta?: unknown }>)[0]
      ?.delta;
    expect(AgentRemoteDelta.parse(delta).removed).toEqual(["pty-s4"]);
  });

  it("`remote` is a projection and `desk` is one no longer (retired into it)", () => {
    expect(AgentProjection.options).toEqual(["full", "field", "model", "remote"]);
    expect(AgentSubscribeParams.safeParse({ projection: "desk" }).success).toBe(false);
    expect(AgentSubscribeParams.parse({ projection: "remote", minIntervalMs: 1_000 })).toEqual({
      projection: "remote",
      minIntervalMs: 1_000,
    });
    // PG-D8 — the floors: a peer window's, the phone's, and its urgent edge inside it
    expect(AGENT_FIELD.REMOTE_MIN_INTERVAL_MS).toBe(100);
    expect(AGENT_FIELD.REMOTE_PHONE_MIN_INTERVAL_MS).toBe(1_000);
    expect(AGENT_FIELD.REMOTE_URGENT_MS).toBe(250);
    expect(AGENT_FIELD.REMOTE_URGENT_MS).toBeLessThan(AGENT_FIELD.REMOTE_PHONE_MIN_INTERVAL_MS);
  });
});

// PG-3a (Q-J1 (a), James 2026-11-01 03:55Z) — THE WITNESS GOLDENS: the remote
// cut's states a phone must read row for row with its home's window, which the
// PG-2 goldens never reach (every row there is read and fresh, and every key is
// its id). Hand-written in this contract commit, as every remote golden is
// (EL9: contracts first); the producer side is held to them in field-app
// (`test/phone-goldens-producer.test.ts`, fieldd's own cut), and the window's
// fold, replica and J1 step over them are the computed goldens
// (`field-app/test/fixtures/phone-godview/`).
describe("PG-3a — the witness goldens: the remote cut's states the phone reads row for row", () => {
  const HOME = "dev-01HQ9S7UD1";
  const LOFT = "dev-01HQ9S7XZ2";
  const ATTIC = "dev-01HQ9S7Y44";
  const open = (): AgentRemoteMeshOpen =>
    AgentRemoteMeshOpen.parse(golden("agent-remote-mesh-open.witness.json"));
  const frames = (): AgentRemoteMeshFrame[] =>
    (golden("agent-remote-mesh-frames.witness.json") as unknown[]).map((frame) =>
      AgentRemoteMeshFrame.parse(frame),
    );
  const boardOf = (device: string) => open().devices.find((entry) => entry.device === device);
  const rowsOf = (device: string): AgentRemoteRow[] => boardOf(device)?.snapshot?.rows ?? [];
  const row = (device: string, key: string): AgentRemoteRow => {
    const found = rowsOf(device).find((candidate) => candidate.runtimeRunId === key);
    if (found === undefined) throw new Error(`${key} is not on ${device}'s board`);
    return found;
  };
  /** every row the witness carries: the open's boards, then every frame's rows */
  const everyRow = (): AgentRemoteRow[] => [
    ...open().devices.flatMap((entry) => entry.snapshot?.rows ?? []),
    ...frames().flatMap((frame) =>
      "delta" in frame ? frame.delta.upserts : "snapshot" in frame ? frame.snapshot.rows : [],
    ),
  ];

  it("the open: the home live, a live peer, an asleep peer carrying the board its home kept", () => {
    expect(open().devices.map((entry) => [entry.device, entry.state])).toEqual([
      [HOME, "live"],
      [LOFT, "live"],
      [ATTIC, "asleep"],
    ]);
    // DS-L8 — asleep is a state, not an absence: the home sends the board it kept
    expect(rowsOf(ATTIC).map((entry) => entry.runtimeRunId)).toEqual(["run-a-idle"]);
    for (const entry of open().devices)
      expect(entry.snapshot?.epoch).toMatch(/^fieldd-[0-9a-f]{16}\.\d+$/);
  });

  it("an unread mark on a home row and on a peer's, as each owner keeps it (L5)", () => {
    expect(row(HOME, "run-h-turn").monitorRow).toMatchObject({ status: "idle", unread: true });
    expect(row(LOFT, "run-p-done").monitorRow).toMatchObject({ status: "idle", unread: true });
    // and a frame that ends a turn nobody has shown carries the owner's mark
    const ended = frames()[1];
    if (ended === undefined || !("delta" in ended)) throw new Error("frame 1 is the home's delta");
    expect(ended.delta.upserts[0]?.monitorRow).toMatchObject({
      id: "run-h-partial",
      status: "idle",
      unread: true,
      reply: { final: true },
    });
  });

  it("the cost in every coverage: complete with a burn, partial with a burn, unavailable with none", () => {
    expect(row(HOME, "run-h-turn").monitorRow.cost).toMatchObject({
      usd: 2.1,
      coverage: "complete",
      burnPerHour: 0.9,
    });
    expect(row(HOME, "run-h-partial").monitorRow.cost).toMatchObject({
      usd: 0.62,
      coverage: "partial",
      burnPerHour: 30,
    });
    const quiet = row(HOME, "run-h-quiet").monitorRow;
    expect(quiet.cost).toEqual({ usd: 0, coverage: "unavailable" });
    // the owner's evidence that it went quiet, which the home's window keeps for its own rows
    expect(quiet).toMatchObject({ status: "working", stale: true });
    // the J1 discriminator: a live peer's row its owner calls stale
    expect(row(LOFT, "run-p-ask").monitorRow).toMatchObject({ status: "blocked", stale: true });
  });

  it("M22 — a promoted row's key is its run and its id its shell's, at the open and in one delta", () => {
    const turn = row(HOME, "run-h-turn");
    expect(turn.monitorRow.id).toBe("pty-h1");
    expect(turn.terminal).toMatchObject({ hosted: "local", runtimeSessionId: "pty-h1" });
    expect(row(LOFT, "run-p-ask").monitorRow.id).toBe("pty-p3");
    // item 137's case: the run's key arrives carrying the shell's id while the shell's key leaves
    const promotion = frames()[0];
    if (promotion === undefined || !("delta" in promotion))
      throw new Error("frame 0 is the home's delta");
    expect(promotion.device).toBe(HOME);
    const [typed] = promotion.delta.upserts;
    expect(typed).toMatchObject({
      runtimeRunId: "run-h-typed",
      terminal: { hosted: "local", runtimeSessionId: "pty-h2" },
      monitorRow: { id: "pty-h2", kind: "agent" },
    });
    expect(typed?.kind).toBeUndefined();
    expect(promotion.delta.removed).toEqual(["pty-h2"]);
    expect(row(HOME, "pty-h2").kind).toBe("terminal");
  });

  it("each desktop's chain: a same-epoch re-present, a re-attach on a new epoch, and a delta on the old chain", () => {
    const loftBoard = boardOf(LOFT)?.snapshot;
    const loft = frames().filter((frame) => frame.device === LOFT);
    const kinds = loft.map((frame) =>
      "delta" in frame ? "delta" : "snapshot" in frame ? "snapshot" : frame.state,
    );
    expect(kinds).toEqual(["snapshot", "stale", "snapshot", "live", "delta", "delta"]);
    const [present, , reattach, , removal, gap] = loft;
    // PG-1d — the board re-presented on its own chain, row for row as it was
    if (present === undefined || !("snapshot" in present)) throw new Error("a re-present");
    expect(present.snapshot).toEqual(loftBoard);
    // a restarted daemon: a new chain, the question answered, the idle shell gone
    if (reattach === undefined || !("snapshot" in reattach)) throw new Error("a re-attach");
    expect(reattach.snapshot.epoch).not.toBe(loftBoard?.epoch);
    expect(reattach.snapshot.rows.map((entry) => entry.runtimeRunId)).toEqual([
      "run-p-ask",
      "run-p-done",
    ]);
    expect(reattach.snapshot.rows[0]?.monitorRow).toMatchObject({
      id: "pty-p3",
      status: "working",
      stale: false,
    });
    if (removal === undefined || !("delta" in removal)) throw new Error("a delta on the new chain");
    expect(removal.delta).toMatchObject({
      epoch: reattach.snapshot.epoch,
      since: reattach.snapshot.revision,
      removed: ["run-p-done"],
    });
    // the old chain heard after the new one: no reader can follow it
    if (gap === undefined || !("delta" in gap)) throw new Error("a delta on the old chain");
    expect(gap.delta).toMatchObject({ epoch: loftBoard?.epoch, since: loftBoard?.revision });
  });

  it("bare terminals on the home and a peer, each named by its folder (EL7 B1)", () => {
    for (const [device, key] of [
      [HOME, "pty-h2"],
      [LOFT, "pty-p1"],
    ] as const) {
      expect(row(device, key)).toMatchObject({
        kind: "terminal",
        terminal: { hosted: "local", runtimeSessionId: key },
        monitorRow: { id: key, kind: "terminal", detail: "notes", project: { name: "notes" } },
      });
    }
  });

  it("the project-key pair: the remote cut names a run with no cwd by its provider and one with only a workspace by its root; the field cut names neither", () => {
    expect(row(HOME, "run-h-nocwd").monitorRow.project).toEqual({ name: "Claude Code" });
    expect(row(HOME, "run-h-root").monitorRow.project).toEqual({ name: "vibe-field" });
    const field = AgentFieldSnapshot.parse(golden("agent-field-snapshot.project-keys.json"));
    expect(field.rows.map((entry) => entry.runtimeRunId)).toEqual(["run-h-nocwd", "run-h-root"]);
    for (const entry of field.rows) {
      // the kit's key is `projectName ?? label`: "Claude Code" for both, where the remote cut says two names
      expect(entry.project, entry.runtimeRunId).toBeUndefined();
      expect(entry.label).toBe("Claude Code");
      expect(entry.device).toBe(HOME);
    }
  });

  it("Q06 — a crashed home run: dead, its failure its wait, its local terminal join kept, so the home's window keeps its body", () => {
    const crash = row(HOME, "run-h-crash");
    expect(crash.terminal).toEqual({
      hosted: "local",
      runtimeSessionId: "pty-h3",
      workloadClass: "agent",
    });
    // a run whose shell the floor still lists keeps the shell's id (M22), dead or alive
    expect(crash.monitorRow).toMatchObject({
      id: "pty-h3",
      kind: "agent",
      status: "blocked",
      alive: false,
      observed: true,
      wait: { kind: "failure" },
    });
    // the only dead row the witness carries
    expect(
      everyRow()
        .filter((entry) => !entry.monitorRow.alive)
        .map((entry) => entry.runtimeRunId),
    ).toEqual(["run-h-crash"]);
  });

  it("PG-1c — the whole-mesh resync: every desktop as it stands after frame 7, on its own chain, and one home change the reader never heard", () => {
    const resync = AgentRemoteMeshOpen.parse(golden("agent-remote-mesh-open.resync.json"));
    expect(resync.devices.map((entry) => [entry.device, entry.state])).toEqual([
      [HOME, "live"],
      [LOFT, "live"],
      [ATTIC, "asleep"],
    ]);
    const [home, loft, attic] = resync.devices.map((entry) => entry.snapshot);
    // each chain where the frames left it: the home past frame 7 by one delta, the peer on its new chain
    expect(home).toMatchObject({ epoch: boardOf(HOME)?.snapshot?.epoch, revision: 84 });
    const reattach = frames()[4];
    if (reattach === undefined || !("snapshot" in reattach))
      throw new Error("frame 4 is a re-attach");
    expect(loft).toMatchObject({ epoch: reattach.snapshot.epoch, revision: 4 });
    expect(attic).toEqual(boardOf(ATTIC)?.snapshot);
    expect(home?.rows.map((entry) => `${entry.runtimeRunId}→${entry.monitorRow.id}`)).toEqual([
      "run-h-turn→pty-h1",
      "run-h-partial→run-h-partial",
      "run-h-nocwd→run-h-nocwd",
      "run-h-root→run-h-root",
      "run-h-crash→pty-h3",
      "run-h-typed→pty-h2",
    ]);
    expect(loft?.rows.map((entry) => entry.runtimeRunId)).toEqual(["run-p-ask"]);
    // the change it heals: the home's own window showed run-h-turn, so its owner cleared the mark
    expect(home?.rows[0]?.monitorRow.unread).toBe(false);
    expect(AgentModelMeshOpen.safeParse(golden("agent-remote-mesh-open.resync.json")).success).toBe(
      true,
    );
  });

  it("every row as PG-2 holds it: observed, alive but the crash, no colour sequence, no path, every text at the bound, no field half", () => {
    const rows = everyRow();
    expect(rows.length).toBeGreaterThanOrEqual(17);
    for (const entry of rows) {
      const id = entry.runtimeRunId;
      expect(entry.monitorRow, id).toMatchObject({ observed: true, alive: id !== "run-h-crash" });
      expect(
        Number.isInteger(entry.monitorRow.createdAt) && entry.monitorRow.createdAt > 0,
        id,
      ).toBe(true);
      expect(entry.monitorRow.project.seq, id).toBeUndefined();
      // the outer kind is a bare terminal's alone, and says what the model row says
      expect(entry.kind === "terminal", id).toBe(entry.monitorRow.kind === "terminal");
      expect(JSON.stringify(entry), id).not.toMatch(/\/Users\/|\/home\/|[A-Za-z]:\\\\/);
      for (const text of [
        entry.monitorRow.detail,
        entry.monitorRow.reply?.text,
        entry.monitorRow.wait?.question,
        entry.monitorRow.wait?.header,
      ]) {
        expect(text?.length ?? 0, id).toBeLessThanOrEqual(AGENT_FIELD.DESK_TEXT_CHARS);
      }
      for (const key of ["status", "label", "tier", "blockers", "usage", "local"])
        expect(key in entry, `${id}: ${key}`).toBe(false);
    }
    // nothing elided or hidden: every epoch and id spelled out in full
    for (const name of [
      "agent-remote-mesh-open.witness.json",
      "agent-remote-mesh-frames.witness.json",
      "agent-field-snapshot.project-keys.json",
      "agent-remote-mesh-open.resync.json",
    ]) {
      expect(readFileSync(join(FIXTURES, name), "utf8"), name).not.toMatch(
        /[\u200B-\u200D\uFEFF\u2026]/,
      );
    }
  });

  it("both doors read the witness: the phone's remote door and a peer window's model door", () => {
    expect(
      AgentModelMeshOpen.parse(golden("agent-remote-mesh-open.witness.json")).devices,
    ).toHaveLength(3);
    const raw = golden("agent-remote-mesh-frames.witness.json") as unknown[];
    expect(raw).toHaveLength(9);
    for (const frame of raw) expect(AgentModelMeshFrame.safeParse(frame).success).toBe(true);
    // the field board's reader does not take it: an older phone keeps reading `field`
    expect(AgentMeshOpen.safeParse(golden("agent-remote-mesh-open.witness.json")).success).toBe(
      false,
    );
  });
});

describe("item 100 — whose cut a caller reads, by its principal's kind (M16, SP-L4)", () => {
  it("names every kind, and only this desktop's own callers read the window's whole row", () => {
    // the typecheck holds the table to `Principal["kind"]`; this row holds what it says
    expect(Object.keys(MONITOR_AUDIENCE)).toHaveLength(7);
    const windows = Object.entries(MONITOR_AUDIENCE)
      .filter(([, audience]) => audience === "window")
      .map(([kind]) => kind);
    expect(windows.sort()).toEqual(["local-token", "shell-main"]);
    expect(MONITOR_AUDIENCE.tailnet).toBe("peer");
    expect(MONITOR_AUDIENCE["peer-fieldd"]).toBe("peer");
  });

  // PG-3b (the 3b review [0], 2026-11-01) — which boards make a screen, beside whose cut a caller reads
  it("PG-3b — a model board is a screen for this desktop's windows; a remote board and the reader are the phone's alone", () => {
    expect(Object.keys(SCREEN_BOARDS).sort()).toEqual(Object.keys(MONITOR_AUDIENCE).sort());
    const kinds = (board: "model" | "remote" | "reader") =>
      Object.entries(SCREEN_BOARDS)
        .filter(([, boards]) => boards[board])
        .map(([kind]) => kind)
        .sort();
    // `model` is served to the window audience alone, and each of them is a screen
    expect(kinds("model")).toEqual(
      Object.entries(MONITOR_AUDIENCE)
        .filter(([, audience]) => audience === "window")
        .map(([kind]) => kind)
        .sort(),
    );
    expect(kinds("remote")).toEqual(["tailnet"]);
    expect(kinds("reader")).toEqual(["tailnet"]);
    // a plugin, a guest, an agent's MCP session and a peer daemon clear no mark by holding a board
    for (const kind of ["plugin", "tailnet-guest", "mcp-agent", "peer-fieldd"] as const)
      expect(SCREEN_BOARDS[kind]).toEqual({ model: false, remote: false, reader: false });
  });
});

// PG-1b (PG-L4.1) — the relay's reading: every board golden this repo pins is
// readable by its key alone, field rows, desk rows, bare terminals and the
// model board's rows alike, and the key reading copies every other fact
// through untouched (DS-L2).
describe("AgentBoardRowKey — the relay reads each row's key alone", () => {
  type Board = { revision: number; rows: unknown[]; epoch?: string | undefined };
  const boards = (): Board[] => {
    const found: Board[] = [AgentFieldSnapshot.parse(golden("agent-field-snapshot.valid.json"))];
    for (const name of [
      "agent-mesh-open.valid.json",
      "agent-model-mesh-open.valid.json",
      "agent-remote-mesh-open.valid.json",
      "agent-remote-mesh-open.witness.json",
      "agent-remote-mesh-open.resync.json",
    ]) {
      const open = golden(name) as { devices: Array<{ snapshot?: Board }> };
      for (const device of open.devices)
        if (device.snapshot !== undefined) found.push(device.snapshot);
    }
    return found;
  };

  it("reads every pinned board and every pinned delta, and keeps every fact past the key", () => {
    for (const board of boards()) {
      const keyed = AgentBoardKeySnapshot.parse(board);
      expect(keyed).toEqual(board);
    }
    const deltas = [
      golden("agent-field-delta.valid.json"),
      ...(golden("agent-mesh-frames.valid.json") as Array<{ delta?: unknown }>).map((f) => f.delta),
      ...(golden("agent-model-mesh-frames.valid.json") as Array<{ delta?: unknown }>).map(
        (f) => f.delta,
      ),
      ...(golden("agent-remote-mesh-frames.valid.json") as Array<{ delta?: unknown }>).map(
        (f) => f.delta,
      ),
      ...(golden("agent-remote-mesh-frames.witness.json") as Array<{ delta?: unknown }>).map(
        (f) => f.delta,
      ),
    ].filter((delta) => delta !== undefined);
    expect(deltas.length).toBeGreaterThan(3);
    for (const delta of deltas) expect(AgentBoardKeyDelta.parse(delta)).toEqual(delta);
  });

  it("reads a bare terminal, a remote row and a desk row the field row refuses or holds whole", () => {
    for (const name of [
      "agent-desk-terminal-row.valid.json",
      "agent-remote-row.valid.json",
      "agent-remote-row.terminal.json",
    ]) {
      const row = golden(name);
      expect(AgentFieldRow.safeParse(row).success, name).toBe(false);
      expect(AgentBoardRowKey.parse(row), name).toEqual(row);
    }
    const desk = golden("agent-desk-row.valid.json");
    expect(AgentBoardRowKey.parse(desk)).toEqual(desk);
  });

  it("refuses what has no key: no run id, an empty one, or a stamp that is no integer", () => {
    expect(AgentBoardRowKey.safeParse({ revision: 1 }).success).toBe(false);
    expect(AgentBoardRowKey.safeParse({ runtimeRunId: "", revision: 1 }).success).toBe(false);
    expect(AgentBoardRowKey.safeParse({ runtimeRunId: "run-a", revision: 1.5 }).success).toBe(
      false,
    );
    expect(AgentBoardRowKey.safeParse({ runtimeRunId: "run-a" }).success).toBe(false);
  });
});
