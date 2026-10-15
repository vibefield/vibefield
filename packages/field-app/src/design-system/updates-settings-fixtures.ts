import type { UpdateChannel, UpdateConsentWords, UpdateView } from "@vibefield/contracts";
import type { UpdatesDoctorState, UpdatesFlow } from "../panels/UpdatesSection";

// Settings › General's update card and Settings › Diagnostics' updater block in the catalog (WP12d L3c-ii,
// build-wp12-updater.md §13 C5): the projections main publishes in `desktopState.update`, the answers its doors give
// and the doctor's lines, written out — never a copy of the card's markup. The specimens mount the shipping
// `UpdatesSectionView` and `UpdatesDoctorView` over them (docs/UI_SYSTEM.md's fixture-adapter rule).

/** The update's own path: found, fetched, ready, the consent its Restart opens, a refusal, a channel lowered. */
export const UPDATES_PATH_STATES = [
  "current",
  "checking",
  "downloading",
  "ready",
  "consent",
  "refused",
  "downgrade",
] as const;
export type UpdatesPathState = (typeof UPDATES_PATH_STATES)[number];

/** The held and honest states: the policy's answers, a failed check, the person's own choices, no updater. */
export const UPDATES_HELD_STATES = [
  "paused",
  "unsupported",
  "offline",
  "failed",
  "off",
  "skipped",
  "absent",
] as const;
export type UpdatesHeldState = (typeof UPDATES_HELD_STATES)[number];

export type UpdatesFixtureState = UpdatesPathState | UpdatesHeldState;

/** The catalog's clock: an afternoon, the last check eighteen minutes before it. */
export const UPDATES_FIXTURE_NOW = new Date(2026, 9, 15, 14, 20).getTime();
const CHECKED_AT = new Date(2026, 9, 15, 14, 2).getTime();

const NEXT = "0.9.0-nightly.20261016";

const BASE: UpdateView = {
  phase: "idle",
  channel: "nightly",
  buildChannel: "nightly",
  enabled: true,
  lastCheckAt: CHECKED_AT,
  applyWired: true,
};

/** The consent's words as main composes them (`consentWords`) for seven live sessions. */
const CONSENT: UpdateConsentWords = {
  message: "Updating ends 7 terminal sessions",
  lead: `VibeField ${NEXT} replaces the terminal service, which ends:`,
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

export interface UpdatesFixture {
  view: UpdateView | null;
  flow?: UpdatesFlow;
  pendingChannel?: UpdateChannel | null;
}

export function updatesFixture(state: UpdatesFixtureState): UpdatesFixture {
  switch (state) {
    case "current":
      return { view: BASE };
    case "checking":
      return { view: { ...BASE, phase: "checking" } };
    case "downloading":
      return { view: { ...BASE, phase: "downloading", version: NEXT, percent: 42 } };
    case "ready":
      return {
        view: { ...BASE, phase: "staged", version: NEXT, sessions: 0 },
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
      // a version skipped, on a build below the publisher's oldest supported one: the advisory line, never a block
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
