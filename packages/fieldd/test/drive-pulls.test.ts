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
import type { Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  CONFLICT_GOLDEN,
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

/** The scripted floor over a real NativeLink, and this desktop's user root and `lands` folder under one temp root.
 * `requestDeadlineMs` is the link's own (NativeLink's option), for a row that reads fieldd's TIMEOUT. */
async function floor(
  transfer: "unsupported" | MockFileTransfer = mockFileTransfer(),
  requestDeadlineMs?: number,
) {
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
    ...(requestDeadlineMs !== undefined ? { requestDeadlineMs } : {}),
  });
  cleanup.push(() => link.close());
  await link.connect();
  const landsDir = join(dir, ...LAYOUT.DRIVE_INCOMING_DIR);
  mkdirSync(landsDir, { recursive: true });
  return { mock, link, root: dir, landsDir };
}

/** A user root with nothing under it, for a floor in memory: removed when the row ends. */
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-dp-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A floor in memory, for an order NativeLink's I/O never gives: every answer comes in a microtask. A subscribe is
 * answered `{transfers: []}`, once `gates`' promise for its number (from 1) resolves, if one is set, or refused with
 * `refusals`' error for its number, or with `refuseRest` while it is set and `refusals` names none; a pull is
 * answered with its id, once `releaseAnswer()` is called if `holdNextAnswer` was set when it was asked. `emit`
 * speaks on the stream of the subscribe made last. */
class MemoryFloor implements DrivePullsFloor {
  made = 0;
  readonly gates = new Map<number, Promise<void>>();
  readonly refusals = new Map<number, Error>();
  refuseRest: Error | null = null;
  holdNextAnswer = false;
  releaseAnswer: () => void = () => undefined;
  emit: (payload: unknown, kind: "snapshot" | "delta") => void = () => undefined;

  async request(method: string, params: unknown): Promise<unknown> {
    if (method !== PULL) return { roots: [{ name: ROOT, registered: true }] };
    if (this.holdNextAnswer) {
      this.holdNextAnswer = false;
      await new Promise<void>((resolve) => {
        this.releaseAnswer = resolve;
      });
    }
    return { transferId: (params as { transferId: string }).transferId };
  }

  async subscribe(
    _method: string,
    _params: unknown,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ snapshot: unknown; dispose: () => void }> {
    this.made += 1;
    const made = this.made;
    this.emit = onEvent;
    const gate = this.gates.get(made);
    if (gate !== undefined) await gate;
    const refusal = this.refusals.get(made) ?? this.refuseRest;
    if (refusal !== null) throw refusal;
    return { snapshot: { transfers: [] }, dispose: () => undefined };
  }
}

function pulls(over: DrivePullsFloor, root: string, extra: Partial<DrivePullsOptions> = {}) {
  const drive = new DrivePulls({
    floor: over,
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

/** The relay's log line for a stream subscribe the floor or NativeLink refused (`DrivePulls.#refused`). */
const subscribeRefused = (e: CapturedLog) =>
  e.event === "fieldd.drive.file_transfer_refused" && e.attrs?.["method"] === SUBSCRIBE;

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
    // 6. an ungated node holds the root; a pull is refused CONFLICT by its id, then by its digest (C1's nit 9), and
    // one past DRIVE_LIMITS.PULLS_IN_FLIGHT (W3-15, VF-PM 2026-11-06), each as its golden holds it
    const held = await link.request(ROOTS, { roots: [ROOT] });
    expect(NativeFileTransferRootsResult.parse(held)).toEqual({
      roots: [{ name: ROOT, registered: false, reason: MESH_FILE_TRANSFER.ROOT_UNGATED }],
    });
    expect(await link.request(PULL, pullOf(1, 1))).toEqual({ transferId: idFor(1) });
    for (const params of [pullOf(1, 2), pullOf(2, 1)]) {
      const conflict = await refused(PULL, params);
      expect(conflict.code).toBe(RPC_ERROR_CODES[CONFLICT_GOLDEN.kind]);
      expect(errorData(conflict)).toEqual(CONFLICT_GOLDEN);
    }
    for (let n = 2; n <= DRIVE_LIMITS.PULLS_IN_FLIGHT; n++) {
      await link.request(PULL, pullOf(n, n));
    }
    expect(transfer.running.size).toBe(DRIVE_LIMITS.PULLS_IN_FLIGHT);
    const exhausted = await refused(PULL, pullOf(9, 9));
    expect(exhausted.code).toBe(RPC_ERROR_CODES[EXHAUSTED_GOLDEN.kind]);
    expect(errorData(exhausted)).toEqual(EXHAUSTED_GOLDEN);
  });

  it("leaves a pull running while the stream's replay and the reconnect's subscribe still list it, and settles it on its delta", async () => {
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
    // the link drops and comes back: NativeLink replays the stream, and its snapshot still lists the pull; the
    // reconnect lets that stream go and subscribes anew (`connected`), and that snapshot lists it too
    mock.killClients();
    await until(() => asked(mock, SUBSCRIBE) === 3, "the reconnect's own subscribe", 6_000);
    await roundTrip(link);
    expect(state()).toBe("pending");
    mock.pushFileTransferDelta(completed(id, digest));
    await expect(landed).resolves.toEqual({ path: join(landsDir, `${digest}.${id}`) });
  });

  it("leaves a pull running when a snapshot written before its answer comes in the same read, and settles it on its delta", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root, landsDir } = await floor(transfer);
    const looked: string[] = [];
    const drive = pulls(link, root, {
      heldBoundMs: 2_000,
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
    // it may have been written before the answer, so it reads nothing of the pull and holds it (race#0 (b), VF-PM
    // 2026-11-06): ONE re-subscribe, whose snapshot, built after the answer, lists the pull, so it runs on, its lands
    // folder unread
    await until(() => asked(mock, SUBSCRIBE) === 2, "the one re-subscribe");
    await roundTrip(link);
    expect(state()).toBe("pending");
    expect(looked).toEqual([]);
    expect(asked(mock, SUBSCRIBE)).toBe(2);
    // and that listing released the hold: past the held bound it still runs, and nothing more is asked
    await sleep(2_200);
    expect(state()).toBe("pending");
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
    await until(() => asked(mock, SUBSCRIBE) === 2, "the one re-subscribe");
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
    // handled before anything can settle it, so an early rejection is never unhandled
    landed.catch(() => undefined);
    await until(() => !transfer.snapshotAfterAnswer, "the answer and the snapshot, written");
    await until(() => asked(mock, SUBSCRIBE) === 2, "the one re-subscribe");
    await expect(landed).resolves.toEqual({ path });
    expect(asked(mock, SUBSCRIBE)).toBe(2);
  });

  it("ends a held pull FAILED_TIMEOUT at its bound when its re-subscribe is refused or never answered, then reads it as a row it does not track", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root, landsDir } = await floor(transfer);
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
    await until(() => events.some(subscribeRefused), "the re-subscribe, refused");
    // the refusal ends nothing: the bound does
    expect(firstState()).toBe("pending");
    await expect(first).rejects.toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_TIMEOUT });
    // asked once: one refused attempt (refused at the door, unsent, so the floor's log cannot count them)
    expect(events.filter(subscribeRefused)).toHaveLength(1);
    // the bound cannot tell whether the pull runs on, so from there it is a row this fieldd does not track: its
    // digest stays held, refused here and unsent, and what it lands is an adopt candidate, never an answer
    const firstId = String(transfer.pulls[0]?.["transferId"]);
    const sent = mock.meshCalls.length;
    const again = await drive.pull(ask(digestOf(1))).catch((error: unknown) => error);
    expect(again).toBeInstanceOf(RpcCallError);
    expect(errorData(again as RpcCallError)).toEqual(CONFLICT_GOLDEN);
    expect(mock.meshCalls.length).toBe(sent);
    const candidates: DriveAdoptCandidate[] = [];
    drive.onAdoptCandidate((candidate) => candidates.push(candidate));
    mock.pushFileTransferDelta(completed(firstId, digestOf(1)));
    await until(() => candidates.length === 1, "its landing, an adopt candidate");
    const path = join(landsDir, `${digestOf(1)}.${firstId}`);
    expect(candidates).toEqual([{ transferId: firstId, digest: digestOf(1), path }]);
    // 2. never answered: the floor reads the re-subscribe and says nothing
    link.setDoorGate(null);
    mock.silentMethods.add(SUBSCRIBE);
    transfer.snapshotAfterAnswer = true;
    const asking = Date.now();
    const second = drive.pull(ask(digestOf(2)));
    // handled before anything can settle it, so an early rejection is never unhandled
    second.catch(() => undefined);
    await until(() => subscribes() === 2, "the re-subscribe, unanswered");
    // the silence ends nothing: the bound does, counted from the hold, which came after `asking`
    await expect(second).rejects.toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_TIMEOUT });
    expect(Date.now() - asking).toBeGreaterThanOrEqual(1_000 - 50);
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
    await until(() => made === 2, "the one re-subscribe");
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

  it("subscribes once more when a re-subscribe the floor ran is read as refused, so a running pull still ends on its delta", async () => {
    const transfer = mockFileTransfer();
    // the link's own deadline, short, so fieldd's TIMEOUT comes within the row
    const { mock, link, root, landsDir } = await floor(transfer, 1_000);
    const drive = pulls(link, root);
    await drive.start();
    // a pull runs on, its answer read long before (its fence has run)
    const digest = digestOf(1);
    const running = drive.pull(ask(digest));
    // handled before anything can settle it, so an early rejection is never unhandled
    running.catch(() => undefined);
    await until(() => transfer.running.size === 1, "the first pull runs");
    await roundTrip(link);
    const id = idOf(transfer, digest);
    // a second pull is held (race#0 (b), VF-PM 2026-11-06), and the floor RUNS its re-subscribe, which replaces the
    // stream (W3-20, VF-PM 2026-11-06), but answers it past fieldd's deadline: fieldd reads its own TIMEOUT
    transfer.subscribeUnanswered = true;
    transfer.snapshotAfterAnswer = true;
    const held = drive.pull(ask(digestOf(2))).catch((error: unknown) => error);
    await until(() => transfer.replaced.length === 1, "the re-subscribe, run");
    // the stream fieldd held is quiet now, so it is set aside and ONE plain subscribe follows; its snapshot, built
    // after the held pull's answer, ends that pull by the lands rule, long before the held bound (60 s here)
    await until(() => asked(mock, SUBSCRIBE) === 3, "the plain subscribe after the TIMEOUT");
    expect(await held).toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_IO });
    expect(transfer.replaced).toEqual(transfer.subscribed.slice(0, 2));
    // and the running pull's end reaches it on the stream that stands
    mock.pushFileTransferDelta(completed(id, digest));
    await expect(running).resolves.toEqual({ path: join(landsDir, `${digest}.${id}`) });
  });

  it("judges a held pull by the stream NativeLink replays when the link drops under its re-subscribe", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root } = await floor(transfer);
    // `connected()` is not wired here: NativeLink's replay alone must judge the pull
    const drive = pulls(link, root, { heldBoundMs: 20_000 });
    await drive.start();
    const subscribes = () => mock.requestLog.filter((r) => r.method === SUBSCRIBE).length;
    // held, and its re-subscribe read by the floor and never answered
    mock.silentMethods.add(SUBSCRIBE);
    transfer.snapshotAfterAnswer = true;
    const held = drive.pull(ask(digestOf(1))).catch((error: unknown) => error);
    await until(() => subscribes() === 2, "the re-subscribe, unanswered");
    // the link drops: the re-subscribe is refused UNAVAILABLE (`failPending`), which ran no subscribe, so the stream
    // fieldd holds stands; NativeLink replays it on the new connection, and that snapshot, built after the pull's
    // answer, ends the pull by the lands rule, never the bound
    mock.silentMethods.delete(SUBSCRIBE);
    mock.killClients();
    await until(() => subscribes() === 3, "the stream's replay", 6_000);
    expect(await held).toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_IO });
  });

  it("holds every accepted pull once a re-subscribe and its plain subscribe both read TIMEOUT, and the retry's snapshot settles them", async () => {
    const transfer = mockFileTransfer();
    // the link's own deadline, short, so fieldd's TIMEOUTs come within the row
    const { mock, link, root, landsDir } = await floor(transfer, 1_000);
    let minted = 0;
    const drive = pulls(link, root, {
      mintId: () => {
        minted += 1;
        return idFor(minted);
      },
      heldBoundMs: 6_000,
      retryDelaysMs: [100],
    });
    await drive.start();
    const timers = vi.spyOn(globalThis, "setTimeout");
    cleanup.push(() => timers.mockRestore());
    // a pull runs on, its answer read long before (its fence has run), and nothing holds it
    const digest = digestOf(1);
    const running = drive.pull(ask(digest));
    // handled before anything can settle it, so an early rejection is never unhandled
    running.catch(() => undefined);
    const runningState = settled(running);
    await until(() => transfer.running.size === 1, "the first pull runs");
    await roundTrip(link);
    // a second pull is held (race#0 (b)), and the floor's mesh worker is backlogged: it RUNS the re-subscribe, which
    // replaces the stream (W3-20), past fieldd's deadline
    transfer.subscribeUnanswered = true;
    transfer.snapshotAfterAnswer = true;
    const held = drive.pull(ask(digestOf(2))).catch((error: unknown) => error);
    await until(() => transfer.replaced.length === 1, "the re-subscribe, run");
    // the plain subscribe that follows its TIMEOUT is run and read TIMEOUT too; meanwhile the first pull ends with no
    // stream to carry its end, its file in place
    transfer.subscribeUnanswered = true;
    const path = join(landsDir, `${digest}.${idFor(1)}`);
    writeFileSync(path, "object bytes");
    transfer.running.delete(idFor(1));
    // with no stream every accepted pull is held (W3-21, VF-PM 2026-11-06), and the subscribe is retried: its
    // snapshot, built after both answers, omits both, and the lands rule settles each, long before the bound
    await until(
      () => runningState() !== "pending",
      "the running pull, settled by the retry's snapshot (W3-21)",
      5_000,
    );
    await expect(running).resolves.toEqual({ path });
    expect(await held).toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_IO });
    // held twice, each at its own bound: the second pull by race#0, the running one as the stream went (`#holdAll`)
    expect(timers.mock.calls.filter((call) => call[1] === 6_000)).toHaveLength(2);
    expect(asked(mock, SUBSCRIBE)).toBe(4);
    // each subscribe the floor ran replaced the one before it, the two fieldd read as refused included: ONE stream
    // stands, the retry's
    expect(transfer.subscribed).toHaveLength(4);
    expect(transfer.replaced).toEqual(transfer.subscribed.slice(0, 3));
  });

  it("ends every held pull FAILED_TIMEOUT at its bound when each retry is refused, asks only while one is held, and a pull a bound's row refuses asks for the stream", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root } = await floor(transfer, 1_000);
    const events: CapturedLog[] = [];
    const captured = captureLogger(events);
    // the instant the stream goes, stamped as its refusal is logged: the first pull is held in that same run
    // (`#refused`, then `#holdAll`), so a late poll cannot shorten what the row measures
    let emptied = 0;
    const logger: Logger = {
      ...captured,
      child: () => logger,
      info: (event, message, attrs) => {
        captured.info(event, message, attrs);
        if (emptied === 0 && subscribeRefused({ event, attrs })) emptied = Date.now();
      },
    };
    const bound = 2_500;
    const last = 400;
    const delays = [100, 200, last];
    const drive = pulls(link, root, { heldBoundMs: bound, retryDelaysMs: delays, logger });
    await drive.start();
    const running = drive.pull(ask(digestOf(1))).catch((error: unknown) => error);
    await until(() => transfer.running.size === 1, "the first pull runs");
    await roundTrip(link);
    // a second pull is held, the floor runs its re-subscribe past fieldd's deadline, and from there it refuses every
    // subscribe, its mesh queue full (RESOURCE_EXHAUSTED, never run)
    transfer.subscribeUnanswered = true;
    transfer.snapshotAfterAnswer = true;
    const held = drive.pull(ask(digestOf(2))).catch((error: unknown) => error);
    await until(() => transfer.replaced.length === 1, "the re-subscribe, run");
    transfer.refuseSubscribes = Number.POSITIVE_INFINITY;
    // the stream goes at the re-subscribe's TIMEOUT, and the first pull is held from there; the refusals end nothing:
    // each pull's bound does
    const ended = Promise.all([held, running]).then(() => Date.now());
    const state = settled(ended);
    await until(
      () => state() !== "pending",
      "both held pulls, ended at their bounds",
      bound + 4_000,
    );
    for (const failure of [await held, await running]) {
      expect(failure).toBeInstanceOf(DrivePullFailed);
      expect(failure).toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_TIMEOUT });
    }
    expect(emptied).toBeGreaterThan(0);
    const waited = (await ended) - emptied;
    expect(waited).toBeGreaterThanOrEqual(bound - 50);
    // load-sensitive: a timer fires late on a loaded host, never early
    expect(waited).toBeLessThan(bound + 1_500);
    // asked: at the start, the re-subscribe, then the plain subscribe and its series, the list and its last delay
    // again while a pull is held (once at least, here), and nothing once none is
    await sleep(2 * last);
    const subscribes = asked(mock, SUBSCRIBE);
    const series = subscribes - 2;
    expect(series).toBeGreaterThan(1 + delays.length);
    expect(series).toBeLessThanOrEqual(1 + delays.length + Math.ceil(bound / last));
    expect(events.filter(subscribeRefused)).toHaveLength(subscribes - 1);
    await sleep(2 * last);
    expect(asked(mock, SUBSCRIBE)).toBe(subscribes);
    // each bound left its row foreign, and with no stream nothing else would clear one: a pull such a row refuses
    // asks for the stream once, at the series' next delay, and that snapshot forgets every row the floor ended
    // (here, at its own idle bound)
    transfer.running.clear();
    transfer.refuseSubscribes = 0;
    const conflict = await drive.pull(ask(digestOf(1))).catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(RpcCallError);
    expect(errorData(conflict as RpcCallError)).toEqual(CONFLICT_GOLDEN);
    await until(() => asked(mock, SUBSCRIBE) === subscribes + 1, "the one ask the refusal made");
    await roundTrip(link);
    void drive.pull(ask(digestOf(1))).catch(() => undefined);
    await until(() => transfer.pulls.length === 3, "the same digest, accepted");
    expect(asked(mock, SUBSCRIBE)).toBe(subscribes + 1);
  });

  it("holds a pull accepted while no stream stands at once, asks for the stream, and the first fresh snapshot settles it", async () => {
    const transfer = mockFileTransfer();
    // the stream is refused twice, its mesh queue full: at the start, and at the pull's own ask
    transfer.refuseSubscribes = 2;
    const { mock, link, root, landsDir } = await floor(transfer);
    const id = idFor(1);
    const bound = 4_321;
    const drive = pulls(link, root, {
      mintId: () => id,
      heldBoundMs: bound,
      retryDelaysMs: [1_000],
    });
    await drive.start();
    expect(asked(mock, SUBSCRIBE)).toBe(1);
    const timers = vi.spyOn(globalThis, "setTimeout");
    cleanup.push(() => timers.mockRestore());
    // the pull ends at the floor as it is answered, its file in place, before any retry can be made; no stream
    // carries its end, because the floor holds none for this connection (each subscribe was refused unrun), so its
    // answer comes alone
    const digest = digestOf(1);
    const path = join(landsDir, `${digest}.${id}`);
    writeFileSync(path, "object bytes");
    transfer.snapshotAfterAnswer = true;
    const landed = drive.pull(ask(digest));
    const state = settled(landed);
    // held as its answer is read (its bound's timer set), and the stream asked for with no node-up
    await until(() => asked(mock, SUBSCRIBE) === 2, "the pull's own ask for the stream");
    expect(transfer.running.size).toBe(0);
    expect(timers.mock.calls.some((call) => call[1] === bound)).toBe(true);
    expect(state()).toBe("pending");
    // the retry's snapshot, the first fresh one, omits it, and the lands rule settles it long before the bound
    await expect(landed).resolves.toEqual({ path });
    expect(asked(mock, SUBSCRIBE)).toBe(3);
  });

  it("lets the stream go at a reconnect, holds every accepted pull and subscribes anew, so a refused replay leaves none waiting", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root, landsDir } = await floor(transfer);
    const id = idFor(1);
    const drive = pulls(link, root, { mintId: () => id });
    link.on("connected", () => void drive.connected());
    await drive.start();
    const digest = digestOf(1);
    const landed = drive.pull(ask(digest));
    const state = settled(landed);
    await until(() => transfer.running.size === 1, "the pull runs");
    await roundTrip(link);
    // the pull ends at the floor, its file in place, and the link drops before its delta is sent
    const path = join(landsDir, `${digest}.${id}`);
    writeFileSync(path, "object bytes");
    transfer.running.delete(id);
    // NativeLink replays the stream into a full mesh queue: refused, and its entry kept with no route until the next
    // reconnect (native-link.ts:1112-1126); it says "connected" once that replay has run (:494-501)
    transfer.refuseSubscribes = 1;
    mock.killClients();
    // `connected()` lets that entry go, holds the pull and subscribes anew: that snapshot, built after its answer,
    // omits it, and the lands rule settles it, long before the held bound (60 s here)
    await until(() => state() !== "pending", "the pull, settled after the refused replay", 8_000);
    await expect(landed).resolves.toEqual({ path });
    // at the start, the replay (refused), and the one the reconnect made
    expect(asked(mock, SUBSCRIBE)).toBe(3);
  });

  it("lets the stream go at a reconnect whose replay is refused with no pull accepted, so a pull accepted after it settles on its end", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root, landsDir } = await floor(transfer);
    const id = idFor(1);
    const bound = 3_000;
    const drive = pulls(link, root, { mintId: () => id, heldBoundMs: bound });
    let reconnects = 0;
    link.on("connected", () => {
      void drive.connected().then(() => {
        reconnects += 1;
      });
    });
    await drive.start();
    // no pull is accepted, and NativeLink replays the stream into a full mesh queue: refused, its entry kept with no
    // route until the next reconnect (native-link.ts:1112-1126); it says "connected" once that replay has run
    transfer.refuseSubscribes = 1;
    mock.killClients();
    await until(() => reconnects === 1, "the reconnect, handed to the pulls", 8_000);
    // a pull accepted from here ends at the floor, its file in place, and its end goes on the stream the floor holds
    // for this connection: the one the reconnect made, which `#subscription` names
    const digest = digestOf(1);
    const landed = drive.pull(ask(digest));
    const state = settled(landed);
    await until(() => transfer.running.size === 1, "the pull runs");
    await roundTrip(link);
    const path = join(landsDir, `${digest}.${id}`);
    writeFileSync(path, "object bytes");
    mock.pushFileTransferDelta(completed(id, digest));
    await until(
      () => state() !== "pending",
      "the pull, settled after a refused replay",
      bound + 2_000,
    );
    await expect(landed).resolves.toEqual({ path });
    // at the start, the replay (refused), and the one the reconnect made
    expect(asked(mock, SUBSCRIBE)).toBe(3);
  });

  it("holds a pull accepted at a reconnect whose replay and own subscribe are both refused, and a pull accepted later asks the stream, whose snapshot settles both", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root, landsDir } = await floor(transfer);
    let minted = 0;
    const bound = 4_000;
    const drive = pulls(link, root, {
      mintId: () => {
        minted += 1;
        return idFor(minted);
      },
      heldBoundMs: bound,
      // past the bound: no retry of the series is made within this row, so only the later pull's own ask can serve
      retryDelaysMs: [30_000],
    });
    let reconnects = 0;
    link.on("connected", () => {
      void drive.connected().then(() => {
        reconnects += 1;
      });
    });
    await drive.start();
    const first = digestOf(1);
    const landed = drive.pull(ask(first));
    const state = settled(landed);
    await until(() => transfer.running.size === 1, "the first pull runs");
    await roundTrip(link);
    // it ends at the floor, its file in place, and the link drops before its delta is sent
    const path = join(landsDir, `${first}.${idFor(1)}`);
    writeFileSync(path, "object bytes");
    transfer.running.delete(idFor(1));
    // the replay and the reconnect's own subscribe both meet a full mesh queue: refused, never run
    transfer.refuseSubscribes = 2;
    mock.killClients();
    await until(() => reconnects === 1, "the reconnect, handed to the pulls", 8_000);
    expect(asked(mock, SUBSCRIBE)).toBe(3);
    expect(state()).toBe("pending");
    // a later pull is accepted with no stream: held as it is accepted, and it asks the stream at once; that
    // snapshot, built after both answers, omits the first pull, which the lands rule settles, long before its bound
    const later = digestOf(2);
    const second = drive.pull(ask(later));
    // handled before anything can settle it, so an early rejection is never unhandled
    second.catch(() => undefined);
    await until(
      () => state() !== "pending",
      "the first pull, settled by the later one's ask",
      bound + 2_000,
    );
    await expect(landed).resolves.toEqual({ path });
    expect(asked(mock, SUBSCRIBE)).toBe(4);
    // and the later pull runs on that stream: its end reaches it as a delta
    const secondId = idOf(transfer, later);
    await roundTrip(link);
    mock.pushFileTransferDelta(completed(secondId, later));
    await expect(second).resolves.toEqual({ path: join(landsDir, `${later}.${secondId}`) });
  });

  it("clears the series' timer at a node-up, which asks at once and opens the series again, and at a stop, which asks nothing more", async () => {
    const transfer = mockFileTransfer();
    // the stream is refused three times, its mesh queue full: at the start, at the pull's own ask, at the node-up
    transfer.refuseSubscribes = 3;
    const { mock, link, root } = await floor(transfer);
    const first = 1_500;
    const drive = pulls(link, root, { heldBoundMs: 20_000, retryDelaysMs: [first, 2_500] });
    await drive.start();
    const timers = vi.spyOn(globalThis, "setTimeout");
    const cleared = vi.spyOn(globalThis, "clearTimeout");
    cleanup.push(() => {
      timers.mockRestore();
      cleared.mockRestore();
    });
    /** every timer set with `delay`, in order */
    const set = (delay: number): unknown[] => {
      const found: unknown[] = [];
      for (const [at, call] of timers.mock.calls.entries()) {
        if (call[1] === delay) found.push(timers.mock.results[at]?.value);
      }
      return found;
    };
    const held = drive.pull(ask(digestOf(1))).catch((error: unknown) => error);
    await until(() => asked(mock, SUBSCRIBE) === 2, "the pull's own ask for the stream");
    await until(() => set(first).length === 1, "the series' first retry, set");
    // a node-up asks at once and clears that timer, and its refusal opens the series again: the list's first delay,
    // never its second
    await drive.nodeUp();
    expect(asked(mock, SUBSCRIBE)).toBe(3);
    expect(cleared).toHaveBeenCalledWith(set(first)[0]);
    expect(set(first)).toHaveLength(2);
    expect(set(2_500)).toHaveLength(0);
    // a stop clears the timer the node-up's refusal set, and nothing is asked past its delay (item 196)
    drive.stop();
    expect(cleared).toHaveBeenCalledWith(set(first)[1]);
    expect(await held).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    await sleep(first + 300);
    expect(asked(mock, SUBSCRIBE)).toBe(3);
  });

  it("opens a second series at the list's first delay once a subscribe was answered after the first series", async () => {
    const transfer = mockFileTransfer();
    // the start's subscribe, the pull's own ask and the series' first retry meet a full mesh queue
    transfer.refuseSubscribes = 3;
    // the link's own deadline, short, so fieldd's TIMEOUT comes within the row
    const { mock, link, root } = await floor(transfer, 1_000);
    let minted = 0;
    const delays = [130, 370, 910];
    const drive = pulls(link, root, {
      mintId: () => {
        minted += 1;
        return idFor(minted);
      },
      heldBoundMs: 6_000,
      retryDelaysMs: delays,
    });
    await drive.start();
    const timers = vi.spyOn(globalThis, "setTimeout");
    cleanup.push(() => timers.mockRestore());
    /** every series delay set, in order */
    const series = () =>
      timers.mock.calls.map((call) => call[1]).filter((delay) => delays.some((d) => d === delay));
    // the first series: a pull accepted with no stream is held and asks at once; refused, the series retries at the
    // list's first delay, then its second, which is answered, and an answered subscribe resets the series' count
    const running = drive.pull(ask(digestOf(1)));
    // handled before anything can settle it, so an early rejection is never unhandled
    running.catch(() => undefined);
    await until(
      () => asked(mock, SUBSCRIBE) === 4,
      "the first series, answered at its second retry",
    );
    await roundTrip(link);
    expect(series()).toEqual([delays[0], delays[1]]);
    // the second: a second pull is held (race#0 (b)), the floor RUNS its re-subscribe past fieldd's deadline, which
    // sets the stream aside (W3-20), and refuses the plain subscribe that follows: the series opens again at the
    // list's FIRST delay, never at the third the first series' count would give
    transfer.subscribeUnanswered = true;
    transfer.snapshotAfterAnswer = true;
    const held = drive.pull(ask(digestOf(2))).catch((error: unknown) => error);
    await until(() => transfer.replaced.length === 1, "the re-subscribe, run");
    transfer.refuseSubscribes = 1;
    await until(() => asked(mock, SUBSCRIBE) === 7, "the second series' first retry");
    expect(series()).toEqual([delays[0], delays[1], delays[0]]);
    // that retry is answered: its snapshot, built after both answers, omits the second pull (the lands rule)
    expect(await held).toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_IO });
  });

  it("asks for the stream at the series' pace however fast a caller refused by rows it does not track retries, and nothing once the caller stops", async () => {
    const memory = new MemoryFloor();
    // the floor runs the re-subscribe past fieldd's deadline (TIMEOUT), and from there refuses every subscribe, its
    // mesh queue full: no stream stands
    memory.refusals.set(2, new RpcCallError("TIMEOUT", "the deadline passed", true));
    memory.refuseRest = new RpcCallError("RESOURCE_EXHAUSTED", "mesh request queue is full", true);
    const spacing = 200;
    const drive = pulls(memory, tempRoot(), { heldBoundMs: 500, retryDelaysMs: [spacing] });
    await drive.start();
    // a snapshot the pull cannot be ordered against omits it and lists pulls a previous fieldd started; the pull is
    // held, its re-subscribe reads TIMEOUT, the stream is set aside, and the held bound leaves the pull a row this
    // fieldd does not track too: every one of DRIVE_LIMITS.PULLS_IN_FLIGHT slots is such a row
    const rows = Array.from({ length: DRIVE_LIMITS.PULLS_IN_FLIGHT - 1 }, (_, n) => ({
      transferId: idFor(51 + n),
      peer: "peer-b",
      root: ROOT,
      digest: digestOf(51 + n),
      bytes: 0,
    }));
    const ended = drive.pull(ask(digestOf(1))).catch((error: unknown) => error);
    memory.emit({ transfers: rows }, "snapshot");
    expect(await ended).toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_TIMEOUT });
    // a caller retries RESOURCE_EXHAUSTED (retryable true) as fast as it is refused, for a second
    const before = memory.made;
    const began = Date.now();
    const refusals: unknown[] = [];
    while (Date.now() - began < 1_000) {
      refusals.push(await drive.pull(ask(digestOf(9))).catch((error: unknown) => error));
      await sleep(2);
    }
    // the ask the last refusal set, made
    await sleep(2 * spacing);
    const asks = memory.made - before;
    const allowed = Math.floor((Date.now() - began) / spacing) + 1;
    // refused far faster than the asks may come: one ask per refusal would break the bound below
    expect(refusals.length).toBeGreaterThan(2 * allowed);
    for (const refusal of refusals) {
      expect(errorData(refusal as RpcCallError)).toEqual(EXHAUSTED_GOLDEN);
    }
    // asked, at the series' pace: each ask waits a delay of the list after the refusal that set it, and none is set
    // while one is due or in flight, whatever the caller's rate
    expect(asks).toBeGreaterThanOrEqual(1);
    expect(asks).toBeLessThanOrEqual(allowed);
    // the caller stopped: nothing more is asked
    await sleep(2 * spacing);
    expect(memory.made - before).toBe(asks);
  });

  it("settles a held pull with the stop's own refusal, and the stop clears its bound's timer", async () => {
    const transfer = mockFileTransfer();
    const { link, root } = await floor(transfer);
    const events: CapturedLog[] = [];
    const bound = 1_500;
    const drive = pulls(link, root, { heldBoundMs: bound, logger: captureLogger(events) });
    await drive.start();
    const timers = vi.spyOn(globalThis, "setTimeout");
    const cleared = vi.spyOn(globalThis, "clearTimeout");
    cleanup.push(() => {
      timers.mockRestore();
      cleared.mockRestore();
    });
    // held, and its re-subscribe refused at the door (the floor held unresponsive): only its bound would end it
    transfer.snapshotAfterAnswer = true;
    const held = drive.pull(ask(digestOf(1))).catch((error: unknown) => error);
    link.setDoorGate(() => ({
      service: NATIVE_REFUSALS.SERVICE,
      state: NATIVE_REFUSALS.STATE_UNRESPONSIVE,
    }));
    await until(() => events.some(subscribeRefused), "the re-subscribe, refused");
    const at = timers.mock.calls.findIndex((call) => call[1] === bound);
    expect(at).toBeGreaterThanOrEqual(0);
    const boundTimer = timers.mock.results[at]?.value;
    drive.stop();
    // the stop's refusal (UNAVAILABLE, retryable, no {service, state}), never FAILED_TIMEOUT, and no timer left
    const refusal = await held;
    expect(refusal).toBeInstanceOf(RpcCallError);
    expect(refusal).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    expect((refusal as RpcCallError).details).toBeUndefined();
    expect(cleared).toHaveBeenCalledWith(boundTimer);
  });

  it("judges a held pull by the re-subscribe's snapshot it was asked for, when that snapshot comes before its fence ran", async () => {
    // a floor in memory answers in microtasks, so the re-subscribe's snapshot arrives before the pull's fence ran:
    // only its `serves` says it was built after the answer (NativeLink's I/O never gives this order)
    const memory = new MemoryFloor();
    const drive = pulls(memory, tempRoot(), { heldBoundMs: 2_000 });
    await drive.start();
    // the pull is asked, and before its answer is read the stream says nothing runs: a snapshot it cannot order
    const ended = drive.pull(ask(digestOf(1))).catch((error: unknown) => error);
    memory.emit({ transfers: [] }, "snapshot");
    // held, then ONE re-subscribe, whose snapshot omits it: the lands rule ends it, never the bound
    expect(await ended).toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_IO });
    expect(memory.made).toBe(2);
  });

  it("asks one more re-subscribe for a pull held while one was in flight, whose snapshot may predate its answer", async () => {
    const memory = new MemoryFloor();
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    memory.gates.set(2, gate);
    const drive = pulls(memory, tempRoot(), { heldBoundMs: 2_000 });
    await drive.start();
    // the first pull is held, and its re-subscribe (the second subscribe) waits at the floor
    const first = drive.pull(ask(digestOf(1))).catch((error: unknown) => error);
    memory.emit({ transfers: [] }, "snapshot");
    await until(() => memory.made === 2, "the first pull's re-subscribe, in flight");
    // the second pull's answer and that re-subscribe's snapshot, which omits it, come in one turn: the snapshot is
    // stamped before the second pull's fence runs and was not asked for it, so it holds the second pull
    memory.holdNextAnswer = true;
    const second = drive.pull(ask(digestOf(2))).catch((error: unknown) => error);
    memory.releaseAnswer();
    open();
    // one more re-subscribe follows the one in flight, and its snapshot ends the second pull, never the bound
    for (const failure of [await first, await second]) {
      expect(failure).toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_IO });
    }
    expect(memory.made).toBe(3);
  });

  it("keeps a pull held while no stream stands though a listing the gone stream left names it, and ends it at its bound", async () => {
    const memory = new MemoryFloor();
    // the re-subscribe reads fieldd's TIMEOUT (the floor may have run it), and the plain subscribe after it waits
    memory.refusals.set(2, new RpcCallError("TIMEOUT", "the deadline passed", true));
    memory.gates.set(3, new Promise<void>(() => undefined));
    const id = idFor(1);
    const bound = 1_000;
    const drive = pulls(memory, tempRoot(), { mintId: () => id, heldBoundMs: bound });
    await drive.start();
    // held by a snapshot it cannot order (race#0 (b)); its re-subscribe is refused, so the stream is set aside, every
    // accepted pull held (W3-21), and the plain subscribe made
    const ended = drive.pull(ask(digestOf(1))).catch((error: unknown) => error);
    memory.emit({ transfers: [] }, "snapshot");
    await until(() => memory.made === 3, "the plain subscribe, in flight");
    // a listing the gone stream left names the pull, its answer long read: with no stream it names no route for the
    // pull's end, so it releases nothing
    const row = { transferId: id, peer: "peer-a", root: ROOT, digest: digestOf(1), bytes: 0 };
    memory.emit({ transfers: [row] }, "snapshot");
    const state = settled(ended);
    await until(() => state() !== "pending", "the held pull, ended at its bound", bound + 2_000);
    expect(await ended).toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_TIMEOUT });
    expect(memory.made).toBe(3);
  });

  it("sets no bound for a pull whose answer comes after the stop, and refuses it with the stop's word", async () => {
    const memory = new MemoryFloor();
    const bound = 3_210;
    const drive = pulls(memory, tempRoot(), { heldBoundMs: bound });
    await drive.start();
    const timers = vi.spyOn(globalThis, "setTimeout");
    cleanup.push(() => timers.mockRestore());
    memory.holdNextAnswer = true;
    const refused = drive.pull(ask(digestOf(1))).catch((error: unknown) => error);
    drive.stop();
    // accepted after the stop: no stream stands, and a pull this side no longer tracks is never held (item 196)
    memory.releaseAnswer();
    expect(await refused).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    expect(timers.mock.calls.some((call) => call[1] === bound)).toBe(false);
  });

  it("keeps a pull's own word when its end follows, in one read, a snapshot that already omits it", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, root } = await floor(transfer);
    const drive = pulls(link, root);
    await drive.start();
    const digest = digestOf(1);
    const ended = drive.pull(ask(digest)).catch((error: unknown) => error);
    await until(() => transfer.running.size === 1, "the pull runs");
    // the snapshot below comes after the pull's fence (a round trip after its answer)
    await roundTrip(link);
    const id = idOf(transfer, digest);
    // the node goes: the floor's table drops the pull before its stream forwards the end, so a snapshot that omits
    // it and its `failed` come in ONE write; the delta's word stands, never the lands rule's FAILED_IO
    const reason = MESH_FILE_TRANSFER.FAILED_NODE_DOWN;
    const end = { kind: "failed", transferId: id, reason, message: "gone" };
    mock.pushFileTransferSnapshotThenDelta(end);
    expect(await ended).toMatchObject({ reason, transferId: id });
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
    // as C1's golden holds it (nit 9): CONFLICT, retryable false, no details
    expect((refusal as RpcCallError).code).toBe(RPC_ERROR_CODES[CONFLICT_GOLDEN.kind]);
    expect(errorData(refusal as RpcCallError)).toEqual(CONFLICT_GOLDEN);
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
    // this side's refusals in the floor's shapes pass untouched: CONFLICT (its golden), PRECONDITION_FAILED
    const conflict = await service.pull(ask(digest, "peer-b")).catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(RpcCallError);
    expect((conflict as RpcCallError).code).toBe(RPC_ERROR_CODES[CONFLICT_GOLDEN.kind]);
    expect(errorData(conflict as RpcCallError)).toEqual(CONFLICT_GOLDEN);
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
    const refusal = await drive.pull(ask(digest)).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RpcCallError);
    expect(errorData(refusal as RpcCallError)).toEqual(CONFLICT_GOLDEN);
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
