// PORTED VERBATIM from ICE's worked third-party kind (`infinite-canvas-engine/examples/desk-clock/src/local.ts`, design-016 K8b) — re-wrapped by this repo's formatter,
// its imports moved to the SDK's `/desk` door — a VibeField plugin imports nothing of ICE but what the SDK re-exports (K-L1).

// The desk clock's state on ONE desk (`ObjectKind.local`) — THE REGISTERED WAKE (design-016 K7a, used as a plugin uses it). The
// hands move on the host's wall clock, never on a poll: each clock the builder records says what it shows (`saw` — its cadence,
// a second or a minute, and its time key); the desk asks `due` after every step and gets the wall clock's next boundary a drawn
// clock needs, on its own frame clock; at that step `tick` finds the key turned and says so — the kind is RESTLESS for one build,
// every drawn clock's record is remade (reading the new time), and the loop sleeps again. A desk at rest with a clock showing
// seconds takes a frame a second, without seconds a frame a minute, and with no clock drawn none at all: a clock culled, gone or
// pinned (a still's time) is not waited on. The builder remakes EVERY drawn clock at a restless build, so the set is rebuilt
// then — a clock that left the screen costs at most the one wake it was already owed.

import type { Entity, KindLocal } from "@vibefield/plugin-sdk/desk";
import { keyAt, nextMoveAt } from "./law";

/** A clock's hands as its last record drew them — the rigs' read-back (`handle.local("desk-clock").shown(e)`). */
export interface ClockShown {
  /** The time of day shown, seconds since the zone's midnight. */
  readonly tod: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly seconds: boolean;
  /** A still's time (the asset's `at`): drawn, never waited on. */
  readonly pinned: boolean;
}

export interface ClockLocal extends KindLocal {
  /** The wall clock this desk's clocks read, epoch ms (the host's; a test's). */
  now(): number;
  /** The builder recorded clock `e` showing time key `key` at cadence `step` (law.ts `keyAt`) — it is drawn, and waits for the next. */
  saw(e: Entity, step: number, key: number): void;
  /** Clock `e`'s hands as its last record drew them (a still's too), or undefined. */
  shown(e: Entity): ClockShown | undefined;
  /** …and set by the record. */
  show(e: Entity, shown: ClockShown): void;
  /** The clocks waited on now (drawn since the last move, not pinned) — a rig's witness. */
  waiting(): number;
  tick(now: number): boolean;
  due(now: number): number;
}

export function createClockLocal(clock: () => number = () => Date.now()): ClockLocal {
  /** The drawn clocks the desk waits on: each one's cadence and the key its record shows. Rebuilt at every restless build. */
  const drawn = new Map<Entity, { readonly step: number; readonly key: number }>();
  const shownOf = new Map<Entity, ClockShown>();
  return {
    now: clock,
    saw(e, step, key) {
      drawn.set(e, { step, key });
    },
    shown: (e) => shownOf.get(e),
    show(e, s) {
      shownOf.set(e, s);
    },
    waiting: () => drawn.size,
    tick() {
      if (drawn.size === 0) return false;
      const wall = clock();
      for (const { step, key } of drawn.values()) {
        if (keyAt(wall, step) !== key) {
          // a hand moves: every drawn clock's record is remade in this build (the kind is restless), each saying what it shows anew
          drawn.clear();
          return true;
        }
      }
      return false;
    },
    // docs:begin due
    due(now) {
      if (drawn.size === 0) return Number.POSITIVE_INFINITY;
      const wall = clock();
      let at = Number.POSITIVE_INFINITY;
      for (const { step, key } of drawn.values()) at = Math.min(at, nextMoveAt(key, step));
      return now + Math.max(0, at - wall);
    },
    // docs:end due
    forget(e) {
      drawn.delete(e);
      shownOf.delete(e);
    },
    dispose() {
      drawn.clear();
      shownOf.clear();
    },
  };
}
