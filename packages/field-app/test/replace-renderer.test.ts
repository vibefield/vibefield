// @vitest-environment node
/**
 * DK-9 — THE RENDERER MOVE, CARRIED OUT (plugin-host/replace-renderer.ts): the board is saved FIRST, then the
 * shell's door replaces this renderer (main reloads the page — its own `location.reload()` is a navigation the
 * shell refuses outside dev, which the restart smoke caught: the window drained its board and sat on a closed
 * lane, no new document). A host with no door reloads the page itself; a save that fails or never settles is
 * said and the replacement goes on; a door that refuses falls back to the page's own reload.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RendererLogger } from "../src/logging";
import { replaceThisRenderer } from "../src/plugin-host/replace-renderer";

function logger() {
  const said: string[] = [];
  const log = {
    info: (event: string) => said.push(event),
    error: (event: string) => said.push(event),
    warn: (event: string) => said.push(event),
  } as unknown as RendererLogger;
  return { log, said };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("replaceThisRenderer (DK-9)", () => {
  it("saves the board FIRST, then asks the shell's door — and never reloads the page itself", async () => {
    const order: string[] = [];
    const reload = vi.fn();
    const { log } = logger();
    await replaceThisRenderer({
      shutdown: async () => {
        order.push("save");
      },
      door: async (reason) => {
        order.push(`door ${reason}`);
        return { replacing: true };
      },
      reload,
      log,
    });
    expect(order).toEqual(["save", "door plugin-kinds"]);
    expect(reload).not.toHaveBeenCalled();
  });

  it("with no door (a browser harness) the page reloads itself, after the save", async () => {
    const order: string[] = [];
    const { log } = logger();
    await replaceThisRenderer({
      shutdown: async () => {
        order.push("save");
      },
      door: undefined,
      reload: () => order.push("reload"),
      log,
    });
    expect(order).toEqual(["save", "reload"]);
  });

  it("a save that fails is said, and the renderer is replaced regardless", async () => {
    const door = vi.fn(async () => ({ replacing: true }));
    const { log, said } = logger();
    await replaceThisRenderer({
      shutdown: async () => {
        throw new Error("lane closed");
      },
      door,
      reload: vi.fn(),
      log,
    });
    expect(said).toContain("renderer.plugins.replace_save_failed");
    expect(door).toHaveBeenCalledTimes(1);
  });

  it("a save that never settles is said at its deadline, and the renderer is replaced then", async () => {
    vi.useFakeTimers();
    const door = vi.fn(async () => ({ replacing: true }));
    const { log, said } = logger();
    const done = replaceThisRenderer({
      shutdown: () => new Promise<void>(() => undefined),
      door,
      reload: vi.fn(),
      log,
      saveDeadlineMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(door).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(said).toContain("renderer.plugins.replace_save_late");
    expect(door).toHaveBeenCalledTimes(1);
  });

  it("a door that refuses is said, and the page reloads itself", async () => {
    const reload = vi.fn();
    const { log, said } = logger();
    await replaceThisRenderer({
      shutdown: async () => undefined,
      door: async () => {
        throw new Error("an older shell: no handler registered for the renderer replacement");
      },
      reload,
      log,
    });
    expect(said).toContain("renderer.plugins.replace_refused");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
