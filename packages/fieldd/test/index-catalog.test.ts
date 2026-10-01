import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION } from "@rosetta/protocol/protocol-version";
import {
  AGENT_CATALOG,
  createAgentCatalogReaders,
  IndexCatalogProject,
  type IndexCatalogProject as IndexCatalogProjectRow,
  IndexCatalogSession,
  type IndexCatalogSession as IndexCatalogSessionRow,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { RowsCopy } from "../src/catalog-rows";
import { IndexCatalog } from "../src/index-catalog";
import type { RosettadState, RosettadSupervisor } from "../src/rosettad-supervisor";

// DS-6 — the history catalog's source (index-catalog.ts) against the scripted
// rosettad's `/ws/meta` (test/fixtures/fake-rosettad.mjs speaks the stream as
// it is at the pin: hello, ONE snapshot of the whole mirror, then unstamped
// FULL-row mutations, a resync barrier, and NO removal event). The follower
// must: republish top-level sessions and projects as rows stamped with this
// device, name each session's agent through the runtime rows, compute the
// repository family, fold a burst of mutations into one frame per table, keep
// its tables across a lost stream, find a SILENT removal only by diffing a
// fresh snapshot, and refuse a daemon that speaks another protocol.

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, "fixtures", "fake-rosettad.mjs");
const readers = createAgentCatalogReaders(AGENT_CATALOG);

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const until = async (predicate: () => boolean, timeoutMs = 5_000, what = "condition") => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

interface SessionFixture {
  id: string;
  native_session_id: string;
  root_session_id: string;
  parent_session_id: string | null;
  runtime_id: string;
  project_id: string | null;
  cwd: string | null;
  title: string | null;
  summary: string | null;
  started_at: number;
  updated_at: number;
  activity: { first_at: number; last_at: number } | null;
  stream_state: string;
  role: string;
  delegation: null;
}

const session = (id: string, over: Partial<SessionFixture> = {}): SessionFixture => ({
  id,
  native_session_id: `nat-${id}`,
  root_session_id: id,
  parent_session_id: null,
  runtime_id: "rt-claude",
  project_id: "p-app",
  cwd: "/work/app",
  title: `title ${id}`,
  summary: null,
  started_at: 1_000,
  updated_at: 2_000,
  activity: { first_at: 1_000, last_at: 5_000 },
  stream_state: "indexed",
  role: "primary",
  delegation: null,
  ...over,
});

const RUNTIMES = [
  { id: "rt-claude", kind: "claude-code", data_root: "~/.claude", enabled: true },
  { id: "rt-codex", kind: "codex", data_root: "~/.codex", enabled: true },
];
const PROJECTS = [
  { id: "p-app", name: "app", root_paths: ["/work/app"], git_repo: "github.com:o/app" },
  { id: "p-lib", name: "lib", root_paths: ["/work/lib"], git_repo: null },
];

interface World {
  dir: string;
  write(file: "sessions" | "projects" | "runtimes" | "control", value: unknown): void;
  origin: string;
  child: ChildProcess;
}

async function startFake(
  initial: { sessions?: unknown; projects?: unknown; runtimes?: unknown } = {},
  env: Record<string, string> = {},
): Promise<World> {
  const dir = mkdtempSync(join(tmpdir(), "vf-ixc-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const files = {
    sessions: join(dir, "sessions.json"),
    projects: join(dir, "projects.json"),
    runtimes: join(dir, "runtimes.json"),
    control: join(dir, "control.json"),
  };
  const write = (file: keyof typeof files, value: unknown) =>
    writeFileSync(files[file], JSON.stringify(value));
  write("sessions", initial.sessions ?? []);
  write("projects", initial.projects ?? PROJECTS);
  write("runtimes", initial.runtimes ?? RUNTIMES);
  write("control", {});
  const child = spawn(process.execPath, [FAKE, "serve", "--json"], {
    env: {
      ...process.env,
      FAKE_ROSETTAD_MODE: "ok",
      FAKE_ROSETTAD_SESSIONS: files.sessions,
      FAKE_ROSETTAD_PROJECTS: files.projects,
      FAKE_ROSETTAD_RUNTIMES: files.runtimes,
      FAKE_ROSETTAD_META_CONTROL: files.control,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  cleanup.push(() => {
    child.kill("SIGINT");
  });
  const origin = await new Promise<string>((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(() => reject(new Error("the fake never said ready")), 10_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString();
      for (const line of buffered.split("\n")) {
        try {
          const parsed = JSON.parse(line) as { event?: string; origin?: string };
          if (parsed.event === "ready" && typeof parsed.origin === "string") {
            clearTimeout(timer);
            resolve(parsed.origin);
          }
        } catch {
          // not a whole line yet
        }
      }
    });
    child.once("exit", (code) => reject(new Error(`the fake exited ${code}`)));
  });
  return { dir, write, origin, child };
}

/** A supervisor that is only what the follower reads: its state and its
 * transitions. */
function supervisorAt(origin: string | null) {
  const events = new EventEmitter();
  let state: RosettadState = {
    phase: origin === null ? "starting" : "ready",
    origin,
    detail: null,
    pid: 1,
    protocolVersion: PROTOCOL_VERSION,
    announce: null,
    enrollRefusals: [],
  };
  const supervisor = Object.assign(events, {
    state: () => state,
    health: () => state,
  }) as unknown as RosettadSupervisor;
  return {
    supervisor,
    move(next: Partial<RosettadState>) {
      state = { ...state, ...next };
      events.emit("transition", state);
    },
  };
}

function follower(
  origin: string | null,
  opts: { deviceId?: () => string; resnapshotMs?: number } = {},
) {
  const control = supervisorAt(origin);
  const catalog = new IndexCatalog({
    supervisor: control.supervisor,
    expectedProtocolVersion: PROTOCOL_VERSION,
    deviceId: opts.deviceId ?? (() => "dev-a"),
    epoch: "boot-test",
    batchMs: 20,
    reconnectMinMs: 50,
    reconnectMaxMs: 200,
    resnapshotMs: opts.resnapshotMs ?? 0,
  });
  cleanup.push(() => catalog.dispose());
  catalog.start();
  return { catalog, ...control };
}

const ids = (rows: Array<{ sessionId?: string | undefined; projectId?: string | undefined }>) =>
  rows.map((row) => row.sessionId ?? row.projectId).sort();

describe("IndexCatalog — following rosetta's /ws/meta (DS-6)", () => {
  it("republishes top-level sessions and projects as rows: device, agent, family, figures", async () => {
    const world = await startFake({
      sessions: [
        session("s1", { activity: { first_at: 1_000, last_at: 9_000 } }),
        session("s2", { runtime_id: "rt-codex", activity: { first_at: 1_000, last_at: 7_000 } }),
        // a delegated child: transcript structure, never a catalog row
        session("c1", { parent_session_id: "s1", root_session_id: "s1" }),
        session("s3", { project_id: "p-lib", runtime_id: "rt-unknown", activity: null }),
        // contradicting bounds are no evidence
        session("s4", { project_id: null, activity: { first_at: 9, last_at: 1 } }),
      ],
    });
    const { catalog } = follower(world.origin);
    await until(() => catalog.ready, 5_000, "the first snapshot");
    expect(catalog.phase).toBe("live");

    expect(ids(catalog.sessions.rows())).toEqual(["s1", "s2", "s3", "s4"]);
    for (const row of catalog.sessions.rows()) {
      expect(IndexCatalogSession.safeParse(row).success).toBe(true);
      expect(row.device).toBe("dev-a");
    }
    const s1 = catalog.sessions.get("s1");
    expect(s1).toMatchObject({
      nativeSessionId: "nat-s1",
      kind: "claude-code",
      projectId: "p-app",
      cwd: "/work/app",
      title: "title s1",
      startedAt: 1_000,
      updatedAt: 2_000,
      activity: { firstAt: 1_000, lastAt: 9_000 },
      streamState: "indexed",
    });
    expect(s1?.provider).toBe(readers.idForKind("claude-code"));
    expect(catalog.sessions.get("s2")?.provider).toBe(readers.idForKind("codex"));
    // a runtime the stream never named: no kind, no provider — still a row
    expect(catalog.sessions.get("s3")).not.toHaveProperty("kind");
    expect(catalog.sessions.get("s3")).not.toHaveProperty("provider");
    expect(catalog.sessions.get("s4")?.activity).toBeNull();

    const app = catalog.projects.get("p-app");
    for (const row of catalog.projects.rows()) {
      expect(IndexCatalogProject.safeParse(row).success).toBe(true);
    }
    expect(app).toMatchObject({
      device: "dev-a",
      name: "app",
      rootPaths: ["/work/app"],
      gitRepo: "github.com:o/app",
      family: "github.com/o/app",
      sessionCount: 2,
      lastActivityAt: 9_000,
    });
    const lib = catalog.projects.get("p-lib");
    expect(lib).toMatchObject({ sessionCount: 1 });
    expect(lib).not.toHaveProperty("family"); // no remote, no family
    expect(lib).not.toHaveProperty("lastActivityAt"); // none of its sessions has any
  });

  it("folds a burst of mutations into one frame per table, and moves the project's figures", async () => {
    const world = await startFake({ sessions: [session("s1"), session("s2")] });
    const { catalog } = follower(world.origin);
    await until(() => catalog.ready, 5_000, "the first snapshot");
    const sessionsAt = catalog.sessions.revision;
    const frames: number[] = [];
    catalog.sessions.onDelta((delta) => frames.push(delta.upserts.length));

    world.write("sessions", [
      session("s1", { title: "renamed", activity: { first_at: 1_000, last_at: 20_000 } }),
      session("s2", { title: "also renamed" }),
      session("s5", { activity: { first_at: 1_000, last_at: 30_000 } }),
    ]);
    await until(() => catalog.sessions.get("s5") !== undefined, 5_000, "the new session");
    await until(() => catalog.sessions.get("s2")?.title === "also renamed", 5_000, "both renames");
    // the fake polls every 40ms and the batch window is 20ms: the three rows
    // arrive as mutations close together — never one frame per row
    expect(catalog.sessions.revision - sessionsAt).toBeLessThanOrEqual(2);
    expect(frames.reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(catalog.sessions.get("s1")?.title).toBe("renamed");
    await until(() => catalog.projects.get("p-app")?.lastActivityAt === 30_000, 5_000, "figures");
    expect(catalog.projects.get("p-app")?.sessionCount).toBe(3);
  });

  it("a SILENT removal stays until a fresh snapshot is diffed in — the re-snapshot finds it", async () => {
    const world = await startFake({ sessions: [session("s1"), session("s2")] });
    const { catalog } = follower(world.origin);
    await until(() => catalog.ready, 5_000, "the first snapshot");
    world.write("sessions", [session("s1")]); // s2 dropped without a word
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(catalog.sessions.has("s2")).toBe(true); // the stream said nothing, honestly
    const removed: string[] = [];
    catalog.sessions.onDelta((delta) => removed.push(...delta.removed));
    catalog.resnapshot();
    await until(() => !catalog.sessions.has("s2"), 5_000, "the diffed removal");
    expect(removed).toEqual(["s2"]);
    expect(catalog.projects.get("p-app")?.sessionCount).toBe(1);
    expect(catalog.phase).toBe("live"); // a deliberate re-dial never reads stale
  });

  it("the re-snapshot runs on its own cadence", async () => {
    const world = await startFake({ sessions: [session("s1"), session("s2")] });
    const { catalog } = follower(world.origin, { resnapshotMs: 250 });
    await until(() => catalog.ready, 5_000, "the first snapshot");
    world.write("sessions", [session("s2")]);
    await until(() => !catalog.sessions.has("s1"), 5_000, "the cadence's diff");
  });

  it("a resync barrier's fresh snapshot is diffed like any other", async () => {
    const world = await startFake({ sessions: [session("s1"), session("s2")] });
    const { catalog } = follower(world.origin);
    await until(() => catalog.ready, 5_000, "the first snapshot");
    world.write("sessions", [session("s2")]);
    world.write("control", { resync: 1 });
    await until(() => !catalog.sessions.has("s1"), 5_000, "the resync's diff");
  });

  it("keeps its tables when the stream drops, reads stale, and re-dials to live", async () => {
    const world = await startFake({ sessions: [session("s1")] });
    const { catalog } = follower(world.origin);
    await until(() => catalog.ready, 5_000, "the first snapshot");
    const phases: string[] = [];
    catalog.on("phase", (phase: string) => phases.push(phase));
    world.write("control", { drop: 1 });
    await until(() => phases.includes("stale"), 5_000, "stale");
    expect(catalog.sessions.has("s1")).toBe(true); // asleep is a state, not an absence
    await until(() => catalog.phase === "live", 5_000, "the re-dial");
  });

  it("a daemon that is not ready is waited for; a new origin is re-dialed; its tables stay", async () => {
    const first = await startFake({ sessions: [session("s1")] });
    const { catalog, move } = follower(null);
    expect(catalog.phase).toBe("waiting");
    move({ phase: "ready", origin: first.origin });
    await until(() => catalog.ready, 5_000, "the first snapshot");
    move({ phase: "restarting", origin: null });
    expect(catalog.phase).toBe("waiting");
    expect(catalog.sessions.has("s1")).toBe(true);
    const second = await startFake({ sessions: [session("s9")] });
    move({ phase: "ready", origin: second.origin });
    await until(
      () => catalog.sessions.has("s9") && !catalog.sessions.has("s1"),
      5_000,
      "the new daemon",
    );
  });

  it("refuses a daemon that speaks another protocol, and never reads ready", async () => {
    const world = await startFake({ sessions: [session("s1")] }, { FAKE_ROSETTAD_PROTOCOL: "1" });
    const { catalog } = follower(world.origin);
    await until(() => catalog.phase === "incompatible", 5_000, "incompatible");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(catalog.ready).toBe(false);
    expect(catalog.sessions.size).toBe(0);
  });

  it("re-stamps every row when the device id moves from its fallback to the mesh identity", async () => {
    let device = "local-fallback";
    const world = await startFake({ sessions: [session("s1")] });
    const { catalog } = follower(world.origin, { deviceId: () => device });
    await until(() => catalog.ready, 5_000, "the first snapshot");
    expect(catalog.sessions.get("s1")?.device).toBe("local-fallback");
    device = "dev-mesh";
    world.write("sessions", [session("s1", { title: "touched" })]);
    await until(() => catalog.sessions.get("s1")?.title === "touched", 5_000, "the touch");
    expect(catalog.sessions.rows().every((row) => row.device === "dev-mesh")).toBe(true);
    expect(catalog.projects.rows().every((row) => row.device === "dev-mesh")).toBe(true);
  });

  it("a peer's copy follows the tables through the rows pump", async () => {
    const world = await startFake({ sessions: [session("s1"), session("s2")] });
    const { catalog } = follower(world.origin);
    await until(() => catalog.ready, 5_000, "the first snapshot");
    const copy = new RowsCopy<IndexCatalogSessionRow>({
      keyOf: (row) => row.sessionId,
      parseRow: (raw) => {
        const parsed = IndexCatalogSession.safeParse(raw);
        return parsed.success ? parsed.data : undefined;
      },
    });
    const pump = catalog.pump("sessions", {
      emit: (payload) => copy.apply(payload),
      minIntervalMs: 20,
      digestIntervalMs: 0,
    });
    copy.apply(pump.open);
    pump.start();
    cleanup.push(() => pump.dispose());
    world.write("sessions", [session("s2"), session("s3")]);
    await until(() => copy.rows().some((row) => row.sessionId === "s3"), 5_000, "the delta");
    catalog.resnapshot();
    await until(() => !copy.rows().some((row) => row.sessionId === "s1"), 5_000, "the removal");
    expect(copy.digest()).toEqual(catalog.sessions.digest());
    const projects: IndexCatalogProjectRow[] = catalog.projects.rows();
    expect(projects.map((row) => row.projectId).sort()).toEqual(["p-app", "p-lib"]);
  });
});

// The real binary (`pnpm siblings:build`; FIELDD_ROSETTAD_BIN): the follower
// against rosetta's OWN /ws/meta, over its ground-truth transcript seeded into
// an empty home (nothing of the developer's is ever read). This is the row
// that says the stream reading above is the wire, not the fake's opinion of it.
const REAL_BIN = process.env["FIELDD_ROSETTAD_BIN"];
const GROUNDTRUTH = join(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "rosetta",
  "groundtruth",
  "claude-code",
  "fixtures",
  "2.1.241",
  "basic-chat",
  "claude-config",
);
/** the one session that transcript records */
const FIXTURE_NATIVE_ID = "665e3e71-7c12-4810-925a-e8b92cb6f29d";

describe.skipIf(
  REAL_BIN === undefined || REAL_BIN === "" || !existsSync(REAL_BIN) || !existsSync(GROUNDTRUTH),
)("IndexCatalog — against the real rosettad (opt-in via FIELDD_ROSETTAD_BIN)", () => {
  it("follows the real /ws/meta: the ground-truth session arrives as a row with its agent named", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-ixr-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const home = join(dir, "home");
    mkdirSync(home, { recursive: true });
    cpSync(GROUNDTRUTH, join(home, ".claude"), { recursive: true });
    const child = spawn(
      REAL_BIN as string,
      ["serve", "--json", "--db", join(dir, "r.db"), "--home", home, "--agent", "claude-code"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    cleanup.push(() => {
      child.kill("SIGINT");
    });
    const ready = await new Promise<{ origin: string; protocol_version: number }>(
      (resolve, reject) => {
        let buffered = "";
        const timer = setTimeout(() => reject(new Error("rosettad never said ready")), 30_000);
        child.stdout?.on("data", (chunk: Buffer) => {
          buffered += chunk.toString();
          for (const line of buffered.split("\n")) {
            try {
              const parsed = JSON.parse(line) as {
                event?: string;
                origin?: string;
                protocol_version?: number;
              };
              if (parsed.event === "ready" && typeof parsed.origin === "string") {
                clearTimeout(timer);
                resolve({ origin: parsed.origin, protocol_version: parsed.protocol_version ?? -1 });
              }
            } catch {
              // not a whole line yet
            }
          }
        });
        child.once("exit", (code) => reject(new Error(`rosettad exited ${code}`)));
      },
    );
    expect(
      ready.protocol_version,
      `FIELDD_ROSETTAD_BIN speaks protocol ${ready.protocol_version}; the pin is ${PROTOCOL_VERSION}`,
    ).toBe(PROTOCOL_VERSION);
    const { catalog } = follower(ready.origin);
    await until(
      () => catalog.sessions.rows().some((row) => row.nativeSessionId === FIXTURE_NATIVE_ID),
      60_000,
      "the ground-truth session in the catalog",
    );
    expect(catalog.phase).toBe("live");
    const row = catalog.sessions.rows().find((r) => r.nativeSessionId === FIXTURE_NATIVE_ID);
    expect(IndexCatalogSession.safeParse(row).success).toBe(true);
    expect(row?.kind).toBe("claude-code");
    expect(row?.provider).toBe(readers.idForKind("claude-code"));
    expect(row?.device).toBe("dev-a");
    for (const project of catalog.projects.rows()) {
      expect(IndexCatalogProject.safeParse(project).success).toBe(true);
    }
  }, 90_000);
});
