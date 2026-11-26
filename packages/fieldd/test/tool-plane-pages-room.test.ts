import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ObjectIntent,
  type ObjectIntentAnswer,
  PAGES_PANE_RUN_PROP,
  PAGES_PANE_URL_MAX,
  PAGES_RUN_PANES_MAX,
  PAGES_RUN_STILLS_MAX_BYTES,
  type ShellSurfacesControlParams,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcCallError } from "../src/native-link";
import type { DeskKind } from "../src/objects/kinds";
import {
  BROWSER_KIND,
  createPagesVerbs,
  PAGES_BOOT_ENDS_MAX,
  PAGES_OWED_ENDS_MAX,
  type PagesDeps,
  type PagesVerbs,
  pagesRunsOf,
} from "../src/tool-plane/rooms/pages/verbs";
import {
  type Answer,
  capture,
  cleanupWorlds,
  type DeskWorld,
  type LoggedEvents,
  NOTE,
  ordinaryWindow,
  world,
} from "./desk-fixtures";

// EY-2 (2b, 2026-11-19) — the pages room against a real DeskObjects (OB's grants and presence), a scripted window and a
// FAKE main: main's broker answers each control call as the script says, so every row here shows the room's law given
// main's answer, never main's own. The order of a call is the room's: the caller holds the page, it is a page, it is the
// agent's own (a page from the desk carries the person's sign-ins until EY-5), fieldd binds its pane, the person's hand
// is not on it; then main; then the grant again. A pane any call made is the run's own desk object, granted `placed`.

afterEach(() => cleanupWorlds());

const BROWSER: DeskKind = {
  kind: BROWSER_KIND,
  title: "Browser",
  placeable: true,
  concurrency: "many",
  version: 1,
  tools: [],
};

const S1 = "surface_page_000001";
const S2 = "surface_page_000002";
const URL = "https://example.com/";

type Script = (params: ShellSurfacesControlParams) => unknown;

const done = (data: unknown = {}, more: Record<string, unknown> = {}) => ({
  status: "done",
  output: { success: true, data },
  ...more,
});
const made = (surfaceId: string, by: "open" | "tab" | "popup" = "tab") => ({
  surfaceId,
  url: URL,
  by,
});

/** Main, as a script: each call is answered by the next step, and an empty script answers an empty success. */
function fakeMain() {
  const calls: ShellSurfacesControlParams[] = [];
  const steps: Script[] = [];
  return {
    calls,
    next(step: Script | unknown) {
      steps.push(typeof step === "function" ? (step as Script) : () => step);
    },
    control: async (params: ShellSurfacesControlParams) => {
      calls.push(params);
      const step = steps.shift();
      return step === undefined ? done() : step(params);
    },
  };
}

/** A window that places each made pane under a key of its own, bound to the surface the place names (the adopt seam). */
const pagesWindow = (intent: ObjectIntent): Answer | undefined => {
  if (intent.op !== "place") return ordinaryWindow(intent);
  const key = `k-${String((intent as { made?: unknown }).made)}`;
  return {
    ok: true,
    value: { key, kind: intent.kind, title: "Page", now: "", heldByUser: false, onScreen: true },
    inverse: { remove: key },
    changed: "Opened Page",
  };
};

function room(h: DeskWorld, over: Partial<PagesDeps> = {}) {
  const main = fakeMain();
  const verbs: PagesVerbs = createPagesVerbs({
    objects: h.desk,
    control: main.control,
    stills: {
      folderFor: (run) => `/Users/u/stills/${run}`,
      used: () => 0,
      holds: (run, file) => file.startsWith(`/Users/u/stills/${run}/`),
    },
    ...over,
  });
  return { verbs, main };
}

const A = { runtimeRunId: "run-a", rows: ["browser_tab_new", "browser_click", "object_open"] };
const B = { runtimeRunId: "run-b", rows: [] };

const factOf = (err: unknown) => (err as { details?: { fact?: string } }).details?.fact;
const stateOf = (err: unknown) => (err as { details?: { state?: string } }).details?.state;

/** A desk window, and one page of run-a's own, made by a new tab. */
async function withOwnPage(over: Partial<PagesDeps> = {}) {
  const h = world({ kinds: [BROWSER, NOTE] });
  const win = h.window(pagesWindow);
  const r = room(h, over);
  r.main.next(done({}, { made: [made(S1)] }));
  const answer = (await r.verbs.call("browser_tab_new", A, {})) as {
    page: string;
    made: unknown[];
  };
  r.main.calls.length = 0;
  return { h, win, ...r, page: answer.page, answer };
}

describe("EY-2: a pane a call made is the run's own desk object", () => {
  it("a new tab is placed, granted placed, marked open, and named by its desk object, never its surface", async () => {
    const { h, win, main, page, answer } = await withOwnPage();
    expect(win.seen.filter((intent) => intent.op === "place")).toEqual([
      expect.objectContaining({
        op: "place",
        run: "run-a",
        kind: BROWSER_KIND,
        made: S1,
        props: { [PAGES_PANE_RUN_PROP]: "run-a", url: URL },
      }),
    ]);
    expect(answer).toEqual({ page, made: [{ page, url: URL, by: "tab" }] });
    expect(JSON.stringify(answer)).not.toContain(S1);
    expect(h.desk.grantOf(page, "run-a")?.how).toBe("placed");
    expect(h.desk.presence.agentsOn(page)).toEqual([expect.objectContaining({ state: "open" })]);
    expect(main.calls).toEqual([]);
  });

  it("the place takes the undo shelf like any object's, so the person can take the page off the desk", async () => {
    const { h, page } = await withOwnPage();
    const row = h.desk.presence.snapshot().objects.find((object) => object.ref === page);
    expect(row?.agents).toEqual([
      expect.objectContaining({ run: "run-a", lastChange: { label: "Opened Page" } }),
    ]);
  });

  it("pop-ups main refused in one act are said, each reason once with its count, in the run's words", async () => {
    const said = async (capped: Record<string, unknown>) => {
      const { main, verbs, page } = await withOwnPage();
      main.next(done({ clicked: true }, { capped }));
      const answer = (await verbs.call("browser_click", A, { page, ref: "@e1" })) as Record<
        string,
        unknown
      >;
      expect(answer.result).toEqual({ clicked: true });
      return answer.said;
    };
    expect(await said({ deskFull: 1 })).toBe(
      "1 pop-up from this page did not open, because the desk has no room.",
    );
    expect(await said({ address: 2 })).toBe(
      "2 pop-ups from this page did not open, because a page may open only http and https addresses.",
    );
    expect(await said({ address: 1, runFull: 2, deskFull: 1 })).toBe(
      `4 pop-ups from this page did not open: 2 because this run holds ${PAGES_RUN_PANES_MAX} pages, 1 because the desk has no room, 1 because a page may open only http and https addresses.`,
    );
    // a count that is not a whole number of at least one is not counted, and the act's answer stands
    expect(await said({ deskFull: 0, runFull: 1.5 })).toBeUndefined();
  });

  it("refused pop-ups ride whichever answer comes next: a list says them, and so does a refusal, its fact kept", async () => {
    const { main, verbs, page } = await withOwnPage();
    main.next(done({ tabs: [], current: null }, { capped: { runFull: 1 } }));
    expect(await verbs.call("browser_tab_list", A, {})).toEqual({
      pages: [],
      said: `1 pop-up from this page did not open, because this run holds ${PAGES_RUN_PANES_MAX} pages.`,
    });
    main.next({ status: "refused", fact: "off-site", capped: { deskFull: 2 } });
    const err = await verbs.call("browser_click", A, { page, ref: "@e1" }).catch((e) => e);
    expect(factOf(err)).toBe("off-site");
    expect((err as RpcCallError).message).toMatch(
      / 2 pop-ups from this page did not open, because the desk has no room\.$/,
    );
  });

  it("a reason the room does not know, or a count it cannot say, is logged and passed over, never a failure", async () => {
    const events: LoggedEvents = [];
    const { main, verbs, page } = await withOwnPage({ logger: capture(events) });
    main.next(done({ clicked: true }, { capped: { deskFull: 1, sideways: 3, runFull: 0 } }));
    const answer = (await verbs.call("browser_click", A, { page, ref: "@e1" })) as Record<
      string,
      unknown
    >;
    expect(answer.said).toBe("1 pop-up from this page did not open, because the desk has no room.");
    expect(events).toContainEqual({
      event: "fieldd.pages.capped_unknown",
      attrs: { reasons: "sideways" },
    });
    expect(events).toContainEqual({
      event: "fieldd.pages.capped_dropped",
      attrs: { reasons: "runFull" },
    });
    // a capped that is no record at all is dropped whole, and the act's answer stands
    main.next(done({ clicked: true }, { capped: "many" }));
    expect(await verbs.call("browser_click", A, { page, ref: "@e1" })).toEqual(
      expect.objectContaining({ result: { clicked: true } }),
    );
    expect(events).toContainEqual({
      event: "fieldd.pages.capped_dropped",
      attrs: { reasons: "capped" },
    });
  });

  it("a pane id main names that the room cannot read is dropped and logged, never voiding the act's answer", async () => {
    const events: LoggedEvents = [];
    const { main, verbs, page } = await withOwnPage({ logger: capture(events) });
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `surface_given_back_${i}`);
    main.next(
      done({ clicked: true }, { closed: ["no", 7], givenBack: [...ids(PAGES_RUN_PANES_MAX), "x"] }),
    );
    expect(await verbs.call("browser_click", A, { page, ref: "@e1" })).toEqual(
      expect.objectContaining({ result: { clicked: true } }),
    );
    expect(events).toContainEqual({
      event: "fieldd.pages.panes_dropped",
      attrs: { list: "closed", count: 2 },
    });
    const givenBackDropped = () =>
      events.filter(
        (e) => e.event === "fieldd.pages.panes_dropped" && e.attrs?.list === "givenBack",
      );
    expect(givenBackDropped()).toEqual([
      { event: "fieldd.pages.panes_dropped", attrs: { list: "givenBack", count: 1 } },
    ]);
    // a list that is no list at all is dropped whole, and the answer still stands
    main.next(done({ clicked: true }, { givenBack: "surface_given_back_0" }));
    expect(await verbs.call("browser_click", A, { page, ref: "@e1" })).toEqual(
      expect.objectContaining({ result: { clicked: true } }),
    );
    expect(givenBackDropped()).toHaveLength(2);
  });

  it("a pop-up an act made that the desk would not place is closed, and the act's answer stands", async () => {
    const h = world({ kinds: [BROWSER, NOTE] });
    let refuse = false;
    h.window((intent) =>
      intent.op === "place" && refuse
        ? { ok: false, fact: "conflict", text: "The desk is full." }
        : pagesWindow(intent),
    );
    const { verbs, main } = room(h);
    main.next(done({}, { made: [made(S1)] }));
    const { page } = (await verbs.call("browser_tab_new", A, {})) as { page: string };
    refuse = true;
    main.next(done({ clicked: true }, { made: [made(S2, "popup")] }));
    const answer = (await verbs.call("browser_click", A, { page, ref: "@e1" })) as Record<
      string,
      unknown
    >;
    expect(answer.result).toEqual({ clicked: true });
    expect(answer).not.toHaveProperty("made");
    expect(main.calls.at(-1)).toEqual({
      run: "run-a",
      surfaceId: S2,
      window: "act",
      command: { action: "close" },
    });
  });

  it("the new tab asked main in the run's own form: no surface, an act window, the engine's tab_new", async () => {
    const h = world({ kinds: [BROWSER] });
    h.window(pagesWindow);
    const { verbs, main } = room(h);
    main.next(done({}, { made: [made(S1)] }));
    await verbs.call("browser_tab_new", A, { url: URL });
    expect(main.calls).toEqual([
      { run: "run-a", window: "act", command: { action: "tab_new", url: URL } },
    ]);
  });

  it("open with no page is the run's own new pane too", async () => {
    const h = world({ kinds: [BROWSER] });
    h.window(pagesWindow);
    const { verbs, main } = room(h);
    main.next(done({}, { made: [made(S1, "open")] }));
    const answer = (await verbs.call("browser_open", A, { url: URL })) as { page: string };
    expect(main.calls[0]).toEqual({
      run: "run-a",
      window: "act",
      command: { action: "navigate", url: URL },
    });
    expect(h.desk.grantOf(answer.page, "run-a")?.how).toBe("placed");
  });

  it("a browser engine this VibeField does not have is said so to the model, never as stopped", async () => {
    const h = world({ kinds: [BROWSER] });
    h.window(pagesWindow);
    const { verbs, main } = room(h);
    // main's pages UNAVAILABLE, its state in its details as its provider sends it (EY-1's provider-state pair)
    main.next(() => {
      throw new RpcCallError("UNAVAILABLE", "the live-surface authority is unavailable", true, {
        service: "pages",
        state: "not-installed",
      });
    });
    const err = (await verbs.call("browser_open", A, { url: URL }).catch((e) => e)) as RpcCallError;
    expect(err.kind).toBe("UNAVAILABLE");
    expect(stateOf(err)).toBe("not-installed");
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/browser engine is not installed/);
  });

  it("with no desk open a new tab is refused as no window, before main makes anything", async () => {
    const h = world({ kinds: [BROWSER] });
    const { verbs, main } = room(h);
    const err = await verbs.call("browser_tab_new", A, {}).catch((e) => e);
    expect((err as RpcCallError).kind).toBe("UNAVAILABLE");
    expect(stateOf(err)).toBe("no-window");
    expect(main.calls).toEqual([]);
  });

  it("a pane made while its desk's window closed is ended, and the call says no window", async () => {
    const h = world({ kinds: [BROWSER] });
    const win = h.window(pagesWindow);
    const { verbs, main } = room(h);
    main.next(() => {
      win.dispose();
      return done({}, { made: [made(S1)] });
    });
    const err = await verbs.call("browser_tab_new", A, {}).catch((e) => e);
    expect(stateOf(err)).toBe("no-window");
    expect(main.calls[1]).toEqual({
      run: "run-a",
      surfaceId: S1,
      window: "act",
      command: { action: "close" },
    });
  });

  it("a new page main refused says why, in the run's words: the run's count, the desk's, or no window", async () => {
    const h = world({ kinds: [BROWSER] });
    h.window(pagesWindow);
    const { verbs, main } = room(h);
    for (const [error, fact, said] of [
      ["run-full", "limit", /^This run already holds \d+ pages/],
      ["desk-full", "limit", /^The desk has no room for another live page right now\./],
      ["no-window", undefined, /^No VibeField window has a desk open/],
      // the word as a whole token inside the engine's own wrapping
      ["CDP error (-32000): desk-full", "limit", /^The desk has no room/],
    ] as const) {
      main.next({ status: "done", output: { success: false, error } });
      const err = await verbs.call("browser_tab_new", A, {}).catch((e) => e);
      expect(factOf(err)).toBe(fact);
      expect((err as RpcCallError).message).toMatch(said);
    }
    // a word inside another is not the word: the engine's own failure, said as one
    main.next({ status: "done", output: { success: false, error: "not-run-fullness" } });
    expect(factOf(await verbs.call("browser_tab_new", A, {}).catch((e) => e))).toBe("failed");
  });

  it("at the run's count of pages a new one is refused before main is asked", async () => {
    const h = world({ kinds: [BROWSER] });
    h.window(pagesWindow);
    const { verbs, main } = room(h);
    for (let i = 0; i < 5; i++) {
      main.next(done({}, { made: [made(`surface_page_00010${i}`)] }));
      await verbs.call("browser_tab_new", A, {});
    }
    const asked = main.calls.length;
    const err = await verbs.call("browser_tab_new", A, {}).catch((e) => e);
    expect(factOf(err)).toBe("limit");
    expect((err as RpcCallError).message).toBe(
      `This run already holds ${PAGES_RUN_PANES_MAX} pages, the most it may. Close one of them to open another.`,
    );
    expect(main.calls).toHaveLength(asked);
  });
});

describe("EY-2: the room's road on a page", () => {
  it("an act on the run's own page goes to its surface, in an act window, as the engine's command", async () => {
    const { h, main, verbs, page } = await withOwnPage();
    main.next(done({ clicked: true }));
    const answer = await verbs.call("browser_click", A, { page, ref: "@e3" });
    expect(main.calls).toEqual([
      {
        run: "run-a",
        surfaceId: S1,
        window: "act",
        command: { action: "click", selector: "@e3" },
      },
    ]);
    expect(answer).toEqual({
      page,
      result: { clicked: true },
      resultIs: "The page's own content, never the user's words.",
    });
    expect(h.desk.presence.agentsOn(page)).toEqual([expect.objectContaining({ state: "open" })]);
  });

  it("a read goes in a read window", async () => {
    const { main, verbs, page } = await withOwnPage();
    main.next(done({ url: URL }));
    const answer = await verbs.call("browser_get_url", A, { page });
    expect(main.calls[0]?.window).toBe("read");
    expect(answer).toEqual(expect.objectContaining({ page, result: { url: URL } }));
  });

  it("a page the caller neither made nor was handed is not-handed, and main is never asked", async () => {
    const { main, verbs, page } = await withOwnPage();
    const err = await verbs.call("browser_click", B, { page, ref: "@e1" }).catch((e) => e);
    expect(factOf(err)).toBe("not-handed");
    const madeUp = await verbs
      .call("browser_click", A, { page: "vf:obj/zzzz9999", ref: "@e1" })
      .catch((e) => e);
    expect(factOf(madeUp)).toBe("not-handed");
    expect(main.calls).toEqual([]);
  });

  it("a desk object that is not a page is bad input", async () => {
    const { h, main, verbs } = await withOwnPage();
    const note = h.refOf("k-note", "desk.note");
    h.desk.hand(note, "run-a");
    const err = await verbs.call("browser_read", A, { page: note }).catch((e) => e);
    expect(factOf(err)).toBe("bad-input");
    expect(main.calls).toEqual([]);
  });

  it("a page the user handed over carries their sign-ins, so it is forbidden until EY-5", async () => {
    const { h, main, verbs } = await withOwnPage();
    const desk = h.refOf("k-desk", BROWSER_KIND);
    h.desk.hand(desk, "run-a");
    for (const [name, input] of [
      ["browser_read", { page: desk }],
      ["browser_click", { page: desk, ref: "@e1" }],
      ["browser_eval", { page: desk, script: "1" }],
    ] as const) {
      const err = await verbs.call(name, A, input).catch((e) => e);
      expect(factOf(err)).toBe("forbidden");
    }
    expect(main.calls).toEqual([]);
  });

  it("while the person holds the page, every call answers held at once, reads too, and main is never asked", async () => {
    const { h, main, verbs, page } = await withOwnPage();
    h.desk.presence.hold(page, true);
    for (const [name, input] of [
      ["browser_read", { page }],
      ["browser_click", { page, ref: "@e1" }],
      ["browser_screenshot", { page }],
    ] as const) {
      const err = await verbs.call(name, A, input).catch((e) => e);
      expect(factOf(err)).toBe("held");
      expect((err as RpcCallError).retryable).toBe(true);
    }
    expect(main.calls).toEqual([]);
  });

  it("the grant is read again after main answers: a page taken back meanwhile answers not-handed", async () => {
    const { h, main, verbs, page } = await withOwnPage();
    main.next(() => {
      h.desk.revoke(page, "run-a");
      return done({ text: "secret" });
    });
    const err = await verbs.call("browser_read", A, { page }).catch((e) => e);
    expect(factOf(err)).toBe("not-handed");
    expect(JSON.stringify(err)).not.toContain("secret");
  });

  it("a still is written in the run's private folder, named by fieldd and never by the agent, and answered as its file", async () => {
    const { main, verbs, page } = await withOwnPage();
    const path = "/Users/u/stills/run-a/still-1.png";
    main.next(done({}, { still: { path, mime: "image/png", width: 10, height: 10, bytes: 99 } }));
    const answer = await verbs.call("browser_screenshot", A, { page });
    expect(main.calls[0]).toEqual(
      expect.objectContaining({ folder: "/Users/u/stills/run-a", window: "read" }),
    );
    expect(answer).toEqual({ page, file: path, mime: "image/png" });
  });

  it("a still main names outside the run's own folder is never answered: main's answer is bad", async () => {
    const { main, verbs, page } = await withOwnPage();
    main.next(
      done(
        {},
        {
          still: {
            path: "/Users/u/stills/run-b/still-1.png",
            mime: "image/png",
            width: 10,
            height: 10,
            bytes: 99,
          },
        },
      ),
    );
    const err = await verbs.call("browser_screenshot", A, { page }).catch((e) => e);
    expect(stateOf(err)).toBe("bad-answer");
    expect(JSON.stringify(err)).not.toContain("run-b");
  });

  it("an unchanged still has no file; a folder that cannot be fieldd's own saves none, and main is never asked", async () => {
    const { main, verbs, page } = await withOwnPage();
    main.next(done({}));
    expect(await verbs.call("browser_screenshot", A, { page, ifChanged: true })).toEqual({ page });
    const {
      main: other,
      verbs: noFolder,
      page: p2,
    } = await withOwnPage({
      stills: {
        folderFor: () => {
          throw new Error("not a real directory");
        },
        used: () => 0,
        holds: () => false,
      },
    });
    const err = await noFolder.call("browser_screenshot", A, { page: p2 }).catch((e) => e);
    expect(factOf(err)).toBe("failed");
    expect(other.calls).toEqual([]);
  });

  it("a run whose stills hold the bound is refused limit, saying so, and main is never asked", async () => {
    let made = 0;
    const { main, verbs, page } = await withOwnPage({
      stills: {
        folderFor: (run) => {
          made += 1;
          return `/Users/u/stills/${run}`;
        },
        used: () => PAGES_RUN_STILLS_MAX_BYTES,
        holds: () => true,
      },
    });
    const err = await verbs.call("browser_screenshot", A, { page }).catch((e) => e);
    expect(factOf(err)).toBe("limit");
    expect((err as RpcCallError).message).toMatch(/stills are full/);
    expect(main.calls).toEqual([]);
    expect(made).toBe(0);
    // what is not a still is not bounded by the stills
    main.next(done({ url: URL }));
    expect(await verbs.call("browser_get_url", A, { page })).toEqual(
      expect.objectContaining({ result: { url: URL } }),
    );
  });

  it("a switch reads the page and sets nothing", async () => {
    const { main, verbs, page } = await withOwnPage();
    main.next(done({ url: URL }));
    expect(await verbs.call("browser_tab_switch", A, { page })).toEqual({
      page,
      result: { current: true },
    });
    expect(main.calls[0]).toEqual(
      expect.objectContaining({ window: "read", command: { action: "url" } }),
    );
  });
});

describe("EY-2: main's answers as facts, and the page's at-work mark", () => {
  it("main's refusal keeps its word, the mark open again", async () => {
    const { h, main, verbs, page } = await withOwnPage();
    main.next({ status: "refused", fact: "off-site" });
    const err = await verbs.call("browser_click", A, { page, ref: "@e1" }).catch((e) => e);
    expect(factOf(err)).toBe("off-site");
    expect(h.desk.presence.agentsOn(page)).toEqual([expect.objectContaining({ state: "open" })]);
  });

  it("needs-you says what for, and the mark says the page needs the user", async () => {
    const { h, main, verbs, page } = await withOwnPage();
    main.next({ status: "refused", fact: "needs-you", need: "password" });
    const err = await verbs
      .call("browser_fill", A, { page, ref: "@e2", text: "x" })
      .catch((e) => e);
    expect((err as RpcCallError).details).toEqual({ fact: "needs-you", need: "password" });
    expect(h.desk.presence.agentsOn(page)).toEqual([
      expect.objectContaining({ state: "needs-you" }),
    ]);
  });

  it("a page main says is gone twice running leaves the mark, and fieldd stops binding it", async () => {
    const { h, main, verbs, page } = await withOwnPage();
    main.next({ status: "refused", fact: "gone" });
    main.next({ status: "refused", fact: "gone" });
    const first = await verbs.call("browser_read", A, { page }).catch((e) => e);
    expect(factOf(first)).toBe("gone");
    // F5 (2026-11-24): a page the desk put to rest and woke answers gone once, and works at the next call
    expect((first as RpcCallError).message).toMatch(/Try it once more/);
    expect(h.desk.presence.agentsOn(page)).toEqual([expect.objectContaining({ state: "open" })]);
    const second = await verbs.call("browser_read", A, { page }).catch((e) => e);
    expect(factOf(second)).toBe("gone");
    // a second gone running is the page's end: its words offer no more tries (2026-11-24)
    expect((second as RpcCallError).message).toBe(
      "This page has closed. List your pages, or open a new one.",
    );
    expect(h.desk.presence.agentsOn(page)).toEqual([]);
    const err = await verbs.call("browser_read", A, { page }).catch((e) => e);
    expect(factOf(err)).toBe("gone");
    expect(main.calls).toHaveLength(2);
  });

  it("a page woken after the desk rested it is not forgotten: the call after its one gone reaches it", async () => {
    const { main, verbs, page } = await withOwnPage();
    main.next({ status: "refused", fact: "gone" });
    main.next(done({ url: URL }));
    expect(factOf(await verbs.call("browser_get_url", A, { page }).catch((e) => e))).toBe("gone");
    expect(await verbs.call("browser_get_url", A, { page })).toEqual(
      expect.objectContaining({ page, result: { url: URL } }),
    );
    // a success clears the one gone: the next gone is a first again
    main.next({ status: "refused", fact: "gone" });
    main.next(done({ url: URL }));
    await verbs.call("browser_get_url", A, { page }).catch((e) => e);
    expect(await verbs.call("browser_get_url", A, { page })).toEqual(
      expect.objectContaining({ result: { url: URL } }),
    );
  });

  it("the engine's own words for a part the page no longer has are a stale ref", async () => {
    const { main, verbs, page } = await withOwnPage();
    main.next({ status: "done", output: { success: false, error: "Unknown ref: e9" } });
    const err = await verbs.call("browser_click", A, { page, ref: "@e9" }).catch((e) => e);
    expect(factOf(err)).toBe("stale-ref");
  });

  it("an act main never answered is no answer, never a failure: the act may have happened", async () => {
    const { h, main, verbs, page } = await withOwnPage();
    main.next(() => {
      throw new RpcCallError("TIMEOUT", "deadline");
    });
    const err = await verbs.call("browser_click", A, { page, ref: "@e1" }).catch((e) => e);
    expect((err as RpcCallError).kind).toBe("UNAVAILABLE");
    expect(stateOf(err)).toBe("no-answer");
    expect(h.desk.presence.agentsOn(page)).toEqual([expect.objectContaining({ state: "open" })]);
  });

  it("an answer main's contract refuses is the browser's answer unread", async () => {
    const { main, verbs, page } = await withOwnPage();
    main.next({ status: "nonsense" });
    const err = await verbs.call("browser_read", A, { page }).catch((e) => e);
    expect(stateOf(err)).toBe("bad-answer");
  });

  it("a pop-up an act made is the run's own page too", async () => {
    const { h, main, verbs, page } = await withOwnPage();
    main.next(done({}, { made: [made(S2, "popup")] }));
    const answer = (await verbs.call("browser_click", A, { page, ref: "@e1" })) as {
      made: { page: string; by: string }[];
    };
    expect(answer.made).toEqual([expect.objectContaining({ by: "popup" })]);
    expect(h.desk.grantOf(answer.made[0]?.page ?? "", "run-a")?.how).toBe("placed");
  });
});

describe("EY-2: closing, giving back, listing", () => {
  it("closing one of the run's own pages removes its desk object, the person able to bring it back", async () => {
    const { h, win, main, verbs, page } = await withOwnPage();
    main.next(done({}, { closed: [S1] }));
    expect(await verbs.call("browser_tab_close", A, { page })).toEqual({
      closed: [page],
      returned: [],
    });
    expect(main.calls[0]).toEqual(
      expect.objectContaining({ surfaceId: S1, command: { action: "tab_close" } }),
    );
    expect(win.seen.filter((intent) => intent.op === "remove")).toHaveLength(1);
    expect(h.desk.presence.agentsOn(page)).toEqual([]);
    expect(factOf(await verbs.call("browser_read", A, { page }).catch((e) => e))).toBe("gone");
  });

  it("closing a page the user handed over gives it back, its pane left open, and main is never asked", async () => {
    const { h, win, main, verbs } = await withOwnPage();
    const desk = h.refOf("k-desk", BROWSER_KIND);
    h.desk.hand(desk, "run-a");
    const answer = (await verbs.call("browser_tab_close", A, { page: desk })) as Record<
      string,
      unknown
    >;
    expect(answer).toEqual(expect.objectContaining({ closed: [], returned: [desk] }));
    expect(String(answer.said)).toMatch(/still open/);
    expect(h.desk.grantOf(desk, "run-a")).toBeUndefined();
    expect(win.seen.filter((intent) => intent.op === "remove")).toHaveLength(0);
    expect(main.calls).toEqual([]);
  });

  it("the close ends the run's own pages one by one and gives back the user's", async () => {
    const { h, main, verbs, page } = await withOwnPage();
    const desk = h.refOf("k-desk", BROWSER_KIND);
    h.desk.hand(desk, "run-a");
    main.next(done({}, { closed: [S1] }));
    const answer = (await verbs.call("browser_close", A, {})) as Record<string, unknown>;
    expect(answer).toEqual(expect.objectContaining({ closed: [page], returned: [desk] }));
    // C1 (2026-11-24): each page's own close, which main answers itself; never the run's end
    expect(main.calls).toEqual([
      { run: "run-a", surfaceId: S1, window: "act", command: { action: "close" } },
    ]);
    expect(h.desk.grantOf(desk, "run-a")).toBeUndefined();
  });

  it("open, close, open again: the second open places a new pane, and main never hears the run end", async () => {
    const h = world({ kinds: [BROWSER] });
    const win = h.window(pagesWindow);
    const { verbs, main } = room(h);
    main.next(done({}, { made: [made(S1, "open")] }));
    await verbs.call("browser_open", A, { url: URL });
    main.next(done({}, { closed: [S1] }));
    const closed = (await verbs.call("browser_close", A, {})) as { closed: string[] };
    expect(closed.closed).toHaveLength(1);
    main.next(done({}, { made: [made(S2, "open")] }));
    const again = (await verbs.call("browser_open", A, { url: URL })) as { page: string };
    expect(h.desk.grantOf(again.page, "run-a")?.how).toBe("placed");
    expect(verbs.placed(S2)).toBe(true);
    expect(win.seen.filter((intent) => intent.op === "place")).toHaveLength(2);
    // the run form's close is the run's end alone: a close the agent asked for never sends it
    expect(
      main.calls.filter((c) => c.surfaceId === undefined && c.command.action === "close"),
    ).toEqual([]);
  });

  it("the list is main's, for the run as a whole, naming only pages fieldd minted for this run", async () => {
    const { main, verbs, page } = await withOwnPage();
    main.next(
      done({
        tabs: [
          { surfaceId: S1, url: URL, title: "Example" },
          { surfaceId: "surface_not_this_run", url: URL },
        ],
        current: S1,
      }),
    );
    expect(await verbs.call("browser_tab_list", A, {})).toEqual({
      pages: [{ page, url: URL, title: "Example", handed: false, current: true }],
    });
    expect(main.calls[0]).toEqual({
      run: "run-a",
      window: "read",
      command: { action: "tab_list" },
    });
  });

  it("the profiles row lists the caller's own browser rows, asking main nothing", async () => {
    const { main, verbs } = await withOwnPage();
    expect(await verbs.call("browser_tools_profiles", A, {})).toEqual({
      rows: ["browser_tab_new", "browser_click"],
    });
    expect(main.calls).toEqual([]);
  });
});

describe("EY-2: a run's end and a resume", () => {
  it("a plain run's end ends every page the user handed it, named in an answer or not; each stays the person's", async () => {
    const h = world({ kinds: [BROWSER, NOTE] });
    h.window(pagesWindow);
    const { verbs } = room(h, { resumeGraceMs: 0 });
    const first = h.refOf("k-desk-1", BROWSER_KIND);
    const second = h.refOf("k-desk-2", BROWSER_KIND);
    h.desk.hand(first, "run-a");
    h.desk.hand(second, "run-a");
    // as the runtime tells it: the desk's objects hear the end, then the room
    h.desk.runEnded("run-a");
    verbs.runEnded("run-a");
    expect(h.desk.grantOf(first, "run-a")).toBeUndefined();
    expect(h.desk.grantOf(second, "run-a")).toBeUndefined();
    expect(h.desk.registry.get(first)).toBeDefined();
    expect(h.desk.registry.get(second)).toBeDefined();
  });

  it("a run's end ends its browser session once no resume carried its pages, and they are no longer bound", async () => {
    const { main, verbs, page } = await withOwnPage({ resumeGraceMs: 0 });
    verbs.runEnded("run-a");
    // fieldd binds no pane of an ended run: a call that names one is gone, and main is not asked for it
    expect(factOf(await verbs.call("browser_read", A, { page }).catch((e) => e))).toBe("gone");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(main.calls).toEqual([{ run: "run-a", window: "act", command: { action: "close" } }]);
  });

  it("a resume, its end told first as the runtime tells it, carries the pages on: main is told to move them, never to end them", async () => {
    const { h, main, verbs, page } = await withOwnPage({ resumeGraceMs: 0 });
    h.runs.set("run-c", "live");
    // the runtime tells the old run's end, and only then names its successor; the desk's grants move with it
    verbs.runEnded("run-a");
    h.desk.grant(page, "run-c", "placed");
    verbs.runReplaced("run-a", "run-c");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(main.calls).toEqual([
      { run: "run-c", window: "act", command: { action: "rebind", from: "run-a" } },
    ]);
    main.next(done({ url: URL }));
    const C = { runtimeRunId: "run-c", rows: [] };
    expect(await verbs.call("browser_get_url", C, { page })).toEqual(
      expect.objectContaining({ page, result: { url: URL } }),
    );
    expect(main.calls[1]).toEqual(expect.objectContaining({ run: "run-c", surfaceId: S1 }));
  });

  it("a resume told with no end first carries the pages on too", async () => {
    const { h, main, verbs, page } = await withOwnPage();
    h.runs.set("run-c", "live");
    h.desk.grant(page, "run-c", "placed");
    verbs.runReplaced("run-a", "run-c");
    expect(main.calls).toEqual([
      { run: "run-c", window: "act", command: { action: "rebind", from: "run-a" } },
    ]);
  });
});

describe("EY-2 (the made path): the panes the room placed, the only ones an open may adopt", () => {
  it("a made pane counts as placed from the room's ask, before the window answers", async () => {
    const h = world({ kinds: [BROWSER, NOTE] });
    // a window that holds its place's answer, as one whose pane minted before the answer reached fieldd
    const win = h.window((intent) => (intent.op === "place" ? undefined : ordinaryWindow(intent)));
    const { verbs, main } = room(h);
    main.next(done({}, { made: [made(S1)] }));
    expect(verbs.placed(S1)).toBe(false);
    const call = verbs.call("browser_tab_new", A, {});
    let asked: boolean | undefined;
    try {
      await vi.waitFor(() => expect(win.seen.some((intent) => intent.op === "place")).toBe(true));
      asked = verbs.placed(S1);
    } finally {
      // the window answers at last, whatever the row saw, so no ask outlives the row
      const place = win.seen.find((intent) => intent.op === "place");
      if (place !== undefined)
        h.desk.intents.answer(
          { ...(pagesWindow(place) as Answer), intent: place.intent } as ObjectIntentAnswer,
          "tok-window",
        );
    }
    const { page } = (await call) as { page: string };
    expect(asked).toBe(true);
    expect(verbs.placed(S1)).toBe(true);
    expect(verbs.placed(S2)).toBe(false);
    expect(h.desk.grantOf(page, "run-a")?.how).toBe("placed");
  });

  it("a pane the desk would not place is not placed; the pane before it stands", async () => {
    const h = world({ kinds: [BROWSER, NOTE] });
    let refuse = false;
    h.window((intent) =>
      intent.op === "place" && refuse
        ? { ok: false, fact: "conflict", text: "The desk is full." }
        : pagesWindow(intent),
    );
    const { verbs, main } = room(h);
    main.next(done({}, { made: [made(S1)] }));
    const { page } = (await verbs.call("browser_tab_new", A, {})) as { page: string };
    refuse = true;
    main.next(done({ clicked: true }, { made: [made(S2, "popup")] }));
    await verbs.call("browser_click", A, { page, ref: "@e1" });
    expect(verbs.placed(S1)).toBe(true);
    expect(verbs.placed(S2)).toBe(false);
  });

  it("a pane main closed, or every pane of a run that closed its browser, is placed no more", async () => {
    const one = await withOwnPage();
    expect(one.verbs.placed(S1)).toBe(true);
    one.main.next(done({}, { closed: [S1] }));
    await one.verbs.call("browser_tab_close", A, { page: one.page });
    expect(one.verbs.placed(S1)).toBe(false);

    const all = await withOwnPage();
    expect(all.verbs.placed(S1)).toBe(true);
    all.main.next(done({}, { closed: [S1] }));
    await all.verbs.call("browser_close", A, {});
    expect(all.verbs.placed(S1)).toBe(false);
  });

  it("a run's end keeps its panes placed while a resume may carry them, and a resume carries them on as the new run's", async () => {
    const { h, verbs } = await withOwnPage();
    expect(verbs.placed(S1)).toBe(true);
    h.runs.set("run-c", "live");
    verbs.runEnded("run-a");
    // PI-4 (2026-11-24): a covered desk's first mint in the resume's grace is the carried page's, never closed for good
    expect(verbs.placed(S1)).toBe(true);
    verbs.runReplaced("run-a", "run-c");
    expect(verbs.placed(S1)).toBe(true);
  });

  it("once the resume's grace has passed, an ended run's panes are placed no more", async () => {
    const { verbs } = await withOwnPage({ resumeGraceMs: 1 });
    verbs.runEnded("run-a");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(verbs.placed(S1)).toBe(false);
  });

  it("a run key outside the prop's form places nothing: no place is asked, and the pane is ended", async () => {
    const h = world({ kinds: [BROWSER, NOTE] });
    const win = h.window(pagesWindow);
    const events: LoggedEvents = [];
    const { verbs, main } = room(h, { logger: capture(events) });
    // a key PagesPaneRun refuses (a "."), held by a run the desk vouches for
    h.runs.set("run.a", "live");
    const ODD = { runtimeRunId: "run.a", rows: [] };
    main.next(done({}, { made: [made(S1)] }));
    const err = await verbs.call("browser_tab_new", ODD, {}).catch((e) => e);
    expect(factOf(err)).toBe("failed");
    expect(win.seen.filter((intent) => intent.op === "place")).toEqual([]);
    expect(main.calls[1]).toEqual({
      run: "run.a",
      surfaceId: S1,
      window: "act",
      command: { action: "close" },
    });
    expect(verbs.placed(S1)).toBe(false);
    expect(events.map((logged) => logged.event)).toContain("fieldd.pages.run_key_unfit");
  });
});

describe("S2b: a made pane is placed with its address", () => {
  /** The props of each place the window was asked for, in order. */
  const placedProps = (win: { seen: ObjectIntent[] }) =>
    win.seen
      .filter((intent) => intent.op === "place")
      .map((intent) => (intent as { props?: unknown }).props);

  /** Run-a's browser_open with no page, main answering one pane made by the open at `madeUrl`. */
  async function opened(input: Record<string, unknown>, madeUrl = "about:blank") {
    const h = world({ kinds: [BROWSER] });
    const win = h.window(pagesWindow);
    const { verbs, main } = room(h);
    main.next(done({}, { made: [{ surfaceId: S1, url: madeUrl, by: "open" }] }));
    const answer = (await verbs.call("browser_open", A, input)) as {
      made?: { url: string }[];
    };
    return { win, main, answer };
  }

  it("an open is placed at the address the room asked the page to open, not the one main made it at", async () => {
    const { win } = await opened({ url: URL });
    expect(placedProps(win)).toEqual([{ [PAGES_PANE_RUN_PROP]: "run-a", url: URL }]);
  });

  it("an open's answer names its page at the address it was opened at, not the blank page it was made at", async () => {
    // F9 (2026-11-24): main makes an open's page blank and then sends it the address
    const { answer } = await opened({ url: URL });
    expect(answer.made?.map((m) => m.url)).toEqual([URL]);
    const blank = await opened({}, URL);
    expect(blank.answer.made?.map((m) => m.url)).toEqual(["about:blank"]);
  });

  it("an open with no address is placed blank", async () => {
    const { win, main } = await opened({}, URL);
    expect(main.calls[0]?.command).toEqual({ action: "navigate", url: "about:blank" });
    expect(placedProps(win)).toEqual([{ [PAGES_PANE_RUN_PROP]: "run-a", url: "about:blank" }]);
  });

  it("an address that is not http or https is placed blank, never passed through", async () => {
    // the app's own scheme is built from parts: wall R6 keeps a raw literal of it inside contracts
    const appScheme = "vibefield";
    for (const odd of [
      "file:///etc/hosts",
      "javascript:alert(1)",
      "data:text/html,hi",
      `${appScheme}://desk`,
      "https://",
      "not an address",
    ]) {
      const { win } = await opened({ url: odd }, odd);
      expect(placedProps(win)).toEqual([{ [PAGES_PANE_RUN_PROP]: "run-a", url: "about:blank" }]);
    }
  });

  it("an address longer than the pane's url holds is placed blank; one at the bound is kept", async () => {
    const at = `https://example.com/${"a".repeat(PAGES_PANE_URL_MAX - "https://example.com/".length)}`;
    expect(at.length).toBe(PAGES_PANE_URL_MAX);
    const kept = await opened({ url: at });
    expect(placedProps(kept.win)).toEqual([{ [PAGES_PANE_RUN_PROP]: "run-a", url: at }]);
    const over = await opened({ url: `${at}a` });
    expect(placedProps(over.win)).toEqual([{ [PAGES_PANE_RUN_PROP]: "run-a", url: "about:blank" }]);
  });

  it("a tab and a pop-up are placed at the made pane's own address, under the same rule", async () => {
    const h = world({ kinds: [BROWSER, NOTE] });
    const win = h.window(pagesWindow);
    const { verbs, main } = room(h);
    main.next(done({}, { made: [{ surfaceId: S1, url: "https://example.org/tab", by: "tab" }] }));
    const { page } = (await verbs.call("browser_tab_new", A, { url: URL })) as { page: string };
    main.next(
      done(
        { clicked: true },
        { made: [{ surfaceId: S2, url: "https://example.org/pop", by: "popup" }] },
      ),
    );
    await verbs.call("browser_click", A, { page, ref: "@e1" });
    main.next(
      done(
        { clicked: true },
        { made: [{ surfaceId: "surface_page_000003", url: "about:srcdoc", by: "popup" }] },
      ),
    );
    await verbs.call("browser_click", A, { page, ref: "@e2" });
    expect(placedProps(win)).toEqual([
      { [PAGES_PANE_RUN_PROP]: "run-a", url: "https://example.org/tab" },
      { [PAGES_PANE_RUN_PROP]: "run-a", url: "https://example.org/pop" },
      { [PAGES_PANE_RUN_PROP]: "run-a", url: "about:blank" },
    ]);
  });

  it("the pane's manifest declares both props, its url bounded as contracts bound it", () => {
    // the pane's manifest read from its plugin folder, never copied
    const manifest = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../../plugins/browser-pane/vibefield.plugin.json"),
        "utf8",
      ),
    ) as {
      contributes: {
        objects: { type: string; props: Record<string, { kind: string; maxLength?: number }> }[];
      };
    };
    const pane = manifest.contributes.objects.find((object) => object.type === BROWSER_KIND);
    expect(pane?.props["url"]).toMatchObject({ kind: "string", maxLength: PAGES_PANE_URL_MAX });
    expect(pane?.props[PAGES_PANE_RUN_PROP]).toMatchObject({ kind: "string", maxLength: 128 });
  });
});

/** The pinned engine's reply to a navigate that launched its browser, as it came back in the first live run
 * (2026-11-24): its keys sorted, its own record of the launch beside the page's facts. */
const ENGINE_REPLY = {
  success: true,
  data: {
    lifecycle: {
      effectiveLaunch: { browserLaunched: true, engine: "chrome", launchHash: "5c1e9a07d2" },
      launched: false,
      relaunchedBrowser: false,
      restartedBackground: false,
    },
    title: "Example Domain",
    url: URL,
  },
};

describe("L2: an answer carries the page's facts, never the engine's own bookkeeping (2026-11-24)", () => {
  it("an open's answer names the page's title and address, and nothing of the engine's launch", async () => {
    const h = world({ kinds: [BROWSER] });
    h.window(pagesWindow);
    const { verbs, main } = room(h);
    main.next({ status: "done", output: ENGINE_REPLY, made: [made(S1, "open")] });
    const answer = (await verbs.call("browser_open", A, { url: URL })) as { result: unknown };
    expect(answer.result).toEqual({ title: "Example Domain", url: URL });
    expect(JSON.stringify(answer)).not.toMatch(/lifecycle|launchHash|relaunchedBrowser/);
  });

  it("a read on the page answers the same way", async () => {
    const { main, verbs, page } = await withOwnPage();
    main.next({ status: "done", output: ENGINE_REPLY });
    expect(await verbs.call("browser_get_url", A, { page })).toEqual(
      expect.objectContaining({ result: { title: "Example Domain", url: URL } }),
    );
  });
});

describe("F1, F8: what the window said of a made pane's place, and a pop-up no window took (2026-11-24)", () => {
  const DESK_FULL_WORDS =
    "The desk has no room for another live page right now. Close a page you no longer need, or carry on in this one.";
  /** A desk whose window answers every place as `place` says, and the rest as a pages window does. */
  const deskAnswering = (place: Answer | undefined, opts: { answerMs?: number } = {}) => {
    const h = world({ kinds: [BROWSER, NOTE], ...opts });
    h.window((intent) => (intent.op === "place" ? place : pagesWindow(intent)));
    return { h, ...room(h) };
  };

  it("a desk the window finds full is said as full, never as try again, and the page made for it is closed", async () => {
    const { verbs, main } = deskAnswering({ ok: false, fact: "desk-full", text: DESK_FULL_WORDS });
    main.next(done({}, { made: [made(S1, "open")] }));
    const err = (await verbs.call("browser_open", A, { url: URL }).catch((e) => e)) as RpcCallError;
    expect(factOf(err)).toBe("limit");
    expect(err.message).toBe(DESK_FULL_WORDS);
    expect(main.calls[1]).toEqual({
      run: "run-a",
      surfaceId: S1,
      window: "act",
      command: { action: "close" },
    });
  });

  it("a window that never answers the place is no answer: the page made for it was closed, and the desk is worth a look", async () => {
    const { verbs, main } = deskAnswering(undefined, { answerMs: 20 });
    main.next(done({}, { made: [made(S1, "tab")] }));
    const err = (await verbs.call("browser_tab_new", A, {}).catch((e) => e)) as RpcCallError;
    expect(err.kind).toBe("UNAVAILABLE");
    expect(stateOf(err)).toBe("no-answer");
    expect(err.message).toMatch(/closed the page/);
    expect(err.message).not.toMatch(/Try again/);
  });

  it("a refusal the window words itself reaches the model as the window said it, its fact kept", async () => {
    const text = "The user is holding the desk, so nothing was placed. Try again when they let go.";
    const { verbs, main } = deskAnswering({ ok: false, fact: "held", text });
    main.next(done({}, { made: [made(S1, "open")] }));
    const err = (await verbs.call("browser_open", A, { url: URL }).catch((e) => e)) as RpcCallError;
    expect(factOf(err)).toBe("held");
    // the window's words, and what became of the page made for the place (2026-11-24)
    expect(err.message).toBe(`${text} The browser closed the page it made for it.`);
    expect(err.retryable).toBe(true);
  });

  it("a pop-up the desk had no room for is said, as main's refused pop-ups are, and the act's answer stands", async () => {
    const h = world({ kinds: [BROWSER, NOTE] });
    let full = false;
    h.window((intent) =>
      intent.op === "place" && full
        ? { ok: false, fact: "desk-full", text: DESK_FULL_WORDS }
        : pagesWindow(intent),
    );
    const { verbs, main } = room(h);
    main.next(done({}, { made: [made(S1)] }));
    const { page } = (await verbs.call("browser_tab_new", A, {})) as { page: string };
    full = true;
    main.next(done({ clicked: true }, { made: [made(S2, "popup")] }));
    const answer = (await verbs.call("browser_click", A, { page, ref: "@e1" })) as Record<
      string,
      unknown
    >;
    expect(answer.result).toEqual({ clicked: true });
    expect(answer.said).toBe("1 pop-up from this page did not open, because the desk has no room.");
  });

  it("a pop-up no window took is said in its own words, and is no reason the room does not know", async () => {
    const events: LoggedEvents = [];
    const { main, verbs, page } = await withOwnPage({ logger: capture(events) });
    main.next(done({ clicked: true }, { capped: { noWindow: 1 } }));
    const answer = (await verbs.call("browser_click", A, { page, ref: "@e1" })) as Record<
      string,
      unknown
    >;
    expect(answer.said).toBe(
      "1 pop-up from this page did not open, because no window took its page.",
    );
    main.next(done({ clicked: true }, { capped: { runFull: 1, noWindow: 2 } }));
    const both = (await verbs.call("browser_click", A, { page, ref: "@e1" })) as Record<
      string,
      unknown
    >;
    expect(both.said).toBe(
      `3 pop-ups from this page did not open: 1 because this run holds ${PAGES_RUN_PANES_MAX} pages, 2 because no window took its page.`,
    );
    expect(events.map((e) => e.event)).not.toContain("fieldd.pages.capped_unknown");
  });
});

describe("F6: main hears every run's end, panes held or none, and a previous boot's (2026-11-24)", () => {
  /** The runs main was told had ended, in order: the run form's close, never a page's. */
  const runEnds = (main: { calls: ShellSurfacesControlParams[] }) =>
    main.calls
      .filter((c) => c.surfaceId === undefined && c.command.action === "close")
      .map((c) => c.run);

  it("a run that worked pages and holds none now still ends its browser session, at once", async () => {
    const { main, verbs, page } = await withOwnPage();
    main.next(done({}, { closed: [S1] }));
    await verbs.call("browser_tab_close", A, { page });
    main.calls.length = 0;
    verbs.runEnded("run-a");
    await vi.waitFor(() => expect(runEnds(main)).toEqual(["run-a"]));
  });

  it("a run that never reached main through the room tells main nothing", async () => {
    const h = world({ kinds: [BROWSER] });
    const { verbs, main } = room(h);
    verbs.runEnded("run-b");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(main.calls).toEqual([]);
  });

  it("a run's end main could not hear is told again when a shell registers, once it is heard no more", async () => {
    const { main, verbs } = await withOwnPage({ resumeGraceMs: 0 });
    main.next(() => {
      throw new RpcCallError("UNAVAILABLE", "no shell is registered", true);
    });
    verbs.runEnded("run-a");
    await vi.waitFor(() => expect(runEnds(main)).toEqual(["run-a"]));
    await new Promise((resolve) => setTimeout(resolve, 5));
    verbs.shellRegistered();
    await vi.waitFor(() => expect(runEnds(main)).toEqual(["run-a", "run-a"]));
    await new Promise((resolve) => setTimeout(resolve, 5));
    verbs.shellRegistered();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(runEnds(main)).toEqual(["run-a", "run-a"]);
  });

  it("the runs a previous boot's grants name pages for are read at the next boot, and each one not live at the settle is told its end once", async () => {
    const { h } = await withOwnPage();
    const next = h.reopen();
    expect(pagesRunsOf(next)).toEqual(["run-a"]);
    h.runs.set("run-a", "ended");
    const { verbs, main } = room(h, { objects: next });
    verbs.endedBefore(["run-a", "run-a", "run-x"]);
    await vi.waitFor(() => expect(runEnds(main)).toEqual(["run-a", "run-x"]));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(runEnds(main)).toEqual(["run-a", "run-x"]);
  });

  it("a previous boot's run re-attached live is told no end at the settle: its pages of that boot close one by one, and its own end later is told", async () => {
    const acts: unknown[] = [];
    const { h } = await withOwnPage();
    // fieldd restarted while main and the run's process stayed up: the re-attach is the same run, under the same id
    const next = h.reopen({ vouched: ["run-a"] });
    next.reconcile();
    const { verbs, main } = room(h, {
      objects: next,
      audited: async (act, send) => {
        acts.push(act);
        return send();
      },
    });
    main.next(done({ tabs: [{ surfaceId: S1, url: URL, title: "Page" }], current: S1 }));
    verbs.endedBefore(["run-a"]);
    await vi.waitFor(() => expect(main.calls).toHaveLength(2));
    expect(main.calls).toEqual([
      { run: "run-a", window: "read", command: { action: "tab_list" } },
      { run: "run-a", surfaceId: S1, window: "act", command: { action: "close" } },
    ]);
    expect(runEnds(main)).toEqual([]);
    verbs.runEnded("run-a");
    await vi.waitFor(() => expect(runEnds(main)).toEqual(["run-a"]));
    expect(acts).toEqual([
      { action: "pages.run.free", run: "run-a", attrs: { why: "boot", panes: 1 } },
      { action: "pages.run.close", run: "run-a", attrs: { why: "run-end", panes: 0 } },
    ]);
  });

  it("a live run that reached main through this room before the settle is neither ended nor swept", async () => {
    const { main, verbs } = await withOwnPage();
    verbs.endedBefore(["run-a"]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(main.calls).toEqual([]);
  });

  it("a previous boot's end main did not hear is not told again once its run is live, and its own end is", async () => {
    const h = world({ kinds: [BROWSER] });
    const { verbs, main } = room(h);
    main.next(() => {
      throw new RpcCallError("UNAVAILABLE", "no shell is registered", true);
    });
    verbs.endedBefore(["run-x"]);
    await vi.waitFor(() => expect(runEnds(main)).toEqual(["run-x"]));
    await new Promise((resolve) => setTimeout(resolve, 5));
    h.runs.set("run-x", "live");
    verbs.shellRegistered();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(runEnds(main)).toEqual(["run-x"]);
    verbs.runEnded("run-x");
    await vi.waitFor(() => expect(runEnds(main)).toEqual(["run-x", "run-x"]));
  });

  it("past the most runs one start tells, the rest are cut and the cut is logged", async () => {
    const events: LoggedEvents = [];
    const h = world({ kinds: [BROWSER] });
    const { verbs, main } = room(h, { logger: capture(events) });
    verbs.endedBefore(Array.from({ length: PAGES_BOOT_ENDS_MAX + 3 }, (_, i) => `run-x${i}`));
    await vi.waitFor(() => expect(runEnds(main)).toHaveLength(PAGES_BOOT_ENDS_MAX));
    expect(events).toContainEqual({
      event: "fieldd.pages.boot_ends_cut",
      attrs: { runs: PAGES_BOOT_ENDS_MAX + 3, told: PAGES_BOOT_ENDS_MAX },
    });
  });

  it("the ends owed are bounded: past the most, the oldest is let go, and that is logged", async () => {
    const events: LoggedEvents = [];
    const h = world({ kinds: [BROWSER] });
    let refusing = true;
    const { verbs, main } = room(h, {
      logger: capture(events),
      control: async (params) => {
        main.calls.push(params);
        if (refusing) throw new RpcCallError("UNAVAILABLE", "no shell is registered", true);
        return done();
      },
    });
    const batch = (from: number) =>
      Array.from({ length: PAGES_BOOT_ENDS_MAX }, (_, i) => `run-x${from + i}`);
    for (let from = 0; from <= PAGES_OWED_ENDS_MAX; from += PAGES_BOOT_ENDS_MAX)
      verbs.endedBefore(batch(from));
    const sent = Math.ceil((PAGES_OWED_ENDS_MAX + 1) / PAGES_BOOT_ENDS_MAX) * PAGES_BOOT_ENDS_MAX;
    await vi.waitFor(() => expect(runEnds(main)).toHaveLength(sent));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(events.filter((e) => e.event === "fieldd.pages.owed_end_dropped")).toHaveLength(
      sent - PAGES_OWED_ENDS_MAX,
    );
    refusing = false;
    main.calls.length = 0;
    verbs.shellRegistered();
    await vi.waitFor(() => expect(runEnds(main)).toHaveLength(PAGES_OWED_ENDS_MAX));
    expect(runEnds(main)).not.toContain("run-x0");
  });
});

describe("el7 F6: the room's own acts on a run's browser are each an audit line (2026-11-24)", () => {
  it("a resume's rebind, a run's end and a previous boot's end are each written with the run and a count, never a page", async () => {
    const acts: unknown[] = [];
    const { h, main, verbs } = await withOwnPage({
      resumeGraceMs: 0,
      audited: async (act, send) => {
        acts.push(act);
        return send();
      },
    });
    h.runs.set("run-c", "live");
    verbs.runReplaced("run-a", "run-c");
    verbs.runEnded("run-c");
    verbs.endedBefore(["run-x"]);
    await vi.waitFor(() => expect(acts).toHaveLength(3));
    expect(acts).toEqual([
      { action: "pages.run.rebind", run: "run-c", attrs: { from: "run-a", panes: 1 } },
      { action: "pages.run.close", run: "run-x", attrs: { why: "boot", panes: 0 } },
      { action: "pages.run.close", run: "run-c", attrs: { why: "run-end", panes: 1 } },
    ]);
    expect(JSON.stringify(acts)).not.toMatch(/surface_|example\.com/);
    await vi.waitFor(() => expect(main.calls).toHaveLength(3));
  });

  it("an act whose line could not be written is not sent to main", async () => {
    const { main, verbs } = await withOwnPage({
      resumeGraceMs: 0,
      audited: async () => {
        throw new Error("the audit is full");
      },
    });
    verbs.runEnded("run-a");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(main.calls).toEqual([]);
  });

  it("a rebind whose line could not be written is not sent, and main is told the replaced run's end instead", async () => {
    const acts: unknown[] = [];
    const { h, main, verbs } = await withOwnPage({
      audited: async (act, send) => {
        if (act.action === "pages.run.rebind") throw new Error("the audit is full");
        acts.push(act);
        return send();
      },
    });
    h.runs.set("run-c", "live");
    verbs.runReplaced("run-a", "run-c");
    await vi.waitFor(() =>
      expect(main.calls).toEqual([{ run: "run-a", window: "act", command: { action: "close" } }]),
    );
    expect(acts).toEqual([
      { action: "pages.run.close", run: "run-a", attrs: { why: "run-end", panes: 1 } },
    ]);
  });
});

// A run's pane after its run (2026-11-24) — A RUN'S PANE WHEN ITS RUN IS GONE AND THE APP COMES BACK. The pane's object is
// the window's and stands on the desk across a restart, naming its run in the prop VibeField set; fieldd binds a made
// pane in memory alone, and main holds a run's pages in memory alone. So after a restart nothing can answer a mint into
// that run's session with a page: the grant the room gave at the place is ended at the settle, the room places nothing
// for its surface, and a resume after the restart has nothing of it to carry. `serves` is the room's word for that,
// which `surface.open` asks before it forwards a mint into a run's session.
describe("a run's pane after its run: whether the run can still be served a page, asked at each mint into its session (2026-11-24)", () => {
  it("START CLEAN: a previous boot's run that is not live holds nothing after the settle, and serves no page", async () => {
    const { h, page } = await withOwnPage();
    // the app stopped and started: fieldd is new, and the run was not brought back
    const next = h.reopen();
    h.runs.set("run-a", "ended");
    const { verbs, main } = room(h, { objects: next });
    // before the settle nothing is judged: a re-attached run may not read live yet
    expect(verbs.serves("run-a")).toBe(true);
    next.reconcile();
    verbs.endedBefore(pagesRunsOf(next));
    // what is left of the pane in fieldd: its name alone. No grant, no placed surface, no page for its run
    expect(next.grantOf(page as never, "run-a")).toBeUndefined();
    expect(next.registry.get(page as never)).toEqual(
      expect.objectContaining({ key: `k-${S1}`, kind: BROWSER_KIND }),
    );
    expect(verbs.placed(S1)).toBe(false);
    expect(verbs.serves("run-a")).toBe(false);
    // a live run is served, pages or none: main decides its mint by the key
    expect(verbs.serves("run-b")).toBe(true);
    // a run this fieldd has never heard of (an older build's pane, another device's) is served none here either
    expect(verbs.serves("run-never-here")).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(main.calls.filter((c) => c.command.action === "rebind")).toEqual([]);
  });

  it("RESTORE after a restart: the run comes back under a new id with nothing of the old boot's to carry; the old id serves no page", async () => {
    const { h } = await withOwnPage();
    const next = h.reopen();
    h.runs.set("run-a", "ended");
    const { verbs, main } = room(h, { objects: next });
    next.reconcile();
    verbs.endedBefore(pagesRunsOf(next));
    // the person's Restore: the session is resumed as a new run, and the runtime names it the old one's successor
    h.runs.set("run-c", "live");
    next.runReplaced("run-a", "run-c");
    verbs.runReplaced("run-a", "run-c");
    await new Promise((resolve) => setTimeout(resolve, 5));
    // main is told no rebind: this fieldd bound none of the old run's pages
    expect(main.calls.filter((c) => c.command.action === "rebind")).toEqual([]);
    expect(verbs.placed(S1)).toBe(false);
    expect(verbs.serves("run-a")).toBe(false);
    expect(verbs.serves("run-c")).toBe(true);
  });

  it("within one boot, an ended run is served through the resume's grace, and none once it has lapsed", async () => {
    const { h, verbs } = await withOwnPage({ resumeGraceMs: 20 });
    verbs.endedBefore([]);
    expect(verbs.serves("run-a")).toBe(true);
    h.runs.set("run-a", "ended");
    verbs.runEnded("run-a");
    // a covered desk's first mint in the grace is the page a resume would carry on
    expect(verbs.serves("run-a")).toBe(true);
    await vi.waitFor(() => expect(verbs.serves("run-a")).toBe(false));
  });

  it("a resume that carried the pages on serves the old id as its successor's: the pane still names the run that placed it", async () => {
    const { h, verbs, page } = await withOwnPage({ resumeGraceMs: 20 });
    verbs.endedBefore([]);
    h.runs.set("run-c", "live");
    h.runs.set("run-a", "ended");
    verbs.runEnded("run-a");
    h.desk.grant(page as never, "run-c", "placed");
    verbs.runReplaced("run-a", "run-c");
    await new Promise((resolve) => setTimeout(resolve, 40));
    // past the old run's grace: main keeps both names on the one record, so the old id is served while its successor is
    expect(verbs.serves("run-a")).toBe(true);
    h.runs.set("run-c", "ended");
    verbs.runEnded("run-c");
    await vi.waitFor(() => expect(verbs.serves("run-a")).toBe(false));
    expect(verbs.serves("run-c")).toBe(false);
  });

  it("a mint that comes before the boot's settle waits for it, and is judged then: never forwarded unjudged while the settle is on its way", async () => {
    const { h } = await withOwnPage();
    const next = h.reopen({ vouched: ["run-b"] });
    h.runs.set("run-a", "ended");
    h.runs.set("run-b", "ended");
    const { verbs } = room(h, { objects: next, settleWaitMs: 2_000 });
    // the window's desk asks for its panes' pages as the app starts, before the re-attach has settled
    let gone: boolean | undefined;
    let back: boolean | undefined;
    void verbs.servesOnceSettled("run-a").then((served) => {
      gone = served;
    });
    void verbs.servesOnceSettled("run-b").then((served) => {
      back = served;
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect([gone, back]).toEqual([undefined, undefined]);
    // the re-attach brings run-b back, and settles
    h.runs.set("run-b", "live");
    next.reconcile();
    verbs.endedBefore(pagesRunsOf(next));
    await vi.waitFor(() => expect([gone, back]).toEqual([false, true]));
    // settled, the answer is at once
    expect(await verbs.servesOnceSettled("run-a")).toBe(false);
  });

  it("a run that reads live before the settle is answered at once; a settle that does not come within the wait leaves the mint unjudged", async () => {
    const { h } = await withOwnPage();
    const next = h.reopen();
    h.runs.set("run-a", "ended");
    const { verbs } = room(h, { objects: next, settleWaitMs: 10 });
    expect(await verbs.servesOnceSettled("run-b")).toBe(true);
    // no settle: past the wait the mint is forwarded as it was before this word existed, and main's answer stands
    expect(await verbs.servesOnceSettled("run-a")).toBe(true);
  });

  it("a run that ended holding no page serves none at once: no resume has a page of it to carry", async () => {
    const { h, main, verbs, page } = await withOwnPage();
    verbs.endedBefore([]);
    main.next(done({}, { closed: [S1] }));
    await verbs.call("browser_tab_close", A, { page });
    h.runs.set("run-a", "ended");
    verbs.runEnded("run-a");
    expect(verbs.serves("run-a")).toBe(false);
  });
});
