import type { ReactElement } from "react";
import type { ProfileMeters } from "../../usage/meters";
import type { ColumnCircle } from "./ProfilesColumnView";

// UM-3 2b red: the skeleton — the popover draws nothing and says nothing yet.

export interface ProfilePopoverViewProps {
  circle: ColumnCircle;
  lens: boolean;
  chosen: boolean;
  focus: string | null;
  read: string;
  onClose: () => void;
  onFocusPlan: (key: string | null) => void;
  onOpenProfile: (setId: string) => void;
  onRetry: (profileIds: readonly string[]) => void;
}

export function ProfilePopoverView(_props: ProfilePopoverViewProps): ReactElement | null {
  return null;
}

export function readWords(_meters: ProfileMeters, _now: Date): string {
  return "";
}
