// EY-1 (2026-11-19) — an agent's input on a desk page: a point method's point on the page session goes through the
// view's scale (a mouse's, each touch point's, a gesture's origin), never a wheel's deltas or a gesture's distances; a
// child session's point passes as it came; key-like input is refused on a child, and on the page while a frame of
// another site holds the focus or may; and a key that carries an edit command is refused, whichever command it is
// (2026-11-24): a key's edit command runs with a key binding's standing and may read or write the system clipboard.
import { describe, expect, it } from "vitest";
import type { BrowserAgentPort } from "../src/main/live-surfaces/browser-electron-native";
import { BRIDGE_OK, type CdpCall, type SessionKind } from "../src/main/pages/core/types";
import { agentInput } from "../src/main/pages/endpoint/input";
import { client, refusedAs, wall } from "./pages-wall-kit";

/** a page at capture scale 0.5 */
function port(o: { readonly framesHoldFocus?: boolean } = {}): BrowserAgentPort {
  return {
    targetId: "DEVTOOLS-A",
    openClientSession: async () => {
      throw new Error("not in these rows");
    },
    captureScale: () => 0.5,
    info: () => ({ url: "https://a.test/", title: "A" }),
    onDetach: () => () => {},
    pin: () => ({ applied: Promise.resolve("applied"), release: () => {} }),
    framesHoldFocus: () => o.framesHoldFocus === true,
    viewImagePoint: (p) => ({ x: p.x * 0.5, y: p.y * 0.5 }),
  };
}

const call = (method: string, params: Record<string, unknown>): CdpCall => ({ method, params });
const on = (c: CdpCall, session: SessionKind = "page", p = port()) =>
  agentInput({ call: c, session, port: p });

describe("an agent's input on a desk page (EY-1 1d)", () => {
  it("takes a mouse's point on the page through the view's scale, and keeps the rest", () => {
    const out = on(
      call("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: 200,
        y: 100,
        button: "left",
        clickCount: 1,
      }),
    );
    expect(out.verdict).toEqual(BRIDGE_OK);
    expect(out.call.params).toEqual({
      type: "mousePressed",
      x: 100,
      y: 50,
      button: "left",
      clickCount: 1,
    });
  });

  it("scales a wheel's point and never its deltas", () => {
    const out = on(
      call("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: 200,
        y: 100,
        deltaX: 0,
        deltaY: 200,
      }),
    );
    expect(out.call.params).toEqual({ type: "mouseWheel", x: 100, y: 50, deltaX: 0, deltaY: 200 });
  });

  it("takes each touch point through the view's scale", () => {
    const out = on(
      call("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: 200, y: 100, id: 1 },
          { x: 40, y: 20 },
        ],
      }),
    );
    expect(out.call.params["touchPoints"]).toEqual([
      { x: 100, y: 50, id: 1 },
      { x: 20, y: 10 },
    ]);
  });

  it("scales a gesture's origin and never its distances or factor", () => {
    expect(
      on(call("Input.synthesizeScrollGesture", { x: 200, y: 100, xDistance: 0, yDistance: -300 }))
        .call.params,
    ).toEqual({
      x: 100,
      y: 50,
      xDistance: 0,
      yDistance: -300,
    });
    expect(
      on(call("Input.synthesizeTapGesture", { x: 200, y: 100, tapCount: 1 })).call.params,
    ).toEqual({
      x: 100,
      y: 50,
      tapCount: 1,
    });
    expect(
      on(call("Input.synthesizePinchGesture", { x: 200, y: 100, scaleFactor: 2 })).call.params,
    ).toEqual({
      x: 100,
      y: 50,
      scaleFactor: 2,
    });
  });

  it("passes a child session's point as it came, while the page's is scaled", () => {
    const press = call("Input.dispatchMouseEvent", { type: "mousePressed", x: 200, y: 100 });
    expect(on(press, "child").call).toBe(press);
    expect(on(press, "page").call.params["x"]).toBe(100);
  });

  it("refuses key input on a child session", () => {
    const out = on(call("Input.dispatchKeyEvent", { type: "keyDown", key: "a" }), "child");
    expect(out.verdict).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("refuses key input on the page while a frame of another site holds the focus, and passes it otherwise", () => {
    const text = call("Input.insertText", { text: "hello" });
    expect(on(text, "page", port({ framesHoldFocus: true })).verdict).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(on(text, "page", port({ framesHoldFocus: false }))).toEqual({
      verdict: BRIDGE_OK,
      call: text,
    });
    expect(
      on(
        call("Input.imeSetComposition", { text: "あ", selectionStart: 0, selectionEnd: 1 }),
        "page",
        port({ framesHoldFocus: true }),
      ).verdict.ok,
    ).toBe(false);
  });

  it("passes a call that is not input unchanged, while a point is scaled", () => {
    const evaluate = call("Runtime.evaluate", { expression: "1" });
    expect(on(evaluate)).toEqual({ verdict: BRIDGE_OK, call: evaluate });
    expect(on(call("Input.synthesizeTapGesture", { x: 10, y: 10 })).call.params["x"]).toBe(5);
  });
});

describe("a key's edit commands never reach a page: an agent's key cannot read or write the person's clipboard (EY-1, 2026-11-24)", () => {
  const key = (commands: unknown) =>
    call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "v", code: "KeyV", commands });

  it.each([
    "paste",
    "pasteAndMatchStyle",
    "copy",
    "cut",
    "yank",
    "takeFindStringFromSelection",
    "Paste",
    "selectAll",
  ])("refuses a key carrying the edit command %s, whichever it is", (command) => {
    const out = on(key([command]));
    expect(out.verdict).toMatchObject({ ok: false, code: "forbidden" });
    expect(out.verdict.ok ? "" : out.verdict.reason).toContain("clipboard");
  });

  it.each([
    ["a bare word", "paste"],
    ["a number", 1],
    ["null", null],
    ["a list holding a non-word", [1]],
    ["a list with a harmless word among others", ["moveLeft", "paste"]],
  ])("refuses commands that are %s", (_name, commands) => {
    expect(on(key(commands)).verdict).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("refuses it whether or not a frame holds the focus, and passes a key with no commands or an empty list as it came", () => {
    expect(on(key(["paste"]), "page", port({ framesHoldFocus: true })).verdict.ok).toBe(false);
    const plain = call("Input.dispatchKeyEvent", { type: "keyDown", key: "a", text: "a" });
    expect(on(plain)).toEqual({ verdict: BRIDGE_OK, call: plain });
    const empty = key([]);
    expect(on(empty)).toEqual({ verdict: BRIDGE_OK, call: empty });
    // the modifiers of a paste shortcut alone carry no edit command: the key passes as a key
    const chord = call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "v", modifiers: 4 });
    expect(on(chord)).toEqual({ verdict: BRIDGE_OK, call: chord });
  });

  it("at the wall, in an act window on the agent's own page: refused forbidden, nothing sent to the page, and the call hears of it", async () => {
    const w = wall();
    const c = client(w.endpoint);
    const s = await c.attach();
    const callId = w.open("act");
    const pasted = await c.call(
      "Input.dispatchKeyEvent",
      { type: "rawKeyDown", key: "v", code: "KeyV", commands: ["paste"] },
      s,
    );
    refusedAs(pasted.answer, "forbidden");
    expect(w.session().sent).toEqual([]);
    expect(w.refused.mock.calls).toEqual([
      [{ callId, method: "Input.dispatchKeyEvent", code: "forbidden" }],
    ]);
    // the same key without the command is typed
    const typed = await c.call(
      "Input.dispatchKeyEvent",
      { type: "keyDown", key: "a", text: "a" },
      s,
    );
    expect(typed.answer?.result).toEqual({});
    expect(w.session().sent.map((m) => m.method)).toEqual(["Input.dispatchKeyEvent"]);
  });
});
