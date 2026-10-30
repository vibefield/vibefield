import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LiveSurfaceIosSimulatorBindingV1, validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { DESK_OBJECT, isObjectKind } from "@vibefield/plugin-sdk/desk";
import { activateWithMockHost } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  DEFAULT_PHONE,
  MM,
  PHONE_SIZE,
  PROP,
  SIMULATOR_BINDING_EXPORT,
  SIMULATOR_CATEGORY,
  SIMULATOR_KIND,
  SIMULATOR_TYPE,
  simulatorManifest,
  simulatorRenderer,
  UNBOUND,
} from "../src";
import * as rendererModule from "../src/renderer";

// The phone's contract in miniature (PT-S1): its manifest V1-validates and is committed as its own canonical emission; its one
// OBJECT row names an export of the renderer module whose kind the host will take — a desk kind whose registry name IS the
// row's type; it lies on the desk by the SDK's key and goes into no mini mat yet; its size is the default model's body at the
// desk's one scale and it is never resized nor turned (no angle prop); its props are model, finish and binding — each named
// once (ids.ts), the binding's default UNBOUND; it hangs on a shelf under its own new category; it asks for NO capability
// (surface.attach and surface.capture are PT-S2's); and its activation binds nothing (the kind is a static export).
describe("vibefield.simulator", () => {
  const row = simulatorManifest.contributes?.objects?.[0];

  it("declares one object and no widget, bound by name to the renderer module's export — a desk kind named by its type", () => {
    expect(simulatorManifest.contributes?.objects).toHaveLength(1);
    expect(simulatorManifest.id).toBe("vibefield.simulator");
    expect(row?.type).toBe(SIMULATOR_TYPE);
    expect(SIMULATOR_KIND).toBe(SIMULATOR_TYPE);
    expect(row?.binding.kind).toBe(SIMULATOR_BINDING_EXPORT);
    // the host reads a row's kind off the module's NAMESPACE by its binding name (spec §12.8)
    const exported = (rendererModule as unknown as Record<string, { kind?: unknown }>)[
      row?.binding.kind ?? ""
    ];
    const kind = exported?.kind;
    expect(isObjectKind(kind)).toBe(true);
    expect(isObjectKind(kind) ? kind.name : undefined).toBe(row?.type);
  });

  it("lies on the desk by the SDK's key — and goes into no mini mat yet (it has no chip)", () => {
    expect(row?.provides).toEqual([SIMULATOR_TYPE, DESK_OBJECT]);
  });

  it("keeps its model, its finish and its binding — named once, never an angle (a phone is never turned) nor a UDID", () => {
    expect(Object.keys(row?.props ?? {}).sort()).toEqual(
      [PROP.binding, PROP.finish, PROP.model].sort(),
    );
    expect(Object.keys(row?.props ?? {})).not.toContain("angle");
    const m = row?.props[PROP.model];
    expect(m?.kind === "string" ? m.default : undefined).toBe(DEFAULT_MODEL);
    const f = row?.props[PROP.finish];
    expect(f?.kind === "string" ? f.default : undefined).toBe(DEFAULT_PHONE.finishes[0]);
    const b = row?.props[PROP.binding];
    expect(b?.kind).toBe("json");
    expect(b?.kind === "json" ? b.default : undefined).toEqual(UNBOUND);
    // the default is unbound: the contract refuses it as a device (a fresh phone opens no face)
    expect(LiveSurfaceIosSimulatorBindingV1.safeParse(UNBOUND).success).toBe(false);
    // its shape is the contract's two ids — and nothing names a UDID
    expect(b?.kind === "json" ? b.inner : undefined).toEqual({
      kind: "object",
      fields: { deviceType: { kind: "string" }, runtime: { kind: "string" } },
    });
    expect(JSON.stringify(row?.props)).not.toMatch(/udid/i);
  });

  it("is the default model's body in size at the desk's one scale — never resized: a phone is its model's size", () => {
    expect(row?.size).toEqual(PHONE_SIZE);
    expect(PHONE_SIZE.w).toBeCloseTo(DEFAULT_PHONE.body.mm[0] * MM, 2);
    expect(PHONE_SIZE.h).toBeCloseTo(DEFAULT_PHONE.body.mm[1] * MM, 2);
    expect(row?.minSize).toBeUndefined();
    expect(row?.interaction).toEqual({
      selectable: true,
      movable: true,
      resizable: false,
      snap: "both",
    });
  });

  it("hangs on the pegboard on a SHELF under its own new category, `devices`, at its own aspect", () => {
    const tray = row?.tray;
    expect(tray?.category).toBe(SIMULATOR_CATEGORY);
    expect(tray?.category).toBe("devices");
    expect(["paper", "surfaces", "things", "comments", "portals"]).not.toContain(tray?.category);
    expect(tray?.label).toBe("Phone");
    expect(tray?.hang.accessory).toBe("shelf");
    expect((tray?.hang.w ?? 0) / PHONE_SIZE.w).toBeCloseTo((tray?.hang.h ?? 0) / PHONE_SIZE.h, 3);
    // its specimen is drawn by its own pass with the screen off: bound to nothing, with no desk state
    expect(tray?.props).toBeUndefined();
    expect(tray?.local).toBeUndefined();
  });

  it("asks for NO capability in PT-S1 — surface.attach and surface.capture (the Screen Recording class) are PT-S2's", () => {
    expect(simulatorManifest.capabilities).toEqual([]);
  });

  it("activates as any plugin does, binding no command, surface or behavior — its kind is its export", async () => {
    const session = await activateWithMockHost(simulatorRenderer, {
      id: simulatorManifest.id,
      version: simulatorManifest.version,
    });
    expect([...session.commands.keys()]).toEqual([]);
    expect([...session.surfaces.keys()]).toEqual([]);
    await session.close();
  });

  it("keeps the committed manifest byte-identical to its validated canonical emission", () => {
    const result = validatePluginManifest(simulatorManifest);
    if (!result.ok) throw new Error(result.issues.join(" · "));
    const artifact = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json"),
      "utf8",
    );
    expect(artifact).toBe(canonicalJson(result.manifest));
  });
});
