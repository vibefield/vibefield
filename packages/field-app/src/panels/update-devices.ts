import {
  CONTRACTS_VERSION,
  compareReleaseVersions,
  type DeviceInfo,
  releaseChannelOf,
  releaseName,
} from "@vibefield/contracts";
import { osOf } from "../godview/monitor/devices";
import type { MonitorDeviceFacet } from "../godview/monitor/types";

// AU-3 (AU-D13 A; LC-20, LC-21) — Settings → Updates' "Your devices": each desktop on the account and the VibeField it
// runs, from the roster's `appVersion` (AU-3a), never `fielddVersion`, which every build says alike. Pure, so the page
// and the catalog read the same rows (docs/UI_SYSTEM.md's fixture-adapter rule).

/** One desktop as the section draws it: its OS mark, its name, its version, and one word. */
export interface UpdateDeviceRow {
  readonly id: string;
  /** as the roster names it (Tailscale's, or the person's own) */
  readonly name: string;
  readonly os: MonitorDeviceFacet["os"];
  readonly self: boolean;
  /** the exact version (the friendly name's title), or null when the desktop doesn't say */
  readonly version: string | null;
  /** the version in friendly words ("The Oct 27 nightly"), or null */
  readonly versionName: string | null;
  /** "This Mac" · "Same as this Mac" · "Older than this Mac" · "Newer than this Mac" · "Version not shared", or what
   * to do when a version keeps it from connecting; null when the versions are of two channels (the name stands
   * alone) or this Mac's own is unknown */
  readonly relation: string | null;
  /** the attention ink: a desktop its version keeps from connecting */
  readonly tone?: "attention";
}

/** A contracts version's major, or null for one that is not a dotted number. */
function contractsMajor(version: string | undefined): number | null {
  if (version === undefined) return null;
  const major = Number(version.split(".")[0]);
  return Number.isInteger(major) ? major : null;
}

/** LC-21 — a desktop its version keeps from connecting (`incompatible`) says what to do, by contracts major: the one
 * behind updates. Unknown which (no version, or one major), it says so. */
function incompatibleWords(peer: DeviceInfo, ours: string): string {
  const theirs = contractsMajor(peer.contractsVersion);
  const mine = contractsMajor(ours);
  if (theirs === null || mine === null || theirs === mine) return "Can't connect: another version";
  return theirs < mine ? "Update VibeField there to connect" : "Update this Mac to connect";
}

/** Older and newer only between versions of one channel (semver orders `beta` below `nightly`). */
function relationOf(version: string, current: string | null): string | null {
  if (current === null) return null;
  const channel = releaseChannelOf(version);
  if (channel === null || channel !== releaseChannelOf(current)) return null;
  const order = compareReleaseVersions(version, current);
  if (Number.isNaN(order)) return null;
  if (order === 0) return "Same as this Mac";
  return order < 0 ? "Older than this Mac" : "Newer than this Mac";
}

/** The account's desktops (DS-D7: `capabilities.docHost`; a phone publishes none), this Mac first, then by name.
 * This Mac's version is the updater's (`currentVersion`), else its own row's. */
export function updateDeviceRows(
  roster: readonly DeviceInfo[] | null,
  currentVersion: string | undefined,
): UpdateDeviceRow[] {
  const desktops = (roster ?? []).filter(
    (device) => device.self || device.capabilities?.docHost === true,
  );
  const self = desktops.find((device) => device.self);
  const current = currentVersion ?? self?.appVersion ?? null;
  // the contracts this Mac speaks: its own row's word, else this build's
  const ours = self?.contractsVersion ?? CONTRACTS_VERSION;
  const rows = desktops.map((device): UpdateDeviceRow => {
    const version = device.self ? current : (device.appVersion ?? null);
    const versionName = version === null ? null : releaseName(version, { start: true });
    const base = { id: device.deviceId, name: device.name, os: osOf(device.platform) };
    if (device.self) return { ...base, self: true, version, versionName, relation: "This Mac" };
    if (device.state === "incompatible" || device.link === "incompatible")
      return {
        ...base,
        self: false,
        version,
        versionName,
        relation: incompatibleWords(device, ours),
        tone: "attention",
      };
    return {
      ...base,
      self: false,
      version,
      versionName,
      relation: version === null ? "Version not shared" : relationOf(version, current),
    };
  });
  return rows.sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name));
}
