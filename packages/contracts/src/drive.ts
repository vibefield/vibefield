import { z } from "zod";
import { UnavailableDetails } from "./errors";
import { DRIVE_SERVICE, MESH_CONTROL_LIMITS } from "./registries";

// ── DR-2a — the drive's own shapes (`draft/thinking-drive.md` v0.3: DR-D4 (a), DR-D5 (a), DR-D7 (a), DR-L8; the wave-0
// plan's DR-2/DR-3 map and its critic's VF-DRC line) ──
//
// The drive is the account's (DR-L1). Its document (names, digests, intents) is mille-drive's, kept in the files worker
// (DR-D10 (a)), and its objects are files named by their blake3 under LAYOUT.DRIVE_DIR (DR-L2). Three seams carry it
// between desktops, and each has its own contract:
//  - the document's frames ride a `drive` meshdata lane (mgmt.ts `MeshLaneProtocol`), opaque: fieldd relays them and
//    reads none;
//  - an object rides the floor's file transfer by a named root (mgmt.ts `NativeFileTransfer*`, FILE_TRANSFER_ROOTS);
//  - who holds a drive is this file's `DriveHoldersSlice`, one slice per desktop in STORES.DRIVE.
// Every refusal names `DriveUnavailableDetails` (DR-L8).
//
// TS-only (gen-jsonschema.ts's header): the floor carries the slice as opaque store JSON under its byte cap
// (MESH_CONTROL_LIMITS.DRIVE_SLICE_BYTES) and reads none of it.

/** The drive protocol this tree speaks (`DriveHoldersSlice.protocol`). A desktop dials a `drive` lane only to a peer
 * whose slice names a protocol it speaks; it moves with the frames mille-drive sends. */
export const DRIVE_PROTOCOL = 1;

/** A holder's state, as its slice says it: `ready`, or one of the two DRIVE_SERVICE states another desktop acts on (a
 * desktop still copying is a poor first holder to ask, and one out of room takes nothing more). A desktop whose drive
 * is not open publishes no slice at all, so the other states never appear here. */
export const DriveHolderState = z.enum([
  "ready",
  DRIVE_SERVICE.STATE_COPYING,
  DRIVE_SERVICE.STATE_OUT_OF_ROOM,
]);
export type DriveHolderState = z.infer<typeof DriveHolderState>;

/** `field.drive.v1` — DEVICE-OWNED (DS-L2): one slice per desktop whose drive is open, written by that desktop under
 * its mesh deviceId (D30), and gone with its publisher. DISCOVERY only (the wave-0 critic): the capability by
 * publication, the protocol, the state and the counts a person reads. Which object a desktop holds rides the drive's
 * own lane (mille-drive's have and want), never this slice, and no path rides it at all: a pull names a root and a path
 * relative to it (EL7). The disk budget joins once it is measured (DRIVE_LIMITS). */
export const DriveHoldersSlice = z
  .object({
    deviceId: z.string().min(1).max(MESH_CONTROL_LIMITS.OWNER_CHARS),
    protocol: z.number().int().positive(),
    state: DriveHolderState,
    held: z
      .object({
        /** the objects this desktop holds */
        objects: z.number().int().nonnegative(),
        /** their bytes together */
        bytes: z.number().int().nonnegative(),
      })
      .passthrough(),
    publishedAt: z.number().int(),
  })
  .passthrough();
export type DriveHoldersSlice = z.infer<typeof DriveHoldersSlice>;

/** Every DRIVE_SERVICE state a refusal names. */
export const DriveUnavailableState = z.enum([
  DRIVE_SERVICE.STATE_UNBUILT,
  DRIVE_SERVICE.STATE_STARTING,
  DRIVE_SERVICE.STATE_NOT_LINKED,
  DRIVE_SERVICE.STATE_MESH_DOWN,
  DRIVE_SERVICE.STATE_COPYING,
  DRIVE_SERVICE.STATE_NOT_HELD,
  DRIVE_SERVICE.STATE_OUT_OF_ROOM,
]);
export type DriveUnavailableState = z.infer<typeof DriveUnavailableState>;

/** Every UNAVAILABLE the drive answers (DR-L8): `UnavailableDetails` extended, as `MeshEgressUnavailableDetails` is.
 * The service and the state narrow to the drive's; `progress` (how far a copy has come, 0 to 1) and `device` (when the
 * refusal is about another desktop: an object only it holds) stay UnavailableDetails' own (DR-2a's review nit 10). */
export const DriveUnavailableDetails = UnavailableDetails.extend({
  service: z.literal(DRIVE_SERVICE.SERVICE),
  state: DriveUnavailableState,
}).passthrough();
export type DriveUnavailableDetails = z.infer<typeof DriveUnavailableDetails>;
