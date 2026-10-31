import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { AGENT_CATALOG, AgentDistributionRecord, ENV_PREFIXES, LAYOUT } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  HISTORY_SEED_WORDS,
  leakedVariables,
  personEnvironment,
  readTypedAgentCalls,
  STUB_STANDING,
  stageFirstRun,
  stageTypedAgent,
  startupFilesRead,
  TYPED_AGENT_ID,
  TYPED_AGENT_MODELS,
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

/** A pid still running: answering `kill(pid, 0)`, and not a zombie its parent has yet to reap. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const stat = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
    encoding: "utf8",
  }).stdout.trim();
  return stat !== "" && !stat.startsWith("Z");
}

/** A program run in a terminal of its own, both ends (macOS `script`): the way
 * fieldd's floor runs a sign-in. The end of this process's input is a ^D typed
 * at it, and its exit is the program's. `cat` stands between: Node hands a child
 * its input over a socket, which macOS `script` refuses ("tcgetattr/ioctl:
 * Operation not supported on socket"), and a pipe it takes. */
function atATerminal(program: string, args: readonly string[]): ReturnType<typeof spawn> {
  return spawn("/bin/sh", ["-c", 'cat | script -q /dev/null "$@"', "sh", program, ...args], {
    stdio: ["pipe", "pipe", "ignore"],
  });
}

const terminals =
  process.platform === "darwin" &&
  spawnSync(
    "/bin/sh",
    ["-c", 'cat | script -q /dev/null /bin/sh -c "test -t 0 && test -t 1 && echo both"'],
    { encoding: "utf8", input: "" },
  ).stdout?.includes("both") === true;

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

  it("gives the person one conversation with the typed agent, where that agent keeps it (AR-8, L4)", () => {
    const vibefieldRoot = root();
    const staged = stageTypedAgent({ vibefieldRoot, source: {}, ownerHome: "/Users/owner" });
    const row = AGENT_CATALOG.find((entry) => entry.id === TYPED_AGENT_ID);
    expect(staged.history.kind).toBe(row?.seams.rosetta?.kind);
    // under the PERSON's home, in the agent's own layout, named by its session
    const projects = join(staged.person, (row?.layoutRoot ?? "").slice(2), "projects");
    const [project] = readdirSync(projects);
    const file = join(projects, project as string, `${staged.history.nativeSessionId}.jsonl`);
    const lines = readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => line["type"])).toEqual(["user", "assistant"]);
    for (const line of lines) {
      expect(line["sessionId"]).toBe(staged.history.nativeSessionId);
      expect(line["cwd"]).toBe(staged.work);
      // timed against now, so no recency window ever hides it
      expect(Date.now() - Date.parse(line["timestamp"] as string)).toBeLessThan(120_000);
    }
    expect(JSON.stringify(lines[1])).toContain(HISTORY_SEED_WORDS);
    // the prompt does not carry the reply's words: only the BODY says them
    expect(JSON.stringify(lines[0])).not.toContain(HISTORY_SEED_WORDS);
  });

  it("refuses a root that already holds a machine record: it stages only into one the run created", () => {
    const vibefieldRoot = root();
    stageTypedAgent({ vibefieldRoot, source: {}, ownerHome: "/Users/owner" });
    expect(() => stageTypedAgent({ vibefieldRoot, source: {}, ownerHome: "/Users/owner" })).toThrow(
      /only into a root this run created/,
    );
  });
});

describe("stageFirstRun — the first-run smoke's person (track FG)", () => {
  it("names the one stub as the ACTIVE install of every row puppeteer launches, by the catalog alone", () => {
    const vibefieldRoot = root();
    const staged = stageFirstRun({ vibefieldRoot, source: {}, ownerHome: "/Users/owner" });
    const record = AgentDistributionRecord.parse(
      JSON.parse(
        readFileSync(join(vibefieldRoot, ...LAYOUT.MACHINE_DISTRIBUTION_FILE), "utf8"),
      ) as unknown,
    );
    const launched = AGENT_CATALOG.filter((row) => row.seams.puppeteer !== null).map(
      (row) => row.id,
    );
    expect(launched.length).toBeGreaterThan(1);
    expect(staged.standsFor).toEqual(launched);
    for (const id of launched) expect(record.providers[id]?.activeExecutable, id).toBe(staged.stub);
    // which of them count it installed is each adapter's rule: the stub's own name is
    // no agent's, so no PATH lookup of an agent's command finds it
    expect(AGENT_CATALOG.map((row) => row.id)).not.toContain(basename(staged.stub));
    expect(staged.environment["FIELDD_AGENT_SEARCH_PATH"]).toBe(dirname(staged.stub));
    expect(staged.environment["HOME"]).toBe(staged.person);
    // the godview smoke's stage is its own folder, so the two never share a stub
    expect(staged.stub).toBe(join(vibefieldRoot, "first-run", "bin", "typed-agent"));
  });

  it("gives the person the typed agent's one conversation: History's one row", () => {
    const staged = stageFirstRun({ vibefieldRoot: root(), source: {}, ownerHome: "/Users/owner" });
    const row = AGENT_CATALOG.find((entry) => entry.id === TYPED_AGENT_ID);
    expect(staged.agentId).toBe(TYPED_AGENT_ID);
    expect(staged.history.kind).toBe(row?.seams.rosetta?.kind);
    const projects = join(staged.person, (row?.layoutRoot ?? "").slice(2), "projects");
    const [project] = readdirSync(projects);
    expect(
      existsSync(join(projects, project as string, `${staged.history.nativeSessionId}.jsonl`)),
    ).toBe(true);
  });

  it("refuses a root another stage already holds", () => {
    const vibefieldRoot = root();
    stageTypedAgent({ vibefieldRoot, source: {}, ownerHome: "/Users/owner" });
    expect(() => stageFirstRun({ vibefieldRoot, source: {}, ownerHome: "/Users/owner" })).toThrow(
      /only into a root this run created/,
    );
  });
});

describe("the stub at a terminal — a sign-in stands for the first run, and for no other smoke", () => {
  it("still has nothing to answer, and leaves at once, for a run with no terminal", () => {
    const staged = stageFirstRun({ vibefieldRoot: root(), source: {}, ownerHome: "/Users/owner" });
    const status = spawnSync(staged.stub, ["auth", "status", "--json"], { stdio: "ignore" });
    expect(status.status).toBe(1);
    expect(readTypedAgentCalls(staged.calls).map((call) => call.tty)).toEqual([false]);
  });

  it.skipIf(!terminals)(
    "stands in a terminal, its one line said, until the terminal's input ends",
    async () => {
      const staged = stageFirstRun({
        vibefieldRoot: root(),
        source: {},
        ownerHome: "/Users/owner",
      });
      const child = atATerminal(staged.stub, ["login"]);
      const left = exited(child);
      let said = "";
      await new Promise<void>((ready) =>
        child.stdout?.on("data", (chunk: Buffer) => {
          said += chunk.toString("utf8");
          if (said.includes(STUB_STANDING)) ready();
        }),
      );
      // still there: a sign-in waits for its person (the stub's own pid — the terminal's wrapper outlives it)
      await new Promise((settle) => setTimeout(settle, 300));
      const [call] = readTypedAgentCalls(staged.calls);
      expect(call?.argv).toEqual(["login"]);
      expect(call?.tty).toBe(true);
      expect(alive(call?.pid ?? 0)).toBe(true);
      child.stdin?.end();
      expect(await left).toBe(0);
      expect(alive(call?.pid ?? 0)).toBe(false);
    },
  );

  it.skipIf(!terminals)(
    "the godview smoke's stub refuses a terminal run: no line, and red",
    async () => {
      const staged = stageTypedAgent({
        vibefieldRoot: root(),
        source: {},
        ownerHome: "/Users/owner",
      });
      const child = atATerminal(staged.stub, ["login"]);
      const left = exited(child);
      let said = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        said += chunk.toString("utf8");
      });
      // the terminal's input ended at once: a stub that stood would leave on it at 0, one that refuses leaves at 1
      child.stdin?.end();
      expect(await left).toBe(1);
      expect(said).not.toContain(STUB_STANDING);
      expect(readTypedAgentCalls(staged.calls).map((call) => call.tty)).toEqual([true]);
    },
  );
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
    const help = execFileSync(staged.stub, ["--help"], { encoding: "utf8", cwd: staged.work });
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
    // and the folder it ran in, resolved (PJ-4: New agent lands where History said)
    expect(calls[1]?.cwd).toBe(realpathSync(staged.work));
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

describe("the stub's model picker (PJ-6)", () => {
  it("answers the picker's read — one stream-json control request — with its own models in the agent's `initialize` rows, under the request's id, and leaves", () => {
    const staged = stageTypedAgent({
      vibefieldRoot: root(),
      source: {},
      ownerHome: "/Users/owner",
    });
    const read = spawnSync(
      staged.stub,
      ["--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"],
      {
        input: `${JSON.stringify({
          type: "control_request",
          request_id: 7,
          request: { subtype: "initialize", hooks: {} },
        })}\n`,
        encoding: "utf8",
        cwd: staged.work,
      },
    );
    expect(read.status).toBe(0);
    expect(JSON.parse(read.stdout.trim())).toEqual({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: 7,
        response: { models: TYPED_AGENT_MODELS },
      },
    });
    // one model offers efforts, one none — the rung starts the first at its last
    expect(TYPED_AGENT_MODELS.map((model) => model.supportsEffort)).toEqual([true, false]);
    // the read is recorded like any run, and is no session
    expect(readTypedAgentCalls(staged.calls).map((call) => call.argv[0])).toEqual(["--print"]);
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
