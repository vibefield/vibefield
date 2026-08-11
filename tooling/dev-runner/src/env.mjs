/**
 * Child environment blocks, honest about win32's case-insensitive env.
 *
 * `process.env` is a proxy that hides the platform difference: on Windows the
 * real block is case-INSENSITIVE, so an inherited `Electron_Run_As_Node` is the
 * same variable as `ELECTRON_RUN_AS_NODE`. Spreading it (`{...process.env}`)
 * freezes the snapshot into a plain, case-sensitive object, and the `delete`
 * that follows then misses the variant — turning the Electron we launch into
 * plain Node, the exact failure the call sites' comments warn about.
 */
export function buildChildEnv(base, { set = {}, unset = [] } = {}, platform = process.platform) {
  const env = { ...base };
  const matching = platform === "win32" ? caseInsensitiveKeys : exactKey;
  // Overridden keys are removed first so a variant spelling cannot survive
  // beside the casing we intend to hand the child (last write wins).
  for (const key of [...unset, ...Object.keys(set)]) {
    for (const existing of matching(env, key)) delete env[existing];
  }
  for (const [key, value] of Object.entries(set)) env[key] = value;
  return env;
}

function exactKey(env, key) {
  return key in env ? [key] : [];
}

function caseInsensitiveKeys(env, key) {
  const wanted = key.toUpperCase();
  return Object.keys(env).filter((candidate) => candidate.toUpperCase() === wanted);
}
