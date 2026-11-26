import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  type BrowserAgentPage,
  type BrowserAgentPopups,
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

/** EY-1 (1g): a producer's page that is never held — what these rows' bindings carry. */
const PAGE: BrowserAgentPage = { held: false, onHeld: () => () => undefined };

/** EY-1 (1g): a producer's page under the test's hand — `set` moves its hold and tells each edge once. */
function fakePage() {
  let held = false;
  const listeners = new Set<(held: boolean) => void>();
  return {
    get held() {
      return held;
    },
    onHeld(listener: (held: boolean) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: boolean) {
      if (next === held) return;
      held = next;
      for (const listener of [...listeners]) listener(next);
    },
    listeners: () => listeners.size,
  };
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
    const binding = result.registry.associate("surface_0123456789abcdef", 1, contents, PAGE);
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
    expect(() => result.registry.associate("surface_0123456789abcdef", 1, contents, PAGE)).toThrow(
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
    result.registry.associate("surface_0123456789abcdef", 1, first, PAGE);
    const secondBinding = result.registry.associate("surface_0123456789abcdef", 2, second, PAGE);
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

  it("EY-1: the binding carries the producer's page; a revoked binding's page is dead — never held, no edge, its listeners let go", () => {
    const result = setup();
    const first = new FakeContents(17, "target-A");
    const second = new FakeContents(18, "target-B");
    result.targets.set(first.targetId, first);
    result.targets.set(second.targetId, second);
    const page = fakePage();
    const binding = result.registry.associate("surface_0123456789abcdef", 1, first, page);
    const edges: boolean[] = [];
    binding.page.onHeld((held) => edges.push(held));
    page.set(true);
    expect(binding.page.held).toBe(true);
    expect(edges).toEqual([true]);

    // the page's next window: a new binding of the same page; the old one's page is dead
    const next = result.registry.associate("surface_0123456789abcdef", 2, second, page);
    expect(next.page.held).toBe(true);
    expect(binding.page.held).toBe(false);
    page.set(false);
    expect(edges).toEqual([true]);
    const late: boolean[] = [];
    binding.page.onHeld((held) => late.push(held));
    page.set(true);
    expect(late).toEqual([]);

    // destroyed: the new binding's page is dead too, and nothing it took is left on the producer's page
    next.page.onHeld(() => undefined);
    second.destroy();
    expect(next.page.held).toBe(false);
    expect(page.listeners()).toBe(0);
  });

  it("EY-1 (1f): a binding passes its run's pop-up policy while it stands, and its revoke clears the one it set, once", () => {
    const result = setup();
    const first = new FakeContents(17, "target-A");
    const second = new FakeContents(18, "target-B");
    result.targets.set(first.targetId, first);
    result.targets.set(second.targetId, second);
    const told: Array<BrowserAgentPopups | null> = [];
    const page: BrowserAgentPage = {
      held: false,
      onHeld: () => () => undefined,
      popups: (policy) => {
        told.push(policy);
      },
    };
    const policy: BrowserAgentPopups = { decide: () => "allow", open: () => undefined };
    const binding = result.registry.associate("surface_0123456789abcdef", 1, first, page);
    binding.page.popups?.(policy);
    expect(told).toEqual([policy]);
    // the page's next window: the old binding is revoked first, and its revoke clears the policy it set
    const next = result.registry.associate("surface_0123456789abcdef", 2, second, page);
    expect(told).toEqual([policy, null]);
    // a dead binding's policy is not taken
    binding.page.popups?.(policy);
    expect(told).toEqual([policy, null]);
    // a binding that cleared its own clears nothing more at its revoke
    next.page.popups?.(policy);
    next.page.popups?.(null);
    second.destroy();
    expect(told).toEqual([policy, null, policy, null]);
  });

  it("revokes a target whose reverse lookup stops naming the exact WebContents", () => {
    const result = setup();
    const contents = new FakeContents(17, "target-A");
    result.targets.set(contents.targetId, contents);
    result.registry.associate("surface_0123456789abcdef", 1, contents, PAGE);
    result.targets.delete(contents.targetId);
    expect(result.registry.lookupPrivate("surface_0123456789abcdef")).toBeNull();
    expect(result.registry.status("surface_0123456789abcdef")).toMatchObject({
      bound: false,
      controlBindingRevision: 2,
    });
  });
});
