// PJ-2 §0 (build-pj23.md §4) — is a placeId stable? A placeId hashes the
// device id its scanner is given (place-scanner.ts `placeIdFor`), and PJ-2's
// records persist anchors, links and splits by placeId, so a move of that id
// orphans every one of them. PJ-1 gave the scanner the ROSTER id, and the
// roster id moves: it is the persisted local fallback until the mesh answers,
// the mesh ULID after (D30), and a NEW ULID after an unlink and a relink (the
// native `retire` archives the mesh state). These rows prove the moves, and
// that a scanner keyed by the persisted local id — the daemon's wiring since
// PJ-2 — publishes the same placeIds across all of them.
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlaceFacts } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { DeviceService, localDeviceIdAt } from "../src/device-service";
import type { MeshClient } from "../src/mesh-client";
import {
  type PlaceCatalog,
  type PlaceFactsAsker,
  PlaceScanner,
} from "../src/projects/place-scanner";
import { readPlaces } from "../src/workspace/host/places";
import type { FilesHostHealth } from "../src/workspace/supervisor";

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

function scratch(): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "vf-placeid-")));
  cleanup.push(() => rmSync(base, { recursive: true, force: true }));
  return base;
}

/** The mesh as DeviceService reads its identity: down (every call refuses),
 * or up under a node whose durable ULID is `ulid`. */
function meshOf() {
  const state: { ulid: string | null } = { ulid: null };
  const down = async (): Promise<never> => {
    throw new Error("mesh down");
  };
  const mesh = Object.assign(new EventEmitter(), {
    getSlice: async () => (state.ulid === null ? down() : { deviceId: state.ulid }),
    subscribePeers: async () => (state.ulid === null ? down() : undefined),
    peers: async () => (state.ulid === null ? down() : []),
    subscribeStoreManaged: async () =>
      state.ulid === null ? down() : { snapshot: { slices: {} }, dispose: () => undefined },
    setSlice: async () => (state.ulid === null ? down() : undefined),
  });
  return { mesh: mesh as unknown as MeshClient, state };
}

function devicesOf(dataDir: string, mesh: MeshClient): DeviceService {
  const devices = new DeviceService({
    dataDir,
    mesh,
    bootId: "boot-1",
    fielddVersion: "0.0.0",
    contractsVersion: "1.0.0",
    productEndpoint: () => ({ serve: "product" }),
  });
  cleanup.push(() => devices.dispose());
  return devices;
}

describe("PJ-2 §0 — the id a placeId hashes", () => {
  it("the roster id moves at a link and again at a relink; the persisted local id never does", async () => {
    const dataDir = scratch();
    const { mesh, state } = meshOf();
    const devices = devicesOf(dataDir, mesh);
    await devices.sync();
    const local = devices.currentDeviceId();
    expect(local).toMatch(/^local-/);
    expect(devices.localDeviceId()).toBe(local);

    // linked: the mesh identity supersedes the fallback (D30)
    state.ulid = "01JA0000000000000000000001";
    await devices.sync();
    expect(devices.currentDeviceId()).toBe("01JA0000000000000000000001");
    // unlinked and relinked: `retire` archived the mesh state, a new ULID
    state.ulid = "01JB0000000000000000000002";
    await devices.sync();
    expect(devices.currentDeviceId()).toBe("01JB0000000000000000000002");

    expect(devices.localDeviceId()).toBe(local);
    // a restart reads the same persisted id, linked or not
    expect(devicesOf(dataDir, meshOf().mesh).localDeviceId()).toBe(local);
    expect(localDeviceIdAt(dataDir)).toBe(local);
  });

  it("keyed by the roster id a folder had three placeIds; keyed by the local id it keeps one", async () => {
    const base = scratch();
    const folder = join(base, "app");
    mkdirSync(folder);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: folder });
    writeFileSync(join(folder, "n.txt"), "n\n");
    const { mesh, state } = meshOf();
    const devices = devicesOf(join(base, "root"), mesh);
    await devices.sync();

    const told: string[][] = [];
    const catalog = Object.assign(new EventEmitter(), {
      ready: true,
      projects: { rows: () => [{ projectId: "p-app", rootPaths: [folder] }] },
      setPlaces: (places: ReadonlyMap<string, readonly PlaceFacts[]>) => {
        told.push([...places.values()].flat().map((place) => place.placeId));
      },
    }) as unknown as PlaceCatalog;
    const worker = Object.assign(new EventEmitter(), {
      health: (): FilesHostHealth => ({
        phase: "ready",
        detail: null,
        pid: 1,
        generation: 1,
        mille: null,
      }),
      request: async (_op: "placeFacts", args: Parameters<typeof readPlaces>[0]) =>
        readPlaces(args, { temps: [] }),
    }) as unknown as PlaceFactsAsker;
    const scan = (deviceId: () => string) => {
      const scanner = new PlaceScanner({
        catalog,
        worker,
        deviceId,
        taskRoots: () => [],
        intervalMs: 0,
        settleMs: 60_000,
      });
      cleanup.push(() => scanner.dispose());
      return scanner;
    };
    const byRoster = scan(() => devices.currentDeviceId());
    const byLocal = scan(() => devices.localDeviceId());

    const roster: string[] = [];
    const stable: string[] = [];
    for (const ulid of [null, "01JA0000000000000000000001", "01JB0000000000000000000002"]) {
      state.ulid = ulid;
      await devices.sync();
      await byRoster.scanNow();
      roster.push(...told.at(-1)!);
      await byLocal.scanNow();
      stable.push(...told.at(-1)!);
    }
    expect(new Set(roster).size).toBe(3);
    expect(new Set(stable).size).toBe(1);
  });
});
