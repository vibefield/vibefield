// Types for cargo-target.mjs (tooling (a)): the workspace's own target directory, asked of cargo.
export declare function workspaceTargetDir(
  root: string,
  env?: NodeJS.ProcessEnv,
  platform?: NodeJS.Platform,
): string;
export declare function cargoBinaries(
  root: string,
  profile: string,
  names: readonly string[],
  options?: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform },
): Array<{ name: string; file: string; path: string }>;
