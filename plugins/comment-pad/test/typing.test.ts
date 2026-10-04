// TYPING ON THE PAD, on a fake world and a fake document: the SESSION (a draft drawn at once, ONE transaction at
// its end, nothing when it nets to nothing, nothing on a read-only document, the runtime alone with no document,
// each glyph's hand carried through an edit) and the SHEET — the pad's TEXT PART the desk's one editor is lent
// to: a tap on a pad takes the editor with the caret where it fell, a tap on anything else is not the pad's, the
// field is the session's while it is open and the cell's between sessions, 1 s idle commits, Escape lets go, a
// pad deleted or cut from the frame ends the lease, and the editor stands over the writing box on screen.
import {
  Active,
  Camera,
  decodeSeeds,
  type EditorLease,
  type Entity,
  type ObjectDomHost,
} from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import { COMMENT_PAD_PART, createPadSheet, createPadTyping, PAD_HAND, writingBox } from "../src";

const INK = { name: "vibefield.comment-pad:ink" };
const PROPS = { name: "vibefield.comment-pad:props" };
const PAD = 7 as Entity;
const NOT_A_PAD = 9 as Entity;
const OK_REPORT = {
  docSchema: 3,
  localSchema: 3,
  newerInDoc: [],
  olderInDoc: [],
  renamedInDoc: {},
};

function fakeWorld() {
  const cells = new Map<string, unknown>();
  const tags = new Set<string>([`${PAD}:active`, `${NOT_A_PAD}:active`]);
  const alive = new Set<Entity>([PAD, NOT_A_PAD]);
  const key = (e: Entity, c: { name: string }) => `${e}:${c.name}`;
  cells.set(key(PAD, INK), { text: "first", seeds: "" });
  cells.set(key(PAD, PROPS), { pen: "ball", accent: "indigo", seed: 5 });
  const world = {
    get: (e: Entity, c: { name: string }) => cells.get(key(e, c)),
    isAlive: (e: Entity) => alive.has(e),
    hasTag: (e: Entity, t: unknown) => t === Active && tags.has(`${e}:active`),
    edit: (e: Entity) => ({
      set: (c: { name: string }, v: unknown) => {
        cells.set(key(e, c), v);
      },
    }),
    getResource: (r: unknown) => (r === Camera ? { x: -100, y: -50, zoom: 2 } : undefined),
  };
  return {
    world,
    cells,
    tags,
    alive,
    ink: () => cells.get(key(PAD, INK)) as { text: string; seeds: string },
  };
}

function fakeDocs(
  w: ReturnType<typeof fakeWorld>,
  opts: { readOnly?: boolean; none?: boolean } = {},
) {
  const commits: unknown[] = [];
  let readOnly = opts.readOnly ?? false;
  const session = {
    store: {
      transaction: (fn: (tx: unknown) => void) => {
        const tx = {
          edit: (e: Entity) => ({
            set: (c: { name: string }, v: unknown) => {
              commits.push(v);
              w.world.edit(e).set(c, v);
            },
          }),
        };
        fn(tx);
      },
    },
    liveWriter: {},
    get readOnly() {
      return readOnly;
    },
    versionReport: () => OK_REPORT,
  };
  const docs = { current: () => (opts.none === true ? undefined : session) };
  return { docs, commits, goReadOnly: () => (readOnly = true) };
}

function fakeWriting() {
  const drafts: (string | undefined)[] = [];
  const carets: (number | undefined)[] = [];
  return {
    drafts,
    carets,
    writing: {
      setDraft: (_e: Entity, d: { text: string } | undefined) => drafts.push(d?.text),
      setCaret: (_e: Entity | undefined, i?: number) => carets.push(i),
      caretIndexAt: () => 2,
    },
  };
}

describe("the pad's typing session", () => {
  const make = (opts: { readOnly?: boolean; none?: boolean } = {}) => {
    const w = fakeWorld();
    const d = fakeDocs(w, opts);
    const fw = fakeWriting();
    const typing = createPadTyping({
      world: w.world as never,
      docs: d.docs as never,
      ink: INK as never,
      props: PROPS as never,
      writing: () => fw.writing as never,
      fresh: () => 4242,
    });
    return { w, d, fw, typing };
  };

  it("draws a session's DRAFT at once and commits ONE transaction at its end — the cell unmoved until then", () => {
    const { w, d, fw, typing } = make();
    expect(typing.begin(PAD)).toBe(true);
    typing.input("first ");
    typing.input("first c");
    typing.input("first comment");
    expect(w.ink().text).toBe("first"); // the document has not moved
    expect(fw.drafts).toEqual(["first ", "first c", "first comment"]);
    expect(typing.text(PAD)).toBe("first comment");
    expect(typing.commit()).toBe(true);
    expect(d.commits).toHaveLength(1);
    expect(w.ink().text).toBe("first comment");
    expect(fw.drafts.at(-1)).toBeUndefined(); // the draft goes: the cell is drawn again
    expect(typing.open()).toBe(false);
  });

  it("carries each glyph's HAND through an edit: the prefix keeps its seeds, the inserted run gets fresh ones", () => {
    const { w, typing } = make();
    typing.begin(PAD);
    typing.input("first!");
    typing.commit();
    const seeds = decodeSeeds(w.ink().seeds);
    expect(seeds).toHaveLength(6);
    expect(seeds[5]).toBe(4242);
    typing.input("first!?");
    typing.commit();
    expect(decodeSeeds(w.ink().seeds).slice(0, 6)).toEqual(seeds);
  });

  it("a session that NETS TO NOTHING commits nothing", () => {
    const { d, typing } = make();
    typing.begin(PAD);
    typing.input("firstX");
    typing.input("first");
    expect(typing.commit()).toBe(false);
    expect(d.commits).toEqual([]);
  });

  it("a READ-ONLY document takes no session; one gone read-only mid-session lands nothing", () => {
    expect(make({ readOnly: true }).typing.begin(PAD)).toBe(false);
    const { w, d, typing } = make();
    typing.begin(PAD);
    typing.input("first edit");
    d.goReadOnly();
    expect(typing.commit()).toBe(false);
    expect(d.commits).toEqual([]);
    expect(w.ink().text).toBe("first");
  });

  it("with NO document at all the runtime is all there is: the commit writes the world", () => {
    const { w, typing } = make({ none: true });
    typing.begin(PAD);
    typing.input("first, offline");
    expect(typing.commit()).toBe(true);
    expect(w.ink().text).toBe("first, offline");
  });

  it("refuses a dead entity and one with no ink cell", () => {
    const { w, typing } = make();
    expect(typing.begin(NOT_A_PAD)).toBe(false);
    w.alive.delete(PAD);
    expect(typing.begin(PAD)).toBe(false);
  });
});

describe("the pad's sheet — its text part", () => {
  function sheetOn(opts: { readOnly?: boolean } = {}) {
    const w = fakeWorld();
    const d = fakeDocs(w, opts);
    const fw = fakeWriting();
    let lent: EditorLease | undefined;
    const element = { selectionStart: 0, value: "" };
    const editor = {
      element,
      lend: (lease: EditorLease) => {
        lent = lease;
      },
      release: (lease?: EditorLease) => {
        if (lent !== undefined && (lease === undefined || lease === lent)) {
          const l = lent;
          lent = undefined;
          l.ended();
        }
      },
      lease: () => lent,
      blur: () => {},
      follow: () => {},
      placement: () => null,
      dispose: () => {},
    };
    const G = {
      centre: [100, 80],
      half: [110, 140],
      size: { w: 220, h: 280 },
      scale: 1,
    };
    const host = {
      container: {},
      world: w.world,
      docs: d.docs,
      use: () => undefined,
      editor,
      object: {
        groups: [
          { name: "ink", component: INK },
          { name: "props", component: PROPS },
        ],
      },
      driver: { isPad: (e: Entity) => e === PAD, writing: () => fw.writing, follow: () => {} },
      look: () => undefined,
      geometryOf: (e: Entity) => (e === PAD ? G : undefined),
      hand: () => undefined,
      heldToWorld: () => undefined,
      wake: () => {},
    } as unknown as ObjectDomHost;
    const sheet = createPadSheet(host);
    if (sheet === undefined) throw new Error("no sheet");
    const tap = (hit: Entity | undefined, found = true) =>
      sheet.tap?.({ wx: 100, wy: 80, found, hit });
    return { w, d, fw, sheet, editor, element, tap, take: (l: EditorLease) => (lent = l) };
  }

  it("names its part, and a TAP on a pad takes the editor with the caret where the tap fell; anything else is not the pad's", () => {
    const s = sheetOn();
    expect(s.sheet.part).toBe(COMMENT_PAD_PART);
    expect(s.tap(NOT_A_PAD)).toBeUndefined();
    expect(s.tap(undefined)).toBeUndefined();
    expect(s.tap(PAD, false)).toBeUndefined(); // the pointer is gone: the sheet looks for nothing
    const taken = s.tap(PAD);
    expect(taken?.caret).toBe(2);
    expect(taken?.lease.part).toBe(COMMENT_PAD_PART);
  });

  it("the field is the CELL's between sessions and the session's while it is open; idle commits; Escape lets go", () => {
    const s = sheetOn();
    const lease = s.tap(PAD)?.lease;
    if (lease === undefined) throw new Error("no lease");
    s.take(lease);
    expect(lease.value()).toBe("first");
    s.element.selectionStart = 9;
    lease.input("first new");
    expect(lease.value()).toBeNull(); // a session is open: the field is the truth
    expect(s.fw.carets.at(-1)).toBe(9);
    lease.idle(); // 1 s without input: the session ends
    expect(s.d.commits).toEqual([expect.objectContaining({ text: "first new" })]);
    expect(lease.value()).toBe("first new");
    expect(lease.keydown({ key: "a" } as KeyboardEvent)).toBe(false);
    expect(lease.keydown({ key: "Escape" } as KeyboardEvent)).toBe(true);
    expect(s.sheet.editing()).toBeUndefined();
    expect(s.fw.carets.at(-1)).toBeUndefined(); // the caret goes with the lease
  });

  it("a lease ends when its pad is deleted or cut from the frame, and the session's text lands as it does", () => {
    const s = sheetOn();
    const lease = s.tap(PAD)?.lease;
    if (lease === undefined) throw new Error("no lease");
    expect(lease.live?.()).toBe(true);
    s.w.tags.delete(`${PAD}:active`); // a nav cut: the pad is no longer in the frame
    expect(lease.live?.()).toBe(false);
    lease.input("first, then cut");
    lease.ended();
    expect(s.w.ink().text).toBe("first, then cut");
  });

  it("stands the editor over the WRITING BOX on screen, from the camera, in the pad's hand", () => {
    const s = sheetOn();
    const lease = s.tap(PAD)?.lease;
    const box = writingBox(220, 280);
    // the camera at (−100, −50), zoom 2; the pad's centre (100, 80), its top-left (−10, −60)
    expect(lease?.place()).toMatchObject({
      x: (-10 + box.x + 100) * 2,
      y: (-60 + box.y + 50) * 2,
      w: box.w * 2,
      h: box.h * 2,
      fontPx: PAD_HAND.size * 2,
      wrap: true,
    });
  });

  it("a read-only document's pad is read, never written: a tap takes nothing", () => {
    expect(sheetOn({ readOnly: true }).tap(PAD)).toBeUndefined();
  });
});
