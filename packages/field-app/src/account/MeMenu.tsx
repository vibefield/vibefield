import type {
  ThemeName,
  ThemePreference,
  UpdateConsentWords,
  UpdateView,
} from "@vibefield/contracts";
import { faceLiftHostClass, UserFaceView } from "@vibefield/design-kit/face";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { SegmentedControl, UiButton } from "@vibefield/design-kit/primitives";
import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { leaveFor } from "../boot/switch";
import { roundButtonCls } from "../field/theme-constants";
import { getHost } from "../host";
import { errorText, NO_FLOW, type UpdatesFlow, useUpdateRestart } from "../panels/update-flow";
import {
  downloadRefusalFallback,
  type MeUpdateAct,
  type MeUpdateLocal,
  type MeUpdateRow,
  meUpdateRow,
  notAppliedNotice,
  readyClause,
  refusalLine,
  updateWaits,
} from "../panels/update-words";
import { setAppTheme, THEME_LABELS, themeChoice, themeLabel, useAppTheme } from "../theme";
import { CONNECT_ROW_LABEL } from "./link";
import {
  type AccountMe,
  type AccountPerson,
  refusalSentence,
  useAccountSnapshot,
} from "./use-account";
import { useLinkDoor } from "./use-link-door";
import "./MeMenu.css";

// The Me menu (UA-D19; DESIGN.md §8 "The Me menu") — the owner's face in the
// corner, and the account's one door.
//
// The face sits in the corner, centred on the foot axis, and NEVER MOVES (M2):
// the second click lands on the same face and folds the menu. Since One Frame
// FR-4 the menu opens ABOVE the line, never around the face (FC-D14 — a menu
// never covers the frame): one panel, grown upward on the island's curve from
// a seed at its own foot, above the face (M1). It reads bottom-up, nearest
// first: you · the update row (AU-2) · Settings… · Theme (the app's one theme
// control, FC-D5) · Link… (unlinked only) · New user… · then the other users.
//
// AU-2 (AU-D1…D7, D11, D14; DESIGN.md §8 "The Me menu") — the menu always
// carries one row about the app itself, nearest the face: it checks, downloads
// and restarts IN PLACE, a restart that ends sessions grows the panel into
// main's own question, and while an install waits on you the face wears a cyan
// dot beside it (never on it, I-5) that pops in once and never pulses.
//
// Split like every runtime-bound view (UI_SYSTEM.md): `MeMenuView` owns the
// DOM, motion, keyboard and focus and takes plain data; `MeMenu` is the
// controller that reads the account and runs the acts.

/** The app's theme as the Theme row draws it: the choice, and what it
 * resolves to (the row's sun or moon). */
export interface MeMenuTheme {
  readonly preference: ThemePreference;
  readonly resolved: ThemeName;
}

/** AU-2 — the update as the menu draws it: plain data, so the catalog builds it
 * with the shipping words (`meUpdateRow`). */
export interface MeMenuUpdate {
  readonly row: MeUpdateRow;
  /** an install waits on you (`updateWaits`): the dot beside the face
   * (AU-D1, AU-D2) — a waiting count outranks it in the badge's one slot */
  readonly mark: boolean;
  /** the face's title clause while it wears the dot: "the Oct 28 nightly is ready" */
  readonly markTitle?: string;
  /** the install that didn't take, said once (shown only while no refusal is) */
  readonly notice?: string | null;
  /** AU-D6 — the question, in main's words, while it stands; `busy` while the
   * confirm is in flight */
  readonly ask?: { readonly words: UpdateConsentWords; readonly busy: boolean } | null;
  /** said to assistive tech when an in-place check answers */
  readonly announce?: string | null;
}

export interface MeMenuViewProps {
  me: AccountMe;
  others: readonly AccountPerson[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Settings… opens Settings on General, as ⌘, does. */
  onOpenSettings: () => void;
  /** Your name and login open Settings → Account. */
  onOpenAccount: () => void;
  /** Connect your devices… (offered only while this Mac is not connected)
   * STARTS the link (One Frame F16; TS-D1 its words): the menu folds and the
   * controller asks the daemon. */
  onLink: () => void;
  /** Absent: this host cannot switch, and the rows say nothing false. `from`
   * is the row that was pressed — the switch carries its face (§8). */
  onSwitch?: ((userId: string, from?: Element) => void) | undefined;
  onNewUser?: (() => void) | undefined;
  /** The app's one theme (FC-D5). Absent with its setter: no Theme row. */
  theme?: MeMenuTheme | undefined;
  /** Choose a theme. The menu stays open — the app changes behind it. */
  onThemeChange?: ((preference: ThemePreference) => void) | undefined;
  /** A switch or create is in flight: the window is about to reload. */
  busy?: boolean;
  /** The Settings chord as this platform spells it. */
  shortcut?: string;
  /** A switch, a new user or a link main or the daemon refused, in its words:
   * said at the top of the menu (and to assistive tech) until it next folds. */
  notice?: string | null;
  /** AU-2 (AU-D4 B) — the update's row, the face's dot and the in-menu
   * question. Absent: no row (the window doesn't know the desktop's state yet). */
  update?: MeMenuUpdate | undefined;
  /** A row act: `open` and `notes` arrive after the menu folds (Settings →
   * Updates; AU-6: at the release's notes); the rest keep it open — the
   * check, the restart and the download happen in place. */
  onUpdate?: ((act: Exclude<MeUpdateAct, "none">) => void) | undefined;
  /** The question's act, on the snapshot it shows. */
  onUpdateConfirm?: (() => void) | undefined;
  /** The question's Cancel (or Esc): back to the rows. */
  onUpdateCancel?: (() => void) | undefined;
  className?: string;
}

const MENU_WIDTH = 256;
/** AU-D6 — the panel grows to this on the island curve for the update's
 * question (§6), and back on Cancel or Esc. */
const ASK_WIDTH = 320;
/** The seed: the face's 44px plus the 6px it sits inside on every side — the
 * size the panel grows from, at its own foot. */
const SEED = 56;

function MenuIcon({ name }: { name: "gear" | "person" | "link" | "sun" | "moon" }): ReactElement {
  return <FieldGlyph name={name} size={18} />;
}

/** One row's reveal delay: nearest first, 160ms + 26ms per row, capped at
 * 400ms (§6's stagger constants). `fromNearest` counts up from the bottom. */
const revealDelay = (fromNearest: number): number => 160 + Math.min(fromNearest * 26, 400);

/** The question's lines, and the rows coming back from it, rise nearest-first
 * once the face they replace has faded, at the rows' 26ms stagger and its cap
 * (DESIGN.md §6, AU-D6). */
const riseDelay = (fromNearest: number): number => Math.min(fromNearest * 26, 400);

/** AU-D6 (§6) — the beat the face going out takes: the rows fade over it
 * before the question is drawn, and the question before the rows come back. */
const SWAP_MS = 120;

/** The question as the menu draws it. */
type MeMenuAsk = NonNullable<MeMenuUpdate["ask"]>;

const AT_REST: MeUpdateLocal = { kind: "rest" };
/** A folded menu's question stays drawn while the panel folds, then goes. */
const FOLD_MS = 700;

/** The row's flow: main's restart phases outrank the row's own click. */
function rowLocalOf(flow: UpdatesFlow, local: MeUpdateLocal): MeUpdateLocal {
  switch (flow.kind) {
    case "preparing":
      return { kind: "preparing" };
    case "confirming":
      return { kind: "confirming" };
    case "restarting":
      return { kind: "restarting" };
    default:
      return local;
  }
}

export function MeMenuView({
  me,
  others,
  open,
  onOpenChange,
  onOpenSettings,
  onOpenAccount,
  onLink,
  onSwitch,
  onNewUser,
  theme,
  onThemeChange,
  busy = false,
  shortcut = "⌘,",
  notice = null,
  update,
  onUpdate,
  onUpdateConfirm,
  onUpdateCancel,
  className = "",
}: MeMenuViewProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  const leadId = useId();
  const [panelHeight, setPanelHeight] = useState(SEED);
  /** Opened from the keyboard: land focus on the nearest item once it shows. */
  const focusOnOpen = useRef(false);
  /** Folding because Tab is leaving: focus is on its way somewhere else. */
  const tabbingOut = useRef(false);
  const wasOpen = useRef(open);
  const waiting = others.reduce((sum, person) => sum + person.waiting, 0);
  // AU-D6 — the update's question replaces the rows while it stands
  const ask = update?.ask ?? null;
  const asking = ask !== null;
  const askBusy = ask?.busy === true;

  // AU-D6 (DESIGN.md §6) — what the list draws: the rows, or the question in
  // the words it last stood in. Inside a menu that was already open, the face
  // going out fades for one beat (`leaving`) before the other is drawn: the
  // rows before the question's lines rise, the question before the rows rise
  // back (`returning`) — Esc reverses it. A folded or just-opened menu swaps at
  // once, so a question never lingers into an open. Adjusted while rendering
  // (React's "information from previous renders"), so the commit that opens
  // the menu already draws what it lands focus on.
  const [drawn, setDrawn] = useState<MeMenuAsk | null>(ask);
  const [leaving, setLeaving] = useState<"fading" | "done" | null>(null);
  const [returning, setReturning] = useState(false);
  const [openBefore, setOpenBefore] = useState(open);
  if (openBefore !== open) setOpenBefore(open);
  if (asking === (drawn !== null)) {
    // the same face: the question keeps main's latest (a confirm going busy),
    // and a beat toward the other face is called off (Esc while the rows fade)
    if (ask !== null && (ask.words !== drawn?.words || ask.busy !== drawn?.busy)) setDrawn(ask);
    if (leaving !== null) setLeaving(null);
  } else if (open && openBefore) {
    if (leaving === null) {
      setLeaving("fading");
      if (returning) setReturning(false);
    } else if (leaving === "done") {
      setDrawn(ask);
      setLeaving(null);
      setReturning(ask === null);
    }
  } else {
    setDrawn(ask);
    if (leaving !== null) setLeaving(null);
  }
  if (!open && returning) setReturning(false);
  useEffect(() => {
    if (leaving !== "fading") return;
    const timer = setTimeout(() => setLeaving((now) => (now === "fading" ? "done" : now)), SWAP_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  const drawnAsking = drawn !== null;

  // AU-D1 (I-5) — one slot, one badge: a waiting count outranks the update's
  // dot. The dot pops in once, only when the slot goes from empty to the dot
  // after the first render that knows the update — the desktop's state can
  // land after the account, and a dot already waiting then never pops;
  // returning after a count clears, it comes back without a pop (and it never
  // pulses, AU-L3).
  const markShown = update?.mark === true && waiting === 0;
  const badge = waiting > 0 ? "count" : markShown ? "dot" : null;
  const known = update !== undefined;
  const lastBadge = useRef<typeof badge | "unknown">(known ? badge : "unknown");
  const [pop, setPop] = useState(false);
  useLayoutEffect(() => {
    if (!known) return;
    if (badge === "dot" && lastBadge.current === null) setPop(true);
    else if (badge !== "dot") setPop(false);
    lastBadge.current = badge;
  }, [badge, known]);

  // The question takes focus on Cancel the moment it is drawn (nothing ends
  // by accident); when it goes — Cancel, Esc, main's answer — focus comes back
  // to the update row, never dropped (DESIGN.md §8 "The question"). Only in a
  // menu that stayed open: a fold gives focus to the face, and an open lands
  // where it always does, on Settings… (AU-D5).
  const focusSeen = useRef({ asking: drawnAsking, open });
  useLayoutEffect(() => {
    const was = focusSeen.current;
    focusSeen.current = { asking: drawnAsking, open };
    if (was.asking === drawnAsking || !open || !was.open) return;
    const target = drawnAsking
      ? cancelRef.current
      : rootRef.current?.querySelector<HTMLElement>("[data-me-update]");
    target?.focus({ preventScroll: true });
  }, [drawnAsking, open]);

  // The panel's open height is its content's, measured — the rows are real
  // DOM at rest (invisible, inert), so the grow always has a true target.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const measure = (): void => setPanelHeight(Math.max(SEED, list.offsetHeight));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  /** The stops ↑ ↓ walk, in the order they stand: every live row, and the
   * Theme row once — at the theme it holds. */
  const items = useCallback(
    (): HTMLElement[] =>
      Array.from(
        rootRef.current?.querySelectorAll<HTMLElement>(
          '[role="menuitem"], [data-me-theme] button[aria-pressed="true"]',
        ) ?? [],
      ).filter((item) => !(item as HTMLButtonElement).disabled),
    [],
  );

  // Keyboard-opened: focus the NEAREST item (Settings…, just above you) once
  // the rows can take focus.
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    rootRef.current
      ?.querySelector<HTMLElement>("[data-me-nearest]")
      ?.focus({ preventScroll: true });
  }, [open]);

  // A click anywhere else folds the menu — pointerdown, capture phase, so the
  // canvas under it never has to know a menu was open. Esc folds it from
  // ANYWHERE, not only from inside the rows: a menu opened with the pointer
  // leaves focus on the face, outside them. Capture + stopImmediatePropagation,
  // as the pill's sheet does, so the field's own Esc (leave a container) waits
  // for the next press.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return;
      onOpenChange(false);
    };
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // AU-D6 — Esc goes back from the question to the rows first (a confirm
      // in flight holds it); the next Esc folds the menu
      if (asking) {
        if (!askBusy) onUpdateCancel?.();
        return;
      }
      onOpenChange(false);
      faceRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onEscape, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onEscape, true);
    };
  }, [open, onOpenChange, asking, askBusy, onUpdateCancel]);

  // Folded from OUTSIDE while focus was on a row — ⌘, or another of the
  // frame's surfaces — the rows go inert, so focus comes back to the face
  // first. Settings records what had focus as it opens and returns it there on
  // close. A click outside moves focus itself, after this; Tab is left alone.
  useLayoutEffect(() => {
    const folded = wasOpen.current && !open;
    wasOpen.current = open;
    if (!folded) return;
    if (tabbingOut.current) {
      tabbingOut.current = false;
      return;
    }
    const active = document.activeElement;
    const panel = rootRef.current?.querySelector(".vf-me-panel");
    if (active instanceof HTMLElement && panel?.contains(active)) {
      faceRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  const focusNearest = (): void => {
    rootRef.current
      ?.querySelector<HTMLElement>("[data-me-nearest]")
      ?.focus({ preventScroll: true });
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // On Theme, ← → choose — the kit's segmented control's own keys since R19 (DK-13: it chooses, the focus with
    // the choice, as a radio's does, and claims the key), so a key it took is not the menu's to walk with.
    if (event.defaultPrevented) return;
    // AU-D6 — a face on its way out takes no keys: focus waits where it is for
    // the beat, and Tab never leaves an open menu mid-swap
    if (leaving !== null) {
      if (event.key === "Tab") event.preventDefault();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    if (drawnAsking && event.key === "Tab") {
      // AU-D6 — the question holds Tab: it walks Cancel ↔ the act, and the
      // menu stays open
      const acts = Array.from(
        rootRef.current?.querySelectorAll<HTMLButtonElement>(".vf-me-ask-acts button") ?? [],
      ).filter((button) => !button.disabled);
      const first = acts[0];
      const last = acts[acts.length - 1];
      if (event.shiftKey ? active === first : active === last) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus({ preventScroll: true });
      }
      return;
    }
    const list = items();
    const index = list.indexOf(active as HTMLElement);
    const move = (to: number): void => {
      // the question has no rows to walk
      if (list.length === 0) return;
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus({ preventScroll: true });
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index < 0 ? list.length - 1 : index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(list.length - 1);
    else if (event.key === "Tab") {
      // The menu pattern: Tab leaves, and the menu goes with it.
      tabbingOut.current = true;
      onOpenChange(false);
    }
  };

  /** Run an act, folding the menu first. Focus goes back to the face BEFORE
   * the act: Settings remembers what had focus when it opened and returns it
   * on close, and a row of a folded menu is inert — the face is the one thing
   * left to come back to. */
  const act = (run: () => void): void => {
    faceRef.current?.focus({ preventScroll: true });
    onOpenChange(false);
    run();
  };

  // Rows, top to bottom as they stand on screen. Delays count up from the
  // bottom (nearest first), so they are assigned after the list is known.
  type Row = { key: string; node: (delay: number) => ReactElement };
  const rows: Row[] = [];
  // One notice row at most: a refusal answers what you just did, so it
  // outranks the install that didn't take (AU-D11).
  const shownNotice = notice ?? update?.notice ?? null;
  if (shownNotice !== null) {
    rows.push({
      key: "notice",
      node: (delay) => (
        <div
          className="vf-me-notice"
          role="presentation"
          style={{ "--vf-me-delay": `${delay}ms` } as CSSProperties}
        >
          {shownNotice}
        </div>
      ),
    });
  }
  if (others.length > 0) {
    rows.push({
      key: "eyebrow",
      node: (delay) => (
        <div
          className="vf-me-eyebrow"
          role="presentation"
          style={{ "--vf-me-delay": `${delay}ms` } as CSSProperties}
        >
          Switch to
        </div>
      ),
    });
    for (const person of others) {
      rows.push({
        key: `user-${person.userId}`,
        node: (delay) => (
          <button
            type="button"
            role="menuitem"
            className={`vf-me-row vf-me-row--person ${faceLiftHostClass}`}
            disabled={onSwitch === undefined || busy}
            tabIndex={-1}
            style={{ "--vf-me-delay": `${delay}ms` } as CSSProperties}
            aria-label={`Switch to ${person.name}${person.waiting > 0 ? `, ${person.waiting} waiting` : ""}`}
            onClick={(event) => {
              const from = event.currentTarget;
              act(() => onSwitch?.(person.userId, from));
            }}
          >
            <span className="vf-me-slot">
              <UserFaceView
                emoji={person.face.emoji}
                frame={person.face.frame}
                size={26}
                seed={person.userId}
              />
            </span>
            <span className="vf-me-row-label">{person.name}</span>
            {person.waiting > 0 && (
              <span className="vf-me-row-end">
                <span className="vf-me-waiting-dot" aria-hidden="true" />
                <span>
                  <span className="tabular-nums">{person.waiting}</span> waiting
                </span>
              </span>
            )}
          </button>
        ),
      });
    }
    rows.push({
      key: "sep-people",
      node: (delay) => (
        <hr
          className="vf-me-separator"
          style={{ "--vf-me-delay": `${delay}ms` } as CSSProperties}
        />
      ),
    });
  }
  if (onNewUser !== undefined) {
    rows.push({
      key: "new-user",
      node: (delay) => (
        <button
          type="button"
          role="menuitem"
          className="vf-me-row"
          disabled={busy}
          tabIndex={-1}
          style={{ "--vf-me-delay": `${delay}ms` } as CSSProperties}
          onClick={() => act(onNewUser)}
        >
          <span className="vf-me-slot vf-me-icon">
            {/* A person, not a plus (One Frame FR-3: one plus on screen). */}
            <MenuIcon name="person" />
          </span>
          <span className="vf-me-row-label">New user…</span>
        </button>
      ),
    });
  }
  if (me.canLink) {
    rows.push({
      key: "link",
      node: (delay) => (
        <button
          type="button"
          role="menuitem"
          className="vf-me-row"
          tabIndex={-1}
          style={{ "--vf-me-delay": `${delay}ms` } as CSSProperties}
          onClick={() => act(onLink)}
        >
          <span className="vf-me-slot vf-me-icon">
            <MenuIcon name="link" />
          </span>
          <span className="vf-me-row-label">{CONNECT_ROW_LABEL}</span>
        </button>
      ),
    });
  }
  if (theme !== undefined && onThemeChange !== undefined) {
    rows.push({
      key: "theme",
      node: (delay) => (
        <div
          className="vf-me-row vf-me-row--theme"
          data-me-theme=""
          style={{ "--vf-me-delay": `${delay}ms` } as CSSProperties}
        >
          <span className="vf-me-slot vf-me-icon">
            <MenuIcon name={theme.resolved === "dark" ? "moon" : "sun"} />
          </span>
          <span className="vf-me-row-label">Theme</span>
          <SegmentedControl
            options={THEME_LABELS}
            value={themeLabel(theme.preference)}
            onChange={(option) => onThemeChange(themeChoice(option))}
            label="Theme"
            size="small"
            className="vf-me-theme"
          />
        </div>
      ),
    });
  }
  rows.push({
    key: "settings",
    node: (delay) => (
      <button
        type="button"
        role="menuitem"
        className="vf-me-row"
        data-me-nearest=""
        tabIndex={-1}
        style={{ "--vf-me-delay": `${delay}ms` } as CSSProperties}
        onClick={() => act(onOpenSettings)}
      >
        <span className="vf-me-slot vf-me-icon">
          <MenuIcon name="gear" />
        </span>
        <span className="vf-me-row-label">Settings…</span>
        <kbd className="vf-me-row-end vf-me-kbd">{shortcut}</kbd>
      </button>
    ),
  });
  if (update !== undefined) {
    // AU-2 (AU-D4 B, AU-D5) — the app's own row, always, nearest the face:
    // directly above you, under Settings… — which keeps `data-me-nearest`, so
    // Return lands there and a double Return never restarts. A row that can't
    // act now is `aria-disabled`, never `disabled`: it keeps its place in the
    // arrows' walk and never drops focus.
    const row = update.row;
    const rowAct = row.act;
    const inert = rowAct === "none" || busy;
    rows.push({
      key: "update",
      node: (delay) => (
        <button
          type="button"
          role="menuitem"
          className="vf-me-row vf-me-row--update"
          data-me-update=""
          aria-disabled={inert ? true : undefined}
          tabIndex={-1}
          style={{ "--vf-me-delay": `${delay}ms` } as CSSProperties}
          onClick={() => {
            // a second press while the rows fade into the question asks nothing twice
            if (rowAct === "none" || busy || leaving !== null) return;
            // Settings → Updates folds the menu first (What's new too: it
            // opens the page at the notes); the check, the restart and the
            // download happen where the row stands
            if (rowAct === "open" || rowAct === "notes") act(() => onUpdate?.(rowAct));
            else onUpdate?.(rowAct);
          }}
        >
          <span className="vf-me-slot vf-me-icon">
            <FieldGlyph name={row.glyph} size={18} turn={row.turn} />
          </span>
          <span className="vf-me-update-lines">
            <span className="vf-me-update-label" data-tone={row.labelTone}>
              {row.label}
            </span>
            <span className="vf-me-update-detail" data-tone={row.detailTone}>
              {row.detail}
            </span>
            {row.note !== undefined && (
              <span className="vf-me-update-note" data-tone={row.note.tone}>
                {row.note.text}
              </span>
            )}
          </span>
          {row.dot && (
            <span className="vf-me-row-end">
              <span className="vf-me-update-dot" aria-hidden="true" />
            </span>
          )}
          {/* The 2px bar moves on real progress only, never a loop; its width is
              the one inline style (UI_SYSTEM "Rules for new UI"). */}
          {row.progress !== undefined && (
            <span className="vf-me-update-bar" aria-hidden="true">
              <span style={{ width: `${Math.round(row.progress)}%` }} />
            </span>
          )}
        </button>
      ),
    });
  }
  rows.push({
    key: "you",
    node: (delay) => (
      <button
        type="button"
        role="menuitem"
        className="vf-me-you"
        tabIndex={-1}
        style={{ "--vf-me-delay": `${delay}ms` } as CSSProperties}
        aria-label={`${me.name}${me.detail.length > 0 ? `, ${me.detail}` : ""} — account settings`}
        onClick={() => act(onOpenAccount)}
      >
        <span className="vf-me-you-name">{me.name}</span>
        {me.detail.length > 0 && (
          <span
            className={`vf-me-you-detail${me.detailIsLogin ? " vf-ui-mono" : ""}`}
            data-tone={me.detailTone === "attention" ? "attention" : undefined}
          >
            {me.detail}
          </span>
        )}
      </button>
    ),
  });

  const panelStyle = {
    "--vf-me-width": `${asking ? ASK_WIDTH : MENU_WIDTH}px`,
    "--vf-me-height": `${panelHeight}px`,
  } as CSSProperties;
  // The face the list draws keeps its own width while the panel grows or
  // shrinks to the other's, so nothing reflows as it fades (AU-D6).
  const listStyle = {
    "--vf-me-width": `${drawnAsking ? ASK_WIDTH : MENU_WIDTH}px`,
  } as CSSProperties;

  // The face's names (AU-D1): its title and its accessible name say the dot
  // in words — the waiting clause first.
  const waitingLabel = waiting > 0 ? `, ${waiting} waiting in another user` : "";
  const markLabel = update?.mark === true ? ", an update is ready to install" : "";
  const markTitle =
    update?.mark === true && update.markTitle !== undefined ? ` · ${update.markTitle}` : "";

  return (
    <div
      ref={rootRef}
      className={`vf-me ${className}`.trim()}
      data-open={open ? "" : undefined}
      data-busy={busy ? "" : undefined}
    >
      <button
        ref={faceRef}
        type="button"
        className={`vf-me-face ${faceLiftHostClass}`}
        // Where a switch's face comes home (DESIGN.md §8 "The switch").
        data-vf-switch-home={me.userId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${me.name}: account menu${waitingLabel}${markLabel}`}
        title={`${me.name} · Account${markTitle}`}
        onClick={(event) => {
          // A keyboard click (Enter/Space) arrives with no pointer detail.
          focusOnOpen.current = !open && event.detail === 0;
          onOpenChange(!open);
        }}
        onKeyDown={(event) => {
          // The menu button pattern: an arrow on the face goes into the menu,
          // opening it first if it is folded.
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          if (open) {
            focusNearest();
            return;
          }
          focusOnOpen.current = true;
          onOpenChange(true);
        }}
      >
        <UserFaceView
          emoji={me.face.emoji}
          frame={me.face.frame}
          size={40}
          seed={me.userId}
          held={open}
        />
      </button>

      <div className="vf-me-panel" style={panelStyle}>
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is menu or group (a menu holding an alertdialog is no menu: a group while the question stands), both named; the rule reads an expression role as none */}
        <div
          role={drawnAsking ? "group" : "menu"}
          aria-label={`${me.name}'s account`}
          className="vf-me-menu"
          inert={!open}
          onKeyDown={onMenuKeyDown}
        >
          <div
            ref={listRef}
            className="vf-me-list"
            data-leaving={leaving !== null ? "" : undefined}
            data-returning={returning ? "" : undefined}
            style={listStyle}
          >
            {drawn !== null ? (
              // AU-D6 — the question, in main's own consent words (the status
              // item's box and Settings → Updates say the same): what ends,
              // five at most, then Cancel leading and focused, the act trailing
              // in the danger text. Its lines rise nearest-first.
              <div
                className="vf-me-ask"
                role="alertdialog"
                aria-labelledby={questionId}
                aria-describedby={leadId}
              >
                <p
                  id={questionId}
                  className="vf-me-ask-question"
                  style={{ "--vf-me-delay": `${riseDelay(3)}ms` } as CSSProperties}
                >
                  {drawn.words.message}
                </p>
                <p
                  id={leadId}
                  className="vf-me-ask-lead"
                  style={{ "--vf-me-delay": `${riseDelay(2)}ms` } as CSSProperties}
                >
                  {drawn.words.lead}
                </p>
                <ul
                  className="vf-me-ask-list"
                  aria-label="The sessions it ends"
                  style={{ "--vf-me-delay": `${riseDelay(1)}ms` } as CSSProperties}
                >
                  {drawn.words.listed.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                  {drawn.words.more > 0 && <li>and {drawn.words.more} more</li>}
                </ul>
                <div
                  className="vf-me-ask-acts"
                  style={{ "--vf-me-delay": `${riseDelay(0)}ms` } as CSSProperties}
                >
                  {/* a question on its way out acts no more: the menu is going back to its rows */}
                  <UiButton
                    ref={cancelRef}
                    disabled={drawn.busy}
                    onClick={() => {
                      if (leaving === null) onUpdateCancel?.();
                    }}
                  >
                    Cancel
                  </UiButton>
                  <UiButton
                    variant="danger"
                    disabled={drawn.busy}
                    onClick={() => {
                      if (leaving === null) onUpdateConfirm?.();
                    }}
                  >
                    {drawn.words.confirm}
                  </UiButton>
                </div>
              </div>
            ) : (
              rows.map((row, index) => {
                const fromNearest = rows.length - 1 - index;
                return (
                  <Fragment key={row.key}>
                    {row.node(returning ? riseDelay(fromNearest) : revealDelay(fromNearest))}
                  </Fragment>
                );
              })
            )}
          </div>
        </div>
      </div>

      {waiting > 0 && (
        <span className="vf-me-badge tabular-nums" aria-hidden="true">
          {waiting}
        </span>
      )}
      {/* AU-D1, AU-D2 — an install waits on you: the dot BESIDE the face,
          never on it (I-5), in the badge's one slot. */}
      {markShown && (
        <span className="vf-me-mark" data-pop={pop ? "" : undefined} aria-hidden="true" />
      )}
      {/* The notice row is presentation inside a menu; this says it aloud. */}
      <span className="sr-only" role="status">
        {notice ?? update?.announce ?? update?.notice ?? ""}
      </span>
    </div>
  );
}

/** The controller: the account snapshot, the app's one theme, and the acts.
 * Renders nothing while it learns who this window belongs to — the corner
 * never shows a face it has to take back — and falls back to the plain
 * Settings button on a host with no account door at all, so the corner is never
 * a dead end. */
export function MeMenu({
  open,
  onOpenChange,
  onOpenSettings,
  update,
  shortcut,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `whats-new` (AU-6, LC-7): Settings → Updates, at the release's notes */
  onOpenSettings: (page: "general" | "account" | "updates" | "whats-new") => void;
  /** AU-2 — the desktop's update projection (`desktopState.update`): `null`
   * where no updater runs, absent until the window knows the desktop's state
   * (no row then). */
  update?: UpdateView | null | undefined;
  shortcut?: string;
  className?: string;
}): ReactElement | null {
  const account = useAccountSnapshot();
  // The app's ONE theme (FC-D5): the same store Settings → Appearance reads.
  const theme = useAppTheme();
  // TS-2 — the link's one machinery: the hand-off (F16) lives there now, shared
  // with the Setup Assistant's pane and Settings → Devices (TS-D5)
  const door = useLinkDoor();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const host = getHost();
  // Folding the menu clears a refusal: it is said once, where the act was.
  const onMenuOpenChange = useCallback(
    (next: boolean) => {
      if (!next) setRefusal(null);
      onOpenChange(next);
    },
    [onOpenChange],
  );

  // AU-2 — the update row's doors and its flow inside one open. A host with no
  // updater doors reads as a build that doesn't update itself (R1), whatever
  // the state says.
  const updates = host.updates;
  const view = update === undefined ? undefined : updates === undefined ? null : update;
  const stagedVersion = view?.phase === "staged" ? view.version : undefined;
  // the SAME prepare and confirm Settings → Updates runs (AU-3, AU-L4)
  const restart = useUpdateRestart(updates, stagedVersion);
  const { flow, error, reset, dropToken, setFlow, setError } = restart;
  const [local, setLocal] = useState<MeUpdateLocal>(AT_REST);
  /** the not-applied record already said (its `lastApply.at`): once per window */
  const [saidNotApplied, setSaidNotApplied] = useState<number | null>(null);
  /** bumped at every fold: an answer for a folded open is dropped, never flashed
   * on the next one */
  const openGen = useRef(0);
  /** the open a restart was asked in */
  const askedGen = useRef(0);
  const foldReset = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notAppliedAt = view?.lastApply?.at ?? null;
  const notAppliedWords = notAppliedNotice(view);
  const unsaidNotice =
    notAppliedWords !== null && notAppliedAt !== saidNotApplied ? notAppliedWords : null;
  // what the fold reads: the flow, and the notice it is folding away
  const flowNow = useRef<UpdatesFlow>(flow);
  const shownNotApplied = useRef<number | null>(null);
  useLayoutEffect(() => {
    flowNow.current = flow;
    shownNotApplied.current = unsaidNotice !== null ? notAppliedAt : null;
  });

  // The fold, however it comes (the face, Esc, a click away, the shell): this
  // open's flow ends. The token goes at once, so nothing confirms a question no
  // longer shown; its words stay drawn while the panel folds, then go — unless
  // a restart is already underway.
  const wasOpen = useRef(open);
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = open;
    if (was === open) return;
    if (foldReset.current !== null) {
      // reopened inside the fold: the last open's question goes now
      clearTimeout(foldReset.current);
      foldReset.current = null;
      reset();
    }
    if (open) return;
    openGen.current += 1;
    setLocal(AT_REST);
    setRefusal(null);
    dropToken();
    const said = shownNotApplied.current;
    if (said !== null) setSaidNotApplied(said);
    const kind = flowNow.current.kind;
    if (kind === "confirming" || kind === "restarting") return;
    foldReset.current = setTimeout(() => {
      foldReset.current = null;
      reset();
    }, FOLD_MS);
  }, [open, reset, dropToken]);
  useEffect(
    () => () => {
      if (foldReset.current !== null) clearTimeout(foldReset.current);
    },
    [],
  );

  // What main said back to a restart: a refusal is one line at the top of the
  // menu, in its words (P15); a bridge that threw says so. Both only in the
  // open that asked; a question that comes back after the fold is dropped.
  useEffect(() => {
    if (flow.kind === "consent" && askedGen.current !== openGen.current) reset();
    if (flow.kind !== "refused") return;
    if (askedGen.current === openGen.current) setRefusal(refusalLine(flow.words));
    setFlow(NO_FLOW);
  }, [flow, reset, setFlow]);
  useEffect(() => {
    if (error === null) return;
    if (askedGen.current === openGen.current)
      setRefusal(refusalSentence("Couldn't restart to update", error));
    setError(null);
  }, [error, setError]);

  if (account.me === null) {
    if (account.status === "loading") return null;
    return (
      <button
        type="button"
        className={`${roundButtonCls(false)} m-0.5 [&>svg]:h-5 [&>svg]:w-5 [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.8]`}
        title="Settings"
        aria-label="Settings"
        onClick={() => onOpenSettings("general")}
      >
        <MenuIcon name="gear" />
      </button>
    );
  }

  // THE RELOAD IS THE FEEDBACK (host.ts): switch and create re-target this
  // window and reload it, so nothing waits on their promises — only a refusal
  // comes back. It un-busies the corner and reopens the menu with main's
  // words at the top, so a click never just does nothing. Both leave through
  // the switch (DESIGN.md §8), which asks main once its frame has converged.
  const fireAndForget = (head: string, run: () => Promise<unknown>): void => {
    setBusy(true);
    setRefusal(null);
    void run().catch((cause: unknown) => {
      setBusy(false);
      setRefusal(refusalSentence(head, cause));
      onOpenChange(true);
    });
  };

  /** Connect your devices… STARTS the link (One Frame F16 — it opened
   * Settings → Account, as the name row does). The daemon's own act, through
   * the door every surface shares: the line under your name moves on the
   * subscription, the sign-in opens in the browser when the node offers it,
   * and a refusal comes back to the top of the menu in the daemon's words. */
  const beginLink = (): void => {
    setRefusal(null);
    void door.begin().then((reason) => {
      if (reason === null) return;
      setRefusal(refusalSentence("Couldn't connect to Tailscale", reason));
      onOpenChange(true);
    });
  };

  /** AU-2 — the update row's acts. `open` arrives folded (Settings → Updates),
   * and `notes` the same, at the release's notes (AU-6, LC-7); the check, the
   * download and the restart happen where the row stands, and whatever comes
   * back for an open that has since folded is dropped. */
  const onUpdate = (act: Exclude<MeUpdateAct, "none">): void => {
    if (act === "open" || act === "notes") {
      onOpenSettings(act === "notes" ? "whats-new" : "updates");
      return;
    }
    if (updates === undefined) return;
    const gen = openGen.current;
    setRefusal(null);
    if (act === "check") {
      // P1, then P2–P9 in place, answered when the CHECK settles (LC-5)
      setLocal({ kind: "checking" });
      void updates.check().then(
        (result) => {
          if (gen !== openGen.current) return;
          setLocal({ kind: "answered", outcome: result.outcome });
        },
        (failure: unknown) => {
          if (gen !== openGen.current) return;
          setLocal({ kind: "unreachable", message: errorText(failure) });
        },
      );
      return;
    }
    if (act === "download") {
      // AU-G5 — automatic updates off: Download in place; the view says
      // downloading next, and a refusal comes back in main's words (LC-38)
      const version = view?.version;
      if (version === undefined) return;
      setLocal({ kind: "requested" });
      void updates.download(version).then(
        (result) => {
          if (gen !== openGen.current || result.ok) return;
          setLocal(AT_REST);
          setRefusal(refusalLine(result.words ?? downloadRefusalFallback(result.reason)));
        },
        (failure: unknown) => {
          if (gen !== openGen.current) return;
          setLocal(AT_REST);
          setRefusal(refusalSentence("Couldn't download the update", failure));
        },
      );
      return;
    }
    // restart, ask — ONE snapshot of what ends (C2); nothing ends without the
    // question's second, red click
    askedGen.current = gen;
    void restart.restart();
  };

  const row =
    view === undefined
      ? null
      : meUpdateRow({ view, local: rowLocalOf(flow, local), now: Date.now() });
  const markTitle = readyClause(view);
  const menuUpdate: MeMenuUpdate | undefined =
    row === null || view === undefined
      ? undefined
      : {
          row,
          mark: updateWaits(view) && flow.kind !== "restarting",
          ...(markTitle !== null ? { markTitle } : {}),
          notice: unsaidNotice,
          // AU-D6 — main's question while it stands, in the open that asked it:
          // a menu reopened inside the fold draws its rows, never the last
          // open's question (AU-D5); busy while its confirm is in flight (a
          // restart that asked nothing confirms on the row, P12)
          ask:
            open && askedGen.current !== openGen.current
              ? null
              : flow.kind === "consent"
                ? { words: flow.words, busy: false }
                : flow.kind === "confirming" && flow.words !== undefined
                  ? { words: flow.words, busy: true }
                  : null,
          announce: local.kind === "answered" || local.kind === "unreachable" ? row.label : null,
        };

  return (
    <MeMenuView
      me={account.me}
      others={account.others}
      open={open}
      onOpenChange={onMenuOpenChange}
      onOpenSettings={() => onOpenSettings("general")}
      onOpenAccount={() => onOpenSettings("account")}
      onLink={beginLink}
      onSwitch={
        account.canSwitch && host.usersSwitch !== undefined
          ? (userId, from) => {
              const usersSwitch = host.usersSwitch;
              const person = account.others.find((other) => other.userId === userId);
              const name = person?.name ?? "that user";
              if (usersSwitch !== undefined) {
                fireAndForget(`Couldn't switch to ${name}`, () =>
                  leaveFor(
                    person === undefined ? null : { userId, name, face: person.face },
                    from ?? null,
                    () => usersSwitch({ userId }),
                  ),
                );
              }
            }
          : undefined
      }
      onNewUser={
        account.canCreate && host.usersCreate !== undefined
          ? () => {
              const usersCreate = host.usersCreate;
              if (usersCreate !== undefined) {
                fireAndForget("Couldn't add a user", () =>
                  leaveFor(null, null, () => usersCreate({})),
                );
              }
            }
          : undefined
      }
      theme={theme}
      onThemeChange={setAppTheme}
      busy={busy}
      notice={refusal}
      update={menuUpdate}
      onUpdate={onUpdate}
      onUpdateConfirm={restart.confirm}
      onUpdateCancel={restart.cancel}
      {...(shortcut !== undefined ? { shortcut } : {})}
      {...(className !== undefined ? { className } : {})}
    />
  );
}
