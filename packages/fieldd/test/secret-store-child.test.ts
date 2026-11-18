import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentExtensionStore } from "../src/agent-extension-store";
import { RpcCallError } from "../src/native-link";
import { createDarwinSecretStore, type SecretToolCall } from "../src/plugin-settings";

// Item 542 (2026-11-18): a secret store's child process. No row here runs the real keychain tool: each hands the
// store a stub of its own, written into the row's own folder and named by its absolute path, which the row checks
// before the store is made; the store's default tool is read from a recording runner and never run.

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
    const { store: secrets, read, root } = await stubbed();
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
});
