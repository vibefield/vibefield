// OB custody (C5) — MARKS: WHAT A SURVIVOR REMEMBERS OF A STORE.
//
// A mark is a named number that only rises. A store that is put back as it was earlier is below its mark, and is
// seen to be stale. fieldd's own memory dies with fieldd, so a mark is kept by two that outlive it: the floor, told
// over the management channel (`native.marks.set`) and saying what it holds in every hello ack (`HelloAck.marks`);
// and the shell, which reads fieldd's view from a product stream (`system.custody.marks.subscribe`) and hands the
// highest it heard to the next fieldd it spawns (`CustodyHandoff.expect`).
//
// fieldd's half, here in two parts:
//   · the link alone over the mock floor: the ack's marks, and `setMark`;
//   · the daemon: its view at boot, the floor told what it lacks, and the stream (the local shell's alone, whole at
//     the open and whole again at every rise).
// The holder by itself (`src/custody-marks.ts`) is custody-marks-holder.test.ts's. The floor's own half (the memory,
// the 64 names, the ack) is field-native's `tests/marks.rs`; the mock floor here keeps marks as that one is specified
// to (`MockMgmtServer.marks`).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CUSTODY, CustodyMarksFrame, LAYOUT, SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { FielddCustody } from "../src/index";
import { NativeLink } from "../src/native-link";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import {
  bootFiles,
  bootSealed,
  type Cleanup,
  HANDED,
  hello,
  openDoor,
  pairingCredential,
  runCleanup,
  type SealedWorld,
} from "./custody-harness";
import { productDoorPath, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint, removeTempRoot, shortTmpRoot } from "./native-harness";
import { helloAs, until, type WsRpc } from "./ws-rpc";

const cleanup: Cleanup = [];
afterEach(() => runCleanup(cleanup));

/** The first mark: the objects store's grants generation. */
const GRANTS = CUSTODY.MARK_OBJECT_GRANTS;
const STREAM = "system.custody.marks.subscribe";
const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A mock floor and a link to it that has not dialled yet. */
async function floorAndLink(): Promise<{ mock: MockMgmtServer; link: NativeLink }> {
  const dataDir = shortTmpRoot("vf-cust-");
  cleanup.push(() => removeTempRoot(dataDir));
  mkdirSync(join(dataDir, ...LAYOUT.NATIVE_RUN_DIR), { recursive: true });
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const link = new NativeLink({
    socketPath: mock.endpoint,
    pairingSecret: () => mock.pairingSecretHex,
    bootId: "fieldd-marks-link",
  });
  cleanup.push(() => link.close());
  return { mock, link };
}

describe("the link and the floor's marks (C5)", () => {
  it("the link reads the ack's marks", async () => {
    const { mock, link } = await floorAndLink();
    mock.marks.set(GRANTS, 8).set("store.other", 3);
    // before any hello it holds none
    expect([...link.marks]).toEqual([]);
    await link.connect();
    expect(Object.fromEntries(link.marks)).toEqual({ [GRANTS]: 8, "store.other": 3 });

    // every hello is read again: a floor that came back holds what THAT floor holds (marks die with the floor)
    mock.marks.clear();
    mock.marks.set("store.other", 1);
    const before = mock.connections;
    mock.killClients();
    await until(() => mock.connections > before && link.connected, 15_000, "the re-pair");
    expect(Object.fromEntries(link.marks)).toEqual({ "store.other": 1 });
  });

  it("an ack's marks are read on their own terms: a name off the pattern or a value that is no count is dropped", async () => {
    const { mock, link } = await floorAndLink();
    // what a floor never sends, and what this side must not believe if one did
    mock.marks.set("Not A Name", 4).set("store.negative", -1);
    mock.marks.set("store.half", 1.5).set(GRANTS, 2);
    await link.connect();
    expect(Object.fromEntries(link.marks)).toEqual({ [GRANTS]: 2 });
  });

  // the floor's count is a u64: past the safe integers it reads as the top here, never as no mark (§8, v0.11)
  it("a mark past the safe integers reads as the top: in the ack, and in a set's answer", async () => {
    const { mock, link } = await floorAndLink();
    mock.marks.set(GRANTS, 2 ** 60);
    await link.connect();
    expect(link.marks.get(GRANTS)).toBe(Number.MAX_SAFE_INTEGER);
    await expect(link.setMark(GRANTS, 3)).resolves.toBe(Number.MAX_SAFE_INTEGER);
  });

  it("`setMark` answers what the floor keeps", async () => {
    const { mock, link } = await floorAndLink();
    await link.connect();
    await expect(link.setMark(GRANTS, 9)).resolves.toBe(9);
    // a mark only rises: a value below it changes nothing and reads the mark back
    await expect(link.setMark(GRANTS, 4)).resolves.toBe(9);
    await expect(link.setMark(GRANTS, 12)).resolves.toBe(12);
    expect(mock.marks.get(GRANTS)).toBe(12);
    // each was asked of the floor, as given: the link keeps no mark of its own to answer from
    expect(mock.markSets).toEqual([
      { name: GRANTS, value: 9 },
      { name: GRANTS, value: 4 },
      { name: GRANTS, value: 12 },
    ]);
  });

  it("a set the floor refuses is the floor's refusal", async () => {
    const { mock, link } = await floorAndLink();
    await link.connect();
    // a name off the pattern
    await expect(link.setMark("Not A Name", 1)).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      retryable: false,
    });
    // one name more than the floor holds at once
    for (let i = 0; i < CUSTODY.MARKS_MAX; i += 1) mock.marks.set(`held.${i}`, 1);
    await expect(link.setMark("one.more", 1)).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      details: { reason: "marks-full" },
    });
    expect(mock.marks.has("one.more")).toBe(false);
    // a held name always rises
    await expect(link.setMark("held.0", 5)).resolves.toBe(5);
  });
});

const participant = (suffix: string) => ({
  participantId: `renderer:desktop-test:window-${suffix}`,
  incarnation: `renderer:desktop-test:window-${suffix}:document-1`,
});

/** A shell paired with a sealed daemon (§2.3), as shell-pairing.test.ts's control pairs. */
async function shell(world: SealedWorld): Promise<WsRpc> {
  const { controlPort: port, bootId } = world.daemon;
  const rpc = await openDoor(cleanup, port);
  await hello(rpc, pairingCredential({ port, bootId }));
  return rpc;
}

/** Open the marks' stream: its id and its first, whole value. */
async function marksOf(rpc: WsRpc): Promise<{ subId: string; snapshot: CustodyMarksFrame }> {
  const open = (await rpc.call(STREAM, {})) as { subId: string; snapshot: unknown };
  return { subId: open.subId, snapshot: CustodyMarksFrame.parse(open.snapshot) };
}

/** Every frame a stream sent after its open, in order. */
function frames(rpc: WsRpc, subId: string): Array<{ method: string; frame: unknown }> {
  const sent = rpc.notifications.filter((one) => one.params.subId === subId);
  return sent.map((one) => ({ method: one.method, frame: one.params.payload }));
}

describe("fieldd's marks (C5)", () => {
  it("fieldd's view at boot is the max of the hand-off's `expect` and the ack's", async () => {
    const custody: FielddCustody = {
      ...HANDED,
      expect: { [GRANTS]: 5, "store.both": 7, "store.shell": 9 },
    };
    const world = await bootSealed(cleanup, {
      custody,
      floor: (mock) => {
        mock.marks.set(GRANTS, 8).set("store.both", 4);
        mock.marks.set("store.floor", 2);
      },
    });
    const marks = world.daemon.custodyMarks;
    // name by name the higher of the two, whichever of them holds it
    expect(marks.get(GRANTS)).toBe(8);
    expect(marks.get("store.both")).toBe(7);
    expect(marks.get("store.shell")).toBe(9);
    expect(marks.get("store.floor")).toBe(2);
    // and 0 for a name neither holds
    expect(marks.get("store.none")).toBe(0);

    // the stream opens on that view, whole
    const { snapshot } = await marksOf(await shell(world));
    expect(snapshot.marks).toEqual({
      [GRANTS]: 8,
      "store.both": 7,
      "store.shell": 9,
      "store.floor": 2,
    });
  });

  it("a floor that holds less than fieldd is told what fieldd holds", async () => {
    const custody: FielddCustody = { ...HANDED, expect: { "store.both": 7, "store.shell": 9 } };
    const { mock } = await bootSealed(cleanup, {
      custody,
      floor: (floor) => {
        floor.marks.set(GRANTS, 8).set("store.both", 4);
      },
    });
    // the shell remembered more than this floor does (a floor that came up since): the floor is a survivor again
    await until(
      () => mock.marks.get("store.both") === 7 && mock.marks.get("store.shell") === 9,
      15_000,
      "the floor is told the marks it lacks",
    );
    // and it is told nothing it already holds at least as high
    const told = mock.markSets.map((set) => set.name);
    expect(told.sort()).toEqual(["store.both", "store.shell"]);
    expect(mock.marks.get(GRANTS)).toBe(8);
  });

  it("a floor that comes back empty is told again, and fieldd's view does not fall", async () => {
    const { daemon, mock } = await bootSealed(cleanup, {
      floor: (floor) => {
        floor.marks.set(GRANTS, 8);
      },
    });
    expect(daemon.custodyMarks.get(GRANTS)).toBe(8);
    // the floor is gone and another is there: marks die with the floor
    mock.marks.clear();
    const before = mock.connections;
    mock.killClients();
    await until(
      () => mock.connections > before && mock.marks.get(GRANTS) === 8,
      15_000,
      "the floor that came back is told the mark",
    );
    expect(daemon.custodyMarks.get(GRANTS)).toBe(8);
  });

  it("the stream is refused to a window token and to a tailnet principal", async () => {
    const world = await bootSealed(cleanup, { before: (dataDir) => writeLinkFixture(dataDir) });
    const { daemon, mock } = world;
    // the control: the local shell opens it
    const paired = await shell(world);
    expect((await marksOf(paired)).snapshot.marks).toEqual({});

    // a window's token that carries the stream's own scope: the gate is WHO the caller is, as it is for
    // `system.mintWindowToken`, and a window is not the shell
    const minted = (await paired.call("system.mintWindowToken", {
      scopes: ["tokens.mint"],
      label: "window-1",
      rendererParticipant: participant("1"),
    })) as { token: string };
    const window = await openDoor(cleanup, daemon.controlPort);
    await helloAs(window, minted.token);
    expect((await window.callErr(STREAM, {})).data?.kind).toBe("FORBIDDEN_SCOPE");

    // a window's token without it does not reach the handler at all
    const plain = (await paired.call("system.mintWindowToken", {
      scopes: ["canvas.read"],
      label: "window-2",
      rendererParticipant: participant("2"),
    })) as { token: string };
    const other = await openDoor(cleanup, daemon.controlPort);
    await helloAs(other, plain.token);
    expect((await other.callErr(STREAM, {})).data).toMatchObject({
      kind: "FORBIDDEN_SCOPE",
      details: { required: "tokens.mint" },
    });

    // the person's own phone, arriving through the sidecar's door
    await until(() => mock.meshServes.get("product") !== undefined, 15_000, "the product serve");
    const phone = await openDoor(cleanup, daemon.controlPort, productDoorPath(mock), {
      "Tailscale-User-Login": TEST_LOGIN,
    });
    const ack = await hello(phone, undefined, "ios");
    expect(ack.grantedScopes).not.toContain("tokens.mint");
    expect((await phone.callErr(STREAM, {})).data?.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("it emits whole on every rise and never on a non-rise", async () => {
    const world = await bootSealed(cleanup, {
      custody: { ...HANDED, expect: { "store.shell": 9 } },
    });
    const rpc = await shell(world);
    const { subId, snapshot } = await marksOf(rpc);
    expect(snapshot.marks).toEqual({ "store.shell": 9 });
    const marks = world.daemon.custodyMarks;

    // a rise: one frame, and it is every mark, not the one that moved
    await expect(marks.note(GRANTS, 3)).resolves.toBe(3);
    await until(() => frames(rpc, subId).length >= 1, 4_000, "the first rise's frame");
    expect(frames(rpc, subId)[0]).toEqual({
      method: "system.custody.marks.delta",
      frame: { marks: { [GRANTS]: 3, "store.shell": 9 } },
    });

    // not a rise: the same value, a lower one, and 0 for a name nobody holds
    await expect(marks.note(GRANTS, 3)).resolves.toBe(3);
    await expect(marks.note(GRANTS, 1)).resolves.toBe(3);
    await expect(marks.note("store.none", 0)).resolves.toBe(0);
    // a second rise, sent after them on the same connection: a frame for any of the three would arrive before its
    await expect(marks.note(GRANTS, 4)).resolves.toBe(4);
    await until(() => frames(rpc, subId).length >= 2, 4_000, "the second rise's frame");
    await settle(150);
    expect(frames(rpc, subId)).toEqual([
      {
        method: "system.custody.marks.delta",
        frame: { marks: { [GRANTS]: 3, "store.shell": 9 } },
      },
      {
        method: "system.custody.marks.delta",
        frame: { marks: { [GRANTS]: 4, "store.shell": 9 } },
      },
    ]);
    // the floor was told each rise, and a non-rise was not sent to it
    expect(world.mock.marks.get(GRANTS)).toBe(4);
    expect(world.mock.markSets.filter((set) => set.name === GRANTS)).toEqual([
      { name: GRANTS, value: 3 },
      { name: GRANTS, value: 4 },
    ]);
  });

  it("a files fieldd serves the stream to its shell, with no floor behind its marks", async () => {
    const { daemon, mock } = await bootFiles(cleanup, {
      floor: (floor) => {
        floor.marks.set(GRANTS, 8);
      },
    });
    const rpc = await openDoor(cleanup, daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    const { subId, snapshot } = await marksOf(rpc);
    // nothing was handed, and the floor's word is not taken: the view starts empty
    expect(snapshot.marks).toEqual({});
    // the holder is the same one a sealed daemon has, so a store has one code path: a note rises and is said
    await expect(daemon.custodyMarks.note(GRANTS, 3)).resolves.toBe(3);
    await until(() => frames(rpc, subId).length >= 1, 4_000, "the rise's frame");
    expect(frames(rpc, subId)[0]?.frame).toEqual({ marks: { [GRANTS]: 3 } });
    // and the floor is told nothing: at `files` this fieldd asks nothing new of its floor
    await settle(150);
    expect(mock.markSets).toEqual([]);
  });
});
