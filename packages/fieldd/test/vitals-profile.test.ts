import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LAYOUT, SOCKETS, VITALS_CAPTURES } from "@vibefield/contracts";
import { VitalsProfileCaptureResult, vitalsCaptureName } from "@vibefield/contracts/vitals";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { type ProfilerSession, VitalsProfiler } from "../src/vitals-profile";
import { nativeEndpoint } from "./native-harness";
import { helloAs, WsRpc } from "./ws-rpc";

// VT-5 (track VT, 2026-11-24; VT-D12 A) — fieldd's CPU profile of itself: a real in-process inspector session on a
// short profile, written whole to the captures folder; the session disconnected on every path; one at a time; and
// the door Electron main's alone. These run on vitest's Node; fieldd ships on Electron's (ELECTRON_RUN_AS_NODE),
// which no test here exercises.

const roots: string[] = [];
const temp = (): string => {
  const root = mkdtempSync(join(tmpdir(), "vf-vitals-profile-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A session that records what was asked of it and answers as told. */
function fakeSession(opts: { failOn?: string; profile?: unknown } = {}): {
  session: ProfilerSession;
  asked: string[];
  disconnects: () => number;
} {
  const asked: string[] = [];
  let disconnects = 0;
  return {
    asked,
    disconnects: () => disconnects,
    session: {
      connect: () => asked.push("connect"),
      post: (method, _params, callback) => {
        asked.push(method);
        if (method === opts.failOn) callback(new Error(`${method} refused`));
        else if (method === "Profiler.stop")
          callback(null, { profile: opts.profile ?? { nodes: [], samples: [1, 2, 3] } });
        else callback(null, {});
      },
      disconnect: () => {
        disconnects += 1;
      },
    },
  };
}

describe("VT-5 — fieldd's profile of itself", () => {
  it("takes a real profile from inside, with no port, and writes it whole and private", async () => {
    const dir = join(temp(), ...LAYOUT.VITALS_CAPTURES_DIR);
    const at = Date.UTC(2026, 10, 24, 14, 7, 0, 0);
    // a "second" of 30 ms: ten of them is a real profile of a third of a second
    const profiler = new VitalsProfiler({
      dir,
      logger: createNoopLogger(),
      msPerSecond: 30,
      now: () => at,
    });
    const busy = setInterval(() => {
      let sum = 0;
      for (let index = 0; index < 50_000; index++) sum += Math.sqrt(index);
      return sum;
    }, 5);
    let result: VitalsProfileCaptureResult;
    try {
      result = VitalsProfileCaptureResult.parse(await profiler.capture({ seconds: 10 }));
    } finally {
      clearInterval(busy);
    }
    expect(result.name).toBe(vitalsCaptureName("profile", at));
    expect(result.seconds).toBe(10);
    const path = join(dir, result.name);
    const written = readFileSync(path, "utf8");
    expect(result.bytes).toBe(Buffer.byteLength(written));
    const profile = JSON.parse(written) as {
      nodes: unknown[];
      samples: unknown[];
      startTime: number;
    };
    // the shape Chrome's DevTools open
    expect(Array.isArray(profile.nodes)).toBe(true);
    expect(profile.nodes.length).toBeGreaterThan(0);
    expect(typeof profile.startTime).toBe("number");
    expect(result.samples).toBe(profile.samples.length);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    // nothing but the file: no temporary left beside it
    expect(readdirSync(dir)).toEqual([result.name]);
    expect(profiler.busy).toBe(false);
  });

  it("never opens the inspector's port", async () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "src", "vitals-profile.ts"),
      "utf8",
    );
    const code = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
      .join("\n");
    expect(code).not.toMatch(/\.open\(/);
    expect(code).not.toMatch(/\binspector\.url\b|--inspect/);
    const { url } = await import("node:inspector");
    const profiler = new VitalsProfiler({
      dir: temp(),
      logger: createNoopLogger(),
      msPerSecond: 5,
    });
    await profiler.capture({ seconds: 10 });
    expect(url()).toBeUndefined();
  });

  it("takes one at a time, and refuses a length off the list", async () => {
    const fake = fakeSession();
    const profiler = new VitalsProfiler({
      dir: temp(),
      logger: createNoopLogger(),
      session: () => fake.session,
      msPerSecond: 5,
    });
    const first = profiler.capture({ seconds: 10 });
    await expect(profiler.capture({ seconds: 10 })).rejects.toMatchObject({
      kind: "CONFLICT",
      details: { capture: "busy" },
    });
    await first;
    for (const seconds of [5, 15, 60, "10"]) {
      await expect(profiler.capture({ seconds })).rejects.toMatchObject({
        kind: "PRECONDITION_FAILED",
      });
    }
    expect(fake.asked.filter((method) => method === "connect")).toHaveLength(1);
  });

  it("disconnects the session when a step fails, and says why", async () => {
    for (const failOn of ["Profiler.enable", "Profiler.start"]) {
      const fake = fakeSession({ failOn });
      const profiler = new VitalsProfiler({
        dir: temp(),
        logger: createNoopLogger(),
        session: () => fake.session,
        msPerSecond: 1,
      });
      await expect(profiler.capture({ seconds: 10 })).rejects.toMatchObject({
        kind: "UNAVAILABLE",
        details: { capture: "not-started" },
      });
      expect(fake.disconnects(), failOn).toBe(1);
      expect(profiler.busy).toBe(false);
    }
    const stop = fakeSession({ failOn: "Profiler.stop" });
    const profiler = new VitalsProfiler({
      dir: temp(),
      logger: createNoopLogger(),
      session: () => stop.session,
      msPerSecond: 1,
    });
    await expect(profiler.capture({ seconds: 10 })).rejects.toMatchObject({
      details: { capture: "not-saved" },
    });
    expect(stop.disconnects()).toBe(1);
  });

  it("says a profile it could not write, and leaves no temporary", async () => {
    const root = temp();
    const dir = join(root, "captures");
    writeFileSync(dir, "a file where the folder should be");
    const profiler = new VitalsProfiler({
      dir,
      logger: createNoopLogger(),
      session: () => fakeSession().session,
      msPerSecond: 1,
    });
    await expect(profiler.capture({ seconds: 10 })).rejects.toMatchObject({
      kind: "INTERNAL",
      details: { capture: "not-saved" },
    });
    expect(readdirSync(root)).toEqual(["captures"]);
  });

  it("cuts a profile when fieldd stops: the session disconnected, nothing written", async () => {
    const dir = temp();
    const fake = fakeSession();
    const profiler = new VitalsProfiler({
      dir,
      logger: createNoopLogger(),
      session: () => fake.session,
      msPerSecond: 1_000,
    });
    const taking = profiler.capture({ seconds: 30 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(profiler.busy).toBe(true);
    profiler.dispose();
    await expect(taking).rejects.toMatchObject({ details: { capture: "cut-short" } });
    expect(fake.disconnects()).toBeGreaterThanOrEqual(1);
    expect(fake.asked).not.toContain("Profiler.stop");
    expect(readdirSync(dir)).toEqual([]);
    await expect(profiler.capture({ seconds: 10 })).rejects.toMatchObject({ kind: "UNAVAILABLE" });
  });

  it("keeps the folder's newest ten, and never a file not its own", async () => {
    const dir = temp();
    mkdirSync(dir, { recursive: true });
    const base = Date.UTC(2026, 10, 24, 12, 0, 0, 0);
    const older = Array.from({ length: VITALS_CAPTURES.KEEP }, (_, index) =>
      vitalsCaptureName(index % 2 === 0 ? "trace" : "frames", base + index * 1_000),
    );
    for (const name of [...older, "notes.txt"]) writeFileSync(join(dir, name), "{}");
    const profiler = new VitalsProfiler({
      dir,
      logger: createNoopLogger(),
      session: () => fakeSession().session,
      msPerSecond: 1,
      now: () => base + 3_600_000,
    });
    const result = await profiler.capture({ seconds: 10 });
    expect(readdirSync(dir).sort()).toEqual([...older.slice(1), "notes.txt", result.name].sort());
  });
});

describe("VT-5 — the profile door (vitals.profile.capture) is Electron main's alone", () => {
  let root: string | null = null;
  let daemon: FielddDaemon | null = null;
  let native: MockMgmtServer | null = null;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await daemon?.stop();
    await native?.stop();
    if (root !== null) rmSync(root, { recursive: true, force: true });
    daemon = null;
    native = null;
    root = null;
  });

  async function rpc(token: string, clientKind: string): Promise<WsRpc> {
    const socket = new WebSocket(`ws://127.0.0.1:${daemon?.controlPort}`);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const client = new WsRpc(socket);
    await helloAs(client, token, clientKind);
    return client;
  }

  it("refuses every other caller, and a length off the list", async () => {
    root = mkdtempSync(join(tmpdir(), "vf-vitals-profile-door-"));
    const dataDir = join(root, "data");
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    native = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await native.start();
    daemon = await bootstrap({ dataDir, logRoot: join(root, "logs"), controlPort: 0, dataPort: 0 });

    const reporter = daemon.tokens.mint(["vitals.read", "vitals.report"], "vitals-window");
    const window = await rpc(reporter.token, "renderer");
    expect((await window.callErr("vitals.profile.capture", { seconds: 10 })).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );
    const narrow = daemon.tokens.mint(["workspace.read"], "no-vitals");
    const outsider = await rpc(narrow.token, "renderer");
    expect((await outsider.callErr("vitals.profile.capture", { seconds: 10 })).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );

    const main = await rpc(daemon.shellToken, "shell-main");
    expect((await main.callErr("vitals.profile.capture", { seconds: 15 })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );
    // nothing was written by a refusal
    expect(() => readdirSync(join(dataDir, ...LAYOUT.VITALS_CAPTURES_DIR))).toThrow();
  });
});
