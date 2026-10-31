/**
 * EdgeTrayView — the edge tray as ruled 2026-09-23 (DESIGN.md §8, edge trays;
 * the record is draft/composer/compact.html §17–19): a NOTCH at mid-edge (N1:
 * a concave fillet into the wall, a convex face) and a DRAWER behind it (P4:
 * the same path at the panel's scale, opaque solid chrome, the strong
 * hairline gapped under the notch, the edge shadow when open) holding ONE
 * column — Artifacts' Hub (One Frame FR-4) — and nothing else: no head, no
 * find line. Over a covered view the notch rests as its SLIVER (One Frame §10)
 * and becomes the notch on approach. The right edge's alone since the left
 * edge's clipboard retired into the hand (track HN). Controller-free: the
 * drawer's grammar (hover, pin, keyboard) lives in EdgeTray.tsx; previews
 * mount this.
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

export interface EdgeTrayViewProps {
  readonly label: string;
  readonly open: boolean;
  readonly pinned: boolean;
  /** Over a covered view the notch rests as its sliver (One Frame §10). */
  readonly sliver?: boolean;
  /** The drawer's column: the Artifact Hub (the `hud.side-panel` contribution),
   * or nothing while the drawer is shut. */
  readonly content: ReactNode;
  /** the nub's tooltip — the grammar in words */
  readonly hint: string;
  readonly nubRef?: Ref<HTMLButtonElement>;
  readonly trayRef?: Ref<HTMLElement>;
  readonly onNubClick: () => void;
  readonly onPointerEnter: () => void;
  readonly onPointerLeave: () => void;
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
  return (
    <aside
      ref={props.trayRef}
      className="vf-edge-tray hud-flight"
      data-hud-flight="right"
      data-side="right"
      data-open={props.open}
      data-pinned={props.pinned}
      aria-label={props.label}
      onPointerEnter={props.onPointerEnter}
      onPointerLeave={props.onPointerLeave}
    >
      <div className="vf-edge-tray__panel" ref={panelRef}>
        <DrawerSilhouette panelRef={panelRef} />
        <button
          type="button"
          className="vf-edge-tray__nub no-drag"
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
          <FieldGlyph name="package" size={16} className="vf-edge-tray__glyph" />
        </button>
        <div className="vf-edge-tray__inner">
          <div className="vf-edge-tray__list" data-content="">
            {props.content}
          </div>
        </div>
      </div>
    </aside>
  );
}
