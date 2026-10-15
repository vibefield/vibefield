// WP8d (build-wp8-bundled-plugins.md W9; §10 addendum, "WP8d, the packaged witness's shape") — the packaged fieldd and
// the app's own plugins, run from the ARTIFACT. Opt-in: FIELDD_TEST_PLUGINS_PACKAGE names a built app's
// `Contents/Resources`, and verify-plugins-package.mjs sets it (it is the only runner that has one). Each row execs the
// real single-executable fieldd from `Resources/bin` behind the mock floor, as the packaged shell spawns it (WP8-D9: the
// layout's bundled root, no dev root, the staged trust-root and the root keys release-identity.json names), with a HOME,
// data root and agent search path of the row's own, and reads `plugins.list`:
//  - the app's root as shipped: every plugin of its index enabled, with the provenance block; no root problem;
//  - a copy of that root with one byte of one plugin's file flipped: that row refused on its row, the others enabled;
//  - the app's root under root keys that are not the app's: not one bundled row, one root problem.
import { type ChildProcess, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUNDLED_PLUGIN_INDEX_FILE,
  BundledPluginIndex,
  FIELDD_TRUST_ROOT_ENV,
  FIELDD_TRUST_ROOT_KEYS_ENV,
  IDENTITY_DIR,
  LAYOUT,
  type PluginRegistrySnapshot,
  PluginsListResult,
  pipeEndpointFor,
  RELEASE_IDENTITY_FILE,
  SOCKETS,
  StagedReleaseIdentity,
  TRUST_ROOT_FILE,
} from "@vibefield/contracts";
import { FielddClient } from "@vibefield/fieldd-client";
import { generateRegistryKeypair } from "@vibefield/plugin-build";
import { afterEach, describe, expect, it } from "vitest";
import { MockMgmtServer } from "../src/testing/mock-mgmt";

const RESOURCES = process.env["FIELDD_TEST_PLUGINS_PACKAGE"];
const exe = (name: string): string => (process.platform === "win32" ? `${name}.exe` : name);

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* already gone */
    }
  }
  cleanup = [];
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Ask until there is an answer; a throw is a "not yet" whose words the timeout carries. */
async function until<T>(read: () => T | null | Promise<T | null>, label: string, ms: number) {
  const deadline = Date.now() + ms;
  let last: unknown = null;
  for (;;) {
    try {
      const value = await read();
      if (value !== null) return value;
    } catch (error) {
      last = error;
    }
    if (Date.now() > deadline)
      throw new Error(`until: ${label}${last === null ? "" : ` (last: ${String(last)})`}`);
    await sleep(150);
  }
}

/** The app's own bundled root, its index, and the root keys its staged identity names. */
function shipped() {
  const resources = RESOURCES as string;
  const bundled = join(resources, "plugins", "bundled");
  const identity = StagedReleaseIdentity.parse(
    JSON.parse(readFileSync(join(resources, IDENTITY_DIR, RELEASE_IDENTITY_FILE), "utf8")),
  );
  const index = BundledPluginIndex.parse(
    JSON.parse(readFileSync(join(bundled, BUNDLED_PLUGIN_INDEX_FILE), "utf8")),
  );
  return {
    bundled,
    trustRoot: join(resources, IDENTITY_DIR, TRUST_ROOT_FILE),
    rootKeys: identity.trustRootKeys,
    keyClass: identity.keyClass,
    index,
    ids: Object.keys(index.plugins).sort(),
  };
}

/** The packaged fieldd, spawned with the packaged shell's plugin environment, and its registry snapshot. */
async function packagedRegistry(plugins: {
  root: string;
  trustRoot: string;
  rootKeys: readonly string[];
}): Promise<PluginRegistrySnapshot> {
  const bin = join(RESOURCES as string, "bin");
  // a SHORT root: the mock floor's socket must fit macOS's 104-byte sun_path
  const root = mkdtempSync(join(tmpdir(), "vf-pkp-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "native", "run"), { recursive: true });
  writeFileSync(join(root, "native", "pairing"), "ab".repeat(32));
  const home = join(root, "home");
  const agents = join(root, "agents");
  const logs = join(root, "logs");
  for (const dir of [home, agents, logs]) mkdirSync(dir, { recursive: true });
  const mock = new MockMgmtServer(
    process.platform === "win32"
      ? pipeEndpointFor(root, SOCKETS.MGMT)
      : join(root, ...LAYOUT.MGMT_SOCKET),
  );
  await mock.start();
  cleanup.push(() => mock.stop());
  const child: ChildProcess = spawn(join(bin, exe("fieldd")), [], {
    env: {
      PATH: "/usr/bin:/bin",
      HOME: home,
      TMPDIR: tmpdir(),
      FIELDD_DATA_DIR: root,
      FIELDD_USER_ROOT: root,
      FIELDD_CONTROL_PORT: "0",
      FIELDD_DATA_PORT: "0",
      FIELDD_ALLOWED_ORIGINS: "vibefield-app://shell",
      FIELDD_AGENT_SEARCH_PATH: agents,
      FIELD_LOG_DIR: logs,
      FIELDD_ALLOW_LOG_DIR_OVERRIDE: "1",
      // the packaged shell's plugin environment (main/fieldd.ts, WP8-D9), and nothing of the launcher's
      FIELDD_PLUGIN_ROOTS: plugins.root,
      FIELDD_PLUGIN_DEV_ROOTS: "",
      [FIELDD_TRUST_ROOT_ENV]: plugins.trustRoot,
      [FIELDD_TRUST_ROOT_KEYS_ENV]: plugins.rootKeys.join(","),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4_000);
  });
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        const kill = setTimeout(() => child.kill("SIGKILL"), 15_000);
        child.once("exit", () => {
          clearTimeout(kill);
          resolve();
        });
        child.kill("SIGTERM");
      }),
  );
  const run = await until(
    () => {
      if (child.exitCode !== null) throw new Error(`fieldd exited ${child.exitCode}`);
      const product = join(root, ...LAYOUT.PRODUCT_JSON);
      const token = join(root, ...LAYOUT.SHELL_TOKEN);
      if (!existsSync(product) || !existsSync(token)) return null;
      return {
        port: (JSON.parse(readFileSync(product, "utf8")) as { port: number }).port,
        token: readFileSync(token, "utf8").trim(),
      };
    },
    "the packaged fieldd's run files",
    60_000,
  ).catch((error: unknown) => {
    throw new Error(`${String(error)}\n${stderr}`);
  });
  const client = new FielddClient({
    url: `ws://127.0.0.1:${run.port}`,
    token: run.token,
    clientKind: "shell-main",
  });
  client.connect();
  cleanup.push(() => client.close());
  return until(
    async () => PluginsListResult.parse(await client.request("plugins.list", {})),
    "plugins.list from the packaged fieldd",
    30_000,
  );
}

describe.skipIf(RESOURCES === undefined || RESOURCES === "")(
  "WP8d (W9) — the packaged fieldd and the app's own plugins (FIELDD_TEST_PLUGINS_PACKAGE)",
  () => {
    it("the app's root as shipped: every plugin of its index enabled with its provenance, no root problem", async () => {
      const app = shipped();
      expect(app.ids.length).toBeGreaterThan(0);
      const snapshot = await packagedRegistry({
        root: app.bundled,
        trustRoot: app.trustRoot,
        rootKeys: app.rootKeys,
      });
      console.log(
        `PACKAGED_PLUGINS ${JSON.stringify({
          keyClass: app.keyClass,
          rows: snapshot.plugins.map((p) => ({ id: p.id, source: p.source, state: p.state })),
          problems: snapshot.problems,
        })}`,
      );
      expect(snapshot.problems).toEqual([]);
      expect(snapshot.plugins.filter((p) => p.source !== "bundled").map((p) => p.id)).toEqual([]);
      expect(snapshot.plugins.map((p) => p.id).sort()).toEqual(app.ids);
      for (const row of snapshot.plugins) {
        const entry = app.index.plugins[row.id];
        expect(row.state, row.id).toBe("enabled");
        expect(row.enabled, row.id).toBe(true);
        expect(row.registry, row.id).toMatchObject({
          indexRef: BUNDLED_PLUGIN_INDEX_FILE,
          artifactSha256: entry?.artifactSha256,
          publisher: "vibefield",
        });
        expect(`sha256:${row.installRevision}`, row.id).toBe(entry?.artifactSha256);
      }
    }, 120_000);

    it("a copy of the root with one byte flipped: that plugin refused on its row, the others enabled", async () => {
      const app = shipped();
      const work = mkdtempSync(join(tmpdir(), "vf-pkp-copy-"));
      cleanup.push(() => rmSync(work, { recursive: true, force: true }));
      const copy = join(work, "bundled");
      cpSync(app.bundled, copy, { recursive: true });
      const id = app.ids[0] as string;
      const path = Object.keys(app.index.plugins[id]?.files ?? {}).sort()[0] as string;
      const file = join(copy, id, ...path.split("/"));
      const bytes = readFileSync(file);
      const at = Math.floor(bytes.length / 2);
      bytes[at] = (bytes[at] ?? 0) ^ 0x01;
      writeFileSync(file, bytes);
      const snapshot = await packagedRegistry({
        root: copy,
        trustRoot: app.trustRoot,
        rootKeys: app.rootKeys,
      });
      console.log(
        `PACKAGED_PLUGINS_CORRUPT ${JSON.stringify({
          id,
          path,
          rows: snapshot.plugins.map((p) => ({ id: p.id, state: p.state, lastError: p.lastError })),
        })}`,
      );
      expect(snapshot.problems).toEqual([]);
      const refused = snapshot.plugins.find((p) => p.id === id);
      expect(refused?.state).toBe("invalid");
      expect(refused?.enabled).toBe(false);
      expect(refused?.lastError?.kind).toBe("PLUGIN_ARTIFACT_MISMATCH");
      expect(refused?.lastError?.message).toContain(path);
      for (const other of app.ids.filter((x) => x !== id)) {
        expect(snapshot.plugins.find((p) => p.id === other)?.state, other).toBe("enabled");
      }
    }, 120_000);

    it("the root under keys that are not the app's: not one bundled row, one root problem", async () => {
      const app = shipped();
      const strangers = [generateRegistryKeypair(), generateRegistryKeypair()].map(
        (pair) => pair.publicKey,
      );
      const snapshot = await packagedRegistry({
        root: app.bundled,
        trustRoot: app.trustRoot,
        rootKeys: strangers,
      });
      console.log(`PACKAGED_PLUGINS_STRANGER ${JSON.stringify(snapshot.problems)}`);
      expect(snapshot.plugins.filter((p) => p.source === "bundled")).toEqual([]);
      expect(snapshot.problems).toHaveLength(1);
      expect(snapshot.problems[0]?.error.kind).toBe("PLUGIN_ARTIFACT_MISMATCH");
      expect(snapshot.problems[0]?.error.message).toMatch(/trust-root/);
    }, 120_000);
  },
);
