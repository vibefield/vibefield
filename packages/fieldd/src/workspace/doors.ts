import { randomBytes } from "node:crypto";
import {
  type CallerContext,
  PRODUCT_API_LIMITS,
  type Principal,
  WORKSPACE_LIMITS,
  WORKSPACE_SERVICE,
  WorkspaceGitFactsParams,
  WorkspaceGitFactsResult,
  WorkspaceListParams,
  type WorkspaceListResult,
  WorkspaceListResult as WorkspaceListResultSchema,
  type WorkspaceRoot,
  WorkspaceRootsParams,
  type WorkspaceRootsResult,
  WorkspaceSearchParams,
  type WorkspaceSearchResult,
  WorkspaceSearchResult as WorkspaceSearchResultSchema,
  WorkspaceSubscribeParams,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { CatalogTable, createRowsPump, type RowsEmit } from "../catalog-rows";
import { RpcCallError } from "../native-link";
import { atFloor } from "../projection";
import { parseRelativePath, relativePathRefusal } from "./paths";
import type { RootsRegistry } from "./roots";
import { FilesHostRefusal, type FilesHostSupervisor, FilesHostUnavailable } from "./supervisor";

// FS-1a — the files service's DOOR TIER (`workspace.*`, methods.ts;
// `thinking-files-service.md` §3). Every door, in the order a caller hears
// its refusals:
//
//   1. WHO (FS-D6 (a), RO-13's rule). `workspace.read` is plugin-eligible and
//      guards the device roster and the artifact list, so the scope proves
//      nothing about files: a PLUGIN (renderer or service), an MCP AGENT and a
//      TAILNET GUEST are refused FORBIDDEN_SCOPE whatever they hold. A window
//      (a local token, the renderer's participant or not — the shell mints
//      both), the shell, a self phone (`tailnet`, `self: true`) and a self peer
//      daemon (`peer-fieldd`) are served.
//   2. WHAT — the params (PRECONDITION_FAILED, the caller's to fix), then the
//      path rule (paths.ts: `..`, an absolute path, a drive letter → refused;
//      the worker refuses a symlink on the way or a real path outside the
//      root as NOT_FOUND, indistinguishable from an absent folder).
//   3. WHICH root — an id this desktop does not hold is NOT_FOUND; a place
//      whose folder is gone is NOT_FOUND and the registry marks it `missing`.
//   4. WHETHER the worker can answer — UNAVAILABLE {service: "workspace",
//      state: starting | restarting | off | unconfigured | failed | stopped}.
//
// PAGES (L4): a `workspace.list` page holds at most LIST_PAGE rows, and a
// TAILNET caller's at most TAILNET_PAGE — the DOOR's cut, never the worker's
// — with `clipped` and `nextCursor` saying more follows. A self peer daemon
// keeps a window's pages (it asks on behalf of one, `tailnet-rows.ts`'s rule).
// `workspace.roots` is cut the same way, oldest places first.

/** The cursor's spelling: the next page's offset (opaque to readers). */
function cursorOf(offset: number): string {
  return `o:${offset}`;
}

function offsetOf(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const match = /^o:(\d{1,9})$/.exec(cursor);
  if (match === null)
    throw new RpcCallError("PRECONDITION_FAILED", "the cursor is not one this door gave", false);
  return Number(match[1]);
}

/** FS-D6 — the principal gate. */
export function admitWorkspaceReader(ctx: CallerContext, method: string): void {
  const principal = ctx.principal;
  const refused =
    principal.kind === "plugin" ||
    principal.kind === "mcp-agent" ||
    principal.kind === "tailnet-guest" ||
    (principal.kind === "tailnet" && principal.self !== true);
  if (refused)
    throw new RpcCallError(
      "FORBIDDEN_SCOPE",
      "the files service answers the owner's own windows and devices only — never a plugin, an agent or a guest",
      false,
      { method, principal: principal.kind },
    );
}

/** L4 — the most rows one page holds for this caller. */
export function workspacePageLimit(principal: Principal): number {
  return principal.kind === "tailnet" || principal.kind === "tailnet-guest"
    ? WORKSPACE_LIMITS.TAILNET_PAGE
    : WORKSPACE_LIMITS.LIST_PAGE;
}

export interface WorkspaceDoorsOptions {
  registry: RootsRegistry;
  supervisor: FilesHostSupervisor;
  /** how often an open roots subscription re-reads the disk (mounts, missing) */
  rootsPollMs?: number;
  logger?: Logger;
}

/** The roots subscription's re-read cadence while anyone holds it. */
export const ROOTS_POLL_MS = 10_000;

export class WorkspaceDoors {
  readonly #registry: RootsRegistry;
  readonly #supervisor: FilesHostSupervisor;
  readonly #logger: Logger;
  readonly #pollMs: number;
  /** the roots as rows (DS-L3), one table for every subscriber */
  readonly #table: CatalogTable<WorkspaceRoot>;
  #subscribers = 0;
  #poll: NodeJS.Timeout | null = null;
  readonly #unlisten: () => void;

  constructor(opts: WorkspaceDoorsOptions) {
    this.#registry = opts.registry;
    this.#supervisor = opts.supervisor;
    this.#logger = opts.logger ?? createNoopLogger();
    this.#pollMs = opts.rootsPollMs ?? ROOTS_POLL_MS;
    this.#table = new CatalogTable<WorkspaceRoot>({
      epoch: `workspace-${randomBytes(6).toString("hex")}`,
      keyOf: (row) => row.rootId,
    });
    this.#unlisten = this.#registry.onChange(() => {
      if (this.#subscribers > 0) this.#refreshTable(false);
    });
  }

  dispose(): void {
    this.#unlisten();
    if (this.#poll !== null) clearInterval(this.#poll);
    this.#poll = null;
  }

  #refreshTable(reread: boolean): void {
    if (reread) this.#registry.refresh();
    this.#table.replaceAll(this.#registry.roots());
  }

  #root(rootId: string): WorkspaceRoot {
    const root = this.#registry.find(rootId);
    if (root === undefined)
      throw new RpcCallError("NOT_FOUND", "this desktop exports no root with that id", false, {
        rootId,
      });
    return root;
  }

  /** A worker answer or refusal, in the door's words. */
  async #ask<T>(root: WorkspaceRoot, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof FilesHostUnavailable)
        throw new RpcCallError("UNAVAILABLE", error.message, error.retryable, {
          service: WORKSPACE_SERVICE.SERVICE,
          state: error.state,
        });
      if (error instanceof FilesHostRefusal) {
        switch (error.error.code) {
          case "root-missing":
            if (root.kind === "place") this.#registry.markMissing(root.rootId);
            throw new RpcCallError("NOT_FOUND", "the root's folder is gone", false, {
              rootId: root.rootId,
              missing: true,
            });
          case "not-found":
            throw new RpcCallError("NOT_FOUND", "no folder at that path under the root", false);
          case "not-a-directory":
            throw new RpcCallError(
              "PRECONDITION_FAILED",
              "that path names a file, not a folder",
              false,
            );
          case "invalid":
            throw new RpcCallError("PRECONDITION_FAILED", error.message, false);
          default:
            this.#logger.warn(
              "fieldd.workspace.worker_failed",
              "The files worker failed a question",
              {
                message: error.message,
              },
            );
            throw new RpcCallError("INTERNAL", "the files service could not answer", true);
        }
      }
      throw error;
    }
  }

  roots(ctx: CallerContext, params: unknown): WorkspaceRootsResult {
    admitWorkspaceReader(ctx, "workspace.roots");
    if (!WorkspaceRootsParams.safeParse(params ?? {}).success)
      throw new RpcCallError("PRECONDITION_FAILED", "expected { device?: string }", false);
    this.#registry.refresh();
    const all = this.#registry.roots();
    const limit = workspacePageLimit(ctx.principal);
    if (all.length <= limit) return { roots: all, clipped: false };
    // the cut takes the OLDEST places first: browse exports always stay
    const browse = all.filter((root) => root.kind !== "place");
    const places = all.filter((root) => root.kind === "place");
    const keep = Math.max(0, limit - browse.length);
    return { roots: [...places.slice(0, keep), ...browse].slice(0, limit), clipped: true };
  }

  async list(ctx: CallerContext, params: unknown): Promise<WorkspaceListResult> {
    admitWorkspaceReader(ctx, "workspace.list");
    const parsed = WorkspaceListParams.safeParse(params ?? {});
    if (!parsed.success)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `expected { rootId, path? (relative), cursor?, limit? (1..${WORKSPACE_LIMITS.LIST_PAGE}), kinds?: "dirs" | "all", device? }`,
        false,
      );
    const path = parseRelativePath(parsed.data.path);
    if (!path.ok)
      throw new RpcCallError("PRECONDITION_FAILED", relativePathRefusal(path.reason), false, {
        reason: path.reason,
      });
    const offset = offsetOf(parsed.data.cursor);
    const ceiling = workspacePageLimit(ctx.principal);
    const limit = Math.min(parsed.data.limit ?? ceiling, ceiling);
    const root = this.#root(parsed.data.rootId);
    const value = await this.#ask(root, () =>
      this.#supervisor.request("list", {
        rootPath: root.path,
        segments: path.segments,
        offset,
        limit,
        kinds: parsed.data.kinds ?? "dirs",
      }),
    );
    const answer = WorkspaceListResultSchema.safeParse({
      rootId: root.rootId,
      path: value.path,
      entries: value.entries,
      nextCursor: value.nextOffset === null ? null : cursorOf(value.nextOffset),
      clipped: value.nextOffset !== null,
      total: value.total,
    });
    if (!answer.success) {
      this.#logger.warn(
        "fieldd.workspace.answer_malformed",
        "A files worker answer did not parse",
        {
          method: "workspace.list",
        },
      );
      throw new RpcCallError("INTERNAL", "the files service answered out of contract", false);
    }
    return answer.data;
  }

  async search(ctx: CallerContext, params: unknown): Promise<WorkspaceSearchResult> {
    admitWorkspaceReader(ctx, "workspace.search");
    const parsed = WorkspaceSearchParams.safeParse(params ?? {});
    if (!parsed.success)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `expected { rootId, q (1..${WORKSPACE_LIMITS.QUERY_CHARS} chars), limit? (1..${WORKSPACE_LIMITS.SEARCH_HITS}), kinds?: "dirs" | "all", device? }`,
        false,
      );
    const ceiling = Math.min(WORKSPACE_LIMITS.SEARCH_HITS, workspacePageLimit(ctx.principal));
    const limit = Math.min(parsed.data.limit ?? ceiling, ceiling);
    const root = this.#root(parsed.data.rootId);
    const value = await this.#ask(root, () =>
      this.#supervisor.request("search", {
        rootPath: root.path,
        q: parsed.data.q,
        limit,
        kinds: parsed.data.kinds ?? "all",
      }),
    );
    const answer = WorkspaceSearchResultSchema.safeParse({ rootId: root.rootId, ...value });
    if (!answer.success) {
      this.#logger.warn(
        "fieldd.workspace.answer_malformed",
        "A files worker answer did not parse",
        {
          method: "workspace.search",
        },
      );
      throw new RpcCallError("INTERNAL", "the files service answered out of contract", false);
    }
    return answer.data;
  }

  async gitFacts(ctx: CallerContext, params: unknown): Promise<WorkspaceGitFactsResult> {
    admitWorkspaceReader(ctx, "workspace.gitFacts");
    const parsed = WorkspaceGitFactsParams.safeParse(params ?? {});
    if (!parsed.success)
      throw new RpcCallError("PRECONDITION_FAILED", "expected { rootId, device? }", false);
    const root = this.#root(parsed.data.rootId);
    // a gone folder is NOT_FOUND like any other door's (the worker checks)
    const value = await this.#ask(root, () =>
      this.#supervisor.request("gitFacts", { rootPath: root.path }),
    );
    const answer = WorkspaceGitFactsResult.safeParse(value);
    if (!answer.success)
      throw new RpcCallError("INTERNAL", "the files service answered out of contract", false);
    return answer.data;
  }

  /** L3 — `workspace.subscribe {scope: "roots"}`: the roots as rows at the
   * stream floor (a slower ask is honoured, a faster one served at it). */
  subscribe(
    ctx: CallerContext,
    params: unknown,
    emit: RowsEmit,
  ): { snapshot: unknown; start: () => void; dispose: () => void } {
    admitWorkspaceReader(ctx, "workspace.subscribe");
    const parsed = WorkspaceSubscribeParams.safeParse(params ?? {});
    if (!parsed.success)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        'expected { scope: "roots", since?: {epoch, revision}, minIntervalMs?, device? }',
        false,
      );
    this.#refreshTable(true);
    const pump = createRowsPump({
      table: this.#table,
      since: parsed.data.since,
      minIntervalMs: atFloor(parsed.data.minIntervalMs, PRODUCT_API_LIMITS.STREAM_MIN_INTERVAL_MS),
      emit,
    });
    this.#subscribers += 1;
    if (this.#poll === null) {
      this.#poll = setInterval(() => this.#refreshTable(true), this.#pollMs);
      this.#poll.unref?.();
    }
    let disposed = false;
    return {
      snapshot: pump.open,
      start: () => pump.start(),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        pump.dispose();
        this.#subscribers -= 1;
        if (this.#subscribers === 0 && this.#poll !== null) {
          clearInterval(this.#poll);
          this.#poll = null;
        }
      },
    };
  }
}
