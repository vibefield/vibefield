import {
  type CallerContext,
  ShellDialogPickFolderResult,
  WorkspacePickFolderParams,
  type WorkspacePickFolderResult,
  type WorkspaceRoot,
} from "@vibefield/contracts";
import type { AuditService } from "../audit-service";
import { RpcCallError } from "../native-link";
import { isWorkspaceWindow } from "./doors";
import type { RootsRegistry } from "./roots";

export interface WorkspacePickerOptions {
  registry: RootsRegistry;
  audit: Pick<AuditService, "required">;
  choose(ctx: CallerContext): Promise<unknown>;
  /** The shell may revoke a window while its native dialog is open. */
  isCurrent(ctx: CallerContext): boolean;
}

/** FS-3's Files-owned seam: the shell chooses a directory, fieldd owns its
 * export. Audit the attended selection before publishing any persistent row.
 * The caller never submits a filesystem path. */
export class WorkspacePicker {
  #busy = false;
  constructor(private readonly options: WorkspacePickerOptions) {}

  #current(ctx: CallerContext): void {
    if (!isWorkspaceWindow(ctx) || ctx.signal?.aborted || !this.options.isCurrent(ctx)) {
      throw new RpcCallError(
        "FORBIDDEN_SCOPE",
        "Only this desktop's current window may choose a Files folder",
        false,
      );
    }
  }

  async pick(ctx: CallerContext, params: unknown): Promise<WorkspacePickFolderResult> {
    this.#current(ctx);
    if (!WorkspacePickFolderParams.safeParse(params ?? {}).success)
      throw new RpcCallError("PRECONDITION_FAILED", "expected a folder picker request", false);
    if (this.#busy)
      throw new RpcCallError("CONFLICT", "A Files folder choice is already open", true);
    this.#busy = true;
    try {
      const selected = await this.options.audit.required(
        ctx,
        {
          action: "workspace.folder.pick",
          target: { kind: "shell-operation", id: "workspace-folder-picker" },
        },
        async (): Promise<WorkspacePickFolderResult> => {
          this.#current(ctx);
          const result = ShellDialogPickFolderResult.parse(await this.options.choose(ctx));
          this.#current(ctx);
          if (result.canceled) return { canceled: true };
          const root = this.options.registry.preparePicked(result.path);
          if (!root)
            throw new RpcCallError(
              "PRECONDITION_FAILED",
              "Choose an existing folder below a filesystem root",
              false,
            );
          return { canceled: false, root };
        },
        (result) =>
          result.canceled
            ? { outcome: "cancelled" }
            : { outcome: "succeeded", attrs: { rootId: result.root.rootId } },
      );
      // Required audit has recorded the selection, including its outcome. A
      // disconnected/revoked caller or failed persistence creates no export.
      this.#current(ctx);
      if (selected.canceled) return selected;
      let root: WorkspaceRoot | null;
      try {
        root = this.options.registry.registerPicked(selected.root.path);
      } catch {
        throw new RpcCallError("UNAVAILABLE", "The chosen folder could not be saved", true, {
          service: "workspace",
          state: "failed",
        });
      }
      if (!root)
        throw new RpcCallError(
          "NOT_FOUND",
          "The chosen folder changed before it could be added",
          false,
        );
      return { canceled: false, root };
    } finally {
      this.#busy = false;
    }
  }
}
