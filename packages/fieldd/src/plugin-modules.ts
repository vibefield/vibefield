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
import { join, resolve, sep } from "node:path";
import {
  PLUGIN_LIMITS,
  PLUGIN_MODULE_SCHEME,
  type PluginModuleResolution,
  type PluginModulesResult,
  type PluginModuleUrls,
} from "@vibefield/contracts";
import type { PluginRegistryService } from "./plugin-registry";

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
  readonly plugins: Pick<PluginRegistryService, "snapshot" | "rootPath">;
}

export class PluginModuleAuthority {
  private readonly deps: PluginModuleAuthorityDeps;
  /** token → grant, valid only for `mintedFor`. */
  private grants = new Map<string, Grant>();
  private urls: PluginModuleUrls[] = [];
  /** The generation `grants`/`urls` were built from; `-1` means "never built". */
  private mintedFor = -1;

  constructor(deps: PluginModuleAuthorityDeps) {
    this.deps = deps;
  }

  /** The renderer-safe projection (`plugins.modules`). Rebuilds when the
   * registry has moved; otherwise hands back the current set. */
  async modules(): Promise<PluginModulesResult> {
    const { generation } = this.deps.plugins.snapshot();
    await this.rebuildIfStale(generation);
    return { generation, modules: this.urls };
  }

  /** The privileged resolution (`plugins.resolveModule`, shell-main only).
   * Unknown token → undefined, and a token minted under a superseded generation
   * is unknown by construction: the caller cannot tell "never existed" from
   * "no longer authorized", which is the right amount to tell it. */
  async resolve(token: string): Promise<PluginModuleResolution | undefined> {
    const { generation } = this.deps.plugins.snapshot();
    await this.rebuildIfStale(generation);
    const grant = this.grants.get(token);
    if (grant === undefined) return undefined;
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

  private async rebuildIfStale(generation: number): Promise<void> {
    if (this.mintedFor === generation) return;
    const grants = new Map<string, Grant>();
    const urls: PluginModuleUrls[] = [];

    for (const record of this.deps.plugins.snapshot().plugins) {
      // Enablement and compatibility are the registry's verdict, not ours: a
      // row that is not `enabled` has no loadable module, full stop.
      if (record.state !== "enabled") continue;
      const root = this.deps.plugins.rootPath(record.id);
      if (root === undefined) continue;
      const entryRel = await readRendererEntry(root);
      if (entryRel === undefined) continue;

      // Containment, restated here rather than trusted from the manifest's own
      // syntactic check: this is the path main will open.
      const modulePath = resolve(join(root, entryRel));
      if (!modulePath.startsWith(`${resolve(root)}/`)) continue;

      const moduleToken = mintToken();
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
        styleToken = mintToken();
        grants.set(styleToken, {
          pluginId: record.id,
          path: stylePath,
          contentType: "text/css",
          root,
        });
      }

      urls.push({
        pluginId: record.id,
        moduleUrl: moduleUrl(moduleToken),
        ...(styleToken === undefined ? {} : { styleUrl: moduleUrl(styleToken) }),
        manifestHash: record.manifestHash,
        installRevision: record.installRevision,
      });
    }

    this.grants = grants;
    this.urls = urls;
    this.mintedFor = generation;
  }
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
