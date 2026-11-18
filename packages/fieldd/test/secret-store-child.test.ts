import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentExtensionStore } from "../src/agent-extension-store";
import { createDarwinSecretStore, type SecretToolCall } from "../src/plugin-settings";

// Item 542 (2026-11-18): a secret store's child process. No row here runs the real keychain tool: each hands the
// store a stub of its own, written into the row's own folder and named by its absolute path, which the row checks
// before the store is made; the store's default tool is read from a recording runner and never run.

const VALUE = 'a 542 value with spaces, "quotes" and ünïcode';
const SERVICE = "vibefield.plugin.probe";

// The stub records each call: its arguments one per line, its environment, and its stdin. It answers a read with a
// fixed word.
const STUB = `#!/bin/sh
here=$(/usr/bin/dirname "$0")
printf '%s\\n' "$@" > "$here/args"
/usr/bin/env > "$here/env"
/bin/cat > "$here/stdin"
if [ "$1" = find-generic-password ]; then printf 'stub-answer\\n'; fi
exit 0
`;

let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
  delete process.env.FIELDD_ITEM542_PROBE;
});

async function stubbed() {
  const root = await mkdtemp(join(tmpdir(), "fieldd-secret-child-"));
  dir = root;
  const executable = join(root, "security");
  await writeFile(executable, STUB, { mode: 0o700 });
  // the store is pointed at this stub, in this row's own folder, and at nothing else
  expect(executable.startsWith(`${root}/`)).toBe(true);
  const store = createDarwinSecretStore({ executable, platform: "darwin" });
  const read = (name: "args" | "env" | "stdin") => readFile(join(root, name), "utf8");
  return { store, read, root };
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
});
