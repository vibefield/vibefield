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

/** The most pages a desk keeps alive at once. */
export const LIVE_PAGES_MAX = 6;

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
  /** The unseen pages still alive, the let-go ones first, each the least recently seen first — each may give its slot. */
  const spare = (): CapFace | undefined =>
    faces.filter((f) => f.want === "unseen" && alive.has(f.key)).sort(ghostsFirst)[0];
  /** The seen page farthest from the view's centre — the last to give its slot. */
  const farthest = (): CapFace | undefined =>
    faces.filter((f) => f.want === "seen" && alive.has(f.key)).sort((a, b) => nearest(b, a))[0];
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
  // the held page first: alive whatever it costs
  for (const f of asleep("held")) {
    if (alive.size >= max) {
      const gives = spare() ?? farthest();
      if (gives !== undefined) put(gives);
    }
    bring(f);
  }
  // the seen ones, nearest the view's centre first: a free slot, or an unseen page's
  for (const f of asleep("seen").sort(nearest)) {
    if (free(f)) {
      bring(f);
      continue;
    }
    // no page is rested for it while another may turn out alive (the plan is made again when that lane says)
    const gives =
      alive.size >= max && unknown.size - (unknown.has(f.key) ? 1 : 0) === 0 ? spare() : undefined;
    if (gives === undefined) {
      waiting.push(f.key);
      continue;
    }
    put(gives);
    bring(f);
  }
  // over the cap still (it was lowered): the unseen, then the seen farthest out — never the held
  while (alive.size > max) {
    const gives = spare() ?? farthest();
    if (gives === undefined) break;
    put(gives);
    if (gives.want === "seen") waiting.push(gives.key);
  }
  return { rest, wake, waiting };
}
