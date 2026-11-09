import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESK_KINDS, OBJECT_LIMITS, type PluginRecord } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { deskKinds, pluginDeskKinds } from "../src/objects/kinds";

// OB-3b — the one seam a kind is read through (OB-L2): the built-ins' table, and each enabled plugin's kinds, a guide
// read from the plugin's own folder. A kind with no agent half can be placed and named, and gives no tools.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const agentHalf = {
  summary: "A mind map.",
  concurrency: "one",
  faces: [{ type: "ref" }],
  guide: "./assets/agent/guide.md",
  tools: [
    {
      name: "outline",
      readOnly: true,
      description: "Read it.",
      input: { type: "object", properties: {} },
    },
  ],
};

const object = (type: string, agent?: unknown) => ({
  type,
  title: type,
  schemaVersion: 3,
  ...(agent !== undefined ? { agent } : {}),
});

const record = (id: string, enabled: boolean, objects: unknown[]) =>
  ({ id, enabled, contributions: { objects } }) as unknown as PluginRecord;

describe("the kinds a desk knows (OB-L2)", () => {
  it("reads the built-ins from the table, each by its type", () => {
    const kinds = deskKinds();
    expect(kinds.map((k) => k.kind)).toEqual(DESK_KINDS.map((k) => k.type));
    const note = kinds.find((k) => k.kind === "desk.note");
    const table = DESK_KINDS.find((k) => k.type === "desk.note");
    expect(note).toMatchObject({
      title: table?.title,
      version: table?.version,
      summary: table?.agent.summary,
      guide: table?.agent.guide,
      concurrency: table?.agent.concurrency,
    });
    expect(note?.tools.map((t) => t.name)).toEqual(table?.agent.tools.map((t) => t.name));
  });

  it("keeps Print from being placed", () => {
    expect(deskKinds().find((k) => k.kind === "desk.photo")?.placeable).toBe(false);
  });

  it("adds an enabled plugin's kinds, its guide read from the plugin's folder, its version the schema's", () => {
    const root = mkdtempSync(join(tmpdir(), "vf-kinds-"));
    roots.push(root);
    mkdirSync(join(root, "assets", "agent"), { recursive: true });
    writeFileSync(join(root, "assets", "agent", "guide.md"), "Read the outline first.");
    const [map] = pluginDeskKinds(
      [record("com.a", true, [object("a.map", agentHalf)])],
      () => root,
    );
    expect(map).toMatchObject({
      kind: "a.map",
      placeable: true,
      concurrency: "one",
      summary: "A mind map.",
      guide: "Read the outline first.",
      version: 3,
    });
    expect(map?.tools.map((t) => t.name)).toEqual(["outline"]);
    expect(deskKinds([map as never]).at(-1)?.kind).toBe("a.map");
  });

  it("gives a kind with no agent half no tools, and an agent no way to place it: no gesture opens a plugin's kind", () => {
    const [plain] = pluginDeskKinds([record("com.a", true, [object("a.plain")])], () => undefined);
    expect(plain).toMatchObject({ kind: "a.plain", placeable: false, concurrency: "many" });
    expect(plain?.tools).toEqual([]);
    expect(plain?.guide).toBeUndefined();
  });

  it("names the plugin a guide came from, and reads no more of it than the bound in bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "vf-kinds-"));
    roots.push(root);
    mkdirSync(join(root, "assets", "agent"), { recursive: true });
    writeFileSync(join(root, "assets", "agent", "guide.md"), "é".repeat(OBJECT_LIMITS.GUIDE_BYTES));
    const [map] = pluginDeskKinds(
      [{ ...record("com.a", true, [object("a.map", agentHalf)]), title: "Mind Maps" }],
      () => root,
    );
    expect(map?.guideFrom).toBe("Mind Maps");
    expect(Buffer.byteLength(map?.guide ?? "")).toBeLessThanOrEqual(OBJECT_LIMITS.GUIDE_BYTES);
    expect(map?.guide?.endsWith("\uFFFD")).toBe(false);
  });

  it("goes without a guide the plugin no longer ships, and skips a disabled plugin", () => {
    const root = mkdtempSync(join(tmpdir(), "vf-kinds-"));
    roots.push(root);
    const [map] = pluginDeskKinds(
      [record("com.a", true, [object("a.map", agentHalf)])],
      () => root,
    );
    expect(map?.guide).toBeUndefined();
    expect(
      pluginDeskKinds([record("com.b", false, [object("b.map", agentHalf)])], () => root),
    ).toEqual([]);
  });
});
