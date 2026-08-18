import type { FielddSupervisor } from "@vibefield/fieldd-supervisor";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { createBootstrapHandler } from "../src/main/bootstrap";

// The once-per-generation mint contract (spec §6.2 table; review finding 6):
// one token per webContents generation — concurrent and repeat invokes share
// it; a failure clears for an honest retry; a main-frame cross-document
// navigation or destruction ends the generation. Structural fakes, no electron.

type NavListener = (event: unknown, url: string, isInPlace: boolean, isMainFrame: boolean) => void;
const DESKTOP_BOOT_ID = "desktop-test-a1b2";

function fakeSender(id: number) {
  const nav: NavListener[] = [];
  const processGone: (() => void)[] = [];
  const destroyed: (() => void)[] = [];
  let isDestroyed = false;
  let crashRequests = 0;
  let reloads = 0;
  const sender = {
    id,
    isDestroyed: () => isDestroyed,
    forcefullyCrashRenderer: () => {
      crashRequests += 1;
    },
    reload: () => {
      reloads += 1;
    },
    on: (event: string, fn: NavListener | (() => void)) => {
      if (event === "did-start-navigation") nav.push(fn as NavListener);
      if (event === "render-process-gone") processGone.push(fn as () => void);
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
      isDestroyed = true;
      for (const fn of [...destroyed]) fn();
    },
    processGone: () => {
      for (const fn of [...processGone]) fn();
    },
    crashRequests: () => crashRequests,
    reloads: () => reloads,
  };
}

function fakeDaemon(opts?: {
  failFirstMint?: boolean;
  failFirstReap?: boolean;
  failFirstRevoke?: boolean;
  mismatchIdentity?: boolean;
}) {
  let minted = 0;
  let mintFailures = opts?.failFirstMint ? 1 : 0;
  let reapFailures = opts?.failFirstReap ? 1 : 0;
  let revokeFailures = opts?.failFirstRevoke ? 1 : 0;
  const revoked: string[] = [];
  const revocations: Array<{ tokenId: string; cause: string }> = [];
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
      const parsed = params as { tokenId: string; cause?: string };
      revoked.push(parsed.tokenId);
      revocations.push({ tokenId: parsed.tokenId, cause: parsed.cause ?? "generation-ended" });
      return { revoked: true, droppedConnections: 0 };
    }
    if (mintFailures > 0) {
      mintFailures -= 1;
      throw new Error("daemon not ready");
    }
    expect(method).toBe("system.mintWindowToken");
    minted += 1;
    const rendererParticipant = (params as { rendererParticipant?: unknown } | undefined)
      ?.rendererParticipant;
    return {
      token: `tk-${minted}-${(params as { label: string }).label}`,
      tokenId: `tk_${minted.toString(16).padStart(12, "0")}`,
      rendererParticipant: opts?.mismatchIdentity
        ? {
            participantId: "renderer:forged:window-9",
            incarnation: "renderer:forged:window-9:document-9",
          }
        : rendererParticipant,
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
    revocations,
  };
}

describe("createBootstrapHandler (once per generation)", () => {
  it("refuses a sender the registry does not own", async () => {
    const daemon = fakeDaemon();
    const handler = createBootstrapHandler({
      owns: () => false,
      ensure: daemon.ensure,
      desktopBootId: DESKTOP_BOOT_ID,
    });
    await expect(handler({ sender: fakeSender(9).wc })).rejects.toThrow("unregistered sender");
    expect(daemon.request).not.toHaveBeenCalled();
  });

  it("concurrent and repeat invokes from one sender share ONE mint", async () => {
    const daemon = fakeDaemon();
    const handler = createBootstrapHandler({
      owns: () => true,
      ensure: daemon.ensure,
      desktopBootId: DESKTOP_BOOT_ID,
    });
    const s = fakeSender(1);

    // StrictMode's dev double-invoke: two in flight at once
    const [a, b] = await Promise.all([handler({ sender: s.wc }), handler({ sender: s.wc })]);
    const c = await handler({ sender: s.wc }); // and a later re-invoke
    expect(daemon.mintCount()).toBe(1);
    expect(a.token).toBe(b.token);
    expect(a.token).toBe(c.token);
    expect(a.port).toBe(4242);
    expect(a.rendererParticipant).toEqual(b.rendererParticipant);
    expect(a.rendererParticipant).toEqual(c.rendererParticipant);
    expect(
      daemon.request.mock.calls.filter(([method]) => method === "system.revokeStaleWindowTokens"),
    ).toHaveLength(1);
  });

  it("distinct senders mint distinct tokens with their own labels", async () => {
    const daemon = fakeDaemon();
    const handler = createBootstrapHandler({
      owns: () => true,
      ensure: daemon.ensure,
      desktopBootId: DESKTOP_BOOT_ID,
    });
    const one = await handler({ sender: fakeSender(1).wc });
    const two = await handler({ sender: fakeSender(2).wc });
    expect(daemon.mintCount()).toBe(2);
    expect(one.token).toContain("window-1");
    expect(two.token).toContain("window-2");
    expect(one.token).not.toBe(two.token);
    expect(one.rendererParticipant.participantId).not.toBe(two.rendererParticipant.participantId);
  });

  it("a failed mint clears the cache — the retry mints for real", async () => {
    const daemon = fakeDaemon({ failFirstMint: true });
    const handler = createBootstrapHandler({
      owns: () => true,
      ensure: daemon.ensure,
      desktopBootId: DESKTOP_BOOT_ID,
    });
    const s = fakeSender(1);
    await expect(handler({ sender: s.wc })).rejects.toThrow("daemon not ready");
    const conn = await handler({ sender: s.wc });
    expect(conn.token).toContain("tk-1"); // the retry's mint, not a cached rejection
    expect(
      daemon.request.mock.calls.filter(([method]) => method === "system.mintWindowToken"),
    ).toHaveLength(2);
    const identities = daemon.request.mock.calls
      .filter(([method]) => method === "system.mintWindowToken")
      .map(([, params]) => (params as { rendererParticipant: unknown }).rendererParticipant);
    expect(identities[0]).toEqual(identities[1]);
    expect(
      daemon.request.mock.calls.filter(([method]) => method === "system.revokeStaleWindowTokens"),
    ).toHaveLength(1);
  });

  it("blocks minting behind a failed stale-token sweep and retries the sweep", async () => {
    const daemon = fakeDaemon({ failFirstReap: true });
    const handler = createBootstrapHandler({
      owns: () => true,
      ensure: daemon.ensure,
      desktopBootId: DESKTOP_BOOT_ID,
    });
    const s = fakeSender(1);
    await expect(handler({ sender: s.wc })).rejects.toThrow("stale-token sweep failed");
    expect(daemon.mintCount()).toBe(0);

    await expect(handler({ sender: s.wc })).resolves.toMatchObject({ port: 4242 });
    expect(
      daemon.request.mock.calls.filter(([method]) => method === "system.revokeStaleWindowTokens"),
    ).toHaveLength(2);
  });

  it("refuses and revokes a token whose daemon identity echo does not match", async () => {
    const daemon = fakeDaemon({ mismatchIdentity: true });
    const handler = createBootstrapHandler({
      owns: () => true,
      ensure: daemon.ensure,
      desktopBootId: DESKTOP_BOOT_ID,
    });

    await expect(handler({ sender: fakeSender(1).wc })).rejects.toThrow(
      "different renderer participant identity",
    );
    expect(daemon.revoked).toEqual(["tk_000000000001"]);
  });

  it("a main-frame cross-document navigation ends the generation; in-place does not", async () => {
    const daemon = fakeDaemon();
    const handler = createBootstrapHandler({
      owns: () => true,
      ensure: daemon.ensure,
      desktopBootId: DESKTOP_BOOT_ID,
    });
    const s = fakeSender(1);

    const first = await handler({ sender: s.wc });
    s.navigate({ isInPlace: true }); // hash/HMR-style — same document
    s.navigate({ isMainFrame: false }); // a subframe — not our generation
    expect((await handler({ sender: s.wc })).token).toBe(first.token);

    s.navigate(); // a real reload: main frame, new document
    await vi.waitFor(() => expect(daemon.revoked).toHaveLength(1));
    const second = await handler({ sender: s.wc });
    expect(second.token).not.toBe(first.token);
    expect(second.rendererParticipant.participantId).toBe(first.rendererParticipant.participantId);
    expect(second.rendererParticipant.incarnation).not.toBe(first.rendererParticipant.incarnation);
    expect(daemon.mintCount()).toBe(2);
    expect(daemon.revoked).toEqual(["tk_000000000001"]);
  });

  it("destruction revokes the generation before an id can be reused", async () => {
    const daemon = fakeDaemon();
    const handler = createBootstrapHandler({
      owns: () => true,
      ensure: daemon.ensure,
      desktopBootId: DESKTOP_BOOT_ID,
    });
    const s = fakeSender(1);
    const first = await handler({ sender: s.wc });
    s.destroy();
    await vi.waitFor(() => expect(daemon.revoked).toEqual(["tk_000000000001"]));
    const second = await handler({ sender: s.wc }); // a fresh logical window
    expect(daemon.mintCount()).toBe(2);
    expect(second.rendererParticipant.participantId).not.toBe(
      first.rendererParticipant.participantId,
    );
  });

  it("requests and reports only the exact process-gone generation, then remints behind revocation", async () => {
    const daemon = fakeDaemon();
    const handler = createBootstrapHandler({
      owns: () => true,
      ensure: daemon.ensure,
      desktopBootId: DESKTOP_BOOT_ID,
    });
    const s = fakeSender(1);
    const first = await handler({ sender: s.wc });

    expect(
      handler.requestReplacement({
        ...first.rendererParticipant,
        incarnation: `${first.rendererParticipant.participantId}:document-forged`,
      }),
    ).toBe(false);
    expect(handler.requestReplacement(first.rendererParticipant)).toBe(true);
    expect(s.crashRequests()).toBe(1);
    expect(daemon.revoked).toEqual([]);

    s.processGone();
    const secondPromise = handler({ sender: s.wc });
    await vi.waitFor(() =>
      expect(daemon.revocations).toEqual([
        { tokenId: "tk_000000000001", cause: "render-process-gone" },
      ]),
    );
    await vi.waitFor(() => expect(s.reloads()).toBe(1));
    const second = await secondPromise;
    expect(second.rendererParticipant.participantId).toBe(first.rendererParticipant.participantId);
    expect(second.rendererParticipant.incarnation).not.toBe(first.rendererParticipant.incarnation);
  });

  it("fences two current windows once and reloads each only after exact process death", async () => {
    const daemon = fakeDaemon();
    const handler = createBootstrapHandler({
      owns: () => true,
      ensure: daemon.ensure,
      desktopBootId: DESKTOP_BOOT_ID,
    });
    const a = fakeSender(1);
    const b = fakeSender(2);
    const oldA = await handler({ sender: a.wc });
    const oldB = await handler({ sender: b.wc });

    expect(handler.state()).toEqual({
      generations: 2,
      hookedSenders: 2,
      windowIdentities: 2,
      documentIdentities: 2,
      retirements: 0,
      replacementsRequested: 0,
      staleBootReapers: 1,
    });

    expect(handler.requestAllReplacements()).toEqual({ requested: 2, unavailable: 0 });
    expect(handler.requestAllReplacements()).toEqual({ requested: 0, unavailable: 0 });
    expect(handler.state().replacementsRequested).toBe(2);
    expect(a.crashRequests()).toBe(1);
    expect(b.crashRequests()).toBe(1);
    expect(daemon.revocations).toEqual([]);
    expect(a.reloads()).toBe(0);
    expect(b.reloads()).toBe(0);

    a.processGone();
    b.processGone();
    const nextA = handler({ sender: a.wc });
    const nextB = handler({ sender: b.wc });
    await vi.waitFor(() => expect(daemon.revocations).toHaveLength(2));
    await vi.waitFor(() => {
      expect(a.reloads()).toBe(1);
      expect(b.reloads()).toBe(1);
    });
    const [newA, newB] = await Promise.all([nextA, nextB]);
    await vi.waitFor(() =>
      expect(handler.state()).toEqual({
        generations: 2,
        hookedSenders: 2,
        windowIdentities: 2,
        documentIdentities: 2,
        retirements: 0,
        replacementsRequested: 0,
        staleBootReapers: 1,
      }),
    );
    expect(newA.rendererParticipant.participantId).toBe(oldA.rendererParticipant.participantId);
    expect(newB.rendererParticipant.participantId).toBe(oldB.rendererParticipant.participantId);
    expect(newA.rendererParticipant.incarnation).not.toBe(oldA.rendererParticipant.incarnation);
    expect(newB.rendererParticipant.incarnation).not.toBe(oldB.rendererParticipant.incarnation);
    expect(daemon.revocations).toEqual([
      { tokenId: "tk_000000000001", cause: "render-process-gone" },
      { tokenId: "tk_000000000002", cause: "render-process-gone" },
    ]);
  });

  it("retries exact revocation after a transient daemon link failure", async () => {
    const daemon = fakeDaemon({ failFirstRevoke: true });
    const onRevokeError = vi.fn();
    const handler = createBootstrapHandler({
      owns: () => true,
      ensure: daemon.ensure,
      desktopBootId: DESKTOP_BOOT_ID,
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
    const request = vi.fn((method: string, params?: unknown) => {
      if (method === "system.revokeStaleWindowTokens") {
        return Promise.resolve({ revoked: 0 });
      }
      if (method === "system.mintWindowToken") {
        return mintResult.then((result) => ({
          ...result,
          rendererParticipant: (params as { rendererParticipant?: unknown } | undefined)
            ?.rendererParticipant,
        }));
      }
      return Promise.resolve({ revoked: true });
    });
    const ensure = vi.fn(async () => ({
      info: { port: 4242, bootId: "fieldd-test" },
      client: { request },
    })) as unknown as FielddSupervisor["ensure"];
    const handler = createBootstrapHandler({
      owns: () => true,
      ensure,
      desktopBootId: DESKTOP_BOOT_ID,
    });
    const s = fakeSender(1);

    const connection = handler({ sender: s.wc });
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("system.mintWindowToken", expect.anything()),
    );
    s.navigate();
    finishMint?.({ token: "retired-token", tokenId: "tk_00000000000a" });
    await expect(connection).resolves.toMatchObject({ port: 4242, token: "retired-token" });
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("system.revokeWindowToken", {
        tokenId: "tk_00000000000a",
      }),
    );
  });
});
