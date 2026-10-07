// A holders ledger is still owned by fieldd until its checkpoint settles.
// Park the real directory creation to expose early shutdown deterministically.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocHoldersService } from "../src/library-doc";
import { FakeHoldersStore } from "./holders-store";

const gate = vi.hoisted(() => ({
  path: null as string | null,
  entered: null as (() => void) | null,
  wait: null as Promise<void> | null,
  release: null as (() => void) | null,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  const mkdir = (async (path: Parameters<typeof actual.mkdir>[0], options: unknown) => {
    if (String(path) === gate.path) {
      gate.path = null;
      gate.entered?.();
      await gate.wait;
    }
    return await (actual.mkdir as (...args: unknown[]) => Promise<unknown>)(path, options);
  }) as typeof actual.mkdir;
  return { ...actual, mkdir, default: { ...actual, mkdir } };
});

const fixtures: Array<{ root: string; holders: DocHoldersService }> = [];
afterEach(async () => {
  gate.release?.();
  gate.path = null;
  for (const { root, holders } of fixtures.splice(0)) {
    // Also drain a failed assertion against the old fire-and-forget stop.
    await holders.flush();
    await holders.stop();
    rmSync(root, { recursive: true, force: true });
  }
  gate.entered = null;
  gate.wait = null;
  gate.release = null;
});

function holdDirectory(path: string): Promise<void> {
  gate.path = path;
  gate.wait = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  return new Promise<void>((resolve) => {
    gate.entered = resolve;
  });
}

describe("holders ledger shutdown", () => {
  it.each(["scheduled", "in-flight"] as const)(
    "waits for a %s checkpoint before the owner can remove its root",
    async (phase) => {
      const root = mkdtempSync(join(tmpdir(), "vf-holders-stop-"));
      const ledgerPath = join(root, "registries", "holders.json");
      const store = new FakeHoldersStore();
      const holders = new DocHoldersService({
        mesh: store.member("studio"),
        deviceId: () => "studio",
        holdings: async () => [],
        ledgerPath,
        debounceMs: 60_000,
      });
      fixtures.push({ root, holders });
      await holders.start();
      const entered = holdDirectory(join(root, "registries"));
      const writing = phase === "in-flight" ? holders.flush() : null;
      if (writing !== null) await entered;
      const stop = holders.stop();
      let settled = false;
      const stopped = Promise.resolve(stop).then(() => {
        settled = true;
      });
      try {
        await entered;
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(holders.stop()).toBe(stop);
        gate.release?.();
        await stopped;
        await writing;
        expect(JSON.parse(readFileSync(ledgerPath, "utf8"))).toMatchObject({
          v: 1,
          heard: true,
          holders: { studio: { docs: [] } },
        });
      } finally {
        gate.release?.();
        await writing;
      }
    },
  );
});
