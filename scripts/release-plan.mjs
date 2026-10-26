#!/usr/bin/env node
// WP12 (build-wp12-updater.md D6, D7, D14; L3a) — the release workflow's PLAN: which release this run is, before
// anything is built. One answer, as JSON (and as `key=value` lines for `$GITHUB_OUTPUT` with `--github-output`):
//   - a `schedule` or `workflow_dispatch` run is a NIGHTLY: tag `nightly-YYYYMMDD` (UTC), version
//     `<product>-nightly.YYYYMMDD` — the one version a tool stamps (D6, RM-D7's stated exception) — and it is SKIPPED
//     when main is red or unchanged since the last PUBLISHED nightly (RL4 (a)), or when today's nightly tag already
//     exists (a tag name is burned once used, D7: a second nightly in one UTC day waits for the next);
//   - a pushed `v*` tag is a BETA (`vX.Y.Z-beta.N`) or a STABLE (`vX.Y.Z`), whose version must already be the committed
//     product version (betas and stables are commit-bumped, RM-D7); a mismatch refuses the run.
// Nightlies and betas are GitHub prereleases; only a stable is `latest` (`releases/latest/download/` reaches stable, D4).
//
// THE TAG IS MADE AT PLAN TIME (2026-10-26, VF-PM's ruling A): GitHub refuses GITHUB_TOKEN a tag, and so a release that
// would create one, at a commit whose .github/workflows differ from main's head ("the GITHUB_TOKEN available to GitHub
// Actions cannot be authorized for this"). Nightly 40342606623's publish met that twice, after a push changed workflows
// between its plan and its publish. So release.yml's `tag` job makes the run's tag right after plan, while the planned
// commit is main's head (`tagAction`), and publish only asserts it. A red nightly therefore leaves its tag with no
// release, which is why "unchanged" reads the newest PUBLISHED nightly, and "today's" still the newest tag.
//
// usage: node scripts/release-plan.mjs --event <schedule|workflow_dispatch|push> --ref <git ref> --commit <sha>
//          [--now <ms>] [--last-nightly-tag <tag>] [--last-published-nightly-commit <sha>]
//          [--main-green <true|false>] [--github-output <file>]
//        node scripts/release-plan.mjs stamp --version <version>   (writes apps/desktop/package.json's version)
//        node scripts/release-plan.mjs tag --tag <tag> --commit <sha> [--existing <sha>]   (prints create | present)

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP_PACKAGE = join(repo, "apps/desktop/package.json");

export class ReleasePlanError extends Error {}
const refuse = (message) => {
  throw new ReleasePlanError(message);
};

const SEMVER = /^\d+\.\d+\.\d+$/;
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

/** The release this run is. `productVersion` is the committed `apps/desktop/package.json` version. */
export function planRelease({
  event,
  ref,
  commit,
  now = Date.now(),
  productVersion,
  lastNightlyTag = null,
  lastPublishedNightlyCommit = null,
  mainGreen = true,
}) {
  if (!SEMVER.test(productVersion)) refuse(`the product version "${productVersion}" is not X.Y.Z`);
  if (event === "schedule" || event === "workflow_dispatch") {
    const day = utcDay(now);
    const base = {
      channel: "nightly",
      tag: `nightly-${day}`,
      version: `${productVersion}-nightly.${day}`,
      prerelease: true,
      makeLatest: false,
      commit,
    };
    if (!mainGreen)
      return { ...base, skip: true, reason: "main is red: no nightly from a red trunk" };
    if (lastPublishedNightlyCommit !== null && lastPublishedNightlyCommit === commit)
      return { ...base, skip: true, reason: "main is unchanged since the last published nightly" };
    if (lastNightlyTag === base.tag)
      return {
        ...base,
        skip: true,
        reason: `today's nightly exists (${base.tag}); a tag name is used once (D7), so the next waits for tomorrow`,
      };
    return { ...base, skip: false };
  }
  if (event === "push") {
    const tag = ref.replace(/^refs\/tags\//, "");
    const beta = /^v(\d+\.\d+\.\d+)-beta\.(\d+)$/.exec(tag);
    const stable = /^v(\d+\.\d+\.\d+)$/.exec(tag);
    if (!beta && !stable)
      refuse(`"${tag}" is neither a beta (vX.Y.Z-beta.N) nor a stable (vX.Y.Z) tag`);
    const version = tag.slice(1);
    const core = (beta ?? stable)[1];
    if (core !== productVersion)
      refuse(
        `the tag ${tag} names ${core}, but apps/desktop/package.json says ${productVersion}: betas and stables are commit-bumped (RM-D7)`,
      );
    return {
      channel: beta ? "beta" : "stable",
      tag,
      version,
      prerelease: Boolean(beta),
      makeLatest: !beta,
      commit,
      skip: false,
    };
  }
  return refuse(`a release runs on a schedule, a dispatch or a pushed tag — not on "${event}"`);
}

/** The run's tag, made once at the planned commit: `create` when it does not exist, `present` when it already points
 * there (a re-run, or a pushed beta/stable tag), and refused when it points anywhere else — a tag name is used once
 * (D7). `existing` is the commit the tag points at, peeled, or null. */
export function tagAction({ tag, commit, existing = null }) {
  if (!existing) return "create";
  if (existing === commit) return "present";
  return refuse(
    `${tag} already points at ${existing}, not at this run's commit ${commit}: a tag name is used once (D7)`,
  );
}

/** D6: a nightly's version, stamped into the runner's checkout only — never committed. */
export function stampVersion(version, path = DESKTOP_PACKAGE) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version))
    refuse(`"${version}" is not a semver version`);
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith("--")) refuse(`unexpected argument "${key}"`);
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    if (argv[0] === "stamp") {
      const a = args(argv.slice(1));
      stampVersion(a.version);
      console.log(
        `release-plan: apps/desktop/package.json version → ${a.version} (this checkout only)`,
      );
    } else if (argv[0] === "tag") {
      const a = args(argv.slice(1));
      console.log(tagAction({ tag: a.tag, commit: a.commit, existing: a.existing || null }));
    } else {
      const a = args(argv);
      const plan = planRelease({
        event: a.event,
        ref: a.ref ?? "",
        commit: a.commit,
        now: a.now ? Number(a.now) : Date.now(),
        productVersion: JSON.parse(readFileSync(DESKTOP_PACKAGE, "utf8")).version,
        lastNightlyTag: a["last-nightly-tag"] || null,
        lastPublishedNightlyCommit: a["last-published-nightly-commit"] || null,
        mainGreen: a["main-green"] !== "false",
      });
      console.log(JSON.stringify(plan));
      if (a["github-output"]) {
        appendFileSync(
          a["github-output"],
          `${Object.entries(plan)
            .map(([key, value]) => `${key}=${value}`)
            .join("\n")}\n`,
        );
      }
    }
  } catch (error) {
    console.error(
      `release-plan: ${error instanceof ReleasePlanError ? error.message : error.stack}`,
    );
    process.exit(1);
  }
}
