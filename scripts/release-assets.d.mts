// Types for release-assets.mjs (LP-1): the tests, release-verify and notarize-dmg import it.
export declare const STABLE_DMG_ALIAS: "VibeField-mac-arm64.dmg";
export declare class ReleaseAssetsError extends Error {}
export declare function versionedDmgName(version: string): string;
export declare function digestOfFile(
  path: string,
  algorithm: string,
  encoding: "hex" | "base64",
): string;
export declare function sha512Base64OfFile(path: string): string;
export interface FeedEntry {
  url: string;
  sha512: string;
  /** NaN when the feed's size is unreadable */
  size: number;
}
export declare function feedEntries(feedText: string): FeedEntry[];
export declare function refreshFeedEntry(
  feedText: string,
  entry: { url: string; sha512: string; size: number },
): string;
export declare function dmgOfFeed(feedText: string): string;
export declare function stableDmgAlias(input: {
  dir: string;
  channel: string;
  version: string;
}): { source: string; alias: "VibeField-mac-arm64.dmg" } | null;
export declare function checkReleaseAssets(input: { dir: string; tag: string; channel: string }): {
  checked: string[];
};
