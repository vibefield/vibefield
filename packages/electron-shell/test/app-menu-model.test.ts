import type { FrameView, FrameZoomAct, GodviewDeckState } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  type AppMenuItem,
  buildAppMenu,
  CLOSE_WINDOW_ITEM_ID,
  type MenuPlatform,
  SCREENSHOT_ITEM_ID,
  screenshotAccelerator,
  VIEW_ITEM_IDS,
  viewAccelerator,
  ZOOM_ITEM_IDS,
} from "../src/main/app-menu-model";

// The View menu names the frame's four views (One Frame FR-1) and SAYS their
// keys; the keys themselves are the page's product chords (VIEW_KEYS_ROAD in
// the model). What stays load-bearing here is what the menu must not do: claim
// an accelerator it does not own, take ⌘G back from the deck, hold ⌘W while
// Godview's panes need it, or mark a view main does not hold.

const flatten = (items: readonly AppMenuItem[]): AppMenuItem[] =>
  items.flatMap((item) => [item, ...flatten(item.submenu ?? [])]);

const find = (items: readonly AppMenuItem[], id: string): AppMenuItem | undefined =>
  flatten(items).find((item) => item.id === id);

const PLATFORMS: readonly MenuPlatform[] = ["darwin", "other"];
const VIEWS: readonly FrameView[] = ["canvas", "godview", "history", "assistant"];
/** What a page may have said of its deck: nothing yet (the key absent), that it
 * has none, or one of the three names (contracts `GodviewDeckState`). */
const DECKS: readonly (GodviewDeckState | null | undefined)[] = [
  undefined,
  null,
  "away",
  "up",
  "maximized",
];
const menuState = (view: FrameView, deck: GodviewDeckState | null | undefined) =>
  deck === undefined ? { view } : { view, deck };
const noActions = {};
const asked: FrameView[] = [];
const actions = {
  setView: (view: FrameView) => {
    asked.push(view);
  },
  closeWindow: () => undefined,
};

describe("buildAppMenu", () => {
  it.each(PLATFORMS)(
    "names the four views in the track's order, with their keys (%s)",
    (platform) => {
      const view = buildAppMenu(platform, { view: "canvas" }, actions).find(
        (item) => item.label === "View",
      );
      const items = (view?.submenu ?? []).filter((item) => item.id?.startsWith("view-") === true);
      expect(items.map((item) => item.id)).toEqual([
        ...VIEWS.map((v) => VIEW_ITEM_IDS[v]),
        SCREENSHOT_ITEM_ID,
      ]);
      // ⌘1–⌘4 on darwin, Ctrl+1–4 elsewhere — "the View menu says ⌘2" (FR-1's exit)
      expect(
        VIEWS.map(
          (v) =>
            find(buildAppMenu(platform, { view: "canvas" }, actions), VIEW_ITEM_IDS[v])
              ?.accelerator,
        ),
      ).toEqual([
        "CommandOrControl+1",
        "CommandOrControl+2",
        "CommandOrControl+3",
        "CommandOrControl+4",
      ]);
      expect(viewAccelerator("godview")).toBe("CommandOrControl+2");
    },
  );

  it.each(PLATFORMS)("says the keys and leaves delivering them to the page (%s)", (platform) => {
    // VIEW_KEYS_ROAD: the chords are caught in the page's capture phase. Off
    // the Mac the menu only SAYS them; on darwin a shown key equivalent is a
    // registered one, which the page answers first.
    for (const v of VIEWS) {
      const item = find(buildAppMenu(platform, { view: "canvas" }, actions), VIEW_ITEM_IDS[v]);
      expect(item?.registerAccelerator).toBe(platform === "darwin" ? undefined : false);
      expect(item?.role).toBeUndefined();
    }
  });

  it.each(PLATFORMS)("carries no ⇧⇧ anywhere — the gesture retired (FC-D4) (%s)", (platform) => {
    for (const v of VIEWS) {
      const labels = flatten(buildAppMenu(platform, { view: v }, actions)).map(
        (item) => item.label ?? "",
      );
      expect(labels.some((label) => label.includes("⇧"))).toBe(false);
    }
  });

  it.each(PLATFORMS)("marks the view main holds, and only it (%s)", (platform) => {
    for (const held of ["canvas", "godview", "history"] as const) {
      const menu = buildAppMenu(platform, { view: held }, actions);
      expect(VIEWS.filter((v) => find(menu, VIEW_ITEM_IDS[v])?.checked === true)).toEqual([held]);
      expect(find(menu, VIEW_ITEM_IDS[held])?.type).toBe("radio");
    }
  });

  it.each(PLATFORMS)("asks main's owner for the view an item names (%s)", (platform) => {
    asked.length = 0;
    find(buildAppMenu(platform, { view: "canvas" }, actions), VIEW_ITEM_IDS.godview)?.click?.();
    find(buildAppMenu(platform, { view: "godview" }, actions), VIEW_ITEM_IDS.history)?.click?.();
    expect(asked).toEqual(["godview", "history"]);
  });

  it.each(PLATFORMS)(
    "keeps the Assistant present and waiting, its key still said (%s)",
    (platform) => {
      const item = find(
        buildAppMenu(platform, { view: "canvas" }, actions),
        VIEW_ITEM_IDS.assistant,
      );
      expect(item).toMatchObject({ enabled: false, accelerator: "CommandOrControl+4" });
      expect(item?.label).toBe("Assistant · not built yet");
      expect(item?.click).toBeUndefined();
    },
  );

  it.each(PLATFORMS)("leaves ⌘G to the deck's panes in every view (%s)", (platform) => {
    // The toggle moved off ⌘G on 2026-08-04 precisely to end a collision: ⌘G is
    // find-next in ghostty. Unlike ⌘W, which the close item lends out and takes
    // back, no item declares ⌘G in any view.
    for (const v of VIEWS) {
      const accelerators = flatten(buildAppMenu(platform, { view: v }, actions)).map(
        (item) => item.accelerator,
      );
      expect(accelerators).not.toContain("CommandOrControl+G");
    }
  });

  it.each(PLATFORMS)("offers the views disabled when nothing can move them (%s)", (platform) => {
    // An absent item reads as a missing feature; a disabled one reads as "not
    // here yet", which is the truth in a mode with no window to move.
    for (const v of VIEWS) {
      const item = find(buildAppMenu(platform, { view: "canvas" }, noActions), VIEW_ITEM_IDS[v]);
      expect(item?.enabled).toBe(false);
      expect(item?.click).toBeUndefined();
    }
  });

  it.each(PLATFORMS)("holds ⌘W for the window in every view but Godview (%s)", (platform) => {
    // History has no panes to lend ⌘W to: there it closes the window, as the
    // canvas always did.
    for (const view of ["canvas", "history"] as const) {
      const item = find(buildAppMenu(platform, { view }, actions), CLOSE_WINDOW_ITEM_ID);
      expect(item).toMatchObject({ role: "close", accelerator: "CommandOrControl+W" });
    }
  });

  it.each(PLATFORMS)(
    "releases ⌘W to the deck's panes while Godview is the view (%s)",
    (platform) => {
      // ghostty binds ⌘W to close_surface, and an application accelerator always
      // wins — so with the deck up the menu gives the chord back. Closing a pane
      // detaches a session that lives on (GT-D5), which is what a user pressing
      // ⌘W in a terminal means.
      //
      // THE ROLE MUST BE GONE, not merely the accelerator (2026-08-10). This
      // test used to assert `role: "close"` here and passed for days while the
      // handover released nothing: Electron resolves `explicit ?? roleDefault`
      // and `close` defaults to ⌘W, so a role-bearing item binds the chord no
      // matter what this model omits. The smoke measured the alternatives —
      // `accelerator: null` and `registerAccelerator: false` both still resolve
      // to the role default — so no-role is the only spelling that releases it,
      // and the assertion below is the one that would have failed.
      const item = find(buildAppMenu(platform, { view: "godview" }, actions), CLOSE_WINDOW_ITEM_ID);
      expect(item?.accelerator).toBeUndefined();
      expect(item?.role).toBeUndefined();
      // Still a working menu command — the role's behaviour, supplied by hand.
      expect(item?.label).toBe("Close Window");
      expect(item?.enabled).toBe(true);
      expect(item?.click).toBe(actions.closeWindow);
    },
  );

  it.each(PLATFORMS)(
    "lends ⌘W by the deck's own word: while it is up or maximized, and while nothing was said (%s)",
    (platform) => {
      // Godview round 3 (GV-D6): the deck can be AWAY, and then no pane is there
      // to answer ⌘W. The page says its deck's state by name (the deck door) and
      // the lend reads that fact. Until a page says anything — every build
      // before the deck's state slices — there is no fact, and the lend is
      // exactly what it was: whenever Godview is the view.
      const asBefore = find(
        buildAppMenu(platform, { view: "godview" }, actions),
        CLOSE_WINDOW_ITEM_ID,
      );
      for (const deck of [undefined, null, "up", "maximized"] as const) {
        const item = find(
          buildAppMenu(platform, menuState("godview", deck), actions),
          CLOSE_WINDOW_ITEM_ID,
        );
        expect(item, String(deck)).toEqual(asBefore);
        expect(item?.role, String(deck)).toBeUndefined();
        expect(item?.accelerator, String(deck)).toBeUndefined();
        expect(item?.click, String(deck)).toBe(actions.closeWindow);
      }
    },
  );

  it.each(PLATFORMS)(
    "takes ⌘W back while the deck is away — the window's, as in a view with no panes (%s)",
    (platform) => {
      const away = find(
        buildAppMenu(platform, { view: "godview", deck: "away" }, actions),
        CLOSE_WINDOW_ITEM_ID,
      );
      // Not a behaviour of its own: the very item History and the canvas carry.
      expect(away).toEqual(
        find(buildAppMenu(platform, { view: "history" }, actions), CLOSE_WINDOW_ITEM_ID),
      );
      expect(away).toMatchObject({ role: "close", accelerator: "CommandOrControl+W" });
      expect(away?.click).toBeUndefined();
    },
  );

  it.each(PLATFORMS)("lends nothing by a deck's word outside Godview (%s)", (platform) => {
    // Main keeps what the page last said. A change of view must not wait for
    // the page to take its word back before ⌘W is the window's again.
    for (const view of ["canvas", "history"] as const) {
      for (const deck of DECKS) {
        expect(
          find(buildAppMenu(platform, menuState(view, deck), actions), CLOSE_WINDOW_ITEM_ID),
          `${view} · ${String(deck)}`,
        ).toEqual({ id: CLOSE_WINDOW_ITEM_ID, role: "close", accelerator: "CommandOrControl+W" });
      }
    }
  });

  it.each(PLATFORMS)(
    "keeps Close Window present-but-disabled when nothing can close it (%s)",
    (platform) => {
      // Same law as Godview's disabled face: an absent item reads as a missing
      // feature. Only reachable while the overlay is open, where the item has
      // no role to fall back on.
      const item = find(
        buildAppMenu(platform, { view: "godview" }, noActions),
        CLOSE_WINDOW_ITEM_ID,
      );
      expect(item?.enabled).toBe(false);
      expect(item?.click).toBeUndefined();
      expect(item?.accelerator).toBeUndefined();
    },
  );

  it.each(PLATFORMS)("declares exactly one close item, whatever the state (%s)", (platform) => {
    // The `fileMenu` and `windowMenu` roles each contain a `close` of their
    // own; taking either would plant a second, unconditional ⌘W beside the
    // conditional one and the deck would lose the chord to whichever fired.
    //
    // Keyed on the ITEM ID, not on `role: "close"` — since 2026-08-10 the item
    // sheds its role while the overlay is open, so a role-keyed count would read
    // zero there and stop watching for the very duplicate it exists to catch.
    for (const view of VIEWS) {
      for (const deck of DECKS) {
        const items = flatten(buildAppMenu(platform, menuState(view, deck), actions));
        expect(items.filter((item) => item.id === CLOSE_WINDOW_ITEM_ID)).toHaveLength(1);
        // and nothing ELSE may carry a close role, in either state
        expect(
          items.filter((item) => item.role === "close" && item.id !== CLOSE_WINDOW_ITEM_ID),
        ).toHaveLength(0);
      }
    }
  });

  it.each(PLATFORMS)("keeps the standard sections Electron's default menu had (%s)", (platform) => {
    const roles = new Set(
      flatten(buildAppMenu(platform, { view: "canvas" }, actions)).map((item) => item.role),
    );
    // Owning the menu means owning all of it: an Edit menu that lost Copy would
    // be a regression the accelerator paid for.
    expect(roles.has("editMenu")).toBe(true);
    expect(roles.has("minimize")).toBe(true);
    expect(roles.has("togglefullscreen")).toBe(true);
    // Quit lives in the app menu on darwin and in File everywhere else.
    expect(roles.has(platform === "darwin" ? "appMenu" : "quit")).toBe(true);
  });
});

describe("Take Screenshot (SNAP-D3)", () => {
  const takeScreenshot = () => undefined;
  const withScreenshot = { ...actions, takeScreenshot };

  it.each(PLATFORMS)(
    "offers the item with the prototype's chord as an APPLICATION accelerator (%s)",
    (platform) => {
      const item = find(
        buildAppMenu(platform, { view: "canvas" }, withScreenshot),
        SCREENSHOT_ITEM_ID,
      );
      expect(item).toMatchObject({ label: "Take Screenshot", enabled: true });
      expect(item?.accelerator).toBe(screenshotAccelerator(platform));
      expect(item?.accelerator).toBe(platform === "darwin" ? "Control+Command+A" : "Alt+A");
      expect(item?.click).toBe(takeScreenshot);
      // no role: this is our command, not one of Electron's
      expect(item?.role).toBeUndefined();
    },
  );

  it.each(PLATFORMS)("stays present-but-disabled where no helper exists (%s)", (platform) => {
    // SNAP-D5: an absent item reads as a missing feature; a disabled one with
    // its chord still showing reads as "not here yet", which is the truth on a
    // platform without a helper or in a dev tree before its first build.
    const item = find(buildAppMenu(platform, { view: "canvas" }, actions), SCREENSHOT_ITEM_ID);
    expect(item?.enabled).toBe(false);
    expect(item?.click).toBeUndefined();
    expect(item?.accelerator).toBe(screenshotAccelerator(platform));
  });

  it.each(PLATFORMS)("claims its chord exactly once, in every overlay state (%s)", (platform) => {
    for (const view of VIEWS) {
      const items = flatten(buildAppMenu(platform, { view }, withScreenshot));
      expect(
        items.filter((item) => item.accelerator === screenshotAccelerator(platform)),
      ).toHaveLength(1);
      expect(items.filter((item) => item.id === SCREENSHOT_ITEM_ID)).toHaveLength(1);
    }
  });
});

describe("the View menu's zoom (One Frame FR-4, 3b)", () => {
  const zoomed: FrameZoomAct[] = [];
  const withZoom = {
    ...actions,
    zoom: (act: FrameZoomAct) => {
      zoomed.push(act);
    },
  };
  const ZOOM_IDS = [ZOOM_ITEM_IDS.actual, ZOOM_ITEM_IDS.in, ZOOM_ITEM_IDS.out];
  const PAGE_ZOOM_ROLES = ["resetZoom", "zoomIn", "zoomOut"];

  it.each(PLATFORMS)("carries none of Electron's page-zoom roles, in any view (%s)", (platform) => {
    // FR-3's finding: the roles zoomed the WHOLE WINDOW wherever nothing
    // claimed ⌘0 ⌘+ ⌘−, and their items always did. A role on one of these
    // items would bring that back as its default behaviour.
    for (const view of VIEWS) {
      const items = flatten(buildAppMenu(platform, { view }, withZoom));
      expect(items.filter((item) => PAGE_ZOOM_ROLES.includes(item.role ?? ""))).toEqual([]);
      for (const id of ZOOM_IDS) {
        const found = items.filter((item) => item.id === id);
        expect(found).toHaveLength(1);
        expect(found[0]?.role).toBeUndefined();
      }
    }
  });

  it.each(PLATFORMS)(
    "names Actual Size, Zoom In and Zoom Out where the roles stood, their keys said (%s)",
    (platform) => {
      const view = buildAppMenu(platform, { view: "canvas" }, withZoom).find(
        (item) => item.label === "View",
      );
      const submenu = view?.submenu ?? [];
      const at = submenu.findIndex((item) => item.id === ZOOM_ITEM_IDS.actual);
      expect(submenu[at - 1]?.type).toBe("separator");
      expect(
        submenu.slice(at, at + 3).map((item) => [item.id, item.label, item.accelerator]),
      ).toEqual([
        [ZOOM_ITEM_IDS.actual, "Actual Size", "CommandOrControl+0"],
        [ZOOM_ITEM_IDS.in, "Zoom In", "CommandOrControl+Plus"],
        [ZOOM_ITEM_IDS.out, "Zoom Out", "CommandOrControl+-"],
      ]);
      expect(submenu[at + 3]?.type).toBe("separator");
      // VIEW_KEYS_ROAD: the page answers ⌘0 ⌘+ ⌘− first on Canvas; off the Mac
      // the menu only SAYS them.
      for (const id of ZOOM_IDS) {
        expect(find(submenu, id)?.registerAccelerator).toBe(
          platform === "darwin" ? undefined : false,
        );
      }
    },
  );

  it.each(PLATFORMS)("sends each item's act to the head on Canvas (%s)", (platform) => {
    zoomed.length = 0;
    const menu = buildAppMenu(platform, { view: "canvas" }, withZoom);
    for (const id of ZOOM_IDS) {
      const item = find(menu, id);
      expect(item?.enabled).toBe(true);
      item?.click?.();
    }
    expect(zoomed).toEqual(["actual", "in", "out"]);
  });

  it.each(PLATFORMS)("is disabled under a cover, and sends nothing there (%s)", (platform) => {
    // The zoom is Canvas's instrument: under Godview or History there is no
    // canvas to zoom, and the menu is told the view by its one owner (FR-1).
    zoomed.length = 0;
    for (const view of ["godview", "history", "assistant"] as const) {
      for (const id of ZOOM_IDS) {
        const item = find(buildAppMenu(platform, { view }, withZoom), id);
        expect(item?.enabled).toBe(false);
        expect(item?.click).toBeUndefined();
        // still SAID while disabled, as a disabled Take Screenshot keeps its chord
        expect(item?.accelerator).toBeDefined();
      }
    }
    expect(zoomed).toEqual([]);
  });

  it.each(PLATFORMS)("stays present-but-disabled where nothing can zoom (%s)", (platform) => {
    for (const id of ZOOM_IDS) {
      const item = find(buildAppMenu(platform, { view: "canvas" }, noActions), id);
      expect(item?.enabled).toBe(false);
      expect(item?.click).toBeUndefined();
    }
  });
});
