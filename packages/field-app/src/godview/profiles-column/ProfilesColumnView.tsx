import type { AgentProfileSet } from "@vibefield/contracts";
import type { ReactElement, ReactNode } from "react";
import type { ProfileMeters } from "../../usage/meters";

// UM-3 2b red: the skeleton — the column draws nothing yet.

export interface ColumnCircle {
  set: AgentProfileSet;
  meters: ProfileMeters;
}

export interface ProfilesColumnViewProps {
  circles: readonly ColumnCircle[];
  lens: boolean;
  chosen: string | null;
  open: string | null;
  pinned: boolean;
  focus: string | null;
  read: string;
  addOpen: boolean;
  canAdd: boolean;
  moment?: ReactNode;
  onPoint: (target: string | null) => void;
  onCircle: (setId: string) => void;
  onClose: () => void;
  onFocusPlan: (key: string | null) => void;
  onAdd: () => void;
  onOpenProfile: (setId: string) => void;
  onRetry: (profileIds: readonly string[]) => void;
}

export function ProfilesColumnView(_props: ProfilesColumnViewProps): ReactElement | null {
  return null;
}
