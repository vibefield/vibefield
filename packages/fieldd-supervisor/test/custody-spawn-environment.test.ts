import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTRACTS_VERSION, CUSTODY, type CustodyHandoff } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFielddSupervisor,
  type FielddSupervisorEvent,
  type FielddSupervisorOptions,
  type SupervisorError,
  type SupervisorLifecycleEventName,
} from "../src/index";
import {
  createHarness,
  FIXTURE_READY,
  FIXTURE_SEALED,
  type Harness,
  readSealedObserved,
  sealedObservePath,
  waitDead,
} from "./helpers";

// OB custody meets ESP-18 (item 341) — one spawn carries both: the keys it asks for (`spawnEnvironment`, a packaged
// app's person's PATH) and its custody (`custody`, the hand-off on stdin under FIELDD_CUSTODY=stdin). Neither change
// knew the other, so neither has these rows. They hold four things of the joined spawn:
//  · the asked keys reach a sealed child, and the flag is the supervisor's own whatever the hook answered;
//  · the ask is over before the spawner's clock starts, so a hook that never answers costs its wait and no more;
//  · a hook that throws changes nothing of the hand-off, and the one event it costs says nothing of either;
//  · a hook can neither set the flag on a spawn handed no custody nor write under it on one that was.
// The children are helpers' FIXTURE_SEALED and FIXTURE_READY, each after it writes the three keys a row reads to
// ENV_OUT. The rows assert by booleans: a red prints no environment and no hand-off (item 320).

const HANDOFF: CustodyHandoff = {
  v: 1,
  shell: "d6".repeat(32),
  pairing: "e7".repeat(32),
  records: "f8".repeat(32),
};
const SECRETS = [HANDOFF.shell, HANDOFF.pairing, HANDOFF.records];
const LINE_SHA256 = createHash("sha256").update(JSON.stringify(HANDOFF), "utf8").digest("hex");

const LAUNCHED = "/usr/bin:/bin";
const ASKED = "/sentinel-join/bin:/usr/bin:/bin";
/** The hook's time in the row that waits it out (the product's is 5 s; the supervisor's own clock is faked there). */
const ASK_MS = 3_000;
const UNAVAILABLE: SupervisorLifecycleEventName = "fieldd.supervisor.spawn_environment_unavailable";

const ENV_KEYS = ["PATH", "HOOK_MARK", CUSTODY.ENV];
/** Prefixed to a fixture: the three keys a row reads (and only those), written to ENV_OUT before anything else. */
const WRITES_ENV = `
import { writeFileSync as writeEnvKeys } from "node:fs";
const envKeys = ${JSON.stringify(ENV_KEYS)};
writeEnvKeys(
  process.env.ENV_OUT,
  JSON.stringify(Object.fromEntries(envKeys.map((key) => [key, process.env[key] ?? null]))),
);
`;
const FIXTURE_ENV_SEALED = `${WRITES_ENV}${FIXTURE_SEALED}`;
const FIXTURE_ENV_READY = `${WRITES_ENV}${FIXTURE_READY}`;

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

type Lifecycle = Extract<FielddSupervisorEvent, { kind: "lifecycle" }>;

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

const notOurs = (event: FielddSupervisorEvent): boolean =>
  event.kind === "lifecycle" && event.event === "fieldd.supervisor.child_not_ours";
const handed = (event: FielddSupervisorEvent): boolean =>
  event.kind === "lifecycle" && event.event === "fieldd.supervisor.custody_handed";

/** The keys the fixture wrote: what the child was spawned with, of the three a row reads. */
function spawnedWith(root: string): Record<string, string | null> {
  return JSON.parse(readFileSync(join(root, "env.json"), "utf8")) as Record<string, string | null>;
}

/** The attrs' key names, sorted: what an event carries, never what it holds. */
function attrNames(event: Lifecycle | undefined): string {
  return Object.keys(event?.attrs ?? {})
    .sort()
    .join(",");
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A supervisor handed custody, spawning FIXTURE_SEALED under `root`. */
function sealedSup(
  root: string,
  events: FielddSupervisorEvent[],
  extra: Partial<FielddSupervisorOptions>,
) {
  const script = h.writeFixture(join(root, "fx"), "fieldd.mjs", FIXTURE_ENV_SEALED);
  return h.track(
    createFielddSupervisor({
      dataRoot: root,
      spawn: { command: process.execPath, args: [script] },
      environment: {
        CV: CONTRACTS_VERSION,
        PATH: LAUNCHED,
        ENV_OUT: join(root, "env.json"),
        OBSERVE_FILE: sealedObservePath(root),
      },
      shutdownPolicy: "leave-running",
      adoptProbeMs: 300,
      readinessDeadlineMs: 4_000,
      liveness: false,
      custody: { handoff: () => HANDOFF },
      onEvent: (event) => events.push(event),
      ...extra,
    }),
  );
}

/** `ensure()`'s rejection, or null, with the spawned child tracked for cleanup whatever happened. */
async function refusal(
  supervisor: ReturnType<typeof sealedSup>,
  events: FielddSupervisorEvent[],
): Promise<unknown> {
  const outcome = await supervisor.ensure().then(
    (handle) => {
      h.trackPid(handle.childPid);
      return null;
    },
    (error: unknown) => error,
  );
  h.trackPid(spawnedPid(events));
  return outcome;
}

/** The worst a hook's own failure could say: every secret of the hand-off, which no hook is ever handed. */
const throwsEverything = async (): Promise<never> => {
  throw new Error(`sentinel-join ${SECRETS.join(" ")}`);
};

describe("a spawn that asks for its environment and is handed custody (OB custody, ESP-18)", () => {
  it("a sealed spawn takes the asked PATH and keeps its own flag", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    let asked = 0;
    const supervisor = sealedSup(root, events, {
      spawnEnvironment: async () => {
        asked += 1;
        // the flag by its own name, and set to the other level: the hook's word for it is never the child's
        return { PATH: ASKED, HOOK_MARK: "asked", [CUSTODY.ENV]: "files" };
      },
    });
    const handle = await supervisor.ensure().finally(() => h.trackPid(spawnedPid(events)));
    h.trackPid(handle.childPid);
    const keys = spawnedWith(root);
    const seen = readSealedObserved(root);
    expect(asked === 1).toBe(true);
    expect(handle.ownership === "spawned" && handle.info.custody === "sealed").toBe(true);
    expect(keys["PATH"] === ASKED && keys["HOOK_MARK"] === "asked").toBe(true);
    expect(keys[CUSTODY.ENV] === CUSTODY.STDIN && seen.custodyFlag === CUSTODY.STDIN).toBe(true);
    // the hand-off is the one line it always was, and still in no argument and no variable
    expect(seen.handoffSha256 === LINE_SHA256).toBe(true);
    expect(seen.secretInArgv === false && seen.secretInEnv === false).toBe(true);
    expect(unavailable(events).length === 0).toBe(true);
  });

  it("a hook that never answers costs a sealed spawn its wait alone", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    let hookAsked: () => void = () => undefined;
    const hookAskedOnce = new Promise<void>((resolve) => {
      hookAsked = resolve;
    });
    let checkAsked: (pid: number) => void = () => undefined;
    const checkAskedOnce = new Promise<number>((resolve) => {
      checkAsked = resolve;
    });
    let answer: (ours: boolean) => void = () => undefined;
    const custody = {
      handoff: () => HANDOFF,
      // the tool that would say whose code the child is hangs: no answer, no throw
      verifyChild(pid: number): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
          answer = resolve;
          checkAsked(pid);
        });
      },
    };
    let error: unknown;
    let pid = 0;
    try {
      // only the supervisor's own clock is faked: the child is real, and its exit is a real event
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      try {
        const supervisor = sealedSup(root, events, {
          custody,
          spawnEnvironment: () => {
            hookAsked();
            return new Promise<never>(() => undefined);
          },
          spawnEnvironmentMs: ASK_MS,
        });
        const outcome = refusal(supervisor, events);
        await hookAskedOnce;
        // one tick short of the hook's time nothing is spawned: the ask comes before the spawn
        await vi.advanceTimersByTimeAsync(ASK_MS - 1);
        expect(spawnedPid(events) === undefined).toBe(true);
        // at its time the spawn goes on without the hook, and says so once
        await vi.advanceTimersByTimeAsync(1);
        pid = await checkAskedOnce;
        h.trackPid(pid);
        const said = unavailable(events);
        expect(said.length === 1 && said[0]?.attrs?.["why"] === "deadline").toBe(true);
        // the check's budget is counted from the SPAWN: one tick short of it, counted from there, the supervisor is
        // still asking and the child is still there. Counted from the ask, the budget would be long gone
        await vi.advanceTimersByTimeAsync(CUSTODY.CHILD_CHECK_BUDGET_MS - 1);
        expect(events.some(notOurs)).toBe(false);
        expect(alive(pid)).toBe(true);
        // at the budget it stops asking
        await vi.advanceTimersByTimeAsync(1);
        const refused = events.find(notOurs) as Lifecycle | undefined;
        expect(refused?.attrs?.["reason"] === "over-budget").toBe(true);
        error = await outcome;
      } finally {
        vi.useRealTimers();
      }
      expect((error as SupervisorError).kind === "child-not-ours").toBe(true);
      expect(await waitDead(pid)).toBe(true);
      expect(events.some(handed)).toBe(false);
    } finally {
      // a supervisor that is still asking (this row's red) is let go on to its end: nothing outlives the row
      answer(false);
    }
  });

  it("a hook that throws while custody is handed says nothing of either", async () => {
    // the child is handed its custody all the same, and the one event carries a reason and a wait
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    const supervisor = sealedSup(root, events, { spawnEnvironment: throwsEverything });
    const handle = await supervisor.ensure().finally(() => h.trackPid(spawnedPid(events)));
    h.trackPid(handle.childPid);
    const keys = spawnedWith(root);
    const seen = readSealedObserved(root);
    const said = unavailable(events);
    expect(handle.info.custody === "sealed" && seen.handoffSha256 === LINE_SHA256).toBe(true);
    expect(events.some(handed)).toBe(true);
    expect(keys["PATH"] === LAUNCHED && keys["HOOK_MARK"] === null).toBe(true);
    expect(said.length === 1 && said[0]?.attrs?.["why"] === "rejected").toBe(true);
    expect(attrNames(said[0]) === "ms,why").toBe(true);
    const told = JSON.stringify([events, handle.info]);
    expect(SECRETS.some((secret) => told.includes(secret))).toBe(false);
    expect(told.includes("sentinel-join")).toBe(false);

    // and when the attempt fails after it (a child not shown to be ours), the error says nothing of either as well
    const refusedEvents: FielddSupervisorEvent[] = [];
    const refusing = sealedSup(h.mkRoot(), refusedEvents, {
      custody: { handoff: () => HANDOFF, verifyChild: async () => false },
      spawnEnvironment: throwsEverything,
    });
    const error = await refusal(refusing, refusedEvents);
    expect((error as SupervisorError).kind === "child-not-ours").toBe(true);
    const refusedTold = JSON.stringify([refusedEvents, String((error as Error).message)]);
    expect(SECRETS.some((secret) => refusedTold.includes(secret))).toBe(false);
    expect(refusedTold.includes("sentinel-join")).toBe(false);
  });

  it("an asked custody flag is dropped at a spawn handed no custody", async () => {
    // `files`: no provider, so no flag of the supervisor's. A hook naming the flag cannot make the child wait for a
    // hand-off nobody writes: the key is dropped with every other daemon-prefixed key, not merely written over
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    const script = h.writeFixture(join(root, "fx"), "fieldd.mjs", FIXTURE_ENV_READY);
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
        readinessDeadlineMs: 3_000,
        onEvent: (event) => events.push(event),
        spawnEnvironment: async () => ({
          PATH: ASKED,
          HOOK_MARK: "asked",
          [CUSTODY.ENV]: CUSTODY.STDIN,
        }),
      }),
    );
    const handle = await supervisor.ensure().finally(() => h.trackPid(spawnedPid(events)));
    h.trackPid(handle.childPid);
    const keys = spawnedWith(root);
    expect(handle.ownership === "spawned").toBe(true);
    // the hook WAS heard: its other keys are the child's
    expect(keys["PATH"] === ASKED && keys["HOOK_MARK"] === "asked").toBe(true);
    expect(keys[CUSTODY.ENV] === null).toBe(true);
  });

  // A row that reads the source. No hook's answer can show the ORDER by itself: the filter above drops the flag's
  // name before the order is ever asked. So the order is held where it is written: in the one object `spawnFieldd`
  // builds, the base comes first, the asked keys second, and the flag's line is the last entry, under nothing.
  it("the custody flag is the last entry of the spawn environment", () => {
    const source = readFileSync(new URL("../src/supervisor.ts", import.meta.url), "utf8");
    const head = source.indexOf("  function spawnFieldd(");
    const open = source.indexOf("    const env: Record<string, string | undefined> = {\n", head);
    const close = source.indexOf("\n    };\n", open);
    const entries = source
      .slice(open, close)
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("//"));
    const flag = "...(sealed ? { [CUSTODY.ENV]: CUSTODY.STDIN } : {}),";
    expect(head > 0 && open > head && close > open).toBe(true);
    expect(entries.indexOf("...opts.environment,") === 0).toBe(true);
    expect(entries.indexOf("...asked,") === 1).toBe(true);
    expect(entries.indexOf(flag) === entries.length - 1 && entries.length > 3).toBe(true);
  });
});
