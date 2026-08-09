import type { DeviceInfo, DocSyncDocState } from "@vibefield/contracts";
import { StatusDot } from "@vibefield/design-kit";
import type { FielddHealth } from "@vibefield/fieldd";
import { useFielddClient, useFielddStatus, useSubscription } from "@vibefield/fieldd-client/react";
import type { ReactElement } from "react";
import { useDocSyncStatuses } from "../doc-sync-store";
import { getRendererLogger } from "../logging";
import { labelCls, SettingsSection } from "./settings-ui";

// Mesh diagnostics — a Settings SECTION, sibling to SystemSection (C3; the
// 2026-07-21 law: dev-facing diagnostics live inside the Settings panel, never
// as pages). Renders the tailnet honestly (EL5) in the panel's mono lowercase
// vocabulary (DESIGN.md §9 voice): the mesh node's state, the serves the field
// declares (with their capability URLs), and peers. Status hues come from
// DESIGN.md §2.5 via the Dot mapping — muted states carry no hue.

/** DESIGN.md §2.5 hue mapping, spanning unit states (mesh-gateway) and the fused
 * serve states (active/pending/error). Muted = disabled/stopped, no hue. */
function Dot({ state }: { state: string }): ReactElement {
  const tone =
    state === "up" || state === "ready" || state === "active" || state === "running"
      ? "healthy"
      : state === "degraded" ||
          state === "crashed" ||
          state === "failed" ||
          state === "closed" ||
          state === "error"
        ? "error"
        : state === "disabled" || state === "stopped" || state === "offline"
          ? "muted"
          : "attention"; // starting / pending / connecting / reconnecting / auth-required
  return <StatusDot tone={tone} />;
}

/** C6-4 — the sync fold in the Dot's vocabulary. In step and actively syncing
 * are healthy work (§2.5 green); peer-offline is a FACT, muted like a device's
 * offline; pending/declined/epoch-stale need attention (orange via the Dot's
 * fallback — nothing failed, so never red). */
function syncDotState(state: DocSyncDocState): string {
  if (state === "in-step") return "up";
  if (state === "syncing") return "running";
  if (state === "peer-offline") return "offline";
  return state; // pending | peer-declined | epoch-stale → the orange fallback
}

/** §9 voice: terse row words, hyphens made human; the numbers ride separately. */
const SYNC_LABEL: Record<DocSyncDocState, string> = {
  "in-step": "in step",
  syncing: "syncing",
  pending: "pending",
  "peer-offline": "peer offline",
  "peer-declined": "declined",
  "epoch-stale": "epoch stale",
};

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function MeshSection(): ReactElement {
  const client = useFielddClient();
  const conn = useFielddStatus();
  const sub = useSubscription<FielddHealth>("system.health.subscribe");
  const h = sub.data;
  // C4 (D31): the device roster — snapshot and every delta are the DeviceInfo[]
  // roster (self ⋈ peers), so `data` is the current roster wholesale.
  const devicesSub = useSubscription<DeviceInfo[]>("device.subscribe");
  const roster = devicesSub.data ?? [];
  // C6-4: per-doc sync standing from the module store (fed in FieldView).
  // null = stream unanswered, [] = sync has nothing to say — both render quiet.
  const syncStatuses = useDocSyncStatuses() ?? [];
  const deviceName = (peer: string): string =>
    roster.find((d) => d.deviceId === peer)?.name ?? peer;
  // UA-D7 — the registry write IS the whole effect: the row disappears on the
  // next status delta because fieldd stops publishing a gated doc, so there is
  // no local optimism to keep in step with the daemon.
  const keepLocal = (docId: string): void => {
    void client
      .request("doc.setSyncIntent", { docId, intent: "local" })
      .catch((error: unknown) =>
        getRendererLogger()
          .child({ component: "settings.mesh", docId })
          .error(
            "renderer.docs.sync_intent_failed",
            "Setting a document's sync intent failed",
            error,
          ),
      );
  };

  // The mesh node's own unit (design-02 §2.4): prefer the gateway, tolerate any
  // mesh-named unit as the surface grows (mesh-bridge, …).
  const units = h?.native?.units ?? [];
  const meshUnit =
    units.find((u) => u.unit === "mesh-gateway") ?? units.find((u) => u.unit.includes("mesh"));

  const serves = h?.mesh?.serves ?? [];

  // Node state: the mesh unit when present; else honest — native up but no mesh
  // unit means the gateway is unavailable (disabled / not surfaced); no health
  // at all falls back to the connection status.
  const nodeState = meshUnit ? meshUnit.state : h ? "unavailable" : conn;

  return (
    <SettingsSection
      title="Mesh network"
      description="Devices, shared services, and document synchronization on your private network."
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className={labelCls}>node</span>
          <span className="flex items-center gap-1.5">
            {meshUnit?.authUrl !== undefined && (
              <a
                href={meshUnit.authUrl}
                target="_blank"
                rel="noreferrer"
                className="vf-ui-tone-info underline"
              >
                authenticate
              </a>
            )}
            <Dot state={nodeState} />
            {nodeState}
            {meshUnit?.detail !== undefined && ` · ${meshUnit.detail}`}
          </span>
        </div>

        {/* serves — one row per declared serve; the URL is the capability URL
            (base + secret path) the field answers on, mono-truncated. */}
        {serves.map((s) => {
          const serveState = s.status;
          return (
            <div key={s.name} className="pl-2">
              <div className="flex items-center justify-between gap-2">
                <span className={labelCls}>{s.name}</span>
                <span className="flex min-w-0 items-center gap-1.5">
                  {s.url !== undefined && (
                    <span className="min-w-0 truncate" title={s.url}>
                      {s.url}
                    </span>
                  )}
                  <Dot state={serveState} />
                  <span className="flex-none">{serveState}</span>
                </span>
              </div>
              {/* error detail — the red dot signals state; the text stays muted
                  and explains (DESIGN.md §9: say what happened). */}
              {s.error !== undefined && (
                <div className={`truncate text-right ${labelCls}`} title={s.error}>
                  {s.error}
                </div>
              )}
            </div>
          );
        })}
        {/* never blank (DESIGN.md §8): an honest "none" when the field serves nothing. */}
        {h !== null && serves.length === 0 && (
          <div className="flex items-center justify-between pl-2">
            <span className={labelCls}>serves</span>
            <span className={labelCls}>none</span>
          </div>
        )}

        {/* devices — the C4 roster (self ⋈ peers). online is a FACT, not a
            status: green when the tailnet backs the device, muted grey when not
            (DESIGN.md §2.5 — offline is never an error). docHost shows a muted
            "docs" hint. Empty / errored rosters render honestly, never blank. */}
        <div className="pl-2">
          <div className="flex items-center justify-between gap-2">
            <span className={labelCls}>devices</span>
            {roster.length > 0 && <span className={labelCls}>{roster.length}</span>}
          </div>
          {devicesSub.error !== null ? (
            <div className={`pl-2 ${labelCls}`}>roster unavailable</div>
          ) : roster.length === 0 ? (
            <div className={`pl-2 ${labelCls}`}>no devices yet</div>
          ) : (
            roster.map((d) => (
              <div key={d.deviceId} className="flex items-center justify-between gap-2 pl-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Dot state={d.online ? "up" : "offline"} />
                  <span className="min-w-0 truncate">
                    {d.name}
                    {d.self && <span className={labelCls}> · this device</span>}
                  </span>
                </span>
                <span className="flex flex-none items-center gap-1.5">
                  {d.capabilities.docHost && <span className={labelCls}>docs</span>}
                  <span className={labelCls}>{d.platform}</span>
                  {/* C5 (D32): our link verdict to a peer — a muted text fact
                      (mono lowercase), separate from the online dot. */}
                  {!d.self && d.link !== undefined && <span className={labelCls}>{d.link}</span>}
                </span>
              </div>
            ))
          )}
        </div>

        {/* doc sync — C6-4: per-doc standing with peers, from the same fold
            doc.sync.subscribe publishes (EL5: pending is NOT in step, and a
            declined record is state, never floor litter). No rows when sync
            has nothing to say — with no peers the quiet IS the honesty. The
            last-exchange clock, not the state word, carries freshness:
            offline detection can lag by minutes (F-C6-22). */}
        {syncStatuses.length > 0 && (
          <div className="pl-2">
            <div className="flex items-center justify-between gap-2">
              <span className={labelCls}>doc sync</span>
              <span className={labelCls}>{syncStatuses.length}</span>
            </div>
            {syncStatuses.map((s) => {
              const offline = s.peers.filter((p) => !p.reachable);
              const lastExchange = s.peers.reduce<number | null>(
                (last, p) =>
                  p.lastExchangeAt !== null && (last === null || p.lastExchangeAt > last)
                    ? p.lastExchangeAt
                    : last,
                null,
              );
              return (
                <div key={s.docId} className="pl-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {s.name ?? <span className={labelCls}>a peer's doc · not held here</span>}
                    </span>
                    <span className="flex flex-none items-center gap-1.5">
                      {/* UA-D7 — the way out of the mesh, on the row that says
                          the doc is in it. Only for a doc THIS device holds: a
                          null name is a peer's doc we have no registry entry
                          for, and there is no intent to set on what we lack.
                          A doc that takes this leaves these rows entirely —
                          fieldd stops publishing a status for it, because a
                          gated doc can never reach one (EL5). */}
                      {s.name !== null && (
                        <button
                          type="button"
                          data-keep-local={s.docId}
                          onClick={() => keepLocal(s.docId)}
                          title="Stop syncing this document — it stays on this device"
                          className={`rounded px-1 underline decoration-dotted underline-offset-2 transition-opacity duration-200 ease-out hover:text-black dark:hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--vf-select)] ${labelCls}`}
                        >
                          keep local
                        </button>
                      )}
                      {s.pendingRecords > 0 && (
                        <span className={`tabular-nums ${labelCls}`}>
                          waiting on {s.pendingRecords}
                        </span>
                      )}
                      <Dot state={syncDotState(s.state)} />
                      <span>{SYNC_LABEL[s.state]}</span>
                    </span>
                  </div>
                  {/* the honest detail line: verbatim reason, WHO is offline,
                      and WHEN we last actually exchanged — never "up to date
                      as of now" (§9: numbers and provenance). */}
                  {(s.reason !== null || offline.length > 0) && (
                    <div className={`truncate text-right tabular-nums ${labelCls}`}>
                      {[
                        s.reason,
                        offline.length > 0
                          ? `offline: ${offline.map((p) => deviceName(p.peer)).join(", ")}`
                          : null,
                        lastExchange !== null
                          ? `last exchange ${fmtClock(lastExchange)}`
                          : "no exchange yet",
                      ]
                        .filter((part) => part !== null)
                        .join(" · ")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {sub.error !== null && <div className={labelCls}>health stream unavailable</div>}
      </div>
    </SettingsSection>
  );
}
