// Types for run-alias-parent.mjs (item 345, the seam slice): a run's own socket alias parent and the witness.
export declare const SOCKET_ALIAS_PARENT_ENV: "FIELD_SOCKET_ALIAS_PARENT";
export declare function makeRunAliasParent(platform?: NodeJS.Platform): string | null;
export declare function aliasParentEnv(made: string | null): Record<string, string>;
export declare function removeRunAliasParent(made: string | null): string | null;
export declare function setupRunAliasParent(
  provide: (parent: string) => void,
  label: string,
): () => void;
export declare function aliasLinksIntoTempRoots(platform?: NodeJS.Platform): number;
