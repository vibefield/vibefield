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

/** Whether source-side cropping is absent, proven and applied, or deliberately degraded. */
export const LiveSurfaceCropStateV1 = z.enum(["none", "applied", "degraded"]);
export type LiveSurfaceCropStateV1 = z.infer<typeof LiveSurfaceCropStateV1>;

export const LiveSurfaceGeometryV1 = z
  .object({
    revision: LiveSurfaceRevisionV1,
    codedSize: LiveSurfacePixelSizeV1,
    visibleRect: LiveSurfacePixelRectV1,
    logicalSize: LiveSurfaceLogicalSizeV1,
    orientation: LiveSurfaceOrientationV1,
    cropState: LiveSurfaceCropStateV1.optional(),
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

/** PT-4 — the client hints a user agent ships with (`navigator.userAgentData`, CDP's `userAgentMetadata`): without them an
 * overridden agent's hints are EMPTY, and modern sites notice (BW-5). The brands are the producer's to say (none for an
 * agent that is not its own engine's — a Safari has none). */
export const LiveSurfaceBrowserClientHintsV1 = z
  .object({
    platform: z.string().max(64).refine(hasNoControlCharacters),
    platformVersion: z.string().max(32).refine(hasNoControlCharacters),
    architecture: z.string().max(16).refine(hasNoControlCharacters),
    model: z.string().max(64).refine(hasNoControlCharacters),
    mobile: z.boolean(),
  })
  .passthrough();
export type LiveSurfaceBrowserClientHintsV1 = z.infer<typeof LiveSurfaceBrowserClientHintsV1>;

/**
 * PT-4 — THE PAGE AS A DEVICE SEES IT: what a browser source's page is told of the device it is shown on. The producer
 * applies it over CDP at the page's creation and again when an `emulate` command moves it (`LiveSurfaceNavigationCommandV1`):
 *  - `deviceScaleFactor`: the device's density, device px a CSS px (absent: the source's own);
 *  - `mobile`: a phone's or a tablet's layout (the metrics override's `mobile`);
 *  - `touchPoints`: how many fingers the device takes — 0 is a pointer device, and a press on a page with any arrives as a
 *    TOUCH;
 *  - `agent`: the user agent the device announces, `navigator.platform`, and its client hints. Absent: the engine's own —
 *    the producer's Chromium by its own name and bundled version, never the app's;
 *  - `colorScheme`: the `prefers-color-scheme` the page is told (absent: the system's).
 */
export const LiveSurfaceBrowserEmulationV1 = z
  .object({
    deviceScaleFactor: z.number().finite().positive().max(8).optional(),
    mobile: z.boolean(),
    touchPoints: z.number().int().min(0).max(10),
    agent: z
      .object({
        userAgent: LiveSurfaceBoundedTextV1,
        navigatorPlatform: z.string().max(32).refine(hasNoControlCharacters),
        hints: LiveSurfaceBrowserClientHintsV1,
      })
      .passthrough()
      .optional(),
    colorScheme: z.enum(["light", "dark"]).optional(),
  })
  .passthrough();
export type LiveSurfaceBrowserEmulationV1 = z.infer<typeof LiveSurfaceBrowserEmulationV1>;

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
    /** PT-4: the device the page is born on (an `emulate` command moves it under a running page). */
    emulation: LiveSurfaceBrowserEmulationV1.optional(),
    /**
     * PT-5a: what the producer does when the page STOPS — its process gone, or unresponsive past the producer's bound.
     * `restart` (absent: this) — start it again by itself, within its restart budget, as before. `say` — the page is said
     * to have stopped (`failed`, `producer-crashed` / `frame-stalled`, its address kept) and waits for a `reload`: a page a
     * person was using has lost what they had in it, and they are told.
     */
    whenStopped: z.enum(["restart", "say"]).optional(),
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
    /** The layout size the holder wants the source to lay out at (CSS logical
     * units — LSF D8's first variable, distinct from the raster and from the
     * presentation transform). Producers whose capability block declares
     * `resizeLogicalViewport: false` ignore it; for a browser source it is the
     * page's viewport, so a card-sized holder gets a card-sized layout
     * (DT-3f). Absent means "no layout opinion": the source keeps its own. */
    logicalViewport: LiveSurfaceLogicalSizeV1.optional(),
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

const LiveSurfaceFrameMetadataFieldsV1 = {
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
  colorSpace: LiveSurfaceColorSpaceV1,
  alphaMode: LiveSurfaceAlphaModeV1,
  /** PT-5b3: a browser's frame says the DOCUMENT it is of — the producer's `browser.document` at its paint. Absent: a
   * producer that counts none; a holder then takes the document that stood when the frame ARRIVED, never the one that
   * stands when it is consumed. */
  document: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
} as const;

/** Transport capability and degradation state are one coherent observation. */
export const LiveSurfaceFrameMetadataV1 = z.discriminatedUnion("transport", [
  z
    .object({
      ...LiveSurfaceFrameMetadataFieldsV1,
      transport: z.literal("shared-texture"),
      pixelFormat: LiveSurfacePixelFormatV1,
      degradedMode: z.never().optional(),
    })
    .passthrough(),
  z
    .object({
      ...LiveSurfaceFrameMetadataFieldsV1,
      transport: z.literal("cpu-bgra"),
      pixelFormat: z.enum(["bgra", "rgba"]),
      degradedMode: z.literal("cpu-bitmap"),
    })
    .passthrough(),
]);
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

/** PT-5a: why a browser page's LOAD failed, in the producer's words (a holder says each in a person's). A certificate is
 * refused, never bypassed; `blocked` is the surface's own policy (a scheme it does not open). PT-5b2 (ruling 6) — and a
 * load that ENDED with no document of the page standing and nothing under way: `no-document` (the address answered with
 * no page — an attachment, an empty answer; the engine says only that the load stopped) and `stopped` (the person
 * stopped it before anything of the page arrived). Its `url` is the address that was asked for, as for every failure. */
export const LiveSurfaceLoadFailureV1 = z.enum([
  "name-not-resolved",
  "offline",
  "connection-refused",
  "connection-failed",
  "timed-out",
  "certificate",
  "blocked",
  "no-document",
  "stopped",
  "failed",
]);
export type LiveSurfaceLoadFailureV1 = z.infer<typeof LiveSurfaceLoadFailureV1>;

/** PT-4: the most a favicon may weigh — kept small; one past it is none. Its base64 is four characters for three bytes.
 * (PT-5a: its bytes no longer ride every summary of the page's state — see `favicon` below.) */
export const LIVE_SURFACE_FAVICON_MAX_BYTES = 32 * 1024;
export const LIVE_SURFACE_FAVICON_MAX_BASE64 = 4 * Math.ceil(LIVE_SURFACE_FAVICON_MAX_BYTES / 3);

/** The browser producer's committed navigation truth, carried on runtime
 * summaries so chrome (URL bar, back/forward) renders facts, never guesses.
 * Plain state like `error` — no revision of its own; the control port is FIFO
 * and the producer publishes monotonically. Part of the DT-D6 input lane (its
 * event and command shapes live beside the renderer control union below). */
export const LiveSurfaceBrowserStateV1 = z
  .object({
    url: LiveSurfaceUrlV1,
    title: LiveSurfaceBoundedTextV1.optional(),
    loading: z.boolean(),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
    /** PT-3: the CSS cursor the page shows where the pointer last was (`pointer` over a link, `text` over a field) — the
     * producer's `cursor-changed`, as a CSS cursor name; absent until the page has said one. */
    cursor: z
      .string()
      .regex(/^[a-z][a-z-]{0,31}$/)
      .optional(),
    /** PT-4: the page's FAVICON — fetched by the producer through the page's own session (http/https only), held to
     * `LIVE_SURFACE_FAVICON_MAX_BYTES`: its bytes (base64), their media type, and a short digest a holder compares instead
     * of the bytes. Absent: the page has none the producer could read (a holder draws its generic mark).
     * PT-5a — THE BYTES CROSS ONCE A KEY: on an attachment's port `data` rides only the FIRST summary that names a key
     * (the attach's own, or the one that first says it); every later summary of that key carries the key and the media
     * type alone — each cursor move in hand is a summary, and up to 43,692 characters rode each one. The renderer's
     * attachment keeps the bytes it was sent and its `summary` is whole again (a holder reads `data` as before); a key
     * whose bytes it was never sent is no favicon. Main-side (the producer's own summary) `data` is always there. */
    favicon: z
      .object({
        key: z.string().regex(/^[a-f0-9]{16}$/u),
        mediaType: z.string().regex(/^image\/[a-z0-9.+-]{1,40}$/u),
        data: z
          .string()
          .min(4)
          .max(LIVE_SURFACE_FAVICON_MAX_BASE64)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/u)
          .optional(),
      })
      .passthrough()
      .optional(),
    /** PT-5b3 — WHICH DOCUMENT the page is at: a serial that moves when a document COMMITS (a navigation's commit; the
     * engine's error page standing in a failed address's place) and never at a move within one (a hash, `pushState`,
     * `replaceState`). It counts for the surface's life: a window made anew begins another. Whoever asks "is this
     * another document?" — whose pixels a texture holds, whose scale was read — asks this. Absent: no document of the
     * page STANDS in its window (none has committed yet — in a window made anew too —, the page is at rest or failed,
     * headed elsewhere before its first commit, or its load ended with nothing: PT-5c), or the producer counts none: a
     * holder then reads it by the address, as before. */
    document: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    /** PT-5a: the page's last LOAD FAILED. `url` is still the address that was ASKED for — never the engine's error page —
     * and there is no `title`; a `reload` asks for it again. Absent once a page commits. */
    failure: z.object({ reason: LiveSurfaceLoadFailureV1 }).passthrough().optional(),
    /** PT-5a: the last thing the page asked for that it MAY NOT have and a person should be told of — today a download,
     * cancelled. `serial` counts the page's refusals: a holder says it (for a moment) when the serial moves, never twice. */
    refused: z
      .object({
        what: z.enum(["download"]),
        serial: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type LiveSurfaceBrowserStateV1 = z.infer<typeof LiveSurfaceBrowserStateV1>;

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
    /** Browser sources only: the producer's committed navigation truth. */
    browser: LiveSurfaceBrowserStateV1.optional(),
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

// ── the human input lane (DT-3 — thinking-devtools-pack.md DT-D6) ──
// Fire-and-forget renderer→main events on the SAME generation-scoped control
// port the attachment already rides, gated main-side by the ticket's
// operations ("pointer"/"keyboard"/"navigate" — browser sources mint them,
// capture and Simulator stay view-only). Coordinates are CSS LOGICAL pixels in
// the surface's `logicalSize` space (LSF §10.2): the sender maps its canvas
// box to logical space and NEVER re-scales by raster or visibleRect; the
// input envelope carries the geometry revision that mapping used, and the
// PRODUCER drops stale revisions rather than guessing.

export const LiveSurfacePointerButtonV1 = z.enum(["left", "middle", "right"]);
export type LiveSurfacePointerButtonV1 = z.infer<typeof LiveSurfacePointerButtonV1>;

export const LiveSurfaceKeyModifiersV1 = z
  .object({
    alt: z.boolean(),
    ctrl: z.boolean(),
    meta: z.boolean(),
    shift: z.boolean(),
  })
  .passthrough();
export type LiveSurfaceKeyModifiersV1 = z.infer<typeof LiveSurfaceKeyModifiersV1>;

const LiveSurfaceLogicalCoordinateV1 = z.number().finite().min(0).max(LIVE_SURFACE_MAX_DIMENSION);

export const LiveSurfaceInputEventV1 = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("pointer"),
      action: z.enum(["move", "down", "up"]),
      x: LiveSurfaceLogicalCoordinateV1,
      y: LiveSurfaceLogicalCoordinateV1,
      /** Absent on `move`; a down/up without one is the primary button. */
      button: LiveSurfacePointerButtonV1.optional(),
      clickCount: z.number().int().min(1).max(3).optional(),
      /** PT-3: the buttons HELD (DOM's mask — 1 primary, 2 secondary, 4 middle): a move with the primary held is a drag (a
       * page's text selection); absent — none held. */
      buttons: z.number().int().min(0).max(31).optional(),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("wheel"),
      x: LiveSurfaceLogicalCoordinateV1,
      y: LiveSurfaceLogicalCoordinateV1,
      deltaX: z.number().finite().min(-100_000).max(100_000),
      deltaY: z.number().finite().min(-100_000).max(100_000),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("key"),
      action: z.enum(["down", "up"]),
      /** DOM `KeyboardEvent.key` / `.code`; the producer re-validates both. */
      key: z.string().min(1).max(32),
      code: z.string().min(1).max(64),
      modifiers: LiveSurfaceKeyModifiersV1,
      autoRepeat: z.boolean().optional(),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("text"),
      /** Committed text (typing, IME composition end, paste). Long pastes are
       * chunked by the sender; the bound matches the producer's own. */
      text: z.string().min(1).max(16_384),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("compose"),
      /** PT-3: an IME COMPOSITION as it runs (the preedit — `""` as one starts) and the caret within it (the producer
       * holds it to the text's length); its end rides `text` (the committed string). Gated as keys are (`keyboard`). */
      text: z.string().max(16_384),
      caret: z.number().int().min(0).max(16_384),
    })
    .passthrough(),
]);
export type LiveSurfaceInputEventV1 = z.infer<typeof LiveSurfaceInputEventV1>;

/** Chrome-initiated navigation on a browser surface. `go` is re-validated by
 * the producer against the same top-level scheme policy as the initial load.
 * PT-4 — `emulate`: the page seen as another device, or in another scheme (the chrome's device switch): the producer
 * re-applies it under the running page, and reloads the page ONCE when what the page is told of its device moved (its
 * agent, its hints, mobile, touch) — a scheme or a density alone is told live. The same emulation again is nothing. */
export const LiveSurfaceNavigationCommandV1 = z.discriminatedUnion("action", [
  z.object({ action: z.literal("go"), url: LiveSurfaceUrlV1 }).passthrough(),
  z.object({ action: z.literal("back") }).passthrough(),
  z.object({ action: z.literal("forward") }).passthrough(),
  z.object({ action: z.literal("reload") }).passthrough(),
  z.object({ action: z.literal("stop") }).passthrough(),
  z
    .object({ action: z.literal("emulate"), emulation: LiveSurfaceBrowserEmulationV1 })
    .passthrough(),
]);
export type LiveSurfaceNavigationCommandV1 = z.infer<typeof LiveSurfaceNavigationCommandV1>;

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
  z
    .object({
      v: z.literal(LIVE_SURFACE_PROTOCOL_VERSION_V1),
      type: z.literal("cpu-frame-ack"),
      attachmentId: LiveSurfaceAttachmentIdV1,
      producerEpoch: LiveSurfaceRevisionV1,
      sequence: LiveSurfaceSequenceV1,
    })
    .passthrough(),
  z
    .object({
      v: z.literal(LIVE_SURFACE_PROTOCOL_VERSION_V1),
      type: z.literal("input"),
      attachmentId: LiveSurfaceAttachmentIdV1,
      /** The geometry the sender mapped its coordinates against. Stale
       * revisions are dropped by the producer, never re-mapped (LSF §10.2). */
      geometryRevision: LiveSurfaceRevisionV1,
      input: LiveSurfaceInputEventV1,
    })
    .passthrough(),
  z
    .object({
      v: z.literal(LIVE_SURFACE_PROTOCOL_VERSION_V1),
      type: z.literal("navigate"),
      attachmentId: LiveSurfaceAttachmentIdV1,
      navigation: LiveSurfaceNavigationCommandV1,
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

// ── surface.* product-API shapes (DT-1 — thinking-devtools-pack.md DT-D2/DT-D3) ──
// TS-only like the rest of this file. fieldd owns policy (scopes, audit,
// idempotency); Electron main owns mechanism (producers, tickets). The
// privileged source specification crosses fieldd exactly once on `surface.open`
// and never returns to a caller; enumeration rows are REDACTED to what a
// picker face needs (LSF-16: routing identity, never authority).

export const LiveSurfaceSourceKindV1 = z.enum(["browser", "sck-window", "ios-simulator"]);
export type LiveSurfaceSourceKindV1 = z.infer<typeof LiveSurfaceSourceKindV1>;

/** Only capture kinds enumerate: browser sources are created, never listed. */
export const SurfaceEnumerationKindV1 = z.enum(["sck-window", "ios-simulator"]);
export type SurfaceEnumerationKindV1 = z.infer<typeof SurfaceEnumerationKindV1>;

export const SURFACE_LIMITS = {
  MAX_ENUMERATED_SOURCES: 256,
  IDEMPOTENCY_KEY_CHARS: 64,
} as const;

/** One redacted picker row. `sourceRef` is the producer boundary's opaque
 * stable reference; window-server ids, raw UDID paths, and native handles
 * never appear here. */
export const SurfaceSourceDescriptorV1 = z
  .object({
    kind: SurfaceEnumerationKindV1,
    sourceRef: LiveSurfaceBoundedTextV1,
    title: LiveSurfaceBoundedTextV1.optional(),
    appName: LiveSurfaceBoundedTextV1.optional(),
  })
  .passthrough();
export type SurfaceSourceDescriptorV1 = z.infer<typeof SurfaceSourceDescriptorV1>;

export const SurfaceSourcesParamsV1 = z.object({ kind: SurfaceEnumerationKindV1 }).passthrough();
export type SurfaceSourcesParamsV1 = z.infer<typeof SurfaceSourcesParamsV1>;

export const SurfaceSourcesResultV1 = z
  .object({
    sources: z.array(SurfaceSourceDescriptorV1).max(SURFACE_LIMITS.MAX_ENUMERATED_SOURCES),
  })
  .passthrough();
export type SurfaceSourcesResultV1 = z.infer<typeof SurfaceSourcesResultV1>;

/** DT-1c — caller-scoped continuity key (typically the widget's durable entity
 * key). Custody in Electron main dedupes mints on {participant, kind, reuseKey},
 * so a renderer reload re-binds the SAME still-running runtime (the reason
 * main-side custody exists) instead of leaking one per reload. Optional: a
 * mint without it is fresh each time and swept when its document dies. */
export const SurfaceReuseKeyV1 = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
export type SurfaceReuseKeyV1 = z.infer<typeof SurfaceReuseKeyV1>;

export const SurfaceOpenParamsV1 = z
  .object({
    source: LiveSurfaceSourceSpecV1,
    reuseKey: SurfaceReuseKeyV1.optional(),
    idempotencyKey: z.string().min(1).max(SURFACE_LIMITS.IDEMPOTENCY_KEY_CHARS).optional(),
  })
  .passthrough();
export type SurfaceOpenParamsV1 = z.infer<typeof SurfaceOpenParamsV1>;

/** The ticket is one-use and bound main-side to the calling window + renderer
 * generation; the surfaceId is runtime identity for `surface.close`, never a
 * durable key (LSF §5). */
export const SurfaceOpenResultV1 = z
  .object({ surfaceId: LiveSurfaceIdV1, ticket: LiveSurfaceAttachTicketV1 })
  .passthrough();
export type SurfaceOpenResultV1 = z.infer<typeof SurfaceOpenResultV1>;

export const SurfaceCloseParamsV1 = z.object({ surfaceId: LiveSurfaceIdV1 }).passthrough();
export type SurfaceCloseParamsV1 = z.infer<typeof SurfaceCloseParamsV1>;

export const SurfaceCloseResultV1 = z.object({ closed: z.boolean() }).passthrough();
export type SurfaceCloseResultV1 = z.infer<typeof SurfaceCloseResultV1>;
