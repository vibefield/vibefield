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
  /** TS-4 (TS-D7) — the status item's Connect Your Devices… and the away
   * notice's Connect…: Settings → Devices begins the link once it can read it,
   * as its own Connect does, and says it has (`connect` back to false). */
  readonly connect: boolean;
}

export const INITIAL_SHELL_PRESENTATION: ShellPresentationState = {
  diagnosticsRequest: 0,
  target: "general",
  connect: false,
};

/** Diagnostics requests are a monotonic sequence. General Settings changes
 * presentation intent without rewinding the sequence a mounted panel has
 * already acknowledged. */
export function reduceShellPresentation(
  state: ShellPresentationState,
  command: ShellCommand,
): ShellPresentationState {
  if (command === "open-diagnostics") {
    return { ...state, diagnosticsRequest: state.diagnosticsRequest + 1, target: "diagnostics" };
  }
  if (command === "open-connect") return { ...state, target: "devices", connect: true };
  return { ...state, target: command === "open-devices" ? "devices" : "general" };
}

const requests = new Set<(command: ShellCommand) => void>();

/** TS-4 — a renderer surface asks for what a native command asks for: the
 * filters' ghost row's Connect… opens the same Connect door as the status
 * item's Connect Your Devices…, and the chrome answers both the same way. */
export function requestShellPresentation(command: ShellCommand): void {
  for (const listener of [...requests]) listener(command);
}

export function onShellPresentationRequest(listener: (command: ShellCommand) => void): () => void {
  requests.add(listener);
  return () => {
    requests.delete(listener);
  };
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
