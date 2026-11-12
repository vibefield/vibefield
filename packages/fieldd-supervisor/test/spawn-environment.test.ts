import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTRACTS_VERSION } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFielddSupervisor,
  type FielddSupervisorEvent,
  type FielddSupervisorOptions,
  type SupervisorLifecycleEventName,
} from "../src/index";
import { createHarness, FIXTURE_READY, type Harness } from "./helpers";

// ESP-18 (item 341) — `spawnEnvironment`: keys a SPAWN asks for (a packaged app's person's PATH), merged over
// `environment` right before the child is spawned. An adoption never asks; the supervisor's own keys always win; no
// daemon-prefixed key (FIELD_, FIELDD_, VIBEFIELD_, VF_) ever comes through it; and a hook that rejects or does not
// answer in time costs the spawn nothing but one event, which carries no value. The fixture is FIXTURE_READY after
// it writes the few keys a row reads to ENV_OUT. The rows assert by booleans: a red prints no environment (item 320).

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const LAUNCHED = "/usr/bin:/bin";
const ASKED = "/sentinel-341/bin:/usr/bin:/bin";
const UNAVAILABLE: SupervisorLifecycleEventName = "fieldd.supervisor.spawn_environment_unavailable";

/** One key under each daemon prefix, none of which the supervisor sets itself. */
const PREFIXED = [
  "FIELD_SENTINEL_341",
  "FIELDD_SENTINEL_341",
  "VIBEFIELD_SENTINEL_341",
  "VF_SENTINEL_341",
];
const ENV_KEYS = ["PATH", "HOOK_MARK", "FIELDD_DATA_DIR", "FIELDD_USER_ROOT", ...PREFIXED];

/** FIXTURE_READY, after it writes the keys a row reads (and only those) to ENV_OUT. */
const FIXTURE_ENV = `
import { writeFileSync as writeEnvKeys } from "node:fs";
const envKeys = ${JSON.stringify(ENV_KEYS)};
writeEnvKeys(
  process.env.ENV_OUT,
  JSON.stringify(Object.fromEntries(envKeys.map((key) => [key, process.env[key] ?? null]))),
);
${FIXTURE_READY}`;

type Lifecycle = Extract<FielddSupervisorEvent, { kind: "lifecycle" }>;

/** The spawned pid from the supervisor's own line, so a child of a rejected ensure() is still ended. */
function spawnedPid(events: readonly FielddSupervisorEvent[]): number | undefined {
  const spawned = events.find(
    (event): event is Lifecycle =>
      event.kind === "lifecycle" && event.event === "fieldd.supervisor.spawned",
  );
  const pid = spawned?.attrs?.["pid"];
  return typeof pid === "number" ? pid : undefined;
}

function unavailable(events: readonly FielddSupervisorEvent[]): Lifecycle[] {
  return events.filter(
    (event): event is Lifecycle => event.kind === "lifecycle" && event.event === UNAVAILABLE,
  );
}

/** The keys the fixture wrote: what the child was spawned with, of the four a row reads. */
function spawnedWith(root: string): Record<string, string | null> {
  return JSON.parse(readFileSync(join(root, "env.json"), "utf8")) as Record<string, string | null>;
}

async function ensureSpawned(
  root: string,
  events: FielddSupervisorEvent[],
  extra: Partial<FielddSupervisorOptions>,
) {
  const { port, token } = await h.startProduct();
  const script = h.writeFixture(join(root, "fx"), "fieldd.mjs", FIXTURE_ENV);
  const supervisor = h.track(
    createFielddSupervisor({
      dataRoot: root,
      spawn: { command: process.execPath, args: [script] },
      environment: {
        CV: CONTRACTS_VERSION,
        PATH: LAUNCHED,
        ENV_OUT: join(root, "env.json"),
        TEST_PRODUCT_PORT: String(port),
        SHELL_TOKEN: token,
      },
      shutdownPolicy: "leave-running",
      adoptProbeMs: 800,
      readinessDeadlineMs: 3000,
      onEvent: (event) => events.push(event),
      ...extra,
    }),
  );
  const handle = await supervisor.ensure().finally(() => h.trackPid(spawnedPid(events)));
  h.trackPid(handle.childPid);
  return handle;
}

describe("spawnEnvironment — keys a spawn asks for (ESP-18, item 341)", () => {
  it("a spawn awaits it, and the child is spawned with its keys", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    let asked = 0;
    const handle = await ensureSpawned(root, events, {
      spawnEnvironment: async () => {
        asked += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        return { PATH: ASKED, HOOK_MARK: "asked" };
      },
    });
    const keys = spawnedWith(root);
    expect(asked === 1).toBe(true);
    expect(handle.ownership === "spawned").toBe(true);
    expect(keys["PATH"] === ASKED && keys["HOOK_MARK"] === "asked").toBe(true);
    expect(unavailable(events).length === 0).toBe(true);
  });

  it("an adoption never asks it", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, { port, pid: process.pid, token });
    let asked = 0;
    const supervisor = h.track(
      createFielddSupervisor({
        dataRoot: root,
        // an adoption never reaches the spawn: an inert command, as adopt.test.ts's
        spawn: { command: process.execPath, args: ["--eval", ""] },
        environment: {},
        shutdownPolicy: "leave-running",
        adoptProbeMs: 800,
        readinessDeadlineMs: 3000,
        spawnEnvironment: async () => {
          asked += 1;
          return { PATH: ASKED };
        },
      }),
    );
    const handle = await supervisor.ensure();
    expect(handle.ownership === "adopted").toBe(true);
    expect(asked === 0).toBe(true);
  });

  it("its answer never overrides the supervisor's own keys", async () => {
    const root = h.mkRoot();
    const elsewhere = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    let asked = 0;
    await ensureSpawned(root, events, {
      spawnEnvironment: async () => {
        asked += 1;
        return { PATH: ASKED, FIELDD_DATA_DIR: elsewhere, FIELDD_USER_ROOT: elsewhere };
      },
    });
    const keys = spawnedWith(root);
    expect(asked === 1).toBe(true);
    expect(keys["PATH"] === ASKED).toBe(true);
    expect(keys["FIELDD_DATA_DIR"] === root && keys["FIELDD_USER_ROOT"] === root).toBe(true);
  });

  it("its answer never puts a daemon-prefixed key into fieldd's environment", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    let asked = 0;
    await ensureSpawned(root, events, {
      spawnEnvironment: async () => {
        asked += 1;
        return {
          PATH: ASKED,
          HOOK_MARK: "asked",
          ...Object.fromEntries(PREFIXED.map((key) => [key, "from-the-hook"])),
        };
      },
    });
    const keys = spawnedWith(root);
    expect(asked === 1).toBe(true);
    expect(keys["PATH"] === ASKED && keys["HOOK_MARK"] === "asked").toBe(true);
    expect(PREFIXED.every((key) => keys[key] === null)).toBe(true);
  });

  it("a rejecting hook: the spawn goes on with `environment`, one event, no value", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    let asked = 0;
    const handle = await ensureSpawned(root, events, {
      spawnEnvironment: async () => {
        asked += 1;
        throw new Error("sentinel-341: the login shell could not be asked");
      },
    });
    const keys = spawnedWith(root);
    const said = unavailable(events);
    expect(asked === 1).toBe(true);
    expect(handle.ownership === "spawned").toBe(true);
    expect(keys["PATH"] === LAUNCHED && keys["HOOK_MARK"] === null).toBe(true);
    expect(said.length === 1).toBe(true);
    expect(
      Object.keys(said[0]?.attrs ?? {})
        .sort()
        .join(",") === "ms,why",
    ).toBe(true);
    expect(said[0]?.attrs?.["why"] === "rejected").toBe(true);
    expect(JSON.stringify(events).includes("sentinel-341")).toBe(false);
  });

  it("a hook past its time: the spawn goes on with `environment`, and one event", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    let asked = 0;
    const handle = await ensureSpawned(root, events, {
      spawnEnvironment: () => {
        asked += 1;
        return new Promise<never>(() => undefined);
      },
      spawnEnvironmentMs: 150,
    });
    const keys = spawnedWith(root);
    const said = unavailable(events);
    expect(asked === 1).toBe(true);
    expect(handle.ownership === "spawned").toBe(true);
    expect(keys["PATH"] === LAUNCHED && keys["HOOK_MARK"] === null).toBe(true);
    expect(said.length === 1).toBe(true);
    expect(
      Object.keys(said[0]?.attrs ?? {})
        .sort()
        .join(",") === "ms,why",
    ).toBe(true);
    expect(said[0]?.attrs?.["why"] === "deadline").toBe(true);
    expect(typeof said[0]?.attrs?.["ms"] === "number").toBe(true);
  });
});
