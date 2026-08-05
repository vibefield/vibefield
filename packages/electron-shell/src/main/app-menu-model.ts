// The application menu, as data (the tray-model precedent: policy is a pure
// function, Electron is a thin adapter in app-menu.ts).
//
// The shell had no application menu until GT-2 — Electron's built-in default
// was serving. Godview's toggle has to be answered ABOVE the page (GT-D2 /
// design-04 §8.3) so it reaches the overlay even while a terminal pane holds
// keyboard focus, which a renderer-level listener could never promise. A menu
// key equivalent was how that was done until 2026-08-04; on darwin it no longer
// is — see GODVIEW_ACCELERATOR below and `installGodviewChord`. Owning
// the menu means owning the whole thing — replacing Electron's default with one
// that omits Copy or Quit would be a regression the accelerator paid for — so
// every standard section below is present by ROLE, which is how Electron keeps
// their labels, accelerators, and platform ordering correct without us
// restating them.

export type MenuPlatform = "darwin" | "other";

/** The subset of Electron's MenuItemConstructorOptions this shell constructs.
 * `role` and an explicit item are mutually exclusive in practice: a role item
 * carries no click, and our items carry no role. */
export interface AppMenuItem {
  readonly id?: string;
  readonly role?: string;
  readonly type?: "normal" | "checkbox" | "separator";
  readonly label?: string;
  readonly accelerator?: string;
  readonly enabled?: boolean;
  readonly checked?: boolean;
  readonly click?: () => void;
  readonly submenu?: readonly AppMenuItem[];
}

export interface AppMenuActions {
  /** Flip the focused window's Godview. Undefined in modes with no window to
   * flip — the item still appears (an absent menu item reads as a missing
   * feature), disabled, which is the honest face of "not here yet". */
  toggleGodview?: () => void;
}

export interface AppMenuState {
  /** Whether the focused window's overlay is open — the checkmark's fact.
   * Main owns it (contracts GodviewState), so this is not a guess. */
  godviewOpen: boolean;
}

/** GT-D2, James 2026-08-01; moved off ⌘G 2026-08-04. Electron resolves
 * `CommandOrControl` per platform, so one string is the whole cross-platform
 * statement.
 *
 * ON DARWIN THIS IS A LABEL, NOT A BINDING. Electron accepts the string and the
 * View menu draws ⌘⎋ beside Godview, but macOS does not deliver ⌘⎋ to a menu
 * key equivalent — the item never fired. `installGodviewChord` (main/godview.ts)
 * is what actually answers the chord, above the page, where GT-D2 needs it. The
 * accelerator stays here because the menu is where a user LOOKS to learn the
 * gesture, and it remains the live binding wherever the platform honours it.
 *
 * It was ⌘G until the collision got paid for twice. ⌘G is find-next in every
 * macOS text surface and in ghostty, and an application accelerator always wins
 * — so the overlay's toggle ate the deck's search-next for as long as the deck
 * was up (GT-2's named cost). ⌘⎋ collides with nothing: macOS reserves
 * ⌘⌥⎋ (Force Quit), not this, and a terminal reads a BARE Escape — the modifier
 * is what keeps vim's Escape out of this menu's reach. ⌘G goes back to the
 * panes, unconditionally, which is why the close item's conditional dance below
 * has no twin here. */
export const GODVIEW_ACCELERATOR = "CommandOrControl+Escape";

/** The id the Window section's close item carries, so the adapter can find it
 * again when the overlay opens. Named here because the reason is policy: the
 * deck's own close-pane gesture is ⌘W (ghostty's `close_surface`), and an
 * application accelerator would eat it before the pane could answer. */
export const CLOSE_WINDOW_ITEM_ID = "window-close";

export const GODVIEW_ITEM_ID = "view-godview";

/** `Toggle Godview` — a checkbox, because main knows the answer (§9 voice:
 * buttons say what they do; a state we hold is stated, not implied). */
function godviewItem(state: AppMenuState, actions: AppMenuActions): AppMenuItem {
  return {
    id: GODVIEW_ITEM_ID,
    type: "checkbox",
    label: "Godview",
    accelerator: GODVIEW_ACCELERATOR,
    checked: state.godviewOpen,
    enabled: actions.toggleGodview !== undefined,
    ...(actions.toggleGodview !== undefined ? { click: actions.toggleGodview } : {}),
  };
}

/** The Window section's close item, whose accelerator is CONDITIONAL.
 *
 * ⌘W means "close this window" everywhere in macOS, and it means "close this
 * pane" inside a terminal deck (ghostty `close_surface`). Both are right; they
 * cannot both hold the accelerator. An application accelerator always wins, so
 * with the overlay open the item gives ⌘W up and the deck's panes answer it —
 * and closing a pane detaches a session that goes on living (GT-D5), which is
 * the gesture a user in a terminal actually means. With the overlay closed the
 * item takes ⌘W back and the window closes, as it should. Role and label never
 * move: the menu still says Close Window and still works by click. */
function closeWindowItem(state: AppMenuState): AppMenuItem {
  return {
    id: CLOSE_WINDOW_ITEM_ID,
    role: "close",
    ...(state.godviewOpen ? {} : { accelerator: "CommandOrControl+W" }),
  };
}

/** The whole template. Roles carry every standard section; the two items this
 * shell owns are Godview and the conditional close. */
export function buildAppMenu(
  platform: MenuPlatform,
  state: AppMenuState,
  actions: AppMenuActions,
): readonly AppMenuItem[] {
  // File is spelled out rather than taken as a role because the `fileMenu` role
  // IS `close` on darwin and `quit` elsewhere — taking it would plant a second
  // Close Window holding an unconditional ⌘W beside the conditional one, and
  // the deck would lose the gesture to whichever fired first.
  const appSection: readonly AppMenuItem[] = platform === "darwin" ? [{ role: "appMenu" }] : [];
  const fileSubmenu: readonly AppMenuItem[] =
    platform === "darwin" ? [closeWindowItem(state)] : [{ role: "quit" }];
  return [
    ...appSection,
    { label: "File", submenu: fileSubmenu },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        godviewItem(state, actions),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu:
        platform === "darwin"
          ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
          : [{ role: "minimize" }, { role: "zoom" }, closeWindowItem(state)],
    },
  ];
}
