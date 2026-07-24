import { EventEmitter } from "node:events";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { InstallSetEntry, SETTINGS_DOC_SECTIONS } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { LoroDoc, UndoManager } from "loro-crdt";

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
// Replication: this IS a Loro doc, so the sync machinery is the doc itself —
// it joins field.docs.v1 (system:true) and rides the doc-sync lanes when that
// track lands; today it persists locally like every other doc (recorded
// delta, thinking-p7).

export interface SettingsDocConfig {
  dataDir: string;
  logger?: Logger;
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
    this.docPath = join(cfg.dataDir, "fieldd", "settings", "doc.loro");
    this.legacyUserPath = join(cfg.dataDir, "fieldd", "plugins", "settings-user.json");
    this.undoMgr = new UndoManager(this.doc, {
      // law 2 — install-set/grant mutations and the one-time migration are
      // OUTSIDE the undo stack, by origin prefix
      excludeOriginPrefixes: ["no-undo:", "migrate:"],
    });
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

  // --- the install-set (§16.6 — OUTSIDE undo, law 2) -------------------------

  async installSet(): Promise<Record<string, InstallSetEntry>> {
    await this.ready();
    const raw = this.doc.getMap(SETTINGS_DOC_SECTIONS.INSTALL_SET).toJSON() as Record<
      string,
      unknown
    >;
    const out: Record<string, InstallSetEntry> = {};
    for (const [id, value] of Object.entries(raw)) {
      // tolerant reader: a malformed entry is skipped and logged, never fatal
      const parsed = InstallSetEntry.safeParse(value);
      if (parsed.success) out[id] = parsed.data;
      else
        this.log.warn(
          "fieldd.settings_doc.install_set_entry_invalid",
          "An install-set entry failed its schema and was skipped",
          { pluginId: id },
        );
    }
    return out;
  }

  async setInstallSetEntry(entry: InstallSetEntry, by: string): Promise<void> {
    await this.ready();
    this.doc
      .getMap(SETTINGS_DOC_SECTIONS.INSTALL_SET)
      .set(entry.pluginId, entry as unknown as never);
    this.doc.commit({ origin: `no-undo:install-set:${by}` });
    await this.persistNow();
    this.emit("changed", { section: "installSet" });
  }

  async removeInstallSetEntry(pluginId: string, by: string): Promise<void> {
    await this.ready();
    const map = this.doc.getMap(SETTINGS_DOC_SECTIONS.INSTALL_SET);
    if (map.get(pluginId) === undefined) return;
    map.delete(pluginId);
    this.doc.commit({ origin: `no-undo:install-set:${by}` });
    await this.persistNow();
    this.emit("changed", { section: "installSet" });
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
