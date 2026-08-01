import type { WindowConnection } from "@vibefield/contracts";
import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import type { WebContents } from "electron";

// The bootstrap mint, PURE (ESR §6.2–6.3): the sender policy plus the
// once-per-generation cache the contract table promises ("once per webContents
// generation, retry only after failure"). Until the 2026-07-23 review, every
// invoke minted a fresh token — StrictMode's dev double-invoke minted two per
// boot, and every stale token stayed valid until daemon restart (EL7 surface
// growth). The cache keys on the webContents id; a main-frame cross-document
// navigation or destruction ends the generation; a failed mint clears so the
// renderer's retry is honest.

/** The slice of WebContents the generation cache listens to — tests fake it
 * structurally (the pattern of window-policy's fakes). */
interface SenderLike {
  readonly id: number;
  once(event: "destroyed", listener: () => void): unknown;
  on(
    event: "did-start-navigation",
    listener: (event: unknown, url: string, isInPlace: boolean, isMainFrame: boolean) => void,
  ): unknown;
}

export function createBootstrapHandler(deps: {
  owns: (sender: WebContents) => boolean;
  ensure: FielddSupervisor["ensure"];
  onRevokeError?: (error: unknown, details: { senderId: number; tokenId: string }) => void;
}): (event: { sender: WebContents }) => Promise<WindowConnection> {
  interface MintedGeneration {
    connection: WindowConnection;
    tokenId: string;
    handle: FielddHandle;
  }
  interface Generation {
    result: Promise<MintedGeneration>;
    connection: Promise<WindowConnection>;
    retired: boolean;
  }

  const generations = new Map<number, Generation>();
  const hooked = new Set<number>();
  let reaper: { bootId: string; promise: Promise<void> } | null = null;

  const revokeWindowToken = async (handle: FielddHandle, tokenId: string): Promise<void> => {
    try {
      await handle.client.request("system.revokeWindowToken", { tokenId });
      return;
    } catch {
      // A navigation cannot wait for transport recovery, but revocation can.
      // Retry through ensure() so a transient dropped response does not leave
      // the old renderer grant alive until the shell is restarted. If ensure
      // adopts a new daemon boot, the old daemon (and its in-memory grant) is
      // already gone.
      const current = await deps.ensure();
      if (current.info.bootId !== handle.info.bootId) return;
      await current.client.request("system.revokeWindowToken", { tokenId });
    }
  };

  const reapStaleForBoot = async (handle: FielddHandle): Promise<void> => {
    if (reaper?.bootId === handle.info.bootId) return await reaper.promise;
    const promise = handle.client
      .request("system.revokeStaleWindowTokens", {})
      .then(() => undefined);
    const attempt = { bootId: handle.info.bootId, promise };
    reaper = attempt;
    try {
      await promise;
    } catch (error) {
      // A failed safety sweep must be retryable; do not mint behind it.
      if (reaper === attempt) reaper = null;
      throw error;
    }
  };

  const retire = (senderId: number): void => {
    const generation = generations.get(senderId);
    if (generation === undefined || generation.retired) return;
    generation.retired = true;
    if (generations.get(senderId) === generation) generations.delete(senderId);
    void generation.result
      .then(
        async ({ handle, tokenId }) => {
          await revokeWindowToken(handle, tokenId);
        },
        () => undefined,
      )
      .catch((error: unknown) => {
        // Revocation failures are visible, while renderer teardown remains
        // non-blocking. fieldd itself revokes even when its audit sink fails.
        void generation.result.then(
          ({ tokenId }) => deps.onRevokeError?.(error, { senderId, tokenId }),
          () => undefined,
        );
      });
  };

  return (event) => {
    const sender = event.sender;
    if (!deps.owns(sender)) {
      return Promise.reject(new Error("window bootstrap refused: unregistered sender"));
    }
    const cached = generations.get(sender.id);
    if (cached) return cached.connection;

    if (!hooked.has(sender.id)) {
      hooked.add(sender.id);
      const s = sender as unknown as SenderLike;
      s.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
        // a new main-frame document is a NEW generation — the old page's token
        // dies with its JS; revoke it before the next invoke mints fresh
        if (isMainFrame && !isInPlace) retire(sender.id);
      });
      s.once("destroyed", () => {
        retire(sender.id);
        hooked.delete(sender.id);
      });
    }

    const generation = {} as Generation;
    generation.retired = false;
    generation.result = mint(deps.ensure, reapStaleForBoot, sender.id).catch((error: unknown) => {
      // failure ends the cached attempt — retry re-mints for real
      if (generations.get(sender.id) === generation) generations.delete(sender.id);
      throw error;
    });
    generation.connection = generation.result.then((result) => result.connection);
    generations.set(sender.id, generation);
    return generation.connection;
  };
}

async function mint(
  ensure: FielddSupervisor["ensure"],
  reapStaleForBoot: (handle: FielddHandle) => Promise<void>,
  senderId: number,
): Promise<{ connection: WindowConnection; tokenId: string; handle: FielddHandle }> {
  const handle = await ensure();
  // A production fieldd outlives Electron. Reap grants left by a previous
  // shell crash once per daemon boot, before issuing this shell's first grant.
  await reapStaleForBoot(handle);
  const minted = (await handle.client.request("system.mintWindowToken", {
    // B3: the renderer owns the board doc — doc.* is scope-gated (EL7), and
    // the doc lane itself is entered through doc.open's one-shot ticket.
    // C4: workspace.read lets the Settings mesh section read the device roster.
    // P2: plugins.read feeds the registry snapshot; plugins.manage backs the
    // Settings plugin toggles (both local-only scopes — never in the tailnet preset).
    // LOG-L5: the host-owned Settings diagnostics surface reads records and
    // manages time-bounded leases. Plugin-bound tokens never receive either.
    // GT-1: the deck redeems its own tickets — terminal.attach covers
    // attach+create+terminate in the v1 posture (GT-D6), and only spine code
    // holds a window token. The terminal.manage split is the named upgrade
    // before any plugin reaches a terminal.
    scopes: [
      "doc.read",
      "doc.write",
      "workspace.read",
      "plugins.read",
      "plugins.manage",
      "diagnostics.read",
      "diagnostics.manage",
      "settings.manage",
      "terminal.attach",
    ],
    label: `window-${senderId}`,
  })) as { token: string; tokenId: string };
  return {
    connection: { port: handle.info.port, token: minted.token },
    tokenId: minted.tokenId,
    handle,
  };
}
