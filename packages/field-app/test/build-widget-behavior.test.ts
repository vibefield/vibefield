import { WidgetContribution } from "@vibefield/contracts";
import { defineBehavior, p } from "@vibefield/plugin-sdk/behavior";
import { describe, expect, it } from "vitest";
import { buildWidgetType } from "../src/plugin-host/build-widget";

describe("host-built widget behavior riders", () => {
  it("resolves the manifest id through the sealed code map and stays dormant", () => {
    const pluginId = "com.example.widget-rider";
    let inits = 0;
    const Rider = defineBehavior(`${pluginId}:counter`, {
      store: "runtime",
      schema: { count: p.number({ default: 0 }) },
      on: {
        init() {
          inits += 1;
        },
      },
    });
    const contribution = WidgetContribution.parse({
      type: `${pluginId}.card`,
      title: "Card",
      schemaVersion: 1,
      surface: "dom",
      sizeMode: "fixed",
      defaultSize: { w: 100, h: 80 },
      behaviors: [{ id: Rider.name, data: { count: 3 } }],
    });

    const widget = buildWidgetType(
      contribution,
      { component: () => null },
      { pluginId, pluginTitle: "Rider" },
      new Map([[Rider.name, { handle: Rider }]]),
    );

    expect(widget.behaviors).toHaveLength(1);
    expect(widget.behaviors[0]?.behavior).toBe(Rider);
    expect(widget.behaviors[0]?.data).toEqual({ count: 3 });
    expect(inits).toBe(0);
  });

  it("defensively refuses missing, mismatched, cross-plugin, and ephemeral handles", () => {
    const pluginId = "com.example.widget-defense";
    const Rider = defineBehavior(`${pluginId}:rider`, { store: "runtime" });
    const Other = defineBehavior(`${pluginId}:other`, { store: "runtime" });
    const Ephemeral = defineBehavior(`${pluginId}:facet`, { store: "ephemeral" });
    const contribution = (behaviorId: string, suffix: string) =>
      WidgetContribution.parse({
        type: `${pluginId}.${suffix}`,
        title: suffix,
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 100, h: 80 },
        behaviors: [{ id: behaviorId }],
      });
    const binding = { component: () => null };
    const owner = { pluginId, pluginTitle: "Defense" };

    expect(() => buildWidgetType(contribution(Rider.name, "missing"), binding, owner)).toThrow(
      /no sealed code binding/,
    );
    expect(() =>
      buildWidgetType(
        contribution(Rider.name, "mismatch"),
        binding,
        owner,
        new Map([[Rider.name, { handle: Other }]]),
      ),
    ).toThrow(/does not match/);
    expect(() =>
      buildWidgetType(
        contribution("com.other:rider", "foreign"),
        binding,
        owner,
        new Map([["com.other:rider", { handle: Rider }]]),
      ),
    ).toThrow(/outside plugin/);
    expect(() =>
      buildWidgetType(
        contribution(Ephemeral.name, "ephemeral"),
        binding,
        owner,
        new Map([[Ephemeral.name, { handle: Ephemeral }]]),
      ),
    ).toThrow(/cannot pre-attach ephemeral/);
  });
});
