// Types for update-fixture.mjs (WP12 L4): the fixture's tests import it from TypeScript.
export type FixtureKey = { publicKey: string; secretKey: string };
export type FixtureKeys = {
  rootA: FixtureKey;
  rootB: FixtureKey;
  release: FixtureKey;
  bundled: FixtureKey;
  registry: FixtureKey;
};
export type FixtureTrustRoot = { doc: Record<string, unknown>; bytes: Buffer; sigText: string };
export type FixtureRelease = {
  dir: string;
  tag: string;
  channel: "nightly" | "beta" | "stable";
  version: string;
  zip: string;
  sha512: string;
  size: number;
};
export type UpdateRunName = "staged" | "forged" | "rollback" | "killed" | "unresolved";
export type FixtureRun = {
  releases: FixtureRelease[];
  seed: Record<string, unknown> | null;
  expect: "staged" | "feed-unverified" | "policy-rollback" | "killed" | "channel-unresolved";
};
export type FixtureServer = {
  origin: string;
  requests: { method: string | undefined; path: string }[];
  payloadRequests(): { method: string | undefined; path: string }[];
  close(): Promise<void>;
};

export declare const FIXTURE_PATH: "/vibefield/vibefield/releases";
export declare const FEED_FILE: "latest-mac.yml";
export declare const UPDATE_RUNS: readonly UpdateRunName[];
export declare function mintKeys(): FixtureKeys;
export declare function smokeTrustRoot(keys: FixtureKeys, now?: number): FixtureTrustRoot;
export declare function writeTrustRoot(path: string, trustRoot: FixtureTrustRoot): string;
export declare function nextVersion(
  current: string,
  channel: "nightly" | "beta" | "stable",
  now?: number,
): string;
export declare function buildRelease(input: {
  dir: string;
  keys: FixtureKeys;
  trustRoot: FixtureTrustRoot;
  channel: "nightly" | "beta" | "stable";
  current: string;
  run?: number;
  levers?: Record<string, unknown>;
  policyVersion?: number;
  forgeFeedSig?: boolean;
  payloadSize?: number;
  now?: number;
}): FixtureRelease;
export declare function buildRun(
  name: UpdateRunName,
  input: {
    root: string;
    keys: FixtureKeys;
    trustRoot: FixtureTrustRoot;
    current: string;
    now?: number;
  },
): FixtureRun;
export declare function isPayload(path: string): boolean;
export declare function serveReleases(
  releases: FixtureRelease[],
  options?: { host?: string; port?: number },
): Promise<FixtureServer>;
