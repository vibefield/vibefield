import type { ShellCommand } from "@vibefield/contracts";

export interface ShellPresentationState {
  readonly diagnosticsRequest: number;
  readonly target: "general" | "diagnostics";
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
  return command === "open-diagnostics"
    ? { diagnosticsRequest: state.diagnosticsRequest + 1, target: "diagnostics" }
    : { ...state, target: "general" };
}
