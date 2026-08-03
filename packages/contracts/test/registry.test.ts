import { describe, expect, it } from "vitest";
import { ARTIFACT_LIMITS } from "../src/artifacts";
import { DEVICE_LIMITS } from "../src/devices";
import { LOCALITIES, METHODS, SURFACES } from "../src/methods";
import {
  DESKTOP_APP_ID,
  DESKTOP_TRAY_GUID,
  LOG_STREAMS,
  MESH_CONTROL_LIMITS,
  PORTS,
  SCOPES,
  TAILNET_SCOPES,
} from "../src/registries";

describe("method registry lint (design-01 §9.2 + D36)", () => {
  it("every method is fully declared", () => {
    for (const m of METHODS) {
      expect(SURFACES).toContain(m.surface);
      expect(LOCALITIES, `${m.method} missing locality`).toContain(m.locality);
      if (m.scope !== null) expect(SCOPES).toContain(m.scope);
      expect(m.method).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/);
      expect(typeof m.idempotent).toBe("boolean");
    }
  });
  it("method names are unique", () => {
    const names = METHODS.map((m) => m.method);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("port registry", () => {
  it("no port is assigned twice", () => {
    const values = Object.values(PORTS);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("mesh control limits", () => {
  it("keeps public-store readers on the generated cross-plane budgets", () => {
    expect(ARTIFACT_LIMITS.SLICE_BYTES).toBe(MESH_CONTROL_LIMITS.ARTIFACT_SLICE_BYTES);
    expect(DEVICE_LIMITS.SLICE_BYTES).toBe(MESH_CONTROL_LIMITS.DEVICE_SLICE_BYTES);
    expect(DEVICE_LIMITS.REMOTE_ORIGINS).toBe(MESH_CONTROL_LIMITS.REMOTE_ORIGINS);
    expect(MESH_CONTROL_LIMITS.MGMT_QUEUED_BYTES).toBeGreaterThan(
      MESH_CONTROL_LIMITS.MGMT_FRAME_BYTES,
    );
  });
});

describe("installed desktop identity", () => {
  it("pins the frozen application and status-item identities", () => {
    expect(DESKTOP_APP_ID).toBe("com.jamesyong.vibefield");
    expect(DESKTOP_TRAY_GUID).toBe("c524c40e-05b6-4d89-bbb9-82ba4e97ea91");
  });
});

describe("logging registries (LOG-43/LOG-44)", () => {
  it("declares unique, fixed category/basename pairs", () => {
    const streams = Object.values(LOG_STREAMS);
    expect(new Set(streams).size).toBe(streams.length);
    for (const stream of streams) {
      expect(stream).toMatch(/^(?:system|plugins)\/[a-z][a-z-]*$/);
    }
  });

  it("keeps diagnostics and audit scopes local-only", () => {
    for (const scope of [
      "diagnostics.read",
      "diagnostics.manage",
      "audit.append",
      "settings.manage",
    ] as const) {
      expect(SCOPES).toContain(scope);
      expect(TAILNET_SCOPES).not.toContain(scope);
    }
  });

  it("declares the exact trusted app-preference surface", () => {
    const methods = METHODS.filter((method) => method.method.startsWith("storage.appPreferences."));
    expect(methods.map((method) => method.method)).toEqual([
      "storage.appPreferences.get",
      "storage.appPreferences.set",
      "storage.appPreferences.subscribe",
    ]);
    for (const method of methods) {
      expect(method.scope).toBe("settings.manage");
      expect(method.locality).toBe("sync");
    }
  });

  it("declares the exact AH-3 static shell provider surface", () => {
    const methods = METHODS.filter((method) => method.method.startsWith("shell."));
    expect(methods.map((method) => method.method)).toEqual([
      "shell.provider.register",
      "shell.provider.resolve",
      "shell.dialog.pickFolder",
      "shell.openExternal",
    ]);
    expect(methods.map(({ scope }) => scope)).toEqual([null, null, "shell.dialog", "shell.open"]);
    expect(methods.every(({ locality }) => locality === "local")).toBe(true);
  });
});
