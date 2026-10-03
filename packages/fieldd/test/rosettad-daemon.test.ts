// The index daemon THROUGH fieldd (AR-0, the review fixes): what every product
// client sees of rosettad is the health PROJECTION — never the daemon's origin
// (EL7: rosettad is unauthenticated and `system.health.subscribe` is
// scope-null) — plus the restart door, the stop ladder, supersession, and the
// empty-binary configuration. Against the mock mgmt server (no cargo) and the
// scripted rosettad (test/fixtures/fake-rosettad.mjs).
//
// AR-1 adds the index doors: the enrollment record is on disk before the
// first launch and names the daemon's `--enroll`; `index.status` and
// `index.discoveries` are projections (no origin, no enrolled root's path);
// `index.enroll` and `index.retire` rewrite the record, audit the act, and
// bounce the daemon only when the record changed. The last block runs the
// same doors against the REAL rosettad when FIELDD_ROSETTAD_BIN names it.
import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type IndexDiscoveriesResult,
  type IndexEnrollmentRecord,
  type IndexMutationResult,
  type IndexStatus,
  LAYOUT,
  SOCKETS,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  bootstrap,
  type FielddDaemon,
  type FielddHealth,
  ROSETTAD_UNCONFIGURED,
  type RosettadHealth,
} from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-rosettad.mjs");
const fakeSpawner = (mode: string): typeof spawn =>
  ((_bin: string, args: readonly string[], options: object) =>
    spawn(process.execPath, [FAKE, ...args], {
      ...options,
      env: { ...process.env, FAKE_ROSETTAD_MODE: mode },
    })) as unknown as typeof spawn;

const PROJECTION_KEYS = ["detail", "phase", "pid", "protocolVersion"];
const rendererParticipant = (suffix: string) => ({
  participantId: `renderer:desktop-test:window-${suffix}`,
  incarnation: `renderer:desktop-test:window-${suffix}:document-1`,
});
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function setup(
  config: {
    rosettadBin?: string;
    mode?: string;
    /** AR-1: a record written BEFORE boot (the store loads it at construction) */
    enrollment?: Partial<IndexEnrollmentRecord>;
    /** AR-1: spawn the binary itself (the live rows), with an EMPTY home */
    real?: boolean;
    /** AR-1 live rows: a vendor layout copied into `<home>/.claude` so the
     * roll call finds one installed kind (rosetta's own ground-truth fixture) */
    seedClaudeHome?: string;
  } = {},
): Promise<{ dataDir: string; mock: MockMgmtServer; daemon: FielddDaemon }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-rosettad-daemon-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  if (config.enrollment !== undefined) {
    mkdirSync(join(dataDir, ...LAYOUT.INDEX_DIR), { recursive: true });
    writeFileSync(
      join(dataDir, ...LAYOUT.INDEX_ENROLLMENT_FILE),
      `${JSON.stringify({ format: 1, enabled_kinds: [], runtimes: [], ...config.enrollment })}\n`,
    );
  }
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  if (config.seedClaudeHome !== undefined) {
    cpSync(config.seedClaudeHome, join(home, ".claude"), { recursive: true });
  }
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    rosettadBin: config.rosettadBin ?? "/stand-in/rosettad",
    ...(config.real ? {} : { rosettadSpawn: fakeSpawner(config.mode ?? "ok") }),
    // an EMPTY home: even the real daemon discovers nothing installed here
    // and never reads the developer's own vendor roots
    rosettadHome: home,
  });
  cleanup.push(() => daemon.stop().catch(() => undefined));
  return { dataDir, mock, daemon };
}

/** A shell connection plus a renderer window token holding exactly `scopes`. */
async function shellAndWindow(
  daemon: FielddDaemon,
  scopes: string[],
  suffix: string,
): Promise<{ shell: WsRpc; win: WsRpc }> {
  const shell = await openRpc(daemon.controlPort);
  await helloAs(shell, daemon.shellToken, "shell-main");
  const minted = (await shell.call("system.mintWindowToken", {
    scopes,
    label: `window-${suffix}`,
    rendererParticipant: rendererParticipant(suffix),
  })) as { token: string };
  const win = await openRpc(daemon.controlPort);
  await helloAs(win, minted.token);
  return { shell, win };
}

const readRecord = (dataDir: string): IndexEnrollmentRecord =>
  JSON.parse(readFileSync(join(dataDir, ...LAYOUT.INDEX_ENROLLMENT_FILE), "utf8"));

/** every audit line under the user root, concatenated (the ledgers are JSONL) */
function auditText(dataDir: string): string {
  const dir = join(dataDir, ...LAYOUT.AUDIT_DIR);
  const walk = (d: string): string[] =>
    existsSync(d)
      ? readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
        )
      : [];
  return walk(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}

/** the whole serialized answer must carry neither the origin nor its port */
function expectNoOrigin(value: unknown, origin: string): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(origin);
  expect(serialized).not.toContain(`:${new URL(origin).port}`);
}

/** `until` for an async predicate (the live rows poll the doors themselves) */
async function untilAsync(fn: () => Promise<boolean>, ms: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`untilAsync: condition not met within ${ms}ms`);
}

async function openRpc(port: number): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

async function ready(daemon: FielddDaemon): Promise<{ pid: number; origin: string }> {
  await until(() => daemon.health().rosettad.phase === "ready", 8_000);
  const state = daemon.rosettad?.state();
  return { pid: state?.pid as number, origin: state?.origin as string };
}

describe("rosettad through fieldd (AR-0)", () => {
  it("starts after boot commits, at LAYOUT.INDEX_DB, announcing into fieldd's PRIVATE directory", async () => {
    const { dataDir, daemon } = await setup();
    const { pid } = await ready(daemon);
    expect(alive(pid)).toBe(true);
    expect(daemon.rosettad?.state().announce).toBe(
      join(dataDir, ...LAYOUT.INDEX_DAEMONS_DIR, `${pid}.json`),
    );
    expect(readdirSync(join(dataDir, ...LAYOUT.INDEX_DAEMONS_DIR))).toEqual([`${pid}.json`]);
  });

  it("every product client sees the projection only: a renderer window token reads phase/reason/pid, and the origin appears NOWHERE in health", async () => {
    const { daemon } = await setup();
    const { pid, origin } = await ready(daemon);
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/); // fieldd itself knows it

    const shell = await openRpc(daemon.controlPort);
    await helloAs(shell, daemon.shellToken, "shell-main");
    const minted = (await shell.call("system.mintWindowToken", {
      scopes: [],
      label: "window-1",
      rendererParticipant: rendererParticipant("1"),
    })) as { token: string };
    const win = await openRpc(daemon.controlPort);
    await helloAs(win, minted.token);

    const health = (await win.call("system.health", {})) as FielddHealth;
    expect(Object.keys(health.rosettad).sort()).toEqual(PROJECTION_KEYS);
    expect(health.rosettad).toEqual({
      phase: "ready",
      detail: null,
      pid,
      protocolVersion: expect.any(Number),
    } satisfies RosettadHealth);
    const port = new URL(origin).port;
    const serialized = JSON.stringify(health);
    expect(serialized).not.toContain(origin);
    expect(serialized).not.toContain(`:${port}`);
    expect(serialized).not.toContain("daemons");

    // the stream's snapshot is the same projection — and so is every delta
    const sub = (await win.call("system.health.subscribe", {})) as {
      subId: string;
      snapshot: FielddHealth;
    };
    expect(Object.keys(sub.snapshot.rosettad).sort()).toEqual(PROJECTION_KEYS);
    expect(JSON.stringify(sub.snapshot)).not.toContain(origin);
    // the shell holds the same projection: the door is the type, not the caller
    const shellHealth = (await shell.call("system.health", {})) as FielddHealth;
    expect(Object.keys(shellHealth.rosettad).sort()).toEqual(PROJECTION_KEYS);
  });

  it("system.index.restart: local admin bounces the daemon (a new pid, ready), every delta stays a projection, a window token is refused", async () => {
    const { daemon } = await setup();
    const { pid: firstPid, origin: firstOrigin } = await ready(daemon);

    const shell = await openRpc(daemon.controlPort);
    await helloAs(shell, daemon.shellToken, "shell-main");
    const minted = (await shell.call("system.mintWindowToken", {
      scopes: [],
      label: "window-2",
      rendererParticipant: rendererParticipant("2"),
    })) as { token: string };
    const win = await openRpc(daemon.controlPort);
    await helloAs(win, minted.token);
    const sub = (await win.call("system.health.subscribe", {})) as { subId: string };
    const deltas = (): FielddHealth[] =>
      win.notifications
        .filter((n) => n.method === "system.health.delta" && n.params.subId === sub.subId)
        .map((n) => n.params.payload as FielddHealth);

    // the registry scope gate: a window token holds no native.admin
    const denied = await win.callErr("system.index.restart", {});
    expect(denied.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(alive(firstPid)).toBe(true);

    const result = (await shell.call("system.index.restart", {})) as { rosettad: RosettadHealth };
    expect(result.rosettad.phase).toBe("ready");
    expect(Object.keys(result.rosettad).sort()).toEqual(PROJECTION_KEYS);
    const secondPid = result.rosettad.pid as number;
    expect(secondPid).not.toBe(firstPid);
    expect(alive(firstPid)).toBe(false);
    expect(alive(secondPid)).toBe(true);

    await until(() =>
      deltas().some((d) => d.rosettad.pid === secondPid && d.rosettad.phase === "ready"),
    );
    const phases = deltas().map((d) => d.rosettad.phase);
    expect(phases).toContain("restarting");
    for (const d of deltas()) {
      expect(Object.keys(d.rosettad).sort()).toEqual(PROJECTION_KEYS);
      expect(JSON.stringify(d)).not.toContain(firstOrigin);
    }
    const secondOrigin = daemon.rosettad?.state().origin as string;
    for (const d of deltas()) expect(JSON.stringify(d)).not.toContain(secondOrigin);
  });

  it("the stop ladder puts the daemon down: after stop() the child and its announce file are gone", async () => {
    const { dataDir, daemon } = await setup();
    const { pid } = await ready(daemon);
    await daemon.stop();
    expect(alive(pid)).toBe(false);
    expect(daemon.health().rosettad.phase).toBe("stopped");
    expect(readdirSync(join(dataDir, ...LAYOUT.INDEX_DAEMONS_DIR))).toEqual([]);
  });

  it("supersession puts the daemon down: the successor spawns its own over the SAME projection, so ours must be gone first", async () => {
    const { mock, daemon } = await setup();
    const { pid } = await ready(daemon);
    // the floor tells this fieldd another owner took the plane
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "native.lifecycle.superseded",
      params: { reason: "scripted takeover" },
    });
    for (const sock of mock.sockets) sock.write(`${frame}\n`);
    await until(() => daemon.native.superseded, 4_000);
    await until(() => !alive(pid), 6_000);
    expect(daemon.health().rosettad.phase).toBe("stopped");
  });

  it("an EMPTY rosettadBin is the honest unconfigured, never a spawn of nothing", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-rosettad-empty-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());
    const daemon = await bootstrap({ dataDir, controlPort: 0, rosettadBin: "" });
    cleanup.push(() => daemon.stop());
    expect(daemon.rosettad).toBeNull();
    expect(daemon.health().rosettad).toEqual(ROSETTAD_UNCONFIGURED);
    expect(existsSync(join(dataDir, ...LAYOUT.INDEX_DIR))).toBe(false);
  });
});

describe("the index doors (AR-1) — against the scripted rosettad", () => {
  it("the record is on disk before the first launch and names the daemon's --enroll; the home is explicit", async () => {
    const { dataDir, daemon } = await setup();
    await ready(daemon);
    // the store published the empty record before spawn — the daemon got it
    expect(readRecord(dataDir)).toMatchObject({ format: 1, enabled_kinds: [], runtimes: [] });
    expect(daemon.enrollment.path()).toBe(join(dataDir, ...LAYOUT.INDEX_ENROLLMENT_FILE));
    // the fake read the file: nothing consented ⇒ awaiting consent
    const status = await daemon.index.status();
    expect(status.phase).toBe("awaiting_consent");
    expect(status.runtimes).toEqual([]);
    expect(status.enrollment).toEqual({
      enabledKinds: [],
      runtimes: [],
      retired: [],
      updatedAt: null,
    });
  });

  it("index.status and index.discoveries are projections a window token with index.read may read — and neither carries the origin", async () => {
    const { daemon } = await setup();
    const { origin } = await ready(daemon);
    const { win } = await shellAndWindow(daemon, ["index.read"], "r1");

    const status = (await win.call("index.status", {})) as IndexStatus;
    expect(status.phase).toBe("awaiting_consent");
    expect(Object.keys(status.rosettad).sort()).toEqual(PROJECTION_KEYS);
    expectNoOrigin(status, origin);

    const found = (await win.call("index.discoveries", {})) as IndexDiscoveriesResult;
    expect(found.discoveries.map((d) => [d.kind, d.installed, d.consented])).toEqual([
      ["claude-code", true, false],
      ["codex", false, false],
    ]);
    expect(found.discoveries[0]?.dataRoot).toBe("~/.claude");
    expectNoOrigin(found, origin);

    // index.read does not open the mutations
    const denied = await win.callErr("index.enroll", { kinds: ["claude-code"] });
    expect(denied.data?.kind).toBe("FORBIDDEN_SCOPE");
    const denied2 = await win.callErr("index.retire", { runtimeId: "rt-claude-code-native" });
    expect(denied2.data?.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("index.enroll: the record is rewritten, the act audited, the daemon bounced — and the same set again changes nothing", async () => {
    const { dataDir, daemon } = await setup();
    const { pid: firstPid } = await ready(daemon);
    const { win } = await shellAndWindow(daemon, ["index.read", "index.manage"], "m1");

    const result = (await win.call("index.enroll", {
      kinds: ["claude-code", "claude-code"],
    })) as IndexMutationResult;
    expect(result.changed).toBe(true);
    expect(result.status.phase).toBe("live");
    expect(result.status.enrollment.enabledKinds).toEqual(["claude-code"]);
    expect(result.status.runtimes).toHaveLength(1);
    expect(result.status.runtimes[0]).toMatchObject({
      runtimeId: "rt-claude-code-native",
      kind: "claude-code",
      provenance: "discovered",
      dataRoot: "~/.claude",
      watched: true,
      backfill: { state: "done", filesTotal: 3, sessionsTotal: 1 },
      live: { events: 2, liveRows: 4 },
    });
    // the daemon was bounced and read the new file
    const secondPid = daemon.health().rosettad.pid as number;
    expect(secondPid).not.toBe(firstPid);
    expect(alive(firstPid)).toBe(false);
    expect(readRecord(dataDir)).toMatchObject({ enabled_kinds: ["claude-code"] });
    expect(typeof readRecord(dataDir).updated_at).toBe("string");
    // the census now says consented
    const found = (await win.call("index.discoveries", {})) as IndexDiscoveriesResult;
    expect(found.discoveries[0]).toMatchObject({ kind: "claude-code", consented: true });
    // audited: the attempt and the outcome
    const audit = auditText(dataDir);
    expect(audit).toContain('"action":"index.enroll"');
    expect(audit).toContain('"outcome":"succeeded"');

    // idempotent: the same set writes nothing and bounces nothing
    const again = (await win.call("index.enroll", {
      kinds: ["claude-code"],
    })) as IndexMutationResult;
    expect(again.changed).toBe(false);
    expect(daemon.health().rosettad.pid).toBe(secondPid);
  });

  it("index.retire: a discovered runtime's kind leaves the consented set (rows stay: the daemon still lists it, unwatched); an unknown id is NOT_FOUND", async () => {
    const { dataDir, daemon } = await setup({ enrollment: { enabled_kinds: ["claude-code"] } });
    const { pid: firstPid } = await ready(daemon);
    const { win } = await shellAndWindow(daemon, ["index.read", "index.manage"], "m2");
    const before = (await win.call("index.status", {})) as IndexStatus;
    expect(before.phase).toBe("live");
    expect(before.runtimes[0]?.watched).toBe(true);

    const missing = await win.callErr("index.retire", { runtimeId: "rt-nope" });
    expect(missing.data?.kind).toBe("NOT_FOUND");

    const result = (await win.call("index.retire", {
      runtimeId: "rt-claude-code-native",
    })) as IndexMutationResult;
    expect(result.changed).toBe(true);
    expect(result.status.enrollment.enabledKinds).toEqual([]);
    expect(result.status.phase).toBe("awaiting_consent");
    expect(daemon.health().rosettad.pid).not.toBe(firstPid);
    expect(readRecord(dataDir).enabled_kinds).toEqual([]);
    expect(auditText(dataDir)).toContain('"action":"index.retire"');
  });

  it("an enrolled root (a persona, AR-2's path) rides the file: labelled, provenance enrolled, its path never projected; retiring keeps the persona named", async () => {
    const root = mkdtempSync(join(tmpdir(), "vf-persona-root-"));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const { dataDir, daemon } = await setup({
      enrollment: {
        runtimes: [
          { kind: "claude-code", data_root: root, label: "Kim", profile_id: "claude:9a3d" },
        ],
      },
    });
    const { origin } = await ready(daemon);
    const { win } = await shellAndWindow(daemon, ["index.read", "index.manage"], "m3");
    const status = (await win.call("index.status", {})) as IndexStatus;
    expect(status.phase).toBe("live");
    expect(status.runtimes).toHaveLength(1);
    expect(status.runtimes[0]).toMatchObject({
      kind: "claude-code",
      provenance: "enrolled",
      label: "Kim",
      profileId: "claude:9a3d",
      watched: true,
    });
    expect(status.runtimes[0]).not.toHaveProperty("dataRoot");
    expect(JSON.stringify(status)).not.toContain(root);
    expectNoOrigin(status, origin);
    // the roll call never lists a managed root
    const found = (await win.call("index.discoveries", {})) as IndexDiscoveriesResult;
    expect(found.discoveries.every((d) => d.dataRoot.startsWith("~"))).toBe(true);

    const runtimeId = status.runtimes[0]?.runtimeId as string;
    const retired = (await win.call("index.retire", { runtimeId })) as IndexMutationResult;
    expect(retired.changed).toBe(true);
    expect(retired.status.enrollment.runtimes).toEqual([]);
    expect(retired.status.enrollment.retired).toEqual([
      {
        kind: "claude-code",
        label: "Kim",
        profileId: "claude:9a3d",
        retiredAt: expect.any(String),
      },
    ]);
    const record = readRecord(dataDir);
    expect(record.runtimes).toEqual([]);
    expect(record.retired?.[0]).toMatchObject({ data_root: root, label: "Kim" });
  });

  it("the store refuses what the daemon refuses (a missing root), and a root that vanishes is retired at publish, never handed to the daemon", async () => {
    const { dataDir, daemon } = await setup();
    await ready(daemon);
    expect(() =>
      daemon.enrollment.enrollRuntime({ kind: "claude-code", dataRoot: join(dataDir, "nope") }),
    ).toThrow(/not an existing directory/);
    expect(() =>
      daemon.enrollment.enrollRuntime({ kind: "claude-code", dataRoot: "~/.claude" }),
    ).toThrow();
    const root = mkdtempSync(join(tmpdir(), "vf-persona-gone-"));
    const enrolled = await daemon.index.enrollRuntime({
      kind: "claude-code",
      dataRoot: root,
      label: "Gone",
      profileId: "claude:gone",
    });
    expect(enrolled.changed).toBe(true);
    expect(enrolled.status.runtimes.map((r) => r.provenance)).toEqual(["enrolled"]);
    rmSync(root, { recursive: true, force: true });
    daemon.enrollment.publish();
    const record = readRecord(dataDir);
    expect(record.runtimes).toEqual([]);
    expect(record.retired?.map((r) => r.label)).toEqual(["Gone"]);
  });

  it("while the daemon is down the reads say so: index.discoveries is UNAVAILABLE {service:index, state}, index.status still answers the record", async () => {
    // a daemon that refuses to start: the supervisor is retrying it (and will
    // settle on "failed" once the intensity window trips — the supervisor
    // rows witness that); every phase on the way is a not-ready state the
    // doors must name, never a blank
    const { daemon } = await setup({ mode: "crash-on-start" });
    const { win } = await shellAndWindow(daemon, ["index.read"], "d1");
    const notReady = ["starting", "restarting", "failed"];
    const err = await win.callErr("index.discoveries", {});
    expect(err.data?.kind).toBe("UNAVAILABLE");
    expect(err.data?.retryable).toBe(true);
    const details = err.data?.details as { service: string; state: string };
    expect(details.service).toBe("index");
    expect(notReady).toContain(details.state);
    // once the child has died its last words ride the detail
    await until(() => daemon.health().rosettad.phase !== "starting", 10_000);
    const status = (await win.call("index.status", {})) as IndexStatus;
    expect(notReady).toContain(status.phase);
    expect(status.rosettad.detail).toContain("refusing to start");
    expect(status.runtimes).toEqual([]);
    expect(status.enrollment.enabledKinds).toEqual([]);
  });

  it("an unreadable record is set aside, never handed to the daemon; the user consents again", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-rosettad-corrupt-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    mkdirSync(join(dataDir, ...LAYOUT.INDEX_DIR), { recursive: true });
    writeFileSync(join(dataDir, ...LAYOUT.INDEX_ENROLLMENT_FILE), "{ not json");
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());
    const daemon = await bootstrap({
      dataDir,
      controlPort: 0,
      rosettadBin: "/stand-in/rosettad",
      rosettadSpawn: fakeSpawner("ok"),
      rosettadHome: join(dataDir, "home"),
    });
    cleanup.push(() => daemon.stop().catch(() => undefined));
    await ready(daemon);
    expect(readRecord(dataDir)).toMatchObject({ format: 1, enabled_kinds: [] });
    const aside = readdirSync(join(dataDir, ...LAYOUT.INDEX_DIR)).filter((f) =>
      f.startsWith("enrollment.json.unreadable-"),
    );
    expect(aside).toHaveLength(1);
  });

  it("without a daemon the record is still this user's truth: enroll writes it and nothing is spawned", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-rosettad-nodaemon-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());
    const daemon = await bootstrap({ dataDir, controlPort: 0, rosettadBin: "" });
    cleanup.push(() => daemon.stop());
    expect(existsSync(join(dataDir, ...LAYOUT.INDEX_DIR))).toBe(false);
    const result = await daemon.index.enroll(["codex"]);
    expect(result.changed).toBe(true);
    expect(result.status.phase).toBe("unconfigured");
    expect(result.status.rosettad).toEqual(ROSETTAD_UNCONFIGURED);
    expect(readRecord(dataDir).enabled_kinds).toEqual(["codex"]);
    await expect(daemon.index.discoveries()).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "index", state: "unconfigured" },
    });
  });
});

// The real binary (`pnpm siblings:build`; FIELDD_ROSETTAD_BIN=$(node scripts/siblings.mjs bin)):
// the same doors, the daemon reading fieldd's record for real, with an EMPTY
// home so nothing of the developer's is ever read.
const REAL_BIN = process.env["FIELDD_ROSETTAD_BIN"];
describe.skipIf(REAL_BIN === undefined || REAL_BIN === "" || !existsSync(REAL_BIN))(
  "the index doors (AR-1) — against the real rosettad (opt-in via FIELDD_ROSETTAD_BIN)",
  () => {
    it("an empty home: the roll call lists the registry uninstalled and unconsented; the daemon awaits consent", async () => {
      const { daemon } = await setup({ rosettadBin: REAL_BIN as string, real: true });
      await until(() => daemon.health().rosettad.phase === "ready", 30_000);
      const { win } = await shellAndWindow(daemon, ["index.read", "index.manage"], "live1");
      await untilAsync(
        () =>
          daemon.index
            .status()
            .then((s) => s.phase === "awaiting_consent")
            .catch(() => false),
        20_000,
      );
      const found = (await win.call("index.discoveries", {})) as IndexDiscoveriesResult;
      expect(found.discoveries.length).toBeGreaterThan(0);
      for (const row of found.discoveries) {
        expect(row.installed).toBe(false);
        expect(row.consented).toBe(false);
        expect(row.dataRoot.startsWith("~")).toBe(true);
      }
      // consenting an uninstalled kind is accepted by the record and warned
      // about by the daemon, never fatal: the daemon comes back and still waits
      const result = (await win.call("index.enroll", {
        kinds: ["claude-code"],
      })) as IndexMutationResult;
      expect(result.changed).toBe(true);
      expect(result.status.rosettad.phase).toBe("ready");
      expect(result.status.enrollment.enabledKinds).toEqual(["claude-code"]);
    }, 90_000);

    it("an enrolled EMPTY root is a live runtime from the first start (RO-2): labelled, provenance enrolled, no path projected; retiring keeps its rows and its name", async () => {
      const root = mkdtempSync(join(tmpdir(), "vf-persona-live-"));
      cleanup.push(() => rmSync(root, { recursive: true, force: true }));
      const { dataDir, daemon } = await setup({
        rosettadBin: REAL_BIN as string,
        real: true,
        enrollment: {
          runtimes: [
            { kind: "claude-code", data_root: root, label: "Kim", profile_id: "claude:9a3d" },
          ],
        },
      });
      await until(() => daemon.health().rosettad.phase === "ready", 30_000);
      const { origin } = await ready(daemon);
      const { win } = await shellAndWindow(daemon, ["index.read", "index.manage"], "live2");
      await untilAsync(
        () =>
          daemon.index
            .status()
            .then((s) => s.phase === "live")
            .catch(() => false),
        30_000,
      );
      const status = (await win.call("index.status", {})) as IndexStatus;
      const kim = status.runtimes.find((r) => r.provenance === "enrolled");
      expect(kim).toMatchObject({
        kind: "claude-code",
        provenance: "enrolled",
        label: "Kim",
        profileId: "claude:9a3d",
        watched: true,
      });
      expect(kim).not.toHaveProperty("dataRoot");
      expect(JSON.stringify(status)).not.toContain(root);
      expectNoOrigin(status, origin);
      expect(kim?.runtimeId).toMatch(/\S/);

      const retired = (await win.call("index.retire", {
        runtimeId: kim?.runtimeId,
      })) as IndexMutationResult;
      expect(retired.changed).toBe(true);
      expect(retired.status.rosettad.phase).toBe("ready");
      expect(retired.status.enrollment.retired).toEqual([
        {
          kind: "claude-code",
          label: "Kim",
          profileId: "claude:9a3d",
          retiredAt: expect.any(String),
        },
      ]);
      // rows stay public: the daemon still lists the runtime, now unwatched and
      // still named by the record
      const after = retired.status.runtimes.find((r) => r.runtimeId === kim?.runtimeId);
      expect(after).toMatchObject({ provenance: "enrolled", watched: false, label: "Kim" });
      expect(readRecord(dataDir).runtimes).toEqual([]);
    }, 120_000);

    // RO-2c — the file is AUTHORITATIVE: a kind the record no longer names is
    // not watched on the next start even though the projection persisted its
    // consent, and the roll call says so. Before RO-2c rosetta unioned the
    // persisted flag in, so the record could add consent but never revoke it.
    // AR-8b (2026-10-03): read from `../rosetta-pin`, the checkout dedicated to the
    // pin since W-D10 — this said `../rosetta` (James's working tree, nothing this
    // repo reads), so the row skipped in every lane and read his tree in his own.
    const GROUNDTRUTH = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "..",
      "rosetta-pin",
      "groundtruth",
      "claude-code",
      "fixtures",
      "2.1.241",
      "basic-chat",
      "claude-config",
    );
    it.skipIf(!existsSync(GROUNDTRUTH))(
      "revocation: consent a discovered kind, then declare it gone — the daemon comes back live with nothing watched, the census reads unconsented, its rows stay (RO-2c)",
      async () => {
        const { dataDir, daemon } = await setup({
          rosettadBin: REAL_BIN as string,
          real: true,
          seedClaudeHome: GROUNDTRUTH,
        });
        await until(() => daemon.health().rosettad.phase === "ready", 30_000);
        const { win } = await shellAndWindow(daemon, ["index.read", "index.manage"], "live3");
        await untilAsync(
          () =>
            daemon.index
              .status()
              .then((s) => s.phase === "awaiting_consent")
              .catch(() => false),
          20_000,
        );
        const census = (await win.call("index.discoveries", {})) as IndexDiscoveriesResult;
        const claude = census.discoveries.find((d) => d.kind === "claude-code");
        expect(claude).toMatchObject({ installed: true, consented: false });

        // consent: the daemon reads the file on its restart and goes live
        const granted = (await win.call("index.enroll", {
          kinds: ["claude-code"],
        })) as IndexMutationResult;
        expect(granted.changed).toBe(true);
        await untilAsync(
          () =>
            daemon.index
              .status()
              .then((s) => s.phase === "live")
              .catch(() => false),
          60_000,
        );
        const live = (await win.call("index.status", {})) as IndexStatus;
        const native = live.runtimes.find((r) => r.kind === "claude-code");
        expect(native).toMatchObject({
          provenance: "discovered",
          dataRoot: "~/.claude",
          watched: true,
        });

        // revoke: the record is the truth, the projection's persisted flag is not.
        // On a WARM projection the one-shot gate never arms (rosetta's rule: the
        // supervisor restarts with a new file rather than POSTing a grant), so
        // the daemon comes back `live` with ZERO watched runtimes — the standing
        // history stays public and the roll call reads unconsented.
        const revoked = (await win.call("index.enroll", { kinds: [] })) as IndexMutationResult;
        expect(revoked.changed).toBe(true);
        expect(revoked.status.rosettad.phase).toBe("ready");
        await untilAsync(
          () =>
            daemon.index
              .status()
              .then(
                (s) =>
                  s.phase === "live" &&
                  s.runtimes.some((r) => r.kind === "claude-code" && r.watched === false),
              )
              .catch(() => false),
          30_000,
        );
        const after = (await win.call("index.status", {})) as IndexStatus;
        const row = after.runtimes.find((r) => r.kind === "claude-code");
        // rows stay public: the daemon still lists the runtime, now unwatched
        expect(row).toMatchObject({ provenance: "discovered", watched: false });
        expect(after.runtimes.every((r) => r.watched === false)).toBe(true);
        const census2 = (await win.call("index.discoveries", {})) as IndexDiscoveriesResult;
        expect(census2.discoveries.find((d) => d.kind === "claude-code")).toMatchObject({
          installed: true,
          consented: false,
        });
        expect(readRecord(dataDir).enabled_kinds).toEqual([]);
      },
      180_000,
    );
  },
);
