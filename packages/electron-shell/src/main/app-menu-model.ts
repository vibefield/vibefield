// The application menu, as data (the tray-model precedent: policy is a pure
// function, Electron is a thin adapter in app-menu.ts).
//
// The shell had no application menu until GT-2 — Electron's built-in default
// was serving. Godview's toggle has to be answered ABOVE the page (GT-D2 /
// design-04 §8.3) so it reaches the overlay even while a terminal pane holds
// keyboard focus, which a renderer-level listener could never promise. A menu
// key equivalent was how that was done until 2026-08-04; it no longer is — the
// gesture became ⇧⇧, which no accelerator can express. See
// GODVIEW_GESTURE_HINT below and `installGodviewDoubleShift`. Owning
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

/** THE GODVIEW ITEM CARRIES NO ACCELERATOR, and the absence is the design.
 *
 * The gesture is ⇧⇧ — a double tap of Shift, WebStorm's Search Everywhere
 * gesture — and an accelerator cannot express it. Accelerators describe chords,
 * one key held with modifiers; this is a rhythm, two taps inside 300ms. It is
 * detected in main by `installGodviewDoubleShift` (main/godview.ts), which keeps
 * GT-D2's actual requirement: answered above the page, so it works while a
 * terminal pane holds focus.
 *
 * The road here, so nobody re-walks it (all three states were shipped):
 *   ⌘G  — worked, but IS find-next in ghostty and every macOS text surface, and
 *         an application accelerator always wins, so the deck lost search-next
 *         for as long as the overlay was up. GT-2 named that cost and paid it.
 *   ⌘⎋  — never worked, and never can: macOS eats Command+Escape before the
 *         application sees it. MEASURED, with the app focused — ⌘G and a bare ⎋
 *         both arrived at `before-input-event`, ⌘⎋ never did. (⇧⌘⎋ and ⌃⌘⎋ do
 *         arrive, if a chord is ever wanted again.) A menu accelerator, a
 *         `before-input-event` interceptor and a globalShortcut would all fail
 *         identically, because the key never reaches the process.
 *   ⇧⇧  — costs no chord at all. Nothing in ghostty, macOS or this shell binds a
 *         lone Shift, so there is no collision to arbitrate and ⌘G stays the
 *         panes' — which is why the close item's conditional ⌘W dance below has
 *         no twin here. */
export const GODVIEW_GESTURE_HINT = "⇧ ⇧";

/** The id the Window section's close item carries, so the adapter can find it
 * again when the overlay opens. Named here because the reason is policy: the
 * deck's own close-pane gesture is ⌘W (ghostty's `close_surface`), and an
 * application accelerator would eat it before the pane could answer. */
export const CLOSE_WINDOW_ITEM_ID = "window-close";

export const GODVIEW_ITEM_ID = "view-godview";

/** `Godview` — a checkbox, because main knows the answer (§9 voice: buttons say
 * what they do; a state we hold is stated, not implied).
 *
 * The gesture rides in the LABEL because it cannot ride in the accelerator
 * column (see GODVIEW_GESTURE_HINT). The menu is still where a user looks to
 * learn a gesture, and a Godview row that showed no way to reach it by keyboard
 * would teach that there isn't one. WebStorm does the same for Search
 * Everywhere, for the same reason. */
function godviewItem(state: AppMenuState, actions: AppMenuActions): AppMenuItem {
  return {
    id: GODVIEW_ITEM_ID,
    type: "checkbox",
    label: `Godview  (${GODVIEW_GESTURE_HINT})`,
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
