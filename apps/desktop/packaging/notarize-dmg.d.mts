// Types for notarize-dmg.mjs (LP-1): the release scripts' tests import it from TypeScript.
export declare const TEAM_ID: "9F79X9D26S";
export declare const MAC_FEED: "latest-mac.yml";
export declare const RETRIES: {
  readonly codesign: readonly number[];
  readonly submit: readonly number[];
  readonly wait: readonly number[];
  readonly staple: readonly number[];
  readonly assess: readonly number[];
};
export declare class NotarizeDmgError extends Error {}
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type Exec = (command: string, args: readonly string[]) => ExecResult;
export declare function isTransient(text: string, kind: string): boolean;
export declare function systemExec(command: string, args: readonly string[]): ExecResult;
export declare function sleepSync(ms: number): void;
export declare function scrubberOf(
  env: Record<string, string | undefined>,
  extra?: string[],
): (text: string) => string;
export declare function notaryCredentials(env: Record<string, string | undefined>): {
  mode: "app-store-connect-api-key" | "apple-id" | "keychain-profile";
  args: string[];
};
export declare function notaryResult(stdout: string): Record<string, unknown> | null;
export declare function developerIdIdentity(
  text: string,
  teamId?: string,
): { hash: string; name: string } | null;
export declare function keychainList(text: string): string[];
export declare function decodeCscLink(link: string, cwd: string): Buffer;
export declare function finalizeDmg(input: {
  dir: string;
  mode?: "signed" | "unsigned" | "validate-only";
  env?: Record<string, string | undefined>;
  exec?: Exec;
  sleep?: (ms: number) => void;
  log?: (line: string) => void;
  cwd?: string;
  scratch?: string;
}):
  | { mode: "validate-only"; dmgs: string[] }
  | {
      mode: "signed" | "unsigned";
      dmg: string;
      sha512: string;
      size: number;
      submission: string | null;
    };
