import { IPC_CHANNELS, LOG_TRANSPORT_LIMITS } from "@vibefield/contracts";
import {
  type LogIngressRecordV1,
  type PluginLogProvenanceV1,
  type RendererLogBatchV1 as RendererLogBatch,
  RendererLogBatchV1,
  type RendererLogDropCountsV1,
} from "@vibefield/contracts/logging";
import type { Logger, NodeLogging, PluginLogRouter } from "@vibefield/logging";
import {
  type BrowserWindow,
  MessageChannelMain,
  type MessagePortMain,
  type RenderProcessGoneDetails,
} from "electron";
import type { RendererPluginResolver } from "./plugin-provenance";

type RejectionReason =
  | "non-string"
  | "oversized"
  | "invalid-json"
  | "invalid-batch"
  | "rate"
  | "plugin-route"
  | "plugin-pending-overflow";

interface PendingPluginRecord {
  readonly record: LogIngressRecordV1;
  readonly observedTime: number;
  readonly rendererPid: number;
  readonly bytes: number;
}

type BatchAdmission = "normal" | "high-severity-reserve";

export interface RendererIngressHealth {
  readonly acceptedBatches: number;
  readonly acceptedHighSeverityReserveBatches: number;
  readonly acceptedRecords: number;
  readonly rendererDropped: number;
  readonly pendingPluginRecords: number;
  readonly pendingPluginBytes: number;
  readonly rejected: Readonly<Record<RejectionReason, number>>;
}

export class RendererLogIngress {
  private envelopeTokens: number = LOG_TRANSPORT_LIMITS.RENDERER_ENVELOPE_BATCHES_PER_SECOND;
  private normalBatchTokens: number = LOG_TRANSPORT_LIMITS.RENDERER_BATCHES_PER_SECOND;
  private highSeverityBatchTokens: number =
    LOG_TRANSPORT_LIMITS.RENDERER_HIGH_SEVERITY_BATCHES_PER_SECOND;
  private lastRefill: number;
  private acceptedBatches = 0;
  private acceptedHighSeverityReserveBatches = 0;
  private acceptedRecords = 0;
  private rendererDropped = 0;
  private rejected: Record<RejectionReason, number> = {
    "non-string": 0,
    oversized: 0,
    "invalid-json": 0,
    "invalid-batch": 0,
    rate: 0,
    "plugin-route": 0,
    "plugin-pending-overflow": 0,
  };
  private readonly pendingPluginRecords: PendingPluginRecord[] = [];
  private pendingPluginBytes = 0;
  private readonly stopResolver: (() => void) | null;
  private lastRejectionLogAt = Number.NEGATIVE_INFINITY;
  private disposed = false;

  constructor(
    private readonly options: {
      sink: NodeLogging;
      desktopLogger: Logger;
      windowId: string;
      webContentsId: number;
      rendererPid: () => number;
      pluginRouter?: PluginLogRouter;
      pluginResolver?: RendererPluginResolver;
      now?: () => number;
    },
  ) {
    this.lastRefill = this.now();
    this.stopResolver =
      options.pluginResolver?.onChange(() => this.flushPendingPluginRecords()) ?? null;
  }

  accept(raw: unknown): void {
    if (this.disposed) return;
    if (typeof raw !== "string") {
      this.reject("non-string");
      return;
    }
    if (raw.length > LOG_TRANSPORT_LIMITS.RENDERER_BATCH_BYTES) {
      this.reject("oversized");
      return;
    }
    const bytes = Buffer.byteLength(raw, "utf8");
    if (bytes > LOG_TRANSPORT_LIMITS.RENDERER_BATCH_BYTES) {
      this.reject("oversized");
      return;
    }
    // Charge the envelope before JSON parsing/schema work. A compromised
    // renderer cannot bypass the host's CPU budget by flooding malformed JSON.
    if (!this.takeEnvelopeToken()) {
      this.reject("rate");
      return;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      this.reject("invalid-json");
      return;
    }
    const parsed = RendererLogBatchV1.safeParse(decoded);
    if (!parsed.success) {
      this.reject("invalid-batch");
      return;
    }
    const admission = this.takeBatchAdmission(parsed.data);
    if (admission === null) {
      this.reject("rate");
      return;
    }
    const observedTime = this.now();
    const rendererPid = Math.max(0, this.options.rendererPid());
    const hostDropped: RendererLogDropCountsV1 = {
      trace: 0,
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      fatal: 0,
    };
    const records =
      admission === "normal"
        ? parsed.data.records
        : parsed.data.records.filter((record) => {
            const preserved = record.level === "error" || record.level === "fatal";
            if (!preserved) hostDropped[record.level] += 1;
            return preserved;
          });
    for (const record of records) {
      this.routeRecord(record, observedTime, rendererPid);
    }
    const dropped: RendererLogDropCountsV1 = {
      trace: Math.min(
        Number.MAX_SAFE_INTEGER,
        (parsed.data.dropped?.trace ?? 0) + hostDropped.trace,
      ),
      debug: Math.min(
        Number.MAX_SAFE_INTEGER,
        (parsed.data.dropped?.debug ?? 0) + hostDropped.debug,
      ),
      info: Math.min(Number.MAX_SAFE_INTEGER, (parsed.data.dropped?.info ?? 0) + hostDropped.info),
      warn: Math.min(Number.MAX_SAFE_INTEGER, (parsed.data.dropped?.warn ?? 0) + hostDropped.warn),
      error: Math.min(
        Number.MAX_SAFE_INTEGER,
        (parsed.data.dropped?.error ?? 0) + hostDropped.error,
      ),
      fatal: Math.min(
        Number.MAX_SAFE_INTEGER,
        (parsed.data.dropped?.fatal ?? 0) + hostDropped.fatal,
      ),
    };
    const count = Object.values(dropped).reduce(
      (sum, value) => Math.min(Number.MAX_SAFE_INTEGER, sum + value),
      0,
    );
    if (count > 0) {
      this.rendererDropped += count;
      this.options.sink.ingest({
        time: observedTime,
        observedTime,
        level: "warn",
        event: "renderer.logging.records_dropped",
        message: "The renderer logging transport dropped records under pressure",
        component: "renderer.transport",
        attrs: {
          ...dropped,
          ...(admission === "high-severity-reserve"
            ? { hostRateLimited: Object.values(hostDropped).reduce((sum, value) => sum + value, 0) }
            : {}),
          webContentsId: this.options.webContentsId,
          rendererPid,
        },
        windowId: this.options.windowId,
        pid: rendererPid,
      });
    }
    this.acceptedBatches += 1;
    if (admission === "high-severity-reserve") {
      this.acceptedHighSeverityReserveBatches += 1;
    }
    this.acceptedRecords += records.length;
  }

  dispose(): void {
    this.disposed = true;
    this.stopResolver?.();
    this.pendingPluginRecords.length = 0;
    this.pendingPluginBytes = 0;
    this.options.pluginRouter?.releaseWindow(this.options.windowId);
  }

  health(): RendererIngressHealth {
    return {
      acceptedBatches: this.acceptedBatches,
      acceptedHighSeverityReserveBatches: this.acceptedHighSeverityReserveBatches,
      acceptedRecords: this.acceptedRecords,
      rendererDropped: this.rendererDropped,
      pendingPluginRecords: this.pendingPluginRecords.length,
      pendingPluginBytes: this.pendingPluginBytes,
      rejected: { ...this.rejected },
    };
  }

  private routeRecord(record: LogIngressRecordV1, observedTime: number, rendererPid: number): void {
    if (record.pluginId === undefined) {
      this.options.sink.ingest({
        time: record.time,
        observedTime,
        level: record.level,
        event: record.event,
        message: record.msg,
        component: record.component,
        ...(record.err !== undefined ? { error: record.err } : {}),
        attrs: {
          ...(record.attrs ?? {}),
          webContentsId: this.options.webContentsId,
          rendererPid,
        },
        bindings: {
          ...(record.traceId !== undefined ? { traceId: record.traceId } : {}),
          ...(record.spanId !== undefined ? { spanId: record.spanId } : {}),
          ...(record.operationId !== undefined ? { operationId: record.operationId } : {}),
          ...(record.requestId !== undefined ? { requestId: record.requestId } : {}),
          ...(record.sessionId !== undefined ? { sessionId: record.sessionId } : {}),
          ...(record.docId !== undefined ? { docId: record.docId } : {}),
          ...(record.deviceId !== undefined ? { deviceId: record.deviceId } : {}),
        },
        windowId: this.options.windowId,
        pid: rendererPid,
        ...(record.truncation !== undefined ? { truncation: record.truncation } : {}),
      });
      return;
    }

    const resolution = this.options.pluginResolver?.resolve(record.pluginId, this.options.windowId);
    if (resolution === undefined) {
      this.reject("plugin-route");
      return;
    }
    if (resolution.kind === "pending") {
      this.queuePendingPluginRecord(record, observedTime, rendererPid);
      return;
    }
    if (resolution.kind === "rejected") {
      this.reject("plugin-route");
      return;
    }
    this.forwardPluginRecord(record, observedTime, rendererPid, resolution.provenance);
  }

  private forwardPluginRecord(
    record: LogIngressRecordV1,
    observedTime: number,
    rendererPid: number,
    provenance: PluginLogProvenanceV1,
  ): void {
    if (
      this.options.pluginRouter === undefined ||
      record.level === "trace" ||
      record.level === "fatal"
    ) {
      this.reject("plugin-route");
      return;
    }
    this.options.pluginRouter.accept(provenance, {
      time: record.time,
      observedTime,
      level: record.level,
      event: "plugin.log",
      message: record.msg,
      fields: {
        ...(record.attrs ?? {}),
        webContentsId: this.options.webContentsId,
        rendererPid,
      },
      pid: rendererPid,
      ...(record.truncation !== undefined ? { truncation: record.truncation } : {}),
    });
  }

  private queuePendingPluginRecord(
    record: LogIngressRecordV1,
    observedTime: number,
    rendererPid: number,
  ): void {
    const bytes = Buffer.byteLength(JSON.stringify(record), "utf8");
    if (
      this.pendingPluginRecords.length + 1 > LOG_TRANSPORT_LIMITS.RENDERER_QUEUE_RECORDS ||
      this.pendingPluginBytes + bytes > LOG_TRANSPORT_LIMITS.RENDERER_QUEUE_BYTES
    ) {
      this.reject("plugin-pending-overflow");
      return;
    }
    this.pendingPluginRecords.push({ record, observedTime, rendererPid, bytes });
    this.pendingPluginBytes += bytes;
  }

  private flushPendingPluginRecords(): void {
    if (this.disposed || this.options.pluginResolver === undefined) return;
    const retained: PendingPluginRecord[] = [];
    let retainedBytes = 0;
    for (const pending of this.pendingPluginRecords) {
      const pluginId = pending.record.pluginId;
      if (pluginId === undefined) continue;
      const resolution = this.options.pluginResolver.resolve(pluginId, this.options.windowId);
      if (resolution.kind === "pending") {
        retained.push(pending);
        retainedBytes += pending.bytes;
      } else if (resolution.kind === "rejected") {
        this.reject("plugin-route");
      } else {
        this.forwardPluginRecord(
          pending.record,
          pending.observedTime,
          pending.rendererPid,
          resolution.provenance,
        );
      }
    }
    this.pendingPluginRecords.splice(0, this.pendingPluginRecords.length, ...retained);
    this.pendingPluginBytes = retainedBytes;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private refillRateTokens(): void {
    const now = this.now();
    const elapsed = Math.max(0, now - this.lastRefill);
    this.envelopeTokens = Math.min(
      LOG_TRANSPORT_LIMITS.RENDERER_ENVELOPE_BATCHES_PER_SECOND,
      this.envelopeTokens +
        (elapsed * LOG_TRANSPORT_LIMITS.RENDERER_ENVELOPE_BATCHES_PER_SECOND) / 1_000,
    );
    this.normalBatchTokens = Math.min(
      LOG_TRANSPORT_LIMITS.RENDERER_BATCHES_PER_SECOND,
      this.normalBatchTokens + (elapsed * LOG_TRANSPORT_LIMITS.RENDERER_BATCHES_PER_SECOND) / 1_000,
    );
    this.highSeverityBatchTokens = Math.min(
      LOG_TRANSPORT_LIMITS.RENDERER_HIGH_SEVERITY_BATCHES_PER_SECOND,
      this.highSeverityBatchTokens +
        (elapsed * LOG_TRANSPORT_LIMITS.RENDERER_HIGH_SEVERITY_BATCHES_PER_SECOND) / 1_000,
    );
    this.lastRefill = now;
  }

  private takeEnvelopeToken(): boolean {
    this.refillRateTokens();
    if (this.envelopeTokens < 1) return false;
    this.envelopeTokens -= 1;
    return true;
  }

  private takeBatchAdmission(batch: RendererLogBatch): BatchAdmission | null {
    if (this.normalBatchTokens >= 1) {
      this.normalBatchTokens -= 1;
      return "normal";
    }
    const hasHighSeverity =
      batch.records.some((record) => record.level === "error" || record.level === "fatal") ||
      (batch.dropped?.error ?? 0) > 0 ||
      (batch.dropped?.fatal ?? 0) > 0;
    if (!hasHighSeverity || this.highSeverityBatchTokens < 1) return null;
    this.highSeverityBatchTokens -= 1;
    return "high-severity-reserve";
  }

  private reject(reason: RejectionReason): void {
    this.rejected[reason] += 1;
    const now = this.now();
    if (now - this.lastRejectionLogAt < 60_000) return;
    this.lastRejectionLogAt = now;
    this.options.desktopLogger.warn(
      "desktop.renderer.log_batch_rejected",
      "Electron rejected a renderer logging batch",
      {
        reason,
        windowId: this.options.windowId,
        webContentsId: this.options.webContentsId,
        rejected: { ...this.rejected },
      },
    );
  }
}

export function installRendererLogging(options: {
  window: BrowserWindow;
  sink: NodeLogging;
  pluginRouter: PluginLogRouter;
  pluginResolver: RendererPluginResolver;
  desktopLogger: Logger;
}): () => void {
  const win = options.window;
  const webContents = win.webContents;
  const windowId = String(win.id);
  const logger = options.desktopLogger.child({ component: "renderer.lifecycle", windowId });
  let port: MessagePortMain | null = null;
  let ingress: RendererLogIngress | null = null;
  let generation = 0;
  let disposed = false;
  const rendererPid = (): number => {
    try {
      return Math.max(0, webContents.getOSProcessId());
    } catch {
      return 0;
    }
  };

  const closePort = (): void => {
    ingress?.dispose();
    ingress = null;
    const current = port;
    port = null;
    try {
      current?.close();
    } catch {
      // The renderer process already disconnected.
    }
  };

  const openPort = (): void => {
    if (disposed || webContents.isDestroyed()) return;
    closePort();
    generation += 1;
    const channel = new MessageChannelMain();
    port = channel.port1;
    ingress = new RendererLogIngress({
      sink: options.sink,
      desktopLogger: logger,
      windowId,
      webContentsId: webContents.id,
      rendererPid,
      pluginRouter: options.pluginRouter,
      pluginResolver: options.pluginResolver,
    });
    const currentIngress = ingress;
    channel.port1.on("message", (event) => currentIngress.accept(event.data));
    channel.port1.on("close", () => currentIngress.dispose());
    channel.port1.start();
    try {
      webContents.postMessage(IPC_CHANNELS.rendererLogPort, null, [channel.port2]);
    } catch (error) {
      closePort();
      logger.error(
        "desktop.renderer.log_port_failed",
        "Electron could not transfer the renderer logging port",
        error,
        { generation, webContentsId: webContents.id },
      );
      return;
    }
    logger.info("desktop.renderer.log_port_opened", "Renderer logging port opened", {
      generation,
      webContentsId: webContents.id,
      rendererPid: rendererPid(),
    });
  };

  const onPreloadError = (_event: Electron.Event, _preloadPath: string, error: Error): void => {
    logger.error("desktop.renderer.preload_failed", "Renderer preload failed", error, {
      webContentsId: webContents.id,
    });
  };
  const onProcessGone = (_event: Electron.Event, details: RenderProcessGoneDetails): void => {
    closePort();
    logger.error(
      "desktop.renderer.process_gone",
      "Renderer process exited unexpectedly",
      undefined,
      {
        reason: details.reason,
        exitCode: details.exitCode,
        webContentsId: webContents.id,
      },
    );
  };
  const onUnresponsive = (): void => {
    logger.warn("desktop.renderer.unresponsive", "Renderer became unresponsive", {
      webContentsId: webContents.id,
    });
  };
  const onResponsive = (): void => {
    logger.info("desktop.renderer.responsive", "Renderer became responsive again", {
      webContentsId: webContents.id,
    });
  };
  const onReadyToShow = (): void => {
    logger.info("desktop.window.ready", "Window is ready to show", {
      webContentsId: webContents.id,
    });
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    closePort();
    webContents.off("did-finish-load", openPort);
    webContents.off("preload-error", onPreloadError);
    webContents.off("render-process-gone", onProcessGone);
    webContents.off("unresponsive", onUnresponsive);
    webContents.off("responsive", onResponsive);
    webContents.off("destroyed", onDestroyed);
    win.off("ready-to-show", onReadyToShow);
    win.off("closed", onClosed);
  };
  const onClosed = (): void => {
    logger.info("desktop.window.closed", "Window closed", {
      webContentsId: webContents.id,
    });
    dispose();
  };
  const onDestroyed = (): void => {
    logger.info("desktop.renderer.web_contents_destroyed", "Renderer WebContents was destroyed", {
      webContentsId: webContents.id,
    });
    dispose();
  };

  webContents.on("did-finish-load", openPort);
  webContents.on("preload-error", onPreloadError);
  webContents.on("render-process-gone", onProcessGone);
  webContents.on("unresponsive", onUnresponsive);
  webContents.on("responsive", onResponsive);
  webContents.once("destroyed", onDestroyed);
  win.on("ready-to-show", onReadyToShow);
  win.on("closed", onClosed);
  logger.info("desktop.window.created", "Window created", {
    webContentsId: webContents.id,
  });
  return dispose;
}
