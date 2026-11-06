import type { ReactElement } from "react";
import type { GodviewTheme } from "../godview/GodviewTuningPanel";

// UM-3 (DESIGN.md §8 "Godview's profiles column") — THE PROFILES COLUMN ON FIXTURES. A skeleton: no plate yet.

export function ProfilesColumnPreview({ theme }: { theme: GodviewTheme }): ReactElement {
  return <div className="vf-ds-profiles-plates" data-theme-of={theme} />;
}
