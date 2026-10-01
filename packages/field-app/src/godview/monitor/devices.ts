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

/**
 * DS-4e — a roster row's STANDING: what the desktop is (DS-L8's state, or the
 * tailnet's `online` from an older peer), whether this daemon's link to it is
 * up, and which boot of its daemon is answering. A FLIP is a change of any of
 * them — the one signal a pane waiting on that desktop's terminal asks again
 * on (a peer that comes online can be routed to; a reconnected link or a
 * restarted daemon may serve what it refused). Names, versions and the rest of
 * the row are not standing.
 */
export function rosterStanding(device: DeviceInfo): string {
  return [
    device.state ?? (device.online ? "awake" : "asleep"),
    device.online ? "online" : "offline",
    device.link ?? "",
    device.bootId ?? "",
  ].join("|");
}

/**
 * DS-4e — which desktops' rows flipped between one roster list and the next.
 * A desktop seen for the first time sets its baseline and is no flip (nothing
 * was waiting on a standing nobody had read); a desktop that leaves the list
 * keeps its last standing, so its return is compared, not re-baselined. The
 * same list twice flips nothing — two readers of one subscription cost nothing.
 */
export class RosterFlips {
  private readonly standing = new Map<string, string>();

  observe(devices: readonly DeviceInfo[]): string[] {
    const flipped: string[] = [];
    for (const device of devices) {
      const now = rosterStanding(device);
      const before = this.standing.get(device.deviceId);
      this.standing.set(device.deviceId, now);
      if (before !== undefined && before !== now) flipped.push(device.deviceId);
    }
    return flipped;
  }
}

/** DS-4e — the roster port as the monitor holds it, with a second reader of
 * the SAME lists (the deck's: flips and names) — no second subscription. */
export function teeDevicesPort(
  port: DevicesPort,
  observe: (devices: readonly DeviceInfo[]) => void,
): DevicesPort {
  return {
    subscribe: (listener) =>
      port.subscribe((devices) => {
        observe(devices);
        listener(devices);
      }),
  };
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
