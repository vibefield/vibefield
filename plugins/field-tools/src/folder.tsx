/**
 * Folder — the v1 folder (RFC-004 Phase 5) on v3 container semantics,
 * re-skinned 2026-07-17 to the design-006 mock's folder (James: "make the
 * container widget look like that"): a dark surface card whose body is a
 * live PREVIEW PORTAL — dot-grid backdrop + minis of the actual children,
 * mapped through the SAME affine the portal-zoom transition uses (fit of the
 * child frame's arrival view onto the portal rect), so entering reads as
 * diving into the picture you were already looking at — and a 36px bottom
 * bar: accent folder icon, name, count pill. Minis are true card silhouettes
 * (2026-07-17, James): CARD_RADIUS scaled by the same affine, and each mini
 * wears its card's REAL background via shell-ui's previewBackground (manifest
 * `preview` data, spine-wired — the P-3 reshape of widgetlab's preview.ts).
 *
 * `container.accepts: ["widget"]` arms drop-to-consume + nested canvas, and
 * the folder now ALSO carries `provides: ["widget"]` (2026-07-17): folders
 * are widgets too, so a folder drops into a folder — nesting was already
 * fully supported engine-side (membership walks the ChildOf chain), only the
 * missing Provides blocked the match. Double-click (or Enter/Space) descends
 * via ops.enterContainer. Child snapshot reads the `ChildOf` containment
 * edge (chrome-grade 250 ms poll, value-stable state).
 *
 * size: large (329×345).
 */
import {
  CameraLimits,
  ChildOf,
  type Entity,
  FIT_DEFAULTS,
  getWidgetType,
  MeasuredSize,
  Position,
  PrefabId,
  Size,
  useOps,
  useWidgetProps,
  Viewport,
  type World,
} from "@vibefield/plugin-sdk/canvas";
import { CARD_RADIUS, CardShell, previewBackground } from "@vibefield/plugin-sdk/ui";
import {
  type CSSProperties,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useState,
} from "react";
import "./folder.css";

const TYPE = "vibefield.field-tools.folder";

export const FOLDER_SIZE = { w: 329, h: 345 };
/** The folder card's own surface (the design-006 mock's --panel; manifest `preview` mirrors it). */
export const FOLDER_BG = "var(--vf-folder-surface)";

/** Mock constants (design-006 artifact): portal inset + bottom bar height. */
const FOLDER_PAD = 10;
const FOLDER_BAR = 36;
/** The preview portal rect in card-local px (fixed size — sizeMode "fixed"). */
const PORTAL = {
  x: FOLDER_PAD,
  y: FOLDER_PAD,
  w: FOLDER_SIZE.w - FOLDER_PAD * 2,
  h: FOLDER_SIZE.h - FOLDER_PAD - FOLDER_BAR,
};

type Mini = { x: number; y: number; w: number; h: number; bg: string };

function childrenSnapshot(world: World, entity: Entity): Mini[] {
  const out: Mini[] = [];
  for (const c of world.getReverse(entity, ChildOf)) {
    const pos = world.get(c, Position);
    const m = world.get(c, MeasuredSize);
    const s = m !== undefined && m.w > 0 ? m : world.get(c, Size);
    if (pos === undefined || s === undefined) continue;
    const type = world.get(c, PrefabId)?.id;
    const def = typeof type === "string" ? getWidgetType(type) : undefined;
    const bg = previewBackground(typeof type === "string" ? type : undefined, def?.surface);
    out.push({ x: pos.x, y: pos.y, w: s.w, h: s.h, bg });
  }
  return out;
}

/** Aspect-FIT affine mapping rect R onto rect K, centers aligned (mock fitAffine). */
function fitAffine(
  R: { x: number; y: number; w: number; h: number },
  K: { x: number; y: number; w: number; h: number },
): { s: number; ox: number; oy: number } {
  const s = Math.min(K.w / R.w, K.h / R.h);
  return { s, ox: K.x + K.w / 2 - (R.x + R.w / 2) * s, oy: K.y + K.h / 2 - (R.y + R.h / 2) * s };
}

/**
 * Mini placement = the transition's own map: zoom-to-fit arrival camera over
 * the children (pad 80, zoom clamped like resolveArrivalCamera), that view
 * rect fit onto the portal — pixel-continuous with the enter flight. Falls
 * back to a plain bbox fit when no Viewport exists (headless/tests).
 */
function miniRects(
  minis: Mini[],
  world: World,
): Array<Mini & { left: number; top: number; width: number; height: number; radius: number }> {
  if (minis.length === 0) return [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const c of minis) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + c.w);
    maxY = Math.max(maxY, c.y + c.h);
  }
  const pad = FIT_DEFAULTS.pad;
  const vp = world.getResource(Viewport);
  let R: { x: number; y: number; w: number; h: number };
  if (vp !== undefined && vp.w > 0 && vp.h > 0) {
    // The arrival camera's NATURAL band (2026-07-18): FIT_DEFAULTS ∩
    // CameraLimits — must match resolveArrivalCamera exactly or the enter
    // flight lands on a different view than the portal promised.
    const lim = world.getResource(CameraLimits);
    const fitMin = Math.max(FIT_DEFAULTS.minZoom, lim?.minZoom ?? FIT_DEFAULTS.minZoom);
    const fitMax = Math.min(FIT_DEFAULTS.maxZoom, lim?.maxZoom ?? FIT_DEFAULTS.maxZoom);
    const bw = maxX - minX;
    const bh = maxY - minY;
    let zoom = Math.min(vp.w / (bw + pad * 2), vp.h / (bh + pad * 2));
    zoom = Math.min(fitMax, Math.max(fitMin, zoom));
    R = {
      x: minX + bw / 2 - vp.w / (2 * zoom),
      y: minY + bh / 2 - vp.h / (2 * zoom),
      w: vp.w / zoom,
      h: vp.h / zoom,
    };
  } else {
    R = { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }
  const M = fitAffine(R, PORTAL);
  // Same silhouette as the card: the 22px corner scaled by the SAME affine.
  const radius = CARD_RADIUS * M.s;
  return minis.map((c) => ({
    ...c,
    left: M.ox + c.x * M.s - PORTAL.x,
    top: M.oy + c.y * M.s - PORTAL.y,
    width: c.w * M.s,
    height: c.h * M.s,
    radius,
  }));
}

function FolderView({ entity, world }: { entity: Entity; world: World }): ReactElement {
  const props = useWidgetProps<{ title: string; accent: string }>(world, entity, TYPE);
  const ops = useOps();
  const [minis, setMinis] = useState<Mini[]>(() => childrenSnapshot(world, entity));
  useEffect(() => {
    // Seed from a fresh snapshot (not the state closure) — value-stable
    // updates: setMinis fires only when the serialized snapshot changes.
    let lastKey = JSON.stringify(childrenSnapshot(world, entity));
    const id = setInterval(() => {
      const next = childrenSnapshot(world, entity);
      const key = JSON.stringify(next);
      if (key !== lastKey) {
        lastKey = key;
        setMinis(next);
      }
    }, 250);
    return () => clearInterval(id);
  }, [world, entity]);

  const title = props?.title ?? "Folder";
  const accent = props?.accent ?? "var(--vf-accent-1)";
  const enterFolder = (): void => ops.enterContainer(entity);
  const onDoubleClick = (event: ReactMouseEvent): void => {
    event.stopPropagation();
    enterFolder();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      enterFolder();
    }
  };
  const placed = miniRects(minis, world);

  // v1 note kept: a <div role="button"> rather than <button> — a real button
  // would be treated as a widget-internal control and make the whole surface
  // non-draggable; role + tabIndex + onKeyDown keep keyboard a11y.
  return (
    <CardShell world={world} entity={entity} background={FOLDER_BG}>
      {/* biome-ignore lint/a11y/useSemanticElements: drag-surface; see comment above */}
      <div
        className="vf-folder-card"
        role="button"
        tabIndex={0}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        style={
          {
            "--vf-folder-accent": accent,
            "--vf-folder-bar-height": `${FOLDER_BAR}px`,
          } as CSSProperties
        }
        title={`Double-click to open ${title}`}
      >
        {/* Preview portal: dot-grid backdrop + live minis of the children. */}
        <div
          className="vf-folder-card__portal"
          style={{
            left: PORTAL.x,
            top: PORTAL.y,
            width: PORTAL.w,
            height: PORTAL.h,
          }}
        >
          {placed.map((c, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: positional snapshot, order-stable per poll
              key={i}
              className="vf-folder-card__mini"
              style={{
                left: c.left,
                top: c.top,
                width: c.width,
                height: c.height,
                borderRadius: c.radius,
                background: c.bg,
              }}
            />
          ))}
          {placed.length === 0 && (
            <div className="vf-folder-card__empty">Empty — drop cards in</div>
          )}
        </div>

        {/* Bottom bar: accent folder icon · name · count pill (mock .bar). */}
        <div className="vf-folder-card__bar">
          <svg
            width="14"
            height="12"
            viewBox="0 0 14 12"
            fill="none"
            aria-hidden="true"
            className="vf-folder-card__icon"
          >
            <path
              d="M1 3.2C1 2.1 1.9 1.2 3 1.2h2.4l1.4 1.6H11c1.1 0 2 .9 2 2v4C13 9.9 12.1 10.8 11 10.8H3c-1.1 0-2-.9-2-2V3.2Z"
              fill="var(--vf-folder-accent)"
            />
          </svg>
          <span className="vf-folder-card__title">{title}</span>
          <span className="vf-folder-card__count">{placed.length}</span>
        </div>
      </div>
    </CardShell>
  );
}

// C1b: the defineWidget call is GONE — the host builds the prefab from the
// canonical manifest (§12.2; the container semantics live there as data).
export const FOLDER_TYPE = TYPE;
export { FolderView };
