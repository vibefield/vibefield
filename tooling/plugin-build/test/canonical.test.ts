import { describe, expect, it } from "vitest";
import { CanonicalJsonError, canonicalJson } from "../src/canonical";

describe("canonicalJson", () => {
  it("sorts object keys recursively, including keys of objects nested inside arrays", () => {
    const input = { z: [{ y: 1, x: 2 }], b: 1, a: { d: 2, c: 3 } };
    const out = canonicalJson(input);
    // oracle: keys typed in already-sorted order; JSON.stringify (not
    // canonicalJson) does the formatting, so this isn't just re-testing itself.
    const expected = { a: { c: 3, d: 2 }, b: 1, z: [{ x: 2, y: 1 }] };
    expect(out).toBe(`${JSON.stringify(expected, null, 2)}\n`);
  });

  it("keeps array element order untouched even though object keys are sorted", () => {
    const input = { list: [3, 1, 2, "banana", "apple"] };
    const out = canonicalJson(input);
    const expected = { list: [3, 1, 2, "banana", "apple"] }; // deliberately unsorted
    expect(out).toBe(`${JSON.stringify(expected, null, 2)}\n`);
  });

  it("is byte-stable: repeated calls and differently key-ordered input produce identical bytes", () => {
    const value = { b: 1, a: 2, nested: { y: 1, x: 2 }, list: [1, 2, 3] };
    const first = canonicalJson(value);
    expect(canonicalJson(value)).toBe(first);

    const reordered = { nested: { x: 2, y: 1 }, list: [1, 2, 3], a: 2, b: 1 };
    expect(canonicalJson(reordered)).toBe(first);
  });

  it("ends with exactly one trailing newline", () => {
    const out = canonicalJson({ a: 1 });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("rejects a cyclic object reference with a clear, pathed error", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(cyclic)).toThrow(/cyclic/i);
  });

  it("rejects a cycle reached through an array", () => {
    const cyclic: unknown[] = [];
    cyclic.push({ list: cyclic });
    expect(() => canonicalJson({ nested: cyclic })).toThrow(/cyclic/i);
  });

  it("rejects undefined anywhere in the tree, with the offending path in the message", () => {
    expect(() => canonicalJson(undefined)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ a: undefined })).toThrow(/undefined/i);
    expect(() => canonicalJson({ a: undefined })).toThrow(/<root>\.a/);
    expect(() => canonicalJson({ a: [1, undefined, 2] })).toThrow(/<root>\.a\[1\]/);
  });

  it("rejects functions with a clear error", () => {
    expect(() => canonicalJson({ handler: () => {} })).toThrow(/function/i);
  });

  it("rejects non-finite numbers and non-plain-object instances (e.g. Date)", () => {
    expect(() => canonicalJson({ n: Number.POSITIVE_INFINITY })).toThrow(/canonical JSON form/i);
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(/canonical JSON form/i);
    expect(() => canonicalJson({ when: new Date() })).toThrow(/not JSON-shaped/i);
  });
});
