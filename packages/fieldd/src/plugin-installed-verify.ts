import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { RegistryIndex } from "@vibefield/contracts";
import { readVfpluginEntries, verifyRegistryIndex } from "@vibefield/plugin-build";
import {
  type InstalledPluginArtifactSelection,
  keptListPaths,
  PLUGIN_ARTIFACT_MARKER_FILE,
  PLUGIN_KEPT_ARTIFACT_FILE,
} from "./plugin-artifact-store";
import {
  ARTIFACT_MAX_BYTES,
  REGISTRY_INDEX_MAX_BYTES,
  REGISTRY_SIGNATURE_MAX_BYTES,
} from "./plugin-install";
import type { InstalledVerdict } from "./plugin-registry";

// Item 279's S3 (2026-11-19) — an installed plugin is loaded only as what its install verified.
//
// With a list key configured, an install verifies the plugin list's signature and the artifact's hash, then unpacks
// the artifact into a revision (`plugin-install.ts`). Until S3 the load followed the pointer to that revision and read
// what it found: the marker, the pointer and the provenance file are files whoever writes one can write, and the key
// was never read at load. So a same-user program could put code there and it loaded as a listed plugin.
//
// The install now keeps the artifact inside the revision and the signed list beside it (`plugin-artifact-store.ts`).
// At each refresh the registry asks this check of the revision the pointer selects:
//   1. the kept list's signature verifies with the list key;
//   2. the list names a release of this plugin whose hash is the pointer's;
//   3. the kept artifact has that hash;
//   4. the revision holds exactly the artifact's files, byte for byte, beside fieldd's own three.
// Anything else is a refusal, its reason naming a path inside the artifact at most. The registry then lists the plugin
// as one that can't run, never loadable, with Remove… still standing.
//
// What it does not close, said: a file changed after the check is served as changed until the next refresh (serving by
// hash is S3b); and any release some signed list once named, put back with that list, passes. It reads and hashes each
// installed plugin's files at every refresh.

/** fieldd's own files in a revision, beside the artifact's: the store's marker, the provenance file, the kept
 * artifact. */
const OWN_FILES = new Set([
  PLUGIN_ARTIFACT_MARKER_FILE,
  ".vf-registry.json",
  PLUGIN_KEPT_ARTIFACT_FILE,
]);

const sha256hex = (bytes: Buffer): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** A regular file's bytes, at most `maxBytes`, or why not. A link is not followed. */
async function readRegular(
  path: string,
  maxBytes: number,
): Promise<Buffer | "missing" | "not-a-file" | "too-large"> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch {
    return "missing";
  }
  if (!info.isFile()) return "not-a-file";
  if (info.size > maxBytes) return "too-large";
  return await readFile(path);
}

/** Every regular file under `dir`, as forward-slash paths; the first entry that is neither a real directory nor a
 * regular file is the answer instead. */
async function filesUnder(dir: string): Promise<{ files: string[] } | { offending: string }> {
  const files: string[] = [];
  const walk = async (prefix: string): Promise<string | null> => {
    const at = prefix === "" ? dir : join(dir, ...prefix.split("/"));
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        const deeper = await walk(rel);
        if (deeper !== null) return deeper;
      } else if (entry.isFile()) files.push(rel);
      else return rel;
    }
    return null;
  };
  const offending = await walk("");
  return offending === null ? { files: files.sort() } : { offending };
}

/** Item 279's S3: does the revision `selected` names hold what the install of `pluginId` verified, under `listKey`? */
export async function verifyInstalledRevision(
  installedRoot: string,
  pluginId: string,
  selected: InstalledPluginArtifactSelection,
  listKey: string,
): Promise<InstalledVerdict> {
  const refuse = (reason: string): InstalledVerdict => ({ ok: false, reason });
  const want = selected.pointer.artifactSha256;

  // 1, 2 — the list the install verified, and the release it signed
  const kept = keptListPaths(installedRoot, pluginId, selected.pointer.slot);
  const listBytes = await readRegular(kept.list, REGISTRY_INDEX_MAX_BYTES);
  const sigBytes = await readRegular(kept.signature, REGISTRY_SIGNATURE_MAX_BYTES);
  if (!Buffer.isBuffer(listBytes) || !Buffer.isBuffer(sigBytes))
    return refuse("the plugin list its install verified is not kept beside it");
  if (!verifyRegistryIndex(listBytes, sigBytes.toString("utf8").trim(), listKey))
    return refuse("the plugin list kept beside it does not verify with the list key");
  let index: RegistryIndex;
  try {
    const parsed = RegistryIndex.safeParse(JSON.parse(listBytes.toString("utf8")));
    if (!parsed.success) return refuse("the plugin list kept beside it is not a plugin list");
    index = parsed.data;
  } catch {
    return refuse("the plugin list kept beside it is not a plugin list");
  }
  const entry = index.plugins[pluginId];
  const signed =
    entry === undefined
      ? undefined
      : [entry.latest, ...entry.history].find((release) => release.sha256 === want);
  if (signed === undefined) return refuse("the plugin list kept beside it names no such release");

  // 3 — the artifact the install verified
  const artifact = await readRegular(
    join(selected.root, PLUGIN_KEPT_ARTIFACT_FILE),
    ARTIFACT_MAX_BYTES,
  );
  if (!Buffer.isBuffer(artifact)) return refuse("the artifact its install verified is not kept");
  if (sha256hex(artifact) !== want)
    return refuse("the artifact kept in it is not the release the list signed");
  let entries: Array<{ name: string; data: Buffer }>;
  try {
    entries = readVfpluginEntries(artifact);
  } catch {
    return refuse("the artifact kept in it is not a plugin artifact");
  }

  // 4 — the revision's files are the artifact's, byte for byte, and fieldd's own
  const listing = await filesUnder(selected.root);
  if ("offending" in listing) return refuse(`${listing.offending} is not a regular file`);
  const onDisk = new Set(listing.files);
  for (const { name, data } of entries) {
    if (!onDisk.has(name)) return refuse(`${name} is missing`);
    onDisk.delete(name);
    const bytes = await readRegular(join(selected.root, ...name.split("/")), data.length);
    if (!Buffer.isBuffer(bytes) || !bytes.equals(data))
      return refuse(`${name} is not the artifact's`);
  }
  const [extra] = [...onDisk].filter((path) => !OWN_FILES.has(path)).sort();
  if (extra !== undefined) return refuse(`${extra} is not in the artifact`);
  return { ok: true };
}
