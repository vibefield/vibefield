import { randomBytes } from "node:crypto";
import type { PreparedRegistryInstall } from "./plugin-install";

// MK-O2 (2026-11-12): the downloads waiting on an install card (DESIGN.md §8 "Every install asks
// first"). Install's press downloads, verifies and stages a plugin this desktop does not have
// (`plugins.install.prepare`); the card shows the row read from it; the card's Install commits it,
// its Cancel throws it away. Between the two the prepared candidate is held here, in fieldd's
// memory alone: one per plugin, each for fifteen minutes. A restart forgets every one, and its
// slot stays on disk unselected, where a later install of the same artifact meets the installer's
// own checks. A handle is not a secret: a caller that may use these doors may install directly.

/** How long a download waits for its card's Install before it is thrown away. A constant, never
 * a config field. */
export const INSTALL_CARD_TTL_MS = 15 * 60_000;

interface Held {
  readonly prepared: PreparedRegistryInstall;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class InstallCards {
  private readonly byHandle = new Map<string, Held>();
  private readonly handleByPlugin = new Map<string, string>();

  /** `discard` throws a candidate's download away (the installer's own). */
  constructor(private readonly discard: (prepared: PreparedRegistryInstall) => Promise<boolean>) {}

  /** Holds a prepared candidate and answers its handle. A card already waiting for the same
   * plugin is dropped first, and its download thrown away unless the new one stands in the same
   * slot. */
  async hold(prepared: PreparedRegistryInstall): Promise<string> {
    const earlier = this.handleByPlugin.get(prepared.id);
    if (earlier !== undefined) {
      const dropped = this.take(earlier);
      if (dropped !== undefined && dropped.artifact.slot !== prepared.artifact.slot)
        await this.discard(dropped).catch(() => false);
    }
    const handle = randomBytes(16).toString("hex");
    const timer = setTimeout(() => {
      void this.expire(handle);
    }, INSTALL_CARD_TTL_MS);
    timer.unref?.();
    this.byHandle.set(handle, { prepared, timer });
    this.handleByPlugin.set(prepared.id, handle);
    return handle;
  }

  /** The candidate a handle holds, left waiting: the doors name their audit target by it before
   * they take it. */
  peek(handle: string): PreparedRegistryInstall | undefined {
    return this.byHandle.get(handle)?.prepared;
  }

  /** The candidate a handle holds, taken out: a second take of the same handle answers
   * undefined. */
  take(handle: string): PreparedRegistryInstall | undefined {
    const held = this.byHandle.get(handle);
    if (held === undefined) return undefined;
    clearTimeout(held.timer);
    this.byHandle.delete(handle);
    const id = held.prepared.id;
    if (this.handleByPlugin.get(id) === handle) this.handleByPlugin.delete(id);
    return held.prepared;
  }

  private async expire(handle: string): Promise<void> {
    const prepared = this.take(handle);
    if (prepared !== undefined) await this.discard(prepared).catch(() => false);
  }
}
