/**
 * Cursor-halo tick systems — pointerlab's cursorSpawn/follower/localVisual/
 * cursorReap, ported to widgetlab's three-stop morph (see components.ts).
 * House rules kept: whole-frame walks are `defineTickSystem` with `ctx.query`
 * inner walks; every write is change-only (easeSettle returns null settled).
 *
 * Scope resolution (the morph goal), priority order:
 *   1. pointer `OverInteractive` (the L0 hover fact — DOM interactives, GL
 *      claim-capable meshes, live island captures)      → DOT_SCALE
 *   2. `Targets` a resize handle (HandleSpec)           → DOT_SCALE (the
 *      overlay styles it as the dot too — with the OS cursor hidden the
 *      dot is the precision cursor over handles)
 *   3. `Targets` a widget (Position + Size)             → MID_SCALE
 *   4. free canvas / no pointer                         → 1
 * Mouse only: touch gets no halo (there is no cursor to augment).
 */
import {
  defineQuery,
  defineTickSystem,
  Follows,
  FrameInfo,
  HandleSpec,
  LocalPointer,
  OverInteractive,
  Pointer,
  PointerScreen,
  Position,
  Size,
  Targets,
} from "@vibecook/ice";
import { Cur, DOT_SCALE, easeSettle, FOLLOW_TAU, MID_SCALE, MORPH_TAU } from "./components";

const localPointerQ = defineQuery([Pointer, PointerScreen, LocalPointer]);
const curQ = defineQuery([Cur]);

export function createHaloSystems() {
  /** react — spawn a halo for any local MOUSE pointer that has none yet. */
  const haloSpawn = defineTickSystem(
    (ctx) => {
      ctx.query(localPointerQ).each((b) => {
        for (const r of b) {
          const p = b.entity(r);
          if (ctx.read(p, Pointer).device !== "mouse") continue;
          if (ctx.getReverse(p, Follows).length > 0) continue;
          const at = ctx.read(p, PointerScreen);
          const c = ctx.spawn({ components: [[Cur, { x: at.x, y: at.y, scale: 0 }]] });
          ctx.setRelation(c, Follows, p);
        }
      });
    },
    { name: "wlHaloSpawn" },
  );

  /** simulate — ease Cur toward the followed pointer's screen position. */
  const haloFollower = defineTickSystem(
    (ctx) => {
      const dt = ctx.getResource(FrameInfo)?.dt ?? 16;
      ctx.query(curQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          const target = ctx.getRelation(e, Follows);
          if (target === undefined || !ctx.has(target, PointerScreen)) continue; // reap handles
          const goal = ctx.read(target, PointerScreen);
          const cur = ctx.read(e, Cur);
          const nx = easeSettle(cur.x, goal.x, dt, FOLLOW_TAU);
          const ny = easeSettle(cur.y, goal.y, dt, FOLLOW_TAU);
          if (nx === null && ny === null) continue;
          ctx.edit(e).set(Cur, { ...cur, x: nx ?? cur.x, y: ny ?? cur.y });
        }
      });
    },
    { name: "wlHaloFollower", access: { write: [Cur], orderIndependent: [Cur] } },
  );

  /** simulate — the three-stop morph. `Targets` is disc-picked with a release
   *  dead-band (l1-pick), and `OverInteractive` is change-only, so the goal is
   *  already debounced — no flicker guard needed here. */
  const haloVisual = defineTickSystem(
    (ctx) => {
      const dt = ctx.getResource(FrameInfo)?.dt ?? 16;
      ctx.query(curQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          const cur = ctx.read(e, Cur);
          const target = ctx.getRelation(e, Follows);
          let goal = 0; // pointer gone — shrink out (reap destroys under 0.02)
          if (target !== undefined) {
            if (ctx.hasTag(target, OverInteractive)) {
              goal = DOT_SCALE;
            } else {
              const hover = ctx.getRelation(target, Targets);
              const overHandle = hover !== undefined && ctx.has(hover, HandleSpec);
              const overWidget =
                hover !== undefined &&
                !overHandle &&
                ctx.has(hover, Position) &&
                ctx.has(hover, Size);
              goal = overHandle ? DOT_SCALE : overWidget ? MID_SCALE : 1;
            }
          }
          const ns = easeSettle(cur.scale, goal, dt, MORPH_TAU);
          if (ns !== null) ctx.edit(e).set(Cur, { ...cur, scale: ns });
        }
      });
    },
    { name: "wlHaloVisual", access: { write: [Cur], orderIndependent: [Cur] } },
  );

  /** cleanup — a halo whose pointer despawned shrinks to 0 and reaps itself. */
  const haloReap = defineTickSystem(
    (ctx) => {
      ctx.query(curQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          if (ctx.getRelation(e, Follows) !== undefined) continue; // edge auto-cleared on despawn
          if (ctx.read(e, Cur).scale < 0.02) ctx.destroy(e);
        }
      });
    },
    { name: "wlHaloReap" },
  );

  return { haloSpawn, haloFollower, haloVisual, haloReap };
}
