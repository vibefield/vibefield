import type { PluginsUpdatesCheckResult, PluginUpdateInfo } from "@vibefield/contracts";
import { FielddRpcError } from "@vibefield/fieldd-client";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useState } from "react";
import { labelCls } from "./SettingsPanel";

// P7 UI — the user-initiated updates flow (plugin spec §5.3.1: "plugins.updates.check
// is user-initiated … no push feed, no phone-home"). Mounts under PluginsSection as an
// "updates ▸" disclosure at the section top. There is NO auto-check and NO polling: a
// fetch happens ONLY on an explicit button press — opening the disclosure reveals a
// "check for updates" action, it never checks on its own (fetches are software
// acquisition, a deliberate act, DESIGN.md §9 honesty).
//
// PluginsUpdatesCheckResult renders honestly (DESIGN.md §8 — a state is rendered, never
// blank): compatible updates carry an install action (plugins.install {id, version});
// incompatible ones say WHY from the release's own minApp/minContracts (§5.3.1 —
// "false when engine ranges refuse this device; honest, not hidden"); vanished registry
// entries list plainly; an empty result reads "everything current" (DESIGN.md §9 voice).
// No optimistic state — a successful install re-runs the check (still a consequence of
// the user's click) and the section itself re-renders from plugins.subscribe (the P5 law).

/** §5.3.1 — a sha256 mismatch is PLUGIN_ARTIFACT_MISMATCH, discarded, never partially
 * installed; give it the one honest sentence (DESIGN.md §9). Otherwise the server's own
 * doctor-grade message (§9.4) speaks, matching the section's existing error idiom. */
function installErrorText(e: unknown): string {
  if (e instanceof FielddRpcError && e.kind === "PLUGIN_ARTIFACT_MISMATCH") {
    return "artifact hash mismatch — discarded";
  }
  return e instanceof Error ? e.message : String(e);
}

function UpdateRow({
  info,
  onInstalled,
}: {
  info: PluginUpdateInfo;
  onInstalled: () => void;
}): ReactElement {
  const client = useFielddClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.request("plugins.install", { id: info.id, version: info.latest.version });
      // No optimistic state — re-check so the row leaves honestly, and the section
      // re-renders from plugins.subscribe (the P5 law).
      onInstalled();
    } catch (e) {
      setError(installErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate" title={info.id}>
          {info.id}
        </span>
        <span className="flex flex-none items-center gap-1.5">
          <span className={`tabular-nums ${labelCls}`}>
            {info.installedVersion} → {info.latest.version}
          </span>
          {info.compatible ? (
            <button
              type="button"
              onClick={() => void install()}
              disabled={busy}
              className={`flex-none ${labelCls} hover:text-neutral-600 dark:hover:text-neutral-300`}
            >
              {busy ? "installing…" : "install"}
            </button>
          ) : (
            <span className={labelCls}>incompatible</span>
          )}
        </span>
      </div>
      {/* §5.3.1 — incompatibility is honest: name the engine range that refuses this
          device (the release's own minApp/minContracts), never a bare flag. */}
      {!info.compatible && (
        <div className={`pl-2 ${labelCls}`}>
          needs app {info.latest.minApp} · contracts {info.latest.minContracts}
        </div>
      )}
      {error !== null && (
        <div className={`truncate pl-2 text-right ${labelCls}`} title={error}>
          {error}
        </div>
      )}
    </div>
  );
}

export function PluginUpdates(): ReactElement {
  const client = useFielddClient();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<PluginsUpdatesCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // User-initiated ONLY (§5.3.1): the sole call site is this button. Opening the
  // disclosure reveals it; nothing fetches on mount, on expand, or on a timer.
  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      const res = (await client.request("plugins.updates.check", {})) as PluginsUpdatesCheckResult;
      setResult(res);
    } catch (e) {
      setError(installErrorText(e));
    } finally {
      setChecking(false);
    }
  };

  const nothing = result !== null && result.updates.length === 0 && result.missing.length === 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex-none ${labelCls} hover:text-neutral-600 dark:hover:text-neutral-300`}
      >
        updates {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 border-l border-neutral-100 pl-2 dark:border-neutral-700">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => void check()}
              disabled={checking}
              className="flex-none hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              {checking ? "checking…" : result === null ? "check for updates" : "check again"}
            </button>
            {result !== null && (
              <span className={`tabular-nums ${labelCls}`}>
                checked {new Date(result.checkedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          {error !== null && (
            <div className={`truncate ${labelCls}`} title={error}>
              {error}
            </div>
          )}
          {result !== null && error === null && nothing && (
            <div className={labelCls}>everything current</div>
          )}
          {result !== null && error === null && !nothing && (
            <>
              {result.updates.map((u) => (
                <UpdateRow key={u.id} info={u} onInstalled={() => void check()} />
              ))}
              {/* §5.3.1 — a registry entry that vanished is parked and listed plainly,
                  never silently dropped. */}
              {result.missing.map((id) => (
                <div key={id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate" title={id}>
                    {id}
                  </span>
                  <span className={labelCls}>dropped from registry</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
