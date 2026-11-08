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
import { NativeLink } from "../src/native-link";
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

/** The daemon's log lines, as written (an event's fields ride in the record whole, so a row reads them by text). */
function records(logRoot: string): Array<{ event: string; text: string }> {
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
    .map((line) => ({ event: (JSON.parse(line) as { event: string }).event, text: line }));
}

function events(logRoot: string): string[] {
  return records(logRoot).map((record) => record.event);
}

/** What the scripted floor was asked, by method (asked, answered or refused: `meshCalls` records before the gate). */
const calls = (floor: MockMgmtServer, method: string): number =>
  floor.meshCalls.filter((called) => called === method).length;

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
      // S2 (the review): the stream read the refusal as the node gate (the golden's shape), not as a plain retryable
      // refusal, which would also wait for node-up and pass this row for the wrong reason
      expect(
        records(logRoot).some(
          (r) =>
            r.event === "fieldd.mesh_stream.refused" && r.text.includes('"refusal":"node-gate"'),
        ),
        "the holders' stream read its refusal as the node gate",
      ).toBe(true);
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
    "the control: a node that never comes up leaves the stream waiting, asked once and no more",
    async () => {
      const { floor, logRoot } = await pair({ nodeUp: false });
      expect(
        await within(REARM_MS, () => events(logRoot).includes("fieldd.docs.holders_unavailable")),
        "the holders' boot subscribe was refused (fieldd.docs.holders_unavailable)",
      ).toBe(true);
      // three seconds of a floor whose node stays down: no node-up and no reconnect, so nothing is owed an ask. Its
      // health reads "starting", so no "ask now" is owed either: the refused boot ask is the only one. (S2's review:
      // the bound was "≤ 2", which a node read up by mistake, or a loop slower than the window, would keep green.)
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(asks(floor, STORES.DOCS), "the docs store was asked once, at boot").toBe(1);
      expect(floor.meshNodeUp).toBe(false);
    },
    ROW_BUDGET_MS,
  );

  it(
    "R1b (the note's §3.3): health says up while the gate still refuses, and the stream asks twice, then waits",
    async () => {
      const { floor, logRoot } = await pair({ nodeUp: false });
      expect(
        await within(REARM_MS, () => events(logRoot).includes("fieldd.docs.holders_unavailable")),
        "the holders' boot subscribe was refused (fieldd.docs.holders_unavailable)",
      ).toBe(true);
      // the one window the gate's answer and its health share: health turns up, and the gate has not opened
      floor.pushHealth(health("nr-floor-1", "up"));
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      // the moment's ask, refused; then the one ask a node that reads up NOW is owed, refused; then the wait. A
      // misread as a plain retryable refusal asks once; a loop asks on
      expect(asks(floor, STORES.DOCS) - 1, "the moment's ask and its one ask now").toBe(2);
    },
    ROW_BUDGET_MS,
  );
});

describe("NR R2 (item 238) — the floor restarts under fieldd and its node comes up a second after the re-dial", () => {
  it(
    "asks for the docs and devices stores again once the new floor's node is up, with no second reconnect",
    async () => {
      const { floor, logRoot, daemon } = await pair({ nodeUp: true });
      // a linked desktop running: every owned stream stands (the note's §6.1, rows 5, 6, 8a, 8b and 8c)
      const streams = (): number[] => [
        asks(floor, STORES.DOCS),
        asks(floor, STORES.DEVICES),
        asks(floor, STORES.ARTIFACTS),
        calls(floor, "native.mesh.serve.subscribe"),
        calls(floor, "native.mesh.peers.subscribe"),
      ];
      expect(
        await within(REARM_MS, () => streams().every((n) => n >= 1)),
        "the docs, devices and artifacts stores, the serve stream and the peers stream all stand",
      ).toBe(true);
      const standing = streams();
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
      // every stream's replay was asked (and refused) before the baseline is read, and the owners' one ask each has
      // landed in the second below, so only the node's coming up can raise a count from here (S2's review: a baseline
      // read mid-pass let the refused replay itself satisfy the row)
      expect(
        await within(
          REARM_MS,
          () => daemon.native.connected && streams().every((n, i) => n > (standing[i] ?? 0)),
        ),
        "the link is connected again and every stream's replay was asked",
      ).toBe(true);
      const redialed = floor.connections;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const [docs = 0, devices = 0, artifacts = 0, serves = 0, peers = 0] = streams();
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
      expect
        .soft(
          await within(REARM_MS, () => asks(floor, STORES.DEVICES) > devices),
          "the devices store is asked again once the new floor's node is up (DeviceService re-arms)",
        )
        .toBe(true);
      // S2 (the review): the three latch owners S2 adds beside the two R2 named, each red at S1 through its latch
      expect
        .soft(
          await within(REARM_MS, () => calls(floor, "native.mesh.peers.subscribe") > peers),
          "the peers stream is asked again (DeviceService's peers leg re-arms)",
        )
        .toBe(true);
      expect
        .soft(
          await within(REARM_MS, () => calls(floor, "native.mesh.serve.subscribe") > serves),
          "the serve stream is asked again (MeshClient's reconcile re-arms it)",
        )
        .toBe(true);
      expect
        .soft(
          await within(REARM_MS, () => asks(floor, STORES.ARTIFACTS) > artifacts),
          "the artifacts store is asked again (the catalog re-arms)",
        )
        .toBe(true);
      expect(floor.connections, "no second reconnect carried it").toBe(redialed);
    },
    ROW_BUDGET_MS,
  );
});

/** The owned subscribe: NativeLink's `NativeSubscribeOptions.onReplayFailed`, FielddClient's name, the note's §3.1. */
const owned = (native: NativeLink) => native.subscribe.bind(native);

/** A bare link to the scripted floor, connected, its node up. */
async function bareLink(
  opts: { requestDeadlineMs?: number } = {},
): Promise<{ floor: MockMgmtServer; native: NativeLink }> {
  const root = mkdtempSync(join(tmpdir(), "vf-nr-link-"));
  const pairingFile = join(root, "pairing");
  writeFileSync(pairingFile, "ab".repeat(32));
  const endpoint = nativeEndpoint(root, SOCKETS.MGMT);
  if (!isPipeEndpoint(endpoint)) mkdirSync(dirname(endpoint), { recursive: true });
  const floor = new MockMgmtServer(endpoint);
  await floor.start();
  const native = new NativeLink({ socketPath: endpoint, pairingFile, bootId: "nr-boot", ...opts });
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
    "a subscribe made DURING the replay pass, by an owner its replayed snapshot woke, is sent once (S2)",
    async () => {
      // the health stream's replayed snapshot can say the node is up, and a stream waiting on node-up subscribes then,
      // inside the pass: a pass that visited entries added while it ran sent that subscribe a second time
      const { floor, native } = await bareLink();
      let woken = 0;
      await native.subscribe(
        "native.mesh.store.subscribe",
        { storeId: STORES.DOCS },
        (_payload, kind) => {
          if (kind !== "snapshot" || woken > 0) return;
          woken += 1;
          void native
            .subscribe("native.mesh.store.subscribe", { storeId: STORES.DEVICES }, () => {})
            .catch(() => undefined);
        },
      );
      const devices = asks(floor, STORES.DEVICES);
      expect(await redial(floor, native), "the link re-dialed").toBe(true);
      await within(REARM_MS, () => asks(floor, STORES.DEVICES) > devices);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(woken, "the replayed snapshot woke its owner").toBe(1);
      expect(asks(floor, STORES.DEVICES) - devices, "the woken subscribe, sent once").toBe(1);
    },
    ROW_BUDGET_MS,
  );

  it(
    "R4e: an owned replay that TIMES OUT is ended and told as TIMEOUT (S2)",
    async () => {
      const { floor, native } = await bareLink({ requestDeadlineMs: 300 });
      const heard: string[] = [];
      await owned(native)("native.mesh.store.subscribe", { storeId: STORES.DOCS }, () => {}, {
        onReplayFailed: (error) => heard.push(error.kind),
      });
      // the floor takes the replay and never answers it
      floor.silentMethods.add("native.mesh.store.subscribe");
      expect(await redial(floor, native), "the link re-dialed").toBe(true);
      await within(REARM_MS, () => heard.length >= 1);
      expect(heard, "the owner heard its replay time out, once").toEqual(["TIMEOUT"]);
    },
    ROW_BUDGET_MS,
  );

  it(
    "R4f: an owner that ends its subscription before it is told is never told (S2)",
    async () => {
      const { floor, native } = await bareLink();
      const heard: string[] = [];
      const docs = await owned(native)(
        "native.mesh.store.subscribe",
        { storeId: STORES.DOCS },
        () => {},
        { onReplayFailed: (error) => heard.push(error.kind) },
      );
      // "connected" comes before the owners are told: an owner that disposes there has let its subscription go
      native.once("connected", () => docs.dispose());
      floor.meshNodeUp = false;
      expect(await redial(floor, native), "the link re-dialed").toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(heard, "nobody is told of a subscription its owner ended").toEqual([]);
    },
    ROW_BUDGET_MS,
  );

  it(
    "R4g: an entry an earlier replay's owner disposes during the pass is not replayed (S2)",
    async () => {
      const { floor, native } = await bareLink();
      let later: { dispose: () => void } | null = null;
      await native.subscribe(
        "native.mesh.store.subscribe",
        { storeId: STORES.DOCS },
        (_p, kind) => {
          if (kind === "snapshot") later?.dispose();
        },
      );
      later = await native.subscribe(
        "native.mesh.store.subscribe",
        { storeId: STORES.DEVICES },
        () => {},
      );
      const devices = asks(floor, STORES.DEVICES);
      const docs = asks(floor, STORES.DOCS);
      expect(await redial(floor, native), "the link re-dialed").toBe(true);
      await within(REARM_MS, () => asks(floor, STORES.DOCS) > docs);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(asks(floor, STORES.DEVICES), "the disposed entry was not replayed").toBe(devices);
    },
    ROW_BUDGET_MS,
  );

  it(
    "R4h: an owner that throws when told leaves the other owners told (S2)",
    async () => {
      const { floor, native } = await bareLink();
      const heard: string[] = [];
      await owned(native)("native.mesh.store.subscribe", { storeId: STORES.DOCS }, () => {}, {
        onReplayFailed: () => {
          throw new Error("an owner that throws");
        },
      });
      await owned(native)("native.mesh.store.subscribe", { storeId: STORES.DEVICES }, () => {}, {
        onReplayFailed: (error) => heard.push(error.kind),
      });
      floor.meshNodeUp = false;
      expect(await redial(floor, native), "the link re-dialed").toBe(true);
      await within(REARM_MS, () => heard.length >= 1);
      expect(heard, "the second owner was told").toEqual(["UNAVAILABLE"]);
      expect(native.connected, "a throwing owner fails nothing").toBe(true);
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

describe("NR R5 (S2, R4d's daemon twin) — the floor restarts with its node up while the holders wait", () => {
  it(
    "the node-up a replayed health snapshot carries mid-pass asks for the docs store once, not twice",
    async () => {
      const { floor, logRoot, daemon } = await pair({ nodeUp: false });
      expect(
        await within(REARM_MS, () => events(logRoot).includes("fieldd.docs.holders_unavailable")),
        "the holders' boot subscribe was refused (fieldd.docs.holders_unavailable)",
      ).toBe(true);
      const before = floor.connections;
      // a new floor whose node is already up: the re-dial's replay of the health stream says so, inside the pass
      floor.meshNodeUp = true;
      floor.healthSnapshot = health("nr-floor-2", "up");
      floor.killClients();
      expect(
        await within(REARM_MS, () => floor.connections > before && daemon.native.connected),
        "the link re-dialed",
      ).toBe(true);
      await within(REARM_MS, () => asks(floor, STORES.DOCS) >= 2);
      await new Promise((resolve) => setTimeout(resolve, 500));
      // the boot's refused ask, then the stream's one ask at that node-up. A pass that visited entries added while
      // it ran sent that ask a second time
      expect(asks(floor, STORES.DOCS), "the boot ask and the re-arm's, once").toBe(2);
    },
    ROW_BUDGET_MS,
  );
});
