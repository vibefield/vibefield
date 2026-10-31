import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  AGENT_CATALOG,
  AGENT_DISTRIBUTION_FORMAT,
  AgentDistributionRecord,
  ENV_PREFIXES,
  LAYOUT,
} from "@vibefield/contracts";

// THE GODVIEW SMOKE'S TYPED AGENT (AR-7, R1 — "type it"; the plan's §9 names
// the `smoke:godview` typed-agent row as R1's witness).
//
// `pnpm smoke:godview` runs the product's own daemon pair on the machine
// owner's daily machine, and the typed-agent step types an agent's name into
// one of its panes. Nothing of the owner's may answer: no vendor's binary runs,
// and no install, profile, configuration or history of theirs is read or
// written. So before the pair boots — fieldd composes an agent's executable
// ONCE, at boot — this stages, in the run's own root:
//
//   · a STUB: the smoke's own stand-in for the agent's CLI. It answers the
//     launch's probes (`--version`, `--help`) and its model picker's read
//     (PJ-6: the agent's own stream-json `initialize`, answered with
//     `TYPED_AGENT_MODELS`), records every run of itself (its arguments and
//     its environment's NAMES — never a value) and, run as a managed session,
//     waits at its prompt until `exit` or the end of its input;
//   · the MACHINE RECORD naming the stub as that agent's ACTIVE install — the
//     choice Settings → Agents records (`machine/agents/distribution.json`,
//     AR-D16), so the launch recipe, the launch's probe and the gateway's
//     launcher all name the stub — and naming, for every other agent, an
//     install that does not exist: nothing fieldd composes can resolve a
//     vendor's binary (their usage and identity reads start one otherwise);
//   · a PERSON: a throwaway HOME whose startup files only say they ran (and
//     announce the shell's directory, as a terminal app's own zshrc does). The
//     pair runs as them — the floor rows' `person: true`
//     (fieldd/test/agent-gateway-floor.ts) — so every pane is born theirs, the
//     agent's own settings are read from THEIR home, and no line the smoke
//     types reaches the owner's shell history.
//
// AR-8 (L4): the person also has a HISTORY — one synthesized conversation with
// the typed agent, in that agent's own transcript layout under their HOME, which
// is the home rosettad indexes (fieldd's `--home` is its own HOME, the
// person's). The History rung enrolls the agent and opens it: the body's words
// rendering in the room are the packaged origin's fetch, preflight and socket
// working from a real Chromium page.
//
// And the pair is handed one seam of fieldd's own: `FIELDD_AGENT_SEARCH_PATH`
// (fieldd `bin.ts`), the stub's directory — the install inventory then finds
// no install of the owner's to inspect or run.
//
// Test-only by construction: this module rides the smoke bundle
// (dist/testing/smoke.cjs), which packaging omits.

/** The agent the step types, as the catalog spells it — THE one agent id this
 * harness names (R23b's allow-list holds it to exactly one literal). It is the
 * one agent a stub can stand in for: its managed launch is the command a
 * person types plus the launch's own flags (another's is a private server and
 * a thread), and its adapter refuses an argument for a session it cannot
 * observe (`TYPED_AGENT_REFUSED_ARGUMENT`). */
export const TYPED_AGENT_ID = "claude";

/** An argument that agent's adapter refuses for an interactive session (its
 * grammar: the session would fire no hook, so it could not be observed). */
export const TYPED_AGENT_REFUSED_ARGUMENT = "--bare";

/** The kit's own variables, which the shim strips before an agent runs. */
const KIT_VARIABLE_PREFIX = "PUPPETEER_SHIM_";

/** What the stub prints for `--version`: a version the launch's probe can
 * read, and a banner that says what it is. */
const STUB_VERSION = "0.0.0-smoke (the godview smoke's typed-agent stub)";

/** What the stub prints for `--help`: the managed launch's own options, which
 * the launch's probe looks for before it will prepare a session — the door's
 * four among them (item 124, 2026-10-31): a current Claude declares them, so
 * every birth's briefing passes the probe and the row walks the door path. A
 * stub without them is a Claude older than `--mcp-config`, whose births
 * fieldd makes without their briefing (`fieldd/src/agent-door-launch.ts`). */
const STUB_HELP = `Usage: typed-agent [options] [prompt]

The godview smoke's stand-in for an agent's CLI. It takes the managed launch's
own options, records every run of itself, and waits for exit.

Options:
  -r, --resume [value]         resume a session
  --session-id <uuid>          the session's id
  --settings <file-or-json>    the session's settings
  --setting-sources <sources>  the settings layers to read
  --permission-mode <mode>     the permission mode
  -n, --name <name>            the session's name
  --model <model>              the model
  --effort <level>             the effort
  --mcp-config <configs...>    the session's MCP servers
  --allowedTools <tools...>    the tools it may use without asking
  --append-system-prompt-file <file>
                               instructions appended to its system prompt
  --system-prompt-snapshot <mode>
                               whether its system prompt is snapshotted
  -v, --version                print the version
  -h, --help                   print this help
`;

/** PJ-6 — the stub's own model picker, in the agent's native `initialize` rows
 * (`value`, `displayName`, the effort levels each model offers): one model with
 * efforts, one without. The History rung starts the first at its last level. */
export const TYPED_AGENT_MODELS = [
  {
    value: "stub-steady",
    displayName: "Steady",
    description: "The stub's model with an effort",
    supportedEffortLevels: ["low", "high"],
    supportsEffort: true,
  },
  { value: "stub-plain", displayName: "Plain", supportsEffort: false },
] as const;

/** The stub, as a Node program: `#!/usr/bin/env node`, so a shell, the
 * shim's exec and fieldd's probes all run the same file the same way. */
export function typedAgentStubSource(calls: string): string {
  return `#!/usr/bin/env node
"use strict";
// The godview smoke's typed-agent stub: a stand-in written by the smoke, never
// an agent. It records every run of itself — its arguments, its folder and the
// NAMES of its environment, never a value — and, run as a managed session, waits at
// its prompt until \`exit\` or the end of its input.
const { appendFileSync } = require("node:fs");
const { isatty } = require("node:tty");
const argv = process.argv.slice(2);
appendFileSync(
  ${JSON.stringify(calls)},
  JSON.stringify({
    argv,
    envKeys: Object.keys(process.env).sort(),
    tty: isatty(0) && isatty(1),
    cwd: process.cwd(),
    pid: process.pid,
    ppid: process.ppid,
  }) + "\\n",
);
if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) {
  process.stdout.write(${JSON.stringify(`${STUB_VERSION}\n`)});
  process.exit(0);
}
if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
  process.stdout.write(${JSON.stringify(STUB_HELP)});
  process.exit(0);
}
let pending = "";
process.stdin.setEncoding("utf8");
if (argv.includes("--print") && argv.includes("stream-json")) {
  // PJ-6 — the model picker's read: one control request, the agent's own
  // \`initialize\` answered under its id with the stub's models
  process.stdin.on("data", (chunk) => {
    pending += chunk;
    const at = pending.indexOf("\\n");
    if (at < 0) return;
    const request = JSON.parse(pending.slice(0, at));
    const answer = {
      type: "control_response",
      response: {
        subtype: "success",
        request_id: request.request_id,
        response: { models: ${JSON.stringify(TYPED_AGENT_MODELS)} },
      },
    };
    process.stdout.write(JSON.stringify(answer) + "\\n", () => process.exit(0));
  });
  process.stdin.on("end", () => process.exit(0));
} else if (!argv.includes("--session-id") && !argv.includes("--resume")) {
  // Not a session (a sign-in's status, a usage read): nothing to answer.
  process.exit(1);
} else {
  process.stdout.write("typed-agent stub: a managed session. Type exit to leave.\\n");
  process.stdin.on("data", (chunk) => {
    pending += chunk;
    for (let at = pending.indexOf("\\n"); at >= 0; at = pending.indexOf("\\n")) {
      const line = pending.slice(0, at).trim();
      pending = pending.slice(at + 1);
      if (line === "exit") process.exit(0);
    }
  });
  process.stdin.on("end", () => process.exit(0));
}
`;
}

/** One run of the stub, as it recorded itself. */
export interface TypedAgentCall {
  argv: string[];
  /** the NAMES of its environment — the stub never records a value */
  envKeys: string[];
  /** its input and output were a terminal */
  tty: boolean;
  /** the folder it ran in (resolved, as the OS reports it) — PJ-4's New
   * agent lands in the folder History named */
  cwd?: string;
  pid: number;
  ppid: number;
}

/** Every run of the stub so far, oldest first. A line still being written is
 * left for the next read. */
export function readTypedAgentCalls(calls: string): TypedAgentCall[] {
  let text: string;
  try {
    text = readFileSync(calls, "utf8");
  } catch {
    return [];
  }
  const seen: TypedAgentCall[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      seen.push(JSON.parse(line) as TypedAgentCall);
    } catch {
      // half a line: the stub is writing it
    }
  }
  return seen;
}

/** The variables of a run's environment an agent must never be handed: the
 * kit's own (the shim strips them before exec) and VibeField's private ones
 * (EL7: a shell of ours is born without them). */
export function leakedVariables(call: Pick<TypedAgentCall, "envKeys">): string[] {
  return call.envKeys.filter(
    (name) =>
      name.startsWith(KIT_VARIABLE_PREFIX) ||
      ENV_PREFIXES.some((prefix) => name.startsWith(prefix)),
  );
}

/** Which of the person's startup files the shell with this pid read. */
export function startupFilesRead(ran: string, pid: number): string[] {
  let text: string;
  try {
    text = readFileSync(ran, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .map((line) => line.trim().split(" "))
    .filter((parts) => parts.length === 2 && parts[1] === String(pid))
    .map((parts) => parts[0] as string);
}

/**
 * The environment the pair runs with — and so every shell it births: the
 * harness's own, as the person's.
 *
 * Out goes what would make a born shell look integrated already or reach
 * outside the box (the floor rows' person: a ZDOTDIR or HISTFILE of the
 * owner's, a terminal app's session hooks, the kit's variables), and anything
 * that names a place in the OWNER's home — a configuration root, a cache, a
 * history — so no agent of this run is handed one. PATH stays whole: its
 * entries are how the person's shell and the launcher find their programs
 * (the launcher's Node among them), and a launcher's shim leads it anyway.
 * HOME is the person's.
 */
export function personEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  opts: { ownerHome: string; personHome: string },
): Record<string, string> {
  const owner = resolve(opts.ownerHome);
  const inOwnerHome = (value: string): boolean =>
    value.split(delimiter).some((part) => {
      if (part === "~" || part.startsWith("~/")) return true;
      if (!isAbsolute(part)) return false;
      const path = resolve(part);
      return path === owner || path.startsWith(`${owner}${sep}`);
    });
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (name === "HOME" || name === "ZDOTDIR" || name === "HISTFILE") continue;
    if (name.startsWith("TERM_") || name.startsWith("PUPPETEER_")) continue;
    if (name !== "PATH" && inOwnerHome(value)) continue;
    environment[name] = value;
  }
  environment["HOME"] = opts.personHome;
  return environment;
}

/** The person's startup files: each says it ran, with its shell's pid; the
 * zshrc also announces the shell's directory before every prompt (OSC 7) —
 * where a `cd` lands is only ever what a shell announces, and the smoke's cwd
 * rows read it. An interactive zsh with no zshrc would offer its new-user
 * wizard instead of a prompt. */
function writePersonFiles(person: string, ran: string): void {
  const said = (file: string): string => `print -r -- "${file} $$" >> '${ran}'\n`;
  writeFileSync(join(person, ".zshenv"), said(".zshenv"));
  writeFileSync(join(person, ".zprofile"), said(".zprofile"));
  writeFileSync(
    join(person, ".zshrc"),
    `${said(".zshrc")}_vf_person_cwd() { printf '\\e]7;file://%s%s\\a' "$HOST" "$PWD"; }
autoload -Uz add-zsh-hook && add-zsh-hook precmd _vf_person_cwd
`,
  );
  writeFileSync(join(person, ".profile"), `echo ".profile $$" >> '${ran}'\n`);
}

/** Words only the seeded conversation's BODY carries — the agent's reply —
 * so the History rung can tell its transcript rendered from a catalog row. */
export const HISTORY_SEED_WORDS = "Lanterns hang along the harbour wall tonight";

/** The person's one conversation with the typed agent, written where that agent
 * keeps its transcripts (the catalog's layout root under their HOME) in its own
 * line format — a prompt and a reply, timed a minute ago so no recency window
 * hides it (the shape rosetta's own adapter tests write, build-hf L4). */
function writePersonTranscript(
  person: string,
  work: string,
  row: (typeof AGENT_CATALOG)[number],
  conversation: { sessionId: string; asked: string; said: string } = {
    sessionId: randomUUID(),
    asked: "Where are the lanterns?",
    said: HISTORY_SEED_WORDS,
  },
): { kind: string; nativeSessionId: string } {
  const kind = row.seams.rosetta?.kind;
  const layoutRoot = row.layoutRoot;
  if (kind === undefined || layoutRoot === null || !layoutRoot.startsWith("~/")) {
    throw new Error(
      "the typed agent's catalog row names no rosetta kind or home layout: History has nothing to seed",
    );
  }
  const { sessionId } = conversation;
  const prompt = randomUUID();
  const reply = randomUUID();
  const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1_000).toISOString();
  const common = {
    isSidechain: false,
    userType: "external",
    cwd: work,
    sessionId,
    version: "2.1.241",
    gitBranch: "HEAD",
  };
  const lines = [
    {
      ...common,
      parentUuid: null,
      type: "user",
      uuid: prompt,
      timestamp: at(60),
      message: { role: "user", content: conversation.asked },
    },
    {
      ...common,
      parentUuid: prompt,
      type: "assistant",
      uuid: reply,
      timestamp: at(30),
      message: {
        id: "msg_smoke_0000",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [{ type: "text", text: `${conversation.said}.` }],
        stop_reason: "end_turn",
        stop_sequence: null,
        stop_details: null,
        // the recorded shape the adapter requires: the four counters, the cache
        // split, and the two nullable-never-absent fields (a reply without them
        // is a hard error and only the prompt indexes — measured)
        usage: {
          input_tokens: 12,
          output_tokens: 9,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
          inference_geo: "",
          service_tier: "standard",
        },
      },
    },
  ];
  const projects = join(
    person,
    layoutRoot.slice(2),
    "projects",
    work.replace(/[^A-Za-z0-9]/g, "-"),
  );
  mkdirSync(projects, { recursive: true });
  writeFileSync(
    join(projects, `${sessionId}.jsonl`),
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
  return { kind, nativeSessionId: sessionId };
}

/** PJ-6 (Q4) — a conversation the stub "had" in a session it was launched
 * into: the agent keeps a transcript for every session, and its resume refuses
 * one that is not on disk ("…is not on disk under <home>/.claude/projects; it
 * cannot be resumed", the Claude adapter). The stub keeps none of its own, so
 * a rung that resumes a stub session writes the transcript the agent would
 * have — the person's, in the agent's own layout, under that session's id. */
export function writeTypedAgentConversation(
  staged: Pick<StagedTypedAgent, "person" | "work">,
  sessionId: string,
  words: { asked: string; said: string },
): void {
  const row = AGENT_CATALOG.find((entry) => entry.id === TYPED_AGENT_ID);
  if (row === undefined) throw new Error("the typed agent's catalog row is gone");
  writePersonTranscript(staged.person, staged.work, row, { sessionId, ...words });
}

/** What `stageTypedAgent` put in place, for the step that types. */
export interface StagedTypedAgent {
  /** the catalog id the stub stands in for */
  agentId: string;
  /** the stand-in: that agent's ACTIVE install in this run */
  stub: string;
  /** what the stub records, one JSON line per run of it */
  calls: string;
  /** the person's HOME */
  person: string;
  /** one line per startup file a shell of theirs read: `<file> <pid>` */
  ran: string;
  /** where the name is typed: an empty project, so the agent's project and
   * local settings layers are nobody's */
  work: string;
  /** the environment the pair is spawned with */
  environment: Record<string, string>;
  /** AR-8 — the person's one conversation, for the History rung: the rosetta
   * kind to enroll, and the session's own id */
  history: { kind: string; nativeSessionId: string };
}

/**
 * Stage the typed agent in a run's OWN root, before its pair boots. Refuses a
 * root that already holds a machine record: this is only ever a root the run
 * created (main never stages into an injected `FIELDD_DATA_DIR`).
 */
export function stageTypedAgent(opts: {
  /** the VibeField root above the run's user root (`users.json`'s root) */
  vibefieldRoot: string;
  /** the environment the person's is made from (default: this process's) */
  source?: Readonly<Record<string, string | undefined>>;
  /** the machine owner's home (default: this process's) */
  ownerHome?: string;
}): StagedTypedAgent {
  const row = AGENT_CATALOG.find((entry) => entry.id === TYPED_AGENT_ID);
  if (row === undefined || row.seams.puppeteer === null || !row.offers.invoke) {
    throw new Error(
      "the typed agent's catalog row is gone or no longer offers invoke: no launcher would stand for it, and the step has nothing to type",
    );
  }
  const base = join(opts.vibefieldRoot, "typed-agent");
  const bin = join(base, "bin");
  const person = join(base, "person");
  const work = join(base, "work");
  const calls = join(base, "calls.jsonl");
  const ran = join(person, "ran");
  const stub = join(bin, "typed-agent");
  const record = join(opts.vibefieldRoot, ...LAYOUT.MACHINE_DISTRIBUTION_FILE);
  if (existsSync(record)) {
    throw new Error(`${record} exists: the typed agent stages only into a root this run created`);
  }
  for (const directory of [bin, person, work, dirname(record)]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(stub, typedAgentStubSource(calls));
  chmodSync(stub, 0o755);
  writePersonFiles(person, ran);
  const history = writePersonTranscript(person, work, row);
  // Every other agent's install names a path that is never created: whatever
  // fieldd would start for one of them fails to start.
  const absent = join(base, "absent");
  const providers: Record<string, { activeExecutable: string }> = {};
  for (const entry of AGENT_CATALOG) {
    if (entry.seams.puppeteer === null) continue;
    providers[entry.id] = { activeExecutable: entry.id === row.id ? stub : join(absent, entry.id) };
  }
  const machine = AgentDistributionRecord.parse({
    format: AGENT_DISTRIBUTION_FORMAT,
    providers,
    updatedAt: new Date().toISOString(),
  });
  writeFileSync(record, `${JSON.stringify(machine, null, 2)}\n`);
  return {
    agentId: row.id,
    stub,
    calls,
    person,
    ran,
    work,
    environment: {
      ...personEnvironment(opts.source ?? process.env, {
        ownerHome: opts.ownerHome ?? homedir(),
        personHome: person,
      }),
      FIELDD_AGENT_SEARCH_PATH: bin,
    },
    history,
  };
}
