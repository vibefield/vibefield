/**
 * Cursor-halo overlay — the app reflector that draws halo entities (post-
 * notify, output-only; never writes ECS). The halo IS the cursor: widgetlab
 * takes design-003 §7's app opt-in (2026-07-18, James: "please also hide
 * mouse cursor" — pointerlab parity) and blanket-hides the OS cursor inside
 * the canvas (`.wl-no-cursor`, stylesheet `!important`, so it also beats the
 * L4 cursor reflector's inline writes — those become inert here). Because no
 * native pointer remains:
 *  - the DOT state doubles as the precision cursor over resize handles
 *    (previously the halo stepped aside for the OS resize arrows);
 *  - text fields lose the hover I-beam (caret still shows once focused) —
 *    the accepted trade of the opt-in; carve-outs can restore per-widget.
 * Ring states are BARE rings — pointerlab parity (James, 2026-07-18: a
 * center-point hotspot read as a stray "inner circle", especially in dark
 * mode where its white outline dominates; removed same day it was added).
 *
 * DOM-only presentation state (visibility on container enter/leave) lives
 * here as event listeners toggling a class — presentation truth about the OS
 * cursor's whereabouts, not interaction state, so it never touches the world.
 */
import {
  defineQuery,
  type Entity,
  Follows,
  HandleSpec,
  OverInteractive,
  PointerButtons,
  type ReflectorDef,
  Targets,
  type World,
} from "@vibecook/ice";
import { Cur, HALO_RADIUS_PX } from "./components";

// Ring styling = the OS-cursor trick (white stroke + dark OUTER rim) so it
// reads on dark cards and light canvas alike — no theme variant.
// Field-verified 2026-07-18: a theme-gray ring vanished over the dark clock
// card in light mode. OUTER rim only (James, same day: "can you not show the
// inner circle?") — an inset rim drew a second concentric circle on light
// backgrounds where the white stroke blends away; one rim keeps the ring a
// single clean circle. The rim rides box-shadow, so it scales with the morph.
const CSS = `
.wl-no-cursor,.wl-no-cursor *{cursor:none !important;}
.wl-halo-layer{position:absolute;inset:0;pointer-events:none;z-index:30;}
.wl-halo{position:absolute;top:0;left:0;width:${2 * HALO_RADIUS_PX}px;height:${2 * HALO_RADIUS_PX}px;border-radius:50%;
  border:2px solid rgba(255,255,255,0.92);background-color:transparent;
  box-shadow:0 0 0 1.25px rgba(0,0,0,0.32);
  transition:opacity 140ms ease,border-color 140ms ease,background-color 140ms ease,box-shadow 140ms ease;
  will-change:transform;}
.wl-halo.is-dot{border-color:transparent;background-color:#4A90D9;box-shadow:none;}
.wl-halo.is-pressed{border-width:3px;}
.wl-halo-layer.is-away .wl-halo{opacity:0;}
`;

const curQ = defineQuery([Cur]);

export interface HaloOverlay {
  readonly reflector: ReflectorDef;
  dispose(): void;
}

export function createHaloOverlay(container: HTMLElement): HaloOverlay {
  const doc = container.ownerDocument;
  const style = doc.createElement("style");
  style.textContent = CSS;
  doc.head.appendChild(style);

  const layer = doc.createElement("div");
  layer.className = "wl-halo-layer is-away"; // hidden until the pointer proves itself present
  container.appendChild(layer);
  container.classList.add("wl-no-cursor"); // the halo IS the cursor inside the canvas

  const show = (): void => layer.classList.remove("is-away");
  const hide = (): void => layer.classList.add("is-away");
  // pointermove doubles as "enter": a mount UNDER an already-inside cursor
  // gets no pointerenter until a leave/re-enter cycle.
  container.addEventListener("pointerenter", show);
  container.addEventListener("pointermove", show);
  container.addEventListener("pointerleave", hide);

  const nodes = new Map<Entity, HTMLDivElement>();

  const flush = (w: World): void => {
    const seen = new Set<Entity>();
    w.query(curQ).each((b) => {
      for (const r of b) {
        const e = b.entity(r);
        seen.add(e);
        let node = nodes.get(e);
        if (!node) {
          node = doc.createElement("div");
          node.className = "wl-halo";
          layer.appendChild(node);
          nodes.set(e, node);
        }
        const cur = w.read(e, Cur);
        node.style.transform = `translate3d(${cur.x}px,${cur.y}px,0) translate(-50%,-50%) scale(${cur.scale})`;
        const target = w.getRelation(e, Follows);
        const hover = target !== undefined ? w.getRelation(target, Targets) : undefined;
        const overHandle = hover !== undefined && w.has(hover, HandleSpec);
        // Handles share the DOT state: with the OS cursor hidden there are no
        // native resize arrows to defer to — the dot is the precision cursor.
        const dot = (target !== undefined && w.hasTag(target, OverInteractive)) || overHandle;
        const pressed =
          target !== undefined &&
          w.has(target, PointerButtons) &&
          w.read(target, PointerButtons).buttons !== 0;
        node.classList.toggle("is-dot", dot);
        node.classList.toggle("is-pressed", pressed && !dot);
      }
    });
    for (const [e, node] of nodes) {
      if (!seen.has(e)) {
        node.remove();
        nodes.delete(e);
      }
    }
  };

  return {
    reflector: { name: "wlHaloOverlay", always: true, flush },
    dispose() {
      container.classList.remove("wl-no-cursor");
      container.removeEventListener("pointerenter", show);
      container.removeEventListener("pointermove", show);
      container.removeEventListener("pointerleave", hide);
      for (const node of nodes.values()) node.remove();
      nodes.clear();
      layer.remove();
      style.remove();
    },
  };
}
