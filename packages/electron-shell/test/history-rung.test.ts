/**
 * Item 263 — smoke:godview's History rung (AR-8c; testing/history-rung.ts) over a page. Before its past the room's
 * consent slot holds only HG-2's marker, and the card that says the room's state stands in the view's own layer over
 * the frosted sample (HG-D1), so the rung reads the card's words while the room waits — never a blank.
 *
 * Why the room's selector narrows to the view's own (`.vf-history > .vf-history-room .ah-frame`): the sample behind
 * the glass is a SECOND rosetta room, inert, with its own `.ah-frame` under a `.vf-history-room` of its own, so
 * `.vf-history .ah-frame` matches it too, and a read that took it would pass on the demo's columns, never the person's.
 */
import { describe, expect, it } from "vitest";
import { HISTORY_FACE, type HistoryFace, historyFaceShows } from "../src/testing/history-rung";

/** A page box: its classes, its attributes, its children and its own words. */
class Box {
  readonly kids: Box[] = [];
  parent: Box | null = null;
  constructor(
    readonly classes: readonly string[],
    readonly attrs: Readonly<Record<string, string>> = {},
    readonly words = "",
  ) {}
  add(...kids: Box[]): this {
    for (const kid of kids) {
      kid.parent = this;
      this.kids.push(kid);
    }
    return this;
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  get textContent(): string {
    return [this.words, ...this.kids.map((kid) => kid.textContent)].join(" ");
  }
  querySelector(selector: string): Box | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  /** As the DOM's: every box inside this one that the whole selector matches, its ancestors read to the root. */
  querySelectorAll(selector: string): Box[] {
    return inOrder(this)
      .slice(1)
      .filter((box) => matches(box, parse(selector)));
  }
}

/** A box and everything in it, in tree order. */
const inOrder = (at: Box): Box[] => [at, ...at.kids.flatMap(inOrder)];

/** One compound of a selector: its classes and attributes, and how it joins the compound before it. */
interface Compound {
  classes: string[];
  attrs: Array<[string, string]>;
  child: boolean;
}

/** The selectors the rung writes: descendant and child combinators over `.class` and `[name="value"]` compounds. */
function parse(selector: string): Compound[] {
  const out: Compound[] = [];
  let child = false;
  for (const token of selector.trim().split(/\s+/u)) {
    if (token === ">") {
      child = true;
      continue;
    }
    const classes = [...token.matchAll(/\.([\w-]+)/gu)].map((m) => m[1] ?? "");
    const attrs = [...token.matchAll(/\[([\w-]+)="([^"]*)"\]/gu)].map(
      (m) => [m[1] ?? "", m[2] ?? ""] as [string, string],
    );
    if (classes.length + attrs.length === 0) throw new Error(`the fake page reads no ${token}`);
    out.push({ classes, attrs, child });
    child = false;
  }
  return out;
}

const fits = (box: Box, c: Compound): boolean =>
  c.classes.every((name) => box.classes.includes(name)) &&
  c.attrs.every(([name, value]) => box.attrs[name] === value);

/** Whether `box` matches the compounds, right to left, through its ancestors. */
function matches(box: Box, compounds: readonly Compound[]): boolean {
  const last = compounds.at(-1);
  if (last === undefined || !fits(box, last)) return false;
  const rest = compounds.slice(0, -1);
  if (rest.length === 0) return true;
  for (let up = box.parent; up !== null; up = up.parent) {
    if (matches(up, rest)) return true;
    if (last.child) return false;
  }
  return false;
}

/** The rung's read over a page whose root is `page`. */
const read = (page: Box): string =>
  new Function("document", `return ${HISTORY_FACE};`)({
    querySelector: (selector: string) =>
      inOrder(page).find((box) => matches(box, parse(selector))) ?? null,
  }) as string;
const face = (page: Box): HistoryFace => JSON.parse(read(page)) as HistoryFace;

/** A room's frame, as rosetta's room draws it. */
const frame = (...kids: Box[]): Box =>
  new Box(["ah-frame"], { "data-ah-surface": "host" }).add(...kids);
/** The cover's History view around `inside`. */
const cover = (...inside: Box[]): Box =>
  new Box(["vf-cover"], { "data-cover-view": "history" }).add(
    new Box(["vf-history"]).add(...inside),
  );
/** A room with columns and a project, as one whose index has answered. */
const answered = (): Box =>
  frame(new Box(["ah-cols"]).add(new Box(["ah-project-list-item"], {}, "vibe-field")));
/** The view's room while it waits: its slot holds HG-2's marker alone. */
const waiting = (): Box =>
  new Box(["vf-history-room"]).add(frame(new Box(["vf-history-consent-marker"])));
/** The view's own layer: the sample (a second room, answered) and the card. */
const glass = (card: string): Box =>
  new Box(["vf-history-glass"]).add(
    new Box(["vf-history-sample"], { inert: "", "aria-hidden": "true" }).add(
      new Box(["vf-history-room"]).add(answered()),
    ),
    new Box(["vf-history-glass-card"], {}, card),
  );
const CARD = "Bring in your history Your agents keep their past on this Mac. Bring in history";

describe("smoke:godview's History rung (AR-8c) reads the view's own room", () => {
  it("passes a room whose index answered, by its columns", () => {
    const page = cover(new Box(["vf-history-room"]).add(answered()));
    expect(face(page)).toMatchObject({ surface: "host", columns: true, projects: 1 });
    expect(historyFaceShows(read(page))).toBe(true);
  });

  it("passes the room before its past by the card's words, never the sample's columns (item 263)", () => {
    const page = cover(waiting(), glass(CARD));
    const seen = face(page) as HistoryFace & { card?: string | null };
    expect(seen.columns).toBe(false);
    expect(seen.projects).toBe(0);
    expect(seen.card).toBe(CARD);
    expect(historyFaceShows(read(page))).toBe(true);
  });

  it("reads the view's room even where the glass stands first in the page", () => {
    const page = cover(glass(CARD), waiting());
    const seen = face(page) as HistoryFace & { card?: string | null };
    expect(seen.columns).toBe(false);
    expect(seen.card).toBe(CARD);
  });

  it("never passes a blank: a room with no words, or a waiting room whose card says nothing", () => {
    expect(historyFaceShows(read(cover(new Box(["vf-history-room"]).add(frame()))))).toBe(false);
    expect(historyFaceShows(read(cover(waiting(), glass(""))))).toBe(false);
  });

  it("says no room before one stands, and passes no surface but the host's", () => {
    expect(read(cover())).toBe("no room");
    expect(historyFaceShows("no room")).toBe(false);
    const peek = cover(
      new Box(["vf-history-room"]).add(
        new Box(["ah-frame"], { "data-ah-surface": "reader" }, "words"),
      ),
    );
    expect(historyFaceShows(read(peek))).toBe(false);
  });
});
