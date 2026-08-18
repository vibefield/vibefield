import { describe, expect, it } from "vitest";
import { ARTIFACT_LIMITS } from "../src/artifacts";
import { DEVICE_LIMITS } from "../src/devices";
import { LOCALITIES, METHODS, SURFACES } from "../src/methods";
import {
  DESKTOP_APP_ID,
  DESKTOP_TRAY_GUID,
  HOST_SINGLETON_EXTERNALS,
  HOST_SINGLETON_MODULE_SPECIFIERS,
  LOG_STREAMS,
  MESH_CONTROL_LIMITS,
  PORTS,
  SCOPES,
  SOCKETS,
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

  it("keeps the renderer update participant lane local and identity-gated by handlers", () => {
    expect(
      METHODS.filter((method) => method.method.startsWith("plugins.update.")).map((method) => ({
        method: method.method,
        scope: method.scope,
        locality: method.locality,
        subscription: method.subscription ?? false,
      })),
    ).toEqual([
      {
        method: "plugins.update.subscribe",
        scope: "plugins.read",
        locality: "local",
        subscription: true,
      },
      {
        method: "plugins.update.ack",
        scope: "plugins.read",
        locality: "local",
        subscription: false,
      },
      {
        method: "plugins.update.source",
        scope: "plugins.read",
        locality: "local",
        subscription: false,
      },
      {
        method: "plugins.update.source.release",
        scope: "plugins.read",
        locality: "local",
        subscription: false,
      },
      {
        method: "plugins.update.leave",
        scope: "plugins.read",
        locality: "local",
        subscription: false,
      },
    ]);
  });

  it("socket names fit the tightest path budget (UA-D9 — sun_path)", () => {
    // The tightest real prefix is the repo-nested dev root's users/<fuid>
    // tree; 14 chars keeps every socket under the 103-byte macOS sun_path
    // ceiling there with three-digit-fuid headroom. 2026-08-05:
    // terminal-control.sock (21 chars → a 108-byte path) crashed the dev
    // terminal plane exactly this way — bind failed, the guard had only
    // measured mgmt.sock. Longer names need a shallower tree, not a waiver.
    for (const name of Object.values(SOCKETS)) {
      expect(name.endsWith(".sock"), `${name} must end .sock`).toBe(true);
      expect(name.length, `${name} exceeds the 14-char socket name budget`).toBeLessThanOrEqual(14);
    }
  });

  it("guestOk methods are idempotent, non-mutating, and exactly the v1 set (UA-4 / UA-D14)", () => {
    const guestOk = METHODS.filter((m) => m.guestOk === true);
    // spec §7.3 v1 law: system.hello only. Widening is a deliberate edit
    // against this pin, never drift.
    expect(guestOk.map((m) => m.method)).toEqual(["system.hello"]);
    for (const m of guestOk) {
      expect(m.idempotent, `${m.method}: guestOk ⇒ idempotent`).toBe(true);
      expect(
        m.scope === null || /\.(read|observe)$/.test(m.scope),
        `${m.method}: guestOk ⇒ non-mutating scope (got ${m.scope})`,
      ).toBe(true);
    }
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

  it("does not classify a state-advancing preview refresh as replay-safe", () => {
    expect(METHODS.find((method) => method.method === "artifact.refreshPreview")).toMatchObject({
      idempotent: false,
      locality: "local",
    });
  });
});

describe("installed desktop identity", () => {
  it("pins the frozen application and status-item identities", () => {
    expect(DESKTOP_APP_ID).toBe("com.jamesyong.vibefield");
    expect(DESKTOP_TRAY_GUID).toBe("c524c40e-05b6-4d89-bbb9-82ba4e97ea91");
  });
});

describe("host singleton registries (PA-29 / plugin spec §11.6)", () => {
  it("pins the externals list byte-exactly", () => {
    // Every entry is a bundler external at pack time AND an import-map key at
    // load time, so adding or renaming one moves both halves of PA-29 at once.
    // The pin is here to make that a deliberate edit against a failing test.
    expect(HOST_SINGLETON_EXTERNALS).toEqual([
      "react",
      "react-dom",
      "react/jsx-runtime",
      "three",
      "@react-three/fiber",
      "@react-three/drei",
      "@vibefield/plugin-sdk",
      "@vibecook/ice",
      "loro-crdt",
    ]);
  });

  it("binds at least every external, and every extra is a subpath of one", () => {
    for (const external of HOST_SINGLETON_EXTERNALS) {
      expect(HOST_SINGLETON_MODULE_SPECIFIERS, `${external} must be bindable`).toContain(external);
    }
    // The subpath arm is why the two lists differ at all: the bundler
    // externalizes by prefix, so an artifact emits `@vibefield/plugin-sdk/ui`
    // while the root list only names `@vibefield/plugin-sdk`. What it must NOT
    // grow is a specifier rooted outside PA-29 — that would be the host
    // offering a module no singleton rule covers.
    const extras = HOST_SINGLETON_MODULE_SPECIFIERS.filter(
      (spec) => !(HOST_SINGLETON_EXTERNALS as readonly string[]).includes(spec),
    );
    expect(extras).toEqual([
      "@vibefield/plugin-sdk/ui",
      "@vibefield/plugin-sdk/canvas",
      "@vibefield/plugin-sdk/behavior",
    ]);
    for (const extra of extras) {
      expect(
        HOST_SINGLETON_EXTERNALS.some((root) => extra.startsWith(`${root}/`)),
        `${extra} is not a subpath of any host singleton`,
      ).toBe(true);
    }
  });

  it("names each module once — an import map key cannot be declared twice", () => {
    expect(new Set(HOST_SINGLETON_MODULE_SPECIFIERS).size).toBe(
      HOST_SINGLETON_MODULE_SPECIFIERS.length,
    );
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
