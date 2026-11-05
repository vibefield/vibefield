// Types for code-directory.mjs (TD-4, LP-D16): main's `native-plane.ts` imports it from TypeScript, and
// `scripts/release-manifest.mjs` from node.

/** One signed image: its Mach-O header's cpu, the CodeDirectory's hash type, and the SHA-256 of that CodeDirectory. */
export type CodeDirectorySlice = {
  cputype: number;
  cpusubtype: number;
  /** CS_HASHTYPE_*: 1 SHA-1, 2 SHA-256, 3 SHA-256 truncated, 4 SHA-384 */
  hashType: 1 | 2 | 3 | 4;
  /** hex SHA-256 of the CodeDirectory blob, all 32 bytes (a SHA-256 CodeDirectory's: Apple's full cdhash) */
  cdhash: string;
};

/** Every image signed, its code verified against its CodeDirectory, or why the file is read by its bytes. */
export type CodeSignatureRead =
  | { signed: true; universal: boolean; slices: CodeDirectorySlice[] }
  | { signed: false; why: string };

export declare function readCodeSignature(bytes: Uint8Array): CodeSignatureRead;

/** A native-plane member's digest (hex sha256): its cdhash when signed, else its bytes'. */
export type MemberDigest =
  | { by: "cdhash"; digest: string }
  | { by: "bytes"; digest: string; why: string };

export declare function memberDigest(bytes: Uint8Array): MemberDigest;

/** `path\0cdhash:<hex>` for a signed Mach-O, `path\0<sha256 of the bytes>` otherwise. */
export declare function memberLine(path: string, bytes: Uint8Array): string;

/** `memberLine` from a digest already read. */
export declare function lineOf(path: string, member: MemberDigest): string;
