import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
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

  destroy(): void {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

function setup() {
  const targets = new Map<string, BrowserControlTargetWebContents>();
  const registry = new BrowserControlTargetRegistry({
    resolveTarget: (targetId) => targets.get(targetId),
  });
  return { targets, registry };
}

describe("BrowserControlTargetRegistry", () => {
  it("associates only an exact reverse-resolved target and keeps it across navigation", () => {
    const result = setup();
    const contents = new FakeContents(17, "target-A");
    result.targets.set(contents.targetId, contents);
    const binding = result.registry.associate("surface_0123456789abcdef", 1, contents);
    expect(binding).toMatchObject({
      surfaceId: "surface_0123456789abcdef",
      producerEpoch: 1,
      controlBindingRevision: 1,
      webContentsId: 17,
      targetId: "target-A",
    });
    contents.emit("did-navigate", "https://example.test/next");
    expect(result.registry.lookupPrivate(binding.surfaceId)).toBe(binding);
    expect(result.registry.status(binding.surfaceId)).toEqual({
      surfaceId: binding.surfaceId,
      controlBindingRevision: 1,
      bound: true,
      producerEpoch: 1,
      webContentsId: 17,
    });
  });

  it("rejects target-discovery ambiguity", () => {
    const result = setup();
    const contents = new FakeContents(17, "target-A");
    result.targets.set(contents.targetId, new FakeContents(18, "target-B"));
    expect(() => result.registry.associate("surface_0123456789abcdef", 1, contents)).toThrow(
      /exact Browser control target/,
    );
    expect(result.registry.status("surface_0123456789abcdef").bound).toBe(false);
  });

  it("revokes on destruction and replacement without letting the old target revoke the new one", () => {
    const result = setup();
    const first = new FakeContents(17, "target-A");
    const second = new FakeContents(18, "target-B");
    result.targets.set(first.targetId, first);
    result.targets.set(second.targetId, second);
    result.registry.associate("surface_0123456789abcdef", 1, first);
    const secondBinding = result.registry.associate("surface_0123456789abcdef", 2, second);
    expect(secondBinding.controlBindingRevision).toBe(3);
    first.destroy();
    expect(result.registry.lookupPrivate(secondBinding.surfaceId)).toBe(secondBinding);
    second.destroy();
    expect(result.registry.status(secondBinding.surfaceId)).toEqual({
      surfaceId: secondBinding.surfaceId,
      controlBindingRevision: 4,
      bound: false,
    });
  });

  it("revokes a target whose reverse lookup stops naming the exact WebContents", () => {
    const result = setup();
    const contents = new FakeContents(17, "target-A");
    result.targets.set(contents.targetId, contents);
    result.registry.associate("surface_0123456789abcdef", 1, contents);
    result.targets.delete(contents.targetId);
    expect(result.registry.lookupPrivate("surface_0123456789abcdef")).toBeNull();
    expect(result.registry.status("surface_0123456789abcdef")).toMatchObject({
      bound: false,
      controlBindingRevision: 2,
    });
  });
});
