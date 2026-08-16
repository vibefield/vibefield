import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { resolveBrowserControlProviderBinding } from "../src/main/live-surfaces/browser-control-provider";
import {
  BrowserControlTargetRegistry,
  type BrowserControlTargetWebContents,
} from "../src/main/live-surfaces/browser-control-target";

class FakeContents extends EventEmitter implements BrowserControlTargetWebContents {
  destroyed = false;

  constructor(
    readonly id: number,
    readonly targetId: string,
  ) {
    super();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  getOrCreateDevToolsTargetId(): string {
    return this.targetId;
  }
}

function setup() {
  const targets = new Map<string, BrowserControlTargetWebContents>();
  const registry = new BrowserControlTargetRegistry({
    resolveTarget: (targetId) => targets.get(targetId),
  });
  return { targets, registry };
}

describe("Browser control provider handoff", () => {
  it("maps only the registry's exact reverse-validated private target", () => {
    const result = setup();
    const contents = new FakeContents(17, "target-A");
    result.targets.set(contents.targetId, contents);
    result.registry.associate("surface_0123456789abcdef", 3, contents);

    expect(
      resolveBrowserControlProviderBinding(result.registry, "surface_0123456789abcdef"),
    ).toEqual({
      surfaceId: "surface_0123456789abcdef",
      producerEpoch: 3,
      revision: 1,
      target: {
        webContentsId: 17,
        targetId: "target-A",
        contents,
      },
    });
  });

  it("fails closed when the target no longer reverse-resolves", () => {
    const result = setup();
    const contents = new FakeContents(17, "target-A");
    result.targets.set(contents.targetId, contents);
    result.registry.associate("surface_0123456789abcdef", 3, contents);
    result.targets.delete(contents.targetId);

    expect(
      resolveBrowserControlProviderBinding(result.registry, "surface_0123456789abcdef"),
    ).toBeNull();
    expect(result.registry.status("surface_0123456789abcdef")).toEqual({
      surfaceId: "surface_0123456789abcdef",
      controlBindingRevision: 2,
      bound: false,
    });
  });
});
