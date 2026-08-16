import { z } from "zod";

// LSF-1 — wire-only Live Surfaces vocabulary. This module deliberately names
// no Electron, DOM, WebGPU, IOSurface, or native-handle object. Those resources
// ride direct process-local lanes; only bounded metadata crosses here.

export const LIVE_SURFACE_PROTOCOL_VERSION_V1 = 1 as const;
export const LIVE_SURFACE_MAX_DIMENSION = 16_384;
export const LIVE_SURFACE_MAX_PIXELS = 67_108_864;
export const LIVE_SURFACE_PORT_BRIDGE_MESSAGE_V1 = "vibefield:live-surfaces:ports-v1";

/** Monotonic local revision that remains exactly representable in JSON/JavaScript. */
export const LiveSurfaceRevisionV1 = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export type LiveSurfaceRevisionV1 = z.infer<typeof LiveSurfaceRevisionV1>;

function hasNoControlCharacters(value: string): boolean {
  return ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

const LiveSurfaceBoundedTextV1 = z
  .string()
  .min(1)
  .max(512)
  .refine(hasNoControlCharacters, "control characters are forbidden");
const LiveSurfaceUrlV1 = z
  .string()
  .min(1)
  .max(8_192)
  .refine(hasNoControlCharacters, "control characters are forbidden");

/** Ephemeral local runtime identity. Durable document identity is a separate layer. */
export const LiveSurfaceIdV1 = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);
export type LiveSurfaceIdV1 = z.infer<typeof LiveSurfaceIdV1>;

/** One renderer-generation reference to a local runtime. */
export const LiveSurfaceAttachmentIdV1 = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);
export type LiveSurfaceAttachmentIdV1 = z.infer<typeof LiveSurfaceAttachmentIdV1>;

/** Correlation only; possession grants no authority. */
export const LiveSurfaceRequestIdV1 = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);
export type LiveSurfaceRequestIdV1 = z.infer<typeof LiveSurfaceRequestIdV1>;

/** Decimal u64: JSON/native-safe on the wire, bigint inside the runtime. */
export const LiveSurfaceSequenceV1 = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,19})$/u)
  .refine((value) => BigInt(value) <= 0xffff_ffff_ffff_ffffn, "must fit an unsigned u64");
export type LiveSurfaceSequenceV1 = z.infer<typeof LiveSurfaceSequenceV1>;

export const LiveSurfacePixelSizeV1 = z
  .object({
    width: z.number().int().positive().max(LIVE_SURFACE_MAX_DIMENSION),
    height: z.number().int().positive().max(LIVE_SURFACE_MAX_DIMENSION),
  })
  .passthrough()
  .superRefine((size, context) => {
    if (size.width * size.height > LIVE_SURFACE_MAX_PIXELS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `pixel area exceeds ${LIVE_SURFACE_MAX_PIXELS}`,
      });
    }
  });
export type LiveSurfacePixelSizeV1 = z.infer<typeof LiveSurfacePixelSizeV1>;

export const LiveSurfaceLogicalSizeV1 = z
  .object({
    width: z.number().finite().positive().max(32_768),
    height: z.number().finite().positive().max(32_768),
  })
  .passthrough();
export type LiveSurfaceLogicalSizeV1 = z.infer<typeof LiveSurfaceLogicalSizeV1>;

export const LiveSurfacePixelRectV1 = z
  .object({
    x: z.number().int().nonnegative().max(LIVE_SURFACE_MAX_DIMENSION),
    y: z.number().int().nonnegative().max(LIVE_SURFACE_MAX_DIMENSION),
    width: z.number().int().positive().max(LIVE_SURFACE_MAX_DIMENSION),
    height: z.number().int().positive().max(LIVE_SURFACE_MAX_DIMENSION),
  })
  .passthrough();
export type LiveSurfacePixelRectV1 = z.infer<typeof LiveSurfacePixelRectV1>;

/** ScreenCaptureKit source rectangles are expressed in points and may be fractional. */
export const LiveSurfaceSourceRectV1 = z
  .object({
    x: z.number().finite().nonnegative().max(32_768),
    y: z.number().finite().nonnegative().max(32_768),
    width: z.number().finite().positive().max(32_768),
    height: z.number().finite().positive().max(32_768),
  })
  .passthrough();
export type LiveSurfaceSourceRectV1 = z.infer<typeof LiveSurfaceSourceRectV1>;

export const LiveSurfaceOrientationV1 = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);
export type LiveSurfaceOrientationV1 = z.infer<typeof LiveSurfaceOrientationV1>;

export const LiveSurfaceGeometryV1 = z
  .object({
    revision: LiveSurfaceRevisionV1,
    codedSize: LiveSurfacePixelSizeV1,
    visibleRect: LiveSurfacePixelRectV1,
    logicalSize: LiveSurfaceLogicalSizeV1,
    orientation: LiveSurfaceOrientationV1,
  })
  .passthrough()
  .superRefine((geometry, context) => {
    if (geometry.visibleRect.x + geometry.visibleRect.width > geometry.codedSize.width) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visibleRect", "width"],
        message: "visible rectangle exceeds coded width",
      });
    }
    if (geometry.visibleRect.y + geometry.visibleRect.height > geometry.codedSize.height) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visibleRect", "height"],
        message: "visible rectangle exceeds coded height",
      });
    }
  });
export type LiveSurfaceGeometryV1 = z.infer<typeof LiveSurfaceGeometryV1>;

export const LiveSurfaceCropV1 = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }).passthrough(),
  z.object({ mode: z.literal("auto") }).passthrough(),
  z
    .object({
      mode: z.literal("explicit"),
      sourceRect: LiveSurfaceSourceRectV1,
    })
    .passthrough(),
]);
export type LiveSurfaceCropV1 = z.infer<typeof LiveSurfaceCropV1>;

export const LiveSurfaceBrowserSourceV1 = z
  .object({
    kind: z.literal("browser"),
    initialUrl: LiveSurfaceUrlV1,
    profile: z
      .object({
        mode: z.enum(["persistent", "memory"]),
        ref: LiveSurfaceBoundedTextV1,
      })
      .passthrough(),
    logicalViewport: LiveSurfaceLogicalSizeV1,
    deviceScaleFactor: z.number().finite().positive().max(8).optional(),
  })
  .passthrough();
export type LiveSurfaceBrowserSourceV1 = z.infer<typeof LiveSurfaceBrowserSourceV1>;

export const LiveSurfaceSckWindowSourceV1 = z
  .object({
    kind: z.literal("sck-window"),
    /** Opaque enumeration result, never durable truth or capture authority by itself. */
    sourceRef: LiveSurfaceBoundedTextV1,
    crop: LiveSurfaceCropV1.optional(),
    captureCursor: z.boolean().default(false),
  })
  .passthrough();
export type LiveSurfaceSckWindowSourceV1 = z.infer<typeof LiveSurfaceSckWindowSourceV1>;

export const LiveSurfaceIosSimulatorSourceV1 = z
  .object({
    kind: z.literal("ios-simulator"),
    udid: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9-]+$/u),
    /** Optional current resolution hint; the resolver must still revalidate it. */
    windowRef: LiveSurfaceBoundedTextV1.optional(),
    crop: LiveSurfaceCropV1.default({ mode: "auto" }),
  })
  .passthrough();
export type LiveSurfaceIosSimulatorSourceV1 = z.infer<typeof LiveSurfaceIosSimulatorSourceV1>;

export const LiveSurfaceSourceSpecV1 = z.discriminatedUnion("kind", [
  LiveSurfaceBrowserSourceV1,
  LiveSurfaceSckWindowSourceV1,
  LiveSurfaceIosSimulatorSourceV1,
]);
export type LiveSurfaceSourceSpecV1 = z.infer<typeof LiveSurfaceSourceSpecV1>;

export const LIVE_SURFACE_FPS_BUCKETS_V1 = [0, 2, 5, 10, 15, 30, 60] as const;
export const LiveSurfaceFpsBucketV1 = z.union([
  z.literal(0),
  z.literal(2),
  z.literal(5),
  z.literal(10),
  z.literal(15),
  z.literal(30),
  z.literal(60),
]);
export type LiveSurfaceFpsBucketV1 = z.infer<typeof LiveSurfaceFpsBucketV1>;

export const LiveSurfaceDemandV1 = z
  .object({
    revision: LiveSurfaceRevisionV1,
    mode: z.enum(["live", "paused", "hibernated"]),
    targetFps: LiveSurfaceFpsBucketV1,
    targetRasterSize: LiveSurfacePixelSizeV1.optional(),
    priority: z.number().int().min(0).max(100),
    interactive: z.boolean(),
  })
  .passthrough()
  .superRefine((demand, context) => {
    if (demand.mode === "live" && demand.targetFps === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetFps"],
        message: "live demand requires a non-zero FPS bucket",
      });
    }
    if (demand.mode !== "live" && demand.targetFps !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetFps"],
        message: "paused and hibernated demand require zero FPS",
      });
    }
  });
export type LiveSurfaceDemandV1 = z.infer<typeof LiveSurfaceDemandV1>;

export const LiveSurfaceLifecycleStateV1 = z.enum([
  "created",
  "starting",
  "live",
  "paused",
  "hibernated",
  "reconnecting",
  "failed",
  "closed",
]);
export type LiveSurfaceLifecycleStateV1 = z.infer<typeof LiveSurfaceLifecycleStateV1>;

export const LiveSurfaceTransportV1 = z.enum(["shared-texture", "cpu-bgra"]);
export type LiveSurfaceTransportV1 = z.infer<typeof LiveSurfaceTransportV1>;

export const LiveSurfacePixelFormatV1 = z.enum(["bgra", "rgba", "nv12", "p010"]);
export type LiveSurfacePixelFormatV1 = z.infer<typeof LiveSurfacePixelFormatV1>;

export const LiveSurfaceColorSpaceV1 = z.enum(["srgb", "display-p3", "rec709"]);
export type LiveSurfaceColorSpaceV1 = z.infer<typeof LiveSurfaceColorSpaceV1>;

export const LiveSurfaceAlphaModeV1 = z.enum(["opaque", "premultiplied"]);
export type LiveSurfaceAlphaModeV1 = z.infer<typeof LiveSurfaceAlphaModeV1>;

export const LiveSurfaceFrameMetadataV1 = z
  .object({
    v: z.literal(LIVE_SURFACE_PROTOCOL_VERSION_V1),
    surfaceId: LiveSurfaceIdV1,
    producerEpoch: LiveSurfaceRevisionV1,
    sequence: LiveSurfaceSequenceV1,
    geometry: LiveSurfaceGeometryV1,
    /** Monotonic host clock. This is the authoritative local frame-age origin. */
    hostReceivedAtUs: LiveSurfaceSequenceV1,
    producerTimestamp: z
      .object({
        clockDomain: LiveSurfaceBoundedTextV1,
        timestampUs: LiveSurfaceSequenceV1,
      })
      .passthrough()
      .optional(),
    pixelFormat: LiveSurfacePixelFormatV1,
    colorSpace: LiveSurfaceColorSpaceV1,
    alphaMode: LiveSurfaceAlphaModeV1,
    transport: LiveSurfaceTransportV1,
    degradedMode: z.enum(["cpu-bitmap", "software-decode"]).optional(),
  })
  .passthrough();
export type LiveSurfaceFrameMetadataV1 = z.infer<typeof LiveSurfaceFrameMetadataV1>;

/**
 * Presentation-local interaction and geometry affordances. Semantic browser
 * automation, network/session inspection, and native-window control belong to
 * separately authorized control subsystems and are intentionally absent.
 */
export const LiveSurfacePresentationCapabilitiesV1 = z
  .object({
    pointer: z.boolean(),
    wheel: z.boolean(),
    keyboard: z.boolean(),
    textInput: z.boolean(),
    touch: z.boolean(),
    rotateDevice: z.boolean(),
    resizeLogicalViewport: z.boolean(),
    resizeBackingRaster: z.boolean(),
    crop: z.boolean(),
  })
  .passthrough();
export type LiveSurfacePresentationCapabilitiesV1 = z.infer<
  typeof LiveSurfacePresentationCapabilitiesV1
>;

export const LiveSurfaceErrorCodeV1 = z.enum([
  "unsupported",
  "permission-denied",
  "source-not-found",
  "source-closed",
  "producer-crashed",
  "frame-stalled",
  "transport-degraded",
  "device-lost",
  "lease-timeout",
  "protocol-violation",
  "security-rejected",
]);
export type LiveSurfaceErrorCodeV1 = z.infer<typeof LiveSurfaceErrorCodeV1>;

export const LiveSurfaceErrorV1 = z
  .object({
    code: LiveSurfaceErrorCodeV1,
    message: LiveSurfaceBoundedTextV1,
    recovery: z.enum(["automatic", "user-action", "permanent"]),
  })
  .passthrough();
export type LiveSurfaceErrorV1 = z.infer<typeof LiveSurfaceErrorV1>;

/** Opaque one-use authority. The privileged source specification stays main-side. */
export const LiveSurfaceAttachTicketV1 = z
  .object({
    v: z.literal(LIVE_SURFACE_PROTOCOL_VERSION_V1),
    token: z
      .string()
      .min(32)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/u),
  })
  .passthrough();
export type LiveSurfaceAttachTicketV1 = z.infer<typeof LiveSurfaceAttachTicketV1>;

export const LiveSurfaceRuntimeSummaryV1 = z
  .object({
    v: z.literal(LIVE_SURFACE_PROTOCOL_VERSION_V1),
    surfaceId: LiveSurfaceIdV1,
    state: LiveSurfaceLifecycleStateV1,
    producerEpoch: LiveSurfaceRevisionV1,
    stateRevision: LiveSurfaceRevisionV1,
    capabilities: LiveSurfacePresentationCapabilitiesV1,
    transport: LiveSurfaceTransportV1.optional(),
    geometry: LiveSurfaceGeometryV1.optional(),
    error: LiveSurfaceErrorV1.optional(),
  })
  .passthrough();
export type LiveSurfaceRuntimeSummaryV1 = z.infer<typeof LiveSurfaceRuntimeSummaryV1>;

/** One renderer-generation port handoff. The transferred ports are the capability. */
export const LiveSurfacePortBootstrapV1 = z
  .object({
    v: z.literal(LIVE_SURFACE_PROTOCOL_VERSION_V1),
    rendererGeneration: LiveSurfaceRevisionV1,
  })
  .passthrough();
export type LiveSurfacePortBootstrapV1 = z.infer<typeof LiveSurfacePortBootstrapV1>;

export const LiveSurfaceAttachmentDescriptorV1 = z
  .object({
    v: z.literal(LIVE_SURFACE_PROTOCOL_VERSION_V1),
    attachmentId: LiveSurfaceAttachmentIdV1,
    summary: LiveSurfaceRuntimeSummaryV1,
  })
  .passthrough()
  .superRefine((descriptor, context) => {
    if (descriptor.attachmentId === descriptor.summary.surfaceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attachmentId"],
        message: "attachment identity must be distinct from surface identity",
      });
    }
  });
export type LiveSurfaceAttachmentDescriptorV1 = z.infer<typeof LiveSurfaceAttachmentDescriptorV1>;

/** Renderer → main messages carried only by the generation-scoped control port. */
export const LiveSurfaceRendererControlMessageV1 = z.discriminatedUnion("type", [
  z
    .object({
      v: z.literal(LIVE_SURFACE_PROTOCOL_VERSION_V1),
      type: z.literal("attach"),
      requestId: LiveSurfaceRequestIdV1,
      ticket: LiveSurfaceAttachTicketV1,
    })
    .passthrough(),
  z
    .object({
      v: z.literal(LIVE_SURFACE_PROTOCOL_VERSION_V1),
      type: z.literal("demand"),
      attachmentId: LiveSurfaceAttachmentIdV1,
      demand: LiveSurfaceDemandV1,
    })
    .passthrough(),
  z
    .object({
      v: z.literal(LIVE_SURFACE_PROTOCOL_VERSION_V1),
      type: z.literal("detach"),
      attachmentId: LiveSurfaceAttachmentIdV1,
    })
    .passthrough(),
]);
export type LiveSurfaceRendererControlMessageV1 = z.infer<
  typeof LiveSurfaceRendererControlMessageV1
>;

/** Main → renderer messages carried only by the generation-scoped control port. */
export const LiveSurfaceHostControlMessageV1 = z.discriminatedUnion("type", [
  z
    .object({
      v: z.literal(LIVE_SURFACE_PROTOCOL_VERSION_V1),
      type: z.literal("ready"),
      bootstrap: LiveSurfacePortBootstrapV1,
    })
    .passthrough(),
  z
    .object({
      v: z.literal(LIVE_SURFACE_PROTOCOL_VERSION_V1),
      type: z.literal("attached"),
      requestId: LiveSurfaceRequestIdV1,
      attachment: LiveSurfaceAttachmentDescriptorV1,
    })
    .passthrough(),
  z
    .object({
      v: z.literal(LIVE_SURFACE_PROTOCOL_VERSION_V1),
      type: z.literal("rejected"),
      requestId: LiveSurfaceRequestIdV1,
      error: LiveSurfaceErrorV1,
    })
    .passthrough(),
  z
    .object({
      v: z.literal(LIVE_SURFACE_PROTOCOL_VERSION_V1),
      type: z.literal("summary"),
      attachmentId: LiveSurfaceAttachmentIdV1,
      summary: LiveSurfaceRuntimeSummaryV1,
    })
    .passthrough(),
  z
    .object({
      v: z.literal(LIVE_SURFACE_PROTOCOL_VERSION_V1),
      type: z.literal("detached"),
      attachmentId: LiveSurfaceAttachmentIdV1,
    })
    .passthrough(),
]);
export type LiveSurfaceHostControlMessageV1 = z.infer<typeof LiveSurfaceHostControlMessageV1>;

/** Metadata paired with a process-local transferable frame; no pixel object enters Zod. */
export const LiveSurfaceFrameEnvelopeV1 = z
  .object({
    v: z.literal(LIVE_SURFACE_PROTOCOL_VERSION_V1),
    attachmentId: LiveSurfaceAttachmentIdV1,
    metadata: LiveSurfaceFrameMetadataV1,
  })
  .passthrough()
  .superRefine((envelope, context) => {
    if (envelope.metadata.surfaceId === envelope.attachmentId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attachmentId"],
        message: "attachment identity must be distinct from surface identity",
      });
    }
  });
export type LiveSurfaceFrameEnvelopeV1 = z.infer<typeof LiveSurfaceFrameEnvelopeV1>;
