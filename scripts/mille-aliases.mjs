// FS-1b: rosetta's own link cannot choose a third engine for our renderer.
// RD-5 (the EL8 to mille 0.3.6, 2026-11-17): mille's npm plane is released. The aliases into the locked checkout stand only
// while a checkout is LINKED (a dev lock, or the overlay's `pnpm siblings use mille`); unlinked, both renderer
// resolvers take the installed packages, and check:deps holds every consumer to the release (`milleCopies`).
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { linkedPackages, readLock, siblingDir } from "./siblings.mjs";

/** The two renderer resolvers that must install the aliases before any other alias. */
const RENDERER_CONFIGS = [
  "packages/electron-shell/vite.config.ts",
  "packages/field-app/vitest.config.ts",
];

/** mille's direct consumers in this tree. */
const CONSUMERS = [
  ["packages/fieldd", "@vibecook/mille"],
  ["packages/field-app", "@vibecook/mille"],
  ["packages/field-app", "@vibecook/mille-ui"],
];

/** The History room, whose own dependencies take this tree's mille rows. */
const ROOM = "@vibefield/rosetta-room";

/** The renderer's aliases into a LINKED mille checkout: every export of each package. `[]` when the lock names no
 * mille, and when its npm plane is released and the overlay does not link it (RD-5). */
export function milleAliases(root) {
  const lock = readLock(root);
  const entry = lock?.siblings?.mille;
  if (!entry) return [];
  const linked = linkedPackages(root, lock);
  if (!Object.keys(entry.packages).some((name) => linked.has(name))) return [];
  return Object.entries(entry.packages)
    .flatMap(([name, folder]) => {
      const dir = join(siblingDir(root, entry), folder);
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      return Object.entries(manifest.exports).map(([key, value]) => ({
        find: name + (key === "." ? "" : key.slice(1)),
        replacement: join(dir, typeof value === "string" ? value : (value.import ?? value.default)),
      }));
    })
    .sort((a, b) => b.find.length - a.find.length);
}

/** `name` as Node resolves it for code in `from`: the nearest `node_modules/<name>` at or above it, no higher than
 * `top`, as a real path; null when there is none. Not `require.resolve`: mille exports no `./package.json`. */
function installedFrom(top, from, name) {
  for (let dir = from; ; dir = dirname(dir)) {
    try {
      return realpathSync(join(dir, "node_modules", name));
    } catch {
      // not installed here
    }
    if (dir === top || dirname(dir) === dir) return null;
  }
}

function versionOf(dir) {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
}

/** One copy's lines in a duplicate report, check-single-copy's own shape (gate-landing reads it). */
function copyLine(dir, from) {
  return `      ${versionOf(dir)}  ← ${from.join(", ")}\n        ${dir}`;
}

/** Why each package must be one real directory at run time. */
const ONE_COPY = {
  "@vibecook/mille": "the engine and its clients load one copy",
  "@vibecook/mille-ui": "the renderer bundles field-app's and the room's as one",
};

/** check:deps' mille law (scripts/check-single-copy.mjs). LINKED: every direct consumer resolves the locked
 * checkout, and both renderer resolvers install its aliases first, because a version string alone cannot tell two
 * unreleased builds apart. RELEASED and unlinked (RD-5, 2026-11-13): every consumer —
 * fieldd's and field-app's `@vibecook/mille`, field-app's mille-ui and the room's own two — resolves the lock's
 * `release.npm`; `@vibecook/mille` is ONE real directory for all three; and field-app's mille-ui and the room's are
 * ONE real directory, so the renderer bundles one. The copies are counted in the report.
 * `{ problems, report }`; `report` is null when the lock names no mille. */
export function milleCopies(root) {
  const entry = readLock(root)?.siblings?.mille;
  if (!entry) return { problems: [], report: null };
  const problems = [];
  for (const config of RENDERER_CONFIGS) {
    const source = readFileSync(join(root, config), "utf8");
    if (
      !source.includes('from "../../scripts/mille-aliases.mjs"') ||
      !/alias:\s*\[\s*\.\.\.milleAliases\(/.test(source)
    )
      problems.push(`${config} must install the locked mille aliases before other aliases`);
  }
  const aliases = milleAliases(root);
  if (aliases.length > 0) {
    for (const [consumer, name] of CONSUMERS) {
      const expected = aliases.find((alias) => alias.find === name)?.replacement;
      let actual;
      try {
        actual = realpathSync(join(root, consumer, "node_modules", name));
      } catch {}
      const locked = realpathSync(join(siblingDir(root, entry), entry.packages[name]));
      if (!expected || !actual || actual !== locked)
        problems.push(`${consumer} resolves ${name} outside the locked mille checkout`);
    }
    for (const alias of aliases) {
      if (!existsSync(alias.replacement))
        problems.push(
          `${alias.find} has no built export at ${alias.replacement}; build the pinned mille sibling`,
        );
    }
    return {
      problems,
      report: `mille@${entry.sha.slice(0, 8)} (daemon, renderer and room pinned together)`,
    };
  }
  const top = realpathSync(root);
  const copies = new Map(); // package -> Map<real directory | null, consumers>
  const note = (name, from, dir) => {
    const byPath = copies.get(name) ?? new Map();
    byPath.set(dir, [...(byPath.get(dir) ?? []), from]);
    copies.set(name, byPath);
  };
  for (const [consumer, name] of CONSUMERS) {
    note(name, consumer, installedFrom(top, join(top, consumer), name));
  }
  const room = installedFrom(top, join(top, "packages/field-app"), ROOM);
  if (room === null) {
    problems.push(`packages/field-app resolves no ${ROOM}, so the room's mille is unread`);
  } else {
    for (const name of Object.keys(entry.packages)) {
      note(name, `the room (${ROOM})`, installedFrom(top, room, name));
    }
  }
  const release = entry.release?.npm;
  const counts = [];
  for (const [name, byPath] of copies) {
    const missing = byPath.get(null);
    if (missing !== undefined) problems.push(`${missing.join(", ")}: no ${name} resolves`);
    const found = [...byPath].filter(([dir]) => dir !== null);
    for (const [dir, from] of found) {
      const version = versionOf(dir);
      if (version !== release) {
        const at = `${name}@${version}`;
        problems.push(`${from.join(", ")}: ${at}, but the lock's release is ${release}`);
      }
    }
    if (found.length > 1) {
      const lines = found.map(([dir, from]) => copyLine(dir, from)).join("\n");
      problems.push(
        `${found.length} distinct ${name} copies are resolvable (${ONE_COPY[name]}):\n${lines}`,
      );
    }
    counts.push(`${name} ×${found.length}`);
  }
  const summary = `daemon, renderer and room at the release, from npm: ${counts.join(", ")}`;
  return { problems, report: `mille@${release} (${summary})` };
}
