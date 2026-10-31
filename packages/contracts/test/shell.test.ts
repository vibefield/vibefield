import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SURFACE_LIMITS } from "../src/live-surfaces";
import { METHODS } from "../src/methods";
import { IPC_CHANNELS } from "../src/registries";
import {
  APP_PREFERENCE_KEYS,
  AppPreferenceSetParams,
  AppPreferences,
  BrowserDataClearResult,
  CloseReason,
  CloseRequest,
  CloseResult,
  DesktopShellState,
  FrameView,
  FrameViewSetRequest,
  FrameViewState,
  FrameZoomRequest,
  frameViewBuilt,
  GodviewDeckSetRequest,
  GodviewDeckState,
  isUnambiguousLinkText,
  ProductInfo,
  RendererParticipantIdentity,
  RendererReplaceRequest,
  RendererReplaceResult,
  resolveTheme,
  SHELL_INTERNAL_PROVIDER_METHODS,
  SHELL_PROVIDER_METHODS,
  ShellCommandRequest,
  ShellDialogPickFolderParams,
  ShellDialogPickFolderResult,
  ShellOpenExternalParams,
  ShellOpenLinkParams,
  ShellOpenLinkResult,
  ShellProviderCallParams,
  ShellProviderOutcome,
  ShellProviderRegisterParams,
  ShellProviderRegisterResult,
  ShellRendererRequestReplacementParams,
  ShellRendererRequestReplacementResult,
  ShellSurfacesSimulatorDevicesParams,
  ShellSurfacesSimulatorDevicesResult,
  ShellWebContentsCaptureArtifactPreviewParams,
  ShellWebContentsCaptureArtifactPreviewResult,
  SURFACE_AUTHORITY_LIMITS,
  ThemePreference,
  ThemeSetRequest,
  ThemeState,
  WindowConnection,
  WindowLights,
  WindowLightsState,
  WindowTerminalBootstrap,
} from "../src/shell";

// Shell-boundary contracts (ESR spec §6.1–6.2). These shapes cross the Electron
// seam — product.json on the daemon filesystem boundary and the CLOSED
// contextBridge IPC surface — so the fixtures here double as the EL9
// tolerant-reader proof for that seam. Shapes are today's reality; contracts
// describe what ships.

// The exact literal fieldd writes to `<dataRoot>/fieldd/run/product.json`
// (packages/fieldd/src/daemon.ts, `satisfies ProductInfo`): an ephemeral bound
// port that is read and never inferred, a real `fieldd-<hex>` bootId, and the
// shipped contractsVersion. nativePid is null when field-native is disabled.
const PRODUCT_JSON = {
  port: 49213,
  pid: 84217,
  bootId: "fieldd-1a2b3c4d5e6f7a8b",
  contractsVersion: "0.1.0",
  startedAt: 1753203698123,
  nativePid: null,
  buildId: null,
} satisfies ProductInfo;

describe("ProductInfo — fieldd's product.json adoption descriptor (design-02 §3.6/D10)", () => {
  it("parses the golden literal fieldd writes on boot", () => {
    const parsed = ProductInfo.parse(PRODUCT_JSON);
    expect(parsed.port).toBe(49213);
    expect(parsed.bootId).toBe("fieldd-1a2b3c4d5e6f7a8b");
    expect(parsed.nativePid).toBeNull();
    expect(parsed.buildId).toBeNull();
  });

  it("accepts a positive nativePid when field-native is ensured", () => {
    const parsed = ProductInfo.parse({ ...PRODUCT_JSON, nativePid: 84219 });
    expect(parsed.nativePid).toBe(84219);
  });

  it("accepts a bounded development build identity", () => {
    const parsed = ProductInfo.parse({ ...PRODUCT_JSON, buildId: "dev-96d85f4f9d3f" });
    expect(parsed.buildId).toBe("dev-96d85f4f9d3f");
  });

  it("accepts an older product file without buildId", () => {
    const { buildId: _buildId, ...legacyProduct } = PRODUCT_JSON;
    expect(ProductInfo.parse(legacyProduct).buildId).toBeUndefined();
  });

  it("preserves an unknown extra field (EL9 tolerant reader — passthrough)", () => {
    const withFuture = { ...PRODUCT_JSON, meshEpoch: 7 };
    const parsed = ProductInfo.parse(withFuture);
    // the future field survives the parse — removal would be silent data loss
    expect((parsed as Record<string, unknown>).meshEpoch).toBe(7);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(withFuture);
  });

  it("round-trips JSON.stringify → parse → schema (product.json is a file on disk)", () => {
    const onDisk = `${JSON.stringify(PRODUCT_JSON, null, 2)}\n`; // exactly how daemon.ts writes it
    const parsed = ProductInfo.parse(JSON.parse(onDisk));
    expect(parsed).toEqual(PRODUCT_JSON);
  });

  const BAD_PRODUCT: ReadonlyArray<[string, unknown]> = [
    ["port 0 (must be a real bound port, never inferred)", { ...PRODUCT_JSON, port: 0 }],
    ["a negative pid", { ...PRODUCT_JSON, pid: -1 }],
    ["a missing bootId", { ...PRODUCT_JSON, bootId: undefined }],
    ["a non-semver contractsVersion", { ...PRODUCT_JSON, contractsVersion: "1.2" }],
    ["an empty buildId", { ...PRODUCT_JSON, buildId: "" }],
  ];
  for (const [label, value] of BAD_PRODUCT) {
    it(`rejects ${label}`, () => {
      expect(ProductInfo.safeParse(value).success).toBe(false);
    });
  }
});

describe("WindowConnection — the D27 loopback endpoint + per-window scoped token", () => {
  const rendererParticipant = {
    participantId: "renderer:desktop-a1b2:window-1",
    incarnation: "renderer:desktop-a1b2:window-1:document-2",
  };

  it("parses a shell-minted participant identity and tolerates extra fields", () => {
    const parsed = WindowConnection.parse({
      port: 49213,
      token: "wnd_9f8e7d6c5b4a39281706",
      rendererParticipant,
      generation: 3, // an unknown field a future broker might add
    });
    expect(parsed.port).toBe(49213);
    expect(parsed.token).toBe("wnd_9f8e7d6c5b4a39281706");
    expect(parsed.rendererParticipant).toEqual(rendererParticipant);
    expect((parsed as Record<string, unknown>).generation).toBe(3);
  });

  it("carries main's per-generation terminal selector while older hosts remain readable", () => {
    const terminal = {
      transport: "routed" as const,
      defaultShell: "/bin/zsh",
      home: "/Users/test",
    };
    expect(
      WindowConnection.parse({
        port: 49213,
        token: "wnd_9f8e7d6c5b4a39281706",
        rendererParticipant,
        terminal,
      }).terminal,
    ).toEqual(terminal);
    expect(WindowTerminalBootstrap.safeParse({ ...terminal, transport: "guess" }).success).toBe(
      false,
    );
    expect(WindowTerminalBootstrap.safeParse({ ...terminal, home: "" }).success).toBe(false);
  });

  it("bounds both renderer identity parts to printable protocol-safe values", () => {
    expect(RendererParticipantIdentity.parse(rendererParticipant)).toEqual(rendererParticipant);
    for (const value of [
      { ...rendererParticipant, participantId: "" },
      { ...rendererParticipant, incarnation: "renderer window with spaces" },
      { ...rendererParticipant, incarnation: "x".repeat(257) },
    ]) {
      expect(RendererParticipantIdentity.safeParse(value).success).toBe(false);
    }
  });

  const BAD_CONNECTION: ReadonlyArray<[string, unknown]> = [
    ["a missing participant identity", { port: 49213, token: "wnd_abc" }],
    ["an empty token", { port: 49213, token: "", rendererParticipant }],
    ["a non-positive port", { port: 0, token: "wnd_abc", rendererParticipant }],
  ];
  for (const [label, value] of BAD_CONNECTION) {
    it(`rejects ${label}`, () => {
      expect(WindowConnection.safeParse(value).success).toBe(false);
    });
  }
});

describe("Close protocol — CloseReason / CloseRequest / CloseResult (ESR §6.4)", () => {
  it("CloseReason is the closed four-value set", () => {
    expect(CloseReason.options).toEqual(["window", "app-quit", "restart", "update"]);
  });

  for (const reason of CloseReason.options) {
    it(`accepts a CloseRequest with reason "${reason}"`, () => {
      const parsed = CloseRequest.parse({ requestId: "close-1", reason });
      expect(parsed.reason).toBe(reason);
    });
  }

  it("rejects an unknown close reason (the enum is closed)", () => {
    expect(CloseRequest.safeParse({ requestId: "close-1", reason: "sleep" }).success).toBe(false);
  });

  it("accepts a CloseResult with ok:true and no error (a clean drain)", () => {
    const parsed = CloseResult.parse({ requestId: "close-1", ok: true });
    expect(parsed.ok).toBe(true);
    expect(parsed.error).toBeUndefined();
  });

  it("accepts a CloseResult with ok:false and an honest error (Retry / Quit)", () => {
    const parsed = CloseResult.parse({
      requestId: "close-1",
      ok: false,
      error: "lane flush timed out",
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("lane flush timed out");
  });

  it("rejects an empty requestId on both request and result", () => {
    expect(CloseRequest.safeParse({ requestId: "", reason: "window" }).success).toBe(false);
    expect(CloseResult.safeParse({ requestId: "", ok: true }).success).toBe(false);
  });
});

describe("IPC_CHANNELS — the CLOSED contextBridge surface (ESR §6.2)", () => {
  it("exposes exactly the thirty-two channel keys, in order", () => {
    expect(Object.keys(IPC_CHANNELS)).toEqual([
      "windowBootstrap",
      "prepareClose",
      "closeResult",
      "rendererLogPort",
      "diagnosticsPort",
      "liveSurfacePorts",
      "shellCommand",
      "desktopState",
      // WP12d (L3c-i) — the desktop updater's host doors (ESR §6.2's `update*` rows)
      "updateCheck",
      "updateSetEnabled",
      "updateSetChannel",
      "updateDecline",
      "updatePrepareRestart",
      "updateConfirmRestart",
      "updateDoctor",
      "updateDownload", // AU-1 — a person's download of one found version (AU-G5, AU-G6)
      "updateMoveToApplications", // AU-7 — Move to Applications through the quit gate (AU-G8)
      // TP-S3e: terminalConnect + terminalStatus retired with the bridge —
      // the renderer dials the cells' T1 doors itself.
      "viewState", // FR-1 — the window's active view (GT-D2's Godview bit, grown into four)
      "viewSet",
      "viewZoom", // FR-4 — main → renderer: the View menu's zoom, as an act for the head
      "themeState", // FR-4 — the app's one theme, main's (Light · Dark · Auto)
      "themeSet",
      "deckSet", // GV round 3 — Godview's deck said by name; main moves the lights and lends ⌘W by it
      "usersUpdate", // UA-3 — the Account page's profile write (main owns users.json)
      "usersList", // UA-5 — the roster; one truth for switcher + tray submenu
      "usersCreate", // UA-5 — mint user N under the §3.3 lock, then attach
      "usersSwitch", // UA-5/UA-D15 — attach re-target + window reload
      "screenshotCapture", // SNAP-D3 — the native screenshot helper, one capture at a time
      "screenshotResult", // SNAP-3 — main → renderer: the View menu's capture, told to the page
      "screenshotPreview",
      "screenshotStillBytes", // HN-D7 — a retained still's bytes, for the desk's print of a snapshot
      "screenshotStillKept", // HN-4 — whether a still is kept, before a pane is given its path
      "rendererReplace", // DK-9 — the window's renderer replaced at its own asking (a plugin's kinds)
      "browserDataClear", // BP-D4 — Settings' Clear browsing data: the desk's profile cleared, its pages reloaded
    ]);
  });

  it("pins the exact channel strings (a new or renamed channel must move the spec table first)", () => {
    expect(IPC_CHANNELS).toEqual({
      windowBootstrap: "vibefield:shell:window-bootstrap",
      prepareClose: "vibefield:shell:prepare-close",
      closeResult: "vibefield:shell:close-result",
      rendererLogPort: "vibefield:logging:renderer-port",
      diagnosticsPort: "vibefield:diagnostics:host-port",
      liveSurfacePorts: "vibefield:live-surfaces:host-ports",
      shellCommand: "vibefield:shell:command",
      desktopState: "vibefield:shell:desktop-state",
      updateCheck: "vibefield:update:check",
      updateSetEnabled: "vibefield:update:set-enabled",
      updateSetChannel: "vibefield:update:set-channel",
      updateDecline: "vibefield:update:decline",
      updatePrepareRestart: "vibefield:update:prepare-restart",
      updateConfirmRestart: "vibefield:update:confirm-restart",
      updateDoctor: "vibefield:update:doctor",
      updateDownload: "vibefield:update:download",
      updateMoveToApplications: "vibefield:update:move-to-applications",
      viewState: "vibefield:view:state",
      viewSet: "vibefield:view:set",
      viewZoom: "vibefield:view:zoom",
      themeState: "vibefield:theme:state",
      themeSet: "vibefield:theme:set",
      deckSet: "vibefield:deck:set",
      usersUpdate: "vibefield:users:update",
      usersList: "vibefield:users:list",
      usersCreate: "vibefield:users:create",
      usersSwitch: "vibefield:users:switch",
      screenshotCapture: "vibefield:screenshot:capture",
      screenshotResult: "vibefield:screenshot:result",
      screenshotPreview: "vibefield:screenshot:preview",
      screenshotStillBytes: "vibefield:screenshot:still-bytes",
      screenshotStillKept: "vibefield:screenshot:still-kept",
      rendererReplace: "vibefield:shell:renderer-replace",
      browserDataClear: "vibefield:browser:clear-data",
    });
  });

  it("the renderer replacement door (DK-9) names its reason and nothing else does", () => {
    expect(RendererReplaceRequest.parse({ reason: "plugin-kinds" })).toEqual({
      reason: "plugin-kinds",
    });
    expect(() => RendererReplaceRequest.parse({})).toThrow();
    expect(() => RendererReplaceRequest.parse({ reason: "because" })).toThrow();
    expect(RendererReplaceResult.parse({ replacing: true })).toEqual({ replacing: true });
    expect(() => RendererReplaceResult.parse({ replacing: false })).toThrow();
  });

  it("Clear browsing data (BP-D4) answers counts only — no path, no site, no size", () => {
    expect(BrowserDataClearResult.parse({ profiles: 1, pages: 3 })).toEqual({
      profiles: 1,
      pages: 3,
    });
    expect(BrowserDataClearResult.parse({ profiles: 0, pages: 0 })).toEqual({
      profiles: 0,
      pages: 0,
    });
    for (const bad of [
      {},
      { profiles: 1 },
      { profiles: -1, pages: 0 },
      { profiles: 1.5, pages: 0 },
      { profiles: 65, pages: 0 },
    ])
      expect(BrowserDataClearResult.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("the app's one theme (FR-4, FC-D5)", () => {
  it("is three states — Light, Dark, Auto — and resolves to two themes", () => {
    expect(ThemePreference.options).toEqual(["light", "dark", "auto"]);
    expect(ThemeState.parse({ preference: "auto", resolved: "dark" })).toEqual({
      preference: "auto",
      resolved: "dark",
    });
    // The old sticky boolean is not a theme: a `{dark}` from an older page is refused.
    expect(ThemeState.safeParse({ dark: true }).success).toBe(false);
    expect(ThemeState.safeParse({ preference: "auto", resolved: "auto" }).success).toBe(false);
    expect(ThemeState.safeParse({ preference: "sepia", resolved: "light" }).success).toBe(false);
  });

  it("chooses by name — there is no toggle to argue with", () => {
    expect(ThemeSetRequest.parse({ preference: "dark" })).toEqual({ preference: "dark" });
    expect(ThemeSetRequest.safeParse({}).success).toBe(false);
    expect(ThemeSetRequest.safeParse({ dark: true }).success).toBe(false);
  });

  it("reads Auto as the OS's theme and the other two as themselves", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("the frame's active view (FR-1)", () => {
  it("names the four views in the track's order, the canvas first", () => {
    expect(FrameView.options).toEqual(["canvas", "godview", "history", "assistant"]);
    expect(FrameViewState.parse({ view: "godview" })).toEqual({ view: "godview" });
    expect(FrameViewState.safeParse({}).success).toBe(false);
    // GT-D2's bit is gone, not aliased: an old main's `{open}` is not a view.
    expect(FrameViewState.safeParse({ open: true }).success).toBe(false);
    expect(FrameViewState.safeParse({ view: "rooms" }).success).toBe(false);
  });

  it("asks for a view by name — there is no flip to argue with", () => {
    expect(FrameViewSetRequest.parse({ view: "history" })).toEqual({ view: "history" });
    expect(FrameViewSetRequest.safeParse({}).success).toBe(false);
    expect(FrameViewSetRequest.safeParse({ open: true }).success).toBe(false);
  });

  it("sends the View menu's zoom as one of its three acts — never a level, never a fit (FR-4, 3b)", () => {
    for (const act of ["in", "out", "actual"] as const) {
      expect(FrameZoomRequest.parse({ act })).toEqual({ act });
    }
    // ⇧1's fit has no menu item (nothing new in the menu bar), and the camera
    // is the page's: main sends an act, never a zoom it would have to know.
    expect(FrameZoomRequest.safeParse({ act: "fit" }).success).toBe(false);
    expect(FrameZoomRequest.safeParse({ zoom: 1.25 }).success).toBe(false);
    expect(FrameZoomRequest.safeParse({}).success).toBe(false);
  });

  it("keeps the Assistant's cell waiting: every view but it is built (FC-D2)", () => {
    expect(FrameView.options.filter(frameViewBuilt)).toEqual(["canvas", "godview", "history"]);
  });

  it("passes unknown fields through, like every other inbound shape (EL9)", () => {
    expect(FrameViewState.parse({ view: "canvas", future: "field" })).toEqual({
      view: "canvas",
      future: "field",
    });
  });
});

describe("Godview's deck, said to main by name (round 3 — GV-D6, GV-D11)", () => {
  it("has three states — away, up, maximized — or none", () => {
    expect(GodviewDeckState.options).toEqual(["away", "up", "maximized"]);
    for (const deck of GodviewDeckState.options) {
      expect(GodviewDeckSetRequest.parse({ deck })).toEqual({ deck });
    }
    // A window whose page has no deck to speak of says so: null, never silence.
    expect(GodviewDeckSetRequest.parse({ deck: null })).toEqual({ deck: null });
    expect(GodviewDeckSetRequest.safeParse({}).success).toBe(false);
    expect(GodviewDeckSetRequest.safeParse({ deck: "full" }).success).toBe(false);
    expect(GodviewDeckSetRequest.safeParse({ deck: true }).success).toBe(false);
  });

  it("never carries a position: the page names a state and main owns the numbers", () => {
    // Coordinates are not a request…
    expect(GodviewDeckSetRequest.safeParse({ x: 12, y: 9 }).success).toBe(false);
    expect(GodviewDeckSetRequest.safeParse({ deck: { x: 12, y: 9 } }).success).toBe(false);
    // …and not an answer: the lights are named by where they stand.
    expect(WindowLights.options).toEqual(["head", "bar", "none"]);
    expect(
      WindowLightsState.safeParse({ deck: "maximized", lights: { x: 12, y: 9 } }).success,
    ).toBe(false);
  });

  it("is answered with what main holds: the deck as said, and where the lights stand", () => {
    expect(WindowLightsState.parse({ deck: "maximized", lights: "bar" })).toEqual({
      deck: "maximized",
      lights: "bar",
    });
    expect(WindowLightsState.parse({ deck: null, lights: "head" })).toEqual({
      deck: null,
      lights: "head",
    });
    // A window with no inset lights (not a Mac, a default title bar) is told so.
    expect(WindowLightsState.parse({ deck: "maximized", lights: "none" }).lights).toBe("none");
    expect(WindowLightsState.safeParse({ deck: "up" }).success).toBe(false);
    expect(WindowLightsState.safeParse({ lights: "head" }).success).toBe(false);
    expect(WindowLightsState.safeParse({ deck: "up", lights: "tray" }).success).toBe(false);
  });

  it("passes unknown fields through, like every other inbound shape (EL9)", () => {
    expect(GodviewDeckSetRequest.parse({ deck: "up", future: "field" })).toEqual({
      deck: "up",
      future: "field",
    });
    expect(WindowLightsState.parse({ deck: "up", lights: "head", future: 1 })).toEqual({
      deck: "up",
      lights: "head",
      future: 1,
    });
  });
});

describe("tray shell commands and app preferences", () => {
  it("keeps desired preferences separate from native desktop capability truth", () => {
    expect(
      DesktopShellState.parse({
        tray: {
          availability: "unavailable",
          placement: "unknown",
          backgroundShellEffective: false,
          issue: {
            code: "DESKTOP_TRAY_UNAVAILABLE",
            message: "status item creation failed",
          },
        },
      }).tray,
    ).toMatchObject({
      availability: "unavailable",
      placement: "unknown",
      backgroundShellEffective: false,
    });
    expect(
      DesktopShellState.parse({
        tray: {
          availability: "available",
          placement: "offscreen",
          backgroundShellEffective: false,
          issue: {
            code: "DESKTOP_TRAY_OFFSCREEN",
            message: "macOS placed the status item outside the visible menu bar",
          },
        },
      }).tray.issue?.code,
    ).toBe("DESKTOP_TRAY_OFFSCREEN");
    expect(
      DesktopShellState.safeParse({
        tray: {
          availability: "unavailable",
          placement: "unknown",
          backgroundShellEffective: true,
          issue: { code: "UNKNOWN", message: "bad" },
        },
      }).success,
    ).toBe(false);
  });

  it("AU-1 — every update-view fixture parses as the desktop state's update", () => {
    // the preload drops the WHOLE desktop state when it fails to parse (`preload/desktop-state.ts`): a view field the
    // contract does not take blanks the tray facts and the Settings card together
    const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
    const views = readdirSync(fixtures).filter((f) => f.startsWith("update-view."));
    expect(views.length).toBeGreaterThanOrEqual(5);
    for (const f of views) {
      const raw: unknown = JSON.parse(readFileSync(join(fixtures, f), "utf8"));
      const parsed = DesktopShellState.shape.update.safeParse(raw);
      const issues = parsed.success ? "" : JSON.stringify(parsed.error.issues);
      expect(parsed.success, `${f}: ${issues}`).toBe(true);
    }
  });

  it("keeps the renderer command set closed", () => {
    expect(ShellCommandRequest.parse({ command: "open-settings" }).command).toBe("open-settings");
    expect(ShellCommandRequest.parse({ command: "open-diagnostics" }).command).toBe(
      "open-diagnostics",
    );
    // TS-4 — the status item's Connect Your Devices… and the away notice's Connect…
    expect(ShellCommandRequest.parse({ command: "open-connect" }).command).toBe("open-connect");
    expect(ShellCommandRequest.safeParse({ command: "run-plugin-code" }).success).toBe(false);
  });

  it("requires a complete effective preference snapshot", () => {
    expect(
      AppPreferences.parse({ showTray: true, backgroundShell: false, syncPosture: "opt-in" }),
    ).toEqual({
      showTray: true,
      backgroundShell: false,
      screenshotHotkey: true,
      syncPosture: "opt-in",
      // AL-3: an older daemon's snapshot has no confirmQuit; the default is to ask
      confirmQuit: true,
      // TS-4: nor connectAsks; the asks to connect stay on until the person turns them off
      connectAsks: true,
    });
    expect(AppPreferences.safeParse({ showTray: true }).success).toBe(false);
    // UA-6: the posture is part of the EFFECTIVE snapshot, so a caller can
    // never be handed one that leaves it to guess (the daemon folds the default).
    expect(AppPreferences.safeParse({ showTray: true, backgroundShell: true }).success).toBe(false);
  });

  it("accepts the boolean preference mutations, and the posture's own word", () => {
    expect(
      AppPreferenceSetParams.safeParse({ key: APP_PREFERENCE_KEYS.CONNECT_ASKS, value: false })
        .success,
    ).toBe(true);
    expect(
      AppPreferenceSetParams.safeParse({ key: APP_PREFERENCE_KEYS.CONNECT_ASKS, value: "opt-in" })
        .success,
    ).toBe(false);
    expect(
      AppPreferenceSetParams.safeParse({ key: APP_PREFERENCE_KEYS.SCREENSHOT_HOTKEY, value: false })
        .success,
    ).toBe(true);
    expect(
      AppPreferenceSetParams.safeParse({
        key: APP_PREFERENCE_KEYS.SCREENSHOT_HOTKEY,
        value: "opt-in",
      }).success,
    ).toBe(false);
    expect(
      AppPreferenceSetParams.parse({
        key: APP_PREFERENCE_KEYS.SHOW_TRAY,
        value: false,
      }),
    ).toMatchObject({ key: "desktop.showTray", value: false });
    expect(AppPreferenceSetParams.safeParse({ key: "desktop.unknown", value: true }).success).toBe(
      false,
    );
    expect(
      AppPreferenceSetParams.safeParse({
        key: APP_PREFERENCE_KEYS.BACKGROUND_SHELL,
        value: "yes",
      }).success,
    ).toBe(false);
    // UA-D7 — not every preference is a switch. The value union widened by
    // exactly the posture's vocabulary and nothing else.
    expect(
      AppPreferenceSetParams.parse({
        key: APP_PREFERENCE_KEYS.MESH_SYNC_POSTURE,
        value: "opt-in",
      }),
    ).toMatchObject({ key: "mesh.syncPosture", value: "opt-in" });
    expect(
      AppPreferenceSetParams.safeParse({
        key: APP_PREFERENCE_KEYS.MESH_SYNC_POSTURE,
        value: "paranoid",
      }).success,
    ).toBe(false);
  });
});

describe("AH-3/AH-4 static shell provider", () => {
  it("pins the folder picker to its two declared purposes and bounded result union", () => {
    expect(ShellDialogPickFolderParams.parse({ purpose: "workspace.export" })).toEqual({
      purpose: "workspace.export",
    });
    expect(ShellDialogPickFolderParams.parse({ purpose: "artifact.publish" })).toEqual({
      purpose: "artifact.publish",
    });
    expect(ShellDialogPickFolderParams.safeParse({ purpose: "browse-anywhere" }).success).toBe(
      false,
    );
    expect(ShellDialogPickFolderResult.parse({ canceled: true })).toEqual({ canceled: true });
    expect(
      ShellDialogPickFolderResult.parse({ canceled: false, path: "/Users/me/Sites/demo" }),
    ).toEqual({ canceled: false, path: "/Users/me/Sites/demo" });
    expect(ShellDialogPickFolderResult.parse({ canceled: false, path: "C:\\Sites\\demo" })).toEqual(
      { canceled: false, path: "C:\\Sites\\demo" },
    );
    expect(ShellDialogPickFolderResult.safeParse({ canceled: false }).success).toBe(false);
    expect(
      ShellDialogPickFolderResult.safeParse({ canceled: false, path: "relative/demo" }).success,
    ).toBe(false);
  });

  it("accepts only bounded credential-free HTTPS external URLs", () => {
    expect(ShellOpenExternalParams.parse({ url: "https://device.example.ts.net:12000/" }).url).toBe(
      "https://device.example.ts.net:12000/",
    );
    for (const url of [
      "http://device.example.ts.net:12000/",
      "https://user:pass@device.example.ts.net:12000/",
      " https://device.example.ts.net:12000/",
      "HTTPS://device.example.ts.net:12000/",
      "https://device.example.ts.net\\@evil.example/",
      "not a url",
      `https://example.com/${"x".repeat(2048)}`,
    ]) {
      expect(ShellOpenExternalParams.safeParse({ url }).success, url).toBe(false);
    }
  });

  it("GT-8a: opens a terminal link only as a canonical, credential-free http(s) URL", () => {
    for (const url of [
      // the dev server is the link a terminal prints most — http is admitted
      "http://localhost:3000/x",
      "https://example.com/",
      "http://127.0.0.1:8080/api?q=1#top",
      "http://[::1]:5173/",
      "https://xn--bcher-kva.example/docs",
      // exactly at the terminal's own bound
      `https://example.com/${"x".repeat(8192 - "https://example.com/".length)}`,
    ]) {
      expect(ShellOpenLinkParams.safeParse({ url }).success, url).toBe(true);
    }
    for (const url of [
      // credentials, in any arm
      "https://user:pass@example.com/",
      "https://user@example.com/",
      "http://:secret@localhost:3000/",
      // control characters: C0, DEL, C1
      "https://example.com/\u0007",
      "https://example.com/\u007f",
      "https://example.com/\u0085",
      // whitespace the parser would trim or encode
      " https://example.com/",
      "https://example.com/a b",
      "https://example.com/\t",
      "https://example.com/\u00a0",
      // invisible format characters the parser would erase or encode
      "https://exa\u200Bmple.com/",
      "https://example.com/\u202Egnp.exe",
      // backslashes, in the authority and in the query the parser keeps them in
      "https://example.com\\@evil.example/",
      "https://example.com/?next=\\evil",
      // every scheme but http and https
      "javascript:alert(1)",
      "file:///tmp/source.ts",
      "file:relative.ts",
      "mailto:team@example.com",
      "ftp://example.com/",
      "ftps://example.com/",
      "data:text/html,hi",
      "vscode://file/tmp/source.ts",
      // not the URL's own spelling: main opens only what the standard would print
      "HTTPS://example.com/",
      "https://example.com",
      "https:example.com",
      "http://0x7f.1/",
      "https://bücher.example/",
      // no host, or no URL at all
      "http://",
      "https:///",
      "http://[::1",
      "",
      // past the bound
      `https://example.com/${"x".repeat(8192)}`,
    ]) {
      expect(ShellOpenLinkParams.safeParse({ url }).success, JSON.stringify(url)).toBe(false);
    }
    expect(ShellOpenLinkResult.parse({ opened: true })).toEqual({ opened: true });
    expect(ShellOpenLinkResult.safeParse({ opened: false }).success).toBe(false);
    // the external door beside it keeps HTTPS-only for the callers that rely on it
    expect(ShellOpenExternalParams.safeParse({ url: "http://localhost:3000/x" }).success).toBe(
      false,
    );
  });

  it("GT-8a: names the characters a URL parser would silently repair", () => {
    expect(isUnambiguousLinkText("https://example.com/a%20b?q=1#top")).toBe(true);
    expect(isUnambiguousLinkText("file:///tmp/my%20project/source.ts#L42")).toBe(true);
    for (const text of [
      "a b",
      "a\tb",
      "a\nb",
      "a\u0000b",
      "a\u0085b",
      "a\u200Bb",
      "a\u2066b",
      "a\\b",
    ]) {
      expect(isUnambiguousLinkText(text), JSON.stringify(text)).toBe(false);
    }
  });

  it("GT-8a: reaches the browser through an INTERNAL provider verb no client calls", () => {
    expect(SHELL_INTERNAL_PROVIDER_METHODS).toContain("shell.openLink");
    expect(SHELL_PROVIDER_METHODS).toContain("shell.openLink");
    expect(METHODS.some((method) => method.method === "shell.openLink")).toBe(false);
  });

  it("PT-S2 (R11): the attach's device list is a local `surface.capture` read, carried by an INTERNAL provider verb, and its rows never hold a UDID", () => {
    expect(METHODS.find((method) => method.method === "surface.simulator.devices")).toEqual({
      surface: "product",
      method: "surface.simulator.devices",
      scope: "surface.capture",
      idempotent: true,
      locality: "local",
    });
    expect(SHELL_INTERNAL_PROVIDER_METHODS).toContain("shell.surfaces.simulatorDevices");
    expect(SHELL_PROVIDER_METHODS).toContain("shell.surfaces.simulatorDevices");
    expect(METHODS.some((method) => method.method === "shell.surfaces.simulatorDevices")).toBe(
      false,
    );
    // above main's own worst case for the call: the Xcode probe (5 s) and the list (8 s)
    expect(SURFACE_AUTHORITY_LIMITS.SIMULATOR_DEVICES_DEADLINE_MS).toBe(15_000);
    expect(ShellSurfacesSimulatorDevicesParams.parse({})).toEqual({});
    const row = {
      deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
      runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-1",
      name: "iPhone 17 Pro",
      booted: true,
    };
    expect(ShellSurfacesSimulatorDevicesResult.parse({ devices: [row] })).toEqual({
      devices: [row],
    });
    expect(ShellSurfacesSimulatorDevicesResult.parse({ devices: [] })).toEqual({ devices: [] });
    // a UDID anywhere refuses the whole list: main's own parse is the last door before fieldd
    expect(
      ShellSurfacesSimulatorDevicesResult.safeParse({
        devices: [{ ...row, udid: "F93EABF3-4281-4EB5-A5F6-A550FBE95CDC" }],
      }).success,
    ).toBe(false);
    expect(
      ShellSurfacesSimulatorDevicesResult.safeParse({
        devices: Array.from({ length: SURFACE_LIMITS.MAX_SIMULATOR_DEVICES + 1 }, () => row),
      }).success,
    ).toBe(false);
    // the runtimes installed here ride with them (the attach's third pick): CoreSimulator's ids, never a UDID
    const runtimes = ["com.apple.CoreSimulator.SimRuntime.iOS-26-1"];
    expect(ShellSurfacesSimulatorDevicesResult.parse({ devices: [], runtimes })).toEqual({
      devices: [],
      runtimes,
    });
    expect(
      ShellSurfacesSimulatorDevicesResult.safeParse({
        devices: [],
        runtimes: ["F93EABF3-4281-4EB5-A5F6-A550FBE95CDC"],
      }).success,
    ).toBe(false);
  });

  it("requires a unique registered static method set and exactly one outcome arm", () => {
    expect(
      ShellProviderRegisterParams.safeParse({
        methods: [...SHELL_PROVIDER_METHODS],
      }).success,
    ).toBe(true);
    expect(
      ShellProviderRegisterParams.safeParse({
        methods: ["shell.openExternal", "shell.openExternal"],
      }).success,
    ).toBe(false);
    expect(
      ShellProviderRegisterResult.safeParse({
        registered: [...SHELL_PROVIDER_METHODS],
      }).success,
    ).toBe(true);
    expect(
      ShellProviderRegisterResult.safeParse({
        registered: ["shell.openExternal", "shell.openExternal"],
      }).success,
    ).toBe(false);
    expect(
      ShellProviderRegisterResult.safeParse({ registered: ["shell.openExternal"] }).success,
    ).toBe(false);
    expect(ShellProviderOutcome.safeParse({ result: { opened: true } }).success).toBe(true);
    expect(ShellProviderOutcome.safeParse({}).success).toBe(false);
    expect(ShellProviderOutcome.safeParse({ result: undefined }).success).toBe(false);
    expect(
      ShellProviderOutcome.safeParse({
        result: { opened: true },
        error: { kind: "INTERNAL", message: "no", retryable: false },
      }).success,
    ).toBe(false);
  });

  it("bounds and validates server-originated call notifications", () => {
    expect(
      ShellProviderCallParams.parse({
        callId: "shell-abcdefghijklmnop",
        method: "shell.openExternal",
        params: { url: "https://device.example.ts.net:12000/" },
        caller: { kind: "plugin", pluginId: "vibefield.browser", clientKind: "renderer" },
        deadlineAt: Date.now() + 5_000,
      }).caller,
    ).toMatchObject({ kind: "plugin", pluginId: "vibefield.browser" });
  });

  it("pins exact renderer replacement requests while keeping the result non-authoritative", () => {
    const rendererParticipant = {
      participantId: "renderer:desktop-test:window-1",
      incarnation: "renderer:desktop-test:window-1:document-2",
    };
    expect(
      ShellRendererRequestReplacementParams.parse({
        rendererParticipant,
        reason: "plugin-update-deadline",
      }),
    ).toEqual({ rendererParticipant, reason: "plugin-update-deadline" });
    expect(
      ShellRendererRequestReplacementParams.safeParse({
        rendererParticipant,
        reason: "renderer-said-so",
      }).success,
    ).toBe(false);
    expect(ShellRendererRequestReplacementResult.parse({ requested: true })).toEqual({
      requested: true,
    });
  });

  it("confines preview capture to a local artifact id and canonical AH root URL", () => {
    expect(
      ShellWebContentsCaptureArtifactPreviewParams.parse({
        artifactId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        url: "https://device.tail1234.ts.net:12000/",
      }),
    ).toMatchObject({ artifactId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
    for (const url of [
      "http://device.tail1234.ts.net:12000/",
      "https://device.tail1234.ts.net:9999/",
      "https://device.tail1234.ts.net:12000/path",
      "https://device.tail1234.ts.net:12000/?query=1",
      "https://device.example.com:12000/",
      "https://DEVICE.tail1234.ts.net:12000/",
      "https://user@device.tail1234.ts.net:12000/",
    ]) {
      expect(
        ShellWebContentsCaptureArtifactPreviewParams.safeParse({
          artifactId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          url,
        }).success,
        url,
      ).toBe(false);
    }
    expect(
      ShellWebContentsCaptureArtifactPreviewResult.parse({ captured: true, title: "Workbench" }),
    ).toEqual({ captured: true, title: "Workbench" });
    expect(
      ShellWebContentsCaptureArtifactPreviewResult.safeParse({
        captured: true,
        title: "x".repeat(129),
      }).success,
    ).toBe(false);
  });
});
