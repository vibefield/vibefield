// @vitest-environment happy-dom
/**
 * H1 (docket v9, ruled (a) 2026-10-09: "we map, the room draws") — rosetta's
 * room grows OPTIONAL host inputs (s-pj4 A5's R1–R9, rosetta
 * `vf/room-host-slots`), and stays device-unaware (A-D9): opaque host keys and
 * render slots it draws and never interprets. Each input here twice, over the
 * room's demo ports: given, the room draws it; absent, the room draws what it
 * drew before (rosetta's app, the reference host, passes none). Lane pj4 codes
 * the adapter against these shapes.
 */
import {
  HistoryRoom,
  type HistoryRoomHandle,
  type HistoryRoomProps,
  type HostPort,
  type RoomFilter,
  type RoomFolders,
  type RoomProjectContext,
  type RoomSelection,
} from "@rosetta/room";
import { createDemoPorts, createRoomDemo } from "@rosetta/room/fixtures";
import { act, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeAll(async () => {
  await import("@rosetta/room");
}, 60_000);

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
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

/** The room over its demo ports, with these inputs; settled once its rows are drawn. */
async function room(inputs: Inputs = {}, desktop: HostPort | null = null) {
  const demo = createRoomDemo();
  const ports = { ...createDemoPorts(demo), host: desktop };
  const handle = createRef<HistoryRoomHandle>();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const el = host;
  const render = (next: Inputs) =>
    act(() => root?.render(<HistoryRoom ref={handle} {...ports} storage={null} {...next} />));
  render(inputs);
  await until(
    () => el.querySelector('.ah-project-list-item[data-motion-key="p0"]'),
    "the ledger's rows",
  );
  return { el, demo, handle, render };
}

const projectRow = (el: HTMLElement, id: string) =>
  el.querySelector<HTMLElement>(`.ah-project-list-item[data-motion-key="${id}"]`);

describe("R1 — a host colour per project", () => {
  it("given, a project's tint is the host's; a project it leaves out keeps the dealt one", async () => {
    const { el, handle } = await room({
      projectTint: (id) => (id === "p0" ? "rgb(1, 2, 3)" : null),
    });
    expect(projectRow(el, "p0")?.style.getPropertyValue("--project-color")).toBe("rgb(1, 2, 3)");
    expect(projectRow(el, "p1")?.style.getPropertyValue("--project-color")).toMatch(
      /^oklch\(var\(--tint-l\)/,
    );
    // the colour follows the project across the room: ②'s panel wears it too
    act(() => handle.current?.openAt({ sessionId: "s0" }));
    const panel = await until(
      () => el.querySelector<HTMLElement>(".ah-col .ah-meta[style]"),
      "②'s panel",
    );
    expect(panel.style.getPropertyValue("--tint")).toBe("rgb(1, 2, 3)");
  });

  it("absent, every project wears the room's dealt tint", async () => {
    const { el } = await room();
    for (const row of el.querySelectorAll<HTMLElement>(".ah-project-list-item")) {
      expect(row.style.getPropertyValue("--project-color")).toMatch(/^oklch\(var\(--tint-l\)/);
    }
  });
});

/** A list's drawn order: rows by id, a section head as `head:key`, a fold line as `fold:key`. */
function drawn(list: Element | null): string[] {
  return [...(list?.children ?? [])].flatMap((child) => {
    const el = child as HTMLElement;
    if (el.classList.contains("ah-section")) return [`head:${el.dataset.section}`];
    if (el.classList.contains("ah-fold")) return [`fold:${el.dataset.section}`];
    if (el.dataset.motionKey !== undefined) return [el.dataset.motionKey];
    return [];
  });
}
const ledger = (el: HTMLElement) => el.querySelector(".ah-cols > .ah-col:nth-child(1) .ah-scroll");
const sessionList = (el: HTMLElement) =>
  el.querySelector(".ah-cols > .ah-col:nth-child(2) .ah-scroll");

describe("R2 — a project row's marks, second line and live count", () => {
  it("given, the marks lead the path line, the second line sits under it, and the time slot says 'n live'", async () => {
    const { el } = await room({
      projectRow: (id) =>
        id === "p0"
          ? { marks: <i data-host-mark="">M</i>, line: "3 sessions on Studio", live: 2 }
          : id === "p1"
            ? { live: 0 }
            : null,
    });
    const p0 = projectRow(el, "p0")!;
    const path = p0.querySelector(".ah-project-list-item__path[data-marks]")!;
    expect(path.firstElementChild?.className).toBe("ah-project-list-item__marks");
    expect(path.firstElementChild?.querySelector("[data-host-mark]")).not.toBeNull();
    expect(path.lastElementChild?.tagName).toBe("SMALL");
    expect(p0.querySelector(".ah-project-list-item__line")?.textContent).toBe(
      "3 sessions on Studio",
    );
    expect(p0.hasAttribute("data-line")).toBe(true);
    const last = p0.querySelector(".ah-last")!;
    expect(last.textContent).toBe("2 live");
    expect(last.hasAttribute("data-live")).toBe(true);
    expect(p0.getAttribute("aria-label")).toContain("2 live");
    // a row the host decorates with nothing (or zero live) is the room's own
    const p1 = projectRow(el, "p1")!;
    expect(
      p1.querySelector(".ah-project-list-item__marks, .ah-project-list-item__line"),
    ).toBeNull();
    expect(p1.querySelector(".ah-last")?.textContent).not.toMatch(/live/);
  });

  it("absent, no row carries a host mark, a second line or a live count", async () => {
    const { el } = await room();
    expect(
      el.querySelector(
        "[data-marks], [data-line], .ah-project-list-item__marks, .ah-project-list-item__line",
      ),
    ).toBeNull();
    for (const last of el.querySelectorAll(".ah-project-list-item .ah-last")) {
      expect(last.textContent).not.toMatch(/live/);
    }
  });
});

describe("R3 — sections over the lists", () => {
  it("① draws the host's sections in order: Live now first, the rest in the room's order, a folded foot", async () => {
    const { el } = await room({
      projectSections: [
        { key: "live", title: "Live now", ids: ["p3", "p1"] },
        { key: "rest" },
        { key: "temp", ids: ["p5", "p1"], fold: { label: "Temporary", act: "Show older" } },
      ],
    });
    const order = drawn(ledger(el));
    expect(order.slice(0, 3)).toEqual(["head:live", "p3", "p1"]);
    expect(order.at(-1)).toBe("fold:temp");
    // the rest: every row no section names, in the room's own order; p1 is drawn once, in Live now
    const rest = order.slice(3, -1);
    expect(new Set(rest)).toEqual(new Set(["p0", "p2", "p4"]));
    expect(el.querySelector(".ah-section[data-section='live']")?.textContent).toBe("Live now");
    const fold = el.querySelector<HTMLButtonElement>(".ah-fold[data-section='temp']")!;
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(fold.textContent).toBe("Temporary1Show older");
    expect(projectRow(el, "p5")).toBeNull();
    act(() => fold.click());
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(drawn(ledger(el)).slice(-2)).toEqual(["fold:temp", "p5"]);
    expect(fold.querySelector(".ah-fold__act")).toBeNull();
    act(() => fold.click());
    expect(projectRow(el, "p5")).toBeNull();
  });

  it("① hides what no section names when every section names its rows (a host filter)", async () => {
    const { el } = await room({ projectSections: [{ key: "only", ids: ["p2", "p0"] }] });
    expect(drawn(ledger(el))).toEqual(["p2", "p0"]);
  });

  it("a folded section holding the selected row opens", async () => {
    const { el, handle } = await room({
      projectSections: [
        { key: "rest" },
        { key: "temp", ids: ["p1"], fold: { label: "Temporary", act: "Show older" } },
      ],
    });
    expect(projectRow(el, "p1")).toBeNull();
    act(() => handle.current?.openAt({ sessionId: "s8" }));
    await until(
      () => projectRow(el, "p1")?.classList.contains("is-selected"),
      "p1 selected and drawn",
    );
    expect(el.querySelector(".ah-fold[data-section='temp']")?.getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("② draws a project's sections: Live now first, the threads by day, the older ones folded; the head counts what is drawn", async () => {
    const { el } = await room({
      sessionSections: (id) =>
        id === "p0"
          ? [
              { key: "live", title: "Live now", ids: ["s2"] },
              { key: "rest" },
              {
                key: "older",
                ids: ["s7", "s6"],
                order: "room",
                fold: { label: "Older", act: "Show older" },
              },
            ]
          : null,
    });
    act(() => projectRow(el, "p0")?.click());
    await until(() => sessionList(el)?.querySelector("[data-motion-key='s0']"), "②'s rows");
    const order = drawn(sessionList(el));
    expect(order.slice(0, 2)).toEqual(["head:live", "s2"]);
    expect(order.at(-1)).toBe("fold:older");
    expect(new Set(order.slice(2, -1))).toEqual(new Set(["s0", "s1", "s3", "s4", "s5"]));
    // the rest keeps the room's day heads
    expect(
      sessionList(el)?.querySelectorAll(":scope > .ah-day:not(.ah-section)").length,
    ).toBeGreaterThan(0);
    expect(el.querySelector(".ah-cols > .ah-col:nth-child(2) .ah-bubble")?.textContent).toBe("8");
    act(() => el.querySelector<HTMLButtonElement>(".ah-fold[data-section='older']")?.click());
    // opened in the room's order (s6 before s7), under their own day head
    const opened = drawn(sessionList(el));
    expect(opened.slice(opened.indexOf("fold:older") + 1)).toEqual(["s6", "s7"]);
  });

  it("absent, neither list draws a section head or a fold line", async () => {
    const { el } = await room();
    act(() => projectRow(el, "p0")?.click());
    await until(() => sessionList(el)?.querySelector("[data-motion-key='s0']"), "②'s rows");
    expect(el.querySelector(".ah-section, .ah-fold")).toBeNull();
    expect(drawn(ledger(el)).sort()).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
  });
});

const sessionRowOf = (el: HTMLElement, id: string) =>
  el.querySelector<HTMLElement>(`.ah-session-list-item[data-motion-key="${id}"]`);

describe("R4 — a session row's id slot, its act or reason, and the host's key", () => {
  it("given, the id slot is the host's, the act sits before the time, and the host key rides the selection", async () => {
    const pressed: string[] = [];
    const selections: (RoomSelection | null)[] = [];
    const { el } = await room({
      onSelect: (selection) => selections.push(selection),
      sessionRow: (session) =>
        session.id === "s0"
          ? {
              hostKey: "mac:s0",
              id: (
                <>
                  <i data-host-mark="" />
                  …/vibe-field
                </>
              ),
              idTitle: "~/Projects/vibe-field",
              act: {
                key: "resume",
                label: "Resume this session",
                content: "Resume",
                onPress: () => pressed.push("s0"),
              },
            }
          : session.id === "s1"
            ? { hostKey: "studio:s1", reason: "asleep" }
            : null,
    });
    act(() => projectRow(el, "p0")?.click());
    const s0 = await until(() => sessionRowOf(el, "s0"), "s0's row");
    // a row with an act is a box: one button covers it, the act sits above, and no button holds another
    expect(s0.tagName).toBe("DIV");
    expect(el.querySelector("button button")).toBeNull();
    const hit = s0.querySelector<HTMLButtonElement>(":scope > button.ah-session-list-item__hit")!;
    expect(hit.getAttribute("aria-label")).toContain("One frame for four views");
    const slot = s0.querySelector<HTMLElement>(".ah-session-list-item__native-id[data-host]")!;
    expect(slot.querySelector("[data-host-mark]")).not.toBeNull();
    expect(slot.textContent).toBe("…/vibe-field");
    expect(slot.title).toBe("~/Projects/vibe-field");
    const end = s0.querySelector(".ah-session-list-item__footer > .ah-session-list-item__end")!;
    const actButton = end.firstElementChild as HTMLButtonElement;
    expect(actButton.matches("button.ah-hostact[data-place='row'][data-act='resume']")).toBe(true);
    expect(actButton.textContent).toBe("Resume");
    expect(actButton.getAttribute("aria-label")).toBe("Resume this session");
    expect(end.lastElementChild?.className).toBe("ah-last");
    // pressing the act is the host's alone: the selection does not move
    act(() => actButton.click());
    expect(pressed).toEqual(["s0"]);
    expect(selections.at(-1)).toBeNull();
    // pressing the row selects it, with the host's key passed through untouched
    act(() => hit.click());
    await until(() => selections.at(-1)?.sessionId === "s0", "s0 selected");
    expect(selections.at(-1)).toEqual({
      sessionId: "s0",
      nativeSessionId: "native-claude-0",
      folder: "/Users/demo/Projects/vibe-field",
      hostKey: "mac:s0",
    });
    expect(s0.classList.contains("is-selected")).toBe(true);
    expect(hit.getAttribute("aria-current")).toBe("true");
    // a reason with no act keeps the row one button, the reason before the time
    const s1 = sessionRowOf(el, "s1")!;
    expect(s1.tagName).toBe("BUTTON");
    expect(
      s1.querySelector(".ah-session-list-item__end > .ah-session-list-item__reason")?.textContent,
    ).toBe("asleep");
    act(() => s1.click());
    await until(() => selections.at(-1)?.sessionId === "s1", "s1 selected");
    expect(selections.at(-1)?.hostKey).toBe("studio:s1");
    // a row the host leaves alone is the room's own
    const s2 = sessionRowOf(el, "s2")!;
    expect(
      s2.querySelector(".ah-session-list-item__native-id:not([data-host]) > span")?.textContent,
    ).toBe("native-codex-2");
    expect(s2.querySelector(".ah-session-list-item__end")).toBeNull();
  });

  it("absent, every row is one button with its native id, and the selection carries no host key", async () => {
    const selections: (RoomSelection | null)[] = [];
    const { el } = await room({ onSelect: (selection) => selections.push(selection) });
    act(() => projectRow(el, "p0")?.click());
    const s0 = await until(() => sessionRowOf(el, "s0"), "s0's row");
    for (const row of el.querySelectorAll(".ah-session-list-item"))
      expect(row.tagName).toBe("BUTTON");
    expect(
      el.querySelector("[data-host], .ah-hostact, .ah-session-list-item__end, [data-host-act]"),
    ).toBeNull();
    act(() => s0.click());
    await until(() => selections.at(-1)?.sessionId === "s0", "s0 selected");
    expect(selections.at(-1)).toEqual({
      sessionId: "s0",
      nativeSessionId: "native-claude-0",
      folder: "/Users/demo/Projects/vibe-field",
    });
    expect("hostKey" in (selections.at(-1) ?? {})).toBe(false);
  });
});

const head = (el: HTMLElement, column: number) =>
  el.querySelector(`.ah-cols > .ah-col:nth-child(${column})`);

describe("R5 — the heads: ②'s acts and card, ④'s acts or reason", () => {
  it("② draws the host's acts after its own, the primary on the go fill, a menu as the room's popover rows", async () => {
    const asked: [string, RoomProjectContext][] = [];
    const chosen: string[] = [];
    const { el } = await room({
      projectActs: (id, context) => {
        asked.push([id, context]);
        return id !== "p0"
          ? null
          : [
              {
                key: "pin",
                label: "Pin this project",
                content: "P",
                onPress: () => chosen.push("pin"),
              },
              {
                key: "new",
                label: "New agent",
                content: <i data-glyph="start" />,
                primary: true,
                menu: {
                  label: "New agent",
                  groups: [
                    {
                      key: "where",
                      title: "Starts in",
                      items: [
                        {
                          key: "here",
                          label: "~/Projects/vibe-field",
                          checked: true,
                          onSelect: () => chosen.push("here"),
                        },
                      ],
                    },
                    {
                      key: "recipes",
                      items: [
                        {
                          key: "claude",
                          label: "Claude",
                          aside: "last used",
                          checked: false,
                          onSelect: () => chosen.push("claude"),
                        },
                        {
                          key: "other",
                          label: "Another model",
                          detail: "not settable yet",
                          disabled: true,
                        },
                      ],
                    },
                  ],
                },
              },
            ];
      },
    });
    act(() => projectRow(el, "p0")?.click());
    const acts = await until(() => head(el, 2)?.querySelector(".ah-meta__acts"), "②'s head");
    const kids = [...acts.children];
    // the room's own first (the figures, the repository), the host's after, in its order
    expect(
      kids
        .slice(-2)
        .map((kid) => (kid.querySelector("[data-act]") ?? kid).getAttribute("data-act")),
    ).toEqual(["pin", "new"]);
    expect(asked.at(-1)).toEqual(["p0", { folder: null }]);
    const pin = acts.querySelector<HTMLButtonElement>("button[data-act='pin']")!;
    expect(pin.className).toBe("ah-iconbtn ah-hostact");
    act(() => pin.click());
    expect(chosen).toEqual(["pin"]);
    const trigger = acts.querySelector<HTMLButtonElement>("button[data-act='new']")!;
    expect(trigger.hasAttribute("data-primary")).toBe(true);
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.querySelector("[data-glyph='start']")).not.toBeNull();
    act(() => trigger.click());
    const menu = el.querySelector<HTMLElement>(".ah-menu [role='menu']")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(menu.getAttribute("aria-label")).toBe("New agent");
    expect(menu.querySelector(".ah-menu__title")?.textContent).toBe("Starts in");
    const items = [...menu.querySelectorAll<HTMLButtonElement>(".ah-menu__item")];
    expect(items.map((item) => item.getAttribute("role"))).toEqual([
      "menuitemradio",
      "menuitemradio",
      "menuitemradio",
    ]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(items[2]?.disabled).toBe(true);
    expect(items[2]?.querySelector(".ah-menu__detail")?.textContent).toBe("not settable yet");
    expect(items[1]?.querySelector(".ah-menu__aside")?.textContent).toBe("last used");
    // it opens on the chosen row, and the arrows walk the rows that can be chosen
    expect(document.activeElement).toBe(items[0]);
    act(() =>
      items[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    expect(document.activeElement).toBe(items[1]);
    act(() =>
      items[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    expect(document.activeElement).toBe(items[0]);
    // a choice is the host's, and closes the rows back onto their control
    act(() => items[1]?.click());
    expect(chosen).toEqual(["pin", "claude"]);
    expect(el.querySelector(".ah-menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    // Escape closes too
    act(() => trigger.click());
    expect(el.querySelector(".ah-menu")).not.toBeNull();
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(el.querySelector(".ah-menu")).toBeNull();
  });

  it("② draws the host's card under its head, above the list", async () => {
    const { el } = await room({
      projectCard: (id) =>
        id === "p0" ? <p data-card="">These two folders look like one project</p> : null,
    });
    act(() => projectRow(el, "p0")?.click());
    const card = await until(() => head(el, 2)?.querySelector(".ah-hostcard"), "the card");
    expect(card.querySelector("[data-card]")?.textContent).toBe(
      "These two folders look like one project",
    );
    expect(card.previousElementSibling?.classList.contains("ah-meta")).toBe(true);
    act(() => projectRow(el, "p1")?.click());
    await until(() => head(el, 2)?.querySelector(".ah-hostcard") === null, "no card for p1");
  });

  it("④ draws the host's acts before the activity act, or its reason after the range", async () => {
    const pressed: string[] = [];
    const { el, handle } = await room({
      sessionActs: (session) =>
        session.id === "s0"
          ? {
              acts: [
                {
                  key: "jump",
                  label: "Jump to this session",
                  content: "Jump to",
                  onPress: () => pressed.push(session.id),
                },
              ],
            }
          : session.id === "s1"
            ? { reason: "asleep · 2 h" }
            : null,
    });
    act(() => handle.current?.openAt({ sessionId: "s0" }));
    const acts = await until(
      () => head(el, 4)?.querySelector(".ah-headacts .ah-hostact"),
      "④'s act",
    );
    const row = [...(acts.parentElement?.children ?? [])];
    expect(row.map((kid) => kid.className)).toEqual([
      "ah-caption tnum",
      "ah-hostact",
      "ah-iconbtn",
    ]);
    expect(acts.getAttribute("data-place")).toBe("pill");
    expect(acts.textContent).toBe("Jump to");
    act(() => (acts as HTMLButtonElement).click());
    expect(pressed).toEqual(["s0"]);
    act(() => handle.current?.openAt({ sessionId: "s1" }));
    const reason = await until(() => head(el, 4)?.querySelector(".ah-headreason"), "④'s reason");
    expect(reason.textContent).toBe("asleep · 2 h");
    expect(reason.previousElementSibling?.className).toBe("ah-caption tnum");
    expect(head(el, 4)?.querySelector(".ah-hostact")).toBeNull();
  });

  it("absent, the heads hold only the room's own acts and no card", async () => {
    const { el, handle } = await room();
    act(() => handle.current?.openAt({ sessionId: "s0" }));
    await until(() => head(el, 4)?.querySelector(".ah-headacts .ah-iconbtn"), "④'s activity act");
    expect(el.querySelector(".ah-hostact, .ah-hostcard, .ah-headreason, .ah-menuhost")).toBeNull();
    expect(
      [...(head(el, 4)?.querySelector(".ah-headacts")?.children ?? [])].map((kid) => kid.className),
    ).toEqual(["ah-caption tnum", "ah-iconbtn"]);
  });
});

/** A desktop host whose worktree engine records the roots it is asked to open. */
function desktop(): { host: HostPort; opened: string[] } {
  const opened: string[] = [];
  let generation = 0;
  return {
    opened,
    host: {
      homeDir: "/Users/demo",
      platform: "darwin",
      openInBrowser: async () => false,
      favicon: async () => null,
      worktree: {
        open: async (root) => {
          opened.push(root);
          generation += 1;
          return { ok: true, generation };
        },
        gitFacts: async () => null,
        fileAction: async () => ({ ok: true }),
        ports: () => () => undefined,
      },
    },
  };
}

describe("R6 — ③'s head as the host's folder list", () => {
  it("lists every folder by group, checks the shown one by key, follows the session, and never opens one elsewhere", async () => {
    const shown: (string | null)[] = [];
    const contexts: RoomProjectContext[] = [];
    const folders: RoomFolders = {
      groups: [
        {
          key: "mac",
          title: "This Mac",
          folders: [
            {
              key: "mac:vf",
              path: "/Users/demo/Projects/vibe-field",
              mark: <i data-os="mac" />,
              detail: "main",
            },
            {
              key: "mac:lane",
              path: "/Users/demo/Projects/vibe-field-lane",
              depth: 1,
              detail: "lane-x",
            },
          ],
        },
        {
          key: "studio",
          title: "Studio",
          folders: [
            {
              key: "studio:vf",
              path: "/Users/demo/Projects/vibe-field",
              mark: <i data-os="studio" />,
              caption: "Studio · main",
              elsewhere: <p data-elsewhere="">Files stay on Studio</p>,
            },
          ],
        },
      ],
      initial: "mac:lane",
      of: (session) => (session.id === "s1" ? "studio:vf" : session.id === "s0" ? "mac:vf" : null),
      filterAfter: 2,
      filterPlaceholder: "Filter 3 folders",
      onShow: (key) => shown.push(key),
    };
    const { host: desk, opened } = desktop();
    const { el } = await room(
      {
        folders: (id) => (id === "p0" ? folders : null),
        projectActs: (_id, context) => {
          contexts.push(context);
          return null;
        },
      },
      desk,
    );
    act(() => projectRow(el, "p0")?.click());
    const pick = await until(
      () => head(el, 3)?.querySelector<HTMLButtonElement>("header button.ah-folderpick"),
      "③'s dropdown",
    );
    // no session yet: the usual place
    expect(pick.querySelector("strong")?.textContent).toBe("~/Projects/vibe-field-lane");
    await until(() => shown.at(-1) === "mac:lane", "onShow(mac:lane)");
    expect(contexts.at(-1)).toEqual({ folder: "mac:lane" });
    // the guest opens on the shown folder's path
    act(() =>
      head(el, 2)
        ?.querySelector<HTMLButtonElement>("button[aria-label='Toggle the project worktree']")
        ?.click(),
    );
    await until(
      () => opened.at(-1) === "/Users/demo/Projects/vibe-field-lane",
      "the engine on the lane",
    );
    // the list: every folder by group, the shown one checked, a worktree one step in, a filter past two
    act(() => pick.click());
    const rows = [...(head(el, 3)?.querySelectorAll<HTMLButtonElement>(".ah-menu__item") ?? [])];
    expect(rows.map((row) => row.dataset.key)).toEqual(["mac:vf", "mac:lane", "studio:vf"]);
    expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(rows[1]?.dataset.depth).toBe("1");
    expect(rows[0]?.querySelector(".ah-menu__label")?.textContent).toBe("~/Projects/vibe-field");
    expect(
      [...(head(el, 3)?.querySelectorAll(".ah-menu__title") ?? [])].map((t) => t.textContent),
    ).toEqual(["This Mac", "Studio"]);
    const filter = head(el, 3)?.querySelector<HTMLInputElement>(".ah-menu__filter");
    expect(filter?.placeholder).toBe("Filter 3 folders");
    // the reader's pick
    act(() => rows[0]?.click());
    expect(pick.querySelector("strong")?.textContent).toBe("~/Projects/vibe-field");
    expect(pick.querySelector("[data-os='mac']")).not.toBeNull();
    await until(() => shown.at(-1) === "mac:vf", "onShow(mac:vf)");
    await until(
      () => opened.at(-1) === "/Users/demo/Projects/vibe-field",
      "the engine on vibe-field",
    );
    // choosing a session follows it: s1 ran on Studio — the same spelling, another key, never opened here
    const openedBefore = opened.length;
    act(() => sessionRowOf(el, "s1")?.click());
    await until(() => shown.at(-1) === "studio:vf", "onShow(studio:vf)");
    expect(pick.querySelector("[data-os='studio']")).not.toBeNull();
    expect(head(el, 3)?.querySelector("header > .ah-caption")?.textContent).toBe("Studio · main");
    expect(head(el, 3)?.querySelector(".ah-elsewhere [data-elsewhere]")?.textContent).toBe(
      "Files stay on Studio",
    );
    act(() => pick.click());
    const checked = [
      ...(head(el, 3)?.querySelectorAll<HTMLButtonElement>(".ah-menu__item[aria-checked='true']") ??
        []),
    ];
    expect(checked.map((row) => row.dataset.key)).toEqual(["studio:vf"]);
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(opened.length).toBe(openedBefore);
    // and s0 ran here
    act(() => sessionRowOf(el, "s0")?.click());
    await until(() => shown.at(-1) === "mac:vf", "onShow(mac:vf) for s0");
    expect(head(el, 3)?.querySelector(".ah-elsewhere")).toBeNull();
  });

  it("a filter narrows the list by path", async () => {
    const { el } = await room({
      folders: () => ({
        groups: [
          {
            key: "g",
            folders: [
              { key: "a", path: "/x/alpha" },
              { key: "b", path: "/x/beta" },
              { key: "c", path: "/x/gamma" },
            ],
          },
        ],
        filterAfter: 2,
      }),
    });
    act(() => projectRow(el, "p0")?.click());
    const pick = await until(
      () => head(el, 3)?.querySelector<HTMLButtonElement>("button.ah-folderpick"),
      "③'s dropdown",
    );
    act(() => pick.click());
    const filter = await until(
      () => head(el, 3)?.querySelector<HTMLInputElement>(".ah-menu__filter"),
      "the filter",
    );
    expect(document.activeElement).toBe(filter);
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(filter, "bet");
      filter.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      [...(head(el, 3)?.querySelectorAll<HTMLButtonElement>(".ah-menu__item") ?? [])].map(
        (row) => row.dataset.key,
      ),
    ).toEqual(["b"]);
  });

  it("absent, ③'s head is the room's own and the guest opens the room's root", async () => {
    const { host: desk, opened } = desktop();
    const { el } = await room({}, desk);
    act(() => projectRow(el, "p0")?.click());
    await until(() => head(el, 3)?.querySelector("header .ah-colhead"), "③'s head");
    expect(el.querySelector(".ah-folderpick, .ah-elsewhere")).toBeNull();
    act(() =>
      head(el, 2)
        ?.querySelector<HTMLButtonElement>("button[aria-label='Toggle the project worktree']")
        ?.click(),
    );
    await until(
      () => opened.at(-1) === "/Users/demo/Projects/vibe-field",
      "the engine on the room's root",
    );
  });
});

describe("R7 — filter chips as buttons with popover rows", () => {
  /** A host that filters ① by a desktop chip, through the ledger's sections. */
  function ChipHost({ ports }: { readonly ports: ReturnType<typeof createDemoPorts> }) {
    const [desktop, setDesktop] = useState<"any" | "studio">("any");
    const chip: RoomFilter = {
      key: "desktop",
      label: desktop === "any" ? "any desktop" : "Studio",
      accessibleLabel: "Filter by desktop",
      set: desktop !== "any",
      menu: {
        label: "Desktops",
        groups: [
          {
            key: "all",
            items: [
              {
                key: "any",
                label: "Any desktop",
                checked: desktop === "any",
                onSelect: () => setDesktop("any"),
              },
              {
                key: "studio",
                label: "Studio",
                mark: <i data-os="studio" />,
                aside: "asleep",
                checked: desktop === "studio",
                onSelect: () => setDesktop("studio"),
              },
            ],
          },
        ],
      },
    };
    return (
      <HistoryRoom
        {...ports}
        storage={null}
        projectFilters={[chip]}
        projectSections={desktop === "any" ? undefined : [{ key: "studio", ids: ["p1"] }]}
      />
    );
  }

  it("① leads its bar with the host's chip; its rows choose, and the host filters through the sections", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const el = host;
    act(() => root?.render(<ChipHost ports={createDemoPorts(createRoomDemo())} />));
    await until(() => projectRow(el, "p0"), "the ledger");
    const bar = el.querySelector(".ah-cols > .ah-col:nth-child(1) .ah-listbar")!;
    expect([...bar.children].map((kid) => kid.className)).toEqual([
      "ah-chips",
      "ah-seg ah-sortseg",
    ]);
    const chip = bar.querySelector<HTMLButtonElement>(
      "button.ah-chipselect.ah-chip[data-filter='desktop']",
    )!;
    expect(chip.getAttribute("aria-label")).toBe("Filter by desktop");
    expect(chip.getAttribute("aria-haspopup")).toBe("menu");
    expect(chip.textContent).toBe("any desktop");
    expect(chip.hasAttribute("data-set")).toBe(false);
    act(() => chip.click());
    const studio = bar.querySelector<HTMLButtonElement>(".ah-menu__item[data-key='studio']")!;
    expect(studio.querySelector("[data-os='studio']")).not.toBeNull();
    expect(studio.querySelector(".ah-menu__aside")?.textContent).toBe("asleep");
    act(() => studio.click());
    expect(chip.textContent).toBe("Studio");
    expect(chip.hasAttribute("data-set")).toBe(true);
    await until(() => projectRow(el, "p0") === null, "p0 filtered out");
    expect(drawn(ledger(el))).toEqual(["p1"]);
  });

  it("② draws a bar of the host's chips for a project that has them", async () => {
    const chip = (key: string, label: string): RoomFilter => ({
      key,
      label,
      accessibleLabel: `Filter by ${key}`,
      menu: { label, groups: [{ key: "g", items: [{ key: "any", label, checked: true }] }] },
    });
    const { el } = await room({
      sessionFilters: (id) =>
        id === "p0" ? [chip("desktop", "any desktop"), chip("agent", "any agent")] : null,
    });
    act(() => projectRow(el, "p0")?.click());
    const bar = await until(() => head(el, 2)?.querySelector(".ah-listbar"), "②'s bar");
    expect([...bar.querySelectorAll(".ah-chip")].map((kid) => kid.textContent)).toEqual([
      "any desktop",
      "any agent",
    ]);
    expect(bar.nextElementSibling?.classList.contains("ah-veilhost")).toBe(true);
    act(() => projectRow(el, "p1")?.click());
    await until(() => head(el, 2)?.querySelector(".ah-listbar") === null, "no bar for p1");
  });

  it("absent, ①'s bar holds only the rank switch, ② draws no bar, and the room's sheet keeps its native selects", async () => {
    const { el } = await room({ search: { open: true, onOpenChange: () => undefined } });
    const bar = el.querySelector(".ah-cols > .ah-col:nth-child(1) .ah-listbar")!;
    expect([...bar.children].map((kid) => kid.className)).toEqual(["ah-seg ah-sortseg"]);
    act(() => projectRow(el, "p0")?.click());
    await until(() => sessionList(el)?.querySelector("[data-motion-key='s0']"), "②'s rows");
    expect(head(el, 2)?.querySelector(".ah-listbar")).toBeNull();
    const selects = await until(() => {
      const found = document.querySelectorAll("select.ah-chipselect");
      return found.length > 0 ? found : null;
    }, "the sheet's selects");
    expect(selects.length).toBeGreaterThan(0);
    expect(document.querySelector("button.ah-chip")).toBeNull();
  });
});
