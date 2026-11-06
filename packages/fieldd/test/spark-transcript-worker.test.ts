import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LAYOUT,
  type Scope,
  SOCKETS,
  type SparkRecord,
  SparkTranscriptOpenTicketResult,
  SparkTranscriptServerFrame,
} from "@vibefield/contracts";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { SparkTranscripts } from "../src/spark-transcripts";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { SparkStore } from "../src/tool-plane/sparks";
import type { TranscriptHostLaunch } from "../src/transcripts/launch";
import { TranscriptHostSupervisor } from "../src/transcripts/supervisor";
import { TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { transcriptHostLaunch } from "./transcript-host-bundle";
import { helloAs, WsRpc } from "./ws-rpc";

// TH-1 (TH0-Q5 (b); step0-th §8 "the ticket") — the REAL transcript worker: fieldd's own child process, mille-free,
// started by its supervisor with the folder's key on its IPC pipe (never its environment), a restart a new
// generation that closes every socket it served, and the daemon's door end to end — a window of this desktop reads a
// kept transcript through its ticket while the files worker is off. Its listener alone is
// spark-transcript-host.test.ts's.

const VELA = "sp-7k2m9q4x";
const RUN = "run-vela-1";

let launch: TranscriptHostLaunch;
beforeAll(async () => {
  launch = await transcriptHostLaunch();
}, 60_000);

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) {
    try {
      await fn();
    } catch {
      // gone already
    }
  }
});

/** How long a row waits for the worker before it says it never came. */
const WAIT_MS = 15_000;

/** The message a bounded wait's assertion carries: what it waited for, and how long. */
const waited = (what: string, ms = WAIT_MS) => `waited ${ms} ms for ${what}; none came`;

/** Whether `test` came true within `ms`: a bounded wait the row asserts on (`waited`), never a bare timeout. */
async function came(test: () => boolean, ms = WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!test()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

/** Whether `promise` settled within `ms`. */
const settled = (promise: Promise<unknown>, ms = WAIT_MS): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    void promise.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });

/** A spark's folder as fieldd's store keeps it. */
function folder() {
  const root = mkdtempSync(join(tmpdir(), "vf-transcript-worker-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const store = new SparkTranscripts({
    dir: join(root, ...LAYOUT.SPARK_FILES_DIR),
    keyPath: join(root, ...LAYOUT.SPARK_FILES_KEY_FILE),
  });
  store.append(VELA, RUN, { kind: "run", runtimeRunId: RUN, fresh: true });
  store.append(VELA, RUN, { kind: "you", via: "chat", text: "carry on" });
  store.append(VELA, RUN, { kind: "reply", messageId: "m-1", text: "On it." });
  return { root, store, dir: join(root, ...LAYOUT.SPARK_FILES_DIR) };
}

/** A window reading `runs` with `ticket` on `endpoint`: every frame, parsed as the contract (EL9). */
async function read(endpoint: string, ticket: string, runs: string[]) {
  const ws = new WebSocket(endpoint);
  cleanup.push(() => ws.terminate());
  const frames: SparkTranscriptServerFrame[] = [];
  ws.on("message", (data) =>
    frames.push(SparkTranscriptServerFrame.parse(JSON.parse(String(data)))),
  );
  const closed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "open", ticket, runs: runs.map((run) => ({ run })) }));
  expect(
    await came(() => frames.some((f) => f.type === "caught-up" || f.type === "refused")),
    waited("the window's caught-up or refused frame"),
  ).toBe(true);
  return { ws, frames, closed };
}

describe("the transcript worker, a real child of fieldd's (TH-1)", () => {
  it("starts with its key on the pipe and never in its environment or arguments, and serves a window", async () => {
    const f = folder();
    const spawned: { args: readonly string[]; env: NodeJS.ProcessEnv | undefined }[] = [];
    const children: ChildProcess[] = [];
    const supervisor = new TranscriptHostSupervisor({
      launch: { kind: "launch", launch },
      dir: f.dir,
      key: () => f.store.secret(),
      allowedOrigins: ["file://"],
      environment: { ...process.env, FIELDD_TEST_SECRET: "held", FIELD_NATIVE_TOKEN: "held" },
      spawnProcess: ((
        command: string,
        args: readonly string[],
        options: { env?: NodeJS.ProcessEnv },
      ) => {
        spawned.push({ args, env: options.env });
        const child = nodeSpawn(command, [...args], options as Parameters<typeof nodeSpawn>[2]);
        children.push(child);
        return child;
      }) as typeof nodeSpawn,
    });
    cleanup.push(() => supervisor.stop());
    supervisor.start();
    expect(
      await came(() => supervisor.health().phase === "ready"),
      waited("the worker to say ready"),
    ).toBe(true);
    const key = f.store.secret();
    const [first] = spawned;
    expect(first).toBeDefined();
    const env = Object.entries(first?.env ?? {});
    expect(env.filter(([name]) => /^FIELDD?_/i.test(name))).toEqual([]);
    for (const secret of [key.toString("base64"), key.toString("hex"), key.toString("base64url")]) {
      expect(env.some(([, value]) => value?.includes(secret))).toBe(false);
      expect(first?.args.some((arg) => arg.includes(secret))).toBe(false);
    }
    const ticket = randomBytes(32).toString("base64url");
    const { port } = await supervisor.request("registerTicket", {
      ticket,
      spark: VELA,
      clientId: "tok-window",
      expiresAt: Date.now() + 60_000,
    });
    // SP-7a (D1 (B)) — the ready generation's port is in its health: the routed serve aims at it
    expect(supervisor.health().port).toBe(port);
    const window = await read(`ws://127.0.0.1:${port}/transcripts`, ticket, [RUN]);
    expect(window.frames[0]).toEqual({ type: "ready", generation: 1 });
    expect(window.frames.flatMap((fr) => (fr.type === "line" ? [fr.line.kind] : []))).toEqual([
      "run",
      "you",
      "reply",
    ]);
    // the tail, at the store's nudge through the supervisor
    f.store.onAppend((spark, run) => supervisor.appended(spark, run));
    f.store.append(VELA, RUN, { kind: "turn", edge: "end" });
    expect(
      await came(() => window.frames.some((fr) => fr.type === "line" && fr.line.seq === 4)),
      waited("line 4, the tail's"),
    ).toBe(true);
  }, 60_000);

  it("restarts as a new generation: the sockets it served close, and a new ticket serves on the next", async () => {
    const f = folder();
    let child: ChildProcess | undefined;
    const supervisor = new TranscriptHostSupervisor({
      launch: { kind: "launch", launch },
      dir: f.dir,
      key: () => f.store.secret(),
      allowedOrigins: [],
      timings: { RESTART_BASE_MS: 50, RESTART_MAX_MS: 200 },
      spawnProcess: ((command: string, args: readonly string[], options: object) => {
        child = nodeSpawn(command, [...args], options);
        return child;
      }) as typeof nodeSpawn,
    });
    cleanup.push(() => supervisor.stop());
    supervisor.start();
    expect(
      await came(() => supervisor.health().phase === "ready"),
      waited("the worker to say ready"),
    ).toBe(true);
    const ticket = randomBytes(32).toString("base64url");
    const { port } = await supervisor.request("registerTicket", {
      ticket,
      spark: VELA,
      clientId: "tok-window",
      expiresAt: Date.now() + 60_000,
    });
    const window = await read(`ws://127.0.0.1:${port}/transcripts`, ticket, [RUN]);
    child?.kill("SIGKILL");
    expect(await settled(window.closed), waited("the killed generation's socket to close")).toBe(
      true,
    );
    expect(
      await came(
        () => supervisor.health().phase === "ready" && supervisor.health().generation === 2,
      ),
      waited("generation 2 to say ready"),
    ).toBe(true);
    const again = randomBytes(32).toString("base64url");
    const next = await supervisor.request("registerTicket", {
      ticket: again,
      spark: VELA,
      clientId: "tok-window",
      expiresAt: Date.now() + 60_000,
    });
    // a new generation, a new port in its health, and the serve re-aims at it
    expect(supervisor.health().port).toBe(next.port);
    const reopened = await read(`ws://127.0.0.1:${next.port}/transcripts`, again, [RUN]);
    expect(reopened.frames[0]).toEqual({ type: "ready", generation: 2 });
  }, 60_000);
});

describe("the ticket door end to end (TH-1; compose.sparks.transcript.openTicket)", () => {
  async function boot(): Promise<{ daemon: FielddDaemon; dataDir: string }> {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-transcript-door-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    writeLinkFixture(dataDir, TEST_LOGIN);
    // a spark this desktop keeps, and its transcript, from before this boot
    const home = mkdtempSync(join(tmpdir(), "vf-transcript-home-"));
    cleanup.push(() => rmSync(home, { recursive: true, force: true }));
    const spark: SparkRecord = {
      format: 1,
      id: VELA,
      name: "Vela",
      face: { seed: 7 },
      agent: "scripted",
      profiles: ["native"],
      thinksUnder: "native",
      folder: home,
      createdAt: "2026-11-04T12:00:00.000Z",
      updatedAt: "2026-11-04T12:00:00.000Z",
    };
    new SparkStore({
      dir: join(dataDir, ...LAYOUT.SPARKS_DIR),
      keyPath: join(dataDir, ...LAYOUT.SPARKS_KEY_FILE),
    }).write(spark);
    const store = new SparkTranscripts({
      dir: join(dataDir, ...LAYOUT.SPARK_FILES_DIR),
      keyPath: join(dataDir, ...LAYOUT.SPARK_FILES_KEY_FILE),
    });
    store.append(VELA, RUN, { kind: "run", runtimeRunId: RUN, fresh: true });
    store.append(VELA, RUN, { kind: "reply", messageId: "m-1", text: "On it." });
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());
    const daemon = await bootstrap({
      dataDir,
      controlPort: 0,
      dataPort: 0,
      allowedOrigins: ["file://"],
      // the files worker is off: the transcript worker serves without mille's engine (TH0-Q5 (b))
      filesHost: false,
      transcriptHost: launch,
      transcriptHostTimings: { RESTART_BASE_MS: 50, RESTART_MAX_MS: 200 },
    });
    cleanup.push(() => daemon.stop());
    expect(
      await came(() => daemon.transcripts.supervisor.health().phase === "ready", 20_000),
      waited("the daemon's transcript worker to say ready", 20_000),
    ).toBe(true);
    return { daemon, dataDir };
  }

  async function open(url: string): Promise<WsRpc> {
    const ws = new WebSocket(url);
    cleanup.push(() => ws.close());
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    return new WsRpc(ws);
  }

  /** A renderer window on this desktop holding `scopes`, as the shell mints it. */
  async function windowOf(daemon: FielddDaemon, scopes: Scope[]) {
    const shell = await open(`ws://127.0.0.1:${daemon.controlPort}`);
    await helloAs(shell, daemon.shellToken, "shell-main");
    const minted = (await shell.call("system.mintWindowToken", {
      scopes,
      label: "window-th1",
      rendererParticipant: {
        participantId: "renderer:th1:w1",
        incarnation: "renderer:th1:w1:document-1",
      },
    })) as { token: string; tokenId: string };
    const rpc = await open(`ws://127.0.0.1:${daemon.controlPort}`);
    await helloAs(rpc, minted.token);
    return { rpc, shell, tokenId: minted.tokenId };
  }

  it("serves this desktop's window the spark's kept transcript through the real worker, and its revoked token closes the socket", async () => {
    const { daemon } = await boot();
    const { rpc, shell, tokenId } = await windowOf(daemon, ["sparks.use"]);
    const answer = SparkTranscriptOpenTicketResult.parse(
      await rpc.call("compose.sparks.transcript.openTicket", { spark: VELA }),
    );
    expect(answer.runs.map((run) => run.runtimeRunId)).toEqual([RUN]);
    const window = await read(answer.endpoint, answer.ticket, [RUN]);
    expect(window.frames.flatMap((f) => (f.type === "line" ? [f.line.kind] : []))).toEqual([
      "run",
      "reply",
    ]);
    // the shell itself is refused: the gate is narrower than the scope
    await expect(
      shell.call("compose.sparks.transcript.openTicket", { spark: VELA }),
    ).rejects.toThrow();
    await shell.call("system.revokeWindowToken", { tokenId });
    expect(await settled(window.closed), waited("the revoked window's socket to close")).toBe(true);
  }, 60_000);
});
