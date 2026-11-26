// PT-5b (ruling 3) — SIX PAGES ALIVE AT MOST: the policy, pure (surfaces/live/live-cap.ts). What is planned for a desk's
// pages given which are alive, which their panes ask for (held, seen, unseen), when each was last seen and how far each lies
// from the view's centre: the held page always, never rested; a seen page into a free slot or an unseen page's — never
// another seen page's; an unseen page left alive while nothing needs its slot, never woken; over the cap the unseen first.
// Item 581 (2026-11-19): an agent's page never rests a person's, seen, unseen or let go; `capRoom` is the plan's own count.
import { LIVE_PAGES_MAX_V1 } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { type CapFace, capPlan, capRoom, LIVE_PAGES_MAX } from "../src/surfaces/live/live-cap";

const face = (
  key: string,
  want: CapFace["want"],
  alive: boolean,
  over: Partial<CapFace> = {},
): CapFace => ({
  key,
  want,
  alive,
  seenAt: 0,
  far: Number.POSITIVE_INFINITY,
  ...over,
});

describe("PT-5b — the cap's plan (ruling 3)", () => {
  it("the cap is six", () => {
    expect(LIVE_PAGES_MAX).toBe(6);
    // item 581: the contracts' number, the bound of the room the desk says to main — one six, never two
    expect(LIVE_PAGES_MAX).toBe(LIVE_PAGES_MAX_V1);
    // …and the plan's own default
    const seven = Array.from({ length: 7 }, (_, i) => face(`p${i}`, "seen", false, { far: i }));
    expect(capPlan(seven).wake).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
    expect(capPlan(seven).waiting).toEqual(["p6"]);
  });

  it("a seen page comes alive while there is room; one over the cap WAITS — a seen page is never rested for another seen one", () => {
    const plan = capPlan(
      [face("a", "seen", true), face("b", "seen", true), face("c", "seen", false)],
      2,
    );
    expect(plan).toEqual({ rest: [], wake: [], waiting: ["c"] });
    expect(capPlan([face("a", "seen", true), face("c", "seen", false)], 2)).toEqual({
      rest: [],
      wake: ["c"],
      waiting: [],
    });
  });

  it("of the seen pages that are not alive, the nearest the view's centre are served first (a desk zoomed out over twenty panes: six alive, fourteen on their stills)", () => {
    const twenty = Array.from({ length: 20 }, (_, i) =>
      face(`p${String(i).padStart(2, "0")}`, "seen", false, { far: (i * 7) % 20 }),
    );
    const plan = capPlan(twenty, 6);
    const near = [...twenty].sort((a, b) => a.far - b.far).map((f) => f.key);
    expect(plan.wake).toEqual(near.slice(0, 6));
    expect(plan.waiting).toEqual(near.slice(6));
    expect(plan.rest).toEqual([]);
  });

  it("a seen page that is not alive takes the slot of the least-recently-seen UNSEEN alive page", () => {
    const plan = capPlan(
      [
        face("old", "unseen", true, { seenAt: 10 }),
        face("new", "unseen", true, { seenAt: 90 }),
        face("c", "seen", false),
      ],
      2,
    );
    expect(plan).toEqual({ rest: ["old"], wake: ["c"], waiting: [] });
  });

  it("an unseen page that is alive stays alive while nothing needs its slot; one that is not alive is never woken", () => {
    expect(capPlan([face("a", "unseen", true), face("b", "unseen", false)], 2)).toEqual({
      rest: [],
      wake: [],
      waiting: [],
    });
  });

  it("the HELD page is alive whatever it costs — an unseen page gives its slot first, else the seen one farthest out — and is never the one rested", () => {
    // an unseen page stands: it goes, the seen one stays
    expect(
      capPlan([face("h", "held", false), face("s", "seen", true), face("u", "unseen", true)], 2),
    ).toEqual({ rest: ["u"], wake: ["h"], waiting: [] });
    // only seen pages stand: the farthest from the view's centre goes (of two as far, the least recently seen)
    expect(
      capPlan(
        [
          face("h", "held", false),
          face("near", "seen", true, { far: 1 }),
          face("far", "seen", true, { far: 9 }),
        ],
        2,
      ).rest,
    ).toEqual(["far"]);
    expect(
      capPlan(
        [
          face("h", "held", false),
          face("stale", "seen", true, { seenAt: 1 }),
          face("fresh", "seen", true, { seenAt: 5 }),
        ],
        2,
      ).rest,
    ).toEqual(["stale"]);
    // the held page alive, the cap lowered under it: the others go, never it
    expect(
      capPlan([face("h", "held", true, { far: 99 }), face("s", "seen", true, { far: 0 })], 1),
    ).toEqual({ rest: ["s"], wake: [], waiting: ["s"] });
    // …and alone over a cap of one it stays
    expect(capPlan([face("h", "held", true), face("g", "held", true)], 1).rest).toEqual([]);
  });

  it("over the cap (it was lowered): the unseen go first, least recently seen first, then the seen farthest out", () => {
    const plan = capPlan(
      [
        face("s1", "seen", true, { far: 1 }),
        face("s2", "seen", true, { far: 2 }),
        face("u1", "unseen", true, { seenAt: 5 }),
        face("u2", "unseen", true, { seenAt: 1 }),
      ],
      1,
    );
    expect(plan.rest).toEqual(["u2", "u1", "s2"]);
    expect(plan.waiting).toEqual(["s2"]);
  });

  it("PT-6a (M7, B7) — over the cap, a LET-GO page (a ghost: a deleted pane's page in the pool's grace, or another mount's) rests before ANY lane, whatever its stamp: a ghost asked live a moment before its delete still goes before a lane panned away long ago; of two ghosts, the stalest first", () => {
    const plan = capPlan(
      [
        face("s", "seen", true, { far: 1, seenAt: 10_000 }),
        face("lane", "unseen", true, { seenAt: 1_000, far: 5 }),
        face("ghost", "unseen", true, { seenAt: 9_000, ghost: true }),
        face("old", "unseen", true, { seenAt: 2_000, ghost: true }),
      ],
      2,
    );
    expect(plan.rest).toEqual(["old", "ghost"]);
    // and a seen page that waits takes a ghost's slot before a lane's
    const woke = capPlan(
      [
        face("lane", "unseen", true, { seenAt: 1_000, far: 5 }),
        face("ghost", "unseen", true, { seenAt: 9_000, ghost: true }),
        face("new", "seen", false, { far: 1 }),
      ],
      2,
    );
    expect(woke.rest).toEqual(["ghost"]);
    expect(woke.wake).toEqual(["new"]);
  });

  it("a page being put to rest (`fixed`, alive) is LEAVING: its slot is planned as free — the page it makes room for is to be woken, and NO second page is rested for it; a stopped page has nothing planned", () => {
    // a is leaving for c: c is to be woken (the service holds that wake until a is gone) — b, unseen, is not rested too
    expect(
      capPlan(
        [
          face("a", "unseen", true, { fixed: true }),
          face("b", "unseen", true),
          face("c", "seen", false),
        ],
        2,
      ),
    ).toEqual({ rest: [], wake: ["c"], waiting: [] });
    // over the cap by the one that is leaving: nobody else goes
    expect(
      capPlan(
        [
          face("a", "seen", true, { fixed: true }),
          face("b", "seen", true),
          face("h", "held", true),
        ],
        2,
      ),
    ).toEqual({ rest: [], wake: [], waiting: [] });
    // a leaving page is not chosen again, nor woken
    expect(
      capPlan([face("a", "seen", true, { fixed: true }), face("b", "seen", true)], 1).rest,
    ).toEqual([]);
    // a stopped page (not alive, nothing to plan for it) is never "woken" by the plan: its ↻ is the person's
    expect(capPlan([face("stopped", "seen", false, { fixed: true })], 2).wake).toEqual([]);
  });

  it("a page whose lane is still attaching (`unknown`) may be alive already: it holds a slot against every seen page but itself — the held page waits for nobody", () => {
    // three panes asked for while their lanes attach, cap 2: none is woken in the place of one that may be alive
    const three = [
      face("a", "seen", false, { unknown: true, far: 1 }),
      face("b", "seen", false, { unknown: true, far: 2 }),
      face("c", "seen", false, { unknown: true, far: 3 }),
    ];
    expect(capPlan(three, 2)).toEqual({ rest: [], wake: [], waiting: ["a", "b", "c"] });
    // one page alone is woken while its own lane attaches
    expect(capPlan([three[0] as CapFace], 2).wake).toEqual(["a"]);
    // a said it is alive, c that it is not, b has not said: b takes the slot that is left (its own, if it was alive all
    // along) and c waits — never woken in b's place
    expect(
      capPlan(
        [
          face("a", "seen", true),
          face("b", "seen", false, { unknown: true }),
          face("c", "seen", false),
        ],
        2,
      ),
    ).toEqual({ rest: [], wake: ["b"], waiting: ["c"] });
    // …whichever lies nearer the view's centre: c, nearer, still waits while b has not said
    expect(
      capPlan(
        [
          face("a", "seen", true),
          face("b", "seen", false, { unknown: true, far: 9 }),
          face("c", "seen", false, { far: 1 }),
        ],
        2,
      ),
    ).toEqual({ rest: [], wake: ["b"], waiting: ["c"] });
    // …nor an unseen page rested while another lane has not said
    expect(
      capPlan(
        [
          face("u", "unseen", true),
          face("v", "unseen", true),
          face("b", "unseen", false, { unknown: true }),
          face("c", "seen", false),
        ],
        2,
      ),
    ).toEqual({ rest: [], wake: [], waiting: ["c"] });
    // the held page comes alive at once
    expect(
      capPlan(
        [face("h", "held", false, { unknown: true }), face("b", "seen", false, { unknown: true })],
        1,
      ).wake,
    ).toEqual(["h"]);
  });
});

describe("item 581 — an agent's page never rests a person's", () => {
  /** A run's page (`agent`), as the desk sets it for a page accepted into that run's own profile. */
  const agents = (
    key: string,
    want: CapFace["want"],
    alive: boolean,
    run = "r1",
    over: Partial<CapFace> = {},
  ): CapFace => face(key, want, alive, { ...over, agent: { run, ...over.agent } });
  const sixPersons = (over: Partial<CapFace> = {}): CapFace[] =>
    Array.from({ length: 6 }, (_, i) => face(`p${i}`, "unseen", true, { seenAt: i, ...over }));

  it("at six, an agent's seen page rests none of the person's unseen pages: it waits, and there is no room", () => {
    const faces = [...sixPersons(), agents("a", "seen", false, "r1", { far: 0 })];
    expect(capPlan(faces)).toEqual({ rest: [], wake: [], waiting: ["a"] });
    expect(capRoom(sixPersons())).toBe(0);
    // a person's LET-GO page (a deleted pane kept for an undo) is the person's too
    const ghosts = sixPersons({ ghost: true });
    expect(capPlan([...ghosts, agents("a", "seen", false)]).rest).toEqual([]);
    expect(capRoom(ghosts)).toBe(0);
  });

  it("an agent's page takes a free slot, and the room counts the free slots", () => {
    const five = sixPersons().slice(0, 5);
    expect(capPlan([...five, agents("a", "seen", false)])).toEqual({
      rest: [],
      wake: ["a"],
      waiting: [],
    });
    expect(capRoom(five)).toBe(1);
    expect(capRoom([])).toBe(LIVE_PAGES_MAX);
  });

  it("an agent's page rests an agent's unseen page — its own run's first, then another run's — and never a kept one", () => {
    const faces = [
      face("p", "unseen", true, { seenAt: 0 }),
      agents("other", "unseen", true, "r2", { seenAt: 1 }),
      agents("own", "unseen", true, "r1", { seenAt: 9 }),
      agents("keep", "unseen", true, "r1", { seenAt: 0, agent: { run: "r1", keep: true } }),
    ];
    expect(capPlan([...faces, agents("a", "seen", false, "r1")], 4).rest).toEqual(["own"]);
    expect(capPlan([...faces, agents("a", "seen", false, "r3")], 4).rest).toEqual(["other"]);
    // the person's and the kept one are not room: two agent pages may come alive here
    expect(capRoom(faces, 4)).toBe(2);
  });

  it("the person's seen page rests an agent's unseen page before one of their own, however stale theirs", () => {
    const faces = [
      face("mine", "unseen", true, { seenAt: 1 }),
      agents("theirs", "unseen", true, "r1", { seenAt: 9 }),
      face("look", "seen", false),
    ];
    expect(capPlan(faces, 2)).toEqual({ rest: ["theirs"], wake: ["look"], waiting: [] });
    // …but never a kept pane: it waits as it would for a seen one
    const kept = [
      face("mine", "seen", true),
      agents("keep", "unseen", true, "r1", { agent: { run: "r1", keep: true } }),
      face("look", "seen", false),
    ];
    expect(capPlan(kept, 2)).toEqual({ rest: [], wake: [], waiting: ["look"] });
  });

  it("the person's seen pages are served before an agent's, however near the agent's lies", () => {
    const plan = capPlan(
      [agents("a", "seen", false, "r1", { far: 0 }), face("p", "seen", false, { far: 9 })],
      1,
    );
    expect(plan).toEqual({ rest: [], wake: ["p"], waiting: ["a"] });
  });

  it("the HAND (the person's, on any pane) is alive whatever it costs: a let-go page, an agent's unseen, the person's unseen, an agent's seen, the person's seen — and only then a kept pane, the one its run called on longest ago", () => {
    const hand = face("h", "held", false);
    const order = [
      face("ghost", "unseen", true, { ghost: true, seenAt: 9 }),
      agents("aUnseen", "unseen", true, "r1", { seenAt: 9 }),
      face("pUnseen", "unseen", true, { seenAt: 0 }),
      agents("aSeen", "seen", true, "r1", { far: 0 }),
      face("pSeen", "seen", true, { far: 9 }),
    ];
    // each in turn is the one that gives, while it stands
    for (let i = 0; i < order.length; i += 1)
      expect(capPlan([hand, ...order.slice(i)], order.length - i).rest).toEqual([order[i]?.key]);
    // every alive page kept: the hand rests exactly the one its run called on longest ago (ties by key), which then
    // waits on its still like any seen page that gave its slot
    const kept = (key: string, calledAt: number): CapFace =>
      agents(key, "seen", true, "r1", { agent: { run: "r1", keep: true, calledAt } });
    expect(capPlan([hand, kept("k2", 20), kept("k1", 10), kept("k0", 10)], 3)).toEqual({
      rest: ["k0"],
      wake: ["h"],
      waiting: ["k0"],
    });
    // an agent's pane in the hand is the person's hand: it rests the person's unseen page as any hand would
    const held = agents("a", "held", false, "r1");
    expect(capPlan([held, face("p", "unseen", true)], 1).rest).toEqual(["p"]);
  });

  it("over the cap (it was lowered): an agent's unseen first, then the person's, then an agent's seen, then the person's — never a kept pane", () => {
    const plan = capPlan(
      [
        face("pSeen", "seen", true, { far: 9 }),
        agents("aSeen", "seen", true, "r1", { far: 0 }),
        face("pUnseen", "unseen", true, { seenAt: 0 }),
        agents("aUnseen", "unseen", true, "r1", { seenAt: 9 }),
        agents("keep", "seen", true, "r1", { agent: { run: "r1", keep: true } }),
      ],
      1,
    );
    expect(plan.rest).toEqual(["aUnseen", "pUnseen", "aSeen", "pSeen"]);
  });

  it("the room is the plan's own answer: each page it counts, the plan wakes as an agent's; one more waits", () => {
    const desks: CapFace[][] = [
      [],
      sixPersons(),
      [...sixPersons().slice(0, 3), agents("u", "unseen", true), agents("v", "unseen", true, "r2")],
      [face("look", "seen", false), agents("u", "unseen", true), ...sixPersons().slice(0, 5)],
      [face("b", "seen", false, { unknown: true }), ...sixPersons().slice(0, 4)],
    ];
    for (const desk of desks) {
      const room = capRoom(desk);
      const asking = Array.from({ length: room + 1 }, (_, i) =>
        agents(`new${i}`, "seen", false, "r9", { far: Number.POSITIVE_INFINITY }),
      );
      const plan = capPlan([...desk, ...asking]);
      expect(asking.filter((f) => plan.wake.includes(f.key)).length).toBe(room);
      expect(plan.waiting).toContain(`new${room}`);
    }
  });
});
