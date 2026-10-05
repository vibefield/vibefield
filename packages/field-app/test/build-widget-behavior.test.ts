import { ObjectContribution } from "@vibefield/contracts";
import { defineBehavior, p } from "@vibefield/plugin-sdk/behavior";
import type { ObjectKind } from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import { buildFacelessObjectType, buildObjectType } from "../src/plugin-host/build-widget";

// DK-8: these rows held WIDGET rows (compiled faceless) until `contributes.widgets` retired; the
// faceless path that remains is an OBJECT row's whose kind could not be bound, and it keeps the same
// rider law — a document's riders survive the missing face.
describe("host-built behavior riders", () => {
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
    const contribution = ObjectContribution.parse({
      type: `${pluginId}.card`,
      title: "Card",
      schemaVersion: 1,
      size: { w: 100, h: 80 },
      provides: ["desk.object"],
      behaviors: [{ id: Rider.name, data: { count: 3 } }],
      binding: { kind: "card" },
    });

    // an unbound object row compiles FACELESS — no kind argument at all
    const widget = buildFacelessObjectType(
      contribution,
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
      ObjectContribution.parse({
        type: `${pluginId}.${suffix}`,
        title: suffix,
        schemaVersion: 1,
        size: { w: 100, h: 80 },
        provides: ["desk.object"],
        behaviors: [{ id: behaviorId }],
        binding: { kind: "card" },
      });
    const owner = { pluginId, pluginTitle: "Defense" };

    expect(() => buildFacelessObjectType(contribution(Rider.name, "missing"), owner)).toThrow(
      /no sealed code binding/,
    );
    expect(() =>
      buildFacelessObjectType(
        contribution(Rider.name, "mismatch"),
        owner,
        new Map([[Rider.name, { handle: Other }]]),
      ),
    ).toThrow(/does not match/);
    expect(() =>
      buildFacelessObjectType(
        contribution("com.other:rider", "foreign"),
        owner,
        new Map([["com.other:rider", { handle: Rider }]]),
      ),
    ).toThrow(/outside plugin/);
    expect(() =>
      buildFacelessObjectType(
        contribution(Ephemeral.name, "ephemeral"),
        owner,
        new Map([[Ephemeral.name, { handle: Ephemeral }]]),
      ),
    ).toThrow(/cannot pre-attach ephemeral/);
  });

  it("DK-6 input (d) — an OBJECT row's riders keep the same law through the host's defineObject: a runtime rider rides, an ephemeral pre-attach is refused", () => {
    const pluginId = "com.example.object-rider";
    const Rider = defineBehavior(`${pluginId}:rider`, { store: "runtime" });
    const Ephemeral = defineBehavior(`${pluginId}:facet`, { store: "ephemeral" });
    const owner = { pluginId, pluginTitle: "Object riders" };
    const object = (behaviorId: string, suffix: string) => {
      const type = `${pluginId}.${suffix}`;
      const row = ObjectContribution.parse({
        type,
        title: suffix,
        schemaVersion: 1,
        size: { w: 100, h: 80 },
        provides: ["desk.object"],
        behaviors: [{ id: behaviorId }],
        binding: { kind: "kind" },
      });
      const kind: ObjectKind = {
        name: type,
        stratum: "things",
        reach: 0,
        create: () => Promise.reject(new Error("no GPU in a unit test")),
        resolve: () => ({}),
        record: () => ({}),
        hit: () => "content",
      };
      return { row, binding: { kind } };
    };

    const riding = object(Rider.name, "riding");
    const built = buildObjectType(
      riding.row,
      riding.binding,
      owner,
      new Map([[Rider.name, { handle: Rider }]]),
    );
    expect(built.behaviors.map((entry) => entry.behavior)).toEqual([Rider]);

    const facet = object(Ephemeral.name, "facet");
    expect(() =>
      buildObjectType(
        facet.row,
        facet.binding,
        owner,
        new Map([[Ephemeral.name, { handle: Ephemeral }]]),
      ),
    ).toThrow(/cannot pre-attach ephemeral/);
  });
});
