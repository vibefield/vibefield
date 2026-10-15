#!/usr/bin/env node
// WP12-D11 (build-wp12-updater.md, L3a) — the release's planes, COMPUTED from bytes (H4 item 4's binary hash manifest,
// which WP8-D8 deferred here). Each built app is hashed per plane; the converge step merges every platform's hashes
// into `release-manifest.json` and marks a plane TOUCHED when its digest differs from the previous release's on any
// platform — a hand-declared plane list is how a native change rides a "shell-only" release. The sign step signs it.
//
// The planes, by path under the app's resources directory:
//   - field-native: `bin/field-native`, `bin/field-terminal-host`, `bin/sidecar-slim` (the floor and its
//     `current_exe()` siblings);
//   - fieldd: every OTHER file under `bin/` (fieldd's SEA and the sidecars it resolves beside itself, rosettad, which
//     it supervises) and `plugins/` (the roots it reads at spawn);
//   - shell: every other file in the app (Electron, the asar, the frameworks, the identity).
//
// usage: node scripts/release-manifest.mjs hash --app <VibeField.app | unpacked dir> --platform <mac-arm64|…>
//          --out <platform-hashes.json>
//        node scripts/release-manifest.mjs merge --hashes <a.json,b.json,…> --version <v> --tag <t> --channel <c>
//          --commit <sha> [--previous <previous release-manifest.json>] --out <release-manifest.json>

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

export const PLANES = ["shell", "fieldd", "field-native"];
const NATIVE_FLOOR = new Set(["field-native", "field-terminal-host", "sidecar-slim"]);

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

/** Every file of the app, hashed (a symlink by its target text: a bundle's framework links are part of its bytes). */
export function hashPlanes(app) {
  const resources = resourcesDirOf(app);
  const files = [];
  walk(app, app, files);
  const lines = { shell: [], fieldd: [], "field-native": [] };
  for (const path of files) {
    const rel = relative(app, path).split(sep).join("/");
    const inResources = path.startsWith(resources + sep);
    const plane = planeOf(inResources ? relative(resources, path).split(sep).join("/") : null);
    const stat = lstatSync(path);
    const content = stat.isSymbolicLink()
      ? Buffer.from(`link:${readlinkSync(path)}`)
      : readFileSync(path);
    lines[plane].push(`${rel}\0${createHash("sha256").update(content).digest("hex")}`);
  }
  const planes = {};
  for (const plane of PLANES) {
    planes[plane] = {
      digest: createHash("sha256").update(lines[plane].sort().join("\n")).digest("hex"),
      files: lines[plane].length,
    };
  }
  return planes;
}

/** Merge every platform's hashes into the manifest; `touched` against the previous release's (all on a first). */
export function mergeManifest({ version, tag, channel, commit, builds, previous }) {
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
  };
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith("--")) throw new ReleaseManifestError(`unexpected argument "${key}"`);
    out[key.slice(2)] = argv[i + 1];
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
      writeFileSync(
        a.out,
        `${JSON.stringify({ platform: a.platform, planes: hashPlanes(a.app) }, null, 2)}\n`,
      );
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
      });
      writeFileSync(a.out, `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(
        `release-manifest: ${a.tag} touches ${manifest.touched.join(", ") || "no plane"}`,
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
