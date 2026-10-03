// The application menu, as data (the tray-model precedent: policy is a pure
// function, Electron is a thin adapter in app-menu.ts).
//
// The shell had no application menu until GT-2 — Electron's built-in default
// was serving. Godview's toggle had to be answered ABOVE the page (GT-D2 /
// design-04 §8.3) so it reached the overlay even while a terminal pane held
// keyboard focus, which is how this menu came to exist; since One Frame (FR-1)
// it names the frame's four views instead, and their keys are the product's own
// chords (see VIEW_KEYS_ROAD below). Owning the menu means owning the whole
// thing — replacing Electron's default with one that omits Copy or Quit would be
// a regression — so every standard section below is present by ROLE, which is
// how Electron keeps their labels, accelerators, and platform ordering correct
// without us restating them.

import type { FrameView, FrameZoomAct } from "@vibefield/contracts";

export type MenuPlatform = "darwin" | "other";

/** The subset of Electron's MenuItemConstructorOptions this shell constructs.
 * `role` and an explicit item are mutually exclusive in practice: a role item
 * carries no click, and our items carry no role. */
export interface AppMenuItem {
  readonly id?: string;
  readonly role?: string;
  readonly type?: "normal" | "checkbox" | "radio" | "separator";
  readonly label?: string;
  readonly accelerator?: string;
  /** Linux and Windows only (Electron's own limit): false SHOWS the
   * accelerator without registering it. On darwin a shown key equivalent is a
   * registered one, which VIEW_KEYS_ROAD explains is harmless here. */
  readonly registerAccelerator?: boolean;
  readonly enabled?: boolean;
  readonly checked?: boolean;
  readonly click?: () => void;
  readonly submenu?: readonly AppMenuItem[];
}

export interface AppMenuActions {
  /** Ask the focused window's owner for a view. Undefined in modes with no
   * window to switch — the items still appear (an absent menu item reads as a
   * missing feature), disabled, which is the honest face of "not here yet". */
  setView?: (view: FrameView) => void;
  /** Close the focused window. Needed only while Godview is the view, when the
   * close item drops `role: "close"` to release ⌘W (see `closeWindowItem`) and
   * therefore loses the role's built-in behaviour along with its accelerator. */
  closeWindow?: () => void;
  /** Take a screenshot with the native helper (SNAP-D3). Undefined where no
   * helper exists for the platform or in a mode with no window — the item
   * stays, disabled, the same honest face Godview wears. */
  takeScreenshot?: () => void;
  /** Send a zoom act to the focused window's head (One Frame FR-4, 3b), which
   * answers it on Canvas. Undefined in modes with no window: the three items
   * stay, disabled, the same honest face. */
  zoom?: (act: FrameZoomAct) => void;
}

export interface AppMenuState {
  /** The focused window's active view — the mark's fact and ⌘W's. Main owns
   * it (contracts FrameViewState, `view.ts`), so this is not a guess. */
  view: FrameView;
}

/** THE ROAD TO THE VIEW KEYS (FC-D4, ruled 2026-10-01), so nobody re-walks it.
 * Every state below shipped:
 *   ⌘G  — worked, but IS find-next in ghostty and every macOS text surface, and
 *         as a menu accelerator it took search-next from the deck. GT-2 named
 *         that cost and paid it.
 *   ⌘⎋  — never worked, and never can: macOS eats Command+Escape before the
 *         application sees it. MEASURED, with the app focused — ⌘G and a bare ⎋
 *         both arrived at `before-input-event`, ⌘⎋ never did.
 *   ⇧⇧  — a double tap of Shift detected in main (`before-input-event`), which a
 *         menu could not express, so the Godview row carried "(⇧ ⇧)" in its
 *         label. RETIRED with FC-D4: four keys for four views and nothing else.
 *   ⌘1–⌘4 (Ctrl 1–4 elsewhere) — the frame's views. They are PRODUCT CHORDS
 *         (GT-D21: field-app's `product-chords.ts`), caught on the page's
 *         window in the capture phase and stopped there, so a focused pane —
 *         whose ghostty default for ⌘1–⌘8 is goto_tab — never sees them, and
 *         each is proven delivered from a focused pane by the godview smoke's
 *         probe rows. The View menu SAYS them (One Frame FR-5: the menu bar is
 *         where a key is said), and does not deliver them: on Linux and Windows
 *         `registerAccelerator: false` keeps them said-only; on darwin a shown
 *         key equivalent is necessarily registered, but the page answers first —
 *         a chord the page claims never reaches the menu (SNAP-3 measured it:
 *         the canvas keymap's ⌘A swallowed ⌃⌘A's menu accelerator, which is why
 *         that chord is taken in main) — and a chord the page did not claim (a
 *         document still loading) lands on the same owner through `setView`, so
 *         either way ONE owner moves. */
export const VIEW_ITEM_IDS: Readonly<Record<FrameView, string>> = {
  canvas: "view-canvas",
  godview: "view-godview",
  history: "view-history",
  assistant: "view-assistant",
};

const VIEW_LABELS: Readonly<Record<FrameView, string>> = {
  canvas: "Canvas",
  godview: "Godview",
  history: "History",
  assistant: "Assistant",
};

const VIEW_ORDER: readonly FrameView[] = ["canvas", "godview", "history", "assistant"];

/** ⌘1–⌘4 on darwin, Ctrl+1–4 elsewhere — one spelling for both. */
export function viewAccelerator(view: FrameView): string {
  return `CommandOrControl+${VIEW_ORDER.indexOf(view) + 1}`;
}

/** The id the Window section's close item carries, so the adapter can find it
 * again when the overlay opens. Named here because the reason is policy: the
 * deck's own close-pane gesture is ⌘W (ghostty's `close_surface`), and an
 * application accelerator would eat it before the pane could answer. */
export const CLOSE_WINDOW_ITEM_ID = "window-close";

export const SCREENSHOT_ITEM_ID = "view-screenshot";

/** One spelling for the menu, the local interceptor and SNAP-1's global
 * registration. The global chord defaults on and can be disabled in Desktop
 * settings; this application accelerator remains available in that case. */
export function screenshotAccelerator(platform: MenuPlatform): string {
  return platform === "darwin" ? "Control+Command+A" : "Alt+A";
}

/** `Take Screenshot` — the View menu's door to the native helper. The chord
 * rides on the item even while it is disabled, so a platform without a helper
 * still teaches what the gesture will be (SNAP-D5: present, disabled, honest). */
function screenshotItem(platform: MenuPlatform, actions: AppMenuActions): AppMenuItem {
  return {
    id: SCREENSHOT_ITEM_ID,
    label: "Take Screenshot",
    accelerator: screenshotAccelerator(platform),
    enabled: actions.takeScreenshot !== undefined,
    ...(actions.takeScreenshot !== undefined ? { click: actions.takeScreenshot } : {}),
  };
}

/** THE VIEW MENU'S ZOOM (One Frame FR-4, 3b — FR-3's finding). Until FR-4 the
 * View menu carried Electron's `resetZoom`/`zoomIn`/`zoomOut` ROLES, which
 * zoom the PAGE: on Canvas the head claimed ⌘0 ⌘+ ⌘− first, but wherever
 * nothing claimed them — under a cover, nothing focused — the keys scaled the
 * whole window, the frame's chrome with it, and the items always did. The
 * three are ours now, with no role (a role would bring its page zoom back as
 * its default behaviour, `closeWindowItem`'s lesson): each sends the ACT to
 * the window's head, which answers on Canvas as its keys do — and under a
 * cover the items are disabled, because the zoom is Canvas's instrument and
 * a covered canvas has nothing to zoom. Their keys are said as the views'
 * are (VIEW_KEYS_ROAD): the page answers ⌘0 ⌘+ ⌘− first on Canvas; a key it
 * leaves unclaimed (a document still loading, a claim that does not use the
 * key) reaches the item on darwin and lands on the same head, so either way
 * ONE owner zooms; off the Mac `registerAccelerator: false` keeps them said.
 * The labels are Electron's role labels, in the roles' order. */
export const ZOOM_ITEM_IDS: Readonly<Record<FrameZoomAct, string>> = {
  actual: "zoom-actual",
  in: "zoom-in",
  out: "zoom-out",
};

const ZOOM_ITEMS: readonly { act: FrameZoomAct; label: string; accelerator: string }[] = [
  { act: "actual", label: "Actual Size", accelerator: "CommandOrControl+0" },
  { act: "in", label: "Zoom In", accelerator: "CommandOrControl+Plus" },
  { act: "out", label: "Zoom Out", accelerator: "CommandOrControl+-" },
];

function zoomItems(
  platform: MenuPlatform,
  state: AppMenuState,
  actions: AppMenuActions,
): AppMenuItem[] {
  const zoom = state.view === "canvas" ? actions.zoom : undefined;
  return ZOOM_ITEMS.map(({ act, label, accelerator }) => ({
    id: ZOOM_ITEM_IDS[act],
    label,
    accelerator,
    ...(platform === "darwin" ? {} : { registerAccelerator: false }),
    enabled: zoom !== undefined,
    ...(zoom !== undefined ? { click: () => zoom(act) } : {}),
  }));
}

/** The four views, as radio items: main knows which one is on (§9 voice: a
 * state we hold is stated, not implied). The Assistant waits (FC-D2) — present,
 * disabled, its key still said, the way a disabled Take Screenshot keeps its
 * chord. */
function viewItems(
  platform: MenuPlatform,
  state: AppMenuState,
  actions: AppMenuActions,
): AppMenuItem[] {
  return VIEW_ORDER.map((view) => {
    const built = view !== "assistant";
    const setView = actions.setView;
    return {
      id: VIEW_ITEM_IDS[view],
      type: "radio",
      label: built ? VIEW_LABELS[view] : `${VIEW_LABELS[view]} · not built yet`,
      accelerator: viewAccelerator(view),
      ...(platform === "darwin" ? {} : { registerAccelerator: false }),
      checked: state.view === view,
      enabled: built && setView !== undefined,
      ...(built && setView !== undefined ? { click: () => setView(view) } : {}),
    };
  });
}

/** The Window section's close item, whose accelerator is CONDITIONAL.
 *
 * ⌘W means "close this window" everywhere in macOS, and it means "close this
 * pane" inside a terminal deck (ghostty `close_surface`). Both are right; they
 * cannot both hold the accelerator. An application accelerator always wins, so
 * with the overlay open the item gives ⌘W up and the deck's panes answer it —
 * and closing a pane detaches a session that goes on living (GT-D5), which is
 * the gesture a user in a terminal actually means. With the overlay closed the
 * item takes ⌘W back and the window closes, as it should.
 *
 * THE HANDOVER DROPS THE ROLE, and that is the whole fix (2026-08-10). Until
 * now this item kept `role: "close"` in both states and merely OMITTED the
 * accelerator — which released nothing, because Electron resolves an item's
 * accelerator as `explicit ?? roleDefault` and `close`'s default IS
 * `CommandOrControl+W`. The smoke measured every alternative on Electron 43.1.1
 * before this was written (`testing/smoke.ts` §⌘W): `accelerator: null` and
 * `registerAccelerator: false` BOTH still resolve to the role default, and only
 * an item carrying no role at all reports null. So while the overlay is open the
 * item becomes a plain labelled command — no role, no inherited chord — and the
 * close behaviour the role used to supply arrives as `actions.closeWindow`.
 * With the overlay closed nothing changes: role, label and ⌘W as before.
 *
 * The cost, stated: the overlay-open label is ours rather than Electron's, so it
 * is English where the role would have been localized. The alternative is a menu
 * that eats the deck's ⌘W in every language.
 *
 * *Note (2026-10-03, FR-1):* "an application accelerator always wins" holds for
 * a chord the page leaves UNCLAIMED. SNAP-3 measured the other half on darwin —
 * a chord the page claims never reaches the menu (VIEW_KEYS_ROAD) — so the
 * handover stays for the panes that leave ⌘W unclaimed, and since FR-1 it is
 * keyed on Godview being the window's view rather than on an overlay bit. */
function closeWindowItem(state: AppMenuState, actions: AppMenuActions): AppMenuItem {
  // Keyed on GODVIEW being the view, not on "covered": History has no panes to
  // lend ⌘W to, so there it closes the window as it always did.
  if (state.view !== "godview") {
    return { id: CLOSE_WINDOW_ITEM_ID, role: "close", accelerator: "CommandOrControl+W" };
  }
  return {
    id: CLOSE_WINDOW_ITEM_ID,
    label: "Close Window",
    enabled: actions.closeWindow !== undefined,
    ...(actions.closeWindow !== undefined ? { click: actions.closeWindow } : {}),
  };
}

/** The whole template. Roles carry every standard section; the items this
 * shell owns are the four views, Take Screenshot, the zoom's three and the
 * conditional close. */
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
    platform === "darwin" ? [closeWindowItem(state, actions)] : [{ role: "quit" }];
  return [
    ...appSection,
    { label: "File", submenu: fileSubmenu },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        ...viewItems(platform, state, actions),
        { type: "separator" },
        screenshotItem(platform, actions),
        { type: "separator" },
        ...zoomItems(platform, state, actions),
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu:
        platform === "darwin"
          ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
          : [{ role: "minimize" }, { role: "zoom" }, closeWindowItem(state, actions)],
    },
  ];
}
