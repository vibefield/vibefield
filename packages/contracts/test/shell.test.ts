import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "../src/registries";
import {
  APP_PREFERENCE_KEYS,
  AppPreferenceSetParams,
  AppPreferences,
  CloseReason,
  CloseRequest,
  CloseResult,
  ProductInfo,
  ShellCommandRequest,
  WindowConnection,
} from "../src/shell";

// Shell-boundary contracts (ESR spec §6.1–6.2). These shapes cross the Electron
// seam — product.json on the daemon filesystem boundary and the CLOSED
// contextBridge IPC surface — so the fixtures here double as the EL9
// tolerant-reader proof for that seam. Shapes are today's reality (port-based
// WindowConnection), not slice-4's WindowBootstrap envelope; contracts describe
// what ships.

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
  it("parses {port, token} and tolerates extra fields", () => {
    const parsed = WindowConnection.parse({
      port: 49213,
      token: "wnd_9f8e7d6c5b4a39281706",
      generation: 3, // an unknown field a future broker might add
    });
    expect(parsed.port).toBe(49213);
    expect(parsed.token).toBe("wnd_9f8e7d6c5b4a39281706");
    expect((parsed as Record<string, unknown>).generation).toBe(3);
  });

  const BAD_CONNECTION: ReadonlyArray<[string, unknown]> = [
    ["an empty token", { port: 49213, token: "" }],
    ["a non-positive port", { port: 0, token: "wnd_abc" }],
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
  it("exposes exactly the six channel keys, in order", () => {
    expect(Object.keys(IPC_CHANNELS)).toEqual([
      "windowBootstrap",
      "prepareClose",
      "closeResult",
      "rendererLogPort",
      "diagnosticsPort",
      "shellCommand",
    ]);
  });

  it("pins the exact channel strings (a new or renamed channel must move the spec table first)", () => {
    expect(IPC_CHANNELS).toEqual({
      windowBootstrap: "vibefield:shell:window-bootstrap",
      prepareClose: "vibefield:shell:prepare-close",
      closeResult: "vibefield:shell:close-result",
      rendererLogPort: "vibefield:logging:renderer-port",
      diagnosticsPort: "vibefield:diagnostics:host-port",
      shellCommand: "vibefield:shell:command",
    });
  });
});

describe("tray shell commands and app preferences", () => {
  it("keeps the renderer command set closed", () => {
    expect(ShellCommandRequest.parse({ command: "open-settings" }).command).toBe("open-settings");
    expect(ShellCommandRequest.parse({ command: "open-diagnostics" }).command).toBe(
      "open-diagnostics",
    );
    expect(ShellCommandRequest.safeParse({ command: "run-plugin-code" }).success).toBe(false);
  });

  it("requires a complete effective preference snapshot", () => {
    expect(AppPreferences.parse({ showTray: true, backgroundShell: false })).toEqual({
      showTray: true,
      backgroundShell: false,
    });
    expect(AppPreferences.safeParse({ showTray: true }).success).toBe(false);
  });

  it("accepts only the two boolean preference mutations", () => {
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
  });
});
