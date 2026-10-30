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
import type { HubWait } from "./head-artifacts";
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
 * not — its plugin off or unable to run, the Hub opening or not starting — in words, so the
 * shelf is never blank. */
export type HeadArtifacts =
  | { readonly state: "hub"; readonly hub: ReactNode }
  | { readonly state: HubWait };

/** The sheet's fold back into the pill, the circle or the bar (§8: 600ms on the island curve):
 * what it holds stays through it, so it never folds away empty. */
export const SHEET_FOLD_MS = 600;

/** True while `on`, and for `ms` after it goes off: what a fold carries away. */
export function useLingering(on: boolean, ms: number): boolean {
  const [lingering, setLingering] = useState(on);
  if (on && !lingering) setLingering(true);
  useEffect(() => {
    if (on) return;
    const timer = window.setTimeout(() => setLingering(false), ms);
    return () => window.clearTimeout(timer);
  }, [on, ms]);
  return on || lingering;
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

/** The package (PL-D1): 28 round like the chevron, on while its shelf shows — `package` 15 in the
 * pill's row, and the circle's 18 in the covered sheet's, which stands in the circle's place (§8
 * "The head"). Its dot says a STANDING state only, and its words are the button's own tooltip and
 * name. */
function PackageButton({
  on,
  dot,
  glyph,
  onPress,
}: {
  readonly on: boolean;
  readonly dot: string | null;
  readonly glyph: 15 | 18;
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
      <FieldGlyph name="package" size={glyph} />
      {dot === null ? null : <span className="vf-head-pack-dot" aria-hidden="true" />}
    </button>
  );
}

/** What the shelf says with no Hub bound, and under it, where there is one, what to do. */
interface WaitWords {
  readonly title: string;
  readonly description?: string;
}

/** The words of each wait (DESIGN.md §8 "Artifacts"). */
const HUB_WAIT_WORDS: Record<HubWait, WaitWords> = {
  off: {
    title: "Artifacts are off",
    description: "Turn on the Browser plugin in Settings › Plugins.",
  },
  "cant-run": {
    title: "Artifacts can't run",
    description: "The Browser plugin can't run in this VibeField — see Settings › Plugins.",
  },
  opening: { title: "Opening Artifacts…" },
  "not-starting": {
    title: "Artifacts aren't starting",
    description: "Turn the Browser plugin off and on in Settings › Plugins.",
  },
};

/** How long the words a wait leaves stay while they fade out under the new ones (head.css: the
 * turn's 180ms `ease`). */
const HUB_WAIT_TURN_MS = 180;

/** With no Hub bound the shelf says why (DESIGN.md §8 "Artifacts"): its plugin is off or can't
 * run, the Hub is opening — said late, as History's opening words are, so a quick restart never
 * flashes it — or, still opening after 10 s, it isn't starting. That last turn is made in place:
 * the words it leaves fade out as the new ones fade in, and then go; every other change of words
 * is at once, and the Hub, binding, takes the shelf the moment it does. */
function HubWaits({ waits }: { readonly waits: HubWait }): ReactElement {
  const [said, setSaid] = useState(waits);
  const [leaving, setLeaving] = useState<HubWait | null>(null);
  if (said !== waits) {
    setSaid(waits);
    setLeaving(said === "opening" && waits === "not-starting" ? said : null);
  }
  useEffect(() => {
    if (leaving === null) return;
    const timer = window.setTimeout(() => setLeaving(null), HUB_WAIT_TURN_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  const face = (wait: HubWait, left: boolean): ReactElement => {
    const words = HUB_WAIT_WORDS[wait];
    return (
      <div
        key={wait}
        className="vf-head-waits-face"
        {...(left ? { "data-leaving": "", "aria-hidden": true } : {})}
      >
        <EmptyState title={words.title} description={words.description} />
      </div>
    );
  };
  return (
    <div
      className="vf-head-waits"
      {...(waits === "opening" ? { "data-late": "" } : {})}
      {...(leaving === null ? {} : { "data-turning": "" })}
      role="status"
    >
      {leaving === null ? null : face(leaving, true)}
      {face(waits, false)}
    </div>
  );
}

/** The Artifacts shelf: the Hub's, hosted in a box pinned at the OPEN sheet's inner width — a
 * container, so the Hub's own stylesheet answers it with its tiles (PL-D3), and one the sheet's
 * morph clips rather than narrows, so the Hub never reflows while the sheet grows or folds — or
 * why it is not there. Unlike Fields it has no fade at its foot: the Hub's buttons are never
 * faded (§8 "The head"). */
function ArtifactsShelf({
  shown,
  artifacts,
}: {
  readonly shown: boolean;
  readonly artifacts: HeadArtifacts | null;
}): ReactElement {
  return (
    <section
      className="vf-head-shelf vf-no-scrollbar"
      data-shelf="artifacts"
      {...(shown ? { "data-shown": "" } : {})}
      aria-label="Artifacts"
      inert={!shown}
    >
      <div className="vf-head-hub">
        {artifacts === null ? null : artifacts.state === "hub" ? (
          artifacts.hub
        ) : (
          <HubWaits waits={artifacts.state} />
        )}
      </div>
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
  // Folded, once it shuts: reduced motion fades the sheet out at its size before it is the pill
  // again (M6), which a pill that was never a sheet — the first paint — must not do.
  const [turn, setTurn] = useState({ shelf, turned: false, folded: false });
  if (turn.shelf !== shelf) {
    setTurn({
      shelf,
      turned: turn.shelf !== null && shelf !== null,
      folded: turn.shelf !== null && shelf === null,
    });
  }
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
      {...(turn.folded ? { "data-folded": "" } : {})}
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
          glyph={15}
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
 * circle at the head's left — or, while Godview's terminals are maximized, from the bar's own
 * control — on Artifacts alone: Fields are the desk's and stay with the pill. Its head row is the
 * circle's own: the package, now a 28 round button and on, holding the circle's 18 where the
 * circle held it, its dot where the circle's is, then the shelf's name. Shut, it is the circle's
 * own box (the bar control's, `bar`), and unseen: the circle, the frame's, stands there. */
function HeadCircleSheetView({
  open,
  bar,
  packageDot,
  artifacts,
  onShut,
}: {
  readonly open: boolean;
  readonly bar: boolean;
  readonly packageDot: string | null;
  readonly artifacts: HeadArtifacts | null;
  readonly onShut: () => void;
}): ReactElement {
  return (
    <div
      className="vf-head-sheet no-drag"
      data-head-sheet=""
      data-open={open ? "true" : "false"}
      {...(bar ? { "data-bar": "" } : {})}
      inert={!open}
    >
      <div className="vf-head-sheet-row">
        <PackageButton on={open} dot={packageDot} glyph={18} onPress={onShut} />
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
  /** Godview's terminals are maximized and the package stands in their title
   * bar (PL-D2 with GV-D11): the covered sheet is shut into the bar's own
   * control, so it grows out of it and folds back into it (§8 "The head"). */
  bar?: boolean;
}

/** The whole head: the sheet's dim, the name pill at the centre, the right
 * slot — the readout alone since FR-4 (the theme went into the Me menu, and
 * Artifacts, behind the right notch until HN-8, into the pill's package) —
 * and, under a cover and through its fold after one, the sheet the package
 * circle grows. */
export function HeadView({
  place,
  zoom,
  covered = false,
  bar = false,
}: HeadViewProps): ReactElement {
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
  const pillOpen = !covered && shelf !== null;
  const circleOpen = covered && shelf === "artifacts";
  // The Hub stays in the sheet that showed it — through that sheet's fold, also when a change
  // of view folds it — and never moves to the other, where it would mount afresh (§8 "The head").
  const showsIn = shelf !== "artifacts" ? null : covered ? "circle" : "pill";
  const [hubIn, setHubIn] = useState<"pill" | "circle">(showsIn ?? "pill");
  if (showsIn !== null && showsIn !== hubIn) setHubIn(showsIn);
  // The covered sheet folds over its 600ms also as the cover lowers, so it stays for its fold.
  const circleSheet = useLingering(covered, SHEET_FOLD_MS);
  return (
    <>
      {/* The sheet's dim (§5 backdrop dim): outside the canvas's head, so it can stand over a
          cover — over the cover and under the frame (§10), and only while the covered sheet
          shows: it follows the sheet it dims — and a click on it shuts the sheet. */}
      <div
        className="vf-head-dim"
        data-open={pillOpen || circleOpen ? "true" : "false"}
        {...(circleOpen ? { "data-covered": "" } : {})}
        aria-hidden="true"
        onClick={() => place.onShelf?.(null)}
      />
      {/* `display: contents`: no box, so every piece keeps its place. It carries only the
          visibility the pieces inherit while a view covers the canvas. */}
      <div className="vf-head" {...(covered ? { "data-covered": "" } : {})}>
        <HeadPlaceView
          {...place}
          shelf={covered ? null : shelf}
          artifacts={hubIn === "pill" ? artifacts : null}
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
      {circleSheet ? (
        <HeadCircleSheetView
          open={circleOpen}
          bar={bar}
          packageDot={place.packageDot ?? null}
          artifacts={hubIn === "circle" ? artifacts : null}
          onShut={() => place.onShelf?.(null)}
        />
      ) : null}
    </>
  );
}
