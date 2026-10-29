import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentModelMeshFrame, AgentModelMeshOpen } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { BoardScreen } from "../src/godview/monitor/board-screen";

// PG-1b (PG-L4.1) — the window reads the model board one desktop at a time: a
// row this build cannot read leaves its frame and reads its desktop as another
// version, while the frame, the chain and every other desktop stand.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");
const golden = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;

const PEER = "dev-01HQ9S7XZ2";
const EPOCH = "fieldd-5d2c8f1a0b7e4c93.2";
type Row = Record<string, unknown>;
type Open = { devices: Array<{ device: string; state: string; snapshot?: { rows: Row[] } }> };

const openWith = (extra: Row[] = []): Open => {
  const open = structuredClone(golden("agent-model-mesh-open.valid.json")) as Open;
  const peer = open.devices.find((entry) => entry.device === PEER);
  if (peer?.snapshot === undefined) throw new Error("the golden lists the peer's board");
  peer.snapshot.rows.push(...extra);
  return open;
};
const peerRow = (): Row => {
  const rows = openWith().devices.find((entry) => entry.device === PEER)?.snapshot?.rows;
  const row = rows?.[0];
  if (row === undefined) throw new Error("the golden's peer runs one agent");
  return row;
};
/** a newer peer's row: a tier this build has no word for */
const newer = (id = "run-newer"): Row => ({
  ...peerRow(),
  runtimeRunId: id,
  tier: "hosted",
  monitorRow: { ...(peerRow()["monitorRow"] as Row), id },
});
const readable = (id = "run-newer"): Row => ({
  ...peerRow(),
  runtimeRunId: id,
  monitorRow: { ...(peerRow()["monitorRow"] as Row), id },
});
const delta = (since: number, upserts: Row[], removed: string[] = []) => ({
  device: PEER,
  delta: { epoch: EPOCH, since, revision: since + 1, upserts, removed },
});

describe("BoardScreen — the model board read one desktop at a time (PG-1b)", () => {
  it("passes a clean open and a clean frame through as they came", () => {
    const screen = new BoardScreen();
    const open = openWith();
    expect(screen.open(open)).toEqual(open);
    const frame = delta(17, [readable()]);
    expect(screen.frame(frame)).toEqual([frame]);
  });

  it("an open: drops the row it cannot read, reads that desktop as another version, and the open parses whole", () => {
    const screen = new BoardScreen();
    const screened = screen.open(openWith([newer()])) as Open;
    expect(AgentModelMeshOpen.safeParse(openWith([newer()])).success, "red without it").toBe(false);
    expect(AgentModelMeshOpen.safeParse(screened).success).toBe(true);
    const peer = screened.devices.find((entry) => entry.device === PEER);
    expect(peer?.state).toBe("incompatible");
    expect(peer?.snapshot?.rows.map((row) => row["runtimeRunId"])).toEqual(["run-loft-w"]);
    // every other desktop stands as it came
    const others = (open: Open) => open.devices.filter((entry) => entry.device !== PEER);
    expect(others(screened)).toEqual(others(openWith()));
  });

  it("a delta: keeps its chain and its readable rows, and the desktop's standing follows as a frame of its own", () => {
    const screen = new BoardScreen();
    screen.open(openWith());
    const frames = screen.frame(delta(17, [readable("run-ok"), newer()], ["run-gone"]));
    expect(frames).toHaveLength(2);
    // the unreadable key leaves the board with the frame's own removals; the chain is the frame's
    expect(frames[0]).toEqual(delta(17, [readable("run-ok")], ["run-gone", "run-newer"]));
    expect(frames[1]).toMatchObject({ device: PEER, state: "incompatible" });
    for (const frame of frames) expect(AgentModelMeshFrame.safeParse(frame).success).toBe(true);
    // while it holds one, the wire's own word on its standing reads as another version
    expect(
      screen.frame({ device: PEER, state: "stale", asOf: "2026-10-29T12:00:00.000Z" }),
    ).toEqual([{ device: PEER, state: "incompatible", asOf: "2026-10-29T12:00:00.000Z" }]);
  });

  it("the desktop comes back as the wire last said, once its last unreadable row is readable or gone", () => {
    const screen = new BoardScreen();
    screen.open(openWith());
    screen.frame(delta(17, [newer("run-a"), newer("run-b")]));
    // one becomes readable: still another version
    expect(screen.frame(delta(18, [readable("run-a")]))).toEqual([delta(18, [readable("run-a")])]);
    // the other leaves the board: back to the wire's word (the open said live)
    const back = screen.frame(delta(19, [], ["run-b"]));
    expect(back[0]).toEqual(delta(19, [], ["run-b"]));
    expect(back[1]).toMatchObject({ device: PEER, state: "live" });
  });

  it("a row the window shows that turns unreadable leaves it, as an open would drop it, never frozen", () => {
    const screen = new BoardScreen();
    screen.open(openWith());
    const frames = screen.frame(delta(17, [newer("run-loft-w")]));
    expect(frames[0]).toEqual(delta(17, [], ["run-loft-w"]));
    expect(frames[1]).toMatchObject({ device: PEER, state: "incompatible" });
  });

  it("a desktop's snapshot frame replaces what it held unreadable", () => {
    const screen = new BoardScreen();
    screen.open(openWith([newer()]));
    const clean = { device: PEER, snapshot: { epoch: EPOCH, revision: 30, rows: [peerRow()] } };
    const frames = screen.frame(clean);
    expect(frames[0]).toEqual(clean);
    expect(frames[1]).toMatchObject({ device: PEER, state: "live" });
  });

  it("a payload that is no open and no frame passes untouched, for the envelope to judge as before", () => {
    const screen = new BoardScreen();
    const notAFrame = [delta(17, [])];
    expect(screen.frame(notAFrame)).toEqual([notAFrame]);
    expect(screen.open("nothing")).toBe("nothing");
  });
});
