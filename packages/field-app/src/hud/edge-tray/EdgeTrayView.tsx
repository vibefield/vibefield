/**
 * EdgeTrayView — the edge tray as ruled 2026-09-23 (DESIGN.md §8, edge trays;
 * the record is draft/composer/compact.html §17–19): a NOTCH at mid-edge (N1:
 * a concave fillet into the wall, a convex face) and a DRAWER behind it (P4:
 * the same path at the panel's scale, opaque solid chrome, the strong
 * hairline gapped under the notch, the edge shadow when open) holding ONE
 * column — the clipboard's 128px tiles grouped by day, or a drawer's own
 * content (Artifacts' Hub, One Frame FR-4) — and nothing else: no head, no
 * find line. Over a covered view the notch rests as its SLIVER (One Frame §10)
 * and becomes the notch on approach. Controller-free: the trays' grammar
 * (hover, pin, keyboard, the capture door, the fly-in) lives in EdgeTray.tsx;
 * previews mount this.
 */
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type Ref,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  DRAWER_FILLET,
  DRAWER_WIDTH,
  drawerLinePath,
  drawerSpec,
  NOTCH,
  notchGap,
  notchHeight,
  notchPath,
  sliverPath,
} from "./notch-path";
import "./edge-tray.css";

export type EdgeTraySide = "left" | "right";
export type EdgeTrayDay = "today" | "yesterday" | "earlier";

export interface EdgeTrayTile {
  readonly id: string;
  readonly kind: "capture";
  readonly label: string;
  /** the still's URL through the shell's scheme; null in a harness without the shell */
  readonly imageUrl: string | null;
  /** HH:MM */
  readonly time: string;
  readonly day: EdgeTrayDay;
  readonly meta: string;
}

/** The Snap tile — the product's door to the capture (SNAP-3). */
export interface EdgeTraySnap {
  readonly state: "ready" | "busy" | "unavailable" | "error";
  /** the honest word under the glyph: "snap", "one at a time", "no helper here", or the setting to flip */
  readonly word: string;
}

export interface EdgeTrayViewProps {
  readonly notice?: string | null;
  readonly side: EdgeTraySide;
  readonly label: string;
  readonly open: boolean;
  readonly pinned: boolean;
  /** The notch's count, or null for a drawer whose count is not the spine's
   * to say (Artifacts': the plugin says it, in its own header). */
  readonly count: number | null;
  /** Over a covered view the notch rests as its sliver (One Frame §10). */
  readonly sliver?: boolean;
  /** A drawer's own column, in place of the tiles (Artifacts' Hub). */
  readonly content?: ReactNode;
  readonly items: readonly EdgeTrayTile[];
  readonly filter: string;
  readonly snap: EdgeTraySnap | null;
  readonly bumped: boolean;
  /** the nub's tooltip — the grammar in words */
  readonly hint: string;
  readonly emptyWord: string;
  readonly nubRef?: Ref<HTMLButtonElement>;
  readonly trayRef?: Ref<HTMLElement>;
  readonly onNubClick: () => void;
  readonly onPointerEnter: () => void;
  readonly onPointerLeave: () => void;
  readonly onSnap?: () => void;
  readonly onLook?: (id: string) => void;
  readonly onRemove?: (id: string) => void;
  readonly onImageBroken?: (id: string) => void;
}

const DAYS: readonly EdgeTrayDay[] = ["today", "yesterday", "earlier"];

function ClipboardGlyph(): ReactElement {
  return <FieldGlyph name="clipboard" size={16} className="vf-edge-tray__glyph" />;
}

function PackageGlyph(): ReactElement {
  return <FieldGlyph name="package" size={16} className="vf-edge-tray__glyph" />;
}

function CaptureGlyph(): ReactElement {
  return <FieldGlyph name="capture" size={18} />;
}

/** The drawer's silhouette, drawn from the panel's rendered box — one path,
 * the notch's builder, the hairline gapped under the notch. */
function DrawerSilhouette({ panelRef }: { panelRef: React.RefObject<HTMLDivElement | null> }) {
  const [box, setBox] = useState<{ w: number; h: number }>({ w: DRAWER_WIDTH, h: 600 });
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    const measure = (): void => {
      const w = panel.offsetWidth || DRAWER_WIDTH;
      const h = panel.offsetHeight || 600;
      setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [panelRef]);
  const spec = drawerSpec(box.w, box.h);
  return (
    <svg
      className="vf-edge-tray__drawer"
      viewBox={`0 0 ${box.w} ${box.h + 2 * DRAWER_FILLET}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path className="vf-edge-tray__drawer-fill" d={notchPath(spec, true)} />
      <path className="vf-edge-tray__drawer-line" d={drawerLinePath(spec, notchGap(box.h))} />
    </svg>
  );
}

/** The notch and its sliver as CSS paths, for the morph between them: the
 * drawing keeps the notch's frame, and only `d` travels (DESIGN.md §6). */
const NUB_PATHS = {
  "--vf-nub-w": `${NOTCH.w}px`,
  "--vf-nub-h": `${notchHeight(NOTCH)}px`,
  "--vf-notch-fill": `path("${notchPath(NOTCH, true)}")`,
  "--vf-notch-line": `path("${notchPath(NOTCH, false)}")`,
  "--vf-sliver-fill": `path("${sliverPath(true)}")`,
  "--vf-sliver-line": `path("${sliverPath(false)}")`,
} as CSSProperties;

export function EdgeTrayView(props: EdgeTrayViewProps): ReactElement {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const notchOpen = notchPath(NOTCH, false);
  const resting = props.sliver === true && !props.open;
  const groups = DAYS.map((day) => ({
    day,
    tiles: props.items.filter((tile) => tile.day === day),
  })).filter((group) => group.tiles.length > 0);
  let dealt = 0;
  return (
    <aside
      ref={props.trayRef}
      className="vf-edge-tray hud-flight"
      data-hud-flight={props.side}
      data-side={props.side}
      data-open={props.open}
      data-pinned={props.pinned}
      data-filter={props.filter}
      aria-label={props.label}
      onPointerEnter={props.onPointerEnter}
      onPointerLeave={props.onPointerLeave}
    >
      <div className="vf-edge-tray__panel" ref={panelRef}>
        <DrawerSilhouette panelRef={panelRef} />
        <button
          type="button"
          className={`vf-edge-tray__nub no-drag${props.bumped ? " is-bumped" : ""}`}
          ref={props.nubRef}
          title={props.hint}
          aria-label={props.label}
          aria-pressed={props.pinned}
          data-sliver={resting ? "" : undefined}
          onClick={props.onNubClick}
          style={NUB_PATHS}
        >
          <svg
            className="vf-edge-tray__shape"
            viewBox={`0 0 ${NOTCH.w} ${notchHeight(NOTCH)}`}
            aria-hidden="true"
          >
            <path className="vf-edge-tray__shape-fill" d={notchPath(NOTCH, true)} />
            <path className="vf-edge-tray__shape-line" d={notchOpen} />
            <path className="vf-edge-tray__shape-ring" d={notchOpen} />
          </svg>
          {props.side === "left" ? <ClipboardGlyph /> : <PackageGlyph />}
          {props.count !== null && <b className="vf-edge-tray__count">{props.count}</b>}
        </button>
        <div className="vf-edge-tray__inner">
          <div
            className="vf-edge-tray__list"
            data-content={props.content !== undefined ? "" : undefined}
          >
            {props.content}
            {props.filter !== "" && (
              <div className="vf-edge-tray__filter">
                <FieldGlyph name="search" size={12} /> <b>{props.filter}</b>
              </div>
            )}
            {groups.map((group) => (
              <div key={group.day} className="vf-edge-tray__group">
                <h6>{group.day}</h6>
                {group.tiles.map((tile) => {
                  const n = Math.min(dealt++, 10);
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: the tile carries its own act buttons (Quick Look, Remove), and a <button> cannot nest buttons; it is keyboard-operable as a button itself
                    <div
                      key={tile.id}
                      className="vf-edge-tray__tile"
                      data-kind={tile.kind}
                      data-blank={tile.imageUrl === null}
                      role="button"
                      tabIndex={0}
                      style={{ "--n": n } as React.CSSProperties}
                      aria-label={`${tile.kind}: ${tile.label} — ${tile.meta}`}
                      onClick={() => props.onLook?.(tile.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          props.onLook?.(tile.id);
                        }
                      }}
                    >
                      {tile.imageUrl !== null ? (
                        <img
                          className="vf-edge-tray__still"
                          src={tile.imageUrl}
                          alt=""
                          draggable={false}
                          onError={() => props.onImageBroken?.(tile.id)}
                        />
                      ) : (
                        <span className="vf-edge-tray__blank">
                          <CaptureGlyph />
                          <span>no still here</span>
                        </span>
                      )}
                      <span className="vf-edge-tray__mark">
                        <CaptureGlyph />
                        <time>{tile.time}</time>
                      </span>
                      <span className="vf-edge-tray__name">{tile.label}</span>
                      <span className="vf-edge-tray__prov">{tile.meta}</span>
                      <span className="vf-edge-tray__acts">
                        <button
                          type="button"
                          title="Quick Look"
                          aria-label="Quick Look"
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onLook?.(tile.id);
                          }}
                        >
                          <FieldGlyph name="outward" size={12} />
                        </button>
                        <button
                          type="button"
                          title="Remove"
                          aria-label="Remove"
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onRemove?.(tile.id);
                          }}
                        >
                          <FieldGlyph name="close" size={12} />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
            {props.items.length === 0 && props.content === undefined && (
              <div className="vf-edge-tray__empty">{props.emptyWord}</div>
            )}
            {props.notice != null && (
              <div role="status" className="vf-edge-tray__empty">
                {props.notice}
              </div>
            )}
            {props.snap !== null && (
              <button
                type="button"
                className="vf-edge-tray__tile vf-edge-tray__snap"
                data-state={props.snap.state}
                disabled={props.snap.state === "busy" || props.snap.state === "unavailable"}
                onClick={props.onSnap}
                title={
                  props.snap.state === "ready"
                    ? "Take a screenshot — the still lands here and on the clipboard"
                    : props.snap.word
                }
              >
                <CaptureGlyph />
                <span>{props.snap.word}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
