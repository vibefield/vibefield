// EY-1 (2026-11-24) — an answer that comes back late (BU-9; windows.ts `lateVerdict`): the bridge forwards a command
// and the page answers when it answers. An answer that arrives after the person picked the page up, after its call's
// window closed, or after its grant ended is refused in its place and never relayed: what it carries was read after
// the wall would have refused the read. On the real windows, journal and policy; the page's answer is given late by
// the row.
import { describe, expect, it } from "vitest";
import {
  client,
  deferred,
  PAGE,
  type PageAnswer,
  pickUp,
  putDown,
  refusedAs,
  wall,
} from "./pages-wall-kit";

/** A script body the pin's record holds as a read, as the kit's matcher is told. */
const ENGINE_READ = "document.readyState";

/** A page that answers one method when the row says. */
function lateOn(method: string) {
  const answer = deferred<Record<string, unknown>>();
  const page: PageAnswer = (asked) => (asked === method ? answer.promise : {});
  return { answer, page };
}

describe("an answer that comes back late is refused in its place, never relayed (EY-1, 2026-11-24)", () => {
  it("a read admitted just before a pick-up: the client gets held, and nothing of the page as it stood in the person's hand", async () => {
    const late = lateOn("DOM.getDocument");
    const w = wall({ answer: late.page });
    const c = client(w.endpoint);
    const s = await c.attach();
    w.open("read");
    const pending = c.call("DOM.getDocument", {}, s);
    await pickUp(w);
    late.answer.resolve({ root: { nodeId: 1, nodeName: "SENTINEL-TREE" } });
    const r = await pending;
    refusedAs(r.answer, "held");
    expect(r.answer?.result).toBeUndefined();
    expect(JSON.stringify(c.frames)).not.toContain("SENTINEL-TREE");
  });

  it("a still admitted just before a pick-up is not relayed either", async () => {
    const late = lateOn("Page.captureScreenshot");
    const w = wall({ answer: late.page });
    const c = client(w.endpoint);
    const s = await c.attach();
    w.open("read");
    const pending = c.call("Page.captureScreenshot", { format: "png" }, s);
    await pickUp(w);
    late.answer.resolve({ data: Buffer.from("SENTINEL-STILL").toString("base64") });
    const r = await pending;
    refusedAs(r.answer, "held");
    expect(JSON.stringify(c.frames)).not.toContain(
      Buffer.from("SENTINEL-STILL").toString("base64"),
    );
  });

  it("an answer after its call's window closed is refused outside-window, and is no other call's refusal", async () => {
    const late = lateOn("DOM.getDocument");
    const w = wall({ answer: late.page });
    const c = client(w.endpoint);
    const s = await c.attach();
    const first = w.open("read");
    const pending = c.call("DOM.getDocument", {}, s);
    w.close(first);
    // the next call's window is open by the time the page answers the last call's read
    w.open("read");
    late.answer.resolve({ root: { nodeId: 1, nodeName: "SENTINEL-TREE" } });
    const r = await pending;
    refusedAs(r.answer, "outside-window");
    expect(JSON.stringify(c.frames)).not.toContain("SENTINEL-TREE");
    expect(w.refused).not.toHaveBeenCalled();
  });

  it("a still past its bound that comes back late is refused as late, and is no other call's refusal", async () => {
    const late = lateOn("Page.captureScreenshot");
    const w = wall({ answer: late.page });
    const c = client(w.endpoint);
    const s = await c.attach();
    const first = w.open("read");
    const pending = c.call("Page.captureScreenshot", { format: "png" }, s);
    w.close(first);
    // the next call's window is open when the last call's still comes back, past the bound
    w.open("read");
    late.answer.resolve({ data: Buffer.alloc(2_000).toString("base64") });
    refusedAs((await pending).answer, "outside-window");
    expect(w.refused).not.toHaveBeenCalled();
  });

  it("an answer after the act lease ran out is refused outside-window", async () => {
    const late = lateOn("DOM.getDocument");
    const w = wall({ answer: late.page });
    const c = client(w.endpoint);
    const s = await c.attach();
    w.open("act");
    const pending = c.call("DOM.getDocument", {}, s);
    w.tick(5_001);
    late.answer.resolve({ root: { nodeId: 1 } });
    refusedAs((await pending).answer, "outside-window");
  });

  it("an answer after the grant ended is refused no-lease", async () => {
    const late = lateOn("DOM.getDocument");
    const w = wall({ answer: late.page });
    const c = client(w.endpoint);
    const s = await c.attach();
    w.open("read");
    const pending = c.call("DOM.getDocument", {}, s);
    w.windows.unlease(PAGE);
    w.endpoint.ungrant(PAGE, "grant-end");
    late.answer.resolve({ root: { nodeId: 1, nodeName: "SENTINEL-TREE" } });
    const r = await pending;
    refusedAs(r.answer, "no-lease");
    expect(JSON.stringify(c.frames)).not.toContain("SENTINEL-TREE");
  });

  it("says a late answer in the log by its method and its word alone", async () => {
    const late = lateOn("DOM.getDocument");
    const w = wall({ answer: late.page });
    const c = client(w.endpoint);
    const s = await c.attach();
    w.open("read");
    const pending = c.call("DOM.getDocument", {}, s);
    await pickUp(w);
    late.answer.resolve({ root: { nodeId: 1, nodeName: "SENTINEL-TREE" } });
    await pending;
    const lines = w.log.mock.calls.map(([line]) => line);
    expect(lines.filter((line) => line.event === "desktop.pages.bridge_late")).toEqual([
      {
        event: "desktop.pages.bridge_late",
        method: "DOM.getDocument",
        session: "page",
        code: "held",
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain("SENTINEL");
  });

  it("after the put-down the same read is answered again, in a window of its own", async () => {
    const w = wall({ answer: () => ({ root: { nodeId: 1 } }) });
    const c = client(w.endpoint);
    const s = await c.attach();
    await pickUp(w);
    await putDown(w);
    w.open("read");
    expect((await c.call("DOM.getDocument", {}, s)).answer?.result).toEqual({
      root: { nodeId: 1 },
    });
  });
});

describe("what the wall does not tighten: an answer inside its call's window (EY-1, 2026-11-24)", () => {
  it.each(["read", "act"] as const)(
    "in a %s window the engine's connect is answered: its page enable and its own script; WebMCP.enable is refused as expected",
    async (kind) => {
      const w = wall({ reads: [ENGINE_READ], answer: () => ({ result: { value: "complete" } }) });
      const c = client(w.endpoint);
      const s = await c.attach();
      w.open(kind);
      expect((await c.call("Page.enable", {}, s)).answer?.error).toBeUndefined();
      const evaluated = await c.call("Runtime.evaluate", { expression: ENGINE_READ }, s);
      expect(evaluated.answer?.result).toEqual({ result: { value: "complete" } });
      refusedAs((await c.call("WebMCP.enable", {}, s)).answer, "forbidden");
      refusedAs((await c.call("WebMCP.enable", {}, s)).answer, "forbidden");
      expect(w.session().sent.map((m) => m.method)).toEqual(["Page.enable", "Runtime.evaluate"]);
    },
  );

  it("an owed Fetch answer continued as sent after its call's window closed is still answered", async () => {
    const w = wall();
    const c = client(w.endpoint);
    const s = await c.attach();
    const call = w.open("act");
    await c.call("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, s);
    w.session().emit({ method: "Fetch.requestPaused", params: { requestId: "r-1" } });
    w.close(call);
    const r = await c.call("Fetch.continueRequest", { requestId: "r-1" }, s);
    expect(r.answer?.result).toEqual({});
  });
});
