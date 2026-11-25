// THE PANE'S HAND ON THE EDITOR (PT-3 rulings 6–9 — its DOM half, after LT2's reference consumer, the rig's `createRigLiveHand`):
// the pane's DRIVER on one desk, joined by its object's DOM half at the mount. While a pane is IN HAND it LEASES the desk's one
// editor for the page — lent in the frame it is first seen held (a pickup by ⏎ or a double-click alike), again should a blur end
// it, let go when the pane leaves the hand (`live()`):
//  - keys go to the page raw (a key, down and up — a printable one TYPES: the field takes it, and its text reaches the page as
//    text), the IME's composition as `compose` and its commit as text;
//  - the browser's CHORDS stay the browser's (ruling 7): ⌘L the address, ⌘R reload (stop while it loads), ⌘[ / ⌘] back and
//    forward — the lease runs them and takes the key; every other key is the page's;
//  - ESC first exits page fullscreen, otherwise stays the desk's (`open.escape: "desk"`) to put the pane down;
//  - a press over the held pane keeps the editor's focus (its default would move the focus off the textarea and end the lease).
// A second LEASE MODE is the ADDRESS (ruling 8): the editor placed over the head's capsule, holding the page's address; ⏎ goes
// where it says (`resolveAddress`), through the page's navigation; Esc cancels back to the page's lease (the pane stays in hand).
//
// And the one write of its own (ruling 9): a page's NAVIGATION writes the `url` prop NOT UNDOABLY — a page's navigation is not a
// desk edit (⌘Z never sends the page back), but the document remembers where the pane was. The hand writes what the desk state
// says a page is at that its record has not read (`PaneLocal.addressed`); the record then reads it, and follows only a url that
// moved under the page from elsewhere — never this one.
//
// The held bar's acts reach the hand on their world (`handOf` — a tool's act is handed the world and the object, never the desk).

import {
  type EditorLease,
  type EditorPlace,
  type Entity,
  type KindDriver,
  type KindDriverHost,
  type LiveInput,
  type ObjectDomHost,
  type World,
  writable,
} from "@vibefield/plugin-sdk/desk";
import { resolveAddress } from "./address";
import { mountAddressEditor } from "./address-editor";
import { propsCell, urlCell } from "./device";
import { SAMPLE_URL } from "./ids";
import { bandLayout, type HeldPart } from "./law";
import { isPageUrl } from "./live";
import type { PaneLocal } from "./local";

/** The pane's hand on a desk: its driver, which its DOM half joins at the mount. */
export interface PaneHand extends KindDriver {
  join(dom: ObjectDomHost): void;
  /** A control's act (the held bar's slot, its chord, the head's control): back, forward, reload — stop while it loads — or the address. */
  tool(e: Entity, control: HeldPart): void;
  /** The editor over the head's capsule (⌘L, the capsule pressed, the bar's slot): the page's address to edit. */
  address(e: Entity): void;
  /** What the hand has done (a test's and a smoke's witness). */
  stats(): PaneHandStats;
}

export interface PaneHandStats {
  /** Leases lent for a page in hand, and for its address. */
  readonly pageLeases: number;
  readonly addressLeases: number;
  /** Inputs the lease sent its page, chords it ran, addresses it went to. */
  readonly sent: number;
  readonly chords: number;
  readonly went: number;
  /** `url` writes for a page's own navigation (never an undo step). */
  readonly urls: number;
}

/** The hands by the world they act on — what a held tool's act (handed the world and the object) reaches. */
const hands = new WeakMap<World, PaneHand>();
export const handOf = (world: World): PaneHand | undefined => hands.get(world);

/** CDP's modifier mask (Alt 1, Ctrl 2, Meta 4, Shift 8 — `LiveInput` key's `mods`). */
const modsOf = (ev: KeyboardEvent): number =>
  (ev.altKey ? 1 : 0) | (ev.ctrlKey ? 2 : 0) | (ev.metaKey ? 4 : 0) | (ev.shiftKey ? 8 : 0);

/** The browser's chords in hand (ruling 7): ⌘ (or ctrl) with L, R, [ or ] — and what each runs. */
export function chordOf(
  ev: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
): HeldPart | undefined {
  if (!(ev.metaKey || ev.ctrlKey) || ev.altKey) return undefined;
  const k = ev.key.toLowerCase();
  if (k === "l") return "address";
  if (k === "r") return "reload";
  if (k === "[") return "back";
  if (k === "]") return "forward";
  return undefined;
}

/** A pane-frame rect (u, v centre and half extents) on the screen of the hand: its open extent drawn at `frame`. */
function onScreen(
  frame: { readonly cx: number; readonly cy: number; readonly s: number },
  extentV: number,
  u: number,
  v: number,
  hu: number,
  hv: number,
): EditorPlace {
  return {
    x: frame.cx + (u - hu) * frame.s,
    y: frame.cy + (v - extentV - hv) * frame.s,
    w: 2 * hu * frame.s,
    h: 2 * hv * frame.s,
    fontPx: Math.max(2 * hv * frame.s * 0.62, 6),
  };
}

/** PT-6a (M7 C1): how long a held pane's page must have been still — no frame arrived, no input sent — before the hand lets
 * the desk sleep (ms). */
export const HELD_QUIET_MS = 250;

/** The hand's seams a test fills: the cell its one write lands in (the pane type's url cell, from the catalog, by default);
 * the clock its quiet is read by (`performance.now()`, the faces' own). */
export interface PaneHandOptions {
  readonly cell?: () => ReturnType<typeof urlCell>;
  readonly now?: () => number;
  /** PI-1 (2026-11-24): whether pane `e` names a run (its `agentRun`): its address is written to `runAddress`, never to
   * `url`. By default read from the pane type's props cell; what cannot be read there is read as a run's. */
  readonly run?: (e: Entity) => boolean;
}

export function createPaneHand(h: KindDriverHost, opts: PaneHandOptions = {}): PaneHand {
  const cellOf = opts.cell ?? urlCell;
  const now = opts.now ?? (() => performance.now());
  const isRun =
    opts.run ??
    ((e: Entity): boolean => {
      // PI-1 (2026-11-24): "cannot tell" (no props cell, no `agentRun` in it) is a run's: its moves go to `runAddress`,
      // which no reader opens for a person's pane, never to `url`. Only a definite "" names no run.
      const cell = propsCell();
      const props =
        cell === undefined
          ? undefined
          : (h.world.get(e, cell) as Readonly<Record<string, unknown>> | undefined);
      return props?.["agentRun"] !== "";
    });
  /** PI-1 (2026-11-24): the prop pane `e`'s address lives in: a run's pane's `runAddress`, a person's pane's `url`. */
  const addressProp = (e: Entity): "runAddress" | "url" => (isRun(e) ? "runAddress" : "url");
  let dom: ObjectDomHost | undefined;
  let addressEditor: ReturnType<typeof mountAddressEditor> | undefined;
  /** A FIELD OF THE HOST'S CHROME holds the keyboard (track OM, OM-1: the selection bar's Custom fields, in hand): the
   * page does not take it back while the person types there — a press over the pane does. Only a field outside the
   * desk's own container counts, and never the desk's one editor. */
  const chromeTyping = (): boolean => {
    const doc = dom?.container.ownerDocument;
    const el = doc?.activeElement as HTMLElement | null | undefined;
    if (dom === undefined || el == null || el === doc?.body || el === dom.editor.element)
      return false;
    if (dom.container.contains(el)) return false;
    return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(el.tagName);
  };
  /** The pane the editor is lent for, and the lease holding it — the page's or the address's (two leases: ICE's editor keeps a
   * lease it already holds and never asks its value again, so a switch of mode is a hand-over from one lease to the other). */
  let leased: Entity | undefined;
  let current: EditorLease | undefined;
  /** What the field held when the page was last sent its text (the page's lease empties the field each frame). */
  let sent = "";
  /** The address the address's lease starts from — handed to the field at its lend. */
  let seed = "";
  /** What the hand last wrote to each pane's `url` (a write awaits its record). */
  const written = new Map<Entity, string>();
  const counts = { pageLeases: 0, addressLeases: 0, sent: 0, chords: 0, went: 0, urls: 0 };
  const local = (): PaneLocal | undefined => h.local as PaneLocal | undefined;
  const send = (input: LiveInput): void => {
    if (leased !== undefined && local()?.send(leased, input) === true) counts.sent += 1;
  };
  /** The kind's pane in hand, settled or flying in — never one flying home. */
  const inHand = (): Entity | undefined => {
    const hand = h.hand();
    return hand !== undefined && !hand.landing && h.isKind(hand.entity) ? hand.entity : undefined;
  };
  const onKeyUp = (ev: KeyboardEvent): void => {
    if (current !== pageLease || chordOf(ev) !== undefined) return;
    send({ kind: "key", key: ev.key, code: ev.code, phase: "up", mods: modsOf(ev), repeat: false });
  };
  /** A press over the held pane keeps the editor's focus: its default would blur the field and end the lease mid-typing. */
  const onDown = (ev: PointerEvent): void => {
    if (current === addressLease && ev.target === dom?.editor.element) return;
    const e = leased;
    const hand = h.hand();
    const at = e === undefined ? undefined : local()?.layout(e);
    if (
      dom === undefined ||
      e === undefined ||
      hand === undefined ||
      hand.entity !== e ||
      at === undefined
    )
      return;
    const r = dom.container.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const y = ev.clientY - r.top;
    if (
      Math.abs(x - hand.frame.cx) <= (at.ext.w / 2) * hand.frame.s &&
      Math.abs(y - hand.frame.cy) <= (at.ext.h / 2) * hand.frame.s
    ) {
      if (current === addressLease) lend(e, pageLease);
      // A toolbar action or inactive native window can leave the lease held while
      // focus is elsewhere. Re-focus it without resetting the pending text buffer.
      else if (current === pageLease) dom.editor.lend(pageLease);
      ev.preventDefault();
    }
  };

  /** The editor lent for pane `e` — its page's lease or its address's; the one holding it hands over (the focus stays). */
  const lend = (e: Entity, lease: EditorLease): void => {
    if (dom === undefined) return;
    leased = e;
    current = lease;
    sent = "";
    if (lease === addressLease) {
      const cell = cellOf();
      const saved =
        cell === undefined
          ? undefined
          : (h.world.get(e, cell) as { url?: string; runAddress?: string } | undefined);
      seed = local()?.page(e)?.info.address ?? saved?.[addressProp(e)] ?? "";
    }
    dom.editor.lend(lease, lease === addressLease ? seed.length : undefined);
    if (lease === addressLease) {
      addressEditor?.show(true);
      counts.addressLeases += 1;
      dom.editor.element.select();
    } else counts.pageLeases += 1;
    dom.editor.element.addEventListener("keyup", onKeyUp);
  };

  const run = (e: Entity, control: HeldPart): void => {
    if (control === "address") lend(e, addressLease);
    else local()?.act(e, control);
  };

  /** The address typed, gone to: a web page through the page's navigation; anything else (the sample) written as the pane's url. */
  const go = (e: Entity, text: string): void => {
    const url = resolveAddress(text);
    counts.went += 1;
    if (isPageUrl(url, SAMPLE_URL) && local()?.navigate(e, { action: "go", url }) === true) return;
    write(e, url);
  };

  /** The pane's `url` prop, written NOT undoably (ruling 9): a page's navigation is not a desk edit — into the url's own cell, so
   * an undo of the desk's edits to the pane's other props never re-asserts the address it replaced. PI-1 (2026-11-24): a run's
   * pane's address goes to its `runAddress` in the same cell, and its `url` is never written. */
  const write = (e: Entity, url: string): void => {
    const cell = cellOf();
    const session = writable(h.docs);
    if (cell === undefined || session === undefined) return;
    const props = (h.world.get(e, cell) ?? {}) as Readonly<Record<string, unknown>>;
    const prop = addressProp(e);
    if (props[prop] === url) return;
    session.store.transaction(
      (tx) => {
        tx.edit(e).set(cell, { ...props, [prop]: url });
      },
      { undoable: false },
    );
    counts.urls += 1;
  };

  /** The lease is over for `lease` — unless another of the hand's took the editor over (then it is that one's). */
  const ended = (lease: EditorLease): void => {
    // Also on hand-over to the page: `current` already names the new lease then.
    if (lease === addressLease) addressEditor?.show(false);
    if (current !== lease) return;
    dom?.editor.element.removeEventListener("keyup", onKeyUp);
    current = undefined;
    leased = undefined;
  };

  /** Where the editor stands: over the page's top line (where a page's IME candidates would show), or over the head's capsule. */
  const placeFor = (over: "page" | "address"): EditorPlace | null => {
    const e = leased;
    const hand = h.hand();
    const at = e === undefined ? undefined : local()?.layout(e);
    if (e === undefined || hand === undefined || hand.entity !== e || at === undefined) return null;
    const S = at.G.shape;
    const extentV = at.ext.cy - at.G.centre[1];
    if (over === "address") {
      const L = bandLayout(S);
      const [ax, ay, ahx, ahy] = L.address;
      const right = L.reload === null ? ax + ahx : L.reload[0] - L.glyph * 0.8;
      const left = ax - ahx;
      return onScreen(hand.frame, extentV, (left + right) / 2, ay, (right - left) / 2, ahy);
    }
    const [px, py, phx, phy] = S.page;
    const line = Math.min(phy, 10 * S.scale);
    return onScreen(hand.frame, extentV, px, py - phy + line, phx, line);
  };

  /** THE PAGE'S LEASE: its keys, its text, its IME — the browser's chords the lease's own, Esc the desk's. */
  const pageLease: EditorLease = {
    part: "vibefield.browser-pane.page",
    label: "type on the page",
    // emptied each frame: what the field typed went to the page
    value: () => {
      sent = "";
      return "";
    },
    input(v) {
      const add = v.startsWith(sent) ? v.slice(sent.length) : v;
      sent = v;
      if (add !== "") send({ kind: "text", text: add });
    },
    compose(text, caret) {
      send({ kind: "compose", text, caret });
    },
    commit(text) {
      if (text !== "") send({ kind: "text", text });
      sent = dom?.editor.element.value ?? "";
    },
    keydown(ev) {
      const e = leased;
      if (e === undefined) return false;
      // Exit page fullscreen first; otherwise Escape puts the pane back on the canvas.
      if (ev.key === "Escape" && local()?.page(e)?.info.extra?.fullscreen !== true) return false;
      const chord = chordOf(ev);
      if (chord !== undefined) {
        counts.chords += 1;
        run(e, chord);
        return true;
      }
      send({
        kind: "key",
        key: ev.key,
        code: ev.code,
        phase: "down",
        mods: modsOf(ev),
        repeat: ev.repeat,
      });
      // a printable key TYPES: the field takes it, its text the page's
      return !(ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey);
    },
    caret() {},
    place: () => placeFor("page"),
    idle() {},
    ended: () => ended(pageLease),
    live: () => leased !== undefined && inHand() === leased,
  };

  /** THE ADDRESS'S LEASE (ruling 8): the page's address to edit over the head's capsule — ⏎ goes there, Esc back to the page. */
  const addressLease: EditorLease = {
    part: "vibefield.browser-pane.address",
    label: "the page's address",
    // the page's address as the lease begins; then the field's own (a session is open — the field is the truth)
    value: () => {
      const v = seed;
      seed = "";
      return v === "" ? null : v;
    },
    input() {},
    keydown(ev) {
      const e = leased;
      if (e === undefined) return false;
      if (ev.key === "Enter" && !ev.isComposing) {
        const text = dom?.editor.element.value ?? "";
        if (text.trim() !== "") go(e, text);
        lend(e, pageLease);
        return true;
      }
      const chord = chordOf(ev);
      if (chord === "address") {
        dom?.editor.element.select();
        return true;
      }
      if (chord !== undefined) {
        run(e, chord);
        return true;
      }
      // Escape cancels; Tab returns keyboard focus to the page.
      if (ev.key === "Escape" || ev.key === "Tab") {
        lend(e, pageLease);
        return true;
      }
      return false;
    },
    caret() {},
    place: () => placeFor("address"),
    idle() {},
    ended: () => ended(addressLease),
    live: () => leased !== undefined && inHand() === leased,
  };

  const hand: PaneHand = {
    join(d) {
      dom = d;
      addressEditor = mountAddressEditor(d);
      d.container.addEventListener("pointerdown", onDown, { capture: true });
      local()?.bind({ address: (e) => lend(e, addressLease) });
    },
    tool: run,
    address: (e) => lend(e, addressLease),
    stats: () => ({ ...counts }),
    follow() {
      // ruling 9: a page's own navigation, written into its url — once per address, never an undo step
      const at = local()?.addressed();
      if (at !== undefined)
        for (const [e, url] of at) {
          if (written.get(e) === url) continue;
          written.set(e, url);
          write(e, url);
        }
      const e = inHand();
      if (dom === undefined || e === undefined || chromeTyping()) return;
      const holding = dom.editor.lease();
      if (leased === e && (holding === pageLease || holding === addressLease)) return;
      lend(e, pageLease);
    },
    // idle once every address a page went to has been written (or refused — a read-only document) and nothing is held —
    // PT-6a (M7 C1): or the pane is held, its lease the hand's, and its page has not stirred it (a frame arrived, an input sent)
    // for HELD_QUIET_MS: the desk sleeps. What moves wakes it: a frame's arrival (the face wakes its kind), the hand's input,
    // the lease's end (the editor wakes the loop — and the hand, not idle while the lease is not its, lends it again); the
    // head's own motions are its kind's `due`. (Before: never idle while held — a still page held stepped the desk every frame.)
    idle: () => {
      for (const [e, url] of local()?.addressed() ?? []) if (written.get(e) !== url) return false;
      const e = inHand();
      if (chromeTyping()) return true;
      if (e === undefined) return leased === undefined;
      // (the lease's end clears `leased` — `ended` — so a hand whose lease went is not idle until it lends again)
      if (leased !== e) return false;
      return now() - (local()?.stirred(e) ?? Number.NEGATIVE_INFINITY) >= HELD_QUIET_MS;
    },
    dispose() {
      hands.delete(h.world);
      dom?.container.removeEventListener("pointerdown", onDown, { capture: true });
      const holding = dom?.editor.lease();
      if (holding === pageLease || holding === addressLease) dom?.editor.release(holding);
      addressEditor?.dispose();
      local()?.bind(undefined);
    },
  };
  hands.set(h.world, hand);
  return hand;
}
