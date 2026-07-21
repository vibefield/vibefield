import { DocListResult, DocOpenResult, DocRegistryEntry } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { DocLaneClient } from "@vibefield/fieldd-client/doclane";

// B3 board bootstrap (thinking-b3-docservice §5): ensure the named board in
// fieldd's registry (registry-open law — list, create if absent, NEVER blind-
// seed), then fetch its at-rest envelope over the :9411 lane BEFORE first
// render (no flash-of-seeded-board). Failure degrades to an in-memory board
// with persistence honestly DETACHED — the field always opens.

export const BOARD_NAME = "board";

/** Everything FieldView needs to decide open-vs-seed and wire autosave. */
export interface BoardBoot {
  /** null ⇒ persistence detached (fieldd unreachable / doc flow failed). */
  lane: DocLaneClient | null;
  /** null ⇒ no at-rest doc — first run, the caller seeds. */
  initialBytes: Uint8Array | null;
  /** why persistence is detached, for the SystemSection row. */
  degraded?: string;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function loadBoard(client: FielddClient, timeoutMs = 5_000): Promise<BoardBoot> {
  let lane: DocLaneClient | null = null;
  try {
    const board = await withTimeout(ensureBoard(client), timeoutMs, "board bootstrap");
    lane = new DocLaneClient({
      openLane: async () =>
        DocOpenResult.parse(await client.request("doc.open", { docId: board.docId })),
    });
    const { hasDoc } = await withTimeout(lane.attach(), timeoutMs, "doc lane attach");
    const initialBytes = hasDoc ? await withTimeout(lane.get(), timeoutMs, "doc fetch") : null;
    return { lane, initialBytes };
  } catch (e) {
    // Honest degraded boot: the board still opens, in memory, and the System
    // section says why nothing is being persisted (never a blank, never a hang).
    lane?.close();
    return { lane: null, initialBytes: null, degraded: e instanceof Error ? e.message : String(e) };
  }
}

async function ensureBoard(client: FielddClient): Promise<DocRegistryEntry> {
  const { docs } = DocListResult.parse(await client.request("doc.list", {}));
  const existing = docs.find((d) => d.name === BOARD_NAME && d.deletedAt === undefined);
  if (existing) return existing;
  return DocRegistryEntry.parse(await client.request("doc.create", { name: BOARD_NAME }));
}
