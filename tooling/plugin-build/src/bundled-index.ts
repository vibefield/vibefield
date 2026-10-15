// WP8 (build-wp8-bundled-plugins.md §3–§4; ESP §10.4; trust-and-distribution.md §5) — the packaged app's own
// plugins, staged and signed. `buildBundledIndex` is the producer the stager calls; `verifyBundledIndex` is the ONE
// verifier, called by fieldd at every registry refresh and by the stager's `--verify`, so the two cannot drift.
//
// The staged root: each plugin's §5.2 members (exactly `listBundleMembers`, the pack's own walk) under
// `<root>/<id>/`, and `bundled-plugins.json` — canonical JSON naming every staged file's sha256, the manifest hash as
// fieldd computes it, and the artifact hash (`packVfplugin` over the staged copy) — signed over its exact bytes by the
// trust-root's `bundled` role into `bundled-plugins.json.sig`. Refusal is fail-closed at two grains (WP8-D5): the
// index missing, unreadable, malformed, signed by no `bundled` key, or built for another platform refuses the ROOT;
// a plugin whose directory is missing, whose file set differs (a missing OR an extra file) or whose any byte
// differs refuses THAT plugin, naming the first offending path. Never a partial registration.
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  BUNDLED_PLUGIN_INDEX_FILE,
  BUNDLED_PLUGIN_INDEX_SIGNATURE_FILE,
  type BundledPluginEntry,
  BundledPluginIndex,
  validatePluginManifest,
} from "@vibefield/contracts";
import { canonicalJson } from "./canonical";
import { listBundleMembers, packVfplugin } from "./pack";
import { signRegistryIndex } from "./registry-sign";
import { type TrustAnchor, verifySignedBytes } from "./trust";

const MANIFEST_NAME = "vibefield.plugin.json";
/** The index is a list of hashes; a megabyte is thousands of files. Anything larger is refused unread. */
const INDEX_MAX_BYTES = 1024 * 1024;

const sha256 = (bytes: Buffer | string): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** The platform string an index is checked against on this host. */
export function hostBundledPlatform(): string {
  return `${process.platform}-${process.arch}`;
}

export interface BuildBundledIndexOptions {
  /** the bundled root to write: `<stage>/plugins/bundled` (each plugin lands in `<id>/`, which must not exist) */
  readonly stageRoot: string;
  /** each plugin's working directory, already built (its `dist/` present) */
  readonly plugins: ReadonlyArray<{ readonly rootDir: string }>;
  readonly appVersion: string;
  readonly platform?: string;
  /** the `bundled` role's secret, base64 PKCS#8 — the release key, or a stage's ephemeral dev key */
  readonly secretKey: string;
  readonly now?: number;
}

export interface BuildBundledIndexResult {
  readonly index: BundledPluginIndex;
  readonly indexBytes: Buffer;
  readonly signature: string;
}

export class BundledIndexError extends Error {}

/** Stage the plugins and write the signed index. Refuses an invalid manifest, a duplicate id, or a destination
 * that already exists — the stager owns a fresh root, and a leftover file would be an unlisted extra. */
export async function buildBundledIndex(
  opts: BuildBundledIndexOptions,
): Promise<BuildBundledIndexResult> {
  const plugins: Record<string, BundledPluginEntry> = {};
  await mkdir(opts.stageRoot, { recursive: true });
  for (const { rootDir } of opts.plugins) {
    const raw = await readFile(join(rootDir, MANIFEST_NAME), "utf8").catch(() => {
      throw new BundledIndexError(`${rootDir}: no ${MANIFEST_NAME} — run the plugin's build first`);
    });
    const validation = validatePluginManifest(JSON.parse(raw));
    if (!validation.ok)
      throw new BundledIndexError(
        `${rootDir}: invalid manifest — ${validation.issues[0] ?? "unknown"}`,
      );
    const manifest = validation.manifest;
    if (Object.hasOwn(plugins, manifest.id))
      throw new BundledIndexError(`${manifest.id} is listed twice`);
    const dest = join(opts.stageRoot, manifest.id);
    if (
      await lstat(dest).then(
        () => true,
        () => false,
      )
    )
      throw new BundledIndexError(`${dest} exists — a bundled root is staged fresh`);
    const files: Record<string, string> = {};
    for (const member of listBundleMembers(rootDir)) {
      const bytes = await readFile(join(rootDir, ...member.split("/")));
      const target = join(dest, ...member.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      files[member] = sha256(bytes);
    }
    plugins[manifest.id] = {
      id: manifest.id,
      version: manifest.version,
      manifestHash: sha256(canonicalJson(manifest)),
      artifactSha256: (await packVfplugin({ rootDir: dest })).sha256,
      files,
    };
  }
  const index = BundledPluginIndex.parse({
    schemaVersion: 1,
    generatedAt: opts.now ?? Date.now(),
    appVersion: opts.appVersion,
    platform: opts.platform ?? "any",
    plugins,
  });
  const indexBytes = Buffer.from(canonicalJson(index));
  const signature = signRegistryIndex(indexBytes, opts.secretKey);
  await writeFile(join(opts.stageRoot, BUNDLED_PLUGIN_INDEX_FILE), indexBytes);
  await writeFile(join(opts.stageRoot, BUNDLED_PLUGIN_INDEX_SIGNATURE_FILE), `${signature}\n`);
  return { index, indexBytes, signature };
}

export type BundledPluginVerdict =
  | { readonly ok: true; readonly entry: BundledPluginEntry; readonly dir: string }
  | {
      readonly ok: false;
      readonly entry: BundledPluginEntry;
      readonly dir: string;
      readonly reason: string;
    };

export type BundledRootVerdict =
  | { readonly ok: false; readonly reason: string }
  | {
      readonly ok: true;
      readonly index: BundledPluginIndex;
      /** keyed by plugin id */
      readonly plugins: ReadonlyMap<string, BundledPluginVerdict>;
      /** directories under the root the index does not list — ignored, never registered */
      readonly unlisted: readonly string[];
    };

export interface VerifyBundledIndexOptions {
  readonly root: string;
  /** the trust-root's `bundled` role (the document already verified against the app's root keys) */
  readonly trust: TrustAnchor;
  readonly platform?: string;
}

/** Every regular file under `dir` as a forward-slash path; a symlink or special file is an error. */
async function stagedFiles(dir: string): Promise<{ files: string[] } | { offending: string }> {
  const files: string[] = [];
  const walk = async (prefix: string): Promise<string | null> => {
    const abs = prefix === "" ? dir : join(dir, ...prefix.split("/"));
    for (const dirent of await readdir(abs, { withFileTypes: true })) {
      const rel = prefix === "" ? dirent.name : `${prefix}/${dirent.name}`;
      if (dirent.isDirectory()) {
        const nested = await walk(rel);
        if (nested !== null) return nested;
      } else if (dirent.isFile()) files.push(rel);
      else return rel;
    }
    return null;
  };
  const offending = await walk("");
  return offending === null ? { files: files.sort() } : { offending };
}

async function verifyPlugin(
  root: string,
  entry: BundledPluginEntry,
): Promise<BundledPluginVerdict> {
  const dir = join(root, entry.id);
  const refuse = (reason: string): BundledPluginVerdict => ({ ok: false, entry, dir, reason });
  let listing: Awaited<ReturnType<typeof stagedFiles>>;
  try {
    if (!(await lstat(dir)).isDirectory()) return refuse(`${entry.id} is not a directory`);
    listing = await stagedFiles(dir);
  } catch {
    return refuse(`${entry.id}'s directory is missing`);
  }
  if ("offending" in listing) return refuse(`${listing.offending} is not a regular file`);
  const expected = Object.keys(entry.files).sort();
  const onDisk = new Set(listing.files);
  for (const path of expected) {
    if (!onDisk.has(path)) return refuse(`${path} is missing`);
    const bytes = await readFile(join(dir, ...path.split("/")));
    if (sha256(bytes) !== entry.files[path])
      return refuse(`${path} does not match the bundled index`);
  }
  const listed = new Set(expected);
  const extra = listing.files.find((path) => !listed.has(path));
  if (extra !== undefined) return refuse(`${extra} is not in the bundled index`);
  return { ok: true, entry, dir };
}

/** Verify a staged bundled root: the index's signature against the `bundled` role, its shape and platform, then
 * every listed plugin's file set and bytes. Never throws for content an adversary could shape. */
export async function verifyBundledIndex(
  opts: VerifyBundledIndexOptions,
): Promise<BundledRootVerdict> {
  const indexPath = join(opts.root, BUNDLED_PLUGIN_INDEX_FILE);
  let indexBytes: Buffer;
  let sigText: string;
  try {
    if ((await lstat(indexPath)).size > INDEX_MAX_BYTES)
      return { ok: false, reason: `${BUNDLED_PLUGIN_INDEX_FILE} exceeds ${INDEX_MAX_BYTES} bytes` };
    indexBytes = await readFile(indexPath);
  } catch {
    return { ok: false, reason: `${BUNDLED_PLUGIN_INDEX_FILE} is missing or unreadable` };
  }
  try {
    sigText = await readFile(join(opts.root, BUNDLED_PLUGIN_INDEX_SIGNATURE_FILE), "utf8");
  } catch {
    return { ok: false, reason: `${BUNDLED_PLUGIN_INDEX_SIGNATURE_FILE} is missing or unreadable` };
  }
  if (!verifySignedBytes(indexBytes, sigText, opts.trust))
    return {
      ok: false,
      reason: "the bundled index's signature does not verify against the app's bundled key",
    };
  let raw: unknown;
  try {
    raw = JSON.parse(indexBytes.toString("utf8"));
  } catch {
    return { ok: false, reason: `${BUNDLED_PLUGIN_INDEX_FILE} is not JSON` };
  }
  const parsed = BundledPluginIndex.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      reason: `${BUNDLED_PLUGIN_INDEX_FILE} is malformed: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    };
  const index = parsed.data;
  const host = opts.platform ?? hostBundledPlatform();
  if (index.platform !== "any" && index.platform !== host)
    return { ok: false, reason: `the bundled root was staged for ${index.platform}, not ${host}` };
  const plugins = new Map<string, BundledPluginVerdict>();
  for (const entry of Object.values(index.plugins))
    plugins.set(entry.id, await verifyPlugin(opts.root, entry));
  const unlisted = (await readdir(opts.root, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !plugins.has(d.name))
    .map((d) => d.name)
    .sort();
  return { ok: true, index, plugins, unlisted };
}
