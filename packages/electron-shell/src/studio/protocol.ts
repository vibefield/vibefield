export const STUDIO_PROTOCOL_VERSION = 3 as const;
export const MAX_APPEARANCE_BYTES = 64 * 1024;
export const MAX_PUBLISHES_PER_SECOND = 120;

export type AppearanceRejectCode = "invalid-document" | "stale-revision";
export type ProductConnectionState = "unavailable" | "connecting" | "connected" | "reconnecting";
export type StudioSection = "design" | "appearance";
export interface ProductContext {
  theme: "light" | "dark";
  zoom: number;
}
export type AppearanceClearReason =
  | "live-disabled"
  | "studio-closed"
  | "studio-crashed"
  | "studio-timeout"
  | "protocol-error"
  | "host-disposed";

export type StudioToHost =
  | { type: "studio.ready"; protocol: typeof STUDIO_PROTOCOL_VERSION }
  | { type: "appearance.publish"; requestId: string; serialized: string }
  | { type: "appearance.clear"; requestId: string }
  | { type: "product.focus"; requestId: string };

export type HostToProduct =
  | {
      type: "product.connect";
      protocol: typeof STUDIO_PROTOCOL_VERSION;
      connectionId: string;
    }
  | { type: "appearance.apply"; revision: number; serialized: string }
  | { type: "appearance.clear"; revision: number; reason: AppearanceClearReason };

export type ProductToHost =
  | {
      type: "product.ready";
      protocol: typeof STUDIO_PROTOCOL_VERSION;
      instanceId: string;
      connectionId: string;
    }
  | { type: "appearance.applied"; revision: number; instanceId: string }
  | {
      type: "appearance.rejected";
      revision: number;
      code: AppearanceRejectCode;
      instanceId: string;
    }
  | ({ type: "product.context" } & ProductContext);

export interface StudioStatus {
  productConnection: ProductConnectionState;
  live: boolean;
  revision: number | null;
  appliedRevision: number | null;
  rejection: AppearanceRejectCode | null;
}

export type HostToStudio =
  | { type: "studio.status"; status: StudioStatus }
  | { type: "appearance.accepted"; requestId: string; revision: number }
  | { type: "appearance.applied"; revision: number }
  | {
      type: "appearance.rejected";
      revision: number;
      code: AppearanceRejectCode;
    }
  | {
      type: "studio.snapshot";
      revision: number | null;
      serialized: string | null;
      live: boolean;
    }
  | ({ type: "product.context" } & ProductContext)
  | { type: "studio.navigate"; section: StudioSection }
  | { type: "studio.disconnected"; reason: StudioDisconnectReason };

export type StudioProtocolErrorCode =
  | "malformed"
  | "oversized"
  | "rate-limited"
  | "version-mismatch";
export type StudioDisconnectReason = StudioProtocolErrorCode | "transport-closed";

export class StudioProtocolError extends Error {
  constructor(readonly code: StudioProtocolErrorCode) {
    super(`Studio protocol rejected ${code}`);
    this.name = "StudioProtocolError";
  }
}

export function serializedAppearanceBytes(serialized: string): number {
  return new TextEncoder().encode(serialized).byteLength;
}

export function assertSerializedAppearance(serialized: unknown): string {
  if (typeof serialized !== "string" || serialized.length === 0) {
    throw new StudioProtocolError("malformed");
  }
  if (serializedAppearanceBytes(serialized) > MAX_APPEARANCE_BYTES) {
    throw new StudioProtocolError("oversized");
  }
  return serialized;
}

export function parseStudioToHost(raw: unknown): StudioToHost {
  const message = record(raw);
  switch (message["type"]) {
    case "studio.ready":
      if (message["protocol"] !== STUDIO_PROTOCOL_VERSION) {
        throw new StudioProtocolError("version-mismatch");
      }
      return { type: "studio.ready", protocol: STUDIO_PROTOCOL_VERSION };
    case "appearance.publish":
      return {
        type: "appearance.publish",
        requestId: requestId(message["requestId"]),
        serialized: assertSerializedAppearance(message["serialized"]),
      };
    case "appearance.clear":
      return { type: "appearance.clear", requestId: requestId(message["requestId"]) };
    case "product.focus":
      return { type: "product.focus", requestId: requestId(message["requestId"]) };
    default:
      throw new StudioProtocolError("malformed");
  }
}

export function parseProductToHost(raw: unknown): ProductToHost {
  const message = record(raw);
  switch (message["type"]) {
    case "product.ready":
      if (message["protocol"] !== STUDIO_PROTOCOL_VERSION) {
        throw new StudioProtocolError("version-mismatch");
      }
      return {
        type: "product.ready",
        protocol: STUDIO_PROTOCOL_VERSION,
        instanceId: identifier(message["instanceId"]),
        connectionId: identifier(message["connectionId"]),
      };
    case "appearance.applied":
      return {
        type: "appearance.applied",
        revision: revision(message["revision"]),
        instanceId: identifier(message["instanceId"]),
      };
    case "appearance.rejected":
      return {
        type: "appearance.rejected",
        revision: revision(message["revision"]),
        code: rejectCode(message["code"]),
        instanceId: identifier(message["instanceId"]),
      };
    case "product.context":
      return { type: "product.context", ...productContext(message) };
    default:
      throw new StudioProtocolError("malformed");
  }
}

export function parseHostToProduct(raw: unknown): HostToProduct {
  const message = record(raw);
  switch (message["type"]) {
    case "product.connect":
      if (message["protocol"] !== STUDIO_PROTOCOL_VERSION) {
        throw new StudioProtocolError("version-mismatch");
      }
      return {
        type: "product.connect",
        protocol: STUDIO_PROTOCOL_VERSION,
        connectionId: identifier(message["connectionId"]),
      };
    case "appearance.apply":
      return {
        type: "appearance.apply",
        revision: revision(message["revision"]),
        serialized: assertSerializedAppearance(message["serialized"]),
      };
    case "appearance.clear":
      return {
        type: "appearance.clear",
        revision: revision(message["revision"]),
        reason: clearReason(message["reason"]),
      };
    default:
      throw new StudioProtocolError("malformed");
  }
}

export function parseHostToStudio(raw: unknown): HostToStudio {
  const message = record(raw);
  switch (message["type"]) {
    case "studio.status": {
      const status = record(message["status"]);
      return {
        type: "studio.status",
        status: {
          productConnection: productConnection(status["productConnection"]),
          live: booleanValue(status["live"]),
          revision: nullableRevision(status["revision"]),
          appliedRevision: nullableRevision(status["appliedRevision"]),
          rejection: status["rejection"] === null ? null : rejectCode(status["rejection"]),
        },
      };
    }
    case "appearance.accepted":
      return {
        type: "appearance.accepted",
        requestId: requestId(message["requestId"]),
        revision: revision(message["revision"]),
      };
    case "appearance.applied":
      return { type: "appearance.applied", revision: revision(message["revision"]) };
    case "appearance.rejected":
      return {
        type: "appearance.rejected",
        revision: revision(message["revision"]),
        code: rejectCode(message["code"]),
      };
    case "studio.snapshot":
      return {
        type: "studio.snapshot",
        revision: nullableRevision(message["revision"]),
        serialized:
          message["serialized"] === null ? null : assertSerializedAppearance(message["serialized"]),
        live: booleanValue(message["live"]),
      };
    case "product.context":
      return { type: "product.context", ...productContext(message) };
    case "studio.navigate":
      return { type: "studio.navigate", section: studioSection(message["section"]) };
    case "studio.disconnected":
      return { type: "studio.disconnected", reason: disconnectReason(message["reason"]) };
    default:
      throw new StudioProtocolError("malformed");
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StudioProtocolError("malformed");
  }
  return value as Record<string, unknown>;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,64}$/.test(value)) {
    throw new StudioProtocolError("malformed");
  }
  return value;
}

function requestId(value: unknown): string {
  return identifier(value);
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new StudioProtocolError("malformed");
  }
  return value as number;
}

function nullableRevision(value: unknown): number | null {
  return value === null ? null : revision(value);
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") throw new StudioProtocolError("malformed");
  return value;
}

function productConnection(value: unknown): ProductConnectionState {
  if (
    value !== "unavailable" &&
    value !== "connecting" &&
    value !== "connected" &&
    value !== "reconnecting"
  ) {
    throw new StudioProtocolError("malformed");
  }
  return value;
}

function productContext(value: Record<string, unknown>): ProductContext {
  const theme = value["theme"];
  const zoom = value["zoom"];
  if (
    (theme !== "light" && theme !== "dark") ||
    typeof zoom !== "number" ||
    !Number.isFinite(zoom)
  ) {
    throw new StudioProtocolError("malformed");
  }
  if (zoom <= 0 || zoom > 100) throw new StudioProtocolError("malformed");
  return { theme, zoom };
}

function studioSection(value: unknown): StudioSection {
  if (value !== "design" && value !== "appearance") {
    throw new StudioProtocolError("malformed");
  }
  return value;
}

function disconnectReason(value: unknown): StudioDisconnectReason {
  if (
    value !== "malformed" &&
    value !== "oversized" &&
    value !== "rate-limited" &&
    value !== "version-mismatch" &&
    value !== "transport-closed"
  ) {
    throw new StudioProtocolError("malformed");
  }
  return value;
}

function rejectCode(value: unknown): AppearanceRejectCode {
  if (value !== "invalid-document" && value !== "stale-revision") {
    throw new StudioProtocolError("malformed");
  }
  return value;
}

function clearReason(value: unknown): AppearanceClearReason {
  if (
    value !== "live-disabled" &&
    value !== "studio-closed" &&
    value !== "studio-crashed" &&
    value !== "studio-timeout" &&
    value !== "protocol-error" &&
    value !== "host-disposed"
  ) {
    throw new StudioProtocolError("malformed");
  }
  return value;
}
