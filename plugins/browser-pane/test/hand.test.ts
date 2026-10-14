// PT-3 — THE PANE'S HAND ON THE EDITOR (src/hand.ts): its driver on a FAKE desk — a hand that holds a pane or not, the desk's one
// editor (lent, released, its textarea's value and keyup), a container a press lands on, the document a write commits into —
// and a FAKE desk state that records what the hand asks of it. While a pane is in hand the PAGE's lease holds the keys: a key goes
// to the page raw (a printable one types, its text the page's), the IME's composition and its commit too; Esc is the desk's; the
// browser's chords are the lease's (⌘L ⌘R ⌘[ ⌘]). The ADDRESS lease edits the page's address over the head's capsule: ⏎ goes
// there, Esc back to the page. A press over the held pane keeps the editor's focus. A page's own navigation writes its url NOT
// undoably, once per address. The held bar's acts reach the hand on their world.
import type {
  BrowserNavigationCommand,
  EditorLease,
  EditorPlace,
  Entity,
  HeldToolApi,
  KindDriverHost,
  LiveInput,
  ObjectDomHost,
  World,
} from "@vibefield/plugin-sdk/desk";
import { describe, expect, it, vi } from "vitest";
import {
  bandLayout,
  chordOf,
  createPaneHand,
  type HeldPart,
  handOf,
  openExtent,
  PANE_SIZE,
  PANE_TOOLS,
  resolvePane,
  shapeOf,
} from "../src";
import { HELD_QUIET_MS } from "../src/hand";
import { LAMP } from "../src/law";

const PAGE = "http://127.0.0.1:4321/page";
const NEXT = "http://127.0.0.1:4321/next";
const S = shapeOf(PANE_SIZE);
const RECT = { cx: 300, cy: 200, w: PANE_SIZE.w, h: PANE_SIZE.h };
const G = resolvePane(RECT, { lift: 0, hover: 0, fade: 1 }, S, LAMP, undefined, 0, true);
const EXT = openExtent(RECT, S);
/** The held pane on screen: its extent's centre at (600, 400), 0.4 CSS px a desk unit. */
const FRAME = { cx: 600, cy: 400, s: 0.4 };

/** A desk state that records what the hand asks of it — the page's words its test sets. */
function fakeLocal() {
  const calls = {
    sent: [] as { e: Entity; input: LiveInput }[],
    acts: [] as { e: Entity; control: HeldPart }[],
    navigations: [] as { e: Entity; command: BrowserNavigationCommand }[],
  };
  let addressed = new Map<Entity, string>();
  let bound: { address(e: Entity): void } | undefined;
  /** PT-6a (M7 C1): when pane 1's page last stirred it (the faces' stamp), and the clock a send stamps by */
  let stirredAt: number | undefined;
  let clock: () => number = () => 0;
  const info = { address: PAGE, loading: undefined as number | undefined };
  const local = {
    send: (e: Entity, input: LiveInput) => {
      calls.sent.push({ e, input });
      stirredAt = clock();
      return true;
    },
    stirred: (e: Entity) => (e === 1 ? stirredAt : undefined),
    act: (e: Entity, control: HeldPart) => calls.acts.push({ e, control }),
    navigate: (e: Entity, command: BrowserNavigationCommand) => {
      calls.navigations.push({ e, command });
      return true;
    },
    layout: (e: Entity) => (e === 1 ? { G, ext: EXT, zoom: FRAME.s } : undefined),
    page: (e: Entity) =>
      e === 1 ? { key: "k-1", state: { is: "live" as const }, info } : undefined,
    addressed: () => addressed,
    bind: (hand: { address(e: Entity): void } | undefined) => {
      bound = hand;
    },
  };
  return {
    local,
    calls,
    info,
    setAddressed: (m: Map<Entity, string>) => {
      addressed = m;
    },
    bound: () => bound,
    /** a frame of pane 1's page arrived (or the local sent it the hand's input) at `at` */
    stir: (at: number) => {
      stirredAt = at;
    },
    clockBy: (now: () => number) => {
      clock = now;
    },
  };
}

/** The desk's one editor: what is lent, its textarea (value, keyup, select), its release. */
function fakeEditor() {
  const listeners = new Map<string, (ev: KeyboardEvent) => void>();
  let held: EditorLease | undefined;
  const lends: { lease: EditorLease; caret: number | undefined }[] = [];
  const element = {
    value: "",
    selected: 0,
    addEventListener: (type: string, fn: (ev: KeyboardEvent) => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    select() {
      element.selected += 1;
    },
  };
  const editor = {
    element,
    // as ICE's (desk/src/host/editor.ts): a lease that holds it is only focused again; another ENDS first, then the new one's
    // value is asked as it begins (null: keep the field's own)
    lend(lease: EditorLease, caret?: number) {
      lends.push({ lease, caret });
      if (held === lease) return;
      held?.ended();
      held = lease;
      const v = lease.value();
      element.value = v ?? element.value;
    },
    release(lease?: EditorLease) {
      if (lease === undefined || lease === held) {
        held?.ended();
        held = undefined;
      }
    },
    lease: () => held,
  };
  return {
    editor,
    element,
    lends,
    keyup: (ev: Partial<KeyboardEvent>) => listeners.get("keyup")?.(ev as KeyboardEvent),
  };
}

function setup(opts: { inHand?: boolean; readOnly?: boolean; now?: () => number } = {}) {
  const L = fakeLocal();
  if (opts.now !== undefined) L.clockBy(opts.now);
  const E = fakeEditor();
  const writes: { e: Entity; value: unknown; opts: unknown }[] = [];
  const props: Record<string, unknown> = { url: PAGE, device: "laptop" };
  const cell = { name: "props" } as never;
  let inHand = opts.inHand ?? true;
  const world = {
    get: (_e: Entity, c: unknown) => (c === cell ? props : undefined),
  } as unknown as World;
  const docs = {
    current: () => ({
      store: {
        transaction(fn: (tx: unknown) => void, o: unknown) {
          fn({
            edit: (e: Entity) => ({
              set: (_c: unknown, value: unknown) => {
                writes.push({ e, value, opts: o });
              },
            }),
          });
        },
      },
      liveWriter: {},
      readOnly: opts.readOnly === true,
      versionReport: () => ({
        docSchema: 1,
        localSchema: 1,
        newerInDoc: [],
        olderInDoc: [],
        renamedInDoc: {},
      }),
    }),
  };
  const h = {
    world,
    docs,
    local: L.local,
    look: () => undefined,
    isKind: (e: Entity) => e === 1,
    kind: () => undefined,
    provides: () => undefined,
    geometryOf: () => G,
    heldToWorld: () => undefined,
    hand: () => (inHand ? { entity: 1 as Entity, landing: false, frame: FRAME } : undefined),
    refused: () => {},
    wake: () => {},
  } as unknown as KindDriverHost;
  const hand = createPaneHand(h, {
    cell: () => cell,
    ...(opts.now === undefined ? {} : { now: opts.now }),
  });
  const downs: ((ev: PointerEvent) => void)[] = [];
  const dom = {
    container: {
      addEventListener: (_t: string, fn: (ev: PointerEvent) => void) => downs.push(fn),
      removeEventListener: () => downs.splice(0),
      getBoundingClientRect: () => ({ left: 10, top: 20 }),
    },
    editor: E.editor,
    driver: hand,
  } as unknown as ObjectDomHost;
  hand.join(dom);
  const lease = (): EditorLease => {
    const l = E.editor.lease();
    if (l === undefined) throw new Error("nothing lent");
    return l;
  };
  return {
    ...L,
    ...E,
    hand,
    world,
    writes,
    props,
    lease,
    press: (x: number, y: number) => {
      const ev = { clientX: x, clientY: y, preventDefault: vi.fn() };
      for (const fn of downs) fn(ev as unknown as PointerEvent);
      return ev.preventDefault;
    },
    letGo: () => {
      inHand = false;
    },
  };
}

/** A key as the editor's textarea sees it. */
const key = (k: string, more: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({
    key: k,
    code: k.length === 1 ? `Key${k.toUpperCase()}` : k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    ...more,
  }) as KeyboardEvent;

describe("the pane's hand on the editor (PT-3 rulings 6–9)", () => {
  it("lends the PAGE's lease in the frame a pane is first held, again after a blur, and lets it go when the pane leaves the hand", () => {
    const t = setup();
    t.hand.follow(0);
    expect(t.lends).toHaveLength(1);
    expect(t.lease().part).toBe("vibefield.browser-pane.page");
    expect(t.lease().live?.()).toBe(true);
    // held still: no second lend
    t.hand.follow(1);
    expect(t.lends).toHaveLength(1);
    // a blur ended it: lent again
    t.editor.release();
    t.hand.follow(2);
    expect(t.lends).toHaveLength(2);
    // the pane put down: the lease is no longer live, and the hand is idle
    const lease = t.lease();
    t.letGo();
    expect(lease.live?.()).toBe(false);
    t.editor.release();
    expect(t.hand.idle?.()).toBe(true);
    expect(t.hand.stats()).toMatchObject({ pageLeases: 2, addressLeases: 0 });
  });

  it("PT-6a (M7, C1) — a HELD pane lets the desk SLEEP once its lease is the hand's and its page has not stirred it for 250 ms; a frame's arrival, a key, a wheel and the lease's end each wake it (before: never idle while held — a still page held stepped the desk every frame)", () => {
    let t0 = 1_000;
    const t = setup({ now: () => t0 });
    // held: the first frame lends the page's lease — then, nothing stirring, the hand is idle
    expect(t.hand.idle?.()).toBe(false);
    t.hand.follow(0);
    expect(t.lends).toHaveLength(1);
    expect(t.hand.idle?.()).toBe(true);
    // a frame of its page arrives: awake for 250 ms from it
    t.stir(t0);
    expect(t.hand.idle?.()).toBe(false);
    t0 += HELD_QUIET_MS - 1;
    expect(t.hand.idle?.()).toBe(false);
    t0 += 1;
    expect(t.hand.idle?.()).toBe(true);
    // a key through the lease: sent to the page — awake again
    t.lease().keydown(key("a"));
    expect(t.calls.sent.at(-1)?.input).toMatchObject({ kind: "key", phase: "down" });
    expect(t.hand.idle?.()).toBe(false);
    t0 += HELD_QUIET_MS;
    expect(t.hand.idle?.()).toBe(true);
    // a wheel over the page (the local sends the hand's own input): awake
    t.stir(t0);
    expect(t.hand.idle?.()).toBe(false);
    t0 += HELD_QUIET_MS;
    expect(t.hand.idle?.()).toBe(true);
    // the lease's end (a blur): not idle until it is lent again, whatever the quiet
    t.editor.release();
    expect(t.hand.idle?.()).toBe(false);
    t.hand.follow(1);
    expect(t.lends).toHaveLength(2);
    expect(t.hand.idle?.()).toBe(true);
    // an address its record has not read: never idle (as before)
    t.setAddressed(new Map([[1 as Entity, NEXT]]));
    expect(t.hand.idle?.()).toBe(false);
  });

  it("keys go to the page RAW — a printable one types, its text the page's — the IME's composition and its commit; Esc is the desk's", () => {
    const t = setup();
    t.hand.follow(0);
    const lease = t.lease();
    // a printable key: sent down, then the FIELD types it (false — the editor does not prevent it), its text the page's
    expect(lease.keydown(key("a"))).toBe(false);
    lease.input("a");
    lease.input("ab");
    // a key the field does not type (an arrow, ⌘C): sent, and taken
    expect(lease.keydown(key("ArrowLeft"))).toBe(true);
    expect(lease.keydown(key("c", { metaKey: true }))).toBe(true);
    t.keyup({
      key: "a",
      code: "KeyA",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    });
    // the IME: its composition as it runs, then its commit as text
    lease.compose?.("", 0);
    lease.compose?.("にほ", 2);
    lease.commit?.("日本");
    // Esc: declined — the keymap puts the pane down in one press; nothing sent
    const before = t.calls.sent.length;
    expect(lease.keydown(key("Escape"))).toBe(false);
    expect(t.calls.sent).toHaveLength(before);
    expect(t.calls.sent.map((c) => c.input)).toEqual([
      { kind: "key", key: "a", code: "KeyA", phase: "down", mods: 0, repeat: false },
      { kind: "text", text: "a" },
      { kind: "text", text: "b" },
      { kind: "key", key: "ArrowLeft", code: "ArrowLeft", phase: "down", mods: 0, repeat: false },
      { kind: "key", key: "c", code: "KeyC", phase: "down", mods: 4, repeat: false },
      { kind: "key", key: "a", code: "KeyA", phase: "up", mods: 8, repeat: false },
      { kind: "compose", text: "", caret: 0 },
      { kind: "compose", text: "にほ", caret: 2 },
      { kind: "text", text: "日本" },
    ]);
    // the page lease empties the field each frame: what it typed went to the page
    expect(lease.value()).toBe("");
  });

  it("the browser's CHORDS are the lease's (ruling 7): ⌘L the address, ⌘R reload, ⌘[ back, ⌘] forward — taken, never sent", () => {
    const t = setup();
    t.hand.follow(0);
    const lease = t.lease();
    expect(lease.keydown(key("r", { metaKey: true }))).toBe(true);
    expect(lease.keydown(key("[", { metaKey: true, code: "BracketLeft" }))).toBe(true);
    expect(lease.keydown(key("]", { ctrlKey: true, code: "BracketRight" }))).toBe(true);
    expect(t.calls.acts).toEqual([
      { e: 1, control: "reload" },
      { e: 1, control: "back" },
      { e: 1, control: "forward" },
    ]);
    // ⌘L takes up the address: the editor lent again, in the address's mode
    expect(lease.keydown(key("l", { metaKey: true }))).toBe(true);
    expect(t.lends).toHaveLength(2);
    expect(t.hand.stats()).toMatchObject({ chords: 4, addressLeases: 1 });
    // none of them reached the page; their release neither
    t.keyup({
      key: "r",
      code: "KeyR",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    });
    expect(t.calls.sent).toEqual([]);
    // the chords as the lease reads them: ⌘ or ctrl, never with ⌥
    expect(chordOf({ key: "L", metaKey: true, ctrlKey: false, altKey: false })).toBe("address");
    expect(chordOf({ key: "r", metaKey: true, ctrlKey: false, altKey: true })).toBeUndefined();
    expect(chordOf({ key: "r", metaKey: false, ctrlKey: false, altKey: false })).toBeUndefined();
    expect(chordOf({ key: "k", metaKey: true, ctrlKey: false, altKey: false })).toBeUndefined();
  });

  it("the ADDRESS: the editor over the head's capsule holding the page's address; ⏎ goes there through the page, Esc back to the page", () => {
    const t = setup();
    t.hand.follow(0);
    t.hand.address(1 as Entity);
    const lease = t.lease();
    // the field starts from the page's address, selected, and then keeps what is typed
    expect(t.element.value).toBe(PAGE);
    expect(t.element.selected).toBe(1);
    expect(t.lends.at(-1)?.caret).toBe(PAGE.length);
    expect(lease.value()).toBeNull();
    // placed over the capsule: its rect in the pane's frame, drawn at the hand's frame
    const [ax, ay, ahx, ahy] = bandLayout(S).address;
    const extentV = EXT.cy - RECT.cy;
    const place = lease.place() as EditorPlace;
    expect(place.x).toBeCloseTo(FRAME.cx + (ax - ahx) * FRAME.s, 9);
    expect(place.y).toBeCloseTo(FRAME.cy + (ay - extentV - ahy) * FRAME.s, 9);
    expect(place.w).toBeCloseTo(2 * ahx * FRAME.s, 9);
    // typing goes to the field, never the page
    lease.input("http://127.0.0.1:4321/n");
    expect(t.calls.sent).toEqual([]);
    // ⏎: the page goes where it says, through its navigation — and the page's lease is back
    t.element.value = NEXT;
    expect(lease.keydown(key("Enter"))).toBe(true);
    expect(t.calls.navigations).toEqual([{ e: 1, command: { action: "go", url: NEXT } }]);
    expect(t.hand.stats()).toMatchObject({ went: 1, pageLeases: 2 });
    const page = t.lease();
    expect(page.value()).toBe("");
    // Esc in the address: back to the page, TAKEN — the pane stays in hand
    t.hand.address(1 as Entity);
    expect(t.lease().keydown(key("Escape"))).toBe(true);
    expect(t.hand.stats().pageLeases).toBe(3);
    // an address that is not a web page (nothing typed: the sample) is the pane's url, written — never sent to the page
    t.hand.address(1 as Entity);
    t.element.value = "";
    t.lease().keydown(key("Enter"));
    expect(t.calls.navigations).toHaveLength(1);
    expect(t.writes.at(-1)?.value).toMatchObject({ url: "https://lumen.example/" });
  });

  it("a press over the held pane keeps the editor's focus; one beside it does not", () => {
    const t = setup();
    t.hand.follow(0);
    // the container's px: the client point less its rect's corner (10, 20)
    expect(t.press(FRAME.cx + 10, FRAME.cy + 20)).toHaveBeenCalledOnce();
    expect(
      t.press(FRAME.cx + 10 + (EXT.w / 2) * FRAME.s + 5, FRAME.cy + 20),
    ).not.toHaveBeenCalled();
  });

  it("a page's own NAVIGATION writes its url NOT undoably (ruling 9), once per address — and nothing into a read-only document", () => {
    const t = setup({ inHand: false });
    t.setAddressed(new Map([[1 as Entity, NEXT]]));
    // the hand is not idle while a page is at an address its record has not read
    expect(t.hand.idle?.()).toBe(false);
    t.hand.follow(0);
    t.hand.follow(1);
    expect(t.writes).toEqual([
      { e: 1, value: { url: NEXT, device: "laptop" }, opts: { undoable: false } },
    ]);
    expect(t.hand.stats().urls).toBe(1);
    // written: nothing more to follow until the record reads it
    expect(t.hand.idle?.()).toBe(true);
    const ro = setup({ inHand: false, readOnly: true });
    ro.setAddressed(new Map([[1 as Entity, NEXT]]));
    ro.hand.follow(0);
    expect(ro.writes).toEqual([]);
    // refused once is not asked again every frame: the hand rests
    expect(ro.hand.idle?.()).toBe(true);
  });

  it("the held bar's acts reach the hand on their WORLD: back, forward and reload the page's, the address the hand's", () => {
    const t = setup();
    t.hand.follow(0);
    expect(handOf(t.world)).toBe(t.hand);
    const api = { world: t.world, entity: 1 as Entity } as unknown as HeldToolApi;
    const tool = (id: string) => PANE_TOOLS.find((x) => x.id === id);
    tool("back")?.run?.(api);
    tool("forward")?.run?.(api);
    tool("reload")?.run?.(api);
    expect(t.calls.acts.map((a) => a.control)).toEqual(["back", "forward", "reload"]);
    tool("address")?.run?.(api);
    expect(t.hand.stats().addressLeases).toBe(1);
    // the hand binds the desk state's door to its address (a press on the capsule takes it up)
    t.bound()?.address(1 as Entity);
    expect(t.hand.stats().addressLeases).toBe(2);
    t.hand.dispose?.();
    expect(handOf(t.world)).toBeUndefined();
    expect(t.bound()).toBeUndefined();
  });
});
