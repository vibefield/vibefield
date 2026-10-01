import type { DeviceInfo } from "@vibefield/contracts";
import { useEffect, useState } from "react";
import type { DevicesPort } from "./remote-door";
import type { MonitorDeviceFacet } from "./types";

/**
 * DS-3 — WHERE A ROW LIVES, from the roster.
 *
 * The mesh board names devices by id and nothing else; the roster
 * (`device.subscribe`, held only while the stage is: PF6) is what turns an id
 * into a desktop a person recognizes — its name and its operating system, the
 * OS being what a device is DRAWN as (James's direction, 2026-09-30: a device
 * is its OS mark, never its name in a line of words). Pure but for the hook at
 * the bottom; nothing here dials.
 */

/** A roster `platform` (`process.platform` on the publishing desktop) as the
 * views' four marks name it. Anything else — a platform the roster has not
 * heard yet, or one outside the three — is `unknown`, which draws a plain
 * screen: a mark is never guessed. */
export function osOf(platform: string | undefined): MonitorDeviceFacet["os"] {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    default:
      return "unknown";
  }
}

/** The facet for one device id: the roster's word when it has one, else the
 * id itself and no OS (a device the board lists before the roster names it). */
export function deviceFacet(
  id: string,
  roster: ReadonlyMap<string, DeviceInfo>,
  here: string | undefined,
): MonitorDeviceFacet {
  const info = roster.get(id);
  return {
    id,
    name: info?.name ?? id,
    os: osOf(info?.platform),
    here: here !== undefined && id === here,
  };
}

/** The roster by id, and which entry is this desktop. */
export interface RosterView {
  byId: ReadonlyMap<string, DeviceInfo>;
  /** this desktop's id, once the roster has said */
  here?: string;
}

export const EMPTY_ROSTER: RosterView = { byId: new Map() };

export function rosterView(devices: readonly DeviceInfo[]): RosterView {
  const byId = new Map(devices.map((device) => [device.deviceId, device]));
  const here = devices.find((device) => device.self)?.deviceId;
  return here === undefined ? { byId } : { byId, here };
}

/** The roster while the stage holds a door that can read it. */
export function useDeviceRoster(port: DevicesPort | undefined): RosterView {
  const [roster, setRoster] = useState<RosterView>(EMPTY_ROSTER);
  useEffect(() => {
    if (port === undefined) {
      setRoster(EMPTY_ROSTER);
      return;
    }
    return port.subscribe((devices) => setRoster(rosterView(devices)));
  }, [port]);
  return roster;
}
