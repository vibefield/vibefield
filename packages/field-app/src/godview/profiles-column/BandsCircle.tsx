import type { AgentProfileSet } from "@vibefield/contracts";
import type { ReactElement } from "react";
import type { BandsGeometry } from "../../usage/bands";

// UM-3 2b red: the skeleton — the Bands circle draws nothing yet.

export interface BandsCircleProps {
  geometry: BandsGeometry;
  profile?: Pick<AgentProfileSet, "kind" | "glyph" | "default">;
  labelled?: boolean;
  onFocusPlan?: (key: string | null) => void;
}

export function BandsCircle(_props: BandsCircleProps): ReactElement | null {
  return null;
}

export function BandsKey(): ReactElement | null {
  return null;
}
