/**
 * EdgeTrayView — the edge tray as ruled 2026-09-23 (DESIGN.md §8, edge trays;
 * the record is draft/composer/compact.html §17–19): a NOTCH at mid-edge (N1:
 * a concave fillet into the wall, a convex face) and a DRAWER behind it (P4:
 * the same path at the panel's scale, opaque solid chrome, the strong
 * hairline gapped under the notch, the edge shadow when open) holding ONE
 * column of 128px tiles grouped by day, and nothing else — no head, no find
 * line. Controller-free: the tray's grammar (hover, pin, keyboard, the
 * capture door, the fly-in) lives in EdgeTray.tsx; previews mount this.
 */
import { type ReactElement, type Ref, useLayoutEffect, useRef, useState } from "react";
import {
  DRAWER_FILLET,
  DRAWER_WIDTH,
  drawerLinePath,
  drawerSpec,
  NOTCH,
  notchGap,
  notchHeight,
  notchPath,
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
  readonly count: number;
  readonly items: readonly EdgeTrayTile[];
  readonly filter: string;
  readonly snap: EdgeTraySnap | null;
  readonly bumped: boolean;
  /** the nub's tooltip — the grammar in words */
  readonly hint: string;
  readonly emptyWord: string;
  readonly nubRef?: Ref<HTMLButtonElement>;
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
  return (
    <svg
      className="vf-edge-tray__glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="8" y="3" width="8" height="4" rx="1.2" />
      <path d="M16 5h1.5A2.5 2.5 0 0 1 20 7.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-11A2.5 2.5 0 0 1 6.5 5H8" />
      <path d="M8.5 12h7M8.5 16h4.5" />
    </svg>
  );
}

function PackageGlyph(): ReactElement {
  return (
    <svg
      className="vf-edge-tray__glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2.8 20 7.2v9.6l-8 4.4-8-4.4V7.2z" />
      <path d="M4.3 7.4 12 11.7l7.7-4.3M12 11.7v9.3M8 4.9l8 4.4" />
    </svg>
  );
}

function CaptureGlyph(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
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

export function EdgeTrayView(props: EdgeTrayViewProps): ReactElement {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const notchOpen = notchPath(NOTCH, false);
  const groups = DAYS.map((day) => ({
    day,
    tiles: props.items.filter((tile) => tile.day === day),
  })).filter((group) => group.tiles.length > 0);
  let dealt = 0;
  return (
    <aside
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
          onClick={props.onNubClick}
          style={
            {
              "--vf-nub-w": `${NOTCH.w}px`,
              "--vf-nub-h": `${notchHeight(NOTCH)}px`,
            } as React.CSSProperties
          }
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
          <b className="vf-edge-tray__count">{props.count}</b>
        </button>
        <div className="vf-edge-tray__inner">
          <div className="vf-edge-tray__list">
            {props.filter !== "" && (
              <div className="vf-edge-tray__filter">
                ⌕ <b>{props.filter}</b>
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
                          ⛶
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
                          ×
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
            {props.items.length === 0 && (
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
