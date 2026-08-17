import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { ChildOf, declareBehavior, defineBehavior, Position, p } from "../src/behavior";
import type { RendererPluginModule } from "../src/index";
import { activateWithMockHost } from "../src/testing";

describe("React-free behavior authoring door", () => {
  it("projects ICE's complete canonical descriptor into signed manifest truth", () => {
    const Layout = defineBehavior("com.example.sdk:layout", {
      store: "durable",
      derived: true,
      version: 2,
      budgetMs: 4,
      schema: {
        gap: p.number({ default: 120, min: 0, max: 500 }),
        mode: p.enum(["row", "tree"], { default: "tree" }),
      },
      reads: [Position, ChildOf],
      writes: [Position],
      migrate: { 1: (previous) => previous },
      tick: { while: "visible" },
      on: { changed() {}, tick() {} },
    });

    expect(declareBehavior(Layout, { reason: "Keep visible map branches arranged" })).toEqual({
      id: "com.example.sdk:layout",
      reason: "Keep visible map branches arranged",
      definition: {
        store: "durable",
        derived: true,
        deriveDuringGesture: false,
        version: 2,
        phase: "derive",
        budgetMs: 4,
        tickWhile: "visible",
        schema: [
          { name: "gap", spec: { kind: "number", default: 120, min: 0, max: 500 } },
          {
            name: "mode",
            spec: { kind: "enum", options: ["row", "tree"], default: "tree" },
          },
        ],
        reads: [
          { kind: "component", name: "Position" },
          { kind: "relation", name: "ChildOf" },
        ],
        writes: ["Position"],
        migrationFrom: [1],
        hooks: ["changed", "tick"],
      },
    });
  });

  it("applies the tick-reason honesty tax during authoring", () => {
    const Tick = defineBehavior("com.example.sdk:tick-reason", {
      store: "runtime",
      on: { tick() {} },
    });
    expect(() => declareBehavior(Tick)).toThrow(/tick behavior requires/);
  });

  it("has no React-bearing source edge", () => {
    const source = readFileSync(new URL("../src/behavior.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["']react(?:\/|["'])/);
    expect(source).not.toContain('from "./canvas"');
    expect(source).not.toContain('from "./index"');

    const iceSource = readFileSync(createRequire(import.meta.url).resolve("@vibecook/ice"), "utf8");
    expect(iceSource).not.toMatch(/from\s+["']react(?:\/|["'])/);
  });
});

describe("mock host behavior binding", () => {
  it("binds a complete inert declaration even with no canvas engine/grant", async () => {
    const Counter = defineBehavior("com.example.mock:counter", { store: "runtime" });
    let retainedContext: Parameters<RendererPluginModule["activate"]>[0] | undefined;
    let retainedBinding: { dispose(): void } | undefined;
    const mod: RendererPluginModule = {
      activate(ctx) {
        retainedContext = ctx;
        expect(ctx.canvas?.engine()).toBeNull();
        retainedBinding = ctx.canvas?.behaviors.bind(Counter.name, Counter);
      },
    };

    const activation = await activateWithMockHost(mod, {
      id: "com.example.mock",
      declaredBehaviors: [Counter.name],
    });
    expect(activation.behaviors.get(Counter.name)).toBe(Counter);
    expect(() => retainedContext?.canvas?.behaviors.bind(Counter.name, Counter)).toThrow(/sealed/);
    retainedBinding?.dispose();
    expect(activation.behaviors.get(Counter.name)).toBe(Counter);

    await activation.close();
    expect(activation.behaviors.size).toBe(0);
  });

  it("refuses undeclared, duplicate, mismatched, and missing bindings", async () => {
    const Declared = defineBehavior("com.example.mock:declared", { store: "runtime" });
    const Other = defineBehavior("com.example.mock:other", { store: "runtime" });

    await expect(
      activateWithMockHost(
        {
          activate(ctx) {
            ctx.canvas?.behaviors.bind(Other.name, Other);
          },
        },
        { declaredBehaviors: [Declared.name] },
      ),
    ).rejects.toThrow(/not declared/);

    await expect(
      activateWithMockHost(
        {
          activate(ctx) {
            ctx.canvas?.behaviors.bind(Declared.name, Declared);
            ctx.canvas?.behaviors.bind(Declared.name, Declared);
          },
        },
        { declaredBehaviors: [Declared.name] },
      ),
    ).rejects.toThrow(/already bound/);

    await expect(
      activateWithMockHost(
        {
          activate(ctx) {
            ctx.canvas?.behaviors.bind(Declared.name, Other);
          },
        },
        { declaredBehaviors: [Declared.name] },
      ),
    ).rejects.toThrow(/does not match/);

    await expect(
      activateWithMockHost({ activate() {} }, { declaredBehaviors: [Declared.name] }),
    ).rejects.toThrow(/missing behavior bindings/);

    await expect(
      activateWithMockHost(
        {
          activate(ctx) {
            ctx.canvas?.behaviors.bind(Declared.name, Declared);
          },
        },
        {
          declaredBehaviors: [
            {
              ...declareBehavior(Declared),
              definition: {
                ...declareBehavior(Declared).definition,
                schema: [
                  ...declareBehavior(Declared).definition.schema,
                  { name: "drift", spec: { kind: "boolean", default: false } },
                ],
              },
            },
          ],
        },
      ),
    ).rejects.toThrow(/descriptor does not match/);
  });
});
