#!/usr/bin/env node
// Every golden the iOS test bundles carry must be the contracts' own bytes.
//
// EL9 says a seam is pinned by fixtures parsed on BOTH sides; the phone is the
// third side, and it holds COPIES because its bundle cannot reach across the
// workspace. A copy is only evidence while it is identical — and this lane
// shipped a "byte for byte" claim that was already false by one line of
// formatting, with nothing to notice. This is the thing that notices.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const contracts = join(root, "packages/contracts/fixtures");
const searchRoots = [
  join(root, "apps/ios/VibeFieldKit/Tests"),
  join(root, "apps/ios/VibeFieldKit/Sources"),
];

/** Every `*.json` under a tree, however deep. */
function jsonFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...jsonFiles(path));
    else if (entry.name.endsWith(".json")) found.push(path);
  }
  return found;
}

const problems = [];
let checked = 0;

for (const searchRoot of searchRoots) {
  for (const copy of jsonFiles(searchRoot)) {
    const name = copy.slice(copy.lastIndexOf("/") + 1);
    const origin = join(contracts, name);
    try {
      statSync(origin);
    } catch {
      // Not a contracts golden — a fixture this lane authored for itself, which
      // is allowed and is not this script's business.
      continue;
    }
    checked += 1;
    const a = readFileSync(origin);
    const b = readFileSync(copy);
    if (!a.equals(b)) {
      problems.push(
        `${relative(root, copy)} differs from ${relative(root, origin)}\n` +
          `  fix: cp ${relative(root, origin)} ${relative(root, copy)}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`ios fixtures: ${problems.length} of ${checked} copies are stale\n`);
  for (const problem of problems) console.error(`  ${problem}\n`);
  process.exit(1);
}

console.log(`ios fixtures: ${checked} copies identical to packages/contracts/fixtures`);
