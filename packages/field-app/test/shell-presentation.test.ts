import type { ShellCommand } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  INITIAL_SHELL_PRESENTATION,
  onShellPresentationRequest,
  reduceShellPresentation,
  requestShellPresentation,
} from "../src/field/shell-presentation";

describe("shell presentation sequencing", () => {
  it("never reuses a diagnostics request after an intervening Settings command", () => {
    const firstDiagnostics = reduceShellPresentation(
      INITIAL_SHELL_PRESENTATION,
      "open-diagnostics",
    );
    const settings = reduceShellPresentation(firstDiagnostics, "open-settings");
    const secondDiagnostics = reduceShellPresentation(settings, "open-diagnostics");

    expect(firstDiagnostics).toEqual({
      diagnosticsRequest: 1,
      target: "diagnostics",
      connect: false,
    });
    expect(settings).toEqual({ diagnosticsRequest: 1, target: "general", connect: false });
    expect(secondDiagnostics).toEqual({
      diagnosticsRequest: 2,
      target: "diagnostics",
      connect: false,
    });
  });

  it("opens Settings → Devices for a link notice's click (TS-5), keeping the sequence", () => {
    const diagnostics = reduceShellPresentation(INITIAL_SHELL_PRESENTATION, "open-diagnostics");
    const devices = reduceShellPresentation(diagnostics, "open-devices");
    expect(devices).toEqual({ diagnosticsRequest: 1, target: "devices", connect: false });
  });

  it("opens Settings → Devices to begin the link for the status item's Connect Your Devices… (TS-4)", () => {
    const connect = reduceShellPresentation(INITIAL_SHELL_PRESENTATION, "open-connect");
    expect(connect).toEqual({ diagnosticsRequest: 0, target: "devices", connect: true });
    // a link notice's click opens the page without beginning anything new
    expect(reduceShellPresentation(INITIAL_SHELL_PRESENTATION, "open-devices").connect).toBe(false);
  });

  it("hands a page surface's request to the chrome as a native command is (TS-4's ghost rows)", () => {
    const heard: ShellCommand[] = [];
    const stop = onShellPresentationRequest((command) => heard.push(command));
    requestShellPresentation("open-connect");
    stop();
    requestShellPresentation("open-connect");
    expect(heard).toEqual(["open-connect"]);
  });
});
