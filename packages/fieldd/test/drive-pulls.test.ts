// DR-3b (W3, VF-RELAY) — fieldd's half of the floor's file transfer (src/drive/pulls.ts; contracts mgmt.ts
// `NativeFileTransfer*`), and the service's refusals over it (src/drive/service.ts). Against the scripted floor over
// a real NativeLink (src/testing/mock-mgmt.ts: `"unsupported"` is the floor at the =0.7.24 pin, `mockFileTransfer()`
// a floor whose truffle pulls by a named root, in C1's refusal order), with a real `lands` folder under a temp root.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DRIVE_LIMITS,
  DRIVE_SERVICE,
  DriveUnavailableDetails,
  FILE_TRANSFER_ID_PATTERN,
  FILE_TRANSFER_ROOTS,
  isPipeEndpoint,
  LAYOUT,
  MESH_FILE_TRANSFER,
  NATIVE_REFUSALS,
  NativeFileTransferPullParams,
  NativeFileTransferRootsResult,
  RPC_ERROR_CODES,
  SOCKETS,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { DriveHolders } from "../src/drive/holders";
import { DriveLaneRelay } from "../src/drive/lane-relay";
import {
  type DriveAdoptCandidate,
  DrivePullFailed,
  DrivePulls,
  type DrivePullsFloor,
  type DrivePullsOptions,
} from "../src/drive/pulls";
import { DriveService } from "../src/drive/service";
import { OutboundLaneIdAllocator } from "../src/lane-id";
import { NativeLink, RpcCallError } from "../src/native-link";
import { type MockFileTransfer, MockMgmtServer, mockFileTransfer } from "../src/testing/mock-mgmt";
import {
  type CapturedLog,
  captureLogger,
  EXHAUSTED_GOLDEN,
  FakeDriveLaneBytes,
  FakeDriveLaneControl,
  FakeDriveStore,
  refusingFloor,
  sleep,
  UNSUPPORTED_GOLDEN,
  until,
} from "./drive-fakes";
import { nativeEndpoint } from "./native-harness";

const ROOT = FILE_TRANSFER_ROOTS.DRIVE_OBJECTS.name;
const SHA = "075eeb056ba8f587858fe88dd968e5d29207d6537944d88d8826a56cb8e89a42";
const SUBSCRIBE = "native.mesh.fileTransfer.subscribe";
const ROOTS = "native.mesh.fileTransfer.roots";
const PULL = "native.mesh.fileTransfer.pull";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

/** A blake3-shaped digest, and the path a holder serves it under (mille-drive's `<2 hex>/<64 hex>` shard). */
const digestOf = (n: number) => n.toString(16).padStart(64, "0");
const pathOf = (digest: string) => `${digest.slice(0, 2)}/${digest}`;
const ask = (digest: string, peer = "peer-a") => ({ peer, digest, path: pathOf(digest) });

/** The nth fixed transferId: a ULID's shape (FILE_TRANSFER_ID_PATTERN), two digits at its end. */
const idFor = (n: number) => `01JC8ZK4W2MX7N3Q5R9T6V0B${String(n).padStart(2, "0")}`;
/** A pull as the floor reads it, sent to the floor with no DrivePulls between: the nth id, the mth digest. */
const pullOf = (n: number, m: number) => ({
  transferId: idFor(n),
  peer: "peer-a",
  root: ROOT,
  path: pathOf(digestOf(m)),
  digest: digestOf(m),
});

function completed(transferId: string, digest: string) {
  return {
    kind: "completed",
    transferId,
    digest,
    incoming: `${digest}.${transferId}`,
    bytes: 5,
    sha256: SHA,
  };
}

/** An answer's ErrorData as the wire carried it: NativeLink keeps its `kind`, `retryable` and `details`. */
const errorData = (error: RpcCallError) => ({
  kind: error.kind,
  retryable: error.retryable,
  details: error.details,
});

/** A round trip on the link: every reply the floor wrote before it has been read, and its continuation run. */
async function roundTrip(link: NativeLink): Promise<void> {
  await link.request("native.lifecycle.ping", {});
  await sleep(10);
}

/** The scripted floor over a real NativeLink, and this desktop's user root and `lands` folder under one temp root. */
async function floor(transfer: "unsupported" | MockFileTransfer = mockFileTransfer()) {
  const dir = mkdtempSync(join(tmpdir(), "vf-dp-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "pairing"), "ab".repeat(32));
  const endpoint = nativeEndpoint(dir, SOCKETS.MGMT);
  if (!isPipeEndpoint(endpoint)) mkdirSync(dirname(endpoint), { recursive: true });
  const mock = new MockMgmtServer(endpoint);
  mock.fileTransfer = transfer;
  await mock.start();
  cleanup.push(() => mock.stop());
  const link = new NativeLink({
    socketPath: endpoint,
    pairingFile: join(dir, "pairing"),
    bootId: "b",
  });
  cleanup.push(() => link.close());
  await link.connect();
  const landsDir = join(dir, ...LAYOUT.DRIVE_INCOMING_DIR);
  mkdirSync(landsDir, { recursive: true });
  return { mock, link, root: dir, landsDir };
}

function pulls(link: NativeLink, root: string, extra: Partial<DrivePullsOptions> = {}) {
  const drive = new DrivePulls({
    floor: link,
    userRoot: root,
    roots: () => [ROOT],
    bootId: () => "boot-1",
    linked: () => true,
    ...extra,
  });
  cleanup.push(() => drive.stop());
  return drive;
}

/** The service over `drive`, with fakes for the lanes and the slice: these rows are the pulls'. */
function serviceOver(drive: DrivePulls) {
  const control = new FakeDriveLaneControl();
  const relay = new DriveLaneRelay({
    control,
    bytes: new FakeDriveLaneBytes(),
    allocateLaneId: new OutboundLaneIdAllocator().allocate,
    isSelfPeer: () => true,
  });
  const holders = new DriveHolders({
    mesh: new FakeDriveStore().member("studio"),
    deviceId: () => "studio",
    drive: () => null,
    linked: () => true,
  });
  const service = new DriveService({ relay, pulls: drive, holders });
  cleanup.push(() => service.stop());
  return { service, control };
}

/** The running pull of `digest` at the floor. */
function idOf(transfer: MockFileTransfer, digest: string): string {
  for (const row of transfer.running.values()) if (row.digest === digest) return row.transferId;
  throw new Error(`no pull of ${digest} is running`);
}

const asked = (mock: MockMgmtServer, method: string) =>
  mock.meshCalls.filter((m) => m === method).length;

/** What a promise settled to, or "pending" while it has not. */
function settled(promise: Promise<unknown>): () => string {
  let state = "pending";
  promise.then(
    () => {
      state = "resolved";
    },
    () => {
      state = "rejected";
    },
  );
  return () => state;
}

describe("DR-3b — the drive's pulls over the floor's file transfer", () => {
  it("reads the pin's floor as unsupported, caches it for the boot, and the service says unbuilt", async () => {
    const { mock, link, root } = await floor("unsupported");
    let boot: string | undefined = "boot-1";
    const drive = pulls(link, root, { bootId: () => boot });
    await drive.start();
    expect(drive.unsupported()).toBe(true);
    expect(mock.meshCalls).toEqual([SUBSCRIBE]);
    // cached: refused here, in the floor's own words (the pin's golden), and never sent
    const cached = await drive.pull(ask(digestOf(1))).catch((error: unknown) => error);
    expect(cached).toBeInstanceOf(RpcCallError);
    expect(errorData(cached as RpcCallError)).toEqual(UNSUPPORTED_GOLDEN);
    expect(mock.meshCalls).toEqual([SUBSCRIBE]);
    const { service } = serviceOver(drive);
    const refusal = await service.pull(ask(digestOf(1))).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RpcCallError);
    expect((refusal as RpcCallError).retryable).toBe(false);
    expect(DriveUnavailableDetails.parse((refusal as RpcCallError).details)).toEqual({
      service: DRIVE_SERVICE.SERVICE,
      state: DRIVE_SERVICE.STATE_UNBUILT,
    });
    // the cache is the boot's: a floor of another boot is asked again, and a boot not known caches nothing
    boot = "boot-2";
    expect(drive.unsupported()).toBe(false);
    await drive.pull(ask(digestOf(1))).catch(() => undefined);
    expect(mock.meshCalls).toEqual([SUBSCRIBE, PULL]);
    expect(drive.unsupported()).toBe(true);
    boot = undefined;
    await drive.pull(ask(digestOf(1))).catch(() => undefined);
    await drive.pull(ask(digestOf(1))).catch(() => undefined);
    expect(drive.unsupported()).toBe(false);
    expect(mock.meshCalls).toEqual([SUBSCRIBE, PULL, PULL, PULL]);
    // a floor before the facade (a node answers these verbs method-not-found) reads the same
    const notFound = new RpcCallError("NOT_FOUND", "method not found", false, undefined, -32601);
    const old = refusingFloor(notFound);
    const before = pulls(link, root, { floor: old });
    await before.start();
    expect(before.unsupported()).toBe(true);
    expect(old.asked).toEqual([SUBSCRIBE]);
  });

  it("holds the scripted floor to C1's refusal order, and its default to the pin's golden", async () => {
    // mock-mgmt's ~80 consumers read its default; these answers are the wire's, with no DrivePulls between
    const { mock, link } = await floor("unsupported");
    const refused = async (method: string, params: unknown = {}): Promise<RpcCallError> => {
      const error = await link.request(method, params).catch((caught: unknown) => caught);
      expect(error, method).toBeInstanceOf(RpcCallError);
      return error as RpcCallError;
    };
    const offer = "native.mesh.fileTransfer.offer";
    const notFound = { kind: "NOT_FOUND", code: -32601 };
    // 0. a name the contract does not declare is none, ahead of step 1
    expect(await refused(offer)).toMatchObject(notFound);
    // 1. the pin's floor answers every declared verb the golden, -32006, node or no node
    mock.meshUnavailable = true;
    for (const verb of [ROOTS, PULL, SUBSCRIBE]) {
      const error = await refused(verb);
      expect(error.code, verb).toBe(RPC_ERROR_CODES.UNAVAILABLE);
      expect(errorData(error), verb).toEqual(UNSUPPORTED_GOLDEN);
    }
    const transfer = mockFileTransfer({ gated: false });
    mock.fileTransfer = transfer;
    expect(await refused(offer)).toMatchObject(notFound);
    // 2. the stream is answered with no node; 3. roots and pull answer the node gate
    expect(await link.request(SUBSCRIBE, {})).toMatchObject({ snapshot: { transfers: [] } });
    const gate = { kind: "UNAVAILABLE", details: { service: "mesh-gateway" } };
    expect(await refused(ROOTS)).toMatchObject(gate);
    expect(await refused(PULL)).toMatchObject(gate);
    // 4. a capture refuses them MESH_CAPTURING
    mock.meshUnavailable = false;
    mock.meshPosture = { mode: "capture" };
    const capturing = { kind: "PRECONDITION_FAILED", details: { code: "MESH_CAPTURING" } };
    expect(await refused(ROOTS)).toMatchObject(capturing);
    expect(await refused(PULL)).toMatchObject(capturing);
    mock.meshPosture = undefined;
    // 5. params the floor cannot read
    const unreadable = { kind: "PRECONDITION_FAILED", code: RPC_ERROR_CODES.PRECONDITION_FAILED };
    expect(await refused(ROOTS, { roots: ["../up"] })).toMatchObject(unreadable);
    expect(await refused(PULL, { transferId: "lower" })).toMatchObject(unreadable);
    // 6. an ungated node holds the root; a pull is refused CONFLICT by its id, then by its digest, and one past
    // DRIVE_LIMITS.PULLS_IN_FLIGHT as its golden holds it (W3-15, VF-PM 2026-11-06)
    const held = await link.request(ROOTS, { roots: [ROOT] });
    expect(NativeFileTransferRootsResult.parse(held)).toEqual({
      roots: [{ name: ROOT, registered: false, reason: MESH_FILE_TRANSFER.ROOT_UNGATED }],
    });
    expect(await link.request(PULL, pullOf(1, 1))).toEqual({ transferId: idFor(1) });
    const conflict = { kind: "CONFLICT", retryable: false, code: RPC_ERROR_CODES.CONFLICT };
    expect(await refused(PULL, pullOf(1, 2))).toMatchObject(conflict);
    expect(await refused(PULL, pullOf(2, 1))).toMatchObject(conflict);
    for (let n = 2; n <= DRIVE_LIMITS.PULLS_IN_FLIGHT; n++) {
      await link.request(PULL, pullOf(n, n));
    }
    expect(transfer.running.size).toBe(DRIVE_LIMITS.PULLS_IN_FLIGHT);
    const exhausted = await refused(PULL, pullOf(9, 9));
    expect(exhausted.code).toBe(RPC_ERROR_CODES[EXHAUSTED_GOLDEN.kind]);
    expect(errorData(exhausted)).toEqual(EXHAUSTED_GOLDEN);
  });

  it("leaves a pull running while the stream's replay still lists it, and settles it on its delta", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root, landsDir } = await floor(transfer);
    const drive = pulls(link, root);
    link.on("connected", () => void drive.connected());
    await drive.start();
    const digest = digestOf(1);
    const landed = drive.pull(ask(digest));
    const state = settled(landed);
    await until(() => transfer.running.size === 1, "the pull reached the floor");
    await roundTrip(link);
    const id = idOf(transfer, digest);
    // the link drops and comes back: NativeLink replays the stream, and its snapshot still lists the pull
    mock.killClients();
    await until(() => asked(mock, SUBSCRIBE) === 2, "the stream's replay", 6_000);
    await sleep(50);
    expect(state()).toBe("pending");
    mock.pushFileTransferDelta(completed(id, digest));
    await expect(landed).resolves.toEqual({ path: join(landsDir, `${digest}.${id}`) });
  });

  it("leaves a pull running when a snapshot written before its answer comes in the same read, and settles it on its delta", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root, landsDir } = await floor(transfer);
    const looked: string[] = [];
    const drive = pulls(link, root, {
      exists: async (path) => {
        looked.push(path);
        return existsSync(path);
      },
    });
    await drive.start();
    // the floor writes its table as it was before this pull began, then the pull's answer, in ONE write: the
    // snapshot is read first, and judged after the answer's continuation has accepted the pull
    transfer.snapshotBeforeAnswer = true;
    const digest = digestOf(1);
    const landed = drive.pull(ask(digest));
    const state = settled(landed);
    await until(() => !transfer.snapshotBeforeAnswer, "the snapshot and the answer, written");
    const id = idOf(transfer, digest);
    // it may have been written before the answer, so it reads nothing of the pull and holds it (race#0 (b)): ONE
    // re-subscribe, whose snapshot, built after the answer, lists the pull, so it runs on, its lands folder unread
    await until(() => asked(mock, SUBSCRIBE) === 2, "the one re-subscribe");
    await roundTrip(link);
    expect(state()).toBe("pending");
    expect(looked).toEqual([]);
    expect(asked(mock, SUBSCRIBE)).toBe(2);
    mock.pushFileTransferDelta(completed(id, digest));
    await expect(landed).resolves.toEqual({ path: join(landsDir, `${digest}.${id}`) });
  });

  it("reads no landed name for a snapshot written before a pull's answer, and ends the pull on its own delta", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root, landsDir } = await floor(transfer);
    const id = idFor(1);
    const drive = pulls(link, root, { mintId: () => id });
    await drive.start();
    // its landed name is in the folder, as when the floor has placed the file and then fails the pull (`finish`)
    const digest = digestOf(1);
    writeFileSync(join(landsDir, `${digest}.${id}`), "object bytes");
    transfer.snapshotBeforeAnswer = true;
    const landed = drive.pull(ask(digest));
    const state = settled(landed);
    await until(() => !transfer.snapshotBeforeAnswer, "the snapshot and the answer, written");
    // the re-subscribe's snapshot lists the pull: a running pull it lists is never settled, landed file or none
    await until(() => asked(mock, SUBSCRIBE) === 2, "the one re-subscribe");
    await roundTrip(link);
    expect(state()).toBe("pending");
    const reason = MESH_FILE_TRANSFER.FAILED_INTEGRITY;
    mock.pushFileTransferDelta({ kind: "failed", transferId: id, reason, message: "bad" });
    await expect(landed).rejects.toMatchObject({ reason, transferId: id });
  });

  it("re-subscribes once for a pull held by a snapshot read with its answer, and that snapshot ends it failed io", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root } = await floor(transfer);
    const drive = pulls(link, root);
    await drive.start();
    // the floor answers the pull, the pull ends and its delta is lost, and the snapshot that loss is owed follows,
    // in ONE write: read before the pull's fence ran, the snapshot may predate the answer, so it holds the pull
    transfer.snapshotAfterAnswer = true;
    const ended = drive.pull(ask(digestOf(1))).catch((error: unknown) => error);
    await until(() => !transfer.snapshotAfterAnswer, "the answer and the snapshot, written");
    // race#0 (b), VF-PM 2026-11-06: ONE re-subscribe, whose snapshot, built after the answer, omits the pull, and
    // the lands rule ends it at once, long before the held bound (60 s here)
    const failure = await ended;
    expect(failure).toBeInstanceOf(DrivePullFailed);
    expect(failure).toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_IO });
    expect(transfer.running.size).toBe(0);
    expect(asked(mock, SUBSCRIBE)).toBe(2);
  });

  it("re-subscribes once for a pull held by a snapshot read with its answer, and resolves it when its file landed", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root, landsDir } = await floor(transfer);
    const id = idFor(1);
    const drive = pulls(link, root, { mintId: () => id });
    await drive.start();
    // it completed and its delta was lost: its file is in place before its answer and the owed snapshot are read
    const digest = digestOf(1);
    const path = join(landsDir, `${digest}.${id}`);
    writeFileSync(path, "object bytes");
    transfer.snapshotAfterAnswer = true;
    const landed = drive.pull(ask(digest));
    const state = settled(landed);
    await until(() => !transfer.snapshotAfterAnswer, "the answer and the snapshot, written");
    await expect(landed).resolves.toEqual({ path });
    expect(state()).toBe("resolved");
    expect(asked(mock, SUBSCRIBE)).toBe(2);
  });

  it("ends a held pull FAILED_TIMEOUT at its bound when its re-subscribe is refused or never answered", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root } = await floor(transfer);
    const events: CapturedLog[] = [];
    const drive = pulls(link, root, { heldBoundMs: 1_000, logger: captureLogger(events) });
    await drive.start();
    const subscribes = () => mock.requestLog.filter((r) => r.method === SUBSCRIBE).length;
    // 1. refused: the pull has left (its request is written as `pull` is called), and from here the floor is held
    // unresponsive (WG-D4), so a door's subscribe is refused at once and never sent
    transfer.snapshotAfterAnswer = true;
    const first = drive.pull(ask(digestOf(1)));
    const firstState = settled(first);
    link.setDoorGate(() => ({
      service: NATIVE_REFUSALS.SERVICE,
      state: NATIVE_REFUSALS.STATE_UNRESPONSIVE,
    }));
    const subscribeRefused = (e: CapturedLog) =>
      e.event === "fieldd.drive.file_transfer_refused" && e.attrs?.["method"] === SUBSCRIBE;
    await until(() => events.some(subscribeRefused), "the re-subscribe, refused");
    // the refusal ends nothing: the bound does
    expect(firstState()).toBe("pending");
    await expect(first).rejects.toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_TIMEOUT });
    expect(subscribes()).toBe(1);
    // 2. never answered: the floor reads the re-subscribe and says nothing
    link.setDoorGate(null);
    mock.silentMethods.add(SUBSCRIBE);
    transfer.snapshotAfterAnswer = true;
    const second = drive.pull(ask(digestOf(2)));
    const secondState = settled(second);
    await until(() => subscribes() === 2, "the re-subscribe, unanswered");
    expect(secondState()).toBe("pending");
    await expect(second).rejects.toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_TIMEOUT });
  });

  it("serves every pull one snapshot held with ONE re-subscribe, and disposes the stream the floor replaced", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root } = await floor(transfer);
    // NativeLink's subscriptions, numbered as made, and every one disposed (its dispose tells the floor nothing)
    const disposed: number[] = [];
    let made = 0;
    const counted: DrivePullsFloor = {
      request: (method, params) => link.request(method, params),
      subscribe: async (method, params, onEvent) => {
        made += 1;
        const n = made;
        const subscription = await link.subscribe(method, params, onEvent);
        return {
          snapshot: subscription.snapshot,
          dispose: () => {
            disposed.push(n);
            subscription.dispose();
          },
        };
      },
    };
    const drive = pulls(link, root, { floor: counted });
    await drive.start();
    // two pulls run with their answers held (this reader is behind), both end and their deltas are lost, then both
    // answers and the snapshot owed come in ONE read, before either pull's fence ran: it holds both
    transfer.holdAnswers = true;
    const first = drive.pull(ask(digestOf(1))).catch((error: unknown) => error);
    const second = drive.pull(ask(digestOf(2))).catch((error: unknown) => error);
    await until(() => transfer.running.size === 2, "both pulls run");
    transfer.running.clear();
    transfer.holdAnswers = false;
    mock.releaseFileTransferAnswers();
    // ONE re-subscribe serves both: its snapshot, built after both answers, omits both, and the lands rule ends them
    for (const failure of [await first, await second]) {
      expect(failure).toBeInstanceOf(DrivePullFailed);
      expect(failure).toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_IO });
    }
    expect(asked(mock, SUBSCRIBE)).toBe(2);
    expect(made).toBe(2);
    // the floor replaced the first stream with it (W3-20, VF-PM 2026-11-06), and fieldd disposed the first
    expect(transfer.replaced).toEqual([transfer.subscribed[0]]);
    expect(disposed).toEqual([1]);
  });

  it("mints a ULID and asks with the contract's fields; a path outside the grammar is refused, unsent", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root } = await floor(transfer);
    const drive = pulls(link, root);
    await drive.start();
    void drive.pull(ask(digestOf(1))).catch(() => undefined);
    await until(() => transfer.pulls.length === 1, "the pull reached the floor");
    expect(NativeFileTransferPullParams.parse(transfer.pulls[0])).toEqual({
      transferId: expect.stringMatching(new RegExp(FILE_TRANSFER_ID_PATTERN)),
      peer: "peer-a",
      root: ROOT,
      path: pathOf(digestOf(1)),
      digest: digestOf(1),
    });
    const sent = mock.meshCalls.length;
    const long = "a".repeat(MESH_FILE_TRANSFER.PATH_MAX_BYTES + 1);
    for (const path of ["/etc/passwd", "../up", "a//b", ".hidden", "a\\b", "a/./b", long]) {
      const refusal = drive.pull({ peer: "peer-a", digest: digestOf(2), path });
      await expect(refusal, path).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    }
    expect(mock.meshCalls.length).toBe(sent);
  });

  it("resolves a completion with the landed path, and refuses one landed under another name or digest", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root, landsDir } = await floor(transfer);
    const drive = pulls(link, root);
    await drive.start();
    const first = drive.pull(ask(digestOf(1)));
    const second = drive.pull(ask(digestOf(2)));
    const third = drive.pull(ask(digestOf(4)));
    await until(() => transfer.running.size === 3, "three pulls run");
    const a = idOf(transfer, digestOf(1));
    const b = idOf(transfer, digestOf(2));
    const c = idOf(transfer, digestOf(4));
    mock.pushFileTransferDelta(completed(a, digestOf(1)));
    await expect(first).resolves.toEqual({ path: join(landsDir, `${digestOf(1)}.${a}`) });
    // a name this pull did not ask for is never handed on as its object
    mock.pushFileTransferDelta({ ...completed(b, digestOf(2)), incoming: `${digestOf(3)}.${b}` });
    await expect(second).rejects.toBeInstanceOf(DrivePullFailed);
    await expect(second).rejects.toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_IO });
    // nor one whose name and digest agree with each other but name another object
    mock.pushFileTransferDelta(completed(c, digestOf(5)));
    await expect(third).rejects.toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_IO });
  });

  it("rejects a failure with the floor's word, and reads a word it does not know as io", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root } = await floor(transfer);
    const drive = pulls(link, root);
    await drive.start();
    const first = drive.pull(ask(digestOf(1)));
    const second = drive.pull(ask(digestOf(2)));
    await until(() => transfer.running.size === 2, "both pulls run");
    const a = idOf(transfer, digestOf(1));
    const b = idOf(transfer, digestOf(2));
    const rejected = MESH_FILE_TRANSFER.FAILED_REJECTED;
    mock.pushFileTransferDelta({ kind: "failed", transferId: a, reason: rejected, message: "no" });
    mock.pushFileTransferDelta({ kind: "failed", transferId: b, reason: "solar", message: "?" });
    await expect(first).rejects.toMatchObject({ reason: rejected, message: "no", transferId: a });
    await expect(second).rejects.toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_IO });
  });

  it("ends a pull the node's teardown ends, node-down on the same stream, and frees its digest", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root } = await floor(transfer);
    const drive = pulls(link, root);
    await drive.start();
    expect(transfer.roots).toEqual([ROOT]);
    const digest = digestOf(1);
    const ended = drive.pull(ask(digest)).catch((error: unknown) => error);
    await until(() => transfer.running.size === 1, "the pull runs");
    // an unlink retires the node: the floor drops the held roots and ends every pull it ran (C1's W3-2)
    await link.request("native.mesh.retire", {});
    const failure = await ended;
    expect(failure).toBeInstanceOf(DrivePullFailed);
    expect(failure).toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_NODE_DOWN });
    expect(transfer.roots).toEqual([]);
    // the node is gone and the digest is free: the next pull of it reaches the floor, and its node gate
    mock.meshUnavailable = true;
    const sent = asked(mock, PULL);
    const again = await drive.pull(ask(digest)).catch((error: unknown) => error);
    expect(asked(mock, PULL)).toBe(sent + 1);
    expect(again).toMatchObject({ kind: "UNAVAILABLE", details: { service: "mesh-gateway" } });
  });

  it("refuses a second pull of a running digest here, in the floor's CONFLICT shape, unsent", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root } = await floor(transfer);
    const drive = pulls(link, root);
    await drive.start();
    void drive.pull(ask(digestOf(1))).catch(() => undefined);
    await until(() => transfer.running.size === 1, "the pull runs");
    const sent = mock.meshCalls.length;
    const refusal = await drive.pull(ask(digestOf(1), "peer-b")).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RpcCallError);
    // C1's error-data.file-transfer-conflict.json (nit 9): CONFLICT, retryable false, no details. C1 is not on this
    // lane's base, so the shape is written out; once C1 and this lane are both on main, the row reads the golden.
    expect(refusal).toMatchObject({
      kind: "CONFLICT",
      retryable: false,
      code: RPC_ERROR_CODES.CONFLICT,
    });
    expect((refusal as RpcCallError).details).toBeUndefined();
    expect(mock.meshCalls.length).toBe(sent);
    expect(transfer.pulls).toHaveLength(1);
  });

  it("runs DRIVE_LIMITS.PULLS_IN_FLIGHT pulls at once, and refuses one more here, unsent", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root } = await floor(transfer);
    const drive = pulls(link, root);
    await drive.start();
    for (let n = 1; n <= DRIVE_LIMITS.PULLS_IN_FLIGHT; n++) {
      void drive.pull(ask(digestOf(n))).catch(() => undefined);
    }
    await until(() => transfer.running.size === DRIVE_LIMITS.PULLS_IN_FLIGHT, "four pulls run");
    const sent = mock.meshCalls.length;
    // as the floor's golden holds it: retryable true and no details (W3-15, VF-PM 2026-11-06)
    const refusal = await drive.pull(ask(digestOf(9))).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RpcCallError);
    expect((refusal as RpcCallError).code).toBe(RPC_ERROR_CODES[EXHAUSTED_GOLDEN.kind]);
    expect(errorData(refusal as RpcCallError)).toEqual(EXHAUSTED_GOLDEN);
    expect(mock.meshCalls.length).toBe(sent);
  });

  it("resyncs a pull the snapshot no longer lists as completed when its file landed", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root, landsDir } = await floor(transfer);
    const drive = pulls(link, root);
    await drive.start();
    const digest = digestOf(1);
    const landed = drive.pull(ask(digest));
    await until(() => transfer.running.size === 1, "the pull runs");
    // the snapshot below comes after the pull's fence (a round trip after its answer): the lands rule's
    await roundTrip(link);
    const id = idOf(transfer, digest);
    // it ended while the reader lagged: its delta was lost, its file is in place
    writeFileSync(join(landsDir, `${digest}.${id}`), "object bytes");
    transfer.running.delete(id);
    mock.pushFileTransferSnapshot();
    await expect(landed).resolves.toEqual({ path: join(landsDir, `${digest}.${id}`) });
  });

  it("resyncs a pull the snapshot no longer lists, with nothing landed, as failed io", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root, landsDir } = await floor(transfer);
    const drive = pulls(link, root);
    await drive.start();
    const digest = digestOf(1);
    const landed = drive.pull(ask(digest));
    await until(() => transfer.running.size === 1, "the pull runs");
    // the snapshot below comes after the pull's fence (a round trip after its answer): the lands rule's
    await roundTrip(link);
    const id = idOf(transfer, digest);
    // the floor's temporary is no landed file, and only the floor removes it
    const temporary = join(landsDir, `${digest}.${id}.0123abcd.truffle-tmp`);
    writeFileSync(temporary, "half");
    transfer.running.delete(id);
    mock.pushFileTransferSnapshot();
    await expect(landed).rejects.toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_IO });
    expect(existsSync(temporary)).toBe(true);
  });

  it("asks a floor once unsupported again at a reconnect, and declares the roots at node-up and every reconnect", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root } = await floor("unsupported");
    mock.meshUnavailable = true;
    const drive = pulls(link, root);
    link.on("connected", () => void drive.connected());
    await drive.start();
    expect(drive.unsupported()).toBe(true);
    // the floor is upgraded under a fieldd that stays: the reconnect asks again
    mock.fileTransfer = transfer;
    mock.killClients();
    await until(() => asked(mock, ROOTS) === 1, "the roots, asked at the reconnect", 6_000);
    expect(drive.unsupported()).toBe(false);
    expect(asked(mock, SUBSCRIBE)).toBe(2);
    // the stream is answered with no node (rider B); the roots wait for one
    expect(transfer.declared).toEqual([]);
    mock.meshUnavailable = false;
    await drive.nodeUp();
    expect(transfer.declared).toEqual([[ROOT]]);
    expect(drive.roots()).toEqual([{ name: ROOT, state: "served" }]);
    // facade state is rebuilt, never persisted: a reconnect declares the whole set again
    mock.killClients();
    await until(() => transfer.declared.length === 2, "the roots, declared again", 6_000);
    expect(transfer.declared[1]).toEqual([ROOT]);
  });

  it("reads ROOT_UNGATED as held, never refused; declares nothing while unlinked, and none while the drive is closed", async () => {
    const transfer = mockFileTransfer({ gated: false });
    const { link, root } = await floor(transfer);
    let open = true;
    let linked = true;
    const drive = pulls(link, root, {
      roots: () => (open ? [ROOT] : []),
      linked: () => linked,
    });
    await drive.start();
    expect(transfer.declared).toEqual([[ROOT]]);
    const ungated = MESH_FILE_TRANSFER.ROOT_UNGATED;
    expect(drive.roots()).toEqual([{ name: ROOT, state: "held", reason: ungated }]);
    // unlinked (a capture, say): nothing is declared, at node-up or asked, and the floor's held set stands
    linked = false;
    await drive.nodeUp();
    await drive.declareRoots();
    expect(transfer.declared).toEqual([[ROOT]]);
    linked = true;
    open = false;
    expect(await drive.declareRoots()).toEqual([]);
    expect(transfer.declared).toEqual([[ROOT], []]);
  });

  it("drops a payload outside the contract, and the pull still settles on the next good one", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root, landsDir } = await floor(transfer);
    const events: CapturedLog[] = [];
    const drive = pulls(link, root, { logger: captureLogger(events) });
    await drive.start();
    const digest = digestOf(1);
    const landed = drive.pull(ask(digest));
    const state = settled(landed);
    await until(() => transfer.running.size === 1, "the pull runs");
    const id = idOf(transfer, digest);
    mock.pushFileTransferDelta({ ...completed(id, digest), digest: "not-a-digest" });
    mock.pushFileTransferDelta({ kind: "teleported", transferId: id });
    mock.pushFileTransferSnapshot({ transfers: "none" });
    const dropped = () => events.filter((e) => e.event === "fieldd.drive.pull_event_dropped");
    await until(() => dropped().length === 3, "three payloads dropped");
    expect(state()).toBe("pending");
    mock.pushFileTransferDelta(completed(id, digest));
    await expect(landed).resolves.toEqual({ path: join(landsDir, `${digest}.${id}`) });
  });

  it("answers the floor's unsupported and its node gate as DriveUnavailableDetails, and any other UNAVAILABLE as it came", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root } = await floor(transfer);
    const drive = pulls(link, root);
    const { service, control } = serviceOver(drive);
    await drive.start();
    const refusals: unknown[] = [];
    // the node gate
    mock.meshUnavailable = true;
    refusals.push(await service.pull(ask(digestOf(1))).catch((error: unknown) => error));
    // a lane the floor will not open
    const notUp = { service: "mesh-gateway", state: "starting" };
    control.refuse = new RpcCallError("UNAVAILABLE", "mesh node not up", true, notUp, -32006);
    refusals.push(await service.send("peer-a", new Uint8Array(1)).catch((error: unknown) => error));
    // the floor at the pin
    mock.fileTransfer = "unsupported";
    refusals.push(await service.pull(ask(digestOf(2))).catch((error: unknown) => error));
    const read = refusals.map((refusal) => {
      expect(refusal).toBeInstanceOf(RpcCallError);
      const error = refusal as RpcCallError;
      expect(error.kind).toBe("UNAVAILABLE");
      return { ...DriveUnavailableDetails.parse(error.details), retryable: error.retryable };
    });
    expect(read).toEqual([
      { service: DRIVE_SERVICE.SERVICE, state: DRIVE_SERVICE.STATE_MESH_DOWN, retryable: true },
      { service: DRIVE_SERVICE.SERVICE, state: DRIVE_SERVICE.STATE_MESH_DOWN, retryable: true },
      { service: DRIVE_SERVICE.SERVICE, state: DRIVE_SERVICE.STATE_UNBUILT, retryable: false },
    ]);
    // a floor that is not answering names its own service and state: never the node gate's mesh-down
    const unresponsive = { service: "native", state: "unresponsive" };
    control.refuse = new RpcCallError("UNAVAILABLE", "not answering", true, unresponsive);
    const record = new Uint8Array(1);
    const passed = await service.send("peer-a", record).catch((error: unknown) => error);
    expect(passed).toBe(control.refuse);
  });

  it("passes every other refusal as it came, and hands a drive change, a node-up and a reconnect to its parts", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root } = await floor(transfer);
    const drive = pulls(link, root);
    const { service } = serviceOver(drive);
    await service.start();
    expect(transfer.declared).toEqual([[ROOT]]);
    const digest = digestOf(1);
    const ended = service.pull(ask(digest)).catch((error: unknown) => error);
    await until(() => transfer.running.size === 1, "the pull runs");
    // this side's refusals in the floor's shapes pass untouched: CONFLICT, PRECONDITION_FAILED
    const conflict = await service.pull(ask(digest, "peer-b")).catch((error: unknown) => error);
    expect(conflict).toMatchObject({
      kind: "CONFLICT",
      retryable: false,
      code: RPC_ERROR_CODES.CONFLICT,
    });
    const outside = service.pull({ peer: "peer-a", digest: digestOf(2), path: "../up" });
    await expect(outside).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    // a pull's end passes with the floor's word: mapping it is the worker adapter's (DR-2)
    const rejected = MESH_FILE_TRANSFER.FAILED_REJECTED;
    const id = idOf(transfer, digest);
    mock.pushFileTransferDelta({ kind: "failed", transferId: id, reason: rejected, message: "no" });
    const failure = await ended;
    expect(failure).toBeInstanceOf(DrivePullFailed);
    expect(failure).toMatchObject({ reason: rejected });
    // the roots, again: at a drive change, a node-up and a reconnect
    await service.driveChanged();
    await service.nodeUp();
    await service.connected();
    expect(transfer.declared).toEqual([[ROOT], [ROOT], [ROOT], [ROOT]]);
  });

  it("refuses a previous fieldd's running digests here, and surfaces what they land as adopt candidates", async () => {
    // field-native outlives fieldd: the first snapshot lists pulls this fieldd never minted (the W3 critic's
    // finding 4). Their digests are held, and what they land is the drive's to adopt, never an answer to a pull.
    const transfer = mockFileTransfer();
    const digest = digestOf(1);
    const lagged = digestOf(2);
    const foreign = "01JC8ZK4W2MX7N3Q5R9T6V0B1D";
    const earlier = "01JC8ZK4W2MX7N3Q5R9T6V0B1E";
    const row = { peer: "peer-b", root: ROOT, bytes: 16_384, total: 48_213 };
    transfer.running.set(foreign, { ...row, transferId: foreign, digest });
    transfer.running.set(earlier, { ...row, transferId: earlier, digest: lagged });
    const { mock, link, root, landsDir } = await floor(transfer);
    const looked: string[] = [];
    const drive = pulls(link, root, {
      exists: async (path) => {
        looked.push(path);
        return existsSync(path);
      },
    });
    const { service } = serviceOver(drive);
    await drive.start();
    const sent = mock.meshCalls.length;
    await expect(drive.pull(ask(digest))).rejects.toMatchObject({
      kind: "CONFLICT",
      retryable: false,
    });
    expect(mock.meshCalls.length).toBe(sent);
    // the earlier one ended while the reader lagged: its file is in place, and the next snapshot no longer lists it
    const landed = join(landsDir, `${lagged}.${earlier}`);
    writeFileSync(landed, "object bytes");
    transfer.running.delete(earlier);
    mock.pushFileTransferSnapshot();
    await until(() => looked.includes(landed), "the lands folder, read");
    // surfaced before any listener: held for the first, which the service hands it to
    const candidates: DriveAdoptCandidate[] = [];
    service.onAdoptCandidate((candidate) => candidates.push(candidate));
    expect(candidates).toEqual([{ transferId: earlier, digest: lagged, path: landed }]);
    mock.pushFileTransferDelta(completed(foreign, digest));
    await until(() => candidates.length === 2, "the second adopt candidate");
    expect(candidates).toEqual([
      { transferId: earlier, digest: lagged, path: landed },
      { transferId: foreign, digest, path: join(landsDir, `${digest}.${foreign}`) },
    ]);
    // its end freed the digest
    void drive.pull(ask(digest)).catch(() => undefined);
    await until(() => transfer.pulls.length === 1, "a pull of this boot");
  });
});
