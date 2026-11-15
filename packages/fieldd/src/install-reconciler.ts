import { AsyncLocalStorage } from "node:async_hooks";
import {
  type InstallSetEntry,
  type PluginRecord,
  type StandingReason,
  standingDecision,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { AuditService } from "./audit-service";
import { RpcCallError } from "./native-link";
import { COMMUNITY_SWITCH_CLOSED, type RegistryInstallService } from "./plugin-install";
import type { PluginRegistryService } from "./plugin-registry";
import type { InstallIdentity, InstallSetChange, SettingsDocService } from "./settings-doc";

// InstallSetReconciler (P7, spec §16.6/PA-31/PA-32): the DESIRED plugin set is
// user-scope state in the settings doc; each device converges its local
// install records toward it. Code never rides the CRDT — intent does; bytes
// come from the registry (peer-CAS joins when the doc itself syncs).
//
// Two halves, both idempotent:
//   apply()   — doc → device: install missing registry entries, align
//               enablement, apply the STANDING grant decisions;
//   publish() — device → doc: a LOCAL user action (install/uninstall/enable/
//               disable/grant) writes what IT decided, and nothing else.
//
// Laws (§16.6, enforced or honestly recorded):
//   - effective enablement stays per-device (we set DESIRE via the registry;
//     engine gates/quarantine remain local truths);
//   - dev-linked/sideload NEVER enter the doc;
//   - revocation wins (PA-32) — the bias is the merge rule here, as design-06
//     §4 puts it. DS-5b 2026-10-01: the bias is built; settings cross. A grant
//     records the revocation generation it saw; a merged grant that saw fewer
//     revocations than the entry holds missed one and is applied as REVOKED,
//     audited `REVOCATION_BIAS` (contracts `standingDecision`). And publish()
//     writes only the act's own fields — a revocation is one transaction (the
//     generation and the revoked decision together), a grant names the
//     generation it saw, enablement is enablement — because republishing a
//     desktop's whole local truth is exactly how a stale grant came back (B1);
//   - a failed install parks honestly (logged; §16.6 version-skew) and is
//     retried on the next reconcile, never crash-looped.

/** What a publication is for. Each act writes only what it decided (DS-5b). */
export type PublishAction = "install" | "enable" | "disable" | "grants";

/** The one decision a `grants` act made (`plugins.grants.set`). `changed` is
 * whether this device's effective grants moved: a grant that moved nothing
 * names no generation, because a desktop whose local grant still stands may
 * simply not have applied a revocation it just merged. */
export interface GrantAct {
  capability: string;
  granted: boolean;
  changed: boolean;
  /** the revocation generation the act SAW, read at its start in the plugin's lane; its grant records this one */
  seen?: number;
}

/** One async context's hold on one plugin's lane (the re-entry guard). `live` falls when the hold is released. */
interface LaneHold {
  readonly pluginId: string;
  live: boolean;
  readonly outer: LaneHold | undefined;
}

/** A plugin's lane asked for by the async context that already holds it: a programming error, said at once instead of
 * a wait behind itself that never ends. */
export class LaneReenteredError extends Error {
  constructor(readonly pluginId: string) {
    super(`lane re-entered: ${pluginId}`);
  }
}

/** What a person's enable, disable or update hands back from its own work (`localAct`): the record to publish (none:
 * nothing is published) and the handler's answer. */
export interface LocalMove<T> {
  record: PluginRecord | undefined;
  value: T;
}

/** What a person's grant act hands back from its own work (`grantAct`): the record to publish, whether this
 * device's grants moved, and what the caller answers. */
export interface GrantMove<T> {
  record: PluginRecord;
  changed: boolean;
  value: T;
}

const BIAS_REASON_CODES: Record<Exclude<StandingReason, "decision">, string> = {
  "revocation-bias": "REVOCATION_BIAS",
  "stamp-ahead": "REVOCATION_STAMP_AHEAD",
};

export interface InstallReconcilerConfig {
  settingsDoc: SettingsDocService;
  plugins: PluginRegistryService;
  installer: RegistryInstallService;
  /** the daemon's principal-recycling teardown (stop/revoke/drop/kill/withdraw) */
  teardown: (pluginId: string) => Promise<void>;
  /** fire-and-forget service (re)start for an enabled plugin */
  restart: (pluginId: string) => void;
  /** LOG-L6: synced intent is still a real mutation on this device. */
  audit: Pick<AuditService, "requiredSystem">;
  /** MK-2d (R3): the daemon's retire step after an uninstall (the plugin's runtime diagnostics) */
  retire?: (pluginId: string) => void;
  logger?: Logger;
}

export class InstallSetReconciler {
  private readonly log: Logger;
  private inflight: Promise<void> | null = null;
  private queued = false;
  /** MK-2c (2026-11-11): per plugin id, the index `generatedAt` its community refusal was last said for */
  private readonly communityRefused = new Map<string, number>();
  /** The grant race (2026-11-15): one lane per plugin. A person's grant act (`grantAct`) holds it from before its
   * registry move until its publication settles; a walk's grant section (`applyGrants`) holds it while it reads the
   * doc's decisions and the record and makes its powers. Neither interleaves with the other, so a walk never
   * applies a decision older than a person's act over it. First come, first served: each entrant waits for the
   * tail it found (`enter`). */
  private readonly lanes = new Map<string, Promise<void>>();
  /** Per plugin, the revocations a person made here whose publication PARKED: the doc never got them, and its
   * standing grant is older than this device's act. While one stands, no walk GRANTS that capability here (it may
   * always revoke); the walk retries the publication, and the first of the plugin's publications that commits
   * carries it and clears it. A later act on the capability supersedes it. In memory: a restart forgets it. */
  private readonly parkedRevokes = new Map<string, Set<string>>();

  constructor(private readonly cfg: InstallReconcilerConfig) {
    this.log = (cfg.logger ?? createNoopLogger()).child({ component: "plugin.install.reconciler" });
  }

  /** subscribe to install-set movement; coalesces overlapping runs */
  attach(): void {
    this.cfg.settingsDoc.on("changed", (ev: { section: string }) => {
      if (ev.section === "installSet") void this.reconcile();
    });
  }

  /** Converge once more. Overlapping calls coalesce into the run in flight,
   * which repeats until no call is queued; every caller's promise settles when
   * that run does, so awaiting it means the doc as of the call has applied. */
  reconcile(): Promise<void> {
    if (this.inflight !== null) {
      this.queued = true;
      return this.inflight;
    }
    const run = (async () => {
      try {
        do {
          this.queued = false;
          await this.applyOnce();
        } while (this.queued);
      } finally {
        this.inflight = null;
      }
    })();
    this.inflight = run;
    return run;
  }

  private async applyOnce(): Promise<void> {
    // never apply a document older than this device's own acts (see `publishing`)
    while (this.publishing.size > 0) await Promise.allSettled([...this.publishing]);
    const desired = await this.cfg.settingsDoc.installSet();
    for (const entry of Object.values(desired)) {
      try {
        await this.applyEntry(entry);
      } catch (e) {
        // §16.6 — parked pending, honestly; the next reconcile retries. MK-2c (2026-11-11, VF-PM 08:48:07Z): a
        // community entry refused while community plugins are off parks like any other, and is said once per id
        // per index `generatedAt`, not on every reconcile
        const refusedAt = communityRefusalAt(e);
        if (refusedAt !== undefined) {
          if (this.communityRefused.get(entry.pluginId) === refusedAt) continue;
          this.communityRefused.set(entry.pluginId, refusedAt);
        }
        this.log.warn(
          "fieldd.install_reconciler.entry_parked",
          "A desired install-set entry could not be applied; parked",
          { pluginId: entry.pluginId, error: e instanceof Error ? e.message : String(e) },
        );
      }
    }
    // MK-2d (2026-11-11; E10's R3, VF-PM 10:34:14Z): the removal half. A registry plugin this desktop holds that the
    // doc reads as removed (removed on any desktop) is removed here as the uninstall door removes it, data kept.
    for (const pluginId of await this.cfg.settingsDoc.removedPlugins()) {
      try {
        await this.applyRemoval(pluginId);
      } catch (e) {
        this.log.warn(
          "fieldd.install_reconciler.entry_parked",
          "A removed install-set entry could not be applied; parked",
          { pluginId, error: e instanceof Error ? e.message : String(e) },
        );
      }
    }
  }

  /** R3: teardown, the code removed with its data KEPT (the literal `false`: whether data goes is never the doc's,
   * `plugin-install.ts`'s `uninstall`), retire; audited as the synced install is. */
  private async removeHere(record: PluginRecord): Promise<void> {
    const attrs = {
      origin: "settings-doc",
      removeData: false,
      source: record.source,
      manifestHash: record.manifestHash,
      artifactSha256: record.registry?.artifactSha256 ?? "unknown",
    };
    await this.cfg.audit.requiredSystem(
      { action: "plugin.uninstall", target: { kind: "plugin", id: record.id }, attrs },
      async () => {
        await this.cfg.teardown(record.id);
        await this.cfg.installer.uninstall(record.id, false);
        this.cfg.retire?.(record.id);
      },
      () => ({ attrs: { origin: "settings-doc", removeData: false } }),
    );
    this.log.info(
      "fieldd.install_reconciler.removed",
      "A plugin removed on another desktop was removed here; its data stays",
      { pluginId: record.id, reason: "removed-in-settings" },
    );
  }

  private async applyEntry(entry: InstallSetEntry): Promise<void> {
    let record = this.cfg.plugins.get(entry.pluginId);

    // presence, in the plugin's lane (the uninstall race, item 441): read afresh there, never from this walk's start
    if (record === undefined) {
      record = await this.applyPresence(entry.pluginId);
      if (record === undefined) return;
    }
    // dev-linked/sideload rows never take doc-driven state (§16.6)
    if (record.source === "dev-linked" || record.source === "sideload") return;

    // enablement, in the plugin's lane (the disable race, item 440): read afresh there, never from this walk's start
    record = await this.applyEnablement(entry.pluginId, record);

    // grant decisions, in the plugin's lane (the grant race): read afresh there, never from this walk's start
    const { moved, held } = await this.applyGrants(entry.pluginId);
    if (held) void this.publish(this.cfg.plugins.get(entry.pluginId) ?? record, "grants");
    if (moved) {
      await this.cfg.teardown(entry.pluginId);
      if (record.enabled) this.cfg.restart(entry.pluginId);
    }
  }

  /** The grant section of a walk, in the plugin's lane. The doc's decisions and the record are read INSIDE the
   * lane: a person's act on this plugin is either wholly before (its publication committed, so its decision is the
   * doc's) or wholly after (and it is the last word). The STANDING decision (PA-32: a grant that missed a
   * revocation stands as revoked), an idempotent diff; `moved` tells the caller to recycle principals, `held` that
   * a parked revocation withheld a grant (the caller retries its publication). At most one audited `setGrant` per
   * requested decision of the entry, and one doc read: the lane's longest hold by a walk. */
  private async applyGrants(pluginId: string): Promise<{ moved: boolean; held: boolean }> {
    const lane = await this.hold(pluginId);
    try {
      return await lane.run(async () => {
        const entry = (await this.cfg.settingsDoc.installSet())[pluginId];
        const record = this.cfg.plugins.get(pluginId);
        if (entry === undefined || record === undefined) return { moved: false, held: false };
        if (record.source === "dev-linked" || record.source === "sideload")
          return { moved: false, held: false };
        let moved = false;
        let held = false;
        for (const g of entry.grants) {
          const standing = standingDecision(entry, g);
          const wantGranted = standing.granted;
          const isGranted = record.grantedCapabilities.includes(g.capability);
          const isDeniedRevoked = record.deniedCapabilities.some(
            (d) => d.capability === g.capability && d.reason === "revoked",
          );
          const matches = wantGranted
            ? isGranted || !isDeniedRevoked
            : !isGranted && isDeniedRevoked;
          if (matches) continue;
          if (!record.requestedCapabilities.includes(g.capability)) continue; // never grant the unrequested
          // a revocation of this device's whose publication parked is newer than the doc's standing grant: held, the
          // publication retried; a revoke is never held
          if (wantGranted && this.parkedRevokes.get(pluginId)?.has(g.capability) === true) {
            held = true;
            this.log.info(
              "fieldd.install_reconciler.grant_held",
              "A synced grant is held: this device's revocation has not reached the document yet",
              { pluginId, capability: g.capability },
            );
            continue;
          }
          const biased = standing.reason !== "decision";
          const stamps = {
            revocationGeneration: entry.revocationGenerations?.[g.capability] ?? 0,
            decisionGeneration: g.revocationGeneration ?? 0,
          };
          const { changed } = await this.cfg.audit.requiredSystem(
            {
              action: wantGranted ? "capability.grant" : "capability.revoke",
              target: { kind: "capability", id: g.capability, parentId: entry.pluginId },
              ...(standing.reason !== "decision"
                ? { reasonCode: BIAS_REASON_CODES[standing.reason] }
                : {}),
              attrs: {
                origin: "settings-doc",
                pluginId: entry.pluginId,
                granted: wantGranted,
                decisionAt: g.at,
                ...stamps,
                ...(biased ? { reason: standing.reason } : {}),
              },
            },
            () => this.cfg.plugins.setGrant(entry.pluginId, g.capability, wantGranted),
            (result) => ({
              attrs: {
                origin: "settings-doc",
                pluginId: entry.pluginId,
                capability: g.capability,
                granted: wantGranted,
                changed: result.changed,
                grantGeneration: result.record.grantGeneration,
                ...stamps,
                ...(biased ? { reason: standing.reason } : {}),
              },
            }),
          );
          moved = moved || changed;
        }
        return { moved, held };
      });
    } finally {
      lane.release();
    }
  }

  /** The lanes the current async context holds, live from the grant until the release (the re-entry guard). */
  private readonly holds = new AsyncLocalStorage<LaneHold>();

  private holding(pluginId: string): boolean {
    for (let h = this.holds.getStore(); h !== undefined; h = h.outer)
      if (h.live && h.pluginId === pluginId) return true;
    return false;
  }

  /** Wait for this plugin's lane and hold it. `run` runs work as its holder (the guard reads that), `release` ends
   * the hold. A lane asked for by the context that holds it rejects at once (`LaneReenteredError`); a released hold
   * never trips it, so a child a move started and did not await may take the lane after the act, as before. */
  private async hold(
    pluginId: string,
  ): Promise<{ run: <T>(fn: () => Promise<T>) => Promise<T>; release: () => void }> {
    if (this.holding(pluginId)) throw new LaneReenteredError(pluginId);
    const release = await this.enter(pluginId);
    const held: LaneHold = { pluginId, live: true, outer: this.holds.getStore() };
    return {
      run: (fn) => this.holds.run(held, fn),
      release: () => {
        held.live = false;
        release();
      },
    };
  }

  /** The grant race: wait for this plugin's lane, first come first served, and get its release. `prior` never
   * rejects (a hold only resolves), so a failed holder cannot wedge the lane: every holder releases in a finally. */
  private enter(pluginId: string): Promise<() => void> {
    const prior = this.lanes.get(pluginId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.then(() => hold);
    this.lanes.set(pluginId, tail);
    void tail.then(() => {
      if (this.lanes.get(pluginId) === tail) this.lanes.delete(pluginId);
    });
    return prior.then(() => release);
  }

  /** A person's grant act on this desktop (`plugins.grants.set`), in the plugin's lane from before its registry
   * move until its publication settles. `move` is the handler's own work: the registry, the principals' recycle,
   * and the record to publish. The caller's promise settles when `move` does; the publication stays
   * fire-and-forget to the caller (it catches), and only the lane waits for it. Once its move is done, the act
   * supersedes a parked revocation of the same capability: its own decision is the registry's, and it is written. */
  async grantAct<T>(
    pluginId: string,
    capability: string,
    granted: boolean,
    move: () => Promise<GrantMove<T>>,
  ): Promise<T> {
    const lane = await this.hold(pluginId);
    const release = lane.release;
    // the generation this act SAW: read before its registry move, inside the lane, never at its commit. A failed
    // read has moved nothing of this act: it releases and rethrows, and parks nothing
    let seen: number;
    try {
      const doc = this.cfg.settingsDoc;
      seen = await lane.run(() => doc.revocationGenerationOf(pluginId, capability));
    } catch (e) {
      release();
      throw e;
    }
    let out: GrantMove<T>;
    try {
      out = await lane.run(move);
    } catch (e) {
      // the registry may have moved before the handler failed: a revocation that stands here and was never
      // published is parked, as a failed publication's is
      if (!granted && this.revokedHere(pluginId, capability)) this.park(pluginId, capability);
      release();
      throw e;
    }
    this.unpark(pluginId, capability);
    const act: GrantAct = { capability, granted, changed: out.changed, seen };
    void this.publish(out.record, "grants", act).finally(release);
    return out.value;
  }

  /** The presence section of a walk, in the plugin's lane (the uninstall race, item 441): a registry entry this desktop
   * lacks is installed. The doc's entry and the record are read INSIDE the lane, so a person's uninstall here is
   * either wholly before it (its removal committed: the doc holds no entry) or wholly after it. Bundled presence is
   * the app's own (enablement-only sync). The install runs inside the lane: the lane's longest hold by a walk, a
   * download bounded by the installer's own limits, and only for a plugin this desktop does not hold, on which a
   * person here has no act. Answers the record, or undefined when nothing is to be installed. */
  private async applyPresence(pluginId: string): Promise<PluginRecord | undefined> {
    const lane = await this.hold(pluginId);
    try {
      return await lane.run(async () => {
        const entry = (await this.cfg.settingsDoc.installSet())[pluginId];
        const here = this.cfg.plugins.get(pluginId);
        if (here !== undefined) return here;
        if (entry === undefined || entry.source !== "registry") return undefined;
        return await this.cfg.audit.requiredSystem(
          {
            action: "plugin.install",
            target: { kind: "plugin", id: pluginId },
            attrs: {
              origin: "settings-doc",
              source: entry.source,
              requestedVersion: entry.version ?? "latest",
              artifactSha256: entry.artifactSha256 ?? "unknown",
            },
          },
          async () => {
            await this.cfg.installer.install({
              id: pluginId,
              ...(entry.version !== undefined ? { version: entry.version } : {}),
            });
            const installed = this.cfg.plugins.get(pluginId);
            if (installed === undefined) {
              throw new Error(`${pluginId}: install completed without a registry record`);
            }
            return installed;
          },
          (installed) => ({
            attrs: {
              origin: "settings-doc",
              version: installed.version,
              source: installed.source,
              manifestHash: installed.manifestHash,
              artifactSha256: installed.registry?.artifactSha256 ?? "unknown",
              publisher: installed.registry?.publisher ?? "unknown",
            },
          }),
        );
      });
    } finally {
      lane.release();
    }
  }

  /** The removal half of a walk, in the plugin's lane (item 441): a registry plugin this desktop holds that the doc
   * reads as removed is removed here, data kept. Read again inside the lane: a fresh install here of a plugin removed
   * elsewhere is either wholly before (its publication committed: the doc no longer reads it removed) or after. */
  private async applyRemoval(pluginId: string): Promise<void> {
    const lane = await this.hold(pluginId);
    try {
      return await lane.run(async () => {
        if (!(await this.cfg.settingsDoc.removedPlugins()).has(pluginId)) return;
        const record = this.cfg.plugins.get(pluginId);
        // bundled and dev-linked plugins are never removed by the doc; a sideload never enters it
        if (record?.source !== "registry") return;
        await this.removeHere(record);
      });
    } finally {
      lane.release();
    }
  }

  /** The enablement section of a walk, in the plugin's lane (the disable race, item 440). The doc's wish and the
   * record are read INSIDE the lane: a person's enable or disable on this plugin is either wholly before it (its
   * publication committed, so its wish is the doc's) or wholly after it (and it is the last word). Desire only:
   * effective stays per-device. MK-O3 (O3-C, 2026-11-12): a row held while community plugins are off reads off
   * whatever the person wants, so its synced wish is held to the wish recorded here; else every reconcile would
   * enable it again, audited, to no effect. A disable's teardown runs INSIDE the lane: after it, a person's enable
   * could land between this walk's registry move and its teardown, which would then stop a plugin the registry calls
   * enabled. An enable's restart is fire-and-forget, as before. */
  private async applyEnablement(pluginId: string, start: PluginRecord): Promise<PluginRecord> {
    const lane = await this.hold(pluginId);
    try {
      return await lane.run(async () => {
        const entry = (await this.cfg.settingsDoc.installSet())[pluginId];
        let record = this.cfg.plugins.get(pluginId);
        if (entry === undefined || record === undefined) return record ?? start;
        if (record.source === "dev-linked" || record.source === "sideload") return record;
        const enabledHere = this.cfg.plugins.isHeld(pluginId)
          ? await this.cfg.plugins.wantsEnabled(pluginId)
          : record.enabled;
        if (enabledHere === entry.enabled) return record;
        if (entry.enabled) {
          record = await this.cfg.audit.requiredSystem(
            {
              action: "plugin.enable",
              target: { kind: "plugin", id: pluginId },
              attrs: { origin: "settings-doc" },
            },
            () => this.cfg.plugins.enable(pluginId),
            (enabled) => ({
              attrs: {
                origin: "settings-doc",
                enabled: enabled.enabled,
                source: enabled.source,
                manifestHash: enabled.manifestHash,
              },
            }),
          );
          this.cfg.restart(pluginId);
        } else {
          record = await this.cfg.audit.requiredSystem(
            {
              action: "plugin.disable",
              target: { kind: "plugin", id: pluginId },
              attrs: { origin: "settings-doc" },
            },
            async () => {
              const disabled = await this.cfg.plugins.disable(pluginId);
              await this.cfg.teardown(pluginId);
              return disabled;
            },
            (disabled) => ({
              attrs: {
                origin: "settings-doc",
                enabled: disabled.enabled,
                source: disabled.source,
                manifestHash: disabled.manifestHash,
              },
            }),
          );
        }
        return this.cfg.plugins.get(pluginId) ?? record;
      });
    } finally {
      lane.release();
    }
  }

  /** A person's enable, disable or update on this desktop (item 440), in the plugin's lane from before its move
   * until its publication settles, as `grantAct` holds a grant act. `move` is the handler's own work, and hands back
   * the record to publish (none: nothing is published) and the handler's answer. The act answers once its move is
   * done; its publication is fire-and-forget to the caller, and only the lane waits for it. So one desktop's
   * publications for one plugin commit in its acts' order, and a walk's enablement section never reads the doc's
   * older wish over the act. */
  async localAct<T>(
    pluginId: string,
    action: Exclude<PublishAction, "grants">,
    move: () => Promise<LocalMove<T>>,
  ): Promise<T> {
    const lane = await this.hold(pluginId);
    const release = lane.release;
    let out: LocalMove<T>;
    try {
      out = await lane.run(move);
    } catch (e) {
      release();
      throw e;
    }
    if (out.record === undefined) {
      release();
      return out.value;
    }
    void this.publish(out.record, action).finally(release);
    return out.value;
  }

  /** A person's uninstall on this desktop (`plugins.uninstall`, item 441), in the plugin's lane from before its
   * teardown until its removal from the doc settles: a walk raised in the handler's gap never installs the plugin
   * again. `move` is the handler's own work (the teardown, the code removed); the act answers once it is done. */
  async uninstallAct<T>(pluginId: string, by: string, move: () => Promise<T>): Promise<T> {
    const lane = await this.hold(pluginId);
    const release = lane.release;
    let value: T;
    try {
      value = await lane.run(move);
    } catch (e) {
      release();
      throw e;
    }
    void this.unpublish(pluginId, by).finally(release);
    return value;
  }

  private revokedHere(pluginId: string, capability: string): boolean {
    const record = this.cfg.plugins.get(pluginId);
    return (record?.deniedCapabilities ?? []).some(
      (d) => d.capability === capability && d.reason === "revoked",
    );
  }

  private park(pluginId: string, capability: string): void {
    const parked = this.parkedRevokes.get(pluginId) ?? new Set<string>();
    parked.add(capability);
    this.parkedRevokes.set(pluginId, parked);
  }

  private unpark(pluginId: string, capability: string): void {
    const parked = this.parkedRevokes.get(pluginId);
    if (parked === undefined) return;
    parked.delete(capability);
    if (parked.size === 0) this.parkedRevokes.delete(pluginId);
  }

  /** device → doc: publish what one LOCAL act decided — an install's identity
   * and enablement, an enable or disable's enablement, a grant act's one
   * decision — and nothing else (DS-5b: a republished whole entry carried a
   * stale grant back over a revocation, B1). Dev-linked/sideload never publish
   * (§16.6). Fire-and-forget by contract — a failed write logs and parks; it
   * must never surface as an unhandled rejection from a handler. */
  async publish(record: PluginRecord, action: PublishAction, act?: GrantAct): Promise<void> {
    const run = (async () => {
      try {
        await this.publishInner(record, action, act);
      } catch (e) {
        // a revocation that never reached the doc is held here until one does (`parkedRevokes`)
        if (act !== undefined && !act.granted) this.park(record.id, act.capability);
        this.log.warn(
          "fieldd.install_reconciler.publish_parked",
          "An install-set publication failed; the next mutation republishes",
          { pluginId: record.id, error: e instanceof Error ? e.message : String(e) },
        );
      }
    })();
    this.publishing.add(run);
    try {
      await run;
    } finally {
      this.publishing.delete(run);
    }
  }

  /** DS wave 2 landing (2026-10-01) — this device's LOCAL publications still in
   * flight. A local act mutates the registry first and reaches the document
   * after (commit → persist → `changed`), so while one is in flight the
   * document is OLDER than this device's own truth. `applyOnce` waits for them:
   * a disable's late persist (fsync'd since DS-5c) used to raise `changed`
   * after a re-enable had already run, and the reconciler, reading the still-
   * disabled entry, tore the re-enabled plugin down — its fresh leases with it
   * (plugin-settings.test.ts "disable keeps settings/KV on disk; re-enable
   * restores read access": `invalid token` at the fresh principal's hello). */
  private readonly publishing = new Set<Promise<void>>();

  private async publishInner(
    record: PluginRecord,
    action: PublishAction,
    act: GrantAct | undefined,
  ): Promise<void> {
    if (record.source === "dev-linked" || record.source === "sideload") return;
    const identity: InstallIdentity =
      record.source === "registry"
        ? {
            source: "registry",
            version: record.version,
            ...(record.registry?.artifactSha256 !== undefined
              ? { artifactSha256: record.registry.artifactSha256 }
              : {}),
          }
        : { source: "bundled" };
    // item 440 (James's pick, 2026-11-15 01:22:08Z: an install follows the account's on/off): an install or an
    // update writes its identity, and its enablement only where none stands (`ensure`), as a grant act's does. An
    // update is not an enablement act, so it never carries a record's flip into the doc
    const change: InstallSetChange =
      action === "install"
        ? { identity, ensure: { identity, enabled: record.enabled } }
        : action === "grants"
          ? { ensure: { identity, enabled: record.enabled } }
          : { enabled: record.enabled, ensure: { identity, enabled: record.enabled } };
    const revoke = new Set<string>();
    const grant: string[] = [];
    const grantSeen: Record<string, number> = {};
    if (act !== undefined) {
      // A revocation is always written — biased to security, and it must reach
      // a document whose standing grant this device has not applied away yet.
      // A grant is written only when it MOVED this device: one that moved
      // nothing may be a desktop that has merged a revocation and not applied
      // it, and stamping that grant now would let it outlive the revocation.
      if (!act.granted) revoke.add(act.capability);
      else if (act.changed) grant.push(act.capability);
      if (act.granted && act.changed && act.seen !== undefined)
        grantSeen[act.capability] = act.seen;
    }
    // A revocation this device holds that the document has no decision for
    // (made before its entry was ever published) joins it, biased to security.
    // A grant is never inferred from state: defaults are not decisions, and a
    // local grant may be one a merged revocation has not yet reached.
    const decided = new Set(
      ((await this.cfg.settingsDoc.installSet())[record.id]?.grants ?? []).map((g) => g.capability),
    );
    for (const denied of record.deniedCapabilities) {
      if (denied.reason === "revoked" && !decided.has(denied.capability)) {
        revoke.add(denied.capability);
      }
    }
    // a revocation of this device's whose publication parked rides the plugin's next publication that commits
    const carried = [...(this.parkedRevokes.get(record.id) ?? [])];
    for (const capability of carried) revoke.add(capability);
    if (revoke.size > 0) change.revoke = [...revoke];
    if (grant.length > 0) change.grant = grant;
    if (Object.keys(grantSeen).length > 0) change.grantSeen = grantSeen;
    const attrs = {
      by: action,
      source: identity.source,
      version: identity.version ?? "bundled",
      enabled: record.enabled,
      grantCount: grant.length,
      revokeCount: revoke.size,
      ...(act !== undefined ? { capability: act.capability, granted: act.granted } : {}),
    };
    await this.cfg.audit.requiredSystem(
      {
        action: "plugin.install_set.publish",
        target: { kind: "install-set", id: record.id },
        attrs,
      },
      () => this.cfg.settingsDoc.updateInstallSet(record.id, change, action),
      (written) => ({
        attrs: { ...attrs, revocationGenerations: written.revocationGenerations },
      }),
    );
    for (const capability of carried) this.unpark(record.id, capability);
  }

  async unpublish(pluginId: string, by: string): Promise<void> {
    // item 441 — a removal is one of this device's local publications: a walk that starts while it is in flight
    // waits for it (`publishing`), as it waits for an install's or a grant's
    const run = this.cfg.audit
      .requiredSystem(
        {
          action: "plugin.install_set.remove",
          target: { kind: "install-set", id: pluginId },
          attrs: { by },
        },
        () => this.cfg.settingsDoc.removeInstallSetEntry(pluginId, by),
        () => ({ attrs: { by } }),
      )
      .catch((e) => {
        this.log.warn(
          "fieldd.install_reconciler.publish_parked",
          "An install-set removal failed to publish; the next mutation republishes",
          { pluginId, error: e instanceof Error ? e.message : String(e) },
        );
      });
    this.publishing.add(run);
    try {
      await run;
    } finally {
      this.publishing.delete(run);
    }
  }
}

/** MK-2c (2026-11-11): the index `generatedAt` a community refusal names, or undefined for any other error. */
function communityRefusalAt(error: unknown): number | undefined {
  if (!(error instanceof RpcCallError)) return undefined;
  const details = error.details as { reasonCode?: unknown; generatedAt?: unknown } | undefined;
  if (details?.reasonCode !== COMMUNITY_SWITCH_CLOSED) return undefined;
  return typeof details.generatedAt === "number" ? details.generatedAt : undefined;
}
