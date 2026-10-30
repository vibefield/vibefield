import { describe, expect, it } from "vitest";
import {
  LIVE_SURFACE_FAVICON_MAX_BASE64,
  LIVE_SURFACE_FAVICON_MAX_BYTES,
  LIVE_SURFACE_MAX_PIXELS,
  LiveSurfaceBrowserEmulationV1,
  LiveSurfaceBrowserSourceV1,
  LiveSurfaceBrowserStateV1,
  LiveSurfaceDemandV1,
  LiveSurfaceFrameEnvelopeV1,
  LiveSurfaceFrameMetadataV1,
  LiveSurfaceGeometryV1,
  LiveSurfaceHostControlMessageV1,
  LiveSurfaceInputEventV1,
  LiveSurfaceIosSimulatorBindingV1,
  LiveSurfaceLoadFailureV1,
  LiveSurfaceNavigationCommandV1,
  LiveSurfacePresentationCapabilitiesV1,
  LiveSurfaceRendererControlMessageV1,
  LiveSurfaceSequenceV1,
  LiveSurfaceSourceSpecV1,
} from "../src/live-surfaces";

const geometry = {
  revision: 3,
  codedSize: { width: 848, height: 1736 },
  visibleRect: { x: 0, y: 0, width: 848, height: 1736 },
  logicalSize: { width: 424, height: 868 },
  orientation: 0,
};

describe("LSF-1 Live Surfaces contracts", () => {
  it("keeps producer, geometry, and sequence discontinuities distinct", () => {
    expect(
      LiveSurfaceFrameMetadataV1.parse({
        v: 1,
        surfaceId: "surface_0123456789abcdef",
        producerEpoch: 2,
        sequence: "18446744073709551615",
        geometry,
        hostReceivedAtUs: "123456",
        pixelFormat: "bgra",
        colorSpace: "srgb",
        alphaMode: "opaque",
        transport: "shared-texture",
        futureField: "tolerated",
      }),
    ).toMatchObject({
      producerEpoch: 2,
      sequence: "18446744073709551615",
      geometry: { revision: 3 },
      futureField: "tolerated",
    });
    expect(LiveSurfaceSequenceV1.safeParse("18446744073709551616").success).toBe(false);
  });

  it("makes transport metadata coherent by construction", () => {
    const base = {
      v: 1,
      surfaceId: "surface_0123456789abcdef",
      producerEpoch: 2,
      sequence: "7",
      geometry,
      hostReceivedAtUs: "123456",
      pixelFormat: "bgra",
      colorSpace: "srgb",
      alphaMode: "opaque",
    } as const;
    expect(
      LiveSurfaceFrameMetadataV1.safeParse({
        ...base,
        transport: "cpu-bgra",
      }).success,
    ).toBe(false);
    expect(
      LiveSurfaceFrameMetadataV1.safeParse({
        ...base,
        transport: "shared-texture",
        degradedMode: "cpu-bitmap",
      }).success,
    ).toBe(false);
    expect(
      LiveSurfaceFrameMetadataV1.safeParse({
        ...base,
        transport: "cpu-bgra",
        degradedMode: "cpu-bitmap",
      }).success,
    ).toBe(true);
  });

  it("rejects visible rectangles outside the coded frame and oversized allocations", () => {
    expect(
      LiveSurfaceGeometryV1.safeParse({
        ...geometry,
        visibleRect: { x: 100, y: 0, width: 800, height: 1736 },
      }).success,
    ).toBe(false);
    expect(
      LiveSurfaceGeometryV1.safeParse({
        ...geometry,
        codedSize: { width: 16_384, height: 8_192 },
        visibleRect: { x: 0, y: 0, width: 16_384, height: 8_192 },
      }).success,
    ).toBe(false);
    expect(LIVE_SURFACE_MAX_PIXELS).toBe(67_108_864);
  });

  it("reports proven and deliberately degraded source-side crop state", () => {
    expect(LiveSurfaceGeometryV1.parse({ ...geometry, cropState: "applied" }).cropState).toBe(
      "applied",
    );
    expect(LiveSurfaceGeometryV1.parse({ ...geometry, cropState: "degraded" }).cropState).toBe(
      "degraded",
    );
    expect(LiveSurfaceGeometryV1.safeParse({ ...geometry, cropState: "guessed" }).success).toBe(
      false,
    );
  });

  it("enforces coherent revisioned demand", () => {
    expect(
      LiveSurfaceDemandV1.safeParse({
        revision: 1,
        mode: "live",
        targetFps: 30,
        targetRasterSize: { width: 1280, height: 800 },
        priority: 50,
        interactive: true,
      }).success,
    ).toBe(true);
    // DT-3f: demand may carry a layout ask — logical units, so fractional CSS
    // sizes are legitimate — and a viewport with a zero side is not a layout.
    expect(
      LiveSurfaceDemandV1.safeParse({
        revision: 4,
        mode: "live",
        targetFps: 30,
        targetRasterSize: { width: 1800, height: 1064 },
        logicalViewport: { width: 900.5, height: 532 },
        priority: 50,
        interactive: false,
      }).success,
    ).toBe(true);
    expect(
      LiveSurfaceDemandV1.safeParse({
        revision: 5,
        mode: "live",
        targetFps: 30,
        logicalViewport: { width: 0, height: 532 },
        priority: 50,
        interactive: false,
      }).success,
    ).toBe(false);
    expect(
      LiveSurfaceDemandV1.safeParse({
        revision: 2,
        mode: "live",
        targetFps: 0,
        priority: 50,
        interactive: false,
      }).success,
    ).toBe(false);
    expect(
      LiveSurfaceDemandV1.safeParse({
        revision: 3,
        mode: "paused",
        targetFps: 5,
        priority: 0,
        interactive: false,
      }).success,
    ).toBe(false);
  });

  it("keeps semantic automation out of the presentation capability contract", () => {
    expect(
      LiveSurfacePresentationCapabilitiesV1.parse({
        pointer: true,
        wheel: true,
        keyboard: true,
        textInput: true,
        touch: false,
        rotateDevice: false,
        resizeLogicalViewport: true,
        resizeBackingRaster: true,
        crop: false,
      }),
    ).toEqual({
      pointer: true,
      wheel: true,
      keyboard: true,
      textInput: true,
      touch: false,
      rotateDevice: false,
      resizeLogicalViewport: true,
      resizeBackingRaster: true,
      crop: false,
    });
  });

  it("models Simulator as an SCK-resolved source without an encoded pixel endpoint", () => {
    expect(
      LiveSurfaceSourceSpecV1.parse({
        kind: "ios-simulator",
        udid: "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
      }),
    ).toMatchObject({ kind: "ios-simulator", crop: { mode: "auto" } });
    expect(
      LiveSurfaceSourceSpecV1.safeParse({
        kind: "sck-window",
        sourceRef: "enumeration-ref-01",
      }).success,
    ).toBe(true);
  });

  it("PT-S1: binds a phone to a CoreSimulator device type and runtime — bounded, pattern-checked, and never a UDID", () => {
    const binding = {
      deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
      runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-1",
    };
    expect(LiveSurfaceIosSimulatorBindingV1.parse(binding)).toEqual(binding);
    // Apple's own spellings keep their dashes (the 2nd-generation SE's trails one)
    expect(
      LiveSurfaceIosSimulatorBindingV1.safeParse({
        ...binding,
        deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-SE--2nd-generation-",
      }).success,
    ).toBe(true);
    // a tolerant reader: a later field rides along
    expect(LiveSurfaceIosSimulatorBindingV1.parse({ ...binding, later: 1 })).toMatchObject({
      later: 1,
    });
    // never a UDID — a UDID names one simulator on one Mac, and the document travels between Macs
    for (const udid of ["A1B2C3D4-E5F6-7890-ABCD-EF1234567890", "booted"]) {
      expect(
        LiveSurfaceIosSimulatorBindingV1.safeParse({ ...binding, deviceType: udid }).success,
      ).toBe(false);
      expect(
        LiveSurfaceIosSimulatorBindingV1.safeParse({ ...binding, runtime: udid }).success,
      ).toBe(false);
    }
    // the two ids are each other's never, nor a name, nor a path, nor empty, nor past the bound
    for (const bad of [
      { ...binding, deviceType: binding.runtime },
      { ...binding, runtime: binding.deviceType },
      { ...binding, deviceType: "iPhone 17 Pro" },
      {
        ...binding,
        deviceType:
          "/Library/Developer/CoreSimulator/Profiles/DeviceTypes/iPhone 17 Pro.simdevicetype",
      },
      { ...binding, runtime: "com.apple.CoreSimulator.SimRuntime.iOS 26.1" },
      { ...binding, deviceType: "" },
      { ...binding, runtime: "" },
      { ...binding, deviceType: `com.apple.CoreSimulator.SimDeviceType.${"x".repeat(100)}` },
      { deviceType: binding.deviceType },
      { runtime: binding.runtime },
    ])
      expect(LiveSurfaceIosSimulatorBindingV1.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false,
      );
  });

  it("PT-3: the input lane carries an IME composition and the buttons a move holds; the browser state says the page's cursor", () => {
    // a composition as it runs — its start ("", 0), an update, the caret inside it — and what is refused
    expect(LiveSurfaceInputEventV1.parse({ kind: "compose", text: "", caret: 0 })).toEqual({
      kind: "compose",
      text: "",
      caret: 0,
    });
    expect(
      LiveSurfaceInputEventV1.parse({ kind: "compose", text: "にほ", caret: 2 }),
    ).toMatchObject({
      text: "にほ",
      caret: 2,
    });
    expect(
      LiveSurfaceInputEventV1.safeParse({ kind: "compose", text: "x", caret: -1 }).success,
    ).toBe(false);
    expect(
      LiveSurfaceInputEventV1.safeParse({ kind: "compose", text: "x".repeat(16_385), caret: 0 })
        .success,
    ).toBe(false);
    expect(LiveSurfaceInputEventV1.safeParse({ kind: "compose", caret: 0 }).success).toBe(false);
    // a move with the primary held is a drag; a mask out of range is refused
    expect(
      LiveSurfaceInputEventV1.parse({ kind: "pointer", action: "move", x: 10, y: 20, buttons: 1 }),
    ).toMatchObject({
      buttons: 1,
    });
    expect(
      LiveSurfaceInputEventV1.safeParse({
        kind: "pointer",
        action: "move",
        x: 10,
        y: 20,
        buttons: 32,
      }).success,
    ).toBe(false);
    // the cursor a page shows, as a CSS name — and nothing that is not one
    const state = {
      url: "https://example.test/",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    };
    expect(LiveSurfaceBrowserStateV1.parse({ ...state, cursor: "pointer" })).toMatchObject({
      cursor: "pointer",
    });
    expect(LiveSurfaceBrowserStateV1.parse({ ...state, cursor: "not-allowed" })).toMatchObject({
      cursor: "not-allowed",
    });
    expect(LiveSurfaceBrowserStateV1.parse(state)).not.toHaveProperty("cursor");
    for (const cursor of ["", "url(x.png)", "Pointer", "a".repeat(33)])
      expect(LiveSurfaceBrowserStateV1.safeParse({ ...state, cursor }).success, cursor).toBe(false);
  });

  it("PT-5a: the browser state says what the page asked for and was REFUSED — a download, with a serial that counts them", () => {
    const state = {
      url: "https://example.test/",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    };
    expect(
      LiveSurfaceBrowserStateV1.parse({ ...state, refused: { what: "download", serial: 3 } }),
    ).toMatchObject({ refused: { what: "download", serial: 3 } });
    expect(LiveSurfaceBrowserStateV1.parse(state)).not.toHaveProperty("refused");
    for (const refused of [
      { what: "download" },
      { what: "download", serial: 0 },
      { what: "download", serial: 1.5 },
      { what: "alert", serial: 1 },
      { serial: 1 },
    ])
      expect(
        LiveSurfaceBrowserStateV1.safeParse({ ...state, refused }).success,
        JSON.stringify(refused),
      ).toBe(false);
  });

  it("BP-D1: a denied PERMISSION is said too — the refusal names it, and only a permission names one", () => {
    const state = {
      url: "https://example.test/",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    };
    for (const permission of [
      "camera",
      "microphone",
      "geolocation",
      "clipboard-sanitized-write",
      "midiSysex",
    ]) {
      expect(
        LiveSurfaceBrowserStateV1.parse({
          ...state,
          refused: { what: "permission", permission, serial: 2 },
        }),
      ).toMatchObject({ refused: { what: "permission", permission, serial: 2 } });
    }
    for (const refused of [
      { what: "permission", serial: 1 },
      { what: "permission", permission: "", serial: 1 },
      { what: "permission", permission: "Camera", serial: 1 },
      { what: "permission", permission: "a/b", serial: 1 },
      { what: "permission", permission: "x".repeat(49), serial: 1 },
      { what: "permission", permission: "camera", serial: 0 },
    ])
      expect(
        LiveSurfaceBrowserStateV1.safeParse({ ...state, refused }).success,
        JSON.stringify(refused),
      ).toBe(false);
  });

  it("PT-5a: a favicon may be named WITHOUT its bytes — a summary after the first that names its key — but never without its key or its type", () => {
    const state = {
      url: "https://example.test/",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    };
    const named = { key: "0123456789abcdef", mediaType: "image/png" };
    expect(LiveSurfaceBrowserStateV1.parse({ ...state, favicon: named }).favicon).toEqual(named);
    expect(
      LiveSurfaceBrowserStateV1.parse({ ...state, favicon: { ...named, data: "AAAA" } }).favicon,
    ).toEqual({ ...named, data: "AAAA" });
    for (const favicon of [
      { key: named.key },
      { mediaType: named.mediaType },
      { ...named, data: "" },
      { ...named, data: "not base64!" },
    ])
      expect(
        LiveSurfaceBrowserStateV1.safeParse({ ...state, favicon }).success,
        JSON.stringify(favicon),
      ).toBe(false);
  });

  it("PT-5a: the browser state says a load FAILED and why, in a closed set of reasons; a browser source says whether its page, stopped, is restarted or SAID", () => {
    const state = {
      url: "https://example.test/",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    };
    for (const reason of LiveSurfaceLoadFailureV1.options)
      expect(LiveSurfaceBrowserStateV1.parse({ ...state, failure: { reason } })).toMatchObject({
        failure: { reason },
      });
    expect(LiveSurfaceLoadFailureV1.options).toEqual([
      "name-not-resolved",
      "offline",
      "connection-refused",
      "connection-failed",
      "timed-out",
      "certificate",
      "blocked",
      // PT-5b2 (ruling 6): a load that ENDED with no document of the page standing — the address is no page; it was stopped
      "no-document",
      "stopped",
      "failed",
    ]);
    expect(LiveSurfaceBrowserStateV1.parse(state)).not.toHaveProperty("failure");
    for (const failure of [{}, { reason: "ERR_CONNECTION_REFUSED" }, { reason: -102 }, "failed"])
      expect(
        LiveSurfaceBrowserStateV1.safeParse({ ...state, failure }).success,
        JSON.stringify(failure),
      ).toBe(false);
    const source = {
      kind: "browser",
      initialUrl: "https://example.test/",
      profile: { mode: "memory", ref: "t" },
      logicalViewport: { width: 320, height: 180 },
    };
    expect(LiveSurfaceBrowserSourceV1.parse(source)).not.toHaveProperty("whenStopped");
    for (const whenStopped of ["restart", "say"])
      expect(LiveSurfaceBrowserSourceV1.parse({ ...source, whenStopped })).toMatchObject({
        whenStopped,
      });
    expect(LiveSurfaceBrowserSourceV1.safeParse({ ...source, whenStopped: "ask" }).success).toBe(
      false,
    );
  });

  it("PT-5b3 (ruling 4): the browser state says WHICH DOCUMENT the page is at — `document`, a positive integer, absent until one has committed (or from a producer that counts none) — and a frame may say the document it is of", () => {
    const state = {
      url: "https://example.test/",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    };
    expect(LiveSurfaceBrowserStateV1.parse(state)).not.toHaveProperty("document");
    for (const document of [1, 2, 7_000_000])
      expect(LiveSurfaceBrowserStateV1.parse({ ...state, document })).toMatchObject({ document });
    for (const document of [0, -1, 1.5, "2", null, Number.MAX_SAFE_INTEGER + 2])
      expect(
        LiveSurfaceBrowserStateV1.safeParse({ ...state, document }).success,
        JSON.stringify(document),
      ).toBe(false);
    const frame = {
      v: 1,
      surfaceId: "surface_0123456789abcdef",
      producerEpoch: 1,
      sequence: "1",
      geometry: {
        revision: 1,
        codedSize: { width: 640, height: 360 },
        visibleRect: { x: 0, y: 0, width: 640, height: 360 },
        logicalSize: { width: 320, height: 180 },
        orientation: 0,
      },
      hostReceivedAtUs: "1",
      colorSpace: "srgb",
      alphaMode: "premultiplied",
      transport: "shared-texture",
      pixelFormat: "bgra",
    };
    expect(LiveSurfaceFrameMetadataV1.parse(frame)).not.toHaveProperty("document");
    expect(LiveSurfaceFrameMetadataV1.parse({ ...frame, document: 3 })).toMatchObject({
      document: 3,
    });
    for (const document of [0, -3, 2.5, "3"])
      expect(
        LiveSurfaceFrameMetadataV1.safeParse({ ...frame, document }).success,
        JSON.stringify(document),
      ).toBe(false);
    // …and on the CPU's frames the same
    expect(
      LiveSurfaceFrameMetadataV1.parse({
        ...frame,
        transport: "cpu-bgra",
        degradedMode: "cpu-bitmap",
        document: 4,
      }),
    ).toMatchObject({ document: 4 });
  });

  it("PT-4: a browser source says the device its page is seen as — its density, mobile, touch, its agent with its hints, its scheme — at its creation and as an `emulate` command; the state carries the page's favicon, held small", () => {
    const phone = {
      deviceScaleFactor: 3,
      mobile: true,
      touchPoints: 5,
      agent: {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
        navigatorPlatform: "iPhone",
        hints: {
          platform: "iOS",
          platformVersion: "26.0",
          architecture: "",
          model: "iPhone",
          mobile: true,
        },
      },
      colorScheme: "dark",
    };
    expect(LiveSurfaceBrowserEmulationV1.parse(phone)).toEqual(phone);
    // the engine's own: no agent, no touch — a scheme alone, or nothing but the two it must say
    const laptop = { mobile: false, touchPoints: 0 };
    expect(LiveSurfaceBrowserEmulationV1.parse(laptop)).toEqual(laptop);
    expect(LiveSurfaceBrowserEmulationV1.parse({ ...laptop, colorScheme: "light" })).toMatchObject({
      colorScheme: "light",
    });
    for (const bad of [
      { touchPoints: 0 },
      { mobile: false },
      { ...laptop, touchPoints: 11 },
      { ...laptop, touchPoints: 1.5 },
      { ...laptop, deviceScaleFactor: 9 },
      { ...laptop, colorScheme: "sepia" },
      { ...laptop, agent: { userAgent: "x" } },
      { ...phone, agent: { ...phone.agent, userAgent: "" } },
      { ...phone, agent: { ...phone.agent, userAgent: "a\nb" } },
      { ...phone, agent: { ...phone.agent, hints: { ...phone.agent.hints, mobile: "yes" } } },
    ])
      expect(LiveSurfaceBrowserEmulationV1.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    // on the source at its creation
    const source = {
      kind: "browser",
      initialUrl: "https://example.test/",
      profile: { mode: "persistent", ref: "desk" },
      logicalViewport: { width: 402, height: 874 },
      deviceScaleFactor: 3,
    };
    expect(LiveSurfaceSourceSpecV1.parse({ ...source, emulation: phone })).toMatchObject({
      emulation: phone,
    });
    expect(LiveSurfaceSourceSpecV1.parse(source)).not.toHaveProperty("emulation");
    expect(
      LiveSurfaceSourceSpecV1.safeParse({ ...source, emulation: { mobile: true } }).success,
    ).toBe(false);
    // under a running page: the chrome's device switch, a navigation command
    expect(LiveSurfaceNavigationCommandV1.parse({ action: "emulate", emulation: phone })).toEqual({
      action: "emulate",
      emulation: phone,
    });
    expect(LiveSurfaceNavigationCommandV1.safeParse({ action: "emulate" }).success).toBe(false);
    expect(
      LiveSurfaceRendererControlMessageV1.parse({
        v: 1,
        type: "navigate",
        attachmentId: "attachment_0123456789abcdef",
        navigation: { action: "emulate", emulation: laptop },
      }),
    ).toMatchObject({ navigation: { action: "emulate", emulation: laptop } });

    // the favicon: a digest, an image's media type, its bytes in base64 — never past the cap, never another type
    const state = {
      url: "https://example.test/",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    };
    const favicon = { key: "0123456789abcdef", mediaType: "image/png", data: "iVBORw0KGgo=" };
    expect(LiveSurfaceBrowserStateV1.parse({ ...state, favicon })).toMatchObject({ favicon });
    expect(LiveSurfaceBrowserStateV1.parse(state)).not.toHaveProperty("favicon");
    expect(LIVE_SURFACE_FAVICON_MAX_BYTES).toBe(32_768);
    expect(LIVE_SURFACE_FAVICON_MAX_BASE64).toBe(43_692);
    const atCap = "A".repeat(LIVE_SURFACE_FAVICON_MAX_BASE64);
    expect(
      LiveSurfaceBrowserStateV1.safeParse({ ...state, favicon: { ...favicon, data: atCap } })
        .success,
    ).toBe(true);
    for (const bad of [
      { ...favicon, data: `${atCap}AAAA` },
      { ...favicon, data: "" },
      { ...favicon, data: "not base64!" },
      { ...favicon, mediaType: "text/html" },
      { ...favicon, mediaType: "image/" },
      { ...favicon, key: "0123" },
      { ...favicon, key: "0123456789ABCDEF" },
      { mediaType: "image/png", data: "iVBORw0KGgo=" },
    ])
      expect(
        LiveSurfaceBrowserStateV1.safeParse({ ...state, favicon: bad }).success,
        JSON.stringify(bad).slice(0, 80),
      ).toBe(false);
  });

  it("keeps attach/demand control metadata separate from transferable frames", () => {
    const ticket = { v: 1, token: "abcdefghijklmnopqrstuvwxyz_0123456789-ABCDE" };
    expect(
      LiveSurfaceRendererControlMessageV1.parse({
        v: 1,
        type: "attach",
        requestId: "request_0001",
        ticket,
      }),
    ).toMatchObject({ type: "attach", ticket });
    expect(
      LiveSurfaceRendererControlMessageV1.parse({
        v: 1,
        type: "cpu-frame-ack",
        attachmentId: "attachment_0123456789abcdef",
        producerEpoch: 2,
        sequence: "7",
      }),
    ).toMatchObject({ type: "cpu-frame-ack", producerEpoch: 2, sequence: "7" });
    expect(
      LiveSurfaceHostControlMessageV1.parse({
        v: 1,
        type: "ready",
        bootstrap: { v: 1, rendererGeneration: 4 },
      }),
    ).toMatchObject({ type: "ready", bootstrap: { rendererGeneration: 4 } });

    const metadata = LiveSurfaceFrameMetadataV1.parse({
      v: 1,
      surfaceId: "surface_0123456789abcdef",
      producerEpoch: 2,
      sequence: "7",
      geometry,
      hostReceivedAtUs: "123456",
      pixelFormat: "bgra",
      colorSpace: "srgb",
      alphaMode: "opaque",
      transport: "shared-texture",
    });
    const envelope = LiveSurfaceFrameEnvelopeV1.parse({
      v: 1,
      attachmentId: "attachment_0123456789abcdef",
      metadata,
    });
    expect(envelope.metadata.sequence).toBe("7");
    expect("frame" in envelope).toBe(false);
  });
});
