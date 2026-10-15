#!/usr/bin/env node
// WP12-D12 (build-wp12-updater.md, L3a; ESP §13.3 item 17, EDP §13.3) — the asar allowlist: every path in a built app's
// `app.asar` and `app.asar.unpacked` must be in the stage's `app/` census (`apps/desktop/build/stage/app`), and any
// `node_modules` path fails. A duplicate signed executable inside the asar (the second `sidecar-slim` an
// `optionalDependencies` row packs) is exactly what Squirrel.Mac's strict nested validation trips on SILENTLY
// (EDP §16.1); this makes the class a gate, not a review. Run on the built app in the release workflow's build job, and
// on `package:dir`'s output by hand (D12's measurement).
//
// The asar header is read here, read-only, rather than through `@electron/asar` (a transitive dependency this repo does
// not declare): an archive starts with an 8-byte pickle whose second word is the header pickle's size; that pickle
// holds a length-prefixed JSON directory of nested `files`, each file entry carrying `size` and, when packed beside the
// archive, `unpacked: true`.
//
// usage: node scripts/audit-asar.mjs --app <VibeField.app | unpacked dir> --stage-app <apps/desktop/build/stage/app>

import { closeSync, existsSync, lstatSync, openSync, readdirSync, readSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export class AsarAuditError extends Error {}

/** The archive's JSON directory (header only; no file is read). */
export function readAsarHeader(path) {
  const fd = openSync(path, "r");
  try {
    const sizeBuf = Buffer.alloc(8);
    if (readSync(fd, sizeBuf, 0, 8, 0) !== 8)
      throw new AsarAuditError(`${path}: too short to be an asar`);
    const headerPickleSize = sizeBuf.readUInt32LE(4);
    const header = Buffer.alloc(headerPickleSize);
    if (readSync(fd, header, 0, headerPickleSize, 8) !== headerPickleSize)
      throw new AsarAuditError(`${path}: the header is truncated`);
    const jsonLength = header.readUInt32LE(4);
    return JSON.parse(header.subarray(8, 8 + jsonLength).toString("utf8"));
  } finally {
    closeSync(fd);
  }
}

/** Every file path in the directory (`/`-separated), and which of them are packed beside the archive. */
export function asarFiles(header, prefix = "") {
  const out = [];
  for (const [name, entry] of Object.entries(header.files ?? {})) {
    const path = prefix === "" ? name : `${prefix}/${name}`;
    if (entry.files !== undefined) out.push(...asarFiles(entry, path));
    else if (entry.link === undefined) out.push({ path, unpacked: entry.unpacked === true });
  }
  return out;
}

function listTree(root, dir = root, out = new Set()) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (lstatSync(path).isDirectory()) listTree(root, path, out);
    else out.add(relative(root, path).split(sep).join("/"));
  }
  return out;
}

function resourcesOf(app) {
  for (const candidate of [join(app, "Contents", "Resources"), join(app, "resources")])
    if (existsSync(join(candidate, "app.asar"))) return candidate;
  throw new AsarAuditError(`${app}: no app.asar under Contents/Resources or resources`);
}

/** The audit: returns the problems (empty = clean). */
export function auditAsar({ app, stageApp }) {
  const resources = resourcesOf(app);
  const census = listTree(stageApp);
  if (census.size === 0) throw new AsarAuditError(`${stageApp}: the stage's app/ census is empty`);
  const problems = [];
  const files = asarFiles(readAsarHeader(join(resources, "app.asar")));
  const unpackedOnDisk = listTree(join(resources, "app.asar.unpacked"));
  for (const path of [...files.map((file) => file.path), ...unpackedOnDisk]) {
    if (path.split("/").includes("node_modules"))
      problems.push(`${path}: a node_modules path in the asar`);
    else if (!census.has(path)) problems.push(`${path}: not in the stage's app/ census`);
  }
  return [...new Set(problems)].sort();
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith("--")) throw new AsarAuditError(`unexpected argument "${key}"`);
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const a = args(process.argv.slice(2));
    if (!a.app || !a["stage-app"]) throw new AsarAuditError("--app and --stage-app are required");
    const problems = auditAsar({ app: a.app, stageApp: a["stage-app"] });
    if (problems.length > 0) {
      console.error(
        `audit-asar: ${problems.length} path(s) outside the allowlist:\n  ${problems.join("\n  ")}`,
      );
      process.exit(1);
    }
    console.log(
      "audit-asar: every asar path is in the stage's app/ census, and none is node_modules",
    );
  } catch (error) {
    console.error(`audit-asar: ${error instanceof AsarAuditError ? error.message : error.stack}`);
    process.exit(1);
  }
}
