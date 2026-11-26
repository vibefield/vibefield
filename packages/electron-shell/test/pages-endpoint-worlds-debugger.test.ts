// EY-1 (2026-11-24) — the Debugger domain inside a client's worlds (BU-23). A script belongs to the context it was
// parsed in, and a client's debugger hears every script of the page: the page's own, the owner's words world's and
// every other client's isolated worlds'. So the filter that keeps a client to its own contexts keeps it to their
// scripts too: a script of a world it was not given is not said, cannot be read, edited or stopped in, and a pause
// in one is never the client's (the bridge lets the page run on). The worlds' own rows first, then the wall's.
import { describe, expect, it } from "vitest";
import type { CdpCall, CdpEvent, CleanedEvent } from "../src/main/pages/core/types";
import { clientWorlds } from "../src/main/pages/endpoint/worlds";
import { client, type PageAnswer, refusedAs, wall } from "./pages-wall-kit";

const S = "S-page";
const call = (method: string, params: Record<string, unknown> = {}): CdpCall => ({
  method,
  params,
});
const DEFAULT = { isDefault: true, type: "default", frameId: "F" };
const ISOLATED = { isDefault: false, type: "isolated", frameId: "F" };
const context = (id: number, name: string, auxData?: Record<string, unknown>): CdpEvent => ({
  method: "Runtime.executionContextCreated",
  params: {
    context: {
      id,
      origin: "https://a.test",
      name,
      uniqueId: `u-${id}`,
      ...(auxData ? { auxData } : {}),
    },
  },
});
const parsed = (
  scriptId: string,
  executionContextId: number,
  executionContextAuxData?: Record<string, unknown>,
  url = "",
): CdpEvent => ({
  method: "Debugger.scriptParsed",
  params: {
    scriptId,
    url,
    executionContextId,
    ...(executionContextAuxData ? { executionContextAuxData } : {}),
  },
});
const paused = (
  ...frames: readonly (readonly [callFrameId: string, scriptId: string])[]
): CdpEvent => ({
  method: "Debugger.paused",
  params: {
    reason: "other",
    callFrames: frames.map(([callFrameId, scriptId]) => ({
      callFrameId,
      functionName: "",
      location: { scriptId, lineNumber: 0 },
    })),
  },
});
const forwarded = (r: CleanedEvent): boolean => r.action === "forward";
const verdictOf = (r: { readonly verdict: { readonly ok: boolean; readonly code?: string } }) =>
  r.verdict.ok ? "ok" : r.verdict.code;

/** A client with the page's own world (context 1, script 10), a world of its own (context 2, script 20), the owner's
 * words world (context 3, script 30) and another client's world (context 4, script 40) on the page. */
function worlds() {
  const w = clientWorlds(3);
  w.event(S, context(1, "", DEFAULT));
  w.event(S, context(2, "__vfc3__utility", ISOLATED));
  w.event(S, context(3, "__vibefield_words", ISOLATED));
  w.event(S, context(4, "__vfc9__utility", ISOLATED));
  return w;
}

describe("a client's debugger keeps to the scripts of its own worlds (BU-23; EY-1, 2026-11-24)", () => {
  it("hears a script of the page's own world and of its own world, and none of the owner's or another client's", () => {
    const w = worlds();
    expect(forwarded(w.event(S, parsed("10", 1, DEFAULT, "https://a.test/app.js")))).toBe(true);
    expect(forwarded(w.event(S, parsed("20", 2, ISOLATED)))).toBe(true);
    expect(w.event(S, parsed("30", 3, ISOLATED))).toEqual({
      action: "drop",
      reason: "not-the-clients",
    });
    expect(forwarded(w.event(S, parsed("40", 4, ISOLATED)))).toBe(false);
    const failed: CdpEvent = {
      method: "Debugger.scriptFailedToParse",
      params: { scriptId: "31", url: "", executionContextId: 3, executionContextAuxData: ISOLATED },
    };
    expect(forwarded(w.event(S, failed))).toBe(false);
    // a worker's script carries no world mark: it is the session's own
    expect(forwarded(w.event("S-worker", parsed("7", 1)))).toBe(true);
  });

  it("hears a page-world script with Runtime never enabled: the script's own mark says whose world it is", () => {
    const w = clientWorlds(3);
    expect(forwarded(w.event(S, parsed("10", 1, DEFAULT)))).toBe(true);
    expect(forwarded(w.event(S, parsed("30", 3, ISOLATED)))).toBe(false);
    expect(verdictOf(w.command(S, call("Debugger.getScriptSource", { scriptId: "10" })))).toBe(
      "ok",
    );
  });

  it.each([
    ["Debugger.getScriptSource", (scriptId: string) => ({ scriptId })],
    ["Debugger.setScriptSource", (scriptId: string) => ({ scriptId, scriptSource: "1" })],
    [
      "Debugger.setBreakpoint",
      (scriptId: string) => ({ location: { scriptId, lineNumber: 0 }, condition: "1" }),
    ],
  ] as const)("%s names only a script the client was told of", (method, params) => {
    const w = worlds();
    w.event(S, parsed("10", 1, DEFAULT));
    w.event(S, parsed("20", 2, ISOLATED));
    w.event(S, parsed("30", 3, ISOLATED));
    expect(verdictOf(w.command(S, call(method, params("10"))))).toBe("ok");
    expect(verdictOf(w.command(S, call(method, params("20"))))).toBe("ok");
    // the owner's, one never said (a guessed id), one of another session, and none at all
    expect(verdictOf(w.command(S, call(method, params("30"))))).toBe("forbidden");
    expect(verdictOf(w.command(S, call(method, params("31"))))).toBe("forbidden");
    expect(verdictOf(w.command("S-other", call(method, params("10"))))).toBe("forbidden");
    expect(verdictOf(w.command(S, call(method, {})))).toBe("forbidden");
  });

  it("a breakpoint by address names one exact address: no pattern and no hash, which would match a script of any world", () => {
    const w = worlds();
    const at = (params: Record<string, unknown>) =>
      verdictOf(w.command(S, call("Debugger.setBreakpointByUrl", { lineNumber: 0, ...params })));
    expect(at({ url: "https://a.test/app.js" })).toBe("ok");
    expect(at({ url: "https://a.test/app.js", condition: "1" })).toBe("ok");
    expect(at({ urlRegex: ".*" })).toBe("forbidden");
    expect(at({ url: "https://a.test/app.js", urlRegex: ".*" })).toBe("forbidden");
    expect(at({ scriptHash: "abc" })).toBe("forbidden");
    // the owner's scripts carry no address: an empty one would name them
    expect(at({ url: "" })).toBe("forbidden");
    expect(at({})).toBe("forbidden");
  });

  it("a pause is the client's only when every frame of it is in a script of its own; one that is not is marked for the bridge to run on", () => {
    const w = worlds();
    w.event(S, parsed("10", 1, DEFAULT));
    w.event(S, parsed("20", 2, ISOLATED));
    w.event(S, parsed("30", 3, ISOLATED));
    expect(forwarded(w.event(S, paused(["f-1", "10"], ["f-2", "20"])))).toBe(true);
    expect(w.event(S, paused(["f-3", "30"]))).toEqual({ action: "drop", reason: "foreign-pause" });
    // the owner's listener on top of the page's own caller
    expect(w.event(S, paused(["f-4", "30"], ["f-5", "10"]))).toEqual({
      action: "drop",
      reason: "foreign-pause",
    });
    expect(w.event(S, paused(["f-6", "10"], ["f-7", "30"]))).toEqual({
      action: "drop",
      reason: "foreign-pause",
    });
  });

  it("evaluates only on a call frame of the pause it was last told of", () => {
    const w = worlds();
    w.event(S, parsed("10", 1, DEFAULT));
    w.event(S, parsed("30", 3, ISOLATED));
    const on = (callFrameId: unknown) =>
      verdictOf(
        w.command(S, call("Debugger.evaluateOnCallFrame", { callFrameId, expression: "1" })),
      );
    expect(on("f-1")).toBe("forbidden");
    w.event(S, paused(["f-1", "10"]));
    expect(on("f-1")).toBe("ok");
    expect(on("f-9")).toBe("forbidden");
    expect(on(undefined)).toBe("forbidden");
    // a pause in the owner's script names frames the client never gets
    w.event(S, { method: "Debugger.resumed", params: {} });
    expect(on("f-1")).toBe("forbidden");
    w.event(S, paused(["f-3", "30"]));
    expect(on("f-3")).toBe("forbidden");
  });

  it("drops a breakpoint's resolution in a script that is not the client's, and forgets a session's scripts with the session", () => {
    const w = worlds();
    w.event(S, parsed("10", 1, DEFAULT));
    w.event(S, parsed("30", 3, ISOLATED));
    const resolved = (scriptId: string): CdpEvent => ({
      method: "Debugger.breakpointResolved",
      params: { breakpointId: "bp-1", location: { scriptId, lineNumber: 0 } },
    });
    expect(forwarded(w.event(S, resolved("10")))).toBe(true);
    expect(forwarded(w.event(S, resolved("30")))).toBe(false);
    w.sessionEnded(S);
    expect(verdictOf(w.command(S, call("Debugger.getScriptSource", { scriptId: "10" })))).toBe(
      "forbidden",
    );
  });
});

describe("the Debugger domain at the wall, on the agent's own page (BU-23; EY-1, 2026-11-24)", () => {
  /** The page's own script (10) and the owner's words script (30), said on the client's session. */
  async function debugged(answer?: PageAnswer) {
    const w = wall(answer === undefined ? {} : { answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    w.open("act");
    await c.call("Debugger.enable", {}, s);
    w.session().emit(parsed("10", 1, DEFAULT, "https://a.test/app.js"));
    w.session().emit(parsed("30", 3, ISOLATED));
    return { w, c, s };
  }

  it("the client hears its page's script and not the owner's, and can neither read, edit nor stop in the owner's", async () => {
    const { w, c, s } = await debugged((method) =>
      method === "Debugger.getScriptSource" ? { scriptSource: "SENTINEL-OWNER-SOURCE" } : {},
    );
    const said = c.frames.filter((f) => f.method === "Debugger.scriptParsed");
    expect(said.map((f) => f.params?.scriptId)).toEqual(["10"]);
    refusedAs(
      (await c.call("Debugger.getScriptSource", { scriptId: "30" }, s)).answer,
      "forbidden",
    );
    refusedAs(
      (await c.call("Debugger.setScriptSource", { scriptId: "30", scriptSource: "1" }, s)).answer,
      "forbidden",
    );
    refusedAs(
      (await c.call("Debugger.setBreakpoint", { location: { scriptId: "30", lineNumber: 0 } }, s))
        .answer,
      "forbidden",
    );
    refusedAs(
      (await c.call("Debugger.setBreakpointByUrl", { lineNumber: 0, urlRegex: ".*" }, s)).answer,
      "forbidden",
    );
    expect(w.session().sent.map((m) => m.method)).toEqual(["Debugger.enable"]);
    expect(JSON.stringify(c.frames)).not.toContain("SENTINEL-OWNER-SOURCE");
    // its own page's script is still its to read
    expect((await c.call("Debugger.getScriptSource", { scriptId: "10" }, s)).answer?.error).toBe(
      undefined,
    );
  });

  it("a pause in the owner's script is not said to the client, and the bridge lets the page run on at once", async () => {
    const { w, c, s } = await debugged();
    const before = c.frames.length;
    w.session().emit(paused(["f-3", "30"]));
    expect(c.frames.slice(before)).toEqual([]);
    expect(w.session().sent.at(-1)).toEqual({ method: "Debugger.resume", params: {} });
    refusedAs(
      (await c.call("Debugger.evaluateOnCallFrame", { callFrameId: "f-3", expression: "1" }, s))
        .answer,
      "forbidden",
    );
    // a pause in the client's own script is said, and nothing is resumed for it
    const sent = w.session().sent.length;
    w.session().emit(paused(["f-1", "10"]));
    expect(c.frames.at(-1)?.method).toBe("Debugger.paused");
    expect(w.session().sent).toHaveLength(sent);
    const evaluated = await c.call(
      "Debugger.evaluateOnCallFrame",
      { callFrameId: "f-1", expression: "1" },
      s,
    );
    expect(evaluated.answer?.error).toBeUndefined();
  });
});
