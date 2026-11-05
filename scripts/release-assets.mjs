#!/usr/bin/env node
// LP-1 (the 0.9 launch's rails) — the release's DOWNLOADABLE assets, as names and bytes: what the feed says of each
// payload, the stable channel's fixed-name DMG, and the rules the verifier holds every release directory to.
//
// - The feed (`latest-mac.yml`) names each payload with its sha512 and size. electron-builder writes it BEFORE the DMG
//   is notarized and stapled (`packaging/notarize-dmg.mjs`), and stapling appends the ticket to the DMG, so the DMG's
//   entry is re-read from the stapled bytes (`refreshFeedEntry`) and every entry is checked against its bytes here
//   (`checkReleaseAssets`), in the sign job and again in converge.
// - A DMG's blockmap goes stale the moment the DMG is stapled, and nothing reads it: electron-updater updates a Mac from
//   the zip (MacUpdater picks the `.zip` entry; the zip's blockmap stays, for differential downloads). So a release
//   publishes NO `.dmg.blockmap`, signed or not.
// - The stable channel's fixed name, `VibeField-mac-arm64.dmg`, a byte copy of the versioned DMG, so
//   `https://github.com/vibefield/vibefield/releases/latest/download/VibeField-mac-arm64.dmg` always resolves (only a
//   stable is GitHub's `latest`, D4). Never on a nightly or a beta.
//
// usage: node scripts/release-assets.mjs alias --dir <release dir> --channel <nightly|beta|stable> --version <version>
//        (stable: copies VibeField-<version>-arm64.dmg to VibeField-mac-arm64.dmg; nightly and beta: says so, copies
//        nothing)

import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The stable channel's fixed-name download (LP-1): the same bytes as `VibeField-<X.Y.Z>-arm64.dmg`. */
export const STABLE_DMG_ALIAS = "VibeField-mac-arm64.dmg";
const CHANNELS = ["nightly", "beta", "stable"];
const isFeed = (name) => /^latest.*\.yml$/.test(name);

export class ReleaseAssetsError extends Error {}
const refuse = (message) => {
  throw new ReleaseAssetsError(message);
};

/** The versioned DMG electron-builder names (`${productName}-${version}-${arch}.dmg`) for an arm64 build. */
export const versionedDmgName = (version) => `VibeField-${version}-arm64.dmg`;

/** A file's digest, read in chunks (a DMG is ~200 MB; never whole in memory). */
export function digestOfFile(path, algorithm, encoding) {
  const hash = createHash(algorithm);
  const buffer = Buffer.alloc(4 * 1024 * 1024);
  const fd = openSync(path, "r");
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest(encoding);
}

/** electron-builder's own payload digest: sha512, base64 (`builder-util`'s hashFile default). */
export const sha512Base64OfFile = (path) => digestOfFile(path, "sha512", "base64");

const unquote = (value) => {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'"))
    return v.slice(1, -1).replace(/''/g, "'");
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
};

/** The feed's `files:` block as electron-builder writes it (js-yaml's dump: `  - url: …` then `    key: …` lines),
 * each entry's lines kept with their range so one can be rewritten in place. Refuses any other shape. */
function feedBlock(feedText) {
  const lines = feedText.split("\n");
  const start = lines.indexOf("files:");
  if (start === -1) refuse("the feed has no files: block");
  const entries = [];
  let end = start + 1;
  for (; end < lines.length; end++) {
    const line = lines[end];
    const first = /^ {2}- ([A-Za-z0-9]+): ?(.*)$/.exec(line);
    const more = /^ {4}([A-Za-z0-9]+): ?(.*)$/.exec(line);
    if (first !== null) {
      entries.push({
        from: end,
        to: end + 1,
        fields: { [first[1]]: unquote(first[2]) },
        raw: [line],
      });
    } else if (more !== null && entries.length > 0) {
      const entry = entries[entries.length - 1];
      entry.fields[more[1]] = unquote(more[2]);
      entry.raw.push(line);
      entry.to = end + 1;
    } else if (/^\S/.test(line) || line === "") {
      break;
    } else {
      refuse(
        `the feed's files: block has a line this reader does not know: ${JSON.stringify(line)}`,
      );
    }
  }
  if (entries.length === 0) refuse("the feed's files: block is empty");
  return { lines, start, end, entries };
}

/** Every payload the feed names: `{ url, sha512, size }` (size a number; NaN when unreadable). */
export function feedEntries(feedText) {
  return feedBlock(feedText).entries.map(({ fields }) => ({
    url: fields.url ?? "",
    sha512: fields.sha512 ?? "",
    size: Number(fields.size),
  }));
}

/** The feed with ONE payload's entry re-stated from its bytes: `sha512` and `size` replaced, every other key of that
 * entry dropped (a `blockMapSize` names a blockmap the release no longer publishes). The other entries, `version`,
 * `releaseDate` and the legacy top-level `path`/`sha512` stay byte for byte — unless `path` names this payload, when
 * the top-level `sha512` follows it. Refuses a feed that names the payload zero times or twice. */
export function refreshFeedEntry(feedText, { url, sha512, size }) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sha512)) refuse(`"${sha512}" is not a base64 sha512`);
  if (!Number.isSafeInteger(size) || size <= 0) refuse(`${size} is not a payload size`);
  const { lines, entries } = feedBlock(feedText);
  const matches = entries.filter((entry) => entry.fields.url === url);
  if (matches.length !== 1)
    refuse(`the feed names ${url} ${matches.length} times; it must name it exactly once`);
  const entry = matches[0];
  if (!/^ {2}- url: /.test(entry.raw[0]))
    refuse(`the feed's entry for ${url} does not open with its url (not electron-builder's shape)`);
  const out = [
    ...lines.slice(0, entry.from),
    entry.raw[0],
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    ...lines.slice(entry.to),
  ];
  const path = out.findIndex((line) => /^path: /.test(line));
  if (path !== -1 && unquote(out[path].slice(6)) === url) {
    const top = out.findIndex((line) => /^sha512: /.test(line));
    if (top === -1) refuse(`the feed's path names ${url} but it carries no top-level sha512`);
    out[top] = `sha512: ${sha512}`;
  }
  return out.join("\n");
}

/** The ONE DMG the feed names (the build's own; a stale DMG left in the output directory is never it). */
export function dmgOfFeed(feedText) {
  const dmgs = feedEntries(feedText).filter((entry) => entry.url.endsWith(".dmg"));
  if (dmgs.length !== 1)
    refuse(`the feed names ${dmgs.length} DMGs; a macOS build names exactly one`);
  return dmgs[0].url;
}

/** LP-1 — the stable channel's fixed-name download: a byte copy of `VibeField-<version>-arm64.dmg`, made only for a
 * stable. Returns the two names, or null for a nightly or a beta (which never carry it). Refuses a missing source, an
 * alias already present, or a copy whose bytes differ. */
export function stableDmgAlias({ dir, channel, version }) {
  if (!CHANNELS.includes(channel)) refuse(`"${channel}" is not a channel`);
  if (channel !== "stable") return null;
  if (!/^\d+\.\d+\.\d+$/.test(version)) refuse(`"${version}" is not a stable version (X.Y.Z)`);
  const source = versionedDmgName(version);
  if (!existsSync(join(dir, source)))
    refuse(`${source} is not in ${dir}: the stable download's fixed name copies it`);
  // COPYFILE_EXCL: an alias already there is a re-run over a used directory, never silently replaced
  copyFileSync(join(dir, source), join(dir, STABLE_DMG_ALIAS), constants.COPYFILE_EXCL);
  if (
    digestOfFile(join(dir, source), "sha256", "hex") !==
    digestOfFile(join(dir, STABLE_DMG_ALIAS), "sha256", "hex")
  )
    refuse(`${STABLE_DMG_ALIAS} is not a byte copy of ${source}`);
  return { source, alias: STABLE_DMG_ALIAS };
}

/** The rules every release directory is held to (release-verify runs them, signed or not):
 *  1. no `.dmg.blockmap` (stale once the DMG is stapled; nothing reads it);
 *  2. the fixed-name DMG only on a stable, and then the same bytes as that release's versioned DMG;
 *  3. every payload a `latest*.yml` names that is in the directory has the feed's sha512 and size — a DMG stapled after
 *     electron-builder wrote the feed, its entry not re-read, fails here. */
export function checkReleaseAssets({ dir, tag, channel }) {
  const names = readdirSync(dir);
  const blockmaps = names.filter((name) => name.endsWith(".dmg.blockmap"));
  if (blockmaps.length > 0)
    refuse(
      `${blockmaps.join(", ")}: a DMG's blockmap goes stale when the DMG is stapled and nothing reads it; a release publishes none`,
    );
  if (names.includes(STABLE_DMG_ALIAS)) {
    if (channel !== "stable")
      refuse(
        `${STABLE_DMG_ALIAS} is the stable download's fixed name; a ${channel} release never carries it`,
      );
    const source = versionedDmgName(tag.replace(/^v/, ""));
    if (
      !names.includes(source) ||
      digestOfFile(join(dir, source), "sha256", "hex") !==
        digestOfFile(join(dir, STABLE_DMG_ALIAS), "sha256", "hex")
    )
      refuse(`${STABLE_DMG_ALIAS} is not a byte copy of ${source}`);
  }
  const checked = [];
  for (const feed of names.filter(isFeed)) {
    for (const entry of feedEntries(readFileSync(join(dir, feed), "utf8"))) {
      if (!names.includes(entry.url)) continue; // the payloads live beside the feed only in a release directory
      const path = join(dir, entry.url);
      if (statSync(path).size !== entry.size || sha512Base64OfFile(path) !== entry.sha512)
        refuse(
          `${feed}: ${entry.url}'s sha512 or size is not its bytes' (a DMG stapled after the feed was written, its entry not re-read?)`,
        );
      checked.push(entry.url);
    }
  }
  return { checked };
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
    if (argv[0] !== "alias")
      refuse("usage: release-assets.mjs alias --dir <dir> --channel <channel> --version <version>");
    const a = args(argv.slice(1));
    if (!a.dir || !a.channel || !a.version) refuse("--dir, --channel and --version are required");
    const made = stableDmgAlias({ dir: a.dir, channel: a.channel, version: a.version });
    console.log(
      made === null
        ? `release-assets: a ${a.channel} release carries no ${STABLE_DMG_ALIAS} (stable only)`
        : `release-assets: ${made.alias} ← ${made.source} (byte copy; releases/latest/download/${made.alias} resolves to it)`,
    );
  } catch (error) {
    console.error(
      `release-assets: ${error instanceof ReleaseAssetsError ? error.message : error.stack}`,
    );
    process.exit(1);
  }
}
