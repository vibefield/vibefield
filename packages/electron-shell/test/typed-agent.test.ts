import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AGENT_CATALOG, AgentDistributionRecord, ENV_PREFIXES, LAYOUT } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  leakedVariables,
  personEnvironment,
  readTypedAgentCalls,
  stageTypedAgent,
  startupFilesRead,
  TYPED_AGENT_ID,
} from "../src/testing/typed-agent";

// AR-7 — the godview smoke's typed-agent fixture, its PURE and on-disk halves:
// what it stages before the pair boots (the machine record, the stub, the
// person), the person's environment, and the stub's own behaviour, run as the
// program it is. The Electron half — the product's window, its pair, a pane
// the name is typed into — runs as `pnpm smoke:godview`.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const made = mkdtempSync(join(tmpdir(), "vf-typed-"));
  roots.push(made);
  return made;
}

/** A process's life, from a spawn to its exit. */
function exited(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((done) => child.on("exit", (code) => done(code)));
}

describe("stageTypedAgent — the run's own root, before the pair boots", () => {
  it("names the stub as the typed agent's ACTIVE install, and an install that does not exist as every other agent's", () => {
    const vibefieldRoot = root();
    const staged = stageTypedAgent({ vibefieldRoot, source: {}, ownerHome: "/Users/owner" });
    const record = AgentDistributionRecord.parse(
      JSON.parse(
        readFileSync(join(vibefieldRoot, ...LAYOUT.MACHINE_DISTRIBUTION_FILE), "utf8"),
      ) as unknown,
    );
    expect(staged.agentId).toBe(TYPED_AGENT_ID);
    expect(record.providers[TYPED_AGENT_ID]?.activeExecutable).toBe(staged.stub);
    // the stub is a program: a shell, the shim and fieldd's probes run it
    expect(statSync(staged.stub).mode & 0o111).toBe(0o111);
    // every other agent the runtime composes: an install that is not there,
    // so nothing fieldd would start for it can start — not a vendor's binary
    const others = AGENT_CATALOG.filter(
      (row) => row.seams.puppeteer !== null && row.id !== TYPED_AGENT_ID,
    );
    expect(others.length).toBeGreaterThan(0);
    for (const row of others) {
      const install = record.providers[row.id]?.activeExecutable;
      expect(install, row.id).toBeDefined();
      expect(existsSync(install as string), row.id).toBe(false);
    }
    // the inventory searches the stub's directory and nothing else of the machine's
    expect(staged.environment["FIELDD_AGENT_SEARCH_PATH"]).toBe(dirname(staged.stub));
    expect(staged.environment["HOME"]).toBe(staged.person);
    expect(existsSync(staged.work)).toBe(true);
  });

  it("refuses a root that already holds a machine record: it stages only into one the run created", () => {
    const vibefieldRoot = root();
    stageTypedAgent({ vibefieldRoot, source: {}, ownerHome: "/Users/owner" });
    expect(() => stageTypedAgent({ vibefieldRoot, source: {}, ownerHome: "/Users/owner" })).toThrow(
      /only into a root this run created/,
    );
  });
});

describe("personEnvironment — the pair runs as the person", () => {
  it("leaves out what would make a shell look integrated or reach the owner, keeps PATH whole, and homes it in the person's HOME", () => {
    const environment = personEnvironment(
      {
        HOME: "/Users/owner",
        PATH: "/Users/owner/.nvm/bin:/usr/bin",
        ZDOTDIR: "/Users/owner/.config/zsh",
        HISTFILE: "/tmp/history",
        TERM_PROGRAM: "ghostty",
        TERM: "xterm-256color",
        PUPPETEER_SHIM_DIR: "/tmp/shims/bin",
        PUPPETEER_ANY_BIN: "/opt/agent",
        AGENT_CONFIG_ROOT: "/Users/owner/.agent",
        CACHE_DIRS: "/var/cache:/Users/owner/Library/Caches",
        TILDE: "~/notes",
        OWNERISH: "/Users/owner2/elsewhere",
        LANG: "en_US.UTF-8",
        TMPDIR: "/tmp",
        UNSET: undefined,
      },
      { ownerHome: "/Users/owner", personHome: "/tmp/run/person" },
    );
    expect(environment).toEqual({
      HOME: "/tmp/run/person",
      PATH: "/Users/owner/.nvm/bin:/usr/bin",
      TERM: "xterm-256color",
      OWNERISH: "/Users/owner2/elsewhere",
      LANG: "en_US.UTF-8",
      TMPDIR: "/tmp",
    });
  });
});

describe("the stub — the smoke's own stand-in, run as the program it is", () => {
  it("answers the launch's probes, and records its argv and its environment's NAMES — never a value", () => {
    const staged = stageTypedAgent({
      vibefieldRoot: root(),
      source: {},
      ownerHome: "/Users/owner",
    });
    const secret = `value-${process.pid}-never-recorded`;
    const version = execFileSync(staged.stub, ["--version"], {
      encoding: "utf8",
      env: { ...process.env, VF_TYPED_SECRET: secret },
    });
    // a version the launch's probe reads (`x.y.z`), and a banner that says what it is
    expect(version).toMatch(/^\d+\.\d+\.\d+\S* \(the godview smoke's typed-agent stub\)\n$/u);
    const help = execFileSync(staged.stub, ["--help"], { encoding: "utf8" });
    for (const flag of [
      "--session-id",
      "--settings",
      "--setting-sources",
      "--permission-mode",
      "--name",
      "--resume",
      "--model",
      "--effort",
    ]) {
      expect(help, flag).toContain(flag);
    }
    const calls = readTypedAgentCalls(staged.calls);
    expect(calls.map((call) => call.argv)).toEqual([["--version"], ["--help"]]);
    expect(calls[0]?.envKeys).toContain("VF_TYPED_SECRET");
    expect(calls[0]?.tty).toBe(false);
    expect(readFileSync(staged.calls, "utf8")).not.toContain(secret);
  });

  it("run as a managed session it stays at its prompt, and leaves at `exit`", async () => {
    const staged = stageTypedAgent({
      vibefieldRoot: root(),
      source: {},
      ownerHome: "/Users/owner",
    });
    const child = spawn(staged.stub, ["--session-id", "s-1", "--settings", "/tmp/s.json"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    const left = exited(child);
    let said = "";
    await new Promise<void>((ready) =>
      child.stdout?.on("data", (chunk: Buffer) => {
        said += chunk.toString("utf8");
        if (said.includes("Type exit to leave")) ready();
      }),
    );
    child.stdin?.write("hello\n");
    // still there: a line that is not `exit` is not a way out
    await new Promise((settle) => setTimeout(settle, 300));
    expect(child.exitCode).toBeNull();
    child.stdin?.write("exit\n");
    expect(await left).toBe(0);
    expect(readTypedAgentCalls(staged.calls).map((call) => call.argv)).toEqual([
      ["--session-id", "s-1", "--settings", "/tmp/s.json"],
    ]);
  });

  it("leaves at once when its input ends, and at once when the run is not a session", async () => {
    const staged = stageTypedAgent({
      vibefieldRoot: root(),
      source: {},
      ownerHome: "/Users/owner",
    });
    const session = spawn(staged.stub, ["--session-id", "s-2"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    const left = exited(session);
    session.stdin?.end();
    expect(await left).toBe(0);
    // a sign-in's status, a usage read: nothing to answer, and no wait
    const status = spawnSync(staged.stub, ["auth", "status", "--json"], { stdio: "ignore" });
    expect(status.status).toBe(1);
    expect(readTypedAgentCalls(staged.calls).map((call) => call.argv)).toEqual([
      ["--session-id", "s-2"],
      ["auth", "status", "--json"],
    ]);
  });
});

describe("what the step reads back", () => {
  it("names the variables an agent must never be handed: the kit's own and VibeField's private ones", () => {
    expect(
      leakedVariables({
        envKeys: [
          "PATH",
          "PUPPETEER_SHIM_DIR",
          "PUPPETEER_STATUSLINE_ENDPOINT",
          ...ENV_PREFIXES.map((prefix) => `${prefix}LOG_DIR`),
        ],
      }),
    ).toEqual(["PUPPETEER_SHIM_DIR", ...ENV_PREFIXES.map((prefix) => `${prefix}LOG_DIR`)]);
  });

  it("reads which startup files ONE shell read, by its pid", () => {
    const ran = join(root(), "ran");
    writeFileSync(ran, ".zshenv 41\n.zshenv 42\n.zprofile 42\n.zshrc 42\n.zshrc 41\n");
    expect(startupFilesRead(ran, 42)).toEqual([".zshenv", ".zprofile", ".zshrc"]);
    expect(startupFilesRead(join(root(), "none"), 42)).toEqual([]);
  });

  const zsh = spawnSync("zsh", ["-fc", "print ok"], { encoding: "utf8" }).stdout?.trim() === "ok";
  it.skipIf(!zsh)(
    "the person's startup files run in a real zsh, each saying so with its shell's pid, and parse without a word on stderr",
    () => {
      const staged = stageTypedAgent({
        vibefieldRoot: root(),
        source: {},
        ownerHome: "/Users/owner",
      });
      const run = spawnSync("zsh", ["-l", "-i", "-c", "print -r -- $$"], {
        encoding: "utf8",
        env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: staged.person },
      });
      expect(run.stderr).toBe("");
      const pid = Number(run.stdout.trim());
      expect(startupFilesRead(staged.ran, pid)).toEqual([".zshenv", ".zprofile", ".zshrc"]);
    },
  );
});
