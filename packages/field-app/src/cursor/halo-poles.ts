/**
 * Halo → magnet-pole adapter (ICE design-010 §7 — this file is the wiring
 * that design's §7 documents; the widgetlab twin is the reference build).
 * The magnet grid never learns what a halo is: this adapter reads OUR cursor
 * vocabulary and hands the ground pass plain screen-space poles.
 *
 * Why the halo beats the raw pointer as the field driver:
 *  - `Cur` eases toward the pointer (FOLLOW_TAU), so the field trails with
 *    the same spring the visible cursor has — needle and halo move as one.
 *  - the morph scale already telegraphs ownership; the field inheriting it
 *    (full on free canvas → quiet over a card → ~zero at the DOT stop)
 *    REINFORCES the handoff instead of fighting it.
 *  - `easeSettle` stops writing once settled and the systems runIf-gate
 *    (design-010 §10.7), so hover redraws self-terminate — an idle canvas
 *    stays at zero ground frames with the field wired.
 *
 * ICE 0.11 selects the magnet pass at build time, so this source is always
 * subscribed while the ground is mounted. The Cur systems stop stamping once
 * settled, preserving the measured zero-frame idle behavior.
 */
import { defineQuery, type World } from "@vibecook/ice";
import type { Pole, PoleSource } from "@vibecook/ice/ground";
import { Cur, DOT_SCALE } from "./components";

const curQ = defineQuery([Cur]);

/** Morph scale → strength: 1 on free canvas, 0 at (and below) the DOT stop. */
function strengthFromScale(scale: number): number {
  return Math.min(Math.max((scale - DOT_SCALE) / (1 - DOT_SCALE), 0), 1);
}

export function haloPoles(): PoleSource {
  return {
    read(world: World) {
      const out: Pole[] = [];
      world.query(curQ).each((b) => {
        for (const r of b) {
          const c = world.read(b.entity(r), Cur);
          const strength = strengthFromScale(c.scale);
          if (strength <= 0) continue;
          out.push({ x: c.x, y: c.y, strength, space: "screen" });
        }
      });
      return out;
    },
    subscribe(world, wake) {
      return world.reactive.observeQuery(curQ, wake, { cols: [Cur] });
    },
  };
}
