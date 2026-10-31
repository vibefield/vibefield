// Types for release-plan.mjs (WP12 L3a): the tests import it from TypeScript.
export declare class ReleasePlanError extends Error {}
export interface ReleasePlan {
  channel: "nightly" | "beta" | "stable";
  tag: string;
  version: string;
  prerelease: boolean;
  makeLatest: boolean;
  commit: string;
  /** AU-6 (LC-18) — the plan time, ISO UTC: the build job stages it as the identity's `builtAt` */
  builtAt: string;
  skip: boolean;
  reason?: string;
}
export declare function planRelease(input: {
  event: string;
  ref: string;
  commit: string;
  now?: number;
  productVersion: string;
  lastNightlyTag?: string | null;
  lastPublishedNightlyCommit?: string | null;
  mainGreen?: boolean;
}): ReleasePlan;
export declare function tagAction(input: {
  tag: string;
  commit: string;
  existing?: string | null;
}): "create" | "present";
export declare function stampVersion(version: string, path?: string): void;
