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
// `NativeBootstrap`, `NativeMarksSet*` and `NativeTerminalStartedForSet*`, `HelloAck.marks` and `HelloAck.startedFor`,
// and from this file `CustodySecret`, which the bundle names beside them as it names artifacts.ts's `Blake3Hex`, and
// the started-for table's four shapes at the foot.
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

// ---- what a terminal was started for (rule 6 · the verb is mgmt.ts's `NativeTerminalStartedForSet*`) ----
//
// A sealed fieldd may not learn what a run is from a file an agent can rewrite, and a run's session record is one: it
// names a spark, a creation request, a typed process. So when fieldd starts or adopts a run it tells the FLOOR, on the
// management channel, what that terminal was started for (`native.terminal.startedFor.set`). The floor keeps it in
// memory beside its marks, for at most `CUSTODY.STARTED_FOR_MAX` terminals, and hands the table to the next fieldd in
// its hello ack (`HelloAck.startedFor`). After a restart fieldd vouches for a run iff the floor's entry for its
// terminal names it. The table dies with the floor. It is never on a terminal's row: terminal.ts's `TerminalInfo` IS
// mgmt.ts's `ObservedTerminal`, so a field there would be a field on the row every window, plugin and peer reads.
//
// These four ride the Rust bundle and live HERE, not in mgmt.ts: the hello ack embeds the entry, and envelope.ts
// cannot import mgmt.ts, which imports it.

/** An id as the table holds one: a terminal session, a run, a spark, a helper root. 1 to 128 characters, and opaque
 * to the floor, which stores one and hands it back and never reads it. Deliberately NOT agent-session.ts's `SparkId`
 * for a spark: the floor outlives fieldd, and a floor that pinned today's pattern would refuse a newer fieldd's set
 * the day the pattern widened. fieldd holds a spark to `SparkId` where it reads one. No named schema exists for a
 * run or a creation request; each is this string too. */
export const TerminalStartedForId = z.string().min(1).max(128);
export type TerminalStartedForId = z.infer<typeof TerminalStartedForId>;

/** The process a TYPED run is: the agent a person started by typing in a shell, which fieldd then adopted. Its pid,
 * and the kernel's start for it in ms since the epoch (compare a start only through mgmt.ts's `sameStartSecond`). A
 * pid of 0 or 1 is refused: the kernel's and launchd's are never a person's process. That bound is NOT in the
 * generated Rust type (typify has an exact type for a minimum of 0 or 1 alone and gives `i64` for any other), so the
 * floor and fieldd's reader of the ack each hold it by hand as well. */
export const TerminalStartedForProcess = z
  .object({
    pid: z.number().int().min(2),
    startedAtMs: z.number().int().nonnegative(),
  })
  .passthrough();
export type TerminalStartedForProcess = z.infer<typeof TerminalStartedForProcess>;

/** What one terminal was started for, as fieldd says it at the launch or the adoption, from the launch call's own
 * arguments and never from a record:
 *  · `run` — the run in it (its `runtimeRunId`);
 *  · `spark` — the spark it was started for; absent for a plain run;
 *  · `process` — a typed run's alone: the process fieldd adopted;
 *  · `root` — the creation request fieldd announced for the launch, which is also the id it names the run's helper
 *    root by (`native.door.roots.set`'s `rootId`), so the next fieldd names that root again from here. */
export const TerminalStartedFor = z
  .object({
    run: TerminalStartedForId,
    spark: TerminalStartedForId.optional(),
    process: TerminalStartedForProcess.optional(),
    root: TerminalStartedForId.optional(),
  })
  .passthrough();
export type TerminalStartedFor = z.infer<typeof TerminalStartedFor>;

/** One row of the table as the hello ack hands it: a `TerminalStartedFor` with its terminal's `sessionId` beside it.
 * SPELLED OUT, never `TerminalStartedFor.extend(...)`, and that is a codegen constraint: zod-to-json-schema writes an
 * extension as `$ref`s into the parent's own properties, which typify cannot follow (mgmt.ts says so at
 * `TerminalRoutesStreamPayload`). A row holds the two spellings to one shape (custody-started-for.test.ts). */
export const TerminalStartedForEntry = z
  .object({
    sessionId: TerminalStartedForId,
    run: TerminalStartedForId,
    spark: TerminalStartedForId.optional(),
    process: TerminalStartedForProcess.optional(),
    root: TerminalStartedForId.optional(),
  })
  .passthrough();
export type TerminalStartedForEntry = z.infer<typeof TerminalStartedForEntry>;
