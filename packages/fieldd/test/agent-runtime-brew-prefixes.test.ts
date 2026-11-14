import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentHost } from "@vibefield/puppeteer-core";
import type { AgentRuntimeOptions } from "@vibefield/puppeteer-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IndexService } from "../src/agent-index";
import { AgentRuntimeService } from "../src/agent-runtime";
import type { SecretStore } from "../src/plugin-settings";

// RV item 354, F1's second half (R-c) — the Homebrew prefixes a fieldd's harness names reach puppeteer's install
// inventory: the runtime fieldd builds is handed them as `distribution.brewPrefixes`, and nothing when none is named
// (puppeteer's default, the machine's own Homebrew, a person's app wants listed). It boots no daemon and starts no
// program. puppeteer's own runtime is built, and each construction's options are kept. Every node:child_process
// member is counted and throws, and each row asserts the count is 0: the service reads its personas in the
// background and logs a failure there rather than throwing it.

const seen = vi.hoisted(() => ({ options: [] as AgentRuntimeOptions[], programs: 0 }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const strict: Record<string, unknown> = Object.fromEntries(
    Object.keys(actual).map((name) => [
      name,
      () => {
        seen.programs += 1;
        throw new Error(`child_process.${name} is not mocked`);
      },
    ]),
  );
  return { ...strict, default: strict };
});

vi.mock("@vibefield/puppeteer-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vibefield/puppeteer-runtime")>();
  return {
    ...actual,
    createAgentRuntime: (options: AgentRuntimeOptions) => {
      seen.options.push(options);
      return actual.createAgentRuntime(options);
    },
  };
});

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

/** A keychain in a map, so this row never reaches the machine's. */
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

type Distribution = NonNullable<AgentRuntimeOptions["distribution"]>;

/** The distribution options puppeteer's runtime was built with, by a service named `prefixes` (or none). */
async function distributionFor(prefixes: readonly string[] | undefined): Promise<Distribution> {
  const root = mkdtempSync(join(tmpdir(), "vf-brew-rc-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "bin"));
  const refuse = () => {
    throw new Error("this row's host starts no terminal");
  };
  const options = {
    userRoot: root,
    vibefieldRoot: null,
    index: {} as unknown as IndexService,
    supervisor: null,
    host: { spawnTerminal: refuse, automateTerminal: refuse } as unknown as AgentHost,
    providers: () => [],
    home: root,
    searchPath: join(root, "bin"),
    installHome: root,
    secretStore: memoryKeychain(),
  };
  // set on the object, never in its literal: this row compiles before the option exists (its red)
  if (prefixes !== undefined) Object.assign(options, { brewPrefixes: prefixes });
  const before = seen.options.length;
  const service = new AgentRuntimeService(options);
  cleanup.push(() => service.dispose());
  // the personas' background read settles before the count is taken
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(seen.options.length, "puppeteer's runtime was built once").toBe(before + 1);
  expect(seen.programs, "a program was started").toBe(0);
  return seen.options[before]?.distribution ?? {};
}

describe("the Homebrew prefixes reach puppeteer's install inventory (RV item 354, F1's second half)", () => {
  it("hands none when the harness names none, so puppeteer keeps its own default", async () => {
    const distribution = await distributionFor(undefined);
    expect("brewPrefixes" in distribution, "a brewPrefixes key was handed").toBe(false);
    // the seams beside it are as they were
    expect(typeof distribution.searchPath).toBe("string");
    expect(typeof distribution.home).toBe("string");
  });

  it("hands the harness's list as it is named", async () => {
    const distribution = await distributionFor(["/stand-in/brew-a", "/stand-in/brew-b"]);
    expect(distribution.brewPrefixes).toEqual(["/stand-in/brew-a", "/stand-in/brew-b"]);
  });

  it("hands an empty list as empty, so a harness's fieldd probes no prefix", async () => {
    const distribution = await distributionFor([]);
    expect(distribution.brewPrefixes).toEqual([]);
  });
});
