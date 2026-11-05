// WP12d (L3b-i, `build-wp12-updater.md` §12 B3; the PM's ruling 2026-10-15 16:03Z) — the native plane, read by DIGEST.
// A release leaves field-native untouched only when what the running floor can still exec is the same: the floor
// AND every executable it execs from its own directory (`field-terminal-host`, `config.rs` `cell_binary()`;
// `field-freeway-host`, `freeway_binary()`, F1; `sidecar-slim` or `truffle-sidecar`, `mesh.rs` `SIDECAR_NAMES`). The
// client hashes its OWN installed plane and compares it — members and digest — with the head release's signed
// manifest. Anything it cannot read, or any difference, reads as TOUCHED: today's behaviour, the floor stopped under
// the census gate.
//
// `scripts/release-manifest.mjs` computes the manifest's side by the same rule (a line per member, the lines sorted,
// the digest their sha256); the release-scripts tests hold the two to one digest on one fixture app.
//
// TD-4 (LP-D16, 2026-11-05): a member's line is `bin/<name>\0cdhash:<hex>` when it is a signed Mach-O, its
// CodeDirectory's SHA-256 — the code the kernel runs, never the CMS blob whose signing time and timestamp make every
// release's bytes new — and `bin/<name>\0<sha256>` of its bytes otherwise (a symlink, an unsigned build, anything the
// reader does not read whole). Both hashers read it from ONE copy, `code-directory.mjs` beside this file.

import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import type { ReleaseManifest } from "@vibefield/contracts";
import { memberLine } from "./code-directory.mjs";

/** field-native and every executable it execs from its own directory (`.exe` stripped on Windows). */
export const NATIVE_PLANE_NAMES = [
  "field-native",
  "field-terminal-host",
  "field-freeway-host",
  "sidecar-slim",
  "truffle-sidecar",
] as const;
const NATIVE = new Set<string>(NATIVE_PLANE_NAMES);

export interface NativePlane {
  /** sha256 over the sorted member lines: `bin/<name>\0cdhash:<hex>` signed, `bin/<name>\0<sha256>` by bytes (TD-4) */
  readonly digest: string;
  /** `bin/<name>`, sorted */
  readonly members: readonly string[];
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The installed app's native plane, from its resources directory (`process.resourcesPath`). */
export async function hashNativePlane(resourcesDir: string): Promise<NativePlane> {
  const bin = join(resourcesDir, "bin");
  const names = await readdir(bin).catch((): string[] => []);
  const lines: string[] = [];
  const members: string[] = [];
  for (const name of names) {
    if (!NATIVE.has(name.replace(/\.exe$/i, ""))) continue;
    const path = join(bin, name);
    const stat = await lstat(path);
    if (stat.isDirectory()) continue; // the manifest's walk files a directory's contents under fieldd, never here
    const content = stat.isSymbolicLink()
      ? Buffer.from(`link:${await readlink(path)}`)
      : await readFile(path);
    const rel = `bin/${name}`;
    lines.push(memberLine(rel, content));
    members.push(rel);
  }
  return { digest: sha256(lines.sort().join("\n")), members: members.sort() };
}

/** Why a release counts as touching the native plane (or that it does not). */
export type NativeVerdict =
  | { readonly touched: false }
  | {
      readonly touched: true;
      /** `head-moved`: the verified head is not the staged version, so its manifest says nothing of the staged bytes */
      readonly why: "no-manifest" | "no-build" | "unreadable" | "members" | "digest" | "head-moved";
    };

/** B3: untouched only when this platform's build names the SAME members with the SAME digest as the installed plane. */
export function nativeVerdict(
  manifest: ReleaseManifest | null,
  platformKey: string,
  local: NativePlane | null,
): NativeVerdict {
  if (manifest === null) return { touched: true, why: "no-manifest" };
  if (local === null) return { touched: true, why: "unreadable" };
  const build = manifest.builds[platformKey]?.["field-native"];
  if (build === undefined) return { touched: true, why: "no-build" };
  const theirs = build.members ?? [];
  if (
    theirs.length !== local.members.length ||
    theirs.some((member, i) => member !== local.members[i])
  ) {
    return { touched: true, why: "members" };
  }
  if (build.digest !== local.digest) return { touched: true, why: "digest" };
  return { touched: false };
}
