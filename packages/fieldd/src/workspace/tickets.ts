import { randomBytes } from "node:crypto";
import {
  type CallerContext,
  WORKSPACE_LIMITS,
  WorkspaceCloseTicketParams,
  WorkspaceOpenTicketParams,
  type WorkspaceOpenTicketResult,
  type WorkspaceRoot,
} from "@vibefield/contracts";
import { RpcCallError } from "../native-link";
import { isWorkspaceWindow } from "./doors";
import { parseRelativePath, relativePathRefusal } from "./paths";
import type { RootsRegistry } from "./roots";
import { FilesHostRefusal, type FilesHostSupervisor, FilesHostUnavailable } from "./supervisor";

export function workspaceError(error: unknown): never {
  if (error instanceof FilesHostUnavailable)
    throw new RpcCallError("UNAVAILABLE", error.message, error.retryable, {
      service: "workspace",
      state: error.state,
    });
  if (error instanceof FilesHostRefusal)
    throw new RpcCallError(
      error.error.code === "busy"
        ? "RESOURCE_EXHAUSTED"
        : error.error.code === "invalid" || error.error.code === "not-a-directory"
          ? "PRECONDITION_FAILED"
          : error.error.code === "internal"
            ? "INTERNAL"
            : "NOT_FOUND",
      error.message,
      error.error.code === "busy",
    );
  throw error;
}

export class WorkspaceTickets {
  constructor(
    readonly registry: RootsRegistry,
    readonly supervisor: FilesHostSupervisor,
  ) {}

  check(
    ctx: CallerContext,
    params: unknown,
  ): { root: WorkspaceRoot; segments: string[]; clientId: string } {
    if (!isWorkspaceWindow(ctx) || ctx.principal.kind !== "local-token")
      throw new RpcCallError(
        "FORBIDDEN_SCOPE",
        "Files attach only to this desktop's window",
        false,
      );
    const parsed = WorkspaceOpenTicketParams.safeParse(params);
    if (!parsed.success)
      throw new RpcCallError("PRECONDITION_FAILED", "expected {rootId, path?}", false);
    const path = parseRelativePath(parsed.data.path);
    if (!path.ok)
      throw new RpcCallError("PRECONDITION_FAILED", relativePathRefusal(path.reason), false);
    this.registry.refresh();
    const root = this.registry.find(parsed.data.rootId);
    if (!root || root.missing)
      throw new RpcCallError("NOT_FOUND", "the exported folder is not available", false);
    return { root, segments: path.segments, clientId: ctx.principal.tokenId };
  }

  async mint(
    ask: ReturnType<WorkspaceTickets["check"]>,
    stillAllowed: () => boolean,
  ): Promise<WorkspaceOpenTicketResult> {
    try {
      // A project below a browse export gets a confined subtree; no arbitrary absolute-path request.
      const rootPath = await this.supervisor.request("resolve", {
        rootPath: ask.root.path,
        segments: ask.segments,
      });
      const ticket = randomBytes(32).toString("base64url");
      const gitTicket = randomBytes(32).toString("base64url");
      const expiresAt = Date.now() + WORKSPACE_LIMITS.TICKET_TTL_MS;
      const { port } = await this.supervisor.request("registerTicket", {
        rootId: ask.root.rootId,
        rootPath,
        clientId: ask.clientId,
        ticket,
        gitTicket,
        expiresAt,
      });
      // Re-check after both awaits: removal or revocation may have raced the mint.
      const currentRoot = this.registry.find(ask.root.rootId);
      if (
        !stillAllowed() ||
        !currentRoot ||
        currentRoot.missing ||
        currentRoot.path !== ask.root.path
      ) {
        await this.closeForClient(ask.clientId, ticket);
        throw new RpcCallError("FORBIDDEN_SCOPE", "The folder grant is no longer available", false);
      }
      return {
        device: ask.root.device,
        rootId: ask.root.rootId,
        rootPath,
        ticket,
        gitTicket,
        expiresAt,
        generation: this.supervisor.health().generation,
        access: "read-only",
        endpoints: {
          treeUrl: `ws://127.0.0.1:${port}/tree`,
          gitUrl: `ws://127.0.0.1:${port}/git`,
        },
      };
    } catch (error) {
      return workspaceError(error);
    }
  }

  async close(ctx: CallerContext, params: unknown): Promise<{ closed: boolean }> {
    if (!isWorkspaceWindow(ctx) || ctx.principal.kind !== "local-token")
      throw new RpcCallError(
        "FORBIDDEN_SCOPE",
        "Files attach only to this desktop's window",
        false,
      );
    const parsed = WorkspaceCloseTicketParams.safeParse(params);
    if (!parsed.success)
      throw new RpcCallError("PRECONDITION_FAILED", "expected a files ticket", false);
    return { closed: await this.closeForClient(ctx.principal.tokenId, parsed.data.ticket) };
  }

  async closeForClient(clientId: string, ticket: string): Promise<boolean> {
    try {
      return await this.supervisor.request("closeTicket", { clientId, ticket });
    } catch (error) {
      if (error instanceof FilesHostUnavailable) return false;
      return workspaceError(error);
    }
  }

  async revokeClient(clientId: string): Promise<void> {
    try {
      await this.supervisor.request("revokeClient", { clientId });
    } catch (error) {
      if (!(error instanceof FilesHostUnavailable)) throw error;
    }
  }
}
