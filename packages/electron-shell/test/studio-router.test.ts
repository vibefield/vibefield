import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioRouter, type StudioRouterPort } from "../src/studio/router";

class FakePort implements StudioRouterPort {
  readonly sent: unknown[] = [];
  started = false;
  closed = false;
  private messageListener: ((event: { data: unknown }) => void) | null = null;
  private closeListener: (() => void) | null = null;

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  on(_event: "message", listener: (event: { data: unknown }) => void): this {
    this.messageListener = listener;
    return this;
  }

  once(_event: "close", listener: () => void): this {
    this.closeListener = listener;
    return this;
  }

  start(): void {
    this.started = true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeListener?.();
  }

  receive(data: unknown): void {
    this.messageListener?.({ data });
  }
}

function readyStudio(router: StudioRouter): FakePort {
  const port = new FakePort();
  router.attachStudio(port);
  port.receive({ type: "studio.ready", protocol: 2 });
  return port;
}

function readyProduct(router: StudioRouter, instanceId = "product-1"): FakePort {
  const port = new FakePort();
  router.attachProduct(port);
  port.receive({ type: "product.ready", protocol: 2, instanceId });
  return port;
}

afterEach(() => vi.useRealTimers());

describe("StudioRouter", () => {
  it("assigns revisions monotonically and never claims applied before product ack", () => {
    const router = new StudioRouter();
    const studio = readyStudio(router);
    const product = readyProduct(router);
    studio.sent.length = 0;
    product.sent.length = 0;

    studio.receive({ type: "appearance.publish", requestId: "r-1", serialized: '{"one":1}' });
    expect(studio.sent).toContainEqual({
      type: "appearance.accepted",
      requestId: "r-1",
      revision: 1,
    });
    expect(studio.sent).not.toContainEqual({ type: "appearance.applied", revision: 1 });
    expect(product.sent).toContainEqual({
      type: "appearance.apply",
      revision: 1,
      serialized: '{"one":1}',
    });

    product.receive({ type: "appearance.applied", revision: 1, instanceId: "product-1" });
    expect(studio.sent).toContainEqual({ type: "appearance.applied", revision: 1 });

    studio.receive({ type: "appearance.clear", requestId: "r-2" });
    expect(product.sent).toContainEqual({
      type: "appearance.clear",
      revision: 2,
      reason: "live-disabled",
    });
  });

  it("retains one latest snapshot and replays it to a replacement product", () => {
    const router = new StudioRouter();
    const studio = readyStudio(router);
    const firstProduct = readyProduct(router);

    studio.receive({ type: "appearance.publish", requestId: "r-1", serialized: '{"reach":1}' });
    studio.receive({ type: "appearance.publish", requestId: "r-2", serialized: '{"reach":2}' });
    expect(router.state()).toMatchObject({ revision: 2, retainedBytes: 11, live: true });

    const replacement = readyProduct(router, "product-2");
    expect(replacement.sent).toContainEqual({
      type: "appearance.apply",
      revision: 2,
      serialized: '{"reach":2}',
    });

    firstProduct.receive({
      type: "appearance.applied",
      revision: 2,
      instanceId: "product-1",
    });
    expect(router.state().appliedRevision).toBeNull();
    replacement.receive({ type: "appearance.applied", revision: 2, instanceId: "product-2" });
    expect(router.state().appliedRevision).toBe(2);
  });

  it("requires a fresh acknowledgement after a previously applied product is replaced", () => {
    const router = new StudioRouter();
    const studio = readyStudio(router);
    const firstProduct = readyProduct(router);

    studio.receive({ type: "appearance.publish", requestId: "r-1", serialized: "{}" });
    firstProduct.receive({
      type: "appearance.applied",
      revision: 1,
      instanceId: "product-1",
    });
    expect(router.state()).toMatchObject({
      productConnection: "connected",
      appliedRevision: 1,
    });

    const replacement = new FakePort();
    router.attachProduct(replacement);
    expect(router.state()).toMatchObject({
      productConnection: "reconnecting",
      appliedRevision: null,
    });
    replacement.receive({ type: "product.ready", protocol: 2, instanceId: "product-2" });
    expect(router.state()).toMatchObject({
      productConnection: "connected",
      appliedRevision: null,
    });

    replacement.receive({ type: "appearance.applied", revision: 1, instanceId: "product-1" });
    expect(router.state().appliedRevision).toBeNull();
    replacement.receive({ type: "appearance.applied", revision: 1, instanceId: "product-2" });
    expect(router.state().appliedRevision).toBe(1);
  });

  it("keeps the product override through a Studio reload grace and clears on expiry", () => {
    vi.useFakeTimers();
    const router = new StudioRouter();
    const studio = readyStudio(router);
    const product = readyProduct(router);
    studio.receive({ type: "appearance.publish", requestId: "r-1", serialized: '{"live":true}' });
    product.sent.length = 0;

    studio.close();
    vi.advanceTimersByTime(4_999);
    expect(product.sent).toEqual([]);

    const replacement = readyStudio(router);
    vi.advanceTimersByTime(1);
    expect(product.sent).toEqual([]);
    expect(replacement.sent).toContainEqual({
      type: "studio.snapshot",
      revision: 1,
      serialized: '{"live":true}',
      live: true,
    });

    replacement.close();
    vi.advanceTimersByTime(5_000);
    expect(product.sent).toContainEqual({
      type: "appearance.clear",
      revision: 2,
      reason: "studio-timeout",
    });
  });

  it("clears immediately on explicit close and rejects malformed publisher input", () => {
    const router = new StudioRouter();
    const studio = readyStudio(router);
    const product = readyProduct(router);
    studio.receive({ type: "appearance.publish", requestId: "r-1", serialized: "{}" });
    product.sent.length = 0;

    router.closeStudio("studio-closed");
    expect(product.sent).toContainEqual({
      type: "appearance.clear",
      revision: 2,
      reason: "studio-closed",
    });

    const malformed = readyStudio(router);
    malformed.receive({ type: "appearance.publish", requestId: "bad id", serialized: "{}" });
    expect(malformed.closed).toBe(true);
  });

  it("forwards a bounded rejection code from the current product only", () => {
    const router = new StudioRouter();
    const studio = readyStudio(router);
    const product = readyProduct(router);
    studio.receive({ type: "appearance.publish", requestId: "r-1", serialized: "{}" });
    studio.sent.length = 0;

    product.receive({
      type: "appearance.rejected",
      revision: 1,
      code: "invalid-document",
      instanceId: "product-1",
    });
    expect(studio.sent).toContainEqual({
      type: "appearance.rejected",
      revision: 1,
      code: "invalid-document",
    });
    expect(router.state().rejection).toBe("invalid-document");
  });

  it("reports a stable protocol failure before disconnecting the Studio endpoint", () => {
    const router = new StudioRouter();
    const studio = readyStudio(router);
    studio.sent.length = 0;

    studio.receive({ type: "appearance.publish", requestId: "bad id", serialized: "{}" });

    expect(studio.sent).toContainEqual({
      type: "studio.disconnected",
      reason: "malformed",
    });
    expect(studio.closed).toBe(true);
  });

  it("routes bounded product context and replays the requested Studio section", () => {
    const router = new StudioRouter();
    router.navigateStudio("appearance");
    const studio = readyStudio(router);
    const product = readyProduct(router);
    studio.sent.length = 0;

    product.receive({ type: "product.context", theme: "dark", zoom: 1.25 });
    expect(studio.sent).toContainEqual({
      type: "product.context",
      theme: "dark",
      zoom: 1.25,
    });

    const replacementStudio = readyStudio(router);
    expect(replacementStudio.sent).toContainEqual({
      type: "studio.navigate",
      section: "appearance",
    });
    expect(replacementStudio.sent).toContainEqual({
      type: "product.context",
      theme: "dark",
      zoom: 1.25,
    });
  });

  it("accepts only a ready Studio endpoint as the product-focus authority", () => {
    const focus = vi.fn();
    const router = new StudioRouter(Date.now, focus);
    const unready = new FakePort();
    router.attachStudio(unready);
    unready.receive({ type: "product.focus", requestId: "focus-0" });
    expect(focus).not.toHaveBeenCalled();
    expect(unready.closed).toBe(true);

    const studio = readyStudio(router);
    studio.receive({ type: "product.focus", requestId: "focus-1" });
    expect(focus).toHaveBeenCalledOnce();
  });

  it("leaves no reload-grace timer behind when the host disposes", () => {
    vi.useFakeTimers();
    const router = new StudioRouter();
    const studio = readyStudio(router);
    readyProduct(router);
    studio.receive({ type: "appearance.publish", requestId: "r-1", serialized: "{}" });
    studio.close();
    expect(vi.getTimerCount()).toBe(1);

    router.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
