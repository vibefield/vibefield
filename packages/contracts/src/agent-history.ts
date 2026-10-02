import { z } from "zod";

// TL (2026-10-02, "Where the Time Went", TL-D8) — the status ledger: what each
// run was doing over time, kept by fieldd's fold because the fold already sees
// every change (`applyMonitor`), keeps running while Godview is closed, and has
// a per-run record to sit beside. Core keeps only the current status and when
// it began; without this record Godview's timeline can draw an agent's birth
// and its current state, and nothing between (TL-D9).
//
// A request, not a field on the fold row: the full projection is a whole
// board every 16 ms tick, and a day of changes per row would ride every frame.
// The renderer asks once when Godview opens and again for a run it has not
// asked about, and carries the rest forward from the frames it already reads.
//
// What a change records is content-free by the fold's standard: a status, the
// moment, a blocker's kind and its words, and a working span's last activity
// line — the same two texts the desk row already carries (`AGENT_FIELD`'s
// DESK_TEXT_CHARS), bounded here by `AGENT_HISTORY.TEXT_CHARS`.
//
// TS-only in the generation pipeline (design-01 §7), like the rest of the
// agent plane: field-native reads none of it.

/** One change of a run's status: from `at` on, the run was `status`. `status`
 * is an OPEN string (today `AgentStatus`: idle | working | blocked | unknown);
 * a reader treats a value it does not know as unrecorded. */
export const AgentHistoryChange = z
  .object({
    status: z.string(),
    at: z.string(),
    /** On a `blocked` change: what it waited on (Core's blocker kind) and its words. */
    blocker: z.object({ kind: z.string(), detail: z.string().optional() }).passthrough().optional(),
    /** On a `working` change: the last activity line of the span it starts —
     * the latest so far while that span is still open. */
    did: z.string().optional(),
  })
  .passthrough();
export type AgentHistoryChange = z.infer<typeof AgentHistoryChange>;

/** One run's record. Before `recordedFrom` its past was not recorded (the run
 * began before fieldd watched it, or the horizon trimmed it); a reader draws
 * that stretch as unrecorded, never as a guess. Changes are oldest first. */
export const AgentRunHistory = z
  .object({
    runtimeRunId: z.string().min(1),
    recordedFrom: z.string(),
    changes: z.array(AgentHistoryChange),
    /** Set once the run exited; its last change then ends here. */
    exitedAt: z.string().optional(),
  })
  .passthrough();
export type AgentRunHistory = z.infer<typeof AgentRunHistory>;

/** Absent `runtimeRunIds`: every run with a record inside the horizon. */
export const AgentHistoryParams = z
  .object({ runtimeRunIds: z.array(z.string().min(1)).max(512).optional() })
  .passthrough();
export type AgentHistoryParams = z.infer<typeof AgentHistoryParams>;

export const AgentHistoryResult = z
  .object({
    horizonMs: z.number().int().positive(),
    runs: z.array(AgentRunHistory),
  })
  .passthrough();
export type AgentHistoryResult = z.infer<typeof AgentHistoryResult>;
