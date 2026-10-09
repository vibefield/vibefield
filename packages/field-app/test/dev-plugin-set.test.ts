// @vitest-environment node
// DK-8 — THE DEV PLUGIN SET IS THE PRODUCT'S: the plugins a dev run falls back to (and every headless suite
// registers) are the browser — its Artifacts panel alone — VibeField's own comment pad, and since PT-1 the browser
// PANE (PORTALS' first kind, `vibefield.browser-pane` — the Artifacts panel's plugin stays its own). The note
// (`desk.note` is the note), field-tools (the mini mat is the folder, the pad the comment) and widgetlab (its
// demos go) retired with their widgets, and widgetlab's HUD STATUS PANEL ("WIDGETLAB · STATUS … 18 widgets",
// `hud.panel`) went with its plugin. HUD surfaces are not widgets: the browser's side panel stays.
import { describe, expect, it } from "vitest";
import { buildDevRegistry, loadDevBundledPlugins } from "../src/field-engine";

describe("the dev plugin set is the product's (DK-8)", () => {
  it("is the browser, the comment pad and the browser pane — no type of the note, field-tools or widgetlab registered", async () => {
    const set = await loadDevBundledPlugins();
    expect(set.map((p) => p.manifest.id).sort()).toEqual([
      "vibefield.browser",
      "vibefield.browser-pane",
      "vibefield.comment-pad",
    ]);
    const types = [...(await buildDevRegistry()).allWidgets().keys()];
    expect(types.filter((t) => /^vibefield\.(note|field-tools|widgetlab)(\.|$)/.test(t))).toEqual(
      [],
    );
    expect(types).toContain("vibefield.comment-pad");
    expect(types).toContain("vibefield.browser-pane");
  });

  it("its HUD surfaces: the browser's Artifacts side panel stays; widgetlab's status panel went with its plugin", async () => {
    const surfaces = (await loadDevBundledPlugins()).flatMap((p) =>
      (p.manifest.contributes?.surfaces ?? []).map((s) => [s.id, s.slot]),
    );
    expect(surfaces).toEqual([["vibefield.browser.artifacts", "hud.side-panel"]]);
  });
});
