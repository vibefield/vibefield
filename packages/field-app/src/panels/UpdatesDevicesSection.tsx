import type { DeviceInfo } from "@vibefield/contracts";
import { useSubscription } from "@vibefield/fieldd-client/react";
import type { ReactElement } from "react";
import { OsMark } from "../godview/os-marks";
import { labelCls, SettingsSection } from "./settings-ui";
import { type UpdateDeviceRow, updateDeviceRows } from "./update-devices";
import "./devices.css";

// AU-3 (AU-D13 A; DESIGN.md §8 "Settings → Updates") — "Your devices" under the updater: each desktop on the account,
// its name in mono, the VibeField it runs in friendly words, and one word. A controller of its own, composed BESIDE
// `UpdatesSection` by the panel: it reads fieldd's roster, and the updater beside it reads the host bridge, so the page
// still works with the daemon down (EDP §11.3). The rows are the Devices page's quiet rows (§13's OS marks).

/** What the section can say: the roster not read yet, not readable, or its desktops (and whether this Mac stands
 * alone, not connected). */
export type UpdatesDevicesState =
  | { readonly kind: "reading" }
  | { readonly kind: "unread" }
  | { readonly kind: "rows"; readonly rows: readonly UpdateDeviceRow[]; readonly alone: boolean };

/** Controller-free: the catalog mounts it over rows the shipping `updateDeviceRows` builds from fixture devices. */
export function UpdatesDevicesView({ state }: { state: UpdatesDevicesState }): ReactElement {
  return (
    <SettingsSection
      title="Your devices"
      description="Each desktop updates itself. This is where they stand."
    >
      {state.kind === "reading" && <div className={labelCls}>Reading your devices…</div>}
      {state.kind === "unread" && (
        <div className={labelCls}>VibeField can't read your devices right now.</div>
      )}
      {state.kind === "rows" && (
        <>
          <ul className="vf-devices-rows vf-updates-devices" data-updates-devices="">
            {state.rows.map((row) => (
              <li key={row.id} className="vf-devices-row" data-self={row.self ? "" : undefined}>
                <OsMark os={row.os} size={16} />
                <span className="vf-devices-row-name vf-ui-mono">{row.name}</span>
                <span className="flex items-center gap-3">
                  {row.versionName !== null && (
                    <span title={row.version ?? undefined}>{row.versionName}</span>
                  )}
                  {row.relation !== null && (
                    <span className={labelCls} data-tone={row.tone}>
                      {row.relation}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {state.alone && <div className={labelCls}>Connect to see your other devices here.</div>}
        </>
      )}
    </SettingsSection>
  );
}

/** Settings → Updates' devices: fieldd's roster (`device.subscribe`, the Devices page's feed), its desktops' versions
 * read against this Mac's (`current`, the updater's own). `linked` false: this Mac is not connected, and says how to
 * see the rest. */
export function UpdatesDevicesSection({
  current,
  linked,
}: {
  current?: string | undefined;
  linked?: boolean | undefined;
}): ReactElement {
  const roster = useSubscription<DeviceInfo[]>("device.subscribe");
  const state: UpdatesDevicesState =
    roster.status === "live"
      ? { kind: "rows", rows: updateDeviceRows(roster.data, current), alone: linked === false }
      : roster.status === "error"
        ? { kind: "unread" }
        : { kind: "reading" };
  return <UpdatesDevicesView state={state} />;
}
