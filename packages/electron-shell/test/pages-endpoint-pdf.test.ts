// EY-1 (2026-11-24) — a PDF is a still (BU-12 A): one per read window, its bytes in the answer, bounded there. Asked
// for as a stream it would be read over IO.read, in any later window, with no bound; so the stream form is refused
// before it can be the window's one still. On the real windows and policy.
import { describe, expect, it } from "vitest";
import { client, type PageAnswer, refusedAs, wall } from "./pages-wall-kit";

const SMALL = Buffer.from("a small pdf").toString("base64");
/** past the kit's still bound (1024 bytes) */
const BIG = Buffer.from("SENTINEL-PDF-BODY-".repeat(80)).toString("base64");

describe("a PDF comes in its answer, under the still's bound, never as a stream (EY-1, 2026-11-24)", () => {
  it("in a read window a PDF asked for as a stream is refused and nothing is sent; it does not spend the window's one still", async () => {
    const answer: PageAnswer = (method) => (method === "Page.printToPDF" ? { data: SMALL } : {});
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    w.open("read");
    refusedAs(
      (await c.call("Page.printToPDF", { transferMode: "ReturnAsStream" }, s)).answer,
      "forbidden",
    );
    expect(w.session().sent).toEqual([]);
    // the window's one still is still its to take, as bytes
    expect((await c.call("Page.printToPDF", {}, s)).answer?.result).toEqual({ data: SMALL });
    refusedAs((await c.call("Page.printToPDF", {}, s)).answer, "outside-window");
    expect(w.session().sent.map((m) => m.method)).toEqual(["Page.printToPDF"]);
  });

  it("a PDF past the still's bound is refused before it is relayed, and its body is in no frame or log line", async () => {
    const answer: PageAnswer = (method) => (method === "Page.printToPDF" ? { data: BIG } : {});
    const w = wall({ answer });
    const c = client(w.endpoint);
    const s = await c.attach();
    w.open("read");
    refusedAs((await c.call("Page.printToPDF", {}, s)).answer, "forbidden");
    expect(JSON.stringify(c.frames)).not.toContain(BIG);
    expect(JSON.stringify(w.log.mock.calls)).not.toContain(BIG);
  });
});
