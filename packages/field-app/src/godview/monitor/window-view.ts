import type { MonitorReplicaLike } from "@vibecook/puppeteer-view-sdk/host";
import type {
  AgentView,
  ModelChanges,
  MonitorModel,
  MonitorSpawnMenu,
} from "@vibecook/puppeteer-view-sdk/model";
import type { MonitorAgent as ViewsMonitorAgent } from "@vibecook/puppeteer-views";

/**
 * MV-4 — THE MODEL A PORTED VIEW DRAWS IN THIS WINDOW.
 *
 * List and rain are SDK views now: each reads its input alone (MV-D17), so the
 * legacy bridge's rows no longer reach them. What those rows carried beyond
 * the model is this WINDOW's (`window-rows.ts`), and a ported view must be
 * handed it the same way, or a person sees the difference:
 *
 *   · the chosen desktop's rows only (DS-3 — the chip narrows what the views
 *     are handed; the claims still count every row);
 *   · the ORDER the stage draws: this desktop's agents by birth, its panes'
 *     terminals in pane order, then other desktops' runs as their boards list
 *     them — the rain claims its columns in that order;
 *   · one row per visual identity (a launcher hand-off's managed row takes the
 *     shell's body while the shell's row is still here);
 *   · a PEER greyed by its desktop's standing (DS-L8), never by its owner's
 *     evidence clock, and under no Agent Profile of this device's.
 *
 * So this replica hands the view host the replica's model cut to exactly the
 * rows the bridge hands a legacy view (`rowsFor` is the bridge's own reader),
 * in the same order, as the model's own `AgentView`s: a row nothing patched is
 * the replica's object, a patched one is the same object while its patch
 * stands, and the model keeps its identity while nothing in it moved (MV-D21).
 * Nothing here derives a business fact — membership, order and standing are
 * the window rows', which read the board.
 */

export interface WindowViewReplica extends MonitorReplicaLike {
  /**
   * The window's facts moved without the model moving (the chosen desktop, a
   * desktop's standing, the panes' order): the mounted view hears it when the
   * rows it would be handed differ — the bridge's `refresh`, for a ported view.
   */
  refresh(): void;
}

interface WindowViewSnapshot {
  readonly model: MonitorModel;
  readonly changes: ModelChanges;
  readonly spawn?: MonitorSpawnMenu | undefined;
}

const NO_IDS: readonly string[] = Object.freeze([]);

function sameList<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/** What moved between two published models, by id: a row is updated when its object is new. */
function changesBetween(previous: MonitorModel | undefined, next: MonitorModel): ModelChanges {
  if (previous === undefined) {
    return Object.freeze({
      added: Object.freeze(next.agents.map((view) => view.id)),
      updated: NO_IDS,
      removed: NO_IDS,
    });
  }
  const added: string[] = [];
  const updated: string[] = [];
  for (const view of next.agents) {
    const was = previous.byId.get(view.id);
    if (was === undefined) added.push(view.id);
    else if (was !== view) updated.push(view.id);
  }
  const removed = previous.agents.filter((view) => !next.byId.has(view.id)).map((view) => view.id);
  return Object.freeze({
    added: added.length === 0 ? NO_IDS : Object.freeze(added),
    updated: updated.length === 0 ? NO_IDS : Object.freeze(updated),
    removed: removed.length === 0 ? NO_IDS : Object.freeze(removed),
  });
}

export function createWindowViewReplica(
  replica: MonitorReplicaLike,
  rowsFor: (model: MonitorModel) => readonly ViewsMonitorAgent[],
): WindowViewReplica {
  /** a peer's view as this window greys it, while its standing holds */
  const patched = new WeakMap<AgentView, { stale: boolean; view: AgentView }>();
  const listeners = new Set<() => void>();
  let source: MonitorModel | undefined;
  let rows: readonly ViewsMonitorAgent[] | undefined;
  let published: WindowViewSnapshot | undefined;

  /** A peer's row wears its desktop's standing (the window row's `stale`) and
   * no profile set of its owner's; every other row is the replica's own. */
  const viewOf = (view: AgentView, row: ViewsMonitorAgent): AgentView => {
    if (view.device.self) return view;
    const stale = row.stale === true;
    if (view.stale === stale && view.profileSet === undefined) return view;
    const held = patched.get(view);
    if (held !== undefined && held.stale === stale) return held.view;
    const { profileSet: _owners, ...rest } = view;
    const made: AgentView = Object.freeze({ ...rest, stale });
    patched.set(view, { stale, view: made });
    return made;
  };

  const modelFor = (
    current: MonitorModel,
    shown: readonly ViewsMonitorAgent[],
    previous: MonitorModel | undefined,
  ): MonitorModel => {
    const agents: AgentView[] = [];
    for (const row of shown) {
      const view = current.byId.get(row.id);
      if (view !== undefined) agents.push(viewOf(view, row));
    }
    if (sameList(agents, current.agents)) return current;
    if (previous !== undefined && sameList(agents, previous.agents)) return previous;
    return Object.freeze({
      revision: current.revision,
      agents: Object.freeze(agents),
      byId: new Map(agents.map((view) => [view.id, view] as const)),
    });
  };

  return {
    getSnapshot() {
      const snapshot = replica.getSnapshot();
      const shown = rowsFor(snapshot.model);
      if (
        published !== undefined &&
        snapshot.model === source &&
        rows !== undefined &&
        sameList(shown, rows) &&
        snapshot.spawn === published.spawn
      ) {
        return published;
      }
      const model = modelFor(snapshot.model, shown, published?.model);
      source = snapshot.model;
      rows = shown;
      if (
        published !== undefined &&
        model === published.model &&
        snapshot.spawn === published.spawn
      ) {
        return published;
      }
      published = Object.freeze({
        model,
        changes: changesBetween(published?.model, model),
        ...(snapshot.spawn !== undefined ? { spawn: snapshot.spawn } : {}),
      });
      return published;
    },
    subscribe(listener) {
      listeners.add(listener);
      const off = replica.subscribe(listener);
      return () => {
        off();
        listeners.delete(listener);
      };
    },
    refresh() {
      // nothing was handed out yet: the first read takes the facts as they are
      if (published === undefined) return;
      const snapshot = replica.getSnapshot();
      if (
        snapshot.model === source &&
        rows !== undefined &&
        sameList(rowsFor(snapshot.model), rows)
      )
        return;
      for (const listener of [...listeners]) listener();
    },
  };
}
