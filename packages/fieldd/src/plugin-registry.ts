import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  BUNDLED_PLUGIN_INDEX_FILE,
  type BundledPluginEntry,
  CONTRACTS_VERSION,
  computeEffectiveGrants,
  isWellFormedPluginId,
  LAYOUT,
  PLUGIN_LIMITS,
  type PluginErrorSummary,
  type PluginManifestV1,
  type PluginRecord,
  type PluginRegistryProblem,
  type PluginRegistrySnapshot,
  type RegistryListedAs,
  RegistryProvenance,
  type RegistryRung,
  SemverString,
  SIGNATURE_SUFFIX,
  validatePluginManifest,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { canonicalJson, verifyBundledIndex, verifyTrustRoot } from "@vibefield/plugin-build";
import { RpcCallError } from "./native-link";
import {
  type InstalledPluginArtifactSelection,
  resolveInstalledArtifact,
} from "./plugin-artifact-store";
import { SystemDocFile } from "./system-doc-file";

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
  /** dirs whose CHILDREN are plugin dirs (each child holds vibefield.plugin.json).
   * P7 — `installed` is the registry-install root (source:"registry"); its
   * children carry a `.vf-registry.json` provenance sidecar (§6.3). */
  roots: { bundled: string[]; devLinked: string[]; installed?: string[] };
  /** WP8c / TD-2 — set ⇒ every bundled root is KEYED: walked only through its signed index
   * (`verifyBundledIndex`, the stager's own verifier), after the trust-root at `trustRootPath` verifies
   * against `rootKeys` (the app's embedded root, handed over by the shell — never read from the root it
   * protects). Unset ⇒ a bundled root walks by manifest as before: the developer's own tree. */
  bundledTrust?: { trustRootPath: string; rootKeys: readonly string[] };
  /** Item 279's S3 (2026-11-19) — set ⇒ every installed revision is held, at each refresh, to what its install verified:
   * `verify` (the daemon hands `verifyInstalledRevision`, `plugin-installed-verify.ts`, with the list key) answers for
   * the revision the pointer selects, and one that fails is a refused row, never loadable, as a bundled one is. Unset ⇒
   * an installed root walks as before. The daemon hands it with the installed root, under one condition: a list key. */
  installedTrust?: {
    verify(pluginId: string, selected: InstalledPluginArtifactSelection): Promise<InstalledVerdict>;
  };
  /** MK-O3 (O3-C, 2026-11-12; James's pick "Stop"): community plugins off means none of their code runs. Set (the
   * daemon alone), a registry row is held as if turned off while the community gate says so (`setCommunityGate`),
   * and every registry row is held until a gate is set, or when it fails. Unset (a registry a test builds alone),
   * nothing is held. Bundled and development rows are never held. */
  communityHold?: true;
  /** Item 457: what the records file's writer says, chiefly a torn copy kept aside and a fall-back to the last good
   * one (`SystemDocFile`). Unset (a registry a test builds alone), it says nothing. */
  logger?: Logger;
}

/** Item 279's S3: whether an installed revision holds what its install verified. A refusal's reason names a path
 * inside the artifact at most, never one on this device. */
export type InstalledVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** MK-O3 (O3-C): the community gate's answer for one refresh. Allowed, nothing is held; else each registry id the held
 * plugin list does not name as VibeField's is held (`plugin-catalog.ts`, `listedAsLookup`). */
export type CommunityVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly listedAs: (id: string) => RegistryListedAs };
export type CommunityGate = () => Promise<CommunityVerdict>;

/** Items 442 and 452 (2026-11-15): a person's act on this desktop that the account has not received yet. Its
 * publication failed, or fieldd stopped before it was sent. A walk holds it against the account's doc until a
 * publication carries it. */
export interface UnpublishedMark {
  /** the person's on/off here: off is restricting, on is enabling */
  enabled?: boolean;
  /** the capabilities the person revoked here (restricting) */
  revoked?: string[];
  /** the person removed the plugin here (restricting) */
  removed?: true;
  /** the person installed or updated the plugin here (enabling) */
  installed?: true;
}

/** Items 442 and 452 (plan r2; VF-PM 2026-11-15 12:38:10Z): the ONE seam that decides whether a part of a mark is
 * written to the records file. A restricting part is (a disable, a revocation, a removal), so it outlives a restart.
 * An enabling part (an enable, an install) is kept in this process's memory alone, never written to the file nor read
 * from it: any process of this uid can write the file, and a planted enabling mark would be held against the
 * account's doc and sent to it. */
export function persisted(part: keyof UnpublishedMark, value: unknown): boolean {
  if (part === "enabled") return value === false;
  return part === "revoked" || part === "removed";
}

/** A mark split by `persisted`: what the records file may hold, and what lives in this process's memory alone. */
function splitMark(mark: UnpublishedMark): { file: UnpublishedMark; memory: UnpublishedMark } {
  const file: UnpublishedMark = {};
  const memory: UnpublishedMark = {};
  if (mark.enabled !== undefined) {
    (persisted("enabled", mark.enabled) ? file : memory).enabled = mark.enabled;
  }
  if (mark.revoked !== undefined && mark.revoked.length > 0) {
    (persisted("revoked", mark.revoked) ? file : memory).revoked = mark.revoked;
  }
  if (mark.removed === true) (persisted("removed", true) ? file : memory).removed = true;
  if (mark.installed === true) (persisted("installed", true) ? file : memory).installed = true;
  return { file, memory };
}

/** A records entry's mark, read tolerantly and through the same seam: a part of the wrong type, and every part the
 * file may not hold (an enabling one), reads as absent. */
function readMark(raw: unknown): UnpublishedMark {
  if (raw === null || typeof raw !== "object") return {};
  const { enabled, revoked, removed, installed } = raw as Record<string, unknown>;
  const capabilities = Array.isArray(revoked)
    ? [...new Set(revoked.filter((c): c is string => typeof c === "string"))]
    : [];
  return splitMark({
    ...(typeof enabled === "boolean" ? { enabled } : {}),
    ...(capabilities.length > 0 ? { revoked: capabilities } : {}),
    ...(removed === true ? { removed: true as const } : {}),
    ...(installed === true ? { installed: true as const } : {}),
  }).file;
}

/** One plugin's entry in the records file. */
interface InstallRecordEntry {
  enabled: boolean;
  grants?: Record<string, boolean>;
  /** items 442 and 452: the restricting parts of this desktop's unpublished act, the only ones written (`persisted`) */
  unpublished?: UnpublishedMark;
}

interface InstallRecordsFile {
  version: 1;
  /** P6 — `grants` is the §15.3 device-local decision store: absent/true =
   * granted, explicit false = revoked. Same atomic file as enable intent. */
  plugins: Record<string, InstallRecordEntry>;
}

export interface PluginRegistryHealth {
  count: number;
  enabled: number;
  invalid: number;
}

/** Daemon-internal, code-free view of one immutable registry candidate. It is
 * intentionally not installed in rows/rootPaths/serviceDecls by inspection. */
export interface PluginRegistryCandidate {
  readonly record: PluginRecord;
  readonly manifest: PluginManifestV1;
  readonly root: string;
  readonly artifactSha256: string;
}

/** MK-2c (2026-11-11, G2): the slot file's provenance with the signed entry's display copies in place of its own. */
function withSignedCopies(
  provenance: RegistryProvenance,
  signed: { rung?: RegistryRung; publisherName?: string },
): RegistryProvenance {
  const { rung: _fileRung, publisherName: _filePublisherName, ...rest } = provenance;
  return {
    ...rest,
    ...(signed.rung !== undefined ? { rung: signed.rung } : {}),
    ...(signed.publisherName !== undefined ? { publisherName: signed.publisherName } : {}),
  };
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

/** A row's `manifestHash`: §9.2 canonicalize-then-hash, the emitter's own form. MK-O2 (2026-11-12): the installer
 * holds a candidate's row to the manifest inside its verified artifact by this same hash. */
export const manifestHashOf = (manifest: PluginManifestV1): string =>
  sha256(canonicalJson(manifest));

const summary = (kind: PluginErrorSummary["kind"], message: string): PluginErrorSummary => ({
  kind,
  message: message.slice(0, 500),
});

/** MK-O3 (O3-C): a registered row held as if turned off: not enabled, no grants, and why. Null for a row that is
 * invalid or incompatible, which is off already and stays as it is. MK-O3D (2026-11-14, O3-C's rider): `held` says
 * why a row the person wants on is off (the contract's rule), so a row whose wish is off (`buildRow`'s `enabled`, the
 * wish of a registered row) is held without it: it reads off as the person left it. */
function heldOff(row: PluginRecord): PluginRecord | null {
  if (row.state !== "enabled" && row.state !== "disabled") return null;
  return {
    ...row,
    enabled: false,
    grantedCapabilities: [],
    state: "disabled",
    held: row.enabled ? "community-off" : undefined,
  };
}

export class PluginRegistryService extends EventEmitter {
  private generation = 0;
  private rows = new Map<string, PluginRecord>();
  /** plugin dir absolute paths — DAEMON-INTERNAL (never in any snapshot); the
   * service host resolves entries.service against them. */
  private rootPaths = new Map<string, string>();
  /** DAEMON-INTERNAL durable publication epochs discovered from registry
   * pointers. They seed update coordinators after every fieldd restart. */
  private commitEpochs = new Map<string, number>();
  /** P4 — live service-entry states asserted by the ServiceHost; an overlay so
   * a refresh() rebuild never erases runtime truth (§9.3 states). */
  private serviceStates = new Map<string, PluginRecord["service"]>();
  /** Daemon-internal renderer-serving epoch. Registry `generation` orders the
   * whole snapshot; this one moves only when an explicit dev reload must make
   * this plugin's module URLs and browser module identity fresh even if the
   * author kept the manifest byte-identical. */
  private rendererServingRevisions = new Map<string, number>();
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
  /** Item 457: the records file's ONE writer, the system documents' (`system-doc-file.ts`, DS-5c): one write at a
   * time, each taking the records as they stand when it runs; a per-process tmp, fsync'd, the last good copy kept;
   * a copy it cannot read is kept aside and the last good one read, never first boot. */
  private readonly recordsFile: SystemDocFile;
  /** The records' one load, shared by every first reader (`loadRecords`). */
  private recordsLoad: Promise<InstallRecordsFile> | null = null;
  private lastSnapshotJson = "";
  /** MK-O3 (O3-C): the community gate (`setCommunityGate`), and the registry ids the last refresh held. The set, never
   * the row's `held`, is what decides: `setEnabled` keeps a held row held, and the daemon's hold reads it. */
  private communityGate: CommunityGate | null = null;
  private heldIds = new Set<string>();
  /** Items 442 and 452: the ENABLING parts of the marks, in this process's memory alone (`persisted`). */
  private readonly heldMarks = new Map<string, UnpublishedMark>();

  constructor(private readonly cfg: PluginRegistryConfig) {
    super();
    this.recordsPath = join(cfg.dataDir, ...LAYOUT.PLUGIN_RECORDS_FILE);
    this.recordsFile = new SystemDocFile({
      path: this.recordsPath,
      snapshot: () => RECORDS_TEXT.encode(`${JSON.stringify(this.records, null, 2)}\n`),
      ...(cfg.logger !== undefined ? { logger: cfg.logger } : {}),
    });
  }

  /** Full §9.2 re-scan. Emits ONE "changed" (coalesced) when the snapshot moved. */
  async refresh(): Promise<void> {
    const records = await this.loadRecords();
    // MK-O3 (O3-C): the gate is asked once per refresh, before the walk
    const holds = await this.communityHolds();
    const heldIds = new Set<string>();
    const rows = new Map<string, PluginRecord>();
    const rootPaths = new Map<string, string>();
    const commitEpochs = new Map<string, number>();
    const nextDecls = new Map<string, PluginManifestV1["contributes"]>();
    const problems: PluginRegistryProblem[] = [];

    // bundled roots scan first — no source may shadow a bundled id (§9.1).
    // dev links outrank registry installs of the SAME id: a dev link exists
    // only in developer mode and is the developer's deliberate local override
    // of the published copy (the working-on-my-own-plugin loop).
    const walks: Array<{ source: "bundled" | "dev-linked" | "registry"; root: string }> = [
      ...this.cfg.roots.bundled.map((root) => ({ source: "bundled" as const, root })),
      ...this.cfg.roots.devLinked.map((root) => ({ source: "dev-linked" as const, root })),
      ...(this.cfg.roots.installed ?? []).map((root) => ({ source: "registry" as const, root })),
    ];
    for (const { source, root } of walks) {
      if (source === "bundled" && this.cfg.bundledTrust !== undefined) {
        await this.walkKeyedBundled(root, this.cfg.bundledTrust, records, {
          rows,
          rootPaths,
          commitEpochs,
          nextDecls,
          problems,
        });
        continue;
      }
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
        let pluginRoot = join(root, dir);
        let commitEpoch = 1;
        // item 279's S3: the revision's provenance, checked against what its install verified
        let verified: InstalledPluginArtifactSelection | null = null;
        if (source === "registry") {
          try {
            const selected = await resolveInstalledArtifact(root, dir);
            if (selected === null) continue;
            pluginRoot = selected.root;
            commitEpoch = selected.commitEpoch;
            const trust = this.cfg.installedTrust;
            if (trust !== undefined) {
              const verdict = await trust.verify(dir, selected);
              if (!verdict.ok) {
                this.refuseInstalled(dir, selected, verdict.reason, rows, problems);
                continue;
              }
              verified = selected;
            }
          } catch (error) {
            problems.push({
              root: dir,
              error: summary(
                "PLUGIN_ARTIFACT_MISMATCH",
                `current artifact pointer is invalid: ${error instanceof Error ? error.message : String(error)}`,
              ),
            });
            continue;
          }
        }
        const manifestPath = join(pluginRoot, "vibefield.plugin.json");
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
        let row = this.buildRow(parsed, raw, source, records, (id, contributes) =>
          nextDecls.set(id, contributes),
        );
        if (row !== null && source === "registry") {
          // §6.3 — verified provenance rides a fieldd-written sidecar; a
          // missing/invalid sidecar leaves the row provenance-less (visible
          // in the manager as an anomaly, never fatal)
          try {
            const sidecar = JSON.parse(
              await readFile(join(pluginRoot, ".vf-registry.json"), "utf8"),
            );
            const prov = RegistryProvenance.safeParse(sidecar);
            if (prov.success) {
              row = {
                ...row,
                registry: prov.data,
                // PRC-5c: runtime identity must cover code/assets, not only
                // the manifest. Artifact-store slots are the complete signed
                // package SHA-256 without its `sha256:` prefix.
                installRevision: prov.data.artifactSha256.slice("sha256:".length),
              };
            }
          } catch {
            // absent sidecar — the honest state is simply no provenance block
          }
          // Item 279's S3: a checked revision's provenance is the checked one. The artifact's hash is the pointer's,
          // which the kept list signed; the publisher is the id's namespace, as the install writes it. The sidecar
          // gives the list's address alone, which nothing acts on.
          if (verified !== null) {
            if (row.id !== dir) {
              this.refuseInstalled(
                dir,
                verified,
                "its manifest names another plugin",
                rows,
                problems,
              );
              continue;
            }
            row = {
              ...row,
              registry: {
                indexRef: row.registry?.indexRef ?? "",
                artifactSha256: verified.pointer.artifactSha256,
                publisher: dir.split(".")[0] ?? dir,
              },
              installRevision: verified.pointer.slot,
            };
          }
        }
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
        // MK-O3 (O3-C): a registry row the community gate holds is held as if turned off. Nothing is written: the
        // person's own switch stays in the records, and the row comes back as it was when the hold lifts.
        const held = source === "registry" && holds(row.id) ? heldOff(row) : null;
        if (held !== null) {
          row = held;
          heldIds.add(row.id);
        }
        rows.set(row.id, row);
        rootPaths.set(row.id, pluginRoot);
        commitEpochs.set(row.id, commitEpoch);
      }
    }

    this.rows = rows;
    this.rootPaths = rootPaths;
    this.commitEpochs = commitEpochs;
    this.serviceDecls = nextDecls;
    this.problems = problems;
    this.heldIds = heldIds;
    this.publish();
  }

  /** MK-O3 (O3-C): the daemon sets the gate once both of its reads exist (the settings doc and the catalog), then
   * refreshes. */
  setCommunityGate(gate: CommunityGate): void {
    this.communityGate = gate;
  }

  /** MK-O3 (O3-C), DAEMON-INTERNAL: whether the last refresh held this registry id. */
  isHeld(id: string): boolean {
    return this.heldIds.has(id);
  }

  /** MK-O3 (O3-C), DAEMON-INTERNAL: the person's own switch for a plugin, as the records hold it (absent: on). A held
   * row reads off whatever it says; the reconciler holds a synced wish to this one. */
  async wantsEnabled(id: string): Promise<boolean> {
    const records = await this.loadRecords();
    return records.plugins[id]?.enabled ?? true;
  }

  /** Items 442 and 452, DAEMON-INTERNAL: the mark standing for a plugin, the file's parts with this process's. It
   * answers for an id with no row: an uninstall leaves the plugin's records entry in the file. */
  async unpublished(id: string): Promise<UnpublishedMark> {
    const records = await this.loadRecords();
    return { ...readMark(records.plugins[id]?.unpublished), ...this.heldMarks.get(id) };
  }

  /** Items 442 and 452, DAEMON-INTERNAL: mark a person's act here, before its move. A part replaces the same part
   * standing (a later act is the last word); `revoked` adds its capabilities. Presence is one thing, as on/off is one
   * field: a removal clears an install standing and an install clears a removal, so a file's `removed` never outlives
   * the memory's later `installed` across a restart (VF-PM 2026-11-15 12:54:30Z). */
  async mark(id: string, part: UnpublishedMark): Promise<void> {
    const now = await this.unpublished(id);
    const revoked = [...new Set([...(now.revoked ?? []), ...(part.revoked ?? [])])];
    const { removed: _removed, installed: _installed, ...rest } = now;
    const presence: UnpublishedMark = {};
    if (part.removed !== true && part.installed !== true) {
      if (now.removed === true) presence.removed = true;
      if (now.installed === true) presence.installed = true;
    }
    await this.setMark(id, {
      ...rest,
      ...presence,
      ...part,
      ...(revoked.length > 0 ? { revoked } : {}),
    });
  }

  /** Items 442 and 452, DAEMON-INTERNAL: clear what a committed publication carried, or what no longer holds. An
   * `enabled` part clears only the same wish; `revoked` clears the capabilities it names. */
  async clearMark(id: string, part: UnpublishedMark): Promise<void> {
    const now = await this.unpublished(id);
    const revoked = (now.revoked ?? []).filter((c) => !(part.revoked ?? []).includes(c));
    const enabled = now.enabled === part.enabled ? undefined : now.enabled;
    await this.setMark(id, {
      ...(enabled !== undefined ? { enabled } : {}),
      ...(revoked.length > 0 ? { revoked } : {}),
      ...(now.removed === true && part.removed !== true ? { removed: true as const } : {}),
      ...(now.installed === true && part.installed !== true ? { installed: true as const } : {}),
    });
  }

  /** A whole mark, its parts split by `persisted`: the enabling ones to memory, the restricting ones to the records
   * file in one write when they moved. A write also drops any part the file held that it may not hold. */
  private async setMark(id: string, mark: UnpublishedMark): Promise<void> {
    const { file, memory } = splitMark(mark);
    if (Object.keys(memory).length > 0) this.heldMarks.set(id, memory);
    else this.heldMarks.delete(id);
    const records = await this.loadRecords();
    const entry = records.plugins[id];
    const empty = Object.keys(file).length === 0;
    if (entry === undefined && empty) return;
    if (JSON.stringify(entry?.unpublished ?? {}) === JSON.stringify(file)) return;
    const stood: InstallRecordEntry = entry ?? { enabled: true }; // an entry absent reads on (`wantsEnabled`)
    const { unpublished: _stood, ...rest } = stood;
    records.plugins[id] = empty ? rest : { ...rest, unpublished: file };
    await this.saveRecords(records);
  }

  /** MK-O3 (O3-C): which registry ids this refresh holds. Without `communityHold`, none. With it, every one until a
   * gate is set and every one when the gate fails (closed, VF-PM's ask 6); else each id that does not list as
   * VibeField's while community plugins are not allowed. */
  private async communityHolds(): Promise<(id: string) => boolean> {
    if (this.cfg.communityHold !== true) return () => false;
    const gate = this.communityGate;
    if (gate === null) return () => true;
    let verdict: CommunityVerdict;
    try {
      verdict = await gate();
    } catch {
      return () => true;
    }
    if (verdict.allowed) return () => false;
    const { listedAs } = verdict;
    return (id) => listedAs(id) !== "vibefield";
  }

  /** WP8c (WP8-D5, D7): a keyed bundled root. The trust-root first, against the app's root keys; then the index
   * against the document's `bundled` role and every listed plugin's file set and bytes. Two grains, fail closed:
   * the trust-root or the index refused ⇒ ONE root problem and no row from the root; a plugin whose files differ
   * ⇒ that plugin's row is `invalid` with `PLUGIN_ARTIFACT_MISMATCH` naming the first offending path, and the others
   * register. A directory the index does not list is ignored — never a row. A verified row's `installRevision` is
   * its artifact hash and it carries a provenance block, exactly as a registry row does (§6.3). Re-verified on every
   * refresh: a bundled root is read at boot and at the registry's own refreshes. */
  private async walkKeyedBundled(
    root: string,
    trust: { trustRootPath: string; rootKeys: readonly string[] },
    records: InstallRecordsFile,
    into: {
      rows: Map<string, PluginRecord>;
      rootPaths: Map<string, string>;
      commitEpochs: Map<string, number>;
      nextDecls: Map<string, PluginManifestV1["contributes"]>;
      problems: PluginRegistryProblem[];
    },
  ): Promise<void> {
    const refuseRoot = (message: string): void => {
      into.problems.push({
        root: basename(root),
        error: summary("PLUGIN_ARTIFACT_MISMATCH", message),
      });
    };
    let docBytes: Buffer;
    let sigText: string;
    try {
      docBytes = await readFile(trust.trustRootPath);
      sigText = await readFile(`${trust.trustRootPath}${SIGNATURE_SUFFIX}`, "utf8");
    } catch {
      refuseRoot("the app's trust-root is missing or unreadable");
      return;
    }
    const doc = verifyTrustRoot(docBytes, sigText, { keys: trust.rootKeys, threshold: 1 });
    if (!doc.ok) {
      refuseRoot(`the app's trust-root does not verify: ${doc.reason}`);
      return;
    }
    if (doc.signers.length < doc.doc.root.threshold) {
      refuseRoot(
        `the app's trust-root carries ${doc.signers.length} root signature(s); it needs ${doc.doc.root.threshold}`,
      );
      return;
    }
    const verdict = await verifyBundledIndex({ root, trust: doc.doc.roles.bundled });
    if (!verdict.ok) {
      refuseRoot(verdict.reason);
      return;
    }
    for (const plugin of verdict.plugins.values()) {
      const { entry } = plugin;
      if (!plugin.ok) {
        into.rows.set(entry.id, this.refusedBundledRow(entry, plugin.reason));
        continue;
      }
      let raw: string;
      let parsed: unknown;
      try {
        raw = await readFile(join(plugin.dir, "vibefield.plugin.json"), "utf8");
        parsed = JSON.parse(raw);
      } catch {
        into.rows.set(
          entry.id,
          this.refusedBundledRow(entry, "vibefield.plugin.json is not valid JSON"),
        );
        continue;
      }
      let contributes: PluginManifestV1["contributes"] | undefined;
      const row = this.buildRow(parsed, raw, "bundled", records, (_id, declared) => {
        contributes = declared;
      });
      if (row === null || row.id !== entry.id || row.manifestHash !== entry.manifestHash) {
        into.rows.set(
          entry.id,
          this.refusedBundledRow(entry, "vibefield.plugin.json does not match the bundled index"),
        );
        continue;
      }
      into.rows.set(row.id, {
        ...row,
        installRevision: entry.artifactSha256.slice("sha256:".length),
        registry: {
          indexRef: BUNDLED_PLUGIN_INDEX_FILE,
          artifactSha256: entry.artifactSha256,
          publisher: "vibefield",
        },
      });
      if (contributes !== undefined) into.nextDecls.set(row.id, contributes);
      into.rootPaths.set(row.id, plugin.dir);
      into.commitEpochs.set(row.id, 1);
    }
  }

  /** Item 279's S3: an installed plugin whose revision does not hold what its install verified: present, honest, never
   * loadable, as a refused bundled plugin is. Its manifest is not believed, so its title is its id. A source that
   * claimed the id first keeps it (bundled scans first, §9.1). Remove… still stands on it (a registry row). */
  private refuseInstalled(
    id: string,
    selected: InstalledPluginArtifactSelection,
    reason: string,
    rows: Map<string, PluginRecord>,
    problems: PluginRegistryProblem[],
  ): void {
    const prior = rows.get(id);
    if (prior !== undefined) {
      problems.push({
        root: id,
        error: summary(
          "PLUGIN_INVALID",
          `duplicate plugin id ${id} (already claimed by a ${prior.source} plugin)`,
        ),
      });
      return;
    }
    this.cfg.logger?.warn(
      "fieldd.plugin_registry.installed_refused",
      "An installed plugin does not hold what its install verified; refused",
      { pluginId: id, reason },
    );
    rows.set(id, {
      id,
      version: "0.0.0",
      title: id,
      source: "registry",
      // no manifest is believed: the hash of none
      manifestHash: sha256(""),
      installRevision: selected.pointer.slot,
      state: "invalid",
      compatible: true,
      enabled: false,
      requestedCapabilities: [],
      grantedCapabilities: [],
      deniedCapabilities: [],
      grantGeneration: this.grantGenerations.get(id) ?? 0,
      contributions: { objects: [], behaviors: [], commands: [], surfaces: [], capabilities: [] },
      renderer: "none",
      service: "none",
      lastError: summary("PLUGIN_ARTIFACT_MISMATCH", reason),
    });
  }

  /** A bundled plugin the index refused: present, honest, never loadable. */
  private refusedBundledRow(entry: BundledPluginEntry, reason: string): PluginRecord {
    return {
      id: entry.id,
      version: entry.version,
      title: entry.id,
      source: "bundled",
      manifestHash: entry.manifestHash,
      installRevision: entry.artifactSha256.slice("sha256:".length),
      state: "invalid",
      compatible: true,
      enabled: false,
      requestedCapabilities: [],
      grantedCapabilities: [],
      deniedCapabilities: [],
      grantGeneration: this.grantGenerations.get(entry.id) ?? 0,
      contributions: { objects: [], behaviors: [], commands: [], surfaces: [], capabilities: [] },
      renderer: "none",
      service: "none",
      lastError: summary("PLUGIN_ARTIFACT_MISMATCH", reason),
    };
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
    source: "bundled" | "dev-linked" | "registry",
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
        contributions: {
          objects: [],
          behaviors: [],
          commands: [],
          surfaces: [],
          capabilities: [],
        },
        renderer: "none",
        service: "none",
        lastError: summary("PLUGIN_INVALID", validation.issues[0] ?? "manifest is invalid"),
      };
    }

    const m: PluginManifestV1 = validation.manifest;
    collectContributes?.(m.id, m.contributes);
    const hash = manifestHashOf(m); // §9.2 canonicalize-then-hash, the emitter's own form
    const platforms = m.engines.platforms;
    const platformOk = platforms === undefined || platforms.includes(process.platform as "darwin");
    // engines.app is unchecked in P2 — fieldd does not know the app's version
    // (the shell will supply it when the P3 harness lands); contracts is ours.
    const contractsOk = contractsRangeSatisfied(CONTRACTS_VERSION, m.engines.contracts);
    // DK-2 (desk/landing): the desk draws objects, so a plugin that declares
    // object kinds is compatible like any other (DK-0f's `objects-need-desk`
    // clause is flipped off; the row lists its kinds as before).
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
        objects: m.contributes?.objects ?? [],
        // PRC-4d: renderer-safe, code-free canonical ICE descriptors. Object
        // riders and their declaration table must cross this boundary together.
        behaviors: m.contributes?.behaviors ?? [],
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
          !contractsOk
            ? `requires contracts ${m.engines.contracts}, this device has ${CONTRACTS_VERSION}`
            : `not built for platform ${process.platform}`,
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

  /** DAEMON-INTERNAL: exact plugin-local URL lifetime, never renderer policy.
   * Zero is the initial artifact; every applied dev reload advances it. */
  rendererServingRevision(id: string): number {
    return this.rendererServingRevisions.get(id) ?? 0;
  }

  /** DAEMON-INTERNAL: epoch paired atomically with the selected artifact.
   * Bundled and dev-linked roots begin at epoch 1. */
  commitEpoch(id: string): number | undefined {
    return this.commitEpochs.get(id);
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

  /** PRC-5c code-free candidate inspection. The explicit immutable root is
   * validated into a complete row/manifest without moving live registry state. */
  async inspectRegistryCandidate(input: {
    pluginId: string;
    root: string;
    artifactSha256: string;
    /** MK-2c (2026-11-11, G2): the signed entry's display copies, carried in memory from prepare. When given, the
     * candidate row shows these and not the slot file's, which a reused slot may have written before them (item
     * 322's family). Display only, as the file's are. */
    signed?: { rung?: RegistryRung; publisherName?: string };
  }): Promise<PluginRegistryCandidate> {
    const manifestPath = join(input.root, "vibefield.plugin.json");
    let raw: string;
    let parsed: unknown;
    try {
      const size = (await stat(manifestPath)).size;
      if (size > PLUGIN_LIMITS.MANIFEST_MAX_BYTES) throw new Error("manifest exceeds size cap");
      raw = await readFile(manifestPath, "utf8");
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `candidate manifest is unreadable (${error instanceof Error ? error.message : String(error)})`,
        false,
        { pluginKind: "PLUGIN_INVALID" },
      );
    }
    const validation = validatePluginManifest(parsed);
    if (!validation.ok) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `candidate manifest is invalid (${validation.issues[0] ?? "schema failure"})`,
        false,
        { pluginKind: "PLUGIN_INVALID" },
      );
    }
    if (validation.manifest.id !== input.pluginId) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `candidate manifest id ${validation.manifest.id} does not match ${input.pluginId}`,
        false,
        { pluginKind: "PLUGIN_ARTIFACT_MISMATCH" },
      );
    }

    let provenance: RegistryProvenance;
    try {
      provenance = RegistryProvenance.parse(
        JSON.parse(await readFile(join(input.root, ".vf-registry.json"), "utf8")),
      );
    } catch {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "candidate has no valid fieldd registry provenance",
        false,
        { pluginKind: "PLUGIN_ARTIFACT_MISMATCH" },
      );
    }
    if (provenance.artifactSha256 !== input.artifactSha256) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "candidate provenance does not match its immutable artifact handle",
        false,
        { pluginKind: "PLUGIN_ARTIFACT_MISMATCH" },
      );
    }

    const records = await this.loadRecords();
    const built = this.buildRow(parsed, raw, "registry", records);
    if (built === null || built.id !== input.pluginId) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "candidate could not produce its expected registry row",
        false,
        { pluginKind: "PLUGIN_INVALID" },
      );
    }
    if (built.state === "invalid" || built.state === "incompatible") {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `candidate refused (${built.lastError?.message ?? built.state})`,
        false,
        { pluginKind: built.state === "invalid" ? "PLUGIN_INVALID" : "PLUGIN_INCOMPATIBLE" },
      );
    }
    const record: PluginRecord = {
      ...built,
      registry:
        input.signed === undefined ? provenance : withSignedCopies(provenance, input.signed),
      installRevision: provenance.artifactSha256.slice("sha256:".length),
    };
    const old = this.rows.get(input.pluginId);
    if (old !== undefined) this.assertDurableSchemaProgress(old, record);
    return {
      record,
      manifest: validation.manifest,
      root: input.root,
      artifactSha256: input.artifactSha256,
    };
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
    // MK-O3 (O3-C): the person's wish is recorded as ever, and a held row stays held until the hold lifts
    const on = registered && enabled && !this.heldIds.has(id);
    const grants = this.effectiveGrantsFor(row, records);
    const next: PluginRecord = {
      ...row,
      enabled: on,
      // §15.2 through the same algorithm as buildRow — enable never resurrects
      // an ineligible or revoked capability
      grantedCapabilities: on ? grants.granted : [],
      deniedCapabilities: grants.denied,
      state: registered ? (on ? "enabled" : "disabled") : row.state,
      // MK-O3D (O3-C's rider): a held row says why only while the person wants it on, as `heldOff` does
      held: registered && enabled && this.heldIds.has(id) ? "community-off" : undefined,
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
    // MK-O3 (O3-C): a held row reads off whatever the person wants. With no record, its wish is the default (on),
    // never the hold's off, which would keep it off when the hold lifts
    const prior = records.plugins[id] ?? { enabled: this.heldIds.has(id) || row.enabled };
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
    this.assertDurableSchemaProgress(row, candidate);
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
    this.rendererServingRevisions.set(id, this.rendererServingRevision(id) + 1);
    this.rows.set(id, candidate);
    // The module bytes may have changed while the manifest did not. Force one
    // observation so PluginModuleAuthority can retire the old plugin-local URL
    // set; semantic snapshot equality is not serving-identity equality.
    this.publish(true);
    return this.snapshot().plugins.find((p) => p.id === id) ?? candidate;
  }

  /** §18.5 — durable schemas may only move forward, for both dev reload and
   * immutable registry candidates. DK-8: the law's rows are OBJECT rows — it held
   * WIDGET rows until `contributes.widgets` retired, and an object's type and
   * schemaVersion are the same durable promise (the host compiles both into one
   * process-permanent prefab). */
  private assertDurableSchemaProgress(old: PluginRecord, candidate: PluginRecord): void {
    const oldVersions = new Map(
      (old.contributions.objects ?? []).map((row) => [row.type, row.schemaVersion] as const),
    );
    for (const row of candidate.contributions.objects ?? []) {
      const prior = oldVersions.get(row.type);
      if (prior !== undefined && row.schemaVersion < prior) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          `object ${row.type} regresses schemaVersion ${prior} → ${row.schemaVersion} (§18.5); live version untouched`,
          false,
          { pluginKind: "PLUGIN_SCHEMA_VIOLATION" },
        );
      }
    }
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

  /** Generation bump + one coalesced `changed`. Normally semantic-move-only;
   * explicit reload forces an observation because code bytes are out-of-row. */
  private publish(force = false): void {
    const probe = JSON.stringify({
      plugins: this.snapshot().plugins,
      problems: this.snapshot().problems,
    });
    if (!force && probe === this.lastSnapshotJson) return;
    this.lastSnapshotJson = probe;
    this.generation += 1;
    this.emit("changed", this.snapshot());
  }

  /** Item 457: the records, loaded ONCE through their writer and shared by every first reader (two first loads at once
   * could each install their own copy, and a change made on the first would be lost). The newest copy the writer can
   * read wins: a torn one, or another version's, is kept aside and the last good copy read. Nothing readable, or no
   * file yet, is first boot: every known plugin defaults enabled. */
  private loadRecords(): Promise<InstallRecordsFile> {
    if (this.records !== null) return Promise.resolve(this.records);
    if (this.recordsLoad !== null) return this.recordsLoad;
    const load = this.recordsFile
      .load((bytes) => {
        this.records = parseRecords(bytes);
      })
      .then(() => {
        this.records ??= { version: 1, plugins: {} };
        return this.records;
      });
    this.recordsLoad = load;
    load.catch(() => {
      if (this.recordsLoad === load) this.recordsLoad = null; // a failed load is asked again, never kept
    });
    return load;
  }

  /** Item 457: the records written through their one writer. The promise settles when the write that carries this
   * change has landed (fsync'd); a write this call joined rejects every caller that joined it. */
  private saveRecords(records: InstallRecordsFile): Promise<void> {
    this.records = records;
    return this.recordsFile.persist();
  }
}

const RECORDS_TEXT = new TextEncoder();

/** Item 457: a records file's bytes as this version's records, or a THROW, which the writer's load reads as a copy it
 * cannot take: kept aside, and the last good copy tried. */
function parseRecords(bytes: Uint8Array): InstallRecordsFile {
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("install records: not an object");
  }
  const { version, plugins } = parsed as { version?: unknown; plugins?: unknown };
  if (version !== 1) throw new Error(`install records: version ${String(version)}, not 1`);
  if (plugins === null || typeof plugins !== "object" || Array.isArray(plugins)) {
    throw new Error("install records: no plugins map");
  }
  return { version: 1, plugins: { ...(plugins as InstallRecordsFile["plugins"]) } };
}
