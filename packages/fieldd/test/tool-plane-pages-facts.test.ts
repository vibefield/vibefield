import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAGES_NEEDS, PAGES_UNAVAILABLE_STATES, TOOL_FACTS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { RpcCallError } from "../src/native-link";
import {
  controlFailure,
  engineData,
  engineFailure,
  pageRefusal,
  runFull,
} from "../src/tool-plane/rooms/pages/facts";

// EY-2 (2b, 2026-11-19) — what main and the engine answered, as the facts a model acts on. Main's refusals keep their
// word; the engine's own failures inside a `done` are read by their code and their words; a timeout on an act is no
// answer, never a failure (the act may have happened), and on a read a page still loading.

const detailsOf = (err: unknown) => (err as RpcCallError).details as Record<string, unknown>;

describe("EY-2: main's refusals, in words that say what to do next", () => {
  it("each refusal fact main may name keeps its word, one of TOOL_FACTS, and those worth another try say so", () => {
    const retry: Record<string, boolean> = {
      held: true,
      gone: false,
      parked: true,
      "stale-ref": false,
      loading: true,
      "off-site": false,
    };
    for (const [fact, retryable] of Object.entries(retry)) {
      const err = pageRefusal(fact as never);
      expect(err.kind).toBe("PRECONDITION_FAILED");
      expect(detailsOf(err).fact).toBe(fact);
      expect((TOOL_FACTS as readonly string[]).includes(fact)).toBe(true);
      expect(err.retryable).toBe(retryable);
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  it("needs-you carries what the person is needed for, and says it", () => {
    for (const need of PAGES_NEEDS) {
      const err = pageRefusal("needs-you", need);
      expect(detailsOf(err)).toEqual({ fact: "needs-you", need });
      expect(err.message).toMatch(/needs the user/);
    }
  });
});

describe("EY-2: the engine's own answer inside main's done", () => {
  it("a success is no failure, and its envelope comes off", () => {
    const ok = { success: true, data: { url: "https://example.com/" } };
    expect(engineFailure(ok, false)).toBeUndefined();
    expect(engineData(ok)).toEqual({ url: "https://example.com/" });
    // an answer with no envelope is answered as it came
    expect(engineData({ title: "x" })).toEqual({ title: "x" });
    expect(engineData(null)).toBeNull();
  });

  it("a bound tab gone is gone; a wedged page is loading", () => {
    expect(
      detailsOf(engineFailure({ success: false, error: "tab gone: x", code: "tab_gone" }, false))
        .fact,
    ).toBe("gone");
    expect(
      detailsOf(engineFailure({ success: false, error: "wedged", code: "page_wedged" }, false))
        .fact,
    ).toBe("loading");
  });

  it("a part the page no longer has is a stale ref, on a row that names one", () => {
    for (const error of [
      "Unknown ref: e7",
      "Element ref e7 is stale",
      "Element not found in the selected frame: #x",
    ]) {
      expect(detailsOf(engineFailure({ success: false, error }, true)).fact).toBe("stale-ref");
      // on a row with no part, the same words are the engine's failure
      expect(detailsOf(engineFailure({ success: false, error }, false)).fact).toBe("failed");
    }
  });

  it("any other failure is failed, with the engine's words cut to a line", () => {
    const long = "x".repeat(1_000);
    const err = engineFailure({ success: false, error: long }, false) as RpcCallError;
    expect(detailsOf(err).fact).toBe("failed");
    expect(err.message.length).toBeLessThan(400);
    expect(detailsOf(engineFailure({ success: false }, false)).fact).toBe("failed");
  });
});

describe("EY-2: a control call that failed", () => {
  it("a timeout on an act is no answer, never a failure: the act may have happened", () => {
    const err = controlFailure(new RpcCallError("TIMEOUT", "deadline"), "act") as RpcCallError;
    expect(err.kind).toBe("UNAVAILABLE");
    expect(err.retryable).toBe(true);
    expect(detailsOf(err)).toEqual({ service: "pages", state: "no-answer" });
    expect(err.message).toMatch(/cannot tell whether this happened/);
  });

  it("a timeout on a read is a page still loading", () => {
    const err = controlFailure(new RpcCallError("TIMEOUT", "deadline"), "read") as RpcCallError;
    expect(detailsOf(err).fact).toBe("loading");
  });

  it("each of the pages states keeps its state, in the room's words", () => {
    for (const state of PAGES_UNAVAILABLE_STATES) {
      const err = controlFailure(
        new RpcCallError("UNAVAILABLE", "x", false, { service: "pages", state }),
        "read",
      ) as RpcCallError;
      expect(err.kind).toBe("UNAVAILABLE");
      expect(detailsOf(err)).toEqual({ service: "pages", state });
      expect(err.message).not.toBe("x");
    }
  });

  it("main's bare UNAVAILABLE (no broker yet) is the engine stopped; another service's passes as it came", () => {
    const bare = controlFailure(new RpcCallError("UNAVAILABLE", "x"), "act") as RpcCallError;
    expect(detailsOf(bare)).toEqual({ service: "pages", state: "engine-stopped" });
    const other = new RpcCallError("UNAVAILABLE", "x", false, {
      service: "desk",
      state: "no-window",
    });
    expect(controlFailure(other, "act")).toBe(other);
    const odd = new Error("not an rpc error");
    expect(controlFailure(odd, "act")).toBe(odd);
  });
});

describe("EY-1 x EY-2: the state main's provider gave, as the room says it", () => {
  /** main's pages UNAVAILABLE as its provider sends it (EL9: the contracts fixture both sides parse), as fieldd's shell
   * provider hands it on: an RpcCallError carrying the outcome's details. */
  const provided = () => {
    const { error } = JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          "../../contracts/fixtures/shell-provider-outcome.pages-unavailable.json",
        ),
        "utf8",
      ),
    ) as { error: { kind: "UNAVAILABLE"; message: string; retryable: boolean; details: unknown } };
    return new RpcCallError(error.kind, error.message, error.retryable, error.details);
  };

  it("not installed is said as not installed, never as stopped, and another try is not offered", () => {
    expect(provided().details).toEqual({ service: "pages", state: "not-installed" });
    for (const window of ["read", "act"] as const) {
      const err = controlFailure(provided(), window) as RpcCallError;
      expect(err.kind).toBe("UNAVAILABLE");
      expect(detailsOf(err)).toEqual({ service: "pages", state: "not-installed" });
      expect(err.retryable).toBe(false);
      expect(err.message).toMatch(/browser engine is not installed/);
      expect(err.message).not.toMatch(/stopped/);
    }
  });

  it("each engine state main gives is said as its own, never another's", () => {
    const said = new Map<string, string>();
    for (const state of [
      "engine-starting",
      "engine-stopped",
      "engine-refused",
      "not-installed",
    ] as const) {
      const err = controlFailure(
        new RpcCallError("UNAVAILABLE", "the live-surface authority is unavailable", true, {
          service: "pages",
          state,
        }),
        "act",
      ) as RpcCallError;
      expect(detailsOf(err)).toEqual({ service: "pages", state });
      said.set(state, err.message);
    }
    expect(new Set(said.values()).size).toBe(4);
  });

  it("a provider that gives no details is still read as the engine stopped", () => {
    const err = controlFailure(
      new RpcCallError("UNAVAILABLE", "the live-surface authority is unavailable", true),
      "read",
    ) as RpcCallError;
    expect(detailsOf(err)).toEqual({ service: "pages", state: "engine-stopped" });
    expect(err.retryable).toBe(true);
  });
});

describe("L2: the engine's own record of its launch never reaches the model (2026-11-24)", () => {
  const LIFECYCLE = {
    effectiveLaunch: { browserLaunched: true, engine: "chrome", launchHash: "5c1e9a07d2" },
    launched: false,
    relaunchedBrowser: false,
    restartedBackground: false,
  };

  it("inside the engine's data, its lifecycle comes off and the page's facts stay", () => {
    expect(
      engineData({
        success: true,
        data: { lifecycle: LIFECYCLE, title: "Example Domain", url: "https://example.com/" },
      }),
    ).toEqual({ title: "Example Domain", url: "https://example.com/" });
  });

  it("beside the envelope, or on an answer with no data, it comes off too", () => {
    expect(
      engineData({ success: true, lifecycle: LIFECYCLE, data: { url: "https://example.com/" } }),
    ).toEqual({ url: "https://example.com/" });
    expect(engineData({ success: true, lifecycle: LIFECYCLE })).toEqual({ success: true });
    expect(engineData({ lifecycle: LIFECYCLE, title: "x" })).toEqual({ title: "x" });
  });

  it("a page's own value is never touched: data that is no record, and a dialog's warning, stay", () => {
    expect(engineData({ success: true, data: "lifecycle" })).toBe("lifecycle");
    expect(engineData({ success: true, data: [1, 2] })).toEqual([1, 2]);
    expect(
      engineData({ success: true, data: { url: "u", warning: "alert: hi", lifecycle: LIFECYCLE } }),
    ).toEqual({ url: "u", warning: "alert: hi" });
  });
});

describe("F2: main's RESOURCE_EXHAUSTED as what it is, in the room's words (2026-11-24)", () => {
  /** As fieldd's shell provider hands it on today: the preview's words, with the broker's state when main says one. */
  const exhausted = (state?: string) =>
    new RpcCallError(
      "RESOURCE_EXHAUSTED",
      "the preview could not fit within the image budget",
      false,
      state === undefined ? undefined : { service: "pages", state },
    );

  it("the desk's room and the run's count are their limits, each in its own words", () => {
    const desk = controlFailure(exhausted("desk-full"), "act") as RpcCallError;
    expect(detailsOf(desk).fact).toBe("limit");
    expect(desk.message).toMatch(/^The desk has no room for another live page right now\./);
    const run = controlFailure(exhausted("run-full"), "act") as RpcCallError;
    expect(detailsOf(run).fact).toBe("limit");
    expect(run.message).toMatch(/^This run already holds \d+ pages, the most it may\./);
  });

  it("an answer past what one call carries says to ask for less, never the preview's words", () => {
    for (const err of [exhausted("output-too-large"), exhausted()]) {
      const said = controlFailure(err, "read") as RpcCallError;
      expect(detailsOf(said).fact).toBe("limit");
      expect(said.message).toMatch(/Ask for less/);
      expect(said.message).not.toMatch(/preview|image budget/);
    }
  });

  // EL9 (2026-11-24): main's provider now sends the broker's word for a pages call with no room; the fixture both
  // sides parse (main's row reads the same file)
  it("main's run-full, as its provider sends it, is said by the room's own words, whatever the call", () => {
    const { error } = JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          "../../contracts/fixtures/shell-provider-outcome.pages-exhausted.json",
        ),
        "utf8",
      ),
    ) as {
      error: { kind: "RESOURCE_EXHAUSTED"; message: string; retryable: boolean; details: unknown };
    };
    for (const making of [true, false]) {
      const err = controlFailure(
        new RpcCallError(error.kind, error.message, error.retryable, error.details),
        "act",
        making,
      ) as RpcCallError;
      expect(err.message).toBe(runFull().message);
    }
  });

  it("a bare one on a call that makes a page is no room for another page", () => {
    const said = controlFailure(exhausted(), "act", true) as RpcCallError;
    expect(detailsOf(said).fact).toBe("limit");
    expect(said.message).toMatch(/no room for another page/);
    expect(said.message).not.toMatch(/preview|image budget/);
  });
});

describe("F5: a page the desk put to rest, said as the person's to wake (2026-11-24)", () => {
  it("parked says the page wakes when the user looks at it, never only to try again in a moment", () => {
    const err = pageRefusal("parked");
    expect(err.message).not.toMatch(/Try again in a moment/);
    expect(err.message).toMatch(/wakes when the user looks at it/);
    expect(err.retryable).toBe(true);
  });

  it("gone says a page woken from its rest answers once more, then is gone for good", () => {
    expect(pageRefusal("gone").message).toMatch(/Try it once more/);
  });
});
