// TC-D6(b) — the message half of create-failure classification. Since ghosttea
// 0.10.0 (G17) spawn refusals carry a typed {stage, code, osError} and are
// classified structurally in create; THIS function keeps the openpty half,
// where portable-pty stringifies the errno inside openpty() itself and the
// string stays the only carrier. The string-alone rows below are still law:
// the bare spawn message is as ambiguous as ever, and the classifier must
// refuse it — blame for spawn refusals is decided by `code`, never prose.
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

  it("refuses to classify the bare spawn string — its blame belongs to `code` (G17)", () => {
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
