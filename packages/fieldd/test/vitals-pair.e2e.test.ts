// VT-2 (track VT, 2026-11-24) — the census on a REAL pair: the built field-native measuring, this process as fieldd
// naming. VT-1's rows drove each half against a stand-in for the other; this one closes what VT-1 owed, a reading
// taken end to end. It asserts what must be true of any pair (both daemons listed, real memory, a CPU rate from the
// second reading on, a meter that costs a small share of a core) and prints the figures it read, for the record.
import { type ChildProcess, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VITALS } from "@vibefield/contracts";
import { type VitalsDeltaV1, VitalsSnapshotV1 } from "@vibefield/contracts/vitals";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import {
  endRow,
  nativeBinPath,
  type RowFloor,
  shortTmpRoot,
  waitForMgmtEndpoint,
} from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN = nativeBinPath(ROOT);

let floors: RowFloor[] = [];
let roots: string[] = [];
let cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  const row = { stops: cleanup, floors, roots };
  cleanup = [];
  floors = [];
  roots = [];
  await endRow(row);
});

async function upPair(): Promise<{ daemon: FielddDaemon; floor: ChildProcess }> {
  const dataDir = shortTmpRoot("vf-vt-");
  roots.push(dataDir);
  const floor = spawn(BIN, [], {
    env: {
      ...process.env,
      FIELD_NATIVE_DATA_DIR: dataDir,
      FIELD_LOG_DIR: join(dataDir, "logs"),
      FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
    },
    stdio: "ignore",
  });
  floors.push({ name: "the vitals row's floor", child: floor });
  await waitForMgmtEndpoint(dataDir, 15_000);
  const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  return { daemon, floor };
}

describe("VT — the census on a real pair", () => {
  it.skipIf(process.platform === "win32")(
    "lists fieldd and the floor with real memory, gives each a CPU rate from its second reading, and reads the meter's own cost",
    async () => {
      const { daemon, floor } = await upPair();
      const socket = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      cleanup.push(() => socket.close());
      const client = new WsRpc(socket);
      await helloAs(client, daemon.shellToken, "shell-main");

      const opened = (await client.call("vitals.subscribe", {})) as {
        subId: string;
        snapshot: unknown;
      };
      const snapshot = VitalsSnapshotV1.parse(opened.snapshot);
      expect(snapshot.intervalMs).toBe(VITALS.SAMPLE_INTERVAL_MS);
      const deltas = (): VitalsDeltaV1[] =>
        client.notifications
          .filter((note) => note.method === "vitals.delta" && note.params.subId === opened.subId)
          .map((note) => note.params.payload as VitalsDeltaV1);
      // three readings after the door opened: enough for every row to have a rate
      await until(
        () => deltas().filter((delta) => delta.sample !== undefined).length >= 3,
        15_000,
        "three samples from the real floor",
      );

      const processes = new Map(snapshot.processes.map((process) => [process.key, process]));
      for (const delta of deltas()) {
        for (const process of delta.processes ?? []) processes.set(process.key, process);
      }
      const last = deltas()
        .map((delta) => delta.sample)
        .filter((sample) => sample !== undefined)
        .at(-1);
      if (last === undefined) throw new Error("a sample arrived");
      const rows = last.points.map((point) => ({ point, process: processes.get(point.key) }));
      const of = (role: string) => rows.find((row) => row.process?.role === role);

      const fieldd = of("fieldd");
      const native = of("field-native");
      // this process IS fieldd here, and the floor is the child this row started
      expect(fieldd?.process).toMatchObject({ pid: process.pid, group: "fieldd" });
      expect(native?.process).toMatchObject({ pid: floor.pid, group: "floor" });
      for (const row of [fieldd, native]) {
        expect(row?.point.memBytes).toBeGreaterThan(1024 * 1024);
        expect(row?.point.cpu).not.toBeNull();
        expect(row?.point.cpu).toBeGreaterThanOrEqual(0);
        // a rate, not a counter: no process here can use more cores than the machine has
        expect(row?.point.cpu).toBeLessThan(64);
        // a start time in the past, in milliseconds, not in some other unit
        expect(row?.process?.startedAt).toBeGreaterThan(Date.now() - 24 * 3_600_000);
        expect(row?.process?.startedAt).toBeLessThanOrEqual(Date.now());
      }
      // macOS reads the physical footprint; Linux has none and says so
      const fresh = VitalsSnapshotV1.parse(
        ((await client.call("vitals.subscribe", {})) as { snapshot: unknown }).snapshot,
      );
      expect(fresh.state).toBe("recording");
      expect(fresh.memory).toBe(process.platform === "darwin" ? "footprint" : "resident");
      expect(fresh.samples.length).toBeGreaterThanOrEqual(3);
      // the meter's own cost, as a share of one core. Its budget is 5 ms of every second; that is a figure to read on
      // a quiet Mac, and this row runs on busy ones, so it holds the reading to a sane share and prints what it was
      expect(fresh.observer.meterCpu).toBeGreaterThanOrEqual(0);
      expect(fresh.observer.meterCpu).toBeLessThan(0.25);

      const mb = (bytes: number | undefined): string =>
        bytes === undefined ? "?" : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      console.info(
        `[vitals pair] fieldd ${mb(fieldd?.point.memBytes)} cpu ${fieldd?.point.cpu?.toFixed(4)} · ` +
          `field-native ${mb(native?.point.memBytes)} cpu ${native?.point.cpu?.toFixed(4)} · ` +
          `meter ${(fresh.observer.meterCpu * 100).toFixed(4)}% of a core · rows ${last.points.length}`,
      );
    },
    60_000,
  );
});
