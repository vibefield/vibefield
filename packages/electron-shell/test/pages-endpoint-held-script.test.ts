// EY-1 (2026-11-24) — the agent's script on its own page while the person holds it (BU-9). What the hold takes off:
// the init script (so no document the person opens in their hand runs it) and the binding (the injected script's own
// line to its client), both set again at the put-down; and a binding's call is not said during the hold. What the
// hold does NOT take off, by the design's own word (BU-9, v0.4): a script the agent already ran in the page stays in
// it, and the own page's console is said while it is held. On the real windows, journal, policy and cleaning.
import { describe, expect, it } from "vitest";
import { client, type PageAnswer, pickUp, putDown, wall } from "./pages-wall-kit";

const HOOK = "vfAgentHook";
const answer: PageAnswer = (method) =>
  method === "Page.addScriptToEvaluateOnNewDocument" ? { identifier: "s-1" } : {};

/** An own page with the agent's init script and binding on it, and its page world given to the client. */
async function scripted() {
  const w = wall({ answer, bindings: [HOOK] });
  const c = client(w.endpoint);
  const s = await c.attach();
  const call = w.open("act");
  await c.call("Runtime.enable", {}, s);
  w.session().emit({
    method: "Runtime.executionContextCreated",
    params: {
      context: {
        id: 1,
        origin: "https://a.test",
        name: "",
        uniqueId: "u-1",
        auxData: { isDefault: true, type: "default", frameId: "F" },
      },
    },
  });
  expect(
    (await c.call("Page.addScriptToEvaluateOnNewDocument", { source: "listen()" }, s)).answer
      ?.result,
  ).toEqual({ identifier: "s-1" });
  expect((await c.call("Runtime.addBinding", { name: HOOK }, s)).answer?.result).toEqual({});
  w.close(call);
  return { w, c, s };
}

const called = (payload: string) => ({
  method: "Runtime.bindingCalled",
  params: { name: HOOK, payload, executionContextId: 1 },
});

describe("the agent's script on its own page while the person holds it (EY-1, 2026-11-24)", () => {
  it("at the pick-up the init script and the binding are taken off the page, and both are set again at the put-down", async () => {
    const { w } = await scripted();
    const sent = w.session().sent;
    const before = sent.length;
    await pickUp(w);
    expect(sent.slice(before)).toEqual([
      { method: "Runtime.removeBinding", params: { name: HOOK } },
      { method: "Page.removeScriptToEvaluateOnNewDocument", params: { identifier: "s-1" } },
    ]);
    const held = sent.length;
    await putDown(w);
    expect(sent.slice(held)).toEqual([
      { method: "Page.addScriptToEvaluateOnNewDocument", params: { source: "listen()" } },
      { method: "Runtime.addBinding", params: { name: HOOK } },
    ]);
  });

  it("a binding's call while the page is held is not said to the client, and is said again after the put-down", async () => {
    const { w, c, s } = await scripted();
    w.session().emit(called("before the hold"));
    expect(c.frames.at(-1)).toMatchObject({ method: "Runtime.bindingCalled", sessionId: s });
    await pickUp(w);
    const before = c.frames.length;
    w.session().emit(called("SENTINEL-TYPED-IN-THE-HAND"));
    expect(c.frames.slice(before)).toEqual([]);
    expect(JSON.stringify(c.frames)).not.toContain("SENTINEL-TYPED-IN-THE-HAND");
    await putDown(w);
    w.session().emit(called("after the put-down"));
    expect(c.frames.at(-1)?.params?.payload).toBe("after the put-down");
  });

  it("the own page's console is still said while it is held: the hold is not a promise that the agent stops seeing its own page", async () => {
    const { w, c, s } = await scripted();
    await pickUp(w);
    w.session().emit({
      method: "Runtime.consoleAPICalled",
      params: { type: "log", args: [{ type: "string", value: "seen" }], executionContextId: 1 },
    });
    expect(c.frames.at(-1)).toMatchObject({ method: "Runtime.consoleAPICalled", sessionId: s });
  });
});
