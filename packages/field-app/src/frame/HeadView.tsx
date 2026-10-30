import type { DocRegistryEntry } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { EmptyState } from "@vibefield/design-kit/primitives";
import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { SheetShelf } from "./frame-surface";
import type { HeadCrumb } from "./head-canvas";
import { SyncQuestionView, type SyncQuestionViewProps } from "./SyncQuestionView";
import type { ViewKeys } from "./views";
import { formatZoomPercent, ZOOM_ACTS, type ZoomAct, zoomKeyLabel } from "./zoom";
import "./menu.css";
import "./head.css";

// THE HEAD (DESIGN.md §8 "The head", §10; One Frame FR-2, FR-6, §4, §6, §7;
// FC-D8, FC-D9) — controller-free, so the catalog mounts this exact markup on
// fixtures. On Canvas: the name pill centred on the window — the field's name
// and, inside a folder, the crumbs folded in, then the chevron and, after a
// rule, the package (HN-8, PL-D1) — which grows into its sheet on two
// shelves, Fields and Artifacts; the zoom readout at the right, which grows
// its menu. Under a cover the pill is the desk's and hides with it, and the
// same sheet grows on Artifacts from the package circle (PL-D2). What the
// head DOES lives in `Head.tsx`; what it shows is all props.

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

/** What the sheet's Artifacts shelf holds (HN-8; DESIGN.md §8 "Artifacts — the Artifacts
 * shelf's contents"): the Hub's own surface, hosted, while one is bound; with none bound, why
 * not — its plugin off, or starting — in words, so the shelf is never blank. */
export type HeadArtifacts =
  | { readonly state: "hub"; readonly hub: ReactNode }
  | { readonly state: "off" | "opening" };

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
  /** The sheet is out on this shelf (HN-8): the pill has grown into it. Null: the pill. */
  shelf?: SheetShelf | null;
  /** A field is loading: renaming and New field wait. */
  busy?: boolean;
  docs?: readonly HeadDocTile[];
  currentId?: string | null;
  /** The chevron and the package ask for their shelf, or null to shut the sheet: the button
   * that is on shuts it, the other opens it on its shelf or turns it there in place. */
  onShelf?: (shelf: SheetShelf | null) => void;
  /** The package's standing dot (PL-D1): the words its tooltip and name say while an artifact's
   * source is unavailable; null, no dot. */
  packageDot?: string | null;
  /** What the Artifacts shelf holds while it shows, and through its fold; null while shut. */
  artifacts?: HeadArtifacts | null;
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
  /** TS-6 (TS-D13) — the sync question, asked by New field while a link owes
   * it: drawn in the explorer in place of its tiles until it is answered or
   * cancelled. Null: the tiles. */
  question?: SyncQuestionViewProps | null;
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

/** The package (PL-D1): 28 round like the chevron, `package` 15, on while its shelf shows. Its
 * dot says a STANDING state only, and its words are the button's own tooltip and name. */
function PackageButton({
  on,
  dot,
  onPress,
}: {
  readonly on: boolean;
  readonly dot: string | null;
  readonly onPress: () => void;
}): ReactElement {
  const name = dot ?? "Artifacts";
  return (
    <button
      type="button"
      className="vf-head-pack"
      aria-label={on ? "Close the artifacts" : name}
      aria-expanded={on}
      title={on ? "Close  Esc" : name}
      onClick={onPress}
    >
      <FieldGlyph name="package" size={15} />
      {dot === null ? null : <span className="vf-head-pack-dot" aria-hidden="true" />}
    </button>
  );
}

/** With no Hub bound the shelf says why (DESIGN.md §8 "Artifacts"): its plugin is off, or it
 * is starting — said late, as History's opening words are, so a quick restart never flashes. */
function HubWaits({ waits }: { readonly waits: "off" | "opening" }): ReactElement {
  return waits === "off" ? (
    <div className="vf-head-waits" role="status">
      <EmptyState
        title="Artifacts are off"
        description="Turn on the Browser plugin in Settings › Plugins."
      />
    </div>
  ) : (
    <div className="vf-head-waits" data-late="" role="status">
      <EmptyState title="Opening Artifacts…" />
    </div>
  );
}

/** The Artifacts shelf: the Hub's, hosted at the sheet's width — a container, so the Hub's own
 * stylesheet answers it with its tiles (PL-D3) — or why it is not there. */
function ArtifactsShelf({
  shown,
  artifacts,
}: {
  readonly shown: boolean;
  readonly artifacts: HeadArtifacts | null;
}): ReactElement {
  return (
    <section
      className="vf-head-shelf vf-no-scrollbar vf-mask-fade-bottom"
      data-shelf="artifacts"
      {...(shown ? { "data-shown": "" } : {})}
      aria-label="Artifacts"
      inert={!shown}
    >
      {artifacts === null ? null : artifacts.state === "hub" ? (
        artifacts.hub
      ) : (
        <HubWaits waits={artifacts.state} />
      )}
    </section>
  );
}

/** The name pill, and the sheet it grows into on two shelves (M1: one element). */
export function HeadPlaceView({
  name,
  path = [],
  dot = null,
  renaming = null,
  renameRef,
  shelf = null,
  busy = false,
  docs = [],
  currentId = null,
  onShelf,
  packageDot = null,
  artifacts = null,
  onJump,
  onRename,
  onRenameDraft,
  onRenameEnd,
  onOpenDoc,
  onNewField,
  onToggleSync,
  onDeleteDoc,
  question = null,
  side,
}: HeadPlaceViewProps): ReactElement {
  const pathRef = useRef<HTMLDivElement>(null);
  const open = shelf !== null;
  // Turned while open (§6): the shelves change in place and the sheet never regrows — said to
  // the CSS for that change, and forgotten as the sheet shuts, so the next opening rises in.
  const [turn, setTurn] = useState({ shelf, turned: false });
  if (turn.shelf !== shelf) setTurn({ shelf, turned: turn.shelf !== null && shelf !== null });
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
      data-head-sheet=""
      data-open={open ? "true" : "false"}
      {...(turn.turned ? { "data-turned": "" } : {})}
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
          aria-label={shelf === "fields" ? "Close the fields" : "Fields"}
          aria-expanded={shelf === "fields"}
          title={shelf === "fields" ? "Close  Esc" : "Fields"}
          onClick={() => onShelf?.(shelf === "fields" ? null : "fields")}
        >
          <FieldGlyph name="chevron" size={12} turn={90} />
        </button>
        <span className="vf-head-rule" aria-hidden="true" />
        <PackageButton
          on={shelf === "artifacts"}
          dot={packageDot}
          onPress={() => onShelf?.(shelf === "artifacts" ? null : "artifacts")}
        />
      </div>
      <section
        className="vf-head-shelf vf-head-explorer vf-no-scrollbar vf-mask-fade-bottom"
        data-shelf="fields"
        {...(shelf === "fields" ? { "data-shown": "" } : {})}
        aria-label="Fields"
        inert={shelf !== "fields"}
      >
        {question !== null ? <SyncQuestionView {...question} /> : null}
        <div className="vf-head-docs" hidden={question !== null}>
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
      <ArtifactsShelf shown={shelf === "artifacts"} artifacts={artifacts} />
    </div>
  );
}

/** The same sheet under a cover (HN-8, PL-D2; DESIGN.md §8 "The head"), grown from the package
 * circle at the head's left, on Artifacts alone — Fields are the desk's and stay with the pill.
 * Its head row is the circle's own: the package, now a 28 round button and on, its glyph where
 * the circle's stood, then the shelf's name. Shut, it is the circle's own box, and unseen: the
 * circle, the frame's, stands there. */
function HeadCircleSheetView({
  open,
  packageDot,
  artifacts,
  onShut,
}: {
  readonly open: boolean;
  readonly packageDot: string | null;
  readonly artifacts: HeadArtifacts | null;
  readonly onShut: () => void;
}): ReactElement {
  return (
    <div
      className="vf-head-sheet no-drag"
      data-head-sheet=""
      data-open={open ? "true" : "false"}
      inert={!open}
    >
      <div className="vf-head-sheet-row">
        <PackageButton on={open} dot={packageDot} onPress={onShut} />
        <span className="vf-head-sheet-name">Artifacts</span>
      </div>
      <ArtifactsShelf shown={open} artifacts={artifacts} />
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
  /** A view covers the canvas, and the head goes with it (DESIGN.md §8 "The
   * covers over the desk"): it is DOM over the desk, never in the desk's blurred
   * still, so the cover's tint alone would leave the pill and the readout sharp.
   * The sheet does not (HN-8): under a cover it grows from the package circle. */
  covered?: boolean;
}

/** The whole head: the sheet's dim, the name pill at the centre, the right
 * slot — the readout alone since FR-4 (the theme went into the Me menu, and
 * Artifacts, behind the right notch until HN-8, into the pill's package) —
 * and, under a cover, the sheet the package circle grows. */
export function HeadView({ place, zoom, covered = false }: HeadViewProps): ReactElement {
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
  const shelf = place.shelf ?? null;
  const artifacts = place.artifacts ?? null;
  // Under a cover the sheet holds Artifacts alone, grown from the package circle; the pill's
  // own sheet stays shut, as the pill is the desk's and hides with it.
  const sheet = covered && shelf !== "artifacts" ? null : shelf;
  return (
    <>
      {/* The sheet's dim (§5 backdrop dim): outside the canvas's head, so it stands over a
          cover too — over the cover and under the frame (§10) — and a click on it shuts the
          sheet. */}
      <div
        className="vf-head-dim"
        data-open={sheet !== null ? "true" : "false"}
        {...(covered ? { "data-covered": "" } : {})}
        aria-hidden="true"
        onClick={() => place.onShelf?.(null)}
      />
      {/* `display: contents`: no box, so every piece keeps its place. It carries only the
          visibility the pieces inherit while a view covers the canvas. */}
      <div className="vf-head" {...(covered ? { "data-covered": "" } : {})}>
        <HeadPlaceView
          {...place}
          shelf={covered ? null : shelf}
          artifacts={covered ? null : artifacts}
          side={side}
        />
        <div
          ref={toolsRef}
          className="vf-head-tools no-drag hud-flight"
          data-hud-flight="top-right"
        >
          <HeadZoomView {...zoom} />
        </div>
      </div>
      {covered ? (
        <HeadCircleSheetView
          open={sheet === "artifacts"}
          packageDot={place.packageDot ?? null}
          artifacts={artifacts}
          onShut={() => place.onShelf?.(null)}
        />
      ) : null}
    </>
  );
}
