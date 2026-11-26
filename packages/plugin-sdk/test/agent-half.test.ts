// @vitest-environment node
// OB-2 (§5.3) — the kit's agent half: the API a handler is handed (the wall), the manifest and binding held to each other,
// and each tool driven over a playground state's props with no document.
import type { ObjectContribution } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  type AgentActApi,
  type AgentHalf,
  agentActStillHolds,
  agentReadApi,
  recordAgentAct,
  sameAgentValue,
} from "../src/desk";
import {
  agentToolHarness,
  checkKindDeclaration,
  type KindVerdict,
  runKindConformance,
} from "../src/testing";
import { discKind, discRow } from "./fixtures/disc-kind";

const AGENT: NonNullable<ObjectContribution["agent"]> = {
  summary: "A disc.",
  concurrency: "many",
  faces: [{ type: "ref" }, { type: "text", id: "words", label: "Its words" }, { type: "image" }],
  tools: [
    {
      name: "color_of",
      readOnly: true,
      description: "Read the disc's color.",
      input: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "paint",
      readOnly: false,
      description: "Paint the disc.",
      input: {
        type: "object",
        properties: { color: { type: "string", maxLength: 32 } },
        required: ["color"],
      },
    },
  ],
};

const HALF: AgentHalf = {
  summary: (api) => ({ color: api.props()["color"] }),
  faces: { words: (api) => String(api.props()["color"]) },
  read: { color_of: (api) => ({ color: api.props()["color"] }) },
  act: {
    paint: (api, input) => {
      api.setProps({ color: input["color"] });
      return { value: { color: input["color"] }, changed: "Painted the disc" };
    },
  },
};

const rowWithAgent = (agent = AGENT): ObjectContribution => discRow({ agent });

const refusalsOf = (verdicts: readonly KindVerdict[]) =>
  verdicts.filter((v) => v.status === "refused").map((v) => v.code);

describe("the handler's API", () => {
  it("a read handler holds nothing to write with: no setProps, no world, and its props are a copy", () => {
    const props = { color: "red", nested: { a: 1 } };
    const api = agentReadApi(props);
    expect(Object.keys(api)).toEqual(["props"]);
    (api.props() as { nested: { a: number } }).nested.a = 2;
    expect(props.nested.a).toBe(1);
  });

  it("every setProps of an act is one change, with the prior values kept for its undo", () => {
    const recording = recordAgentAct({ color: "red", size: 1, label: "x" });
    recording.api.setProps({ color: "blue" });
    recording.api.setProps({ size: 2 });
    recording.api.setProps({ color: "green" });
    expect(recording.inverse()).toEqual({
      after: { color: "green", size: 2 },
      before: { color: "red", size: 1 },
    });
  });

  it("an act sees what it has set so far, and an unchanged prop is no change", () => {
    const recording = recordAgentAct({ color: "red" });
    recording.api.setProps({ color: "blue" });
    expect(recording.api.props()).toEqual({ color: "blue" });
    recording.api.setProps({ color: "red" });
    expect(recording.inverse()).toBeUndefined();
  });

  it("an act's undo applies only to an object that still holds what the act set, whatever the key order", () => {
    const inverse = { after: { box: { x: 1, y: 2 } }, before: { box: { x: 0, y: 0 } } };
    expect(agentActStillHolds({ box: { y: 2, x: 1 }, other: 3 }, inverse)).toBe(true);
    expect(agentActStillHolds({ box: { x: 9, y: 2 } }, inverse)).toBe(false);
    expect(sameAgentValue([1, { a: 2 }], [1, { a: 2 }])).toBe(true);
    expect(sameAgentValue([1], { 0: 1 })).toBe(false);
  });
});

describe("check: the manifest's agent block against the binding's agent", () => {
  const verdictsFor = (agent: unknown, row = rowWithAgent()) =>
    refusalsOf(
      checkKindDeclaration({ kind: discKind({}), ...(agent === undefined ? {} : { agent }) }, row),
    );

  it("passes a kind whose tools and faces are bound both ways", () => {
    expect(verdictsFor(HALF)).toEqual([]);
  });

  it("refuses a block with no handlers, and handlers with no block", () => {
    expect(verdictsFor(undefined)).toEqual(["object-agent-unbound"]);
    expect(verdictsFor(HALF, discRow())).toEqual(["object-agent-undeclared"]);
  });

  it("refuses a kind that cannot say what it holds", () => {
    expect(verdictsFor({ ...HALF, summary: undefined })).toEqual(["object-agent-summary-missing"]);
  });

  // R-2's follow-up (2026-11-19): a kind whose tools are a room's rows, as the browser pane's agent half declares it
  const ROOM_AGENT: NonNullable<ObjectContribution["agent"]> = {
    summary: "A web page.",
    concurrency: "many",
    faces: [{ type: "ref" }, { type: "image" }],
    tools: [],
    room: "pages",
  };

  it("passes a kind whose tools are a room's rows with no agent on its binding: the room answers for it", () => {
    expect(verdictsFor(undefined, rowWithAgent(ROOM_AGENT))).toEqual([]);
  });

  it("refuses an agent bound on such a kind, since it would never be called, and says what to do", () => {
    const verdicts = checkKindDeclaration(
      { kind: discKind({}), agent: { summary: () => ({}) } },
      rowWithAgent(ROOM_AGENT),
    ).filter((v) => v.status === "refused");
    expect(verdicts.map((v) => v.code)).toEqual(["object-agent-room-bound"]);
    expect(verdicts[0]?.detail).toContain("would never be called: remove it, or drop `room`");
  });

  it("names a tool with no handler, and a handler with no tool", () => {
    expect(verdictsFor({ ...HALF, read: {} })).toEqual(["object-agent-tool-unbound"]);
    expect(verdictsFor({ ...HALF, read: { ...HALF.read, extra: () => null } })).toEqual([
      "object-agent-tool-undeclared",
    ]);
  });

  it("refuses a readOnly tool bound under act, which is the only side that can write", () => {
    const act: Record<string, (api: AgentActApi) => undefined> = {
      ...(HALF.act as Record<string, (api: AgentActApi) => undefined>),
      color_of: () => undefined,
    };
    expect(verdictsFor({ ...HALF, read: {}, act })).toEqual(["object-agent-tool-misbound"]);
  });

  it("names a text face with no handler, and a face handler with no face", () => {
    expect(verdictsFor({ ...HALF, faces: {} })).toEqual(["object-agent-face-unbound"]);
    expect(verdictsFor({ ...HALF, faces: { ...HALF.faces, other: () => "" } })).toEqual([
      "object-agent-face-undeclared",
    ]);
  });
});

describe("the in-memory tool harness", () => {
  it("runs a tool over a state's props: reads change nothing, an act lands, its inverse restores it", () => {
    const harness = agentToolHarness(HALF, rowWithAgent(), { color: "red" });
    expect(harness.summary()).toEqual({ color: "red" });
    expect(harness.face("words")).toBe("red");
    expect(harness.read("color_of")).toEqual({ color: "red" });
    const { value, changed, inverse } = harness.act("paint", { color: "blue" });
    expect([value, changed]).toEqual([{ color: "blue" }, "Painted the disc"]);
    expect(harness.props()["color"]).toBe("blue");
    expect(inverse && harness.undo(inverse)).toBe(true);
    expect(harness.props()["color"]).toBe("red");
  });

  it("will not undo over a later change", () => {
    const harness = agentToolHarness(HALF, rowWithAgent(), { color: "red" });
    const { inverse } = harness.act("paint", { color: "blue" });
    harness.act("paint", { color: "green" });
    expect(inverse && harness.undo(inverse)).toBe(false);
    expect(harness.props()["color"]).toBe("green");
  });

  it("refuses a write to a prop the manifest does not declare", () => {
    const half: AgentHalf = {
      ...HALF,
      act: {
        paint: (api) => {
          api.setProps({ nonsense: 1 });
          return undefined;
        },
      },
    };
    expect(() => agentToolHarness(half, rowWithAgent(), {}).act("paint", { color: "x" })).toThrow(
      /nonsense is not a declared prop/,
    );
  });
});

describe("runKindConformance drives the agent half over each fixture", () => {
  const conform = (agent: AgentHalf, states?: Record<string, Record<string, unknown>>) =>
    runKindConformance({
      binding: { kind: discKind({}), agent },
      row: rowWithAgent(),
      createBudgetMs: 200,
      ...(states === undefined ? {} : { states }),
    });

  it("says each fixture's agent half answered", async () => {
    const report = await conform(HALF, { default: {}, red: { color: "red" } });
    expect(refusalsOf(report.verdicts)).toEqual([]);
    expect(report.verdicts.map((v) => v.detail)).toEqual(
      expect.arrayContaining(["its agent half answered its summary, 1 face(s) and 2 tool(s)"]),
    );
  });

  it("makes each tool's input from its schema", async () => {
    let seen: unknown;
    await conform({
      ...HALF,
      act: {
        paint: (api, input) => {
          seen = input;
          api.setProps({ color: "x" });
          return { value: null };
        },
      },
    });
    expect(seen).toEqual({ color: "x" });
  });

  it("says a handler threw, by which tool and which fixture", async () => {
    const report = await conform({
      ...HALF,
      read: {
        color_of: () => {
          throw new Error("no color here");
        },
      },
    });
    expect(refusalsOf(report.verdicts)).toEqual(["state-agent-failed"]);
    expect(report.verdicts.find((v) => v.code === "state-agent-failed")?.detail).toContain(
      "tool color_of threw: no color here",
    );
  });

  it("says a summary is too large to open", async () => {
    const report = await conform({ ...HALF, summary: () => ({ text: "x".repeat(9_000) }) });
    expect(report.verdicts.find((v) => v.code === "state-agent-failed")?.detail).toContain(
      "summary answered more than the 8000 bytes",
    );
  });

  it("says an act wrote a value the manifest would refuse", async () => {
    const report = await conform({
      ...HALF,
      act: {
        paint: (api) => {
          api.setProps({ color: 7 });
          return undefined;
        },
      },
    });
    expect(report.verdicts.find((v) => v.code === "state-agent-failed")?.detail).toContain(
      "tool paint threw",
    );
  });

  it("leaves a kind with no agent half as it was", async () => {
    const report = await runKindConformance({
      binding: { kind: discKind({}) },
      row: discRow(),
      createBudgetMs: 200,
    });
    expect(refusalsOf(report.verdicts)).toEqual([]);
    expect(report.verdicts.some((v) => v.detail.includes("agent half"))).toBe(false);
  });
});
