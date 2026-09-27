import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentExtensionStore, EXTENSION_VALUES_SERVICE } from "../src/agent-extension-store";
import type { SecretStore } from "../src/plugin-settings";

// AR-S4d — what a profile keeps once for its agents: definitions and value
// NAMES in a 0600 file, the values in a keychain entry (a map, faked here —
// no test opens the real keychain), and which names each agent was given.

let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

function memoryKeychain() {
  const entries = new Map<string, string>();
  const secrets: SecretStore = {
    get: vi.fn(async (service, account) => entries.get(`${service}\u0000${account}`) ?? null),
    set: vi.fn(async (service, account, value) => {
      entries.set(`${service}\u0000${account}`, value);
    }),
    delete: vi.fn(async (service, account) => {
      entries.delete(`${service}\u0000${account}`);
    }),
  };
  return {
    secrets,
    entry: (account: string) => entries.get(`${EXTENSION_VALUES_SERVICE}\u0000${account}`),
  };
}

async function setup() {
  dir = await mkdtemp(join(tmpdir(), "fieldd-extension-store-"));
  const keychain = memoryKeychain();
  const store = new AgentExtensionStore({
    dir,
    secrets: keychain.secrets,
    now: () => new Date("2026-09-27T10:00:00.000Z"),
  });
  return { store, keychain, dir };
}

const CONTEXT7 = {
  transport: "stdio" as const,
  command: "npx",
  args: ["-y", "@upstash/context7-mcp"],
  env: ["CONTEXT7_API_KEY"],
};

describe("AgentExtensionStore", () => {
  it("keeps a definition and the names of its values in a file only its user reads, the values in the keychain", async () => {
    const { store, keychain, dir } = await setup();
    await expect(store.read("work")).resolves.toEqual({
      version: 1,
      servers: {},
      values: [],
      given: {},
    });
    await store.keep("work", "context7", CONTEXT7);
    await store.keepValues("work", { CONTEXT7_API_KEY: "ctx7_secret_value" });

    const file = join(dir, "work.json");
    const text = await readFile(file, "utf8");
    expect(JSON.parse(text)).toEqual({
      version: 1,
      servers: { context7: { definition: CONTEXT7, keptAt: "2026-09-27T10:00:00.000Z" } },
      values: ["CONTEXT7_API_KEY"],
      given: {},
    });
    expect(text).not.toContain("ctx7_secret_value");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(keychain.entry("work")!)).toEqual({ CONTEXT7_API_KEY: "ctx7_secret_value" });

    // a second value joins the first in the one entry
    await store.keepValues("work", { LINEAR_API_KEY: "lin_api_value" });
    expect(JSON.parse(keychain.entry("work")!)).toEqual({
      CONTEXT7_API_KEY: "ctx7_secret_value",
      LINEAR_API_KEY: "lin_api_value",
    });
    // another store over the same folder reads what the first wrote
    const again = new AgentExtensionStore({ dir, secrets: keychain.secrets });
    await expect(again.read("work")).resolves.toMatchObject({
      values: ["CONTEXT7_API_KEY", "LINEAR_API_KEY"],
    });
  });

  it("gives an agent only the values of the servers it was given, and opens the keychain for nothing else", async () => {
    const { store, keychain } = await setup();
    await expect(store.launchValues("work", "codex")).resolves.toBeUndefined();
    expect(keychain.secrets.get).not.toHaveBeenCalled();

    await store.keepValues("work", {
      CONTEXT7_API_KEY: "ctx7_secret_value",
      LINEAR_API_KEY: "lin_api_value",
    });
    await store.give("work", "codex", "context7", ["CONTEXT7_API_KEY"]);
    await expect(store.launchValues("work", "codex")).resolves.toEqual({
      CONTEXT7_API_KEY: "ctx7_secret_value",
    });
    // Claude was given nothing here: it is started with nothing
    await expect(store.launchValues("work", "claude")).resolves.toBeUndefined();

    // the agent let the server go: its value goes with it
    await store.take("work", "codex", "context7");
    await expect(store.launchValues("work", "codex")).resolves.toBeUndefined();
    await expect(store.read("work")).resolves.toMatchObject({ given: {} });
  });

  it("forgets a deleted profile's keep and its keychain entry, and takes only an Agent Profile's id", async () => {
    const { store, keychain, dir } = await setup();
    await store.keep("work", "context7", CONTEXT7);
    await store.keepValues("work", { CONTEXT7_API_KEY: "ctx7_secret_value" });
    await store.forgetProfile("work");
    expect(keychain.entry("work")).toBeUndefined();
    await expect(stat(join(dir, "work.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(store.read("work")).resolves.toMatchObject({ servers: {}, values: [] });

    await expect(store.keep("../elsewhere", "context7", CONTEXT7)).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
    });
    await expect(store.launchValues("../elsewhere", "codex")).resolves.toBeUndefined();
  });

  it("makes one change at a time per profile, so two values kept together are both kept", async () => {
    const { store, keychain } = await setup();
    await Promise.all([
      store.keepValues("work", { A_KEY: "a" }),
      store.keepValues("work", { B_KEY: "b" }),
      store.give("work", "codex", "one", ["A_KEY"]),
      store.give("work", "codex", "two", ["B_KEY"]),
    ]);
    expect(JSON.parse(keychain.entry("work")!)).toEqual({ A_KEY: "a", B_KEY: "b" });
    await expect(store.read("work")).resolves.toMatchObject({
      values: ["A_KEY", "B_KEY"],
      given: { codex: { one: ["A_KEY"], two: ["B_KEY"] } },
    });
  });
});
