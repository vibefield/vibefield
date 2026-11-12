import { randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { isWellFormedPluginId } from "@vibefield/contracts";

// PRC-5b — fieldd-owned immutable registry artifact slots.
//
//   installed/<pluginId>/
//     .vf-current.json
//     revisions/<artifact sha256 hex>/...
//
// Staging is a hidden sibling under `installed/`. A revision directory is
// synced and atomically renamed into place before the small current pointer can
// move. Registry discovery follows only the pointer, so an interrupted candidate
// is never accidentally current, and a folder with no pointer is no install.

export const PLUGIN_CURRENT_POINTER_FILE = ".vf-current.json";
export const PLUGIN_ARTIFACT_MARKER_FILE = ".vf-artifact.json";
const REVISION_DIRECTORY = "revisions";
const SHA256 = /^sha256:([0-9a-f]{64})$/;
const SLOT = /^[0-9a-f]{64}$/;

interface StoredPluginArtifactPointerV1 {
  version: 1;
  pluginId: string;
  slot: string;
  artifactSha256: string;
  committedAt: number;
}

export interface PluginArtifactPointerV2 {
  version: 2;
  pluginId: string;
  slot: string;
  artifactSha256: string;
  committedAt: number;
  /** Monotonic per-plugin logical publication epoch. It moves atomically with
   * the selected artifact instead of being reconstructed from daemon memory. */
  commitEpoch: number;
}

interface PluginArtifactMarkerV1 {
  version: 1;
  pluginId: string;
  slot: string;
  artifactSha256: string;
}

export interface ImmutablePluginArtifact {
  pluginId: string;
  slot: string;
  artifactSha256: string;
  root: string;
  reused: boolean;
}

export interface ResolvedPluginArtifact {
  /** Always normalized to the current format. Legacy v1 pointers read as
   * epoch 1 and are replaced by v2 on the next successful update. */
  pointer: PluginArtifactPointerV2;
  root: string;
}

export interface InstalledPluginArtifactSelection {
  root: string;
  commitEpoch: number;
  pointer: PluginArtifactPointerV2;
}

/** The rename completed, so callers may not infer that the old pointer is
 * still current. Restart/re-read is the only safe recovery direction. */
export class PluginArtifactCommitIndeterminateError extends Error {
  readonly publication = "indeterminate" as const;
  readonly cause: unknown;

  constructor(pluginId: string, cause: unknown) {
    super(`${pluginId}: artifact pointer publication is indeterminate; restart recovery required`);
    this.name = "PluginArtifactCommitIndeterminateError";
    this.cause = cause;
  }
}

/** Item 322 — a folder already at a revision slot does not hold the files the
 * caller's `prepare` made. That folder is left as it was found (it may be the
 * current revision); only the private staging copy is removed. */
export class PluginArtifactSlotMismatchError extends Error {
  readonly pluginId: string;
  readonly slot: string;
  /** The first place the two differ: a path inside the artifact, never one on
   * this device. */
  readonly where: string;

  constructor(pluginId: string, slot: string, where: string) {
    super(`${pluginId}: the revision already at slot ${slot} is not the prepared artifact`);
    this.name = "PluginArtifactSlotMismatchError";
    this.pluginId = pluginId;
    this.slot = slot;
    this.where = where;
  }
}

export interface PluginArtifactStoreTestHooks {
  /** Runs after the temp pointer is fsynced but before its atomic rename. */
  beforeCurrentPublish?(pointer: PluginArtifactPointerV2): void | Promise<void>;
  /** Runs after rename but before the containing directory fsync. Failure here
   * is deliberately publication-indeterminate. */
  afterCurrentPublish?(pointer: PluginArtifactPointerV2): void | Promise<void>;
}

export class PluginArtifactStore {
  constructor(
    readonly installedRoot: string,
    private readonly testHooks: PluginArtifactStoreTestHooks = {},
  ) {}

  pluginRoot(pluginId: string): string {
    assertPluginId(pluginId);
    return join(this.installedRoot, pluginId);
  }

  /** Boot-only orphan cleanup. Hidden staging and pointer-temp files are never
   * discoverable, but removing them bounds disk use after a hard crash. */
  async recover(): Promise<{ removed: number }> {
    await mkdir(this.installedRoot, { recursive: true });
    let removed = 0;
    const children = await readdir(this.installedRoot, { withFileTypes: true });
    for (const child of children) {
      if (child.name.startsWith(".staging-")) {
        await rm(join(this.installedRoot, child.name), { recursive: true, force: true });
        removed += 1;
        continue;
      }
      if (!child.isDirectory() || child.name.startsWith(".")) continue;
      const pluginRoot = join(this.installedRoot, child.name);
      for (const entry of await readdir(pluginRoot, { withFileTypes: true }).catch(() => [])) {
        if (!entry.name.startsWith(`${PLUGIN_CURRENT_POINTER_FILE}.tmp-`)) continue;
        await rm(join(pluginRoot, entry.name), { force: true });
        removed += 1;
      }
    }
    return { removed };
  }

  /** Publishes immutable bytes into a content-addressed revision slot. The
   * caller prepares the unpacked artifact inside a private staging root.
   *
   * Item 322: `prepare` ALWAYS runs. A folder already at the slot names the
   * artifact only by its own marker, which whoever wrote the folder also
   * wrote. So it is reused only when it holds exactly what `prepare` made,
   * file for file and byte for byte; otherwise the stage is refused with
   * `PluginArtifactSlotMismatchError` and that folder is left as found. */
  async stage(input: {
    pluginId: string;
    artifactSha256: string;
    prepare(stagingRoot: string): Promise<void>;
  }): Promise<ImmutablePluginArtifact> {
    const { pluginId, artifactSha256 } = input;
    const slot = slotFor(artifactSha256);
    const pluginRoot = this.pluginRoot(pluginId);
    const revisionsRoot = join(pluginRoot, REVISION_DIRECTORY);
    const destination = join(revisionsRoot, slot);
    await mkdir(revisionsRoot, { recursive: true });

    const staging = join(
      this.installedRoot,
      `.staging-${pluginId}-${randomBytes(8).toString("hex")}`,
    );
    await mkdir(staging, { recursive: false });
    try {
      await input.prepare(staging);
      const marker: PluginArtifactMarkerV1 = {
        version: 1,
        pluginId,
        slot,
        artifactSha256,
      };
      await writeFile(join(staging, PLUGIN_ARTIFACT_MARKER_FILE), `${JSON.stringify(marker)}\n`, {
        mode: 0o600,
      });
      // The marker is in the comparison too, so an equal folder is a real
      // directory carrying this exact marker: no separate marker read.
      const reuseWhatIsThere = async (): Promise<ImmutablePluginArtifact> => {
        const where = await firstDifference(staging, destination);
        if (where !== null) throw new PluginArtifactSlotMismatchError(pluginId, slot, where);
        await rm(staging, { recursive: true, force: true });
        return { pluginId, slot, artifactSha256, root: destination, reused: true };
      };
      if (await exists(destination)) return await reuseWhatIsThere();
      await syncTree(staging);
      try {
        await rename(staging, destination);
      } catch (error) {
        // Two identical prepares may race. The winner's files must be this
        // prepare's exactly; otherwise this is corruption, not a reusable slot.
        if (!(await exists(destination))) throw error;
        return await reuseWhatIsThere();
      }
      await syncDirectory(revisionsRoot);
      await validateRevision(destination, marker);
      return { pluginId, slot, artifactSha256, root: destination, reused: false };
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** Returns the exact pointer-selected root, never an unreferenced revision. */
  async current(pluginId: string): Promise<ResolvedPluginArtifact | null> {
    const pluginRoot = this.pluginRoot(pluginId);
    let raw: string;
    try {
      raw = await readFile(join(pluginRoot, PLUGIN_CURRENT_POINTER_FILE), "utf8");
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    const pointer = parsePointer(raw, pluginId);
    const root = join(pluginRoot, REVISION_DIRECTORY, pointer.slot);
    await validateRevision(root, pointer);
    return { pointer, root };
  }

  /** Compare-and-swap the current pointer. `expectedSlot` is captured before
   * candidate preparation, so concurrent/stale installers cannot win late. */
  async commit(
    artifact: ImmutablePluginArtifact,
    expectedSlot: string | null,
    commitEpoch: number,
  ): Promise<{ previous: PluginArtifactPointerV2 | null; current: PluginArtifactPointerV2 }> {
    this.assertOwnedArtifact(artifact);
    await validateRevision(artifact.root, artifact);
    const before = await this.current(artifact.pluginId);
    const actualSlot = before?.pointer.slot ?? null;
    if (actualSlot === artifact.slot) {
      if (before?.pointer.commitEpoch !== commitEpoch) {
        throw new Error(
          `${artifact.pluginId}: current artifact retry expected epoch ${before?.pointer.commitEpoch}, received ${commitEpoch}`,
        );
      }
      return { previous: before?.pointer ?? null, current: before!.pointer };
    }
    if (actualSlot !== expectedSlot) {
      throw new Error(
        `${artifact.pluginId}: stale current pointer; expected ${expectedSlot ?? "absent"}, found ${actualSlot ?? "absent"}`,
      );
    }
    const expectedCommitEpoch = (before?.pointer.commitEpoch ?? 0) + 1;
    if (
      !Number.isSafeInteger(commitEpoch) ||
      commitEpoch <= 0 ||
      commitEpoch !== expectedCommitEpoch
    ) {
      throw new Error(
        `${artifact.pluginId}: expected commit epoch ${expectedCommitEpoch}, received ${commitEpoch}`,
      );
    }
    const pointer: PluginArtifactPointerV2 = {
      version: 2,
      pluginId: artifact.pluginId,
      slot: artifact.slot,
      artifactSha256: artifact.artifactSha256,
      committedAt: Date.now(),
      commitEpoch,
    };
    await atomicWriteCurrent(this.pluginRoot(artifact.pluginId), pointer, this.testHooks);
    // All fallible durability work completed inside atomicWriteCurrent. A
    // verification read here would reintroduce an ambiguous post-publication
    // rejection; return the exact bytes just durably published instead.
    return { previous: before?.pointer ?? null, current: pointer };
  }

  /** Remove a failed, uncommitted candidate. Current bytes are never removed. */
  async discard(artifact: ImmutablePluginArtifact): Promise<boolean> {
    this.assertOwnedArtifact(artifact);
    const current = await this.current(artifact.pluginId);
    if (current?.pointer.slot === artifact.slot) return false;
    const removed = await exists(artifact.root);
    await rm(artifact.root, { recursive: true, force: true });
    if (removed) await syncDirectory(dirname(artifact.root));
    return removed;
  }

  async uninstall(pluginId: string): Promise<void> {
    await rm(this.pluginRoot(pluginId), { recursive: true, force: true });
    await syncDirectory(this.installedRoot);
  }

  private assertOwnedArtifact(artifact: ImmutablePluginArtifact): void {
    const slot = slotFor(artifact.artifactSha256);
    const expected = join(this.pluginRoot(artifact.pluginId), REVISION_DIRECTORY, slot);
    if (artifact.slot !== slot || artifact.root !== expected) {
      throw new Error(`${artifact.pluginId}: artifact handle is not owned by this store`);
    }
  }
}

/** Registry discovery helper: the pointer selects the root. A folder with no
 * pointer is no install, whatever else lies in it; an invalid pointer is fatal. */
export async function resolveInstalledArtifactRoot(
  installedRoot: string,
  pluginDirectoryName: string,
): Promise<string | null> {
  return (await resolveInstalledArtifact(installedRoot, pluginDirectoryName))?.root ?? null;
}

/** Registry discovery with the durable logical epoch retained for coordinator
 * reconstruction. */
export async function resolveInstalledArtifact(
  installedRoot: string,
  pluginDirectoryName: string,
): Promise<InstalledPluginArtifactSelection | null> {
  const store = new PluginArtifactStore(installedRoot);
  const current = await store.current(pluginDirectoryName);
  if (current === null) return null;
  return {
    root: current.root,
    commitEpoch: current.pointer.commitEpoch,
    pointer: current.pointer,
  };
}

function assertPluginId(pluginId: string): void {
  if (!isWellFormedPluginId(pluginId)) throw new Error(`invalid plugin id: ${pluginId}`);
}

function slotFor(artifactSha256: string): string {
  const match = SHA256.exec(artifactSha256);
  if (match === null) throw new Error(`invalid artifact sha256: ${artifactSha256}`);
  return match[1] as string;
}

function parsePointer(raw: string, expectedPluginId: string): PluginArtifactPointerV2 {
  const value = parseJson(raw) as Partial<Omit<StoredPluginArtifactPointerV1, "version">> & {
    version?: unknown;
    commitEpoch?: unknown;
  };
  const legacy = value.version === 1 && value.commitEpoch === undefined;
  const current =
    value.version === 2 &&
    typeof value.commitEpoch === "number" &&
    Number.isSafeInteger(value.commitEpoch) &&
    value.commitEpoch > 0;
  if (
    (!legacy && !current) ||
    value.pluginId !== expectedPluginId ||
    typeof value.slot !== "string" ||
    !SLOT.test(value.slot) ||
    typeof value.artifactSha256 !== "string" ||
    slotFor(value.artifactSha256) !== value.slot ||
    typeof value.committedAt !== "number" ||
    !Number.isFinite(value.committedAt) ||
    value.committedAt < 0
  ) {
    throw new Error(`${expectedPluginId}: invalid current artifact pointer`);
  }
  return {
    version: 2,
    pluginId: expectedPluginId,
    slot: value.slot,
    artifactSha256: value.artifactSha256,
    committedAt: value.committedAt,
    commitEpoch: legacy ? 1 : (value.commitEpoch as number),
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("plugin artifact metadata is not valid JSON");
  }
}

async function validateRevision(
  root: string,
  expected: { pluginId: string; slot: string; artifactSha256: string },
): Promise<void> {
  const info = await lstat(root).catch((error) => {
    throw new Error(`immutable plugin revision is missing: ${String(error)}`);
  });
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("immutable plugin revision is not a real directory");
  }
  const marker = parseJson(
    await readFile(join(root, PLUGIN_ARTIFACT_MARKER_FILE), "utf8").catch((error) => {
      throw new Error(`immutable plugin revision marker is missing: ${String(error)}`);
    }),
  ) as Partial<PluginArtifactMarkerV1>;
  if (
    marker.version !== 1 ||
    marker.pluginId !== expected.pluginId ||
    marker.slot !== expected.slot ||
    marker.artifactSha256 !== expected.artifactSha256
  ) {
    throw new Error(`${expected.pluginId}: immutable plugin revision marker mismatch`);
  }
}

/** The first place `found` differs from `made`, as a path inside them, or null
 * when both hold the same directories and the same files with the same bytes.
 * Anything that is neither a real directory nor a regular file is a
 * difference. Modes and times are not compared. */
async function firstDifference(made: string, found: string, inside = ""): Promise<string | null> {
  const at = (name: string): string => (inside === "" ? name : `${inside}/${name}`);
  if (!(await lstat(found)).isDirectory()) return inside === "" ? "." : inside;
  const madeEntries = await readdir(made, { withFileTypes: true });
  madeEntries.sort((a, b) => (a.name < b.name ? -1 : 1));
  const foundEntries = new Map(
    (await readdir(found, { withFileTypes: true })).map((entry) => [entry.name, entry] as const),
  );
  for (const entry of madeEntries) {
    const other = foundEntries.get(entry.name);
    if (other === undefined) return at(entry.name);
    foundEntries.delete(entry.name);
    const madePath = join(made, entry.name);
    const foundPath = join(found, entry.name);
    if (entry.isDirectory() && other.isDirectory()) {
      const deeper = await firstDifference(madePath, foundPath, at(entry.name));
      if (deeper !== null) return deeper;
      continue;
    }
    if (!entry.isFile() || !other.isFile()) return at(entry.name);
    if ((await lstat(madePath)).size !== (await lstat(foundPath)).size) return at(entry.name);
    if (!(await readFile(madePath)).equals(await readFile(foundPath))) return at(entry.name);
  }
  const [extra] = [...foundEntries.keys()].sort();
  return extra === undefined ? null : at(extra);
}

async function atomicWriteCurrent(
  pluginRoot: string,
  pointer: PluginArtifactPointerV2,
  hooks: PluginArtifactStoreTestHooks,
): Promise<void> {
  await mkdir(pluginRoot, { recursive: true });
  const target = join(pluginRoot, PLUGIN_CURRENT_POINTER_FILE);
  const temp = join(
    pluginRoot,
    `${PLUGIN_CURRENT_POINTER_FILE}.tmp-${randomBytes(8).toString("hex")}`,
  );
  let published = false;
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(pointer)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await hooks.beforeCurrentPublish?.(pointer);
    await rename(temp, target);
    published = true;
    await hooks.afterCurrentPublish?.(pointer);
    await syncDirectory(pluginRoot);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    if (published) throw new PluginArtifactCommitIndeterminateError(pointer.pluginId, error);
    throw error;
  }
}

async function syncTree(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error("plugin artifact contains a symbolic link");
    if (entry.isDirectory()) {
      await syncTree(path);
      continue;
    }
    if (!entry.isFile()) throw new Error("plugin artifact contains a non-file entry");
    const handle = await open(path, process.platform === "win32" ? "r+" : "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  await syncDirectory(root);
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
