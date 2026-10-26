import type { MonitorReplicaLike } from "@vibefield/puppeteer-view-sdk/host";
import type {
  AgentView,
  ModelChanges,
  MonitorModel,
  MonitorSpawnMenu,
} from "@vibefield/puppeteer-view-sdk/model";

/**
 * THE MODEL A VIEW DRAWS IN THIS WINDOW (MV-4, MV-8).
 *
 * Every view reads its input alone (MV-D17). This window's rows
 * (`window-rows.ts`) carry its membership, order and standing:
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
 * This replica publishes those rows as a model. A row nothing patched is the
 * source replica's object, a patched one keeps its identity while its facts
 * stand, and the model keeps its identity while nothing in it moved (MV-D21).
 * Nothing here derives a business fact — membership, order and standing are
 * the window rows', which read the board.
 */

export interface WindowViewReplica extends MonitorReplicaLike {
  /**
   * The window's facts moved without the model moving (the chosen desktop, a
   * desktop's standing, the panes' order): the mounted view hears it when the
   * rows it would be handed differ.
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
  rowsFor: (model: MonitorModel) => readonly AgentView[],
): WindowViewReplica {
  const listeners = new Set<() => void>();
  let source: MonitorModel | undefined;
  let rows: readonly AgentView[] | undefined;
  let published: WindowViewSnapshot | undefined;

  const modelFor = (
    current: MonitorModel,
    agents: readonly AgentView[],
    previous: MonitorModel | undefined,
  ): MonitorModel => {
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
