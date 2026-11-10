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

/** fieldd's bundle under this Node, in an environment that names nothing of the machine's. `nodeArgs` are Node's own
 * (before the bundle): only `codesignSays` hands any, and nothing of them reaches `process.argv`. */
function runFieldd(
  args: string[],
  env: Record<string, string>,
  stdin: "pipe" | "ignore",
  scratch: string,
  nodeArgs: string[] = [],
): Running {
  const home = join(scratch, "home");
  const agents = join(scratch, "agents");
  const logs = join(scratch, "logs");
  for (const dir of [home, agents, logs]) mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, [...nodeArgs, bin, ...args], {
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
    // and asks about no child), holding the handed secret and checking each hello's MAC under it: a ready fieldd is
    // one that paired from its hand-off. (§2.4 "v0.21": a fieldd handed custody asks whose code IT is when it makes
    // its verifier, child or no child. Nothing is stood in for here, so that one question goes to the machine's own
    // tool, about this row's own process, and nothing in this row rests on the answer.)
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
    /** when the first piece of its stdin arrived (`Date.now()`), or null when none did */
    heardAt: number | null;
    secretInEnv: boolean;
    secretInArgv: boolean;
  }

  /** A stand-in for field-native: a script that writes down its pid at once, each piece of its stdin as it arrives
   * and, at its stdin's end, how it was born (its flag, its arguments, the whole of its stdin), then stays. It is no
   * floor: nothing of it listens, and on no host is it signed as the floor is. fieldd may spawn it more than once (a
   * respawn): each writes its own account, and the row's cleanup ends each one by the pid it wrote down. */
  function standInFloor(scratch: string): {
    bin: string;
    /** the pid of each stand-in spawned, in the order they started */
    pids: () => number[];
    /** everything any of them has read of its stdin so far: what one ended before its stdin's end still leaves */
    heard: () => string;
    /** each one's account of its birth, in the order they started; one that did not live to its stdin's end has none */
    births: () => FloorBirth[];
  } {
    const bornFile = (pid: number): string => join(scratch, `floor-born.${pid}.json`);
    const floorPids = join(scratch, "floor.pids");
    const floorHeard = join(scratch, "floor.heard");
    const bin = join(scratch, "field-native");
    writeFileSync(
      bin,
      `#!${process.execPath}
"use strict";
const fs = require("node:fs");
const born = require("node:path").join(${JSON.stringify(scratch)}, "floor-born." + process.pid + ".json");
fs.appendFileSync(${JSON.stringify(floorPids)}, process.pid + "\\n");
// a stand-in nobody ended ends itself
setTimeout(() => process.exit(0), 150_000);
let stdin = "";
let heardAt = null;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  heardAt ??= Date.now();
  stdin += chunk;
  fs.appendFileSync(${JSON.stringify(floorHeard)}, chunk);
});
process.stdin.on("end", () => {
  let secret = null;
  try {
    secret = JSON.parse(stdin).pairing;
  } catch {}
  const holds = (text) => typeof secret === "string" && String(text).includes(secret);
  fs.writeFileSync(
    born,
    JSON.stringify({
      pid: process.pid,
      args: process.argv.slice(2),
      flag: process.env.FIELD_NATIVE_CUSTODY ?? null,
      dataDir: process.env.FIELD_NATIVE_DATA_DIR ?? null,
      stdin,
      heardAt,
      secretInEnv: Object.values(process.env).some(holds),
      secretInArgv: process.argv.some(holds),
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
    const births = (): FloorBirth[] => {
      const found: FloorBirth[] = [];
      for (const pid of pids()) {
        if (!existsSync(bornFile(pid))) continue;
        try {
          found.push(JSON.parse(readFileSync(bornFile(pid), "utf8")) as FloorBirth);
        } catch {
          // half written
        }
      }
      return found;
    };
    return { bin, pids, heard, births };
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

  /** Whose code a process is, as the stand-in for `codesign` below is made to say it. `team: null` is ad-hoc. */
  interface SaidOfCode {
    identifier: string;
    team: string | null;
    hardened: boolean;
  }

  /** What `codesign` is made to say: of fieldd itself, and of any other pid it is asked about (the floor fieldd
   * spawned). `null` is code that is not signed at all. */
  interface CodesignSays {
    own: SaidOfCode | null;
    child: SaidOfCode | null;
  }

  /** One question fieldd put to `codesign`: its arguments, whether it was about fieldd itself, and when. */
  interface AskedOfCodesign {
    args: string[];
    own: boolean;
    at: number;
  }

  /** A stand-in for `/usr/bin/codesign` INSIDE the fieldd a row starts, and nowhere else: a script the row hands
   * Node as `--require`, so it is loaded before fieldd's bundle and answers `execFile` for that one file. It sits
   * BELOW `@vibefield/trust` (CUSTODY-SPEC §2.4 "v0.15": a row "may replace only what sits below the binding (the
   * `codesign` tool trust runs)"): fieldd's entry, its verifier and trust's own two questions all run as they are.
   * It answers the two invocations trust makes, in the words codesign's manual gives them, from what the row says
   * of the two processes, and it writes every question down.
   *
   * It is no seam of production's: fieldd reads no variable for it, and trust names the tool by its absolute path. */
  function codesignSays(
    scratch: string,
    said: CodesignSays,
  ): { nodeArgs: string[]; asked: () => AskedOfCodesign[] } {
    const preload = join(scratch, "codesign-says.cjs");
    const log = join(scratch, "codesign.asked");
    writeFileSync(
      preload,
      `"use strict";
const fs = require("node:fs");
const util = require("node:util");
const childProcess = require("node:child_process");
const real = childProcess.execFile;
const said = ${JSON.stringify(said)};
const NL = String.fromCharCode(10);
// codesign --display --verbose=4 +pid: the words go to stderr
function displayed(who, target) {
  if (who === null) {
    return { code: 1, stdout: "", stderr: target + ": code object is not signed at all" + NL };
  }
  const flags = who.hardened ? "0x10000(runtime)" : "0x0(none)";
  const lines = [
    "Executable=/a/place/" + who.identifier,
    "Identifier=" + who.identifier,
    "CodeDirectory v=20500 size=1024 flags=" + flags + " hashes=20+7 location=embedded",
    "TeamIdentifier=" + (who.team === null ? "not set" : who.team),
  ];
  return { code: 0, stdout: "", stderr: lines.join(NL) + NL };
}
// codesign --verify -R <requirement> +pid: 0 when the code at that pid meets the requirement
function verified(who, requirement) {
  const meets =
    who !== null &&
    who.team !== null &&
    requirement ===
      [
        '=identifier "' + who.identifier + '"',
        "anchor apple generic",
        'certificate leaf[subject.OU] = "' + who.team + '"',
      ].join(" and ");
  if (meets) return { code: 0, stdout: "", stderr: "" };
  const why = "test-requirement: code failed to satisfy specified code requirement(s)";
  return { code: 3, stdout: "", stderr: why + NL };
}
function execFile(file, args, options, callback) {
  if (file !== "/usr/bin/codesign") return real.apply(this, arguments);
  const target = String(args[args.length - 1]);
  const own = target === "+" + process.pid;
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, own, at: Date.now() }) + NL);
  const who = own ? said.own : said.child;
  let answer = { code: 2, stdout: "", stderr: "usage" + NL };
  if (args[0] === "--display") answer = displayed(who, target);
  if (args[0] === "--verify" && args[1] === "-R") answer = verified(who, args[2]);
  const failed = Object.assign(new Error("codesign left " + answer.code), { code: answer.code });
  setImmediate(() => callback(answer.code === 0 ? null : failed, answer.stdout, answer.stderr));
  return undefined;
}
// whoever promisifies execFile gets the real one's promise form, as they would without this file
Object.defineProperty(execFile, util.promisify.custom, { value: real[util.promisify.custom] });
childProcess.execFile = execFile;
`,
    );
    const asked = (): AskedOfCodesign[] => {
      if (!existsSync(log)) return [];
      const written = readFileSync(log, "utf8").split("\n");
      return written.filter(Boolean).map((row) => JSON.parse(row) as AskedOfCodesign);
    };
    return { nodeArgs: ["--require", preload], asked };
  }

  /** A question in two words: what was asked, and of whom. */
  const kindOf = (one: AskedOfCodesign): string => {
    const what = one.args[0] === "--verify" ? "verify" : "display";
    return `${what} ${one.own ? "own" : "child"}`;
  };

  const TEAM = "ABCDE12345";
  /** a signed release's two daemons as its signer names them: each by its file name (trust's code-identity.ts).
   * Written out here, not taken from trust: these are what the binaries ARE, and trust's constant is what is asked */
  const OUR_FIELDD: SaidOfCode = { identifier: "fieldd", team: TEAM, hardened: true };
  const OUR_FLOOR: SaidOfCode = { identifier: "field-native", team: TEAM, hardened: true };
  /** a signed fieldd whose child is the signed floor: everything verifies */
  const VERIFIES: CodesignSays = { own: OUR_FIELDD, child: OUR_FLOOR };
  /** the requirement a fieldd of that team puts to codesign about its floor: WHICH binary, then WHOSE */
  const FLOOR_REQUIREMENT = [
    '=identifier "field-native"',
    "anchor apple generic",
    `certificate leaf[subject.OU] = "${TEAM}"`,
  ].join(" and ");
  /** the floor's pairing these rows hand: not the harness's, so a row can tell it from everything else handed */
  const FLOOR_PAIRING = "d7".repeat(32);

  /** A fieldd handed custody whose floor is the stand-in. `said` is what `codesign` is made to say of the two; with
   * none, NOTHING is replaced and the tool is the machine's own. */
  function sealedOnStandIn(said?: CodesignSays): {
    userRoot: string;
    floor: ReturnType<typeof standInFloor>;
    asked: () => AskedOfCodesign[];
    run: Running;
  } {
    const scratch = shortTmpRoot("vf-cust-floor-");
    cleanup.push(() => removeTempRoot(scratch));
    const userRoot = join(scratch, "vf", ...LAYOUT.USERS_DIR, "1");
    mkdirSync(join(userRoot, ...LAYOUT.NATIVE_RUN_DIR), { recursive: true });
    const floor = standInFloor(scratch);
    const codesign = said === undefined ? undefined : codesignSays(scratch, said);
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
      codesign?.nodeArgs,
    );
    run.child.stdin?.end(line({ ...HANDOFF, pairing: FLOOR_PAIRING }));
    return { userRoot, floor, asked: codesign?.asked ?? (() => []), run };
  }

  /** The first stand-in's account of its birth, or fieldd's exit said as the failure it is. */
  function bornOf(run: Running, floor: ReturnType<typeof standInFloor>): Promise<FloorBirth> {
    return until(
      () => {
        if (run.child.exitCode !== null)
          throw new Error(`fieldd exited ${run.child.exitCode}: ${run.stderr()}`);
        return floor.births()[0] ?? null;
      },
      "the floor's account of its birth",
      60_000,
    );
  }

  /** fieldd's ready line, or its exit said as the failure it is. */
  function readyOf(run: Running): Promise<boolean> {
    return until(
      () => {
        if (run.child.exitCode !== null)
          throw new Error(`fieldd exited ${run.child.exitCode}: ${run.stderr()}`);
        return run.stdout().includes('"ready":true') ? true : null;
      },
      "fieldd's ready line",
      90_000,
    );
  }

  /** The floor proper, for a boot whose stand-in was handed its line: the mock at the endpoint, holding `secret` and
   * checking each hello's MAC under it, so a ready fieldd is one that paired from its hand-off. */
  async function mockFloor(userRoot: string, secret: string): Promise<MockMgmtServer> {
    const mock = new MockMgmtServer(nativeEndpoint(userRoot, SOCKETS.MGMT));
    mock.pairingSecretHex = secret;
    mock.verifyClientMac = true;
    await mock.start();
    cleanup.push(() => mock.stop());
    return mock;
  }

  /** A boot that refused its floor: not a byte reached the stand-in, the boot failed by name, the stand-in is ended. */
  async function expectFloorRefused(
    booted: ReturnType<typeof sealedOnStandIn>,
    what: string,
  ): Promise<void> {
    const { userRoot, floor, run } = booted;
    // the boot ends by itself: it does not wait out the readiness of a floor it refused
    const exit = await exitWithin(run.child, 60_000);
    // the claim first: not a byte reached the stand-in, as it read or at its stdin's end
    expect(floor.heard(), what).toBe("");
    for (const born of floor.births()) expect(born.stdin, what).toBe("");
    // a child WAS spawned and judged (a spawn that made no process says `no-child`), and the boot failed on it
    expect(exit, `${what}: ${run.stderr()}`).toMatchObject({ code: 1, timedOut: false });
    expect(run.stderr(), what).toContain(
      "fieldd failed to start: the native floor was not handed its pairing (child-not-ours)",
    );
    expect(run.stdout(), what).not.toContain('"ready":true');
    expect(existsSync(productPath(userRoot)), what).toBe(false);
    // it was ended, by the pid fieldd spawned, and a boot that failed asked for no second floor
    const gone = await until(
      () => {
        return floor.pids().some(alive) ? null : true;
      },
      `${what}: the refused floor's end`,
      10_000,
    );
    expect(gone, what).toBe(true);
    expect(floor.pids().length, what).toBeLessThanOrEqual(1);
    for (const stream of [run.stdout(), run.stderr()])
      expect(stream, what).not.toContain(FLOOR_PAIRING);
  }

  // C3 and C6 under the real entry (CUSTODY-SPEC §2.4 "v0.15"; the PM's rule of v0.18: a seam's rows go through the
  // real composition root, nothing injected at the seam). Every row from here to the `files` guard is fieldd's own
  // entry, bundled as its build bundles it and run as a process, with NO verifier handed in: what asks is `bin.ts`'s
  // own wiring, fieldd's verifier and trust's two questions. A fieldd handed custody asks whose code its floor is
  // BEFORE it writes the floor anything, always with the floor's signing identifier, and a floor that does not
  // verify is written nothing, is ended, and fails the boot. Never an unverified hand. The floor is a stand-in
  // script, which on no host is the floor.

  // THE row with nothing replaced at all, not even the tool. What it meets depends on the Node it runs under, and
  // it cannot say which. On macOS under a Node a team signed for the hardened runtime, fieldd's own identity is that
  // team's and so is the stand-in's, which is the same Node: what refuses it is the floor's identifier and nothing
  // else, asked of the machine's `/usr/bin/codesign` (display and verify of the row's own two processes, no more).
  // Under any other Node, and off macOS, fieldd cannot say whose code it is itself, which is the same refusal with
  // `codesign` asked once or never.
  it.skipIf(process.platform === "win32")(
    "sealed, a floor that is not ours is written nothing and the boot fails by name",
    async () => {
      await expectFloorRefused(sealedOnStandIn(), "the machine's own codesign");
    },
    120_000,
  );

  // From here the tool below trust is stood in for (`codesignSays`), and nothing else: what a signed build would
  // answer cannot be had on a host with no signed build. These rows are macOS's: off it, trust says "not macOS"
  // before it runs any tool, which is trust's own word and not replaced.

  it.skipIf(process.platform !== "darwin")(
    "sealed, a floor that verifies is asked about first, then handed ONE line on a pipe, and fieldd pairs with no file",
    async () => {
      const { userRoot, floor, asked, run } = sealedOnStandIn(VERIFIES);
      const born = await bornOf(run, floor);
      // the flag, and ONE line on a stdin that then ended (the stand-in writes its account only at its stdin's end)
      expect(born.flag).toBe(CUSTODY.STDIN);
      expect(born.stdin).toBe(line({ v: 1, pairing: FLOOR_PAIRING }));
      // nothing of the secret anywhere else it was born with, and the composition every floor gets
      expect(born).toMatchObject({
        args: [],
        dataDir: userRoot,
        secretInEnv: false,
        secretInArgv: false,
      });

      // asked about before it was written to: whose code fieldd is itself; then WHICH binary and WHOSE the child is,
      // by the pid fieldd spawned; then whether it runs hardened
      const questions = asked();
      expect(questions.map(kindOf)).toEqual(["display own", "verify child", "display child"]);
      expect(questions[1]?.args).toEqual(["--verify", "-R", FLOOR_REQUIREMENT, `+${born.pid}`]);
      expect(questions[2]?.args[2]).toBe(`+${born.pid}`);
      // and the last of them was put before the first byte arrived
      const lastAsked = questions[2]?.at ?? Number.POSITIVE_INFINITY;
      expect(born.heardAt).toBeGreaterThanOrEqual(lastAsked);

      // the floor is up: fieldd pairs under the handed secret, with no pairing file anywhere on the root
      const mock = await mockFloor(userRoot, FLOOR_PAIRING);
      expect(await readyOf(run)).toBe(true);
      expect(mock.refusedHellos).toBe(0);
      expect(existsSync(join(userRoot, ...LAYOUT.PAIRING_FILE))).toBe(false);
      // the floor it spawned is the floor of record
      expect(readProduct(userRoot)).toMatchObject({ custody: "sealed", nativePid: born.pid });
      expect(run.stderr()).not.toContain(FLOOR_PAIRING);
      // fieldd goes first, while its floor still answers: a fieldd that lost its floor would spawn another
      run.child.kill("SIGTERM");
      expect(await exitWithin(run.child, 30_000), run.stderr()).toMatchObject({
        code: 0,
        timedOut: false,
      });
    },
    180_000,
  );

  it.skipIf(process.platform !== "darwin")(
    "sealed, the identifier asked for is the floor's: whatever else stands in the floor's place is written nothing",
    async () => {
      const notTheFloor: Array<{ what: string; child: SaidOfCode | null; asked: string[] }> = [
        {
          // "our team, hardened" is true of every binary the team signs: only one of them is the floor
          what: "another of the team's binaries",
          child: { ...OUR_FLOOR, identifier: "fieldd" },
          asked: ["display own", "verify child"],
        },
        {
          what: "the floor's name under another team",
          child: { ...OUR_FLOOR, team: "ZYXWV98765" },
          asked: ["display own", "verify child"],
        },
        {
          what: "the floor, not under the hardened runtime",
          child: { ...OUR_FLOOR, hardened: false },
          asked: ["display own", "verify child", "display child"],
        },
        { what: "code not signed at all", child: null, asked: ["display own", "verify child"] },
      ];
      for (const { what, child, asked: expected } of notTheFloor) {
        const booted = sealedOnStandIn({ own: OUR_FIELDD, child });
        await expectFloorRefused(booted, what);
        const questions = booted.asked();
        expect(questions.map(kindOf), what).toEqual(expected);
        // what was asked is the same whoever stands there: the floor's identifier, under fieldd's own team
        const put = questions[1]?.args.slice(0, 3);
        expect(put, what).toEqual(["--verify", "-R", FLOOR_REQUIREMENT]);
      }
    },
    300_000,
  );

  it.skipIf(process.platform !== "darwin")(
    "sealed, a fieldd that cannot say whose code it is refuses its floor and asks nothing about it",
    async () => {
      // ad-hoc, as the app installed on this Mac is: `TeamIdentifier=not set`
      const adHoc: SaidOfCode = { identifier: "fieldd", team: null, hardened: false };
      const booted = sealedOnStandIn({ own: adHoc, child: OUR_FLOOR });
      await expectFloorRefused(booted, "an ad-hoc fieldd");
      // one question, about itself. The child, which WOULD verify, is never asked about: no unverified hand, and
      // no fall back to the file (the root has none, and the boot failed)
      expect(booted.asked().map(kindOf)).toEqual(["display own"]);
    },
    120_000,
  );

  it.skipIf(process.platform !== "darwin")(
    "sealed, a respawn is verified too: the same questions of the new child, and fieldd's own identity asked once",
    async () => {
      const { userRoot, floor, asked, run } = sealedOnStandIn(VERIFIES);
      const first = await bornOf(run, floor);
      const mock = await mockFloor(userRoot, FLOOR_PAIRING);
      expect(await readyOf(run)).toBe(true);

      // the floor goes: its endpoint closes, the link's redials fail, and fieldd spawns another (TC-D1), through
      // the one spawn the boot used
      await mock.stop();
      const second = await until(
        () => {
          if (run.child.exitCode !== null)
            throw new Error(`fieldd exited ${run.child.exitCode}: ${run.stderr()}`);
          return floor.births().find((one) => one.pid !== first.pid) ?? null;
        },
        "the respawned floor's account of its birth",
        90_000,
      );
      // handed as the first was: the flag and the one line
      expect(second.flag).toBe(CUSTODY.STDIN);
      expect(second.stdin).toBe(line({ v: 1, pairing: FLOOR_PAIRING }));
      // after it was asked about, by its own pid, with the floor's requirement
      const verifies = asked().filter((one) => kindOf(one) === "verify child");
      const targets = verifies.map((one) => one.args[3]);
      expect(targets.slice(0, 2)).toEqual([`+${first.pid}`, `+${second.pid}`]);
      for (const one of verifies) expect(one.args[2]).toBe(FLOOR_REQUIREMENT);
      // whose code fieldd is itself was asked once, when the verifier was made, and never again
      expect(asked().filter((one) => one.own)).toHaveLength(1);
      // no floor answers now, so fieldd goes on respawning inside its bound: the row's cleanup stops fieldd, then
      // every stand-in by the pid it wrote down
    },
    240_000,
  );

  // §2.4 "v0.21", item 3 — fieldd asks whose code IT is when it makes its verifier, before any floor is spawned, so
  // that the one budget a hand has (`CUSTODY.CHILD_CHECK_BUDGET_MS`) is spent on the child's check alone. Seen here
  // where NO floor is spawned at all: the floor is the mock, alive before the boot. Asked at its first child, as it
  // was before, this fieldd would have asked nothing.
  it.skipIf(process.platform !== "darwin")(
    "sealed, fieldd asks whose code it is itself when it makes its verifier, before any floor is spawned: on a floor already alive it asks that once, and about no child",
    async () => {
      const scratch = shortTmpRoot("vf-cust-own-");
      cleanup.push(() => removeTempRoot(scratch));
      const userRoot = join(scratch, "vf", ...LAYOUT.USERS_DIR, "1");
      mkdirSync(join(userRoot, ...LAYOUT.NATIVE_RUN_DIR), { recursive: true });
      const mock = await mockFloor(userRoot, HANDED.pairing);
      const codesign = codesignSays(scratch, VERIFIES);
      const run = runFieldd(
        [],
        { FIELDD_USER_ROOT: userRoot, FIELDD_USER_ID: USER, [CUSTODY.ENV]: CUSTODY.STDIN },
        "pipe",
        scratch,
        codesign.nodeArgs,
      );
      run.child.stdin?.end(line(HANDOFF));
      expect(await readyOf(run)).toBe(true);
      // it paired with the floor that was there, and spawned none
      expect(mock.refusedHellos).toBe(0);
      expect(codesign.asked().map(kindOf)).toEqual(["display own"]);
      run.child.kill("SIGTERM");
      expect(await exitWithin(run.child, 30_000), run.stderr()).toMatchObject({
        code: 0,
        timedOut: false,
      });
    },
    180_000,
  );

  // A GUARD, not a red row: at `files` nobody asks whose code the floor is, and nothing is handed. The same stand-in
  // a sealed fieldd refuses is spawned as the floor always was (its stdin ignored, no flag), is left alive, and once
  // a floor answers at its endpoint the boot comes up on it. `bin.ts` makes its verifier only from a hand-off, so
  // without one trust is never loaded and neither of its two questions is asked. `codesign` is stood in for here
  // too, with answers that would verify anything, only to count: it is never run.
  it.skipIf(process.platform === "win32")(
    "handed nothing, the floor is spawned as it always was: no pipe, no flag, and nobody asks whose code it is",
    async () => {
      const scratch = shortTmpRoot("vf-cust-files-");
      cleanup.push(() => removeTempRoot(scratch));
      const userRoot = join(scratch, "vf", ...LAYOUT.USERS_DIR, "1");
      mkdirSync(join(userRoot, ...LAYOUT.NATIVE_RUN_DIR), { recursive: true });
      const floor = standInFloor(scratch);
      const codesign = codesignSays(scratch, VERIFIES);

      const run = runFieldd(
        [],
        { FIELDD_USER_ROOT: userRoot, FIELDD_USER_ID: USER, FIELDD_NATIVE_BIN: floor.bin },
        "ignore",
        scratch,
        codesign.nodeArgs,
      );
      const born = await bornOf(run, floor);
      // born with nothing: no flag, a stdin that is nobody's (it ended at once, empty), the composition every floor gets
      expect(born).toMatchObject({ flag: null, stdin: "", args: [], dataDir: userRoot });

      // the floor comes up as field-native does at `files`: its pairing file, then its endpoint
      writeFileSync(join(userRoot, ...LAYOUT.PAIRING_FILE), HANDED.pairing);
      const mock = new MockMgmtServer(nativeEndpoint(userRoot, SOCKETS.MGMT));
      mock.pairingSecretHex = HANDED.pairing;
      await mock.start();
      cleanup.push(() => mock.stop());
      expect(await readyOf(run)).toBe(true);
      // nobody ended it: the stand-in is the floor of record, and alive
      expect(alive(born.pid)).toBe(true);
      expect(readProduct(userRoot)).toMatchObject({ custody: "files", nativePid: born.pid });
      // and nobody asked whose code anything is: not fieldd's own, not the child's
      expect(codesign.asked()).toEqual([]);
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
