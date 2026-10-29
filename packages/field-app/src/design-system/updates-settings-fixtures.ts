import {
  type DeviceInfo,
  releaseName,
  type UpdateChannel,
  type UpdateConsentWords,
  type UpdateView,
  type UpdateViewLastApply,
} from "@vibefield/contracts";
import type { UpdatesDevicesState } from "../panels/UpdatesDevicesSection";
import type { UpdatesDoctorState, UpdatesFlow } from "../panels/UpdatesSection";
import { updateDeviceRows } from "../panels/update-devices";

// Settings → Updates and Settings › Diagnostics' updater block in the catalog (WP12d L3c-ii, build-wp12-updater.md
// §13 C5; AU-3): the projections main publishes in `desktopState.update`, the answers its doors give, the roster fieldd
// publishes and the doctor's lines, written out — never a copy of the page's markup. The specimens mount the shipping
// `UpdatesSectionView`, `UpdatesDevicesView` and `UpdatesDoctorView` over them, the devices' rows built by the shipping
// `updateDeviceRows` (docs/UI_SYSTEM.md's fixture-adapter rule). AU-3 (LC-33) — only states whose fields exist now:
// the build's day, the notes and the Move door join with their slices (AU-6, AU-7).

/** The update's own path: up to date, found, fetched, ready (and long ready), the consent its Restart opens, a
 * refusal. */
export const UPDATES_PATH_STATES = [
  "current",
  "updated",
  "checking",
  "downloading",
  "ready",
  "ready-long",
  "consent",
  "refused",
] as const;
export type UpdatesPathState = (typeof UPDATES_PATH_STATES)[number];

/** The person's own choices and what they leave: updates off with one found, a skipped version, a channel lowered,
 * a channel with nothing published yet, and the install that didn't take (AU-G5, AU-G6, AU-G7). */
export const UPDATES_EDGE_STATES = [
  "found-off",
  "skipped",
  "downgrade",
  "no-release",
  "not-applied",
  "not-applied-ready",
] as const;
export type UpdatesEdgeState = (typeof UPDATES_EDGE_STATES)[number];

/** The held and honest states: the policy's answers, a failed check, updates off, no updater. */
export const UPDATES_HELD_STATES = [
  "paused",
  "unsupported",
  "offline",
  "failed",
  "off",
  "absent",
] as const;
export type UpdatesHeldState = (typeof UPDATES_HELD_STATES)[number];

export type UpdatesFixtureState = UpdatesPathState | UpdatesEdgeState | UpdatesHeldState;

/** The catalog's clock: an afternoon, the last check eighteen minutes before it. */
export const UPDATES_FIXTURE_NOW = new Date(2026, 9, 15, 14, 20).getTime();
const CHECKED_AT = new Date(2026, 9, 15, 14, 2).getTime();

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const NEXT = "0.9.0-nightly.20261016";
/** AU-3 (AU-G4) — the exact version this Mac runs, the page's head */
const CURRENT = "0.9.0-nightly.20261014";
const PREVIOUS = "0.9.0-nightly.20261013";

const BASE: UpdateView = {
  phase: "idle",
  channel: "nightly",
  buildChannel: "nightly",
  enabled: true,
  lastCheckAt: CHECKED_AT,
  applyWired: true,
  currentVersion: CURRENT,
};

/** AU-3 (AU-G7; LC-34) — the restart into NEXT didn't take, judged by this launch, which runs the version it left. */
const NOT_APPLIED: UpdateViewLastApply = {
  version: NEXT,
  from: CURRENT,
  outcome: "not-applied",
  at: UPDATES_FIXTURE_NOW - 6 * 60 * 1000,
  trigger: "restart",
  thisLaunch: true,
};

/** The consent's words as main composes them (`consentWords`) for seven live sessions. */
const CONSENT: UpdateConsentWords = {
  message: "Updating ends 7 terminal sessions",
  // AU-1 (LC-2) — main names the version by its friendly name: "The Oct 16 nightly replaces…"
  lead: `${releaseName(NEXT, { start: true })} replaces the terminal service, which ends:`,
  listed: [
    "claude — ~/Projects/vibe-field",
    "codex — ~/Projects/puppeteer",
    "pnpm dev — ~/Projects/vibe-field",
    "zsh — ~/Projects/rosetta",
    "untitled session",
  ],
  more: 2,
  confirm: "End 7 sessions and update",
};

/** The fresh policy at the click was out of reach (main's `policyNotice({kind: "unreachable"})`). */
const UNREACHABLE = {
  message: "VibeField didn't install the update",
  detail:
    "VibeField checks the update policy before installing and couldn't reach it; try again when online.",
};

/** The clipboard's answer, standing in for the host's door: the version is on it. */
const copied = async (_version: string) => true;

export interface UpdatesFixture {
  view: UpdateView | null;
  flow?: UpdatesFlow;
  pendingChannel?: UpdateChannel | null;
  onCopyVersion?: typeof copied;
}

export function updatesFixture(state: UpdatesFixtureState): UpdatesFixture {
  return { ...fixtureOf(state), onCopyVersion: copied };
}

function fixtureOf(state: UpdatesFixtureState): UpdatesFixture {
  switch (state) {
    case "current":
      return { view: BASE };
    case "updated":
      // AU-3 (AU-D11 A) — up to date, three hours after an update landed: "Updated today from the Oct 13 nightly."
      return {
        view: {
          ...BASE,
          lastApply: {
            version: CURRENT,
            from: PREVIOUS,
            outcome: "installed",
            at: UPDATES_FIXTURE_NOW - 3 * HOUR,
            trigger: "restart",
          },
        },
      };
    case "checking":
      return { view: { ...BASE, phase: "checking" } };
    case "downloading":
      return { view: { ...BASE, phase: "downloading", version: NEXT, percent: 42 } };
    case "ready":
      return {
        view: { ...BASE, phase: "staged", version: NEXT, sessions: 0 },
      };
    case "ready-long":
      // AU-3 (AU-D3 A) — ready eight days and ending sessions: the ready day leads the cost, the act asks first
      return {
        view: {
          ...BASE,
          phase: "staged",
          version: NEXT,
          sessions: 3,
          stagedAt: UPDATES_FIXTURE_NOW - 8 * DAY,
        },
      };
    case "consent":
      return {
        view: { ...BASE, phase: "staged", version: NEXT, sessions: 7, blockedBy: "sessions" },
        flow: { kind: "consent", version: NEXT, words: CONSENT },
      };
    case "refused":
      return {
        view: {
          ...BASE,
          phase: "staged",
          version: NEXT,
          sessions: 7,
          blockedBy: "policy-unreachable",
        },
        flow: { kind: "refused", words: UNREACHABLE },
      };
    case "downgrade":
      return { view: BASE, pendingChannel: "stable" };
    case "found-off":
      // AU-3 (AU-G5) — with automatic updates off, a found update waits for Download
      return { view: { ...BASE, enabled: false, phase: "available", version: NEXT } };
    case "no-release":
      // AU-3 (LC-31) — the beta channel has published nothing yet: quiet, never the danger line
      return {
        view: { ...BASE, channel: "beta", phase: "failed", unavailable: "channel-unresolved" },
      };
    case "not-applied":
      return { view: { ...BASE, lastApply: NOT_APPLIED } };
    case "not-applied-ready":
      return {
        view: { ...BASE, phase: "staged", version: NEXT, sessions: 0, lastApply: NOT_APPLIED },
      };
    case "paused":
      return { view: { ...BASE, phase: "paused" } };
    case "unsupported":
      return { view: { ...BASE, phase: "unsupported" } };
    case "offline":
      return { view: { ...BASE, phase: "offline" } };
    case "failed":
      return { view: { ...BASE, phase: "failed", unavailable: "feed-unverified" } };
    case "off":
      return { view: { ...BASE, enabled: false } };
    case "skipped":
      // a version skipped (AU-G6: Download anyway), on a build below the publisher's oldest supported one: the
      // advisory line, never a block
      return {
        view: {
          ...BASE,
          phase: "available",
          version: NEXT,
          declined: true,
          unsupportedBelow: "0.9.0-nightly.20261010",
        },
      };
    case "absent":
      return { view: null };
  }
}

/** The doctor's lines for a staged update held by its sessions, as main's `doctorLines()` writes them. */
export const UPDATES_DOCTOR_FIXTURE: UpdatesDoctorState = {
  kind: "ready",
  lines: [
    "updates: staged · channel nightly",
    "last check: 2026-10-15T14:02:11.000Z",
    "safe window: closed — windowless",
    "update cache: 186.4 MB",
    "policy: v12 for nightly",
    "native plane: touched (digest) — the apply ends its sessions",
  ],
};

/** AU-3 (AU-D13 A) — the account's roster as fieldd publishes it: this Mac, a desktop on the same nightly, one a
 * nightly behind, one on the beta (no older or newer across channels, LC-20), one that doesn't say, one its version
 * keeps from connecting (LC-21), and a phone, which the section leaves out. */
const FIXTURE_ROSTER: DeviceInfo[] = [
  {
    deviceId: "james-mbp",
    name: "james-mbp",
    platform: "darwin",
    contractsVersion: "1.0.0",
    appVersion: CURRENT,
    capabilities: { terminalHost: true, docHost: true, push: false },
    self: true,
    online: true,
    lastSeenAt: UPDATES_FIXTURE_NOW,
  },
  {
    deviceId: "mac-mini",
    name: "mac-mini",
    platform: "darwin",
    contractsVersion: "1.0.0",
    appVersion: CURRENT,
    capabilities: { terminalHost: true, docHost: true, push: false },
    self: false,
    online: true,
    lastSeenAt: UPDATES_FIXTURE_NOW,
  },
  {
    deviceId: "studio-imac",
    name: "studio-imac",
    platform: "darwin",
    contractsVersion: "1.0.0",
    appVersion: PREVIOUS,
    capabilities: { terminalHost: true, docHost: true, push: false },
    self: false,
    online: false,
    lastSeenAt: UPDATES_FIXTURE_NOW - 2 * DAY,
  },
  {
    deviceId: "air",
    name: "air",
    platform: "darwin",
    contractsVersion: "1.0.0",
    appVersion: "0.9.0-beta.2",
    capabilities: { terminalHost: true, docHost: true, push: false },
    self: false,
    online: true,
    lastSeenAt: UPDATES_FIXTURE_NOW,
  },
  {
    deviceId: "build-box",
    name: "build-box",
    platform: "linux",
    capabilities: { terminalHost: true, docHost: true, push: false },
    self: false,
    online: true,
    lastSeenAt: UPDATES_FIXTURE_NOW,
  },
  {
    deviceId: "lab-pc",
    name: "lab-pc",
    platform: "win32",
    contractsVersion: "0.4.0",
    appVersion: "0.8.0",
    capabilities: { terminalHost: true, docHost: true, push: false },
    self: false,
    online: true,
    lastSeenAt: UPDATES_FIXTURE_NOW,
    state: "incompatible",
  },
  {
    deviceId: "james-phone",
    name: "james-phone",
    platform: "ios",
    capabilities: { terminalHost: false, docHost: false, push: true },
    self: false,
    online: true,
    lastSeenAt: UPDATES_FIXTURE_NOW,
  },
];

/** Settings → Updates' "Your devices" over the fixture roster, its rows the shipping `updateDeviceRows`'. */
export const UPDATES_DEVICES_FIXTURE: UpdatesDevicesState = {
  kind: "rows",
  rows: updateDeviceRows(FIXTURE_ROSTER, CURRENT),
  alone: false,
};
