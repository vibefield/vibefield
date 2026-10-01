import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { InstallSetEntry, LAYOUT, SETTINGS_DOC_SECTIONS } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { LoroDoc, UndoManager } from "loro-crdt";
import type { SystemDocOwner } from "./doc-service";

// SettingsDocService (D29′, P7): fieldd's FIRST live Loro doc — the system
// settings doc. One doc, three section families (contracts
// SETTINGS_DOC_SECTIONS): per-plugin user-scope settings, spine preferences,
// and the §16.6 install-set. Per-key LWW; op history retained in the snapshot;
// every commit stamps writer provenance into its origin.
//
// D29′ laws, mechanically enforced here:
//   1. only user-scope keys live in this doc (device/secret never enter);
//   2. UNDO NEVER RE-ESCALATES — install-set and grant writes commit under the
//      "no-undo:" origin prefix, which the UndoManager EXCLUDES (probe-proven:
//      undoing a settings write leaves an interleaved install-set write
//      untouched); undoing a revocation therefore requires the explicit grant
//      flow, never ⌘Z;
//   3. the horizon is honest — v1 undo reaches back to THIS daemon boot (the
//      UndoManager tracks ops since attach; the two-plane law's ceiling
//      applies: session-scoped affordances are daemon-lifetime). The doc's
//      HISTORY persists in full snapshots; deeper time travel arrives with
//      compaction epochs.
//
// Replication (DS-5, DS-D18): DocumentService.registerSystemDoc hands THIS
// LoroDoc to the Loro-level host under a well-known id derived from the
// account, and the host merges a peer desktop's settings into it (`hostOwner`:
// persist, then every section is announced as changed — the posture, the app
// preferences, and the install-set the reconciler applies). Undo stays this
// device's: the UndoManager tracks local ops only, so a merged peer edit is
// never undone by ⌘Z here (law 2 holds across devices too).
//
// DS-5b 2026-10-01: the bias is built; settings cross.
//
// THE INSTALL-SET (DS-5b, PA-32 — revocations propagate and win regardless of
// last-writer-wins timing). P7 kept an entry as ONE map value, so a desktop
// offline across a revocation could merge its whole entry back and the
// reconciler re-granted (the DS wave 1 review's B1). Now:
//   - one ROOT map per field (contracts SETTINGS_DOC_SECTIONS): the identity,
//     the enablement, one decision register per capability, and the
//     revocations. A desktop that flips enablement writes only `enabled`; a
//     grant decision is its own register. Root maps are named, so two desktops
//     creating one entry at once share every container — a nested map per
//     entry would be two containers and one side's fields would be lost (the
//     library's rule, `library-doc.ts`).
//   - the revocation GENERATION of a capability is the number of revocation
//     keys it has in `installSet.revocations`: one key per revocation ever made
//     (`[pluginId, capability, eventId]`), never deleted. A grow-only set, so
//     the merge is the union and a concurrent revoke is never lost; a grant
//     records the generation it saw, and a grant whose generation is below the
//     merged one missed a revocation and stands as revoked
//     (`standingDecision`, contracts). A revoke adds its key and writes the
//     revoked decision in ONE transaction.
//   - why not a counter: the plan offered a per-replica counter map or
//     `loro-crdt`'s LoroCounter. A LoroCounter per capability must live in a
//     map under the capability's key, and two desktops creating it at once
//     make two counters of which the merge keeps one — probed on 1.13.8: two
//     concurrent first revocations merged to 1, not 2, the exact race the
//     generation exists to win. A ROOT counter per capability is race-free
//     but grows the document's root namespace by one container per capability
//     and can only be listed by scanning root names. A per-replica map needs a
//     stable single writer per key and a read-modify-write; the set needs
//     neither, it is the same count (Σ over desktops of each one's
//     revocations), and each key says when it was made.
//   - P7's whole-entry section ("installSet") is migrated once, on load, into
//     the fields above — a revoked decision becomes a revocation, so an old
//     revocation still beats another desktop's old grant once both cross —
//     and emptied. The migration completes before the daemon registers the
//     document with the host, so no whole entry ever crosses.

export interface SettingsDocConfig {
  dataDir: string;
  logger?: Logger;
}

/** Which plugin, from where, which bytes — an entry exists while this does. */
export interface InstallIdentity {
  source: "registry" | "bundled";
  /** registry entries only */
  version?: string;
  artifactSha256?: string;
}

/** One change to one plugin's install-set entry, committed as ONE Loro
 * transaction. Each local act writes only what it decided (DS-5b): a
 * republished whole entry is how B1's stale grant came back. */
export interface InstallSetChange {
  /** write the identity (an install or an update) */
  identity?: InstallIdentity;
  /** write the desired enablement */
  enabled?: boolean;
  /** create the entry when it is absent: the identity and the enablement each
   * written only where none stands */
  ensure?: { identity: InstallIdentity; enabled: boolean };
  /** grant these now — each decision records the generation this doc holds */
  grant?: readonly string[];
  /** revoke these now — each adds one revocation (its generation grows) and
   * writes the revoked decision, in the same transaction */
  revoke?: readonly string[];
}

const S = SETTINGS_DOC_SECTIONS;
const ORIGIN_INSTALL_SET = "no-undo:install-set:";

/** `[pluginId, capability]` — a JSON tuple, so no id alphabet can collide. */
function grantKey(pluginId: string, capability: string): string {
  return JSON.stringify([pluginId, capability]);
}

function readKey(key: string, arity: number): string[] | null {
  try {
    const parsed: unknown = JSON.parse(key);
    return Array.isArray(parsed) &&
      parsed.length === arity &&
      parsed.every((part) => typeof part === "string")
      ? (parsed as string[])
      : null;
  } catch {
    return null;
  }
}

/** The identity register's value: only the identity's own fields, so a whole
 * entry handed in (the migration, the seeding verb) leaves its decisions out. */
function identityValue(identity: {
  source: InstallIdentity["source"];
  version?: string | undefined;
  artifactSha256?: string | undefined;
}): Record<string, string> {
  return {
    source: identity.source,
    ...(identity.version !== undefined ? { version: identity.version } : {}),
    ...(identity.artifactSha256 !== undefined ? { artifactSha256: identity.artifactSha256 } : {}),
  };
}

export class SettingsDocService extends EventEmitter {
  private readonly doc = new LoroDoc();
  private readonly undoMgr: UndoManager;
  private readonly log: Logger;
  private readonly docPath: string;
  private readonly legacyUserPath: string;
  private readyPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly cfg: SettingsDocConfig) {
    super();
    this.log = (cfg.logger ?? createNoopLogger()).child({ component: "plugin.settings.doc" });
    this.docPath = join(cfg.dataDir, ...LAYOUT.SETTINGS_DOC);
    this.legacyUserPath = join(cfg.dataDir, "fieldd", "plugins", "settings-user.json");
    this.undoMgr = new UndoManager(this.doc, {
      // law 2 — install-set/grant mutations and the one-time migrations are
      // OUTSIDE the undo stack, by origin prefix
      excludeOriginPrefixes: ["no-undo:", "migrate:"],
    });
  }

  /** DS-5 — the document the Loro-level host merges into. The daemon's
   * mountSystemDocs registers it only after `ready()`: the P7 migration must
   * finish before any merge, so no whole entry ever crosses. */
  hostDoc(): LoroDoc {
    return this.doc;
  }

  /** DS-5 — what the host needs after merging a peer's settings: persist (never
   * before this device's own file has loaded — a merge must not be written over
   * a doc that has not read its disk yet), then tell every section's listeners. */
  hostOwner(): SystemDocOwner {
    return {
      persist: async () => {
        await this.ready();
        await this.persistNow();
      },
      merged: () => {
        for (const section of ["app", "settings", "installSet"]) this.emit("changed", { section });
      },
    };
  }

  /** Lazy one-time load + legacy migration; every public method awaits it. */
  ready(): Promise<void> {
    this.readyPromise ??= this.init();
    return this.readyPromise;
  }

  private async init(): Promise<void> {
    try {
      const bytes = await readFile(this.docPath);
      this.doc.import(new Uint8Array(bytes));
    } catch {
      // first boot — an empty doc is the honest starting state
    }
    await this.migrateLegacyUserFile();
    await this.migrateLegacyInstallSet();
  }

  /** P5's settings-user.json folds in ONCE, then the file is renamed aside
   * (its presence is the migration flag — no marker key in the doc). */
  private async migrateLegacyUserFile(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.legacyUserPath, "utf8");
    } catch {
      return; // absent = migrated or never existed
    }
    try {
      const parsed = JSON.parse(raw) as { version?: number; plugins?: Record<string, unknown> };
      if (parsed?.version === 1 && parsed.plugins !== null && typeof parsed.plugins === "object") {
        for (const [pluginId, values] of Object.entries(parsed.plugins ?? {})) {
          if (values === null || typeof values !== "object") continue;
          const map = this.doc.getMap(`${SETTINGS_DOC_SECTIONS.PLUGIN_PREFIX}${pluginId}`);
          for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
            // LWW: an existing doc value (a newer truth) wins over the file
            if (map.get(key) === undefined) map.set(key, value as never);
          }
        }
        this.doc.commit({ origin: "migrate:settings-user.json" });
        await this.persistNow();
      }
    } catch (e) {
      this.log.warn(
        "fieldd.settings_doc.migration_unreadable",
        "settings-user.json could not be migrated; leaving it in place",
        { error: e instanceof Error ? e.message : String(e) },
      );
      return; // do NOT rename an unreadable file away — evidence stays
    }
    await rename(this.legacyUserPath, `${this.legacyUserPath}.migrated`).catch(() => undefined);
    this.log.info(
      "fieldd.settings_doc.migrated",
      "Legacy user settings migrated into the system settings doc",
    );
  }

  /** DS-5b — P7's whole entries move into the per-field sections, once. A
   * revoked decision becomes a REVOCATION (its generation grows), so it beats
   * another desktop's old grant when both documents cross; a granted one
   * records the generation it finds. Nothing that already stands is
   * overwritten: an identity, an enablement, a decision. Each migrated entry
   * is deleted from the old section; one that fails its schema stays where it
   * is, logged (the tolerant reader's rule — evidence stays). */
  private async migrateLegacyInstallSet(): Promise<void> {
    const legacy = this.doc.getMap(S.INSTALL_SET);
    const ids = legacy.keys();
    if (ids.length === 0) return;
    const at = Date.now();
    let migrated = 0;
    for (const pluginId of ids) {
      const parsed = InstallSetEntry.safeParse(legacy.get(pluginId));
      if (!parsed.success) {
        this.log.warn(
          "fieldd.settings_doc.install_set_entry_invalid",
          "A P7 install-set entry failed its schema and was left unmigrated",
          { pluginId },
        );
        continue;
      }
      const entry = parsed.data;
      const plugins = this.doc.getMap(S.INSTALL_SET_PLUGINS);
      const enabled = this.doc.getMap(S.INSTALL_SET_ENABLED);
      const grants = this.doc.getMap(S.INSTALL_SET_GRANTS);
      if (plugins.get(pluginId) === undefined) {
        plugins.set(pluginId, identityValue(entry) as never);
      }
      if (enabled.get(pluginId) === undefined) enabled.set(pluginId, entry.enabled);
      for (const decision of entry.grants) {
        const standing = grants.get(grantKey(pluginId, decision.capability)) as
          | { decision?: unknown }
          | undefined;
        if (decision.decision === "revoked") {
          if (standing?.decision === "revoked") continue;
          this.recordRevocation(pluginId, decision.capability, decision.at);
        } else if (standing === undefined) {
          grants.set(grantKey(pluginId, decision.capability), {
            decision: "granted",
            at: decision.at,
            revocationGeneration: this.generationOf(pluginId, decision.capability),
          } as never);
        }
      }
      legacy.delete(pluginId);
      migrated += 1;
    }
    if (migrated === 0) return;
    this.doc.commit({ origin: "migrate:install-set" });
    await this.persistNow();
    this.log.info(
      "fieldd.settings_doc.install_set_migrated",
      "P7 install-set entries moved into the per-field layout",
      { migrated, at },
    );
  }

  // --- user-scope plugin settings (law 1: the ONLY settings class here) ------

  async userValues(pluginId: string): Promise<Record<string, unknown>> {
    await this.ready();
    return this.doc.getMap(`${SETTINGS_DOC_SECTIONS.PLUGIN_PREFIX}${pluginId}`).toJSON() as Record<
      string,
      unknown
    >;
  }

  /** `by` is the provenance stamp (§15.5 applied to knobs): "plugin:<id>",
   * "pane", or a principal label — it rides the commit origin. */
  async setUserValue(pluginId: string, key: string, value: unknown, by: string): Promise<void> {
    await this.ready();
    this.doc.getMap(`${SETTINGS_DOC_SECTIONS.PLUGIN_PREFIX}${pluginId}`).set(key, value as never);
    this.doc.commit({ origin: `settings:${by}` });
    await this.persistNow();
    this.emit("changed", { section: "settings", pluginId });
  }

  async resetUserValue(pluginId: string, key: string, by: string): Promise<void> {
    await this.ready();
    const map = this.doc.getMap(`${SETTINGS_DOC_SECTIONS.PLUGIN_PREFIX}${pluginId}`);
    if (map.get(key) === undefined) return;
    map.delete(key);
    this.doc.commit({ origin: `settings:${by}` });
    await this.persistNow();
    this.emit("changed", { section: "settings", pluginId });
  }

  // --- spine preferences (D29′ extension a — same discipline, app section) ---

  async appValues(): Promise<Record<string, unknown>> {
    await this.ready();
    return this.doc.getMap(SETTINGS_DOC_SECTIONS.APP).toJSON() as Record<string, unknown>;
  }

  async setAppValue(key: string, value: unknown, by: string): Promise<void> {
    await this.ready();
    this.doc.getMap(SETTINGS_DOC_SECTIONS.APP).set(key, value as never);
    this.doc.commit({ origin: `settings:${by}` });
    await this.persistNow();
    this.emit("changed", { section: "app" });
  }

  // --- the install-set (§16.6 — OUTSIDE undo, law 2; DS-5b per-field) -------

  /** The merged install-set, one entry per plugin whose identity stands. Each
   * entry carries its decisions as written and, per capability, the merged
   * revocation generation; which decision STANDS is `standingDecision`'s call
   * (the reconciler's, and any reader's). Tolerant: an entry that fails its
   * schema is skipped and logged, never fatal. */
  async installSet(): Promise<Record<string, InstallSetEntry>> {
    await this.ready();
    const identities = this.doc.getMap(S.INSTALL_SET_PLUGINS).toJSON() as Record<string, unknown>;
    const enabled = this.doc.getMap(S.INSTALL_SET_ENABLED).toJSON() as Record<string, unknown>;
    const generations = new Map<string, Record<string, number>>();
    for (const key of this.doc.getMap(S.INSTALL_SET_REVOCATIONS).keys()) {
      const parts = readKey(key, 3);
      if (parts === null) continue;
      const [pluginId, capability] = parts as [string, string, string];
      const of = generations.get(pluginId) ?? {};
      of[capability] = (of[capability] ?? 0) + 1;
      generations.set(pluginId, of);
    }
    const decisions = new Map<string, unknown[]>();
    const grants = this.doc.getMap(S.INSTALL_SET_GRANTS);
    for (const key of grants.keys()) {
      const parts = readKey(key, 2);
      const value: unknown = grants.get(key);
      if (parts === null || value === null || typeof value !== "object") continue;
      const [pluginId, capability] = parts as [string, string];
      decisions.set(pluginId, [...(decisions.get(pluginId) ?? []), { ...value, capability }]);
    }
    const out: Record<string, InstallSetEntry> = {};
    for (const [pluginId, identity] of Object.entries(identities)) {
      const of = generations.get(pluginId);
      const parsed = InstallSetEntry.safeParse({
        ...(identity !== null && typeof identity === "object" ? identity : {}),
        pluginId,
        // An identity with no enablement beside it is reachable only through a
        // concurrent uninstall and reinstall; the reinstall's intent is to run.
        enabled: typeof enabled[pluginId] === "boolean" ? enabled[pluginId] : true,
        grants: decisions.get(pluginId) ?? [],
        ...(of !== undefined ? { revocationGenerations: of } : {}),
      });
      if (parsed.success) out[pluginId] = parsed.data;
      else
        this.log.warn(
          "fieldd.settings_doc.install_set_entry_invalid",
          "An install-set entry failed its schema and was skipped",
          { pluginId },
        );
    }
    return out;
  }

  /** DS-5b — one plugin's change, ONE transaction (the reconciler's publish).
   * Returns the generation each touched capability's decision records. */
  async updateInstallSet(
    pluginId: string,
    change: InstallSetChange,
    by: string,
  ): Promise<{ revocationGenerations: Record<string, number> }> {
    await this.ready();
    const plugins = this.doc.getMap(S.INSTALL_SET_PLUGINS);
    const enabled = this.doc.getMap(S.INSTALL_SET_ENABLED);
    const grants = this.doc.getMap(S.INSTALL_SET_GRANTS);
    const at = Date.now();
    let wrote = false;
    // Field order is fixed (identity, enablement, decisions) in every writer,
    // so two concurrent transactions compare their registers in one order.
    const identity =
      change.identity ??
      (change.ensure !== undefined && plugins.get(pluginId) === undefined
        ? change.ensure.identity
        : undefined);
    if (identity !== undefined) {
      plugins.set(pluginId, identityValue(identity) as never);
      wrote = true;
    }
    const desired =
      change.enabled ??
      (change.ensure !== undefined && enabled.get(pluginId) === undefined
        ? change.ensure.enabled
        : undefined);
    if (desired !== undefined) {
      enabled.set(pluginId, desired);
      wrote = true;
    }
    const generations: Record<string, number> = {};
    const revoke = new Set(change.revoke ?? []);
    for (const capability of revoke) {
      generations[capability] = this.recordRevocation(pluginId, capability, at);
      wrote = true;
    }
    for (const capability of change.grant ?? []) {
      if (revoke.has(capability)) continue; // one decision per capability per act
      const generation = this.generationOf(pluginId, capability);
      grants.set(grantKey(pluginId, capability), {
        decision: "granted",
        at,
        revocationGeneration: generation,
      } as never);
      generations[capability] = generation;
      wrote = true;
    }
    if (wrote) {
      this.doc.commit({ origin: `${ORIGIN_INSTALL_SET}${by}` });
      await this.persistNow();
      this.emit("changed", { section: "installSet" });
    }
    return { revocationGenerations: generations };
  }

  /** Adopt a whole entry as decided NOW: its identity, its enablement and
   * every decision it states (a revoked one is a new revocation; a granted one
   * keeps the generation it names, else records the current one), in ONE
   * transaction. The seeding verb (tests, imports) — the reconciler never
   * republishes state through it (B1). */
  async setInstallSetEntry(entry: InstallSetEntry, by: string): Promise<void> {
    await this.ready();
    const grants = this.doc.getMap(S.INSTALL_SET_GRANTS);
    this.doc.getMap(S.INSTALL_SET_PLUGINS).set(entry.pluginId, identityValue(entry) as never);
    this.doc.getMap(S.INSTALL_SET_ENABLED).set(entry.pluginId, entry.enabled);
    for (const decision of entry.grants) {
      if (decision.decision === "revoked") {
        this.recordRevocation(entry.pluginId, decision.capability, decision.at);
      } else {
        grants.set(grantKey(entry.pluginId, decision.capability), {
          decision: "granted",
          at: decision.at,
          revocationGeneration:
            decision.revocationGeneration ?? this.generationOf(entry.pluginId, decision.capability),
        } as never);
      }
    }
    this.doc.commit({ origin: `${ORIGIN_INSTALL_SET}${by}` });
    await this.persistNow();
    this.emit("changed", { section: "installSet" });
  }

  /** Uninstall everywhere: the identity, the enablement and the decisions go;
   * the REVOCATIONS stay — a generation never shrinks, or a grant some desktop
   * made before a revocation would come back to life. */
  async removeInstallSetEntry(pluginId: string, by: string): Promise<void> {
    await this.ready();
    const plugins = this.doc.getMap(S.INSTALL_SET_PLUGINS);
    const enabled = this.doc.getMap(S.INSTALL_SET_ENABLED);
    const grants = this.doc.getMap(S.INSTALL_SET_GRANTS);
    const decided = grants.keys().filter((key) => readKey(key, 2)?.[0] === pluginId);
    if (
      plugins.get(pluginId) === undefined &&
      enabled.get(pluginId) === undefined &&
      decided.length === 0
    )
      return;
    if (plugins.get(pluginId) !== undefined) plugins.delete(pluginId);
    if (enabled.get(pluginId) !== undefined) enabled.delete(pluginId);
    for (const key of decided) grants.delete(key);
    this.doc.commit({ origin: `${ORIGIN_INSTALL_SET}${by}` });
    await this.persistNow();
    this.emit("changed", { section: "installSet" });
  }

  /** How many revocations of this capability the document holds. */
  private generationOf(pluginId: string, capability: string): number {
    let generation = 0;
    for (const key of this.doc.getMap(S.INSTALL_SET_REVOCATIONS).keys()) {
      const parts = readKey(key, 3);
      if (parts?.[0] === pluginId && parts[1] === capability) generation += 1;
    }
    return generation;
  }

  /** A revocation: one new key in the grow-only set, and the revoked decision
   * naming the generation it made — in the caller's open transaction. */
  private recordRevocation(pluginId: string, capability: string, at: number): number {
    this.doc
      .getMap(S.INSTALL_SET_REVOCATIONS)
      .set(JSON.stringify([pluginId, capability, randomUUID()]), { at } as never);
    const generation = this.generationOf(pluginId, capability);
    this.doc.getMap(S.INSTALL_SET_GRANTS).set(grantKey(pluginId, capability), {
      decision: "revoked",
      at,
      revocationGeneration: generation,
    } as never);
    return generation;
  }

  // --- D29′ undo surface -----------------------------------------------------

  async undo(): Promise<{ applied: boolean; reason?: "empty-stack" }> {
    await this.ready();
    if (!this.undoMgr.canUndo()) return { applied: false, reason: "empty-stack" };
    this.undoMgr.undo();
    await this.persistNow();
    this.emit("changed", { section: "settings" });
    return { applied: true };
  }

  async redo(): Promise<{ applied: boolean; reason?: "empty-stack" }> {
    await this.ready();
    if (!this.undoMgr.canRedo()) return { applied: false, reason: "empty-stack" };
    this.undoMgr.redo();
    await this.persistNow();
    this.emit("changed", { section: "settings" });
    return { applied: true };
  }

  // --- persistence (full-history snapshot; EAGER tmp+rename — settings write
  // at user-action rate, so durability beats a debounce: a write that
  // returned is a write that survives a crash) -------------------------------

  private async persistNow(): Promise<void> {
    if (this.disposed) return;
    const bytes = this.doc.export({ mode: "snapshot" });
    await mkdir(dirname(this.docPath), { recursive: true });
    const tmp = `${this.docPath}.tmp`;
    await writeFile(tmp, Buffer.from(bytes));
    await rename(tmp, this.docPath);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.removeAllListeners();
  }
}
