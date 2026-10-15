// Types for release-verify.mjs (WP12 L3a): the tests import it from TypeScript.
export declare const VERIFY_ORIGIN: string;
export declare class ReleaseVerifyError extends Error {}
export declare function verifyReleaseDir(input: {
  dir: string;
  tag: string;
  channel: "nightly" | "beta" | "stable";
  rootKeys?: readonly string[]; // default: the frozen ledger's trustRootKeys, read only when a feed exists
  now?: number;
}): Promise<{ unsigned: boolean; verified: string[] }>;
