// CP-1a — the floor's door (`thinking-roled-agents.md` §16; mgmt.ts `NativeDoor*`, registries.ts `NATIVE_DOOR`). The
// shapes' own rows: what a door says about its caller and its pane, the reasons' open vocabulary, and the one rule for
// comparing a caller's start with another reading of it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { METHODS } from "../src/methods";
import {
  MeshLaneProtocol,
  NATIVE_DOOR_CLOSE_REASONS,
  NativeDoorClosed,
  NativeDoorOpen,
  NativeDoorSnapshot,
  sameStartSecond,
} from "../src/mgmt";
import { NATIVE_DOOR, SOCKETS } from "../src/registries";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

describe("CP-1a — the floor's door", () => {
  it("names the caller by its pid and start, and its pane when one holds it", () => {
    const open = NativeDoorOpen.parse(fixture("native-door-open.valid.json"));
    expect(open.caller).toEqual({ pid: 51842, startedAtMs: 1792431662417 });
    expect(open.pane).toEqual({
      terminalSessionId: "5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9",
      depth: 2,
    });
    // a caller outside every pane still has a door: `pane` is absent, never empty
    const outside = NativeDoorOpen.parse(fixture("native-door-open.outside.json"));
    expect(outside.pane).toBeUndefined();
    expect("pane" in (fixture("native-door-open.outside.json") as object)).toBe(false);
  });

  it("keeps a door lane's id below 2^53, so it crosses JSON-RPC to fieldd intact", () => {
    for (const door of NativeDoorSnapshot.parse(fixture("native-door-snapshot.valid.json")).doors) {
      expect(Number.isSafeInteger(door.laneId)).toBe(true);
      // minted from the floor's inbound base (mesh_bridge.rs `INBOUND_LANE_ID_BASE`, 2^32)
      expect(door.laneId).toBeGreaterThanOrEqual(2 ** 32);
    }
  });

  it("tells an open door from a closed one by `state`, and keeps a reason it does not know", () => {
    expect(NativeDoorOpen.safeParse(fixture("native-door-closed.valid.json")).success).toBe(false);
    expect(NativeDoorClosed.safeParse(fixture("native-door-open.valid.json")).success).toBe(false);
    const unknown = NativeDoorClosed.parse({
      connId: "door-9",
      state: "closed",
      reason: "cell-gone",
    });
    expect(unknown.reason, "open vocabulary: logged verbatim, never refused").toBe("cell-gone");
    expect(NATIVE_DOOR_CLOSE_REASONS).toEqual([
      "eof",
      "refused-uid",
      "delegated",
      "peer-gone",
      "limit",
      "held-too-long",
      "closed-by-fieldd",
    ]);
  });

  it("compares two readings of one start at whole seconds, never to the millisecond", () => {
    expect(NATIVE_DOOR.START_RESOLUTION_MS).toBe(1_000);
    // the kernel's reading against `ps -o lstart=`'s, which truncates to the second
    expect(sameStartSecond(1792431662417, 1792431662000)).toBe(true);
    expect(sameStartSecond(1792431662999, 1792431662000)).toBe(true);
    expect(sameStartSecond(1792431663000, 1792431662999)).toBe(false);
  });

  it("is a door under the run dir's name budget, with an `mcp` lane and three mgmt verbs", () => {
    expect(SOCKETS.DOOR).toBe("door.sock");
    expect(SOCKETS.DOOR.length).toBeLessThanOrEqual(14);
    expect(MeshLaneProtocol.options).toContain("mcp");
    const door = METHODS.filter((m) => m.method.startsWith("native.door."));
    expect(door.map((m) => [m.method, m.surface, m.locality, m.subscription ?? false])).toEqual([
      ["native.door.subscribe", "mgmt", "local", true],
      ["native.door.close", "mgmt", "local", false],
      ["native.door.info", "mgmt", "local", false],
    ]);
  });

  it("bounds what doors hold while no fieldd is attached, per door and in all", () => {
    expect(NATIVE_DOOR.MAX_OPEN).toBe(64);
    expect(NATIVE_DOOR.HELD_BYTES_PER_DOOR).toBe(256 * 1024);
    // 64 full doors would pin 16 MiB; the total holds the floor to 4 MiB
    expect(NATIVE_DOOR.HELD_BYTES_TOTAL).toBeLessThan(
      NATIVE_DOOR.MAX_OPEN * NATIVE_DOOR.HELD_BYTES_PER_DOOR,
    );
  });

  it("bounds a line on both line readers, the bridge's and fieldd's", () => {
    expect(NATIVE_DOOR.LINE_MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});
