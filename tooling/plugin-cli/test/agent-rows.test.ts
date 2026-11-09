// OB-2 — `vibefield-plugin check` on a kind's agent half: its schemas compile, its guide is on disk within the manual's
// limit, and the object rows hold the manifest and the binding to each other.
import { OBJECT_LIMITS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { checkPlugin } from "../src/check";
import { REFUSAL_CATALOG } from "../src/refusals";
import { FIXTURE_ID, makePlugin, objectRendererModule } from "./fixtures";

const CLOCK = `${FIXTURE_ID}.clock`;
const GUIDE = "./assets/agent/guide.md";

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
  binding: { kind: "clock" },
});

const plugin = (agent: Record<string, unknown>, files: Record<string, string> = {}) =>
  makePlugin({
    manifest: {
      activation: [`onObject:${CLOCK}`],
      contributes: { objects: [objectRow(agent)] },
    },
    files: { ...files },
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
      files: { "dist/renderer.js": objectRendererModule() },
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
