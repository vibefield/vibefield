import { type ReactElement, useMemo, useState } from "react";
import { GodviewPreview } from "./GodviewPreview";
import { type CatalogBirth, catalogBirthPanes, spawnBloomDoor } from "./godview-profiles-fixtures";

/**
 * THE SPAWN BLOOM, as the deck ships it (SB-3). The real Godview monitor —
 * `GodviewPreview` mounts the production stage — on a fixture door holding this
 * desktop's three Agent Profiles, so the swarm's hold blooms them and a let-go
 * commits (`createTerminal` answers `mounted`), and on the list view its
 * `＋ TERMINAL` offers the same tree. This file is only the HOST's half
 * (docs/UI_SYSTEM.md's fixture-adapter rule): it keeps each birth as a deck
 * would publish it — a pane, the active one, and the profile it was born under
 * — so the new body arrives where it was let go and names its profile. No
 * markup or stylesheet of its own.
 */
export function SpawnBloomPreview({ view }: { view: "swarm" | "list" }): ReactElement {
  const [births, setBirths] = useState<readonly CatalogBirth[]>([]);
  const door = useMemo(
    () => spawnBloomDoor((birth) => setBirths((current) => [...current, birth])),
    [],
  );
  const panes = useMemo(() => catalogBirthPanes(births), [births]);
  return <GodviewPreview door={door} panes={panes} initialView={view} />;
}
