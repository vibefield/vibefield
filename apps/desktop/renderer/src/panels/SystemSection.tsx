import type { FielddHealth } from "@vibefield/fieldd";
import { useFielddStatus, useSubscription } from "@vibefield/fieldd-client/react";
import type { ReactElement } from "react";
import { borderCls, labelCls, sectionCls } from "./SettingsPanel";

// System diagnostics — a Settings SECTION, not a page (James, 2026-07-21:
// dev-facing diagnostics live inside the Settings panel; the Track A health
// page is retired). Renders the health spine honestly (EL5): connection state,
// fieldd identity, native link, and per-unit states — in the panel's own mono
// vocabulary, status hues from DESIGN.md §2.5 (muted = no hue).

function Dot({ state }: { state: string }): ReactElement {
  const color =
    state === "up" || state === "ready"
      ? "var(--vf-green)"
      : state === "degraded" || state === "crashed" || state === "failed" || state === "closed"
        ? "var(--vf-red)"
        : state === "disabled"
          ? "rgba(128, 128, 128, 0.45)"
          : "var(--vf-orange)"; // starting / auth-required / connecting / reconnecting
  return (
    <span
      className="inline-block h-1.5 w-1.5 flex-none rounded-full"
      style={{ background: color }}
    />
  );
}

export function SystemSection(): ReactElement {
  const conn = useFielddStatus();
  const sub = useSubscription<FielddHealth>("system.health.subscribe");
  const h = sub.data;
  return (
    <div className={borderCls}>
      <div className={sectionCls}>System</div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className={labelCls}>connection</span>
          <span className="flex items-center gap-1.5">
            <Dot state={conn} />
            {conn}
          </span>
        </div>
        {h !== null && (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className={labelCls}>fieldd</span>
              <span className="truncate">
                {h.fieldd.bootId} · v{h.fieldd.contractsVersion} · pid {h.fieldd.pid}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className={labelCls}>native</span>
              <span className="flex items-center gap-1.5">
                <Dot state={h.nativeConnected ? (h.native?.state ?? "up") : "closed"} />
                {h.nativeConnected ? (h.native?.state ?? "up") : "disconnected"}
              </span>
            </div>
            {h.native?.units.map((u) => (
              <div key={u.unit} className="flex items-center justify-between gap-2 pl-2">
                <span className={labelCls}>{u.unit}</span>
                <span className="flex items-center gap-1.5">
                  {u.authUrl !== undefined && (
                    <a
                      href={u.authUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                      style={{ color: "var(--vf-cyan)" }}
                    >
                      authenticate
                    </a>
                  )}
                  <Dot state={u.state} />
                  {u.state}
                </span>
              </div>
            ))}
          </>
        )}
        {sub.error !== null && <div className={labelCls}>health stream unavailable</div>}
      </div>
    </div>
  );
}
