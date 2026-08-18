import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "../src/registries";
import {
  APP_PREFERENCE_KEYS,
  AppPreferenceSetParams,
  AppPreferences,
  CloseReason,
  CloseRequest,
  CloseResult,
  DesktopShellState,
  GodviewSetRequest,
  GodviewState,
  ProductInfo,
  RendererParticipantIdentity,
  SHELL_PROVIDER_METHODS,
  ShellCommandRequest,
  ShellDialogPickFolderParams,
  ShellDialogPickFolderResult,
  ShellOpenExternalParams,
  ShellProviderCallParams,
  ShellProviderOutcome,
  ShellProviderRegisterParams,
  ShellProviderRegisterResult,
  ShellRendererRequestReplacementParams,
  ShellRendererRequestReplacementResult,
  ShellWebContentsCaptureArtifactPreviewParams,
  ShellWebContentsCaptureArtifactPreviewResult,
  WindowConnection,
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
  it("exposes exactly the sixteen channel keys, in order", () => {
    expect(Object.keys(IPC_CHANNELS)).toEqual([
      "windowBootstrap",
      "prepareClose",
      "closeResult",
      "rendererLogPort",
      "diagnosticsPort",
      "liveSurfacePorts",
      "shellCommand",
      "desktopState",
      "terminalConnect",
      "terminalStatus",
      "godviewState",
      "godviewSet",
      "usersUpdate", // UA-3 — the Account page's profile write (main owns users.json)
      "usersList", // UA-5 — the roster; one truth for switcher + tray submenu
      "usersCreate", // UA-5 — mint user N under the §3.3 lock, then attach
      "usersSwitch", // UA-5/UA-D15 — attach re-target + window reload
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
      terminalConnect: "vibefield:terminal:connect",
      terminalStatus: "vibefield:terminal:status",
      godviewState: "vibefield:godview:state",
      godviewSet: "vibefield:godview:set",
      usersUpdate: "vibefield:users:update",
      usersList: "vibefield:users:list",
      usersCreate: "vibefield:users:create",
      usersSwitch: "vibefield:users:switch",
    });
  });
});

describe("Godview overlay state (GT-D2)", () => {
  it("carries one boolean — the overlay bit main owns", () => {
    expect(GodviewState.parse({ open: true })).toEqual({ open: true });
    expect(GodviewState.safeParse({}).success).toBe(false);
    expect(GodviewState.safeParse({ open: "yes" }).success).toBe(false);
  });

  it("lets a request omit `open`, which is how the renderer asks for a FLIP", () => {
    // The accelerator is consumed before any renderer sees the keystroke, so a
    // page that sent the value it believed could be arguing with one main had
    // already changed. Omission means "whatever it is, change it".
    expect(GodviewSetRequest.parse({})).toEqual({});
    expect(GodviewSetRequest.parse({ open: false })).toEqual({ open: false });
    expect(GodviewSetRequest.safeParse({ open: 1 }).success).toBe(false);
  });

  it("passes unknown fields through, like every other inbound shape (EL9)", () => {
    expect(GodviewState.parse({ open: false, future: "field" })).toEqual({
      open: false,
      future: "field",
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

  it("keeps the renderer command set closed", () => {
    expect(ShellCommandRequest.parse({ command: "open-settings" }).command).toBe("open-settings");
    expect(ShellCommandRequest.parse({ command: "open-diagnostics" }).command).toBe(
      "open-diagnostics",
    );
    expect(ShellCommandRequest.safeParse({ command: "run-plugin-code" }).success).toBe(false);
  });

  it("requires a complete effective preference snapshot", () => {
    expect(
      AppPreferences.parse({ showTray: true, backgroundShell: false, syncPosture: "opt-in" }),
    ).toEqual({ showTray: true, backgroundShell: false, syncPosture: "opt-in" });
    expect(AppPreferences.safeParse({ showTray: true }).success).toBe(false);
    // UA-6: the posture is part of the EFFECTIVE snapshot, so a caller can
    // never be handed one that leaves it to guess (the daemon folds the default).
    expect(AppPreferences.safeParse({ showTray: true, backgroundShell: true }).success).toBe(false);
  });

  it("accepts the boolean preference mutations, and the posture's own word", () => {
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
  it("pins the folder picker to its one purpose and bounded result union", () => {
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
