import {
  type DeviceInfo,
  type ReleaseNotesView,
  releaseName,
  type UpdateChannel,
  type UpdateConsentWords,
  type UpdateView,
  type UpdateViewLastApply,
} from "@vibefield/contracts";
import type { UpdatesDevicesState } from "../panels/UpdatesDevicesSection";
import type { UpdatesDoctorState, UpdatesFlow } from "../panels/UpdatesSection";
import { updateDeviceRows } from "../panels/update-devices";
import { type MeUpdateLocal, refusalLine } from "../panels/update-words";

// Settings → Updates and Settings › Diagnostics' updater block in the catalog (WP12d L3c-ii, build-wp12-updater.md
// §13 C5; AU-3): the projections main publishes in `desktopState.update`, the answers its doors give, the roster fieldd
// publishes and the doctor's lines, written out — never a copy of the page's markup. The specimens mount the shipping
// `UpdatesSectionView`, `UpdatesDevicesView` and `UpdatesDoctorView` over them, the devices' rows built by the shipping
// `updateDeviceRows` (docs/UI_SYSTEM.md's fixture-adapter rule). AU-3 (LC-33) — only states whose fields exist now.
// AU-7 — where the app runs joined with the Move door: a writable copy outside Applications, and one macOS won't let
// replace itself. AU-6 (AU-D10 A; LC-7, LC-18) — the build's day on every head, and the release's notes as main
// projects them: a ready nightly's log (before), an install's (after, What's new), a found release's written lines.

/** The update's own path: up to date, found, fetched, ready (and long ready, and ready with its notes), the consent
 * its Restart opens, a refusal, and a day after an install with and without notes. */
export const UPDATES_PATH_STATES = [
  "current",
  "updated",
  "updated-notes",
  "checking",
  "downloading",
  "ready",
  "ready-notes",
  "ready-long",
  "consent",
  "refused",
] as const;
export type UpdatesPathState = (typeof UPDATES_PATH_STATES)[number];

/** The person's own choices and what they leave: updates off with one found (and a release found with its written
 * notes), a skipped version, a channel lowered, a channel with nothing published yet, the install that didn't take
 * (AU-G5, AU-G6, AU-G7), and where the app runs (AU-G8: a copy outside Applications, one that can't replace itself). */
export const UPDATES_EDGE_STATES = [
  "found-off",
  "release-notes",
  "skipped",
  "downgrade",
  "no-release",
  "not-applied",
  "not-applied-ready",
  "elsewhere",
  "read-only",
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
/** AU-6 (LC-18) — when CURRENT was built, in its night: the head's "Nightly · built Oct 14, 2026" */
const BUILT_AT = new Date(2026, 9, 14, 2, 41).getTime();

const BASE: UpdateView = {
  phase: "idle",
  channel: "nightly",
  buildChannel: "nightly",
  enabled: true,
  lastCheckAt: CHECKED_AT,
  applyWired: true,
  currentVersion: CURRENT,
  builtAt: BUILT_AT,
};

/** AU-6 (AU-D10 A) — the Oct 16 nightly's notes as main projects them: the log since the Oct 14 nightly (its count,
 * how many are outside the docs, the newest subject of four tracks) and the comparison main composed from its GitHub
 * releases origin. */
const NEXT_NOTES: ReleaseNotesView = {
  version: NEXT,
  body: {
    kind: "log",
    since: { version: CURRENT, tag: "nightly-20261014" },
    commits: 87,
    product: 41,
    lines: [
      { track: "AU-6", text: "Settings → Updates says what's in a release before you restart" },
      { track: "TS-4b", text: "the approval line on the claims strip, behind the limit moment" },
      { track: "FN", text: "a run's exit is published before its workspace cleanup (item 87)" },
      { track: "QW1 unread", text: "hidden means unread" },
    ],
  },
  compareUrl: "https://github.com/vibefield/vibefield/compare/nightly-20261014...nightly-20261016",
};

/** AU-6 (LC-7) — the notes CURRENT carried, copied into the install's record: what's new, for a day after it. */
const CURRENT_NOTES: ReleaseNotesView = {
  version: CURRENT,
  body: {
    kind: "log",
    since: { version: PREVIOUS, tag: "nightly-20261013" },
    commits: 103,
    product: 58,
    lines: [
      {
        track: "AO",
        text: 'the History pane says "last used" against the clock it is given (item 84)',
      },
      {
        track: "QW1 attach",
        text: "a resume of a conversation the agent has not saved is refused before its live PTY is touched",
      },
      { track: "TS-3a", text: "the Setup Assistant's Not now hint points at Settings → Devices" },
      { track: "TS-4", text: "the status item's Connect Your Devices… begins the link" },
    ],
  },
  compareUrl: "https://github.com/vibefield/vibefield/compare/nightly-20261013...nightly-20261014",
};

/** AU-6 (AU-D10 A, LC-19) — a release's hand-written lines (`apps/desktop/packaging/notes/0.2.0.txt`): no count, and
 * no comparison — the first release counts from none. */
const RELEASE = "0.2.0";
const RELEASE_NOTES: ReleaseNotesView = {
  version: RELEASE,
  body: {
    kind: "written",
    since: null,
    lines: [
      "Updates wait for you: VibeField downloads them in the background and installs when you restart or quit.",
      "Settings → Updates says what's in a release before you restart, and what's new after.",
      "Your devices say which version of VibeField each one runs.",
    ],
  },
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
    case "updated-notes":
      // AU-6 (LC-7) — the same day after an install that carried notes: What's new beside "Updated today from …",
      // and the card says what's new in it, from the record's own copy
      return {
        view: {
          ...BASE,
          lastApply: {
            version: CURRENT,
            from: PREVIOUS,
            outcome: "installed",
            at: UPDATES_FIXTURE_NOW - 3 * HOUR,
            trigger: "restart",
            notes: CURRENT_NOTES,
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
    case "ready-notes":
      // AU-6 (AU-D10 A) — ready, and what's in it before the restart: the log's count, four tracks' lines, the link
      return {
        view: { ...BASE, phase: "staged", version: NEXT, sessions: 0, notes: NEXT_NOTES },
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
    case "release-notes":
      // AU-6 (AU-D10 A) — a stable build that found the next release, waiting for Download: its hand-written lines,
      // no count, no link
      return {
        view: {
          ...BASE,
          channel: "stable",
          buildChannel: "stable",
          currentVersion: "0.1.0",
          enabled: false,
          phase: "available",
          version: RELEASE,
          notes: RELEASE_NOTES,
        },
      };
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
    case "elsewhere":
      // AU-7 (LC-10) — a writable copy outside Applications updates as usual: one quiet line, the move beside it
      return { view: { ...BASE, location: "elsewhere" } };
    case "read-only":
      // AU-7 (LC-10, LC-40) — opened where it was downloaded (App Translocation), with an update ready it can't
      // install: the attention line, Move to Applications… its primary, no dot
      return {
        view: { ...BASE, phase: "staged", version: NEXT, sessions: 0, location: "read-only" },
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

// ── AU-2 — the corner in the catalog: the Me menu's update row and the face's dot, over the same projections. The
// plates mount the shipping `MeMenuView`, its row built by the shipping `meUpdateRow`; what stands in for the
// controller is only what it holds — the row's flow inside one open, main's question, a refusal's line. ──

/** The face alone, folded: at rest, an install waiting on you (the dot), and a waiting count outranking it (I-5). */
export const UPDATE_FACE_STATES = ["rest", "ready", "waiting"] as const;
export type UpdateFaceState = (typeof UPDATE_FACE_STATES)[number];

/** The menu open over each row the corner draws (renderer.md §2.1), in the page's groups: the path, the person's
 * choices and the third line, the held states, a check's answers in place, and the restart's and download's acts.
 * R5 (the copy that can't update itself) is AU-7's; R4's notes form (What's new, LC-7) is AU-6's. */
export const UPDATE_CORNER_GROUPS = {
  path: [
    "current",
    "checking",
    "downloading",
    "ready",
    "ends",
    "census",
    "updated",
    "updated-notes",
  ],
  edges: [
    "off",
    "found-off",
    "skipped",
    "ready-long",
    "floor",
    "not-wired",
    "not-applied",
    "no-release",
    "read-only",
  ],
  held: ["paused", "unsupported", "offline", "failed", "absent"],
  answers: [
    "checking-here",
    "up-to-date",
    "checked-skipped",
    "checked-offline",
    "checked-failed",
    "checked-paused",
    "checked-unsupported",
    "unreachable",
  ],
  acts: ["preparing", "ask", "confirming", "restarting", "requested", "refused"],
} as const;
export type UpdateCornerGroup = keyof typeof UPDATE_CORNER_GROUPS;
export type UpdateCornerState = (typeof UPDATE_CORNER_GROUPS)[UpdateCornerGroup][number];

export interface UpdateCornerFixture {
  /** `desktopState.update`; null where no updater runs */
  view: UpdateView | null;
  /** the row's flow inside this open: its own check, a restart's phase, a Download asked */
  local: MeUpdateLocal;
  /** main's question standing in the menu (busy while its confirm is in flight) */
  ask?: { words: UpdateConsentWords; busy: boolean };
  /** a refusal at the menu's top, as the controller says it */
  refusal?: string;
}

const AT_REST: MeUpdateLocal = { kind: "rest" };
const READY: UpdateView = { ...BASE, phase: "staged", version: NEXT, sessions: 0 };
const ENDS: UpdateView = {
  ...BASE,
  phase: "staged",
  version: NEXT,
  sessions: 7,
  blockedBy: "sessions",
};
const FOUND_OFF: UpdateView = { ...BASE, enabled: false, phase: "available", version: NEXT };
const SKIPPED: UpdateView = { ...BASE, phase: "available", version: NEXT, declined: true };

export function updateCornerFixture(state: UpdateCornerState): UpdateCornerFixture {
  switch (state) {
    case "current":
      return { view: BASE, local: AT_REST };
    case "checking":
      // R6 — a check that began elsewhere (the status item, the page) reads the same while it runs
      return { view: { ...BASE, phase: "checking" }, local: AT_REST };
    case "downloading":
      return {
        view: { ...BASE, phase: "downloading", version: NEXT, percent: 42 },
        local: AT_REST,
      };
    case "ready":
      return { view: READY, local: AT_REST };
    case "ends":
      return { view: { ...ENDS, sessions: 3 }, local: AT_REST };
    case "census":
      // R10 — the census unread: main reads it, then asks or says why not
      return { view: { ...READY, sessions: "unknown" }, local: AT_REST };
    case "updated":
      // R4 (AU-D11) — three hours after an update landed, in the no-notes form
      return { view: fixtureOf("updated").view, local: AT_REST };
    case "updated-notes":
      // R4 (LC-7) — after an install that carried notes: What's new · Updated today, opening the page at them
      return { view: fixtureOf("updated-notes").view, local: AT_REST };
    case "off":
      return { view: { ...BASE, enabled: false }, local: AT_REST };
    case "found-off":
      return { view: FOUND_OFF, local: AT_REST };
    case "skipped":
      return { view: SKIPPED, local: AT_REST };
    case "ready-long":
      // line 3 (AU-D3) — ready eight days and ending sessions: the ready day under the cost
      return { view: fixtureOf("ready-long").view, local: AT_REST };
    case "floor":
      // line 3 — below the publisher's oldest supported version, which outranks the ready day
      return {
        view: {
          ...BASE,
          phase: "staged",
          version: NEXT,
          sessions: 3,
          stagedAt: UPDATES_FIXTURE_NOW - 8 * DAY,
          unsupportedBelow: "0.9.0-nightly.20261015",
        },
        local: AT_REST,
      };
    case "not-wired":
      // R11 — downloaded where the apply isn't wired yet
      return { view: { ...READY, applyWired: false }, local: AT_REST };
    case "not-applied":
      // AU-G7 — the notice on the launch after, and the ready row again
      return { view: fixtureOf("not-applied-ready").view, local: AT_REST };
    case "no-release":
      return { view: fixtureOf("no-release").view, local: AT_REST };
    case "read-only":
      // R5 (AU-7) — the copy macOS won't let replace itself: the row opens Settings → Updates, where the move is
      return { view: fixtureOf("read-only").view, local: AT_REST };
    case "paused":
    case "unsupported":
    case "offline":
    case "failed":
    case "absent":
      return { view: fixtureOf(state).view, local: AT_REST };
    case "checking-here":
      // P1 — the row's own check, running
      return { view: BASE, local: { kind: "checking" } };
    case "up-to-date":
      // P2 — inert until the menu folds
      return { view: BASE, local: { kind: "answered", outcome: "up-to-date" } };
    case "checked-skipped":
      return { view: SKIPPED, local: { kind: "answered", outcome: "found" } };
    case "checked-offline":
      return { view: fixtureOf("offline").view, local: { kind: "answered", outcome: "failed" } };
    case "checked-failed":
      return { view: fixtureOf("failed").view, local: { kind: "answered", outcome: "failed" } };
    case "checked-paused":
      return { view: fixtureOf("paused").view, local: { kind: "answered", outcome: "held" } };
    case "checked-unsupported":
      return { view: fixtureOf("unsupported").view, local: { kind: "answered", outcome: "held" } };
    case "unreachable":
      // P9 — the door itself failed
      return { view: BASE, local: { kind: "unreachable", message: "No handler registered" } };
    case "preparing":
      return { view: ENDS, local: { kind: "preparing" } };
    case "ask":
      // AU-D6 — the panel at 320, in main's words
      return { view: ENDS, local: AT_REST, ask: { words: CONSENT, busy: false } };
    case "confirming":
      return { view: ENDS, local: { kind: "confirming" }, ask: { words: CONSENT, busy: true } };
    case "restarting":
      return { view: ENDS, local: { kind: "restarting" } };
    case "requested":
      // P14 — Download asked, in place
      return { view: FOUND_OFF, local: { kind: "requested" } };
    case "refused":
      // P15 — main's refusal at the menu's top; the row is the ready row again
      return {
        view: { ...ENDS, blockedBy: "policy-unreachable" },
        local: AT_REST,
        refusal: refusalLine(UNREACHABLE),
      };
  }
}
