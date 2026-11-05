// CP-4a2a (CP-D8; 4A2-Q1 (a), 4A2-Q5 (a), ruled by VF-PM 2026-11-05 08:51Z) — fieldd ⇄ a run's flow host, on the
// child's IPC pipe (Node's `process.send`, JSON serialization). The pipe carries bounded control and nothing else (EL2
// as CP4-S10 reads it): the script once, at most FLOW_LIMITS.SCRIPT_MAX_BYTES, and each call and each answer at most
// FLOW_LIMITS.RESULT_MAX_BYTES as JSON. No key, no MAC, no token and no path rides it: the journal is fieldd's alone
// (flows/journal.ts), and the host never sees a line of it.
//
// IMPORT-FREE, as transcripts/protocol.ts is: the host's child imports this file and, by wall R32's host clause,
// nothing of fieldd's but it, so the child's bundle holds `ses` and its own files alone. The numbers the child needs
// arrive in `run`, read by fieldd from FLOW_LIMITS.
//
// fieldd → host:
// - `run {script, input, limits}` once, after READY: the approved bytes rewritten into one script (module-script.ts),
//   the run's input, and the bounds the child holds a call and a log line to;
// - `answer {id, ok, value | refused}`: a call's answer, the script's `await` resolving or throwing;
// - `ping {n}`: answered at once by `pong {n, heap}`, `heap` the child's V8 heap in use (bytes; 4A2-Q7 (a): the cap is
//   measured, not enforced by V8); a host that misses FLOW_LIMITS.HOST_PING_MISSES in a row is ended;
// - `shutdown`.
// host → fieldd: `ready {pid}` once, after lockdown; `call {id, what, args}`; `log {text}`; `pong {n, heap}`; then one of
// `done {value?, cut?}` (the default export returned), `threw {message}` (it threw, or the script would not
// evaluate) or `fatal {reason}` (the host cannot run a script: lockdown failed, a second `run`).

/** The bounds the child holds the script's own calls to, before anything is sent. */
export interface FlowHostLimits {
  /** a call's `args` as JSON, UTF-8 bytes (FLOW_LIMITS.RESULT_MAX_BYTES) */
  readonly callMaxBytes: number;
  /** a `log(…)` line, characters (FLOW_LOG_MAX); longer is cut with "…" */
  readonly logMaxChars: number;
}

export type ToFlowHost =
  | {
      t: "run";
      script: string;
      input: Readonly<Record<string, string>>;
      limits: FlowHostLimits;
    }
  | { t: "answer"; id: number; ok: true; value: unknown }
  | { t: "answer"; id: number; ok: false; refused: string }
  | { t: "ping"; n: number }
  | { t: "shutdown" };

export type FromFlowHost =
  | { t: "ready"; pid: number }
  | { t: "call"; id: number; what: string; args: unknown[] }
  | { t: "log"; text: string }
  | { t: "pong"; n: number; heap?: number }
  | { t: "done"; value?: unknown; cut?: true }
  | { t: "threw"; message: string }
  | { t: "fatal"; reason: string };

/** Whether a value nests at most `max` arrays and objects deep (a scalar is 0, `[x]` is 1), read without recursion,
 * so a value 64 KiB of JSON nests 32,000 deep is refused before anything recursive (canonical JSON, a key) reads it.
 * The child holds a call's arguments to FLOW_LIMITS.ARGS_DEPTH_MAX before it sends, and fieldd again before it keys,
 * journals or hands a call on (bth's review P1/P3, ruled 2026-11-05 11:46Z). */
export function nestsWithin(value: unknown, max: number): boolean {
  const stack: [unknown, number][] = [[value, 0]];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const [item, depth] = next;
    if (typeof item !== "object" || item === null) continue;
    if (depth >= max) return false;
    for (const child of Array.isArray(item) ? item : Object.values(item))
      stack.push([child, depth + 1]);
  }
  return true;
}

/** The words a child's text is cut to before fieldd keeps it (a `threw`'s message, a `fatal`'s reason). */
export const FLOW_HOST_TEXT_MAX = 1_024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const text = (value: unknown): string => String(value ?? "").slice(0, FLOW_HOST_TEXT_MAX);

/** A host message fieldd reads, or null: a child of fieldd's own still runs a person's script, so every message is
 * read as untrusted bytes. */
export function readFromFlowHost(raw: unknown): FromFlowHost | null {
  if (!isRecord(raw)) return null;
  switch (raw["t"]) {
    case "ready":
      return isCount(raw["pid"]) ? { t: "ready", pid: raw["pid"] } : null;
    case "call":
      return isCount(raw["id"]) && typeof raw["what"] === "string" && Array.isArray(raw["args"])
        ? { t: "call", id: raw["id"], what: raw["what"].slice(0, 32), args: raw["args"] }
        : null;
    case "log":
      return typeof raw["text"] === "string" ? { t: "log", text: raw["text"] } : null;
    case "pong":
      if (!isCount(raw["n"])) return null;
      return isCount(raw["heap"])
        ? { t: "pong", n: raw["n"], heap: raw["heap"] }
        : { t: "pong", n: raw["n"] };
    case "done":
      return {
        t: "done",
        ...("value" in raw ? { value: raw["value"] } : {}),
        ...(raw["cut"] === true ? { cut: true as const } : {}),
      };
    case "threw":
      return { t: "threw", message: text(raw["message"]) };
    case "fatal":
      return { t: "fatal", reason: text(raw["reason"]) };
    default:
      return null;
  }
}
