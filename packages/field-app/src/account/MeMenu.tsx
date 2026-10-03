import { faceLiftHostClass, UserFaceView } from "@vibefield/design-kit/face";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { leaveFor } from "../boot/switch";
import { roundButtonCls } from "../field/theme-constants";
import { getHost } from "../host";
import {
  type AccountMe,
  type AccountPerson,
  refusalSentence,
  useAccountSnapshot,
} from "./use-account";
import "./MeMenu.css";

// The Me menu (UA-D19; DESIGN.md §8 "The Me menu") — the owner's face in the
// bottom-left corner, where the Settings gear was, and the account's one door.
//
// It is ONE element that changes role (M1): a 56px circle sits around the face
// — faint on hover, invisible otherwise — and that circle IS the menu, grown on
// the island's curve into a 256px panel. The face never moves (M2), so the
// second click lands on the same face and folds it away. The panel reads
// bottom-up, nearest first: you · Settings… · Link… (unlinked only) · New
// user… · then the other users.
//
// Split like every runtime-bound view (UI_SYSTEM.md): `MeMenuView` owns the
// DOM, motion, keyboard and focus and takes plain data; `MeMenu` is the
// controller that reads the account and runs the acts.

export interface MeMenuViewProps {
  me: AccountMe;
  others: readonly AccountPerson[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Settings… opens Settings on General, as ⌘, does. */
  onOpenSettings: () => void;
  /** Your name and login open Settings → Account. */
  onOpenAccount: () => void;
  /** Link Tailscale account… (offered only while unlinked) — the link block
   * lives on the Account page, so this opens it there. */
  onLink: () => void;
  /** Absent: this host cannot switch, and the rows say nothing false. `from`
   * is the row that was pressed — the switch carries its face (§8). */
  onSwitch?: ((userId: string, from?: Element) => void) | undefined;
  onNewUser?: (() => void) | undefined;
  /** A switch or create is in flight: the window is about to reload. */
  busy?: boolean;
  /** The Settings chord as this platform spells it. */
  shortcut?: string;
  /** A switch or new user main refused, in its words: said at the top of the
   * menu (and to assistive tech) until the menu next folds. */
  notice?: string | null;
  className?: string;
}

const MENU_WIDTH = 256;
/** The seed: the 44px face plus the 6px it sits inside on every side. */
const SEED = 56;

function MenuIcon({ name }: { name: "gear" | "person" | "link" }): ReactElement {
  return <FieldGlyph name={name} size={18} />;
}

/** One row's reveal delay: nearest first, 160ms + 26ms per row, capped at
 * 400ms (§6's stagger constants). `fromNearest` counts up from the bottom. */
const revealDelay = (fromNearest: number): number => 160 + Math.min(fromNearest * 26, 400);

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
  busy = false,
  shortcut = "⌘,",
  notice = null,
  className = "",
}: MeMenuViewProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(SEED);
  /** Opened from the keyboard: land focus on the nearest item once it shows. */
  const focusOnOpen = useRef(false);
  /** Folding because Tab is leaving: focus is on its way somewhere else. */
  const tabbingOut = useRef(false);
  const wasOpen = useRef(open);
  const waiting = others.reduce((sum, person) => sum + person.waiting, 0);

  // The panel's open height is its content's, measured — the rows are real
  // DOM at rest (invisible, inert), so the grow always has a true target.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const measure = (): void => setPanelHeight(SEED + list.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  const items = useCallback(
    (): HTMLElement[] =>
      Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []).filter(
        (item) => !(item as HTMLButtonElement).disabled,
      ),
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
  // as the side panel does, so the field's own Esc (leave a container) waits
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
      onOpenChange(false);
      faceRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onEscape, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onEscape, true);
    };
  }, [open, onOpenChange]);

  // Folded from OUTSIDE while focus was on a row — ⌘, or the tray's
  // Settings… — the rows go inert, so focus comes back to the face first.
  // Settings records what had focus as it opens and returns it there on close.
  // A click outside moves focus itself, after this; Tab is left alone.
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
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number): void => {
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
  if (notice !== null) {
    rows.push({
      key: "notice",
      node: (delay) => (
        <div
          className="vf-me-notice"
          role="presentation"
          style={{ "--vf-me-delay": `${delay}ms` } as CSSProperties}
        >
          {notice}
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
  if (rows.length > 0) {
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
          <span className="vf-me-row-label">Link Tailscale account…</span>
        </button>
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
  rows.push({
    key: "sep-you",
    node: (delay) => (
      <hr className="vf-me-separator" style={{ "--vf-me-delay": `${delay}ms` } as CSSProperties} />
    ),
  });

  const panelStyle = {
    "--vf-me-width": `${MENU_WIDTH}px`,
    "--vf-me-height": `${panelHeight}px`,
  } as CSSProperties;

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
        aria-label={`${me.name}: account menu${waiting > 0 ? `, ${waiting} waiting in another user` : ""}`}
        title={`${me.name} · Account`}
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
        <div
          role="menu"
          aria-label={`${me.name}'s account`}
          className="vf-me-menu"
          inert={!open}
          onKeyDown={onMenuKeyDown}
        >
          <div ref={listRef} className="vf-me-list">
            {rows.map((row, index) => (
              <Fragment key={row.key}>{row.node(revealDelay(rows.length - 1 - index))}</Fragment>
            ))}
          </div>
          <button
            type="button"
            role="menuitem"
            className="vf-me-you"
            tabIndex={-1}
            aria-label={`${me.name}${me.detail.length > 0 ? `, ${me.detail}` : ""} — account settings`}
            onClick={() => act(onOpenAccount)}
          >
            <span className="vf-me-you-name">{me.name}</span>
            {me.detail.length > 0 && (
              <span className={`vf-me-you-detail${me.detailIsLogin ? " vf-ui-mono" : ""}`}>
                {me.detail}
              </span>
            )}
            <span className="vf-me-you-chevron" aria-hidden="true">
              ›
            </span>
          </button>
        </div>
      </div>

      {waiting > 0 && (
        <span className="vf-me-badge tabular-nums" aria-hidden="true">
          {waiting}
        </span>
      )}
      {/* The notice row is presentation inside a menu; this says it aloud. */}
      <span className="sr-only" role="status">
        {notice ?? ""}
      </span>
    </div>
  );
}

/** The controller: the account snapshot, and the four acts. Renders nothing
 * while it learns who this window belongs to — the corner never shows a face
 * it has to take back — and falls back to the plain Settings button on a host
 * with no account door at all, so the corner is never a dead end. */
export function MeMenu({
  open,
  onOpenChange,
  onOpenSettings,
  shortcut,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: (page: "general" | "account") => void;
  shortcut?: string;
  className?: string;
}): ReactElement | null {
  const account = useAccountSnapshot();
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

  return (
    <MeMenuView
      me={account.me}
      others={account.others}
      open={open}
      onOpenChange={onMenuOpenChange}
      onOpenSettings={() => onOpenSettings("general")}
      onOpenAccount={() => onOpenSettings("account")}
      onLink={() => onOpenSettings("account")}
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
      busy={busy}
      notice={refusal}
      {...(shortcut !== undefined ? { shortcut } : {})}
      {...(className !== undefined ? { className } : {})}
    />
  );
}
