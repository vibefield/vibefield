import { CUSTODY, CustodyHandoff } from "@vibefield/contracts";

// OB custody (C2; contracts custody.ts) — how a fieldd is handed custody, and what it holds of it.
//
// Two levels. `files` is a fieldd handed nothing: its secrets are the files they have always been. `sealed` is a
// fieldd whose SPAWNER handed it its secrets, so that none sits in a file the same user can read (EL7): its
// environment says `FIELDD_CUSTODY=stdin` (a flag, not a secret) and one line of JSON, a `CustodyHandoff`, arrives
// on its stdin, then a newline, then EOF. Never argv, never env, never a file, never a log.
//
// The flag set and no valid line is a REFUSAL TO BOOT: the line absent, late, too long or not a hand-off ends the
// process non-zero with one line that names no secret. It is never a fall back to `files`, because then deleting or
// starving the hand-off would be how a sealed build is downgraded. The same holds for a flag that says anything but
// `stdin`: a spawner asking for a custody this build does not have is not asking for the files.
//
// Only the daemon reads its stdin (`bin.ts` `main`). The roles the same executable runs (the files worker, the
// transcript worker, a flow host, the agents' launcher) are handed nothing and never read it, though they are born
// with the same environment.
//
// This module imports the contracts alone: `bin.ts` loads it before the daemon's module graph, and a refusal should
// cost no more than that.

/** What a sealed fieldd holds of its hand-off: `FielddConfig.custody` (daemon.ts). `bin.ts` fills it from the
 * pipe; a test fills it by hand, to boot a sealed daemon in its own process. Its absence is `files`. */
export interface FielddCustody {
  /** the level this is: a fieldd handed custody is `sealed`, and `files` is being handed nothing */
  level: "sealed";
  /** the shell's pairing secret for this user root: the key under a `shell-main` hello's MAC (shell-pairing.ts) */
  shell: string;
  /** the floor's pairing secret for this user root (the D8 handshake's, pairing.ts) */
  pairing: string;
  /** the record key the sealed stores sign with */
  records: string;
  /** the marks the spawner remembers (contracts `CustodyMarksFrame`): a store below its mark is stale */
  expect?: Record<string, number>;
}

/** Why a boot was refused its custody. */
export type CustodyHandoffRefusal = "absent" | "late" | "too-long" | "invalid" | "unknown";

/** What each refusal says after the variable's name. */
const REFUSALS: Record<CustodyHandoffRefusal, string> = {
  absent: "asked for a custody hand-off, and its stdin closed before a line came",
  late: "asked for a custody hand-off, and no line came on its stdin in time",
  "too-long": "asked for a custody hand-off, and the line on its stdin is longer than one may be",
  invalid: "asked for a custody hand-off, and the line on its stdin is not one",
  unknown: "names a custody this build does not have",
};

/** A boot refused its custody. Its message is the one line a log may keep: which variable asked and what was
 * missing, never the line that came, never a field of it, never what the variable was set to. It carries no cause
 * for the same reason (a parser's own error may quote what it read). */
export class CustodyHandoffError extends Error {
  constructor(readonly reason: CustodyHandoffRefusal) {
    super(`${CUSTODY.ENV} ${REFUSALS[reason]}; nothing was started`);
    this.name = "CustodyHandoffError";
  }
}

/** Does this environment say a hand-off is coming? Unset or blank is no: `files`. `CUSTODY.STDIN` is yes. Any
 * other word is refused (`unknown`), never read as `files`. */
export function custodyAsked(env: Readonly<Record<string, string | undefined>>): boolean {
  const flag = env[CUSTODY.ENV];
  if (flag === undefined || flag === "") return false;
  if (flag === CUSTODY.STDIN) return true;
  throw new CustodyHandoffError("unknown");
}

export interface ReadCustodyHandoffOptions {
  /** Test seam; production reads `CUSTODY.HANDOFF_MAX_BYTES`, the line's newline included. */
  maxBytes?: number;
  /** Test seam; production waits `CUSTODY.HANDOFF_WAIT_MS` from the call. */
  waitMs?: number;
}

/** Read the one hand-off line from `stdin`: to the first newline and no further. Resolves with the hand-off, or
 * rejects with a `CustodyHandoffError`. Either way it lets go of the stream (its listeners off, the stream paused):
 * whatever follows the line is nobody's, and is neither read nor waited for. */
export function readCustodyHandoff(
  stdin: NodeJS.ReadableStream,
  options: ReadCustodyHandoffOptions = {},
): Promise<CustodyHandoff> {
  const maxBytes = options.maxBytes ?? CUSTODY.HANDOFF_MAX_BYTES;
  const waitMs = options.waitMs ?? CUSTODY.HANDOFF_WAIT_MS;
  return new Promise((resolve, reject) => {
    const pieces: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const settle = (outcome: CustodyHandoff | CustodyHandoffRefusal): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      stdin.off("error", onEnd);
      stdin.pause();
      pieces.length = 0;
      if (typeof outcome === "string") reject(new CustodyHandoffError(outcome));
      else resolve(outcome);
    };
    const onData = (chunk: Buffer | string): void => {
      const piece = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      const newline = piece.indexOf(0x0a);
      const taken = newline === -1 ? piece.length : newline + 1;
      if (bytes + taken > maxBytes) {
        settle("too-long");
        return;
      }
      pieces.push(piece.subarray(0, taken));
      bytes += taken;
      if (newline !== -1) settle(parseHandoff(Buffer.concat(pieces, bytes).toString("utf8")));
    };
    // a stream that ends or fails before its newline handed nothing
    const onEnd = (): void => settle("absent");
    const timer = setTimeout(() => settle("late"), waitMs);
    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.on("error", onEnd);
  });
}

/** One line as a hand-off, or the refusal: nothing of the line or of a parser's complaint about it goes further. */
function parseHandoff(text: string): CustodyHandoff | CustodyHandoffRefusal {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return "invalid";
  }
  const parsed = CustodyHandoff.safeParse(value);
  return parsed.success ? parsed.data : "invalid";
}

/** A read hand-off as fieldd holds it. */
export function custodyOf(handoff: CustodyHandoff): FielddCustody {
  return {
    level: "sealed",
    shell: handoff.shell,
    pairing: handoff.pairing,
    records: handoff.records,
    ...(handoff.expect !== undefined ? { expect: { ...handoff.expect } } : {}),
  };
}
