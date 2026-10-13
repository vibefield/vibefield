/**
 * PT-5d (rulings 1, 3, 4) — THE HAND REACHES EVERY FRAME: which of a page's targets takes each event of the hand, and the
 * point carried into it. Electron's offscreen view forwards every event to the ROOT widget — no input router, no hit test
 * — so a press over a frame of another site (another process) is heard by the HOST page, on the iframe ELEMENT, and the
 * frame hears nothing; `sendInputEvent` the same (PT-5d's probe, v5, v6). A press dispatched on the FRAME'S OWN session,
 * at the point carried into its viewport, lands where it is drawn (v7): this module decides, for each event, the page's
 * own session or a frame's.
 *
 * What it reads is CACHED, never asked on the hand's path (PT-5c, ruling 1): a frame's place is its owner's content quad
 * in its parent's viewport, read off the path and read again when the parent's document says something moved; which
 * document holds the focus is what each document SAYS of it (PT-5d, M7 H2: its own trusted word, after every press, key,
 * tap and focus change in it — a press, a key's down and a tap are HINTS that put the focus in doubt until a word says
 * where it went; while in doubt nothing key-like is sent anywhere — the native waits for a word, bounded, then refuses).
 * A gesture ends where it began (ruling 3): a press, a finger and a key remember their target, and
 * their moves and releases go to it wherever the point is — or nowhere, once its frame is gone or its document is not
 * the press's. Only frames of the page's own tree are targets (ruling 4): the native adds them as they attach.
 */

/** A frame's content quad in its PARENT's viewport (CSS px): its corners from its top-left, clockwise (CDP's `DOM.Quad`). */
export type FrameQuad = readonly [number, number, number, number, number, number, number, number];

/** PT-5d (M6.3a): the part of a frame's content box in view, as fractions of it: [u0, v0, u1, v1]. */
export type FrameVisible = readonly [number, number, number, number];

/** PT-5d (M6.3a, M7 H3): a frame's SIGHT — the part of it in view, and the rects the host draws over it (fractions). */
export interface FrameSight {
  readonly visible: FrameVisible;
  readonly covers: readonly FrameVisible[];
}

/**
 * PT-5d (M12 J5): a frame of the SAME PROCESS as its parent document between a frame and its session's root — an
 * about:blank ad slot, a `srcdoc`, a same-origin widget — which has no session and no record of its own: its owner's
 * quad in the session root's viewport (where the frame's own quad is), and its sight in ITS parent document.
 */
export interface FrameAncestor {
  readonly quad: FrameQuad;
  readonly sight: FrameSight;
}

/**
 * PT-5d (M7 H2): where a document SAYS the focus is, after a trusted event in it — `here`: in its own process (its active
 * element, through every child it can see into, is no frame); `inner`: in a frame it cannot see into (another process or
 * origin — whose own word says which); `away`: not in it at all.
 */
export type FocusWhere = "here" | "inner" | "away";

/** PT-5d (M7 H2): the focus in DOUBT — since a hint (a press, a key's down, a tap), a blur, a focused frame's going. */
interface Doubt {
  /** where the focus is as the words since have said it (`undefined`: the page's; `null`: unknown) */
  base: string | undefined | null;
  /** a word has been heard since the hint */
  heard: boolean;
  /** the hint's command is answered (a doubt with no hint is) — a word heard now settles it */
  answered: boolean;
  /** PT-5d (M12 J7): a key-like event has waited this doubt's whole bound — the next are refused at once, until a word or a
   * new hint (a new doubt) renews it */
  spent: boolean;
  /** PT-6a (K1): born of a hint the PAGE's own session took while the page held the focus by its word — until a word comes,
   * its key-like events are HELD (the host's bound, never the second) and its word is timed */
  page: boolean;
}

/** Where an event goes — the page's own session (`undefined`) or a frame's — and the document it is for. */
export interface FrameTarget {
  readonly session: string | undefined;
  readonly document: number;
}

/** An event routed: its target, and its point carried into the target's viewport. */
export interface FrameRouted {
  readonly target: FrameTarget;
  readonly x: number;
  readonly y: number;
}

interface FrameRecord {
  readonly session: string;
  readonly targetId: string;
  /** its parent's session (`undefined`: the page's own) */
  readonly parent: string | undefined;
  /** its owner's content quad in its parent's viewport (none until the first read) */
  quad: FrameQuad | undefined;
  /** its own viewport's size in its own CSS px, READ of its local root with its quad (none: the quad's own) — M6.1 */
  size: readonly [number, number] | undefined;
  /** its placements, counted: a size read with a quad no longer current is dropped */
  placement: number;
  /** its sight, read with its quad (none: all of it in view, nothing over it) — M6.3a, M7 H3 */
  sight: FrameSight | undefined;
  /** the same-process frames between it and its session's root, each read with its quad (M12 J5) */
  ancestors: readonly FrameAncestor[];
  /** its own commits */
  documents: number;
  /** its document's address, as its target and its commits say it (M6.4a: a hung frame named by its origin) */
  url: string | undefined;
  /** its place in the order frames attach — the later one wins where two overlap */
  readonly order: number;
}

/** PT-5d (M7 H8): where a release goes that cannot be carried into its target — outside its view (CSS px), as the producer's
 * `letGoOn` lets a button go. */
const OUTSIDE = -1000;

/** PT-5d (M12 J3): how far before a hint's send a word's event may be placed and still be taken as following it — a word's
 * age is rounded to the ms, and its transit only ever places it later. */
export const WORD_TOLERANCE_MS = 2;

/** PT-5d (M7 H7): wheels less than this apart as they ARRIVE (M12 J9 — never as their turns run) are one gesture — latched
 * to the target its first went to (the desk's wheel carries no phase: the ruled 100–300 ms). */
export const WHEEL_LATCH_MS = 200;

/** PT-6a (M1): a FRAME's wheel answered later than this after its SEND has BUBBLED — the frame could not take it, and the
 * engine carried it to the frame's parent across processes, answering on a ~1016-ms cadence in an offscreen window (run 4:
 * 526–1018 ms; a frame's ordinary answer 0.3–9.2 ms, the page's own ≤ 34 ms). */
export const WHEEL_BUBBLED_MS = 250;

/** The pressed buttons, the finger and the held keys — each the target its gesture began on. */
interface Hand {
  readonly buttons: Map<string, FrameTarget>;
  finger: FrameTarget | undefined;
  readonly keys: Map<string, FrameTarget>;
}

export class BrowserFrames {
  readonly #frames = new Map<string, FrameRecord>();
  #order = 0;
  #pageDocument = 0;
  /** the session whose document has the focus (`undefined`: the page's own) — when not in doubt */
  #focused: string | undefined;
  /** PT-5d (M7 H2): the focus in doubt (`null`: known) */
  #doubt: Doubt | null = null;
  /** PT-5d (M12 J3): when the latest hint was sent (main's clock) — a word placed before it is an earlier hint's */
  #hintAt: number | undefined;
  /** PT-5d (M12 J2): a frame of another site was attached in the page's document — the doubt applies (an OOPIF may be in
   * transit while none is attached: a frame's own cross-site navigation swaps its session) */
  #framed = false;
  readonly #hand: Hand = { buttons: new Map(), finger: undefined, keys: new Map() };
  /** where the last hover went — told that the pointer left it when the next goes elsewhere */
  #hover: FrameTarget | undefined;
  /** PT-6a (M4, M5 — F1): the page's current document answered a PULLED word for a doubt its own word never settled — a
   * MUTE document: PULL-ONLY until its next commit (its later page-born doubts ask at once) */
  #pullOnly = false;
  /** PT-5d (M7 H7): the wheel's gesture — its target, and when its last wheel came */
  #wheel: { target: FrameTarget; at: number } | undefined;

  // ── the page's tree, as the native hears it ────────────────────────────────────────────────────────────────────

  /** A frame of the page's tree attached: its session, its target, its parent's session (`undefined`: the page's), its
   * address. */
  attached(session: string, targetId: string, parent: string | undefined, url?: string): void {
    if (parent !== undefined && !this.#frames.has(parent)) return;
    this.#framed = true;
    this.#order += 1;
    this.#frames.set(session, {
      session,
      targetId,
      parent,
      quad: undefined,
      size: undefined,
      placement: 0,
      sight: undefined,
      ancestors: [],
      documents: 0,
      url,
      order: this.#order,
    });
  }

  /** A frame's session went (the frame removed, its process gone, it moved to another): it, and every frame in it. */
  detached(session: string): void {
    if (!this.#frames.delete(session)) return;
    for (const frame of [...this.#frames.values()])
      if (frame.parent === session) this.detached(frame.session);
    // PT-5d (M7 H2): the focused frame gone or swapped (its own cross-site navigation: a new session for the same frame) —
    // where the focus is now is unknown: in doubt until a word (before: the page's — keys on its session, a frame focused)
    if (this.#doubt !== null) {
      if (this.#doubt.base === session) this.#doubt.base = null;
    } else if (this.#focused === session)
      this.#doubt = { base: null, heard: true, answered: true, spent: false, page: false };
  }

  /** A frame committed another document — its own word, on its own session. The frames of the document before go with
   * it (PT-5d, M6.2: the focus in one of them with them — the page's, as at their going). */
  committed(session: string, url?: string): void {
    const frame = this.#frames.get(session);
    if (frame === undefined) return;
    frame.documents += 1;
    frame.url = url;
    for (const child of [...this.#frames.values()])
      if (child.parent === session) this.detached(child.session);
  }

  /** The PAGE committed another document: every frame of the one before goes with it; the focus is the page's. PT-5d (M7
   * H5): the buttons and keys held go with it too — the producer forgets them, and no release follows: kept, every hover of
   * the new document went to a press's target that no longer stands. The finger is kept: its end goes to its session (H4). */
  pageCommitted(document: number): void {
    this.#framed = false;
    this.#pullOnly = false;
    this.#pageDocument = document;
    this.#frames.clear();
    this.#focused = undefined;
    this.#doubt = null;
    this.#hover = undefined;
    this.#hand.buttons.clear();
    this.#hand.keys.clear();
  }

  /**
   * A frame's quad as its parent's session said it (`undefined`: it is not laid out — no box, nothing lands in it); the
   * placement's count, for the read of its own size that goes with it. PT-5d (M6.1): a quad DRAWN AT ANOTHER SIZE (its
   * owner resized, its transform changed) unsays the size read before — the quad's own until its own is read; a quad that
   * only moved (a scroll) keeps it. PT-5d (M6.3a, M7 H3): with its SIGHT (none: all of it, nothing over it) — a point on a
   * part an ancestor of its owner clips, or the host draws over, is not the frame's. PT-5d (M12 J5): and the sight of
   * each SAME-PROCESS frame between its owner's document and its session's root — a point is the frame's only if every
   * one admits it too (before: the slot's own document alone was read, and the page's header over an ad slot sent its
   * press into the ad inside).
   */
  placed(
    session: string,
    quad: FrameQuad | undefined,
    sight?: FrameSight,
    ancestors: readonly FrameAncestor[] = [],
  ): number {
    const frame = this.#frames.get(session);
    if (frame === undefined) return 0;
    if (quad === undefined || frame.quad === undefined || !sameDrawnSize(frame.quad, quad))
      frame.size = undefined;
    frame.quad = quad;
    frame.sight = sight;
    frame.ancestors = ancestors;
    frame.placement += 1;
    return frame.placement;
  }

  /** A frame's own viewport, read of its local root with the quad of `placement` — dropped if that is no longer current
   * (PT-5d, M6.1: never a word of its documents — its own children of its site say theirs on its session too). */
  sized(session: string, width: number, height: number, placement: number): void {
    const frame = this.#frames.get(session);
    if (frame === undefined || frame.placement !== placement || !(width > 0 && height > 0)) return;
    frame.size = [width, height];
  }

  /**
   * PT-5d (M7 H2) — A DOCUMENT SAID WHERE THE FOCUS IS — on its own session (`undefined`: the page's — its main document or
   * any of its process). The ONLY truth of the focus: `here` — that session's; `inner` — a frame of another process under
   * it: the one the focus was in, if it is one (else unknown, until that frame's own word); `away` — not under it: where it
   * was, if that is elsewhere (else unknown). Unknown, or a word heard before a hint's answer, leaves the focus in doubt;
   * a word with or after the answer settles it. (Before: `focus`/`blur` of a window, and the hand's press, DECIDED it — a
   * Tab into a frame, a press that kept a frame's focus, a page that lost it sent keys on the page's session with a frame
   * of another site focused: M3's banned path.) PT-5d (M12 J3): `at`, where main placed the word's event on its clock —
   * one before the latest hint (less `WORD_TOLERANCE_MS`) is an EARLIER hint's late word, and moves nothing (before: it
   * settled the later hint — the page's late word of its own key settled a press into a frame on the page).
   */
  where(session: string | undefined, where: FocusWhere, at?: number): void {
    if (session !== undefined && !this.#frames.has(session)) return;
    if (at !== undefined && this.#hintAt !== undefined && at < this.#hintAt - WORD_TOLERANCE_MS)
      return;
    const doubt = this.#doubt;
    const base = doubt === null ? this.#focused : doubt.base;
    let next: string | undefined | null;
    if (where === "here") next = session;
    else if (where === "inner")
      next =
        typeof base === "string" && base !== session && this.under(base, session) ? base : null;
    else next = base === null || base === session || this.under(base, session) ? null : base;
    if (doubt === null) {
      if (next === null)
        this.#doubt = { base: null, heard: true, answered: true, spent: false, page: false };
      else this.#focused = next;
      return;
    }
    doubt.base = next;
    doubt.heard = true;
    // (M12 J7: a word — any — renews the doubt's bound: the words come, the next may say where it is)
    doubt.spent = false;
    if (doubt.answered && next !== null) this.settle(next);
  }

  /** PT-5d (M7 H2): a HINT — a press, a key's down, a tap — sent to a document: the focus may move; in doubt until a word
   * heard with or after its answer says where it went. `at`: when it was sent (main's clock — M12 J3: the words of
   * events before it move nothing). PT-6a (K1): `page` — it went on the PAGE's own session; with the focus the page's by
   * its word before it (or a doubt of the page's still awaiting its word), the doubt is the page's own: held for its word. */
  handSent(at?: number, page = false): void {
    if (at !== undefined) this.#hintAt = at;
    const was = this.#doubt;
    this.#doubt = {
      base: was === null ? this.#focused : was.base,
      heard: false,
      answered: false,
      spent: false,
      page: page && (was === null ? this.#focused === undefined : was.page && !was.heard),
    };
  }

  /** PT-6a (M4, M5 — F1): is the page's current document PULL-ONLY (mute: its doubts ask for their word)? */
  pullOnly(): boolean {
    return this.#pullOnly;
  }

  /** PT-6a (F1): the page's current document answered a pulled word its own push never sent — pull-only until its commit. */
  markPullOnly(): void {
    this.#pullOnly = true;
  }

  /** PT-6a (K1): the hint's command was REFUSED (let go at a commit, refused by the engine) — nothing of it reached the page,
   * so no word of it comes: its doubt holds nothing for one (J7's second, as before). */
  handRefused(): void {
    if (this.#doubt !== null) this.#doubt.page = false;
  }

  /** PT-6a (K1): the doubt that awaits its PAGE's own word — born of a hint the page's own session took while the page held
   * the focus, no word heard since, in a document that held a frame of another site (where key-like events wait for it):
   * an opaque token of it (the native times the word by it), or undefined. */
  pageWord(): object | undefined {
    const doubt = this.#doubt;
    return doubt !== null && this.#framed && doubt.page && !doubt.heard ? doubt : undefined;
  }

  /** PT-5d (M7 H2): the hint's command answered — a word heard since settles the doubt; else the next word will. */
  handAnswered(): void {
    const doubt = this.#doubt;
    if (doubt === null || doubt.answered) return;
    doubt.answered = true;
    if (doubt.heard && doubt.base !== null) this.settle(doubt.base);
  }

  /** PT-5d (M7 H2): is the focus in doubt — nothing key-like may be sent until a word settles it? PT-5d (M12 J2): only in
   * a document that has held a frame of another site — a page that never did keeps its keys on its own session, in order,
   * never waiting (as at `8dd23597`): no OOPIF, no M3 hazard. (One whose frames all went keeps the doubt: a frame's own
   * cross-site navigation leaves none attached while its new session comes.) */
  inDoubt(): boolean {
    return this.#doubt !== null && this.#framed;
  }

  /** PT-5d (M12 J7): has a key-like event waited this doubt's whole bound — ONE bound a doubt: the next are refused at once
   * (before: each waited its own, one behind another on the hand's one queue — N events, N seconds of a frozen pane)? A
   * word, or a new hint, renews it. */
  doubtSpent(): boolean {
    return this.#doubt?.spent === true;
  }

  /** PT-5d (M12 J7): a key-like event waited the doubt's whole bound, and no word came. */
  spendDoubt(): void {
    if (this.#doubt !== null) this.#doubt.spent = true;
  }

  /** The frames of the page's tree, by session, and their parents: what the native reads their quads by. */
  frames(): readonly {
    readonly session: string;
    readonly targetId: string;
    readonly parent: string | undefined;
  }[] {
    return [...this.#frames.values()].map(({ session, targetId, parent }) => ({
      session,
      targetId,
      parent,
    }));
  }

  // ── the hand's events ──────────────────────────────────────────────────────────────────────────────────────────

  /** A button's press at a page point: the frame drawn there (the innermost), its target remembered. (Where the focus goes
   * is its document's word — M7 H2: a press is a hint, never a decision.) */
  press(button: string, x: number, y: number): FrameRouted {
    const routed = this.at(x, y);
    this.#hand.buttons.set(button, routed.target);
    // (the pointer is the press's target's until its release: a hover after it leaves it, as after a drag in a browser)
    this.#hover = routed.target;
    return routed;
  }

  /** PT-5d (M12 J12): a press whose command was refused — let go at its frame's detach, or refused by the engine: down for
   * nobody (the producer never told it down, and no release follows it) — nothing holds its button. */
  unpressed(button: string): void {
    this.#hand.buttons.delete(button);
  }

  /**
   * A move: with a button down, to that press's target wherever the point is (a drag — nowhere once it is gone); else a
   * HOVER, to the frame drawn there — and, where the hover crosses from one target into another, first to the one it
   * left, at the point carried into it (outside it): its document hears the pointer leave, as a browser's router tells it.
   */
  move(x: number, y: number): readonly FrameRouted[] {
    const held = [...this.#hand.buttons.values()][0];
    if (held !== undefined) {
      const routed = this.to(held, x, y);
      return routed === null ? [] : [routed];
    }
    const routed = this.at(x, y);
    const was = this.#hover;
    this.#hover = routed.target;
    if (was === undefined || same(was, routed.target)) return [routed];
    const left = this.to(was, x, y);
    return left === null ? [routed] : [left, routed];
  }

  /** A button's release: to its press's target if it still stands, wherever the point is; else nowhere. (A release the
   * frames never saw pressed — pressed before they were known — is the page's, as every event was before PT-5d.) PT-5d
   * (M7 H8): never judged by a geometry — a point that cannot be carried into its target (its quad unread: `display:
   * none`, a read refused) goes outside the target's view; dropped, its renderer kept the button down. */
  release(button: string, x: number, y: number): FrameRouted | null {
    const target = this.#hand.buttons.get(button) ?? this.targetOf(undefined);
    this.#hand.buttons.delete(button);
    if (!this.stands(target)) return null;
    return this.to(target, x, y) ?? { target, x: OUTSIDE, y: OUTSIDE };
  }

  /** The wheel: the frame drawn under it — PT-5d (M7 H7) LATCHED to its gesture's first target: a wheel less than
   * `WHEEL_LATCH_MS` after the last goes where it went, the point carried into it (a frame the page scrolls under the
   * pointer mid-gesture takes none of it: the page's scroll went on through every embed it passed); its target gone, a new
   * gesture; a frame's late answer moves it to the frame's parent (PT-6a M1, `wheelAnswered`). `now`: when the wheel
   * ARRIVED (ms) — M12 J9: never when its turn ran. */
  wheel(x: number, y: number, now: number): FrameRouted {
    const latched = this.#wheel;
    if (latched !== undefined && now - latched.at < WHEEL_LATCH_MS) {
      const routed = this.to(latched.target, x, y);
      if (routed !== null) {
        latched.at = now;
        return routed;
      }
    }
    const routed = this.at(x, y);
    this.#wheel = { target: routed.target, at: now };
    return routed;
  }

  /** PT-6a (M1): a wheel `target` answered `took` ms after its send — a FRAME's past `WHEEL_BUBBLED_MS` bubbled: its
   * gesture's latch moves to the frame's PARENT (the page, or a parent frame), and the rest of the gesture goes there at once,
   * the point carried into its viewport — as the engine's own chain would after the bubble (before: every further wheel to
   * the frame, each bubbled again: the hand's one chain held a second a wheel). The page's, on time, or a target the latch no
   * longer holds: nothing moves. */
  wheelAnswered(target: FrameTarget, took: number): void {
    const latched = this.#wheel;
    if (took <= WHEEL_BUBBLED_MS || target.session === undefined) return;
    if (latched === undefined || !same(latched.target, target)) return;
    const frame = this.#frames.get(target.session);
    if (frame !== undefined) latched.target = this.targetOf(frame.parent);
  }

  /** A finger down: the frame drawn there, the finger's target remembered. */
  touchStart(x: number, y: number): FrameRouted {
    const routed = this.at(x, y);
    this.#hand.finger = routed.target;
    return routed;
  }

  /** The finger's move: to its target if it stands. */
  touchMove(x: number, y: number): FrameRouted | null {
    const finger = this.#hand.finger;
    return finger === undefined ? null : this.to(finger, x, y);
  }

  /** The finger lifted or cancelled: PT-5d (M7 H4) to its SESSION while that stands, whatever its document — the engine
   * holds a touch open across a commit (PT-5c's `across.cjs`: the next document deaf to its first tap until the end comes);
   * its session gone, nowhere. It is let go either way. (Buttons and keys keep the document rule.) */
  touchEnd(): FrameTarget | null {
    const finger = this.#hand.finger;
    this.#hand.finger = undefined;
    if (finger === undefined) return null;
    if (finger.session === undefined) return this.targetOf(undefined);
    return this.#frames.has(finger.session) ? this.targetOf(finger.session) : null;
  }

  /** A key's down: the focused document's session; its target remembered by its code. */
  keyDown(code: string): FrameTarget {
    const target = this.focused();
    this.#hand.keys.set(code, target);
    return target;
  }

  /** A key's up: PT-5d (M7 H2) to the CURRENT focus when that is a frame of another site — as a browser delivers it (a Tab
   * whose down moved the focus into a frame has its up there, never on the page's session); else to its down's target if
   * it still stands — else nowhere (a key not down: the focused). */
  keyUp(code: string): FrameTarget | null {
    const target = this.#hand.keys.get(code);
    this.#hand.keys.delete(code);
    if (this.#focused !== undefined) return this.focused();
    if (target === undefined) return this.focused();
    return this.stands(target) ? target : null;
  }

  /** Text, a composition, a command: the focused document's session. */
  focused(): FrameTarget {
    return this.targetOf(this.#focused);
  }

  /** PT-5d (M6.4a): the origin of the frame on a session (`undefined`: the page's own, or an address with none). */
  originOf(session: string | undefined): string | undefined {
    const url = session === undefined ? undefined : this.#frames.get(session)?.url;
    if (url === undefined) return undefined;
    try {
      const origin = new URL(url).origin;
      return origin === "null" ? undefined : origin;
    } catch {
      return undefined;
    }
  }

  /** Is the target still there — its session attached, its document the one it was? */
  stands(target: FrameTarget): boolean {
    if (target.session === undefined) return target.document === this.#pageDocument;
    const frame = this.#frames.get(target.session);
    return frame !== undefined && frame.documents === target.document;
  }

  // ── where a point is ───────────────────────────────────────────────────────────────────────────────────────────

  /** The innermost frame drawn at a page point (its quad known) — on its VISIBLE part (M6.3a), admitted by every
   * same-process frame it is in (M12 J5) — and the point in its viewport. */
  at(x: number, y: number): FrameRouted {
    let session: string | undefined;
    let px = x;
    let py = y;
    for (;;) {
      let inner: FrameRecord | undefined;
      let carried: readonly [number, number] | undefined;
      for (const frame of this.#frames.values()) {
        if (frame.parent !== session || frame.quad === undefined) continue;
        const local = carry(frame, px, py);
        if (
          local === undefined ||
          !within(frame, local) ||
          !inView(frame, local) ||
          !admitted(frame, px, py)
        )
          continue;
        if (inner === undefined || frame.order > inner.order) {
          inner = frame;
          carried = local;
        }
      }
      if (inner === undefined || carried === undefined) break;
      session = inner.session;
      [px, py] = carried;
    }
    return { target: this.targetOf(session), x: px, y: py };
  }

  /** A page point carried into a target's viewport through every quad above it; nowhere if it does not stand. */
  to(target: FrameTarget, x: number, y: number): FrameRouted | null {
    if (!this.stands(target)) return null;
    const chain: FrameRecord[] = [];
    for (let s = target.session; s !== undefined; ) {
      const frame = this.#frames.get(s);
      if (frame === undefined) return null;
      chain.unshift(frame);
      s = frame.parent;
    }
    let px = x;
    let py = y;
    for (const frame of chain) {
      const local = carry(frame, px, py);
      if (local === undefined) return null;
      [px, py] = local;
    }
    return { target, x: px, y: py };
  }

  /** The focus known again: `session`'s. */
  private settle(session: string | undefined): void {
    this.#focused = session;
    this.#doubt = null;
  }

  /** Is frame `session` under `parent` (`undefined`: the page — every frame of its tree is)? */
  private under(session: string | undefined, parent: string | undefined): boolean {
    if (session === undefined) return false;
    let s = this.#frames.get(session)?.parent;
    for (;;) {
      if (s === parent) return true;
      if (s === undefined) return false;
      s = this.#frames.get(s)?.parent;
    }
  }

  private targetOf(session: string | undefined): FrameTarget {
    if (session === undefined) return { session: undefined, document: this.#pageDocument };
    return { session, document: this.#frames.get(session)?.documents ?? 0 };
  }
}

/** Two quads drawn at the same size — their two edges as long (to a hundredth of a px): only moved. */
const sameDrawnSize = (a: FrameQuad, b: FrameQuad): boolean =>
  Math.abs(Math.hypot(a[2] - a[0], a[3] - a[1]) - Math.hypot(b[2] - b[0], b[3] - b[1])) < 0.01 &&
  Math.abs(Math.hypot(a[6] - a[0], a[7] - a[1]) - Math.hypot(b[6] - b[0], b[7] - b[1])) < 0.01;

/** The same target: the same session, the same document. */
const same = (a: FrameTarget, b: FrameTarget): boolean =>
  a.session === b.session && a.document === b.document;

/**
 * A point of a frame's parent carried into the frame's own viewport: where it is along the quad's top edge and down its
 * left (a quad under a 2D transform is a parallelogram), times the frame's own viewport (its size read — else the quad's
 * own). Undefined: a quad with no area. A stated limit (PT-5d, M7 H15): under a PERSPECTIVE (3D) transform a frame's quad
 * is a general one — taken by three of its corners, the point carried as if it were a parallelogram.
 */
function carry(frame: FrameRecord, x: number, y: number): readonly [number, number] | undefined {
  const q = frame.quad;
  if (q === undefined) return undefined;
  const along = fractionsOf(q, x, y);
  if (along === undefined) return undefined;
  const [w, h] = sizeOf(frame, q);
  return [along[0] * w, along[1] * h];
}

/** Where a point is along a quad's top edge and down its left, as fractions of them (undefined: a quad with no area). */
function fractionsOf(q: FrameQuad, x: number, y: number): readonly [number, number] | undefined {
  const [x1, y1, x2, y2, , , x4, y4] = q;
  const ax = x2 - x1;
  const ay = y2 - y1;
  const bx = x4 - x1;
  const by = y4 - y1;
  const det = ax * by - ay * bx;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return undefined;
  const dx = x - x1;
  const dy = y - y1;
  return [(dx * by - dy * bx) / det, (ax * dy - ay * dx) / det];
}

/** A frame's own viewport: its size read (M6.1), else its quad's own. */
function sizeOf(frame: FrameRecord, q: FrameQuad): readonly [number, number] {
  return frame.size ?? [Math.hypot(q[2] - q[0], q[3] - q[1]), Math.hypot(q[6] - q[0], q[7] - q[1])];
}

/** Is a point of a frame's own viewport inside it? */
function within(frame: FrameRecord, [x, y]: readonly [number, number]): boolean {
  const q = frame.quad;
  if (q === undefined) return false;
  const [w, h] = sizeOf(frame, q);
  return x >= 0 && y >= 0 && x < w && y < h;
}

/** PT-5d (M6.3a, M7 H3): is a point of a frame's own viewport on the part of it in view, and under nothing the host draws
 * over it? */
function inView(frame: FrameRecord, [x, y]: readonly [number, number]): boolean {
  const q = frame.quad;
  const sight = frame.sight;
  if (q === undefined || sight === undefined) return true;
  const [w, h] = sizeOf(frame, q);
  const on = (r: FrameVisible): boolean =>
    x >= r[0] * w && y >= r[1] * h && x < r[2] * w && y < r[3] * h;
  return on(sight.visible) && !sight.covers.some(on);
}

/** PT-5d (M12 J5): is a point of a frame's PARENT session's viewport (where its quad, and its ancestors', are) admitted by
 * every same-process frame between it and that session's root — on each one's visible part, under none of its covers? */
function admitted(frame: FrameRecord, x: number, y: number): boolean {
  return frame.ancestors.every(({ quad, sight }) => {
    const along = fractionsOf(quad, x, y);
    if (along === undefined) return false;
    const [u, v] = along;
    const on = (r: FrameVisible): boolean => u >= r[0] && v >= r[1] && u < r[2] && v < r[3];
    return on(sight.visible) && !sight.covers.some(on);
  });
}
