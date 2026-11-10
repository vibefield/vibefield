import { z } from "zod";

// OB custody (EL7: a same-uid agent is the adversary) — what the SPAWNER hands a daemon, so that nothing secret has to
// sit in a file the same user can read. Two levels, decided by the shell from what the build is and never from what
// the disk holds, so there is nothing on disk to delete that downgrades one:
//   · `files` — today, byte for byte: LAYOUT.SHELL_TOKEN, LAYOUT.PAIRING_FILE and the key files as they are. Dev,
//     tests, smokes, an unsigned or ad-hoc package, not macOS.
//   · `sealed` — the spawner handed custody. Nothing secret is on disk.
// fieldd is `sealed` iff its environment says `CUSTODY.ENV=CUSTODY.STDIN` AND a valid `CustodyHandoff` arrives on its
// stdin. The flag present and the hand-off absent, late (`CUSTODY.HANDOFF_WAIT_MS`), longer than
// `CUSTODY.HANDOFF_MAX_BYTES` or invalid is a refusal to boot: exit non-zero, one log line that names no secret,
// never a fall back to `files`. The floor is `sealed` by the same rule under `CUSTODY.NATIVE_ENV`, and its line is
// mgmt.ts's `NativeBootstrap`. The names, the bounds and the MAC contexts are registries.ts's `CUSTODY`.
//
// Split as the drive is. TS-only: the hand-off, the level and the marks' product stream, whose sides are the shell,
// the supervisor and fieldd; field-native reads none of them. The floor's half rides the Rust bundle: mgmt.ts's
// `NativeBootstrap` and `NativeMarksSet*`, `HelloAck.marks`, and `CustodySecret` below, which the bundle names beside
// them as it names artifacts.ts's `Blake3Hex`.
//
// The shell's pairing (C2) has no shape of its own: under `sealed` a `shell-main` hello carries envelope.ts's
// `PairingMac` in `Hello.credential`, its `nonce` required (`CUSTODY.NONCE_HEX` hex characters), and the ack answers
// `HelloAck.serverMac`. The recipe is pinned by `fixtures/shell-pairing.vector.json`.

/** 32 bytes as 64 lowercase hex characters. */
export const CustodySecret = z.string().regex(/^[0-9a-f]{64}$/);
export type CustodySecret = z.infer<typeof CustodySecret>;

/** The level a daemon runs at. `ProductInfo.custody` says fieldd's; absent there is a daemon from before custody. */
export const CustodyLevel = z.enum(["files", "sealed"]);
export type CustodyLevel = z.infer<typeof CustodyLevel>;

/** One line of JSON on fieldd's stdin, then a newline, then EOF. Never argv, never env, never a file, never a log. */
export const CustodyHandoff = z
  .object({
    v: z.literal(1),
    /** the shell's pairing secret for this user root: the key under a `shell-main` hello's MAC and its ack's */
    shell: CustodySecret,
    /** the floor's pairing secret for this user root (the D8 handshake's, unchanged) */
    pairing: CustodySecret,
    /** the record key the sealed stores sign with */
    records: CustodySecret,
    /** the marks the spawner remembers (`CustodyMarksFrame`, as it last heard them): a store below its mark is
     * stale. Absent when it remembers none. */
    expect: z.record(z.string(), z.number().int().nonnegative()).optional(),
  })
  .passthrough();
export type CustodyHandoff = z.infer<typeof CustodyHandoff>;

/** `system.custody.marks.subscribe` (methods.ts) — fieldd's view of every mark, WHOLE at the open and whole again at
 * every rise: a name (`CUSTODY.MARK_NAME`) and a number that only rises. fieldd's view of one at boot is the highest
 * of the hand-off's `expect`, the floor's `HelloAck.marks` and 0. The shell keeps the highest it heard per name and
 * hands it to the next fieldd it spawns, so a mark outlives fieldd by two survivors: the floor's memory and the
 * shell's. Empty (`marks: {}`) when fieldd holds none. */
export const CustodyMarksFrame = z
  .object({ marks: z.record(z.string(), z.number().int().nonnegative()) })
  .passthrough();
export type CustodyMarksFrame = z.infer<typeof CustodyMarksFrame>;
