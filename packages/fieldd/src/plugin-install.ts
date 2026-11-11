import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CONTRACTS_VERSION,
  type PluginsInstallParams,
  type PluginsUpdatesCheckResult,
  type PluginUpdateInfo,
  type RegistryIndex,
  RegistryIndex as RegistryIndexSchema,
  type RegistryListedAs,
  type RegistryRelease,
  registryListedAs,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { unpackVfplugin, verifyRegistryIndex } from "@vibefield/plugin-build";
import { RpcCallError } from "./native-link";
import {
  type ImmutablePluginArtifact,
  PluginArtifactCommitIndeterminateError,
  PluginArtifactSlotMismatchError,
  PluginArtifactStore,
} from "./plugin-artifact-store";
import {
  contractsRangeSatisfied,
  type PluginRegistryCandidate,
  type PluginRegistryService,
} from "./plugin-registry";

// RegistryInstallService (P7, spec §5.3.1): fetch index → VERIFY signature →
// fetch artifact → sha256 MUST match the index → unpack (traversal-proof
// reader) → durable immutable candidate → atomic current-pointer CAS → §9
// re-scan. A mismatch is PLUGIN_ARTIFACT_MISMATCH and the artifact is
// DISCARDED — never partially installed. Fetches happen only on user action
// (no push feed, no phone-home, no identity — §5.3.1/EL3); file:// registries
// serve tests and the offline path.

export interface RegistryInstallConfig {
  dataDir: string;
  plugins: PluginRegistryService;
  /** index.json location — file:// or http(s)://; unset = no registry
   * configured, install refuses honestly */
  registryUrl?: string;
  /** the shipped maintainer verify key (base64); unset = refuse (never
   * install unsigned) */
  registryPublicKey?: string;
  fetchImpl?: typeof fetch;
  /** MK-2b (2026-11-11, MK-D5): how long one registry fetch may take before it answers as unreachable;
   * tests shorten it */
  fetchTimeoutMs?: number;
  /** MK-2c (2026-11-11, G1): whether a community plugin may install now. Absent, none may. daemon.ts passes
   * `COMMUNITY_SWITCH_DRAWN && the person's switch`; a test passes its own to an installer it builds. */
  communityAllowed?: () => Promise<boolean>;
  /** MK-2c (the floor, VF-PM 10:08:59Z): the held plugin list's `generatedAt`, or null with none held. An index
   * older than it is refused, as the catalog's own read refuses one (`plugin-catalog.ts`). */
  indexFloor?: () => Promise<number | null>;
  logger?: Logger;
}

/** MK-2c (G1): the refusal's reason code, the community switch's own word (MK-2a's audit says it too). */
export const COMMUNITY_SWITCH_CLOSED = "COMMUNITY_SWITCH_CLOSED";

/** MK-2b (MK-D5): a registry host that does not answer is offline, never a hang. */
export const REGISTRY_FETCH_TIMEOUT_MS = 20_000;

/** MK-2e (2026-11-11; MK-E9, B1): one listing picture's read. Its bytes are not checked here: the catalog hashes them
 * against the pin (`plugin-catalog.ts`). */
export type ListingFileRead =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: "size" | "unreachable" };

/** MK-2b (L1): the carriers a parse may catch to undefined, by where they sit. */
const ENTRY_CARRIERS = ["rung", "listing"] as const;

/** A verified, durable candidate that is still invisible to discovery. PRC-5c
 * will carry this handle through the participant prepare barrier before the
 * pointer is committed. */
export interface PreparedRegistryInstall {
  readonly id: string;
  readonly version: string;
  readonly baseSlot: string | null;
  readonly baseCommitEpoch: number;
  readonly artifact: ImmutablePluginArtifact;
  readonly runtime: PluginRegistryCandidate;
  /** MK-2c (2026-11-11, G2): the signed entry's verdict, carried in memory from prepare to commit; never re-read
   * from a file under `<dataDir>` */
  readonly listedAs: RegistryListedAs;
  /** the `generatedAt` of the index the entry came from, for a refusal's data */
  readonly indexGeneratedAt: number;
}

const sha256hex = (bytes: Buffer): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** MK-2e: an index-relative path as URL segments, each percent-encoded. */
const encodePath = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

/** MK-2e: a regular file's bytes, at most `maxBytes`, opened without following a link at its last component. The
 * size is read from the open handle, and the read stops one byte past it: a file that grew while it was read is
 * refused (past the cap, `size`; under it, `unreachable`), never read on. */
export async function readFileCapped(file: string, maxBytes: number): Promise<ListingFileRead> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return { ok: false, reason: "unreachable" };
    if (stat.size > maxBytes) return { ok: false, reason: "size" };
    const buffer = Buffer.alloc(stat.size + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > stat.size) return { ok: false, reason: total > maxBytes ? "size" : "unreachable" };
    return { ok: true, bytes: buffer.subarray(0, total) };
  } finally {
    await handle.close();
  }
}

/** minimal semver compare for update checks (a.b.c only — prerelease tags
 * compare as strings, honestly crude until a real semver lands) */
export function semverNewer(candidate: string, installed: string): boolean {
  const parse = (v: string): number[] => v.split("-")[0]?.split(".").map(Number) ?? [];
  const a = parse(candidate);
  const b = parse(installed);
  for (let i = 0; i < 3; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

export class RegistryInstallService {
  private readonly log: Logger;
  private readonly artifacts: PluginArtifactStore;
  readonly installedRoot: string;
  /** MK-2b (2026-11-11, L1): a list's dropped carriers are said once per its `generatedAt`, not on every
   * read of it */
  private readonly droppedLogged = new Set<number>();

  constructor(private readonly cfg: RegistryInstallConfig) {
    this.log = (cfg.logger ?? createNoopLogger()).child({ component: "plugin.install" });
    this.installedRoot = join(cfg.dataDir, "plugins", "installed");
    this.artifacts = new PluginArtifactStore(this.installedRoot);
  }

  /** Boot cleanup is deliberately narrow: only unpublished staging/temp
   * state is removed; every immutable revision remains available for recovery. */
  async recover(): Promise<{ removed: number }> {
    const result = await this.artifacts.recover();
    if (result.removed > 0) {
      this.log.info(
        "fieldd.plugin_install.orphans_recovered",
        "Removed unpublished plugin installation state after restart",
        { removed: result.removed },
      );
    }
    return result;
  }

  /** fetch + signature-verify + parse the index (§5.3.1 — the byte is the
   * unit of trust: the signature covers the exact file, never a re-canon). */
  async fetchIndex(): Promise<{ index: RegistryIndex; indexRef: string }> {
    const signed = await this.fetchSignedIndex();
    const index = this.parseIndex(signed.bytes);
    // MK-2c (2026-11-11; the floor, VF-PM 10:08:59Z): where a list is held, an install's or an updates check's
    // index is held to it, as the catalog's read is; an equal one passes, and with none held nothing changes
    const floor = (await this.cfg.indexFloor?.()) ?? null;
    if (floor !== null && index.generatedAt < floor) {
      this.log.warn(
        "fieldd.plugin_install.index_refused",
        "A plugin list older than the one held was refused",
        { reason: "rollback", heldGeneratedAt: floor, generatedAt: index.generatedAt },
      );
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "the plugin list is older than the one VibeField holds",
        false,
        { pluginKind: "PLUGIN_SOURCE_UNAVAILABLE" },
      );
    }
    return { index, indexRef: signed.indexRef };
  }

  /** MK-2b (2026-11-11): a registry is configured only with both its location and its verify key. */
  registryConfigured(): boolean {
    return this.cfg.registryUrl !== undefined && this.cfg.registryPublicKey !== undefined;
  }

  /** MK-2b: fetch the index's exact bytes and its signature, and verify them; nothing is parsed
   * here, so the catalog can hold the exact bytes as fetched (base64, with the signature, in its one
   * held file, `plugin-catalog.ts`). */
  async fetchSignedIndex(): Promise<{ bytes: Buffer; signature: string; indexRef: string }> {
    const url = this.cfg.registryUrl;
    if (url === undefined)
      throw new RpcCallError("UNAVAILABLE", "no plugin registry is configured", false, {
        pluginKind: "PLUGIN_SOURCE_UNAVAILABLE",
      });
    if (this.cfg.registryPublicKey === undefined)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "no registry verify key is configured — unsigned indexes never install",
        false,
      );
    const timeoutMs = this.cfg.fetchTimeoutMs ?? REGISTRY_FETCH_TIMEOUT_MS;
    const bytes = await this.fetchBytes(url, timeoutMs);
    const signature = (await this.fetchBytes(`${url}.sig`, timeoutMs)).toString("utf8").trim();
    if (!this.verifyIndex(bytes, signature)) {
      this.refused("signature");
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "registry index signature verification FAILED — refusing the index",
        false,
        { pluginKind: "PLUGIN_ARTIFACT_MISMATCH" },
      );
    }
    return { bytes, signature, indexRef: url };
  }

  /** MK-2b: the configured key's verdict over exact bytes (the catalog re-verifies its held list
   * with it on every read). No key, no verdict but false. */
  verifyIndex(bytes: Buffer, signature: string): boolean {
    const key = this.cfg.registryPublicKey;
    return key !== undefined && verifyRegistryIndex(bytes, signature, key);
  }

  /** MK-2b: verified bytes to the typed index. A carrier the schema caught is logged (L1); a
   * refusal is logged with its reason (L2). Neither line carries the bytes or a value. */
  parseIndex(bytes: Buffer): RegistryIndex {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      this.refused("not-json");
      throw new RpcCallError("PRECONDITION_FAILED", "registry index is not JSON", false);
    }
    const index = RegistryIndexSchema.safeParse(parsed);
    if (!index.success) {
      this.refused("schema");
      throw new RpcCallError("PRECONDITION_FAILED", "registry index failed its schema", false);
    }
    this.logDropped(parsed, index.data);
    return index.data;
  }

  /** L2 (custody note §6): "Diagnostics has the details" is true only if the refusal is logged. */
  private refused(reason: "signature" | "not-json" | "schema"): void {
    this.log.warn(
      "fieldd.plugin_install.index_refused",
      "A plugin list arrived that VibeField could not use, and was refused",
      { reason },
    );
  }

  /** L1 (custody note §6): a listing, rung or pick the schema caught goes unshown; say which, by
   * plugin id and field, once per list (`generatedAt`), never the value. */
  private logDropped(raw: unknown, index: RegistryIndex): void {
    if (this.droppedLogged.has(index.generatedAt)) return;
    this.droppedLogged.add(index.generatedAt);
    const rawIndex = raw as {
      plugins?: Record<string, Record<string, unknown> | undefined>;
      featured?: unknown;
    };
    for (const [id, entry] of Object.entries(index.plugins)) {
      const rawEntry = rawIndex.plugins?.[id];
      for (const field of ENTRY_CARRIERS) {
        if (rawEntry?.[field] !== undefined && entry[field] === undefined)
          this.log.warn(
            "fieldd.plugin_install.listing_dropped",
            "A listed plugin's field did not parse, so it goes unshown",
            { pluginId: id, field },
          );
      }
    }
    if (rawIndex.featured !== undefined && index.featured === undefined)
      this.log.warn(
        "fieldd.plugin_install.listing_dropped",
        "The maintainers' pick did not parse, so it goes unshown",
        { field: "featured" },
      );
  }

  /** Resolve, verify, unpack, and durably publish an immutable candidate slot.
   * Discovery remains on the old pointer until commit().
   *
   * Item 322: a folder already at the artifact's slot that does not hold the
   * artifact's files is refused as an artifact mismatch, the kind the window
   * already has a sentence for. The words name no path on this device, and
   * that folder is left as it was found. */
  async prepare(params: PluginsInstallParams): Promise<PreparedRegistryInstall> {
    try {
      return await this.prepareVerified(params);
    } catch (error) {
      if (!(error instanceof PluginArtifactSlotMismatchError)) throw error;
      this.log.warn(
        "fieldd.plugin_install.slot_mismatch",
        "A revision already at the artifact's slot does not hold the artifact's files; refused",
        { pluginId: error.pluginId, slot: error.slot, where: error.where },
      );
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "the copy of this release already in place does not match the artifact — not installed",
        false,
        { pluginKind: "PLUGIN_ARTIFACT_MISMATCH" },
      );
    }
  }

  private async prepareVerified(params: PluginsInstallParams): Promise<PreparedRegistryInstall> {
    if (params.artifactPath !== undefined)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "sideload installs land after first-party publishing (§21.8) — not yet",
        false,
      );
    if (params.id === undefined)
      throw new RpcCallError("PRECONDITION_FAILED", "expected { id, version? }", false);
    const { index, indexRef } = await this.fetchIndex();
    const entry = index.plugins[params.id];
    if (entry === undefined)
      throw new RpcCallError("NOT_FOUND", `${params.id} is not in the registry index`, false, {
        pluginKind: "PLUGIN_SOURCE_UNAVAILABLE",
      });
    // MK-2c (2026-11-11, G1): the signed entry's verdict, read here and nowhere else. A community entry is refused
    // while community plugins are off, before any version, contract or artifact work (nothing past the index is
    // fetched). An update is an install, so it meets the same gate.
    const listedAs = registryListedAs(entry);
    await this.assertListedAllowed(params.id, listedAs, index.generatedAt);
    // G2, G4: the signed entry's display copies, carried in memory to the candidate and written beside the slot
    const publisherName = entry.listing?.publisherName;
    const signedCopies = {
      ...(entry.rung !== undefined ? { rung: entry.rung } : {}),
      ...(publisherName !== undefined ? { publisherName } : {}),
    };
    const release =
      params.version === undefined
        ? entry.latest
        : ([entry.latest, ...entry.history].find((r) => r.version === params.version) ??
          (() => {
            throw new RpcCallError(
              "NOT_FOUND",
              `${params.id}@${params.version} is not a published release`,
              false,
            );
          })());
    if (!contractsRangeSatisfied(CONTRACTS_VERSION, release.minContracts))
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `${params.id}@${release.version} requires contracts ${release.minContracts}; this device has ${CONTRACTS_VERSION}`,
        false,
        { pluginKind: "PLUGIN_INCOMPATIBLE" },
      );

    const artifactBytes = await this.fetchBytes(this.resolveArtifactUrl(indexRef, release));
    const actual = sha256hex(artifactBytes);
    if (actual !== release.sha256) {
      this.log.warn(
        "fieldd.plugin_install.artifact_mismatch",
        "Fetched artifact hash does not match the signed index pin; discarded",
        { pluginId: params.id, expected: release.sha256, actual },
      );
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "artifact hash does not match the signed index — discarded",
        false,
        { pluginKind: "PLUGIN_ARTIFACT_MISMATCH" },
      );
    }

    const base = await this.artifacts.current(params.id);
    const baseSlot = base?.pointer.slot ?? null;
    const baseCommitEpoch = base?.pointer.commitEpoch ?? 0;
    const artifact = await this.artifacts.stage({
      pluginId: params.id,
      artifactSha256: release.sha256,
      prepare: async (staging) => {
        await unpackVfplugin(artifactBytes, staging);
        const manifestRaw = await readFile(join(staging, "vibefield.plugin.json"), "utf8").catch(
          () => {
            throw new RpcCallError(
              "PRECONDITION_FAILED",
              "artifact carries no vibefield.plugin.json",
              false,
              { pluginKind: "PLUGIN_INVALID" },
            );
          },
        );
        const manifest = JSON.parse(manifestRaw) as { id?: unknown; version?: unknown };
        if (manifest.id !== params.id) {
          throw new RpcCallError(
            "PRECONDITION_FAILED",
            `artifact manifest id ${String(manifest.id)} does not match the index entry ${params.id}`,
            false,
            { pluginKind: "PLUGIN_ARTIFACT_MISMATCH" },
          );
        }
        if (manifest.version !== release.version) {
          throw new RpcCallError(
            "PRECONDITION_FAILED",
            `artifact manifest version ${String(manifest.version)} does not match release ${release.version}`,
            false,
            { pluginKind: "PLUGIN_ARTIFACT_MISMATCH" },
          );
        }
        // §6.3 provenance sidecar — written by fieldd, never by the artifact. MK-2c (G4): with the signed
        // entry's display copies, which decide nothing (`RegistryProvenance`); a fresh slot only, as before.
        await rm(join(staging, ".vf-registry.json"), { force: true });
        await writeFile(
          join(staging, ".vf-registry.json"),
          `${JSON.stringify(
            {
              indexRef,
              artifactSha256: release.sha256,
              publisher: entry.repo,
              ...signedCopies,
            },
            null,
            2,
          )}\n`,
        );
      },
    });
    try {
      const runtime = await this.cfg.plugins.inspectRegistryCandidate({
        pluginId: params.id,
        root: artifact.root,
        artifactSha256: artifact.artifactSha256,
        signed: signedCopies,
      });
      return {
        id: params.id,
        version: release.version,
        baseSlot,
        baseCommitEpoch,
        artifact,
        runtime,
        listedAs,
        indexGeneratedAt: index.generatedAt,
      };
    } catch (error) {
      await this.artifacts.discard(artifact).catch(() => false);
      throw error;
    }
  }

  /** The only discovery-visible mutation: compare-and-swap the small pointer,
   * then rebuild the registry snapshot from that exact immutable root. */
  async commit(
    candidate: PreparedRegistryInstall,
    commitEpoch = candidate.artifact.slot === candidate.baseSlot
      ? candidate.baseCommitEpoch
      : candidate.baseCommitEpoch + 1,
  ): Promise<{ id: string; version: string }> {
    // MK-2c (2026-11-11, G2): the gate is asked again with the verdict carried from prepare, before the pointer
    // moves, since the switch can close between the two (the PRC-5c barrier). A refusal here is a plain error, so a
    // coordinated update recovers its retained old and discards the candidate.
    await this.assertListedAllowed(candidate.id, candidate.listedAs, candidate.indexGeneratedAt);
    await this.artifacts.commit(candidate.artifact, candidate.baseSlot, commitEpoch);
    try {
      this.log.info("fieldd.plugin_install.installed", "Registry plugin installed", {
        pluginId: candidate.id,
        version: candidate.version,
        artifactSha256: candidate.artifact.artifactSha256,
        commitEpoch,
      });
      await this.cfg.plugins.refresh();
    } catch (error) {
      // The durable pointer already moved. Never let the coordinator interpret
      // a registry rebuild failure as permission to recover retained-old.
      throw new PluginArtifactCommitIndeterminateError(candidate.id, error);
    }
    return { id: candidate.id, version: candidate.version };
  }

  async discard(candidate: PreparedRegistryInstall): Promise<boolean> {
    return await this.artifacts.discard(candidate.artifact);
  }

  /** MK-2c (2026-11-11, G1): a community plugin installs only while community plugins are allowed; VibeField's
   * own (`vibefield`, the signed rung R1) always may. */
  private async assertListedAllowed(
    pluginId: string,
    listedAs: RegistryListedAs,
    generatedAt: number,
  ): Promise<void> {
    if (listedAs !== "community") return;
    if ((await this.cfg.communityAllowed?.()) === true) return;
    throw new RpcCallError(
      "PRECONDITION_FAILED",
      `${pluginId} is a community plugin, and community plugins are off on this desktop`,
      false,
      {
        pluginKind: "PLUGIN_CAPABILITY_DENIED",
        reasonCode: COMMUNITY_SWITCH_CLOSED,
        generatedAt,
      },
    );
  }

  /** Compatibility wrapper until PRC-5c moves prepare before participant
   * teardown and commit after its prepare barrier. */
  async install(params: PluginsInstallParams): Promise<{ id: string; version: string }> {
    const candidate = await this.prepare(params);
    try {
      return await this.commit(candidate);
    } catch (error) {
      await this.discard(candidate).catch(() => false);
      throw error;
    }
  }

  /** §16.5 — uninstall removes CODE; data survives unless removeData. */
  async uninstall(id: string, removeData: boolean): Promise<void> {
    const record = this.cfg.plugins.get(id);
    if (record === undefined) throw new RpcCallError("NOT_FOUND", `no such plugin: ${id}`, false);
    if (record.source !== "registry")
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `${id} is ${record.source} — only registry installs uninstall here`,
        false,
      );
    await this.artifacts.uninstall(id);
    if (removeData)
      await rm(join(this.cfg.dataDir, "plugins", id), { recursive: true, force: true });
    this.log.info("fieldd.plugin_install.uninstalled", "Registry plugin uninstalled", {
      pluginId: id,
      removeData,
    });
    await this.cfg.plugins.refresh();
  }

  /** §5.3.1 — user-initiated batch check; never a background feed. */
  async updatesCheck(): Promise<PluginsUpdatesCheckResult> {
    const { index } = await this.fetchIndex();
    const updates: PluginUpdateInfo[] = [];
    const missing: string[] = [];
    for (const record of this.cfg.plugins.list()) {
      if (record.source !== "registry") continue;
      const entry = index.plugins[record.id];
      if (entry === undefined) {
        missing.push(record.id);
        continue;
      }
      if (semverNewer(entry.latest.version, record.version))
        updates.push({
          id: record.id,
          installedVersion: record.version,
          latest: entry.latest,
          compatible: contractsRangeSatisfied(CONTRACTS_VERSION, entry.latest.minContracts),
        });
    }
    return { checkedAt: Date.now(), updates, missing };
  }

  /** MK-2e (2026-11-11; MK-E9, B1; VF-PM 11:00:56Z): one listing picture, read at most `maxBytes`.
   * - The path is index-relative (`ListingPath` refused a scheme, "..", and an absolute path) and resolves against
   *   the index's base, so the URL keeps the index's scheme: an http(s) index never reads a file. On a URL index each
   *   segment is percent-encoded, so an encoded dot never becomes a segment.
   * - The cap holds while reading on both arms: http(s) counts the stream; a file opens without following a link at
   *   its last component and reads at most the cap.
   * - Redirects are followed as an artifact's are. The index's timeout bounds it, and `signal` (the catalog's
   *   budget) ends it sooner; the timer is cleared however it ends. */
  async fetchListingFile(
    indexRef: string,
    path: string,
    opts: { maxBytes: number; signal?: AbortSignal },
  ): Promise<ListingFileRead> {
    const timeoutMs = this.cfg.fetchTimeoutMs ?? REGISTRY_FETCH_TIMEOUT_MS;
    const timeout = new AbortController();
    const timer = setTimeout(
      () => timeout.abort(new Error(`no answer in ${timeoutMs} ms`)),
      timeoutMs,
    );
    const signal =
      opts.signal !== undefined ? AbortSignal.any([timeout.signal, opts.signal]) : timeout.signal;
    const base = indexRef.slice(0, indexRef.lastIndexOf("/") + 1);
    try {
      if (/^https?:\/\//.test(indexRef))
        return await this.readListingHttp(`${base}${encodePath(path)}`, opts.maxBytes, signal);
      const file = /^file:\/\//.test(indexRef)
        ? fileURLToPath(`${base}${encodePath(path)}`)
        : fileURLToPath(pathToFileURL(`${base}${path}`).href);
      return await readFileCapped(file, opts.maxBytes);
    } catch {
      return { ok: false, reason: "unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }

  private async readListingHttp(
    url: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<ListingFileRead> {
    const fetcher = this.cfg.fetchImpl ?? fetch;
    const res = await fetcher(url, { redirect: "follow", signal });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "unreachable" };
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "size" };
    }
    if (res.body === null) return { ok: true, bytes: Buffer.alloc(0) };
    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "size" };
      }
      chunks.push(Buffer.from(value));
    }
    return { ok: true, bytes: Buffer.concat(chunks, total) };
  }

  private resolveArtifactUrl(indexRef: string, release: RegistryRelease): string {
    if (/^(https?|file):\/\//.test(release.artifactUrl)) return release.artifactUrl;
    // relative to the index location (fixture/file registries)
    const base = indexRef.slice(0, indexRef.lastIndexOf("/") + 1);
    return `${base}${release.artifactUrl}`;
  }

  /** `timeoutMs` bounds the index's two small fetches alone (MK-2b, 2026-11-11, MK-D5), the body's read
   * included; an artifact's download keeps today's unbounded fetch. The timer is cleared however
   * the fetch ends, so nothing is left running after it. */
  private async fetchBytes(url: string, timeoutMs?: number): Promise<Buffer> {
    const abort = timeoutMs !== undefined ? new AbortController() : undefined;
    const timer =
      abort !== undefined
        ? setTimeout(() => abort.abort(new Error(`no answer in ${timeoutMs} ms`)), timeoutMs)
        : undefined;
    try {
      if (url.startsWith("file://")) return await readFile(fileURLToPath(url));
      if (!/^https?:\/\//.test(url)) return await readFile(fileURLToPath(pathToFileURL(url).href));
      const fetcher = this.cfg.fetchImpl ?? fetch;
      const res = await fetcher(url, {
        redirect: "follow",
        ...(abort !== undefined ? { signal: abort.signal } : {}),
      });
      if (!res.ok)
        throw new RpcCallError("UNAVAILABLE", `registry fetch failed: HTTP ${res.status}`, true, {
          pluginKind: "PLUGIN_SOURCE_UNAVAILABLE",
        });
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (e instanceof RpcCallError) throw e;
      throw new RpcCallError(
        "UNAVAILABLE",
        `registry unreachable: ${e instanceof Error ? e.message : String(e)}`,
        true,
        { pluginKind: "PLUGIN_SOURCE_UNAVAILABLE" },
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
