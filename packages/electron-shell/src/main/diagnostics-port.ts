import { IPC_CHANNELS, LOG_TRANSPORT_LIMITS } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { type BrowserWindow, MessageChannelMain, type MessagePortMain } from "electron";
import type { ElectronLocalDiagnostics } from "./local-diagnostics";

const METHODS = new Set([
  "query",
  "subscribe",
  "unsubscribe",
  "lease.create",
  "lease.list",
  "lease.revoke",
  "logs.open",
  "support.preview",
  "support.export",
  "crashes.list",
  "crashes.viewed",
]);
const MAX_INFLIGHT = 16;
const MAX_SUBSCRIPTIONS = 4;

interface RequestEnvelope {
  v: 1;
  id: string;
  method: string;
  params?: unknown;
}

interface PortLike {
  postMessage(message: string): void;
  start(): void;
  close(): void;
  on(event: "message", listener: (event: { data: unknown }) => void): unknown;
  on(event: "close", listener: () => void): unknown;
}

export interface DiagnosticsHostActions {
  openLogs?(): Promise<unknown> | unknown;
  previewSupport?(params: unknown): Promise<unknown> | unknown;
  exportSupport?(params: unknown): Promise<unknown> | unknown;
  listCrashes?(): Promise<unknown> | unknown;
  markCrashViewed?(params: unknown): Promise<unknown> | unknown;
}

function parseRequest(raw: unknown): RequestEnvelope | null {
  if (typeof raw !== "string") return null;
  if (Buffer.byteLength(raw, "utf8") > LOG_TRANSPORT_LIMITS.DIAGNOSTIC_PORT_REQUEST_BYTES) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<RequestEnvelope>;
    if (
      value.v !== 1 ||
      typeof value.id !== "string" ||
      value.id.length < 1 ||
      value.id.length > 64 ||
      typeof value.method !== "string" ||
      !METHODS.has(value.method)
    ) {
      return null;
    }
    return value as RequestEnvelope;
  } catch {
    return null;
  }
}

function safeError(error: unknown): { kind: string; message: string } {
  const kind =
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    typeof (error as { kind?: unknown }).kind === "string"
      ? (error as { kind: string }).kind
      : "INTERNAL";
  const message =
    error instanceof Error && error.message.length <= 500
      ? error.message
      : "local diagnostics request failed";
  return { kind, message };
}

function recordsAt(message: Record<string, unknown>): {
  records: unknown[];
  replace: (records: unknown[], removed: number) => Record<string, unknown>;
} | null {
  const result = message["result"] as Record<string, unknown> | undefined;
  const payload = message["payload"] as Record<string, unknown> | undefined;
  if (Array.isArray(result?.["records"])) {
    return {
      records: result["records"],
      replace: (records, removed) => ({
        ...message,
        result: { ...result, records, transportTruncatedRecords: removed },
      }),
    };
  }
  const snapshot = result?.["snapshot"] as Record<string, unknown> | undefined;
  if (Array.isArray(snapshot?.["records"])) {
    return {
      records: snapshot["records"],
      replace: (records, removed) => ({
        ...message,
        result: {
          ...result,
          snapshot: { ...snapshot, records, transportTruncatedRecords: removed },
        },
      }),
    };
  }
  if (Array.isArray(payload?.["records"])) {
    return {
      records: payload["records"],
      replace: (records, removed) => ({
        ...message,
        payload: { ...payload, records, transportTruncatedRecords: removed },
      }),
    };
  }
  return null;
}

function serializeBounded(message: Record<string, unknown>): string {
  const serialized = JSON.stringify(message);
  const limit = LOG_TRANSPORT_LIMITS.DIAGNOSTIC_PORT_RESPONSE_BYTES;
  if (Buffer.byteLength(serialized, "utf8") <= limit) return serialized;
  const target = recordsAt(message);
  if (target === null) {
    return JSON.stringify({
      v: 1,
      id: message["id"],
      ok: false,
      error: { kind: "RESOURCE_EXHAUSTED", message: "diagnostic response exceeded its byte cap" },
    });
  }

  let low = 0;
  let high = target.records.length;
  let best: string | null = null;
  while (low <= high) {
    const removed = Math.floor((low + high) / 2);
    const candidate = JSON.stringify(target.replace(target.records.slice(removed), removed));
    if (Buffer.byteLength(candidate, "utf8") <= limit) {
      best = candidate;
      high = removed - 1;
    } else {
      low = removed + 1;
    }
  }
  return (
    best ??
    JSON.stringify({
      v: 1,
      id: message["id"],
      ok: false,
      error: { kind: "RESOURCE_EXHAUSTED", message: "diagnostic record exceeded its byte cap" },
    })
  );
}

/** One WebContents-generation session. Exported for boundary/flood tests. */
export class DiagnosticsPortSession {
  private readonly subscriptions = new Map<string, () => void>();
  private inflight = 0;
  private nextSubscription = 1;
  private closed = false;

  constructor(
    private readonly port: PortLike,
    private readonly diagnostics: ElectronLocalDiagnostics,
    private readonly actions: DiagnosticsHostActions,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.port.on("message", (event) => this.accept(event.data));
    this.port.on("close", () => this.close());
    this.port.start();
  }

  accept(raw: unknown): void {
    if (this.closed) return;
    const request = parseRequest(raw);
    if (request === null) {
      this.logger.warn(
        "desktop.diagnostics.request_rejected",
        "Electron rejected a malformed local diagnostics request",
      );
      return;
    }
    if (this.inflight >= MAX_INFLIGHT) {
      this.replyError(request.id, "RESOURCE_EXHAUSTED", "too many diagnostics requests");
      return;
    }
    this.inflight += 1;
    void this.execute(request)
      .catch((error) => {
        const safe = safeError(error);
        this.replyError(request.id, safe.kind, safe.message);
      })
      .finally(() => {
        this.inflight -= 1;
      });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const dispose of this.subscriptions.values()) dispose();
    this.subscriptions.clear();
    try {
      this.port.close();
    } catch {
      // The renderer generation is already gone.
    }
  }

  private async execute(request: RequestEnvelope): Promise<void> {
    switch (request.method) {
      case "query":
        this.reply(request.id, await this.diagnostics.query(request.params));
        return;
      case "subscribe": {
        if (this.subscriptions.size >= MAX_SUBSCRIPTIONS) {
          this.replyError(request.id, "RESOURCE_EXHAUSTED", "too many diagnostics subscriptions");
          return;
        }
        const subId = `local-${this.nextSubscription++}`;
        const subscription = await this.diagnostics.subscribe(request.params, (payload, kind) => {
          if (!this.closed && this.subscriptions.has(subId)) {
            this.post({ v: 1, kind: "event", subId, eventKind: kind, payload });
          }
        });
        this.subscriptions.set(subId, subscription.dispose);
        this.reply(request.id, { subId, snapshot: subscription.snapshot });
        return;
      }
      case "unsubscribe": {
        const subId = (request.params as { subId?: unknown } | undefined)?.subId;
        if (typeof subId !== "string") {
          this.replyError(request.id, "PRECONDITION_FAILED", "expected { subId }");
          return;
        }
        const dispose = this.subscriptions.get(subId);
        if (dispose !== undefined) {
          this.subscriptions.delete(subId);
          dispose();
        }
        this.reply(request.id, { removed: dispose !== undefined });
        return;
      }
      case "lease.create":
        this.reply(request.id, this.diagnostics.createLease(request.params));
        return;
      case "lease.list":
        this.reply(request.id, this.diagnostics.listLeases());
        return;
      case "lease.revoke":
        this.reply(request.id, this.diagnostics.revokeLease(request.params));
        return;
      case "logs.open":
        this.reply(request.id, await this.requireAction("openLogs")());
        return;
      case "support.preview":
        this.reply(request.id, await this.requireAction("previewSupport")(request.params));
        return;
      case "support.export":
        this.reply(request.id, await this.requireAction("exportSupport")(request.params));
        return;
      case "crashes.list":
        this.reply(request.id, await this.requireAction("listCrashes")());
        return;
      case "crashes.viewed":
        this.reply(request.id, await this.requireAction("markCrashViewed")(request.params));
        return;
    }
  }

  private requireAction<K extends keyof DiagnosticsHostActions>(
    name: K,
  ): NonNullable<DiagnosticsHostActions[K]> {
    const action = this.actions[name];
    if (action === undefined) {
      throw Object.assign(new Error(`${String(name)} is unavailable`), { kind: "NOT_FOUND" });
    }
    return action as NonNullable<DiagnosticsHostActions[K]>;
  }

  private reply(id: string, result: unknown): void {
    this.post({ v: 1, id, ok: true, result });
  }

  private replyError(id: string, kind: string, message: string): void {
    this.post({ v: 1, id, ok: false, error: { kind, message } });
  }

  private post(message: Record<string, unknown>): void {
    if (this.closed) return;
    try {
      this.port.postMessage(serializeBounded(message));
    } catch {
      this.close();
    }
  }
}

export function installLocalDiagnosticsPort(options: {
  window: BrowserWindow;
  diagnostics: ElectronLocalDiagnostics;
  actions?: DiagnosticsHostActions;
  logger: Logger;
}): () => void {
  const webContents = options.window.webContents;
  let port: MessagePortMain | null = null;
  let session: DiagnosticsPortSession | null = null;
  let disposed = false;
  let generation = 0;

  const closePort = (): void => {
    session?.close();
    session = null;
    port = null;
  };
  const openPort = (): void => {
    if (disposed || webContents.isDestroyed()) return;
    closePort();
    generation += 1;
    const channel = new MessageChannelMain();
    port = channel.port1;
    session = new DiagnosticsPortSession(
      channel.port1,
      options.diagnostics,
      options.actions ?? {},
      options.logger,
    );
    session.start();
    try {
      webContents.postMessage(IPC_CHANNELS.diagnosticsPort, null, [channel.port2]);
    } catch (error) {
      closePort();
      options.logger.error(
        "desktop.diagnostics.port_failed",
        "Electron could not transfer the host diagnostics port",
        error,
        { generation, webContentsId: webContents.id },
      );
      return;
    }
    options.logger.info("desktop.diagnostics.port_opened", "The host diagnostics port opened", {
      generation,
      webContentsId: webContents.id,
    });
  };
  const onNavigation = (
    _event: Electron.Event,
    _url: string,
    isInPlace: boolean,
    isMainFrame: boolean,
  ): void => {
    if (isMainFrame && !isInPlace) closePort();
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    closePort();
    webContents.off("did-finish-load", openPort);
    webContents.off("did-start-navigation", onNavigation);
    webContents.off("destroyed", dispose);
  };

  webContents.on("did-finish-load", openPort);
  webContents.on("did-start-navigation", onNavigation);
  webContents.once("destroyed", dispose);
  if (!webContents.isLoadingMainFrame()) openPort();
  return dispose;
}
