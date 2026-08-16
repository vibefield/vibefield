import { describe, expect, it } from "vitest";
import {
  type ActivationScope,
  type BoundaryTerminationReport,
  type RendererRuntimeTarget,
  type RuntimeTargetCandidate,
  RuntimeTargetController,
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

async function until(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const stopAt = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() > stopAt) throw new Error("condition did not become true");
    await delay(0);
  }
}

function target(
  installRevision: string,
  options: {
    windowId?: string;
    authority?: string;
    grantGeneration?: number;
  } = {},
): RendererRuntimeTarget {
  return {
    face: "renderer",
    pluginId: "com.example.notes",
    instanceKey: { windowId: options.windowId ?? "window-a" },
    artifact: {
      installRevision,
      manifestHash: `sha256:${"a".repeat(64)}`,
    },
    authorityFingerprint: options.authority ?? "renderer:canvas.read",
    observedGrantGeneration: options.grantGeneration ?? 1,
  };
}

interface ProbeCandidate extends RuntimeTargetCandidate {
  readonly revision: string;
  readonly live: boolean;
  readonly disposeCalls: number;
}

function candidate(
  revision: string,
  publications: Set<string>,
  events: string[],
  onCommit?: () => void,
): ProbeCandidate {
  let live = true;
  let disposeCalls = 0;
  return {
    revision,
    get live() {
      return live;
    },
    get disposeCalls() {
      return disposeCalls;
    },
    commit() {
      if (!live) throw new Error(`commit after dispose: ${revision}`);
      events.push(`commit:${revision}`);
      publications.add(revision);
      onCommit?.();
    },
    dispose() {
      disposeCalls += 1;
      if (disposeCalls !== 1) throw new Error(`disposed twice: ${revision}`);
      publications.delete(revision);
      live = false;
      events.push(`dispose:${revision}`);
    },
  };
}

describe("RuntimeTargetController", () => {
  it("invalidates the first A episode across A→B→A and never publishes B", async () => {
    const publications = new Set<string>();
    const events: string[] = [];
    const firstGate = deferred<void>();
    let attempts = 0;
    const controller = new RuntimeTargetController("renderer/window-a", {
      activationDeadlineMs: 200,
      disposalDeadlineMs: 200,
      async activate(next) {
        attempts += 1;
        const result = candidate(
          `${next.artifact.installRevision}-${attempts}`,
          publications,
          events,
        );
        if (attempts === 1) await firstGate.promise;
        return result;
      },
    });

    controller.setDesired(target("a"));
    await until(() => controller.state === "loading");
    controller.setDesired(target("b"));
    controller.setDesired(target("a"));
    firstGate.resolve();
    await controller.settle();

    expect(controller.committed?.artifact.installRevision).toBe("a");
    expect(publications).toEqual(new Set(["a-2"]));
    expect(events).not.toContain("commit:a-1");
    expect(events).not.toContain("commit:b-2");
    expect(events.indexOf("dispose:a-1")).toBeLessThan(events.indexOf("commit:a-2"));
  });

  it("rotates semantic-equal provenance without reactivation", async () => {
    const publications = new Set<string>();
    const events: string[] = [];
    let activations = 0;
    const refreshes: Array<[number, number]> = [];
    const controller = new RuntimeTargetController("renderer/window-a", {
      activate(next) {
        activations += 1;
        return candidate(next.artifact.installRevision, publications, events);
      },
      refresh(_candidate, previous, next) {
        refreshes.push([previous.observedGrantGeneration, next.observedGrantGeneration]);
      },
    });

    controller.setDesired(target("a", { grantGeneration: 1 }));
    await controller.settle();
    controller.setDesired(target("a", { grantGeneration: 2 }));
    await controller.settle();
    expect(activations).toBe(1);
    expect(refreshes).toEqual([[1, 2]]);
    expect(controller.committed?.observedGrantGeneration).toBe(2);

    controller.setDesired(target("a", { grantGeneration: 3, authority: "renderer:canvas.write" }));
    await controller.settle();
    expect(activations).toBe(2);
    expect(events.indexOf("dispose:a")).toBeLessThan(events.lastIndexOf("commit:a"));
  });

  it("withdraws after failed credential refresh and makes one fresh activation", async () => {
    const publications = new Set<string>();
    const events: string[] = [];
    let activations = 0;
    let refreshes = 0;
    const controller = new RuntimeTargetController("renderer/window-a", {
      activate(next) {
        activations += 1;
        return candidate(`grant-${next.observedGrantGeneration}`, publications, events);
      },
      refresh() {
        refreshes += 1;
        throw new Error("credential broker unavailable");
      },
    });

    controller.setDesired(target("a", { grantGeneration: 1 }));
    await controller.settle();
    controller.setDesired(target("a", { grantGeneration: 2 }));
    await controller.settle();

    expect(refreshes).toBe(1);
    expect(activations).toBe(2);
    expect(controller.committed?.observedGrantGeneration).toBe(2);
    expect(publications).toEqual(new Set(["grant-2"]));
    expect(events).toEqual(["commit:grant-1", "dispose:grant-1", "commit:grant-2"]);
  });

  it("does not commit credentials from an older grant observation", async () => {
    const publications = new Set<string>();
    const events: string[] = [];
    const firstGate = deferred<void>();
    let activations = 0;
    const controller = new RuntimeTargetController("renderer/window-a", {
      async activate(next) {
        activations += 1;
        const result = candidate(`grant-${next.observedGrantGeneration}`, publications, events);
        if (activations === 1) await firstGate.promise;
        return result;
      },
    });

    controller.setDesired(target("a", { grantGeneration: 1 }));
    await until(() => controller.state === "loading");
    controller.setDesired(target("a", { grantGeneration: 2 }));
    firstGate.resolve();
    await controller.settle();

    expect(activations).toBe(2);
    expect(events).not.toContain("commit:grant-1");
    expect(publications).toEqual(new Set(["grant-2"]));
  });

  it("blocks replacement when worker force does not prove termination", async () => {
    const stuck = deferred<void>();
    const publications = new Set<string>();
    const events: string[] = [];
    const force: BoundaryTerminationReport = {
      terminated: false,
      forced: true,
      detail: "kill failed",
    };
    const controller = new RuntimeTargetController("service/device-a", {
      disposalDeadlineMs: 1,
      termination: { kind: "worker", force: () => force },
      activate(next, scope: ActivationScope) {
        const result = candidate(next.artifact.installRevision, publications, events);
        if (next.artifact.installRevision === "a") {
          scope.track("stuck", async () => await stuck.promise);
        }
        return result;
      },
    });

    controller.setDesired(target("a"));
    await controller.settle();
    controller.setDesired(target("b"));
    await controller.settle();
    expect(controller.state).toBe("non-quiescent");
    expect(controller.forcedCount).toBe(0);
    expect(events).not.toContain("commit:b");

    stuck.resolve();
    await until(() => controller.committed?.artifact.installRevision === "b");
  });

  it("permits replacement only after confirmed worker termination", async () => {
    const stuck = deferred<void>();
    const publications = new Set<string>();
    const events: string[] = [];
    const controller = new RuntimeTargetController("service/device-a", {
      disposalDeadlineMs: 1,
      termination: {
        kind: "worker",
        force: () => ({ terminated: true, forced: true }),
      },
      activate(next, scope) {
        const result = candidate(next.artifact.installRevision, publications, events);
        if (next.artifact.installRevision === "a") {
          scope.track("stuck", async () => await stuck.promise);
        }
        return result;
      },
    });

    controller.setDesired(target("a"));
    await controller.settle();
    controller.setDesired(target("b"));
    await controller.settle();
    expect(controller.committed?.artifact.installRevision).toBe("b");
    expect(controller.forcedCount).toBe(1);
    expect(publications).toEqual(new Set(["b"]));
    stuck.resolve();
  });

  it("keeps same-realm replacement non-quiescent until late setup settles", async () => {
    const gate = deferred<void>();
    const publications = new Set<string>();
    const events: string[] = [];
    const controller = new RuntimeTargetController("renderer/window-a", {
      activationDeadlineMs: 1,
      disposalDeadlineMs: 1,
      async activate(next) {
        if (next.artifact.installRevision === "a") await gate.promise;
        return candidate(next.artifact.installRevision, publications, events);
      },
    });

    controller.setDesired(target("a"));
    await controller.settle();
    expect(controller.state).toBe("non-quiescent");
    controller.setDesired(target("b"));
    await delay(3);
    expect(events).not.toContain("commit:b");

    gate.resolve();
    await until(() => controller.committed?.artifact.installRevision === "b");
  });

  it("cannot resurrect a target superseded from its synchronous commit listener", async () => {
    const publications = new Set<string>();
    const events: string[] = [];
    let controller: RuntimeTargetController<RendererRuntimeTarget, ProbeCandidate>;
    controller = new RuntimeTargetController("renderer/window-a", {
      activate(next) {
        return candidate(next.artifact.installRevision, publications, events, () => {
          if (next.artifact.installRevision === "a") controller.setDesired(target("b"));
        });
      },
    });

    controller.setDesired(target("a"));
    await controller.settle();
    expect(controller.committed?.artifact.installRevision).toBe("b");
    expect(publications).toEqual(new Set(["b"]));
    expect(events).toEqual(["commit:a", "dispose:a", "commit:b"]);
  });

  it("refuses an asynchronous candidate commit", async () => {
    let disposed = 0;
    const controller = new RuntimeTargetController<RendererRuntimeTarget, RuntimeTargetCandidate>(
      "renderer/window-a",
      {
        activate() {
          return {
            async commit() {
              await Promise.resolve();
            },
            dispose() {
              disposed += 1;
            },
          };
        },
      },
    );

    controller.setDesired(target("a"));
    await controller.settle();
    expect(controller.state).toBe("failed");
    expect(controller.snapshot().error).toBe("target candidate commit must be synchronous");
    expect(disposed).toBe(1);
  });

  it("isolates close to the exact renderer instance", async () => {
    const publications = new Set<string>();
    const events: string[] = [];
    const make = (windowId: string) =>
      new RuntimeTargetController<RendererRuntimeTarget, ProbeCandidate>(`renderer/${windowId}`, {
        activate() {
          return candidate(windowId, publications, events);
        },
      });
    const a = make("window-a");
    const b = make("window-b");
    a.setDesired(target("a", { windowId: "window-a" }));
    b.setDesired(target("a", { windowId: "window-b" }));
    await Promise.all([a.settle(), b.settle()]);
    expect(publications).toEqual(new Set(["window-a", "window-b"]));

    a.setDesired(null, { reason: { kind: "window-close", detail: "window-a" } });
    await a.settle();
    expect(a.state).toBe("inactive");
    expect(b.state).toBe("active");
    expect(publications).toEqual(new Set(["window-b"]));
  });

  it("bounds history and converges under seeded semantic/provenance churn", async () => {
    for (let seed = 1; seed <= 16; seed += 1) {
      let randomState = seed >>> 0;
      const random = () => {
        randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
        return randomState / 0x1_0000_0000;
      };
      const publications = new Set<string>();
      const events: string[] = [];
      const candidates: ProbeCandidate[] = [];
      let serial = 0;
      const controller = new RuntimeTargetController(`renderer/random-${seed}`, {
        activationDeadlineMs: 100,
        disposalDeadlineMs: 100,
        historyLimit: 24,
        async activate(next) {
          const result = candidate(
            `${next.artifact.installRevision}-${serial++}`,
            publications,
            events,
          );
          candidates.push(result);
          if (random() < 0.6) await delay(0);
          return result;
        },
        async refresh() {
          if (random() < 0.5) await delay(0);
        },
      });

      for (let step = 0; step < 40; step += 1) {
        if (random() < 0.22) controller.setDesired(null);
        else {
          controller.setDesired(
            target(`r${Math.floor(random() * 5)}`, {
              grantGeneration: step,
              authority: random() < 0.25 ? "renderer:canvas.write" : "renderer:canvas.read",
            }),
          );
        }
        if (random() < 0.72) await delay(0);
        expect(publications.size).toBeLessThanOrEqual(1);
      }

      controller.setDesired(target("final", { grantGeneration: 999 }));
      await controller.settle();
      expect(controller.committed?.artifact.installRevision, `seed ${seed}`).toBe("final");
      expect(publications.size, `seed ${seed} active publications`).toBe(1);
      expect(controller.snapshot().history.length).toBeLessThanOrEqual(24);
      controller.setDesired(null);
      await controller.settle();
      expect(publications.size, `seed ${seed} drained publications`).toBe(0);
      expect(candidates.every((entry) => !entry.live && entry.disposeCalls === 1)).toBe(true);
    }
  });
});
