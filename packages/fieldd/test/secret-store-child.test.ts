import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentExtensionStore, KEPT_VALUES_UNREADABLE } from "../src/agent-extension-store";
import { RpcCallError } from "../src/native-link";
import {
  createDarwinSecretStore,
  type SecretToolCall,
  SecretToolError,
} from "../src/plugin-settings";

// Item 542 (2026-11-18): a secret store's child process. No row here runs the real keychain tool: each hands the
// store a stub of its own, written into the row's own folder and named by its absolute path, which the row checks
// before the store is made. The rows that read the calls themselves hand the store a recording runner, which runs
// nothing: the store's default tool is read from it and never run.

const VALUE = 'a 542 value with spaces, "quotes" and ünïcode';
const SERVICE = "vibefield.plugin.probe";

// The stub records each call: its arguments one per line, its environment, its stdin, and the call's first argument
// on a line of its "calls" file. It answers a read with a fixed word. A word in its folder's "mode" file changes that:
// "slow" takes 3 s over a read (past a row's 300 ms limit), "absent" answers a read with the tool's not-found exit
// (44), and "refuse" fails every call (51).
const STUB = `#!/bin/sh
here=$(/usr/bin/dirname "$0")
printf '%s\\n' "$@" > "$here/args"
/usr/bin/env > "$here/env"
/bin/cat > "$here/stdin"
printf '%s\\n' "$1" >> "$here/calls"
mode=$(/bin/cat "$here/mode" 2>/dev/null)
case "$1:$mode" in
  find-generic-password:slow) exec /bin/sleep 3 ;;
  find-generic-password:absent) exit 44 ;;
  *:refuse) exit 51 ;;
esac
if [ "$1" = find-generic-password ]; then printf 'stub-answer\\n'; fi
exit 0
`;

let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
  delete process.env.FIELDD_ITEM542_PROBE;
});

/** The store's options, and the limit a row hands it. */
type StoreOptions = NonNullable<Parameters<typeof createDarwinSecretStore>[0]> & {
  timeoutMs?: number;
};

async function stubbed(mode?: "slow" | "absent" | "refuse") {
  const root = await mkdtemp(join(tmpdir(), "fieldd-secret-child-"));
  dir = root;
  const executable = join(root, "security");
  await writeFile(executable, STUB, { mode: 0o700 });
  if (mode !== undefined) await writeFile(join(root, "mode"), mode);
  // the store is pointed at this stub, in this row's own folder, and at nothing else
  expect(executable.startsWith(`${root}/`)).toBe(true);
  // a slow stub meets a 300 ms limit (`timeoutMs`, which the store reads from the green on); every other row keeps
  // the store's own
  const options: StoreOptions = { executable, platform: "darwin" };
  if (mode === "slow") options.timeoutMs = 300;
  const store = createDarwinSecretStore(options);
  const read = (name: "args" | "env" | "stdin" | "calls") => readFile(join(root, name), "utf8");
  return { store, read, root };
}

/** The refusal a call rejected with: its kind, its details' state, and everything it says. */
async function refusal(
  call: Promise<unknown>,
): Promise<{ kind: string; state: unknown; text: string }> {
  const error = await call.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(RpcCallError);
  const rpc = error as RpcCallError;
  const details = rpc.details as { state?: unknown } | undefined;
  return {
    kind: rpc.kind,
    state: details?.state,
    text: `${rpc.message} ${JSON.stringify(details)}`,
  };
}

const names = (env: string): string[] => env.split("\n").map((line) => line.split("=")[0] ?? "");

// The longest stdin line the keychain tool was seen to keep whole, its line break included (item 542's probes,
// 2026-11-18): the store hands it no longer one.
const LINE_MAX = 4096;

// What a person reads when a value is refused for its length: with the limit it names when the call's own limit
// reaches it, and without a number when long names leave less.
const TOO_LONG = "Couldn't save to your keychain: these values are too long to keep together";
const TOO_LONG_NAMED = `${TOO_LONG} (about 1,900 characters at most). Nothing was changed.`;
const TOO_LONG_UNNAMED = `${TOO_LONG}. Nothing was changed.`;

/** A store whose calls are recorded and never run: a read hands back `read`, or finds no item (the tool's not-found
 * exit, 44) when it is not given; every other call succeeds. (Item 548, 2026-11-18: a read answered an empty text,
 * which the tool never hands back for an item fieldd wrote; a profile's kept entry read so is not whole, and a save
 * over it is refused.) */
function recorded(read?: string) {
  const calls: SecretToolCall[] = [];
  const store = createDarwinSecretStore({
    platform: "darwin",
    run: async (call) => {
      calls.push(call);
      if (call.args[0] === "find-generic-password") {
        if (read === undefined) throw new SecretToolError(44, false);
        return { stdout: read };
      }
      return { stdout: "" };
    },
  });
  return { store, calls };
}

describe("a secret store's child process (item 542)", () => {
  it("is handed a value on its stdin, and none of its arguments holds it", async () => {
    const { store, read } = await stubbed();
    await store.set(SERVICE, "token", VALUE);
    expect(await read("args")).not.toContain(VALUE);
    const stdin = await read("stdin");
    const hex = Buffer.from(VALUE, "utf8").toString("hex");
    expect(stdin.includes(VALUE) || stdin.toLowerCase().includes(hex)).toBe(true);
  });

  it("holds the value in no entry of its environment, and no FIELD_ or FIELDD_ name, on every call", async () => {
    process.env.FIELDD_ITEM542_PROBE = "fieldd's own";
    const { store, read } = await stubbed();
    await store.set(SERVICE, "token", VALUE);
    const setEnv = await read("env");
    expect(setEnv).not.toContain(VALUE);
    expect(names(setEnv).filter((name) => /^FIELDD?_/u.test(name))).toEqual([]);
    expect(await store.get(SERVICE, "token")).toBe("stub-answer");
    expect(names(await read("env")).filter((name) => /^FIELDD?_/u.test(name))).toEqual([]);
    await store.delete(SERVICE, "token");
    expect(names(await read("env")).filter((name) => /^FIELDD?_/u.test(name))).toEqual([]);
  });

  it("runs /usr/bin/security by its absolute path unless it is handed another", async () => {
    const calls: SecretToolCall[] = [];
    const store = createDarwinSecretStore({
      platform: "darwin",
      run: async (call) => {
        calls.push(call);
        return { stdout: "" };
      },
    });
    await store.set(SERVICE, "token", VALUE);
    await store.get(SERVICE, "token");
    await store.delete(SERVICE, "token");
    expect(calls.map((call) => call.executable)).toEqual([
      "/usr/bin/security",
      "/usr/bin/security",
      "/usr/bin/security",
    ]);
    expect(calls.some((call) => call.args.some((arg) => arg.includes(VALUE)))).toBe(false);
  });

  it("holds a profile's server values out of its arguments too", async () => {
    // a profile that keeps no values yet: the keychain holds no entry for it (item 548, 2026-11-18: the stub's read
    // word is no entry fieldd writes, and a save over it is refused)
    const { store: secrets, read, root } = await stubbed("absent");
    const extensions = join(root, "extensions");
    await mkdir(extensions);
    const store = new AgentExtensionStore({
      dir: extensions,
      skillsDir: join(root, "skills"),
      home: join(root, "home"),
      secrets,
    });
    await store.keepValues("work", { A_TOKEN: "a-542-token-one", B_TOKEN: "b-542-token-two" });
    const args = await read("args");
    expect(args).not.toContain("a-542-token-one");
    expect(args).not.toContain("b-542-token-two");
    expect(await read("stdin")).not.toBe("");
  });

  it("refuses a read the keychain does not finish in time, never answering it as no secret", async () => {
    const { store } = await stubbed("slow");
    const said = await refusal(store.get(SERVICE, "token"));
    expect(said.kind).toBe("UNAVAILABLE");
    expect(said.state).toBe("no-answer");
  });

  it("answers a read the keychain says it does not hold as no secret, and refuses any other failure", async () => {
    const absent = await stubbed("absent");
    expect(await absent.store.get(SERVICE, "token")).toBeNull();
    await rm(absent.root, { recursive: true, force: true });
    const refused = await stubbed("refuse");
    const said = await refusal(refused.store.get(SERVICE, "token"));
    expect(said.kind).toBe("UNAVAILABLE");
    expect(said.state).toBe("refused");
    // the refusal says nothing of the call: neither its arguments nor what it was handed
    expect(said.text).not.toContain(SERVICE);
    expect(said.text).not.toContain("find-generic-password");
  });

  it("keeps a profile's server values whole when the keychain does not answer: nothing is written", async () => {
    const { store: secrets, read, root } = await stubbed("slow");
    const extensions = join(root, "extensions");
    await mkdir(extensions);
    const store = new AgentExtensionStore({
      dir: extensions,
      skillsDir: join(root, "skills"),
      home: join(root, "home"),
      secrets,
    });
    const said = await refusal(store.keepValues("work", { C_TOKEN: "c-542-token-three" }));
    expect(said.state).toBe("no-answer");
    expect((await read("calls")).split("\n").filter(Boolean)).toEqual(["find-generic-password"]);
  });

  it("says a failed set without its value, or anything else of the call", async () => {
    const { store } = await stubbed("refuse");
    const said = await refusal(store.set(SERVICE, "token", VALUE));
    expect(said.kind).toBe("UNAVAILABLE");
    expect(said.state).toBe("refused");
    expect(said.text).not.toContain(VALUE);
    expect(said.text).not.toContain(SERVICE);
    expect(said.text).not.toContain("add-generic-password");
  });

  it("hands its tool a stdin line of at most 4,096 bytes, and refuses a longer one before any call", async () => {
    // a line is 67 bytes under SERVICE and "token" (68 under "tokens") and twice the value's bytes, its line break
    // included: so one line lands on the limit, and the other one byte past it
    const at = recorded();
    await at.store.set(SERVICE, "tokens", "v".repeat((LINE_MAX - 68) / 2));
    expect(at.calls).toHaveLength(1);
    expect(Buffer.byteLength(at.calls[0]?.input ?? "")).toBe(LINE_MAX);
    const past = recorded();
    const said = await refusal(
      past.store.set(SERVICE, "token", "v".repeat((LINE_MAX + 1 - 67) / 2)),
    );
    expect(said.kind).toBe("PRECONDITION_FAILED");
    expect(past.calls).toEqual([]);
    expect(said.text).toContain(TOO_LONG_NAMED);
    // a 300-byte name leaves 1,867 bytes of value: the refusal names no limit
    const long = recorded();
    const unnamed = await refusal(long.store.set(SERVICE, "k".repeat(300), "v".repeat(1900)));
    expect(unnamed.kind).toBe("PRECONDITION_FAILED");
    expect(long.calls).toEqual([]);
    expect(unnamed.text).toContain(TOO_LONG_UNNAMED);
    expect(unnamed.text).not.toContain("1,900");
  });

  it("refuses a profile's server values whose line would pass that length, and writes nothing", async () => {
    const { store: secrets, calls } = recorded();
    const root = await mkdtemp(join(tmpdir(), "fieldd-secret-child-"));
    dir = root;
    const extensions = join(root, "extensions");
    await mkdir(extensions);
    const store = new AgentExtensionStore({
      dir: extensions,
      skillsDir: join(root, "skills"),
      home: join(root, "home"),
      secrets,
    });
    const said = await refusal(store.keepValues("work", { D_TOKEN: "d".repeat(LINE_MAX) }));
    expect(said.kind).toBe("PRECONDITION_FAILED");
    expect(said.text).toContain(TOO_LONG_NAMED);
    expect(calls.map((call) => call.args[0])).toEqual(["find-generic-password"]);
  });

  it("refuses a profile's server values over a kept entry it cannot read before their length, and writes nothing", async () => {
    // item 548, 2026-11-18: a kept entry that is neither JSON nor the tool's hex of it (one cut off). An entry not
    // read whole is refused before any write, and at any length, so that refusal is the one a person reads, and the
    // length's words are not said.
    const { store: secrets, calls } = recorded('{"A_TOKEN":"a-548\n');
    const root = await mkdtemp(join(tmpdir(), "fieldd-secret-child-"));
    dir = root;
    const extensions = join(root, "extensions");
    await mkdir(extensions);
    const store = new AgentExtensionStore({
      dir: extensions,
      skillsDir: join(root, "skills"),
      home: join(root, "home"),
      secrets,
    });
    const said = await refusal(store.keepValues("work", { D_TOKEN: "d".repeat(LINE_MAX) }));
    expect(said.kind).toBe("PRECONDITION_FAILED");
    expect(said.text).toContain(KEPT_VALUES_UNREADABLE);
    expect(said.text).not.toContain(TOO_LONG);
    expect(calls.map((call) => call.args[0])).toEqual(["find-generic-password"]);
  });

  it("refuses before any call an empty value, or a name outside printable ASCII or holding a double quote or a backslash", async () => {
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      [SERVICE, "token", ""],
      [`${SERVICE}"`, "token", "a-542-value"],
      [SERVICE, "to\\ken", "a-542-value"],
      [SERVICE, "to\nken", "a-542-value"],
      [SERVICE, "to\tken", "a-542-value"],
      [`${SERVICE}é`, "token", "a-542-value"],
    ];
    for (const [service, account, value] of cases) {
      const { store, calls } = recorded();
      const said = await refusal(store.set(service, account, value));
      expect(said.kind).toBe("PRECONDITION_FAILED");
      expect(calls).toEqual([]);
    }
  });

  it("runs its tool with HOME and a fixed PATH in its environment, and nothing else", async () => {
    process.env.FIELDD_ITEM542_PROBE = "fieldd's own";
    const { store, calls } = recorded();
    await store.set(SERVICE, "token", "a-542-value");
    await store.get(SERVICE, "token");
    await store.delete(SERVICE, "token");
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.env).toEqual({ HOME: process.env.HOME, PATH: "/usr/bin:/bin" });
    }
  });
});
