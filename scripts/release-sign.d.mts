// Types for release-sign.mjs (WP12 L3a): the tests import it from TypeScript.
export declare const CHANNELS: readonly ["nightly", "beta", "stable"];
export declare const SECRET_ENV: "VIBEFIELD_RELEASE_SECRET";
export declare const FRESH_DAYS: number;
export declare class ReleaseSignError extends Error {}
export declare function policyFile(channel: string): string;
export declare function policyBody(doc: Record<string, unknown>): string;
export declare function checkPolicyBump(
  source: { channel: string; version: number } & Record<string, unknown>,
  previous: ({ version: number } & Record<string, unknown>) | null,
): void;
export declare function buildChannels(input: {
  tag: string;
  channel: string;
  run: number;
  previous: { version?: number; heads?: Record<string, string | null> } | null;
  now: number;
  trustRootVersion: number;
}): {
  schemaVersion: 1;
  version: number;
  generatedAt: number;
  expires: string;
  trustRootVersion: number;
  heads: Record<string, string | null>;
};
export declare function signRelease(input: {
  dir: string;
  tag: string;
  channel: string;
  run: number;
  policies: string;
  trustRoot: string;
  previousDir?: string | null;
  now?: number;
  secret?: string | undefined;
  log?: (line: string) => void;
}): { unsigned: boolean; signed: string[]; written: string[] };
