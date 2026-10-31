// @vitest-environment node
/**
 * The spine's surface registry (§8.4/A7): the side-panel slot holds ONE v1 contribution — the
 * Artifact Hub's, which the pill's sheet hosts on its Artifacts shelf since HN-8 (DESIGN.md §8
 * "Artifacts — the Artifacts shelf's contents"). Moved here from the edge tray's suite, which
 * retired with the edges (HN-8; PL-D1…PL-D3): the rule is the registry's, never the drawer's.
 */
import { afterEach, describe, expect, it } from "vitest";
import { getSurfacesSnapshot, register } from "../src/plugin-host/surface-registry";

const disposeEntries: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposeEntries.splice(0).reverse()) dispose();
});

function bindPanel(pluginId: string): void {
  const disposable = register(
    pluginId,
    `${pluginId}.artifacts`,
    "hud.side-panel",
    () => null,
    100,
    "Artifacts",
  );
  disposeEntries.push(() => disposable.dispose());
}

describe("the side-panel slot's one v1 contribution", () => {
  it("refuses a second side-panel contribution until the first unbinds", () => {
    bindPanel("vibefield.first-panel");
    expect(() => bindPanel("vibefield.second-panel")).toThrow(
      /already has its one v1 contribution/,
    );
    for (const dispose of disposeEntries.splice(0)) dispose();
    bindPanel("vibefield.second-panel");
    expect(
      getSurfacesSnapshot()
        .filter((entry) => entry.slot === "hud.side-panel")
        .map((entry) => entry.surfaceId),
    ).toEqual(["vibefield.second-panel.artifacts"]);
  });
});
