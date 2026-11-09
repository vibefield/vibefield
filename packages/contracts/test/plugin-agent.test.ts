// OB-2 (§5.3, OB-L2) — a kind declares what an agent can do with it, once, in `contributes.objects[].agent`. This is the
// manifest's law for that block: the fixture stands, and each thing the kit cannot repair later is refused here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentHalfProblems,
  DESK_KINDS,
  deskKind,
  OBJECT_LIMITS,
  validatePluginManifest,
} from "../src";

type Row = Record<string, unknown> & { agent: Record<string, unknown> };

const fixture = (): { contributes: { objects: Row[] } } =>
  JSON.parse(readFileSync(join(__dirname, "../fixtures/plugin-manifest.objects.json"), "utf8"));

const withAgent = (patch: Record<string, unknown>) => {
  const manifest = fixture();
  const row = manifest.contributes.objects[0] as Row;
  row.agent = { ...row.agent, ...patch };
  return validatePluginManifest(manifest);
};

const messages = (result: ReturnType<typeof validatePluginManifest>): readonly string[] =>
  result.ok ? [] : result.issueDetails.map((issue) => issue.message);

describe("the manifest's agent block", () => {
  it("takes the fixture's kind: a ref first, a guide under assets, one acting tool", () => {
    const result = validatePluginManifest(fixture());
    expect(messages(result)).toEqual([]);
    expect(result.ok && result.manifest.contributes?.objects?.[0]?.agent?.concurrency).toBe("many");
  });

  it("is optional: a kind with no agent half is a kind agents can only place", () => {
    const manifest = fixture();
    delete (manifest.contributes.objects[0] as Partial<Row>).agent;
    expect(validatePluginManifest(manifest).ok).toBe(true);
  });

  it("refuses a guide that the bundle would not ship", () => {
    expect(messages(withAgent({ guide: "./docs/guide.md" }))).toEqual([
      expect.stringContaining("must live under ./assets/"),
    ]);
  });

  it("refuses a kind whose first face is not the object itself, or that names two", () => {
    expect(messages(withAgent({ faces: [{ type: "image" }, { type: "ref" }] }))).toEqual([
      expect.stringContaining("exactly one ref face, first"),
    ]);
    expect(messages(withAgent({ faces: [{ type: "ref" }, { type: "ref" }] }))).toEqual([
      expect.stringContaining("exactly one ref face, first"),
    ]);
  });

  it("refuses a face the card could not carry", () => {
    expect(messages(withAgent({ faces: [{ type: "ref" }, { type: "text" }] }))).toEqual([
      "a text face needs an id and a label",
    ]);
    expect(messages(withAgent({ faces: [{ type: "ref" }, { type: "session" }] }))).toEqual([
      "a session is an agent's card, never a kind's face",
    ]);
    expect(
      messages(withAgent({ faces: [{ type: "ref" }, { type: "image" }, { type: "image" }] })),
    ).toEqual(["a kind has one picture: at most one image face"]);
    expect(
      messages(
        withAgent({
          faces: [
            { type: "ref" },
            { type: "text", id: "a", label: "A" },
            { type: "file", id: "a", label: "B" },
          ],
        }),
      ),
    ).toEqual(["duplicate face id a"]);
  });

  it("refuses two tools of one name, a destructive read, and more tools than a manual can teach", () => {
    const tool = (name: string, extra: Record<string, unknown> = {}) => ({
      name,
      readOnly: true,
      description: "A tool.",
      input: { type: "object" },
      ...extra,
    });
    expect(messages(withAgent({ tools: [tool("a"), tool("a")] }))).toEqual([
      "duplicate tool name a",
    ]);
    expect(messages(withAgent({ tools: [tool("a", { destructive: true })] }))).toEqual([
      "read-only tool a cannot be destructive",
    ]);
    const many = Array.from({ length: OBJECT_LIMITS.TOOLS_PER_KIND + 1 }, (_, i) => tool(`t${i}`));
    expect(withAgent({ tools: many }).ok).toBe(false);
    expect(withAgent({ tools: [tool("Not-A-Name")] }).ok).toBe(false);
  });
});

describe("the built-in kinds' durable halves", () => {
  it("declares the four the desk offers, each held to the manifest's own law", () => {
    expect(DESK_KINDS.map((kind) => [kind.type, kind.title])).toEqual([
      ["desk.note", "Note"],
      ["desk.photo", "Print"],
      ["desk.board", "Whiteboard"],
      ["desk.minimat", "Mini mat"],
    ]);
    for (const kind of DESK_KINDS) {
      expect(agentHalfProblems(kind.agent)).toEqual([]);
      expect(new TextEncoder().encode(kind.agent.guide ?? "").byteLength).toBeLessThanOrEqual(
        OBJECT_LIMITS.GUIDE_BYTES,
      );
    }
  });

  it("gives the note its words and the mat its name, and a print no way to be made by an agent", () => {
    expect(deskKind("desk.note")?.agent.tools.map((tool) => [tool.name, tool.readOnly])).toEqual([
      ["read_text", true],
      ["write_text", false],
    ]);
    expect(deskKind("desk.note")?.agent.faces.map((face) => face.label)).toEqual([
      "Live",
      "Its words",
      "Picture",
    ]);
    expect(deskKind("desk.minimat")?.agent.tools.map((tool) => tool.name)).toEqual(["rename"]);
    expect(deskKind("desk.photo")?.placeable).toBe(false);
    expect(deskKind("no.such.kind")).toBeUndefined();
  });
});
