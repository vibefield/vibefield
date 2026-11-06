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
  NativeFileTransferPullParams,
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
  type DrivePullsOptions,
} from "../src/drive/pulls";
import { DriveService } from "../src/drive/service";
import { OutboundLaneIdAllocator } from "../src/lane-id";
import { NativeLink, RpcCallError } from "../src/native-link";
import { type MockFileTransfer, MockMgmtServer, mockFileTransfer } from "../src/testing/mock-mgmt";
import {
  type CapturedLog,
  captureLogger,
  FakeDriveLaneBytes,
  FakeDriveLaneControl,
  FakeDriveStore,
  refusingFloor,
  sleep,
  until,
} from "./drive-fakes";
import { nativeEndpoint } from "./native-harness";

const ROOT = FILE_TRANSFER_ROOTS.DRIVE_OBJECTS.name;
const SHA = "075eeb056ba8f587858fe88dd968e5d29207d6537944d88d8826a56cb8e89a42";
const SUBSCRIBE = "native.mesh.fileTransfer.subscribe";
const ROOTS = "native.mesh.fileTransfer.roots";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

/** A blake3-shaped digest, and the path a holder serves it under (mille-drive's `<2 hex>/<64 hex>` shard). */
const digestOf = (n: number) => n.toString(16).padStart(64, "0");
const pathOf = (digest: string) => `${digest.slice(0, 2)}/${digest}`;
const ask = (digest: string, peer = "peer-a") => ({ peer, digest, path: pathOf(digest) });

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

/** A round trip on the link: every reply the floor wrote before it has been read, and its continuation run. */
async function roundTrip(link: NativeLink): Promise<void> {
  await link.request("native.lifecycle.ping", {});
  await sleep(10);
}

/** The scripted floor over a real NativeLink, and this desktop's `lands` folder under the same temp root. */
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
  return { mock, link, landsDir };
}

function pulls(link: NativeLink, landsDir: string, extra: Partial<DrivePullsOptions> = {}) {
  const drive = new DrivePulls({
    floor: link,
    landsDir,
    roots: () => [ROOT],
    bootId: () => "boot-1",
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
    const { mock, link, landsDir } = await floor("unsupported");
    const drive = pulls(link, landsDir);
    await drive.start();
    expect(drive.unsupported()).toBe(true);
    expect(mock.meshCalls).toEqual([SUBSCRIBE]);
    // cached: refused here, in the floor's own words, and never sent
    await expect(drive.pull(ask(digestOf(1)))).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      retryable: false,
      details: { service: MESH_FILE_TRANSFER.SERVICE, state: MESH_FILE_TRANSFER.STATE_UNSUPPORTED },
    });
    expect(mock.meshCalls).toEqual([SUBSCRIBE]);
    const { service } = serviceOver(drive);
    const refusal = await service.pull(ask(digestOf(1))).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RpcCallError);
    expect((refusal as RpcCallError).retryable).toBe(false);
    expect(DriveUnavailableDetails.parse((refusal as RpcCallError).details)).toEqual({
      service: DRIVE_SERVICE.SERVICE,
      state: DRIVE_SERVICE.STATE_UNBUILT,
    });
    // a floor before the facade (a node answers these verbs method-not-found) reads the same
    const notFound = new RpcCallError("NOT_FOUND", "method not found", false, undefined, -32601);
    const old = refusingFloor(notFound);
    const before = pulls(link, landsDir, { floor: old });
    await before.start();
    expect(before.unsupported()).toBe(true);
    expect(old.asked).toEqual([SUBSCRIBE]);
  });

  it("applies the stream's snapshot before its deltas: a replay that lists a pull leaves it running", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, landsDir } = await floor(transfer);
    const drive = pulls(link, landsDir);
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

  it("mints a ULID and asks with the contract's fields; a path outside the grammar is refused, unsent", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, landsDir } = await floor(transfer);
    const drive = pulls(link, landsDir);
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

  it("resolves a completion with the landed path, and refuses one landed under another name", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, landsDir } = await floor(transfer);
    const drive = pulls(link, landsDir);
    await drive.start();
    const first = drive.pull(ask(digestOf(1)));
    const second = drive.pull(ask(digestOf(2)));
    await until(() => transfer.running.size === 2, "both pulls run");
    const a = idOf(transfer, digestOf(1));
    const b = idOf(transfer, digestOf(2));
    mock.pushFileTransferDelta(completed(a, digestOf(1)));
    await expect(first).resolves.toEqual({ path: join(landsDir, `${digestOf(1)}.${a}`) });
    // a name this pull did not ask for is never handed on as its object
    mock.pushFileTransferDelta({ ...completed(b, digestOf(2)), incoming: `${digestOf(3)}.${b}` });
    await expect(second).rejects.toBeInstanceOf(DrivePullFailed);
    await expect(second).rejects.toMatchObject({ reason: MESH_FILE_TRANSFER.FAILED_IO });
  });

  it("rejects a failure with the floor's word, and reads a word it does not know as io", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, landsDir } = await floor(transfer);
    const drive = pulls(link, landsDir);
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

  it("refuses a second pull of a running digest here, in the floor's CONFLICT shape, unsent", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, landsDir } = await floor(transfer);
    const drive = pulls(link, landsDir);
    await drive.start();
    void drive.pull(ask(digestOf(1))).catch(() => undefined);
    await until(() => transfer.running.size === 1, "the pull runs");
    const sent = mock.meshCalls.length;
    const refusal = await drive.pull(ask(digestOf(1), "peer-b")).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RpcCallError);
    // error-data.file-transfer-conflict.json (C1, nit 9): CONFLICT, retryable false, no details
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
    const { mock, link, landsDir } = await floor(transfer);
    const drive = pulls(link, landsDir);
    await drive.start();
    for (let n = 1; n <= DRIVE_LIMITS.PULLS_IN_FLIGHT; n++) {
      void drive.pull(ask(digestOf(n))).catch(() => undefined);
    }
    await until(() => transfer.running.size === DRIVE_LIMITS.PULLS_IN_FLIGHT, "four pulls run");
    const sent = mock.meshCalls.length;
    await expect(drive.pull(ask(digestOf(9)))).rejects.toMatchObject({
      kind: "RESOURCE_EXHAUSTED",
      code: RPC_ERROR_CODES.RESOURCE_EXHAUSTED,
    });
    expect(mock.meshCalls.length).toBe(sent);
    expect(DRIVE_LIMITS.PULLS_IN_FLIGHT).toBe(4);
  });

  it("resyncs a pull the snapshot no longer lists as completed when its file landed", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, landsDir } = await floor(transfer);
    const drive = pulls(link, landsDir);
    await drive.start();
    const digest = digestOf(1);
    const landed = drive.pull(ask(digest));
    await until(() => transfer.running.size === 1, "the pull runs");
    const id = idOf(transfer, digest);
    // it ended while the reader lagged: its delta was lost, its file is in place
    writeFileSync(join(landsDir, `${digest}.${id}`), "object bytes");
    transfer.running.delete(id);
    mock.pushFileTransferSnapshot();
    await expect(landed).resolves.toEqual({ path: join(landsDir, `${digest}.${id}`) });
  });

  it("resyncs a pull the snapshot no longer lists, with nothing landed, as failed io", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, landsDir } = await floor(transfer);
    const drive = pulls(link, landsDir);
    await drive.start();
    const digest = digestOf(1);
    const landed = drive.pull(ask(digest));
    await until(() => transfer.running.size === 1, "the pull runs");
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
    const { mock, link, landsDir } = await floor("unsupported");
    mock.meshUnavailable = true;
    const drive = pulls(link, landsDir);
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

  it("reads ROOT_UNGATED as held, never refused, and declares none while the drive is closed", async () => {
    const transfer = mockFileTransfer({ gated: false });
    const { link, landsDir } = await floor(transfer);
    let open = true;
    const drive = pulls(link, landsDir, { roots: () => (open ? [ROOT] : []) });
    await drive.start();
    expect(transfer.declared).toEqual([[ROOT]]);
    const ungated = MESH_FILE_TRANSFER.ROOT_UNGATED;
    expect(drive.roots()).toEqual([{ name: ROOT, state: "held", reason: ungated }]);
    open = false;
    expect(await drive.declareRoots()).toEqual([]);
    expect(transfer.declared).toEqual([[ROOT], []]);
  });

  it("drops a payload outside the contract, and the pull still settles on the next good one", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, landsDir } = await floor(transfer);
    const events: CapturedLog[] = [];
    const drive = pulls(link, landsDir, { logger: captureLogger(events) });
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

  it("answers every refusal of its own as DriveUnavailableDetails: unbuilt, or mesh-down", async () => {
    const transfer = mockFileTransfer();
    const { mock, link, landsDir } = await floor(transfer);
    const drive = pulls(link, landsDir);
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
  });

  it("refuses a previous fieldd's running digest here, and surfaces its completion as an adopt candidate", async () => {
    // field-native outlives fieldd: the first snapshot lists a pull this fieldd never minted (the W3 critic's
    // finding 4). Its digest is held, and its landed file is the drive's to adopt, never an answer to a pull.
    const transfer = mockFileTransfer();
    const digest = digestOf(1);
    const foreign = "01JC8ZK4W2MX7N3Q5R9T6V0B1D";
    transfer.running.set(foreign, {
      transferId: foreign,
      peer: "peer-b",
      root: ROOT,
      digest,
      bytes: 16_384,
      total: 48_213,
    });
    const { mock, link, landsDir } = await floor(transfer);
    const drive = pulls(link, landsDir);
    await drive.start();
    const sent = mock.meshCalls.length;
    await expect(drive.pull(ask(digest))).rejects.toMatchObject({
      kind: "CONFLICT",
      retryable: false,
    });
    expect(mock.meshCalls.length).toBe(sent);
    const candidates: DriveAdoptCandidate[] = [];
    drive.onAdoptCandidate((candidate) => candidates.push(candidate));
    mock.pushFileTransferDelta(completed(foreign, digest));
    await until(() => candidates.length === 1, "the adopt candidate");
    expect(candidates).toEqual([
      { transferId: foreign, digest, path: join(landsDir, `${digest}.${foreign}`) },
    ]);
    // its end freed the digest
    void drive.pull(ask(digest)).catch(() => undefined);
    await until(() => transfer.pulls.length === 1, "a pull of this boot");
  });
});
