// Item 565 (2026-11-19): the iOS Simulator plugin runs only on a Mac (its phones are
// CoreSimulator's, which is macOS's alone), and the packaged app's bundled list is one list for
// every platform. Its OWN committed manifest (plugins/simulator/vibefield.plugin.json), walked from
// an unkeyed bundled root as a developer's tree is, registers on darwin and is refused on win32 and
// linux: `incompatible`, off, and fieldd's sentence, which Settings → Diagnostics' Plugins section
// shows under the plugin's title. Installed's row says its own line for any plugin in that state.
// fieldd reads `process.platform` as it builds each record, so each row sets it around its one
// refresh and puts the real one back.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PluginRegistryService } from "../src/plugin-registry";

const SIMULATOR_ID = "vibefield.simulator";
const SIMULATOR_MANIFEST = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../plugins/simulator/vibefield.plugin.json",
);

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The simulator's record as fieldd builds it while `process.platform` reads `platform`. */
async function simulatorOn(platform: NodeJS.Platform) {
  const root = tmp("plugreg-platform-");
  mkdirSync(join(root, SIMULATOR_ID));
  writeFileSync(
    join(root, SIMULATOR_ID, "vibefield.plugin.json"),
    readFileSync(SIMULATOR_MANIFEST),
  );
  const svc = new PluginRegistryService({
    dataDir: tmp("plugreg-data-"),
    roots: { bundled: [root], devLinked: [] },
  });
  cleanup.push(() => svc.dispose());
  const real = Object.getOwnPropertyDescriptor(process, "platform");
  if (real === undefined) throw new Error("process.platform has no descriptor");
  Object.defineProperty(process, "platform", { ...real, value: platform });
  try {
    await svc.refresh();
  } finally {
    Object.defineProperty(process, "platform", real);
  }
  return svc.snapshot().plugins.find((p) => p.id === SIMULATOR_ID);
}

describe("the iOS Simulator plugin's own manifest, by platform (item 565)", () => {
  it("registers on a Mac: compatible and on", async () => {
    const row = await simulatorOn("darwin");
    expect(row?.state).toBe("enabled");
    expect(row?.compatible).toBe(true);
    expect(row?.lastError).toBeUndefined();
  });

  it.each(["win32", "linux"] as const)(
    "is refused on %s: incompatible and off, fieldd's sentence naming the platform",
    async (platform) => {
      const row = await simulatorOn(platform);
      expect(row?.state).toBe("incompatible");
      expect(row?.compatible).toBe(false);
      expect(row?.enabled).toBe(false);
      expect(row?.lastError).toEqual({
        kind: "PLUGIN_INCOMPATIBLE",
        message: `not built for platform ${platform}`,
      });
    },
  );
});
