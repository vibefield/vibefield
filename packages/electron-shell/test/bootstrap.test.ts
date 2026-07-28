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

function fakeDaemon(opts?: {
  failFirstMint?: boolean;
  failFirstReap?: boolean;
  failFirstRevoke?: boolean;
}) {
  let minted = 0;
  let mintFailures = opts?.failFirstMint ? 1 : 0;
  let reapFailures = opts?.failFirstReap ? 1 : 0;
  let revokeFailures = opts?.failFirstRevoke ? 1 : 0;
  const revoked: string[] = [];
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === "system.revokeStaleWindowTokens") {
      if (reapFailures > 0) {
        reapFailures -= 1;
        throw new Error("stale-token sweep failed");
      }
      return { revoked: 0, droppedConnections: 0 };
    }
    if (method === "system.revokeWindowToken") {
      if (revokeFailures > 0) {
        revokeFailures -= 1;
        throw new Error("revocation response lost");
      }
      revoked.push((params as { tokenId: string }).tokenId);
      return { revoked: true, droppedConnections: 0 };
    }
    if (mintFailures > 0) {
      mintFailures -= 1;
      throw new Error("daemon not ready");
    }
    expect(method).toBe("system.mintWindowToken");
    minted += 1;
    return {
      token: `tk-${minted}-${(params as { label: string }).label}`,
      tokenId: `tk_${minted.toString(16).padStart(12, "0")}`,
    };
  });
  const ensure = vi.fn(async () => ({
    info: { port: 4242, bootId: "fieldd-test" },
    client: { request },
  }));
  return {
    ensure: ensure as unknown as FielddSupervisor["ensure"],
    request,
    mintCount: () => minted,
    revoked,
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
    expect(
      daemon.request.mock.calls.filter(([method]) => method === "system.revokeStaleWindowTokens"),
    ).toHaveLength(1);
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
    const daemon = fakeDaemon({ failFirstMint: true });
    const handler = createBootstrapHandler({ owns: () => true, ensure: daemon.ensure });
    const s = fakeSender(1);
    await expect(handler({ sender: s.wc })).rejects.toThrow("daemon not ready");
    const conn = await handler({ sender: s.wc });
    expect(conn.token).toContain("tk-1"); // the retry's mint, not a cached rejection
    expect(
      daemon.request.mock.calls.filter(([method]) => method === "system.mintWindowToken"),
    ).toHaveLength(2);
    expect(
      daemon.request.mock.calls.filter(([method]) => method === "system.revokeStaleWindowTokens"),
    ).toHaveLength(1);
  });

  it("blocks minting behind a failed stale-token sweep and retries the sweep", async () => {
    const daemon = fakeDaemon({ failFirstReap: true });
    const handler = createBootstrapHandler({ owns: () => true, ensure: daemon.ensure });
    const s = fakeSender(1);
    await expect(handler({ sender: s.wc })).rejects.toThrow("stale-token sweep failed");
    expect(daemon.mintCount()).toBe(0);

    await expect(handler({ sender: s.wc })).resolves.toMatchObject({ port: 4242 });
    expect(
      daemon.request.mock.calls.filter(([method]) => method === "system.revokeStaleWindowTokens"),
    ).toHaveLength(2);
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
    await vi.waitFor(() => expect(daemon.revoked).toHaveLength(1));
    const second = await handler({ sender: s.wc });
    expect(second.token).not.toBe(first.token);
    expect(daemon.mintCount()).toBe(2);
    expect(daemon.revoked).toEqual(["tk_000000000001"]);
  });

  it("destruction revokes the generation before an id can be reused", async () => {
    const daemon = fakeDaemon();
    const handler = createBootstrapHandler({ owns: () => true, ensure: daemon.ensure });
    const s = fakeSender(1);
    await handler({ sender: s.wc });
    s.destroy();
    await vi.waitFor(() => expect(daemon.revoked).toEqual(["tk_000000000001"]));
    await handler({ sender: s.wc }); // a fresh generation (Electron reuses ids)
    expect(daemon.mintCount()).toBe(2);
  });

  it("retries exact revocation after a transient daemon link failure", async () => {
    const daemon = fakeDaemon({ failFirstRevoke: true });
    const onRevokeError = vi.fn();
    const handler = createBootstrapHandler({
      owns: () => true,
      ensure: daemon.ensure,
      onRevokeError,
    });
    const s = fakeSender(1);
    await handler({ sender: s.wc });

    s.navigate();

    await vi.waitFor(() => expect(daemon.revoked).toEqual(["tk_000000000001"]));
    expect(
      daemon.request.mock.calls.filter(([method]) => method === "system.revokeWindowToken"),
    ).toHaveLength(2);
    expect(onRevokeError).not.toHaveBeenCalled();
  });

  it("revokes a mint that completes after its generation already retired", async () => {
    let finishMint: ((value: { token: string; tokenId: string }) => void) | undefined;
    const mintResult = new Promise<{ token: string; tokenId: string }>((resolve) => {
      finishMint = resolve;
    });
    const request = vi.fn((method: string) => {
      if (method === "system.revokeStaleWindowTokens") {
        return Promise.resolve({ revoked: 0 });
      }
      if (method === "system.mintWindowToken") return mintResult;
      return Promise.resolve({ revoked: true });
    });
    const ensure = vi.fn(async () => ({
      info: { port: 4242, bootId: "fieldd-test" },
      client: { request },
    })) as unknown as FielddSupervisor["ensure"];
    const handler = createBootstrapHandler({ owns: () => true, ensure });
    const s = fakeSender(1);

    const connection = handler({ sender: s.wc });
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("system.mintWindowToken", expect.anything()),
    );
    s.navigate();
    finishMint?.({ token: "retired-token", tokenId: "tk_00000000000a" });
    await expect(connection).resolves.toEqual({ port: 4242, token: "retired-token" });
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("system.revokeWindowToken", {
        tokenId: "tk_00000000000a",
      }),
    );
  });
});
