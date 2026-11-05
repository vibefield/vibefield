import type { ReactElement } from "react";
import type { CrewCard } from "./crew-card";

// CHAT'S CREW CARD, DRAWN (SP-1e2's renderer half; DESIGN.md §8 "Chat's crew card"; RU-18, the Sparks page's
// `crewCard`) — controller-free, so the catalog draws this markup on fixtures. It hangs under its crew's act line in
// Vela's flow (`ThreadFlowView`). (red: a skeleton — it draws nothing)

export interface CrewCardViewProps {
  card: CrewCard;
  /** a row pressed: that member's pane in Godview (absent: the catalog, where nothing opens) */
  onRow?: ((runtimeRunId: string) => void) | undefined;
  /** Open in Godview pressed (absent: the catalog) */
  onOpenGodview?: (() => void) | undefined;
  /** the rows whose reveal runs now: each waits, and a second press does nothing */
  revealing?: ReadonlySet<string> | undefined;
}

export function CrewCardView(_props: CrewCardViewProps): ReactElement | null {
  return null;
}
