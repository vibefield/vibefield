import type { FielddSupervisor } from "@vibefield/fieldd-supervisor";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { createBootstrapHandler } from "../src/main/bootstrap";

// The once-per-generation mint contract (spec §6.2 table; review finding 6):
// one token per webContents generation — concurrent and repeat invokes share
// it; a failure clears for an honest retry; a main-frame cross-document
// navigation or destruction ends the generation. Structural fakes, no electron.

type NavListener = (event: unknown, url: string, isInPlace: boolean, isMainFrame: boolean) => void;

function fakeSender(id: number) {
  const nav: NavListener[] = [];
  const destroyed: (() => void)[] = [];
  const sender = {
    id,
    on: (event: string, fn: NavListener) => {
      if (event === "did-start-navigation") nav.push(fn);
    },
    once: (event: string, fn: () => void) => {
      if (event === "destroyed") destroyed.push(fn);
    },
  };
  return {
    wc: sender as unknown as WebContents,
    navigate: (opts?: { isInPlace?: boolean; isMainFrame?: boolean }) => {
      for (const fn of [...nav])
        fn({}, "app://reload", opts?.isInPlace ?? false, opts?.isMainFrame ?? true);
    },
    destroy: () => {
      for (const fn of [...destroyed]) fn();
    },
  };
}

function fakeDaemon(opts?: { failFirst?: boolean }) {
  let minted = 0;
  let failures = opts?.failFirst ? 1 : 0;
  const request = vi.fn(async (_method: string, params?: unknown) => {
    if (failures > 0) {
      failures -= 1;
      throw new Error("daemon not ready");
    }
    minted += 1;
    return { token: `tk-${minted}-${(params as { label: string }).label}` };
  });
  const ensure = vi.fn(async () => ({ info: { port: 4242 }, client: { request } }));
  return {
    ensure: ensure as unknown as FielddSupervisor["ensure"],
    request,
    mintCount: () => minted,
  };
}

describe("createBootstrapHandler (once per generation)", () => {
  it("refuses a sender the registry does not own", async () => {
    const daemon = fakeDaemon();
    const handler = createBootstrapHandler({ owns: () => false, ensure: daemon.ensure });
    await expect(handler({ sender: fakeSender(9).wc })).rejects.toThrow("unregistered sender");
    expect(daemon.request).not.toHaveBeenCalled();
  });

  it("concurrent and repeat invokes from one sender share ONE mint", async () => {
    const daemon = fakeDaemon();
    const handler = createBootstrapHandler({ owns: () => true, ensure: daemon.ensure });
    const s = fakeSender(1);

    // StrictMode's dev double-invoke: two in flight at once
    const [a, b] = await Promise.all([handler({ sender: s.wc }), handler({ sender: s.wc })]);
    const c = await handler({ sender: s.wc }); // and a later re-invoke
    expect(daemon.mintCount()).toBe(1);
    expect(a.token).toBe(b.token);
    expect(a.token).toBe(c.token);
    expect(a.port).toBe(4242);
  });

  it("distinct senders mint distinct tokens with their own labels", async () => {
    const daemon = fakeDaemon();
    const handler = createBootstrapHandler({ owns: () => true, ensure: daemon.ensure });
    const one = await handler({ sender: fakeSender(1).wc });
    const two = await handler({ sender: fakeSender(2).wc });
    expect(daemon.mintCount()).toBe(2);
    expect(one.token).toContain("window-1");
    expect(two.token).toContain("window-2");
    expect(one.token).not.toBe(two.token);
  });

  it("a failed mint clears the cache — the retry mints for real", async () => {
    const daemon = fakeDaemon({ failFirst: true });
    const handler = createBootstrapHandler({ owns: () => true, ensure: daemon.ensure });
    const s = fakeSender(1);
    await expect(handler({ sender: s.wc })).rejects.toThrow("daemon not ready");
    const conn = await handler({ sender: s.wc });
    expect(conn.token).toContain("tk-1"); // the retry's mint, not a cached rejection
    expect(daemon.request).toHaveBeenCalledTimes(2);
  });

  it("a main-frame cross-document navigation ends the generation; in-place does not", async () => {
    const daemon = fakeDaemon();
    const handler = createBootstrapHandler({ owns: () => true, ensure: daemon.ensure });
    const s = fakeSender(1);

    const first = await handler({ sender: s.wc });
    s.navigate({ isInPlace: true }); // hash/HMR-style — same document
    s.navigate({ isMainFrame: false }); // a subframe — not our generation
    expect((await handler({ sender: s.wc })).token).toBe(first.token);

    s.navigate(); // a real reload: main frame, new document
    const second = await handler({ sender: s.wc });
    expect(second.token).not.toBe(first.token);
    expect(daemon.mintCount()).toBe(2);
  });

  it("destruction clears the cache entry", async () => {
    const daemon = fakeDaemon();
    const handler = createBootstrapHandler({ owns: () => true, ensure: daemon.ensure });
    const s = fakeSender(1);
    await handler({ sender: s.wc });
    s.destroy();
    await handler({ sender: s.wc }); // a fresh generation (Electron reuses ids)
    expect(daemon.mintCount()).toBe(2);
  });
});
