// EY-1 (1f, 2026-11-19) — A RUN'S PANE LEAVES THE DESK: the ONE path that takes a pane an agent's run made off the person's
// document (DESIGN.md §8, 1f), for each of its causes: its page never reached this window (main let it go first), or main
// closed the page it showed (the run's end, or the run's own close; desk-live asks main once and acts on its refusal alone,
// never on a loss). It removes plainly. Item 550b (2026-11-24): the run's-end call waits out the pane's at-work leaving
// (`madePaneLeaving`, over `whenAtWorkLeft`); a page that never arrived has no presence row, so it leaves at once.
// A run's pane after its run (2026-11-24): a third cause comes by the run's-end call too. The pane's run ended while no
// face of it was open (the app was stopped, its desk was under a cover), and that is learned at the next mount's first
// mint, for a pane this device placed (desk-live's `runPanes`). No agent is at work on it then, so it leaves at once.
// Not the person's undo (the person did not do it) and not an agent's act (no intent stands behind it).

import {
  type CanvasEngine,
  type Entity,
  guardedTransaction,
  heldEntity,
  makeDefaultMayDiverge,
} from "@vibecook/ice";
import { getRendererLogger } from "../../../logging";
import { type AtWorkStore, atWorkStore, whenAtWorkLeft } from "../at-work/at-work-store";

/** Why a run's pane leaves: its page never reached this window, or its run's page was closed. */
export type MadePaneWhy = "never-reached" | "run-ended";

/** The remover for one engine: true when the pane was taken off the open document. */
export function madePaneRemover(
  engine: CanvasEngine,
): (entity: Entity, why: MadePaneWhy) => boolean {
  return (entity, why) => {
    const session = engine.docs.current();
    if (session === undefined || session.readOnly || !engine.world.isAlive(entity)) return false;
    guardedTransaction(session.store, engine.world, (tx) => tx.destroy(entity), {
      undoable: false,
    });
    engine.world.sync();
    getRendererLogger().info("renderer.desk.made_pane_left", "a run's pane left the desk", { why });
    return true;
  };
}

/** Item 550b (2026-11-24): a run's pane leaving the desk, by its durable key, for one mounted desk. */
export interface MadePaneLeaving {
  /** The pane `key` leaves: at once when its page never reached this window; on its at-work leaving when its run's
   * page was closed (DESIGN.md §8 "At work on the mat": `whenAtWorkLeft`). */
  leave(key: string, why: MadePaneWhy): void;
  /** The mount goes: no pane still waiting on its leaving is taken off by this mount. */
  dispose(): void;
}

/** The leaver for one engine's mount, over the window's at-work store. A run-ended pane waits on its key (`then` reads
 * the entity again, so a pane the person deleted meanwhile, or a board that changed, is nothing to take off); one wait
 * per key; a disposed mount cancels each wait and takes nothing off after it: the next mount's pane shows the closed
 * still, as one seen after a reload does (DESIGN.md §8, 1f). The wait's cap (`OBJECT_ROOM.RELEASED_SHOWN_MS`, 4 s) runs
 * from this call, which comes after the run's end by main's close and desk-live's one probe.
 *
 * 2026-11-24: never from under the person's hand. The hand is read again when the wait ends, as the applier and the
 * at-work reflector read it (`handOn`: the held entity, or one ICE may let diverge, a pane taken into its live mode): a
 * pane picked up during its leaving is not taken off, and stays, wearing desk-live's closed still (the 1f text: "never
 * from under the person's hand"; a pane held at the run's end, ‹for James›). A page that never arrived is asked only
 * where desk-live has read the hand itself, at once or at its put-down. */
export function madePaneLeaving(
  engine: CanvasEngine,
  store: AtWorkStore = atWorkStore,
  handOn?: (e: Entity) => boolean,
): MadePaneLeaving {
  const remove = madePaneRemover(engine);
  const mayDiverge = makeDefaultMayDiverge(engine.world);
  const inHand = handOn ?? ((e: Entity) => heldEntity(engine.world) === e || mayDiverge(e));
  const entityOf = (key: string): Entity | undefined => {
    const e = engine.docs.current()?.store.resolve(key as never) as Entity | undefined;
    return e !== undefined && engine.world.isAlive(e) ? e : undefined;
  };
  const waiting = new Map<string, () => void>();
  let disposed = false;
  const now = (key: string, why: MadePaneWhy): void => {
    const e = entityOf(key);
    if (e !== undefined) remove(e, why);
  };
  const settled = (key: string, why: MadePaneWhy): void => {
    const e = entityOf(key);
    if (e === undefined) return;
    if (inHand(e)) {
      getRendererLogger().info("renderer.desk.made_pane_kept", "a run's pane in the hand stays", {
        why,
      });
      return;
    }
    remove(e, why);
  };
  return {
    leave(key, why) {
      if (disposed) return;
      if (why === "never-reached") {
        waiting.get(key)?.();
        waiting.delete(key);
        now(key, why);
        return;
      }
      if (waiting.has(key)) return;
      const cancel = whenAtWorkLeft(
        key,
        () => {
          waiting.delete(key);
          if (!disposed) settled(key, why);
        },
        store,
      );
      waiting.set(key, cancel);
    },
    dispose() {
      disposed = true;
      for (const cancel of waiting.values()) cancel();
      waiting.clear();
    },
  };
}
