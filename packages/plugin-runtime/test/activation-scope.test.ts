import { describe, expect, it } from "vitest";
import {
  ActivationEffectSetupError,
  ActivationScope,
  InactiveActivationScopeError,
} from "../src/index";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value) => resolvePromise?.(value) };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function handle(
  label: string,
  events: string[],
  options: {
    beforeDispose?: () => void;
    afterDispose?: () => void;
    delayMs?: number;
    error?: Error;
  } = {},
): { readonly live: boolean; readonly disposeCalls: number; dispose(): Promise<void> } {
  let live = true;
  let disposeCalls = 0;
  events.push(`acquire:${label}`);
  return {
    get live() {
      return live;
    },
    get disposeCalls() {
      return disposeCalls;
    },
    async dispose() {
      disposeCalls += 1;
      if (disposeCalls !== 1) throw new Error(`${label} disposed more than once`);
      options.beforeDispose?.();
      if (options.delayMs !== undefined) await delay(options.delayMs);
      if (options.error !== undefined) throw options.error;
      live = false;
      events.push(`dispose:${label}`);
      options.afterDispose?.();
    },
  };
}

describe("ActivationScope", () => {
  it("awaits teardown in strict reverse acquisition order", async () => {
    const events: string[] = [];
    let providerLive = true;
    const scope = new ActivationScope("renderer");
    scope.track(
      "provider",
      handle("provider", events, {
        afterDispose: () => {
          providerLive = false;
        },
      }),
    );
    scope.track(
      "consumer",
      handle("consumer", events, {
        beforeDispose: () => expect(providerLive).toBe(true),
        delayMs: 2,
      }),
    );

    scope.close({ kind: "disable" });
    const report = await scope.whenQuiescent();

    expect(report.quiescent).toBe(true);
    expect(events).toEqual([
      "acquire:provider",
      "acquire:consumer",
      "dispose:consumer",
      "dispose:provider",
    ]);
  });

  it("rolls back partial setup and preserves the primary error", async () => {
    const events: string[] = [];
    const scope = new ActivationScope("renderer");
    const first = handle("command", events);
    const second = handle("surface", events, { error: new Error("cleanup failed") });

    await expect(
      scope.effect("activate", async (effect) => {
        effect.track("command", first);
        await Promise.resolve();
        effect.track("surface", second);
        throw new Error("activation failed");
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ActivationEffectSetupError);
      const setup = error as ActivationEffectSetupError;
      expect(setup.cause).toBeInstanceOf(Error);
      expect((setup.cause as Error).message).toBe("activation failed");
      expect(setup.cleanup.errors).toEqual([
        { label: "surface", name: "Error", message: "cleanup failed" },
      ]);
      return true;
    });

    expect(first.disposeCalls).toBe(1);
    expect(second.disposeCalls).toBe(1);
    expect(events.at(-1)).toBe("dispose:command");
    scope.close({ kind: "manual" });
    await scope.whenQuiescent();
    expect(first.disposeCalls).toBe(1);
  });

  it("pre-registers effect ownership and the child setup marker before acquisition runs", async () => {
    const events: string[] = [];
    const gate = deferred<void>();
    const scope = new ActivationScope("renderer");
    let witnessedPendingSetups = 0;
    let witnessedEffectLabel: string | undefined;

    const setup = scope.effect("activate", async (effect) => {
      const during = scope.snapshot();
      witnessedEffectLabel = during.effects[0]?.label;
      witnessedPendingSetups = during.effects[0]?.child?.pendingSetups ?? 0;
      effect.track("command", handle("command", events));
      await gate.promise;
    });

    expect(witnessedEffectLabel).toBe("activate");
    expect(witnessedPendingSetups).toBe(1);
    scope.close({ kind: "activation-timeout" });
    expect(await scope.observe(0)).toMatchObject({ quiescent: false, pendingSetups: 1 });

    gate.resolve();
    await setup;
    await expect(scope.whenQuiescent()).resolves.toMatchObject({
      quiescent: true,
      pendingSetups: 0,
      liveCount: 0,
    });
    expect(events.at(-1)).toBe("dispose:command");
  });

  it("owns and cleans a setup result that arrives after close", async () => {
    const events: string[] = [];
    const acquired = deferred<ReturnType<typeof handle>>();
    const late = handle("late", events);
    const scope = new ActivationScope("renderer");
    const setup = scope.effect("activate", () => acquired.promise);

    scope.close({ kind: "activation-timeout" });
    const deadline = await scope.observe(0);
    expect(deadline.quiescent).toBe(false);
    expect(deadline.pendingSetups).toBe(1);

    acquired.resolve(late);
    await setup;
    const report = await scope.whenQuiescent();
    expect(report.quiescent).toBe(true);
    expect(report.stats.lateArrivals).toBe(1);
    expect(late.disposeCalls).toBe(1);
  });

  it("disposes and rejects an explicit resource tracked after close", async () => {
    const events: string[] = [];
    const scope = new ActivationScope("renderer");
    scope.close({ kind: "window-close" });
    await scope.whenQuiescent();
    const late = handle("too-late", events, { delayMs: 2 });

    expect(() => scope.track("too-late", late)).toThrow(InactiveActivationScopeError);
    expect(scope.report()).toMatchObject({ quiescent: false, lateCleanups: 1 });
    await expect(scope.whenQuiescent()).resolves.toMatchObject({
      quiescent: true,
      lateCleanups: 0,
    });
    expect(late.disposeCalls).toBe(1);
    expect(late.live).toBe(false);
  });

  it("starts cleanup once and preserves the first close reason", async () => {
    const events: string[] = [];
    const scope = new ActivationScope("renderer");
    const resource = handle("one", events, {
      beforeDispose: () => scope.close({ kind: "reload" }),
      delayMs: 2,
    });
    scope.track(resource);

    scope.close({ kind: "disable" });
    const [first, second] = await Promise.all([scope.observe(), scope.observe()]);

    expect(resource.disposeCalls).toBe(1);
    expect(first.reason).toEqual({ kind: "disable" });
    expect(second.stats).toEqual(first.stats);
  });

  it("reports deadline observation separately from eventual quiescence", async () => {
    const acquired = deferred<void>();
    const scope = new ActivationScope("same-realm");
    void scope.effect("activate", () => acquired.promise);

    scope.close({ kind: "activation-timeout" });
    const timed = await scope.observe(1);
    expect(timed).toMatchObject({ state: "closing", quiescent: false, pendingSetups: 1 });
    expect(scope.signal.aborted).toBe(true);

    acquired.resolve();
    await expect(scope.whenQuiescent()).resolves.toMatchObject({
      state: "closed",
      quiescent: true,
    });
  });

  it("does not report never-settling same-realm work as quiescent", async () => {
    const scope = new ActivationScope("same-realm");
    void scope.effect("activate", () => new Promise<void>(() => {}));

    scope.close({ kind: "activation-timeout" });
    await expect(scope.observe(1)).resolves.toMatchObject({
      state: "closing",
      quiescent: false,
      pendingSetups: 1,
    });
  });

  it("deduplicates exact handles across automatic, explicit, and returned ownership", async () => {
    const events: string[] = [];
    const scope = new ActivationScope("renderer");
    const shared = handle("shared", events);

    await scope.effect("registration", async (effect) => {
      effect.track("host:auto", shared);
      expect(effect.track("plugin:explicit", shared)).toBe(shared);
      expect(effect.track(shared)).toBe(shared);
      return shared;
    });
    scope.close({ kind: "disable" });
    const report = await scope.whenQuiescent();

    expect(shared.disposeCalls).toBe(1);
    expect(report.stats).toMatchObject({ acquired: 2, disposed: 2 });
  });

  it("compacts closed child generations beneath a live parent", async () => {
    const parent = new ActivationScope("renderer");
    for (let generation = 0; generation < 100; generation += 1) {
      const child = parent.child(`behavior-${generation}`);
      child.track({ dispose() {} });
      child.close({ kind: "reload" });
      await child.whenQuiescent();
      expect(parent.snapshot().effects).toHaveLength(0);
    }

    parent.close({ kind: "window-close" });
    const report = await parent.whenQuiescent();
    expect(report.stats).toMatchObject({ acquired: 200, disposed: 200 });
  });

  it("bounds diagnostic labels, effect projection, and cleanup errors", async () => {
    const scope = new ActivationScope("diagnostics", {
      maxDiagnosticEffects: 2,
      maxDiagnosticErrors: 2,
      maxLabelLength: 16,
    });
    for (let index = 0; index < 4; index += 1) {
      scope.track(`resource-${index}-${"x".repeat(30)}`, {
        dispose() {
          throw new Error(`failure-${index}-${"x".repeat(1_000)}`);
        },
      });
    }
    const before = scope.snapshot();
    expect(before.effects).toHaveLength(2);
    expect(before.omittedEffects).toBe(2);
    expect(before.effects.every((effect) => effect.label.length <= 16)).toBe(true);

    scope.close({ kind: "manual" });
    const after = await scope.whenQuiescent();
    expect(after.errors).toHaveLength(2);
    expect(after.errors.every((error) => error.message.length <= 512)).toBe(true);
    expect(after.omittedErrors).toBe(2);
  });
});
