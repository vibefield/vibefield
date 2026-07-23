/**
 * The bottom toolbar ↔ widget tray (2026-07-19, rev 2 — James: the temp/
 * "Design Bottom Toolbar Features" reference: "do its bottom toolbar and how
 * it expand into the widget tray").
 *
 * ONE morphing element (the reference's dynamic-island move): a 420×64 pill
 * — tool switcher, Clean Up, a morphing ⊕ — that expands into a 60vh sheet
 * (pull bar, category pills, iOS-cell widget grid) with a single
 * `600ms cubic-bezier(0.25,1,0.3,1)` transition over width/height/bottom/
 * radius; the ⊕ rotates 135° into a ✕. A backdrop dims the canvas while
 * open (the field scales its canvas wrapper to 0.98 — the reference's recede).
 *
 * DEFERRED SPAWN (rev 2, the GL-layer workaround): pressing a tile drags a
 * pure-DOM PROXY of the tile (body-level, above every canvas plane — GL
 * included, by construction). The real widget does not exist yet. The moment
 * the proxy leaves the sheet: `ops.insertByDrag` spawns the ghost under the
 * pointer (`home` aimed at the toolbar for cancel fly-backs), the sheet
 * recedes, the proxy zooms-in-and-vanishes while the widget host pops out
 * 0.3→1 (WAAPI on the mounted host — "like the item just spawned it"), and
 * the tray tile pops back into its slot. Release INSIDE the sheet = the
 * proxy glides home; nothing was ever spawned. Release over the TOOLBAR
 * mid-insert = cancel (the put-back; CancelRequest outruns the queued up).
 *
 * This component lives OUTSIDE the canvas container (a field-wrap sibling of
 * InfiniteCanvas): its events never reach the pointer adapter, so no opt-out
 * attributes and no plane-sandwich z games are needed anymore.
 *
 * VibeField port (Track D2, P-3): the catalog comes from the PluginRegistry —
 * labels/categories/preview silhouettes are manifest data (tray-catalog.ts);
 * widgetlab's module-global `widgetRegistry.all()` and its hardcoded
 * LABELS/categoryOf are gone. The proxy machine and the morph are verbatim.
 */
import {
  ActiveTool,
  Camera,
  type CanvasEngine,
  defineQuery,
  type Entity,
  GhostRetiring,
  InsertGhost,
  type WidgetType,
} from "@vibecook/ice";
import { useStageHold, WidgetPreview } from "@vibecook/ice/react";
import type { PluginRegistry } from "@vibefield/plugin-runtime";
import { CARD_BG, CARD_RADIUS } from "@vibefield/shell-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePluginRegistrySnapshot } from "../plugin-host/plugin-registry-store";
import { buildCatalog, CATEGORIES, type CatalogEntry } from "./tray-catalog";
import { useReactiveResource } from "./use-reactive";

const ghostQ = defineQuery([InsertGhost]);

const EASE = "cubic-bezier(0.25, 1, 0.3, 1)"; // the reference's island ease
const MORPH_MS = 600;

// --- catalog presentation -------------------------------------------------

// iOS-style grid cells (reference: fixed cells, centered, span by size).
const CELL = 132;
const GAP = 18;
const LABEL_H = 24;

function spanOf(def: WidgetType): { cols: number; rows: number } {
  return { cols: def.defaultSize.w >= 240 ? 2 : 1, rows: def.defaultSize.h >= 240 ? 2 : 1 };
}

function silhouetteIn(
  def: WidgetType,
  boxW: number,
  boxH: number,
): { w: number; h: number; r: number; s: number } {
  const s = Math.min((boxW - 8) / def.defaultSize.w, (boxH - LABEL_H - 6) / def.defaultSize.h);
  return { w: def.defaultSize.w * s, h: def.defaultSize.h * s, r: Math.max(6, CARD_RADIUS * s), s };
}

/**
 * The tile's face = the FRAMEWORK's answer (design-005 §2 preview contract,
 * 2026-07-19): `<WidgetPreview>` owns the whole fallback chain — the def's
 * declared preview (the GL cards declare baked snapshots), else the real
 * component in the framework sandbox (dom), else our silhouette. The last-rung
 * silhouette background is manifest data now (`preview`), not a code map.
 */
function TileFace({
  entry,
  sil,
}: {
  entry: CatalogEntry<WidgetType>;
  sil: { w: number; h: number; r: number; s: number };
}) {
  return (
    <WidgetPreview
      type={entry.type}
      width={sil.w}
      height={sil.h}
      fallback={
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: sil.r,
            background: entry.preview ?? CARD_BG,
            boxShadow: "inset 0 0 0 1px rgba(127,127,127,0.22)",
          }}
        />
      }
    />
  );
}

// --- the proxy drag machine (deferred spawn) --------------------------------

interface ProxyCallbacks {
  /**
   * The proxy left the sheet — spawn NOW at the proportional grab `anchor`;
   * returns the ghost + its on-screen width (visual px) so the proxy can
   * morph exactly onto it. false = abort (no engine).
   */
  onHandoff(
    e: PointerEvent,
    anchor: { u: number; v: number },
  ): { ghost: number; screenW: number } | false;
  onSettled(): void;
}

/**
 * Imperative on purpose (chrome-grade, no React churn at pointer rate): a
 * body-level clone of the tile silhouette follows the pointer; crossing out
 * of `panel` triggers the one-time handoff; releasing inside glides it back.
 */
function startTileDrag(
  down: PointerEvent,
  tileEl: HTMLElement,
  panel: HTMLElement,
  def: WidgetType,
  cb: ProxyCallbacks,
): void {
  const sil = tileEl.querySelector<HTMLElement>("[data-tray-sil]");
  if (sil === null) return;
  const silRect = sil.getBoundingClientRect();
  // THE GRAB POINT IS THE INVARIANT (2026-07-19 polish): the spot under the
  // finger at press stays the same spot of the face — proxy, morph, and the
  // spawned widget all anchor to it, so nothing ever snaps or re-anchors.
  const grabDx = down.clientX - silRect.left;
  const grabDy = down.clientY - silRect.top;
  const u = silRect.width > 0 ? Math.min(1, Math.max(0, grabDx / silRect.width)) : 0.5;
  const v = silRect.height > 0 ? Math.min(1, Math.max(0, grabDy / silRect.height)) : 0.5;
  const doc = tileEl.ownerDocument;
  let proxy: HTMLElement | null = null;
  let handed = false;

  const makeProxy = (): HTMLElement => {
    // A STATIC CLONE of the tile face (rev 3): you drag the widget's actual
    // preview — React-free, dead markup, cheap. Inline overrides re-anchor it
    // to the viewport; the clone keeps the face's own radius/shadows.
    const p = sil.cloneNode(true) as HTMLElement;
    p.removeAttribute("data-tray-sil");
    p.dataset["trayProxy"] = def.type;
    // cloneNode copies a <canvas> ELEMENT but never its BITMAP — a cloned
    // canvas is blank, so a GL tile's captured 3D content vanished from the
    // proxy (James, 2026-07-19). Blit each source canvas into its clone.
    const srcCanvases = sil.querySelectorAll("canvas");
    p.querySelectorAll("canvas").forEach((dst, i) => {
      const src = srcCanvases[i];
      if (src === undefined) return;
      dst.width = src.width;
      dst.height = src.height;
      try {
        dst.getContext("2d")?.drawImage(src, 0, 0);
      } catch {
        // a contextless clone keeps the chrome-only look — never throws the drag
      }
    });
    Object.assign(p.style, {
      position: "fixed",
      left: "0",
      top: "0",
      margin: "0",
      width: `${silRect.width}px`,
      height: `${silRect.height}px`,
      zIndex: "9999",
      pointerEvents: "none",
      willChange: "transform, opacity",
      filter: "drop-shadow(0 24px 48px rgba(0,0,0,0.35))",
      transition: "none",
      // Scales (the 1.06 lift, the handoff morph) grow around the FINGER,
      // so the grabbed spot never moves under the cursor.
      transformOrigin: `${grabDx}px ${grabDy}px`,
    } as CSSStyleDeclaration);
    doc.body.appendChild(p);
    // The slot goes EMPTY while its widget is "out" (2026-07-19, James: "it
    // should feel like you did picked that thing up") — no dimmed duplicate.
    tileEl.style.transition = "opacity 140ms ease, transform 140ms ease";
    tileEl.style.opacity = "0";
    tileEl.style.transform = "scale(0.9)";
    return p;
  };

  const at = (p: HTMLElement, x: number, y: number, scale: number): void => {
    // Positioned by the PRESS OFFSET, not centered: picking a corner keeps
    // the face exactly where it was under your finger — no pickup snap.
    p.style.transform = `translate(${x - grabDx}px, ${y - grabDy}px) scale(${scale})`;
  };

  const restoreTile = (pop: boolean): void => {
    if (pop) {
      // "the dragged away tile item now re-appears": a small spring pop.
      tileEl.style.transition = "none";
      tileEl.style.opacity = "0";
      tileEl.style.transform = "scale(0.6)";
      requestAnimationFrame(() => {
        tileEl.style.transition =
          "opacity 240ms ease, transform 280ms cubic-bezier(0.34, 1.45, 0.64, 1)";
        tileEl.style.opacity = "1";
        tileEl.style.transform = "scale(1)";
      });
    } else {
      // Instant swap: the proxy just landed EXACTLY on the slot — any fade
      // here would read as a second object appearing.
      tileEl.style.transition = "none";
      tileEl.style.opacity = "1";
      tileEl.style.transform = "scale(1)";
    }
  };

  const settle = (): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("keydown", onKey, true);
    cb.onSettled();
  };

  const glideBack = (): void => {
    // Released inside the sheet — nothing spawned; the proxy returns to its
    // slot. Target = the PRESS-TIME rect: re-measuring the silhouette now
    // would read the hidden/scaled tile and land offset (field report
    // 2026-07-19). Land at scale 1 with no fade — a put-down, not a vanish —
    // then the instant tile swap is pixel-seamless.
    const p = proxy;
    if (p === null) {
      restoreTile(false);
      settle();
      return;
    }
    p.style.transition = `transform 240ms ${EASE}`;
    p.style.transform = `translate(${silRect.left}px, ${silRect.top}px) scale(1)`;
    window.setTimeout(() => {
      p.remove();
      restoreTile(false);
    }, 250);
    settle();
  };

  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== down.pointerId) return;
    if (proxy === null) {
      if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < 4) return;
      proxy = makeProxy();
    }
    at(proxy, e.clientX, e.clientY, 1.06);
    if (handed) return;
    const r = panel.getBoundingClientRect();
    const outside =
      e.clientX < r.left - 8 ||
      e.clientX > r.right + 8 ||
      e.clientY < r.top - 8 ||
      e.clientY > r.bottom + 8;
    if (!outside) return;

    // ---- THE HANDOFF: spawn the real widget, morph the proxy into it. ----
    handed = true;
    const res = cb.onHandoff(e, { u, v });
    const p = proxy;
    if (res === false) {
      p.remove();
      restoreTile(false);
      settle();
      return;
    }
    // The morph is a PURE SCALE about the grab point: proxy and ghost share
    // the cursor anchor at the same (u,v), so growing the proxy to the
    // ghost's on-screen size lands it EXACTLY on the widget — no translate,
    // no re-anchor. CSS transitions, NOT WAAPI: a stalled compositor leaves
    // WAAPI pending forever; a transition worst-case snaps to its end state.
    const targetScale = silRect.width > 0 ? res.screenW / silRect.width : 2;
    p.style.transition = `transform 240ms ${EASE}, opacity 200ms ease-out`;
    p.style.transform = `translate(${e.clientX - grabDx}px, ${e.clientY - grabDy}px) scale(${targetScale})`;
    p.style.opacity = "0";
    window.setTimeout(() => p.remove(), 260);
    // …while the real widget grows OUT of the proxy: same anchor (u,v) as
    // its transform origin, starting at the proxy's relative size — the two
    // crossfade as one object changing resolution. Transient inline styles,
    // cleared after the ride (reflector-owned nodes stay clean).
    const startScale = Math.min(
      0.9,
      Math.max(0.2, res.screenW > 0 ? silRect.width / res.screenW : 0.3),
    );
    let tries = 0;
    const popIn = (): void => {
      const host = doc.querySelector<HTMLElement>(`[data-ice-entity="${res.ghost}"]`);
      if (host === null) {
        if (++tries < 20) requestAnimationFrame(popIn);
        return;
      }
      host.style.transition = "none";
      host.style.transformOrigin = `${u * 100}% ${v * 100}%`;
      host.style.transform = `scale(${startScale})`;
      host.style.opacity = "0.4";
      void host.offsetWidth; // commit the start state before transitioning
      host.style.transition =
        "transform 280ms cubic-bezier(0.34, 1.3, 0.64, 1), opacity 220ms ease";
      host.style.transform = "scale(1)";
      host.style.opacity = "1";
      window.setTimeout(() => {
        host.style.transition = "";
        host.style.transform = "";
        host.style.opacity = "";
        host.style.transformOrigin = "";
      }, 320);
    };
    requestAnimationFrame(popIn);
    restoreTile(true);
    settle(); // the engine owns the pointer from here
  };

  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== down.pointerId) return;
    glideBack();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    glideBack();
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", onKey, true);
}

// --- tiles ------------------------------------------------------------------

function Tile({
  ce,
  entry,
  panelRef,
  onHandoff,
  open,
  index,
}: {
  ce: CanvasEngine;
  entry: CatalogEntry<WidgetType>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  onHandoff: () => void;
  open: boolean;
  index: number;
}) {
  const def = entry.def;
  const { cols, rows } = spanOf(def);
  const boxW = cols * CELL + (cols - 1) * GAP;
  const boxH = rows * CELL + (rows - 1) * GAP;
  const sil = silhouetteIn(def, boxW, boxH);
  const ref = useRef<HTMLDivElement>(null);

  // NATIVE pointerdown (2026-07-19 field bug): React delegates at its root —
  // by then the down already bubbled wherever it will. Here the tray sits
  // outside the canvas container so nothing double-lands, but native keeps
  // the press semantics exact (and preventDefault kills text/image drags).
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      e.preventDefault();
      const panel = panelRef.current;
      if (panel === null) return;
      startTileDrag(e, el, panel, def, {
        onHandoff: (ev, anchor) => {
          const container = document.querySelector<HTMLElement>("[data-ice-canvas]");
          if (container === null) return false;
          // Ratio-corrected: the canvas wrapper is scaled 0.98 while the
          // sheet is open — container px ≠ visual px until it settles.
          const rect = container.getBoundingClientRect();
          const rx = rect.width / container.clientWidth || 1;
          const ry = rect.height / container.clientHeight || 1;
          const pointerId =
            ev.pointerType === "touch"
              ? `touch:${ev.pointerId}`
              : ev.pointerType === "pen"
                ? "pen"
                : "mouse";
          const device =
            ev.pointerType === "touch"
              ? ("touch" as const)
              : ev.pointerType === "pen"
                ? ("pen" as const)
                : ("mouse" as const);
          const ghost = ce.ops.insertByDrag(def.type, {
            screenX: (ev.clientX - rect.left) / rx,
            screenY: (ev.clientY - rect.top) / ry,
            pointerId,
            device,
            buttons: ev.buttons || 1,
            // The grab point carries over: the cursor pins the SAME (u,v)
            // of the widget it pinned in the tile — no re-anchor snap.
            anchor,
            // Cancel fly-backs aim at the persistent toolbar, not open canvas.
            home: { x: container.clientWidth / 2, y: container.clientHeight - 64 },
          });
          onHandoff(); // the sheet recedes; the drag continues on full canvas
          // The ghost's on-screen width (visual px) — the proxy morphs to it.
          const zoom = ce.world.getResource(Camera)?.zoom ?? 1;
          return { ghost, screenW: def.defaultSize.w * zoom * rx };
        },
        onSettled: () => {},
      });
    };
    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, [ce, def, panelRef, onHandoff]);

  return (
    // OUTER = React-owned: the grid slot + the open-flip flow-in (slide up +
    // fade, staggered per tile — riding the sheet's momentum). Kept SEPARATE
    // from the inner tile the drag machine mutates imperatively (pickup
    // hide/restore pop), so the two never fight over style.
    <div
      style={{
        gridColumn: `span ${cols}`,
        gridRow: `span ${rows}`,
        width: boxW,
        height: boxH,
        opacity: open ? 1 : 0,
        transform: open ? "translateY(0)" : "translateY(28px)",
        transition: `opacity 420ms ease, transform 560ms ${EASE}`,
        transitionDelay: open ? `${140 + Math.min(index * 26, 400)}ms` : "0ms",
      }}
    >
      <div
        ref={ref}
        data-tray-tile={def.type}
        className="group relative flex h-full w-full cursor-grab flex-col items-center justify-center active:cursor-grabbing"
        style={{ touchAction: "none", userSelect: "none" }}
        title={`Drag onto the canvas to add a ${entry.title}`}
      >
        <div
          data-tray-sil=""
          className="transition-transform duration-200 group-hover:scale-[1.03] group-active:scale-95"
          style={{
            width: sil.w,
            height: sil.h,
            filter: "drop-shadow(0 10px 18px rgba(0,0,0,0.16))",
          }}
        >
          <TileFace entry={entry} sil={sil} />
        </div>
        <span className="mt-2 max-w-full truncate text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
          {entry.title}
        </span>
      </div>
    </div>
  );
}

// --- the tool switcher (the reference's mode pill, on engine tools) ---------

const TOOLS = [
  { id: "select", label: "Select", key: "V" },
  { id: "pan", label: "Pan", key: "H" },
  { id: "connect", label: "Wire", key: "C" },
] as const;
const SEG_W = 72;

const activeToolId = (t: { id: string | null } | undefined): string => t?.id ?? "select";

function ToolSwitcher({ ce }: { ce: CanvasEngine }) {
  // Reactive subscription (3b amendment) — fires only when the tool changes.
  const active = useReactiveResource(ce, ActiveTool, activeToolId);
  const idx = Math.max(
    0,
    TOOLS.findIndex((t) => t.id === active),
  );
  return (
    <div className="relative flex rounded-full border border-black/5 bg-[#F2F2F7]/80 p-1 shadow-inner dark:border-white/5 dark:bg-black/40">
      <div
        className="absolute top-1 bottom-1 rounded-full border border-black/5 bg-white shadow-sm transition-transform duration-300 dark:border-white/10 dark:bg-[#2C2C2E]"
        style={{
          width: SEG_W,
          transform: `translateX(${idx * SEG_W}px)`,
          transitionTimingFunction: EASE,
        }}
      />
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => ce.ops.setTool(t.id)}
          className={`relative z-10 py-1.5 text-[13px] font-medium transition-colors ${
            active === t.id
              ? "text-black dark:text-white"
              : "text-black/50 hover:text-black/80 dark:text-white/50 dark:hover:text-white/80"
          }`}
          style={{ width: SEG_W }}
          title={`${t.label} tool (${t.key})`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// --- the morphing island -----------------------------------------------------

export function WidgetTray({
  ce,
  registry,
  open,
  onOpenChange,
}: {
  ce: CanvasEngine;
  registry: PluginRegistry<WidgetType>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [ghostLive, setGhostLive] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // P3c: disabled plugins keep their schemas (existing boards render
  // placeholders) but never offer NEW spawns — the tray follows the live
  // fieldd snapshot; null snapshot (daemon away) hides nothing, honestly.
  const pluginSnapshot = usePluginRegistrySnapshot();
  const disabledPlugins = useMemo(
    () =>
      pluginSnapshot === null
        ? undefined
        : new Set(pluginSnapshot.plugins.filter((p) => !p.enabled).map((p) => p.id)),
    [pluginSnapshot],
  );
  const entries = useMemo(
    () => buildCatalog(registry, disabledPlugins),
    [registry, disabledPlugins],
  );
  const shown = category === "All" ? entries : entries.filter((e) => e.category === category);

  // HANDOFF must release the pointer path SYNCHRONOUSLY: until React
  // re-renders `open=false`, the backdrop still has pointer-events auto and
  // the first post-handoff moves land on IT (a container SIBLING — the
  // adapter never sees them), so the drag origin latches late and the ghost
  // trails the cursor by the missed travel (anchor-drift field bug,
  // 2026-07-19). Inline-kill it in the same task; the class value takes back
  // over on the next open.
  const handoff = (): void => {
    backdropRef.current?.style.setProperty("pointer-events", "none");
    onOpenChange(false);
  };
  useEffect(() => {
    if (open) backdropRef.current?.style.removeProperty("pointer-events");
  }, [open]);

  // The stage quiesce (ce.stage holds, 2026-07-19): while the sheet is up the
  // canvas stops discretionary per-frame work — animated GL islands freeze on
  // their retained textures; the world stays live. Opening also cancels any
  // in-flight gesture (the setTool hygiene rule) so nothing freezes mid-drag.
  useStageHold(ce, open, "widget-tray");
  useEffect(() => {
    if (open) ce.ops.cancelActiveGestures();
  }, [open, ce]);

  // Ghost scan, EVENT-DRIVEN (3b amendment): Tier-1 observeQuery fires on any
  // InsertGhost archetype move — spawn, the GhostRetiring tag flip, despawn —
  // so the scan runs exactly when ghosts change, never on a clock. It drives
  // the toolbar's put-back affordance AND the fly-back shrink (2026-07-19,
  // James: "also shrink its size, do a scale down to 0 transition along with
  // the fly") — a retiring ghost's host scales to nothing while the engine
  // tween carries it home; the reap despawns it at arrival, so the
  // fill-forwards end state never lingers.
  useEffect(() => {
    const shrunk = new Set<Entity>();
    return ce.world.reactive.observeQuery(ghostQ, () => {
      let live = false;
      ce.world.query(ghostQ).each((b) => {
        for (const r of b) {
          live = true;
          const e = b.entity(r);
          if (!ce.world.hasTag(e, GhostRetiring) || shrunk.has(e)) continue;
          shrunk.add(e);
          // CSS transition, not WAAPI (the compositor-stall lesson): the
          // host despawns at tween-arrival, so no cleanup is needed.
          const host = document.querySelector<HTMLElement>(`[data-ice-entity="${e}"]`);
          if (host !== null) {
            host.style.transition = "transform 190ms ease-in, opacity 190ms ease-in";
            host.style.transformOrigin = "center center";
            host.style.transform = "scale(0)";
            host.style.opacity = "0.2";
          }
        }
      });
      setGhostLive(live);
    });
  }, [ce]);

  // Release over the toolbar mid-insert = cancel (the put-back). Event-time
  // CancelRequest beats the queued up by phase order (ctl:spawn sweep first).
  useEffect(() => {
    const onUp = (e: PointerEvent): void => {
      const panel = panelRef.current;
      if (panel === null) return;
      let live = false;
      ce.world.query(ghostQ).each((b) => {
        if (b.count > 0) live = true;
      });
      if (!live) return;
      const r = panel.getBoundingClientRect();
      if (
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom
      ) {
        ce.ops.cancelActiveGestures();
      }
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [ce]);

  // B toggles; Escape closes when open (capture — the app's exit-container
  // handler and the engine keymap must not also act on the same press).
  useEffect(() => {
    const isEditable = (t: EventTarget | null): boolean =>
      t instanceof HTMLElement &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable);
    const onKey = (e: KeyboardEvent): void => {
      if (
        (e.key === "b" || e.key === "B") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !isEditable(e.target)
      ) {
        onOpenChange(!open);
      }
    };
    const onEscCapture = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || !open || isEditable(e.target)) return;
      if (document.querySelector("[data-tray-proxy]") !== null) return; // the proxy's own Esc glides it back
      e.stopPropagation();
      onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onEscCapture, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onEscCapture, true);
    };
  }, [open, onOpenChange]);

  return (
    <>
      {/* Dimming backdrop — click closes; canvas rests while browsing. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape is the keyboard close; the backdrop click is a redundant pointer affordance */}
      <div
        ref={backdropRef}
        className={`absolute inset-0 z-40 bg-black/10 transition-opacity duration-500 dark:bg-black/40 ${
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => onOpenChange(false)}
        aria-hidden
      />

      {/* THE morphing island: toolbar pill ⇄ widget sheet, one element. */}
      <div
        ref={panelRef}
        data-tray-panel=""
        data-tray-open={open ? "true" : "false"}
        data-hud-flight="bottom-center"
        className={`hud-flight absolute left-1/2 z-50 -translate-x-1/2 overflow-hidden border transition-all ${
          open
            ? "bottom-0 h-[60vh] w-[min(80%,64rem)] rounded-t-[2.5rem] rounded-b-none border-b-0 border-black/5 bg-white/90 shadow-[0_-20px_40px_rgba(0,0,0,0.08)] backdrop-blur-3xl dark:border-white/10 dark:bg-[#1C1C1E]/90 dark:shadow-[0_-20px_40px_rgba(0,0,0,0.4)]"
            : "bottom-8 h-16 w-[440px] rounded-[32px] border-black/5 bg-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.08)] backdrop-blur-xl hover:bg-white/90 dark:border-white/10 dark:bg-[#1C1C1E]/80 dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)] dark:hover:bg-[#1C1C1E]/90"
        }`}
        style={{
          transitionDuration: `${MORPH_MS}ms`,
          transitionTimingFunction: EASE,
          willChange: "width, height, bottom, border-radius",
        }}
      >
        <div className="relative flex h-full w-full flex-col">
          {/* Pull indicator (open only) — a real button: keyboard closes too. */}
          <button
            type="button"
            aria-label="Close the widget tray"
            className={`absolute top-3 left-1/2 h-1.5 w-12 -translate-x-1/2 cursor-pointer rounded-full bg-black/20 transition-all duration-300 hover:bg-black/40 dark:bg-white/20 dark:hover:bg-white/40 ${
              open ? "opacity-100 delay-200" : "pointer-events-none opacity-0"
            }`}
            onClick={() => onOpenChange(false)}
          />

          {/* The morphing ⊕ (plus ⇄ close via 135° rotation). */}
          <button
            type="button"
            data-tray-toggle=""
            onClick={() => onOpenChange(!open)}
            className={`absolute z-50 flex items-center justify-center rounded-full transition-all ${
              open
                ? "top-5 right-8 h-10 w-10 rotate-[135deg] bg-black/5 text-black/70 shadow-none hover:bg-black/10 hover:text-black dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20 dark:hover:text-white"
                : "top-2 right-2 h-12 w-12 rotate-0 bg-black text-white shadow-md hover:scale-105 hover:bg-black/90 active:scale-95 dark:bg-white dark:text-black dark:hover:bg-white/90"
            }`}
            style={{ transitionDuration: `${MORPH_MS}ms`, transitionTimingFunction: EASE }}
            title={open ? "Close (Esc)" : "Widget tray (B)"}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              role="presentation"
            >
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          </button>

          {/* Always-visible header: tools + actions (the toolbar itself). */}
          <div
            className={`relative z-40 flex w-full shrink-0 items-center transition-all ${
              open ? "h-20 px-8 pr-[100px]" : "h-16 px-2 pr-[64px]"
            }`}
            style={{ transitionDuration: `${MORPH_MS}ms`, transitionTimingFunction: EASE }}
          >
            <ToolSwitcher ce={ce} />
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => ce.ops.arrange()}
              className="flex h-11 w-11 items-center justify-center rounded-full text-[17px] transition-all hover:bg-black/5 active:scale-95 dark:hover:bg-white/10"
              title="Clean up: pack widgets into tidy rows (arranges the selection when 2+ are selected)"
            >
              ✨
            </button>
          </div>

          {/* Put-back affordance: covers the toolbar while an insert drags. */}
          <div
            className={`pointer-events-none absolute inset-0 z-[60] flex items-center justify-center bg-white/90 text-[13px] font-medium text-neutral-500 backdrop-blur-xl transition-opacity duration-200 dark:bg-[#1C1C1E]/95 dark:text-neutral-300 ${
              ghostLive && !open ? "opacity-100" : "opacity-0"
            }`}
          >
            <span className="rounded-full border border-dashed border-neutral-400/60 px-4 py-1.5 dark:border-neutral-500/60">
              Release here to put it back
            </span>
          </div>

          {/* Sheet content: categories + the iOS grid. */}
          <div
            className={`relative flex min-h-0 flex-1 flex-col transition-all duration-500 ease-out ${
              open
                ? "translate-y-0 opacity-100 delay-150"
                : "pointer-events-none absolute inset-x-0 top-16 translate-y-12 opacity-0"
            }`}
          >
            <div className="mb-3 flex w-full items-center gap-2 overflow-x-auto px-8 no-scrollbar mask-fade-right">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`whitespace-nowrap rounded-full border px-4 py-1.5 text-[13px] font-medium transition-all active:scale-95 ${
                    category === cat
                      ? "border-black bg-black text-white shadow-md dark:border-white dark:bg-white dark:text-black"
                      : "border-black/5 bg-[#F2F2F7] text-black/70 hover:bg-[#E5E5EA] hover:text-black dark:border-white/5 dark:bg-[#2C2C2E]/50 dark:text-white/70 dark:hover:bg-[#2C2C2E] dark:hover:text-white"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto px-8 no-scrollbar mask-fade-bottom">
              <div
                className="w-full pt-4 pb-28"
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(auto-fill, ${CELL}px)`,
                  gridAutoRows: `${CELL}px`,
                  gridAutoFlow: "row dense", // small tiles backfill the span gaps
                  columnGap: GAP,
                  rowGap: GAP,
                  justifyContent: "center",
                }}
              >
                {shown.map((entry, i) => (
                  <Tile
                    key={entry.type}
                    ce={ce}
                    entry={entry}
                    panelRef={panelRef}
                    onHandoff={handoff}
                    open={open}
                    index={i}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Reference utility styles (scrollbar hiding + edge fade masks). */}
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .mask-fade-right {
          mask-image: linear-gradient(to right, black 85%, transparent 100%);
          -webkit-mask-image: linear-gradient(to right, black 85%, transparent 100%);
        }
        .mask-fade-bottom {
          mask-image: linear-gradient(to bottom, black 70%, transparent 97%);
          -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 97%);
        }
      `}</style>
    </>
  );
}
