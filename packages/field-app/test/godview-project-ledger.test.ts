import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  dealProjectSeqs,
  EMPTY_PROJECT_LEDGER,
  loadProjectLedger,
  type ProjectLedger,
  saveProjectLedger,
} from "../src/godview/monitor/project-ledger";

// THE PROJECT LEDGER (record §02, D3, adopted at AR-5): a project is dealt a
// SEQUENCE the first time an agent runs in it, and the theme's tint turns the
// sequence into a hue. Everything this file pins is about the sequence being
// an IDENTITY — two runs in one repository share it, it survives a reload, and
// it is never reused — because the hue is only as stable as the number under
// it. The persistence half is CACHE: an unreadable record costs a project its
// colour continuity and nothing more, so every garbage case must start empty
// rather than throw into a renderer that was only asking for a colour.

const KEY = "vf-test-project-ledger";

/** happy-dom's own Storage, which the suite's setup guarantees exists. */
function raw(): string | null {
  return localStorage.getItem(KEY);
}

beforeEach(() => {
  localStorage.removeItem(KEY);
});

afterEach(() => {
  localStorage.removeItem(KEY);
});

describe("dealing a project its sequence", () => {
  it("deals first-seen keys ascending sequences from zero, in the order given", () => {
    const dealt = dealProjectSeqs(EMPTY_PROJECT_LEDGER, ["/a", "/b", "/c"]);
    expect([...dealt.seqByKey]).toEqual([
      ["/a", 0],
      ["/b", 1],
      ["/c", 2],
    ]);
    expect(dealt.next).toBe(3);
    // The empty ledger is untouched: the deal is a new value, not a mutation.
    expect(EMPTY_PROJECT_LEDGER.seqByKey.size).toBe(0);
  });

  it("keeps a key's sequence forever, whatever order it is seen in next", () => {
    // The property the colour rests on. A project that drops off the stage and
    // comes back is the SAME project, so re-dealing it would silently recolour
    // every bubble in it — the visible failure this test exists to prevent.
    const first = dealProjectSeqs(EMPTY_PROJECT_LEDGER, ["/a", "/b"]);
    const second = dealProjectSeqs(first, ["/b", "/c", "/a"]);
    expect(second.seqByKey.get("/a")).toBe(0);
    expect(second.seqByKey.get("/b")).toBe(1);
    expect(second.seqByKey.get("/c")).toBe(2);
    expect(second.next).toBe(3);
  });

  it("returns the SAME object when it dealt nothing, so a poll stops re-rendering", () => {
    // The hook stores this in state; a fresh object per fold would be a new
    // state, a new projection and a re-render of every view, twice a second,
    // to say nothing new.
    const dealt = dealProjectSeqs(EMPTY_PROJECT_LEDGER, ["/a"]);
    expect(dealProjectSeqs(dealt, ["/a"])).toBe(dealt);
    expect(dealProjectSeqs(dealt, [])).toBe(dealt);
    expect(dealProjectSeqs(EMPTY_PROJECT_LEDGER, [])).toBe(EMPTY_PROJECT_LEDGER);
  });

  it("deals a repeated key once within a single call", () => {
    // Every row of a project arrives on the same fold, so the common case IS
    // the repeat: three runs in one repository must not cost three sequences.
    const dealt = dealProjectSeqs(EMPTY_PROJECT_LEDGER, ["/a", "/a", "/a", "/b"]);
    expect(dealt.seqByKey.get("/a")).toBe(0);
    expect(dealt.seqByKey.get("/b")).toBe(1);
    expect(dealt.next).toBe(2);
  });

  it("never rewinds `next`, so a retired project's hue stays retired", () => {
    const dealt = dealProjectSeqs(EMPTY_PROJECT_LEDGER, ["/a", "/b"]);
    // The caller drops /a and /b entirely and shows only a new project: the
    // new one gets 2, not 0, because 0 is still /a's colour wherever it is.
    const later = dealProjectSeqs(dealt, ["/c"]);
    expect(later.seqByKey.get("/c")).toBe(2);
    expect(later.next).toBe(3);
  });
});

describe("the ledger between sessions", () => {
  it("round-trips through storage, key for key and sequence for sequence", () => {
    const dealt = dealProjectSeqs(EMPTY_PROJECT_LEDGER, ["/project/vibe-field", "/project/ice"]);
    saveProjectLedger(KEY, dealt);
    const loaded = loadProjectLedger(KEY);
    expect([...loaded.seqByKey]).toEqual([...dealt.seqByKey]);
    expect(loaded.next).toBe(dealt.next);
    // …and dealing on top of the reloaded ledger continues the sequence rather
    // than starting over, which is the whole point of persisting it.
    expect(dealProjectSeqs(loaded, ["/project/new"]).seqByKey.get("/project/new")).toBe(2);
  });

  it("starts empty when nothing was ever saved", () => {
    expect(loadProjectLedger(KEY)).toEqual(EMPTY_PROJECT_LEDGER);
  });

  it("starts empty on garbage rather than throwing at the renderer", () => {
    // Four ways a cache goes bad, all of which reach a component that was only
    // asking for a colour. Each must be a fresh ledger, never an exception.
    for (const bad of [
      "not json at all",
      "null",
      '{"version":2,"next":1,"seqs":[["/a",0]]}',
      '{"version":1,"next":"one","seqs":[["/a",0]]}',
      '{"version":1,"next":1}',
      '"a string"',
    ]) {
      localStorage.setItem(KEY, bad);
      expect(loadProjectLedger(KEY)).toEqual(EMPTY_PROJECT_LEDGER);
    }
  });

  it("drops the entries it cannot read and keeps the ones it can", () => {
    // The tolerant reader at the cache: one corrupt row is not a reason to
    // recolour every other project on the device.
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        next: 3,
        seqs: [["/a", 0], ["/b", "one"], [42, 1], ["/c", 2], ["/d"], "nonsense"],
      }),
    );
    const loaded = loadProjectLedger(KEY);
    expect([...loaded.seqByKey]).toEqual([
      ["/a", 0],
      ["/c", 2],
    ]);
    expect(loaded.next).toBe(3);
  });

  it("never deals a sequence twice after a truncated record", () => {
    // `next` is the larger of what was saved and what the surviving sequences
    // imply. A record whose counter was lost would otherwise re-deal 0 — two
    // projects, one hue, and no way to tell them apart on the stage.
    localStorage.setItem(KEY, JSON.stringify({ version: 1, next: 0, seqs: [["/a", 7]] }));
    const loaded = loadProjectLedger(KEY);
    expect(loaded.seqByKey.get("/a")).toBe(7);
    expect(loaded.next).toBe(8);
    expect(dealProjectSeqs(loaded, ["/b"]).seqByKey.get("/b")).toBe(8);
  });

  it("swallows a storage partition that refuses to answer", () => {
    // A private window, a cleared partition, a quota: the colours still hold
    // for this session, which is all a cache owes anybody.
    const broken: Storage = {
      length: 0,
      clear: () => undefined,
      getItem: () => {
        throw new Error("partition is blocked");
      },
      key: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error("partition is blocked");
      },
    };
    const real = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { value: broken, configurable: true });
    try {
      expect(loadProjectLedger(KEY)).toEqual(EMPTY_PROJECT_LEDGER);
      expect(() =>
        saveProjectLedger(KEY, dealProjectSeqs(EMPTY_PROJECT_LEDGER, ["/a"])),
      ).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: real, configurable: true });
    }
  });

  it("saves an empty ledger as an empty ledger, not as an absence", () => {
    const empty: ProjectLedger = EMPTY_PROJECT_LEDGER;
    saveProjectLedger(KEY, empty);
    expect(raw()).not.toBeNull();
    expect(loadProjectLedger(KEY)).toEqual(EMPTY_PROJECT_LEDGER);
  });
});

describe("the cache's cap (AR-5b)", () => {
  it("persists at most 256 keys — the newest dealt — and deals on past them", () => {
    // A machine that has run agents in a thousand directories must not keep a
    // thousand absolute paths in its renderer partition; the newest projects
    // keep their colours, the oldest fall out of the cache and re-deal.
    const keys = Array.from({ length: 300 }, (_, index) => `/Projects/p${index}`);
    const dealt = dealProjectSeqs(EMPTY_PROJECT_LEDGER, keys);
    saveProjectLedger("vf-test-cap", dealt);
    const loaded = loadProjectLedger("vf-test-cap");
    expect(loaded.seqByKey.size).toBe(256);
    expect(loaded.seqByKey.get("/Projects/p299")).toBe(299);
    expect(loaded.seqByKey.has("/Projects/p0")).toBe(false);
    // `next` never rewinds: a project that fell out is dealt a NEW sequence
    expect(loaded.next).toBe(300);
    expect(dealProjectSeqs(loaded, ["/Projects/p0"]).seqByKey.get("/Projects/p0")).toBe(300);
  });
});
