// OB custody (C2; CUSTODY-SPEC §1, §2.3; EL7-PLAN §3.2, §3.3) — THE TWO LEVELS AT BOOT.
//
// `files` is today, byte for byte: `fieldd/run/shell.token` (0600, every scope) beside `product.json`. `sealed` is a
// fieldd whose spawner handed it custody on stdin: it writes no `shell.token`, `product.json` says which level it is
// at, and both levels say theirs once in the log. The flag set and no valid hand-off is a refusal to boot, never a
// fall back to the files.
//
// Two roads, both run here:
//   · in this process, through `FielddConfig.custody` (the seam): the run files, the level, the log, the stop;
//   · as a PROCESS, through fieldd's own entry bundled the way its build bundles it (`fieldd-bin-bundle.ts`), with
//     the hand-off written to its stdin as a supervisor writes it: the pipe itself, and the refusals.
// The floor in both is the mock, and its pairing is C3's: until that slice a sealed fieldd still read the floor's
// file, so the rows in this process write it (custody-harness.ts `floorFile`) and hold before C3 and after it. The
// sealed process row pairs with no file. A floor the entry SPAWNS is a stand-in script: handed custody, fieldd asks
// whose code it is and refuses it (C6); handed nothing, it asks nobody.
import { type ChildProcess, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CUSTODY, LAYOUT, ProductInfo, SOCKETS } from "@vibefield/contracts";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import {
  bootFiles,
  bootSealed,
  type Cleanup,
  HANDED,
  hello,
  openDoor,
  pairingCredential,
  runCleanup,
  shellAckMac,
} from "./custody-harness";
import { bundleFielddBin } from "./fieldd-bin-bundle";
import { nativeEndpoint, removeTempRoot, shortTmpRoot } from "./native-harness";

const cleanup: Cleanup = [];
afterEach(() => runCleanup(cleanup));

const tokenPath = (dataDir: string): string => join(dataDir, ...LAYOUT.SHELL_TOKEN);
const productPath = (dataDir: string): string => join(dataDir, ...LAYOUT.PRODUCT_JSON);
const runDir = (dataDir: string): string => join(dataDir, ...LAYOUT.FIELDD_RUN_DIR);
const readProduct = (dataDir: string): ProductInfo =>
  ProductInfo.parse(JSON.parse(readFileSync(productPath(dataDir), "utf8")));

/** The daemon's own log, as it wrote it (`<logRoot>/system/fieldd.ndjson`). */
function logged(logRoot: string): {
  raw: string;
  events: Array<{ event: string; attrs?: Record<string, unknown> }>;
} {
  const raw = readFileSync(join(logRoot, "system", "fieldd.ndjson"), "utf8");
  const events = raw
    .trim()
    .split("\n")
    .map((row) => JSON.parse(row) as { event: string; attrs?: Record<string, unknown> });
  return { raw, events };
}

describe("a fieldd handed custody (sealed)", () => {
  it("a sealed boot writes no shell.token", async () => {
    const { dataDir, daemon } = await bootSealed(cleanup);
    expect(existsSync(tokenPath(dataDir))).toBe(false);
    // the run directory holds the discovery record and nothing else
    expect(readdirSync(runDir(dataDir)).sort()).toEqual(["product.json"]);
    expect(daemon.shellToken).toBeUndefined();
  });

  it("a sealed boot removes the token a files fieldd left on its root", async () => {
    const stale = "tok_left-by-a-fieldd-that-is-gone";
    const { dataDir } = await bootSealed(cleanup, {
      before: (root) => {
        mkdirSync(runDir(root), { recursive: true });
        writeFileSync(tokenPath(root), stale, { mode: 0o600 });
      },
    });
    expect(existsSync(tokenPath(dataDir))).toBe(false);
  });

  it("product.json says its level", async () => {
    const sealed = await bootSealed(cleanup);
    expect(readProduct(sealed.dataDir).custody).toBe("sealed");
    // and the rest of the record is what it was: the port, the pid, the boot
    expect(readProduct(sealed.dataDir)).toMatchObject({
      port: sealed.daemon.controlPort,
      pid: process.pid,
      bootId: sealed.daemon.bootId,
      buildId: null,
      userId: null,
    });

    const files = await bootFiles(cleanup);
    expect(readProduct(files.dataDir).custody).toBe("files");
  });

  it("a sealed stop removes its record and does not miss the token it never wrote", async () => {
    const { dataDir, daemon } = await bootSealed(cleanup);
    expect(existsSync(tokenPath(dataDir))).toBe(false);
    expect(existsSync(productPath(dataDir))).toBe(true);
    await expect(daemon.stop()).resolves.toBeUndefined();
    expect(existsSync(productPath(dataDir))).toBe(false);
    expect(existsSync(tokenPath(dataDir))).toBe(false);
  });

  it("each level says which it is once in its log, and a sealed log holds nothing it was handed", async () => {
    const sealedLogs = shortTmpRoot("vf-cust-log-");
    cleanup.push(() => removeTempRoot(sealedLogs));
    const sealed = await bootSealed(cleanup, { logRoot: sealedLogs });
    await sealed.daemon.stop();
    const sealedLog = logged(sealedLogs);
    const said = sealedLog.events.filter((row) => row.event === "fieldd.custody.level");
    expect(said).toHaveLength(1);
    expect(said[0]?.attrs).toMatchObject({ level: "sealed" });
    for (const secret of [HANDED.shell, HANDED.pairing, HANDED.records])
      expect(sealedLog.raw).not.toContain(secret);

    const filesLogs = shortTmpRoot("vf-cust-log-");
    cleanup.push(() => removeTempRoot(filesLogs));
    const files = await bootFiles(cleanup, { logRoot: filesLogs });
    await files.daemon.stop();
    const filesSaid = logged(filesLogs).events.filter(
      (row) => row.event === "fieldd.custody.level",
    );
    expect(filesSaid).toHaveLength(1);
    expect(filesSaid[0]?.attrs).toMatchObject({ level: "files" });
  });
});

describe("a fieldd handed nothing (files)", () => {
  // A GUARD, not a red row: it holds before custody and after it. What it pins is today's run files.
  it("a files boot is today's: the same files, the same modes", async () => {
    const pairing = "ab".repeat(32);
    const { dataDir, daemon } = await bootFiles(cleanup);
    expect(readdirSync(runDir(dataDir)).sort()).toEqual(["product.json", "shell.token"]);
    expect(readFileSync(tokenPath(dataDir), "utf8")).toBe(daemon.shellToken);
    expect(daemon.shellToken).toMatch(/^tok_[0-9a-f]{48}$/);
    if (process.platform !== "win32") {
      expect(statSync(tokenPath(dataDir)).mode & 0o777).toBe(0o600);
      expect(statSync(runDir(dataDir)).mode & 0o777).toBe(0o700);
    }
    // the floor's pairing file is the floor's: read, never rewritten
    expect(readFileSync(join(dataDir, ...LAYOUT.PAIRING_FILE), "utf8")).toBe(pairing);
    const product = readProduct(dataDir);
    expect(product).toMatchObject({
      port: daemon.controlPort,
      pid: process.pid,
      bootId: daemon.bootId,
      nativePid: null,
      buildId: null,
      userId: null,
    });
    for (const key of ["contractsVersion", "startedAt"]) expect(product).toHaveProperty(key);

    await daemon.stop();
    expect(existsSync(tokenPath(dataDir))).toBe(false);
    expect(existsSync(productPath(dataDir))).toBe(false);
  });
});

// ---- the entry itself, as a process ----

const USER = "01JTESTUSER000000000000001";
const line = (value: unknown): string => `${JSON.stringify(value)}\n`;
/** What a supervisor writes: contracts' `CustodyHandoff`, the harness's secrets in it. */
const HANDOFF = {
  v: 1,
  shell: HANDED.shell,
  pairing: HANDED.pairing,
  records: HANDED.records,
  expect: { "objects.grants": 7 },
};

let bin = "";
let bundleDir = "";

interface Running {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
}

/** fieldd's bundle under this Node, in an environment that names nothing of the machine's. */
function runFieldd(
  args: string[],
  env: Record<string, string>,
  stdin: "pipe" | "ignore",
  scratch: string,
): Running {
  const home = join(scratch, "home");
  const agents = join(scratch, "agents");
  const logs = join(scratch, "logs");
  for (const dir of [home, agents, logs]) mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, [bin, ...args], {
    env: {
      PATH: "/usr/bin:/bin",
      HOME: home,
      TMPDIR: tmpdir(),
      FIELDD_CONTROL_PORT: "0",
      FIELDD_DATA_PORT: "0",
      // were a boot to get that far: no agent install of this machine's is read
      FIELDD_AGENT_SEARCH_PATH: agents,
      FIELD_LOG_DIR: logs,
      FIELDD_ALLOW_LOG_DIR_OVERRIDE: "1",
      ...env,
    },
    stdio: [stdin, "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout = (stdout + chunk.toString()).slice(-8_000);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-8_000);
  });
  // a writer whose reader left is that row's own finding, never an unhandled error here
  child.stdin?.on("error", () => undefined);
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
  return { child, stdout: () => stdout, stderr: () => stderr };
}

/** The child's exit, or, past `ms`, its stop: a boot that neither came up nor refused. */
function exitWithin(
  child: ChildProcess,
  ms: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    let timedOut = false;
    const term = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, ms);
    child.once("exit", (code, signal) => {
      clearTimeout(term);
      resolve({ code, signal, timedOut });
    });
  });
}

async function until<T>(read: () => T | null, what: string, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== null) return value;
    if (Date.now() >= deadline) throw new Error(`${what} did not arrive within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("fieldd's entry under FIELDD_CUSTODY=stdin", () => {
  beforeAll(async () => {
    bundleDir = shortTmpRoot("vf-cust-bin-");
    bin = (await bundleFielddBin(bundleDir)).bin;
    // the packaged layout stages loro's Node wasm beside the bundle; fieldd's own dependency supplies it here
    const loroEntry = createRequire(import.meta.url).resolve("loro-crdt");
    const loroWasm = [dirname(loroEntry), join(dirname(loroEntry), "..", "nodejs")]
      .map((dir) => join(dir, "loro_wasm_bg.wasm"))
      .find((path) => existsSync(path));
    if (loroWasm === undefined) throw new Error(`no loro_wasm_bg.wasm beside ${loroEntry}`);
    copyFileSync(loroWasm, join(bundleDir, "loro_wasm_bg.wasm"));
    return () => removeTempRoot(bundleDir);
  }, 120_000);

  it("handed custody on its stdin, it boots sealed: no token file, its level said, and the shell pairs with what it handed", async () => {
    const scratch = shortTmpRoot("vf-cust-run-");
    cleanup.push(() => removeTempRoot(scratch));
    const userRoot = join(scratch, "vf", ...LAYOUT.USERS_DIR, "1");
    mkdirSync(join(userRoot, ...LAYOUT.NATIVE_RUN_DIR), { recursive: true });
    // C3: no pairing file anywhere on the root. The floor is the mock, alive before the boot (so fieldd spawns none
    // and asks nobody whose code it is), holding the handed secret and checking each hello's MAC under it: a ready
    // fieldd is one that paired from its hand-off.
    const mock = new MockMgmtServer(nativeEndpoint(userRoot, SOCKETS.MGMT));
    mock.pairingSecretHex = HANDED.pairing;
    mock.verifyClientMac = true;
    await mock.start();
    cleanup.push(() => mock.stop());

    const run = runFieldd(
      [],
      { FIELDD_USER_ROOT: userRoot, FIELDD_USER_ID: USER, [CUSTODY.ENV]: CUSTODY.STDIN },
      "pipe",
      scratch,
    );
    // one line, then EOF, as a supervisor writes it
    run.child.stdin?.end(line(HANDOFF));

    const ready = await until(
      () => {
        if (run.child.exitCode !== null)
          throw new Error(`fieldd exited ${run.child.exitCode}: ${run.stderr()}`);
        const rows = run.stdout().split("\n");
        const row = rows.find((text) => text.includes('"ready":true'));
        return row === undefined
          ? null
          : (JSON.parse(row) as { ready: true; port: number; bootId: string });
      },
      "fieldd's ready line",
      90_000,
    );

    // it paired with the floor under what it was handed, and no file was read or made for it
    expect(mock.refusedHellos).toBe(0);
    expect(existsSync(join(userRoot, ...LAYOUT.PAIRING_FILE))).toBe(false);
    // nothing secret on disk: no shell token, and the record says the level
    expect(existsSync(tokenPath(userRoot))).toBe(false);
    expect(readProduct(userRoot)).toMatchObject({
      custody: "sealed",
      port: ready.port,
      bootId: ready.bootId,
      userId: USER,
    });

    // the shell pairs with the secret it handed, and the daemon proves it holds the same
    const rpc = await openDoor(cleanup, ready.port);
    const credential = pairingCredential({ port: ready.port, bootId: ready.bootId, userId: USER });
    const ack = await hello(rpc, credential);
    const proof = { nonce: credential.nonce, bootId: ready.bootId, port: ready.port };
    expect(ack.serverMac).toBe(shellAckMac(HANDED.shell, proof));
    await expect(
      rpc.call("system.mintWindowToken", {
        scopes: ["canvas.read"],
        label: "window-1",
        rendererParticipant: {
          participantId: "renderer:desktop-test:window-1",
          incarnation: "renderer:desktop-test:window-1:document-1",
        },
      }),
    ).resolves.toMatchObject({ scopes: ["canvas.read"] });

    // a clean stop, and nothing the daemon said anywhere holds what it was handed
    run.child.kill("SIGTERM");
    const exit = await exitWithin(run.child, 30_000);
    expect(exit, run.stderr()).toMatchObject({ code: 0, timedOut: false });
    expect(existsSync(productPath(userRoot))).toBe(false);
    const log = logged(join(scratch, "logs", ...LAYOUT.USERS_DIR, "1"));
    const said = log.events.filter((row) => row.event === "fieldd.custody.level");
    expect(said).toHaveLength(1);
    expect(said[0]?.attrs).toMatchObject({ level: "sealed" });
    for (const secret of [HANDED.shell, HANDED.pairing, HANDED.records]) {
      expect(log.raw).not.toContain(secret);
      expect(run.stdout()).not.toContain(secret);
      expect(run.stderr()).not.toContain(secret);
    }
  }, 180_000);

  /** What a stand-in floor wrote down of its birth, at its stdin's end. */
  interface FloorBirth {
    pid: number;
    args: string[];
    flag: string | null;
    dataDir: string | null;
    stdin: string;
  }

  /** A stand-in for field-native: a script that writes down its pid at once, each piece of its stdin as it arrives
   * and, at its stdin's end, how it was born (its flag, its arguments, the whole of its stdin), then stays. It is no
   * floor: nothing of it listens, and on no host is it signed as the floor is. The row's cleanup ends each one by
   * the pid it wrote down. */
  function standInFloor(scratch: string): {
    bin: string;
    pids: () => number[];
    /** everything it has read of its stdin so far: what a stand-in ended before its stdin's end still leaves */
    heard: () => string;
    birth: () => FloorBirth | null;
  } {
    const born = join(scratch, "floor-born.json");
    const floorPids = join(scratch, "floor.pids");
    const floorHeard = join(scratch, "floor.heard");
    const bin = join(scratch, "field-native");
    writeFileSync(
      bin,
      `#!${process.execPath}
"use strict";
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(floorPids)}, process.pid + "\\n");
// a stand-in nobody ended ends itself
setTimeout(() => process.exit(0), 150_000);
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
  fs.appendFileSync(${JSON.stringify(floorHeard)}, chunk);
});
process.stdin.on("end", () => {
  fs.writeFileSync(
    ${JSON.stringify(born)},
    JSON.stringify({
      pid: process.pid,
      args: process.argv.slice(2),
      flag: process.env.FIELD_NATIVE_CUSTODY ?? null,
      dataDir: process.env.FIELD_NATIVE_DATA_DIR ?? null,
      stdin,
    }),
  );
});
setInterval(() => {}, 1_000);
`,
      { mode: 0o755 },
    );
    const pids = (): number[] => {
      if (!existsSync(floorPids)) return [];
      const written = readFileSync(floorPids, "utf8").split("\n");
      return written.filter(Boolean).map(Number);
    };
    // a stand-in outlives fieldd by design (detached, unref'd)
    cleanup.push(() => {
      for (const pid of pids()) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    });
    const heard = (): string => {
      if (!existsSync(floorHeard)) return "";
      return readFileSync(floorHeard, "utf8");
    };
    const birth = (): FloorBirth | null => {
      if (!existsSync(born)) return null;
      try {
        return JSON.parse(readFileSync(born, "utf8")) as FloorBirth;
      } catch {
        return null; // half written
      }
    };
    return { bin, pids, heard, birth };
  }

  /** Is there a process at this pid still? */
  function alive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  // C3 and C6 under the real entry (§2.4 "v0.15"): THE row that goes through the real wiring. It is fieldd's own
  // entry, bundled as its build bundles it; no verifier is handed in, and nothing below it is replaced either. A
  // fieldd handed custody asks whose code its floor is BEFORE it writes the floor anything (trust's `childIsOurs`,
  // always with the floor's signing identifier), and a floor that does not verify is written nothing, is ended, and
  // fails the boot: never an unverified hand. The floor here is a stand-in script, which on no host is the floor.
  //
  // What it meets depends on the Node it runs under, and it cannot say which. On macOS under a Node a team signed
  // for the hardened runtime, fieldd's own identity is that team's and so is the stand-in's, which is the same Node:
  // what refuses it is the floor's identifier and nothing else, asked of the real `codesign` (display and verify of
  // its own two processes, no more). Under any other Node, and off macOS, fieldd cannot say whose code it is itself,
  // which is the same refusal with `codesign` asked once or never.
  //
  // That a floor which DOES verify is written one line and no more is native-bootstrap.test.ts's, with a fake child;
  // under the real entry that half waits for a signed build.
  it.skipIf(process.platform === "win32")(
    "sealed, a floor that is not ours is written nothing and the boot fails by name",
    async () => {
      const scratch = shortTmpRoot("vf-cust-floor-");
      cleanup.push(() => removeTempRoot(scratch));
      const userRoot = join(scratch, "vf", ...LAYOUT.USERS_DIR, "1");
      mkdirSync(join(userRoot, ...LAYOUT.NATIVE_RUN_DIR), { recursive: true });
      const pairing = "d7".repeat(32);
      const floor = standInFloor(scratch);

      const run = runFieldd(
        [],
        {
          FIELDD_USER_ROOT: userRoot,
          FIELDD_USER_ID: USER,
          FIELDD_NATIVE_BIN: floor.bin,
          [CUSTODY.ENV]: CUSTODY.STDIN,
        },
        "pipe",
        scratch,
      );
      run.child.stdin?.end(line({ ...HANDOFF, pairing }));

      // the boot ends by itself: it does not wait out the readiness of a floor it refused
      const exit = await exitWithin(run.child, 60_000);
      // the claim first: not a byte reached the stand-in, as it read or at its stdin's end
      expect(floor.heard()).toBe("");
      expect(floor.birth()?.stdin ?? "").toBe("");
      // a child WAS spawned and judged (a spawn that made no process says `no-child`), and the boot failed on it
      expect(exit, run.stderr()).toMatchObject({ code: 1, timedOut: false });
      expect(run.stderr()).toContain(
        "fieldd failed to start: the native floor was not handed its pairing (child-not-ours)",
      );
      expect(run.stdout()).not.toContain('"ready":true');
      expect(existsSync(productPath(userRoot))).toBe(false);
      // it was ended, by the pid fieldd spawned, and a boot that failed asked for no second floor
      const gone = await until(
        () => {
          return floor.pids().some(alive) ? null : true;
        },
        "the refused floor's end",
        10_000,
      );
      expect(gone).toBe(true);
      expect(floor.pids().length).toBeLessThanOrEqual(1);
      for (const said of [run.stdout(), run.stderr()]) expect(said).not.toContain(pairing);
    },
    120_000,
  );

  // A GUARD, not a red row: at `files` nobody asks whose code the floor is, and nothing is handed. The same stand-in
  // a sealed fieldd refuses is spawned as the floor always was (its stdin ignored, no flag), is left alive, and once
  // a floor answers at its endpoint the boot comes up on it. `bin.ts` makes its verifier only from a hand-off, so
  // without one trust is never loaded and neither of its two questions is asked: had either been, this stand-in
  // would have been refused as the row above refuses it.
  it.skipIf(process.platform === "win32")(
    "handed nothing, the floor is spawned as it always was: no pipe, no flag, and nobody asks whose code it is",
    async () => {
      const scratch = shortTmpRoot("vf-cust-files-");
      cleanup.push(() => removeTempRoot(scratch));
      const userRoot = join(scratch, "vf", ...LAYOUT.USERS_DIR, "1");
      mkdirSync(join(userRoot, ...LAYOUT.NATIVE_RUN_DIR), { recursive: true });
      const floor = standInFloor(scratch);

      const run = runFieldd(
        [],
        { FIELDD_USER_ROOT: userRoot, FIELDD_USER_ID: USER, FIELDD_NATIVE_BIN: floor.bin },
        "ignore",
        scratch,
      );
      const born = await until(
        () => {
          if (run.child.exitCode !== null)
            throw new Error(`fieldd exited ${run.child.exitCode}: ${run.stderr()}`);
          return floor.birth();
        },
        "the floor's account of its birth",
        60_000,
      );
      // born with nothing: no flag, a stdin that is nobody's (it ended at once, empty), the composition every floor gets
      expect(born).toMatchObject({ flag: null, stdin: "", args: [], dataDir: userRoot });

      // the floor comes up as field-native does at `files`: its pairing file, then its endpoint
      writeFileSync(join(userRoot, ...LAYOUT.PAIRING_FILE), HANDED.pairing);
      const mock = new MockMgmtServer(nativeEndpoint(userRoot, SOCKETS.MGMT));
      mock.pairingSecretHex = HANDED.pairing;
      await mock.start();
      cleanup.push(() => mock.stop());
      const ready = await until(
        () => {
          if (run.child.exitCode !== null)
            throw new Error(`fieldd exited ${run.child.exitCode}: ${run.stderr()}`);
          return run.stdout().includes('"ready":true') ? true : null;
        },
        "fieldd's ready line",
        90_000,
      );
      expect(ready).toBe(true);
      // nobody ended it: the stand-in is the floor of record, and alive
      expect(alive(born.pid)).toBe(true);
      expect(readProduct(userRoot)).toMatchObject({ custody: "files", nativePid: born.pid });
      // fieldd goes first, while its floor still answers: a fieldd that lost its floor would spawn another
      run.child.kill("SIGTERM");
      expect(await exitWithin(run.child, 30_000), run.stderr()).toMatchObject({
        code: 0,
        timedOut: false,
      });
    },
    180_000,
  );

  it("the flag set and no valid hand-off is a refusal to boot: one line that names no secret, no root, no fall back", async () => {
    const refusals: Array<{ what: string; stdin: "pipe" | "ignore"; write?: string }> = [
      // nobody at the other end
      { what: "stdin closed", stdin: "ignore" },
      // a pipe closed with nothing on it
      { what: "an empty pipe", stdin: "pipe", write: "" },
      { what: "a line that is no hand-off", stdin: "pipe", write: "not a hand-off\n" },
      // whole but for its version: every secret in it is real to the refusal
      { what: "another version's hand-off", stdin: "pipe", write: line({ ...HANDOFF, v: 2 }) },
    ];
    for (const { what, stdin, write } of refusals) {
      const scratch = shortTmpRoot("vf-cust-no-");
      cleanup.push(() => removeTempRoot(scratch));
      // the root a boot would mint: a refused one never does
      const root = join(scratch, "vf");
      const run = runFieldd(
        [],
        { FIELDD_DATA_DIR: root, [CUSTODY.ENV]: CUSTODY.STDIN },
        stdin,
        scratch,
      );
      if (write !== undefined) run.child.stdin?.end(write);
      // a fieldd that read no flag would wait out its floor (10 s) before it failed: past that, it is stopped
      const exit = await exitWithin(run.child, 25_000);

      expect(exit, `${what}: ${run.stderr()}`).toMatchObject({ code: 1, timedOut: false });
      const said = run.stderr().trim();
      expect(said, what).toMatch(/^fieldd failed to start: .*FIELDD_CUSTODY/);
      expect(said.split("\n"), what).toHaveLength(1);
      for (const secret of [HANDED.shell, HANDED.pairing, HANDED.records])
        expect(said, what).not.toContain(secret);
      expect(run.stdout(), what).not.toMatch(/"ready":true/);
      expect(existsSync(root), `${what}: the refused boot minted no root`).toBe(false);
    }
  }, 180_000);

  // A GUARD, not a red row: a role has never read stdin, and the flag does not make it. Only the daemon is handed
  // custody; its workers and the agents' launcher run under the same executable with the same environment.
  it("no role waits for a hand-off: the flag is the daemon's alone", async () => {
    for (const arg of ["a-script.js", "--vibefield-role=not-a-role"]) {
      const scratch = shortTmpRoot("vf-cust-role-");
      cleanup.push(() => removeTempRoot(scratch));
      const root = join(scratch, "vf");
      // a pipe held open and never written: a reader of it would wait out HANDOFF_WAIT_MS and leave 1, not 127
      const run = runFieldd(
        [arg],
        { FIELDD_DATA_DIR: root, [CUSTODY.ENV]: CUSTODY.STDIN },
        "pipe",
        scratch,
      );
      const exit = await exitWithin(run.child, 20_000);
      expect(exit, `${arg}: ${run.stderr()}`).toMatchObject({ code: 127, timedOut: false });
      expect(run.stderr(), arg).not.toMatch(/FIELDD_CUSTODY/);
      expect(existsSync(root), arg).toBe(false);
    }
  }, 120_000);
});
