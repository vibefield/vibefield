/**
 * Optional Browser control-plane identity. This registry is main-private: Live
 * Surfaces frame contracts deliberately never carry CDP target material.
 */

export interface BrowserControlTargetWebContents {
  readonly id: number;
  isDestroyed(): boolean;
  getOrCreateDevToolsTargetId(): string;
  once(event: "destroyed", listener: () => void): this;
  off(event: "destroyed", listener: () => void): this;
}

/**
 * EY-1 (1f, 2026-11-19) — a run's answer for a page's pop-ups, set by the pages broker while that page's act window
 * stands. No pop-up gets a window of its own (measured: an adopted pop-up's window does not paint). `decide` answers
 * each pop-up at once, on the run's own state; what it refuses, its run counts. `open` hands an allowed pop-up's
 * address to the run, which opens it as a NEW pane of its own, later. A pane opened so has no `window.opener`.
 */
export interface BrowserAgentPopups {
  decide(url: string): "allow" | "deny";
  open(url: string): void;
}

/**
 * EY-1 (1g, 2026-11-19) — the page an agent works through, as the control binding hands it to the pages broker. The
 * person's hold is the producer's (any attachment holding the page); `onHeld` tells each edge once and returns its own
 * stop. 1g's members, and 1f's pop-ups; the act point and the lift add theirs when they land.
 */
export interface BrowserAgentPage {
  readonly held: boolean;
  onHeld(listener: (held: boolean) => void): () => void;
  /** EY-1 (1f): the run's pop-up policy while its act window stands; null clears it. A page without it hands off no
   * pop-up (today's answer). */
  popups?(policy: BrowserAgentPopups | null): void;
}

/** EY-1 (1e, 2026-11-19) — what the pages broker reads of a browser page by its surface, bound
 * or not: `parked` when its producer is at rest (the desk's cap hibernated it: no window, so no
 * binding and no BrowserAgentPage), and its address and title (at rest, the address it keeps). */
export interface BrowserAgentPageState {
  readonly parked: boolean;
  readonly url: string;
  readonly title: string;
  /** EY-1 (7b, 2026-11-19): its logical size and density now, which a tab or pop-up it opens
   * takes */
  readonly logicalViewport: { readonly width: number; readonly height: number };
  readonly deviceScaleFactor: number;
}

export interface BrowserControlTargetBinding {
  readonly surfaceId: string;
  readonly producerEpoch: number;
  readonly controlBindingRevision: number;
  readonly webContentsId: number;
  readonly targetId: string;
  readonly contents: BrowserControlTargetWebContents;
  /** EY-1 (1g): the page this binding's producer hands — dead once the binding is revoked: never held, no edge, its
   * listeners let go. */
  readonly page: BrowserAgentPage;
}

export interface BrowserControlTargetStatus {
  readonly surfaceId: string;
  readonly controlBindingRevision: number;
  readonly bound: boolean;
  readonly producerEpoch?: number;
  readonly webContentsId?: number;
}

interface BrowserControlTargetEntry {
  revision: number;
  binding: BrowserControlTargetBinding | null;
  destroyedListener: (() => void) | null;
  /** EY-1 (1g): kills the binding's page when the binding goes. */
  revokePage: (() => void) | null;
  /** EY-1 (C6, 2026-11-24): when the surface's binding was last asked for (`lookupPrivate`), or null: never */
  askedAt: number | null;
}

export interface BrowserControlTargetRegistryOptions {
  /** Electron's `webContents.fromDevToolsTargetId`, injected for unit tests. */
  readonly resolveTarget: (targetId: string) => BrowserControlTargetWebContents | undefined;
  /** EY-1 (C6): the clock `askedAt` is read on (unix ms); absent: `Date.now` */
  readonly now?: () => number;
}

function incrementRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("browser control binding revision exhausted its safe integer range");
  }
  return value + 1;
}

function validTargetId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 512 &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  );
}

/** EY-1 (1g, 2026-11-19) — the producer's page as one binding hands it: alive while the binding stands, then dead —
 * never held, no edge, every listener it took let go — so a broker holding an old binding hears nothing of the page.
 * EY-1 (1f): its pop-up policy passes while it stands; a dead binding's is not taken, and the revoke itself CLEARS the
 * policy this binding set, so a broker's policy never outlives its binding. (A page's next binding is made only after
 * the old one is revoked, so the clear never takes a newer binding's.) */
function revocablePage(page: BrowserAgentPage): {
  readonly page: BrowserAgentPage;
  revoke(): void;
} {
  let live = true;
  let setPopups = false;
  const stops = new Set<() => void>();
  return {
    page: {
      get held() {
        return live && page.held;
      },
      onHeld(listener) {
        if (!live) return () => undefined;
        const stop = page.onHeld(listener);
        stops.add(stop);
        return () => {
          if (stops.delete(stop)) stop();
        };
      },
      popups(policy) {
        if (!live) return;
        setPopups = policy !== null;
        page.popups?.(policy);
      },
    },
    revoke() {
      live = false;
      for (const stop of [...stops]) stop();
      stops.clear();
      if (setPopups) {
        setPopups = false;
        page.popups?.(null);
      }
    },
  };
}

/** Main-process broker seam between a Browser pixel source and a future control broker. */
export class BrowserControlTargetRegistry {
  readonly #entries = new Map<string, BrowserControlTargetEntry>();

  constructor(readonly options: BrowserControlTargetRegistryOptions) {}

  associate(
    surfaceId: string,
    producerEpoch: number,
    contents: BrowserControlTargetWebContents,
    page: BrowserAgentPage,
  ): BrowserControlTargetBinding {
    if (!Number.isSafeInteger(producerEpoch) || producerEpoch <= 0) {
      throw new RangeError("browser control binding requires a positive producer epoch");
    }
    if (!Number.isSafeInteger(contents.id) || contents.id <= 0 || contents.isDestroyed()) {
      throw new Error("browser control binding requires live WebContents");
    }
    const targetId = contents.getOrCreateDevToolsTargetId();
    if (!validTargetId(targetId) || this.options.resolveTarget(targetId) !== contents) {
      throw new Error("Electron did not reverse-resolve the exact Browser control target");
    }

    const existing = this.#entries.get(surfaceId);
    if (
      existing?.binding !== null &&
      existing?.binding !== undefined &&
      existing.binding.producerEpoch === producerEpoch &&
      existing.binding.contents === contents &&
      existing.binding.targetId === targetId
    ) {
      return existing.binding;
    }
    if (existing?.binding !== null && existing?.binding !== undefined) {
      this.revokeBinding(existing, existing.binding.contents);
    }
    const entry = existing ?? {
      revision: 0,
      binding: null,
      destroyedListener: null,
      revokePage: null,
      askedAt: null,
    };
    entry.revision = incrementRevision(entry.revision);
    const agentPage = revocablePage(page);
    const binding: BrowserControlTargetBinding = {
      surfaceId,
      producerEpoch,
      controlBindingRevision: entry.revision,
      webContentsId: contents.id,
      targetId,
      contents,
      page: agentPage.page,
    };
    const destroyedListener = () => {
      const current = this.#entries.get(surfaceId);
      if (current?.binding === binding) this.revokeBinding(current, contents);
    };
    entry.binding = binding;
    entry.destroyedListener = destroyedListener;
    entry.revokePage = agentPage.revoke;
    this.#entries.set(surfaceId, entry);
    contents.once("destroyed", destroyedListener);
    return binding;
  }

  /**
   * Returns control material only while Electron still resolves the exact same
   * target object. A failed reverse lookup revokes the stale association.
   *
   * EY-1 (C6, 2026-11-24): and the asking is kept (`askedAt`). This is the pages plane's one door to a page: an agent's
   * call on a page, its window's pin and its grant each begin here, so the last asking is the last time a run used the
   * page, whatever the answer was. `status` reads the same binding and is no use of it.
   */
  lookupPrivate(surfaceId: string): BrowserControlTargetBinding | null {
    const entry = this.#entries.get(surfaceId);
    if (entry !== undefined) entry.askedAt = (this.options.now ?? Date.now)();
    return this.#current(surfaceId);
  }

  /** EY-1 (C6): when the surface's binding was last asked for through `lookupPrivate` (unix ms); null for a surface
   * never bound, or never asked for since its first binding. Kept across the page's own rebinds. */
  askedAt(surfaceId: string): number | null {
    return this.#entries.get(surfaceId)?.askedAt ?? null;
  }

  /** The surface's binding while Electron still resolves its exact target; a stale one is revoked. */
  #current(surfaceId: string): BrowserControlTargetBinding | null {
    const entry = this.#entries.get(surfaceId);
    const binding = entry?.binding;
    if (entry === undefined || binding === null || binding === undefined) return null;
    if (
      binding.contents.isDestroyed() ||
      this.options.resolveTarget(binding.targetId) !== binding.contents
    ) {
      this.revokeBinding(entry, binding.contents);
      return null;
    }
    return binding;
  }

  status(surfaceId: string): BrowserControlTargetStatus {
    const binding = this.#current(surfaceId);
    const entry = this.#entries.get(surfaceId);
    if (binding === null) {
      return {
        surfaceId,
        controlBindingRevision: entry?.revision ?? 0,
        bound: false,
      };
    }
    return {
      surfaceId,
      controlBindingRevision: binding.controlBindingRevision,
      bound: true,
      producerEpoch: binding.producerEpoch,
      webContentsId: binding.webContentsId,
    };
  }

  revoke(surfaceId: string, expectedContents?: BrowserControlTargetWebContents): boolean {
    const entry = this.#entries.get(surfaceId);
    if (entry?.binding === null || entry?.binding === undefined) return false;
    if (expectedContents !== undefined && entry.binding.contents !== expectedContents) return false;
    this.revokeBinding(entry, entry.binding.contents);
    return true;
  }

  clear(): void {
    for (const entry of this.#entries.values()) {
      if (entry.binding !== null) this.revokeBinding(entry, entry.binding.contents);
    }
    this.#entries.clear();
  }

  private revokeBinding(
    entry: BrowserControlTargetEntry,
    expectedContents: BrowserControlTargetWebContents,
  ): void {
    if (entry.binding?.contents !== expectedContents) return;
    const listener = entry.destroyedListener;
    const revokePage = entry.revokePage;
    entry.binding = null;
    entry.destroyedListener = null;
    entry.revokePage = null;
    entry.revision = incrementRevision(entry.revision);
    if (listener !== null) expectedContents.off("destroyed", listener);
    revokePage?.();
  }
}
