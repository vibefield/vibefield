import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  APP_PREFERENCES_NEVER_UNDONE,
  DEVICE_LIMITS,
  InstallSetEntry,
  KnownPhone,
  LAYOUT,
  type PhoneEvidence,
  RefusedDevice,
  SETTINGS_DOC_SECTIONS,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { LoroDoc, UndoManager } from "loro-crdt";
import type { SystemDocOwner } from "./doc-service";
import { SystemDocFile } from "./system-doc-file";

// SettingsDocService (D29′, P7): fieldd's FIRST live Loro doc — the system
// settings doc. One doc, three section families (contracts
// SETTINGS_DOC_SECTIONS): per-plugin user-scope settings, spine preferences,
// and the §16.6 install-set. Per-key LWW; op history retained in the snapshot;
// every commit stamps writer provenance into its origin.
//   *Correction 2026-11-11 (item 323):* the origin is not kept. loro-crdt says
//   of `commit`, "The `origin` will not be persisted, but the `message` will"
//   (1.13.8), and this file sets no message. The stamp lives in memory only,
//   where the undo filter and local events read it; nothing in the snapshot,
//   the doc file or a peer's merge says which principal wrote a key.
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
//   - MK-2d (2026-11-11; E10's R1, R2; VF-PM 10:34:14Z): a removal travels. Uninstall adds one key to the
//     grow-only `installSet.removals` (`[pluginId, eventId] → {at}`, never deleted) in the transaction that deletes
//     the entry, so "removed" is told apart from "never published". Every identity write stamps `removalGeneration`,
//     the count of removal keys for that plugin the writer's doc holds, and an entry stands only while its stamp is
//     not below the merged count (clock-free, as a grant's revocation generation is). So:
//       - a removal and a concurrent explicit install (which did not see it: stamp 0, count 1) read as removed;
//       - two concurrent removals and a reinstall that saw one of them (stamp 1, count 2) read as removed;
//       - an identity with no stamp (an older build's) reads as generation 0.
//     An `ensure` keeps an entry and never makes one for a removed plugin (R2); an explicit install does, stamped.
//     The removal key carries `{at}` alone: what a removal reaches on another desktop is the plugin's code, never its
//     data (`install-reconciler.ts`, R3).
//
// THE ACCOUNT'S PHONES (item 406, track WI; VF-PM's rulings of 2026-11-14
// 04:49Z, Q-PM1 and Q-PM2). Two more sections, both OUTSIDE the undo stack
// (law 2: no ⌘Z lifts a refusal, none brings a removed phone back), both the
// account's (law 1), and neither ever a phone's to read: document sync admits
// only desktops.
//   - `devices.refused`: the phones Remove refused, the install-set's
//     revocations' shape — one key per refusal ever made (`[deviceId,
//     eventId]`), never deleted, so the merge is the union and a concurrent
//     Remove is never lost. A phone is refused when its durable id or any of
//     its node ids is in the union. ONE writer (`refuseDevice`), with exactly
//     two callers by the ruling, which a source-reading test pins: the
//     `device.remove` handler, and the roster's registry pass carrying a node
//     id it saw under a durable id ALREADY refused (the phone registered again).
//   - `devices.phones`: the known phones, by durable id — their node ids, the
//     positive phone fact, and the name a row needs (`rememberPhone`). Remove
//     deletes the entry in the refusal's own transaction. A deleted entry leaves
//     the document's STATE only: its name stays in the operation history the
//     snapshots keep (law 3), so nothing may promise that Remove erases it.

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

/** Item 406 (Q-PM1) — the union of every entry of `devices.refused`: a phone is
 * refused when its durable id or any of its node ids is here. */
export interface DeviceRefusals {
  /** the refused durable ids (the roster's ULIDs, D30): every entry's key names one */
  deviceIds: ReadonlySet<string>;
  /** every node id an entry carries: what a door sees (the sidecar's node id header) */
  nodeIds: ReadonlySet<string>;
}

/** Item 406 — why the refusals' ONE writer (`refuseDevice`) writes, one word per
 * caller VF-PM's ruling admits:
 *  - `"remove"`: the `device.remove` handler (S3) refuses a phone not refused yet;
 *  - `"append"`: DeviceService's registry pass carries a node id it saw under a
 *    durable id ALREADY refused (the phone registered again). */
export type RefusalAct = "remove" | "append";

const S = SETTINGS_DOC_SECTIONS;
const ORIGIN_INSTALL_SET = "no-undo:install-set:";
/** MK-2a (S1): an app preference that must never be undone (`APP_PREFERENCES_NEVER_UNDONE`). */
const ORIGIN_APP_NEVER_UNDONE = "no-undo:app:";
/** Item 406 — both device sections commit under it: outside the undo stack (law 2). */
const ORIGIN_DEVICES = "no-undo:devices:";
/** Item 406 (Q-PM2) — how old a known phone's fact may grow before a hello
 * writes it again. A phone hellos at every connect, and the document keeps every
 * write in its history, so the record moves only when its node id or its name
 * does, or once a day. */
const KNOWN_PHONE_REFRESH_MS = 24 * 60 * 60 * 1000;
/** Every section a peer's merge may have moved (`hostOwner().merged`). */
const MERGED_SECTIONS = ["app", "settings", "installSet", S.DEVICES_REFUSED, S.DEVICES_PHONES];

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
 * entry handed in (the migration, the seeding verb) leaves its decisions out.
 * MK-2d: stamped with the removal generation the writer saw. */
function identityValue(
  identity: {
    source: InstallIdentity["source"];
    version?: string | undefined;
    artifactSha256?: string | undefined;
  },
  removalGeneration: number,
): Record<string, string | number> {
  return {
    source: identity.source,
    ...(identity.version !== undefined ? { version: identity.version } : {}),
    ...(identity.artifactSha256 !== undefined ? { artifactSha256: identity.artifactSha256 } : {}),
    removalGeneration,
  };
}

/** MK-2d: an identity's removal stamp; none (an older build's) is 0. */
function stampOf(identity: unknown): number {
  const stamp =
    identity !== null && typeof identity === "object"
      ? (identity as { removalGeneration?: unknown }).removalGeneration
      : undefined;
  return typeof stamp === "number" && Number.isSafeInteger(stamp) && stamp >= 0 ? stamp : 0;
}

export class SettingsDocService extends EventEmitter {
  private readonly doc = new LoroDoc();
  private readonly undoMgr: UndoManager;
  private readonly log: Logger;
  private readonly docPath: string;
  /** DS-5c (DS wave 2 landing) — one writer, fsync'd, the last good copy kept:
   * the host's merge persist and a local write's persist never interleave, and
   * a torn file is no longer first boot (system-doc-file.ts, the library's). */
  private readonly file: SystemDocFile;
  private readonly legacyUserPath: string;
  private readyPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly cfg: SettingsDocConfig) {
    super();
    this.log = (cfg.logger ?? createNoopLogger()).child({ component: "plugin.settings.doc" });
    this.docPath = join(cfg.dataDir, ...LAYOUT.SETTINGS_DOC);
    this.file = new SystemDocFile({
      path: this.docPath,
      snapshot: () => this.doc.export({ mode: "snapshot" }),
      logger: this.log,
    });
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
   * a doc that has not read its disk yet), then tell every section's listeners.
   * Item 406 — the device sections too: a refusal another desktop wrote reaches
   * this desktop's roster only through this announcement. */
  hostOwner(): SystemDocOwner {
    return {
      persist: async () => {
        await this.ready();
        await this.persistNow();
      },
      merged: () => {
        for (const section of MERGED_SECTIONS) this.emit("changed", { section });
      },
    };
  }

  /** Lazy one-time load + legacy migration; every public method awaits it. */
  ready(): Promise<void> {
    this.readyPromise ??= this.init();
    return this.readyPromise;
  }

  private async init(): Promise<void> {
    // "none" is first boot — an empty doc is the honest starting state. DS-5c: a
    // torn file is no longer one (the last good copy loads; the torn file is
    // kept aside as evidence) — every revocation stamp DS-5b counts survives.
    await this.file.load((bytes) => {
      this.doc.import(bytes);
    });
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
        plugins.set(pluginId, identityValue(entry, this.removalGenerationOf(pluginId)) as never);
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

  /** MK-2a (S1; MK-E3): a key in `APP_PREFERENCES_NEVER_UNDONE` commits under the
   * "no-undo:" prefix the UndoManager excludes (law 2), so ⌘Z never turns
   * community plugins on. Each call commits its one write at once, so that
   * commit carries this key alone. */
  async setAppValue(key: string, value: unknown, by: string): Promise<void> {
    await this.ready();
    this.doc.getMap(SETTINGS_DOC_SECTIONS.APP).set(key, value as never);
    const neverUndone = (APP_PREFERENCES_NEVER_UNDONE as readonly string[]).includes(key);
    const origin = neverUndone ? `${ORIGIN_APP_NEVER_UNDONE}${by}` : `settings:${by}`;
    this.doc.commit({ origin });
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
    const removals = this.removalCounts();
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
      // MK-2d: an identity below the merged removal count was removed, whatever the merge kept of it
      if ((removals.get(pluginId) ?? 0) > stampOf(identity)) continue;
      const of = generations.get(pluginId);
      const { removalGeneration: _stamp, ...fields } =
        identity !== null && typeof identity === "object"
          ? (identity as Record<string, unknown>)
          : {};
      const parsed = InstallSetEntry.safeParse({
        ...fields,
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
    // MK-2d (R2): an ensure keeps an entry and never makes one for a removed plugin; an explicit install does,
    // stamped with the removal generation this doc holds
    const removalGeneration = this.removalGenerationOf(pluginId);
    const identity =
      change.identity ??
      (change.ensure !== undefined && plugins.get(pluginId) === undefined && removalGeneration === 0
        ? change.ensure.identity
        : undefined);
    if (identity !== undefined) {
      plugins.set(pluginId, identityValue(identity, removalGeneration) as never);
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
    this.doc
      .getMap(S.INSTALL_SET_PLUGINS)
      .set(entry.pluginId, identityValue(entry, this.removalGenerationOf(entry.pluginId)) as never);
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
   * made before a revocation would come back to life. MK-2d (R1): one removal
   * key joins the grow-only set in the same transaction, carrying `{at}` alone
   * (never whether data goes: that stays the act's own desktop's). */
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
    this.doc
      .getMap(S.INSTALL_SET_REMOVALS)
      .set(JSON.stringify([pluginId, randomUUID()]), { at: Date.now() } as never);
    this.doc.commit({ origin: `${ORIGIN_INSTALL_SET}${by}` });
    await this.persistNow();
    this.emit("changed", { section: "installSet" });
  }

  /** MK-2d (R3's read): the plugins this doc reads as removed — at least one removal key, and no identity
   * whose stamp has seen them all. The reconciler removes their code on its own desktop, data kept. */
  async removedPlugins(): Promise<Set<string>> {
    await this.ready();
    const identities = this.doc.getMap(S.INSTALL_SET_PLUGINS);
    const removed = new Set<string>();
    for (const [pluginId, count] of this.removalCounts()) {
      const identity: unknown = identities.get(pluginId);
      if (identity === undefined || count > stampOf(identity)) removed.add(pluginId);
    }
    return removed;
  }

  /** How many removal keys each plugin has. */
  private removalCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const key of this.doc.getMap(S.INSTALL_SET_REMOVALS).keys()) {
      const pluginId = readKey(key, 2)?.[0];
      if (pluginId !== undefined) counts.set(pluginId, (counts.get(pluginId) ?? 0) + 1);
    }
    return counts;
  }

  /** How many removal keys this plugin has: the generation an identity written now is stamped with. */
  private removalGenerationOf(pluginId: string): number {
    return this.removalCounts().get(pluginId) ?? 0;
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

  // --- item 406: the account's phones (OUTSIDE undo, law 2) -------------------

  /** Item 406 (Q-PM1) — the union of every refusal. Tolerant: an entry whose key
   * is not `[deviceId, eventId]` is skipped; one whose value fails its schema
   * still refuses its durable id and loses only its node ids — a refusal is never
   * dropped for a value this build cannot read. */
  async refusals(): Promise<DeviceRefusals> {
    await this.ready();
    const { deviceIds, nodeIds } = this.readRefusals();
    return { deviceIds, nodeIds };
  }

  /** Item 406 (S3) — the refusals by durable id: each refused device, with every
   * node id its entries carry (none for an entry this build cannot read; the
   * durable id still refuses). The sweep's reading (`DeviceRemoval`): what each
   * desktop closes, and for whom it audits it. */
  async refusedDevices(): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
    await this.ready();
    return this.readRefusals().byDevice;
  }

  /** Item 406 (Q-PM1) — THE ONE WRITER of the refusals, and VF-PM's ruling gives
   * it exactly two callers (`RefusalAct`; settings-doc.test.ts pins them off the
   * source). Grow-only: it adds entries and never deletes one, and no method
   * lifts a refusal.
   *  - `"remove"` refuses a durable id not refused yet, with the node ids its
   *    caller knows (none is lawful: the durable id alone refuses the row), and
   *    deletes the phone's known-phone entry in the same transaction. A durable
   *    id already refused writes nothing (`DeviceRemoveResult.removed` false).
   *  - `"append"` writes ONLY under a durable id already refused, and only the
   *    node ids the refusals do not hold yet, so it can never refuse a durable
   *    id Remove did not, whatever node id it carries.
   * `by` is the writing desktop's roster id (`RefusedDevice.by`). Every entry is
   * checked before any is written, so a refused input throws having written
   * nothing; one write commits under the `no-undo:` origin.
   * DURABLE FIRST (the review's folds, (7)): a commit is announced to the
   * account's other desktops as it lands (`registerSystemDoc`'s local updates),
   * and a refusal is never lifted, so a refusal committed and then not saved could
   * be neither kept nor taken back. The file first takes a copy of the document
   * with the refusal in it, through its one writer; only then does the document
   * commit it. A copy the disk refuses throws having committed nothing. */
  async refuseDevice(
    act: RefusalAct,
    deviceId: string,
    tailscaleIds: readonly string[],
    by: string,
  ): Promise<{ wrote: boolean }> {
    await this.ready();
    if (deviceId.length === 0 || deviceId.length > DEVICE_LIMITS.DEVICE_ID_CHARS)
      throw new RangeError("a refusal names one device by its durable id");
    const standing = this.readRefusals();
    const refused = standing.deviceIds.has(deviceId);
    if (act === "remove" ? refused : !refused) return { wrote: false };
    const fresh = [...new Set(tailscaleIds)].filter((nodeId) => !standing.nodeIds.has(nodeId));
    if (act === "append" && fresh.length === 0) return { wrote: false };
    const removedAt = Date.now();
    // one entry per NODE_IDS_PER_ENTRY node ids, and one with none when Remove knew none; each
    // keyed once, so the copy on disk and the document hold the same keys
    const entries: Array<[string, RefusedDevice]> = [];
    for (let at = 0; at === 0 || at < fresh.length; at += DEVICE_LIMITS.NODE_IDS_PER_ENTRY) {
      const nodeIds = fresh.slice(at, at + DEVICE_LIMITS.NODE_IDS_PER_ENTRY);
      const entry = RefusedDevice.parse({ tailscaleIds: nodeIds, removedAt, by });
      entries.push([JSON.stringify([deviceId, randomUUID()]), entry]);
    }
    const origin = `${ORIGIN_DEVICES}${act}:${by}`;
    /** The refusal as one transaction of `doc`; true when it forgot a known phone. */
    const refuse = (doc: LoroDoc): boolean => {
      const section = doc.getMap(S.DEVICES_REFUSED);
      for (const [key, entry] of entries) section.set(key, entry as never);
      const phones = doc.getMap(S.DEVICES_PHONES);
      const known = act === "remove" && phones.get(deviceId) !== undefined;
      if (known) phones.delete(deviceId);
      doc.commit({ origin });
      return known;
    };
    // 1. the disk takes a copy holding the refusal, made when the write runs (so it holds every
    //    commit before it), or this throws having committed nothing
    await this.file.persistWith(() => {
      const copy = new LoroDoc();
      copy.import(this.doc.export({ mode: "snapshot" }));
      refuse(copy);
      return copy.export({ mode: "snapshot" });
    });
    // 2. the document commits it (and announces it), and is written as itself. The copy on disk
    //    already holds the refusal, so a write that fails here loses nothing of it.
    const forgot = refuse(this.doc);
    try {
      await this.persistNow();
    } catch (error) {
      this.log.warn(
        "fieldd.settings_doc.refusal_copy_stands",
        "The settings document was not written after a refusal; the copy on disk holds it",
        { error: String(error) },
      );
    }
    this.emit("changed", { section: S.DEVICES_REFUSED });
    if (forgot) this.emit("changed", { section: S.DEVICES_PHONES });
    return { wrote: true };
  }

  /** The review's folds (5) — a device a desktop of the account has seen as a
   * desktop (its slice said `docHost`) is no phone: its known-phone record goes,
   * one a forwarded approval or a hello wrote before its slice said so. Writes only
   * while a record stands, under the `no-undo:` origin. A later record for it is
   * refused by its caller (`seenAsDesktop`), never here: this document does not
   * know which devices are desktops. */
  async forgetPhone(deviceId: string, by: string): Promise<{ wrote: boolean }> {
    await this.ready();
    const phones = this.doc.getMap(S.DEVICES_PHONES);
    if (phones.get(deviceId) === undefined) return { wrote: false };
    phones.delete(deviceId);
    this.doc.commit({ origin: `${ORIGIN_DEVICES}desktop:${by}` });
    await this.persistNow();
    this.emit("changed", { section: S.DEVICES_PHONES });
    return { wrote: true };
  }

  /** Item 406 (Q-PM2) — the account's known phones, by durable id. Tolerant: an
   * entry that fails its schema is skipped, so no row is called a phone on a
   * record nobody can read. */
  async knownPhones(): Promise<Map<string, KnownPhone>> {
    await this.ready();
    const phones = this.doc.getMap(S.DEVICES_PHONES);
    const out = new Map<string, KnownPhone>();
    for (const deviceId of phones.keys()) {
      const parsed = KnownPhone.safeParse(phones.get(deviceId));
      if (parsed.success) out.set(deviceId, parsed.data);
    }
    return out;
  }

  /** Item 406 (Q-PM2) — a node spoke to a desktop of this account as a phone
   * (`via`): remember it under its durable id, with its node id and its name (the
   * one thing the row of a phone offline across a restart needs; nothing else
   * about the phone is kept). Never a refused phone, by its durable id or by
   * this node: a refusal is never lifted, and a record would offer Remove again.
   * Writes only when the record moves (a new phone, a new node id, a new name,
   * or a fact older than KNOWN_PHONE_REFRESH_MS), keeping the newest
   * NODE_IDS_PER_ENTRY node ids, under the `no-undo:` origin. */
  async rememberPhone(
    deviceId: string,
    seen: { tailscaleId: string; via: PhoneEvidence; name?: string | undefined },
    by: string,
  ): Promise<{ wrote: boolean }> {
    await this.ready();
    if (deviceId.length === 0 || deviceId.length > DEVICE_LIMITS.DEVICE_ID_CHARS)
      throw new RangeError("a known phone is named by its durable id");
    const refusals = this.readRefusals();
    if (refusals.deviceIds.has(deviceId) || refusals.nodeIds.has(seen.tailscaleId))
      return { wrote: false };
    const phones = this.doc.getMap(S.DEVICES_PHONES);
    const prior = KnownPhone.safeParse(phones.get(deviceId));
    const was = prior.success ? prior.data : undefined;
    const said = seen.name?.slice(0, DEVICE_LIMITS.NAME_CHARS);
    const name = said !== undefined && said.length > 0 ? said : was?.name;
    const at = Date.now();
    if (
      was?.tailscaleIds.includes(seen.tailscaleId) &&
      was.name === name &&
      at - was.phone.at < KNOWN_PHONE_REFRESH_MS
    )
      return { wrote: false };
    const tailscaleIds = [
      ...(was?.tailscaleIds ?? []).filter((nodeId) => nodeId !== seen.tailscaleId),
      seen.tailscaleId,
    ].slice(-DEVICE_LIMITS.NODE_IDS_PER_ENTRY);
    const entry = KnownPhone.parse({
      tailscaleIds,
      phone: { via: seen.via, at },
      ...(name !== undefined ? { name } : {}),
    });
    phones.set(deviceId, entry as never);
    this.doc.commit({ origin: `${ORIGIN_DEVICES}phone:${by}` });
    await this.persistNow();
    this.emit("changed", { section: S.DEVICES_PHONES });
    return { wrote: true };
  }

  /** The refusals' union, and the same by durable id, read in one pass over the
   * section (`refusals`, `refusedDevices`). */
  private readRefusals(): DeviceRefusals & { byDevice: Map<string, Set<string>> } {
    const deviceIds = new Set<string>();
    const nodeIds = new Set<string>();
    const byDevice = new Map<string, Set<string>>();
    const section = this.doc.getMap(S.DEVICES_REFUSED);
    for (const key of section.keys()) {
      const parts = readKey(key, 2);
      if (parts === null) continue;
      const [deviceId] = parts as [string, string];
      if (deviceId.length === 0) continue;
      deviceIds.add(deviceId);
      const nodes = byDevice.get(deviceId) ?? new Set<string>();
      byDevice.set(deviceId, nodes);
      const entry = RefusedDevice.safeParse(section.get(key));
      if (!entry.success) continue;
      for (const nodeId of entry.data.tailscaleIds) {
        nodeIds.add(nodeId);
        nodes.add(nodeId);
      }
    }
    return { deviceIds, nodeIds, byDevice };
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

  // --- persistence (full-history snapshot through the shared system-document
  // at user-action rate, so durability beats a debounce: a write that
  // returned is a write that survives a crash) -------------------------------

  private async persistNow(): Promise<void> {
    if (this.disposed) return;
    // DS-5c — through the file's ONE writer queue: a local commit's persist and
    // the host's merge persist (`hostOwner().persist`) never interleave, and the
    // snapshot is taken when the write runs.
    await this.file.persist();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.removeAllListeners();
    // DS-5c — a write already asked for lands before the daemon goes.
    await this.file.drained();
  }
}
