// Types for the parts of trust-keygen.mjs (TD-0) the release tests use.
export declare function generateKeypair(): { publicKey: string; secretKey: string };
export declare function publicKeyOf(secret: string): string;
export declare function signBytes(bytes: Uint8Array, secret: string): string;
export declare function verifyBytes(
  bytes: Uint8Array,
  signature: string,
  publicKey: string,
): boolean;
export declare function canonicalJson(value: unknown): string;
export declare function assembleTrustRoot(input: {
  root: string[];
  release: string[];
  bundled: string[];
  registry: string[];
  [key: string]: unknown;
}): Record<string, unknown>;
export declare function signTrustRoot(
  docBytes: Uint8Array,
  sigText: string,
  secret: string,
): string;
