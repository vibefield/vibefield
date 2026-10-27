import type { ShellCommand } from "@vibefield/contracts";
import type { ProfilesRoute } from "../panels/agents/ProfilesSection";
import type { SettingsPage } from "../panels/SettingsDialog";

export interface ShellPresentationState {
  readonly diagnosticsRequest: number;
  /** Which page Settings opens on. `account` is the Me menu's name row and its
   * Link… act (UA-D19); `general` is Settings… and ⌘,; `devices` is a link
   * notice's click (TS-5); `new-profile` is the limit moment's Add a profile…
   * (AO-6b): Agent Profiles on its New profile… form. */
  readonly target: "general" | "diagnostics" | "account" | "devices" | "new-profile";
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

/** Where Settings opens for its target: the page, and — for the limit moment's
 * Add a profile… (AO-6b) — Agent Profiles on its New profile… form. Diagnostics
 * opens on General under the panel's own diagnostics switch. */
export function settingsOpening(target: ShellPresentationState["target"]): {
  page: SettingsPage;
  profiles?: ProfilesRoute;
} {
  if (target === "account" || target === "devices") return { page: target };
  if (target === "new-profile") return { page: "profiles", profiles: { kind: "new" } };
  return { page: "general" };
}
