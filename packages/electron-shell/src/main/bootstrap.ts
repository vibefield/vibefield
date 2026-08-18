import {
  RendererParticipantIdentity,
  type RendererParticipantIdentity as RendererParticipantIdentityValue,
  type WindowConnection,
} from "@vibefield/contracts";
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
  isDestroyed(): boolean;
  forcefullyCrashRenderer(): void;
  reload(): void;
  once(event: "destroyed", listener: () => void): unknown;
  on(
    event: "did-start-navigation",
    listener: (event: unknown, url: string, isInPlace: boolean, isMainFrame: boolean) => void,
  ): unknown;
  on(event: "render-process-gone", listener: () => void): unknown;
}

export interface WindowRendererBoundary {
  /** Requests termination of only the exact still-current renderer generation.
   * True means Electron accepted the request, not that process death occurred. */
  requestReplacement(identity: RendererParticipantIdentityValue): boolean;
  /** Requests every current document generation after fieldd's boot authority
   * changes. The later process-gone events remain the positive death facts. */
  requestAllReplacements(): { requested: number; unavailable: number };
  /** Counts-only ownership census for Doctor/physical soak. Reading it never
   * waits a mint/revocation or retains a renderer generation. */
  state(): WindowRendererBoundaryState;
}

export interface WindowRendererBoundaryState {
  readonly generations: number;
  readonly hookedSenders: number;
  readonly windowIdentities: number;
  readonly documentIdentities: number;
  readonly retirements: number;
  readonly replacementsRequested: number;
  readonly staleBootReapers: number;
}

export interface WindowBootstrapHandler extends WindowRendererBoundary {
  (event: { sender: WebContents }): Promise<WindowConnection>;
}

export function createBootstrapHandler(deps: {
  owns: (sender: WebContents) => boolean;
  ensure: FielddSupervisor["ensure"];
  /** Stable for one Electron main process. Renderer code never selects it. */
  desktopBootId: string;
  onRevokeError?: (error: unknown, details: { senderId: number; tokenId: string }) => void;
  onReplacementError?: (error: unknown, details: { senderId: number }) => void;
}): WindowBootstrapHandler {
  interface MintedGeneration {
    connection: WindowConnection;
    tokenId: string;
    handle: FielddHandle;
  }
  interface Generation {
    result: Promise<MintedGeneration>;
    connection: Promise<WindowConnection>;
    readonly identity: RendererParticipantIdentityValue;
    readonly sender: WebContents;
    replacementRequested: boolean;
    retired: boolean;
  }

  const generations = new Map<number, Generation>();
  const hooked = new Set<number>();
  const windowIdentities = new Map<number, string>();
  const documentIdentities = new Map<number, RendererParticipantIdentityValue>();
  const retirements = new Map<number, Promise<void>>();
  let windowSequence = 0;
  let documentSequence = 0;
  let reaper: { bootId: string; promise: Promise<void> } | null = null;

  const identityFor = (senderId: number): RendererParticipantIdentityValue => {
    const cached = documentIdentities.get(senderId);
    if (cached !== undefined) return cached;
    let participantId = windowIdentities.get(senderId);
    if (participantId === undefined) {
      participantId = `renderer:${deps.desktopBootId}:window-${++windowSequence}`;
      windowIdentities.set(senderId, participantId);
    }
    const identity = RendererParticipantIdentity.parse({
      participantId,
      incarnation: `${participantId}:document-${++documentSequence}`,
    });
    documentIdentities.set(senderId, identity);
    return identity;
  };

  const revokeWindowToken = async (
    handle: FielddHandle,
    tokenId: string,
    cause: "generation-ended" | "render-process-gone",
  ): Promise<void> => {
    const params = cause === "generation-ended" ? { tokenId } : { tokenId, cause };
    try {
      await handle.client.request("system.revokeWindowToken", params);
      return;
    } catch {
      // A navigation cannot wait for transport recovery, but revocation can.
      // Retry through ensure() so a transient dropped response does not leave
      // the old renderer grant alive until the shell is restarted. If ensure
      // adopts a new daemon boot, the old daemon (and its in-memory grant) is
      // already gone.
      const current = await deps.ensure();
      if (current.info.bootId !== handle.info.bootId) return;
      await current.client.request("system.revokeWindowToken", params);
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

  const retire = (
    senderId: number,
    cause: "generation-ended" | "render-process-gone",
  ): Promise<void> | null => {
    const generation = generations.get(senderId);
    if (generation === undefined || generation.retired) return null;
    generation.retired = true;
    if (generations.get(senderId) === generation) generations.delete(senderId);
    const prior = retirements.get(senderId) ?? Promise.resolve();
    const retirement = prior
      .catch(() => undefined)
      .then(async () => {
        const minted = await generation.result.catch(() => null);
        if (minted === null) return;
        await revokeWindowToken(minted.handle, minted.tokenId, cause);
      });
    retirements.set(senderId, retirement);
    void retirement
      .catch((error: unknown) => {
        // Revocation failures are visible, while renderer teardown remains
        // non-blocking. fieldd itself revokes even when its audit sink fails.
        void generation.result.then(
          ({ tokenId }) => deps.onRevokeError?.(error, { senderId, tokenId }),
          () => undefined,
        );
      })
      .finally(() => {
        if (retirements.get(senderId) === retirement) retirements.delete(senderId);
      });
    return retirement;
  };

  const handle = ((event: { sender: WebContents }) => {
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
        if (isMainFrame && !isInPlace) {
          retire(sender.id, "generation-ended");
          documentIdentities.delete(sender.id);
        }
      });
      s.on("render-process-gone", () => {
        // This event is the positive boundary fact. Its exact token generation
        // is still present here, so fieldd never accepts renderer-supplied
        // participant identity as death evidence.
        const generation = generations.get(sender.id);
        const retirement = retire(sender.id, "render-process-gone");
        documentIdentities.delete(sender.id);
        if (generation?.replacementRequested === true && retirement !== null) {
          void retirement
            .then(() => {
              // A new renderer document must not mint until fieldd positively
              // retired the old incarnation. Reload is the replacement half;
              // provider success by itself remains non-authoritative.
              if (!s.isDestroyed()) s.reload();
            })
            .catch(() => undefined);
        }
      });
      s.once("destroyed", () => {
        retire(sender.id, "generation-ended");
        hooked.delete(sender.id);
        documentIdentities.delete(sender.id);
        windowIdentities.delete(sender.id);
      });
    }

    const identity = identityFor(sender.id);
    const generation = {
      identity,
      sender,
      replacementRequested: false,
    } as Generation;
    generation.retired = false;
    const predecessor = retirements.get(sender.id);
    generation.result = (async () => {
      await predecessor?.catch(() => undefined);
      return await mint(deps.ensure, reapStaleForBoot, sender.id, identity);
    })().catch((error: unknown) => {
      // failure ends the cached attempt — retry re-mints for real
      if (generations.get(sender.id) === generation) generations.delete(sender.id);
      throw error;
    });
    generation.connection = generation.result.then((result) => result.connection);
    generations.set(sender.id, generation);
    return generation.connection;
  }) as WindowBootstrapHandler;
  const requestGenerationReplacement = (generation: Generation): boolean => {
    if (generation.retired || generation.replacementRequested) return false;
    const sender = generation.sender as unknown as SenderLike;
    if (sender.isDestroyed()) return false;
    generation.replacementRequested = true;
    try {
      sender.forcefullyCrashRenderer();
      return true;
    } catch (error) {
      generation.replacementRequested = false;
      deps.onReplacementError?.(error, { senderId: sender.id });
      return false;
    }
  };
  handle.requestReplacement = (identity): boolean => {
    const parsed = RendererParticipantIdentity.parse(identity);
    for (const generation of generations.values()) {
      if (
        generation.identity.participantId === parsed.participantId &&
        generation.identity.incarnation === parsed.incarnation
      ) {
        return requestGenerationReplacement(generation);
      }
    }
    return false;
  };
  handle.requestAllReplacements = () => {
    let requested = 0;
    let unavailable = 0;
    for (const generation of [...generations.values()]) {
      if (generation.retired || generation.replacementRequested) continue;
      if (requestGenerationReplacement(generation)) requested += 1;
      else unavailable += 1;
    }
    return Object.freeze({ requested, unavailable });
  };
  handle.state = () => {
    let replacementsRequested = 0;
    for (const generation of generations.values()) {
      if (generation.replacementRequested) replacementsRequested += 1;
    }
    return Object.freeze({
      generations: generations.size,
      hookedSenders: hooked.size,
      windowIdentities: windowIdentities.size,
      documentIdentities: documentIdentities.size,
      retirements: retirements.size,
      replacementsRequested,
      staleBootReapers: reaper === null ? 0 : 1,
    });
  };
  return handle;
}

async function mint(
  ensure: FielddSupervisor["ensure"],
  reapStaleForBoot: (handle: FielddHandle) => Promise<void>,
  senderId: number,
  rendererParticipant: RendererParticipantIdentityValue,
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
    rendererParticipant,
  })) as { token: string; tokenId: string; rendererParticipant?: unknown };
  let acceptedIdentity: RendererParticipantIdentityValue;
  try {
    acceptedIdentity = RendererParticipantIdentity.parse(minted.rendererParticipant);
    if (
      acceptedIdentity.participantId !== rendererParticipant.participantId ||
      acceptedIdentity.incarnation !== rendererParticipant.incarnation
    ) {
      throw new Error("fieldd returned a different renderer participant identity");
    }
  } catch (error) {
    // Never disclose a bearer whose server-side participant binding is absent
    // or different. A failed best-effort revoke is caught by the next mandatory
    // stale-window sweep, and this token never reaches renderer code.
    await handle.client
      .request("system.revokeWindowToken", { tokenId: minted.tokenId })
      .catch(() => undefined);
    throw error;
  }
  return {
    connection: {
      port: handle.info.port,
      token: minted.token,
      rendererParticipant: acceptedIdentity,
    },
    tokenId: minted.tokenId,
    handle,
  };
}
