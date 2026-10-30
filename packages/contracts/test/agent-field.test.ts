import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
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
  AgentReportShownParams,
  AgentSubscribeParams,
  MonitorAgentRow,
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

describe("MV-3a — the model's row on the wire (MV-D22, MV-D18)", () => {
  const row = MonitorAgentRow.parse(golden("monitor-agent-row.valid.json"));
  const desk = AgentDeskRow.parse(golden("agent-desk-row.model.json"));
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

  it("the desk row carries the model's row for a PEER without its colour sequence (M16), and still IS a field row", () => {
    expect(desk.monitorRow?.id).toBe(desk.runtimeRunId);
    expect(desk.monitorRow?.project.seq).toBeUndefined();
    const asField = AgentFieldRow.parse(golden("agent-desk-row.model.json"));
    expect(asField.runtimeRunId).toBe(desk.runtimeRunId);
    expect((asField as Record<string, unknown>)["monitorRow"]).toEqual(desk.monitorRow);
    // a desk row from an older daemon carries none, and parses
    const { monitorRow: _omitted, ...older } = golden("agent-desk-row.model.json") as Record<
      string,
      unknown
    >;
    expect(AgentDeskRow.parse(older).monitorRow).toBeUndefined();
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

  it("the window's one door: this desktop's model board first (its terminal among its rows), peers' desk boards beside it", () => {
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
    const peer = open.devices[1]?.snapshot?.rows[0];
    expect(peer !== undefined && peer.kind !== "terminal" ? peer.monitorRow?.project.seq : -1).toBe(
      undefined,
    );
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

  it("the model's texts name folders, never paths, on the agent row; a terminal's detail is its directory and stays home (L8)", () => {
    expect(JSON.stringify(row)).not.toMatch(/"\/Users\/|"\/home\/|"[A-Za-z]:\\\\/);
    // a terminal row is this desktop's windows' only: the path never leaves the device
    expect(terminal.monitorRow.detail).toBe("/Users/james/Projects/notes");
  });

  it("M41 — the row says its home desktop's write policy, and a row from an older daemon without it still parses", () => {
    // a declared fact, not passthrough: the home backend computed it (today it IS attachable's rule)
    expect(MonitorAgentRow.shape.writable).toBeDefined();
    expect(row).toMatchObject({ attachable: true, writable: true });
    expect(desk.monitorRow).toMatchObject({ attachable: true, writable: true });
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

  it("only this desktop's rows carry them: the peer cut and the peers' boards on the window's door carry none", () => {
    expect("local" in AgentDeskRow.parse(golden("agent-desk-row.model.json"))).toBe(false);
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
