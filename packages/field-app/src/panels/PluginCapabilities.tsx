import type {
  GrantDenialReason,
  PluginCapabilityContribution,
  PluginRecord,
} from "@vibefield/contracts";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useMemo, useState } from "react";
import { labelCls } from "./SettingsPanel";

// P6 UI — the per-plugin capability GRANTS pane (plugin spec §15.2–§15.4). Mounts
// under PluginsSection as a "capabilities ▸" disclosure, sibling to P5's
// "settings ▸". Every row is the plugin record's OWN grantedCapabilities +
// deniedCapabilities (the computeEffectiveGrants output, §15.2) — this file holds
// no local grant state. A toggle calls plugins.grants.set and then WAITS for the
// registry subscription to push the next snapshot; the row re-renders from that
// (the P5 law — the server snapshot is truth, never an optimistic flip). §15.4
// bumps grantGeneration on every change, so the snapshot that heals the row is a
// fresh record, not a mutated cache — nothing here caches a grant to go stale.
//
// DESIGN.md sections applied: §2.5 (the risk badge's hue — execute borrows the
// "needs attention" orange, sensitive the "destructive" red; read/write carry no
// hue because they are not states of concern, per "color belongs to honest state
// only"); §8 (a state is rendered, never blank — a denied row shows its reason);
// §9 (voice — honest reasons, sentence case, say what to do next). The mono/
// neutral vocabulary matches the Settings panel's diagnostics sections.

/** §15.4 denial reasons → one honest sentence each (DESIGN.md §9). "revoked" is
 * the interactive off-state (re-grantable); the other three are structural and
 * non-interactive — the grant is impossible, not merely withheld. */
const DENIAL_TEXT: Record<GrantDenialReason, string> = {
  revoked: "revoked",
  "entry-kind": "not eligible for this entry kind",
  "source-policy": "blocked by source policy",
  host: "unavailable on this host",
};

function RiskBadge({ risk }: { risk: PluginCapabilityContribution["risk"] }): ReactElement {
  // DESIGN.md §2.5: hue is reserved for honest signals. execute takes the
  // "needs attention" orange, sensitive the "destructive" red; read/write stay
  // hueless (not states of concern) and the label word differentiates them
  // (§9 — say what it is).
  const hue =
    risk === "sensitive" ? "var(--vf-red)" : risk === "execute" ? "var(--vf-orange)" : null;
  if (hue === null) {
    return (
      <span className="flex-none rounded px-1 text-neutral-400 dark:text-neutral-500">{risk}</span>
    );
  }
  return (
    <span
      className="flex-none rounded px-1"
      style={{ color: hue, background: `color-mix(in srgb, ${hue} 14%, transparent)` }}
    >
      {risk}
    </span>
  );
}

/** A custom x.* capability's declaration (§15.1), located by exact id in its
 * OWNER's contributions — the source of a row's title/description/risk. */
interface CapabilityMeta {
  contribution: PluginCapabilityContribution;
  declaringId: string;
  declaringTitle: string;
}

type RowModel =
  | { capability: string; granted: true }
  | { capability: string; granted: false; reason: GrantDenialReason };

function CapabilityRow({
  plugin,
  row,
  meta,
  interactive,
  busy,
  error,
  onToggle,
}: {
  plugin: PluginRecord;
  row: RowModel;
  meta: CapabilityMeta | undefined;
  interactive: boolean;
  busy: boolean;
  error: string | undefined;
  onToggle: (capability: string, granted: boolean) => void;
}): ReactElement {
  const stateText = row.granted ? "granted" : DENIAL_TEXT[row.reason];
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate" title={row.capability}>
          {row.capability}
        </span>
        <span className="flex flex-none items-center gap-1.5">
          {meta !== undefined && <RiskBadge risk={meta.contribution.risk} />}
          <span className={labelCls}>{stateText}</span>
          <input
            type="checkbox"
            checked={row.granted}
            disabled={!interactive || busy}
            onChange={() => onToggle(row.capability, row.granted)}
          />
        </span>
      </div>
      {/* Custom capabilities carry a human declaration; core scopes and any id
          whose owner is absent stay bare (§9: never invent a description). */}
      {meta !== undefined && (
        <>
          <div className="pl-2">
            {meta.contribution.title}
            {meta.declaringId !== plugin.id && (
              <span className={labelCls}> · from {meta.declaringTitle}</span>
            )}
          </div>
          <div className={`pl-2 ${labelCls}`}>{meta.contribution.description}</div>
        </>
      )}
      {error !== undefined && (
        <div className={`truncate pl-2 text-right ${labelCls}`} title={error}>
          {error}
        </div>
      )}
    </div>
  );
}

export function PluginCapabilities({
  plugin,
  plugins,
}: {
  plugin: PluginRecord;
  plugins: readonly PluginRecord[];
}): ReactElement {
  const client = useFielddClient();
  const [pendingCap, setPendingCap] = useState<string | null>(null);
  const [error, setError] = useState<{ capability: string; message: string } | null>(null);

  // Custom x.* capabilities are DECLARED by their owning plugin (§15.1). Index
  // every plugin's contributions by exact capability id so a requested x.* cap
  // of ANOTHER plugin resolves to that owner's title/description/risk; core
  // scopes and undeclared ids simply miss the map and render bare.
  const catalog = useMemo(() => {
    const map = new Map<string, CapabilityMeta>();
    for (const p of plugins) {
      for (const cap of p.contributions.capabilities) {
        map.set(cap.id, { contribution: cap, declaringId: p.id, declaringTitle: p.title });
      }
    }
    return map;
  }, [plugins]);

  // Granted first, then denied — the union of the record's own two lists (§15.2).
  const rows: RowModel[] = [
    ...plugin.grantedCapabilities.map((c): RowModel => ({ capability: c, granted: true })),
    ...plugin.deniedCapabilities.map(
      (d): RowModel => ({ capability: d.capability, granted: false, reason: d.reason }),
    ),
  ];

  const toggle = async (capability: string, granted: boolean) => {
    setPendingCap(capability);
    setError(null);
    try {
      await client.request("plugins.grants.set", { id: plugin.id, capability, granted: !granted });
      // No optimistic flip: the registry subscription pushes the next snapshot
      // and the row re-renders from grantedCapabilities/deniedCapabilities.
    } catch (e) {
      setError({ capability, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setPendingCap(null);
    }
  };

  return (
    <div className="mt-1.5 space-y-1.5 border-l border-neutral-100 pl-2 dark:border-neutral-700">
      {/* §15.3 — dev-linked plugins are granted their requests on enable; this
          pane is where the developer revokes them. */}
      {plugin.source === "dev-linked" && (
        <div className={labelCls}>
          dev-linked — requested capabilities are granted on enable; revoke any here
        </div>
      )}
      {/* A disabled plugin's grants are meaningless until it runs again — the
          enable toggle upstream is the master switch (rows stay read-only). */}
      {!plugin.enabled && (
        <div className={labelCls}>disabled — re-enable the plugin to change its grants</div>
      )}
      {rows.length === 0 ? (
        <div className={labelCls}>no requested capabilities</div>
      ) : (
        rows.map((row) => {
          // revoked is re-grantable; the three structural denials are not. All
          // rows are read-only while the plugin is disabled (point above).
          const interactive = plugin.enabled && (row.granted || row.reason === "revoked");
          return (
            <CapabilityRow
              key={row.capability}
              plugin={plugin}
              row={row}
              meta={catalog.get(row.capability)}
              interactive={interactive}
              busy={pendingCap === row.capability}
              error={error?.capability === row.capability ? error.message : undefined}
              onToggle={toggle}
            />
          );
        })
      )}
    </div>
  );
}
