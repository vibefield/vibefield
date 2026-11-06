// UM-D8 (A; the Profile Meters page, round 4, ruled 2026-11-06) — THE PHONE MAY
// READ USAGE: the batch its home desktop holds, with no poll of its own.
// `agent.usage` joined the tailnet preset as SP-D13 admitted `index.search`, so
// a self phone is granted it at every hello. What keeps a phone from spending
// this desktop's credentialed calls is the door's rule (daemon.ts, the
// `agents.usage` pair), and these rows measure it:
//   · `agents.usage` answers the batch this desktop holds; a phone's
//     `refresh: true` is answered from that cache and takes no reading, where
//     a window's Retry takes one;
//   · `agents.usage.subscribe` is a PASSIVE watcher for a phone: it never
//     begins the poll, its frames move when a window's poll moves the batch,
//     and its staying keeps no poll alive once the window leaves;
//   · every subscriber's frames are whole batches at the stream floor
//     (`PRODUCT_API_LIMITS.STREAM_MIN_INTERVAL_MS`, through `wholeValueDoor`),
//     a window's as well as a phone's;
//   · a guest holds no scope, and both doors are `local`: a foreign `device`
//     is refused before any forwarder (a peer daemon meets the D36 wall:
//     agent-usage.test.ts's D36 row).
//
// ONE daemon per row over the MOCK floor and the scripted adapter
// (scripted-usage.ts), reached the ways a caller arrives (project-doors-phone's
// harness): the phone through the sidecar's door (a WhoIs login and no token),
// a guest (a login that is not this desktop's), and a window by a local token.
// "Spends nothing" is a measurement: the rows count the adapter's own ledger of
// readings (`ScriptedProvider.fetches`).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AgentAccountUsageBatch,
  CONTRACTS_VERSION,
  LAYOUT,
  PRODUCT_API_LIMITS,
  type Scope,
  SOCKETS,
  TAILNET_SCOPES,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { SCRIPTED_CATALOG } from "./agent-catalog-fixture";
import { productDoorPath, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint, removeTempRoot, shortTmpRoot } from "./native-harness";
import {
  available,
  type ScriptedProvider,
  scriptedProvider,
  USAGE_FILE,
  type UsageScript,
} from "./scripted-usage";
import { helloAs, until, WsRpc } from "./ws-rpc";

/** Small on purpose, as agent-usage.test.ts's: a window's poll reads this often. */
const REFRESH_MS = 60;
const TICK_MS = 25;
/** The stream floor every usage subscriber's frames keep. */
const FLOOR_MS = PRODUCT_API_LIMITS.STREAM_MIN_INTERVAL_MS;
/** How long the account's numbers move at every reading, in the floor row. */
const CHURN_MS = 1_500;
/** The one reading's own stamp (the adapter's, so it never moves by itself). */
const READ_AT = "2026-11-06T03:00:00.000Z";
/** The window's token: the column's scope, and agent.spawn to make a profile. */
const WINDOW_SCOPES: Scope[] = ["agent.usage", "agent.spawn"];

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

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface World {
  daemon: FielddDaemon;
  scripted: ScriptedProvider;
  /** rewrite what the adapter answers, from the next request on */
  script(next: UsageScript): void;
  phone: WsRpc;
  phoneScopes: string[];
  guest: WsRpc;
  guestScopes: string[];
  window: WsRpc;
}

async function open(url: string, headers?: Record<string, string>): Promise<WsRpc> {
  const ws = new WebSocket(url, headers ? { headers } : {});
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

async function boot(options: { profiles?: boolean } = {}): Promise<World> {
  const root = shortTmpRoot("vf-umd8-");
  roots.push(root);
  const dataDir = join(root, ...LAYOUT.USERS_DIR, "1");
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  // the desktop's account: a login that matches it is the person's own phone
  writeLinkFixture(dataDir);
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());

  const usageFile = join(root, "account-usage.json");
  const script = (next: UsageScript): void =>
    writeFileSync(usageFile, `${JSON.stringify(next, null, 2)}\n`);
  script({ default: available("scripted", READ_AT) });
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
    // the built-ins are REPLACED (scripted-usage.ts): no real account is read
    agentCatalog: SCRIPTED_CATALOG,
    agentProviders: () => [scripted.provider],
    agentUsage: { refreshMs: REFRESH_MS, tickMs: TICK_MS },
    terminalBirthWaitMs: 300,
  });
  cleanup.push(() => daemon.stop().catch(() => undefined));
  await until(() => mock.meshServes.get("product") !== undefined, 15_000, "the product serve");
  await until(
    () => daemon.devices.currentDeviceId() === mock.meshDeviceId,
    15_000,
    "the mesh identity",
  );

  const door = `ws://127.0.0.1:${daemon.controlPort}${productDoorPath(mock)}`;
  const tailnet = async (login: string): Promise<{ rpc: WsRpc; granted: string[] }> => {
    const rpc = await open(door, { "Tailscale-User-Login": login });
    const ack = (await rpc.call("system.hello", {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "ios",
    })) as { grantedScopes: string[] };
    return { rpc, granted: ack.grantedScopes };
  };
  const phone = await tailnet(TEST_LOGIN);
  const guest = await tailnet("else@example.com");
  const window = await open(`ws://127.0.0.1:${daemon.controlPort}`);
  await helloAs(window, daemon.tokens.mint(WINDOW_SCOPES, "umd8-window").token);
  return {
    daemon,
    scripted,
    script,
    phone: phone.rpc,
    phoneScopes: phone.granted,
    guest: guest.rpc,
    guestScopes: guest.granted,
    window,
  };
}

/** A call the row expects ANSWERED: a refusal fails the row's assertion and
 * names the refusal, rather than throwing past it. */
async function answered(rpc: WsRpc, method: string, params: unknown): Promise<unknown> {
  const answer = await rpc.attempt(method, params);
  expect(answer, method).toMatchObject({ ok: true });
  return answer.ok ? answer.result : undefined;
}

/** The batch this desktop holds once its first reading has landed — asked by
 * the window, whose one-shot read with nothing cached takes the one reading
 * `snapshot` kicks — then a beat, so no reading is still in flight, and the
 * batch as it stands after that beat: each cold ask before the first landed
 * kicked a reading of its own, and a later one may land inside the beat. A
 * read with a batch cached kicks nothing. */
async function heldBatch(world: World): Promise<AgentAccountUsageBatch> {
  const deadline = Date.now() + 8_000;
  for (;;) {
    const batch = AgentAccountUsageBatch.parse(await world.window.call("agents.usage", {}));
    if (batch.entries.length > 0) {
      await settle(REFRESH_MS * 3);
      return AgentAccountUsageBatch.parse(await world.window.call("agents.usage", {}));
    }
    if (Date.now() > deadline) throw new Error("no reading landed within 8 s");
    await settle(25);
  }
}

/** Every frame a subscription has carried, each read as the WHOLE batch it
 * must be, with when it arrived. */
function framesOf(
  rpc: WsRpc,
  subId: string,
): Array<{ batch: AgentAccountUsageBatch; receivedAt: number }> {
  return rpc.notifications
    .filter((n) => n.params.subId === subId)
    .map((n) => ({
      batch: AgentAccountUsageBatch.parse(n.params.payload),
      receivedAt: n.receivedAt,
    }));
}

describe("UM-D8 — the phone reads its home's usage, and runs no poll of its own", () => {
  it("the phone is granted agent.usage by its preset; a guest holds no scope and is refused both doors", async () => {
    const world = await boot();
    expect(world.phoneScopes).toEqual([...TAILNET_SCOPES]);
    expect(world.phoneScopes).toContain("agent.usage");
    expect(world.guestScopes).toEqual([]);
    for (const method of ["agents.usage", "agents.usage.subscribe"]) {
      const refused = await world.guest.callErr(method, {});
      expect(refused.data?.kind, method).toBe("FORBIDDEN_SCOPE");
      expect(refused.data?.details, method).toEqual({ method });
    }
    // the guest's asks reached no adapter
    expect(world.scripted.fetches()).toEqual({});
  }, 30_000);

  it("the phone is answered the batch this desktop holds, and its Retry takes no reading — a window's takes one", async () => {
    const world = await boot({ profiles: true });
    const held = await heldBatch(world);
    // a sign-in made after the reading: nothing has been read for it yet
    const work = (await world.window.call("agents.profileSets.create", { label: "Work" })) as {
      set: { id: string };
    };
    const created = (await world.window.call("agents.profiles.create", {
      set: work.set.id,
      provider: "scripted",
    })) as { persona: { profileId: string } };
    const profileId = created.persona.profileId;
    world.script({
      default: available("scripted", READ_AT),
      [profileId]: available("scripted", READ_AT, 9),
    });
    const before = world.scripted.fetches();

    // the phone's plain read: the cache, whole
    const read = AgentAccountUsageBatch.parse(await answered(world.phone, "agents.usage", {}));
    expect(read.entries).toEqual(held.entries);
    // the phone's Retry, naming the new sign-in: the flag spends nothing — the
    // answer is the same cache, honest about what it holds (no row for an
    // account nobody has read), and the adapter was asked for nothing
    const retried = AgentAccountUsageBatch.parse(
      await answered(world.phone, "agents.usage", { refresh: true, profileIds: [profileId] }),
    );
    expect(retried.entries).toEqual(held.entries);
    expect(retried.entries.some((entry) => entry.profileId === profileId)).toBe(false);
    expect(world.scripted.fetches()).toEqual(before);

    // the window's Retry is a reading: the sign-in's own, taken now
    const fromWindow = AgentAccountUsageBatch.parse(
      await world.window.call("agents.usage", { refresh: true, profileIds: [profileId] }),
    );
    expect(fromWindow.entries).toContainEqual(
      expect.objectContaining({ profileId, state: "available" }),
    );
    expect(world.scripted.fetches()[profileId]).toBe(1);
  }, 30_000);

  it("the phone's subscription starts no poll: it opens on the batch this desktop holds, and nothing is read while it alone watches", async () => {
    const world = await boot();
    const held = await heldBatch(world);
    const before = world.scripted.fetches();
    const sub = (await answered(world.phone, "agents.usage.subscribe", {})) as {
      subId: string;
      snapshot: unknown;
    };
    expect(AgentAccountUsageBatch.parse(sub.snapshot).entries).toEqual(held.entries);
    // a window's subscription would read every REFRESH_MS; the phone's asks nothing
    await settle(REFRESH_MS * 8);
    expect(world.scripted.fetches()).toEqual(before);
  }, 30_000);

  it("the phone hears a window's poll in whole batches at the stream floor, as the window does, and keeps no poll alive when the window leaves", async () => {
    const world = await boot();
    await heldBatch(world);
    const phoneSub = (await answered(world.phone, "agents.usage.subscribe", {})) as {
      subId: string;
    };
    const windowSub = (await world.window.call("agents.usage.subscribe", {})) as {
      subId: string;
    };
    // the account's numbers move at every reading the window's poll takes
    const startedAt = Date.now();
    let percent = 0;
    while (Date.now() - startedAt < CHURN_MS) {
      percent += 1;
      world.script({ default: available("scripted", READ_AT, percent) });
      await settle(REFRESH_MS / 2);
    }
    const last = percent;
    const heardLast = (rpc: WsRpc, subId: string) => () =>
      framesOf(rpc, subId).some((f) => f.batch.entries[0]?.metrics[0]?.usedPercent === last);
    await until(heardLast(world.phone, phoneSub.subId), 8_000, "the phone hears the last reading");
    await until(heardLast(world.window, windowSub.subId), 8_000, "the window hears it");

    // THE FLOOR, stated as a rate (agent-session.test.ts's reason: arrivals
    // clump on a loaded loop and never multiply, so a count over the window is
    // sound where a per-pair gap is not)
    for (const [who, rpc, subId] of [
      ["phone", world.phone, phoneSub.subId],
      ["window", world.window, windowSub.subId],
    ] as const) {
      const frames = framesOf(rpc, subId);
      for (const frame of frames) expect(frame.batch.entries, who).toHaveLength(1);
      const lastArrival = frames[frames.length - 1]?.receivedAt ?? startedAt;
      const windowMs = Math.max(0, lastArrival - startedAt);
      const ceiling = Math.floor(windowMs / FLOOR_MS) + 1;
      expect(
        frames.length,
        `${who}: ${frames.length} frames in ${windowMs} ms breaches the ${FLOOR_MS} ms floor (max ${ceiling})`,
      ).toBeLessThanOrEqual(ceiling);
    }

    // the window leaves; the phone still watches, and keeps no poll alive
    await world.window.call("system.unsubscribe", { subId: windowSub.subId });
    await settle(REFRESH_MS * 3); // a reading already in flight lands
    const atRelease = world.scripted.fetches();
    await settle(REFRESH_MS * 8);
    expect(world.scripted.fetches()).toEqual(atRelease);
  }, 60_000);

  it("both doors are local: a foreign device is refused before any forwarder, so the phone reads its home's usage alone", async () => {
    const world = await boot();
    for (const method of ["agents.usage", "agents.usage.subscribe"]) {
      const answer = await world.phone.attempt(method, { device: "dev-elsewhere" });
      expect(answer, method).toMatchObject({
        ok: false,
        error: {
          data: { kind: "PRECONDITION_FAILED", details: { method, locality: "local" } },
        },
      });
    }
    expect(world.scripted.fetches()).toEqual({});
  }, 30_000);
});
