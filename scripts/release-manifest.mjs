#!/usr/bin/env node
// WP12-D11 (build-wp12-updater.md, L3a) — the release's planes, COMPUTED from bytes (H4 item 4's binary hash manifest,
// which WP8-D8 deferred here). Each built app is hashed per plane; the converge step merges every platform's hashes
// into `release-manifest.json` and marks a plane TOUCHED when its digest differs from the previous release's on any
// platform — a hand-declared plane list is how a native change rides a "shell-only" release. The sign step signs it.
//
// The planes, by path under the app's resources directory:
//   - field-native: `bin/field-native` and EVERY executable it execs from its own directory — `bin/field-terminal-host`
//     (`config.rs` `cell_binary()`), `bin/field-freeway-host` (`freeway_binary()`, F1), `bin/sidecar-slim` or
//     `bin/truffle-sidecar` (`mesh.rs` `SIDECAR_NAMES`). The manifest NAMES these members: the client compares the
//     set as well as the digest (L3b-i, the PM's ruling 2026-10-15 16:03Z, B3), because a release that adds or
//     drops one changes what the running floor can exec;
//   - fieldd: every OTHER file under `bin/` (fieldd's SEA and the sidecars it resolves beside itself, rosettad, which
//     it supervises) and `plugins/` (the roots it reads at spawn);
//   - shell: every other file in the app (Electron, the asar, the frameworks, the identity).
//
// TD-4 (LP-D16, 2026-11-05): a field-native member that is a signed Mach-O is digested by its CodeDirectory (its line
// `bin/<name>\0cdhash:<hex>`), never its bytes: a Developer ID signature's CMS blob carries a signing time and a secure
// timestamp, so the same code signed to new bytes every release and field-native read touched every time. Anything else
// keeps the byte rule (`bin/<name>\0<sha256>`; the other planes' every line). The rule is ONE copy, main's
// `code-directory.mjs`, which the client's `native-plane.ts` reads too. `hash` says which way each member was read.
//
// TD-4's strict mode (VF-PM's ruling, 2026-11-05 01:59Z): `hash --require-cdhash` REFUSES a field-native member read by
// its bytes, naming each such member and why, and exits non-zero before it writes the hashes. The release workflow
// passes it on the signed macOS path alone: there every floor member is signed, so a byte read means the signature was
// not read whole, and a silent fallback would read every release touched again. Without the flag (dev, unsigned and
// non-mac builds) the fallback stands as before. It checks HOW each member was read, never WHO signed it: an ad-hoc
// signature reads by its cdhash too and passes. This plane's Developer ID rests on notarization alone
// (electron-builder.release.yml's `notarize: true`); the `--require-signed` verifiers (verify-files-package,
// verify-history-package) read fieldd, mille's addon and rosettad, no member of this plane, and host-links' `--version`
// launch of the floor's binaries proves they start, not who signed them.
//
// AU-6 (AU-D10 A; LC-19): `merge --notes` writes the release's notes (`scripts/release-notes.mjs`'s output) INTO the
// manifest before the sign step signs it, so they ride under its one `release` signature: no new signature, no new key.
// A notes file that is absent (a first release of its channel) leaves the field out.
//
// usage: node scripts/release-manifest.mjs hash --app <VibeField.app | unpacked dir> --platform <mac-arm64|…>
//          --out <platform-hashes.json> [--require-cdhash]
//        node scripts/release-manifest.mjs merge --hashes <a.json,b.json,…> --version <v> --tag <t> --channel <c>
//          --commit <sha> [--previous <previous release-manifest.json>] [--notes <notes.json>]
//          --out <release-manifest.json>

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  lineOf,
  memberDigest,
} from "../packages/electron-shell/src/main/updates/code-directory.mjs";
import { FLOOR_BINARIES } from "./native-floor.mjs";

export const PLANES = ["shell", "fieldd", "field-native"];
// The floor's set (`native-floor.mjs`: the floor, its cell, its freeway host) and the sidecars it execs from the same
// directory. Main's `native-plane.ts` names the same set (its cross-test holds the two to one digest).
const NATIVE_FLOOR = new Set([...FLOOR_BINARIES, "sidecar-slim", "truffle-sidecar"]);

export class ReleaseManifestError extends Error {}

/** A file's plane, from its path relative to the resources directory (`null` = outside it: the shell's). */
export function planeOf(resourcesRelative) {
  if (resourcesRelative === null) return "shell";
  const parts = resourcesRelative.split(/[\\/]/);
  if (parts[0] === "bin" && parts.length === 2) {
    const name = parts[1].replace(/\.exe$/i, "");
    return NATIVE_FLOOR.has(name) ? "field-native" : "fieldd";
  }
  if (parts[0] === "bin" || parts[0] === "plugins") return "fieldd";
  return "shell";
}

/** The resources directory of a built app: `Contents/Resources` in a macOS bundle, `resources` elsewhere. */
export function resourcesDirOf(app) {
  const mac = join(app, "Contents", "Resources");
  if (existsSync(mac)) return mac;
  const other = join(app, "resources");
  if (existsSync(other)) return other;
  throw new ReleaseManifestError(
    `${app}: neither Contents/Resources nor resources — not a built app`,
  );
}

function walk(root, dir, out) {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    const stat = lstatSync(path);
    if (stat.isDirectory()) walk(root, path, out);
    else out.push(path);
  }
}

/** Every file of the app, hashed (a symlink by its target text: a bundle's framework links are part of its bytes).
 * A line's path is resources-relative for a file inside the resources directory, app-relative otherwise; the
 * field-native plane also names its members (sorted), each line by `code-directory.mjs` (TD-4: a signed Mach-O by its
 * cdhash).
 * `log` hears how each field-native member was read. `requireCdhash` (TD-4's strict mode, a signed macOS release): a
 * field-native member read by its bytes, or a plane with no member at all, is a ReleaseManifestError naming each member
 * and why — thrown after every member is read and logged, so the build log shows the whole plane. */
export function hashPlanes(app, log = () => {}, { requireCdhash = false } = {}) {
  const resources = resourcesDirOf(app);
  const files = [];
  walk(app, app, files);
  const lines = { shell: [], fieldd: [], "field-native": [] };
  const nativeMembers = [];
  const byBytes = [];
  for (const path of files) {
    const inResources = path.startsWith(resources + sep);
    const rel = relative(inResources ? resources : app, path)
      .split(sep)
      .join("/");
    const plane = planeOf(inResources ? rel : null);
    const stat = lstatSync(path);
    const content = stat.isSymbolicLink()
      ? Buffer.from(`link:${readlinkSync(path)}`)
      : readFileSync(path);
    if (plane === "field-native") {
      const member = memberDigest(content);
      lines[plane].push(lineOf(rel, member));
      nativeMembers.push(rel);
      log(`${rel}: by ${member.by === "cdhash" ? "its cdhash" : `its bytes (${member.why})`}`);
      if (member.by === "bytes") byBytes.push(`${rel} (${member.why})`);
    } else {
      lines[plane].push(`${rel}\0${createHash("sha256").update(content).digest("hex")}`);
    }
  }
  if (requireCdhash && nativeMembers.length === 0)
    throw new ReleaseManifestError(
      `--require-cdhash: ${app} has no field-native member to read by its CodeDirectory`,
    );
  if (requireCdhash && byBytes.length > 0)
    throw new ReleaseManifestError(
      `--require-cdhash: a signed release reads every field-native member by its CodeDirectory (TD-4), never by its bytes — read by its bytes: ${byBytes.join("; ")}`,
    );
  const planes = {};
  for (const plane of PLANES) {
    planes[plane] = {
      digest: createHash("sha256").update(lines[plane].sort().join("\n")).digest("hex"),
      files: lines[plane].length,
      ...(plane === "field-native" ? { members: nativeMembers.sort() } : {}),
    };
  }
  return planes;
}

/** Merge every platform's hashes into the manifest; `touched` against the previous release's (all on a first). AU-6:
 * `notes`, when given, ride in the manifest; notes counted from a release other than the `previous` it names are
 * refused here, before signing (both read the same previous manifest in the sign job). */
export function mergeManifest({ version, tag, channel, commit, builds, previous, notes }) {
  if (notes !== undefined && notes !== null) {
    const since = notes.since?.tag ?? null;
    if (since !== (previous?.tag ?? null))
      throw new ReleaseManifestError(
        `the notes count from ${since ?? "no release"}, but the manifest's previous is ${previous?.tag ?? "none"}`,
      );
  }
  const touched = PLANES.filter((plane) => {
    if (previous === null) return true;
    return Object.entries(builds).some(([platform, planes]) => {
      const before = previous.builds?.[platform]?.[plane]?.digest;
      return before === undefined || before !== planes[plane].digest;
    });
  });
  return {
    schemaVersion: 1,
    version,
    tag,
    channel,
    commit,
    builds,
    touched,
    previous: previous?.tag ?? null,
    ...(notes !== undefined && notes !== null ? { notes } : {}),
  };
}

/** The flags that take no value (TD-4's strict mode); every other flag takes the argument after it. */
const SWITCHES = new Set(["require-cdhash"]);

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key?.startsWith("--")) throw new ReleaseManifestError(`unexpected argument "${key}"`);
    const name = key.slice(2);
    if (SWITCHES.has(name)) out[name] = true;
    else out[name] = argv[++i];
  }
  return out;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...rest] = process.argv.slice(2);
    const a = args(rest);
    if (command === "hash") {
      if (!a.app || !a.platform || !a.out)
        throw new ReleaseManifestError("hash needs --app, --platform and --out");
      const planes = hashPlanes(
        a.app,
        (line) => console.log(`release-manifest: field-native ${line}`),
        { requireCdhash: a["require-cdhash"] === true },
      );
      writeFileSync(a.out, `${JSON.stringify({ platform: a.platform, planes }, null, 2)}\n`);
      console.log(`release-manifest: hashed ${a.app} for ${a.platform}`);
    } else if (command === "merge") {
      const builds = {};
      for (const file of (a.hashes ?? "").split(",").filter(Boolean)) {
        const doc = JSON.parse(readFileSync(file, "utf8"));
        builds[doc.platform] = doc.planes;
      }
      if (Object.keys(builds).length === 0)
        throw new ReleaseManifestError("merge needs at least one --hashes file");
      const manifest = mergeManifest({
        version: a.version,
        tag: a.tag,
        channel: a.channel,
        commit: a.commit,
        builds,
        previous:
          a.previous && existsSync(a.previous)
            ? JSON.parse(readFileSync(a.previous, "utf8"))
            : null,
        // AU-6: release-notes.mjs writes no file for a first release of its channel
        ...(a.notes && existsSync(a.notes)
          ? { notes: JSON.parse(readFileSync(a.notes, "utf8")) }
          : {}),
      });
      writeFileSync(a.out, `${JSON.stringify(manifest, null, 2)}\n`);
      const withNotes = manifest.notes !== undefined ? ", with its notes" : "";
      console.log(
        `release-manifest: ${a.tag} touches ${manifest.touched.join(", ") || "no plane"}${withNotes}`,
      );
    } else {
      throw new ReleaseManifestError(`unknown command "${command ?? ""}" (hash | merge)`);
    }
  } catch (error) {
    console.error(
      `release-manifest: ${error instanceof ReleaseManifestError ? error.message : error.stack}`,
    );
    process.exit(1);
  }
}
