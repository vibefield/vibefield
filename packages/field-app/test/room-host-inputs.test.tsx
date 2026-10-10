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
import { HistoryRoom, type HistoryRoomHandle, type HistoryRoomProps } from "@rosetta/room";
import { createDemoPorts, createRoomDemo } from "@rosetta/room/fixtures";
import { act, createRef } from "react";
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
async function room(inputs: Inputs = {}) {
  const demo = createRoomDemo();
  const ports = createDemoPorts(demo);
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
