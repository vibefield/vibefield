import { folderName, type PaneFrameAgent } from "@vibecook/puppeteer-views";
import { type AgentVisualStatus, projectPath } from "./agent-status";
import type { AgentMonitorMirror, AgentSessionSummary, AgentStatus } from "./facet-types";

/**
 * THE FRAME'S FACTS (GT-6) — the fold's row, projected into what the package's
 * pane frame reads (design-system record §07, upstream since PU-14).
 *
 * The frame is `@vibecook/puppeteer-views`' and knows no host: it takes a
 * `PaneFrameAgent` in the host's own words and dials nothing (the AR-5 rule).
 * This module is that seam on VibeField's side — pure, so the projection's
 * rules are testable without a pane, a GPU or a daemon, exactly as
 * `pane-faces.ts` is.
 *
 * Three rules are worth stating because each is a decision:
 *
 *   · A row with NO monitor mirror yields NO agent facts. A run before its
 *     first monitor state has said nothing about itself, and the honest frame
 *     for it is the bare badge — the folder and nothing else — which is what
 *     the reference draws before a provider speaks. Inventing `idle · claude`
 *     for a starting run would be the vacuous row DESIGN.md's sync law forbids.
 *   · `alive` is carried STRAIGHT through, and a not-alive run is kept. The
 *     monitor's own classifier DROPS those rows (an exited agent is not a
 *     bubble); the deck must not, because the frame's answer to an ended run is
 *     precisely its RESUME verb. Same fold, two honest readings — which is the
 *     reason the fold is lifted above both (AR-6 §4.1).
 *
 *     KNOWN GAP, upstream of this file (found at GT-6, read out of fieldd
 *     rather than out of a doc): the fold carries MANAGED and PENDING runs only
 *     (`fieldd/src/agent-runtime.ts:720` — `list()` folds `this.managed` and
 *     `this.pending`), and a run whose process ends is REMOVED from `managed`
 *     (`closeRun`, :2029) with only its record left for a later `agent.resume`.
 *     So a pane left showing a dead PTY usually has no row at all and wears the
 *     bare badge: the resume verb is reachable while the mirror already says
 *     `alive: false` and fieldd has not withdrawn the row yet, and not after.
 *     Closing that is fieldd's to do — the fold carrying exited-but-resumable
 *     records as rows of their own — and this seam is ready for them.
 *   · Nothing here reads terminal text, and nothing enumerates a vendor: the
 *     mark is puppeteer's open provider id (AR-L1).
 */

/** The fold's four words onto the frame's three. `unknown` — a mirror that
 * could not be read, or a row fieldd has not derived a status for yet — is
 * IDLE here rather than the monitor's "working · starting": the only thing the
 * frame does with `working` is start the stop verb's turn clock from
 * `statusSince`, and a clock started on an unknown state counts nothing. */
export function paneFrameStatus(status: AgentStatus): AgentVisualStatus {
  switch (status) {
    case "blocked":
      return "blocked";
    case "working":
      return "working";
    default:
      return "idle";
  }
}

/**
 * The effort, read TOLERANTLY off the mirror's passthrough: `effort` is one of
 * the fields fieldd carries verbatim rather than names (`AgentMonitorMirror`),
 * so it arrives as an unknown and is read as one. `configured` says the value
 * is the launch INTENT rather than evidence the provider reported — the frame
 * italicises it, which is the whole reason the flag crosses the seam.
 */
function readEffort(
  monitor: AgentMonitorMirror,
): { value: string; configured: boolean } | undefined {
  const raw = (monitor as { effort?: unknown }).effort;
  if (typeof raw !== "object" || raw === null) return undefined;
  const { value, intent } = raw as { value?: unknown; intent?: unknown };
  if (typeof value !== "string" || value === "") return undefined;
  return { value, configured: intent === "configured" };
}

/**
 * The context share, when the provider could actually say. Core marks its own
 * uncertainty in `percentageSource` — `provider` measured it, `derived` inferred
 * it, `unavailable` means nobody knows — and a meter drawn from an unavailable
 * source would be a number invented at the seam. Read off the passthrough for
 * the same reason as the effort.
 */
function readContextPercent(monitor: AgentMonitorMirror): number | undefined {
  const context = monitor.context;
  if (context === undefined) return undefined;
  if ((context as { percentageSource?: unknown }).percentageSource === "unavailable") {
    return undefined;
  }
  const percent = context.usedPercent;
  return typeof percent === "number" && Number.isFinite(percent) ? percent : undefined;
}

/** One managed row's facts, or `undefined` while the run has said nothing. */
export function paneFrameAgentFacts(row: AgentSessionSummary): PaneFrameAgent | undefined {
  const monitor = row.monitor;
  if (monitor === undefined) return undefined;
  // The same chain the monitor's rows are named by (`projectLabel`), so a pane
  // and its bubble say the same word about the same agent. The fallback is
  // deliberately NOT applied here: with no directory at all the frame's own
  // chain takes over (the session's cwd, then `terminal`), and a provider label
  // standing in for a folder would outrank a cwd the floor does know.
  const path = projectPath(row);
  const model =
    monitor.model === undefined ? undefined : (monitor.model.displayName ?? monitor.model.id);
  const effort = readEffort(monitor);
  const contextPercent = readContextPercent(monitor);
  return {
    providerId: row.kind,
    providerLabel: row.label,
    status: paneFrameStatus(row.status),
    alive: monitor.alive,
    ...(monitor.statusSince === "" ? {} : { statusSince: monitor.statusSince }),
    ...(path === "" ? {} : { project: folderName(path, row.label), cwd: path }),
    ...(model === undefined || model === "" ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(contextPercent === undefined ? {} : { contextPercent }),
  };
}

/**
 * The frame's agents, keyed the way a pane finds one: by the floor session its
 * PTY is (`terminal.runtimeSessionId` — the fold's own join, AR-3). A row with
 * no facts to give leaves its session out entirely, so the pane showing it
 * wears the bare badge rather than an empty readout.
 */
export function paneFrameAgents(
  byTerminal: ReadonlyMap<string, AgentSessionSummary>,
): ReadonlyMap<string, PaneFrameAgent> {
  const agents = new Map<string, PaneFrameAgent>();
  for (const [sessionId, row] of byTerminal) {
    const facts = paneFrameAgentFacts(row);
    if (facts !== undefined) agents.set(sessionId, facts);
  }
  return agents;
}

/**
 * The key a re-projection is worth doing on: every field the frame DRAWS, and
 * nothing else. The fold publishes a whole board at fieldd's tick while an
 * agent is active — usage samples, freshness, the latest reply all move — and
 * the deck must not re-render its workspace at that cadence for facts no frame
 * reads. Same discipline as the monitor's own damage gate (`rowsKey`), scoped
 * to a much narrower drawing.
 */
export function paneFrameFactsKey(
  agents: ReadonlyMap<string, PaneFrameAgent>,
  runs: ReadonlyMap<string, string>,
): string {
  const parts: string[] = [];
  // Keyed over the RUNS, not the agents: a session whose facts have gone (a
  // mirror that stopped answering) must change the key too, and its row is
  // still in the run map.
  for (const [sessionId, runtimeRunId] of runs) {
    const facts = agents.get(sessionId);
    parts.push(
      [
        sessionId,
        runtimeRunId,
        facts === undefined ? "-" : "a",
        facts?.providerId ?? "",
        facts?.providerLabel ?? "",
        facts?.status ?? "",
        facts?.alive === undefined ? "" : facts.alive ? 1 : 0,
        facts?.statusSince ?? "",
        facts?.project ?? "",
        facts?.cwd ?? "",
        facts?.model ?? "",
        facts?.effort?.value ?? "",
        facts?.effort?.configured === undefined ? "" : facts.effort.configured ? 1 : 0,
        // The meter is drawn to the whole percent, so a mirror revising the
        // share by a fraction of one is not news to a frame.
        facts?.contextPercent === undefined ? "" : Math.floor(facts.contextPercent),
      ].join("\u0001"),
    );
  }
  return parts.join("\u0002");
}

/**
 * The run each pane's session belongs to — what the frame's VERBS are aimed
 * with (`agent.interrupt` and `agent.resume` take a RUN, never a terminal).
 * Every managed row is here, including one whose mirror has said nothing yet,
 * so a starting run's pane can still be stopped.
 */
export function runIdsBySession(
  byTerminal: ReadonlyMap<string, AgentSessionSummary>,
): ReadonlyMap<string, string> {
  const runs = new Map<string, string>();
  for (const [sessionId, row] of byTerminal) runs.set(sessionId, row.runtimeRunId);
  return runs;
}
