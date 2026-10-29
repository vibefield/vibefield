import {
  WORKSPACE_LIMITS,
  WorkspaceFileActionResult,
  WorkspaceGitFactsResult,
  WorkspaceListResult,
  WorkspaceOpenTicketResult,
  WorkspacePickFolderResult,
  WorkspaceRoot,
  WorkspaceRootsResult,
  WorkspaceSearchResult,
} from "@vibefield/contracts";
import type { WorktreeHostEvent, WorktreeHostPort } from "@vibefield/rosetta-room";
import { COPY_DOOR_WORDS } from "../frame/cards/cards-words";
import { writeClipboard } from "../frame/cards/copy-door";

export interface WorkspaceDoor {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
}
export interface WorkspaceClientOptions {
  worker?: () => Worker;
  copyText?: (text: string) => Promise<void>;
}

/** A copied path's words onto the system clipboard alone, through the one copy door (HN-5):
 * the client's own way when its owner lends it no copy port. A refusal throws Copy's whole
 * sentence, which the room says as the file action's receipt, as History's port does. */
async function writeWords(text: string): Promise<void> {
  const written = await writeClipboard({ text });
  if (!written.ok) throw new Error(COPY_DOOR_WORDS.refused(written.reason));
}

export interface WorkspaceLease {
  ports(listener: (event: WorktreeHostEvent) => void): () => void;
  dispose(): void;
}

/** Map an absolute path learned from the index onto a named export and relative path. */
export function resolveWorkspaceRoot(
  roots: readonly WorkspaceRoot[],
  path: string,
): { root: WorkspaceRoot; path: string } | null {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  const windows = /^[A-Za-z]:/.test(normalized);
  const fold = (s: string) => (windows ? s.toLowerCase() : s);
  const candidates = roots
    .filter((root) => !root.missing)
    .map((root) => {
      const base = root.path.replaceAll("\\", "/").replace(/\/+$/, "");
      return { root, base };
    })
    .filter(
      ({ base }) =>
        fold(normalized) === fold(base) || fold(normalized).startsWith(fold(base) + "/"),
    )
    .sort(
      (a, b) =>
        b.base.length - a.base.length ||
        Number(b.root.kind === "place") - Number(a.root.kind === "place"),
    );
  const chosen = candidates[0];
  if (!chosen) return null;
  const relative = normalized.slice(chosen.base.length).replace(/^\//, "");
  if (relative.split("/").some((part) => part === ".." || part === ".")) return null;
  return { root: chosen.root, path: relative };
}

/** Typed row reads and one recovering attached lease for the History guest. */
export class WorkspaceClient implements WorktreeHostPort {
  readonly #door: WorkspaceDoor;
  readonly #options: WorkspaceClientOptions;
  readonly #listeners = new Set<(event: WorktreeHostEvent) => void>();
  #pending: WorktreeHostEvent | null = null;
  #worker: Worker | null = null;
  #ticket: WorkspaceOpenTicketResult | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #openTimer: ReturnType<typeof setTimeout> | null = null;
  #revision = 0;
  #generation = 0;
  #disposed = false;
  #root: string | null = null;
  #resolved: { root: WorkspaceRoot; path: string } | null = null;
  #retryMs: number = WORKSPACE_LIMITS.RETRY_MIN_MS;

  constructor(door: WorkspaceDoor, options: WorkspaceClientOptions = {}) {
    this.#door = door;
    this.#options = options;
  }
  async roots(device?: string) {
    return WorkspaceRootsResult.parse(
      await this.#door.request("workspace.roots", device ? { device } : {}),
    );
  }
  /** Ask the desktop's attended picker; cancellation creates no lease. */
  async pickFolder(): Promise<WorkspaceRoot | null> {
    if (this.#disposed) throw new Error("The folder choice closed");
    const result = WorkspacePickFolderResult.parse(
      await this.#door.request("workspace.pickFolder", {}),
    );
    if (this.#disposed) throw new Error("The folder choice closed");
    return result.canceled ? null : result.root;
  }
  /** An independent, recovering lease; dispose releases even an unused ticket.
   * A root returned by the picker may lie beyond the bounded roots listing.
   * Its id still goes to fieldd, which alone decides whether it is exported. */
  async attach(selected: string | WorkspaceRoot, path = ""): Promise<WorkspaceLease> {
    if (this.#disposed) throw new Error("The folder choice closed");
    const root =
      typeof selected === "string"
        ? (await this.roots()).roots.find((row) => row.rootId === selected && !row.missing)
        : WorkspaceRoot.parse(selected);
    if (
      !root ||
      root.missing ||
      this.#disposed ||
      /(?:^|[\\/])\.\.?(?:[\\/]|$)/.test(path) ||
      /^[\\/]/.test(path) ||
      path.includes(":")
    )
      throw new Error("This folder is not available");
    const lease = new WorkspaceClient(this.#door, this.#options);
    lease.#root = root.path.replace(/[\\/]$/, "") + (path ? "/" + path : "");
    lease.#resolved = { root, path };
    void lease.#attach(++lease.#revision);
    return { ports: (listener) => lease.ports(listener), dispose: () => lease.dispose() };
  }
  async list(rootId: string, path = "", cursor?: string) {
    return WorkspaceListResult.parse(
      await this.#door.request("workspace.list", { rootId, path, ...(cursor ? { cursor } : {}) }),
    );
  }
  async search(rootId: string, path: string, q: string) {
    return WorkspaceSearchResult.parse(
      await this.#door.request("workspace.search", { rootId, path, q }),
    );
  }
  #emit(event: WorktreeHostEvent): void {
    if (this.#pending?.type === "ports") {
      this.#pending.treePort.close();
      this.#pending.gitPort.close();
    }
    this.#pending = null;
    if (this.#listeners.size === 0) {
      this.#pending = event;
      return;
    }
    // Transferred ports have one owner. A status can be broadcast; a port cannot.
    if (event.type === "ports") this.#listeners.values().next().value?.(event);
    else for (const listener of this.#listeners) listener(event);
  }
  ports(listener: (event: WorktreeHostEvent) => void): () => void {
    this.#listeners.add(listener);
    if (this.#pending) {
      const event = this.#pending;
      this.#pending = null;
      listener(event);
    }
    return () => {
      this.#listeners.delete(listener);
    };
  }
  #release(ticket: WorkspaceOpenTicketResult): void {
    void this.#door.request("workspace.closeTicket", { ticket: ticket.ticket }).catch(() => {});
  }
  #clear(): void {
    if (this.#ticket) this.#release(this.#ticket);
    this.#ticket = null;
    if (this.#timer !== null) clearTimeout(this.#timer);
    if (this.#openTimer !== null) clearTimeout(this.#openTimer);
    this.#timer = null;
    this.#openTimer = null;
    if (this.#worker) {
      this.#worker.onmessage = null;
      this.#worker.onerror = null;
      this.#worker.terminate();
    }
    this.#worker = null;
  }
  async open(
    root: string,
  ): Promise<{ ok: true; generation: number } | { ok: false; error: string }> {
    const revision = ++this.#revision;
    this.#clear();
    this.#resolved = null;
    this.#root = root;
    try {
      const { roots } = await this.roots();
      if (this.#disposed || revision !== this.#revision)
        return { ok: false, error: "The folder choice changed" };
      const resolved = resolveWorkspaceRoot(roots, root);
      if (!resolved) return { ok: false, error: "This folder is not exported by this desktop" };
      this.#resolved = resolved;
      this.#retryMs = WORKSPACE_LIMITS.RETRY_MIN_MS;
      void this.#attach(revision);
      return { ok: true, generation: this.#generation };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "The files service is not answering",
      };
    }
  }
  async #attach(revision: number): Promise<void> {
    if (this.#disposed || revision !== this.#revision || !this.#resolved || this.#root === null)
      return;
    this.#clear();
    const generation = ++this.#generation;
    const root = this.#root;
    const { root: exported, path } = this.#resolved;
    this.#emit({
      type: "status",
      state: "starting",
      root,
      generation,
      message: "Opening this folder",
    });
    const current = () =>
      !this.#disposed && revision === this.#revision && generation === this.#generation;
    const retry = (message: string, allowed = true) => {
      if (!current()) return;
      this.#clear();
      this.#emit({ type: "status", state: "error", root, generation, message });
      if (!allowed) return;
      this.#timer = setTimeout(() => void this.#attach(revision), this.#retryMs);
      this.#retryMs = Math.min(WORKSPACE_LIMITS.RETRY_MAX_MS, this.#retryMs * 2);
    };
    try {
      const ticket = WorkspaceOpenTicketResult.parse(
        await this.#door.request("workspace.openTicket", { rootId: exported.rootId, path }),
      );
      if (!current()) {
        this.#release(ticket);
        return;
      }
      this.#ticket = ticket;
      const worker =
        this.#options.worker?.() ??
        new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      this.#worker = worker;
      worker.onerror = () => retry("The files connection stopped");
      worker.onmessage = (event: MessageEvent) => {
        if (!current()) {
          event.data?.treePort?.close();
          event.data?.gitPort?.close();
          return;
        }
        if (event.data?.type === "ports") {
          if (this.#openTimer !== null) clearTimeout(this.#openTimer);
          this.#openTimer = null;
          this.#retryMs = WORKSPACE_LIMITS.RETRY_MIN_MS;
          this.#emit({
            type: "ports",
            root,
            generation,
            treePort: event.data.treePort,
            gitPort: event.data.gitPort,
          });
          // R1 (2026-10-07): the ticket's expiry bounds its redemption only; a
          // live session ends on a real loss, which arrives as `closed`
        } else
          retry(
            typeof event.data?.message === "string"
              ? event.data.message
              : "The files connection stopped; reconnecting",
          );
      };
      this.#openTimer = setTimeout(
        () => retry("The files connection did not open"),
        WORKSPACE_LIMITS.ATTACH_TIMEOUT_MS,
      );
      worker.postMessage({ type: "attach", ticket });
    } catch (error) {
      const code = (error as { kind?: unknown })?.kind;
      retry(
        error instanceof Error ? error.message : "The files service is not answering",
        code !== "FORBIDDEN_SCOPE" && code !== "NOT_FOUND" && code !== "PRECONDITION_FAILED",
      );
    }
  }
  async gitFacts(root: string, generation: number) {
    const resolved = this.#resolved;
    if (!resolved || root !== this.#root || generation !== this.#generation) return null;
    return WorkspaceGitFactsResult.parse(
      await this.#door.request("workspace.gitFacts", {
        rootId: resolved.root.rootId,
        path: resolved.path,
      }),
    );
  }
  async fileAction(request: Parameters<WorktreeHostPort["fileAction"]>[0]) {
    const resolved = this.#resolved;
    if (!resolved || request.root !== this.#root || request.generation !== this.#generation)
      return { ok: false as const, error: "The folder changed; try again" };
    try {
      const paths: string[] = [];
      for (const path of request.paths) {
        const answer = WorkspaceFileActionResult.parse(
          await this.#door.request("workspace.fileAction", {
            rootId: resolved.root.rootId,
            path: [resolved.path, path].filter(Boolean).join("/"),
            action: request.action,
          }),
        );
        paths.push(answer.path);
      }
      if (request.action === "copyPath")
        await (this.#options.copyText ?? writeWords)(paths.join("\n"));
      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "The file action did not finish",
      };
    }
  }
  dispose(): void {
    this.#disposed = true;
    ++this.#revision;
    this.#clear();
    if (this.#pending?.type === "ports") {
      this.#pending.treePort.close();
      this.#pending.gitPort.close();
    }
    this.#pending = null;
    this.#listeners.clear();
  }
}
