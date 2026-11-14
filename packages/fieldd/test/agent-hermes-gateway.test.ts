// Item 278 (V1) — HERMES'S GATEWAY AS fieldd STARTS IT (puppeteer 0.4.1's #80, carried by the EL8 to 0.4.2). Since
// 0.4.1 the gateway runs the Python the `hermes` wrapper names (found on the launch's PATH), else fieldd's own
// HERMES_PYTHON; with neither it starts nothing and refuses INTERPRETER_UNAVAILABLE, which fieldd says in DESIGN.md
// §9's words (James's A on j-278-hermes-words, 2026-11-13 00:36:05Z). On darwin and linux the gateway's script runs
// as `-I -B -c <source>`: no file, bundled or not (so item 278's plan's bundled half proves nothing more and is
// dropped, VF-PM 2026-11-13 00:54Z).
//
// Nothing of the host is reached. fieldd's real built-in providers run, but Hermes is pinned to this row's wrapper
// (PUPPETEER_HERMES_BIN), claude and codex to the runtime suite's stand-ins, and HERMES_PYTHON and HERMES_HOME are
// taken out of this process's environment for the row and put back after. No inventory door is called, so no
// Homebrew prefix is probed (puppeteer's spawn reaches no inventory). The row's own `bin` leads PATH, so a bare
// `python3` is this row's stub too. Each stub writes one line per run, by SHAPE, and its environment by NAMES; never
// a value. So no red can print an environment. A mock floor serves: the gateway starts before any terminal is born
// (adapter-hermes `prepareHermesTuiSession`).
import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LAYOUT, SOCKETS } from "@vibefield/contracts";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import type { SecretStore } from "../src/plugin-settings";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, WsRpc } from "./ws-rpc";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const FAKE_ROSETTAD = join(FIXTURES, "fake-rosettad.mjs");
const FAKE_CLAUDE = join(FIXTURES, "fake-claude");

/** What this row moves in its own process, each read once at load: only whether it was set, and whether it is the
 * same again, ever leaves this file (never a value). */
const MOVED = ["HERMES_PYTHON", "HERMES_HOME", "PUPPETEER_HERMES_BIN", "PATH", "TMPDIR"] as const;
const AT_LOAD = new Map(MOVED.map((name) => [name, process.env[name]]));
const CANARIES = ["FIELDD_ROW_278_CANARY", "FIELD_ROW_278_CANARY"] as const;

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});
// a red cannot leave the worker changed: each name this row moved is as it was, present or absent
afterAll(() => {
  for (const name of MOVED) {
    const before = AT_LOAD.get(name);
    expect(name in process.env, `${name} is present as it was`).toBe(before !== undefined);
    expect(process.env[name] === before, `${name} is as it was`).toBe(true);
  }
  for (const name of CANARIES) expect(name in process.env, `${name} is gone`).toBe(false);
});

/** Set (or, `undefined`, delete) a variable for this row, put back by the row's cleanup. */
function moveEnv(name: string, value: string | undefined): void {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  cleanup.push(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

/** A stub interpreter: one line per run in `runs`, by shape alone, and its environment's NAMES in `names`. */
function stubInterpreter(path: string, who: string, root: string): void {
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      "# item 278's row: a stub interpreter. Shapes and names only, never a value.",
      'lead=other; if [ "$1" = -I ] && [ "$2" = -B ] && [ "$3" = -c ]; then lead=gateway; fi',
      'files=0; for arg in "$@"; do if [ -f "$arg" ]; then files=$((files + 1)); fi; done',
      `printf 'run who=${who} argc=%s lead=%s files=%s\\n' "$#" "$lead" "$files" >> '${join(root, "runs")}'`,
      `awk 'BEGIN { for (name in ENVIRON) print name }' >> '${join(root, `names-${who}`)}'`,
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
}

interface Row {
  root: string;
  bin: string;
  rowTmp: string;
  daemon: FielddDaemon;
  /** the `hermes` the launch resolves: a wrapper naming `<install>/venv/bin/python`, or a program naming none */
  hermes: (names: "a python" | "no python") => void;
  runs: () => string[];
  names: (who: string) => string[];
}

async function setup(): Promise<Row> {
  const root = mkdtempSync(join(tmpdir(), "vf-hermes-gw-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = join(root, ...LAYOUT.USERS_DIR, "1");
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const bin = join(root, "bin");
  const install = join(root, "install");
  const rowTmp = join(root, "tmp");
  for (const dir of [bin, join(install, "venv", "bin"), rowTmp])
    mkdirSync(dir, { recursive: true });
  copyFileSync(FAKE_CLAUDE, join(bin, "claude"));
  stubInterpreter(join(install, "venv", "bin", "python"), "wrapper-python", root);
  stubInterpreter(join(bin, "python3"), "python3", root);
  const hermes = join(bin, "hermes");
  moveEnv("PUPPETEER_CLAUDE_BIN", join(bin, "claude"));
  moveEnv("PUPPETEER_CODEX_BIN", join(bin, "no-real-codex"));
  moveEnv("FAKE_CLAUDE_STATE_DIR", bin);
  moveEnv("PUPPETEER_HERMES_BIN", hermes);
  moveEnv("HERMES_PYTHON", undefined);
  moveEnv("HERMES_HOME", undefined);
  moveEnv("PATH", `${bin}:${process.env["PATH"] ?? ""}`);
  moveEnv("TMPDIR", rowTmp);
  for (const name of CANARIES) moveEnv(name, "row-278");
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    rosettadBin: "/stand-in/rosettad",
    rosettadSpawn: ((_bin: string, args: readonly string[], options: object) =>
      spawn(process.execPath, [FAKE_ROSETTAD, ...args], {
        ...options,
        env: { ...process.env, FAKE_ROSETTAD_MODE: "ok" },
      })) as unknown as typeof spawn,
    rosettadHome: home,
    vibefieldRoot: root,
    agentSearchPath: bin,
    secretStore: memoryKeychain(),
  });
  cleanup.push(() => daemon.stop().catch(() => undefined));
  const lines = (path: string) =>
    existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
  return {
    root,
    bin,
    rowTmp,
    daemon,
    hermes: (names) => {
      const body =
        names === "a python"
          ? `exec "${join(install, "venv", "bin", "python")}" "${join(install, "hermes")}" "$@"`
          : "exit 0";
      writeFileSync(hermes, `#!/bin/sh\n${body}\n`);
      chmodSync(hermes, 0o755);
    },
    runs: () => lines(join(root, "runs")),
    names: (who) => lines(join(root, `names-${who}`)),
  };
}

/** A keychain in a map, so this row never writes the machine's. */
function memoryKeychain(): SecretStore {
  const entries = new Map<string, string>();
  return {
    get: async (service, account) => entries.get(`${service}/${account}`) ?? null,
    set: async (service, account, value) => {
      entries.set(`${service}/${account}`, value);
    },
    delete: async (service, account) => {
      entries.delete(`${service}/${account}`);
    },
  };
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

/** A renderer window token holding the launch door alone. */
async function launcher(daemon: FielddDaemon): Promise<WsRpc> {
  const shell = await openRpc(daemon.controlPort);
  await helloAs(shell, daemon.shellToken, "shell-main");
  const minted = (await shell.call("system.mintWindowToken", {
    scopes: ["agent.spawn"],
    label: "window-i278",
    rendererParticipant: {
      participantId: "renderer:desktop-test:window-i278",
      incarnation: "renderer:desktop-test:window-i278:document-1",
    },
  })) as { token: string };
  const win = await openRpc(daemon.controlPort);
  await helloAs(win, minted.token);
  return win;
}

describe("item 278 — Hermes's gateway as fieldd starts it", () => {
  it("runs the Python the hermes wrapper names, with no file, and hands it no daemon variable", async () => {
    const row = await setup();
    row.hermes("a python");
    const win = await launcher(row.daemon);
    // the stub exits 1, so the launch fails; what it ran, and how, is the row
    await win.callErr("agent.spawn", { provider: "hermes" });
    const runs = row.runs();
    const gateway = runs.filter(
      (run) => run.includes("who=wrapper-python") && run.includes("lead=gateway"),
    );
    // P1: the wrapper's interpreter, never a bare python3
    expect(gateway.length, "the wrapper's Python ran the gateway").toBe(1);
    expect(runs.filter((run) => run.includes("who=python3")).length, "a bare python3 ran").toBe(0);
    // P2: `-I -B -c`, and no argument names a file; nothing was written for the script
    expect(
      gateway.filter((run) => run.endsWith(" files=0")).length,
      "an argument named a file",
    ).toBe(1);
    const written = readdirSync(row.rowTmp).filter((name) =>
      name.startsWith("puppeteer-hermes-host-"),
    );
    expect(written.length, "a gateway script was written under TMPDIR").toBe(0);
    // EL7: no daemon variable, and none of the row's canaries, reaches the gateway (names alone are compared)
    const names = row.names("wrapper-python");
    expect(names.length > 0, "the stub recorded its environment's names").toBe(true);
    expect(names.filter((name) => /^FIELDD?_/u.test(name)).length, "FIELD_/FIELDD_ names").toBe(0);
    for (const canary of CANARIES) expect(names.includes(canary), canary).toBe(false);
  }, 30_000);

  it("refuses a Hermes whose install names no Python in DESIGN.md §9's words, and starts nothing", async () => {
    const row = await setup();
    row.hermes("no python");
    const win = await launcher(row.daemon);
    const refused = await win.callErr("agent.spawn", { provider: "hermes" });
    expect(refused.message).toBe(
      "VibeField can't find this Mac's Hermes install. Reinstall Hermes, then try again.",
    );
    expect(refused.message).not.toMatch(/exited|interpreter|wrapper|python/iu);
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    expect(refused.data?.details).toMatchObject({
      provider: "hermes",
      code: "AGENT_LAUNCH_REFUSED",
      refusal: "INTERPRETER_UNAVAILABLE",
      reason: "agent-install-missing",
    });
    expect(row.runs().length, "an interpreter was started").toBe(0);
  }, 30_000);
});
