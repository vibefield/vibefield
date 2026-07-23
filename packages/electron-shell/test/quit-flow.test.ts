import { describe, expect, it, vi } from "vitest";
import { createQuitFlow } from "../src/main/quit-flow";

// The quit flow's contract (review P1): teardown is AWAITED — exit() fires
// only after dispose settles or the bound expires; the native quit is always
// deferred; fatal takes the same path with code 1. Electron-free by design.

function make(over?: { boundMs?: number; dispose?: () => Promise<void> }) {
  const calls: string[] = [];
  let settle: () => void = () => {};
  const deps = {
    closeWindows: vi.fn(() => {
      calls.push("windows");
    }),
    dispose: vi.fn(
      over?.dispose ??
        (() => {
          calls.push("dispose");
          return new Promise<void>((resolve) => {
            settle = () => {
              calls.push("disposed");
              resolve();
            };
          });
        }),
    ),
    exit: vi.fn((code: number) => {
      calls.push(`exit(${code})`);
    }),
    onFatal: vi.fn(),
    onTeardownError: vi.fn(),
    boundMs: over?.boundMs ?? 500,
  };
  return { flow: createQuitFlow(deps), deps, calls, settle: () => settle() };
}

describe("createQuitFlow", () => {
  it("defers the native quit and exits 0 only AFTER dispose settles, windows first", async () => {
    const { flow, deps, calls, settle } = make();
    const preventDefault = vi.fn();

    flow.willQuit(preventDefault);
    expect(preventDefault).toHaveBeenCalledTimes(1); // the quit never proceeds natively
    expect(calls).toEqual(["windows", "dispose"]); // teardown started, exit NOT yet
    expect(deps.exit).not.toHaveBeenCalled();

    settle();
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(calls).toEqual(["windows", "dispose", "disposed", "exit(0)"]);
  });

  it("a hung dispose is bounded — exit(0) lands at the bound, not never", async () => {
    const { flow, deps } = make({ boundMs: 80, dispose: () => new Promise<void>(() => {}) });
    flow.willQuit(() => {});
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0), { timeout: 2000 });
  });

  it("re-entry keeps deferring but tears down and exits exactly once", async () => {
    const { flow, deps, settle } = make();
    const pd1 = vi.fn();
    const pd2 = vi.fn();
    flow.willQuit(pd1);
    flow.willQuit(pd2); // e.g. a second Cmd+Q while teardown runs
    expect(pd1).toHaveBeenCalledTimes(1);
    expect(pd2).toHaveBeenCalledTimes(1); // still deferred — our exit() decides
    settle();
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledTimes(1));
    expect(deps.dispose).toHaveBeenCalledTimes(1);
  });

  it("fatal reports the error, runs the SAME teardown, and exits 1", async () => {
    const { flow, deps, calls, settle } = make();
    const boom = new Error("boot exploded");
    flow.fatal(boom);
    expect(deps.onFatal).toHaveBeenCalledWith(boom);
    expect(deps.exit).not.toHaveBeenCalled(); // teardown first, even on fatal
    settle();
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(1));
    expect(calls).toEqual(["windows", "dispose", "disposed", "exit(1)"]);
  });

  it("a rejecting dispose still exits (the teardown error is reported, not fatal)", async () => {
    const { flow, deps } = make({ dispose: () => Promise.reject(new Error("dispose failed")) });
    flow.willQuit(() => {});
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(deps.onTeardownError).toHaveBeenCalledTimes(1);
  });
});
