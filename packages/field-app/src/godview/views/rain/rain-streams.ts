import type { MonitorAgent } from "../../monitor/types";

export interface RainDrop {
  agentId: string;
  /** Head position in rows; fractional, so a stream can crawl slower than one row a frame. */
  y: number;
  speed: number;
}

export interface ReconcileRainColumnsInput {
  /** Agent ids in display order; earlier ids claim their preferred column first. */
  agents: readonly string[];
  columns: number;
  previous: ReadonlyMap<number, RainDrop>;
  createDrop: (agentId: string) => RainDrop;
}

/** Two adjacent streams per agent wherever the stage has room for them. */
const STREAMS_PER_AGENT = 2;

function nearestFreeColumn(
  taken: ReadonlyMap<number, RainDrop>,
  columns: number,
  ideal: number,
): number | undefined {
  for (let offset = 0; offset < columns; offset += 1) {
    const right = ideal + offset;
    if (right < columns && !taken.has(right)) return right;
    const left = ideal - offset;
    if (left >= 0 && !taken.has(left)) return left;
  }
  return undefined;
}

/**
 * Assign columns to agents, keeping the ones already placed where they are.
 *
 * The prototype rebuilt every stream from scratch on each change, which is fine
 * for a fixed cast but not here: agents arrive and leave constantly, and a
 * rebuild would re-randomize every head position, so the whole field would jump
 * whenever anyone spawned. Only new agents are placed, and only freed columns
 * are reused.
 *
 * A second column is granted by a stable hash rather than at random, so the
 * field keeps its uneven texture without an agent's width flickering between
 * frames. When there is not room for everyone, later agents go unplaced — which
 * is visible on screen rather than silent.
 */
export function reconcileRainColumns(input: ReconcileRainColumnsInput): Map<number, RainDrop> {
  const { agents, columns, previous, createDrop } = input;
  const next = new Map<number, RainDrop>();
  if (columns <= 0 || agents.length === 0) return next;

  const live = new Set(agents);
  const held = new Map<string, number[]>();
  for (const [column, drop] of previous) {
    if (column >= columns || !live.has(drop.agentId)) continue;
    next.set(column, drop);
    held.set(drop.agentId, [...(held.get(drop.agentId) ?? []), column]);
  }

  const spacing = columns / agents.length;
  const target = spacing >= STREAMS_PER_AGENT ? STREAMS_PER_AGENT : 1;
  for (const [index, agentId] of agents.entries()) {
    const existing = held.get(agentId) ?? [];
    if (existing.length >= target) {
      for (const column of existing.slice(target)) next.delete(column);
      continue;
    }
    const ideal = Math.min(columns - 1, Math.max(0, Math.floor(index * spacing + spacing / 2)));
    for (let placed = existing.length; placed < target; placed += 1) {
      const column = nearestFreeColumn(next, columns, ideal);
      if (column === undefined) break;
      next.set(column, createDrop(agentId));
    }
  }

  return next;
}

/**
 * What a column says when you read it top to bottom. Symbols are flattened to
 * spaces so every cell holds one grid-width glyph and the stream stays a
 * column rather than a ragged edge.
 *
 * THE HOST IS IN THE STREAM (GT-D17, GT-5c). A remote row carries no agent
 * facet, so until this slice it fell into the same `<project> terminal` branch
 * an unclaimed LOCAL terminal takes — byte-identical on the canvas, with the
 * machine reachable only by hovering or by reading the offscreen list. Two
 * same-named projects on two machines were indistinguishable, and clicking the
 * wrong one detaches the active pane onto a peer's session. The peer's name
 * comes FIRST for the same reason it does in the list row's accessible name:
 * the machine is the fact that changes what the column means.
 *
 * The read-only mark is a HOST property (see `MonitorRemoteFacet.hostWritable`)
 * and reads as one: nobody types into that peer's sessions. A host that DOES
 * permit writes says nothing here, because whether this viewer gets them is not
 * decided until the attach.
 */
export function rainDataString(agent: MonitorAgent): string {
  const facet = agent.agent;
  const remote = agent.remote;
  const parts = facet
    ? [
        agent.project,
        facet.branch,
        facet.model ?? facet.provider,
        facet.contextWindow
          ? `CTX:${Math.round(facet.contextWindow.usedPercent).toString().padStart(2, "0")}%`
          : undefined,
      ]
    : remote
      ? [remote.deviceName, agent.project, remote.hostWritable ? undefined : "read only host"]
      : [agent.project, "terminal"];
  return ` ${parts.filter(Boolean).join(" ")} `.replace(/[^a-zA-Z0-9\s%.]/g, " ");
}

/** Context usage sets the tail, floored so that a stream always reads as one. */
export function rainTailLength(
  agent: MonitorAgent,
  rows: number,
  tailMultiplier: number,
  dataLength: number,
): number {
  const contextWindow = agent.agent?.contextWindow;
  // An unmeasured window is the common case — it only appears once the agent
  // reports one — so it sits mid-scale. Reading it as almost-nothing left a
  // working stream as a head and two fading glyphs with no lit body between.
  const usage = contextWindow ? Math.min(1, Math.max(0, contextWindow.usedPercent / 100)) : 0.5;
  const base = Math.max(3, usage * rows * 0.9) * tailMultiplier;
  // The prototype floored the stuck and resting states at the length of their
  // text; on a stage a third the height of that window, every state needs it.
  // Brightness ramps linearly across the tail, so a short one does not just cut
  // the stream short — it makes the color fall off within a few rows, leaving a
  // head and a fade where the lit body should be. Context still extends the
  // tail past the floor wherever the stage has rows to spend.
  return Math.max(base, dataLength + 6);
}
