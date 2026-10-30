import { folderName, type PaneFrameAgent } from "@vibefield/puppeteer-views";
import type { AgentVisualStatus } from "./agent-status";
import type { ChromeRun } from "./chrome-facts";
import type { AgentStatus } from "./facet-types";

/**
 * THE FRAME'S FACTS (GT-6) — a run of this desktop, projected into what the
 * package's pane frame reads (design-system record §07, upstream since PU-14).
 *
 * MV-3d (M35) — the run is its row of the model board (`chrome-facts.ts`
 * `ChromeRun`), no longer the fold's `full` row: what the row says itself (the
 * provider and its label, the status and its clock, the PTY join, the model, the
 * effort, the context share) is read off the row, and what only the fold knew —
 * the working directory as a PATH, whether the provider has spoken, the mirror's
 * own liveness and how it knows its context share — off the chrome's facts
 * beside it (`local`). Every rule below is the one the fold's reading made, and
 * `godview-pane-frame-facts.test.ts` holds each of them through fieldd's own cut.
 *
 * The frame is `@vibefield/puppeteer-views`' and knows no host: it takes a
 * `PaneFrameAgent` in the host's own words and dials nothing (the AR-5 rule).
 * This module is that seam on VibeField's side — pure, so the projection's
 * rules are testable without a pane, a GPU or a daemon, exactly as
 * `pane-faces.ts` is.
 *
 * Three rules are worth stating because each is a decision:
 *
 *   · A run with NO monitor mirror yields NO agent facts. A run before its
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
 *     MF-1f keeps exited rows while their PTYs remain on the floor; MF-1g keeps
 *     agent panes until explicitly closed. The GT-6 gap is therefore closed:
 *     the fold can supply this projection after exit and after a restart.
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
 * The effort, read TOLERANTLY: a `value` that is a word is the whole
 * requirement. `configured` says the value is the launch INTENT rather than
 * evidence the provider reported — the frame italicises it, which is the whole
 * reason the flag crosses the seam.
 */
function readEffort(run: ChromeRun): { value: string; configured: boolean } | undefined {
  const raw = run.effort as { value?: unknown; intent?: unknown } | undefined;
  if (typeof raw !== "object" || raw === null) return undefined;
  const { value, intent } = raw;
  if (typeof value !== "string" || value === "") return undefined;
  return { value, configured: intent === "configured" };
}

/**
 * The context share, when the provider could actually say. Core marks its own
 * uncertainty in `percentageSource` — `provider` measured it, `derived` inferred
 * it, `unavailable` means nobody knows — and a meter drawn from an unavailable
 * source would be a number invented at the seam. The share is the row's, its
 * source the mirror's word beside it (`local.mirror.contextSource`).
 */
function readContextPercent(run: ChromeRun): number | undefined {
  const context = run.context;
  if (context === undefined) return undefined;
  if (run.local?.mirror?.contextSource === "unavailable") return undefined;
  const percent = context.usedPercent;
  return typeof percent === "number" && Number.isFinite(percent) ? percent : undefined;
}

/** Whether the provider has spoken for a run: fieldd holds a mirror for it. */
function hasSpoken(run: ChromeRun): boolean {
  return run.local?.mirror !== undefined;
}

/** One run's facts, or `undefined` while the run has said nothing. */
export function paneFrameAgentFacts(run: ChromeRun): PaneFrameAgent | undefined {
  const mirror = run.local?.mirror;
  if (mirror === undefined) return undefined;
  // The directory the provider observed, else the workspace's (fieldd reads
  // that chain once, `localFactsOf`). The provider-label fallback is
  // deliberately NOT applied here: with no directory at all the frame's own
  // chain takes over (the session's cwd, then `terminal`), and a provider label
  // standing in for a folder would outrank a cwd the floor does know.
  const path = run.local?.cwd ?? "";
  const model = run.model === undefined ? undefined : (run.model.displayName ?? run.model.id);
  const effort = readEffort(run);
  const contextPercent = readContextPercent(run);
  // Q08 — the key the stop verb presses, fieldd's word for the run (its
  // adapter's own, or the floor's ⌃C while the adapter names none): the frame's
  // stop title names it, and names none when the stop presses no key
  const stopKey = run.local?.stopKey ?? "";
  return {
    providerId: run.kind,
    providerLabel: run.label,
    status: paneFrameStatus(run.status),
    // the mirror's own word, which an exit fieldd witnessed does not rewrite
    // here (the row's `alive` is fieldd's reading); a row from a fieldd that
    // said less falls back to that reading
    alive: mirror.alive ?? run.alive,
    // the row's clock is the mirror's own once the provider has spoken
    ...(run.statusSince === "" ? {} : { statusSince: run.statusSince }),
    ...(path === "" ? {} : { project: folderName(path, run.label), cwd: path }),
    ...(model === undefined || model === "" ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(contextPercent === undefined ? {} : { contextPercent }),
    ...(stopKey === "" ? {} : { stopKey }),
  };
}

/**
 * THE PANE JOIN (AR-3): a run by the floor session its PTY is. `hosted:
 * "local"` only, and the restriction is the point: a remote row's
 * `runtimeSessionId` names a session on the PEER'S floor, while the pane in
 * this deck shows a local REPLICA with an id of its own (GT-5c) — joining on it
 * would hang one device's facts off another device's pane. A run with no
 * terminal (`hosted: "none"` — an exited run, an ingested one) joins nothing,
 * which is the honest answer for a run with no pane.
 *
 * A run the provider has spoken for wins a contested session id: fieldd's fold
 * names one run per PTY, so a collision means a replacement is mid-flight, and
 * the run that has spoken is the one worth drawing.
 */
export function runsByTerminal(runs: readonly ChromeRun[]): ReadonlyMap<string, ChromeRun> {
  const byTerminal = new Map<string, ChromeRun>();
  for (const run of runs) {
    const terminal = run.terminal;
    if (terminal?.hosted !== "local") continue;
    const sessionId = terminal.runtimeSessionId;
    if (sessionId === undefined || sessionId === "") continue;
    const held = byTerminal.get(sessionId);
    if (held !== undefined && hasSpoken(held) && !hasSpoken(run)) continue;
    byTerminal.set(sessionId, run);
  }
  return byTerminal;
}

/**
 * The frame's agents, keyed the way a pane finds one: by the floor session its
 * PTY is (`terminal.runtimeSessionId` — the fold's own join, AR-3). A run with
 * no facts to give leaves its session out entirely, so the pane showing it
 * wears the bare badge rather than an empty readout.
 */
export function paneFrameAgents(
  byTerminal: ReadonlyMap<string, ChromeRun>,
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
 * nothing else. A working agent's row moves several times a second — tokens,
 * cost, its activity, the newest evidence — and the deck must not re-render its
 * workspace at that cadence for facts no frame reads. Same discipline as the
 * monitor's own damage gate, scoped to a much narrower drawing.
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
        facts?.stopKey ?? "",
      ].join("\u0001"),
    );
  }
  return parts.join("\u0002");
}

/**
 * The run each pane's session belongs to — what the frame's VERBS are aimed
 * with (`agent.interrupt` and `agent.resume` take a RUN, never a terminal).
 * Every managed run is here, including one whose mirror has said nothing yet,
 * so a starting run's pane can still be stopped.
 */
export function runIdsBySession(
  byTerminal: ReadonlyMap<string, ChromeRun>,
): ReadonlyMap<string, string> {
  const runs = new Map<string, string>();
  for (const [sessionId, row] of byTerminal) runs.set(sessionId, row.runtimeRunId);
  return runs;
}
