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
import { Cur, DOT_SCALE } from "./components";

// DK-2 (desk/landing, ICE 0.14.0): ICE's `/ground` entry — the magnet field and
// its pole sources — is GONE, and nothing consumes this adapter any more (the
// ground mount is the DK-3 stub). ICE 0.11's two pole types are kept here,
// verbatim, until the retire table's `cursor/` row (the halo, DK-17).

/** ICE 0.11.0's `Pole` (ICE's `/ground` entry), verbatim. */
export interface Pole {
  readonly x: number;
  readonly y: number;
  readonly strength: number;
  readonly space?: "world" | "screen";
}

/** ICE 0.11.0's `PoleSource` (ICE's `/ground` entry), verbatim. */
export interface PoleSource {
  read(world: World): readonly Pole[];
  subscribe(world: World, wake: () => void): () => void;
}

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
