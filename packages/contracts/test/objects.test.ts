import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SERVED_TOOLS } from "../gen/tools";
import {
  CHIP_TYPES,
  doorCanName,
  OBJECT_GRANTS_FORMAT,
  ObjectActInput,
  ObjectAtWork,
  ObjectGrantsFile,
  ObjectIntent,
  ObjectIntentAnswer,
  ObjectManual,
  ObjectRecord,
  ObjectRef,
  ObjectsHandResult,
  ObjectsPresenceSnapshot,
  ObjectsTakeBackResult,
} from "../src/objects";
import { LAYOUT, LAYOUT_ROOT_LEVEL } from "../src/registries";
import { toolRow } from "../src/tools";

// OB-0 — the desk room's wire truth (`draft/thinking-objects-at-work.md` §4, §5).

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

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

// OB custody (C4, C5) — a record is a name, and every grant is in one counted file.
describe("what fieldd keeps: an object's name, and the grants in one file (OB custody)", () => {
  const name = { format: 1, ref: REF, docId: "doc-1", key: "obj-1" };
  const grant = { holder: "01JA7RUNAAAAAAAAAAAAAAAAAA", how: "handed", at: 1 };

  it("keeps an object's record as its name alone: a grant is no part of it", () => {
    expect(Object.keys(ObjectRecord.shape)).toEqual(["format", "ref", "docId", "key", "kind"]);
    expect(ObjectRecord.safeParse(name).success).toBe(true);
    expect(ObjectRecord.safeParse({ ...name, kind: "vibefield.mindmap" }).success).toBe(true);
    // a record written before the grants left still parses: its list is a key nobody reads
    expect(ObjectRecord.safeParse({ ...name, grants: [grant] }).success).toBe(true);
    expect(ObjectRecord.safeParse({ ...name, ref: "vf:obj/SHORT" }).success).toBe(false);
  });

  it("keeps every grant in one file: sealed or not, counted, each naming its object", () => {
    const file = ObjectGrantsFile.parse(fixture("object-grants-file.valid.json"));
    expect(file.format).toBe(OBJECT_GRANTS_FORMAT);
    expect(file.sealed).toBe(true);
    expect(file.generation).toBe(8);
    expect(file.grants.map((g) => [g.ref, g.holder, g.how])).toEqual([
      [REF, "spark:sp-7k2m9q4x", "handed"],
      ["vf:obj/2m9qx4k7", "01JA7RUNAAAAAAAAAAAAAAAAAA", "placed"],
    ]);
    // what the signer signs is the same shape without its signature
    const { signature: _signature, ...body } = file;
    expect(ObjectGrantsFile.safeParse(body).success).toBe(true);
    // the file a first change starts from: no grant, the count at zero
    const empty = { format: 1, sealed: false, generation: 0, grants: [] };
    expect(ObjectGrantsFile.safeParse(empty).success).toBe(true);
  });

  it("refuses a grants file with no count or no level, or a grant that names no object", () => {
    const whole = fixture("object-grants-file.valid.json") as Record<string, unknown>;
    for (const key of ["format", "sealed", "generation", "grants"]) {
      const rest = Object.fromEntries(Object.entries(whole).filter(([k]) => k !== key));
      expect(ObjectGrantsFile.safeParse(rest).success, key).toBe(false);
    }
    for (const generation of [-1, 1.5, "8"]) {
      const counted = { ...whole, generation };
      expect(ObjectGrantsFile.safeParse(counted).success, String(generation)).toBe(false);
    }
    expect(ObjectGrantsFile.safeParse({ ...whole, format: 2 }).success).toBe(false);
    expect(ObjectGrantsFile.safeParse({ ...whole, grants: [grant] }).success).toBe(false);
    const named = { ...grant, ref: REF };
    expect(ObjectGrantsFile.safeParse({ ...whole, grants: [named] }).success).toBe(true);
  });

  it("puts the grants file beside the objects' folder, never in it, under the user's root", () => {
    expect(LAYOUT.OBJECTS_GRANTS_FILE).toEqual(["fieldd", "objects.grants.json"]);
    // the store reads every .json in OBJECTS_DIR as an object's record
    const folder = LAYOUT.OBJECTS_DIR.join("/");
    expect(LAYOUT.OBJECTS_GRANTS_FILE.join("/").startsWith(`${folder}/`)).toBe(false);
    expect(LAYOUT.OBJECTS_GRANTS_FILE.slice(0, -1)).toEqual(LAYOUT.OBJECTS_DIR.slice(0, -1));
    expect(LAYOUT_ROOT_LEVEL).not.toContain("OBJECTS_GRANTS_FILE");
  });

  it("answers a take-back as taken, and says when the disk has not kept it yet", () => {
    expect(ObjectsTakeBackResult.parse({ taken: true }).kept).toBeUndefined();
    expect(ObjectsTakeBackResult.parse({ taken: true, kept: false }).kept).toBe(false);
    expect(ObjectsTakeBackResult.parse({ taken: true, kept: true }).kept).toBe(true);
    // a take-back always takes: there is no answer that says it did not
    expect(ObjectsTakeBackResult.safeParse({ taken: false, kept: false }).success).toBe(false);
  });
});

describe("who is at work on an object, as the window's feed carries it (item 550)", () => {
  it("carries a run's project, its spark and who started it as ids, each one optional", () => {
    const snapshot = ObjectsPresenceSnapshot.parse(fixture("objects-presence.valid.json"));
    const [own, crew] = snapshot.objects[0]?.agents ?? [];
    expect(own).toMatchObject({
      agent: "claude",
      project: { name: "vibe-field", seq: 2, ink: 5 },
      spark: "sp-7k2m9q4x",
    });
    expect(own?.startedBy).toBeUndefined();
    // a crew run: started by the spark, not its own session, and no colour dealt for its project yet
    expect(crew).toMatchObject({ project: { name: "vibe-field" }, startedBy: "sp-7k2m9q4x" });
    expect(crew?.spark).toBeUndefined();
    expect(crew?.project?.seq).toBeUndefined();
  });

  it("still reads a feed from before the ids, and keeps a field it does not know", () => {
    const whole = fixture("objects-presence.valid.json") as {
      objects: { agents: Record<string, unknown>[] }[];
    };
    const before = whole.objects.map((object) => ({
      ...object,
      agents: object.agents.map(({ project: _p, spark: _s, startedBy: _b, ...today }) => today),
    }));
    expect(ObjectsPresenceSnapshot.safeParse({ objects: before }).success).toBe(true);
    const later = {
      ...whole.objects[0]?.agents[0],
      project: { seq: 2, tint: "later" },
      crew: "c1",
    };
    const read = ObjectAtWork.parse(later);
    expect(read.project).toEqual({ seq: 2, tint: "later" });
    expect((read as Record<string, unknown>).crew).toBe("c1");
  });

  it("reads a malformed id as no id, and keeps the row", () => {
    const agent = (fixture("objects-presence.valid.json") as { objects: { agents: object[] }[] })
      .objects[0]?.agents[0];
    const read = (patch: Record<string, unknown>) => {
      const parsed = ObjectAtWork.safeParse({ ...agent, ...patch });
      expect(parsed.success, JSON.stringify(patch)).toBe(true);
      return parsed.data;
    };
    expect(read({ project: { seq: "amber" } })?.project).toEqual({});
    const named = read({ project: { ink: -1, name: "vibe-field" } });
    expect(named?.project).toEqual({ name: "vibe-field" });
    expect(read({ project: { name: "", seq: 2.5 } })?.project).toEqual({});
    expect(read({ project: "amber" })?.project).toBeUndefined();
    expect(read({ spark: "Vela" })?.spark).toBeUndefined();
    expect(read({ startedBy: "spark:sp-7k2m9q4x" })?.startedBy).toBeUndefined();
    const kept = read({ spark: "vela", project: { name: "", seq: 2.5 } });
    expect(kept).toMatchObject({ agent: "claude" });
  });

  it("still reads each well-formed id as itself", () => {
    const agent = (fixture("objects-presence.valid.json") as { objects: { agents: object[] }[] })
      .objects[0]?.agents[0];
    const ids = {
      project: { name: "vibe-field", seq: 0, ink: 11 },
      spark: "sp-7k2m9q4x",
      startedBy: "sp-a1b2c3",
    };
    expect(ObjectAtWork.parse({ ...agent, ...ids })).toMatchObject(ids);
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
