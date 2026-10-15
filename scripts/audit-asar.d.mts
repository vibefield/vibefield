// Types for audit-asar.mjs (WP12 L3a, D12): the tests import it from TypeScript.
export declare class AsarAuditError extends Error {}
export declare function readAsarHeader(path: string): { files?: Record<string, unknown> };
export declare function asarFiles(
  header: { files?: Record<string, unknown> },
  prefix?: string,
): { path: string; unpacked: boolean }[];
export declare function auditAsar(input: { app: string; stageApp: string }): string[];
