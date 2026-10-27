import type { ShellCommand } from "@vibefield/contracts";

export interface ShellPresentationState {
  readonly diagnosticsRequest: number;
  /** Which page Settings opens on. `account` is the Me menu's name row and its
   * Link… act (UA-D19); `general` is Settings… and ⌘,; `devices` is a link
   * notice's click (TS-5). */
  readonly target: "general" | "diagnostics" | "account" | "devices";
}

export const INITIAL_SHELL_PRESENTATION: ShellPresentationState = {
  diagnosticsRequest: 0,
  target: "general",
};

/** Diagnostics requests are a monotonic sequence. General Settings changes
 * presentation intent without rewinding the sequence a mounted panel has
 * already acknowledged. */
export function reduceShellPresentation(
  state: ShellPresentationState,
  command: ShellCommand,
): ShellPresentationState {
  if (command === "open-diagnostics") {
    return { diagnosticsRequest: state.diagnosticsRequest + 1, target: "diagnostics" };
  }
  return { ...state, target: command === "open-devices" ? "devices" : "general" };
}
