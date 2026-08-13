// The refusals, each with the control that proves it can pass. A refusal test
// without its green twin proves only that the command said no — it does not
// prove the command said no for the reason it claimed, and a scaffolder that
// refuses everything would pass a suite made only of red rows.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REFUSAL_CATALOG, type RefusalCode } from "../src/refusals";
import { scaffoldPlugin } from "../src/scaffold";
import type { Verdict } from "../src/verdict";
import { freshDir, unusedPath, VALID, writeAt } from "./fixtures";

function codes(verdicts: readonly Verdict[]): string[] {
  return verdicts.filter((v) => v.level === "refuse").map((v) => v.code);
}

describe("target-not-empty — the global scaffolding law", () => {
  it("refuses a directory that already holds anything, and touches nothing in it", async () => {
    const root = freshDir();
    const existing = writeAt(root, "README.md", "someone's work\n");

    const result = await scaffoldPlugin({ ...VALID, dir: root });

    expect(codes(result.verdicts)).toEqual(["target-not-empty"]);
    expect(result.root).toBeUndefined();
    // The file is untouched AND it is still the only thing there — a scaffolder
    // that refused after writing half a template would pass the first assertion.
    expect(readFileSync(existing, "utf8")).toBe("someone's work\n");
    expect(readdirSync(root)).toEqual(["README.md"]);
  });

  it("refuses a directory holding only a dotfile — hidden entries count", async () => {
    const root = freshDir();
    writeAt(root, ".git/HEAD", "ref: refs/heads/main\n");
    const result = await scaffoldPlugin({ ...VALID, dir: root });
    expect(codes(result.verdicts)).toEqual(["target-not-empty"]);
  });

  // THE CONTROL: the same call, into a directory that is empty rather than not.
  it("accepts an empty directory that already exists", async () => {
    const root = freshDir();
    const result = await scaffoldPlugin({ ...VALID, dir: root });
    expect(codes(result.verdicts)).toEqual([]);
    expect(existsSync(join(root, "vibefield.plugin.json"))).toBe(true);
  });

  it("accepts a target that does not exist yet, creating parents", async () => {
    const root = join(freshDir(), "nested", "deeper", "plugin");
    const result = await scaffoldPlugin({ ...VALID, dir: root });
    expect(codes(result.verdicts)).toEqual([]);
    expect(statSync(root).isDirectory()).toBe(true);
  });
});

describe("id-invalid — the id is the contract's, not ours", () => {
  it.each([
    ["demo", "a single-segment dev alias is not distributable"],
    ["Vendor.Demo", "segments are lowercase"],
    ["vendor..demo", "an empty segment"],
    ["1vendor.demo", "a segment starting with a digit"],
    ["vendor.demo!", "a character outside the grammar"],
    ["", "nothing at all"],
  ])("refuses %j — %s", async (id) => {
    const result = await scaffoldPlugin({ id, title: VALID.title, dir: unusedPath() });
    expect(codes(result.verdicts)).toEqual(["id-invalid"]);
  });

  // THE CONTROL: the shapes §6.1 actually allows, including a long chain and
  // hyphens inside a segment.
  it.each(["vendor.demo", "com.example.notes", "my-vendor.my-plugin", "a.b.c.d"])(
    "accepts %j",
    async (id) => {
      const result = await scaffoldPlugin({ id, title: VALID.title, dir: unusedPath() });
      expect(codes(result.verdicts)).toEqual([]);
    },
  );

  it("writes nothing when the id is refused", async () => {
    const dir = unusedPath();
    await scaffoldPlugin({ id: "demo", title: VALID.title, dir });
    expect(existsSync(dir)).toBe(false);
  });
});

describe("id-reserved — vibefield.* belongs to the built-ins", () => {
  it("refuses a third-party scaffold in the reserved namespace", async () => {
    const result = await scaffoldPlugin({
      id: "vibefield.notes",
      title: VALID.title,
      dir: unusedPath(),
    });
    expect(codes(result.verdicts)).toEqual(["id-reserved"]);
  });

  // THE CONTROL: the same id, declared first-party.
  it("accepts it with --first-party", async () => {
    const result = await scaffoldPlugin({
      id: "vibefield.notes",
      title: VALID.title,
      dir: unusedPath(),
      firstParty: true,
    });
    expect(codes(result.verdicts)).toEqual([]);
  });

  // THE OTHER CONTROL: the check is the first SEGMENT, not a substring — a
  // vendor whose name merely contains the word is not reserved.
  it("does not refuse a vendor that only looks reserved", async () => {
    for (const id of ["vibefields.thing", "my-vibefield.thing", "thing.vibefield"]) {
      const result = await scaffoldPlugin({ id, title: VALID.title, dir: unusedPath() });
      expect(codes(result.verdicts)).toEqual([]);
    }
  });
});

describe("dir-uncreatable", () => {
  it("refuses when the target path is a file", async () => {
    const root = freshDir();
    const asFile = writeAt(root, "plugin", "not a directory\n");
    const result = await scaffoldPlugin({ ...VALID, dir: asFile });
    expect(codes(result.verdicts)).toEqual(["dir-uncreatable"]);
    expect(readFileSync(asFile, "utf8")).toBe("not a directory\n");
  });

  it("refuses when a parent of the target is a file", async () => {
    const root = freshDir();
    writeAt(root, "parent", "not a directory\n");
    const result = await scaffoldPlugin({ ...VALID, dir: join(root, "parent", "plugin") });
    expect(codes(result.verdicts)).toEqual(["dir-uncreatable"]);
  });

  // THE CONTROL: the same shape of path, with a real directory as the parent.
  it("accepts when the parent is a directory", async () => {
    const root = freshDir();
    const result = await scaffoldPlugin({ ...VALID, dir: join(root, "plugin") });
    expect(codes(result.verdicts)).toEqual([]);
  });
});

describe("title-invalid", () => {
  it("refuses an empty title, and one that is only whitespace", async () => {
    for (const title of ["", "   ", "\n"]) {
      const result = await scaffoldPlugin({ id: VALID.id, title, dir: unusedPath() });
      expect(codes(result.verdicts)).toEqual(["title-invalid"]);
    }
  });

  it("refuses a title over the manifest's limit", async () => {
    const result = await scaffoldPlugin({
      id: VALID.id,
      title: "x".repeat(81),
      dir: unusedPath(),
    });
    expect(codes(result.verdicts)).toEqual(["title-invalid"]);
  });

  // THE CONTROL: the boundary itself passes — an off-by-one here would refuse a
  // legal title, which is the failure an author cannot argue with.
  it("accepts a title exactly at the limit", async () => {
    const result = await scaffoldPlugin({
      id: VALID.id,
      title: "x".repeat(80),
      dir: unusedPath(),
    });
    expect(codes(result.verdicts)).toEqual([]);
  });
});

describe("widget-type-invalid — every contributed id is owned by the plugin id", () => {
  it.each([
    ["other.card", "a type under someone else's id"],
    ["vendor.demoish", "a prefix match that is not a segment boundary"],
    ["vendor.demo.", "a trailing dot"],
    ["vendor.demo.Card", "an uppercase segment"],
    // ONE segment under the id, never two: `isOwnedName` tests the remainder
    // against the single-segment pattern, not against the dotted-id grammar.
    // Found by the emit backstop refusing a plan this file first accepted.
    ["vendor.demo.a.b", "two segments under the id"],
  ])("refuses %j — %s", async (widgetType) => {
    const result = await scaffoldPlugin({ ...VALID, widgetType, dir: unusedPath() });
    expect(codes(result.verdicts)).toEqual(["widget-type-invalid"]);
  });

  // THE CONTROL: the id itself and one name under it, which are the two legal shapes.
  it.each(["vendor.demo", "vendor.demo.card", "vendor.demo.a-card"])(
    "accepts %j",
    async (widgetType) => {
      const result = await scaffoldPlugin({ ...VALID, widgetType, dir: unusedPath() });
      expect(codes(result.verdicts)).toEqual([]);
    },
  );

  it("defaults the widget type to the plugin id", async () => {
    const dir = unusedPath();
    const result = await scaffoldPlugin({ ...VALID, dir });
    expect(result.plan?.widgetType).toBe(VALID.id);
    const manifest: unknown = JSON.parse(readFileSync(join(dir, "vibefield.plugin.json"), "utf8"));
    expect((manifest as { activation: string[] }).activation).toEqual([`onWidget:${VALID.id}`]);
  });
});

describe("the catalog is the enumeration", () => {
  it("declares every code the scaffolder can emit, at the level it emits it", async () => {
    const emitted = new Map<string, string>();
    const record = (verdicts: readonly Verdict[]): void => {
      for (const v of verdicts) if (v.level !== "pass") emitted.set(v.code, v.level);
    };

    record((await scaffoldPlugin({ id: "demo", title: "x", dir: unusedPath() })).verdicts);
    record((await scaffoldPlugin({ id: "vibefield.x", title: "x", dir: unusedPath() })).verdicts);
    record((await scaffoldPlugin({ id: VALID.id, title: "", dir: unusedPath() })).verdicts);
    record((await scaffoldPlugin({ ...VALID, widgetType: "other.x", dir: unusedPath() })).verdicts);
    const occupied = freshDir();
    writeAt(occupied, "a", "a");
    record((await scaffoldPlugin({ ...VALID, dir: occupied })).verdicts);
    record((await scaffoldPlugin({ ...VALID, dir: writeAt(freshDir(), "f", "f") })).verdicts);
    record((await scaffoldPlugin({ ...VALID, dir: unusedPath() })).verdicts);

    expect(emitted.size).toBeGreaterThan(0);
    for (const [code, level] of emitted) {
      const declared = REFUSAL_CATALOG[code as RefusalCode];
      expect(declared, `${code} is emitted but not declared in the catalog`).toBeDefined();
      expect(declared.level, `${code} is emitted as ${level}`).toBe(level);
    }
  });
});
