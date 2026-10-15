import { describe, expect, it, vi } from "vitest";
import { createQuitFlow, type UpdatePrepared, type UpdateQuitPlan } from "../src/main/quit-flow";

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

// WP12c (L2b-ii, build-wp12-updater.md §10 S3/S4; the PM's rulings 13:31–13:40Z) — the UPDATE MODE. Electron's own
// quit arrives AFTER quitAndInstall (Squirrel's relaunchToInstallUpdate terminates the app), so only that quit exits.
// Before the daemon stop an abort keeps the app; after it, every branch exits (relaunching only when nothing can have
// been armed).
function updateMake(
  prepared: UpdatePrepared | (() => Promise<UpdatePrepared>),
  over?: { installQuitBoundMs?: number },
) {
  const calls: string[] = [];
  const deps = {
    closeWindows: vi.fn(() => calls.push("windows")),
    dispose: vi.fn(async () => {
      calls.push("dispose");
    }),
    exit: vi.fn((code: number) => calls.push(`exit(${code})`)),
    onFatal: vi.fn(),
    onTeardownError: vi.fn(),
    relaunch: vi.fn(() => calls.push("relaunch")),
    boundMs: 500,
    installQuitBoundMs: over?.installQuitBoundMs ?? 500,
  };
  const plan: UpdateQuitPlan = {
    prepare: vi.fn(async () => {
      calls.push("prepare");
      return typeof prepared === "function" ? prepared() : prepared;
    }),
    install: vi.fn(() => calls.push("install")),
    aborted: vi.fn((reason: string) => calls.push(`aborted(${reason})`)),
    installStalled: vi.fn(async (reason: string) => {
      calls.push(`stalled(${reason})`);
    }),
  };
  const flow = createQuitFlow(deps);
  return { flow, deps, plan, calls };
}

describe("createQuitFlow — WP12c's update mode", () => {
  it("prepares after the windows close, hands the install off, and exits only on Electron's OWN quit after it", async () => {
    const { flow, deps, plan, calls } = updateMake({ kind: "install" });
    expect(flow.armUpdate(plan)).toBe(true);
    flow.willQuit(() => {});
    await vi.waitFor(() => expect(plan.install).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(["windows", "prepare", "install"]);
    expect(deps.exit).not.toHaveBeenCalled(); // the install's quit has not arrived yet
    flow.willQuit(() => {}); // Electron's own quit, after quitAndInstall
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(deps.relaunch).not.toHaveBeenCalled();
  });

  it("an abort BEFORE the daemon stop keeps the app: no teardown, no exit, the plan restores", async () => {
    const { flow, deps, plan, calls } = updateMake({ kind: "abort", reason: "sessions changed" });
    flow.armUpdate(plan);
    flow.willQuit(() => {});
    await vi.waitFor(() => expect(plan.aborted).toHaveBeenCalledWith("sessions changed"));
    expect(calls).toEqual(["windows", "prepare", "aborted(sessions changed)"]);
    expect(deps.dispose).not.toHaveBeenCalled();
    expect(deps.exit).not.toHaveBeenCalled();
    // and the flow is ordinary again: the next quit exits as any quit does
    flow.willQuit(() => {});
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
  });

  it("a Squirrel refusal after the stop relaunches, then exits (nothing can be armed)", async () => {
    const { flow, deps, plan, calls } = updateMake({
      kind: "exit",
      relaunch: true,
      reason: "squirrel-refused",
    });
    flow.armUpdate(plan);
    flow.willQuit(() => {});
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(calls).toEqual(["windows", "prepare", "relaunch", "windows", "dispose", "exit(0)"]);
    expect(plan.install).not.toHaveBeenCalled();
  });

  it("a Squirrel timeout after the stop exits WITHOUT relaunch (Squirrel may still arm)", async () => {
    const { flow, deps, plan } = updateMake({
      kind: "exit",
      relaunch: false,
      reason: "squirrel-timeout",
    });
    flow.armUpdate(plan);
    flow.willQuit(() => {});
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(deps.relaunch).not.toHaveBeenCalled();
  });

  it("an install that never quits the app is said, then exits without relaunch at the bound", async () => {
    const { flow, deps, plan, calls } = updateMake({ kind: "install" }, { installQuitBoundMs: 60 });
    flow.armUpdate(plan);
    flow.willQuit(() => {});
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0), { timeout: 2000 });
    expect(calls).toContain("stalled(the install did not quit the app in time)");
    expect(deps.relaunch).not.toHaveBeenCalled();
  });

  it("an install the updater reports failed is said, then exits without relaunch", async () => {
    const { flow, deps, plan, calls } = updateMake(
      { kind: "install" },
      { installQuitBoundMs: 10_000 },
    );
    flow.armUpdate(plan);
    flow.willQuit(() => {});
    await vi.waitFor(() => expect(plan.install).toHaveBeenCalled());
    flow.updateInstallFailed("ShipIt could not start");
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(calls).toContain("stalled(ShipIt could not start)");
    expect(deps.relaunch).not.toHaveBeenCalled();
  });

  it("a prepare that THROWS is read as past the stop: exit, never relaunch", async () => {
    const { flow, deps, plan } = updateMake(() => Promise.reject(new Error("transport lost")));
    flow.armUpdate(plan);
    flow.willQuit(() => {});
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(deps.relaunch).not.toHaveBeenCalled();
    expect(plan.aborted).not.toHaveBeenCalled();
  });

  it("re-entry while preparing keeps deferring and runs ONE prepare; a second arm is refused", async () => {
    let release: (value: UpdatePrepared) => void = () => {};
    const { flow, deps, plan } = updateMake(
      () => new Promise<UpdatePrepared>((resolve) => (release = resolve)),
    );
    expect(flow.armUpdate(plan)).toBe(true);
    expect(flow.armUpdate(plan)).toBe(false);
    const pd = vi.fn();
    flow.willQuit(pd);
    flow.willQuit(pd);
    flow.willQuit(pd);
    expect(pd).toHaveBeenCalledTimes(3); // every native quit deferred
    await vi.waitFor(() => expect(plan.prepare).toHaveBeenCalledTimes(1));
    release({ kind: "install" });
    await vi.waitFor(() => expect(plan.install).toHaveBeenCalledTimes(1));
    expect(deps.exit).not.toHaveBeenCalled();
  });

  it("an ordinary quit is not an update: nothing armed, it exits as before", async () => {
    const { flow, deps, plan } = updateMake({ kind: "install" });
    flow.willQuit(() => {});
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(plan.prepare).not.toHaveBeenCalled();
    expect(flow.armUpdate(plan)).toBe(false); // a quit is already underway
  });
});
