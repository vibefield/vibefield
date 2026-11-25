// OB-2 — `vibefield-plugin check` on a kind's agent half: its schemas compile, its guide is on disk within the manual's
// limit, and the object rows hold the manifest and the binding to each other.
import {
  AGENT_TOOL_SCHEMA_AJV,
  DESK_KINDS,
  OBJECT_LIMITS,
  STICKER_LIMITS,
} from "@vibefield/contracts";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { checkPlugin } from "../src/check";
import { REFUSAL_CATALOG } from "../src/refusals";
import { baseManifest, FIXTURE_ID, makePlugin, objectRendererModule } from "./fixtures";

const CLOCK = `${FIXTURE_ID}.clock`;
const GUIDE = "./assets/agent/guide.md";
// OB-D16: a kind with an agent half carries its sticker, its art in its bundle; every row here has one unless it says
const STICKER = { art: "./assets/sticker.svg", radius: 4 };
const ART =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#f6e7a9"/></svg>';

const tool = (input: Record<string, unknown>) => ({
  name: "set_seconds",
  readOnly: false,
  description: "Show or hide the seconds hand.",
  input,
});

const objectRow = (agent: Record<string, unknown>) => ({
  type: CLOCK,
  title: "Clock",
  schemaVersion: 1,
  size: { w: 160, h: 160 },
  provides: ["desk.object"],
  tray: {
    category: "things",
    label: "Clock",
    hang: { w: 110, h: 110, accessory: "hook", pegs: [[0, -0.5]] },
  },
  agent: {
    summary: "A clock.",
    concurrency: "many",
    faces: [{ type: "ref" }],
    tools: [],
    ...agent,
  },
  sticker: STICKER,
  binding: { kind: "clock" },
});

const plugin = (agent: Record<string, unknown>, files: Record<string, string> = {}) =>
  makePlugin({
    manifest: {
      activation: [`onObject:${CLOCK}`],
      contributes: { objects: [objectRow(agent)] },
    },
    files: { "assets/sticker.svg": ART, ...files },
  });

const codes = (verdicts: Awaited<ReturnType<typeof checkPlugin>>) =>
  verdicts.filter((v) => v.level === "refuse").map((v) => v.code);

describe("check: the agent half", () => {
  it("compiles each tool's input and output with the daemon's ajv settings", async () => {
    const verdicts = await checkPlugin({
      dir: plugin({ tools: [tool({ type: "not-a-type" })] }),
      skipActivation: true,
    });
    expect(codes(verdicts)).toEqual(["schema-invalid"]);
    expect(verdicts.find((v) => v.code === "schema-invalid")?.pointer).toBe(
      "/contributes/objects/0/agent/tools/0/input",
    );
  });

  describe("refuses what the desk room would refuse at every call", () => {
    const refusalFor = async (tools: unknown[]) => {
      const verdicts = await checkPlugin({ dir: plugin({ tools }), skipActivation: true });
      return { codes: codes(verdicts), row: verdicts.find((v) => v.code === "schema-invalid") };
    };

    it("a format nothing here can check", async () => {
      const { codes: said, row } = await refusalFor([
        tool({ type: "object", properties: { mail: { type: "string", format: "email" } } }),
      ]);
      expect(said).toEqual(["schema-invalid"]);
      expect(row?.pointer).toBe("/contributes/objects/0/agent/tools/0/input");
      expect(row?.detail).toContain("format");
    });

    it("a keyword nothing here knows", async () => {
      const { codes: said, row } = await refusalFor([tool({ type: "object", nonsense: true })]);
      expect(said).toEqual(["schema-invalid"]);
      expect(row?.detail).toContain("nonsense");
    });

    it("in an output too", async () => {
      const { codes: said, row } = await refusalFor([
        { ...tool({ type: "object" }), output: { type: "object", nonsense: true } },
      ]);
      expect(said).toEqual(["schema-invalid"]);
      expect(row?.pointer).toBe("/contributes/objects/0/agent/tools/0/output");
    });

    it("but not two tools that share an $id", async () => {
      const shared = { $id: "https://example.test/input", type: "object" };
      const { codes: said } = await refusalFor([
        tool(shared),
        { ...tool(shared), name: "set_minutes" },
      ]);
      expect(said).toEqual([]);
    });

    it("and leaves a settings schema as it was", async () => {
      const verdicts = await checkPlugin({
        dir: makePlugin({
          manifest: {
            capabilities: ["storage.self"],
            contributes: {
              ...(baseManifest()["contributes"] as object),
              settings: {
                properties: {
                  mail: {
                    title: "Mail",
                    scope: "user",
                    schema: { type: "string", format: "email" },
                  },
                },
              },
            },
          },
        }),
        skipActivation: true,
      });
      expect(codes(verdicts)).not.toContain("schema-invalid");
    });
  });

  it("the built-in kinds' tools all compile under the room's own rule", () => {
    const ajv = new Ajv({ ...AGENT_TOOL_SCHEMA_AJV });
    expect(AGENT_TOOL_SCHEMA_AJV).toMatchObject({ strictSchema: true });
    for (const kind of DESK_KINDS)
      for (const tool of kind.agent.tools) expect(() => ajv.compile(tool.input)).not.toThrow();
  });

  it("finds the guide on disk", async () => {
    const verdicts = await checkPlugin({
      dir: plugin({ guide: GUIDE }),
      skipActivation: true,
    });
    expect(codes(verdicts)).toEqual(["agent-guide-missing"]);
  });

  it("passes a guide under assets within the limit", async () => {
    const verdicts = await checkPlugin({
      dir: plugin({ guide: GUIDE }, { "assets/agent/guide.md": "Read it first." }),
      skipActivation: true,
    });
    expect(codes(verdicts)).toEqual([]);
    expect(verdicts.map((v) => v.detail)).toEqual(
      expect.arrayContaining([`${CLOCK}'s agent guide is 14 bytes and ships`]),
    );
  });

  it("refuses a guide a manual could not carry", async () => {
    const verdicts = await checkPlugin({
      dir: plugin(
        { guide: GUIDE },
        { "assets/agent/guide.md": "x".repeat(OBJECT_LIMITS.GUIDE_BYTES + 1) },
      ),
      skipActivation: true,
    });
    expect(codes(verdicts)).toEqual(["agent-guide-too-large"]);
  });

  it("holds the manifest to the module the host will import", async () => {
    const dir = makePlugin({
      manifest: {
        activation: [`onObject:${CLOCK}`],
        contributes: { objects: [objectRow({ tools: [tool({ type: "object" })] })] },
      },
      files: { "dist/renderer.js": objectRendererModule(), "assets/sticker.svg": ART },
    });
    expect(codes(await checkPlugin({ dir }))).toEqual(["object-agent-unbound"]);
  });

  it("catalogs every code it can say", () => {
    for (const code of [
      "agent-guide-missing",
      "agent-guide-too-large",
      "object-agent-tool-unbound",
    ])
      expect(REFUSAL_CATALOG).toHaveProperty(code);
  });
});

describe("check: the sticker (OB-D16)", () => {
  const STICKER_CODES = [
    "sticker-missing",
    "sticker-art-missing",
    "sticker-art-too-large",
    "sticker-art-invalid",
    "sticker-art-unsafe",
  ] as const;
  const withSticker = (
    sticker: Record<string, unknown> | undefined,
    files: Record<string, string> = { "assets/sticker.svg": ART },
    agent = true,
  ) => {
    const { agent: half, sticker: _default, ...row } = objectRow({});
    return makePlugin({
      manifest: {
        activation: [`onObject:${CLOCK}`],
        contributes: {
          objects: [
            {
              ...row,
              ...(agent ? { agent: half } : {}),
              ...(sticker === undefined ? {} : { sticker }),
            },
          ],
        },
      },
      files,
    });
  };

  it("refuses a kind an agent can hold that shows no sticker", async () => {
    const verdicts = await checkPlugin({ dir: withSticker(undefined), skipActivation: true });
    expect(codes(verdicts)).toEqual(["sticker-missing"]);
    expect(verdicts.find((v) => v.code === "sticker-missing")?.pointer).toBe(
      "/contributes/objects/0",
    );
  });

  it("asks nothing of a kind with no agent half", async () => {
    const verdicts = await checkPlugin({
      dir: withSticker(undefined, {}, false),
      skipActivation: true,
    });
    expect(codes(verdicts)).toEqual([]);
  });

  it("finds the art on disk, small and sound, and says its size", async () => {
    const verdicts = await checkPlugin({ dir: withSticker(STICKER), skipActivation: true });
    expect(codes(verdicts)).toEqual([]);
    expect(verdicts.map((v) => v.detail)).toEqual(
      expect.arrayContaining([`${CLOCK}'s sticker is ${Buffer.byteLength(ART)} bytes and ships`]),
    );
  });

  it("refuses art that is not on disk", async () => {
    const verdicts = await checkPlugin({ dir: withSticker(STICKER, {}), skipActivation: true });
    expect(codes(verdicts)).toEqual(["sticker-art-missing"]);
    expect(verdicts.find((v) => v.code === "sticker-art-missing")?.pointer).toBe(
      "/contributes/objects/0/sticker/art",
    );
  });

  it("refuses art over the size a sticker carries", async () => {
    const big = ART.replace("</svg>", `<!--${"x".repeat(STICKER_LIMITS.ART_BYTES)}--></svg>`);
    const verdicts = await checkPlugin({
      dir: withSticker(STICKER, { "assets/sticker.svg": big }),
      skipActivation: true,
    });
    expect(codes(verdicts)).toEqual(["sticker-art-too-large"]);
  });

  it("refuses art that is no SVG a sticker can be cut from", async () => {
    for (const art of [
      '<html><svg viewBox="0 0 1 1"/></html>',
      "<svg><rect/></svg>",
      '<svg viewBox="0 0 10 40"/>',
    ]) {
      const verdicts = await checkPlugin({
        dir: withSticker(STICKER, { "assets/sticker.svg": art }),
        skipActivation: true,
      });
      expect(codes(verdicts), art).toEqual(["sticker-art-invalid"]);
    }
  });

  it("refuses art that holds a script, a handler or a reference outside itself", async () => {
    for (const inner of [
      "<script>1</script>",
      '<rect onclick="go()"/>',
      '<use href="https://example.com/a.svg#b"/>',
      '<rect style="fill:url(https://example.com/x)"/>',
      "<animate/>",
    ]) {
      const art = ART.replace("</svg>", `${inner}</svg>`);
      const verdicts = await checkPlugin({
        dir: withSticker(STICKER, { "assets/sticker.svg": art }),
        skipActivation: true,
      });
      expect(codes(verdicts), inner).toEqual(["sticker-art-unsafe"]);
    }
  });

  it("names each refusal in the catalog, under the artifact row", () => {
    for (const code of STICKER_CODES) expect(REFUSAL_CATALOG[code].check).toBe("artifact");
  });
});
