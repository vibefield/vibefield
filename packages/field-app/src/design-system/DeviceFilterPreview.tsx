import type { ReactElement } from "react";
import { DeviceFilterChip } from "../godview/DeviceFilterChip";
import { MESH_DEVICE_CHOICES } from "./godview-mesh-fixtures";

/**
 * DS-3 — the device filter's shipping chip, on the catalog's fixtures: open
 * on every desktop (this one first and said to be here, a desktop answering, one
 * asleep, one not answering), and at rest with another desktop chosen — its
 * mark and its name. The stage specimen beside it shows the chip at rest in
 * the bar, over the board's rows; this one shows the states a hand opens.
 * Inside a Godview root of the catalog's own (the swarm bodies' precedent), so
 * the instrument tokens scope to it; nothing here is a copy of the chip.
 */
export function DeviceFilterPreview(): ReactElement {
  const noop = (): void => undefined;
  return (
    <div className="vf-godview vf-ds-device-filter-catalog theme-light">
      <header className="vf-godview-header" data-device-filter-catalog="">
        <DeviceFilterChip
          devices={MESH_DEVICE_CHOICES}
          selected={null}
          onSelect={noop}
          defaultOpen
        />
        <span className="vf-ds-device-filter-gap" aria-hidden="true" />
        <DeviceFilterChip devices={MESH_DEVICE_CHOICES} selected="dev-studio" onSelect={noop} />
      </header>
    </div>
  );
}
