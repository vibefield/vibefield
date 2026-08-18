import type { RendererRuntimeTarget } from "@vibefield/plugin-runtime";
import type { RendererBehaviorBinding } from "./renderer-harness";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareBinding(left: BehaviorCatalogBinding, right: BehaviorCatalogBinding): number {
  const plugin = compareText(left.pluginId, right.pluginId);
  return plugin === 0 ? left.declarationIndex - right.declarationIndex : plugin;
}

/** One complete renderer candidate's code-bearing, still-inert catalog row. */
export interface BehaviorCatalogBinding extends RendererBehaviorBinding {
  /** Exact renderer candidate identity. An obsolete disposer cannot remove its replacement. */
  readonly candidateToken: object;
  /** Semantic renderer target that proved code + authority for this row. */
  readonly rendererTarget: RendererRuntimeTarget;
}

export type BehaviorCatalogListener = (snapshot: readonly BehaviorCatalogBinding[]) => void;

interface CommittedPluginBindings {
  readonly token: object;
  readonly bindings: readonly BehaviorCatalogBinding[];
}

/**
 * Window-scoped code catalog for PRC-4.
 *
 * Renderer candidates publish only after their complete declaration mirror seals. Publication
 * and withdrawal are synchronous, plugin-atomic, and identity-bound; document generations merely
 * project the latest immutable snapshot into their own ICE engine.
 */
export class BehaviorBindingCatalog {
  private readonly committedByPlugin = new Map<string, CommittedPluginBindings>();
  private readonly listeners = new Set<BehaviorCatalogListener>();
  private closed = false;

  snapshot(): readonly BehaviorCatalogBinding[] {
    return Object.freeze(
      [...this.committedByPlugin.values()].flatMap((entry) => entry.bindings).sort(compareBinding),
    );
  }

  /** Structural census for soak/teardown assertions. Code-bearing rows never escape this count. */
  state(): {
    readonly plugins: number;
    readonly bindings: number;
    readonly listeners: number;
    readonly closed: boolean;
  } {
    let bindings = 0;
    for (const entry of this.committedByPlugin.values()) bindings += entry.bindings.length;
    return Object.freeze({
      plugins: this.committedByPlugin.size,
      bindings,
      listeners: this.listeners.size,
      closed: this.closed,
    });
  }

  subscribe(listener: BehaviorCatalogListener): () => void {
    if (this.closed) throw new Error("behavior binding catalog is closed");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Controller-only publication edge. `token` is the exact candidate object identity. */
  publishCandidate(
    pluginId: string,
    token: object,
    target: RendererRuntimeTarget,
    bindings: ReadonlyMap<string, RendererBehaviorBinding>,
  ): void {
    if (this.closed) throw new Error("behavior binding catalog is closed");
    if (target.face !== "renderer" || target.pluginId !== pluginId) {
      throw new Error(`behavior candidate target does not belong to ${pluginId}`);
    }
    const ids = new Set<string>();
    const ranks = new Set<number>();
    const rows = [...bindings.values()].map((binding) => {
      if (binding.pluginId !== pluginId || !binding.id.startsWith(`${pluginId}:`)) {
        throw new Error(`behavior ${binding.id} does not belong to ${pluginId}`);
      }
      if (ids.has(binding.id)) throw new Error(`duplicate behavior binding ${binding.id}`);
      if (ranks.has(binding.declarationIndex)) {
        throw new Error(
          `duplicate behavior declaration index ${binding.declarationIndex} for ${pluginId}`,
        );
      }
      ids.add(binding.id);
      ranks.add(binding.declarationIndex);
      return Object.freeze({
        ...binding,
        candidateToken: token,
        rendererTarget: target,
      });
    });
    if (rows.length === 0) {
      this.withdrawCandidate(pluginId, token);
      return;
    }
    rows.sort(compareBinding);
    this.committedByPlugin.set(pluginId, {
      token,
      bindings: Object.freeze(rows),
    });
    this.emit();
  }

  /** Exact inverse: an old candidate cannot broadly delete a newer publication. */
  withdrawCandidate(pluginId: string, token: object): void {
    const current = this.committedByPlugin.get(pluginId);
    if (current?.token !== token) return;
    this.committedByPlugin.delete(pluginId);
    this.emit();
  }

  /** Window close is a final synchronous fence, including against orphaned controller rows. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.committedByPlugin.size > 0) {
      this.committedByPlugin.clear();
      this.emit();
    }
    this.listeners.clear();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) listener(snapshot);
  }
}
