#!/usr/bin/env node
// WP12 L3b-ii (B8; `build-wp12-updater.md` §12, W8 as corrected 2026-10-15) — the packaged app's update config:
// `Resources/app-update.yml` must be present (electron-updater reads its cache directory's name from it, even with
// VibeField's custom provider: `AppUpdater.js:545`), name `provider: github` (D13's frozen origin), and carry NO token
// (no credential on an end-user machine, EDP §11.4). electron-builder writes it only for a dmg or zip target
// (`PublishManager.js:77-80`), so this runs on the release build's app, never on `package:dir`'s.
//
// usage: node scripts/audit-app-update.mjs --app <VibeField.app | unpacked dir>

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export class AppUpdateAuditError extends Error {}

/** The audit: the problems (empty = clean). */
export function auditAppUpdate(app) {
  const candidates = [
    join(app, "Contents", "Resources", "app-update.yml"),
    join(app, "resources", "app-update.yml"),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (path === undefined) return ["app-update.yml is missing (built for a dmg or zip target?)"];
  const text = readFileSync(path, "utf8");
  const problems = [];
  if (!/^provider:[ \t]*['"]?github['"]?[ \t]*$/m.test(text))
    problems.push("app-update.yml does not name provider: github");
  if (/token/i.test(text)) problems.push("app-update.yml carries a token");
  if (!/^updaterCacheDirName:[ \t]*\S+/m.test(text))
    problems.push("app-update.yml names no updaterCacheDirName");
  return problems;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--app");
  const app = at === -1 ? undefined : process.argv[at + 1];
  if (app === undefined) {
    console.error("audit-app-update: --app is required");
    process.exit(1);
  }
  const problems = auditAppUpdate(app);
  if (problems.length > 0) {
    console.error(`audit-app-update: ${problems.join("; ")}`);
    process.exit(1);
  }
  console.log("audit-app-update: app-update.yml present, provider github, no token");
}
