// SIX PAGES ALIVE AT MOST (PT-5b ruling 3; PT-D8; ICE design-019 §7 — "a cap on live faces is the HOST's policy") — the
// policy, pure: which of the desk's pages may be ALIVE (a WebContents each — the expensive term; a page asked paused is
// alive too), which are PUT TO REST and which WAIT on their stills. The desk's `LIVE` service (desk-live.ts) reads the
// plan and does it: a rest takes the page's still first, then hibernates it (its address kept); a wake asks it live again.
//  - The HELD page is alive always, and never rested.
//  - Every SEEN pane's page is alive while there is room: a seen page that is not alive is woken when a slot is free, or by
//    resting the least-recently-seen UNSEEN alive page; where every alive page is seen it WAITS — a seen page is never
//    rested for another seen one (a rest costs the page its history, its scroll and whatever was typed into it). Among
//    those waiting, the nearest the view's centre is served first.
//  - An UNSEEN page that is alive stays alive while nothing needs its slot (panning back finds it as it was); one that is
//    not alive is never woken.
//  - Over the cap (it was lowered; a held page had to come alive): the unseen go first, least recently seen first, then the
//    seen ones farthest from the view's centre — never the held one.
//  - A page being put to rest (`fixed`, alive) is LEAVING: the plan counts its slot as free already — so no second page is
//    rested for the one it makes room for — and the service wakes nobody into that slot until the page is gone. A stopped
//    page (`fixed`, not alive) has nothing planned for it at all.
//  - A page whose lane is still being attached (`unknown`) MAY be alive already (this window was reloaded: main kept its
//    pages): it holds a slot against every seen page but itself until its lane says, so a reload wakes no page in the
//    place of one that was alive all along.
//  - Item 581 (2026-11-19) — AN AGENT'S PAGE NEVER RESTS A PERSON'S, seen, unseen or let go: a face is a run's (`agent`)
//    or, without one, the person's. An agent's page that needs a slot takes a free one, or an agent's unseen page (its own
//    run's first, then another run's); none, and it WAITS — and `capRoom` says there is no room for one more. The person's
//    pages that need a slot rest an agent's unseen page before one of their own, and are served before an agent's. A KEPT
//    pane (a run still needs it) is rested only for the person's HAND, and only when nothing else can give: the one its
//    run called on longest ago first. A rest of a person's page is the person's own view's or hand's, never an agent's.

import { LIVE_PAGES_MAX_V1 } from "@vibefield/contracts";

/** The most pages a desk keeps alive at once: the contracts' one number (item 581, 2026-11-19 — the room the desk says
 * to main is bounded by it, so the two never name two sixes). */
export const LIVE_PAGES_MAX = LIVE_PAGES_MAX_V1;

/** One of the desk's pages as the policy reads it. */
export interface CapFace {
  readonly key: string;
  /** What its pane asks: in the hand, seen at rest, or unseen (paused, or not yet asked). */
  readonly want: "held" | "seen" | "unseen";
  /** Its page is alive now (made, and not at rest). */
  readonly alive: boolean;
  /** When it was last seen, ms (−Infinity: never). */
  readonly seenAt: number;
  /** How far its pane lies from the view's centre (any unit; +Infinity: unknown). */
  readonly far: number;
  /** Nothing is planned for it: it is being put to rest now (alive: leaving — its slot is as good as free), or it stopped. */
  readonly fixed?: boolean;
  /** Its lane is still being attached: whether its page is alive is not known yet. */
  readonly unknown?: boolean;
  /** PT-6a (M7 B7): a page LET GO — its face closed (a deleted pane's, kept by the pool's grace for an undo; another mount's)
   * — that rests before any lane, by rule, whatever its stamp. */
  readonly ghost?: boolean;
  /** Item 581 — the run whose page this is: set ONLY for a page main and fieldd accepted into that run's own profile (never
   * from a word in the document, which any writer could forge); absent, the page is the PERSON's. */
  readonly agent?: {
    readonly run: string;
    /** A pane its run still needs (its call's page; the opener of a live pop-up): rested only for the person's hand. */
    readonly keep?: boolean;
    /** When its run last called on it, ms: of the kept panes, the hand rests the one called on longest ago first. */
    readonly calledAt?: number;
  };
}

/** What the service does next: these put to rest (in order), then these woken — each when a slot IS free (a page that is
 * leaving still holds its own until it is gone); `waiting` see their stills. */
export interface CapPlan {
  readonly rest: readonly string[];
  readonly wake: readonly string[];
  readonly waiting: readonly string[];
}

const byKey = (a: CapFace, b: CapFace): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
/** Least recently seen first. */
const stalest = (a: CapFace, b: CapFace): number => a.seenAt - b.seenAt || byKey(a, b);
/** PT-6a (M7 B7): the let-go pages first, then the lanes — each the least recently seen first (before: by the stamp alone, so a
 * pane picked up and then deleted outlived a lane panned away earlier — its stamp the fresher). */
const ghostsFirst = (a: CapFace, b: CapFace): number =>
  (a.ghost === true ? 0 : 1) - (b.ghost === true ? 0 : 1) || stalest(a, b);
/** Nearest the view's centre first; of two as near, the more recently seen. */
const nearest = (a: CapFace, b: CapFace): number =>
  (a.far === b.far ? 0 : a.far < b.far ? -1 : 1) || b.seenAt - a.seenAt || byKey(a, b);
/** Item 581: an agent's page before the person's. */
const agentsFirst = (a: CapFace, b: CapFace): number =>
  (a.agent === undefined ? 1 : 0) - (b.agent === undefined ? 1 : 0);
/** Item 581: the person's page before an agent's. */
const personsFirst = (a: CapFace, b: CapFace): number => agentsFirst(b, a);
/** Item 581: the let-go pages first, then an agent's before the person's, each the least recently seen first. */
const givesFirst = (a: CapFace, b: CapFace): number =>
  (a.ghost === true ? 0 : 1) - (b.ghost === true ? 0 : 1) || agentsFirst(a, b) || stalest(a, b);
/** Item 581: a run's page. */
const isAgents = (f: CapFace): boolean => f.agent !== undefined;
/** Item 581: a page that may give its slot to anyone but the hand (not a kept pane). */
const loose = (f: CapFace): boolean => f.agent?.keep !== true;
/** Item 581: of the kept panes, the one its run called on longest ago first. */
const calledAt = (f: CapFace): number => f.agent?.calledAt ?? Number.NEGATIVE_INFINITY;
const calledLongest = (a: CapFace, b: CapFace): number => calledAt(a) - calledAt(b) || byKey(a, b);
/** Item 581: of an agent's pages, its own run's first. */
const runFirst =
  (run: string) =>
  (a: CapFace, b: CapFace): number =>
    (a.agent?.run === run ? 0 : 1) - (b.agent?.run === run ? 0 : 1) || ghostsFirst(a, b);

export function capPlan(faces: readonly CapFace[], cap: number = LIVE_PAGES_MAX): CapPlan {
  const max = Math.max(1, Math.floor(cap));
  // the pages that will be alive: those alive now, less the ones leaving
  const alive = new Set(faces.filter((f) => f.alive && f.fixed !== true).map((f) => f.key));
  /** The pages that may turn out alive: each holds a slot against the seen ones (but itself) until its lane says. */
  const unknown = new Set(faces.filter((f) => f.unknown === true && !f.alive).map((f) => f.key));
  const free = (f: CapFace): boolean =>
    alive.size + unknown.size - (unknown.has(f.key) ? 1 : 0) < max;
  const rest: string[] = [];
  const wake: string[] = [];
  const waiting: string[] = [];
  const unseenAlive = (): CapFace[] =>
    faces.filter((f) => f.want === "unseen" && alive.has(f.key) && loose(f));
  /** For the person (and the cap lowered): the unseen pages still alive — the let-go ones first, then an agent's before the
   * person's, each the least recently seen first — each may give its slot. */
  const spare = (): CapFace | undefined => unseenAlive().sort(givesFirst)[0];
  /** Item 581 — for an agent's page: an agent's unseen page alone, its own run's first, then another run's; never the
   * person's. */
  const spareFor = (run: string): CapFace | undefined =>
    unseenAlive().filter(isAgents).sort(runFirst(run))[0];
  /** The seen page farthest from the view's centre — an agent's before the person's — the last to give its slot. */
  const farthest = (): CapFace | undefined =>
    faces
      .filter((f) => f.want === "seen" && alive.has(f.key) && loose(f))
      .sort((a, b) => agentsFirst(a, b) || nearest(b, a))[0];
  /** Item 581 — for the hand alone, when nothing else can give: the kept pane its run called on longest ago. */
  const kept = (): CapFace | undefined =>
    faces.filter((f) => f.want !== "held" && alive.has(f.key) && !loose(f)).sort(calledLongest)[0];
  const put = (f: CapFace): void => {
    alive.delete(f.key);
    rest.push(f.key);
  };
  const bring = (f: CapFace): void => {
    alive.add(f.key);
    unknown.delete(f.key);
    wake.push(f.key);
  };
  const asleep = (want: CapFace["want"]): CapFace[] =>
    faces.filter((f) => f.want === want && !alive.has(f.key) && f.fixed !== true);
  // the held page first: alive whatever it costs (the hand is the person's, on any pane)
  for (const f of asleep("held")) {
    if (alive.size >= max) {
      const gives = spare() ?? farthest() ?? kept();
      if (gives !== undefined) put(gives);
    }
    bring(f);
  }
  // the seen ones, the person's before an agent's, each nearest the view's centre first: a free slot, or an unseen page's
  // (an agent's page: an agent's unseen page alone)
  const seen = asleep("seen").sort((a, b) => personsFirst(a, b) || nearest(a, b));
  for (const f of seen) {
    if (free(f)) {
      bring(f);
      continue;
    }
    // no page is rested for it while another may turn out alive (the plan is made again when that lane says)
    const settled = alive.size >= max && unknown.size - (unknown.has(f.key) ? 1 : 0) === 0;
    const gives = !settled ? undefined : f.agent === undefined ? spare() : spareFor(f.agent.run);
    if (gives === undefined) {
      waiting.push(f.key);
      continue;
    }
    put(gives);
    bring(f);
  }
  // over the cap still (it was lowered): the unseen, then the seen farthest out — never the held, nor a kept pane
  while (alive.size > max) {
    const gives = spare() ?? farthest();
    if (gives === undefined) break;
    put(gives);
    if (gives.want === "seen") waiting.push(gives.key);
  }
  return { rest, wake, waiting };
}

/** Item 581: the plan's probe — an agent's seen page, served after every face that asks, never one of the desk's keys. */
const PROBE = "\uffffroom:";

/**
 * Item 581 — ROOM FOR AN AGENT'S PAGES: how many more pages a run could have made alive NOW without a person's page put to
 * rest — `capPlan`'s own answer, by the same givers (a free slot, an agent's unseen page), so a make it refuses and the
 * plan can never disagree. It is the same for every run (any run's unseen page gives to any run's, its own first only
 * in which), so one number a desk: the renderer says it to main as it moves (a make is refused early as "desk full"), and
 * the desk asks it again before it makes a made pane alive (the number may have moved since).
 */
export function capRoom(faces: readonly CapFace[], cap: number = LIVE_PAGES_MAX): number {
  const max = Math.max(1, Math.floor(cap));
  const probes: CapFace[] = Array.from({ length: max }, (_, i) => ({
    key: `${PROBE}${i}`,
    want: "seen",
    alive: false,
    seenAt: Number.NEGATIVE_INFINITY,
    far: Number.POSITIVE_INFINITY,
    agent: { run: PROBE },
  }));
  return capPlan([...faces, ...probes], max).wake.filter((key) => key.startsWith(PROBE)).length;
}
