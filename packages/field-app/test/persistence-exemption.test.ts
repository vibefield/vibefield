// @vitest-environment node
// THE EXEMPTION TEST (ESR §5.4.5, slice 5): a hidden window with a dirty
// document still persists. With backgroundThrottling restored, visibility may
// silence every optional source — but the persistence path (DocManager, doc
// lanes, autosave, close-flush) is visibility-EXEMPT by law. Behaviorally: a
// `document` stubbed hidden changes nothing — saves land, the close flush
// lands, and the bytes survive a daemon restart. Structurally: the persistence
// modules are BLIND to visibility (no document.hidden, no visibilitychange,
// no visibility.ts import) — a tripwire against anyone "optimizing" saves.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineQuery, ENGINE_SCHEMA_VERSION, Position, PrefabId } from "@vibecook/ice";
import { bootstrap, type FielddDaemon } from "@vibefield/fieldd";
import { MockMgmtServer } from "@vibefield/fieldd/testing";
import { FielddClient } from "@vibefield/fieldd-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocManager } from "../src/doc-manager";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});
beforeEach(() => {
  localStorage.removeItem("vf-last-doc");
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 4_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error("until: condition timeout");
    await sleep(20);
  }
}

async function stack(dataDir?: string): Promise<{ dataDir: string; daemon: FielddDaemon }> {
  const dir = dataDir ?? mkdtempSync(join(tmpdir(), "vf-exempt-"));
  if (dataDir === undefined) {
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, "native", "run"), { recursive: true });
    writeFileSync(join(dir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(join(dir, "native", "run", "mgmt.sock"));
    await mock.start();
    cleanup.push(() => mock.stop());
  }
  const daemon = await bootstrap({ dataDir: dir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  return { dataDir: dir, daemon };
}

function managerFor(daemon: FielddDaemon): DocManager {
  const client = new FielddClient({
    url: `ws://127.0.0.1:${daemon.controlPort}`,
    token: daemon.shellToken,
    clientKind: "debug",
  });
  client.connect();
  cleanup.push(() => client.close());
  return new DocManager(client, { timeoutMs: 5_000 });
}

function applyPending(manager: DocManager): ReturnType<typeof createFieldEngine> {
  const pending = manager.getState().pending;
  if (pending === null) throw new Error("no pending session");
  const registry = buildRegistry();
  const ce = createFieldEngine(registry);
  cleanup.push(() => ce.dispose());
  if (pending.initialBytes !== null) {
    const res = ce.docs.open(pending.initialBytes);
    if (!res.ok) throw new Error(`open failed: ${res.reason}`);
    for (const update of pending.initialUpdates) res.session.applyRemote(update);
    ce.world.sync();
  } else {
    const session = ce.docs.create();
    if (pending.seed) seedField(ce, session, registry);
    else ce.world.sync();
  }
  manager.contentApplied(pending.generation);
  return ce;
}

const widgetQ = defineQuery([Position, PrefabId]);
function widgetCount(ce: ReturnType<typeof createFieldEngine>): number {
  let n = 0;
  ce.world.query(widgetQ).each((b) => {
    for (const _ of b) n += 1;
  });
  return n;
}

/** The trap: any persistence code consulting document.hidden now sees TRUE. */
function stubHiddenDocument(): void {
  (globalThis as Record<string, unknown>)["document"] = {
    hidden: true,
    visibilityState: "hidden",
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  cleanup.push(() => {
    delete (globalThis as Record<string, unknown>)["document"];
  });
}

describe("the persistence exemption (hidden windows still persist)", () => {
  it("saves land, the close flush lands, and the bytes survive restart — all while hidden", async () => {
    const { dataDir, daemon } = await stack();
    const manager = managerFor(daemon);
    await manager.boot();
    const ce = applyPending(manager);
    await until(() => manager.getState().phase === "ready");

    stubHiddenDocument();

    // a dirty-doc save while "hidden" reaches the daemon
    const pending = manager.getState().pending;
    const session = ce.docs.current();
    if (pending?.lane == null || session === undefined) throw new Error("no lane/session");
    const bytes = session.exportEnvelope(Date.now());
    await pending.lane.put(bytes, { engineSchema: ENGINE_SCHEMA_VERSION, savedAt: Date.now() });
    expect(daemon.docs.list()).toHaveLength(1);

    // the close flush ignores visibility too
    await manager.shutdown();

    // and the hidden-era save is durable: a fresh daemon serves it back
    const second = await stack(dataDir);
    const manager2 = managerFor(second.daemon);
    await manager2.boot();
    const restored = manager2.getState().pending;
    expect(restored?.initialBytes).not.toBeNull();
    const ce2 = applyPending(manager2);
    await until(() => manager2.getState().phase === "ready");
    expect(widgetCount(ce2)).toBe(21); // the seeded board, byte-survived
    await manager2.shutdown();
  }, 30_000);

  it("the persistence path is structurally blind to visibility", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const persistenceSources = [
      join(here, "..", "src", "doc-manager.ts"),
      join(here, "..", "..", "fieldd-client", "src", "doclane.ts"),
      join(here, "..", "..", "fieldd-client", "src", "client.ts"),
    ];
    for (const path of persistenceSources) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(/document\.hidden|visibilitychange|from ["']\.\/visibility/);
    }
  });
});
