// Item 551, 2026-11-18 — before a file's rows run, `node:child_process` is the real module except that a call of the
// keychain tool is refused: `spawn`, `spawnSync`, `execFile`, `execFileSync`, `exec` and `execSync` throw at once,
// before any program starts, when the program is `/usr/bin/security` (plugin-settings.ts's SECURITY_TOOL) or the bare
// name `security`, or when a command string's first word is either. Every other program runs as before, and a
// promisified `execFile` or `exec` keeps its own form. A refused call is kept with the row that made it: that row
// fails by name in this file's afterEach, and a call made outside any row fails the file in its afterAll. The module
// carries `keychainGuard`, so a row can see the guard is in place before it calls anything (keychain-guard.test.ts).
//
// Not covered: a program that starts the tool itself (`sh -c`, `env security`, a script), a daemon's child process or
// worker thread (field-native, the files worker, a fieldd started as its own process), code vitest does not transform
// (node_modules, puppeteer's own included), and a file that mocks `node:child_process` itself, whose mock replaces
// this one there: agent-brew-prefixes and agent-runtime-brew-prefixes, which both throw on every member.
import { afterAll, afterEach, beforeEach, type TestContext, vi } from "vitest";

/** One refused call: the function, the program, its first argument (never more), and the row that made it (null:
 * outside any row). */
interface RefusedCall {
  call: string;
  program: string;
  first: string | undefined;
  row: string | null;
}

const guard = vi.hoisted(() => {
  /** The keychain tool's two spellings: SECURITY_TOOL, and the name a PATH would find it by. */
  const programs: readonly string[] = ["/usr/bin/security", "security"];
  const calls = ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"] as const;
  const promisified = Symbol.for("nodejs.util.promisify.custom");
  const state = { row: null as string | null, calls: [] as RefusedCall[] };
  const wrappers = new WeakSet<object>();

  /** A command word, one pair of surrounding quotes taken off. */
  const unquoted = (word: string | undefined) => word?.replace(/^(["'])(.*)\1$/su, "$2");
  const firstOf = (list: unknown) => {
    const first: unknown = Array.isArray(list) ? list[0] : undefined;
    return first === undefined ? undefined : String(first);
  };

  /** The program and first argument of a call that reaches for the tool: a command equal to either spelling, or a
   * command string whose first word is one. Any other call is undefined. */
  function reaches(
    args: readonly unknown[],
  ): { program: string; first: string | undefined } | undefined {
    const [command, list] = args;
    if (typeof command !== "string") return undefined;
    if (programs.includes(command)) return { program: command, first: firstOf(list) };
    const words = command.trim().split(/\s+/u);
    const head = unquoted(words[0]);
    if (head === undefined || !programs.includes(head)) return undefined;
    return { program: head, first: words.length > 1 ? unquoted(words[1]) : firstOf(list) };
  }

  /** What a row, or the file, fails with: where the calls were made, and each call's program and first argument. */
  function refusal(where: string, made: readonly RefusedCall[]): Error | undefined {
    if (made.length === 0) return undefined;
    const each = made.map((c) => [c.call, c.program, c.first].filter((p) => p !== undefined));
    return new Error(
      `item 551: ${where} reached for the keychain tool (${each.map((p) => p.join(" ")).join("; ")}). ` +
        "Hand it a store of its own: createDarwinSecretStore's `run`, or the daemon's `secretStore`.",
    );
  }

  /** The call refused and kept, when it reaches for the tool. */
  function refuse(call: string, args: readonly unknown[]): Error | undefined {
    const reached = reaches(args);
    if (reached === undefined) return undefined;
    state.calls.push({ call, ...reached, row: state.row });
    return new Error(`item 551: ${call} of ${reached.program} is refused in fieldd's tests`);
  }

  function wrap(call: string, real: (...args: never[]) => unknown): object {
    const wrapped = (...args: unknown[]): unknown => {
      const refused = refuse(call, args);
      if (refused !== undefined) throw refused;
      return Reflect.apply(real, undefined, args);
    };
    const custom: unknown = Reflect.get(real, promisified);
    if (typeof custom === "function") {
      const promised = (...args: unknown[]): unknown => {
        const refused = refuse(call, args);
        return refused !== undefined
          ? Promise.reject(refused)
          : Reflect.apply(custom, undefined, args);
      };
      Object.defineProperty(wrapped, promisified, { value: promised });
    }
    wrappers.add(wrapped);
    return wrapped;
  }

  /** The real module with the six calls wrapped and the marker added, as its names and as its default. */
  function guarded(actual: typeof import("node:child_process")): Record<string, unknown> {
    const named: Record<string, unknown> = Object.fromEntries(
      Object.entries(actual).filter(([name]) => name !== "default"),
    );
    for (const call of calls) named[call] = wrap(call, actual[call]);
    named["keychainGuard"] = {
      programs,
      reaches,
      wraps: (fn: unknown) => typeof fn === "function" && wrappers.has(fn),
      take: () => state.calls.splice(0),
      refusal,
    };
    return { ...named, default: named };
  }

  return { state, guarded, refusal };
});

vi.mock("node:child_process", async (importOriginal) =>
  guard.guarded(await importOriginal<typeof import("node:child_process")>()),
);
// vitest names both spellings as one module; this line keeps the bare one guarded if that ever changes
vi.mock("child_process", async (importOriginal) =>
  guard.guarded(await importOriginal<typeof import("node:child_process")>()),
);

/** A row's name as vitest reports it: its file, its describes, its own name. */
function rowName(task: TestContext["task"]): string {
  const names = [task.name];
  for (let suite = task.suite; suite !== undefined && !("filepath" in suite); suite = suite.suite) {
    names.unshift(suite.name);
  }
  return [task.file.name, ...names].join(" > ");
}

beforeEach((context) => {
  guard.state.row = rowName(context.task);
});

afterEach((context) => {
  const row = rowName(context.task);
  guard.state.row = null;
  const made = guard.state.calls.splice(0);
  guard.state.calls.push(...made.filter((call) => call.row !== row));
  const failure = guard.refusal(
    `the row "${row}"`,
    made.filter((call) => call.row === row),
  );
  if (failure !== undefined) throw failure;
});

afterAll(() => {
  const failure = guard.refusal(
    "a call outside any row (a beforeAll or afterAll, the file's top level, or one still going after its row)",
    guard.state.calls.splice(0),
  );
  if (failure !== undefined) throw failure;
});
