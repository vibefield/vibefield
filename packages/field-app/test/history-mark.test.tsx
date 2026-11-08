// @vitest-environment happy-dom

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIVING_MARK_REST_URL,
  LIVING_MARK_SIZE,
  LIVING_MARK_URL,
} from "@vibefield/design-kit/living-mark";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// History's mark (track HG, HG-W1, HG-W4 and HG-L1; DESIGN.md §8 "History" and "The living mark, drawn as SVG"; §6).
// The living mark stands in History in three places, on the theme's ground, and moves only while its work does. The
// room's waits wear it through rosetta-room's `waitMark` host input (R10, rosetta-room 0.1.6). The builder is held
// here against a stand-in of the room's port (the room's own hold markup drawn round the node it hands back).
// History's first open is the hold too, in the same box on the same rows as the room's, and the last test reads the
// room's own hold.css from the package this tree resolves to hold the two to the same numbers.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEW_CSS = readFileSync(join(HERE, "../src/history/history-room-view.css"), "utf8");
/** The module under test, loaded in each test so a missing piece fails only its own (a named specifier, so the
 * transform leaves the import to run time). */
const MARK_MODULE = "../src/history/history-mark";
const load = (): Promise<typeof import("../src/history/history-mark")> =>
  import(/* @vite-ignore */ MARK_MODULE);

/** A rule's body in a stylesheet: from its selector, at a line's start, to its first close. */
function ruleIn(css: string, selector: string): string {
  const from = css.indexOf(`\n${selector} {`);
  return from < 0 ? "" : css.slice(from, css.indexOf("}", from));
}

/** A rule's declarations, one or several to a line, as property → value. */
function declarations(css: string, selector: string): Map<string, string> {
  const body = ruleIn(css, selector);
  return new Map(
    body
      .slice(body.indexOf("{") + 1)
      .split(";")
      .map((part) => part.trim().match(/^([\w-]+):\s*(.+)$/su))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1] ?? "", (m[2] ?? "").replace(/\s+/gu, " ")]),
  );
}

/** rosetta-room as this tree resolves it: ONE source at a time, named in the test's title — the room's checkout under
 * the dev overlay (`pnpm siblings use rosetta`), the published package in the committed shape. */
const ROOM_PACKAGE = realpathSync(join(HERE, "../node_modules/@vibefield/rosetta-room"));
const ROOM_HOLD_CSS = join(ROOM_PACKAGE, "dist/styles/hold.css");
const ROOM_SOURCE = relative(join(HERE, "../../.."), ROOM_HOLD_CSS);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(node: ReactNode): Promise<HTMLDivElement> {
  if (container === null) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => root?.render(node));
  return container;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

/** The marks drawn, as [ground, src, width, height]. */
const marks = (host: ParentNode): string[][] =>
  [...host.querySelectorAll<HTMLImageElement>(".vf-history-mark img")].map((img) => [
    img.className,
    img.getAttribute("src") ?? "",
    img.getAttribute("width") ?? "",
    img.getAttribute("height") ?? "",
  ]);

describe("History's mark", () => {
  it("stands on the theme's ground: both grounds drawn, the theme's sheet showing one (HG-W4)", async () => {
    const { HistoryMark } = await load();
    const host = await render(createElement(HistoryMark, { width: 99 }));
    expect(marks(host)).toEqual([
      ["vf-history-mark-dark", LIVING_MARK_URL.dark, "99", "44"],
      ["vf-history-mark-light", LIVING_MARK_URL.light, "99", "44"],
    ]);
    // white ink by night, black by day (the app icon's two grounds, §12), the theme's own class choosing
    expect(ruleIn(VIEW_CSS, ".vf-history-mark-dark")).toMatch(/display: none;/u);
    expect(ruleIn(VIEW_CSS, ".dark .vf-history-mark-dark")).toMatch(/display: block;/u);
    expect(ruleIn(VIEW_CSS, ".dark .vf-history-mark-light")).toMatch(/display: none;/u);
    // decoration: the words beside it say what loads
    for (const img of host.querySelectorAll("img")) {
      expect([img.getAttribute("alt"), img.getAttribute("aria-hidden")]).toEqual(["", "true"]);
    }
  });

  it("stands at rest while its work does: the stills the generator writes (HG-L1)", async () => {
    const { HistoryMark } = await load();
    const host = await render(createElement(HistoryMark, { width: 40, resting: true }));
    expect(marks(host)).toEqual([
      ["vf-history-mark-dark", LIVING_MARK_REST_URL.dark, "40", `${(40 * 44) / 99}`],
      ["vf-history-mark-light", LIVING_MARK_REST_URL.light, "40", `${(40 * 44) / 99}`],
    ]);
    expect(host.querySelector(".vf-history-mark")?.hasAttribute("data-resting")).toBe(true);
  });

  it("is what the room's waits wear: 99 in a hold, 40 on the import card, carried as asked (HG-W4, R10)", async () => {
    const { HISTORY_MARK_WIDTH, historyWaitMark } = await load();
    expect(HISTORY_MARK_WIDTH).toEqual({ view: LIVING_MARK_SIZE.width, column: 99, card: 40 });
    expect(historyWaitMark(true).carried).toBe(true);
    expect(historyWaitMark(false).carried).toBe(false);
    // a stand-in of rosetta-room 0.1.6's port: its view hold and its card's head, around what the mark hands back
    const port = historyWaitMark(false);
    const host = await render(
      createElement(
        "div",
        null,
        createElement("div", { className: "ah-hold__mark" }, port.mark("view", { resting: false })),
        createElement(
          "span",
          { className: "ah-ingest-status__mark" },
          port.mark("card", { resting: true }),
        ),
      ),
    );
    const hold = host.querySelector(".ah-hold__mark");
    const card = host.querySelector(".ah-ingest-status__mark");
    expect(hold === null ? [] : marks(hold)).toEqual([
      ["vf-history-mark-dark", LIVING_MARK_URL.dark, "99", "44"],
      ["vf-history-mark-light", LIVING_MARK_URL.light, "99", "44"],
    ]);
    expect(
      card === null ? [] : marks(card).map(([ground, src, width]) => [ground, src, width]),
    ).toEqual([
      ["vf-history-mark-dark", LIVING_MARK_REST_URL.dark, "40"],
      ["vf-history-mark-light", LIVING_MARK_REST_URL.light, "40"],
    ]);
  });

  it("carries History's opening into the room's first hold only once the opening has begun to show", async () => {
    const { HISTORY_HOLD_LATE_MS, carriesOpening } = await load();
    expect(HISTORY_HOLD_LATE_MS).toBe(120);
    expect(carriesOpening(null, 5_000)).toBe(false);
    expect(carriesOpening(5_000, 5_000 + HISTORY_HOLD_LATE_MS - 1)).toBe(false);
    expect(carriesOpening(5_000, 5_000 + HISTORY_HOLD_LATE_MS)).toBe(true);
    // the late its sheet plays is the same 120ms
    expect(ruleIn(VIEW_CSS, ".vf-history-hold-words")).toMatch(
      new RegExp(`animation: vf-history-late 180ms ease ${HISTORY_HOLD_LATE_MS}ms both;`, "u"),
    );
  });
});

describe("History's first open is the hold (HG-W1)", () => {
  it("stands the mark at the centre of History's box, Opening History… 26 under it, over its sub's 17", async () => {
    const { HistoryOpeningState } = await import("../src/history/HistoryOpening");
    const host = await render(createElement(HistoryOpeningState));
    const hold = host.querySelector<HTMLElement>(
      '.vf-history[data-face="opening"] .vf-history-room > .vf-history-face.vf-history-hold',
    );
    expect(hold?.getAttribute("role")).toBe("status");
    expect(hold === null ? [] : marks(hold).map(([ground, , width]) => [ground, width])).toEqual([
      ["vf-history-mark-dark", "99"],
      ["vf-history-mark-light", "99"],
    ]);
    expect(hold?.querySelector(".vf-history-hold-mark .vf-history-mark")).not.toBeNull();
    expect(hold?.querySelector(".vf-history-hold-words .vf-history-hold-line")?.textContent).toBe(
      "Opening History…",
    );
    expect(hold?.querySelector(".vf-history-hold-sub")?.textContent).toBe("");
    // the kit's empty state and the history glyph leave it
    expect(hold?.querySelector(".vf-ui-empty-state, .vf-glyph")).toBeNull();
    // rows `1fr | the mark | 1fr`, the words 26 under the mark: the room's own hold's rows, so nothing moves
    expect(ruleIn(VIEW_CSS, ".vf-history-hold")).toMatch(
      /grid-template-rows: minmax\(0, 1fr\) auto minmax\(0, 1fr\);/u,
    );
    expect(ruleIn(VIEW_CSS, ".vf-history-hold-mark")).toMatch(/min-height: 44px;/u);
    expect(ruleIn(VIEW_CSS, ".vf-history-hold-words")).toMatch(/padding-top: 26px;/u);
    expect(ruleIn(VIEW_CSS, ".vf-history-hold-line")).toMatch(/font-size: 14px;/u);
    expect(ruleIn(VIEW_CSS, ".vf-history-hold-line")).toMatch(
      /color: var\(--vf-text-secondary\);/u,
    );
    expect(ruleIn(VIEW_CSS, ".vf-history-hold-sub")).toMatch(/min-height: 17px;/u);
    expect(ruleIn(VIEW_CSS, ".vf-history-hold-sub")).toMatch(/color: var\(--vf-text-tertiary\);/u);
    // late as before (§6): nothing for 120ms, then the words over 180ms and the mark over 400ms with them
    expect(ruleIn(VIEW_CSS, ".vf-history-hold-mark")).toMatch(
      /animation: vf-history-late 400ms ease 120ms both;/u,
    );
  });

  it("says when it began to show, once, so the room's first hold can carry it", async () => {
    const { HistoryOpeningState } = await import("../src/history/HistoryOpening");
    const onShow = vi.fn();
    const before = performance.now();
    await render(createElement(HistoryOpeningState, { onShow }));
    await render(createElement(HistoryOpeningState, { onShow }));
    expect(onShow).toHaveBeenCalledTimes(1);
    const [at] = onShow.mock.calls[0] ?? [];
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(performance.now());
  });

  it(`stands on the room's own hold's rows and numbers, so the mark keeps its place at the handover (${ROOM_SOURCE})`, () => {
    const room = readFileSync(ROOM_HOLD_CSS, "utf8");
    const pairs: ReadonlyArray<readonly [string, string, readonly string[]]> = [
      [
        ".vf-history-hold",
        ".ah-hold",
        ["display", "grid-template-rows", "justify-items", "padding"],
      ],
      [".vf-history-hold-mark", ".ah-hold__mark", ["min-height", "align-items", "justify-content"]],
      [
        ".vf-history-hold-words",
        ".ah-hold__words",
        ["padding-top", "flex-direction", "align-items"],
      ],
      [
        ".vf-history-hold-line",
        ".ah-hold__line",
        ["margin", "color", "font-size", "font-weight", "line-height", "font-variant-numeric"],
      ],
      [
        ".vf-history-hold-sub",
        ".ah-hold__sub",
        ["margin", "min-height", "color", "font-size", "line-height", "font-variant-numeric"],
      ],
    ];
    for (const [ours, theirs, properties] of pairs) {
      const [ourRule, roomRule] = [declarations(VIEW_CSS, ours), declarations(room, theirs)];
      for (const property of properties) {
        expect([ours, property, ourRule.get(property)]).toEqual([
          ours,
          property,
          roomRule.get(property),
        ]);
        expect(ourRule.get(property), `${ours} ${property}`).toBeDefined();
      }
    }
    // the late and the fades in (§6): the same durations, easings and delays, whatever the keyframes are called
    const timing = (decls: Map<string, string>): string | undefined =>
      decls.get("animation")?.replace(/^[\w-]+ /u, "");
    expect(timing(declarations(VIEW_CSS, ".vf-history-hold-mark"))).toBe(
      timing(declarations(room, ".ah-hold__mark")),
    );
    expect(timing(declarations(VIEW_CSS, ".vf-history-hold-words"))).toBe(
      timing(declarations(room, ".ah-hold__words")),
    );
  });
});
