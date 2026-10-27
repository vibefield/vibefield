// Item 78 (UA-D16 reversed 2026-10-27, James's O1; LOG §6.5, §7.1) — two VibeField users in ONE OS account each get a
// fieldd, and the shell hands every one of them the SAME platform log root (`FIELD_LOG_DIR`). LOG allows one physical
// writer per stream, so the second user's fieldd used to be refused (`writer-conflict`) and log nothing at all: the W11
// Mac mini, 2026-10-27 04:19Z. A pair's log root is DERIVED from its user root (`<root>/users/<fuid>` →
// `<log root>/users/<fuid>`), so both users' fieldds log, each under its own root, whoever launched them.
//
// The row runs fieldd's own entry point (src/bin.ts, bundled the way its build bundles it) as two PROCESSES, each with
// the floor a supervised fieldd expects: a mock native mgmt server and a pairing secret under its user root.
import { type ChildProcess, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LAYOUT, pipeEndpointFor, SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { MockMgmtServer } from "../src/testing/mock-mgmt";

let cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  const fns = cleanup.reverse();
  cleanup = [];
  for (const fn of fns) {
    try {
      await fn();
    } catch {
      /* already gone */
    }
  }
});

async function until<T>(read: () => T | null, what: string, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== null) return value;
    if (Date.now() >= deadline) throw new Error(`${what} did not arrive within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Every fieldd record under `dir`, at any depth, with the file it was read from. */
function fielddRecords(dir: string): Array<{ file: string; pid: unknown }> {
  const found: Array<{ file: string; pid: unknown }> = [];
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...fielddRecords(path));
    else if (name.startsWith("fieldd") && name.endsWith(".ndjson")) {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        if (line.trim() === "") continue;
        try {
          found.push({ file: path, pid: (JSON.parse(line) as { pid?: unknown }).pid });
        } catch {
          /* a torn last line */
        }
      }
    }
  }
  return found;
}

describe("item 78 — two users' fieldds under one platform log root both log, each under its own root", () => {
  it("a second user's fieldd is never refused as writer-conflict: both write their own records", async () => {
    // SHORT roots: each mock floor's socket must fit macOS's 104-byte sun_path
    const base = realpathSync(mkdtempSync(join(tmpdir(), "vf-plr-")));
    cleanup.push(() => rmSync(base, { recursive: true, force: true }));
    const { build } = await import("esbuild");
    await build({
      absWorkingDir: join(import.meta.dirname, ".."),
      entryPoints: ["src/bin.ts"],
      outfile: join(base, "bin.cjs"),
      bundle: true,
      platform: "node",
      format: "cjs",
      define: { "import.meta.url": "undefined" },
      external: ["bufferutil", "utf-8-validate"],
      logLevel: "silent",
    });
    // the packaged layout stages loro's Node wasm beside the bundle; fieldd's own dependency supplies it here
    const loroEntry = createRequire(import.meta.url).resolve("loro-crdt");
    const loroWasm = [dirname(loroEntry), join(dirname(loroEntry), "..", "nodejs")]
      .map((dir) => join(dir, "loro_wasm_bg.wasm"))
      .find((path) => existsSync(path));
    if (loroWasm === undefined) throw new Error(`no loro_wasm_bg.wasm beside ${loroEntry}`);
    copyFileSync(loroWasm, join(base, "loro_wasm_bg.wasm"));
    const logs = join(base, "logs");
    const home = join(base, "home");
    const agents = join(base, "agents");
    for (const dir of [logs, home, agents]) mkdirSync(dir, { recursive: true });

    const pairs: Array<{ fuid: number; userRoot: string; child: ChildProcess }> = [];
    const stderrs = new Map<number, () => string>();
    for (const fuid of [1, 2]) {
      const userRoot = join(base, "vf", ...LAYOUT.USERS_DIR, String(fuid));
      mkdirSync(join(userRoot, "native", "run"), { recursive: true });
      writeFileSync(join(userRoot, "native", "pairing"), "ab".repeat(32));
      const mock = new MockMgmtServer(
        process.platform === "win32"
          ? pipeEndpointFor(userRoot, SOCKETS.MGMT)
          : join(userRoot, ...LAYOUT.MGMT_SOCKET),
      );
      await mock.start();
      cleanup.push(() => mock.stop());
      const child = spawn(process.execPath, [join(base, "bin.cjs")], {
        env: {
          PATH: "/usr/bin:/bin",
          HOME: home,
          TMPDIR: tmpdir(),
          FIELDD_USER_ROOT: userRoot,
          FIELDD_USER_ID: `01JTESTUSER00000000000000${fuid}`,
          FIELDD_CONTROL_PORT: "0",
          FIELDD_DATA_PORT: "0",
          FIELDD_ALLOWED_ORIGINS: "vibefield-app://shell",
          FIELDD_AGENT_SEARCH_PATH: agents,
          // ONE platform root for both, exactly as the shell hands it (electron-shell main/fieldd.ts)
          FIELD_LOG_DIR: logs,
          FIELDD_ALLOW_LOG_DIR_OVERRIDE: "1",
        },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4_000);
      });
      stderrs.set(fuid, () => stderr);
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
      pairs.push({ fuid, userRoot, child });
    }

    for (const { fuid, userRoot, child } of pairs) {
      await until(
        () => {
          if (child.exitCode !== null) {
            throw new Error(
              `user ${fuid}'s fieldd exited ${child.exitCode}: ${stderrs.get(fuid)?.() ?? ""}`,
            );
          }
          return existsSync(join(userRoot, ...LAYOUT.PRODUCT_JSON)) ? true : null;
        },
        `user ${fuid}'s fieldd run files`,
        60_000,
      );
    }

    // Both processes' records, by pid, wherever they landed under the ONE root the shell handed them.
    const byUser = await until(
      () => {
        const records = fielddRecords(logs);
        const files = pairs.map(({ child }) => [
          ...new Set(records.filter((r) => r.pid === child.pid).map((r) => r.file)),
        ]);
        return files.every((f) => f.length > 0) ? files : null;
      },
      "both users' fieldd records",
      10_000,
    ).catch((error: unknown) => {
      const records = fielddRecords(logs);
      throw new Error(
        `${String(error)} — records by pid: ${pairs
          .map(
            ({ fuid, child }) =>
              `user ${fuid} (pid ${child.pid}): ${records.filter((r) => r.pid === child.pid).length}`,
          )
          .join(
            ", ",
          )}; files: ${[...new Set(records.map((r) => r.file.slice(logs.length)))].join(", ")}`,
      );
    });

    // …and each under its OWN derived root, never the other's.
    for (const [index, { fuid }] of pairs.entries()) {
      expect(byUser[index]).toEqual([
        join(logs, ...LAYOUT.USERS_DIR, String(fuid), "system", "fieldd.ndjson"),
      ]);
    }
  }, 120_000);
});
