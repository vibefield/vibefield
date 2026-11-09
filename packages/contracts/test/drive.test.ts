// DR-2a (`draft/thinking-drive.md` v0.3: DR-D7 (a), DR-L1, DR-L3, DR-L8; the wave-0 plan's DR-2/DR-3 map and its
// critic's VF-DRC line) — the drive's contracts: its registry rows, its lane, the file transfer that moves its objects
// between desktops, and its holders' slice. The fixtures pin the shapes (fixtures.test.ts here, and field-native's
// fixture_parity.rs for the floor's half); these rows pin the refusals, which a golden cannot show, and the registry
// facts the floor's belt and fieldd's suspenders both read.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOC_SYNC_MAX_RECORD_BYTES } from "../src/docsync";
import {
  DRIVE_PROTOCOL,
  DriveHolderState,
  DriveHoldersSlice,
  DriveUnavailableDetails,
  DriveUnavailableState,
} from "../src/drive";
import { ErrorData, RPC_ERROR_CODES, UnavailableDetails } from "../src/errors";
import { METHODS } from "../src/methods";
import {
  FileTransferLanded,
  FileTransferPath,
  FileTransferRootName,
  MESH_FILE_TRANSFER,
  MeshLaneOpenRequest,
  MeshLaneProtocol,
  NativeFileTransferDelta,
  NativeFileTransferPullParams,
  NativeFileTransferRootsResult,
  NativeFileTransferSnapshot,
} from "../src/mgmt";
import {
  DRIVE_LIMITS,
  DRIVE_SERVICE,
  FILE_TRANSFER_ROOTS,
  LAYOUT,
  LAYOUT_ROOT_LEVEL,
  MADE_APP_VIEW,
  MESH_CONTROL_LIMITS,
  STORES,
} from "../src/registries";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;
const record = (name: string) => fixture(name) as Record<string, unknown>;
const delta = (kind: string) =>
  NativeFileTransferDelta.parse(fixture(`native-file-transfer-delta.${kind}.json`));
const snapshot = (name: string) =>
  NativeFileTransferSnapshot.parse(fixture(`native-file-transfer-snapshot.${name}.json`));

/** The goldens' object and pull. */
const DIGEST = "b02750d32042f3e5061f34a1d35dd4c03cf03266de5063222e68afeca8b4b201";
const TRANSFER = "01JC8ZK4W2MX7N3Q5R9T6V0B1D";

describe("DR-2a — the drive's registry rows", () => {
  it("names the holders' store and bounds its slice inside one mgmt frame", () => {
    expect(STORES.DRIVE).toBe("field.drive.v1");
    expect(MESH_CONTROL_LIMITS.DRIVE_SLICE_BYTES).toBe(64 * 1024);
    expect(MESH_CONTROL_LIMITS.DRIVE_SLICE_BYTES).toBeLessThan(
      MESH_CONTROL_LIMITS.MGMT_FRAME_BYTES,
    );
    // the golden slice is a few hundred bytes: the cap stops one peer amplifying every reader
    const golden = JSON.stringify(fixture("drive-holders-slice.valid.json"));
    expect(Buffer.byteLength(golden, "utf8")).toBeLessThan(MESH_CONTROL_LIMITS.DRIVE_SLICE_BYTES);
  });

  it("keeps the drive under the user's own root, its three folders inside it (DR-L1)", () => {
    expect(LAYOUT.DRIVE_DIR).toEqual(["drive"]);
    expect(LAYOUT.DRIVE_OBJECTS_DIR).toEqual(["drive", "objects"]);
    expect(LAYOUT.DRIVE_INCOMING_DIR).toEqual(["drive", "incoming"]);
    expect(LAYOUT.DRIVE_IMPORT_DIR).toEqual(["drive", "import"]);
    const rows = [
      "DRIVE_DIR",
      "DRIVE_OBJECTS_DIR",
      "DRIVE_INCOMING_DIR",
      "DRIVE_IMPORT_DIR",
    ] as const;
    for (const key of rows) {
      // under `users/<fuid>/`, never at the VibeField root: the drive is the account's
      expect(LAYOUT_ROOT_LEVEL, key).not.toContain(key);
      expect(LAYOUT[key][0], key).toBe(LAYOUT.DRIVE_DIR[0]);
      // no other row names the same place
      const path = LAYOUT[key].join("/");
      const spelled = Object.entries(LAYOUT).filter(([, segs]) => segs.join("/") === path);
      expect(
        spelled.map(([name]) => name),
        key,
      ).toEqual([key]);
    }
  });

  it("pins the bounds, and holds no disk budget until the real library is measured (record §10, risk 5)", () => {
    expect(DRIVE_LIMITS).toEqual({
      OBJECT_MAX_BYTES: 64 * 1024 * 1024,
      LANE_RECORD_BYTES: 1024 * 1024,
      PULLS_IN_FLIGHT: 4,
    });
  });

  it("fits a captured page in one object, and one lane record in one meshdata frame", () => {
    // one value feeds mille-drive's open and truffle's node, so neither admits what the other cannot move
    expect(DRIVE_LIMITS.OBJECT_MAX_BYTES).toBeGreaterThanOrEqual(MADE_APP_VIEW.PAGE_MAX_BYTES);
    expect(DRIVE_LIMITS.LANE_RECORD_BYTES).toBeLessThanOrEqual(DOC_SYNC_MAX_RECORD_BYTES);
    expect(Number.isSafeInteger(DRIVE_LIMITS.OBJECT_MAX_BYTES)).toBe(true);
    expect(Number.isSafeInteger(DRIVE_LIMITS.PULLS_IN_FLIGHT)).toBe(true);
    expect(DRIVE_LIMITS.PULLS_IN_FLIGHT).toBeGreaterThan(0);
  });

  it("says every honest state as a contract string (DR-L8)", () => {
    expect(DRIVE_SERVICE).toEqual({
      SERVICE: "drive",
      STATE_UNBUILT: "unbuilt",
      STATE_STARTING: "starting",
      STATE_NOT_LINKED: "not-linked",
      STATE_MESH_DOWN: "mesh-down",
      STATE_COPYING: "copying",
      STATE_NOT_HELD: "not-held",
      STATE_OUT_OF_ROOM: "out-of-room",
    });
  });
});

describe("DR-2a — a pull root is a closed name, never a path (EL7)", () => {
  const roots = Object.values(FILE_TRANSFER_ROOTS);

  it("maps each name to the LAYOUT rows it serves and lands in", () => {
    expect(FILE_TRANSFER_ROOTS.DRIVE_OBJECTS).toEqual({
      name: "drive-objects",
      serves: "DRIVE_OBJECTS_DIR",
      lands: "DRIVE_INCOMING_DIR",
    });
    for (const root of roots) {
      // truffle's root grammar (RFC 032), so the same name rides the wire to every holder
      expect(root.name).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/);
      expect(Object.keys(LAYOUT), root.name).toContain(root.serves);
      expect(Object.keys(LAYOUT), root.name).toContain(root.lands);
    }
    const names = roots.map((root) => root.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...FileTransferRootName.options].sort()).toEqual([...names].sort());
  });

  it("never lands in a folder any root serves, so an unverified file is never passed on", () => {
    const inside = (path: readonly string[], folder: readonly string[]) =>
      folder.every((segment, i) => path[i] === segment);
    for (const root of roots) {
      for (const other of roots) {
        expect(inside(LAYOUT[root.lands], LAYOUT[other.serves]), root.name).toBe(false);
        expect(inside(LAYOUT[other.serves], LAYOUT[root.lands]), root.name).toBe(false);
      }
    }
  });

  it("serves a root only from a node built gated: an ungated node holds the declaration, unregistered", () => {
    const answer = fixture("native-file-transfer-roots-result.ungated.json");
    const { roots: held } = NativeFileTransferRootsResult.parse(answer);
    expect(held).toEqual([
      {
        name: FILE_TRANSFER_ROOTS.DRIVE_OBJECTS.name,
        registered: false,
        reason: MESH_FILE_TRANSFER.ROOT_UNGATED,
      },
    ]);
    // the floor's own word: the declaration stands, and the next node built gated serves it
    expect(MESH_FILE_TRANSFER.ROOT_UNGATED).toBe("ungated");
  });

  it("refuses a name outside the closed list, and a path above all", () => {
    for (const bad of [
      "drive",
      "drive-incoming",
      "DRIVE-OBJECTS",
      "/Users/james/vf/users/1/drive/objects",
      "",
    ]) {
      expect(FileTransferRootName.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("DR-2a — a pull names a root and a path RELATIVE to it (truffle T-3, RFC 032)", () => {
  it("admits the drive's object paths and other plain relative paths", () => {
    for (const ok of [`${DIGEST.slice(0, 2)}/${DIGEST}`, "a", "a/b/c.txt", "v1.2/file_name-3"]) {
      expect(FileTransferPath.safeParse(ok).success, ok).toBe(true);
    }
  });

  it("refuses an absolute path, a `.` or `..` segment, an empty one, and what a holder reads as a separator", () => {
    for (const bad of [
      "",
      "/",
      "/a",
      "a/",
      "a//b",
      ".",
      "..",
      "a/./b",
      "a/../b",
      "../a",
      "a\\b",
      "C:/a",
      "a:b",
      "a\u0000b",
      // narrower than truffle's grammar: a holder admits these, and the contract never sends them
      ".hidden",
      "a b",
      "caf\u00e9",
    ]) {
      expect(FileTransferPath.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("bounds a path at PATH_MAX_BYTES", () => {
    const atCap = "a".repeat(MESH_FILE_TRANSFER.PATH_MAX_BYTES);
    expect(FileTransferPath.safeParse(atCap).success).toBe(true);
    expect(FileTransferPath.safeParse(`${atCap}b`).success).toBe(false);
  });

  it("parses the golden pull, which names no size, and refuses a holder's absolute path and a digest that is not blake3 hex", () => {
    const golden = record("native-file-transfer-pull-params.valid.json");
    const pull = NativeFileTransferPullParams.parse(golden);
    expect(pull.root).toBe(FILE_TRANSFER_ROOTS.DRIVE_OBJECTS.name);
    expect(pull.digest).toBe(DIGEST);
    expect(pull.transferId).toBe(TRANSFER);
    // T-3's pull takes no size, so the contract promises no check the floor makes only mid-stream
    expect(Object.keys(NativeFileTransferPullParams.shape)).toEqual([
      "transferId",
      "peer",
      "root",
      "path",
      "digest",
    ]);
    for (const change of [
      { path: `/Users/james/vf/users/1/drive/objects/b0/${DIGEST}` },
      { digest: DIGEST.toUpperCase() },
      { digest: DIGEST.slice(1) },
      { transferId: TRANSFER.toLowerCase() },
      { root: "drive-incoming" },
    ]) {
      expect(
        NativeFileTransferPullParams.safeParse({ ...golden, ...change }).success,
        JSON.stringify(change),
      ).toBe(false);
    }
  });

  it("keeps a pull's unknown fields (tolerant reader)", () => {
    const parsed = NativeFileTransferPullParams.parse({
      ...record("native-file-transfer-pull-params.valid.json"),
      priority: "eager",
    }) as Record<string, unknown>;
    expect(parsed["priority"]).toBe("eager");
  });
});

describe("DR-2a — a pull's outcomes ride one delta method, with a kind", () => {
  it("lands a completed pull as <digest>.<transferId>, beside the SHA-256 truffle checked", () => {
    const done = delta("completed");
    if (done.kind !== "completed") throw new Error(`completed golden parsed as ${done.kind}`);
    expect(done.incoming).toBe(`${done.digest}.${done.transferId}`);
    expect(done.transferId).toBe(TRANSFER);
    expect(delta("progress").kind).toBe("progress");
    expect(snapshot("valid").transfers.map((row) => row.transferId)).toEqual([TRANSFER]);
    // a fresh floor's answer: nothing running
    expect(snapshot("empty").transfers).toEqual([]);
  });

  it("names a landed file, never a path", () => {
    expect(FileTransferLanded.safeParse(`${DIGEST}.${TRANSFER}`).success).toBe(true);
    for (const bad of [
      DIGEST,
      `${DIGEST}.${TRANSFER}/x`,
      `../${DIGEST}.${TRANSFER}`,
      `b0/${DIGEST}.${TRANSFER}`,
      `${DIGEST}.${TRANSFER.toLowerCase()}`,
    ]) {
      expect(FileTransferLanded.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("keeps a failure's reason open on the wire, and the floor's words in one list", () => {
    const failed = delta("failed");
    if (failed.kind !== "failed") throw new Error(`failed golden parsed as ${failed.kind}`);
    expect(failed.reason).toBe(MESH_FILE_TRANSFER.FAILED_REJECTED);
    // a word this reader does not know still parses: it reads as FAILED_IO, never as a torn stream
    const later = { ...record("native-file-transfer-delta.failed.json"), reason: "quarantined" };
    expect(NativeFileTransferDelta.safeParse(later).success).toBe(true);
    const words = Object.entries(MESH_FILE_TRANSFER)
      .filter(([key]) => key.startsWith("FAILED_"))
      .map(([, word]) => word);
    expect(words).toEqual([
      "rejected",
      "unsupported",
      "timeout",
      "integrity",
      "too-large",
      "no-space",
      "io",
      "node-down",
    ]);
  });
});

describe("DR-2a — the file transfer's verbs are local mgmt methods", () => {
  it("refuses a second pull of a live id or a running digest CONFLICT, not retryable, with no details (nit 9)", () => {
    const refusal = ErrorData.parse(fixture("error-data.file-transfer-conflict.json"));
    expect(refusal).toEqual({ kind: "CONFLICT", retryable: false });
    expect(RPC_ERROR_CODES[refusal.kind]).toBe(-32004);
  });

  it("refuses a pull past DRIVE_LIMITS.PULLS_IN_FLIGHT RESOURCE_EXHAUSTED, retryable, with no details (W3-15)", () => {
    const refusal = ErrorData.parse(fixture("error-data.file-transfer-exhausted.json"));
    expect(refusal).toEqual({ kind: "RESOURCE_EXHAUSTED", retryable: true });
    expect(RPC_ERROR_CODES[refusal.kind]).toBe(-32010);
  });

  it("declares roots, pull and subscribe, and leaves offer reserved", () => {
    const verbs = METHODS.filter((m) => m.method.startsWith("native.mesh.fileTransfer."));
    expect(verbs.map((m) => m.method).sort()).toEqual([
      "native.mesh.fileTransfer.pull",
      "native.mesh.fileTransfer.roots",
      "native.mesh.fileTransfer.subscribe",
    ]);
    for (const m of verbs) {
      expect(m.surface, m.method).toBe("mgmt");
      expect(m.locality, m.method).toBe("local");
      expect(m.scope, m.method).toBeNull();
      expect(m.subscription ?? false, m.method).toBe(m.method.endsWith(".subscribe"));
    }
    expect(Object.fromEntries(verbs.map((m) => [m.method, m.idempotent]))).toEqual({
      "native.mesh.fileTransfer.roots": true,
      // a caller-minted id: a second pull under a live one is a collision to refuse
      "native.mesh.fileTransfer.pull": false,
      "native.mesh.fileTransfer.subscribe": true,
    });
  });
});

describe("DR-2a — the drive's document rides a `drive` lane (DR-D7 (a), as v0.3 reads it)", () => {
  // Retitled 2026-11-06 (DR-2a's review nit 11): neither the schema nor the floor holds a `drive` lane to its class
  // or its docId; the golden open is the convention fieldd follows, and this row reads it.
  it("admits `drive` beside the three protocols, and reads its golden open: reliable, with no docId", () => {
    expect(MeshLaneProtocol.options).toEqual(["doc-sync", "presence", "mcp", "drive"]);
    const open = MeshLaneOpenRequest.parse(fixture("mesh-lane-open-request.drive.json"));
    expect(open.protocol).toBe("drive");
    expect(open.class).toBe("reliable");
    expect(open.docId).toBeUndefined();
  });
});

describe("DR-2a — the holders' slice says who holds a drive, never where (EL7)", () => {
  it("parses the golden slice at this tree's protocol", () => {
    const slice = DriveHoldersSlice.parse(fixture("drive-holders-slice.valid.json"));
    expect(slice.protocol).toBe(DRIVE_PROTOCOL);
    expect(slice.state).toBe("ready");
    expect(slice.held).toEqual({ objects: 42, bytes: 8_912_345 });
  });

  it("carries discovery only: no path, and no object a desktop holds (the wave-0 critic)", () => {
    expect(Object.keys(DriveHoldersSlice.shape)).toEqual([
      "deviceId",
      "protocol",
      "state",
      "held",
      "publishedAt",
    ]);
    expect(Object.keys(DriveHoldersSlice.shape.held.shape)).toEqual(["objects", "bytes"]);
  });

  it("says a holder's state in the drive's own words", () => {
    expect(DriveHolderState.options).toEqual([
      "ready",
      DRIVE_SERVICE.STATE_COPYING,
      DRIVE_SERVICE.STATE_OUT_OF_ROOM,
    ]);
    // a desktop with no drive publishes no slice: absence is the capability's answer
    expect(DriveHolderState.safeParse(DRIVE_SERVICE.STATE_UNBUILT).success).toBe(false);
  });

  it("refuses a negative count, a fractional one, a slice that names no desktop and protocol 0", () => {
    const golden = record("drive-holders-slice.valid.json");
    for (const change of [
      { held: { objects: -1, bytes: 0 } },
      { held: { objects: 1.5, bytes: 0 } },
      { deviceId: "" },
      { protocol: 0 },
    ]) {
      expect(
        DriveHoldersSlice.safeParse({ ...golden, ...change }).success,
        JSON.stringify(change),
      ).toBe(false);
    }
  });
});

describe("DR-2a — the drive's refusals say which state it is in (DR-L8)", () => {
  const states = Object.entries(DRIVE_SERVICE)
    .filter(([key]) => key.startsWith("STATE_"))
    .map(([, state]) => state);

  it("reads every DRIVE_SERVICE state as the drive's UNAVAILABLE, and no other service's", () => {
    expect([...DriveUnavailableState.options].sort()).toEqual([...states].sort());
    for (const state of states) {
      const details = { service: DRIVE_SERVICE.SERVICE, state };
      expect(DriveUnavailableDetails.safeParse(details).success, state).toBe(true);
    }
    const elsewhere = { service: "apps", state: DRIVE_SERVICE.STATE_UNBUILT };
    expect(DriveUnavailableDetails.safeParse(elsewhere).success).toBe(false);
    const ready = { service: DRIVE_SERVICE.SERVICE, state: "ready" };
    expect(DriveUnavailableDetails.safeParse(ready).success).toBe(false);
    // a copy under way may say how far it is, as every UNAVAILABLE may
    const copying = {
      service: DRIVE_SERVICE.SERVICE,
      state: DRIVE_SERVICE.STATE_COPYING,
      progress: 0.4,
    };
    expect(DriveUnavailableDetails.safeParse(copying).success).toBe(true);
  });

  it("extends UnavailableDetails, as egress's do: progress 0 to 1, device optional (nit 10)", () => {
    const base = { service: DRIVE_SERVICE.SERVICE, state: DRIVE_SERVICE.STATE_NOT_HELD };
    const ok = (extra: object) => DriveUnavailableDetails.safeParse({ ...base, ...extra }).success;
    expect(ok({ device: "dev-1" })).toBe(true);
    for (const progress of [0, 0.5, 1]) {
      expect(ok({ progress }), `${progress}`).toBe(true);
    }
    for (const progress of [-0.1, 1.1]) {
      expect(ok({ progress }), `${progress}`).toBe(false);
    }
    // the shared fields are UnavailableDetails' own, never a copy
    expect(DriveUnavailableDetails.shape.progress).toBe(UnavailableDetails.shape.progress);
    expect(DriveUnavailableDetails.shape.device).toBe(UnavailableDetails.shape.device);
  });

  it("parses the refusal a desktop without the drive's engine answers", () => {
    const refusal = ErrorData.parse(fixture("error-data.drive-unbuilt.json"));
    expect(refusal).toMatchObject({ kind: "UNAVAILABLE", retryable: false });
    expect(DriveUnavailableDetails.parse(refusal.details).state).toBe(DRIVE_SERVICE.STATE_UNBUILT);
  });

  it("parses the floor's refusal when it cannot pull by a named root", () => {
    const refusal = ErrorData.parse(fixture("error-data.file-transfer-unsupported.json"));
    expect(refusal).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: false,
      details: {
        service: MESH_FILE_TRANSFER.SERVICE,
        state: MESH_FILE_TRANSFER.STATE_UNSUPPORTED,
      },
    });
  });
});
