// @vitest-environment node
// (the desktop vitest default is happy-dom, whose WebSocket stub cannot dial a
// real loopback socket — this file needs Node's undici WebSocket end to end)
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENGINE_SCHEMA_VERSION } from "@vibecook/ice";
import { bootstrap, type FielddDaemon } from "@vibefield/fieldd";
import { MockMgmtServer } from "@vibefield/fieldd/testing";
import { FielddClient } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it } from "vitest";
import { loadBoard } from "../renderer/src/board-boot";
import { buildRegistry, createFieldEngine, seedField } from "../renderer/src/field-engine";

// THE P0 exit criterion, end to end: a REAL fieldd (mock mgmt, no cargo), the
// REAL FielddClient + DocLaneClient over real loopback sockets, the REAL engine
// — seed, persist up the :9411 lane, KILL the daemon, re-bootstrap on the same
// dataDir, and the board comes back byte-for-byte. This is `pnpm dev` quit-and-
// relaunch, headless.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function boot(dataDir: string): Promise<FielddDaemon> {
  const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  return daemon;
}

function connect(daemon: FielddDaemon): FielddClient {
  const client = new FielddClient({
    url: `ws://127.0.0.1:${daemon.controlPort}`,
    token: daemon.shellToken, // all scopes — the shell's own credential
    clientKind: "debug",
  });
  client.connect();
  cleanup.push(() => client.close());
  return client;
}

describe("board survives a fieldd restart (B3 exit criterion)", () => {
  it("seed → put → daemon stop → re-bootstrap → open → identical board", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-b3-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(join(dataDir, "native", "run", "mgmt.sock"));
    await mock.start();
    cleanup.push(() => mock.stop());

    // ---- life 1: first run — empty registry, seed, persist up the lane ----
    const daemon1 = await boot(dataDir);
    const client1 = connect(daemon1);
    const boot1 = await loadBoard(client1);
    expect(boot1.lane, boot1.degraded).not.toBeNull();
    expect(boot1.initialBytes).toBeNull(); // fresh board — the caller seeds

    const seeder = createFieldEngine(buildRegistry());
    const session = seeder.docs.create();
    seedField(seeder, session);
    const bytes = session.exportEnvelope(Date.now());
    await boot1.lane?.put(bytes, { engineSchema: ENGINE_SCHEMA_VERSION, savedAt: Date.now() });
    seeder.dispose();

    boot1.lane?.close();
    client1.close();
    await daemon1.stop();

    // ---- life 2: same dataDir — the board must come back identical ----
    const daemon2 = await boot(dataDir);
    const client2 = connect(daemon2);
    const boot2 = await loadBoard(client2);
    expect(boot2.lane, boot2.degraded).not.toBeNull();
    expect(boot2.initialBytes).not.toBeNull();
    expect(Array.from(boot2.initialBytes ?? [])).toEqual(Array.from(bytes));

    const joiner = createFieldEngine(buildRegistry());
    const res = joiner.docs.open(boot2.initialBytes as Uint8Array);
    expect(res.ok, res.ok ? "" : res.reason).toBe(true);
    joiner.dispose();
    boot2.lane?.close();
  }, 20_000);
});
