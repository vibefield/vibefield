// Types for gen-desk-hands.mjs (IK, 2026-11-25 — the desk's pen): the hand's three faces baked by ICE's baker. ICE's own types
// are not named here (the repo's root installs no ICE); a bake is described by the fields the desk reads.
export interface DeskFaceBake {
  readonly name: string;
  readonly file: string;
  readonly files: { readonly json: string; readonly bin: string };
  readonly baked: {
    readonly json: {
      readonly format: string;
      readonly family: string;
      readonly weight: number;
      readonly em: number;
      readonly width: number;
      readonly height: number;
      readonly glyphs: Readonly<Record<string, { readonly rect?: readonly number[] }>>;
      readonly kerning: Readonly<Record<string, number>>;
      readonly source: { readonly file: string; readonly sha256: string };
      readonly corrections: readonly string[];
    };
    readonly text: string;
    readonly bin: Uint8Array;
    readonly missing: readonly number[];
    readonly refused: readonly string[];
  };
}
export declare const FONTS_DIR: string;
export declare const HANDS_DIR: string;
export declare function bakeDeskFace(name: string): Promise<DeskFaceBake>;
export declare function staleFiles(
  face: Pick<DeskFaceBake, "files" | "baked">,
  read: (file: string) => Uint8Array | undefined,
): string[];
