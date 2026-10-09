import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { DESK_OBJECT, isObjectKind } from "@vibefield/plugin-sdk/desk";
import { activateWithMockHost } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  BROWSER_PANE_CATEGORY,
  BROWSER_PANE_TYPE,
  browserPaneManifest,
  browserPaneRenderer,
  DEVICE_IDS,
  deviceById,
  PANE_FINISHES,
  PANE_MIN_SIZE,
  PANE_SCHEMES,
  PANE_SIZE,
  SAMPLE_URL,
  viewportOf,
} from "../src";
import * as rendererModule from "../src/renderer";

// The pane's contract in miniature (PT-1): its manifest V1-validates and is committed as its own canonical emission; its
// one OBJECT row names an export of the renderer module whose kind the host will take — a desk kind whose registry name
// IS the row's type, NOT the Artifacts panel's (`vibefield.browser`, untouched); it lies on the desk by the SDK's key and
// goes into no mini mat yet; its size is a laptop's page and its floor the smallest viewport; no `viewport` prop (the
// viewport is derived from the size); core resizes it; it hangs on a shelf under its own new category; and its
// activation binds nothing (the kind is a static export).
describe("vibefield.browser-pane", () => {
  const row = browserPaneManifest.contributes?.objects?.[0];

  it("declares one object and no widget, bound by name to the renderer module's export — a desk kind named by its type, not the Artifacts panel's", () => {
    expect(browserPaneManifest.contributes?.widgets).toBeUndefined();
    expect(browserPaneManifest.contributes?.objects).toHaveLength(1);
    expect(row?.type).toBe(BROWSER_PANE_TYPE);
    expect(browserPaneManifest.id).toBe("vibefield.browser-pane");
    expect(browserPaneManifest.id).not.toBe("vibefield.browser");
    // the host reads a row's kind off the module's NAMESPACE by its binding name (spec §12.8)
    const exported = (rendererModule as unknown as Record<string, { kind?: unknown }>)[
      row?.binding.kind ?? ""
    ];
    const kind = exported?.kind;
    expect(isObjectKind(kind)).toBe(true);
    expect(isObjectKind(kind) ? kind.name : undefined).toBe(row?.type);
  });

  it("lies on the desk by the SDK's key — and goes into no mini mat yet (it has no chip)", () => {
    expect(row?.provides).toEqual([BROWSER_PANE_TYPE, DESK_OBJECT]);
  });

  it("keeps the address, the device, the glass and the scheme — never a viewport: Size is the truth and the viewport its derivation", () => {
    expect(Object.keys(row?.props ?? {}).sort()).toEqual(["device", "finish", "scheme", "url"]);
    const device = row?.props.device;
    expect(device?.kind === "enum" ? [device.options, device.default] : undefined).toEqual([
      [...DEVICE_IDS],
      "laptop",
    ]);
    const finish = row?.props.finish;
    expect(finish?.kind === "enum" ? [finish.options, finish.default] : undefined).toEqual([
      [...PANE_FINISHES],
      "low-iron",
    ]);
    const scheme = row?.props.scheme;
    expect(scheme?.kind === "enum" ? [scheme.options, scheme.default] : undefined).toEqual([
      [...PANE_SCHEMES],
      "desk",
    ]);
    expect(row?.props.url?.kind === "string" ? row.props.url.default : undefined).toBe(SAMPLE_URL);
    expect(row?.groups).toEqual({});
  });

  it("is a laptop's page in size, resized by core's handles down to the smallest viewport at the finest density", () => {
    expect(row?.size).toEqual(PANE_SIZE);
    expect(row?.minSize).toEqual(PANE_MIN_SIZE);
    const laptop = deviceById("laptop");
    const phone = deviceById("phone");
    if (laptop === undefined || phone === undefined) throw new Error("devices");
    expect(viewportOf(PANE_SIZE, laptop)).toEqual([1280, 800]);
    expect(viewportOf(PANE_MIN_SIZE, phone)).toEqual([320, 240]);
    expect(row?.interaction).toEqual({
      selectable: true,
      movable: true,
      resizable: true,
      snap: "both",
    });
  });

  it("hangs on the pegboard on a SHELF under its own new category, `portals`, at its own aspect, its specimen with its desk state", () => {
    const tray = row?.tray;
    expect(tray?.category).toBe(BROWSER_PANE_CATEGORY);
    expect(tray?.category).toBe("portals");
    expect(["paper", "surfaces", "things", "comments"]).not.toContain(tray?.category);
    expect(tray?.label).toBe("Browser");
    expect(tray?.hang.accessory).toBe("shelf");
    expect((tray?.hang.w ?? 0) / PANE_SIZE.w).toBeCloseTo((tray?.hang.h ?? 0) / PANE_SIZE.h, 4);
    expect(tray?.local).toBe(true);
  });

  it("asks for a live page's two scopes — the desk's LIVE service opens a page only for an object whose plugin holds both (PT-2)", () => {
    expect([...browserPaneManifest.capabilities].sort()).toEqual([
      "surface.attach",
      "surface.browser",
    ]);
  });

  it("activates as any plugin does, binding no command, surface or behavior — its kind is its export", async () => {
    const session = await activateWithMockHost(browserPaneRenderer, {
      id: browserPaneManifest.id,
      version: browserPaneManifest.version,
    });
    expect([...session.commands.keys()]).toEqual([]);
    expect([...session.surfaces.keys()]).toEqual([]);
    await session.close();
  });

  it("keeps the committed manifest byte-identical to its validated canonical emission", () => {
    const result = validatePluginManifest(browserPaneManifest);
    if (!result.ok) throw new Error(result.issues.join(" · "));
    const artifact = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json"),
      "utf8",
    );
    expect(artifact).toBe(canonicalJson(result.manifest));
  });
});
