import { describe, expect, it } from "vitest";
import { SERVED_TOOLS } from "../gen/tools";
import {
  CHIP_TYPES,
  doorCanName,
  ObjectActInput,
  ObjectIntent,
  ObjectIntentAnswer,
  ObjectManual,
  ObjectRef,
  ObjectsHandResult,
} from "../src/objects";
import { toolRow } from "../src/tools";

// OB-0 — the desk room's wire truth (`draft/thinking-objects-at-work.md` §4, §5).

const REF = "vf:obj/7hk2qx4m";

describe("what a chip can be (OB-D1 A)", () => {
  it("is exactly six types", () => {
    expect([...CHIP_TYPES]).toEqual(["text", "image", "file", "link", "session", "ref"]);
  });
});

describe("a ref is a name (OB-L1)", () => {
  it("reads vf:obj/ and eight lowercase characters, and nothing else", () => {
    expect(ObjectRef.safeParse(REF).success).toBe(true);
    for (const bad of ["vf:obj/SHORT", "vf:obj/7hk2qx4m9", "obj/7hk2qx4m", "vf:obj/7HK2QX4M", ""])
      expect(ObjectRef.safeParse(bad).success, bad).toBe(false);
  });
});

describe("the desk's eight (§5.2)", () => {
  const EIGHT = [
    "canvas_kinds",
    "canvas_list",
    "canvas_place",
    "canvas_remove",
    "object_open",
    "object_read",
    "object_act",
    "object_release",
  ];

  it("are served to every agent, in the desk's category", () => {
    for (const name of EIGHT) {
      const row = SERVED_TOOLS.find((t) => t.name === name);
      expect(row?.audience, name).toBe("agent");
      expect(row?.category, name).toBe("desk");
    }
  });

  it("keeps the harness's gate: exactly these four only read, so reading and acting stay two rows (MT-D7)", () => {
    const reads = EIGHT.filter((name) => toolRow(name)?.readOnly);
    expect(reads).toEqual(["canvas_kinds", "canvas_list", "object_open", "object_read"]);
  });

  it("puts object_act's doing first, because an approval prompt shows the fields in order", () => {
    const row = SERVED_TOOLS.find((t) => t.name === "object_act")!;
    expect(Object.keys((row.inputSchema as { properties: object }).properties)[0]).toBe("doing");
    expect(ObjectActInput.safeParse({ ref: REF, tool: "add" }).success).toBe(false);
  });

  it("always teaches a tool's input: a manual's tools are the kind's own schemas", () => {
    const manual = ObjectManual.safeParse({
      object: {
        ref: REF,
        kind: "vibefield.mindmap",
        title: "Q3 plan",
        yours: "handed",
        agents: [{ handle: "claude·2", state: "open" }],
        heldByUser: false,
        onScreen: true,
      },
      now: { nodes: 23 },
      tools: [
        { name: "add", readOnly: false, description: "Add nodes.", input: { type: "object" } },
      ],
      manual: { kind: "vibefield.mindmap", version: 3 },
    });
    expect(manual.success).toBe(true);
  });
});

describe("the window's door (CP-D13)", () => {
  it("reads an act's intent, and refuses one with no words for its prompt", () => {
    const act = {
      op: "act",
      intent: "i1",
      run: "r1",
      handle: "claude·2",
      key: "k",
      tool: "edit",
      input: {},
    };
    expect(
      ObjectIntent.safeParse({ ...act, doing: "Rename the root", expiresAt: 1_000 }).success,
    ).toBe(true);
    expect(ObjectIntent.safeParse(act).success).toBe(false);
  });

  it("answers with a value or a fact, never both shapes at once", () => {
    expect(ObjectIntentAnswer.safeParse({ intent: "i1", ok: true, value: 1 }).success).toBe(true);
    expect(
      ObjectIntentAnswer.safeParse({
        intent: "i1",
        ok: false,
        fact: "held",
        text: "The user has it.",
      }).success,
    ).toBe(true);
    expect(ObjectIntentAnswer.safeParse({ intent: "i1", ok: false }).success).toBe(false);
  });

  it("says why a hand was refused", () => {
    expect(ObjectsHandResult.safeParse({ handed: false }).success).toBe(false);
    expect(ObjectsHandResult.safeParse({ handed: false, reason: "no-run" }).success).toBe(true);
  });
});

describe("doorCanName", () => {
  it("names a pane's own process or a run's own helper, and nothing else", () => {
    expect(doorCanName("terminal")).toBe(true);
    expect(doorCanName("run-helper")).toBe(true);
    expect(doorCanName("shared-leader")).toBe(false);
    expect(doorCanName(undefined)).toBe(false);
  });
});
