import { commitOfBuildId } from "@vibefield/contracts";

// The Mac's About panel, macOS's own (VibeField › About VibeField; app-menu-model's role "about").
// AU-4 (AU-G9) — About names the version and the commit its build id records: "Version
// 0.1.0-nightly.20261027 (84509d6)". With no staged build id (development, a stage before WP12c)
// the commit is left to macOS.
// LP (Q3.2; James, 2026-11-12) — under the version it carries the phone's About foot, word for word
// (DESIGN.md §9 Voice, "The phone's legal words"; the phone's copy is `SettingsModel.aboutFoot`).

/** Tailscale's trademark line, which opens the phone's foot (DESIGN.md §13). */
export const ABOUT_TRADEMARK = "Tailscale is a registered trademark of Tailscale Inc.";

/** The non-affiliation line, word for word the phone's `SettingsWords.notAffiliated`. */
export const ABOUT_NOT_AFFILIATED =
  "VibeField names agents such as Claude Code and Codex to tell sessions apart. " +
  "It isn’t affiliated with or endorsed by Anthropic or OpenAI.";

export interface AboutPanelOptions {
  readonly applicationName: string;
  readonly applicationVersion: string;
  readonly version?: string;
  readonly credits: string;
}

/** `app.setAboutPanelOptions`'s argument on macOS, as a function so a unit reaches it. */
export function aboutPanelOptions(
  applicationVersion: string,
  buildId: string | null | undefined,
): AboutPanelOptions {
  const commit = commitOfBuildId(buildId);
  return {
    applicationName: "VibeField",
    applicationVersion,
    ...(commit !== undefined ? { version: commit } : {}),
    // Both lines, the trademark first, as on the phone (James, j-mac-about-tm, 2026-11-12).
    credits: `${ABOUT_TRADEMARK}\n${ABOUT_NOT_AFFILIATED}`,
  };
}
