import { createHash } from "node:crypto";
import {
  type PagesCommandClass,
  type PagesScriptMethod,
  PagesScriptSetV1,
  type PagesTemplatePartV1,
} from "@vibefield/contracts";
import { PAGES_ENGINE_RECORD, PAGES_SCRIPT_SET } from "@vibefield/contracts/pages-record";
import { describe, expect, it } from "vitest";
import { createScriptMatcher, pagesScriptMatcher } from "../src/main/pages/core/script-match";

// EY-1 (2026-11-19): the engine's own script, matched by hash. The set here is built in the test
// from its own text, never copied from the engine: two bodies and five templates, one nested and
// one with no method.

const sha = (text: string): string =>
  createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
const fixed = (text: string): PagesTemplatePartV1 => ({
  kind: "fixed",
  sha256: sha(text),
  length: Buffer.byteLength(text, "utf8"),
});
const body = (
  id: string,
  text: string,
  method: PagesScriptMethod,
  commandClass: PagesCommandClass,
  commands: string[],
) => ({
  id,
  sha256: sha(text),
  length: Buffer.byteLength(text, "utf8"),
  method,
  commandClass,
  commands,
});

function smallSet(): PagesScriptSetV1 {
  return {
    v: 1,
    engineVersion: "0.41.0",
    recordedCalls: 9,
    unmatchedCallSites: ["interaction.rs:781"],
    exact: [
      body("x001", "document.title", "Runtime.evaluate", "read", ["get title"]),
      body("x002", "été", "Runtime.callFunctionOn", "act", ["fill", "type"]),
    ],
    templates: [
      {
        id: "find-css",
        method: "Runtime.evaluate",
        commandClass: "read",
        callSite: "element.rs:964",
        parts: [fixed("document.querySelector("), { kind: "json-string" }, fixed(")")],
      },
      {
        id: "find-doc-css",
        commandClass: "read",
        callSite: "element.rs:964",
        parts: [fixed("doc.querySelector("), { kind: "json-string" }, fixed(")")],
      },
      {
        id: "frame-402",
        method: "Runtime.callFunctionOn",
        commandClass: "read",
        callSite: "element.rs:402",
        parts: [
          fixed("function() { return "),
          { kind: "template", id: "find-doc-css" },
          fixed("; }"),
        ],
      },
      {
        id: "scroll-449",
        method: "Runtime.evaluate",
        commandClass: "act",
        callSite: "interaction.rs:449",
        parts: [
          fixed("window.scrollBy("),
          { kind: "finite-number" },
          fixed(", "),
          { kind: "finite-number" },
          fixed(")"),
        ],
      },
      {
        id: "overlay-486",
        method: "Runtime.evaluate",
        commandClass: "read",
        callSite: "screenshot.rs:486",
        parts: [fixed("var items = "), { kind: "json-value" }, fixed(";")],
      },
    ],
  };
}

describe("the engine's own script, matched by hash (EY-1)", () => {
  const match = createScriptMatcher(smallSet());
  const hit = (method: string, text: string): string | null => {
    const m = match(text, method);
    return m.matched ? m.entryId : null;
  };

  it("matches a body by method, UTF-8 length and SHA-256; the same body under another method never", () => {
    expect(match("document.title", "Runtime.evaluate")).toEqual({
      matched: true,
      entryId: "x001",
      commandClass: "read",
    });
    // "été" is 3 UTF-16 units and 5 UTF-8 bytes: the length is the bytes'
    expect(match("été", "Runtime.callFunctionOn")).toEqual({
      matched: true,
      entryId: "x002",
      commandClass: "act",
    });
    expect(hit("Runtime.evaluate", "été")).toBeNull();
  });

  it("reads each gap to its own end and each fixed part by its hash, nested templates too", () => {
    expect(hit("Runtime.evaluate", 'document.querySelector("#a\\"b é")')).toBe("find-css");
    expect(hit("Runtime.callFunctionOn", 'function() { return doc.querySelector(".x"); }')).toBe(
      "frame-402",
    );
    expect(match("window.scrollBy(-1.5e2, 0)", "Runtime.evaluate")).toEqual({
      matched: true,
      entryId: "scroll-449",
      commandClass: "act",
    });
    expect(hit("Runtime.evaluate", 'var items = {"a":["}",1]};')).toBe("overlay-486");
    expect(hit("Runtime.evaluate", "var items = null;")).toBe("overlay-486");
  });

  it("never matches a template with no method alone", () => {
    expect(hit("Runtime.evaluate", 'doc.querySelector(".x")')).toBeNull();
  });

  it("takes anything else in a gap as the agent's script", () => {
    const no = [
      "window.scrollBy(1, fetch(1))", // a number gap holds no call
      "window.scrollBy(01, 0)", // the longest number at the gap is "0", so the next fixed part misses
      "var items =  null;", // no whitespace before a value
      "var items = alert(1);",
      'document.querySelector("a")) + 1', // the script must end where the parts end
      'document.querySelector("a"', // too short for the last fixed part
      'document.querySelectoR("a")', // one byte changed in a fixed part
      "document.querySelector('a')", // a JSON string has double quotes
      'document.querySelector("a" + document.cookie)',
    ];
    for (const text of no) expect(hit("Runtime.evaluate", text), text).toBeNull();
  });

  it("refuses at load a set whose templates cannot match exactly", () => {
    const meeting = smallSet();
    const scroll = meeting.templates[3];
    if (scroll === undefined) throw new Error("the set's scroll template");
    meeting.templates[3] = { ...scroll, parts: scroll.parts.filter((_, i) => i !== 2) };
    expect(() => createScriptMatcher(meeting)).toThrow(/two gaps that meet/);

    const unknown = smallSet();
    const frame = unknown.templates[2];
    if (frame === undefined) throw new Error("the set's frame template");
    unknown.templates[2] = { ...frame, parts: [fixed("x"), { kind: "template", id: "missing" }] };
    expect(() => createScriptMatcher(unknown)).toThrow(/does not hold/);

    const itself = smallSet();
    const css = itself.templates[0];
    if (css === undefined) throw new Error("the set's css template");
    itself.templates[0] = { ...css, parts: [fixed("x"), { kind: "template", id: "find-css" }] };
    expect(() => createScriptMatcher(itself)).toThrow(/inside itself/);
  });

  it("matches a 600 KB body against a 575 KB fixed part, and misses on one changed byte", () => {
    const head = `${"a".repeat(575 * 1024)}(`;
    const set = smallSet();
    set.templates.push({
      id: "a11y-finish",
      method: "Runtime.callFunctionOn",
      commandClass: "read",
      callSite: "a11y/mod.rs:214",
      parts: [fixed(head), { kind: "json-string" }, fixed(")")],
    });
    const big = createScriptMatcher(set);
    const text = `${head}${JSON.stringify("b".repeat(25 * 1024))})`;
    expect(big(text, "Runtime.callFunctionOn")).toEqual({
      matched: true,
      entryId: "a11y-finish",
      commandClass: "read",
    });
    expect(big(`b${text.slice(1)}`, "Runtime.callFunctionOn")).toEqual({ matched: false });
  });
});

describe("the pin's own record (EY-1)", () => {
  it("parses strict, names the record's version, and admits the connect probe `1` as x001, a read", () => {
    expect(PagesScriptSetV1.safeParse(PAGES_SCRIPT_SET).success).toBe(true);
    expect(PAGES_SCRIPT_SET.engineVersion).toBe(PAGES_ENGINE_RECORD.version);
    const match = pagesScriptMatcher();
    // x001 is the digest of "1", the engine's first evaluate on every connect
    expect(match("1", "Runtime.evaluate")).toEqual({
      matched: true,
      entryId: "x001",
      commandClass: "read",
    });
    expect(match("1", "Runtime.callFunctionOn")).toEqual({ matched: false });
    expect(match("2", "Runtime.evaluate")).toEqual({ matched: false });
    // made once, for the bridge's life
    expect(pagesScriptMatcher()).toBe(match);
  });
});
