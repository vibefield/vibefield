import {
  SHELL_PROVIDER_METHODS,
  ShellDialogPickFolderParams,
  ShellDialogPickFolderResult,
  ShellOpenExternalParams,
  ShellOpenExternalResult,
  type ShellProviderCallParams,
  ShellProviderCallParams as ShellProviderCallParamsSchema,
  type ShellProviderError,
  ShellProviderRegisterResult,
  ShellWebContentsCaptureArtifactPreviewParams,
  type ShellWebContentsCaptureArtifactPreviewResult,
  ShellWebContentsCaptureArtifactPreviewResult as ShellWebContentsCaptureArtifactPreviewResultSchema,
} from "@vibefield/contracts";
import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import type { Logger } from "@vibefield/logging";
import type { BrowserWindow, OpenDialogOptions } from "electron";
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
  openExternal(url: string): Promise<void>;
  captureArtifactPreview(
    params: ShellWebContentsCaptureArtifactPreviewParams,
    signal: AbortSignal,
  ): Promise<ShellWebContentsCaptureArtifactPreviewResult>;
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
          : "another folder dialog is already open"
        : kind === "UNAVAILABLE"
          ? method === "shell.webcontents.captureArtifactPreview"
            ? "preview capture is unavailable"
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
    if (call.method === "shell.openExternal") {
      const params = ShellOpenExternalParams.parse(call.params);
      await this.native.openExternal(params.url);
      return ShellOpenExternalResult.parse({ opened: true });
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

    const params = ShellDialogPickFolderParams.parse(call.params);
    if (params.purpose !== "artifact.publish") throw { kind: "PRECONDITION_FAILED" };
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
      const result = await this.native.showOpenDialog(parent, {
        title: "Choose a folder to publish",
        buttonLabel: "Choose Folder",
        properties: ["openDirectory", "createDirectory"],
      });
      if (parentClosed || result.canceled || result.filePaths.length !== 1) {
        return ShellDialogPickFolderResult.parse({ canceled: true });
      }
      return ShellDialogPickFolderResult.parse({
        canceled: false,
        path: result.filePaths[0],
      });
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
