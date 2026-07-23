import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  CONTRACTS_VERSION,
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
  plugins: Record<string, { enabled: boolean }>;
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
        const row = this.buildRow(parsed, raw, source, records);
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
    this.problems = problems;
    this.publish();
  }

  /** id-keyed record from a parsed manifest, or null when no trustworthy id. */
  private buildRow(
    parsed: unknown,
    raw: string,
    source: "bundled" | "dev-linked",
    records: InstallRecordsFile,
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
        contributions: { widgets: [], commands: [], surfaces: [] },
        renderer: "none",
        service: "none",
        lastError: summary("PLUGIN_INVALID", validation.issues[0] ?? "manifest is invalid"),
      };
    }

    const m: PluginManifestV1 = validation.manifest;
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
      // P2: requested verbatim while enabled (policy ceilings land at P6);
      // disable revokes (§16.5)
      grantedCapabilities: enabled ? [...m.capabilities] : [],
      contributions: {
        widgets: m.contributes?.widgets ?? [],
        commands: m.contributes?.commands ?? [],
        surfaces: m.contributes?.surfaces ?? [],
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
    records.plugins[id] = { enabled };
    await this.saveRecords(records);
    const registered = row.state === "enabled" || row.state === "disabled";
    const next: PluginRecord = {
      ...row,
      enabled: registered && enabled,
      grantedCapabilities: registered && enabled ? [...row.requestedCapabilities] : [],
      state: registered ? (enabled ? "enabled" : "disabled") : row.state,
    };
    this.rows.set(id, next);
    this.publish();
    return next;
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
