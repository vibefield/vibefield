import {
  type BehaviorContribution,
  type PluginModuleUrls,
  PluginRecord,
} from "@vibefield/contracts";
import type { RendererPluginContext, RendererPluginModule } from "@vibefield/plugin-sdk";
import { declareBehavior, defineBehavior, p } from "@vibefield/plugin-sdk/behavior";
import { describe, expect, it } from "vitest";
import {
  RendererActivationStageError,
  stageStagedRenderer,
} from "../src/plugin-host/renderer-harness";

function record(
  id: string,
  behavior: BehaviorContribution,
  grantedCapabilities: readonly string[] = [],
) {
  return PluginRecord.parse({
    id,
    version: "1.0.0",
    title: `${id} plugin`,
    source: "dev-linked",
    manifestHash: `sha256:${"c".repeat(64)}`,
    installRevision: "behavior-rev-1",
    state: "enabled",
    compatible: true,
    enabled: true,
    requestedCapabilities: ["canvas.write"],
    grantedCapabilities,
    deniedCapabilities: grantedCapabilities.includes("canvas.write")
      ? []
      : [{ capability: "canvas.write", reason: "revoked" }],
    grantGeneration: 3,
    contributions: {
      widgets: [],
      behaviors: [behavior],
      commands: [],
      surfaces: [],
      capabilities: [],
    },
    renderer: "inactive",
    service: "none",
  });
}

function moduleRow(id: string): PluginModuleUrls {
  return {
    pluginId: id,
    moduleUrl: `vibefield-plugin://${id.padEnd(32, "0").slice(0, 32)}`,
    manifestHash: `sha256:${"c".repeat(64)}`,
    installRevision: "behavior-rev-1",
  };
}

describe("renderer behavior candidate", () => {
  it("seals a complete inert binding while effective canvas.write is denied", async () => {
    const id = "com.example.renderer-denied";
    const Counter = defineBehavior(`${id}:counter`, {
      store: "runtime",
      schema: { count: p.number({ default: 0 }) },
      on: { init() {} },
    });
    let retainedContext: RendererPluginContext | undefined;
    let retainedBinding: { dispose(): void } | undefined;
    const candidate = await stageStagedRenderer(
      record(id, declareBehavior(Counter)),
      moduleRow(id),
      {
        activate(ctx) {
          retainedContext = ctx;
          expect(ctx.canvas).toBeDefined();
          retainedBinding = ctx.canvas?.behaviors.bind(Counter.name, Counter);
        },
      },
    );

    const bound = candidate.activation.behaviors.get(Counter.name);
    expect(bound).toMatchObject({
      pluginId: id,
      id: Counter.name,
      declarationIndex: 0,
      authorized: false,
    });
    expect(bound?.orderKey).toBe(`${id}\0${"0".repeat(6)}`);
    expect(bound?.handle).toBe(Counter);
    expect(() => retainedContext?.canvas?.behaviors.bind(Counter.name, Counter)).toThrow(/sealed/);

    candidate.commit();
    retainedBinding?.dispose();
    expect(candidate.activation.behaviors.get(Counter.name)?.handle).toBe(Counter);
    candidate.setBehaviorAuthorization(true);
    expect(candidate.activation.behaviors.get(Counter.name)?.authorized).toBe(true);

    await candidate.dispose();
    expect(candidate.activation.behaviors.size).toBe(0);

    const grantedId = "com.example.renderer-granted";
    const Granted = defineBehavior(`${grantedId}:counter`, { store: "runtime" });
    const granted = await stageStagedRenderer(
      record(grantedId, declareBehavior(Granted), ["canvas.write"]),
      moduleRow(grantedId),
      {
        activate(ctx) {
          ctx.canvas?.behaviors.bind(Granted.name, Granted);
        },
      },
    );
    expect(granted.activation.behaviors.get(Granted.name)?.authorized).toBe(true);
    await granted.dispose();
  });

  it("fails missing, duplicate, undeclared, and descriptor-drifted bindings before commit", async () => {
    const cases: Array<{
      id: string;
      module(handle: ReturnType<typeof defineBehavior>): RendererPluginModule;
      mutate?(row: BehaviorContribution): BehaviorContribution;
      pattern: RegExp;
    }> = [
      {
        id: "com.example.renderer-missing",
        module: () => ({ activate() {} }),
        pattern: /missing behavior bindings/,
      },
      {
        id: "com.example.renderer-duplicate",
        module: (handle) => ({
          activate(ctx) {
            ctx.canvas?.behaviors.bind(handle.name, handle);
            ctx.canvas?.behaviors.bind(handle.name, handle);
          },
        }),
        pattern: /already bound/,
      },
      {
        id: "com.example.renderer-undeclared",
        module: (handle) => {
          const Other = defineBehavior("com.example.renderer-undeclared:other", {
            store: "runtime",
          });
          return {
            activate(ctx) {
              ctx.canvas?.behaviors.bind(Other.name, Other);
              void handle;
            },
          };
        },
        pattern: /not declared/,
      },
      {
        id: "com.example.renderer-drift",
        module: (handle) => ({
          activate(ctx) {
            ctx.canvas?.behaviors.bind(handle.name, handle);
          },
        }),
        mutate: (row) => ({
          ...row,
          definition: {
            ...row.definition,
            schema: [
              ...row.definition.schema,
              { name: "drift", spec: { kind: "boolean", default: false } },
            ],
          },
        }),
        pattern: /descriptor does not match/,
      },
    ];

    for (const testCase of cases) {
      const Handle = defineBehavior(`${testCase.id}:declared`, { store: "runtime" });
      const declared = declareBehavior(Handle);
      const row = testCase.mutate?.(declared) ?? declared;
      await expect(
        stageStagedRenderer(
          record(testCase.id, row),
          moduleRow(testCase.id),
          testCase.module(Handle),
        ),
        testCase.id,
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(RendererActivationStageError);
        expect((error as Error).message).toMatch(testCase.pattern);
        return true;
      });
    }
  });
});
