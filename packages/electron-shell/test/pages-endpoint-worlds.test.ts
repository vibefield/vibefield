// EY-1 (2026-11-19) — a client's worlds (BU-23): a client gets the page's own contexts and only the isolated worlds it
// made; its world names are made its own on the way in and given back on the way out; a context it was not given is
// refused, and its events dropped.
import { describe, expect, it } from "vitest";
import type { CdpCall, CdpEvent, CleanedEvent } from "../src/main/pages/core/types";
import { clientWorlds } from "../src/main/pages/endpoint/worlds";

const S = "S-page";
const call = (method: string, params: Record<string, unknown> = {}): CdpCall => ({
  method,
  params,
});
const created = (
  id: number,
  name: string,
  kind: "default" | "isolated" | "worker",
  uniqueId = `u-${id}`,
): CdpEvent => ({
  method: "Runtime.executionContextCreated",
  params: {
    context: {
      id,
      origin: "https://a.test",
      name,
      uniqueId,
      ...(kind === "worker"
        ? {}
        : {
            auxData:
              kind === "default"
                ? { isDefault: true, type: "default", frameId: "F" }
                : { isDefault: false, type: "isolated", frameId: "F" },
          }),
    },
  },
});
/** what reached the client: the context's name, or null when the event was dropped */
const nameOut = (r: CleanedEvent): string | null =>
  r.action === "forward"
    ? String((r.event.params["context"] as { readonly name?: unknown } | undefined)?.name)
    : null;
const forwarded = (r: CleanedEvent): boolean => r.action === "forward";
/** the command's verdict: "ok", or its refusal's code */
const verdictOf = (r: { readonly verdict: { readonly ok: boolean; readonly code?: string } }) =>
  r.verdict.ok ? "ok" : r.verdict.code;

describe("a client's worlds (BU-23)", () => {
  it("createIsolatedWorld's name, an empty one included, is made the client's own, and given back out", () => {
    const w = clientWorlds(3);
    const named = w.command(
      S,
      call("Page.createIsolatedWorld", { frameId: "F", worldName: "utility" }),
    );
    expect([
      verdictOf(named),
      named.call.params["worldName"],
      named.call.params["frameId"],
    ]).toEqual(["ok", "__vfc3__utility", "F"]);
    expect(
      w.command(S, call("Page.createIsolatedWorld", { frameId: "F" })).call.params["worldName"],
    ).toBe("__vfc3__");
    expect(nameOut(w.event(S, created(11, "__vfc3__utility", "isolated")))).toBe("utility");
    expect(nameOut(w.event(S, created(12, "__vfc3__", "isolated")))).toBe("");
  });

  it("addScriptToEvaluateOnNewDocument's world and addBinding's context name are rewritten; the page's world is left", () => {
    const w = clientWorlds(3);
    const script = w.command(
      S,
      call("Page.addScriptToEvaluateOnNewDocument", { source: "1", worldName: "utility" }),
    );
    const binding = w.command(
      S,
      call("Runtime.addBinding", { name: "b", executionContextName: "utility" }),
    );
    expect([script.call.params["worldName"], binding.call.params["executionContextName"]]).toEqual([
      "__vfc3__utility",
      "__vfc3__utility",
    ]);
    // no name, or "", is the page's own world for these two: forwarded as asked
    for (const params of [{ source: "1" }, { source: "1", worldName: "" }]) {
      const r = w.command(S, call("Page.addScriptToEvaluateOnNewDocument", params));
      expect([verdictOf(r), r.call.params]).toEqual(["ok", params]);
    }
    const all = w.command(S, call("Runtime.addBinding", { name: "b" }));
    expect([verdictOf(all), all.call.params]).toEqual(["ok", { name: "b" }]);
  });

  it("default and worker contexts pass; another client's, the owner's and an unprefixed isolated world do not", () => {
    const w = clientWorlds(3);
    expect(nameOut(w.event(S, created(1, "", "default")))).toBe("");
    expect(nameOut(w.event(S, created(2, "", "worker")))).toBe("");
    expect(
      [
        created(3, "__vfc4__utility", "isolated"),
        created(4, "__vfc31__utility", "isolated"),
        created(5, "__vibefield_words", "isolated"),
        created(6, "utility", "isolated"),
        created(7, "", "isolated"),
      ].map((e) => forwarded(w.event(S, e))),
    ).toEqual([false, false, false, false, false]);
  });

  it("a name of the bridge's own is forbidden in all three", () => {
    const w = clientWorlds(3);
    for (const name of ["__vfc3__x", "__vfc", "__vibefield_words"]) {
      expect(
        [
          w.command(S, call("Page.createIsolatedWorld", { frameId: "F", worldName: name })),
          w.command(
            S,
            call("Page.addScriptToEvaluateOnNewDocument", { source: "1", worldName: name }),
          ),
          w.command(S, call("Runtime.addBinding", { name: "b", executionContextName: name })),
        ].map(verdictOf),
      ).toEqual(["forbidden", "forbidden", "forbidden"]);
    }
  });

  it("a binding named under the bridge's own prefixes is forbidden, to add or to remove", () => {
    const w = clientWorlds(3);
    for (const method of ["Runtime.addBinding", "Runtime.removeBinding"]) {
      expect(
        ["__vibefieldPageScale", "__vibefieldFrameWords", "__vfc3__b", "__vfc", "mine"].map(
          (name) => verdictOf(w.command(S, call(method, { name }))),
        ),
        method,
      ).toEqual(["forbidden", "forbidden", "forbidden", "forbidden", "ok"]);
    }
  });

  it("a context named in a command must be one this client was given, by id or by unique id", () => {
    const w = clientWorlds(3);
    w.event(S, created(1, "", "default", "u-page"));
    w.event(S, created(9, "__vfc4__utility", "isolated", "u-other"));
    const byId: [string, string][] = [
      ["Runtime.evaluate", "contextId"],
      ["Runtime.callFunctionOn", "executionContextId"],
      ["Runtime.compileScript", "executionContextId"],
      ["Runtime.runScript", "executionContextId"],
      ["Runtime.globalLexicalScopeNames", "executionContextId"],
      ["Runtime.addBinding", "executionContextId"],
      ["DOM.resolveNode", "executionContextId"],
    ];
    for (const [method, param] of byId) {
      expect(
        [1, 9, 77].map((id) => verdictOf(w.command(S, call(method, { [param]: id })))),
        method,
      ).toEqual(["ok", "forbidden", "forbidden"]);
    }
    for (const method of ["Runtime.evaluate", "Runtime.callFunctionOn"]) {
      expect(
        ["u-page", "u-other", "u-none"].map((u) =>
          verdictOf(w.command(S, call(method, { uniqueContextId: u }))),
        ),
        method,
      ).toEqual(["ok", "forbidden", "forbidden"]);
    }
    // naming no context is the default world's, as asked
    expect(verdictOf(w.command(S, call("Runtime.evaluate", { expression: "1" })))).toBe("ok");
  });

  it("createIsolatedWorld's answer gives the client its world at once, before the world's event", () => {
    const w = clientWorlds(3);
    expect(verdictOf(w.command(S, call("Runtime.evaluate", { contextId: 21 })))).toBe("forbidden");
    const asked = w.command(
      S,
      call("Page.createIsolatedWorld", { frameId: "F", worldName: "utility" }),
    );
    w.answered(S, asked.call, { executionContextId: 21 });
    expect(verdictOf(w.command(S, call("Runtime.evaluate", { contextId: 21 })))).toBe("ok");
    expect([...w.isolatedWorlds(S)]).toEqual([21]);
  });

  it("destroyed reaches the client only for its own and forgets it; cleared forgets every id and keeps the names", () => {
    const w = clientWorlds(3);
    w.event(S, created(1, "", "default"));
    w.event(S, created(11, "__vfc3__utility", "isolated"));
    const destroyed = (id: number, uniqueId?: string): CdpEvent => ({
      method: "Runtime.executionContextDestroyed",
      params: {
        executionContextId: id,
        ...(uniqueId === undefined ? {} : { executionContextUniqueId: uniqueId }),
      },
    });
    expect(forwarded(w.event(S, destroyed(9)))).toBe(false);
    expect(forwarded(w.event(S, destroyed(11)))).toBe(true);
    expect(verdictOf(w.command(S, call("Runtime.evaluate", { contextId: 11 })))).toBe("forbidden");
    expect(forwarded(w.event(S, destroyed(11)))).toBe(false);
    const cleared = w.event(S, { method: "Runtime.executionContextsCleared", params: {} });
    expect(forwarded(cleared)).toBe(true);
    expect(verdictOf(w.command(S, call("Runtime.evaluate", { contextId: 1 })))).toBe("forbidden");
    // the names stand: the next navigation's world is still the client's
    expect(nameOut(w.event(S, created(31, "__vfc3__utility", "isolated")))).toBe("utility");
  });

  it('two clients each ask for "utility": each sees only its own under that name, and neither can use the other\'s', () => {
    const a = clientWorlds(1);
    const b = clientWorlds(2);
    const SA = "S-a";
    const SB = "S-b";
    const nameA = a.command(
      SA,
      call("Page.createIsolatedWorld", { frameId: "F", worldName: "utility" }),
    ).call.params["worldName"];
    const nameB = b.command(
      SB,
      call("Page.createIsolatedWorld", { frameId: "F", worldName: "utility" }),
    ).call.params["worldName"];
    expect(nameA).not.toBe(nameB);
    // each session hears both worlds
    const worldA = created(41, String(nameA), "isolated", "u-a");
    const worldB = created(42, String(nameB), "isolated", "u-b");
    expect([nameOut(a.event(SA, worldA)), nameOut(a.event(SA, worldB))]).toEqual(["utility", null]);
    expect([nameOut(b.event(SB, worldA)), nameOut(b.event(SB, worldB))]).toEqual([null, "utility"]);
    expect(
      [
        a.command(SA, call("Runtime.evaluate", { contextId: 42 })),
        a.command(SA, call("Runtime.evaluate", { uniqueContextId: "u-b" })),
        b.command(SB, call("Runtime.evaluate", { contextId: 41 })),
        b.command(SB, call("Runtime.evaluate", { uniqueContextId: "u-a" })),
        a.command(SA, call("Runtime.evaluate", { contextId: 41 })),
        b.command(SB, call("Runtime.evaluate", { uniqueContextId: "u-b" })),
      ].map(verdictOf),
    ).toEqual(["forbidden", "forbidden", "forbidden", "forbidden", "ok", "ok"]);
  });

  it("a console call, a thrown exception and a binding called reach the client only from a context it was given", () => {
    const w = clientWorlds(3);
    w.event(S, created(1, "", "default"));
    w.event(S, created(9, "__vfc4__utility", "isolated"));
    const events = (id: number): CdpEvent[] => [
      {
        method: "Runtime.consoleAPICalled",
        params: { type: "log", args: [], executionContextId: id },
      },
      {
        method: "Runtime.exceptionThrown",
        params: { exceptionDetails: { executionContextId: id } },
      },
      {
        method: "Runtime.bindingCalled",
        params: { name: "b", payload: "", executionContextId: id },
      },
    ];
    expect(events(1).map((e) => forwarded(w.event(S, e)))).toEqual([true, true, true]);
    expect(events(9).map((e) => forwarded(w.event(S, e)))).toEqual([false, false, false]);
  });

  it("contexts are the session's: an id given on one session is not given on another, and an ended one forgets", () => {
    const w = clientWorlds(3);
    w.event(S, created(1, "", "default"));
    w.event("S-child", created(1, "", "default"));
    w.event(S, created(11, "__vfc3__utility", "isolated"));
    expect(verdictOf(w.command("S-other", call("Runtime.evaluate", { contextId: 1 })))).toBe(
      "forbidden",
    );
    expect([...w.isolatedWorlds(S)]).toEqual([11]);
    expect([...w.isolatedWorlds("S-child")]).toEqual([]);
    w.sessionEnded(S);
    expect(verdictOf(w.command(S, call("Runtime.evaluate", { contextId: 1 })))).toBe("forbidden");
    expect(verdictOf(w.command("S-child", call("Runtime.evaluate", { contextId: 1 })))).toBe("ok");
    expect([...w.isolatedWorlds(S)]).toEqual([]);
  });
});
