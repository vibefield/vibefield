import { join } from "node:path";
import {
  SHELL_PROVIDER_METHODS,
  ShellDialogPickFileParams,
  ShellDialogPickFileResult,
  ShellDialogPickFolderParams,
  ShellDialogPickFolderResult,
  ShellDialogSaveFileParams,
  ShellDialogSaveFileResult,
  ShellOpenExternalParams,
  ShellOpenExternalResult,
  ShellOpenLinkParams,
  ShellOpenLinkResult,
  type ShellProviderCallParams,
  ShellProviderCallParams as ShellProviderCallParamsSchema,
  type ShellProviderError,
  ShellProviderRegisterResult,
  ShellRendererRequestReplacementParams,
  type ShellRendererRequestReplacementResult,
  ShellRendererRequestReplacementResult as ShellRendererRequestReplacementResultSchema,
  ShellRevealPathParams,
  ShellRevealPathResult,
  ShellSurfacesEnumerateParams,
  type ShellSurfacesEnumerateResult,
  ShellSurfacesEnumerateResult as ShellSurfacesEnumerateResultSchema,
  ShellSurfacesMintParams,
  type ShellSurfacesMintResult,
  ShellSurfacesMintResult as ShellSurfacesMintResultSchema,
  ShellSurfacesReleaseParams,
  type ShellSurfacesReleaseResult,
  ShellSurfacesReleaseResult as ShellSurfacesReleaseResultSchema,
  ShellWebContentsCaptureArtifactPreviewParams,
  type ShellWebContentsCaptureArtifactPreviewResult,
  ShellWebContentsCaptureArtifactPreviewResult as ShellWebContentsCaptureArtifactPreviewResultSchema,
} from "@vibefield/contracts";
import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import type { Logger } from "@vibefield/logging";
import type { BrowserWindow, OpenDialogOptions, SaveDialogOptions } from "electron";
import type { FielddHandleCoordinator } from "./fieldd-handle-coordinator";

type Stop = () => void;
type Client = FielddHandle["client"];

const REGISTRATION_RETRY_MIN_MS = 500;
const REGISTRATION_RETRY_MAX_MS = 5_000;

export interface ShellProviderNative {
  parentWindow(): BrowserWindow | null;
  showOpenDialog(
    parent: BrowserWindow,
    options: OpenDialogOptions,
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
  /** GT-7 — Export…'s native save dialog (`filePath` is "" when cancelled). */
  showSaveDialog(
    parent: BrowserWindow,
    options: SaveDialogOptions,
  ): Promise<{ canceled: boolean; filePath: string }>;
  /** The user's Documents folder — where Export… first proposes to save. */
  documentsPath(): string;
  openExternal(url: string): Promise<void>;
  /** Show a path in the OS file manager (Electron's `shell.showItemInFolder`).
   * fieldd names only paths it owns: one of its inventoried installs, or (GT-7)
   * the terminal overlay the floor reports. */
  revealPath(path: string): void;
  captureArtifactPreview(
    params: ShellWebContentsCaptureArtifactPreviewParams,
    signal: AbortSignal,
  ): Promise<ShellWebContentsCaptureArtifactPreviewResult>;
  requestRendererReplacement(
    params: ShellRendererRequestReplacementParams,
  ): ShellRendererRequestReplacementResult | Promise<ShellRendererRequestReplacementResult>;
  // DT-1 — the live-surface authority (fieldd's SurfaceService is the sole
  // dispatcher; the broker has already validated params against contracts).
  enumerateSurfaceSources(
    params: ShellSurfacesEnumerateParams,
    signal: AbortSignal,
  ): Promise<ShellSurfacesEnumerateResult>;
  mintSurfaceTicket(params: ShellSurfacesMintParams): Promise<ShellSurfacesMintResult>;
  releaseSurface(params: ShellSurfacesReleaseParams): Promise<ShellSurfacesReleaseResult>;
}

interface ActiveCall {
  cancelled: boolean;
  controller: AbortController;
  method: ShellProviderCallParams["method"];
}

function safeProviderError(
  error: unknown,
  method: ShellProviderCallParams["method"],
): ShellProviderError {
  const kind =
    typeof error === "object" && error !== null && "kind" in error
      ? String((error as { kind: unknown }).kind)
      : "INTERNAL";
  const allowed = new Set([
    "UNAUTHORIZED",
    "FORBIDDEN_SCOPE",
    "NOT_FOUND",
    "CONFLICT",
    "PRECONDITION_FAILED",
    "UNAVAILABLE",
    "AUDIT_UNAVAILABLE",
    "TIMEOUT",
    "INCOMPATIBLE",
    "RESOURCE_EXHAUSTED",
    "INTERNAL",
  ]);
  return {
    kind: allowed.has(kind) ? (kind as ShellProviderError["kind"]) : "INTERNAL",
    message:
      kind === "CONFLICT"
        ? method === "shell.webcontents.captureArtifactPreview"
          ? "another preview capture is already running"
          : method === "shell.dialog.pickFolder"
            ? "another folder dialog is already open"
            : "another dialog is already open"
        : kind === "UNAVAILABLE"
          ? method === "shell.renderer.requestReplacement"
            ? "the exact renderer generation is unavailable"
            : method === "shell.webcontents.captureArtifactPreview"
              ? "preview capture is unavailable"
              : method.startsWith("shell.surfaces.")
                ? "the live-surface authority is unavailable"
                : "the primary window is unavailable"
          : kind === "RESOURCE_EXHAUSTED"
            ? "the preview could not fit within the image budget"
            : "the desktop operation failed",
    retryable: kind === "UNAVAILABLE" || kind === "TIMEOUT" || kind === "CONFLICT",
  };
}

/** Binds Electron main to every recovered fieldd handle. Notification handlers
 * are installed before registration, then survive reconnects on that client;
 * a replacement handle tears every old handler down by generation. */
export class RecoveringShellProvider {
  private generation = 0;
  private disposed = false;
  private registered = false;
  private registering = false;
  private registrationEpoch = 0;
  private registrationRetryMs = REGISTRATION_RETRY_MIN_MS;
  private registrationRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private dialogBusy = false;
  private captureBusy = false;
  private statusStop: Stop | null = null;
  private notificationStops: Stop[] = [];
  private readonly calls = new Map<string, ActiveCall>();
  private readonly stopHandleObservation: Stop;

  constructor(
    coordinator: FielddHandleCoordinator,
    private readonly native: ShellProviderNative,
    private readonly logger: Logger,
  ) {
    this.stopHandleObservation = coordinator.onHandle((handle) => this.bind(handle));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.stopHandleObservation();
    this.clearCurrent();
  }

  private bind(handle: FielddHandle): void {
    if (this.disposed) return;
    this.generation += 1;
    const generation = this.generation;
    this.clearCurrent();
    this.notificationStops = [
      handle.client.onNotification("shell.provider.call", (params) => {
        if (this.isCurrent(generation)) this.receiveCall(generation, handle.client, params);
      }),
      handle.client.onNotification("shell.provider.cancel", (params) => {
        if (this.isCurrent(generation)) this.receiveCancel(params);
      }),
    ];
    const publishStatus = () => {
      if (!this.isCurrent(generation)) return;
      if (handle.client.status !== "ready") {
        this.resetRegistration();
        this.cancelAll();
        return;
      }
      this.ensureRegistered(generation, handle.client);
    };
    this.statusStop = handle.client.onStatusChange(publishStatus);
    publishStatus();
  }

  private ensureRegistered(generation: number, client: Client): void {
    if (!this.isCurrent(generation) || this.registered || this.registering) return;
    const registrationEpoch = ++this.registrationEpoch;
    this.registering = true;
    void (async () => {
      try {
        const raw = await client.request("shell.provider.register", {
          methods: [...SHELL_PROVIDER_METHODS],
        });
        const result = ShellProviderRegisterResult.safeParse(raw);
        if (!result.success) throw new Error("fieldd returned an invalid registration result");
        if (
          !this.isCurrent(generation) ||
          this.registrationEpoch !== registrationEpoch ||
          client.status !== "ready"
        ) {
          return;
        }
        this.registering = false;
        this.registered = true;
        this.registrationRetryMs = REGISTRATION_RETRY_MIN_MS;
        this.logger.info(
          "desktop.shell_provider.registered",
          "Electron main registered its static shell provider",
          { methodCount: result.data.registered.length },
        );
      } catch (error) {
        if (
          !this.isCurrent(generation) ||
          this.registrationEpoch !== registrationEpoch ||
          client.status !== "ready"
        ) {
          return;
        }
        this.registering = false;
        this.registered = false;
        this.logger.error(
          "desktop.shell_provider.registration_failed",
          "Electron main could not register its static shell provider",
          error,
        );
        this.scheduleRegistrationRetry(generation, client);
      }
    })();
  }

  private scheduleRegistrationRetry(generation: number, client: Client): void {
    if (!this.isCurrent(generation) || client.status !== "ready") return;
    if (this.registrationRetryTimer !== null) return;
    const delay = this.registrationRetryMs;
    this.registrationRetryMs = Math.min(REGISTRATION_RETRY_MAX_MS, delay * 2);
    this.registrationRetryTimer = setTimeout(() => {
      this.registrationRetryTimer = null;
      this.ensureRegistered(generation, client);
    }, delay);
  }

  private resetRegistration(): void {
    this.registrationEpoch += 1;
    this.registered = false;
    this.registering = false;
    this.registrationRetryMs = REGISTRATION_RETRY_MIN_MS;
    if (this.registrationRetryTimer !== null) {
      clearTimeout(this.registrationRetryTimer);
      this.registrationRetryTimer = null;
    }
  }

  private receiveCall(generation: number, client: Client, raw: unknown): void {
    const parsed = ShellProviderCallParamsSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        "desktop.shell_provider.call_rejected",
        "fieldd sent an invalid shell-provider call",
        { issueCount: parsed.error.issues.length },
      );
      return;
    }
    const call = parsed.data;
    if (this.calls.has(call.callId)) return;
    const active: ActiveCall = {
      cancelled: false,
      controller: new AbortController(),
      method: call.method,
    };
    this.calls.set(call.callId, active);
    void this.execute(call, active.controller.signal).then(
      (result) => this.resolve(generation, client, call.callId, active, { result }),
      (error: unknown) =>
        this.resolve(generation, client, call.callId, active, {
          error: safeProviderError(error, call.method),
        }),
    );
  }

  private receiveCancel(raw: unknown): void {
    if (typeof raw !== "object" || raw === null || !("callId" in raw)) return;
    const callId = (raw as { callId?: unknown }).callId;
    if (typeof callId !== "string") return;
    const call = this.calls.get(callId);
    if (call === undefined) return;
    call.cancelled = true;
    call.controller.abort();
    this.calls.delete(callId);
  }

  private async execute(call: ShellProviderCallParams, signal: AbortSignal): Promise<unknown> {
    if (call.deadlineAt < Date.now()) {
      throw { kind: "TIMEOUT" };
    }
    if (call.method === "shell.renderer.requestReplacement") {
      const params = ShellRendererRequestReplacementParams.parse(call.params);
      return ShellRendererRequestReplacementResultSchema.parse(
        await this.native.requestRendererReplacement(params),
      );
    }
    if (call.method === "shell.openExternal") {
      const params = ShellOpenExternalParams.parse(call.params);
      await this.native.openExternal(params.url);
      return ShellOpenExternalResult.parse({ opened: true });
    }
    if (call.method === "shell.revealPath") {
      const params = ShellRevealPathParams.parse(call.params);
      this.native.revealPath(params.path);
      return ShellRevealPathResult.parse({ revealed: true });
    }
    // GT-8a (GT-D22) — a terminal link's web half. fieldd's door has already
    // classified the link; main re-checks the one rule it owns — an http(s)
    // URL in its canonical spelling, with no credentials — and hands exactly
    // that string to the default browser. A file link never arrives here: it
    // is revealed, never opened.
    if (call.method === "shell.openLink") {
      const params = ShellOpenLinkParams.safeParse(call.params);
      if (!params.success) throw { kind: "PRECONDITION_FAILED" };
      await this.native.openExternal(params.data.url);
      return ShellOpenLinkResult.parse({ opened: true });
    }
    if (call.method === "shell.webcontents.captureArtifactPreview") {
      const params = ShellWebContentsCaptureArtifactPreviewParams.parse(call.params);
      const parent = this.native.parentWindow();
      if (parent === null || parent.isDestroyed() || !parent.isVisible() || parent.isMinimized()) {
        throw { kind: "UNAVAILABLE" };
      }
      if (this.captureBusy) throw { kind: "CONFLICT" };
      this.captureBusy = true;
      try {
        return ShellWebContentsCaptureArtifactPreviewResultSchema.parse(
          await this.native.captureArtifactPreview(params, signal),
        );
      } finally {
        this.captureBusy = false;
      }
    }
    if (call.method === "shell.surfaces.enumerate") {
      const params = ShellSurfacesEnumerateParams.parse(call.params);
      return ShellSurfacesEnumerateResultSchema.parse(
        await this.native.enumerateSurfaceSources(params, signal),
      );
    }
    if (call.method === "shell.surfaces.mint") {
      const params = ShellSurfacesMintParams.parse(call.params);
      return ShellSurfacesMintResultSchema.parse(await this.native.mintSurfaceTicket(params));
    }
    if (call.method === "shell.surfaces.release") {
      const params = ShellSurfacesReleaseParams.parse(call.params);
      return ShellSurfacesReleaseResultSchema.parse(await this.native.releaseSurface(params));
    }
    // GT-7 — Settings → Terminal's Import file…: one FILE, and main hands back
    // only its path; fieldd reads it (bounded, UTF-8). Each verb is locked to
    // its one purpose, so anything else is refused before a dialog exists.
    if (call.method === "shell.dialog.pickFile") {
      const params = ShellDialogPickFileParams.safeParse(call.params);
      if (!params.success) throw { kind: "PRECONDITION_FAILED" };
      const { result, parentClosed } = await this.parentedDialog((parent) =>
        this.native.showOpenDialog(parent, {
          title: "Import a terminal configuration",
          buttonLabel: "Import",
          properties: ["openFile"],
        }),
      );
      if (parentClosed || result.canceled || result.filePaths.length !== 1) {
        return ShellDialogPickFileResult.parse({ canceled: true });
      }
      return ShellDialogPickFileResult.parse({ canceled: false, path: result.filePaths[0] });
    }
    // GT-7 — Export…: the dialog proposes Documents/<defaultName> (a bare name
    // by contract) and asks before replacing a file; fieldd writes it.
    if (call.method === "shell.dialog.saveFile") {
      const params = ShellDialogSaveFileParams.safeParse(call.params);
      if (!params.success) throw { kind: "PRECONDITION_FAILED" };
      const { result, parentClosed } = await this.parentedDialog((parent) =>
        this.native.showSaveDialog(parent, {
          title: "Export the terminal configuration",
          buttonLabel: "Export",
          defaultPath: join(this.native.documentsPath(), params.data.defaultName),
          properties: ["createDirectory", "showOverwriteConfirmation"],
        }),
      );
      if (parentClosed || result.canceled || result.filePath === "") {
        return ShellDialogSaveFileResult.parse({ canceled: true });
      }
      return ShellDialogSaveFileResult.parse({ canceled: false, path: result.filePath });
    }

    const params = ShellDialogPickFolderParams.parse(call.params);
    const { result, parentClosed } = await this.parentedDialog((parent) =>
      this.native.showOpenDialog(parent, {
        title:
          params.purpose === "workspace.export"
            ? "Choose a folder for Files"
            : "Choose a folder to publish",
        buttonLabel: "Choose Folder",
        properties:
          params.purpose === "workspace.export"
            ? ["openDirectory"]
            : ["openDirectory", "createDirectory"],
      }),
    );
    if (parentClosed || result.canceled || result.filePaths.length !== 1) {
      return ShellDialogPickFolderResult.parse({ canceled: true });
    }
    return ShellDialogPickFolderResult.parse({
      canceled: false,
      path: result.filePaths[0],
    });
  }

  /** The rules every native dialog here shares: one at a time (CONFLICT while
   * another is up), parented to the focused-else-primary window (UNAVAILABLE
   * without one), and a parent that closes while the dialog is up turns
   * whatever it answers into a cancel — the caller that asked is gone. */
  private async parentedDialog<T>(
    show: (parent: BrowserWindow) => Promise<T>,
  ): Promise<{ result: T; parentClosed: boolean }> {
    if (this.dialogBusy) throw { kind: "CONFLICT" };
    const parent = this.native.parentWindow();
    if (parent === null || parent.isDestroyed()) throw { kind: "UNAVAILABLE" };
    this.dialogBusy = true;
    let parentClosed = false;
    const onClosed = () => {
      parentClosed = true;
    };
    parent.once("closed", onClosed);
    try {
      const result = await show(parent);
      return { result, parentClosed };
    } finally {
      parent.removeListener("closed", onClosed);
      this.dialogBusy = false;
    }
  }

  private resolve(
    generation: number,
    client: Client,
    callId: string,
    active: ActiveCall,
    outcome: { result: unknown } | { error: ShellProviderError },
  ): void {
    if (!this.isCurrent(generation) || active.cancelled || this.calls.get(callId) !== active)
      return;
    this.calls.delete(callId);
    void client.request("shell.provider.resolve", { callId, outcome }).catch((error: unknown) => {
      if (!this.isCurrent(generation)) return;
      this.logger.error(
        "desktop.shell_provider.resolve_failed",
        "Electron main could not resolve a shell-provider call",
        error,
        { method: active.method },
      );
    });
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && this.generation === generation;
  }

  private cancelAll(): void {
    for (const call of this.calls.values()) {
      call.cancelled = true;
      call.controller.abort();
    }
    this.calls.clear();
  }

  private clearCurrent(): void {
    this.resetRegistration();
    this.cancelAll();
    const statusStop = this.statusStop;
    this.statusStop = null;
    try {
      statusStop?.();
    } catch {
      // teardown is best-effort; replacement must continue
    }
    for (const stop of this.notificationStops.splice(0)) {
      try {
        stop();
      } catch {
        // teardown is best-effort; replacement must continue
      }
    }
  }
}
