// The index daemon THROUGH fieldd (AR-0, the review fixes): what every product
// client sees of rosettad is the health PROJECTION — never the daemon's origin
// (EL7: rosettad is unauthenticated and `system.health.subscribe` is
// scope-null) — plus the restart door, the stop ladder, supersession, and the
// empty-binary configuration. Against the mock mgmt server (no cargo) and the
// scripted rosettad (test/fixtures/fake-rosettad.mjs).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LAYOUT, SOCKETS } from "@vibefield/contracts";
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
  config: { rosettadBin?: string; mode?: string } = {},
): Promise<{ dataDir: string; mock: MockMgmtServer; daemon: FielddDaemon }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-rosettad-daemon-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    rosettadBin: config.rosettadBin ?? "/stand-in/rosettad",
    rosettadSpawn: fakeSpawner(config.mode ?? "ok"),
  });
  cleanup.push(() => daemon.stop().catch(() => undefined));
  return { dataDir, mock, daemon };
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
