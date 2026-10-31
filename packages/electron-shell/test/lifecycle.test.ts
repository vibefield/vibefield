import type { Logger } from "@vibefield/logging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const app = {
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const current = listeners.get(event) ?? [];
      current.push(listener);
      listeners.set(event, current);
    }),
    quit: vi.fn(),
    exit: vi.fn(),
    // AU-7 — a move that did not happen opens VibeField again where it was
    relaunch: vi.fn(),
  };
  return {
    app,
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    reset() {
      listeners.clear();
      app.on.mockClear();
      app.quit.mockClear();
      app.exit.mockClear();
      app.relaunch.mockClear();
    },
  };
});

vi.mock("electron", () => ({ app: electron.app }));

/** Every rig shares the one `app.quit`, and the lifecycle queues its quits (`setImmediate`): a test that ends with one
 * still queued would fire it into the next rig, past that rig's own reset. Drain the queue before any reset. */
async function drain(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

import { installLifecycle } from "../src/main/lifecycle";
import type { UpdateQuitPlan } from "../src/main/quit-flow";
import type { QuitGate } from "../src/main/quit-gate";
import { WindowRegistry } from "../src/main/window-policy";

function logger(): Logger {
  const value = {
    child: () => value,
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
  return value as unknown as Logger;
}

function install(keepAlive: () => boolean, registry: WindowRegistry = new WindowRegistry()) {
  const openPrimaryWindow = vi.fn(async () => {});
  const onQuitRequested = vi.fn();
  const disposeShell = vi.fn();
  installLifecycle({
    registry,
    getSupervisor: () => null,
    openPrimaryWindow,
    keepAliveWithoutWindows: keepAlive,
    onQuitRequested,
    disposeShell,
    logger: logger(),
    closeLogging: async () => {},
  });
  return { openPrimaryWindow, onQuitRequested, disposeShell };
}

describe("Electron lifecycle routing", () => {
  beforeEach(() => electron.reset());

  it("routes second-instance and Dock activation through the same reveal operation", async () => {
    const h = install(() => true);
    electron.emit("second-instance");
    electron.emit("activate");
    await Promise.resolve();
    expect(h.openPrimaryWindow).toHaveBeenCalledTimes(2);
  });

  it("stays resident only when a platform escape path is usable", () => {
    install(() => true);
    electron.emit("window-all-closed");
    expect(electron.app.quit).not.toHaveBeenCalled();

    electron.reset();
    install(() => false);
    electron.emit("window-all-closed");
    expect(electron.app.quit).toHaveBeenCalledTimes(1);
  });

  it("marks the tray quitting synchronously at the native before-quit boundary", () => {
    const h = install(() => true);
    const event = { preventDefault: vi.fn() };
    electron.emit("before-quit", event);
    expect(h.onQuitRequested).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("defers native quit until the durable primary close has completed", () => {
    let primaryOpen = true;
    const close = vi.fn();
    const registry = {
      primary: () => (primaryOpen ? { close } : null),
      disposeAll: vi.fn(),
    } as unknown as WindowRegistry;
    const h = install(() => true, registry);
    const event = { preventDefault: vi.fn() };

    electron.emit("before-quit", event);
    expect(h.onQuitRequested).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(electron.app.quit).not.toHaveBeenCalled();

    primaryOpen = false;
    electron.emit("window-all-closed");
    expect(electron.app.quit).toHaveBeenCalledTimes(1);
  });

  // WP12c (L2b-ii, build-wp12-updater.md §10 S4; the PM's ruling 13:36Z) — an update quit that ABORTS after
  // before-quit's durable close (the daemon's re-check refused: nothing stopped) keeps the app; the reset undoes the
  // durable-close replay flags so the reopened window is durable-closed again by the next ordinary quit.
  function updateRig(resetOnAbort: boolean) {
    let primaryOpen = true;
    const close = vi.fn(() => {
      primaryOpen = false;
    });
    const registry = {
      primary: () => (primaryOpen ? { close } : null),
      disposeAll: vi.fn(),
    } as unknown as WindowRegistry;
    const flow = installLifecycle({
      registry,
      getSupervisor: () => null,
      openPrimaryWindow: vi.fn(async () => {}),
      keepAliveWithoutWindows: () => true,
      onQuitRequested: vi.fn(),
      disposeShell: vi.fn(),
      logger: logger(),
      closeLogging: async () => {},
    });
    const plan: UpdateQuitPlan = {
      prepare: async () => ({ kind: "abort", reason: "the live sessions differ" }),
      install: vi.fn(),
      aborted: vi.fn(() => {
        if (resetOnAbort) flow.resetAfterAbortedQuit();
        primaryOpen = true; // the window reopens
      }),
      installStalled: vi.fn(async () => {}),
    };
    return { flow, plan, close };
  }

  async function abortedUpdateQuit(rig: ReturnType<typeof updateRig>): Promise<void> {
    expect(rig.flow.armUpdate(rig.plan)).toBe(true);
    electron.emit("before-quit", { preventDefault: vi.fn() }); // the durable close of the primary
    electron.emit("window-all-closed"); // the replayed quit
    electron.emit("before-quit", { preventDefault: vi.fn() });
    electron.emit("will-quit", { preventDefault: vi.fn() });
    await vi.waitFor(() => expect(rig.plan.aborted).toHaveBeenCalledTimes(1));
    expect(electron.app.exit).not.toHaveBeenCalled(); // the abort keeps the app
  }

  it("an aborted update quit keeps the app; the window reopens and an ORDINARY quit still durable-closes and exits", async () => {
    const rig = updateRig(true);
    await abortedUpdateQuit(rig);
    expect(rig.close).toHaveBeenCalledTimes(1);

    const ordinary = { preventDefault: vi.fn() };
    electron.emit("before-quit", ordinary);
    expect(ordinary.preventDefault).toHaveBeenCalledTimes(1); // deferred for the durable close again
    expect(rig.close).toHaveBeenCalledTimes(2);
    electron.emit("window-all-closed");
    electron.emit("before-quit", { preventDefault: vi.fn() });
    electron.emit("will-quit", { preventDefault: vi.fn() });
    await vi.waitFor(() => expect(electron.app.exit).toHaveBeenCalledWith(0));
    expect(rig.plan.install).not.toHaveBeenCalled();
  });

  it("the control: WITHOUT the reset, the next quit would skip the reopened window's durable close", async () => {
    const rig = updateRig(false);
    await abortedUpdateQuit(rig);
    const ordinary = { preventDefault: vi.fn() };
    electron.emit("before-quit", ordinary);
    expect(ordinary.preventDefault).not.toHaveBeenCalled(); // the stale replay flag let it straight through
    expect(rig.close).toHaveBeenCalledTimes(1);
  });
});

// AL-3 (ESR §7.3 as amended 2026-10-27) — a PERSON's quit passes the gate before anything closes: Cancel changes
// nothing; a proceed durable-closes, stops the pairs, and only then quits natively — every re-issue from a macrotask
// (electron #55208); an aborted stop gives the app back; the update's and the runner's own quits skip the gate.
describe("the quit gate in the lifecycle (AL-3)", () => {
  beforeEach(() => electron.reset());
  afterEach(async () => {
    await drain();
    electron.app.quit.mockReset();
  });

  function gateRig(options: {
    decide?: "proceed" | "cancel";
    stop?: "done" | "aborted";
    /** AU-7 — a `done` stop that left a pair running (`complete: false`) */
    complete?: boolean;
    /** AU-7 — the decision waits for this (a box still up) */
    hold?: Promise<void>;
    windowOpen?: boolean;
    /** AU-5 — the sessions a `done` stop ended */
    ended?: number;
    /** AU-5 — install on quit; the rig records `install` in the order as it is called */
    installOnQuit?: (context: { readonly ended: number }) => Promise<void>;
  }) {
    let primaryOpen = options.windowOpen ?? true;
    const close = vi.fn(() => {
      primaryOpen = false;
    });
    const registry = {
      primary: () => (primaryOpen ? { close } : null),
      disposeAll: vi.fn(),
    } as unknown as WindowRegistry;
    const order: string[] = [];
    const gate: QuitGate = {
      decide: vi.fn(async ({ unattended }) => {
        order.push(unattended ? "decide:unattended" : "decide");
        await options.hold;
        return options.decide ?? "proceed";
      }),
      stop: vi.fn(async () => {
        order.push("stop");
        return options.stop === "aborted"
          ? { kind: "aborted" as const }
          : {
              kind: "done" as const,
              complete: options.complete ?? true,
              ended: options.ended ?? 0,
            };
      }),
    };
    const install = options.installOnQuit;
    const onQuitRequested = vi.fn(() => order.push("quit-requested"));
    const onQuitAborted = vi.fn(() => {
      primaryOpen = true;
    });
    const flow = installLifecycle({
      registry,
      getSupervisor: () => null,
      openPrimaryWindow: vi.fn(async () => {}),
      keepAliveWithoutWindows: () => true,
      onQuitRequested,
      disposeShell: vi.fn(),
      logger: logger(),
      closeLogging: async () => {},
      getQuitGate: () => gate,
      onQuitAborted,
      ...(install !== undefined
        ? {
            installOnQuit: async (context: { readonly ended: number }) => {
              order.push("install");
              await install(context);
            },
          }
        : {}),
    });
    electron.app.quit.mockImplementation(() => {
      order.push("app.quit");
      electron.emit("before-quit", { preventDefault: vi.fn() });
    });
    return { flow, gate, close, order, onQuitRequested, onQuitAborted, open: () => primaryOpen };
  }

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it("Cancel changes nothing: the quit is deferred, nothing closes, the tray never says quitting", async () => {
    const rig = gateRig({ decide: "cancel" });
    const event = { preventDefault: vi.fn() };
    electron.emit("before-quit", event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    await settle();
    await settle();
    expect(rig.close).not.toHaveBeenCalled();
    expect(rig.onQuitRequested).not.toHaveBeenCalled();
    expect(electron.app.quit).not.toHaveBeenCalled();
    expect(rig.gate.stop).not.toHaveBeenCalled();
  });

  it("a second ⌘Q while the box is up is absorbed: one decision, never two", async () => {
    const rig = gateRig({ decide: "cancel" });
    electron.emit("before-quit", { preventDefault: vi.fn() });
    const again = { preventDefault: vi.fn() };
    electron.emit("before-quit", again);
    expect(again.preventDefault).toHaveBeenCalledTimes(1);
    await settle();
    expect(rig.gate.decide).toHaveBeenCalledTimes(1);
  });

  it("proceed: decide → durable close → stop → the native quit → exit, in that order", async () => {
    const rig = gateRig({});
    electron.emit("before-quit", { preventDefault: vi.fn() });
    await vi.waitFor(() => expect(rig.close).toHaveBeenCalledTimes(1));
    electron.emit("window-all-closed"); // the durable close finished
    await vi.waitFor(() => expect(rig.gate.stop).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(rig.order.filter((s) => s === "app.quit")).toHaveLength(2));
    electron.emit("will-quit", { preventDefault: vi.fn() });
    await vi.waitFor(() => expect(electron.app.exit).toHaveBeenCalledWith(0));
    expect(rig.order.slice(0, 4)).toEqual(["decide", "app.quit", "quit-requested", "stop"]);
  });

  it("with no window open the stop runs at once, still before the native quit", async () => {
    const rig = gateRig({ windowOpen: false });
    electron.emit("before-quit", { preventDefault: vi.fn() });
    await vi.waitFor(() => expect(rig.gate.stop).toHaveBeenCalledTimes(1));
    expect(rig.close).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(rig.order.filter((s) => s === "app.quit")).toHaveLength(2));
  });

  it("an ABORTED stop gives the app back, and the next quit asks again from the start", async () => {
    const rig = gateRig({ stop: "aborted" });
    electron.emit("before-quit", { preventDefault: vi.fn() });
    await vi.waitFor(() => expect(rig.close).toHaveBeenCalledTimes(1));
    electron.emit("window-all-closed");
    await vi.waitFor(() => expect(rig.onQuitAborted).toHaveBeenCalledTimes(1));
    expect(rig.open()).toBe(true);
    await settle();
    expect(electron.app.quit).toHaveBeenCalledTimes(1); // the decision's re-issue only: nothing replays a quit
    electron.emit("before-quit", { preventDefault: vi.fn() });
    expect(rig.gate.decide).toHaveBeenCalledTimes(2);
  });

  it("the OS ending the session makes the gate decide unattended", async () => {
    const rig = gateRig({});
    rig.flow.noteOsSessionEnding();
    electron.emit("before-quit", { preventDefault: vi.fn() });
    await settle();
    expect(rig.order[0]).toBe("decide:unattended");
  });

  it("a signal's quit (dev's runner; since AU-5a any build's) skips the gate: the pairs are left", async () => {
    const rig = gateRig({});
    rig.flow.leavePairsOnQuit("signal");
    const event = { preventDefault: vi.fn() };
    electron.emit("before-quit", event);
    expect(rig.gate.decide).not.toHaveBeenCalled();
    expect(rig.onQuitRequested).toHaveBeenCalledTimes(1);
    expect(rig.close).toHaveBeenCalledTimes(1); // the durable close, as ever
    electron.emit("window-all-closed");
    expect(rig.gate.stop).not.toHaveBeenCalled();
  });

  // AU-5a (B3's quit-seam review) — a signal that lands while the person's quit is still open to it is not the
  // person's quit: before the fix, the box swallowed it, Cancel left `restarting` set for good (the handler's latch
  // ignored every later signal, and the person's next ⌘Q skipped the gate), and "Quit and end sessions" stopped the pairs
  it("AU-5a — a signal while the box is up quits whatever the box answers, and stops nothing", async () => {
    for (const decide of ["cancel", "proceed"] as const) {
      await drain();
      electron.reset();
      let release: () => void = () => undefined;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const rig = gateRig({ decide, hold });
      electron.emit("before-quit", { preventDefault: vi.fn() });
      await vi.waitFor(() => expect(rig.gate.decide).toHaveBeenCalledTimes(1));
      rig.flow.leavePairsOnQuit("signal");
      const signalled = { preventDefault: vi.fn() };
      electron.emit("before-quit", signalled); // the signal's own app.quit(), held by the box
      expect(signalled.preventDefault).toHaveBeenCalledTimes(1);
      release();
      // the signal's quit again, past the gate: the durable close, as ever
      await vi.waitFor(() => expect(rig.close).toHaveBeenCalledTimes(1));
      electron.emit("window-all-closed");
      await vi.waitFor(() => expect(rig.order.filter((s) => s === "app.quit")).toHaveLength(2));
      expect(rig.gate.decide).toHaveBeenCalledTimes(1);
      expect(rig.gate.stop).not.toHaveBeenCalled();
      expect(rig.flow.leaveReason).toBe("restart");
    }
  });

  it("AU-5a — a signal after the gate decided, before its stop began: the stop never runs", async () => {
    const rig = gateRig({});
    electron.emit("before-quit", { preventDefault: vi.fn() });
    await vi.waitFor(() => expect(rig.close).toHaveBeenCalledTimes(1)); // decided; the durable close runs
    rig.flow.leavePairsOnQuit("signal");
    electron.emit("window-all-closed");
    await vi.waitFor(() => expect(rig.order.filter((s) => s === "app.quit")).toHaveLength(2));
    expect(rig.gate.stop).not.toHaveBeenCalled();
  });

  it("AU-5a — a signal while the stop's re-ask box is up: Cancel stops nothing, and VibeField still quits", async () => {
    const rig = gateRig({ stop: "aborted" });
    electron.emit("before-quit", { preventDefault: vi.fn() });
    await vi.waitFor(() => expect(rig.close).toHaveBeenCalledTimes(1));
    electron.emit("window-all-closed"); // the stop begins: a session born during the quit asks again
    rig.flow.leavePairsOnQuit("signal"); // before that box answers
    await vi.waitFor(() => expect(rig.order.filter((s) => s === "app.quit")).toHaveLength(2));
    await settle();
    expect(rig.gate.stop).toHaveBeenCalledTimes(1);
    expect(rig.onQuitAborted).not.toHaveBeenCalled(); // no window comes back
    expect(rig.open()).toBe(false);
  });

  // AL-7 — why the shell leaves the pairs it holds running, said by each supervisor's dispose
  it("the leave reason: a signal's quit is a restart, a decided gate a quit, an armed update an update, else nothing", async () => {
    const idle = gateRig({});
    expect(idle.flow.leaveReason).toBeUndefined();
    idle.flow.leavePairsOnQuit("signal");
    expect(idle.flow.leaveReason).toBe("restart");

    await drain();
    electron.reset();
    const quitting = gateRig({});
    electron.emit("before-quit", { preventDefault: vi.fn() });
    await vi.waitFor(() => expect(quitting.close).toHaveBeenCalledTimes(1));
    expect(quitting.flow.leaveReason).toBe("quit");

    await drain();
    electron.reset();
    const updating = gateRig({});
    updating.flow.armUpdate({
      prepare: async () => ({ kind: "install" }),
      install: vi.fn(),
      aborted: vi.fn(),
      installStalled: vi.fn(async () => {}),
    });
    expect(updating.flow.leaveReason).toBe("update");
  });

  it("an update's quit skips the gate: its own consent already ran", () => {
    const rig = gateRig({});
    const plan: UpdateQuitPlan = {
      prepare: async () => ({ kind: "install" }),
      install: vi.fn(),
      aborted: vi.fn(),
      installStalled: vi.fn(async () => {}),
    };
    expect(rig.flow.armUpdate(plan)).toBe(true);
    electron.emit("before-quit", { preventDefault: vi.fn() });
    expect(rig.gate.decide).not.toHaveBeenCalled();
    expect(rig.close).toHaveBeenCalledTimes(1);
  });

  // AU-7 (AU-G8; LC-25, LC-37; main-process.md §8.4) — Move to Applications is a person's quit through the gate with
  // the move in place of the plain native quit, and only after a COMPLETE stop; anything less opens VibeField again
  // where it was. The mover's own relaunch (Electron opens the moved copy once this process exits) is Electron's.
  describe("quitThen — the move to Applications (AU-7)", () => {
    const deferred = () => {
      let release: () => void = () => undefined;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { promise, release };
    };

    it("Cancel answers cancel: nothing closes, nothing moves, and the next move may ask again", async () => {
      const rig = gateRig({ decide: "cancel" });
      const after = vi.fn(async () => true);
      expect(await rig.flow.quitThen(after)).toBe("cancel");
      await settle();
      expect(rig.close).not.toHaveBeenCalled();
      expect(rig.gate.stop).not.toHaveBeenCalled();
      expect(after).not.toHaveBeenCalled();
      expect(rig.flow.movePending).toBe(false);
      expect(rig.gate.decide).toHaveBeenCalledTimes(1);
      void rig.flow.quitThen(after);
      await vi.waitFor(() => expect(rig.gate.decide).toHaveBeenCalledTimes(2));
    });

    it("proceed: decide → durable close → stop → the move → the native quit, in that order", async () => {
      const rig = gateRig({});
      const after = vi.fn(async () => {
        rig.order.push("move");
        return true;
      });
      expect(await rig.flow.quitThen(after)).toBe("proceed");
      await vi.waitFor(() => expect(rig.close).toHaveBeenCalledTimes(1));
      expect(rig.flow.movePending).toBe(true);
      electron.emit("window-all-closed"); // the durable close finished
      await vi.waitFor(() => expect(after).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(rig.order.filter((s) => s === "app.quit")).toHaveLength(3));
      expect(rig.order.slice(0, 7)).toEqual([
        "app.quit",
        "decide",
        "app.quit",
        "quit-requested",
        "stop",
        "move",
        "app.quit",
      ]);
      expect(electron.app.relaunch).not.toHaveBeenCalled(); // the mover opens the moved copy itself
      electron.emit("will-quit", { preventDefault: vi.fn() });
      await vi.waitFor(() => expect(electron.app.exit).toHaveBeenCalledWith(0));
    });

    it("a move that fails or throws opens VibeField again where it was, then quits", async () => {
      const refuses = vi.fn(async () => false);
      const throws = vi.fn(async (): Promise<boolean> => {
        throw new Error("the copy failed");
      });
      for (const after of [refuses, throws]) {
        await drain();
        electron.reset();
        const rig = gateRig({});
        expect(await rig.flow.quitThen(after)).toBe("proceed");
        await vi.waitFor(() => expect(rig.close).toHaveBeenCalledTimes(1));
        electron.emit("window-all-closed");
        await vi.waitFor(() => expect(electron.app.relaunch).toHaveBeenCalledTimes(1));
        expect(after).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(rig.order.filter((s) => s === "app.quit")).toHaveLength(3));
        electron.app.quit.mockReset();
      }
    });

    it("an INCOMPLETE stop moves nothing: a pair left running would run from the Trash (LC-25)", async () => {
      const rig = gateRig({ complete: false });
      const after = vi.fn(async () => true);
      expect(await rig.flow.quitThen(after)).toBe("proceed");
      await vi.waitFor(() => expect(rig.close).toHaveBeenCalledTimes(1));
      electron.emit("window-all-closed");
      await vi.waitFor(() => expect(electron.app.relaunch).toHaveBeenCalledTimes(1));
      expect(after).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(rig.order.filter((s) => s === "app.quit")).toHaveLength(3));
    });

    it("an ABORTED stop gives the app back and drops the move", async () => {
      const rig = gateRig({ stop: "aborted" });
      const after = vi.fn(async () => true);
      expect(await rig.flow.quitThen(after)).toBe("proceed");
      await vi.waitFor(() => expect(rig.close).toHaveBeenCalledTimes(1));
      electron.emit("window-all-closed");
      await vi.waitFor(() => expect(rig.onQuitAborted).toHaveBeenCalledTimes(1));
      expect(after).not.toHaveBeenCalled();
      expect(electron.app.relaunch).not.toHaveBeenCalled();
      expect(rig.flow.movePending).toBe(false);
    });

    it("busy while a quit decides, while an update's quit is armed, and while a move waits — and a move refuses an update's quit", async () => {
      const box = deferred();
      const deciding = gateRig({ hold: box.promise });
      electron.emit("before-quit", { preventDefault: vi.fn() });
      expect(await deciding.flow.quitThen(vi.fn(async () => true))).toBe("busy");

      await drain();
      electron.reset();
      const updating = gateRig({});
      const plan: UpdateQuitPlan = {
        prepare: async () => ({ kind: "install" }),
        install: vi.fn(),
        aborted: vi.fn(),
        installStalled: vi.fn(async () => {}),
      };
      expect(updating.flow.armUpdate(plan)).toBe(true);
      expect(await updating.flow.quitThen(vi.fn(async () => true))).toBe("busy");

      await drain();
      electron.reset();
      const held = deferred();
      const moving = gateRig({ hold: held.promise });
      const first = moving.flow.quitThen(vi.fn(async () => true));
      await vi.waitFor(() => expect(moving.gate.decide).toHaveBeenCalledTimes(1));
      expect(await moving.flow.quitThen(vi.fn(async () => true))).toBe("busy");
      expect(moving.flow.armUpdate(plan)).toBe(false);
      held.release();
      expect(await first).toBe("proceed");
    });

    it("a signal during the move's quit moves nothing and relaunches nothing; the OS ending the session refuses it", async () => {
      const box = deferred();
      const rig = gateRig({ hold: box.promise });
      const after = vi.fn(async () => true);
      const answer = rig.flow.quitThen(after);
      await vi.waitFor(() => expect(rig.gate.decide).toHaveBeenCalledTimes(1));
      rig.flow.leavePairsOnQuit("signal");
      box.release();
      expect(await answer).toBe("proceed");
      await vi.waitFor(() => expect(rig.close).toHaveBeenCalledTimes(1));
      electron.emit("window-all-closed");
      await vi.waitFor(() => expect(rig.order.filter((s) => s === "app.quit")).toHaveLength(3));
      expect(after).not.toHaveBeenCalled();
      expect(electron.app.relaunch).not.toHaveBeenCalled();

      await drain();
      electron.reset();
      const ending = gateRig({});
      ending.flow.noteOsSessionEnding();
      expect(await ending.flow.quitThen(vi.fn(async () => true))).toBe("busy");
      expect(ending.gate.decide).not.toHaveBeenCalled();
    });

    it("with no gate to ask (a mode without one) the quit goes on and opens VibeField again where it was", async () => {
      let primaryOpen = true;
      const close = vi.fn(() => {
        primaryOpen = false;
      });
      const flow = installLifecycle({
        registry: {
          primary: () => (primaryOpen ? { close } : null),
          disposeAll: vi.fn(),
        } as unknown as WindowRegistry,
        getSupervisor: () => null,
        openPrimaryWindow: vi.fn(async () => {}),
        keepAliveWithoutWindows: () => true,
        onQuitRequested: vi.fn(),
        disposeShell: vi.fn(),
        logger: logger(),
        closeLogging: async () => {},
      });
      electron.app.quit.mockImplementation(() =>
        electron.emit("before-quit", { preventDefault: vi.fn() }),
      );
      const after = vi.fn(async () => true);
      expect(await flow.quitThen(after)).toBe("proceed");
      expect(close).toHaveBeenCalledTimes(1);
      electron.emit("window-all-closed");
      await vi.waitFor(() => expect(electron.app.relaunch).toHaveBeenCalledTimes(1));
      expect(after).not.toHaveBeenCalled();
    });
  });

  // AU-5 (AU-D9 A; main-process.md §7.1, §7.3) — install on quit is ONE step between a person's complete stop and the
  // native quit. Never for a quit that is not the person's (a signal, an update's own, the OS ending the session),
  // never after an incomplete stop, never in place of a waiting move; a hook that throws still quits.
  describe("install on quit (AU-5)", () => {
    const deferred = () => {
      let release: () => void = () => undefined;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { promise, release };
    };
    const quits = (order: readonly string[]) => order.filter((s) => s === "app.quit").length;

    /** a person's ⌘Q with the primary window open, through the durable close */
    async function personQuits(rig: ReturnType<typeof gateRig>): Promise<void> {
      electron.emit("before-quit", { preventDefault: vi.fn() });
      await vi.waitFor(() => expect(rig.close).toHaveBeenCalledTimes(1));
      electron.emit("window-all-closed"); // the durable close finished
    }

    it("proceed: decide → durable close → stop → the install → the native quit → exit, in that order", async () => {
      const installOnQuit = vi.fn(async () => {});
      const rig = gateRig({ ended: 2, installOnQuit });
      await personQuits(rig);
      await vi.waitFor(() => expect(quits(rig.order)).toBe(2));
      expect(rig.order.slice(0, 6)).toEqual([
        "decide",
        "app.quit",
        "quit-requested",
        "stop",
        "install",
        "app.quit",
      ]);
      // the sessions the stop ended with consent ride along (the record's `consented`)
      expect(installOnQuit).toHaveBeenCalledWith({ ended: 2 });
      electron.emit("will-quit", { preventDefault: vi.fn() });
      await vi.waitFor(() => expect(electron.app.exit).toHaveBeenCalledWith(0));
      expect(electron.app.relaunch).not.toHaveBeenCalled();
    });

    it("an INCOMPLETE stop installs nothing: a pair left running keeps the old bytes in use", async () => {
      const installOnQuit = vi.fn(async () => {});
      const rig = gateRig({ complete: false, installOnQuit });
      await personQuits(rig);
      await vi.waitFor(() => expect(quits(rig.order)).toBe(2));
      expect(rig.gate.stop).toHaveBeenCalledTimes(1);
      expect(installOnQuit).not.toHaveBeenCalled();
    });

    it("the OS ending the session installs nothing (AL-D6): the gate decides unattended, the stop runs, no install", async () => {
      const installOnQuit = vi.fn(async () => {});
      const rig = gateRig({ installOnQuit });
      rig.flow.noteOsSessionEnding();
      await personQuits(rig);
      await vi.waitFor(() => expect(quits(rig.order)).toBe(2));
      expect(rig.order[0]).toBe("decide:unattended");
      expect(rig.gate.stop).toHaveBeenCalledTimes(1);
      expect(installOnQuit).not.toHaveBeenCalled();
    });

    it("a signal installs nothing: before a person's quit (no gate, no stop) and while its box is up", async () => {
      const installOnQuit = vi.fn(async () => {});
      const first = gateRig({ installOnQuit });
      first.flow.leavePairsOnQuit("signal");
      await personQuits(first);
      await settle();
      expect(first.gate.stop).not.toHaveBeenCalled();
      expect(installOnQuit).not.toHaveBeenCalled();

      await drain();
      electron.reset();
      const box = deferred();
      const during = gateRig({ hold: box.promise, installOnQuit });
      electron.emit("before-quit", { preventDefault: vi.fn() });
      await vi.waitFor(() => expect(during.gate.decide).toHaveBeenCalledTimes(1));
      during.flow.leavePairsOnQuit("signal");
      box.release();
      await vi.waitFor(() => expect(during.close).toHaveBeenCalledTimes(1));
      electron.emit("window-all-closed");
      await vi.waitFor(() => expect(quits(during.order)).toBe(2));
      expect(installOnQuit).not.toHaveBeenCalled();
    });

    it("an update's own quit never calls it: its consent ran, and its plan installs", async () => {
      const installOnQuit = vi.fn(async () => {});
      const rig = gateRig({ installOnQuit });
      const plan: UpdateQuitPlan = {
        prepare: async () => ({ kind: "install" }),
        install: vi.fn(),
        aborted: vi.fn(),
        installStalled: vi.fn(async () => {}),
      };
      expect(rig.flow.armUpdate(plan)).toBe(true);
      await personQuits(rig);
      await settle();
      expect(rig.gate.decide).not.toHaveBeenCalled();
      expect(rig.gate.stop).not.toHaveBeenCalled();
      expect(installOnQuit).not.toHaveBeenCalled();
    });

    it("a waiting move runs in place of the install (LC-25): the move, then the native quit", async () => {
      const installOnQuit = vi.fn(async () => {});
      const rig = gateRig({ installOnQuit });
      const after = vi.fn(async () => true);
      expect(await rig.flow.quitThen(after)).toBe("proceed");
      await vi.waitFor(() => expect(rig.close).toHaveBeenCalledTimes(1));
      electron.emit("window-all-closed");
      await vi.waitFor(() => expect(after).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(quits(rig.order)).toBe(3));
      expect(installOnQuit).not.toHaveBeenCalled();
    });

    it("an install that throws is logged and VibeField still quits", async () => {
      const installOnQuit = vi.fn(async (): Promise<void> => {
        throw new Error("Squirrel went away");
      });
      const rig = gateRig({ installOnQuit });
      await personQuits(rig);
      await vi.waitFor(() => expect(quits(rig.order)).toBe(2));
      expect(installOnQuit).toHaveBeenCalledTimes(1);
      electron.emit("will-quit", { preventDefault: vi.fn() });
      await vi.waitFor(() => expect(electron.app.exit).toHaveBeenCalledWith(0));
    });

    it("a second ⌘Q while Squirrel stages is absorbed: one stop, one install, and the native quit waits for it", async () => {
      const staging = deferred();
      const installOnQuit = vi.fn(() => staging.promise);
      const rig = gateRig({ installOnQuit });
      await personQuits(rig);
      await vi.waitFor(() => expect(installOnQuit).toHaveBeenCalledTimes(1));
      electron.emit("before-quit", { preventDefault: vi.fn() });
      await settle();
      expect(rig.gate.stop).toHaveBeenCalledTimes(1);
      expect(quits(rig.order)).toBe(1);
      staging.release();
      await vi.waitFor(() => expect(quits(rig.order)).toBe(2));
      expect(installOnQuit).toHaveBeenCalledTimes(1);
      expect(rig.gate.stop).toHaveBeenCalledTimes(1);
    });
  });
});
