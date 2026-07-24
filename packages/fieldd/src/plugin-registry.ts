import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  CONTRACTS_VERSION,
  computeEffectiveGrants,
  isWellFormedPluginId,
  PLUGIN_LIMITS,
  type PluginErrorSummary,
  type PluginManifestV1,
  type PluginRecord,
  type PluginRegistryProblem,
  type PluginRegistrySnapshot,
  SemverString,
  validatePluginManifest,
} from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { RpcCallError } from "./native-link";

// PluginRegistryService (plugin spec §9, slice P2): discovery → validation →
// install records → sanitized snapshot. NO plugin module is ever imported here
// (§9.2 — registration is manifest data only; module loading is the P3
// harness's job, lazily, in the runtime that owns the entry).
//
// Sanitized-snapshot law (§9.4): records carry no filesystem paths, tokens, or
// stack traces. Problems name plugin directories by BASENAME. The internal
// root-path map stays private to this service.
//
// State machine (§9.3 subset): discovered → invalid | incompatible |
// registered(disabled | enabled). Entry states are "inactive"/"none" only —
// P2 never activates. The enable flag is INTENT and persists for any known id
// (disabling a broken plugin to silence it is legitimate); `enabled: true` is
// only ever REPORTED on a registered row.

export interface PluginRegistryConfig {
  dataDir: string;
  /** dirs whose CHILDREN are plugin dirs (each child holds vibefield.plugin.json) */
  roots: { bundled: string[]; devLinked: string[] };
}

interface InstallRecordsFile {
  version: 1;
  /** P6 — `grants` is the §15.3 device-local decision store: absent/true =
   * granted, explicit false = revoked. Same atomic file as enable intent. */
  plugins: Record<string, { enabled: boolean; grants?: Record<string, boolean> }>;
}

export interface PluginRegistryHealth {
  count: number;
  enabled: number;
  invalid: number;
}

/** Minimal range check for the engine ranges built-ins actually declare:
 * "*", exact "a.b.c", "^a.b.c" (npm zero-major rule), ">=a.b.c". Anything
 * fancier is honestly incompatible until a real semver lands (doctor says so). */
export function contractsRangeSatisfied(version: string, range: string): boolean {
  const parse = (v: string): [number, number, number] | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z-.]+)?$/.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const have = parse(version);
  if (have === null) return false;
  const r = range.trim();
  if (r === "*") return true;
  const cmp = (a: [number, number, number], b: [number, number, number]): number =>
    a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  if (r.startsWith("^")) {
    const want = parse(r.slice(1));
    if (want === null) return false;
    if (cmp(have, want) < 0) return false;
    if (want[0] > 0) return have[0] === want[0];
    if (want[1] > 0) return have[0] === 0 && have[1] === want[1];
    return cmp(have, want) === 0;
  }
  if (r.startsWith(">=")) {
    const want = parse(r.slice(2));
    return want !== null && cmp(have, want) >= 0;
  }
  const want = parse(r);
  return want !== null && cmp(have, want) === 0;
}

const sha256 = (text: string): string =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;

const summary = (kind: PluginErrorSummary["kind"], message: string): PluginErrorSummary => ({
  kind,
  message: message.slice(0, 500),
});

export class PluginRegistryService extends EventEmitter {
  private generation = 0;
  private rows = new Map<string, PluginRecord>();
  /** plugin dir absolute paths — DAEMON-INTERNAL (never in any snapshot); the
   * service host resolves entries.service against them. */
  private rootPaths = new Map<string, string>();
  /** P4 — live service-entry states asserted by the ServiceHost; an overlay so
   * a refresh() rebuild never erases runtime truth (§9.3 states). */
  private serviceStates = new Map<string, PluginRecord["service"]>();
  /** P6 — §15.4 grant generations: bump on every effective-grant change; an
   * overlay for the same reason serviceStates is (refresh never resets it). */
  private grantGenerations = new Map<string, number>();
  /** P6 — DAEMON-INTERNAL manifest sections the SANITIZED snapshot must not
   * carry (service method schemas; MCP server transports name executables and
   * setting keys). McpService and the projection read from here. */
  private serviceDecls = new Map<string, PluginManifestV1["contributes"]>();
  private pendingReloadDecls = new Map<string, PluginManifestV1["contributes"]>();
  private problems: PluginRegistryProblem[] = [];
  private records: InstallRecordsFile | null = null;
  private readonly recordsPath: string;
  private lastSnapshotJson = "";

  constructor(private readonly cfg: PluginRegistryConfig) {
    super();
    this.recordsPath = join(cfg.dataDir, "fieldd", "plugins", "install-records.json");
  }

  /** Full §9.2 re-scan. Emits ONE "changed" (coalesced) when the snapshot moved. */
  async refresh(): Promise<void> {
    const records = await this.loadRecords();
    const rows = new Map<string, PluginRecord>();
    const rootPaths = new Map<string, string>();
    const nextDecls = new Map<string, PluginManifestV1["contributes"]>();
    const problems: PluginRegistryProblem[] = [];

    // bundled roots scan first — no source may shadow a bundled id (§9.1)
    const walks: Array<{ source: "bundled" | "dev-linked"; root: string }> = [
      ...this.cfg.roots.bundled.map((root) => ({ source: "bundled" as const, root })),
      ...this.cfg.roots.devLinked.map((root) => ({ source: "dev-linked" as const, root })),
    ];
    for (const { source, root } of walks) {
      let children: string[];
      try {
        children = (await readdir(root, { withFileTypes: true }))
          .filter((d) => d.isDirectory() && !d.name.startsWith("."))
          .map((d) => d.name)
          .sort();
      } catch {
        problems.push({
          root: basename(root),
          error: summary("PLUGIN_SOURCE_UNAVAILABLE", `plugin root is not readable`),
        });
        continue;
      }
      for (const dir of children) {
        const manifestPath = join(root, dir, "vibefield.plugin.json");
        let size: number;
        try {
          size = (await stat(manifestPath)).size;
        } catch {
          continue; // a non-plugin directory in the root — not a problem, not a row
        }
        if (size > PLUGIN_LIMITS.MANIFEST_MAX_BYTES) {
          problems.push({
            root: dir,
            error: summary(
              "PLUGIN_INVALID",
              `manifest exceeds ${PLUGIN_LIMITS.MANIFEST_MAX_BYTES} bytes`,
            ),
          });
          continue;
        }
        let raw: string;
        let parsed: unknown;
        try {
          raw = await readFile(manifestPath, "utf8");
          parsed = JSON.parse(raw);
        } catch {
          problems.push({
            root: dir,
            error: summary("PLUGIN_INVALID", "vibefield.plugin.json is not valid JSON"),
          });
          continue;
        }
        const row = this.buildRow(parsed, raw, source, records, (id, contributes) =>
          nextDecls.set(id, contributes),
        );
        if (row === null) {
          problems.push({
            root: dir,
            error: summary("PLUGIN_INVALID", "manifest has no well-formed plugin id"),
          });
          continue;
        }
        const prior = rows.get(row.id);
        if (prior !== undefined) {
          problems.push({
            root: dir,
            error: summary(
              "PLUGIN_INVALID",
              `duplicate plugin id ${row.id} (already claimed by a ${prior.source} plugin)`,
            ),
          });
          continue; // first-discovered wins; bundled scans first (§9.1)
        }
        rows.set(row.id, row);
        rootPaths.set(row.id, join(root, dir));
      }
    }

    this.rows = rows;
    this.rootPaths = rootPaths;
    this.serviceDecls = nextDecls;
    this.problems = problems;
    this.publish();
  }

  /** DAEMON-INTERNAL (never snapshot data): the plugin's raw manifest
   * contributes — dynamic-service method schemas and full MCP server entries
   * for the runtimes that need them (§8.6/§8.7). */
  declaredContributes(id: string): PluginManifestV1["contributes"] | undefined {
    return this.serviceDecls.get(id);
  }

  /** id-keyed record from a parsed manifest, or null when no trustworthy id.
   * `collectContributes` receives the VALID manifest's raw contributes (the
   * daemon-internal declaration capture — never snapshot data). */
  private buildRow(
    parsed: unknown,
    raw: string,
    source: "bundled" | "dev-linked",
    records: InstallRecordsFile,
    collectContributes?: (id: string, contributes: PluginManifestV1["contributes"]) => void,
  ): PluginRecord | null {
    const idCandidate =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)["id"]
        : undefined;
    const validation = validatePluginManifest(parsed);
    if (!validation.ok) {
      // without a WELL-FORMED id there is nothing honest to key a row by —
      // the caller files a problem instead (PluginRecord.id must parse client-side)
      if (typeof idCandidate !== "string" || !isWellFormedPluginId(idCandidate)) return null;
      // invalid rows still present schema-true version/title (sanitized, never junk)
      const p = parsed as Record<string, unknown>;
      const version =
        typeof p["version"] === "string" && SemverString.safeParse(p["version"]).success
          ? p["version"]
          : "0.0.0";
      const title =
        typeof p["title"] === "string" && p["title"].length > 0 ? p["title"] : idCandidate;
      return {
        id: idCandidate,
        version,
        title,
        source,
        manifestHash: sha256(raw), // no canonical form exists for an invalid manifest
        installRevision: sha256(raw).slice(7, 19),
        state: "invalid",
        compatible: true,
        enabled: false,
        requestedCapabilities: [],
        grantedCapabilities: [],
        deniedCapabilities: [],
        grantGeneration: this.grantGenerations.get(idCandidate) ?? 0,
        contributions: { widgets: [], commands: [], surfaces: [], capabilities: [] },
        renderer: "none",
        service: "none",
        lastError: summary("PLUGIN_INVALID", validation.issues[0] ?? "manifest is invalid"),
      };
    }

    const m: PluginManifestV1 = validation.manifest;
    collectContributes?.(m.id, m.contributes);
    const hash = sha256(canonicalJson(m)); // §9.2 canonicalize-then-hash, the emitter's own form
    const platforms = m.engines.platforms;
    const platformOk = platforms === undefined || platforms.includes(process.platform as "darwin");
    // engines.app is unchecked in P2 — fieldd does not know the app's version
    // (the shell will supply it when the P3 harness lands); contracts is ours.
    const contractsOk = contractsRangeSatisfied(CONTRACTS_VERSION, m.engines.contracts);
    const compatible = contractsOk && platformOk;
    const wantEnabled = records.plugins[m.id]?.enabled ?? true;
    const registered = compatible;
    const enabled = registered && wantEnabled;
    // P6 — §15.2: effective = requested ∩ eligibility ∩ persisted decisions.
    // The algorithm lives in contracts (§15.1); this service feeds it state.
    // deniedCapabilities stays computed even while disabled — it describes the
    // CALCULATION; `enabled` gates the effective list (§16.5 disable revokes).
    const persisted = records.plugins[m.id]?.grants;
    const grants = computeEffectiveGrants({
      requested: m.capabilities,
      hasRenderer: m.entries?.renderer !== undefined,
      hasService: m.entries?.service !== undefined,
      source,
      ...(persisted !== undefined ? { persisted } : {}),
    });
    const base = {
      id: m.id,
      version: m.version,
      title: m.title,
      source,
      manifestHash: hash,
      installRevision: hash.slice(7, 19),
      compatible,
      enabled,
      requestedCapabilities: [...m.capabilities],
      grantedCapabilities: enabled ? grants.granted : [],
      deniedCapabilities: grants.denied,
      grantGeneration: this.grantGenerations.get(m.id) ?? 0,
      contributions: {
        widgets: m.contributes?.widgets ?? [],
        commands: m.contributes?.commands ?? [],
        surfaces: m.contributes?.surfaces ?? [],
        // P5 — the §8.5 declaration is PUBLIC pane data; values stay behind
        // storage.settings (the delegated suite caught this omission)
        ...(m.contributes?.settings !== undefined ? { settings: m.contributes.settings } : {}),
        // P6 — §15.1: custom-capability declarations are exactly what the
        // grants UX renders (title/description/risk); §8.7 sanitized MCP —
        // tools verbatim, servers stripped to id/kind (executables/urls stay in)
        capabilities: m.contributes?.capabilities ?? [],
        ...(m.contributes?.mcp !== undefined
          ? {
              mcp: {
                tools: (m.contributes.mcp.tools ?? []).map((t) => ({
                  name: t.name,
                  title: t.title,
                  description: t.description,
                  method: t.method,
                })),
                servers: (m.contributes.mcp.servers ?? []).map((s) => ({
                  id: s.id,
                  transportKind: s.transport.kind,
                  autoStart: s.autoStart === true,
                })),
              },
            }
          : {}),
      },
      renderer: (m.entries?.renderer !== undefined ? "inactive" : "none") as "inactive" | "none",
      service: (m.entries?.service !== undefined ? "inactive" : "none") as "inactive" | "none",
    };
    if (!compatible) {
      return {
        ...base,
        state: "incompatible",
        lastError: summary(
          "PLUGIN_INCOMPATIBLE",
          contractsOk
            ? `not built for platform ${process.platform}`
            : `requires contracts ${m.engines.contracts}, this device has ${CONTRACTS_VERSION}`,
        ),
      };
    }
    return { ...base, state: enabled ? "enabled" : "disabled" };
  }

  snapshot(): PluginRegistrySnapshot {
    return {
      generation: this.generation,
      plugins: [...this.rows.values()]
        .map((row) => {
          const service = this.serviceStates.get(row.id);
          return service !== undefined && service !== row.service ? { ...row, service } : row;
        })
        .sort((a, b) => a.id.localeCompare(b.id)),
      problems: [...this.problems].sort((a, b) => a.root.localeCompare(b.root)),
    };
  }

  /** DAEMON-INTERNAL: the plugin dir path (service-entry resolution). */
  rootPath(id: string): string | undefined {
    return this.rootPaths.get(id);
  }

  /** P4 — the ServiceHost asserts live §9.3 service-entry states here. */
  setServiceEntryState(id: string, state: PluginRecord["service"]): void {
    if (this.serviceStates.get(id) === state) return;
    this.serviceStates.set(id, state);
    this.publish();
  }

  list(): PluginRecord[] {
    return this.snapshot().plugins;
  }

  get(id: string): PluginRecord | undefined {
    return this.rows.get(id);
  }

  async enable(id: string): Promise<PluginRecord> {
    return this.setEnabled(id, true);
  }

  async disable(id: string): Promise<PluginRecord> {
    return this.setEnabled(id, false);
  }

  private async setEnabled(id: string, enabled: boolean): Promise<PluginRecord> {
    const row = this.rows.get(id);
    if (row === undefined) throw new RpcCallError("NOT_FOUND", `no such plugin: ${id}`, false);
    const records = await this.loadRecords();
    records.plugins[id] = { ...(records.plugins[id] ?? {}), enabled };
    await this.saveRecords(records);
    const registered = row.state === "enabled" || row.state === "disabled";
    const grants = this.effectiveGrantsFor(row, records);
    const next: PluginRecord = {
      ...row,
      enabled: registered && enabled,
      // §15.2 through the same algorithm as buildRow — enable never resurrects
      // an ineligible or revoked capability
      grantedCapabilities: registered && enabled ? grants.granted : [],
      deniedCapabilities: grants.denied,
      state: registered ? (enabled ? "enabled" : "disabled") : row.state,
    };
    this.rows.set(id, next);
    this.publish();
    return next;
  }

  /** P6 — §15.2/§15.4: persist one device-local grant decision and recompute.
   * Returns whether the EFFECTIVE grant set moved — the daemon cascades
   * (lease revocation, connection drops, service restart) only on movement. */
  async setGrant(
    id: string,
    capability: string,
    granted: boolean,
  ): Promise<{ record: PluginRecord; changed: boolean }> {
    const row = this.rows.get(id);
    if (row === undefined) throw new RpcCallError("NOT_FOUND", `no such plugin: ${id}`, false);
    if (!row.requestedCapabilities.includes(capability))
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `plugin ${id} does not request capability ${capability}`,
        false,
        { pluginKind: "PLUGIN_CAPABILITY_DENIED" },
      );
    const records = await this.loadRecords();
    const prior = records.plugins[id] ?? { enabled: row.enabled };
    records.plugins[id] = {
      ...prior,
      grants: { ...(prior.grants ?? {}), [capability]: granted },
    };
    await this.saveRecords(records);
    const grants = this.effectiveGrantsFor(row, records);
    const effective = row.enabled ? grants.granted : [];
    const changed =
      JSON.stringify(effective) !== JSON.stringify(row.grantedCapabilities) ||
      JSON.stringify(grants.denied) !== JSON.stringify(row.deniedCapabilities);
    const generation = (this.grantGenerations.get(id) ?? 0) + (changed ? 1 : 0);
    this.grantGenerations.set(id, generation);
    const next: PluginRecord = {
      ...row,
      grantedCapabilities: effective,
      deniedCapabilities: grants.denied,
      grantGeneration: generation,
    };
    this.rows.set(id, next);
    this.publish();
    return { record: next, changed };
  }

  /** §18.5 step 1-2 — validate a dev-linked plugin's CURRENT on-disk manifest
   * without disturbing the live version. Throws on every refusal (not dev-
   * linked, unreadable, invalid, id change, incompatible, durable-schema
   * regression); returns the candidate row on success. The live row is
   * untouched either way — that IS the v1 rollback story for dev-linked
   * sources, whose artifacts live in the developer's own tree. */
  async validateReload(id: string): Promise<PluginRecord> {
    const row = this.rows.get(id);
    if (row === undefined) throw new RpcCallError("NOT_FOUND", `no such plugin: ${id}`, false);
    if (row.source !== "dev-linked")
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "plugins.reload is for dev-linked sources only (§18.5); bundled plugins update with the app",
        false,
        { pluginKind: "PLUGIN_INVALID" },
      );
    const dir = this.rootPaths.get(id);
    if (dir === undefined)
      throw new RpcCallError("UNAVAILABLE", "plugin directory is no longer known", false);
    const manifestPath = join(dir, "vibefield.plugin.json");
    let raw: string;
    let parsed: unknown;
    try {
      const size = (await stat(manifestPath)).size;
      if (size > PLUGIN_LIMITS.MANIFEST_MAX_BYTES) throw new Error("manifest exceeds size cap");
      raw = await readFile(manifestPath, "utf8");
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `new manifest is unreadable (${(e as Error).message}); live version untouched`,
        false,
        { pluginKind: "PLUGIN_INVALID" },
      );
    }
    const records = await this.loadRecords();
    const candidate = this.buildRow(parsed, raw, "dev-linked", records, (mid, contributes) => {
      // staged: promoted to the live decls map only by applyReload (and only
      // when the id held — an id-change refusal must not pollute the map)
      if (mid === id) this.pendingReloadDecls.set(id, contributes);
    });
    if (candidate === null || candidate.id !== id)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "reload may not change the plugin id (§18.5) — uninstall and install instead",
        false,
        { pluginKind: "PLUGIN_INVALID" },
      );
    if (candidate.state === "invalid" || candidate.state === "incompatible")
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `new manifest refused (${candidate.lastError?.message ?? candidate.state}); live version untouched`,
        false,
        { pluginKind: candidate.state === "invalid" ? "PLUGIN_INVALID" : "PLUGIN_INCOMPATIBLE" },
      );
    // §18.5 — durable widget schemas may only move forward
    const oldVersions = new Map(
      row.contributions.widgets.map((w) => [w.type, w.schemaVersion] as const),
    );
    for (const w of candidate.contributions.widgets) {
      const prior = oldVersions.get(w.type);
      if (prior !== undefined && w.schemaVersion < prior)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          `widget ${w.type} regresses schemaVersion ${prior} → ${w.schemaVersion} (§18.5); live version untouched`,
          false,
          { pluginKind: "PLUGIN_SCHEMA_VIOLATION" },
        );
    }
    return candidate;
  }

  /** §18.5 step 6 — the atomic registry replacement, applied only after the
   * daemon has deactivated the old module instance. */
  applyReload(id: string, candidate: PluginRecord): PluginRecord {
    const staged = this.pendingReloadDecls.get(id);
    if (staged !== undefined) {
      this.serviceDecls.set(id, staged);
      this.pendingReloadDecls.delete(id);
    }
    this.rows.set(id, candidate);
    this.publish();
    return this.snapshot().plugins.find((p) => p.id === id) ?? candidate;
  }

  /** The row-shaped view of computeEffectiveGrants — entry kinds come from the
   * row ("none" means the manifest declared no such entry). */
  private effectiveGrantsFor(
    row: PluginRecord,
    records: InstallRecordsFile,
  ): ReturnType<typeof computeEffectiveGrants> {
    const persisted = records.plugins[row.id]?.grants;
    return computeEffectiveGrants({
      requested: row.requestedCapabilities,
      hasRenderer: row.renderer !== "none",
      hasService: row.service !== "none",
      source: row.source,
      ...(persisted !== undefined ? { persisted } : {}),
    });
  }

  health(): PluginRegistryHealth {
    let enabled = 0;
    let invalid = 0;
    for (const row of this.rows.values()) {
      if (row.state === "enabled") enabled += 1;
      if (row.state === "invalid") invalid += 1;
    }
    return { count: this.rows.size, enabled, invalid: invalid + this.problems.length };
  }

  dispose(): void {
    this.removeAllListeners();
  }

  /** generation bump + one coalesced "changed" — only when the snapshot moved */
  private publish(): void {
    const probe = JSON.stringify({
      plugins: this.snapshot().plugins,
      problems: this.snapshot().problems,
    });
    if (probe === this.lastSnapshotJson) return;
    this.lastSnapshotJson = probe;
    this.generation += 1;
    this.emit("changed", this.snapshot());
  }

  private async loadRecords(): Promise<InstallRecordsFile> {
    if (this.records !== null) return this.records;
    try {
      const parsed = JSON.parse(await readFile(this.recordsPath, "utf8")) as InstallRecordsFile;
      if (parsed !== null && typeof parsed === "object" && parsed.version === 1) {
        this.records = { version: 1, plugins: { ...parsed.plugins } };
        return this.records;
      }
    } catch {
      // first boot (or unreadable records): every known plugin defaults enabled
    }
    this.records = { version: 1, plugins: {} };
    return this.records;
  }

  private async saveRecords(records: InstallRecordsFile): Promise<void> {
    this.records = records;
    await mkdir(join(this.cfg.dataDir, "fieldd", "plugins"), { recursive: true });
    const tmp = `${this.recordsPath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    await rename(tmp, this.recordsPath);
  }
}
