import type { AgentView } from "@vibecook/puppeteer-view-sdk/model";

// The stage and its chrome read the SDK's model. Find's shared chrome shape
// is adapted only where it joins local facts (`find-agents.ts`, M19).

export type { MonitorSpawnMenu, MonitorSpawnTarget } from "@vibecook/puppeteer-view-sdk/model";
export type {
  MonitorRemoteFacet,
  MonitorTheme,
  MonitorViewEntry,
} from "@vibecook/puppeteer-views";

export type MonitorAgent = AgentView;

/** DS-3 — where a row LIVES, as the device filter's chip names it: the
 * roster's name and OS mark for a device id (`devices.ts`), in VibeField's
 * four OS words (the chip draws `OsMark`). */
export interface MonitorDeviceFacet {
  id: string;
  /** the roster's name for it (a machine's own name) */
  name: string;
  /** its OS, from the roster's `platform`; `unknown` when the roster has none */
  os: "macos" | "windows" | "linux" | "unknown";
  /** this is the desktop the window is on */
  here: boolean;
}
