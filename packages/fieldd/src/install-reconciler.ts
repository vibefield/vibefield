import type { InstallSetEntry, PluginRecord } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { AuditService } from "./audit-service";
import type { RegistryInstallService } from "./plugin-install";
import type { PluginRegistryService } from "./plugin-registry";
import type { SettingsDocService } from "./settings-doc";

// InstallSetReconciler (P7, spec §16.6/PA-31/PA-32): the DESIRED plugin set is
// user-scope state in the settings doc; each device converges its local
// install records toward it. Code never rides the CRDT — intent does; bytes
// come from the registry (peer-CAS joins when the doc itself syncs).
//
// Two halves, both idempotent:
//   apply()   — doc → device: install missing registry entries, align
//               enablement, apply grant decisions;
//   publish() — device → doc: a LOCAL user action (install/uninstall/enable/
//               disable/grant) writes the entry other devices will converge on.
//
// Laws (§16.6, enforced or honestly recorded):
//   - effective enablement stays per-device (we set DESIRE via the registry;
//     engine gates/quarantine remain local truths);
//   - dev-linked/sideload NEVER enter the doc;
//   - revocation-bias is a MERGE-time tie-break — single-replica v1 has no
//     concurrent merges to break, so apply() is a plain idempotent diff; the
//     bias lands with the doc-sync track (recorded, thinking-p7);
//   - a failed install parks honestly (logged; §16.6 version-skew) and is
//     retried on the next reconcile, never crash-looped.

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
  private running = false;
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

  async reconcile(): Promise<void> {
    if (this.running) {
      this.queued = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.queued = false;
        await this.applyOnce();
      } while (this.queued);
    } finally {
      this.running = false;
    }
  }

  private async applyOnce(): Promise<void> {
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

    // grant decisions — idempotent diff; any movement recycles principals
    let moved = false;
    for (const g of entry.grants) {
      const wantGranted = g.decision === "granted";
      const isGranted = record.grantedCapabilities.includes(g.capability);
      const isDeniedRevoked = record.deniedCapabilities.some(
        (d) => d.capability === g.capability && d.reason === "revoked",
      );
      const matches = wantGranted ? isGranted || !isDeniedRevoked : !isGranted && isDeniedRevoked;
      if (matches) continue;
      if (!record.requestedCapabilities.includes(g.capability)) continue; // never grant the unrequested
      const { changed } = await this.cfg.audit.requiredSystem(
        {
          action: wantGranted ? "capability.grant" : "capability.revoke",
          target: { kind: "capability", id: g.capability, parentId: entry.pluginId },
          attrs: {
            origin: "settings-doc",
            pluginId: entry.pluginId,
            granted: wantGranted,
            decisionAt: g.at,
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

  /** device → doc: publish the local truth of one plugin as the desired
   * entry. Dev-linked/sideload never publish (§16.6). Fire-and-forget by
   * contract — a failed write logs and parks (the next mutation republishes);
   * it must never surface as an unhandled rejection from a handler. */
  async publish(record: PluginRecord, by: string): Promise<void> {
    try {
      await this.publishInner(record, by);
    } catch (e) {
      this.log.warn(
        "fieldd.install_reconciler.publish_parked",
        "An install-set publication failed; the next mutation republishes",
        { pluginId: record.id, error: e instanceof Error ? e.message : String(e) },
      );
    }
  }

  private async publishInner(record: PluginRecord, by: string): Promise<void> {
    if (record.source === "dev-linked" || record.source === "sideload") return;
    const entry: InstallSetEntry = {
      pluginId: record.id,
      source: record.source === "registry" ? "registry" : "bundled",
      ...(record.source === "registry"
        ? {
            version: record.version,
            ...(record.registry?.artifactSha256 !== undefined
              ? { artifactSha256: record.registry.artifactSha256 }
              : {}),
          }
        : {}),
      enabled: record.enabled,
      grants: [
        ...record.grantedCapabilities.map((capability) => ({
          capability,
          decision: "granted" as const,
          at: Date.now(),
        })),
        ...record.deniedCapabilities
          .filter((d) => d.reason === "revoked")
          .map((d) => ({
            capability: d.capability,
            decision: "revoked" as const,
            at: Date.now(),
          })),
      ],
    };
    await this.cfg.audit.requiredSystem(
      {
        action: "plugin.install_set.publish",
        target: { kind: "install-set", id: record.id },
        attrs: {
          by,
          source: entry.source,
          version: entry.version ?? "bundled",
          enabled: entry.enabled,
          grantDecisionCount: entry.grants.length,
        },
      },
      () => this.cfg.settingsDoc.setInstallSetEntry(entry, by),
      () => ({
        attrs: {
          by,
          source: entry.source,
          enabled: entry.enabled,
          grantDecisionCount: entry.grants.length,
        },
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
