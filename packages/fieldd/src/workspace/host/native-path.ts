// FS-1a (L1) — the explicit path of mille's native addon, as fieldd handed it
// to this worker (`{t: "init", milleNative}`). Set ONCE, before the engine
// module is first imported: the bundle's native shim (mille-native.ts, which
// replaces mille's own per-platform loader at build time) reads it when it
// initializes. A worker never searches for the addon — no package lookup, no
// `require` of a platform package, nothing beside its own script.

let milleNative: string | null = null;

export function setMilleNativePath(path: string): void {
  if (milleNative !== null && milleNative !== path)
    throw new Error("mille's native path is set once per worker");
  milleNative = path;
}

export function milleNativePath(): string {
  if (milleNative === null)
    throw new Error("mille's native path was not handed to this worker before the engine loaded");
  return milleNative;
}
