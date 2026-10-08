import {
  type CallerContext,
  INDEX_MESH,
  type IndexThread,
  IndexThreadsParams,
  type IndexThreadsResult,
} from "@vibefield/contracts";
import type { IndexCatalog } from "./index-catalog";
import { compareKeys, decodeCursor, pageOf, type SortKey } from "./index-mesh";
import { RpcCallError } from "./native-link";

// AR-8 — `index.threads`, the window's door on this desktop's DELEGATED
// threads (build-hf.md L1, the lead's decision 2026-10-08). The catalog keeps
// a session that has a parent out of `sessions` — every listing, figure,
// replica and the phone read that table, and they stay roots-only — and holds
// it in its local-only `threads` table (index-catalog.ts). This door pages that
// table for the History room, which hangs each thread under its parent's
// delegate line and keeps a search hit inside one.
//
// Who may ask: this desktop's window and shell, nobody else. The scope is
// `index.search` (the history's content), which the phone's preset, a self
// peer daemon's and a plugin's grant could otherwise carry; the method is
// `local`, so the D36 wall refuses a peer daemon before this check runs. The
// phone reads threads later, with SP-7's full transcripts.

/** Every refusal, before anything is read. */
export function checkThreadsCaller(ctx: CallerContext): void {
  const kind = ctx.principal.kind;
  if (kind === "local-token" || kind === "shell-main") return;
  throw new RpcCallError(
    "FORBIDDEN_SCOPE",
    "index.threads is a window's door: a delegated thread is read on the desktop that holds it",
    false,
    { method: "index.threads", principal: kind },
  );
}

/** The keyset a page walks: by root, then by id — nothing a thread's activity
 * moves, so a walk across pages never skips or repeats one. */
const keyOf = (row: IndexThread): SortKey => [null, row.rootSessionId, row.sessionId];

/** One page of the threads, sorted once per table revision. */
export function createThreadsPager(catalog: IndexCatalog) {
  let sorted: { revision: number; rows: IndexThread[] } | null = null;
  return (params: unknown): IndexThreadsResult => {
    const parsed = IndexThreadsParams.safeParse(params ?? {});
    if (!parsed.success)
      throw new RpcCallError("PRECONDITION_FAILED", "expected { cursor?, limit? (1..500) }", false);
    // a catalog that has not read the index has no threads to say: never "none"
    if (!catalog.ready)
      throw new RpcCallError(
        "UNAVAILABLE",
        "the history catalog has not read the index yet",
        true,
        {
          service: "index",
          state: catalog.phase,
        },
      );
    const table = catalog.threads;
    if (sorted === null || sorted.revision !== table.revision) {
      sorted = {
        revision: table.revision,
        rows: table.rows().sort((a, b) => compareKeys(keyOf(a), keyOf(b))),
      };
    }
    const limit = Math.min(
      Math.max(parsed.data.limit ?? INDEX_MESH.PAGE_DEFAULT_LIMIT, 1),
      INDEX_MESH.PAGE_MAX_LIMIT,
    );
    const { items, next } = pageOf(
      sorted.rows,
      keyOf,
      decodeCursor(parsed.data.cursor),
      limit,
      () => true,
    );
    return { rows: items, ...(next !== undefined ? { cursor: next } : {}) };
  };
}
