import {
  type InstallSetEntry,
  type PluginRecord,
  type StandingReason,
  standingDecision,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { AuditService } from "./audit-service";
import type { RegistryInstallService } from "./plugin-install";
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
  logger?: Logger;
}

export class InstallSetReconciler {
  private readonly log: Logger;
  private inflight: Promise<void> | null = null;
  private queued = false;

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
        // §16.6 — parked pending, honestly; the next reconcile retries
        this.log.warn(
          "fieldd.install_reconciler.entry_parked",
          "A desired install-set entry could not be applied; parked",
          { pluginId: entry.pluginId, error: e instanceof Error ? e.message : String(e) },
        );
      }
    }
  }

  private async applyEntry(entry: InstallSetEntry): Promise<void> {
    let record = this.cfg.plugins.get(entry.pluginId);

    // presence: registry entries install when absent; bundled presence is the
    // app's own (enablement-only sync)
    if (record === undefined) {
      if (entry.source !== "registry") return;
      record = await this.cfg.audit.requiredSystem(
        {
          action: "plugin.install",
          target: { kind: "plugin", id: entry.pluginId },
          attrs: {
            origin: "settings-doc",
            source: entry.source,
            requestedVersion: entry.version ?? "latest",
            artifactSha256: entry.artifactSha256 ?? "unknown",
          },
        },
        async () => {
          await this.cfg.installer.install({
            id: entry.pluginId,
            ...(entry.version !== undefined ? { version: entry.version } : {}),
          });
          const installed = this.cfg.plugins.get(entry.pluginId);
          if (installed === undefined) {
            throw new Error(`${entry.pluginId}: install completed without a registry record`);
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
    }
    // dev-linked/sideload rows never take doc-driven state (§16.6)
    if (record.source === "dev-linked" || record.source === "sideload") return;

    // enablement (desire only — effective stays per-device)
    if (record.enabled !== entry.enabled) {
      if (entry.enabled) {
        record = await this.cfg.audit.requiredSystem(
          {
            action: "plugin.enable",
            target: { kind: "plugin", id: entry.pluginId },
            attrs: { origin: "settings-doc" },
          },
          () => this.cfg.plugins.enable(entry.pluginId),
          (enabled) => ({
            attrs: {
              origin: "settings-doc",
              enabled: enabled.enabled,
              source: enabled.source,
              manifestHash: enabled.manifestHash,
            },
          }),
        );
        this.cfg.restart(entry.pluginId);
      } else {
        record = await this.cfg.audit.requiredSystem(
          {
            action: "plugin.disable",
            target: { kind: "plugin", id: entry.pluginId },
            attrs: { origin: "settings-doc" },
          },
          async () => {
            const disabled = await this.cfg.plugins.disable(entry.pluginId);
            await this.cfg.teardown(entry.pluginId);
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
      record = this.cfg.plugins.get(entry.pluginId) ?? record;
    }

    // grant decisions — the STANDING decision (PA-32: a grant that missed a
    // revocation stands as revoked), an idempotent diff; any movement
    // recycles principals
    let moved = false;
    for (const g of entry.grants) {
      const standing = standingDecision(entry, g);
      const wantGranted = standing.granted;
      const isGranted = record.grantedCapabilities.includes(g.capability);
      const isDeniedRevoked = record.deniedCapabilities.some(
        (d) => d.capability === g.capability && d.reason === "revoked",
      );
      const matches = wantGranted ? isGranted || !isDeniedRevoked : !isGranted && isDeniedRevoked;
      if (matches) continue;
      if (!record.requestedCapabilities.includes(g.capability)) continue; // never grant the unrequested
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
    if (moved) {
      await this.cfg.teardown(entry.pluginId);
      if (record.enabled) this.cfg.restart(entry.pluginId);
    }
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
    const change: InstallSetChange =
      action === "install"
        ? { identity, enabled: record.enabled }
        : action === "grants"
          ? { ensure: { identity, enabled: record.enabled } }
          : { enabled: record.enabled, ensure: { identity, enabled: record.enabled } };
    const revoke = new Set<string>();
    const grant: string[] = [];
    if (act !== undefined) {
      // A revocation is always written — biased to security, and it must reach
      // a document whose standing grant this device has not applied away yet.
      // A grant is written only when it MOVED this device: one that moved
      // nothing may be a desktop that has merged a revocation and not applied
      // it, and stamping that grant now would let it outlive the revocation.
      if (!act.granted) revoke.add(act.capability);
      else if (act.changed) grant.push(act.capability);
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
    if (revoke.size > 0) change.revoke = [...revoke];
    if (grant.length > 0) change.grant = grant;
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
  }

  async unpublish(pluginId: string, by: string): Promise<void> {
    await this.cfg.audit
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
  }
}
