// Account usage (AR-5d): the two doors behind Godview's usage column, the
// reading that feeds them, and what it refuses to say.
//
// The whole block runs against the MOCK mgmt server — a quota is read from an
// adapter, never from a PTY, so no floor is needed. The provider under test is
// a scripted one composed through `agentProviders`, REPLACING puppeteer's
// built-ins rather than joining them: the built-in claude reads a real
// account's OAuth root, and a unit test must never depend on (or touch) the
// developer's own credentials. Its readings come from a JSON file named by an
// env var and re-read per request (the `FAKE_ROSETTAD_SESSIONS` pattern in
// test/fixtures/fake-rosettad.mjs), so a test flips an account's state between
// two polls by writing a file.
//
// The last block asks the REAL claude adapter, only when FIELDD_TEST_REAL_AGENT
// names it, and asserts a STATE, never a number: someone's quota is not a
// fixture. That gate is why the poll is demand-driven: puppeteer's claude
// usage service reads the OAuth credential from the user's own root and asks
// the vendor's endpoint, so a fieldd that polled at boot would have every
// daemon in this test graph reach the network with a real token.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AccountUsageFetchResult,
  AgentProfile,
  AccountUsageService as CoreAccountUsageService,
  ProfileFailure,
  ProfileIdentity,
  ProfileService,
  TerminalSpec,
} from "@vibecook/puppeteer-core";
import type { AgentProvider } from "@vibecook/puppeteer-runtime";
import {
  AgentAccountUsageBatch,
  type AgentAccountUsageEntry,
  CONTRACTS_VERSION,
  LAYOUT,
  SOCKETS,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { FielddDaemon } from "../src/index";
import { type AccountUsageRuntime, AccountUsageService, bootstrap } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productPathSecret, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint, removeTempRoot, shortTmpRoot } from "./native-harness";
import { helloAs, type RpcErrorShape, until, WsRpc } from "./ws-rpc";

/** The env var naming the scripted provider's readings file. */
const USAGE_FILE = "FAKE_ACCOUNT_USAGE_FILE";
/** Small on purpose: the poller must be observable inside a test's patience. */
const REFRESH_MS = 60;
const TICK_MS = 25;
/** The column's own scope (AR-5b): a reading is the account's billing state and
 * a credentialed call, which the fold's scope was never consented for. */
const OBSERVER = ["agent.usage"];

let cleanup: Array<() => void | Promise<void>> = [];
let roots: string[] = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* already-stopped daemons and dead sockets are fine */
    }
  }
  cleanup = [];
  for (const root of roots) removeTempRoot(root);
  roots = [];
});

// ── the scripted provider ─────────────────────────────────────────────────

/** One reading per account, as the file spells them. `"throw"` is an adapter
 * that blew up rather than answering — the runtime folds that into an
 * `unavailable` result, which is a different path from a typed refusal. */
type UsageScript = Record<string, AccountUsageFetchResult | "throw">;

const available = (provider: string, at: string, usedPercent = 42): AccountUsageFetchResult => ({
  status: "available",
  snapshot: {
    provider,
    fetchedAt: at,
    scope: "subscription",
    source: { kind: "native-protocol", stability: "experimental" },
    metrics: [
      {
        id: "five-hour",
        label: "5H",
        description: "Rolling five-hour window",
        kind: "window",
        usedPercent,
        durationMinutes: 300,
        resetsAt: "2026-09-13T14:00:00.000Z",
      },
      { id: "seven-day", label: "7D", kind: "window", usedPercent: 12, durationMinutes: 10_080 },
    ],
    credits: { balance: "$12.40", hasCredits: true },
  },
});

/** A quota refusal. `retryAt` is the provider's own authorization to ask
 * again, and the monitor obeys it — a far-future one would park the row, so a
 * test that flips the account afterwards passes a near one. */
const rateLimited = (provider: string, retryAt: string): AccountUsageFetchResult => ({
  status: "unavailable",
  provider,
  message: "the account is rate limited",
  retryable: true,
  code: "rate-limited",
  retryAt,
});

/** A retryable refusal with no provider-authorized retry time: the backoff
 * LADDER's input (a `retryAt` outranks the ladder — its own row below). */
const refused = (provider: string): AccountUsageFetchResult => ({
  status: "unavailable",
  provider,
  message: "the account could not be read",
  retryable: true,
});

const unauthenticated = (provider: string): AccountUsageFetchResult => ({
  status: "unauthenticated",
  provider,
  message: "no account is signed in",
  retryable: false,
});

interface ScriptedProvider {
  provider: AgentProvider;
  /** a provider PUSH (the runtime's `onAccountUsage` path), on demand */
  push(result: AccountUsageFetchResult): void;
  /** how many readings the adapter has been asked for, per account key */
  fetches(): Record<string, number>;
}

/** An adapter that owns nothing but a quota (and, when asked, accounts). */
function scriptedProvider(options: {
  id: string;
  label: string;
  profiles?: boolean;
  pollIntervalMs?: number;
}): ScriptedProvider {
  const counts: Record<string, number> = {};
  let pushTo: ((result: AccountUsageFetchResult) => void) | undefined;
  const read = (key: string): AccountUsageFetchResult | "throw" => {
    const path = process.env[USAGE_FILE];
    if (path === undefined) throw new Error(`${USAGE_FILE} is not set`);
    // re-read per request: the test rewrites this file between polls
    const script = JSON.parse(readFileSync(path, "utf8")) as UsageScript;
    return script[key] ?? script["default"] ?? "throw";
  };
  const accountUsage: CoreAccountUsageService = {
    provider: {
      id: options.id,
      label: options.label,
      refresh: { pollIntervalMs: options.pollIntervalMs ?? 60_000 },
    },
    async fetch(fetchOptions?: { profile?: AgentProfile }) {
      const key = fetchOptions?.profile?.id ?? "default";
      counts[key] = (counts[key] ?? 0) + 1;
      const answer = read(key);
      if (answer === "throw") throw new Error("scripted account usage failure");
      return answer;
    },
    subscribe(listener) {
      pushTo = listener;
      return () => {
        pushTo = undefined;
      };
    },
  };
  const profiles: ProfileService = {
    provider: {
      id: options.id,
      label: options.label,
      support: { supported: true, identity: "none", sharedSurfaces: [] },
    },
    bindingEnvironment: () => ({}),
    observationRoot: (profile: AgentProfile) => profile.dataRoot,
    loginInvocation: (_profile: AgentProfile, opts: { cwd: string }): TerminalSpec => ({
      command: "/bin/sh",
      args: ["-c", "exit 0"],
      cwd: opts.cwd,
    }),
    async verify(): Promise<ProfileIdentity | ProfileFailure> {
      return {
        status: "unsupported",
        message: "the scripted provider has no identity to read",
        retryable: false,
      };
    },
  };
  return {
    provider: {
      descriptor: { id: options.id, label: options.label },
      createSession() {
        // this adapter exists to be ASKED about a quota; it spawns nothing
        return Promise.reject(new Error("the usage provider spawns no sessions"));
      },
      accountUsage,
      ...(options.profiles === true ? { profiles } : {}),
    },
    push: (result) => pushTo?.(result),
    fetches: () => ({ ...counts }),
  };
}

// ── the harness ───────────────────────────────────────────────────────────

interface Box {
  daemon: FielddDaemon;
  /** UA-P-0d — the floor, so a row that plays the sidecar can read the route
   * secret off the `serve.add` instead of out of a published URL. */
  mock: MockMgmtServer;
  scripted: ScriptedProvider;
  /** rewrite what the adapter answers, from the next request on */
  script(next: UsageScript): void;
}

async function setup(options: { profiles?: boolean; realAgent?: boolean } = {}): Promise<Box> {
  const root = shortTmpRoot("vf-ar5d-");
  roots.push(root);
  const dataDir = join(root, ...LAYOUT.USERS_DIR, "1");
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  // UA-P-0a (D1) — the desktop has an ACCOUNT. The posture derives from the
  // link now: without one there is no product serve and the tailnet door mints
  // a guest, which none of the rows below are about.
  writeLinkFixture(dataDir);
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());

  const usageFile = join(root, "account-usage.json");
  const script = (next: UsageScript): void =>
    writeFileSync(usageFile, `${JSON.stringify(next, null, 2)}\n`);
  script({ default: available("scripted", "2026-09-13T12:00:00.000Z") });
  const previous = process.env[USAGE_FILE];
  process.env[USAGE_FILE] = usageFile;
  cleanup.push(() => {
    if (previous === undefined) delete process.env[USAGE_FILE];
    else process.env[USAGE_FILE] = previous;
  });

  const scripted = scriptedProvider({
    id: "scripted",
    label: "Scripted",
    ...(options.profiles === true ? { profiles: true } : {}),
  });
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    // the built-ins are REPLACED (see the file header): no real account is read
    agentProviders: (builtin) => (options.realAgent === true ? builtin : [scripted.provider]),
    agentUsage: { refreshMs: REFRESH_MS, tickMs: TICK_MS },
    terminalBirthWaitMs: 300,
  });
  cleanup.push(() => daemon.stop().catch(() => undefined));
  return { daemon, mock, scripted, script };
}

async function openRpc(port: number): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

/** A renderer window token holding exactly `scopes`. */
async function window(daemon: FielddDaemon, scopes: string[], suffix: string): Promise<WsRpc> {
  const shell = await openRpc(daemon.controlPort);
  await helloAs(shell, daemon.shellToken, "shell-main");
  const minted = (await shell.call("system.mintWindowToken", {
    scopes,
    label: `window-${suffix}`,
    rendererParticipant: {
      participantId: `renderer:desktop-test:window-${suffix}`,
      incarnation: `renderer:desktop-test:window-${suffix}:document-1`,
    },
  })) as { token: string };
  const win = await openRpc(daemon.controlPort);
  await helloAs(win, minted.token);
  return win;
}

async function poll<T>(fn: () => Promise<T | undefined>, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`poll timed out after ${ms}ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** The first batch that satisfies `ready`, asked through the door. */
async function batchWhere(
  win: WsRpc,
  ready: (batch: AgentAccountUsageBatch) => boolean,
  ms = 8_000,
): Promise<AgentAccountUsageBatch> {
  return await poll(async () => {
    const batch = (await win.call("agents.usage", {})) as AgentAccountUsageBatch;
    return ready(batch) ? batch : undefined;
  }, ms);
}

describe("the account usage doors (AR-5d)", () => {
  it("agents.usage answers the batch: the adapter's rows, its metric order, and NOTHING else", async () => {
    const { daemon } = await setup();
    const win = await window(daemon, OBSERVER, "u1");
    // the honest empty is a batch, not a throw: before the first reading the
    // door still answers, stamped
    const first = (await win.call("agents.usage", {})) as AgentAccountUsageBatch;
    expect(Array.isArray(first.entries)).toBe(true);
    expect(Date.parse(first.generatedAt)).toBeGreaterThan(0);

    const batch = await batchWhere(win, (b) => b.entries.length > 0);
    // parsed under the contract on the PRODUCER's side too (EL9): the
    // renderer's tests read the fixtures, this reads the daemon's own answer
    AgentAccountUsageBatch.parse(batch);
    expect(batch.entries).toHaveLength(1);
    const entry = batch.entries[0] as AgentAccountUsageEntry;
    expect(entry.provider).toBe("scripted");
    expect(entry.label).toBe("Scripted");
    expect(entry.state).toBe("available");
    expect(entry.metrics.map((m) => m.label)).toEqual(["5H", "7D"]); // the adapter's order
    // EXACT, not a subset: the contract's metric is `.passthrough()`, so a key
    // added inside `projectMetric` would cross to the renderer under a
    // subset match with every test green (AR-5b, the tests lens)
    expect(entry.metrics[0]).toEqual({
      id: "five-hour",
      label: "5H",
      description: "Rolling five-hour window",
      kind: "window",
      usedPercent: 42,
      durationMinutes: 300,
      resetsAt: "2026-09-13T14:00:00.000Z",
    });
    expect(entry.credits).toEqual({ balance: "$12.40", hasCredits: true });
    expect(entry.fetchedAt).toBe("2026-09-13T12:00:00.000Z"); // when the DATA was read
    expect(entry.scope).toBe("subscription");
    expect(entry.source).toEqual({ kind: "native-protocol", stability: "experimental" });
    // no account is registered, so the reading is the provider's native default
    expect(entry.profileId).toBeUndefined();
    // EL7 — the projection carries the contract's fields and no others: a row
    // is percentages and labels, never a payload fieldd did not name
    expect(Object.keys(entry).sort()).toEqual(
      ["credits", "fetchedAt", "label", "metrics", "provider", "scope", "source", "state"].sort(),
    );
  }, 30_000);

  it("the scope: only agent.usage reads the quota — neither the fold's watcher nor a spawner (AR-5b)", async () => {
    const { daemon } = await setup();
    for (const [suffix, scopes] of [
      ["u2", ["agent.spawn"]],
      ["u2b", ["agent.observe"]],
    ] as const) {
      const holder = await window(daemon, [...scopes], suffix);
      expect((await holder.callErr("agents.usage", {})).data?.kind, scopes.join()).toBe(
        "FORBIDDEN_SCOPE",
      );
      expect((await holder.callErr("agents.usage.subscribe", {})).data?.kind, scopes.join()).toBe(
        "FORBIDDEN_SCOPE",
      );
    }
    const observer = await window(daemon, OBSERVER, "u3");
    expect((await observer.call("agents.usage", {})) as AgentAccountUsageBatch).toBeDefined();
  }, 30_000);

  it("agents.usage.subscribe frames follow the account: available → rate-limited → unauthenticated, the last good numbers kept and flagged", async () => {
    const { daemon, script } = await setup();
    const win = await window(daemon, OBSERVER, "u4");
    const sub = (await win.call("agents.usage.subscribe", {})) as {
      subId: string;
      snapshot: AgentAccountUsageBatch;
    };
    const frames = (): AgentAccountUsageEntry[] =>
      win.notifications
        .filter((n) => n.params.subId === sub.subId)
        .map((n) => (n.params.payload as AgentAccountUsageBatch).entries[0])
        .filter((entry): entry is AgentAccountUsageEntry => entry !== undefined);
    const seen = async (state: string): Promise<AgentAccountUsageEntry> =>
      await poll(async () => [...frames()].reverse().find((entry) => entry.state === state), 8_000);

    const good = await seen("available");
    expect(good.metrics).toHaveLength(2);
    expect(good.stale).toBeUndefined();

    // a quota refusal: upstream keeps `rate-limited` as a CODE on a failure;
    // the door lifts it to a state, and the numbers already read are RETAINED
    const retryAt = new Date(Date.now() + 250).toISOString();
    script({ default: rateLimited("scripted", retryAt) });
    const limited = await seen("rate-limited");
    expect(limited.stale).toBe(true);
    expect(limited.metrics.map((m) => m.label)).toEqual(["5H", "7D"]);
    expect(limited.fetchedAt).toBe("2026-09-13T12:00:00.000Z"); // the numbers' own age
    expect(limited.message).toBe("the account is rate limited");
    expect(limited.retryable).toBe(true);
    expect(limited.retryAt).toBe(retryAt); // the provider's own authorization

    // signed out: the state says so even though the metrics are still here —
    // "available" over a signed-out account is the one thing not to show
    script({ default: unauthenticated("scripted") });
    const out = await seen("unauthenticated");
    expect(out.stale).toBe(true);
    expect(out.message).toBe("no account is signed in");
    expect(out.retryable).toBe(false);
  }, 60_000);

  it("a provider PUSH lands without waiting for a poll (runtime.onAccountUsage → ingest)", async () => {
    const { daemon, scripted } = await setup();
    const win = await window(daemon, OBSERVER, "u5");
    await batchWhere(win, (b) => b.entries.length > 0);
    scripted.push(available("scripted", "2026-09-13T12:34:56.000Z", 77));
    const pushed = await batchWhere(
      win,
      (b) => b.entries[0]?.fetchedAt === "2026-09-13T12:34:56.000Z",
    );
    expect(pushed.entries[0]?.metrics[0]?.usedPercent).toBe(77);
  }, 30_000);

  it("the FIRST frame after a subscribe has one row per account, none failed, one reading each (AR-5b)", async () => {
    // The reconcile runs before the poll's first reading: a reading taken over
    // the unkeyed per-provider rows that the reconcile then replaced made the
    // first frame say every account had failed, and spent one extra
    // credentialed call per provider (the review's probe).
    const { daemon, scripted, script } = await setup({ profiles: true });
    const spawner = await window(daemon, ["agent.spawn"], "u8");
    const created = (await spawner.call("agents.profiles.create", {
      provider: "scripted",
      label: "Work",
    })) as { persona: { profileId: string } };
    const profileId = created.persona.profileId;
    script({ [profileId]: available("scripted", "2026-09-13T13:00:00.000Z", 9) });
    const win = await window(daemon, OBSERVER, "u9");
    await win.call("agents.usage.subscribe", {});
    const first = await batchWhere(win, (b) => b.entries.length > 0, 20_000);
    expect(first.entries.map((entry) => [entry.profileId, entry.state])).toEqual([
      [profileId, "available"],
    ]);
    // exactly one reading, for the account — never one for an unkeyed row first
    const fetches = scripted.fetches();
    expect(fetches[profileId]).toBe(1);
    expect(fetches["default"]).toBeUndefined();
  }, 30_000);

  it("a persona created mid-run becomes its own row on the next reading", async () => {
    const { daemon, script } = await setup({ profiles: true });
    const win = await window(daemon, OBSERVER, "u6");
    const spawner = await window(daemon, ["agent.spawn"], "u7");
    // the column is OPEN — which is what keeps the reading running at all
    // (a quota is never polled with nobody watching)
    await win.call("agents.usage.subscribe", {});
    // the native-default account first: one row, unkeyed
    await batchWhere(win, (b) => b.entries.length > 0);

    const created = (await spawner.call("agents.profiles.create", {
      provider: "scripted",
      label: "Work",
    })) as { persona: { profileId: string } };
    const profileId = created.persona.profileId;
    script({
      default: available("scripted", "2026-09-13T12:00:00.000Z"),
      [profileId]: available("scripted", "2026-09-13T13:00:00.000Z", 9),
    });
    // the registry changed, so what is POLLED changed: the persona is asked
    // for its own reading and becomes its own row
    const batch = await batchWhere(
      win,
      // the persona's OWN reading, not the default account's: the fake answers
      // 9% for this profile id and 42% for the native default
      (b) =>
        b.entries.some(
          (entry) => entry.profileId === profileId && entry.metrics[0]?.usedPercent === 9,
        ),
      20_000,
    );
    const persona = batch.entries.find((entry) => entry.profileId === profileId);
    expect(persona?.profileLabel).toBe("Work");
    expect(persona?.state).toBe("available");
    expect(persona?.metrics[0]?.usedPercent).toBe(9);
    // and the rows stay in provider order, one per ACCOUNT
    expect(batch.entries.every((entry) => entry.provider === "scripted")).toBe(true);
  }, 60_000);

  it("D36: a peer-fieldd principal cannot read this device's quota at all", async () => {
    const { daemon, mock } = await setup();
    // the capability path fieldd composes into its own serve URL
    await until(
      () => daemon.health().mesh.serves.some((s) => s.name === "product" && s.url !== undefined),
      8_000,
    );
    // UA-P-0d — the URL is a LOCATOR now and carries no secret; the sidecar's
    // own copy is what a caller playing the sidecar has to hold
    const secret = productPathSecret(mock);
    expect(secret).toBeTruthy();
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}/t/${secret}`, {
      headers: { "Tailscale-User-Login": TEST_LOGIN },
    });
    cleanup.push(() => ws.close());
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const peer = new WsRpc(ws);
    await peer.call("system.hello", {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "peer-fieldd",
      deviceId: "dev-peer-a",
    });
    const refused = (await peer.callErr("agents.usage", {})) as RpcErrorShape;
    expect(refused.data?.kind).toBe("FORBIDDEN_SCOPE");
    // AR-5b: the tailnet preset carries no agent.usage, so the scope wall fires
    // before the locality wall for a peer; either way the quota never leaves
    expect(refused.data?.details).toMatchObject({ required: "agent.usage" });
    const refusedSub = (await peer.callErr("agents.usage.subscribe", {})) as RpcErrorShape;
    expect(refusedSub.data?.kind).toBe("FORBIDDEN_SCOPE");
  }, 30_000);
});

// ── the reading's own rules, on an injected clock ─────────────────────────
//
// Backoff is a SCHEDULE, and a schedule measured by wall clock on a loaded
// host is a coin toss. These rows drive the service directly over a fake
// runtime with a clock the test moves, so what is asserted is the rule.

interface FakeRuntime extends AccountUsageRuntime {
  answers: AccountUsageFetchResult[];
  asked: number;
}

function fakeRuntime(pollIntervalMs: number): FakeRuntime {
  const runtime = {
    answers: [] as AccountUsageFetchResult[],
    asked: 0,
    accountUsageProviders: () => [
      { id: "scripted", label: "Scripted", refresh: { pollIntervalMs } },
    ],
    accountUsage: async (): Promise<AccountUsageFetchResult> => {
      runtime.asked += 1;
      return runtime.answers.shift() ?? unauthenticated("scripted");
    },
    onAccountUsage: () => () => undefined,
    onProfilesChanged: () => () => undefined,
    profiles: async () => [] as AgentProfile[],
  } as unknown as FakeRuntime;
  return runtime;
}

describe("the reading's own rules (AR-5d)", () => {
  it("a retryable failure pushes the next reading past the refresh interval, and a good one brings it back", async () => {
    let ms = Date.parse("2026-09-13T12:00:00.000Z");
    const runtime = fakeRuntime(1_000);
    const service = new AccountUsageService({
      runtime,
      poll: { refreshMs: 100, tickMs: 100 },
      now: () => new Date(ms),
    });
    cleanup.push(() => service.stop());

    // 1) a good reading: the next is due one interval later
    runtime.answers.push(available("scripted", "2026-09-13T12:00:00.000Z"));
    await service.refresh();
    expect(runtime.asked).toBe(1);
    ms += 50;
    await service.refresh();
    expect(runtime.asked).toBe(1); // not due yet
    ms += 60;
    runtime.answers.push(refused("scripted")); // …and this one is refused
    await service.refresh();
    expect(runtime.asked).toBe(2);

    // 2) the FIRST failure still schedules at one interval (the ladder counts
    // CONSECUTIVE failures, and there has only been one): the second reading
    // is taken on time, and is refused too
    ms += 101;
    runtime.answers.push(refused("scripted"));
    await service.refresh();
    expect(runtime.asked).toBe(3);

    // 3) now the interval has DOUBLED: the reading that would have been due
    // one interval later is not taken
    ms += 101;
    await service.refresh();
    expect(runtime.asked).toBe(3);
    ms += 101;
    runtime.answers.push(available("scripted", "2026-09-13T12:05:00.000Z", 51));
    await service.refresh();
    expect(runtime.asked).toBe(4);
    // the retained numbers are replaced by the fresh ones, and the flag clears
    expect(service.snapshot().entries[0]?.metrics[0]?.usedPercent).toBe(51);
    expect(service.snapshot().entries[0]?.stale).toBeUndefined();

    // 4) a good reading resets the ladder: one interval, as before
    ms += 101;
    runtime.answers.push(available("scripted", "2026-09-13T12:10:00.000Z", 52));
    await service.refresh();
    expect(runtime.asked).toBe(5);
  });

  it("a field this projection does not name is logged ONCE and never crosses (EL7 + the tolerant reader)", async () => {
    const events: Array<{ event: string; attrs?: Record<string, unknown> }> = [];
    const logger = {
      child: () => logger,
      trace: () => undefined,
      debug: () => undefined,
      info: (event: string, _message: string, attrs?: Record<string, unknown>) =>
        events.push({ event, ...(attrs !== undefined ? { attrs } : {}) }),
      warn: (event: string, _message: string, attrs?: Record<string, unknown>) =>
        events.push({ event, ...(attrs !== undefined ? { attrs } : {}) }),
      error: () => undefined,
      fatal: () => undefined,
      isLevelEnabled: () => true,
    } as unknown as Logger;
    const runtime = fakeRuntime(1_000);
    const service = new AccountUsageService({ runtime, poll: { refreshMs: 1, tickMs: 1 }, logger });
    cleanup.push(() => service.stop());
    // an upstream that grew a field (its own schema admits it; ours has no
    // word for it yet) — the drift this sentinel exists to surface
    const grown = (): AccountUsageFetchResult => {
      const result = available("scripted", "2026-09-13T12:00:00.000Z") as {
        status: "available";
        snapshot: Record<string, unknown>;
      };
      return {
        ...result,
        snapshot: { ...result.snapshot, organizationSeat: "enterprise-42" },
      } as unknown as AccountUsageFetchResult;
    };
    runtime.answers.push(grown(), grown());
    await service.refresh();
    await service.refresh();

    const noted = events.filter((e) => e.event === "fieldd.agents.usage_unknown_field");
    expect(noted).toHaveLength(1); // said once per key, not once per poll
    expect(noted[0]?.attrs).toMatchObject({ where: "snapshot", field: "organizationSeat" });
    // and the field itself never reached the door's answer
    expect(JSON.stringify(service.snapshot())).not.toContain("enterprise-42");
    expect(service.snapshot().entries[0]?.state).toBe("available");
  });

  it("the poll outlives any ONE subscriber leaving; only the last to leave stops it (AR-5b)", async () => {
    // The refcount, witnessed: an unconditional stop on any unsubscribe passed
    // every row here (the tests lens's mutation), and the column would die the
    // moment a second watcher left.
    const runtime = fakeRuntime(1_000);
    for (let i = 0; i < 400; i += 1) {
      runtime.answers.push(available("scripted", "2026-09-13T12:00:00.000Z"));
    }
    const service = new AccountUsageService({
      runtime,
      poll: { refreshMs: 20, tickMs: 20 },
    });
    cleanup.push(() => service.stop());
    service.start();
    const first = service.subscribe(() => undefined);
    const second = service.subscribe(() => undefined);
    await until(() => runtime.asked > 0, 2_000);
    first();
    const askedWhenFirstLeft = runtime.asked;
    // still polling for the watcher that stayed
    await until(() => runtime.asked > askedWhenFirstLeft + 1, 2_000);
    second();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const askedWhenLastLeft = runtime.asked;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(runtime.asked).toBe(askedWhenLastLeft);
  });

  it("nobody watching, nothing asked: the poll follows the subscribers", async () => {
    // The rule that keeps a person's quota (and their OAuth token) out of
    // every daemon boot: `start()` ARMS the reading; only a subscriber makes
    // it poll. A regression here is silent and expensive, so it is measured.
    const runtime = fakeRuntime(1_000);
    const service = new AccountUsageService({
      runtime,
      poll: { refreshMs: 40, tickMs: 40 },
    });
    cleanup.push(() => service.stop());
    service.start();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(runtime.asked).toBe(0); // armed, watched by no one, asking nothing

    const dispose = service.subscribe(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const whileWatched = runtime.asked;
    expect(whileWatched).toBeGreaterThan(0);

    dispose();
    const atRelease = runtime.asked;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(runtime.asked).toBe(atRelease); // the last watcher left; so did the poll
  });

  it("a provider's own retryAt outranks the ladder, and an adapter that throws is an honest unavailable", async () => {
    let ms = Date.parse("2026-09-13T12:00:00.000Z");
    const runtime = fakeRuntime(1_000);
    const service = new AccountUsageService({
      runtime,
      poll: { refreshMs: 100, tickMs: 100 },
      now: () => new Date(ms),
    });
    cleanup.push(() => service.stop());
    // an adapter that throws reaches the monitor as a typed unavailable (the
    // runtime catches it upstream; the monitor catches it here)
    runtime.accountUsage = () => Promise.reject(new Error("the adapter blew up"));
    await service.refresh();
    const entry = service.snapshot().entries[0];
    expect(entry?.state).toBe("unavailable");
    expect(entry?.retryable).toBe(true);
    expect(entry?.metrics).toEqual([]);
    expect(entry?.message).toContain("Scripted");

    // a refusal that names its own retry time is honoured over the ladder:
    // nothing is asked until the provider says it may be
    let asked = 0;
    runtime.accountUsage = async () => {
      asked += 1;
      return {
        status: "unavailable",
        provider: "scripted",
        message: "come back later",
        retryable: true,
        retryAt: new Date(ms + 10_000).toISOString(),
      };
    };
    ms += 1_000;
    await service.refresh();
    expect(asked).toBe(1);
    ms += 5_000; // the ladder would have allowed a reading by now
    await service.refresh();
    expect(asked).toBe(1);
    ms += 6_000; // past the provider's own retryAt
    await service.refresh();
    expect(asked).toBe(2);
  });
});

// ── the real provider, opt-in ─────────────────────────────────────────────

const REAL = process.env["FIELDD_TEST_REAL_AGENT"] === "1";
describe.skipIf(!REAL)("the real provider's own account (opt-in)", () => {
  it("answers a state — never a number this test has an opinion about", async () => {
    const { daemon } = await setup({ realAgent: true });
    const win = await window(daemon, OBSERVER, "real");
    const batch = await batchWhere(win, (b) => b.entries.length > 0, 30_000);
    // Whatever this machine's accounts are, EVERY row is one of the states the
    // contract names, with the provider's own words for a refusal. A quota is
    // the person's, not the suite's: nothing here asserts a percentage.
    for (const entry of batch.entries) {
      expect(
        ["available", "rate-limited", "unauthenticated", "unsupported", "unavailable"],
        `${entry.provider}: ${entry.state}`,
      ).toContain(entry.state);
      expect(typeof entry.provider).toBe("string");
      expect(Date.parse(entry.fetchedAt)).toBeGreaterThan(0);
      if (entry.state === "available") expect(Array.isArray(entry.metrics)).toBe(true);
      else expect(entry.message).toBeTruthy();
    }
    // EL7 — even a real reading carries no credential, no path, no payload
    expect(JSON.stringify(batch)).not.toMatch(/token|secret|Bearer/iu);
    expect(JSON.stringify(batch)).not.toMatch(/\/(Users|home)\//u);
    // what the row actually saw, for the person reading the run
    process.stdout.write(
      `[real] ${batch.entries.map((e) => `${e.provider}=${e.state}`).join(" ")}\n`,
    );
  }, 120_000);
});
