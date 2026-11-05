import { z } from "zod";
import { SparkId } from "./agent-session";
import { ComposeSayChip, ComposeSayRequestId, composeChipsFit } from "./compose";
import { SPARK_TRANSCRIPT } from "./registries";
import { WorkspaceCredential, WorkspaceLoopbackSocket } from "./workspace";

// ── TH-1: THE SPARK'S TRANSCRIPT (TH0-Q1 = O1, VF-PM 2026-11-04 05:01Z; DESIGN.md §8 "Chat's thread"). VibeField keeps
// a spark's conversation as its own record: fieldd writes it from the agent runtime's provider-neutral events (a reply,
// a turn's edges, a tool asked for by its kind) and from VibeField's own facts (your words with their chips, their
// receipt, a wake, an answer, a notify), one JSONL file per run, in app data under the spark's custody, never the
// vendor's file and never History's (AR-L1). Each line is MAC'd by fieldd's one record signer (`signed-record.ts`:
// HMAC-SHA256, hex, over the canonical JSON of `{spark, run, line}` with the line's own `mac` left out), so the spark,
// the run and the line's place are inside it; the serving worker verifies each line and never serves one that fails.
// The window reads it over a ticketed loopback socket (EL2), never over fieldd's RPC.
//
// TOLERANT: every line parses as its head (`SparkTranscriptLine`, its kind OPEN), and a reader takes the known kinds
// through `sparkTranscriptLineOf`; a kind, or a body, this build does not know is logged and skipped. TS-only: fieldd,
// its worker and the window read it; field-native never does. ──

/** The line format this build writes. A reader skips a line of a format it does not know. */
export const SPARK_TRANSCRIPT_FORMAT = 1;

/** A line's place in its run's file: 1, 2, 3… with no gap. */
export const SparkTranscriptSeq = z.number().int().min(1);

/** The record signer's signature: HMAC-SHA256, hex. */
export const SparkTranscriptMac = z.string().regex(/^[0-9a-f]{64}$/);

/** A run's id, as the fold names it. */
const RunId = z.string().min(1).max(128);

/** Every line's head. `kind` is OPEN: SPARK_TRANSCRIPT_KINDS. */
export const SparkTranscriptLine = z
  .object({
    v: z.number().int().min(1),
    seq: SparkTranscriptSeq,
    mac: SparkTranscriptMac,
    kind: z.string().min(1).max(32),
    /** when it happened (ISO) */
    at: z.string().min(1),
  })
  .passthrough();
export type SparkTranscriptLine = z.infer<typeof SparkTranscriptLine>;

export const SPARK_TRANSCRIPT_KINDS = [
  "run",
  "you",
  "outcome",
  "reply",
  "tool",
  "act",
  "turn",
  "gap",
] as const;
export type SparkTranscriptKind = (typeof SPARK_TRANSCRIPT_KINDS)[number];

/** A run of the spark entered the record: the file's first line. `fresh` when it began a conversation (a hatch, or a
 * wake that could not resume and started again); a resume continues the conversation before it. */
export const SparkTranscriptRunLine = SparkTranscriptLine.extend({
  kind: z.literal("run"),
  runtimeRunId: RunId,
  fresh: z.boolean(),
});

/** Your words. `via: "chat"` — a say (`compose.sparks.say`), from any screen, with its queued input's id, its request
 * id and the receipt it was queued with (`state`, COMPOSE_SAY_STATES, OPEN: queued | waking). `via: "terminal"` —
 * a prompt typed into the spark's terminal, which no input of fieldd's delivered: no input, no receipt. `via` is
 * OPEN. `chips` stand inside `text` (`composeChipsFit`), read as a say carried them. */
export const SparkTranscriptYouLine = SparkTranscriptLine.extend({
  kind: z.literal("you"),
  via: z.string().min(1).max(32),
  text: z.string().min(1),
  input: z.string().min(1).max(64).optional(),
  requestId: ComposeSayRequestId.optional(),
  state: z.string().min(1).max(32).optional(),
  chips: z.array(ComposeSayChip).optional(),
});

/** What became of your words (`of`: the `you` line's `input`), as the input queue told fieldd: COMPOSE_SAY_STATES,
 * OPEN — `waiting` (turned away, it waits for the next idle), `delivered`, `uncertain` (never resent), `dropped` (its
 * session ended first). `reason` is fieldd's own word for why. The latest for an input stands. */
export const SparkTranscriptOutcomeLine = SparkTranscriptLine.extend({
  kind: z.literal("outcome"),
  of: z.string().min(1).max(64),
  state: z.string().min(1).max(32),
  reason: z.string().min(1).max(500).optional(),
});

/** One of the agent's messages, whole (`conversation:assistant-message`, neither display-only nor unfinished). A later
 * line with the same `messageId` replaces it where it stands. */
export const SparkTranscriptReplyLine = SparkTranscriptLine.extend({
  kind: z.literal("reply"),
  messageId: z.string().min(1).max(256),
  turn: z.string().min(1).max(256).optional(),
  text: z.string().min(1),
});

/** A tool the agent asked for (`tool:requested`): its provider-neutral kind (`presentation.kind`, OPEN: command |
 * web-search | file-read | file-edit | browser | mcp | other) and what it touched (`presentation.detail`). Never the
 * tool's own name, nor `presentation.title`, which carries it for mcp and other (AR-L1). `ours`: fieldd served the
 * call (VibeField's own tool), so its own line says what it did. */
export const SparkTranscriptToolLine = SparkTranscriptLine.extend({
  kind: z.literal("tool"),
  toolCallId: z.string().min(1).max(256),
  turn: z.string().min(1).max(256).optional(),
  toolKind: z.string().min(1).max(32),
  detail: z.string().min(1).max(2_000).optional(),
  ours: z.literal(true).optional(),
});

/** VibeField's own act, typed, never words read for a prefix (TH-Q12 (a)). `what` is OPEN: `wake` (a wake that told
 * the spark something: `text` the facts it told), `answer` (an answer you gave: `text` your choice's words), `notify`
 * (the spark told you: `text` its words), `crew` (SP-1e2's). */
export const SparkTranscriptActLine = SparkTranscriptLine.extend({
  kind: z.literal("act"),
  what: z.string().min(1).max(32),
  text: z.string().min(1),
});

/** A turn's edge (`turn:started`, `turn:completed`, `turn:failed`): `edge` OPEN, start | end | failed. */
export const SparkTranscriptTurnLine = SparkTranscriptLine.extend({
  kind: z.literal("turn"),
  edge: z.string().min(1).max(32),
  turn: z.string().min(1).max(256).optional(),
});

/** fieldd was not listening from `since` (a restart while the run moved), written only on evidence that it moved. */
export const SparkTranscriptGapLine = SparkTranscriptLine.extend({
  kind: z.literal("gap"),
  since: z.string().min(1),
});

export const SparkTranscriptKnownLine = z.discriminatedUnion("kind", [
  SparkTranscriptRunLine,
  SparkTranscriptYouLine,
  SparkTranscriptOutcomeLine,
  SparkTranscriptReplyLine,
  SparkTranscriptToolLine,
  SparkTranscriptActLine,
  SparkTranscriptTurnLine,
  SparkTranscriptGapLine,
]);
export type SparkTranscriptKnownLine = z.infer<typeof SparkTranscriptKnownLine>;

/** A line as one of this build's kinds, else undefined: a format or a kind it does not know, a body that does not
 * parse, or chips that do not stand inside the words they mark. */
export function sparkTranscriptLineOf(line: unknown): SparkTranscriptKnownLine | undefined {
  const parsed = SparkTranscriptKnownLine.safeParse(line);
  if (!parsed.success || parsed.data.v !== SPARK_TRANSCRIPT_FORMAT) return undefined;
  const known = parsed.data;
  if (
    known.kind === "you" &&
    known.chips !== undefined &&
    !composeChipsFit(known.text, known.chips)
  )
    return undefined;
  return known;
}

// ── the ticket: `compose.sparks.transcript.openTicket` (TH-Q30 (a′); local, a renderer window of this desktop alone,
// under the family's `sparks.use`) ──

/** One run of the spark, as its record names it, oldest first. */
export const SparkTranscriptRun = z
  .object({
    runtimeRunId: RunId,
    /** its `run` line's time (ISO) */
    startedAt: z.string().min(1),
    /** it began a conversation */
    fresh: z.boolean(),
  })
  .passthrough();
export type SparkTranscriptRun = z.infer<typeof SparkTranscriptRun>;

export const SparkTranscriptOpenTicketParams = z.object({ spark: SparkId }).passthrough();
export type SparkTranscriptOpenTicketParams = z.infer<typeof SparkTranscriptOpenTicketParams>;

/** A fresh, single-use credential for the spark's record on the transcript worker's loopback listener (the files
 * worker's shape, `WorkspaceCredential`): every answer is a new one, so the door is not idempotent. `expiresAt` bounds
 * its redemption alone. `generation` is the worker's: a worker restart closes every socket, and the window asks
 * again. `runs` are the spark's, oldest first, the newest SPARK_TRANSCRIPT.RUNS_MAX of them. */
export const SparkTranscriptOpenTicketResult = z
  .object({
    spark: SparkId,
    endpoint: WorkspaceLoopbackSocket,
    ticket: WorkspaceCredential,
    expiresAt: z.number().int().positive(),
    generation: z.number().int().positive(),
    runs: z.array(SparkTranscriptRun).max(SPARK_TRANSCRIPT.RUNS_MAX),
  })
  .passthrough();
export type SparkTranscriptOpenTicketResult = z.infer<typeof SparkTranscriptOpenTicketResult>;

// ── the wire, window ⇄ worker: one JSON text frame per message ──

/** The window's one message: the ticket, and the runs it reads, oldest first, each after the last line it holds. */
export const SparkTranscriptOpen = z
  .object({
    type: z.literal("open"),
    ticket: WorkspaceCredential,
    runs: z
      .array(z.object({ run: RunId, after: z.number().int().min(0).optional() }).passthrough())
      .min(1)
      .max(SPARK_TRANSCRIPT.RUNS_MAX),
  })
  .passthrough();
export type SparkTranscriptOpen = z.infer<typeof SparkTranscriptOpen>;

/** The ticket redeemed: lines follow. */
export const SparkTranscriptReady = z
  .object({ type: z.literal("ready"), generation: z.number().int().positive() })
  .passthrough();

/** One verified line of `run`, in order within its run. */
export const SparkTranscriptLineFrame = z
  .object({ type: z.literal("line"), run: RunId, line: SparkTranscriptLine })
  .passthrough();

/** Every line the open named is served; the tail follows. `dropped` counts the lines that failed their check and were
 * never served. */
export const SparkTranscriptCaughtUp = z
  .object({ type: z.literal("caught-up"), dropped: z.number().int().min(0) })
  .passthrough();

/** A run of the spark began after the open (a wake): its lines follow, as the named runs' do. */
export const SparkTranscriptRunFrame = z
  .object({ type: z.literal("run"), run: SparkTranscriptRun })
  .passthrough();

/** The open is refused, then the socket closes: `reason` is the worker's word, OPEN (`ticket-unknown`,
 * `ticket-used`, `ticket-expired`, `origin`, `run-unknown`, `malformed`). */
export const SparkTranscriptRefused = z
  .object({ type: z.literal("refused"), reason: z.string().min(1).max(64) })
  .passthrough();

export const SparkTranscriptServerFrame = z.discriminatedUnion("type", [
  SparkTranscriptReady,
  SparkTranscriptLineFrame,
  SparkTranscriptCaughtUp,
  SparkTranscriptRunFrame,
  SparkTranscriptRefused,
]);
export type SparkTranscriptServerFrame = z.infer<typeof SparkTranscriptServerFrame>;
