// TC-D6(b) — the fieldd half of create-failure classification. The boundary is
// an upstream fact the TC-S0 agent pinned: openpty refusals keep their errno on
// the wire; spawn refusals are flattened to one string by anyhow's top-only
// rendering. This classifier must read the first and REFUSE to guess at the
// second.
import { describe, expect, it } from "vitest";
import { classifyOpenptyPressure } from "../src/terminal-service";

describe("classifyOpenptyPressure (TC-D6b)", () => {
  it("reads EMFILE out of the openpty debug rendering", () => {
    expect(
      classifyOpenptyPressure(
        'failed to openpty: Os { code: 24, kind: Uncategorized, message: "Too many open files" }',
      ),
    ).toBe("fd_pressure");
  });

  it("reads ENFILE (the system-wide table) the same way", () => {
    expect(
      classifyOpenptyPressure(
        'failed to openpty: Os { code: 23, kind: Uncategorized, message: "Too many open files in system" }',
      ),
    ).toBe("fd_pressure");
  });

  it("refuses to classify the flattened spawn string — that ambiguity is upstream's", () => {
    expect(classifyOpenptyPressure("failed to spawn PTY command")).toBeNull();
  });

  it("refuses a non-pressure openpty errno (EACCES is not exhaustion)", () => {
    expect(
      classifyOpenptyPressure(
        'failed to openpty: Os { code: 13, kind: PermissionDenied, message: "Permission denied" }',
      ),
    ).toBeNull();
  });
});
