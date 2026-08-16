import { randomBytes } from "node:crypto";
import {
  type LiveSurfaceErrorV1,
  LiveSurfaceFrameEnvelopeV1,
  type LiveSurfacePortBootstrapV1,
  LiveSurfaceRendererControlMessageV1,
  LiveSurfaceRuntimeSummaryV1,
} from "@vibefield/contracts";
import type {
  LiveSurfaceCpuFrame,
  LiveSurfaceRuntimeAttachment,
  LiveSurfaceRuntimeAuthority,
} from "./runtime";
import { dropLiveSurfaceTextureFrame, type LiveSurfaceTextureFrameSink } from "./texture-forwarder";
import {
  type LiveSurfacePresentationOperation,
  LiveSurfaceTicketError,
  type LiveSurfaceTicketTable,
} from "./ticket-table";

export interface LiveSurfaceMainPortMessageEvent {
  readonly data: unknown;
}

export interface LiveSurfaceMainMessagePort {
  on(event: "message", listener: (event: LiveSurfaceMainPortMessageEvent) => void): this;
  on(event: "close", listener: () => void): this;
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
}

interface ManagedAttachment {
  readonly runtime: LiveSurfaceRuntimeAttachment;
  readonly textureSink: LiveSurfaceTextureFrameSink | null;
  active: boolean;
}

export interface LiveSurfaceControlSessionOptions {
  readonly senderWebContentsId: number;
  readonly bootstrap: LiveSurfacePortBootstrapV1;
  readonly port: LiveSurfaceMainMessagePort;
  readonly tickets: LiveSurfaceTicketTable<LiveSurfaceRuntimeAuthority>;
  readonly publishCpuFrame: (attachmentId: string, frame: LiveSurfaceCpuFrame) => boolean;
  readonly createTextureSink?: (
    surfaceId: string,
    attachmentId: string,
  ) => LiveSurfaceTextureFrameSink;
  readonly randomAttachmentId?: () => string;
  readonly maxAttachments?: number;
  readonly onProtocolFault?: (reason: string) => void;
  readonly onClosed?: () => void;
}

function hostError(
  code: LiveSurfaceErrorV1["code"],
  message: string,
  recovery: LiveSurfaceErrorV1["recovery"],
): LiveSurfaceErrorV1 {
  return { code, message, recovery };
}

/** One main-side control session, bounded to one renderer generation. */
export class LiveSurfaceControlSession {
  readonly #attachments = new Map<string, ManagedAttachment>();
  readonly #randomAttachmentId: () => string;
  readonly #maxAttachments: number;
  #closed = false;

  constructor(readonly options: LiveSurfaceControlSessionOptions) {
    this.#randomAttachmentId =
      options.randomAttachmentId ?? (() => `attachment_${randomBytes(24).toString("base64url")}`);
    this.#maxAttachments = options.maxAttachments ?? 64;
    if (this.#maxAttachments <= 0) throw new RangeError("attachment capacity must be positive");
  }

  get closed(): boolean {
    return this.#closed;
  }

  get attachmentCount(): number {
    return this.#attachments.size;
  }

  start(): void {
    if (this.#closed) throw new Error("cannot start a closed live surface control session");
    this.options.port.on("message", (event) => this.accept(event.data));
    this.options.port.on("close", () => this.dispose());
    this.options.port.start();
    this.post({ v: 1, type: "ready", bootstrap: this.options.bootstrap });
  }

  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const [attachmentId, attachment] of this.#attachments) {
      attachment.active = false;
      this.#attachments.delete(attachmentId);
      try {
        attachment.runtime.dispose();
      } catch {
        // Renderer-generation teardown must continue through every attachment.
      }
      attachment.textureSink?.close();
    }
    try {
      this.options.port.close();
    } catch {
      // The renderer process already disconnected.
    }
    this.options.onClosed?.();
  }

  private accept(raw: unknown): void {
    if (this.#closed) return;
    const parsed = LiveSurfaceRendererControlMessageV1.safeParse(raw);
    if (!parsed.success) {
      this.protocolFault("malformed renderer control message");
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case "attach":
        this.attach(message.requestId, message.ticket);
        return;
      case "demand": {
        const attachment = this.#attachments.get(message.attachmentId);
        if (attachment === undefined || !attachment.active) {
          this.protocolFault("demand named an unknown attachment");
          return;
        }
        try {
          attachment.runtime.setDemand(message.demand);
        } catch {
          this.protocolFault("runtime rejected a validated demand update");
        }
        return;
      }
      case "detach":
        this.detach(message.attachmentId, true);
    }
  }

  private attach(requestId: string, ticket: unknown): void {
    if (this.#attachments.size >= this.#maxAttachments) {
      this.reject(
        requestId,
        hostError("security-rejected", "live surface attachment capacity reached", "automatic"),
      );
      return;
    }
    let authority: LiveSurfaceRuntimeAuthority;
    let operations: readonly LiveSurfacePresentationOperation[];
    try {
      const redeemed = this.options.tickets.redeem(ticket, {
        senderWebContentsId: this.options.senderWebContentsId,
        rendererGeneration: this.options.bootstrap.rendererGeneration,
      });
      authority = redeemed.authority;
      operations = redeemed.operations;
      if (authority.surfaceId !== redeemed.surfaceId) {
        throw new LiveSurfaceTicketError("invalid");
      }
    } catch {
      this.reject(
        requestId,
        hostError("security-rejected", "live surface attachment ticket was rejected", "permanent"),
      );
      return;
    }

    let attachmentId: string;
    try {
      attachmentId = this.uniqueAttachmentId();
    } catch {
      this.reject(
        requestId,
        hostError("protocol-violation", "could not allocate an attachment identity", "automatic"),
      );
      return;
    }

    const queuedSummaries: LiveSurfaceRuntimeSummaryV1[] = [];
    let managed: ManagedAttachment | null = null;
    let textureSink: LiveSurfaceTextureFrameSink | null = null;
    try {
      textureSink = this.options.createTextureSink?.(authority.surfaceId, attachmentId) ?? null;
      const runtime = authority.attach({
        attachmentId,
        rendererGeneration: this.options.bootstrap.rendererGeneration,
        operations,
        publishSummary: (rawSummary) => {
          const summary = LiveSurfaceRuntimeSummaryV1.parse(rawSummary);
          if (summary.surfaceId !== authority.surfaceId) {
            this.protocolFault("runtime summary crossed surface identity");
            return;
          }
          if (managed === null) queuedSummaries.push(summary);
          else if (managed.active) this.post({ v: 1, type: "summary", attachmentId, summary });
        },
        publishCpuFrame: (frame) => {
          if (managed === null || !managed.active || this.#closed) return false;
          return this.options.publishCpuFrame(attachmentId, frame);
        },
        offerTextureFrame: (frame) => {
          if (managed === null || !managed.active || this.#closed || textureSink === null) {
            return dropLiveSurfaceTextureFrame(frame, "closed");
          }
          return textureSink.offer(frame);
        },
      });
      const summary = LiveSurfaceRuntimeSummaryV1.parse(runtime.summary);
      if (summary.surfaceId !== authority.surfaceId) {
        runtime.dispose();
        throw new Error("runtime summary surface mismatch");
      }
      if (this.#closed) {
        runtime.dispose();
        throw new Error("renderer generation closed while source attached");
      }
      managed = { runtime, textureSink, active: true };
      this.#attachments.set(attachmentId, managed);
      this.post({
        v: 1,
        type: "attached",
        requestId,
        attachment: { v: 1, attachmentId, summary },
      });
      for (const queued of queuedSummaries) {
        this.post({ v: 1, type: "summary", attachmentId, summary: queued });
      }
    } catch {
      if (managed !== null) managed.active = false;
      this.#attachments.delete(attachmentId);
      try {
        managed?.runtime.dispose();
      } catch {
        // Preserve the bounded rejection path.
      }
      textureSink?.close();
      this.reject(
        requestId,
        hostError("source-not-found", "live surface source could not attach", "user-action"),
      );
    }
  }

  private detach(attachmentId: string, acknowledge: boolean): void {
    const attachment = this.#attachments.get(attachmentId);
    if (attachment !== undefined) {
      attachment.active = false;
      this.#attachments.delete(attachmentId);
      try {
        attachment.runtime.dispose();
      } catch {
        // Detach remains idempotent and tears down the registry entry first.
      }
      attachment.textureSink?.close();
    }
    if (acknowledge) this.post({ v: 1, type: "detached", attachmentId });
  }

  private uniqueAttachmentId(): string {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = this.#randomAttachmentId();
      if (/^[A-Za-z0-9_-]{16,128}$/u.test(candidate) && !this.#attachments.has(candidate)) {
        return candidate;
      }
    }
    throw new Error("could not mint a unique attachment identity");
  }

  private reject(requestId: string, error: LiveSurfaceErrorV1): void {
    this.post({ v: 1, type: "rejected", requestId, error });
  }

  private protocolFault(reason: string): void {
    this.options.onProtocolFault?.(reason);
    this.dispose();
  }

  private post(message: unknown): void {
    if (this.#closed) return;
    try {
      this.options.port.postMessage(message);
    } catch {
      this.dispose();
    }
  }
}

export function validateCpuFrameEnvelope(
  attachmentId: string,
  frame: LiveSurfaceCpuFrame,
): { readonly type: "cpu-frame"; readonly envelope: unknown; readonly pixels: Uint8Array } | null {
  const metadata = frame.metadata;
  if (metadata.transport !== "cpu-bgra" || metadata.degradedMode !== "cpu-bitmap") return null;
  if (metadata.pixelFormat !== "bgra" && metadata.pixelFormat !== "rgba") return null;
  const { width, height } = metadata.geometry.codedSize;
  if (frame.pixels.byteLength !== width * height * 4) return null;
  if (frame.pixels.byteLength > 16 * 1024 * 1024) return null;
  const envelope = LiveSurfaceFrameEnvelopeV1.safeParse({
    v: 1,
    attachmentId,
    metadata,
  });
  if (!envelope.success) return null;
  return { type: "cpu-frame", envelope: envelope.data, pixels: frame.pixels };
}
