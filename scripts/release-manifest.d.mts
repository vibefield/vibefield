// Types for release-manifest.mjs (WP12 L3a): the tests import it from TypeScript.
export type Plane = "shell" | "fieldd" | "field-native";
export type PlaneHashes = Record<Plane, { digest: string; files: number }>;
export declare const PLANES: readonly Plane[];
export declare class ReleaseManifestError extends Error {}
export declare function planeOf(resourcesRelative: string | null): Plane;
export declare function resourcesDirOf(app: string): string;
export declare function hashPlanes(app: string): PlaneHashes;
export declare function mergeManifest(input: {
  version: string;
  tag: string;
  channel: string;
  commit: string;
  builds: Record<string, PlaneHashes>;
  previous: { tag: string; builds?: Record<string, Partial<PlaneHashes>> } | null;
}): {
  schemaVersion: 1;
  version: string;
  tag: string;
  channel: string;
  commit: string;
  builds: Record<string, PlaneHashes>;
  touched: Plane[];
  previous: string | null;
};
