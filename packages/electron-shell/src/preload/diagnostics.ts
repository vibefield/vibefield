import { LOG_TRANSPORT_LIMITS } from "@vibefield/contracts";
import {
  type CrashArtifactListV1 as CrashArtifactList,
  CrashArtifactListV1,
  CrashArtifactViewedV1,
  type DiagnosticLeaseV1 as DiagnosticLease,
  type DiagnosticLeaseCreateV1 as DiagnosticLeaseCreate,
  DiagnosticLeaseCreateV1,
  type DiagnosticLeaseListV1 as DiagnosticLeaseList,
  DiagnosticLeaseListV1,
  DiagnosticLeaseRevokeV1,
  DiagnosticLeaseV1,
  type DiagnosticLogDeltaV1 as DiagnosticLogDelta,
  DiagnosticLogDeltaV1,
  DiagnosticLogQueryV1,
  type DiagnosticLogSnapshotV1 as DiagnosticLogSnapshot,
  DiagnosticLogSnapshotV1,
  type SupportBundleExportResultV1 as SupportBundleExportResult,
  SupportBundleExportResultV1,
  SupportBundleExportV1,
  type SupportBundlePreviewV1 as SupportBundlePreview,
  SupportBundlePreviewV1,
  SupportBundleSelectionV1,
} from "@vibefield/contracts/diagnostics";

const MAX_PENDING = 16;
const REQUEST_TIMEOUT_MS = 15_000;

export interface DiagnosticsRendererPort {
  postMessage(message: string): void;
  start(): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onmessageerror?: (() => void) | null;
}

interface PendingRequest {
  raw: string;
  sent: boolean;
  resolve(value: unknown): void;
  reject(error: DiagnosticsBridgeError): void;
  timer: ReturnType<typeof setTimeout>;
}

interface ResponseEnvelope {
  v: 1;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    kind?: unknown;
    message?: unknown;
  };
}

interface EventEnvelope {
  v: 1;
  kind: "event";
  subId: string;
  eventKind: "delta" | "snapshot";
  payload: unknown;
}

export type LocalDiagnosticEvent =
  | { kind: "delta"; payload: DiagnosticLogDelta }
  | { kind: "snapshot"; payload: DiagnosticLogSnapshot };

export interface LocalDiagnosticSubscription {
  subId: string;
  snapshot: DiagnosticLogSnapshot;
}

export class DiagnosticsBridgeError extends Error {
  constructor(
    readonly kind:
      | "DISCONNECTED"
      | "INTERNAL"
      | "INVALID_RESPONSE"
      | "PRECONDITION_FAILED"
      | "RESOURCE_EXHAUSTED"
      | "TIMEOUT"
      | string,
    message: string,
  ) {
    super(message);
    this.name = "DiagnosticsBridgeError";
  }
}

function parseIncoming(raw: unknown): ResponseEnvelope | EventEnvelope | null {
  if (typeof raw !== "string") return null;
  if (
    new TextEncoder().encode(raw).byteLength > LOG_TRANSPORT_LIMITS.DIAGNOSTIC_PORT_RESPONSE_BYTES
  ) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<ResponseEnvelope & EventEnvelope>;
    if (value.v !== 1) return null;
    if (
      value.kind === "event" &&
      typeof value.subId === "string" &&
      (value.eventKind === "delta" || value.eventKind === "snapshot")
    ) {
      return value as EventEnvelope;
    }
    if (
      typeof value.id === "string" &&
      typeof value.ok === "boolean" &&
      (value.ok ||
        (typeof value.error === "object" &&
          value.error !== null &&
          typeof value.error.message === "string"))
    ) {
      return value as ResponseEnvelope;
    }
    return null;
  } catch {
    return null;
  }
}

function parseRemoved(raw: unknown): { removed: boolean } {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("removed" in raw) ||
    typeof raw.removed !== "boolean"
  ) {
    throw new DiagnosticsBridgeError("INVALID_RESPONSE", "invalid unsubscribe response");
  }
  return { removed: raw.removed };
}

function parseRevoked(raw: unknown): { revoked: boolean } {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("revoked" in raw) ||
    typeof raw.revoked !== "boolean"
  ) {
    throw new DiagnosticsBridgeError("INVALID_RESPONSE", "invalid lease revoke response");
  }
  return { revoked: raw.revoked };
}

/** Preload-owned request broker for the one host diagnostics MessagePort.
 * The page receives typed functions only; port lifecycle and envelopes remain
 * entirely inside the isolated preload world. */
export class PreloadDiagnosticsBridge {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscriptions = new Map<string, (event: LocalDiagnosticEvent) => void>();
  private port: DiagnosticsRendererPort | null = null;
  private nextRequest = 1;
  private closed = false;

  attach(port: DiagnosticsRendererPort): void {
    if (this.closed) {
      port.close();
      return;
    }
    if (this.port !== null) {
      this.detach(
        new DiagnosticsBridgeError(
          "DISCONNECTED",
          "the diagnostics port was replaced by a new renderer generation",
        ),
      );
    }
    this.port = port;
    port.onmessage = (event) => this.accept(event.data);
    port.onmessageerror = () =>
      this.detach(new DiagnosticsBridgeError("DISCONNECTED", "diagnostics port failed"));
    port.start();
    for (const request of this.pending.values()) this.send(request);
  }

  async query(raw: unknown): Promise<DiagnosticLogSnapshot> {
    const query = DiagnosticLogQueryV1.parse(raw);
    return DiagnosticLogSnapshotV1.parse(await this.request("query", query));
  }

  async subscribe(
    raw: unknown,
    onEvent: (event: LocalDiagnosticEvent) => void,
  ): Promise<LocalDiagnosticSubscription> {
    const query = DiagnosticLogQueryV1.parse(raw);
    const response = await this.request("subscribe", query);
    if (typeof response !== "object" || response === null) {
      throw new DiagnosticsBridgeError("INVALID_RESPONSE", "invalid subscription response");
    }
    const subId = "subId" in response ? response.subId : undefined;
    const snapshot = "snapshot" in response ? response.snapshot : undefined;
    if (typeof subId !== "string" || subId.length < 1 || subId.length > 64) {
      throw new DiagnosticsBridgeError("INVALID_RESPONSE", "invalid diagnostics subscription id");
    }
    let parsed: DiagnosticLogSnapshot;
    try {
      parsed = DiagnosticLogSnapshotV1.parse(snapshot);
    } catch {
      void this.request("unsubscribe", { subId }).catch(() => undefined);
      throw new DiagnosticsBridgeError(
        "INVALID_RESPONSE",
        "invalid diagnostics subscription snapshot",
      );
    }
    this.subscriptions.set(subId, onEvent);
    return { subId, snapshot: parsed };
  }

  async unsubscribe(subId: string): Promise<{ removed: boolean }> {
    if (subId.length < 1 || subId.length > 64) {
      throw new DiagnosticsBridgeError("PRECONDITION_FAILED", "invalid subscription id");
    }
    this.subscriptions.delete(subId);
    return parseRemoved(await this.request("unsubscribe", { subId }));
  }

  async createLease(raw: unknown): Promise<DiagnosticLease> {
    const request = DiagnosticLeaseCreateV1.parse(raw) as DiagnosticLeaseCreate;
    return DiagnosticLeaseV1.parse(await this.request("lease.create", request));
  }

  async listLeases(): Promise<DiagnosticLeaseList> {
    return DiagnosticLeaseListV1.parse(await this.request("lease.list"));
  }

  async revokeLease(raw: unknown): Promise<{ revoked: boolean }> {
    const request = DiagnosticLeaseRevokeV1.parse(raw);
    return parseRevoked(await this.request("lease.revoke", request));
  }

  async openLogs(): Promise<void> {
    const response = await this.request("logs.open");
    if (
      typeof response !== "object" ||
      response === null ||
      !("opened" in response) ||
      response.opened !== true
    ) {
      throw new DiagnosticsBridgeError("INVALID_RESPONSE", "invalid open-logs response");
    }
  }

  async listCrashes(): Promise<CrashArtifactList> {
    return CrashArtifactListV1.parse(await this.request("crashes.list"));
  }

  async markCrashViewed(raw: unknown): Promise<{ viewed: boolean }> {
    const request = CrashArtifactViewedV1.parse(raw);
    const response = await this.request("crashes.viewed", request);
    if (
      typeof response !== "object" ||
      response === null ||
      !("viewed" in response) ||
      typeof response.viewed !== "boolean"
    ) {
      throw new DiagnosticsBridgeError("INVALID_RESPONSE", "invalid crash-viewed response");
    }
    return { viewed: response.viewed };
  }

  async previewSupport(raw: unknown): Promise<SupportBundlePreview> {
    const selection = SupportBundleSelectionV1.parse(raw);
    return SupportBundlePreviewV1.parse(await this.request("support.preview", selection));
  }

  async exportSupport(raw: unknown): Promise<SupportBundleExportResult> {
    const request = SupportBundleExportV1.parse(raw);
    return SupportBundleExportResultV1.parse(await this.request("support.export", request));
  }

  async copyText(text: unknown): Promise<void> {
    if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > 64 * 1024) {
      throw new DiagnosticsBridgeError(
        "PRECONDITION_FAILED",
        "clipboard text is invalid or too large",
      );
    }
    const response = await this.request("clipboard.copy", { text });
    if (
      typeof response !== "object" ||
      response === null ||
      !("copied" in response) ||
      response.copied !== true
    ) {
      throw new DiagnosticsBridgeError("INVALID_RESPONSE", "invalid clipboard response");
    }
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(
        new DiagnosticsBridgeError("DISCONNECTED", "diagnostics bridge is closed"),
      );
    }
    if (this.pending.size >= MAX_PENDING) {
      return Promise.reject(
        new DiagnosticsBridgeError("RESOURCE_EXHAUSTED", "too many diagnostics requests"),
      );
    }
    const id = `preload-${this.nextRequest++}`;
    const raw = JSON.stringify({ v: 1, id, method, ...(params === undefined ? {} : { params }) });
    if (
      new TextEncoder().encode(raw).byteLength > LOG_TRANSPORT_LIMITS.DIAGNOSTIC_PORT_REQUEST_BYTES
    ) {
      return Promise.reject(
        new DiagnosticsBridgeError("RESOURCE_EXHAUSTED", "diagnostics request is too large"),
      );
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new DiagnosticsBridgeError("TIMEOUT", "diagnostics request timed out"));
      }, REQUEST_TIMEOUT_MS);
      const request: PendingRequest = {
        raw,
        sent: false,
        resolve,
        reject,
        timer,
      };
      this.pending.set(id, request);
      this.send(request);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.detach(new DiagnosticsBridgeError("DISCONNECTED", "diagnostics bridge is closed"));
  }

  health(): { connected: boolean; pendingRequests: number; subscriptions: number } {
    return {
      connected: this.port !== null,
      pendingRequests: this.pending.size,
      subscriptions: this.subscriptions.size,
    };
  }

  private send(request: PendingRequest): void {
    if (request.sent || this.port === null) return;
    try {
      this.port.postMessage(request.raw);
      request.sent = true;
    } catch {
      this.detach(new DiagnosticsBridgeError("DISCONNECTED", "diagnostics port disconnected"));
    }
  }

  private accept(raw: unknown): void {
    const envelope = parseIncoming(raw);
    if (envelope === null) {
      this.detach(
        new DiagnosticsBridgeError("INVALID_RESPONSE", "main sent invalid diagnostics data"),
      );
      return;
    }
    if ("kind" in envelope && envelope.kind === "event") {
      const listener = this.subscriptions.get(envelope.subId);
      if (listener === undefined) return;
      try {
        if (envelope.eventKind === "delta") {
          listener({ kind: "delta", payload: DiagnosticLogDeltaV1.parse(envelope.payload) });
        } else {
          listener({
            kind: "snapshot",
            payload: DiagnosticLogSnapshotV1.parse(envelope.payload),
          });
        }
      } catch {
        this.subscriptions.delete(envelope.subId);
        void this.request("unsubscribe", { subId: envelope.subId }).catch(() => undefined);
      }
      return;
    }
    if (!("id" in envelope)) return;
    const request = this.pending.get(envelope.id);
    if (request === undefined) return;
    this.pending.delete(envelope.id);
    clearTimeout(request.timer);
    if (envelope.ok) {
      request.resolve(envelope.result);
      return;
    }
    const kind = typeof envelope.error?.kind === "string" ? envelope.error.kind : "INTERNAL";
    const message =
      typeof envelope.error?.message === "string"
        ? envelope.error.message
        : "diagnostics request failed";
    request.reject(new DiagnosticsBridgeError(kind, message));
  }

  private detach(error: DiagnosticsBridgeError): void {
    const current = this.port;
    this.port = null;
    if (current !== null) {
      current.onmessage = null;
      current.onmessageerror = null;
      try {
        current.close();
      } catch {
        // The main-process half is already gone.
      }
    }
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.subscriptions.clear();
  }
}
