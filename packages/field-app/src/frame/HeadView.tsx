import type { DocRegistryEntry } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type ReactElement,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { HeadCrumb } from "./head-canvas";
import type { ViewKeys } from "./views";
import { formatZoomPercent, ZOOM_ACTS, type ZoomAct, zoomKeyLabel } from "./zoom";
import "./menu.css";
import "./head.css";

// THE HEAD (DESIGN.md §8 "The head", §10; One Frame FR-2, FR-6, §4, §6, §7;
// FC-D8, FC-D9) — controller-free, so the catalog mounts this exact markup on
// fixtures. On Canvas: the name pill centred on the window — the field's name
// and, inside a folder, the crumbs folded in — which grows into the fields
// explorer; the zoom readout at the right, which grows its menu. What the head
// DOES lives in `Head.tsx`; what it shows is all props.

/** The sync dot after the name (C6-4): a standing fact, or none. */
export interface HeadDot {
  readonly tone: "muted" | "attention";
  readonly title: string;
}

/** One tile in the explorer: the registry's entry and what its caption says. */
export interface HeadDocTile {
  readonly entry: DocRegistryEntry;
  readonly thumbnailUrl?: string;
  /** "2h ago", and the honest sync word when there is one ("· syncing"). */
  readonly caption: string;
  /** A board from BEFORE THE DESK (DK-3, ruling 7): listed, never opened — its tile says so and
   * offers Delete where the others keep their sync chip. */
  readonly beforeTheDesk?: boolean;
}

export interface HeadPlaceViewProps {
  /** The field's name — the top of the path. */
  name: string;
  /** The folders you are in under the field's top, outermost first. */
  path?: readonly HeadCrumb[];
  dot?: HeadDot | null;
  /** The name being typed while renaming in place; null when not. */
  renaming?: string | null;
  /** The rename input, so the controller can put the caret in it. */
  renameRef?: Ref<HTMLInputElement>;
  /** The explorer is out: the pill has grown into the sheet. */
  open?: boolean;
  /** A field is loading: renaming and New field wait. */
  busy?: boolean;
  docs?: readonly HeadDocTile[];
  currentId?: string | null;
  onToggle?: (open: boolean) => void;
  /** Go up to a depth (0: the field's top). */
  onJump?: (depth: number) => void;
  onRename?: () => void;
  onRenameDraft?: (text: string) => void;
  /** Leave renaming: commit what was typed, or put the name back. */
  onRenameEnd?: (commit: boolean) => void;
  onOpenDoc?: (docId: string) => void;
  onNewField?: () => void;
  onToggleSync?: (entry: DocRegistryEntry) => void;
  /** Delete a board (DS-5's tombstone) — offered on a board from before the desk. */
  onDeleteDoc?: (entry: DocRegistryEntry) => void;
  /** The slot the pill leaves free on EACH side, so it stays centred on the
   * window: the wider of the two sides (HeadView measures it). */
  side?: number;
}

const SEPARATOR = " › ";

/** FitPath (One Project, Many Places): how many leading names to drop so the
 * path fits its pill — never a name cut mid-word. A layout effect drops one
 * more while the path overflows and something is left to drop, so the pill
 * never paints overflowing. Whatever changes the ROOM starts it again from
 * none dropped: a new path or side (the key), a window that changed size, and
 * the end of the pill's own morph — closing the explorer measures at the start
 * of a 600ms shrink, when there is room to spare, so the end is measured too.
 * Returns the drop and the "start again". */
function useFitDrop(
  key: string,
  names: number,
  pathRef: { current: HTMLElement | null },
): [number, () => void] {
  const [state, setState] = useState({ key, drop: 0 });
  const drop = state.key === key ? state.drop : 0;
  useLayoutEffect(() => {
    const el = pathRef.current;
    if (el === null || el.clientWidth <= 0) return;
    if (el.scrollWidth > el.clientWidth + 0.5 && drop < names - 1) {
      setState({ key, drop: drop + 1 });
    }
  });
  const again = useCallback(() => setState({ key, drop: 0 }), [key]);
  useEffect(() => {
    window.addEventListener("resize", again);
    return () => window.removeEventListener("resize", again);
  }, [again]);
  return [drop, again];
}

function DocThumbnail({ src }: { src: string }): ReactElement {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [src]);
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
      {...(loaded ? { "data-loaded": "true" } : {})}
    />
  );
}

/** The name pill, and the explorer it grows into (M1: one element). */
export function HeadPlaceView({
  name,
  path = [],
  dot = null,
  renaming = null,
  renameRef,
  open = false,
  busy = false,
  docs = [],
  currentId = null,
  onToggle,
  onJump,
  onRename,
  onRenameDraft,
  onRenameEnd,
  onOpenDoc,
  onNewField,
  onToggleSync,
  onDeleteDoc,
  side,
}: HeadPlaceViewProps): ReactElement {
  const pathRef = useRef<HTMLDivElement>(null);
  // Open, the row heads the sheet with the field's name alone (One Frame §7).
  const names = open ? [name] : [name, ...path.map((crumb) => crumb.label)];
  const depths = open ? [0] : [0, ...path.map((crumb) => crumb.depth)];
  const [drop, fitAgain] = useFitDrop(
    `${names.join("\u0000")}|${side ?? 96}`,
    names.length,
    pathRef,
  );
  const last = names.length - 1;
  const hidden = names.slice(0, drop);

  /** A name you can go up to: the parent's says Esc, which goes up one. */
  const crumb = (index: number): ReactElement => {
    const label = names[index] ?? "";
    const where = index === 0 ? "Back to the field's top" : `Go up to ${label}`;
    return (
      <button
        type="button"
        className="vf-head-crumb"
        data-depth={depths[index]}
        title={index === last - 1 ? `${where}  Esc` : where}
        onClick={() => onJump?.(depths[index] ?? 0)}
      >
        {label}
      </button>
    );
  };
  const separator = (): ReactElement => (
    <FieldGlyph name="chevron" size={11} className="vf-head-sep" />
  );

  const here =
    last === 0 ? (
      renaming !== null ? (
        <input
          ref={renameRef}
          className="vf-head-rename"
          value={renaming}
          onChange={(event) => onRenameDraft?.(event.target.value)}
          onBlur={() => onRenameEnd?.(true)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onRenameEnd?.(true);
            } else if (event.key === "Escape") {
              // The name stands; the explorer and the canvas never hear it.
              event.preventDefault();
              event.stopPropagation();
              onRenameEnd?.(false);
            }
          }}
          placeholder="Untitled"
          aria-label="Field name"
          spellCheck={false}
        />
      ) : (
        <button
          type="button"
          className="vf-head-name"
          disabled={busy}
          title={`${name} — double-click to rename`}
          // A double-click renames; so do Return and Space on the focused
          // name (a click the keyboard makes has no count). One click does
          // nothing — the pill is where you are, not a door.
          onClick={(event) => {
            if (event.detail !== 1) onRename?.();
          }}
        >
          {name}
        </button>
      )
    ) : (
      <span className="vf-head-here" aria-current="location" title={names.join(SEPARATOR)}>
        {names[last]}
      </span>
    );

  return (
    // biome-ignore lint/a11y/useSemanticElements: the pill is a row of controls that grows into a sheet, not a fieldset of form inputs
    <div
      className="vf-head-place no-drag"
      data-head-place=""
      data-open={open ? "true" : "false"}
      role="group"
      aria-label="Where you are"
      {...(side === undefined ? {} : { style: { "--vf-head-side": `${side}px` } as CSSProperties })}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.propertyName === "width" || event.propertyName === "max-width") fitAgain();
      }}
    >
      <div className="vf-head-row">
        <div
          ref={pathRef}
          className="vf-head-path"
          data-drop={drop}
          {...(drop === last ? { "data-fit": "floor" } : {})}
        >
          {drop > 0 ? (
            <>
              <button
                type="button"
                className="vf-head-crumb"
                data-depth={depths[drop - 1]}
                title={hidden.join(SEPARATOR)}
                aria-label={`Go up to ${names[drop - 1]}`}
                onClick={() => onJump?.(depths[drop - 1] ?? 0)}
              >
                …
              </button>
              {separator()}
            </>
          ) : null}
          {names.slice(drop, last).map((label, offset) => (
            <Fragment key={`${drop + offset}-${label}`}>
              {crumb(drop + offset)}
              {separator()}
            </Fragment>
          ))}
          {here}
        </div>
        {dot === null ? null : (
          <span
            className="vf-head-dot"
            data-sync-dot=""
            data-dot={dot.tone}
            title={dot.title}
            role="img"
            aria-label={dot.title}
          />
        )}
        <button
          type="button"
          className="vf-head-chev"
          aria-label={open ? "Close the fields" : "Fields"}
          aria-expanded={open}
          title={open ? "Close  Esc" : "Fields"}
          onClick={() => onToggle?.(!open)}
        >
          <FieldGlyph name="chevron" size={12} turn={90} />
        </button>
      </div>
      <section
        className="vf-head-explorer vf-no-scrollbar vf-mask-fade-bottom"
        aria-label="Fields"
        inert={!open}
      >
        <div className="vf-head-docs">
          {/* New field — the explorer's first tile, in words (FR-3: every
              create but Canvas's carries its noun). */}
          <div className="vf-head-doc-tile">
            <button
              type="button"
              className="vf-head-doc"
              data-new=""
              title="New field"
              disabled={busy}
              onClick={() => onNewField?.()}
            >
              <span className="vf-head-doc-face">New field</span>
              {docs.length === 0 ? <span className="vf-head-doc-time">No fields yet</span> : null}
            </button>
          </div>
          {docs.map(({ entry, thumbnailUrl, caption, beforeTheDesk = false }) => {
            const current = entry.docId === currentId;
            // UA-D7: the REGISTRY's answer, never the sync stream's.
            const local = entry.syncIntent === "local";
            if (beforeTheDesk) {
              // Ruling 7: never opened, never converted — the tile names it and offers Delete.
              return (
                <div key={entry.docId} className="vf-head-doc-tile" data-before-the-desk="">
                  <div
                    className="vf-head-doc"
                    aria-disabled="true"
                    {...(current ? { "aria-current": "true" } : {})}
                    title={`${entry.name} is from before the desk — it doesn't open here`}
                  >
                    <span className="vf-head-doc-face" />
                    <span className="vf-head-doc-name">{entry.name}</span>
                    <span className="vf-head-doc-time">before the desk</span>
                  </div>
                  <button
                    type="button"
                    className="vf-head-doc-delete"
                    title={`Delete ${entry.name}`}
                    onClick={() => onDeleteDoc?.(entry)}
                  >
                    Delete
                  </button>
                </div>
              );
            }
            return (
              <div key={entry.docId} className="vf-head-doc-tile">
                <button
                  type="button"
                  className="vf-head-doc"
                  {...(current ? { "aria-current": "true" } : {})}
                  title={current ? `${entry.name} — current` : `Open ${entry.name}`}
                  onClick={() => onOpenDoc?.(entry.docId)}
                >
                  <span className="vf-head-doc-face">
                    {thumbnailUrl === undefined ? null : <DocThumbnail src={thumbnailUrl} />}
                  </span>
                  <span className="vf-head-doc-name">{entry.name}</span>
                  <span className="vf-head-doc-time">{caption}</span>
                </button>
                <button
                  type="button"
                  className="vf-head-doc-sync"
                  data-sync-intent={local ? "local" : "sync"}
                  title={
                    local
                      ? `${entry.name} stays on this device — sync it across your devices`
                      : `Keep ${entry.name} on this device`
                  }
                  onClick={() => onToggleSync?.(entry)}
                >
                  {local ? "local" : "keep local"}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export interface HeadZoomViewProps {
  /** The zoom as one number — a percent at any zoom the desk allows (`zoomPercent`). */
  percent: number;
  /** The acts that cannot move the camera now: Zoom in at the band's top, Zoom out at its foot
   * (the ENGINE's band — DK-3, ruling 5). Their rows stay, disabled. */
  unavailable?: readonly ZoomAct[];
  keys: ViewKeys;
  /** Its menu is out. */
  open?: boolean;
  /** The menu's hot row, by index. */
  hot?: number;
  readoutRef?: Ref<HTMLButtonElement>;
  onToggle?: (open: boolean) => void;
  /** A double-click fits. */
  onFit?: () => void;
  onAct?: (act: ZoomAct) => void;
  onHot?: (index: number) => void;
  onReadoutKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

/** The zoom readout (FC-D8), and the solid menu a click grows (FC-D14). */
export function HeadZoomView({
  percent,
  unavailable = [],
  keys,
  open = false,
  hot = 0,
  readoutRef,
  onToggle,
  onFit,
  onAct,
  onHot,
  onReadoutKeyDown,
}: HeadZoomViewProps): ReactElement {
  const menuId = useId();
  return (
    <div className="vf-head-zoom-at" data-head-zoom="">
      <button
        ref={readoutRef}
        type="button"
        className="vf-head-zoom"
        aria-haspopup="menu"
        aria-expanded={open}
        {...(open ? { "aria-controls": menuId } : {})}
        aria-label={`Zoom, ${formatZoomPercent(percent)}%`}
        title="Zoom · double-click to fit"
        // The second click of a double-click fits (and folds the menu its
        // first click grew); one click — or Return — grows or folds it.
        onClick={(event) => {
          if (event.detail === 2) onFit?.();
          else if (event.detail < 2) onToggle?.(!open);
        }}
        onKeyDown={onReadoutKeyDown}
      >
        {formatZoomPercent(percent)}%
      </button>
      {open ? (
        <div id={menuId} className="vf-menu vf-head-zoom-menu" role="menu" aria-label="Zoom">
          {ZOOM_ACTS.map((entry, index) => (
            <button
              key={entry.act}
              type="button"
              role="menuitem"
              className="vf-menu-row"
              data-act={entry.act}
              tabIndex={-1}
              disabled={unavailable.includes(entry.act)}
              {...(index === hot ? { "data-hot": "true" } : {})}
              // The readout keeps the keyboard while a row is pointed at.
              onMouseDown={(event) => event.preventDefault()}
              onPointerEnter={() => onHot?.(index)}
              onClick={() => onAct?.(entry.act)}
            >
              <span className="vf-menu-label">{entry.name}</span>
              <kbd className="vf-menu-key">{zoomKeyLabel(entry.act, keys)}</kbd>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export interface HeadViewProps {
  place: HeadPlaceViewProps;
  zoom: HeadZoomViewProps;
}

/** The whole head: the explorer's dim, the name pill at the centre, and the
 * right slot — the readout alone since FR-4 (the theme went into the Me menu,
 * Artifacts behind the right notch). */
export function HeadView({ place, zoom }: HeadViewProps): ReactElement {
  const toolsRef = useRef<HTMLDivElement>(null);
  // The pill stays centred on the window, so it gives up the WIDER side's
  // slot on both sides: the lights' 96 on the left, the right slot as wide as
  // it stands (+ 12 clear) — measured, because the readout's digits decide it.
  const [right, setRight] = useState(0);
  useLayoutEffect(() => {
    const tools = toolsRef.current;
    if (tools === null) return;
    const measure = (): void => setRight(Math.ceil(tools.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(tools);
    return () => observer.disconnect();
  }, []);
  const side = Math.max(96, right + 16 + 12);
  return (
    <>
      <div
        className="vf-head-dim"
        data-open={place.open === true ? "true" : "false"}
        aria-hidden="true"
        onClick={() => place.onToggle?.(false)}
      />
      <HeadPlaceView {...place} side={side} />
      <div ref={toolsRef} className="vf-head-tools no-drag hud-flight" data-hud-flight="top-right">
        <HeadZoomView {...zoom} />
      </div>
    </>
  );
}
