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
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { AGENT_CATALOG, AgentDistributionRecord, ENV_PREFIXES, LAYOUT } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  HISTORY_SEED_WORDS,
  leakedVariables,
  personEnvironment,
  readTypedAgentCalls,
  readTypedAgentForwards,
  readTypedAgentLines,
  STUB_STANDING,
  stageFirstRun,
  stageTypedAgent,
  startupFilesRead,
  TYPED_AGENT_ANSWERED,
  TYPED_AGENT_ID,
  TYPED_AGENT_MODELS,
  TYPED_AGENT_PROFILE_ROOT,
  typedAgentAnswer,
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
    // and no record of a session's lines: that is the godview smoke's alone (11m)
    expect(staged.lines).toBeUndefined();
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
    // a run that is no session and no sign-in's read (a usage read, say): nothing to answer, and no wait
    const usage = spawnSync(staged.stub, ["usage"], { stdio: "ignore" });
    expect(usage.status).toBe(1);
    expect(readTypedAgentCalls(staged.calls).map((call) => call.argv)).toEqual([
      ["--session-id", "s-2"],
      ["usage"],
    ]);
  });

  it("says This Mac is signed in, and no profile: `auth status --json` answers loggedIn only with no profile root bound (11m's hatch)", () => {
    const staged = stageTypedAgent({
      vibefieldRoot: root(),
      source: {},
      ownerHome: "/Users/owner",
    });
    // the environment named whole, so a profile root the test's own shell holds never decides it
    const env = { PATH: process.env["PATH"] ?? "" };
    const mac = spawnSync(staged.stub, ["auth", "status", "--json"], { encoding: "utf8", env });
    expect(mac.status).toBe(0);
    expect(JSON.parse(mac.stdout)).toEqual({ loggedIn: true });
    const profile = spawnSync(staged.stub, ["auth", "status", "--json"], {
      encoding: "utf8",
      env: { ...env, [TYPED_AGENT_PROFILE_ROOT]: join(staged.person, "a-profile") },
    });
    expect(profile.status).toBe(1);
    expect(profile.stdout).toBe("");
  });

  it("records each line a managed session is given, in `lines`: 11m's witness that a sent line reached the agent", async () => {
    const staged = stageTypedAgent({
      vibefieldRoot: root(),
      source: {},
      ownerHome: "/Users/owner",
    });
    const lines = staged.lines;
    if (lines === undefined) throw new Error("the godview smoke's stub records no lines");
    const child = spawn(staged.stub, ["--session-id", "s-3"], {
      cwd: staged.work,
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
    // nothing yet: a line is recorded when it is submitted, never as it is typed
    expect(readTypedAgentLines(lines)).toEqual([]);
    child.stdin?.write("pasted words 11m\n");
    child.stdin?.write("exit\n");
    expect(await left).toBe(0);
    const record = readTypedAgentLines(lines);
    expect(record.map((entry) => entry.line)).toEqual(["pasted words 11m", "exit"]);
    expect(record[0]?.pid).toBe(child.pid);
    expect(record[0]?.cwd).toBe(realpathSync(staged.work));
  });

  // Item 185: 11m's Send is puppeteer's paste-and-submit, which is confirmed only by the agent's own
  // UserPromptSubmit hook carrying the prompt (puppeteer 0.3.3: adapter-claude services/prompt.js, 5000 ms). So the
  // stub, given a line, does what the agent does: it POSTs the hook its --settings names and waits for the answer.
  // The settings are the shape puppeteer writes (launch/settings.js `handlerFor`: the bearer a `$VAR` reference,
  // resolved through `allowedEnvVars`, never a value on disk), and the body the fields its pipeline reads
  // (normalization/pipeline.js `normalize`; wire.js holds UserPromptSubmit to a string `prompt`).
  it("tells each prompt to the UserPromptSubmit hook its settings name, as the agent does, and records the line only once the hook has answered (item 185)", async () => {
    const staged = stageTypedAgent({
      vibefieldRoot: root(),
      source: {},
      ownerHome: "/Users/owner",
    });
    const lines = staged.lines;
    if (lines === undefined) throw new Error("the godview smoke's stub records no lines");
    // puppeteer's own variable for the bridge's bearer (adapter-claude driver.js TOKEN_ENV_VAR)
    const variable = "PUPPETEER_HOOK_TOKEN";
    const token = `token-${process.pid}-never-recorded`;
    const sessionId = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
    const heard: {
      method: string | undefined;
      path: string | undefined;
      headers: IncomingHttpHeaders;
      body: unknown;
      recordedAsHeard: string[];
      recordedAsAnswered: string[];
    }[] = [];
    const bridge = createServer((request, response) => {
      let text = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        text += chunk;
      });
      request.on("end", () => {
        const recordedAsHeard = readTypedAgentLines(lines).map((entry) => entry.line);
        // a late answer, so a line recorded before the hook answers would show
        setTimeout(() => {
          heard.push({
            method: request.method,
            path: request.url,
            headers: request.headers,
            body: JSON.parse(text) as unknown,
            recordedAsHeard,
            recordedAsAnswered: readTypedAgentLines(lines).map((entry) => entry.line),
          });
          response.writeHead(200, { "content-type": "application/json" });
          response.end("{}");
        }, 250);
      });
    });
    await new Promise<void>((listening) => bridge.listen(0, "127.0.0.1", listening));
    try {
      const { port } = bridge.address() as AddressInfo;
      const endpoint = `http://127.0.0.1:${port}/hooks`;
      const handler = {
        type: "http",
        url: endpoint,
        headers: { Authorization: `Bearer $${variable}` },
        allowedEnvVars: [variable],
        timeout: 5,
      };
      const settings = join(dirname(staged.calls), "settings.json");
      writeFileSync(
        settings,
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [handler] }],
            UserPromptSubmit: [{ hooks: [handler] }],
            Stop: [{ hooks: [handler] }],
          },
        }),
      );
      const child = spawn(staged.stub, ["--session-id", sessionId, "--settings", settings], {
        cwd: staged.work,
        env: { ...process.env, [variable]: token },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const left = exited(child);
      let said = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        said += chunk.toString("utf8");
      });
      await new Promise<void>((ready) =>
        child.stdout?.on("data", (chunk: Buffer) => {
          said += chunk.toString("utf8");
          if (said.includes("Type exit to leave")) ready();
        }),
      );
      child.stdin?.write("pasted words 11m\n");
      child.stdin?.write("exit\n");
      expect(await left).toBe(0);
      // one hook, the prompt's: the session's id, the line verbatim, the bearer resolved from the environment
      expect(heard.map((hook) => hook.body)).toEqual([
        {
          session_id: sessionId,
          cwd: realpathSync(staged.work),
          hook_event_name: "UserPromptSubmit",
          prompt: "pasted words 11m",
        },
      ]);
      expect(heard[0]?.method).toBe("POST");
      expect(heard[0]?.path).toBe("/hooks");
      expect(heard[0]?.headers.authorization).toBe(`Bearer ${token}`);
      expect(heard[0]?.headers["content-type"]).toBe("application/json");
      // told before it is recorded, and recorded only once the hook has answered
      expect(heard[0]?.recordedAsHeard).toEqual([]);
      expect(heard[0]?.recordedAsAnswered).toEqual([]);
      // the line carries the hook's status and nothing else of it; `exit` is the stub's way out, no prompt
      expect(readTypedAgentLines(lines)).toEqual([
        { pid: child.pid, cwd: realpathSync(staged.work), line: "pasted words 11m", hooks: [200] },
        { pid: child.pid, cwd: realpathSync(staged.work), line: "exit" },
      ]);
      // EL7: never the URL, a header or the token, in a record or a word said
      for (const text of [readFileSync(lines, "utf8"), readFileSync(staged.calls, "utf8"), said]) {
        expect(text).not.toContain(token);
        expect(text).not.toContain("127.0.0.1");
        expect(text).not.toContain("Bearer");
      }
    } finally {
      await new Promise((closed) => bridge.close(closed));
    }
  });

  // Item 227: 11m reads the agent's reply, and fieldd hears it at the turn's end. So a line that carries 11m's mark
  // gives its words to MessageDisplay and ends its turn through the Stop hook, as the agent's does (adapter-claude
  // normalization/wire.ts holds MessageDisplay to these three fields; turn.ts reads `last_assistant_message`). No
  // other line is answered: a turn ended for every line would move every rung.
  it("displays a line's answer and ends its turn through the Stop hook when it carries 11m's mark, and no other line's", async () => {
    const staged = stageTypedAgent({
      vibefieldRoot: root(),
      source: {},
      ownerHome: "/Users/owner",
    });
    const lines = staged.lines;
    if (lines === undefined) throw new Error("the godview smoke's stub records no lines");
    const heard: Record<string, unknown>[] = [];
    const bridge = createServer((request, response) => {
      let text = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        text += chunk;
      });
      request.on("end", () => {
        heard.push(JSON.parse(text) as Record<string, unknown>);
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    await new Promise<void>((listening) => bridge.listen(0, "127.0.0.1", listening));
    try {
      const { port } = bridge.address() as AddressInfo;
      const handler = { type: "http", url: `http://127.0.0.1:${port}/hooks`, timeout: 5 };
      const settings = join(dirname(staged.calls), "settings.json");
      writeFileSync(
        settings,
        JSON.stringify({
          hooks: {
            UserPromptSubmit: [{ hooks: [handler] }],
            MessageDisplay: [{ hooks: [handler] }],
            Stop: [{ hooks: [handler] }],
          },
        }),
      );
      const child = spawn(staged.stub, ["--session-id", "s-5", "--settings", settings], {
        cwd: staged.work,
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
      const marked = `${TYPED_AGENT_ANSWERED}abc`;
      child.stdin?.write("pasted words 11m\n");
      child.stdin?.write(`${marked}\n`);
      child.stdin?.write("exit\n");
      expect(await left).toBe(0);
      expect(heard.map((body) => body["hook_event_name"])).toEqual([
        "UserPromptSubmit",
        "UserPromptSubmit",
        "MessageDisplay",
        "Stop",
      ]);
      expect(heard[2]).toEqual({
        session_id: "s-5",
        cwd: realpathSync(staged.work),
        hook_event_name: "MessageDisplay",
        message_id: "stub-answer",
        delta: typedAgentAnswer(marked),
        final: true,
      });
      expect(heard[3]).toEqual({
        session_id: "s-5",
        cwd: realpathSync(staged.work),
        hook_event_name: "Stop",
        stop_hook_active: false,
        last_assistant_message: typedAgentAnswer(marked),
      });
      const record = readTypedAgentLines(lines);
      expect(record.map((entry) => entry.answered)).toEqual([undefined, [200], undefined]);
    } finally {
      await new Promise((closed) => bridge.close(closed));
    }
  });

  // RV #1 (item 203): a packaged agent's command hooks and status line run VibeField's own executable in its
  // forwarder role, and no row saw them run while the stub ran none. So the stub, as it starts, runs what the agent
  // runs: each SessionStart command hook in exec form (`command` and `args`, no shell, as puppeteer writes them,
  // launch/settings.ts `handlerFor`), the hook's document on its input, then its status line once, through the
  // shell. desk-gates row 34 reads the packaged run's half; this row reads the stub's own.
  it("runs each SessionStart command hook its settings name in exec form, then its status line, as the agent does as it starts, recording each exit and output and never the command, an argument or a variable (RV #1, item 203)", async () => {
    const staged = stageTypedAgent({
      vibefieldRoot: root(),
      source: {},
      ownerHome: "/Users/owner",
    });
    const forwards = staged.forwards;
    if (forwards === undefined) throw new Error("the godview smoke's stub records no forwards");
    const base = dirname(staged.calls);
    const sessionId = "0c9b8a7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";
    // the hook's program: what it was handed, and its input, said into a file of the row's; then one word printed
    const said = join(base, "hook-said.json");
    const program = join(base, "hook-program.cjs");
    writeFileSync(
      program,
      `const { readFileSync, writeFileSync } = require("node:fs");
writeFileSync(${JSON.stringify(said)}, JSON.stringify({ argv: process.argv.slice(2), input: readFileSync(0, "utf8") }));
process.stdout.write("hooked");
`,
    );
    const settings = join(base, "settings.json");
    writeFileSync(
      settings,
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: process.execPath,
                  args: [program, "two words", "$NOT_A_SHELL"],
                  timeout: 30,
                },
              ],
            },
          ],
        },
        statusLine: { type: "command", command: "printf line" },
      }),
    );
    const child = spawn(staged.stub, ["--session-id", sessionId, "--settings", settings], {
      cwd: staged.work,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const left = exited(child);
    const deadline = Date.now() + 30_000;
    while (readTypedAgentForwards(forwards).length < 2 && Date.now() < deadline)
      await new Promise((tick) => setTimeout(tick, 50));
    child.stdin?.write("exit\n");
    expect(await left).toBe(0);
    // exec form: the arguments exactly as written, one word with its space, nothing a shell would expand
    const heard = JSON.parse(readFileSync(said, "utf8")) as { argv: string[]; input: string };
    expect(heard.argv).toEqual(["two words", "$NOT_A_SHELL"]);
    expect(JSON.parse(heard.input)).toEqual({
      session_id: sessionId,
      cwd: realpathSync(staged.work),
      hook_event_name: "SessionStart",
      source: "startup",
    });
    // each run recorded, the hook first: how it left and what it printed
    expect(readTypedAgentForwards(forwards)).toEqual([
      { pid: child.pid, what: "SessionStart", code: 0, signal: null, stdout: "hooked", stderr: "" },
      { pid: child.pid, what: "statusLine", code: 0, signal: null, stdout: "line", stderr: "" },
    ]);
    // never the command, an argument or the document's place in the record
    const record = readFileSync(forwards, "utf8");
    for (const unsaid of [program, "two words", "$NOT_A_SHELL", "printf"])
      expect(record).not.toContain(unsaid);
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
  // Item 145 (2026-11-01) — one real login, interactive zsh over the staged HOME, synchronous: a loaded host stretches
  // it, and vitest's 5 s default cut it at 7,573 ms (items 142–143's electron-shell whole, 05:13Z), in the minute the
  // release-notes row ran 7,436 (item 143): the host, not the row. Measured in this Mac's logged suites since 10-29
  // (24 runs): 14 under vitest's 300 ms report threshold, the rest 456–1,354 ms; the mini's 76, 72 under it and the
  // rest 311–439. Its claim is the startup files' order and silence, never a time: 15 s, as release-notes' row and
  // smoke-profile's LAUNCHER_ROW_BUDGET_MS (item 93), is about twice the worst this Mac has logged.
  it.skipIf(!zsh)(
    "the person's startup files run in a real zsh, each saying so with its shell's pid, and parse without a word on stderr",
    { timeout: 15_000 },
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
