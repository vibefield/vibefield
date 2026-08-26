export const STUDIO_PROTOCOL_VERSION = 1 as const;
export const MAX_APPEARANCE_BYTES = 64 * 1024;
export const MAX_PUBLISHES_PER_SECOND = 120;

export type AppearanceRejectCode = "invalid-document" | "stale-revision";
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
  | { type: "appearance.clear"; requestId: string };

export type HostToProduct =
  | { type: "appearance.apply"; revision: number; serialized: string }
  | { type: "appearance.clear"; revision: number; reason: AppearanceClearReason };

export type ProductToHost =
  | { type: "product.ready"; protocol: typeof STUDIO_PROTOCOL_VERSION; instanceId: string }
  | { type: "appearance.applied"; revision: number }
  | {
      type: "appearance.rejected";
      revision: number;
      code: AppearanceRejectCode;
    };

export interface StudioStatus {
  productConnected: boolean;
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
    };

export type StudioProtocolErrorCode =
  | "malformed"
  | "oversized"
  | "rate-limited"
  | "version-mismatch";

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
      };
    case "appearance.applied":
      return { type: "appearance.applied", revision: revision(message["revision"]) };
    case "appearance.rejected":
      return {
        type: "appearance.rejected",
        revision: revision(message["revision"]),
        code: rejectCode(message["code"]),
      };
    default:
      throw new StudioProtocolError("malformed");
  }
}

export function parseHostToProduct(raw: unknown): HostToProduct {
  const message = record(raw);
  switch (message["type"]) {
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
          productConnected: booleanValue(status["productConnected"]),
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
