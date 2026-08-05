import { describe, expect, it } from "vitest";
import {
  type AppMenuItem,
  buildAppMenu,
  CLOSE_WINDOW_ITEM_ID,
  GODVIEW_GESTURE_HINT,
  GODVIEW_ITEM_ID,
  type MenuPlatform,
} from "../src/main/app-menu-model";

// Godview's gesture is ⇧⇧ and lives OUTSIDE this template (a double tap is a
// rhythm; accelerators describe chords) — see godview-state.test.ts. What stays
// load-bearing here is what the menu must not do: claim an accelerator it does
// not own, take ⌘G back from the deck, or hold ⌘W while the overlay is up.

const flatten = (items: readonly AppMenuItem[]): AppMenuItem[] =>
  items.flatMap((item) => [item, ...flatten(item.submenu ?? [])]);

const find = (items: readonly AppMenuItem[], id: string): AppMenuItem | undefined =>
  flatten(items).find((item) => item.id === id);

const PLATFORMS: readonly MenuPlatform[] = ["darwin", "other"];
const noActions = {};
const actions = { toggleGodview: () => undefined };

describe("buildAppMenu", () => {
  it.each(PLATFORMS)("offers Godview as a checkbox carrying NO accelerator (%s)", (platform) => {
    // The absence is the assertion. ⌘⎋ sat here looking bound and firing
    // nothing, because macOS never delivers Command+Escape to an application —
    // a menu item that claims a key it cannot answer is worse than a silent one.
    const item = find(buildAppMenu(platform, { godviewOpen: false }, actions), GODVIEW_ITEM_ID);
    expect(item).toMatchObject({ type: "checkbox", checked: false, enabled: true });
    expect(item?.accelerator).toBeUndefined();
  });

  it.each(PLATFORMS)("teaches the gesture in the label instead (%s)", (platform) => {
    // A Godview row showing no way to reach it by keyboard would teach that
    // there isn't one, so the hint rides in the label the accelerator vacated.
    const item = find(buildAppMenu(platform, { godviewOpen: false }, actions), GODVIEW_ITEM_ID);
    expect(item?.label).toContain("Godview");
    expect(item?.label).toContain(GODVIEW_GESTURE_HINT);
  });

  it.each(PLATFORMS)("leaves ⌘G to the deck's panes at every state (%s)", (platform) => {
    // The toggle moved off ⌘G on 2026-08-04 precisely to end a collision: ⌘G is
    // find-next in ghostty, and an app accelerator always wins. Unlike ⌘W, which
    // the close item lends out and takes back, no item declares ⌘G in either
    // state — so search-next is the panes' whether the overlay is up or not.
    for (const godviewOpen of [false, true]) {
      const accelerators = flatten(buildAppMenu(platform, { godviewOpen }, actions)).map(
        (item) => item.accelerator,
      );
      expect(accelerators).not.toContain("CommandOrControl+G");
    }
  });

  it.each(PLATFORMS)("checks the box from main's own bit, never a guess (%s)", (platform) => {
    const item = find(buildAppMenu(platform, { godviewOpen: true }, actions), GODVIEW_ITEM_ID);
    expect(item?.checked).toBe(true);
  });

  it.each(PLATFORMS)("offers a disabled Godview when nothing can toggle it (%s)", (platform) => {
    // An absent item reads as a missing feature; a disabled one reads as "not
    // here yet", which is the truth in a mode with no window to flip.
    const item = find(buildAppMenu(platform, { godviewOpen: false }, noActions), GODVIEW_ITEM_ID);
    expect(item?.enabled).toBe(false);
    expect(item?.click).toBeUndefined();
  });

  it.each(PLATFORMS)("holds ⌘W for the window while the overlay is closed (%s)", (platform) => {
    const item = find(
      buildAppMenu(platform, { godviewOpen: false }, actions),
      CLOSE_WINDOW_ITEM_ID,
    );
    expect(item).toMatchObject({ role: "close", accelerator: "CommandOrControl+W" });
  });

  it.each(PLATFORMS)(
    "releases ⌘W to the deck's panes while the overlay is open (%s)",
    (platform) => {
      // ghostty binds ⌘W to close_surface, and an application accelerator always
      // wins — so with the deck up the menu gives the chord back. Closing a pane
      // detaches a session that lives on (GT-D5), which is what a user pressing
      // ⌘W in a terminal means.
      const item = find(
        buildAppMenu(platform, { godviewOpen: true }, actions),
        CLOSE_WINDOW_ITEM_ID,
      );
      expect(item?.accelerator).toBeUndefined();
      expect(item?.role).toBe("close");
    },
  );

  it.each(PLATFORMS)("declares exactly one close item, whatever the state (%s)", (platform) => {
    // The `fileMenu` and `windowMenu` roles each contain a `close` of their
    // own; taking either would plant a second, unconditional ⌘W beside the
    // conditional one and the deck would lose the chord to whichever fired.
    for (const godviewOpen of [false, true]) {
      const closes = flatten(buildAppMenu(platform, { godviewOpen }, actions)).filter(
        (item) => item.role === "close",
      );
      expect(closes).toHaveLength(1);
      expect(closes[0]?.id).toBe(CLOSE_WINDOW_ITEM_ID);
    }
  });

  it.each(PLATFORMS)("keeps the standard sections Electron's default menu had (%s)", (platform) => {
    const roles = new Set(
      flatten(buildAppMenu(platform, { godviewOpen: false }, actions)).map((item) => item.role),
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
