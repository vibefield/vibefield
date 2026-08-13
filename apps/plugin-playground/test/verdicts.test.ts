// The pure half: fixture validation and argument parsing, with no DOM, no
// engine, and no Vite. These are the checks that run BEFORE anything mounts, so
// they are worth pinning on their own — a mistake here turns a diagnosis
// (`state-invalid`) into a symptom (`state-render-failed`).
import type { WidgetContribution } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli";
import { readStatesModule, synthesizeDefaultState, validateState } from "../src/states";

const decl = {
  type: "vibefield.t.card",
  title: "Card",
  schemaVersion: 1,
  surface: "dom",
  sizeMode: "fixed",
  defaultSize: { w: 100, h: 100 },
  groups: {},
  props: {
    count: { kind: "number", min: 0, max: 10, default: 3 },
    label: { kind: "string", default: "hi", maxLength: 8 },
    on: { kind: "boolean", default: false },
    mode: { kind: "enum", options: ["a", "b"], default: "a" },
    rows: {
      kind: "json",
      inner: { kind: "array", item: { kind: "object", fields: { id: { kind: "string" } } } },
      default: [],
    },
    who: { kind: "entity-ref" },
  },
} as unknown as WidgetContribution;

describe("validateState", () => {
  it("accepts props that match every declared kind", () => {
    expect(
      validateState(decl, "ok", {
        count: 3,
        label: "hi",
        on: true,
        mode: "b",
        rows: [{ id: "x" }],
      }),
    ).toBeNull();
  });

  it("accepts a partial state — an omitted prop takes its declared default", () => {
    expect(validateState(decl, "partial", { count: 1 })).toBeNull();
  });

  it("refuses an undeclared prop name and lists the declared ones", () => {
    const bad = validateState(decl, "typo", { kount: 1 });
    expect(bad?.code).toBe("state-invalid");
    expect(bad?.pointer).toBe("/vibefield.t.card/typo/kount");
    expect(bad?.expected).toContain("count");
  });

  it.each([
    ["over the declared max", { count: 99 }, "/vibefield.t.card/x/count"],
    ["under the declared min", { count: -1 }, "/vibefield.t.card/x/count"],
    ["the wrong primitive kind", { count: "3" }, "/vibefield.t.card/x/count"],
    ["a string over maxLength", { label: "far too long" }, "/vibefield.t.card/x/label"],
    ["a non-boolean", { on: "yes" }, "/vibefield.t.card/x/on"],
    ["an enum value outside options", { mode: "c" }, "/vibefield.t.card/x/mode"],
  ])("refuses %s", (_name, props, pointer) => {
    const bad = validateState(decl, "x", props as Record<string, unknown>);
    expect(bad?.code).toBe("state-invalid");
    expect(bad?.pointer).toBe(pointer);
    expect(bad?.expected).toBeDefined();
  });

  it("refuses a json prop at the exact failing sub-path", () => {
    const bad = validateState(decl, "x", { rows: [{ id: "ok" }, { id: 7 }] });
    expect(bad?.code).toBe("state-invalid");
    // the index and the field, not just "rows"
    expect(bad?.pointer).toBe("/vibefield.t.card/x/rows/1/id");
  });

  it("refuses a ref-kind prop, naming the kind rather than letting the prefab build fail", () => {
    const bad = validateState(decl, "x", { who: "e1" });
    expect(bad?.code).toBe("state-invalid");
    expect(bad?.detail).toContain("entity-ref");
  });
});

describe("synthesizeDefaultState", () => {
  it("takes the declared defaults, and omits props that declare none", () => {
    expect(synthesizeDefaultState(decl)).toEqual({
      count: 3,
      label: "hi",
      on: false,
      mode: "a",
      rows: [],
    });
  });
});

describe("readStatesModule", () => {
  it("reads a well-formed states file", () => {
    const read = readStatesModule({ default: { "a.b": { one: { x: 1 } } } });
    expect(read).toEqual({ ok: true, states: { "a.b": { one: { x: 1 } } } });
  });

  it.each([
    ["no default export", {}],
    ["a non-object default export", { default: 7 }],
    ["an array default export", { default: [] }],
    ["states that are not an object", { default: { "a.b": 7 } }],
    ["a state that is not a prop object", { default: { "a.b": { one: 7 } } }],
  ])("refuses %s", (_name, mod) => {
    const read = readStatesModule(mod as Record<string, unknown>);
    expect(read.ok).toBe(false);
    expect(read.ok === false && read.code).toBe("states-invalid");
  });

  it("points at the state it could not read", () => {
    const read = readStatesModule({ default: { "a.b": { one: 7 } } });
    expect(read.ok === false && read.pointer).toBe("/a.b/one");
  });
});

describe("parseArgs", () => {
  it("takes a directory, --json, and --state in either spelling", () => {
    expect(parseArgs(["p", "--json", "--state", "t:s"])).toMatchObject({
      pluginDir: "p",
      json: true,
      only: "t:s",
    });
    expect(parseArgs(["p", "--state=t"])).toMatchObject({ pluginDir: "p", only: "t" });
  });

  it("refuses a --state with no value, an unknown flag, and a second directory", () => {
    expect(parseArgs(["p", "--state"]).error).toBeDefined();
    expect(parseArgs(["p", "--wat"]).error).toBeDefined();
    expect(parseArgs(["p", "q"]).error).toBeDefined();
  });
});
