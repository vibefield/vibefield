import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CONTRACTS_VERSION,
  type PluginsInstallParams,
  type PluginsUpdatesCheckResult,
  type PluginUpdateInfo,
  type RegistryIndex,
  RegistryIndex as RegistryIndexSchema,
  type RegistryRelease,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { unpackVfplugin, verifyRegistryIndex } from "@vibefield/plugin-build";
import { RpcCallError } from "./native-link";
import {
  type ImmutablePluginArtifact,
  PluginArtifactCommitIndeterminateError,
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
  logger?: Logger;
}

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
}

const sha256hex = (bytes: Buffer): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

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
    const indexBytes = await this.fetchBytes(url);
    const sigText = (await this.fetchBytes(`${url}.sig`)).toString("utf8").trim();
    if (!verifyRegistryIndex(indexBytes, sigText, this.cfg.registryPublicKey))
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "registry index signature verification FAILED — refusing the index",
        false,
        { pluginKind: "PLUGIN_ARTIFACT_MISMATCH" },
      );
    let parsed: unknown;
    try {
      parsed = JSON.parse(indexBytes.toString("utf8"));
    } catch {
      throw new RpcCallError("PRECONDITION_FAILED", "registry index is not JSON", false);
    }
    const index = RegistryIndexSchema.safeParse(parsed);
    if (!index.success)
      throw new RpcCallError("PRECONDITION_FAILED", "registry index failed its schema", false);
    return { index: index.data, indexRef: url };
  }

  /** Resolve, verify, unpack, and durably publish an immutable candidate slot.
   * Discovery remains on the old pointer until commit(). */
  async prepare(params: PluginsInstallParams): Promise<PreparedRegistryInstall> {
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

    // P7 flat installs are copied into their first immutable revision before
    // an update. The old live bytes remain selected throughout preparation.
    await this.artifacts.adoptLegacy(params.id);
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
        // §6.3 provenance sidecar — written by fieldd, never by the artifact.
        await rm(join(staging, ".vf-registry.json"), { force: true });
        await writeFile(
          join(staging, ".vf-registry.json"),
          `${JSON.stringify(
            { indexRef, artifactSha256: release.sha256, publisher: entry.repo },
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
      });
      return {
        id: params.id,
        version: release.version,
        baseSlot,
        baseCommitEpoch,
        artifact,
        runtime,
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

  private resolveArtifactUrl(indexRef: string, release: RegistryRelease): string {
    if (/^(https?|file):\/\//.test(release.artifactUrl)) return release.artifactUrl;
    // relative to the index location (fixture/file registries)
    const base = indexRef.slice(0, indexRef.lastIndexOf("/") + 1);
    return `${base}${release.artifactUrl}`;
  }

  private async fetchBytes(url: string): Promise<Buffer> {
    try {
      if (url.startsWith("file://")) return await readFile(fileURLToPath(url));
      if (!/^https?:\/\//.test(url)) return await readFile(fileURLToPath(pathToFileURL(url).href));
      const fetcher = this.cfg.fetchImpl ?? fetch;
      const res = await fetcher(url, { redirect: "follow" });
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
    }
  }
}
