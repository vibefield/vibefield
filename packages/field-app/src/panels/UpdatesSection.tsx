import type {
  DesktopShellState,
  UpdateChannel,
  UpdateConsentWords,
  UpdateView,
} from "@vibefield/contracts";
import { InlineNotice, SegmentedControl, UiButton } from "@vibefield/design-kit";
import { type ReactElement, useCallback, useEffect, useId, useRef, useState } from "react";
import { getHost } from "../host";
import { labelCls, SettingsRow, SettingsSection, SettingsSwitch } from "./settings-ui";
import {
  checkedLabel,
  downgradeWords,
  isDowngrade,
  refusalFallback,
  UPDATE_CHANNEL_OPTIONS,
  unsupportedBelowWords,
  updateStateWords,
} from "./update-words";

// WP12d (L3c-ii; build-wp12-updater.md §13, the PM's ruling 2026-10-15 18:17Z) — Settings › General's update card and
// Settings › Diagnostics' updater block. Main owns the ONE updater (C1, the host bridge: it works with fieldd broken);
// the card renders its one projection (`desktopState.update`, the view the tray's item also comes from) and asks
// through the narrow doors. The card IS the consent from Settings (C2): Restart takes ONE snapshot of the sessions an
// update ends, and only the second, red click acts on it — DESIGN.md's two-step destructive confirm, in main's words.

/** Where the card's two-phase apply stands. The token stays with the controller; the view never holds it. */
// Colour (DESIGN.md §2.5): a state word that has to be READ takes its ink (`--vf-ink-attention`, `--vf-ink-danger`),
// never the fill; the notices stay neutral and let their words carry the meaning.

export type UpdatesFlow =
  | { readonly kind: "none" }
  | { readonly kind: "preparing" }
  | { readonly kind: "consent"; readonly version: string; readonly words: UpdateConsentWords }
  | { readonly kind: "confirming" }
  | { readonly kind: "restarting" }
  | {
      readonly kind: "refused";
      readonly words: { readonly message: string; readonly detail: string };
    };

const NONE: UpdatesFlow = { kind: "none" };

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Settings › General's update card, controller-free: the updater's projection, the flow a Restart is in, and where
 * each act goes. The catalog mounts it over fixtures (docs/UI_SYSTEM.md's fixture-adapter rule). */
export function UpdatesSectionView({
  view,
  now,
  flow = NONE,
  pendingChannel = null,
  busy = false,
  error = null,
  onCheck,
  onSetEnabled,
  onChooseChannel,
  onConfirmChannel,
  onCancelChannel,
  onDecline,
  onRestart,
  onConfirmRestart,
  onCancelRestart,
}: {
  /** null: no updater runs in this build (a development build, a browser harness) */
  view: UpdateView | null;
  /** the clock the "checked" provenance is read against */
  now: number;
  flow?: UpdatesFlow;
  /** EDP-36 — a lower channel chosen, waiting on its sentence */
  pendingChannel?: UpdateChannel | null;
  /** a door is in flight (check, switch, channel, skip): the controls wait */
  busy?: boolean;
  /** the bridge itself failed: said under the card, with what to do */
  error?: string | null;
  onCheck?: () => void;
  onSetEnabled?: (enabled: boolean) => void;
  onChooseChannel?: (channel: UpdateChannel) => void;
  onConfirmChannel?: () => void;
  onCancelChannel?: () => void;
  onDecline?: () => void;
  onRestart?: () => void;
  onConfirmRestart?: () => void;
  onCancelRestart?: () => void;
}): ReactElement {
  if (view === null) {
    return (
      <SettingsSection title="Updates" description="VibeField's release builds update themselves.">
        <div className={`py-2 ${labelCls}`} data-updates-phase="absent">
          This build doesn't update itself: only release builds carry the identity updates need.
        </div>
      </SettingsSection>
    );
  }
  const words = updateStateWords(view);
  const inFlight = flow.kind === "preparing" || flow.kind === "confirming";
  const restarting = flow.kind === "restarting";
  const percent = Math.round(view.percent ?? 0);
  const staged = view.phase === "staged" && view.applyWired;
  const endsSessions =
    view.keepsSessions !== true && typeof view.sessions === "number" && view.sessions > 0;
  const channelLowered = isDowngrade(view.channel, view.buildChannel);
  return (
    <SettingsSection
      title="Updates"
      description="VibeField downloads updates in the background and installs them when it restarts."
      action={
        <UiButton
          disabled={
            busy ||
            inFlight ||
            restarting ||
            view.phase === "checking" ||
            view.phase === "downloading"
          }
          onClick={onCheck}
        >
          {view.phase === "failed" || view.phase === "offline"
            ? "Check again"
            : "Check for updates"}
        </UiButton>
      }
    >
      <div className="vf-updates-state pb-3" data-updates-phase={view.phase}>
        <div
          role="status"
          className={`text-[13px] font-medium leading-5 ${
            words.tone === "error"
              ? "text-[var(--vf-ink-danger)]"
              : words.tone === "attention"
                ? "text-[var(--vf-ink-attention)]"
                : "text-black/80 dark:text-white/80"
          }`}
        >
          {words.headline}
        </div>
        {view.phase === "downloading" && (
          // a bar on real progress only — the number beside it in the headline (DESIGN.md: no spinner)
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={`Downloading VibeField ${view.version ?? ""}`}
            className="mt-2 h-[3px] w-full max-w-[320px] overflow-hidden rounded-full bg-black/10 dark:bg-white/15"
          >
            <div
              className="h-full rounded-full bg-black/60 dark:bg-white/70"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
        <div className={`mt-0.5 max-w-[62ch] tabular-nums ${labelCls}`}>
          {words.detail !== undefined && `${words.detail} · `}
          {checkedLabel(view.lastCheckAt, now)}
        </div>
      </div>

      {view.unsupportedBelow !== undefined && (
        <InlineNotice className="mb-3">{unsupportedBelowWords(view.unsupportedBelow)}</InlineNotice>
      )}

      {staged && flow.kind !== "consent" && (
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <UiButton variant="primary" disabled={busy || inFlight || restarting} onClick={onRestart}>
            {endsSessions ? "Restart to update…" : "Restart to update"}
          </UiButton>
          <UiButton disabled={busy || inFlight || restarting} onClick={onDecline}>
            Skip this version
          </UiButton>
          {flow.kind === "preparing" && (
            <span className={labelCls}>Reading the running sessions…</span>
          )}
          {flow.kind === "confirming" && <span className={labelCls}>Starting the update…</span>}
          {restarting && <span className={labelCls}>Restarting VibeField…</span>}
        </div>
      )}

      {flow.kind === "consent" && (
        <RestartConsent
          words={flow.words}
          busy={busy}
          onConfirm={onConfirmRestart}
          onCancel={onCancelRestart}
        />
      )}

      {flow.kind === "refused" && (
        <InlineNotice role="alert" className="mb-3">
          <span className="font-medium">{flow.words.message}.</span> {flow.words.detail}
        </InlineNotice>
      )}

      <SettingsRow
        title="Automatic updates"
        description="Check for updates and download them on their own. Off, VibeField checks only when you ask."
      >
        <SettingsSwitch
          label="Automatic updates"
          checked={view.enabled}
          disabled={busy || restarting}
          onChange={(checked) => onSetEnabled?.(checked)}
        />
      </SettingsRow>
      <SettingsRow
        title="Channel"
        description={
          channelLowered
            ? `This build is ${view.buildChannel}; the next ${view.channel} release replaces it.`
            : "Stable is tested longest. Beta comes first; Nightly is every day's build."
        }
        divider={false}
      >
        <SegmentedControl
          size="small"
          options={UPDATE_CHANNEL_OPTIONS}
          value={pendingChannel ?? view.channel}
          onChange={(channel) => onChooseChannel?.(channel)}
          label="Update channel"
        />
      </SettingsRow>
      {pendingChannel !== null && (
        <ChannelConfirm
          channel={pendingChannel}
          busy={busy}
          onConfirm={onConfirmChannel}
          onCancel={onCancelChannel}
        />
      )}

      {error !== null && (
        <InlineNotice role="alert" className="mt-3">
          VibeField couldn't reach its updater: {error}. Reopen Settings; if it stays, see
          Diagnostics.
        </InlineNotice>
      )}
    </SettingsSection>
  );
}

/** C2 — the consent from Settings: the snapshot's own words (main's, the same the tray's box says) and a two-step
 * destructive act in red text. Cancel holds focus, as Cancel is the tray box's default: nothing ends by accident. */
function RestartConsent({
  words,
  busy,
  onConfirm,
  onCancel,
}: {
  words: UpdateConsentWords;
  busy: boolean;
  onConfirm?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
}): ReactElement {
  const cancel = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  return (
    <fieldset
      className="vf-profiles-confirm-box mb-3"
      aria-labelledby={questionId}
      data-updates-consent=""
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel?.();
        }
      }}
    >
      <p id={questionId} className="vf-profiles-confirm-question">
        {words.message}
      </p>
      <p className={`vf-profiles-confirm-what ${labelCls}`}>{words.lead}</p>
      <ul className={`mt-1 space-y-0.5 ${labelCls}`} aria-label="The sessions it ends">
        {words.listed.map((line) => (
          <li key={line} className="truncate">
            {line}
          </li>
        ))}
        {words.more > 0 && <li>and {words.more} more</li>}
      </ul>
      <div className="vf-profiles-confirm-acts">
        <UiButton variant="danger" disabled={busy} onClick={onConfirm}>
          {words.confirm}
        </UiButton>
        <UiButton ref={cancel} disabled={busy} onClick={onCancel}>
          Cancel
        </UiButton>
      </div>
    </fieldset>
  );
}

/** EDP-36 — a lower channel is a downgrade, and the card says so before it takes. */
function ChannelConfirm({
  channel,
  busy,
  onConfirm,
  onCancel,
}: {
  channel: UpdateChannel;
  busy: boolean;
  onConfirm?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
}): ReactElement {
  const act = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  const words = downgradeWords(channel);
  useEffect(() => {
    act.current?.focus();
  }, []);
  return (
    <fieldset
      className="vf-profiles-confirm-box mt-2"
      aria-labelledby={questionId}
      data-updates-downgrade={channel}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel?.();
        }
      }}
    >
      <p id={questionId} className="vf-profiles-confirm-question">
        {words.question}
      </p>
      <p className={`vf-profiles-confirm-what ${labelCls}`}>{words.what}</p>
      <div className="vf-profiles-confirm-acts">
        <UiButton ref={act} disabled={busy} onClick={onConfirm}>
          {words.act}
        </UiButton>
        <UiButton disabled={busy} onClick={onCancel}>
          Cancel
        </UiButton>
      </div>
    </fieldset>
  );
}

/** Settings › General's update card (C3: after Desktop, for now). Reads the projection main publishes in
 * `desktopState.update` and asks through `getHost().updates`; absent either, the card says no updater runs here. */
export function UpdatesSection({
  desktopState = null,
}: {
  desktopState?: DesktopShellState | null;
}): ReactElement {
  const host = getHost().updates;
  const view = host === undefined ? null : (desktopState?.update ?? null);
  const [flow, setFlow] = useState<UpdatesFlow>(NONE);
  const [pendingChannel, setPendingChannel] = useState<UpdateChannel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef<string | null>(null);

  // A consent and a refusal belong to the staged version they were about: when that version goes (declined, replaced,
  // applied elsewhere), so do they — main would answer `expired` anyway, but the card never shows a stale list.
  const stagedVersion = view?.phase === "staged" ? view.version : undefined;
  const seenVersion = useRef(stagedVersion);
  useEffect(() => {
    if (seenVersion.current === stagedVersion) return;
    seenVersion.current = stagedVersion;
    setFlow((current) =>
      current.kind === "consent" || current.kind === "refused" ? NONE : current,
    );
    token.current = null;
  }, [stagedVersion]);

  const act = useCallback(async (run: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }, []);

  const confirm = useCallback(
    async (prepared: string): Promise<void> => {
      if (host === undefined) return;
      setFlow({ kind: "confirming" });
      try {
        const result = await host.confirmRestart(prepared);
        setFlow(
          result.ok
            ? { kind: "restarting" }
            : { kind: "refused", words: result.words ?? refusalFallback(result.reason) },
        );
      } catch (failure) {
        setFlow(NONE);
        setError(errorText(failure));
      } finally {
        token.current = null;
      }
    },
    [host],
  );

  const restart = useCallback(async (): Promise<void> => {
    if (host === undefined) return;
    setError(null);
    setFlow({ kind: "preparing" });
    try {
      const prepared = await host.prepareRestart();
      if (!prepared.ok) {
        setFlow({ kind: "refused", words: prepared.words ?? refusalFallback(prepared.reason) });
        return;
      }
      if (prepared.consent === undefined) {
        // nothing ends: the click was the consent, and no apply asks twice
        await confirm(prepared.token);
        return;
      }
      token.current = prepared.token;
      setFlow({ kind: "consent", version: prepared.version, words: prepared.consent });
    } catch (failure) {
      setFlow(NONE);
      setError(errorText(failure));
    }
  }, [host, confirm]);

  return (
    <UpdatesSectionView
      view={view}
      now={Date.now()}
      flow={flow}
      pendingChannel={pendingChannel}
      busy={busy}
      error={error}
      // AU-1 (LC-5) — the check answers when it settles, so `busy` ends there; the card does not read the answer
      onCheck={() =>
        void act(async () => {
          await host?.check();
        })
      }
      onSetEnabled={(enabled) => void act(async () => host?.setEnabled(enabled))}
      onChooseChannel={(channel) => {
        if (view === null || channel === view.channel) {
          setPendingChannel(null);
          return;
        }
        if (isDowngrade(channel, view.buildChannel)) {
          setPendingChannel(channel);
          return;
        }
        setPendingChannel(null);
        void act(async () => host?.setChannel(channel));
      }}
      onConfirmChannel={() => {
        const channel = pendingChannel;
        setPendingChannel(null);
        if (channel !== null) void act(async () => host?.setChannel(channel));
      }}
      onCancelChannel={() => setPendingChannel(null)}
      onDecline={() => {
        const version = view?.version;
        if (version !== undefined) void act(async () => host?.decline(version));
      }}
      onRestart={() => void restart()}
      onConfirmRestart={() => {
        const prepared = token.current;
        if (prepared !== null) void confirm(prepared);
      }}
      onCancelRestart={() => {
        token.current = null;
        setFlow(NONE);
      }}
    />
  );
}

/** One doctor line split at its first ": " — the panel's key/value vocabulary (SystemSection's). */
function doctorRow(line: string): { key: string; value: string } {
  const at = line.indexOf(": ");
  return at < 0 ? { key: "", value: line } : { key: line.slice(0, at), value: line.slice(at + 2) };
}

export type UpdatesDoctorState =
  | { readonly kind: "absent" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly lines: readonly string[] }
  | { readonly kind: "error"; readonly message: string };

/** Settings › Diagnostics' updater block (C4; DESIGN.md §10: dev-facing diagnostics are sections in the panel,
 * `SystemSection` the template), controller-free. The same lines go into a support bundle's `doctor/status.json`. */
export function UpdatesDoctorView({
  state,
  onRefresh,
}: {
  state: UpdatesDoctorState;
  onRefresh?: () => void;
}): ReactElement {
  return (
    <SettingsSection
      title="Updater"
      description="The desktop updater's own account: its state, its last check, and what holds a staged update."
      action={
        state.kind === "absent" ? undefined : (
          <UiButton disabled={state.kind === "loading"} onClick={onRefresh}>
            Refresh
          </UiButton>
        )
      }
    >
      <div className="space-y-1" data-updates-doctor={state.kind}>
        {state.kind === "absent" && <div className={labelCls}>No updater runs in this build.</div>}
        {state.kind === "loading" && <div className={labelCls}>Reading the updater…</div>}
        {state.kind === "error" && (
          <div className={labelCls}>
            The updater didn't answer: {state.message}. Refresh to ask again.
          </div>
        )}
        {state.kind === "ready" &&
          state.lines.map((line) => {
            const { key, value } = doctorRow(line);
            return (
              <div key={line} className="flex items-center justify-between gap-2">
                <span className={labelCls}>{key}</span>
                <span className="truncate">{value}</span>
              </div>
            );
          })}
      </div>
    </SettingsSection>
  );
}

/** Settings › Diagnostics' updater block: the doctor's lines, read when the page opens and on Refresh — a local read
 * of main's updater, never a check for updates. */
export function UpdatesDoctorSection(): ReactElement {
  const host = getHost().updates;
  const [state, setState] = useState<UpdatesDoctorState>(
    host === undefined ? { kind: "absent" } : { kind: "loading" },
  );
  const read = useCallback(async (): Promise<void> => {
    if (host === undefined) return;
    setState({ kind: "loading" });
    try {
      const result = await host.doctor();
      setState({ kind: "ready", lines: result.lines });
    } catch (failure) {
      setState({ kind: "error", message: errorText(failure) });
    }
  }, [host]);
  useEffect(() => {
    void read();
  }, [read]);
  return <UpdatesDoctorView state={state} onRefresh={() => void read()} />;
}
