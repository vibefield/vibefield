import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentSessionRecord, LAYOUT } from "@vibefield/contracts";
import type { AgentHost } from "@vibefield/puppeteer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IndexService } from "../src/agent-index";
import { AgentRuntimeService } from "../src/agent-runtime";
import { SessionRecordStore } from "../src/agent-sessions";
import type { SecretStore } from "../src/plugin-settings";

// EY-2 (2b, 2026-11-19) — a run's record forgotten (its persona removed) is told to whatever fieldd keeps for that run,
// its pages' stills among them: once per run, and nothing for a record under another persona. It boots no daemon and
// starts no program: every node:child_process member is counted and throws, and each row asserts the count is 0.

const seen = vi.hoisted(() => ({ programs: 0 }));

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

/** A run's record as the runtime writes one, under a persona. */
function runRecord(runtimeRunId: string, profileId: string): AgentSessionRecord {
  const at = new Date().toISOString();
  return {
    format: 1,
    runtimeRunId,
    runtimeEpoch: 1,
    provider: "scripted",
    cwd: "/",
    terminalSessionId: `pty-${runtimeRunId}`,
    continuation: { providerId: "scripted", nativeSessionId: `native-${runtimeRunId}` },
    profileId,
    createdAt: at,
    updatedAt: at,
  };
}

/** A runtime on a root of its own, and the records' store it reads, written by this row. */
async function runtime() {
  const root = mkdtempSync(join(tmpdir(), "vf-forgotten-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "bin"));
  const refuse = () => {
    throw new Error("this row's host starts no terminal");
  };
  const service = new AgentRuntimeService({
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
  });
  cleanup.push(() => service.dispose());
  // the personas' background read settles before the row
  await new Promise((resolve) => setTimeout(resolve, 50));
  const records = new SessionRecordStore({
    dir: join(root, ...LAYOUT.AGENT_SESSIONS_DIR),
    keyPath: join(root, ...LAYOUT.AGENT_SESSIONS_KEY_FILE),
    now: () => new Date(),
  });
  return { service, records };
}

describe("EY-2: a run's record forgotten is told", () => {
  it("once for each run under the removed persona, and nothing for a record under another", async () => {
    const { service, records } = await runtime();
    records.write(runRecord("run-a", "p-gone"));
    records.write(runRecord("run-b", "p-gone"));
    records.write(runRecord("run-c", "p-kept"));
    const told: string[] = [];
    service.onRecordForgotten((run) => told.push(run));
    service.forgetUnder(new Set(["p-gone"]));
    expect(told.sort()).toEqual(["run-a", "run-b"]);
    expect(records.read("run-a")).toBeUndefined();
    expect(records.read("run-b")).toBeUndefined();
    expect(records.read("run-c")?.runtimeRunId).toBe("run-c");
    expect(seen.programs).toBe(0);
  });

  it("a listener that throws is its own fault: the others are still told, and the records still go", async () => {
    const { service, records } = await runtime();
    records.write(runRecord("run-a", "p-gone"));
    const told: string[] = [];
    service.onRecordForgotten(() => {
      throw new Error("a keeper's own fault");
    });
    const stop = service.onRecordForgotten((run) => told.push(run));
    service.forgetUnder(new Set(["p-gone"]));
    expect(told).toEqual(["run-a"]);
    expect(records.read("run-a")).toBeUndefined();
    // a listener that stopped listening hears nothing more
    stop();
    records.write(runRecord("run-d", "p-gone"));
    service.forgetUnder(new Set(["p-gone"]));
    expect(told).toEqual(["run-a"]);
    expect(seen.programs).toBe(0);
  });
});
