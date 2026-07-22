import type { DeviceInfo } from "@vibefield/contracts";
import type { FielddHealth } from "@vibefield/fieldd";
import { useFielddStatus, useSubscription } from "@vibefield/fieldd-client/react";
import type { ReactElement } from "react";
import { borderCls, labelCls, sectionCls } from "./SettingsPanel";

// Mesh diagnostics — a Settings SECTION, sibling to SystemSection (C3; the
// 2026-07-21 law: dev-facing diagnostics live inside the Settings panel, never
// as pages). Renders the tailnet honestly (EL5) in the panel's mono lowercase
// vocabulary (DESIGN.md §9 voice): the mesh node's state, the serves the field
// declares (with their capability URLs), and peers. Status hues come from
// DESIGN.md §2.5 via the Dot mapping — muted states carry no hue.

/** DESIGN.md §2.5 hue mapping, spanning unit states (mesh-gateway) and the fused
 * serve states (active/pending/error). Muted = disabled/stopped, no hue. */
function Dot({ state }: { state: string }): ReactElement {
  const color =
    state === "up" || state === "ready" || state === "active" || state === "running"
      ? "var(--vf-green)"
      : state === "degraded" ||
          state === "crashed" ||
          state === "failed" ||
          state === "closed" ||
          state === "error"
        ? "var(--vf-red)"
        : state === "disabled" || state === "stopped" || state === "offline"
          ? "rgba(128, 128, 128, 0.45)"
          : "var(--vf-orange)"; // starting / pending / connecting / reconnecting / auth-required
  return (
    <span
      className="inline-block h-1.5 w-1.5 flex-none rounded-full"
      style={{ background: color }}
    />
  );
}

export function MeshSection(): ReactElement {
  const conn = useFielddStatus();
  const sub = useSubscription<FielddHealth>("system.health.subscribe");
  const h = sub.data;
  // C4 (D31): the device roster — snapshot and every delta are the DeviceInfo[]
  // roster (self ⋈ peers), so `data` is the current roster wholesale.
  const devicesSub = useSubscription<DeviceInfo[]>("device.subscribe");
  const roster = devicesSub.data ?? [];

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
    <div className={borderCls}>
      <div className={sectionCls}>Mesh</div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className={labelCls}>node</span>
          <span className="flex items-center gap-1.5">
            {meshUnit?.authUrl !== undefined && (
              <a
                href={meshUnit.authUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
                style={{ color: "var(--vf-cyan)" }}
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

        {sub.error !== null && <div className={labelCls}>health stream unavailable</div>}
      </div>
    </div>
  );
}
