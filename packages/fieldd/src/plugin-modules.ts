// P8b — the plugin module authority (ESP §8.4).
//
// §8.4 assigns the roles and this file is fieldd's half of them: fieldd
// validates the install record, manifest hash, install revision, enablement,
// engine gates and grants, then hands out an APPROVED URL. Electron main serves
// bytes only for a token this file authorized, and must not discover plugins or
// decide grants — which is why nothing here takes an id or a path from a caller.
// A token is minted, never derived: `resolve` is a MAP LOOKUP, so there is no
// input a caller can shape into a path.
//
// Invalidation is structural rather than remembered. The registry bumps a
// generation on every snapshot move — discovery, enable, disable, reload,
// quarantine, an install revision changing — and the token table is rebuilt
// from scratch whenever the generation it was minted under is no longer the
// registry's. Tokens from the old generation are simply absent, which is §8.4's
// "every URL is invalidated on disable, reload, quarantine, or install-revision
// change" without a subscription, a cache, or a staleness window.

import { randomBytes } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  PLUGIN_LIMITS,
  PLUGIN_MODULE_SCHEME,
  type PluginModuleResolution,
  type PluginModulesResult,
  type PluginModuleUrls,
  type PluginRecord,
  type PluginUpdateArtifact,
} from "@vibefield/contracts";
import type { PluginRegistryCandidate, PluginRegistryService } from "./plugin-registry";

/** The two artifacts a staged renderer plugin can serve, and the only content
 * types this authority will ever name. A plugin cannot add a third by declaring
 * one — the manifest names its module; the stylesheet is derived from it. */
const STYLE_SUFFIX = ".css";

interface Grant {
  readonly pluginId: string;
  readonly path: string;
  readonly contentType: "text/javascript" | "text/css";
  /** The plugin root this grant is contained by, kept so containment can be
   * re-proven at AUTHORIZATION time rather than only at mint time. */
  readonly root: string;
}

export interface PluginModuleAuthorityDeps {
  readonly plugins: Pick<PluginRegistryService, "get" | "snapshot" | "rootPath">;
}

export interface PreparedCandidateModules {
  readonly updateId: string;
  readonly pluginId: string;
  readonly module?: PluginModuleUrls;
  /** Called only after the candidate artifact is the live registry row. */
  promote(): void;
  dispose(): void;
}

export interface PreparedRecoveryModules {
  readonly updateId: string;
  readonly pluginId: string;
  readonly module: PluginModuleUrls;
  dispose(): void;
}

interface CandidateEpisode {
  readonly updateId: string;
  readonly pluginId: string;
  readonly baseInstallRevision: string | null;
  readonly baseObservationFingerprint: string;
  readonly candidateInstallRevision: string;
  readonly candidateManifestHash: string;
  readonly candidateGrantGeneration: number;
  readonly candidateGrantFingerprint: string;
  readonly tokens: Set<string>;
  state: "prepared" | "promoted" | "disposed";
}

interface CandidateGrant {
  readonly episode: CandidateEpisode;
  readonly grant: Grant;
}

interface RecoveryEpisode {
  readonly updateId: string;
  readonly pluginId: string;
  readonly artifact: PluginUpdateArtifact;
  readonly observationFingerprint: string;
  readonly tokens: Set<string>;
  state: "prepared" | "disposed";
}

interface RecoveryGrant {
  readonly episode: RecoveryEpisode;
  readonly grant: Grant;
}

export class PluginModuleAuthority {
  private readonly deps: PluginModuleAuthorityDeps;
  /** token → grant, valid only for `mintedFor`. */
  private liveGrants = new Map<string, Grant>();
  private liveUrls: PluginModuleUrls[] = [];
  private readonly candidateGrants = new Map<string, CandidateGrant>();
  private readonly candidateEpisodes = new Map<string, CandidateEpisode>();
  private readonly candidatePluginOwners = new Map<string, string>();
  private readonly recoveryGrants = new Map<string, RecoveryGrant>();
  private readonly recoveryEpisodes = new Map<string, RecoveryEpisode>();
  /** The generation `grants`/`urls` were built from; `-1` means "never built". */
  private mintedFor = -1;
  /** A registry generation has exactly one live-token mint. Without this
   * single-flight, concurrent window boots each minted a different table and
   * the last assignment invalidated URLs already handed to the first. */
  private rebuildTask: Promise<void> | null = null;

  constructor(deps: PluginModuleAuthorityDeps) {
    this.deps = deps;
  }

  /** The renderer-safe projection (`plugins.modules`). Rebuilds when the
   * registry has moved; otherwise hands back the current set. */
  async modules(): Promise<PluginModulesResult> {
    const generation = await this.ensureLiveGrants();
    return { generation, modules: this.liveUrls };
  }

  /** The privileged resolution (`plugins.resolveModule`, shell-main only).
   * Unknown token → undefined, and a token minted under a superseded generation
   * is unknown by construction: the caller cannot tell "never existed" from
   * "no longer authorized", which is the right amount to tell it. */
  async resolve(token: string): Promise<PluginModuleResolution | undefined> {
    const generation = await this.ensureLiveGrants();
    const candidate = this.candidateGrants.get(token);
    const recovery = this.recoveryGrants.get(token);
    const grant = this.liveGrants.get(token) ?? candidate?.grant ?? recovery?.grant;
    if (
      grant === undefined ||
      (candidate !== undefined && !this.candidateIsAuthorized(candidate)) ||
      (recovery !== undefined && !this.recoveryIsAuthorized(recovery))
    )
      return undefined;
    // SYMLINK CONTAINMENT, RE-PROVEN HERE (EL7: a same-uid process can plant a
    // link). The mint-time check compares path STRINGS, which a symlink at
    // `dist/renderer.js` pointing anywhere would sail through — and main cannot
    // catch it, because catching it needs the plugin root and main knowing a
    // root would be main discovering plugins (§8.4). So it is checked on the
    // authorizing side, freshly, at the moment the answer is given: a link
    // planted after minting is refused on the very next request.
    if (!(await isContainedFile(grant.path, grant.root))) return undefined;
    return {
      pluginId: grant.pluginId,
      path: grant.path,
      contentType: grant.contentType,
      generation,
    };
  }

  /** PRC-5c: mint an episode-bound, path-free renderer module row from one
   * explicit immutable candidate. Live modules/current discovery do not move. */
  async prepareCandidate(input: {
    updateId: string;
    baseInstallRevision: string | null;
    candidate: PluginRegistryCandidate;
  }): Promise<PreparedCandidateModules> {
    if (!/^pupd_[A-Za-z0-9_-]+$/.test(input.updateId) || input.updateId.length > 128)
      throw new Error("invalid plugin update id");
    if (this.candidateEpisodes.has(input.updateId))
      throw new Error(`${input.updateId}: candidate module authority already exists`);
    const { record, manifest, root, artifactSha256 } = input.candidate;
    const owner = this.candidatePluginOwners.get(record.id);
    if (owner !== undefined)
      throw new Error(`${record.id}: candidate module authority is already owned by ${owner}`);
    const current = this.deps.plugins.get(record.id);
    const actualBase = current?.installRevision ?? null;
    if (actualBase !== input.baseInstallRevision) {
      throw new Error(
        `${record.id}: candidate module base is stale; expected ${input.baseInstallRevision ?? "absent"}, found ${actualBase ?? "absent"}`,
      );
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(artifactSha256))
      throw new Error(`${record.id}: candidate artifact sha256 is invalid`);
    const artifactSlot = artifactSha256.slice("sha256:".length);
    if (record.installRevision !== artifactSlot)
      throw new Error(`${record.id}: candidate runtime identity is not its complete artifact slot`);

    const episode: CandidateEpisode = {
      updateId: input.updateId,
      pluginId: record.id,
      baseInstallRevision: input.baseInstallRevision,
      baseObservationFingerprint: pluginObservationFingerprint(current),
      candidateInstallRevision: record.installRevision,
      candidateManifestHash: record.manifestHash,
      candidateGrantGeneration: record.grantGeneration,
      candidateGrantFingerprint: JSON.stringify(record.grantedCapabilities),
      tokens: new Set(),
      state: "prepared",
    };
    this.candidateEpisodes.set(input.updateId, episode);
    this.candidatePluginOwners.set(record.id, input.updateId);
    try {
      let module: PluginModuleUrls | undefined;
      if (record.state === "enabled" && record.renderer !== "none") {
        const entryRel = manifest.entries?.renderer;
        if (entryRel === undefined)
          throw new Error(`${record.id}: renderer row has no renderer manifest entry`);
        const grants = new Map<string, Grant>();
        module = await this.mintRendererUrls(record, root, entryRel, grants, true);
        for (const [token, grant] of grants) {
          episode.tokens.add(token);
          this.candidateGrants.set(token, { episode, grant });
        }
      }
      const handle: PreparedCandidateModules = {
        updateId: input.updateId,
        pluginId: record.id,
        ...(module === undefined ? {} : { module }),
        promote: () => {
          if (episode.state === "promoted") return;
          if (episode.state !== "prepared")
            throw new Error(`${input.updateId}: candidate module authority is disposed`);
          const live = this.deps.plugins.get(record.id);
          if (
            live?.state !== "enabled" ||
            live.installRevision !== episode.candidateInstallRevision ||
            live.manifestHash !== episode.candidateManifestHash ||
            live.grantGeneration !== episode.candidateGrantGeneration ||
            JSON.stringify(live.grantedCapabilities) !== episode.candidateGrantFingerprint
          ) {
            throw new Error(`${input.updateId}: candidate artifact is not current`);
          }
          episode.state = "promoted";
        },
        dispose: () => this.disposeCandidateEpisode(episode),
      };
      return Object.freeze(handle);
    } catch (error) {
      this.disposeCandidateEpisode(episode);
      throw error;
    }
  }

  /** A pre-commit renderer recovery must use a fresh browser module identity even though the live
   * registry generation still names retained old. This episode mints a second opaque URL against
   * that exact current artifact and disappears when the recovery barrier converges. */
  async prepareRecovery(input: {
    updateId: string;
    artifact: PluginUpdateArtifact;
  }): Promise<PreparedRecoveryModules> {
    if (!/^pupd_[A-Za-z0-9_-]+$/.test(input.updateId) || input.updateId.length > 128)
      throw new Error("invalid plugin update id");
    if (this.recoveryEpisodes.has(input.updateId))
      throw new Error(`${input.updateId}: retained-old module authority already exists`);
    const record = this.deps.plugins.get(input.artifact.pluginId);
    if (
      record === undefined ||
      record.state !== "enabled" ||
      record.installRevision !== input.artifact.installRevision ||
      record.manifestHash !== input.artifact.manifestHash
    ) {
      throw new Error(`${input.updateId}: retained-old artifact is not current`);
    }
    const root = this.deps.plugins.rootPath(record.id);
    if (root === undefined) throw new Error(`${record.id}: retained-old root is unavailable`);
    const entryRel = await readRendererEntry(root);
    if (entryRel === undefined)
      throw new Error(`${record.id}: retained-old renderer entry is unavailable`);
    const episode: RecoveryEpisode = {
      updateId: input.updateId,
      pluginId: record.id,
      artifact: Object.freeze({
        pluginId: input.artifact.pluginId,
        installRevision: input.artifact.installRevision,
        manifestHash: input.artifact.manifestHash,
      }),
      observationFingerprint: pluginObservationFingerprint(record),
      tokens: new Set(),
      state: "prepared",
    };
    this.recoveryEpisodes.set(input.updateId, episode);
    try {
      const grants = new Map<string, Grant>();
      const module = await this.mintRendererUrls(record, root, entryRel, grants, true);
      if (module === undefined)
        throw new Error(`${record.id}: retained-old renderer module is unavailable`);
      for (const [token, grant] of grants) {
        episode.tokens.add(token);
        this.recoveryGrants.set(token, { episode, grant });
      }
      return Object.freeze({
        updateId: input.updateId,
        pluginId: record.id,
        module,
        dispose: () => this.disposeRecoveryEpisode(episode),
      });
    } catch (error) {
      this.disposeRecoveryEpisode(episode);
      throw error;
    }
  }

  private async ensureLiveGrants(): Promise<number> {
    for (;;) {
      const generation = this.deps.plugins.snapshot().generation;
      if (this.mintedFor === generation) return generation;
      const active = this.rebuildTask;
      if (active !== null) {
        await active;
        continue;
      }
      const task = this.rebuildGeneration(generation);
      this.rebuildTask = task;
      try {
        await task;
      } finally {
        if (this.rebuildTask === task) this.rebuildTask = null;
      }
    }
  }

  private async rebuildGeneration(generation: number): Promise<void> {
    const snapshot = this.deps.plugins.snapshot();
    if (snapshot.generation !== generation) return;
    const grants = new Map<string, Grant>();
    const urls: PluginModuleUrls[] = [];

    for (const record of snapshot.plugins) {
      // Enablement and compatibility are the registry's verdict, not ours: a
      // row that is not `enabled` has no loadable module, full stop.
      if (record.state !== "enabled") continue;
      const root = this.deps.plugins.rootPath(record.id);
      if (root === undefined) continue;
      const entryRel = await readRendererEntry(root);
      if (entryRel === undefined) continue;
      const row = await this.mintRendererUrls(record, root, entryRel, grants, false);
      if (row !== undefined) urls.push(row);
    }

    // A refresh during filesystem inspection invalidates the whole private
    // build. Never publish tokens paired with a generation they did not scan.
    if (this.deps.plugins.snapshot().generation !== generation) return;
    this.liveGrants = grants;
    this.liveUrls = urls;
    this.mintedFor = generation;
  }

  private async mintRendererUrls(
    record: PluginModuleUrlsIdentity,
    root: string,
    entryRel: string,
    grants: Map<string, Grant>,
    requireModule: boolean,
  ): Promise<PluginModuleUrls | undefined> {
    // Containment, restated here rather than trusted from the manifest's own
    // syntactic check: this is the path main will open.
    const modulePath = resolve(join(root, entryRel));
    if (!isStrictlyWithin(modulePath, root)) {
      if (requireModule) throw new Error(`${record.id}: renderer entry escaped its artifact root`);
      return undefined;
    }
    if (requireModule && !(await isContainedFile(modulePath, root)))
      throw new Error(`${record.id}: candidate renderer entry is unavailable`);

    const moduleToken = this.uniqueToken(grants);
    grants.set(moduleToken, {
      pluginId: record.id,
      path: modulePath,
      contentType: "text/javascript",
      root,
    });

    // The stylesheet is the module's sibling, derived not declared — plugin
    // input never names a second file to authorize.
    const stylePath = modulePath.replace(/\.js$/, STYLE_SUFFIX);
    let styleToken: string | undefined;
    if (stylePath !== modulePath && (await isFile(stylePath))) {
      styleToken = this.uniqueToken(grants);
      grants.set(styleToken, {
        pluginId: record.id,
        path: stylePath,
        contentType: "text/css",
        root,
      });
    }

    return {
      pluginId: record.id,
      moduleUrl: moduleUrl(moduleToken),
      ...(styleToken === undefined ? {} : { styleUrl: moduleUrl(styleToken) }),
      manifestHash: record.manifestHash,
      installRevision: record.installRevision,
    };
  }

  private uniqueToken(local: Map<string, Grant>): string {
    let token = mintToken();
    while (
      local.has(token) ||
      this.liveGrants.has(token) ||
      this.candidateGrants.has(token) ||
      this.recoveryGrants.has(token)
    ) {
      token = mintToken();
    }
    return token;
  }

  private candidateIsAuthorized(candidate: CandidateGrant): boolean {
    const { episode } = candidate;
    if (episode.state === "disposed") return false;
    const live = this.deps.plugins.get(episode.pluginId);
    if (episode.state === "prepared") {
      return (
        (live?.installRevision ?? null) === episode.baseInstallRevision &&
        pluginObservationFingerprint(live) === episode.baseObservationFingerprint
      );
    }
    return (
      live?.state === "enabled" &&
      live.installRevision === episode.candidateInstallRevision &&
      live.manifestHash === episode.candidateManifestHash &&
      live.grantGeneration === episode.candidateGrantGeneration &&
      JSON.stringify(live.grantedCapabilities) === episode.candidateGrantFingerprint
    );
  }

  private disposeCandidateEpisode(episode: CandidateEpisode): void {
    if (episode.state === "disposed") return;
    episode.state = "disposed";
    for (const token of episode.tokens) this.candidateGrants.delete(token);
    this.candidateEpisodes.delete(episode.updateId);
    if (this.candidatePluginOwners.get(episode.pluginId) === episode.updateId)
      this.candidatePluginOwners.delete(episode.pluginId);
  }

  private recoveryIsAuthorized(recovery: RecoveryGrant): boolean {
    const { episode } = recovery;
    if (episode.state === "disposed") return false;
    const live = this.deps.plugins.get(episode.pluginId);
    return (
      live?.state === "enabled" &&
      live.installRevision === episode.artifact.installRevision &&
      live.manifestHash === episode.artifact.manifestHash &&
      pluginObservationFingerprint(live) === episode.observationFingerprint
    );
  }

  private disposeRecoveryEpisode(episode: RecoveryEpisode): void {
    if (episode.state === "disposed") return;
    episode.state = "disposed";
    for (const token of episode.tokens) this.recoveryGrants.delete(token);
    this.recoveryEpisodes.delete(episode.updateId);
  }
}

interface PluginModuleUrlsIdentity {
  readonly id: string;
  readonly manifestHash: string;
  readonly installRevision: string;
}

function pluginObservationFingerprint(record: PluginRecord | undefined): string {
  return JSON.stringify(
    record === undefined
      ? null
      : [
          record.id,
          record.state,
          record.enabled,
          record.installRevision,
          record.manifestHash,
          record.grantGeneration,
          record.grantedCapabilities,
        ],
  );
}

/** 128 bits from the CSPRNG. Unguessable and unrelated to the plugin's identity:
 * a token derived from an id or a hash would survive a revocation that changed
 * neither. */
function mintToken(): string {
  return randomBytes(16).toString("hex");
}

function moduleUrl(token: string): string {
  // Authority-only URL: the token IS the whole address, so there is no path
  // segment for anything to be joined onto (§8.4's warning about
  // `plugin://<id>/<path>` resolvers).
  return `${PLUGIN_MODULE_SCHEME}://${token}`;
}

function isStrictlyWithin(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** A regular file whose REAL path is still strictly beneath the plugin root.
 * `realpath` is what makes this a symlink check rather than a string compare —
 * the whole point is that `dist/renderer.js` may be a link planted by a
 * same-uid process (EL7) after the token was minted. */
async function isContainedFile(path: string, root: string): Promise<boolean> {
  try {
    const [realFile, realRoot] = await Promise.all([realpath(path), realpath(root)]);
    if (!realFile.startsWith(`${realRoot}${sep}`)) return false;
    return (await stat(realFile)).isFile();
  } catch {
    return false;
  }
}

/** The manifest's declared renderer entry, or undefined when it declares none
 * (a service-only or declaration-only plugin is a complete plugin — §4.3 A0). */
async function readRendererEntry(root: string): Promise<string | undefined> {
  try {
    const path = join(root, "vibefield.plugin.json");
    if ((await stat(path)).size > PLUGIN_LIMITS.MANIFEST_MAX_BYTES) return undefined;
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const entries = (parsed as { entries?: { renderer?: unknown } }).entries;
    const renderer = entries?.renderer;
    return typeof renderer === "string" ? renderer : undefined;
  } catch {
    return undefined;
  }
}
