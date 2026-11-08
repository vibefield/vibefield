// NR S1 (track NR, "native re-arm": items 237's root, 238 and 262; `draft/thinking-native-replay-rearm.md` §5) — a
// refused native subscription, as the DAEMON lives it. NativeLink tells nobody: a refused FIRST subscribe is removed
// and thrown (`native-link.ts` `subscribe`), and a refused REPLAY is kept with no route until the next reconnect
// (`replaySubscriptions`). The floor's node gate refuses every mesh subscribe while its node is not up, and at a fresh
// pair start the node is a few seconds behind fieldd: on two linked dev lives the floor's `node_ready` came 3.494 s
// and 2.146 s after the holders' refused boot subscribe, and nothing asked again (the note's Q3, 8 of 8 starts
// refused). These rows hold the stream to its re-arm: the store is asked again once the node is up, with no reconnect
// and no fieldd restart. R1 and R2 fail at their S1 commit (`(red)`); S2's MeshStream makes them pass. R1's control (a
// node that never comes up) passes at both, and guards S2 against a loop.
//
// The world: the real daemon over `MockMgmtServer` (link-posture-daemon.test.ts's harness), whose node gate
// (`meshNodeUp`) answers every mesh call the floor's -32006 until a row opens it, and whose health stream carries the
// mesh unit the daemon reads its node from (`meshNodeUp(health)` → MeshClient's "node-up"). The witnesses are the
// floor's own record of what it was asked (`storeSubscribeAsks`) and the daemon's log.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isPipeEndpoint, SOCKETS, STORES } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, type FielddDaemon } from "../src/index";
import { NativeLink, type RpcCallError } from "../src/native-link";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";

/** A real daemon boots and stops in each row; a loaded gate gets room. */
const ROW_BUDGET_MS = 30_000;
/** How long a re-arm may take once its moment came: the stream's one ask, a beat of a loaded host. */
const REARM_MS = 5_000;

interface World {
  root: string;
  logRoot: string;
  floor: MockMgmtServer;
  daemon: FielddDaemon;
}

const worlds: World[] = [];
const links: Array<{ root: string; floor: MockMgmtServer; native: NativeLink }> = [];
afterEach(async () => {
  for (const world of worlds.splice(0).reverse()) {
    await world.daemon.stop();
    await world.floor.stop();
    rmSync(world.root, { recursive: true, force: true });
  }
  for (const { root, floor, native } of links.splice(0).reverse()) {
    native.close();
    await floor.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

const health = (bootId: string, meshState: string) => ({
  state: "up",
  bootId,
  units: [{ unit: "mesh-gateway", state: meshState }],
});

/** A fresh pair: the floor up, its node gate as asked, and the daemon booted against it. */
async function pair(opts: { nodeUp: boolean }): Promise<World> {
  const root = mkdtempSync(join(tmpdir(), "vf-nr-"));
  const dataDir = join(root, "data");
  const logRoot = join(root, "logs");
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  mkdirSync(join(dataDir, "registries"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const floor = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  floor.meshNodeUp = opts.nodeUp;
  floor.healthSnapshot = health("nr-floor-1", opts.nodeUp ? "up" : "starting");
  await floor.start();
  const daemon = await bootstrap({ dataDir, logRoot, controlPort: 0, dataPort: 0 });
  const world = { root, logRoot, floor, daemon };
  worlds.push(world);
  return world;
}

function events(logRoot: string): string[] {
  let text: string;
  try {
    text = readFileSync(join(logRoot, "system", "fieldd.ndjson"), "utf8");
  } catch {
    return [];
  }
  return text
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => (JSON.parse(line) as { event: string }).event);
}

/** Polls until `fn` holds or `ms` passes; the row asserts on the answer, so a red reads in its own words. */
async function within(ms: number, fn: () => boolean): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (fn()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const asks = (floor: MockMgmtServer, storeId: string): number =>
  floor.storeSubscribeAsks.filter((asked) => asked === storeId).length;

/** The node comes up: the gate opens, and the floor's health says so (a turn to up, which is "node-up"). */
function nodeComesUp(floor: MockMgmtServer, bootId: string): void {
  floor.meshNodeUp = true;
  floor.pushHealth(health(bootId, "up"));
}

describe("NR R1 (item 262) — a fresh pair start whose node is a second behind fieldd", () => {
  it(
    "asks for the docs store again once the node is up, with no reconnect",
    async () => {
      const { floor, logRoot, daemon } = await pair({ nodeUp: false });
      // the precondition, pinned: the holders' boot subscribe met the gate and was refused
      expect(
        await within(REARM_MS, () => events(logRoot).includes("fieldd.docs.holders_unavailable")),
        "the holders' boot subscribe was refused (fieldd.docs.holders_unavailable)",
      ).toBe(true);
      expect(asks(floor, STORES.DOCS)).toBe(1);
      const connections = floor.connections;

      await new Promise((resolve) => setTimeout(resolve, 1_000));
      nodeComesUp(floor, "nr-floor-1");

      // the control, green before NR: DeviceService's store leg is asked once the node is up, because its first
      // ask was refused before it was ever marked subscribed
      expect(
        await within(REARM_MS, () => asks(floor, STORES.DEVICES) >= 1),
        "the devices store is asked once the node is up (the control)",
      ).toBe(true);
      // the row: the docs store is asked again — red before NR, where nothing ever asks again
      expect(
        await within(REARM_MS, () => asks(floor, STORES.DOCS) >= 2),
        "the docs store is asked again once the node is up (DocHoldersService re-arms)",
      ).toBe(true);
      expect(floor.connections, "no reconnect carried it").toBe(connections);
      expect(daemon.native.connected).toBe(true);
    },
    ROW_BUDGET_MS,
  );

  it(
    "the control: a node that never comes up leaves the stream waiting, asked no more than its bound",
    async () => {
      const { floor, logRoot } = await pair({ nodeUp: false });
      expect(
        await within(REARM_MS, () => events(logRoot).includes("fieldd.docs.holders_unavailable")),
        "the holders' boot subscribe was refused (fieldd.docs.holders_unavailable)",
      ).toBe(true);
      // three seconds of a floor whose node stays down: no node-up and no reconnect, so nothing is owed an ask. The
      // bound is the refused boot ask and one more; a re-arm that loops on a refusal blows it within a beat.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(
        asks(floor, STORES.DOCS),
        "the docs store asked no more than its bound",
      ).toBeLessThanOrEqual(2);
      expect(floor.meshNodeUp).toBe(false);
    },
    ROW_BUDGET_MS,
  );
});

describe("NR R2 (item 238) — the floor restarts under fieldd and its node comes up a second after the re-dial", () => {
  it(
    "asks for the docs and devices stores again once the new floor's node is up, with no second reconnect",
    async () => {
      const { floor, logRoot } = await pair({ nodeUp: true });
      // a linked desktop running: both streams stand
      expect(
        await within(
          REARM_MS,
          () => asks(floor, STORES.DOCS) >= 1 && asks(floor, STORES.DEVICES) >= 1,
        ),
        "the docs and devices stores are subscribed on a pair whose node is up",
      ).toBe(true);
      const before = floor.connections;

      // the floor dies and comes back as a new boot whose node is not up yet: the link re-dials and replays, and
      // the gate refuses the stores' replays
      floor.meshNodeUp = false;
      floor.healthSnapshot = health("nr-floor-2", "starting");
      floor.killClients();
      expect(await within(REARM_MS, () => floor.connections > before), "the link re-dialed").toBe(
        true,
      );
      expect(
        await within(REARM_MS, () =>
          events(logRoot).includes("fieldd.native_link.subscription_replay_refused"),
        ),
        "the stores' replays were refused (fieldd.native_link.subscription_replay_refused)",
      ).toBe(true);
      const docs = asks(floor, STORES.DOCS);
      const devices = asks(floor, STORES.DEVICES);
      const redialed = floor.connections;

      await new Promise((resolve) => setTimeout(resolve, 1_000));
      nodeComesUp(floor, "nr-floor-2");

      // red before NR: the refused replays are kept with no route and tell no one; DocHoldersService has no path
      // that asks again, and DeviceService's two booleans say "subscribed"
      // soft, so a red names both services. If the two diverge on the way to green, S2 moves DocHoldersService
      // first, because it is 262's owner and has no retry path at all. So a diverged run reads docs green and
      // devices red, never the reverse.
      expect
        .soft(
          await within(REARM_MS, () => asks(floor, STORES.DOCS) > docs),
          "the docs store is asked again once the new floor's node is up (DocHoldersService re-arms)",
        )
        .toBe(true);
      expect(
        await within(REARM_MS, () => asks(floor, STORES.DEVICES) > devices),
        "the devices store is asked again once the new floor's node is up (DeviceService re-arms)",
      ).toBe(true);
      expect(floor.connections, "no second reconnect carried it").toBe(redialed);
    },
    ROW_BUDGET_MS,
  );
});

/** The owned subscribe S2 gives NativeLink: FielddClient's `SubscribeOptions.onReplayFailed`, the note's §3.1. The rows
 * reach it through this type until S2 declares it, so they read the same at S1 and at S2. */
type OwnedSubscribe = (
  method: string,
  params: unknown,
  onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  opts: { onReplayFailed: (error: RpcCallError) => void },
) => Promise<{ snapshot: unknown; dispose: () => void }>;
const owned = (native: NativeLink): OwnedSubscribe =>
  native.subscribe.bind(native) as unknown as OwnedSubscribe;

/** A bare link to the scripted floor, connected, its node up. */
async function bareLink(): Promise<{ floor: MockMgmtServer; native: NativeLink }> {
  const root = mkdtempSync(join(tmpdir(), "vf-nr-link-"));
  const pairingFile = join(root, "pairing");
  writeFileSync(pairingFile, "ab".repeat(32));
  const endpoint = nativeEndpoint(root, SOCKETS.MGMT);
  if (!isPipeEndpoint(endpoint)) mkdirSync(dirname(endpoint), { recursive: true });
  const floor = new MockMgmtServer(endpoint);
  await floor.start();
  const native = new NativeLink({ socketPath: endpoint, pairingFile, bootId: "nr-boot" });
  links.push({ root, floor, native });
  await native.connect();
  return { floor, native };
}

/** The floor drops the link; resolves once the link has re-dialed and its replays have run. */
async function redial(floor: MockMgmtServer, native: NativeLink): Promise<boolean> {
  const before = floor.connections;
  floor.killClients();
  return await within(REARM_MS, () => floor.connections > before && native.connected);
}

describe("NR R4 — NativeLink tells the owner of a refused replay (the note's §3.1)", () => {
  it(
    "an owned replay the gate refuses is heard once, after connected; it is ended, and its sibling stands",
    async () => {
      const { floor, native } = await bareLink();
      const heard: string[] = [];
      const order: string[] = [];
      native.on("connected", () => order.push("connected"));
      await owned(native)("native.mesh.store.subscribe", { storeId: STORES.DOCS }, () => {}, {
        onReplayFailed: (error) => {
          heard.push(error.kind);
          order.push("replay-failed");
        },
      });
      // the unowned sibling keeps today's retention (Q1)
      await native.subscribe("native.mesh.store.subscribe", { storeId: STORES.DEVICES }, () => {});

      floor.meshNodeUp = false;
      expect(await redial(floor, native), "the link re-dialed").toBe(true);
      await within(REARM_MS, () => heard.length >= 1);
      expect(heard, "the owner heard its refused replay, once").toEqual(["UNAVAILABLE"]);
      expect(order, "after the replay pass, once connected").toEqual([
        "connected",
        "replay-failed",
      ]);

      // the next reconnect, with the node up, replays the sibling and not the ended entry
      floor.meshNodeUp = true;
      const docs = asks(floor, STORES.DOCS);
      const devices = asks(floor, STORES.DEVICES);
      expect(await redial(floor, native), "the link re-dialed again").toBe(true);
      await within(REARM_MS, () => asks(floor, STORES.DEVICES) > devices);
      expect(asks(floor, STORES.DEVICES), "the unowned sibling is replayed").toBe(devices + 1);
      expect(asks(floor, STORES.DOCS), "the owned entry, ended by its refusal, is not").toBe(docs);
      expect(heard).toHaveLength(1);
    },
    ROW_BUDGET_MS,
  );

  it(
    "an owner's re-subscribe from inside its callback is sent once, never again by the same replay pass",
    async () => {
      const { floor, native } = await bareLink();
      const subscribe = owned(native);
      let again: Promise<unknown> | null = null;
      const onReplayFailed = (): void => {
        again = subscribe("native.mesh.store.subscribe", { storeId: STORES.DOCS }, () => {}, {
          onReplayFailed,
        }).catch(() => undefined);
      };
      await subscribe("native.mesh.store.subscribe", { storeId: STORES.DOCS }, () => {}, {
        onReplayFailed,
      });
      floor.meshNodeUp = false;
      const docs = asks(floor, STORES.DOCS);
      expect(await redial(floor, native), "the link re-dialed").toBe(true);
      await within(REARM_MS, () => again !== null);
      await again;
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(again, "the owner heard its refused replay").not.toBeNull();
      expect(
        asks(floor, STORES.DOCS) - docs,
        "the refused replay and the owner's one re-subscribe",
      ).toBe(2);
    },
    ROW_BUDGET_MS,
  );

  it(
    "an unowned replay the gate refuses is kept, as today, and asked again at the next reconnect (Q1)",
    async () => {
      const { floor, native } = await bareLink();
      await native.subscribe("native.mesh.store.subscribe", { storeId: STORES.DOCS }, () => {});
      floor.meshNodeUp = false;
      expect(await redial(floor, native), "the link re-dialed").toBe(true);
      const docs = asks(floor, STORES.DOCS);
      floor.meshNodeUp = true;
      expect(await redial(floor, native), "the link re-dialed again").toBe(true);
      expect(
        await within(REARM_MS, () => asks(floor, STORES.DOCS) > docs),
        "the kept entry is replayed at the next reconnect",
      ).toBe(true);
    },
    ROW_BUDGET_MS,
  );
});
