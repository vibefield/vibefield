// AR-8 (L3) — the packaged fieldd and its index daemon, run from the ARTIFACT.
// Opt-in: FIELDD_TEST_HISTORY_PACKAGE names a package's Resources/bin, and
// verify-history-package.mjs sets it (it is the only runner that has one). Each
// row execs the real single-executable fieldd from there — a SEA, so the words
// it says are the packaged build's — behind the mock floor, as the shell would
// spawn it (FIELDD_USER_ROOT, ephemeral ports, the app origin), with a HOME and
// an agent search path of the row's own: nothing of the machine owner's is read.
//  - with no rosettad named, the index is unconfigured in a person's words;
//  - with the packaged rosettad named, the packaged pair reaches ready.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAYOUT, pipeEndpointFor, SOCKETS } from "@vibefield/contracts";
import { FielddClient } from "@vibefield/fieldd-client";
import { PROTOCOL_VERSION } from "@vibefield/rosetta-protocol/protocol-version";
import { afterEach, describe, expect, it } from "vitest";
import { type RosettadHealth, rosettadUnconfigured } from "../src/rosettad-supervisor";
import { MockMgmtServer } from "../src/testing/mock-mgmt";

const PACKAGE = process.env["FIELDD_TEST_HISTORY_PACKAGE"];
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
/** Ask until there is an answer; a throw is a "not yet" whose words the
 * timeout carries, so a daemon that died says why. */
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

/** The packaged fieldd, spawned the way the shell spawns it, and a shell client
 * over its own run files. */
async function packagedFieldd(rosettad: string | null): Promise<{
  client: FielddClient;
  health: () => Promise<RosettadHealth>;
}> {
  const bin = PACKAGE as string;
  // a SHORT root: the mock floor's socket must fit macOS's 104-byte sun_path
  const root = mkdtempSync(join(tmpdir(), "vf-pkh-"));
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
      ...(rosettad !== null ? { FIELDD_ROSETTAD_BIN: rosettad } : {}),
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
  return {
    client,
    health: async () =>
      ((await client.request("system.health", {})) as { rosettad: RosettadHealth }).rosettad,
  };
}

describe.skipIf(PACKAGE === undefined || PACKAGE === "")(
  "AR-8 (L3) — the packaged fieldd and its rosettad (FIELDD_TEST_HISTORY_PACKAGE)",
  () => {
    it("with no rosettad named, the packaged index is unconfigured in a person's words", async () => {
      const { health } = await packagedFieldd(null);
      const said = await until(health, "system.health from the packaged fieldd", 30_000);
      expect(said).toEqual(rosettadUnconfigured(true));
      expect(said.detail).not.toMatch(/FIELDD|rosettad/);
      console.log(`PACKAGED_UNCONFIGURED ${JSON.stringify(said)}`);
    }, 120_000);

    it("with the packaged rosettad named, the packaged pair reaches ready", async () => {
      const rosettad = join(PACKAGE as string, exe("rosettad"));
      expect(existsSync(rosettad)).toBe(true);
      const { health } = await packagedFieldd(rosettad);
      const said = await until(
        async () => {
          const now = await health();
          if (now.phase === "failed") throw new Error(`rosettad failed: ${now.detail}`);
          return now.phase === "ready" ? now : null;
        },
        "the packaged rosettad ready under the packaged fieldd",
        60_000,
      );
      expect(said.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(said.pid).toBeGreaterThan(0);
      console.log(`PACKAGED_READY ${JSON.stringify(said)}`);
    }, 120_000);
  },
);
