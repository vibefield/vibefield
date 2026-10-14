// @vitest-environment happy-dom
/**
 * ROOM v3 (rosetta `vf/room-host-slots`), over the room's demo ports:
 *
 * 1. A host's menus are drawn ABOVE the columns, in the room's root, anchored
 *    to their control, flipped above it when there is more room there, and
 *    clamped inside the room's box (lane pj4's Electron photographs: every
 *    column clipped what crossed its edge). happy-dom lays nothing out, so the
 *    geometry rows hand the room measured boxes and read where it put the rows.
 * 2. A menu a pointer opens focuses its rows without a ring; one a key opens
 *    lands on the chosen row (the ring is `:focus-visible`'s).
 * 3. H4 (docket v9, ruled (a)): rename on ②'s name itself; a folder row's act
 *    ("Not part of this project"); an act at ①'s row end (pin, hide).
 *
 * Each given and absent; with nothing given the room is rosetta's (the lane's
 * golden, written at eab2f57, stays byte-identical).
 */
import {
  HistoryRoom,
  type HistoryRoomHandle,
  type HistoryRoomProps,
  type RoomAct,
  type RoomFolders,
  type RoomMenu,
} from "@vibefield/rosetta-room";
import { createDemoPorts, createRoomDemo } from "@vibefield/rosetta-room/fixtures";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeAll(async () => {
  await import("@vibefield/rosetta-room");
}, 60_000);

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function until<T>(
  read: () => T | null | undefined | false,
  label: string,
  ms = 5_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

type Inputs = Omit<HistoryRoomProps, "catalog" | "sessions" | "assets" | "host">;

async function room(inputs: Inputs = {}) {
  const ports = createDemoPorts(createRoomDemo());
  const handle = createRef<HistoryRoomHandle>();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const el = host;
  act(() => root?.render(<HistoryRoom ref={handle} {...ports} storage={null} {...inputs} />));
  await until(
    () => el.querySelector('.ah-project-list-item[data-motion-key="p0"]'),
    "the ledger's rows",
  );
  return { el, handle };
}

const frame = (el: HTMLElement) => el.querySelector<HTMLElement>(".ah-frame")!;
const column = (el: HTMLElement, n: number) =>
  el.querySelector(`.ah-cols > .ah-col:nth-child(${n})`);
const projectRow = (el: HTMLElement, id: string) =>
  el.querySelector<HTMLElement>(`.ah-project-list-item[data-motion-key="${id}"]`);

const menu = (label: string, keys: readonly string[], chosen: string[] = []): RoomMenu => ({
  label,
  groups: [
    {
      key: "g",
      items: keys.map((key, at) => ({
        key,
        label: key,
        checked: at === 0,
        onSelect: () => chosen.push(key),
      })),
    },
  ],
});

/** The boxes happy-dom cannot lay out: the room's own, one control's, and the
 * rows' natural size. Everything else measures nothing, as before. */
function measure(boxes: {
  readonly room: { readonly width: number; readonly height: number };
  readonly control: {
    readonly selector: string;
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly menu: { readonly width: number; readonly height: number };
}) {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains("ah-frame")) return rect(0, 0, boxes.room.width, boxes.room.height);
    if (this.matches(boxes.control.selector)) {
      const c = boxes.control;
      return rect(c.left, c.top, c.width, c.height);
    }
    return rect(0, 0, 0, 0);
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains("ah-frame")) return boxes.room.width;
    if (this.classList.contains("ah-menu")) return boxes.menu.width;
    return 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains("ah-menu")) return boxes.menu.height;
    return 0;
  });
}

const placed = (el: HTMLElement) => {
  const rows = frame(el).querySelector<HTMLElement>(":scope > .ah-menu[data-layer]")!;
  return {
    rows,
    left: rows.style.left,
    top: rows.style.top,
    maxHeight: rows.style.maxHeight,
    maxWidth: rows.style.maxWidth,
    side: rows.dataset.side,
  };
};

describe("1 — a host's menus are drawn over the columns, anchored, flipped and clamped inside the room", () => {
  it("②'s New agent, hung from its end in a narrow room, is held inside the room's left edge", async () => {
    const newAgent: RoomAct = {
      key: "new",
      label: "New agent",
      content: "+",
      primary: true,
      menu: menu("New agent", ["here", "claude"]),
    };
    const { el } = await room({ projectActs: (id) => (id === "p0" ? [newAgent] : null) });
    act(() => projectRow(el, "p0")?.click());
    const trigger = await until(
      () => column(el, 2)?.querySelector<HTMLButtonElement>("button[data-act='new']"),
      "New agent",
    );
    measure({
      room: { width: 320, height: 500 },
      control: { selector: "button[data-act='new']", left: 280, top: 10, width: 26, height: 26 },
      menu: { width: 300, height: 200 },
    });
    act(() => trigger.click());
    const at = placed(el);
    // drawn in the room's root, never inside the column that clipped it
    expect(at.rows.parentElement).toBe(frame(el));
    expect(column(el, 2)?.querySelector(".ah-menu")).toBeNull();
    // from the control's end (306 − 300 = 6) to the room's margin: 8
    expect(at.left).toBe("8px");
    expect(at.top).toBe("42px");
    expect(at.side).toBe("below");
    expect(at.maxHeight).toBe("450px");
    expect(at.maxWidth).toBe("304px");
  });

  it("①'s chip, hung from its start near the room's right edge, is held inside that edge", async () => {
    const chip = {
      key: "desktop",
      label: "any desktop",
      accessibleLabel: "Filter by desktop",
      menu: menu("Desktops", ["any", "a-very-long-desktop-name"]),
    };
    const { el } = await room({ projectFilters: [chip] });
    const trigger = el.querySelector<HTMLButtonElement>("button[data-filter='desktop']")!;
    measure({
      room: { width: 320, height: 500 },
      control: {
        selector: "button[data-filter='desktop']",
        left: 200,
        top: 300,
        width: 90,
        height: 24,
      },
      menu: { width: 300, height: 120 },
    });
    act(() => trigger.click());
    const at = placed(el);
    expect(at.left).toBe("12px"); // 320 − 8 − 300
    expect(at.top).toBe("330px");
    expect(at.side).toBe("below");
  });

  it("③'s folders flip above a control near the room's foot, with the room above as their height", async () => {
    const folders: RoomFolders = {
      groups: [
        {
          key: "g",
          folders: [
            { key: "a", path: "/x/alpha" },
            { key: "b", path: "/x/beta" },
          ],
        },
      ],
    };
    const { el } = await room({ folders: () => folders });
    act(() => projectRow(el, "p0")?.click());
    const trigger = await until(
      () => column(el, 3)?.querySelector<HTMLButtonElement>("button.ah-folderpick"),
      "③'s dropdown",
    );
    measure({
      room: { width: 1180, height: 500 },
      control: { selector: "button.ah-folderpick", left: 600, top: 440, width: 200, height: 26 },
      menu: { width: 260, height: 200 },
    });
    act(() => trigger.click());
    const at = placed(el);
    expect(at.side).toBe("above");
    expect(at.top).toBe("234px"); // 440 − 6 − 200
    expect(at.maxHeight).toBe("426px"); // 440 − 6 − 8
    expect(at.left).toBe("600px");
  });

  it("rows wider than the room take the room less its margins", async () => {
    const newAgent: RoomAct = {
      key: "new",
      label: "New agent",
      content: "+",
      menu: menu("New agent", ["here"]),
    };
    const { el } = await room({ projectActs: () => [newAgent] });
    act(() => projectRow(el, "p0")?.click());
    const trigger = await until(
      () => column(el, 2)?.querySelector<HTMLButtonElement>("button[data-act='new']"),
      "New agent",
    );
    measure({
      room: { width: 200, height: 500 },
      control: { selector: "button[data-act='new']", left: 170, top: 10, width: 26, height: 26 },
      menu: { width: 300, height: 100 },
    });
    act(() => trigger.click());
    const at = placed(el);
    expect(at.maxWidth).toBe("184px");
    expect(at.left).toBe("8px");
  });

  it("a press outside closes the rows; a press inside them does not", async () => {
    const chosen: string[] = [];
    const chip = {
      key: "desktop",
      label: "any desktop",
      accessibleLabel: "Filter by desktop",
      menu: menu("Desktops", ["any", "studio"], chosen),
    };
    const { el } = await room({ projectFilters: [chip] });
    const trigger = el.querySelector<HTMLButtonElement>("button[data-filter='desktop']")!;
    act(() => trigger.click());
    const row = frame(el).querySelector<HTMLButtonElement>(".ah-menu__item[data-key='studio']")!;
    act(() => row.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(frame(el).querySelector(".ah-menu")).not.toBeNull();
    act(() => row.click());
    expect(chosen).toEqual(["studio"]);
    expect(frame(el).querySelector(".ah-menu")).toBeNull();
    act(() => trigger.click());
    act(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(frame(el).querySelector(".ah-menu")).toBeNull();
  });
});

describe("2 — the ring is a key's, never a pointer's", () => {
  it("a pointer opens onto the rows with no row focused; a key then walks them", async () => {
    const chip = {
      key: "desktop",
      label: "any desktop",
      accessibleLabel: "Filter by desktop",
      menu: menu("Desktops", ["any", "studio"]),
    };
    const { el } = await room({ projectFilters: [chip] });
    const trigger = el.querySelector<HTMLButtonElement>("button[data-filter='desktop']")!;
    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      trigger.click();
    });
    const list = frame(el).querySelector<HTMLElement>(".ah-menu [role='menu']")!;
    expect(document.activeElement).toBe(list);
    expect(frame(el).querySelector(".ah-menu__item:focus")).toBeNull();
    act(() =>
      list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    expect((document.activeElement as HTMLElement).dataset.key).toBe("any");
  });

  it("a key opens onto the chosen row", async () => {
    const chip = {
      key: "desktop",
      label: "any desktop",
      accessibleLabel: "Filter by desktop",
      menu: menu("Desktops", ["any", "studio"]),
    };
    const { el } = await room({ projectFilters: [chip] });
    act(() => el.querySelector<HTMLButtonElement>("button[data-filter='desktop']")?.click());
    expect((document.activeElement as HTMLElement).dataset.key).toBe("any");
  });
});

describe("3 — H4: pin and hide at ①'s row end, a folder's own act, rename on ②'s name", () => {
  it("(a) ①'s row act: the row stays the selection under one covering button; the act presses, or opens its rows", async () => {
    const pressed: string[] = [];
    const chosen: string[] = [];
    const { el } = await room({
      projectRow: (id) =>
        id === "p0"
          ? {
              act: {
                key: "pin",
                label: "Pin vibe-field",
                content: "Pin",
                onPress: () => pressed.push(id),
              },
            }
          : id === "p1"
            ? {
                act: {
                  key: "more",
                  label: "More for rosetta",
                  content: "···",
                  menu: menu("rosetta", ["pin", "hide"], chosen),
                },
              }
            : null,
    });
    const p0 = projectRow(el, "p0")!;
    expect(p0.tagName).toBe("DIV");
    expect(el.querySelector("button button")).toBeNull();
    const hit = p0.querySelector<HTMLButtonElement>(":scope > button.ah-project-list-item__hit")!;
    expect(hit.getAttribute("aria-label")).toContain("vibe-field");
    const end = p0.querySelector(".ah-project-list-item__footer > .ah-project-list-item__end")!;
    const pin = end.querySelector<HTMLButtonElement>(
      "button.ah-hostact[data-place='row'][data-act='pin']",
    )!;
    expect(end.lastElementChild?.className).toBe("ah-last");
    act(() => pin.click());
    expect(pressed).toEqual(["p0"]);
    expect(p0.classList.contains("is-selected")).toBe(false);
    act(() => hit.click());
    expect(projectRow(el, "p0")?.classList.contains("is-selected")).toBe(true);
    // an act with rows opens them over the columns
    const more = projectRow(el, "p1")!.querySelector<HTMLButtonElement>("button[data-act='more']")!;
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    act(() => more.click());
    act(() =>
      frame(el)
        .querySelector<HTMLButtonElement>(":scope > .ah-menu .ah-menu__item[data-key='hide']")
        ?.click(),
    );
    expect(chosen).toEqual(["hide"]);
    expect(projectRow(el, "p1")?.classList.contains("is-selected")).toBe(false);
    // a row the host leaves alone is one button
    expect(projectRow(el, "p2")?.tagName).toBe("BUTTON");
  });

  it("(b) ③'s folder row carries its own act beside it: → reaches it, ← returns, a press closes the list", async () => {
    const split: string[] = [];
    const folders: RoomFolders = {
      groups: [
        {
          key: "g",
          folders: [
            { key: "a", path: "/x/alpha" },
            {
              key: "b",
              path: "/x/beta",
              act: {
                key: "split",
                label: "Not part of this project",
                content: "Not part of this project",
                onPress: () => split.push("b"),
              },
            },
          ],
        },
      ],
    };
    const { el } = await room({ folders: () => folders });
    act(() => projectRow(el, "p0")?.click());
    const pick = await until(
      () => column(el, 3)?.querySelector<HTMLButtonElement>("button.ah-folderpick"),
      "③'s dropdown",
    );
    act(() => pick.click());
    const list = frame(el).querySelector<HTMLElement>(".ah-menu [role='menu']")!;
    // a row without an act is the row alone; one with an act holds two buttons side by side
    expect(list.querySelector(".ah-menu__group > .ah-menu__item[data-key='a']")).not.toBeNull();
    const row = list.querySelector<HTMLElement>(".ah-menu__row[data-key='b']")!;
    expect([...row.children].map((kid) => kid.className)).toEqual([
      "ah-menu__item",
      "ah-menu__act",
    ]);
    expect(row.querySelector("button button")).toBeNull();
    const item = row.querySelector<HTMLButtonElement>(".ah-menu__item")!;
    const splitAct = row.querySelector<HTMLButtonElement>(".ah-menu__act")!;
    expect(splitAct.getAttribute("aria-label")).toBe("Not part of this project");
    act(() => item.focus());
    act(() =>
      item.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(document.activeElement).toBe(splitAct);
    act(() =>
      splitAct.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
    );
    expect(document.activeElement).toBe(item);
    act(() => splitAct.click());
    expect(split).toEqual(["b"]);
    expect(frame(el).querySelector(".ah-menu")).toBeNull();
    // the press was the act's, not the row's: ③ still shows the folder it showed
    expect(pick.title).not.toBe("/x/beta");
  });

  it("(c) ②'s name renames in place: Enter commits the trimmed name; a refusal is said there; Escape and leaving cancel", async () => {
    const asked: string[] = [];
    let refuse: string | null = "That name is taken";
    const { el } = await room({
      projectRename: (id) =>
        id === "p0"
          ? {
              label: "Rename the project",
              onRename: async (name) => {
                asked.push(name);
                if (refuse !== null) throw new Error(refuse);
              },
            }
          : null,
    });
    act(() => projectRow(el, "p0")?.click());
    const name = await until(
      () =>
        column(el, 2)?.querySelector<HTMLButtonElement>(
          ".ah-meta__head .ah-colhead > button.ah-rename",
        ),
      "the name",
    );
    expect(name.textContent).toBe("vibe-field");
    expect(name.getAttribute("aria-label")).toBe("Rename the project: vibe-field");
    act(() => name.click());
    const again = () =>
      column(el, 2)?.querySelector<HTMLInputElement>("input.ah-rename__field") ?? null;
    const typeIn = (value: string) =>
      act(() => {
        const input = again()!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    const key = (name: string) =>
      act(() => again()?.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })));
    const reopen = () =>
      act(() => column(el, 2)?.querySelector<HTMLButtonElement>("button.ah-rename")?.click());
    expect(again()?.value).toBe("vibe-field");
    expect(document.activeElement).toBe(again());
    // unchanged or empty: nothing asked, the name comes back
    key("Enter");
    expect(again()).toBeNull();
    expect(asked).toEqual([]);
    reopen();
    typeIn("   ");
    key("Enter");
    expect(again()).toBeNull();
    expect(asked).toEqual([]);
    // a refusal keeps the field open, says why where the name is
    reopen();
    typeIn("  Field  ");
    key("Enter");
    const failure = await until(
      () => column(el, 2)?.querySelector(".ah-colhead > .ah-rename__failure"),
      "the refusal",
    );
    expect(asked).toEqual(["Field"]);
    expect(failure.textContent).toBe("Could not rename — That name is taken");
    expect(failure.getAttribute("role")).toBe("alert");
    expect(again()?.getAttribute("aria-invalid")).toBe("true");
    expect(again()?.value).toBe("  Field  ");
    // accepted: the field closes onto the name (the host's catalog renames it)
    refuse = null;
    key("Enter");
    await until(() => again() === null, "the field closed");
    expect(asked).toEqual(["Field", "Field"]);
    // Escape cancels; so does leaving the field
    reopen();
    typeIn("Other");
    key("Escape");
    expect(again()).toBeNull();
    reopen();
    typeIn("Other");
    act(() => again()?.dispatchEvent(new FocusEvent("blur")));
    act(() => again()?.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(again()).toBeNull();
    expect(asked).toEqual(["Field", "Field"]);
    // another project the host gives no rename keeps the room's head
    act(() => projectRow(el, "p1")?.click());
    await until(
      () =>
        column(el, 2)?.querySelector(".ah-meta__head .ah-colhead > strong")?.textContent ===
        "rosetta",
      "p1's head",
    );
  });

  it("absent: rows are buttons, folder rows have no act, and ②'s name is the room's heading", async () => {
    const { el } = await room({
      folders: () => ({ groups: [{ key: "g", folders: [{ key: "a", path: "/x/alpha" }] }] }),
    });
    for (const row of el.querySelectorAll(".ah-project-list-item"))
      expect(row.tagName).toBe("BUTTON");
    act(() => projectRow(el, "p0")?.click());
    const pick = await until(
      () => column(el, 3)?.querySelector<HTMLButtonElement>("button.ah-folderpick"),
      "③'s dropdown",
    );
    expect(column(el, 2)?.querySelector(".ah-meta__head .ah-colhead > strong")?.textContent).toBe(
      "vibe-field",
    );
    expect(el.querySelector(".ah-rename, .ah-rename__field, [data-host-act]")).toBeNull();
    act(() => pick.click());
    expect(frame(el).querySelector(".ah-menu__row, .ah-menu__act")).toBeNull();
  });
});
