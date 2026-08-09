import { StatusDot } from "@vibefield/design-kit";
import type { FielddHealth } from "@vibefield/fieldd";
import { useFielddStatus, useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, useSyncExternalStore } from "react";
import { getBoardStatus, subscribeBoardStatus } from "../board-status";
import { labelCls, SettingsSection } from "./settings-ui";

// System diagnostics — a Settings SECTION, not a page (James, 2026-07-21:
// dev-facing diagnostics live inside the Settings panel; the Track A health
// page is retired). Renders the health spine honestly (EL5): connection state,
// fieldd identity, native link, and per-unit states — in the panel's own mono
// vocabulary, status hues from DESIGN.md §2.5 (muted = no hue).

function Dot({ state }: { state: string }): ReactElement {
  const tone =
    state === "up" || state === "ready"
      ? "healthy"
      : state === "degraded" || state === "crashed" || state === "failed" || state === "closed"
        ? "error"
        : state === "disabled"
          ? "muted"
          : "attention"; // starting / auth-required / connecting / reconnecting
  return <StatusDot tone={tone} />;
}

/** DESIGN.md §2.5 hue mapping for the board-persistence states. */
const BOARD_DOT: Record<string, string> = {
  live: "ready",
  saving: "saving", // transitional → orange
  booting: "booting",
  detached: "detached",
  readonly: "detached", // same edits-don't-persist tone (P2: disabled-plugin boards)
  quarantined: "failed",
};

export function SystemSection(): ReactElement {
  const conn = useFielddStatus();
  const sub = useSubscription<FielddHealth>("system.health.subscribe");
  const h = sub.data;
  const board = useSyncExternalStore(subscribeBoardStatus, getBoardStatus);
  return (
    <SettingsSection
      title="System status"
      description="Live health from this window, the local daemon, and native services."
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className={labelCls}>connection</span>
          <span className="flex items-center gap-1.5">
            <Dot state={conn} />
            {conn}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className={labelCls}>board</span>
          <span className="flex items-center gap-1.5 truncate">
            <Dot state={BOARD_DOT[board.state] ?? "failed"} />
            {board.state}
            {board.detail !== undefined && ` · ${board.detail}`}
            {typeof board.lastSavedAt === "number" &&
              ` · saved ${new Date(board.lastSavedAt).toLocaleTimeString()}`}
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
            <div className="flex items-center justify-between">
              <span className={labelCls}>docs</span>
              <span className="flex items-center gap-1.5">
                <Dot state={h.docs.state} />
                {h.docs.state} · {h.docs.docCount} doc{h.docs.docCount === 1 ? "" : "s"}
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
                      className="vf-ui-tone-info underline"
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
    </SettingsSection>
  );
}
