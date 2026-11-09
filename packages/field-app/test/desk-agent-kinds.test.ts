// OB-3c — the built-in kinds' handlers against their durable halves. Type strings cross the seam as literals (fieldd reads
// `desk-kinds.ts` and cannot import ICE), so this is the test that ties them to ICE's own constants.
import { BOARD_TYPE, MINIMAT_TYPE, NOTE_TYPE, PHOTO_TYPE } from "@vibecook/ice/desk/objects";
import { agentFaceHasHandler, DESK_KINDS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { BUILT_IN_AGENT_HALVES } from "../src/field/desk/agent-kinds";

describe("the built-in kinds' agent halves", () => {
  it("pins every declared type to ICE's own constant", () => {
    expect(DESK_KINDS.map((kind) => kind.type)).toEqual([
      NOTE_TYPE,
      PHOTO_TYPE,
      BOARD_TYPE,
      MINIMAT_TYPE,
    ]);
  });

  it.each(DESK_KINDS.map((kind) => [kind.type, kind] as const))(
    "%s: its handlers and its declaration agree, both ways",
    (_type, kind) => {
      const half = BUILT_IN_AGENT_HALVES.get(kind.type);
      expect(half).toBeDefined();
      const tools = kind.agent.tools;
      expect(Object.keys(half?.read ?? {}).sort()).toEqual(
        tools.filter((tool) => tool.readOnly).map((tool) => tool.name).sort(),
      );
      expect(Object.keys(half?.act ?? {}).sort()).toEqual(
        tools.filter((tool) => !tool.readOnly).map((tool) => tool.name).sort(),
      );
      expect(Object.keys(half?.faces ?? {}).sort()).toEqual(
        kind.agent.faces.filter(agentFaceHasHandler).map((face) => face.id).sort(),
      );
    },
  );
});
