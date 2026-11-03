/** A window's spatial handoffs, correlated before birth. Unrelated rows are
 * never held. Placement commits identity; releasing the predecessor is a
 * separate owner obligation and cannot undo that commit. */
export interface PaneBirth {
  creationId: string;
  finish(): void;
}

export class PaneTransitions {
  private listeners = new Set<() => void>();
  private births = new Map<string, string>();
  private aliases = new Map<string, string>();
  private retired = new Set<string>();
  private committed = new Set<string>();
  private seen = new Set<string>();
  private revision = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): number => this.revision;

  private publish(): void {
    this.aliases = new Map(this.aliases);
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  begin(previous: string): PaneBirth {
    const creationId = crypto.randomUUID();
    this.births.set(creationId, previous);
    return {
      creationId,
      finish: () => {
        if (this.births.delete(creationId)) this.publish();
      },
    };
  }

  reserve(previous: string, next: string): void {
    this.aliases.set(next, this.aliases.get(previous) ?? previous);
    this.publish();
  }

  commit(previous: string, next: string): void {
    this.aliases.set(next, this.aliases.get(previous) ?? previous);
    this.retired.add(previous);
    this.seen.add(previous);
    this.committed.add(next);
    this.publish();
  }

  rollback(_previous: string, next: string): void {
    if (this.committed.has(next)) return;
    this.aliases.set(next, next);
    this.publish();
  }

  visualIds(): ReadonlyMap<string, string> {
    return this.aliases;
  }

  visualId(sessionId: string, creationId?: string, inputUsed = false): string | undefined {
    // The owner kept a predecessor used from another device. The committed
    // successor keeps its body; the retained shell gets a distinct body.
    if (inputUsed && this.retired.has(sessionId)) return `retained:${sessionId}`;
    const previous = creationId === undefined ? undefined : this.births.get(creationId);
    return (
      this.aliases.get(sessionId) ??
      (previous === undefined ? undefined : (this.aliases.get(previous) ?? previous))
    );
  }

  shows(_rowId: string, sessionId: string = _rowId, inputUsed = false): boolean {
    return inputUsed || !this.retired.has(sessionId);
  }

  /** Called with the complete local model, including rows filtered from view.
   * Keep an unpublished birth until seen; reclaim retired identities once the
   * ordered model has withdrawn them. Active handoffs retain their source. */
  reconcile(present: ReadonlySet<string>): void {
    const sources = new Set(this.births.values());
    for (const id of [...this.aliases.keys(), ...this.retired]) {
      if (present.has(id)) {
        this.seen.add(id);
        continue;
      }
      if (!this.seen.has(id) || sources.has(id)) continue;
      this.aliases.delete(id);
      this.retired.delete(id);
      this.committed.delete(id);
      this.seen.delete(id);
    }
  }
}
