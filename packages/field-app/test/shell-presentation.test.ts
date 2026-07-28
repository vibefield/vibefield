import { describe, expect, it } from "vitest";
import {
  INITIAL_SHELL_PRESENTATION,
  reduceShellPresentation,
} from "../src/field/shell-presentation";

describe("shell presentation sequencing", () => {
  it("never reuses a diagnostics request after an intervening Settings command", () => {
    const firstDiagnostics = reduceShellPresentation(
      INITIAL_SHELL_PRESENTATION,
      "open-diagnostics",
    );
    const settings = reduceShellPresentation(firstDiagnostics, "open-settings");
    const secondDiagnostics = reduceShellPresentation(settings, "open-diagnostics");

    expect(firstDiagnostics).toEqual({ diagnosticsRequest: 1, target: "diagnostics" });
    expect(settings).toEqual({ diagnosticsRequest: 1, target: "general" });
    expect(secondDiagnostics).toEqual({ diagnosticsRequest: 2, target: "diagnostics" });
  });
});
