import { describe, expect, it } from "vitest";
import { parseStudioHostCommandRequest } from "../src/studio/command-channel";

describe("Studio child-process command channel", () => {
  it("accepts only the versioned, closed lifecycle command envelope", () => {
    expect(
      parseStudioHostCommandRequest({
        version: 1,
        type: "vibefield.dev-command",
        requestId: "runner-4",
        command: { type: "studio.open", section: "design" },
      }),
    ).toEqual({
      requestId: "runner-4",
      command: { type: "studio.open", section: "design" },
    });
    expect(
      parseStudioHostCommandRequest({
        version: 1,
        type: "vibefield.dev-command",
        requestId: "runner-5",
        command: { type: "studio.status" },
      }),
    ).toEqual({ requestId: "runner-5", command: { type: "studio.status" } });
  });

  it.each([
    null,
    { version: 2, type: "vibefield.dev-command", requestId: "runner-1", command: {} },
    {
      version: 1,
      type: "vibefield.dev-command",
      requestId: "bad id",
      command: { type: "studio.status" },
    },
    {
      version: 1,
      type: "vibefield.dev-command",
      requestId: "runner-1",
      command: { type: "renderer.evaluate", script: "arbitrary" },
    },
    {
      version: 1,
      type: "vibefield.dev-command",
      requestId: "runner-1",
      command: { type: "studio.close", extra: true },
    },
  ])("rejects malformed or ambient command input: %j", (message) => {
    expect(parseStudioHostCommandRequest(message)).toBeNull();
  });
});
