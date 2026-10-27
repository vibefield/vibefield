import { type AgentProfileSet, catalogEntry } from "@vibefield/contracts";
import type {
  MonitorSpawnMenu,
  MonitorSpawnProfile,
  MonitorSpawnTarget,
  ProfileTab,
} from "@vibefield/puppeteer-views";
import { thisDeviceWord } from "../../account/link";

// SB-3 — THE SPAWN MENU: what a new terminal can be born under, as the spawn
// bloom (and the list view's two-step menu) offer it — the views' own tree
// (`MonitorSpawnMenu`), built here from the profile tabs' feed. Pure, like
// `profile-tabs.ts`; `GodviewMonitor` builds it and nothing here dials.

/** The desktop you sit at, as the menu names it. SB-D9 lists only this one
 * until a peer can take a terminal from here (SB-6, after the sync plane); the
 * id is the menu's own, and a create is only ever asked of this desktop. */
export const HERE_DEVICE_ID = "here";

/* Its name is its platform's word (DESIGN.md §9, AO-6: "This Mac", never "This
 * desktop"). No contract hands the renderer this machine's name, and none is
 * needed yet: one desktop blooms its profiles, and a desktop's name and initial
 * are drawn only when there are two or more (SB-6 names each from the roster). */

/**
 * Who is signed in under a profile, in the catalog's labels and the feed's
 * order — the words' detail line (`CLAUDE CODE · CODEX SIGNED IN`). A managed
 * profile's sign-ins count in any state (it holds them); This Mac's only where
 * the agent's own folder is signed in: the rule a profile's page lists by
 * (`signedInUnder`).
 */
export function signedInLabels(set: AgentProfileSet): string[] {
  const labels: string[] = [];
  for (const persona of set.personas) {
    if (set.kind === "native" && persona.identity?.loggedIn !== true) continue;
    const label = catalogEntry(persona.provider)?.label ?? persona.provider;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

/**
 * The menu (SB-D9): this desktop, `reading` with no profiles until the feed
 * first answers (letting go on it then opens an unbound terminal, today's
 * hold), then `ready` with its Agent Profiles in the tabs' order — the tab's
 * fields (`ProfileTab`, its orange dot included) plus who is signed in. One
 * profile is no choice: the views create at once, under it.
 */
export function spawnMenuOf(
  sets: readonly AgentProfileSet[] | null,
  tabs: readonly ProfileTab[],
  /** this desktop, in its platform's word (`thisDeviceWord`) */
  here: string = thisDeviceWord(undefined),
): MonitorSpawnMenu {
  if (sets === null) {
    return { devices: [{ id: HERE_DEVICE_ID, label: here, self: true, state: "reading" }] };
  }
  const blocked = new Set(tabs.filter((tab) => tab.blocked === true).map((tab) => tab.id));
  const profiles = sets.map(
    (set): MonitorSpawnProfile => ({
      id: set.id,
      label: set.label,
      ...(set.glyph !== undefined ? { glyph: set.glyph } : {}),
      kind: set.kind,
      isDefault: set.default,
      ...(blocked.has(set.id) ? { blocked: true } : {}),
      signedIn: signedInLabels(set),
    }),
  );
  return {
    devices: [{ id: HERE_DEVICE_ID, label: here, self: true, state: "ready", profiles }],
  };
}

/** Whether a create may be asked of the desktop a target names: this one, or
 * none named (which means this one). */
export function targetsHere(target: MonitorSpawnTarget | undefined): boolean {
  return target?.deviceId === undefined || target.deviceId === HERE_DEVICE_ID;
}
