import {
  type DesktopShellState,
  releaseName,
  type UpdateChannel,
  type UpdateConsentWords,
  type UpdateView,
} from "@vibefield/contracts";
import { InlineNotice, SegmentedControl, UiButton } from "@vibefield/design-kit";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { copyText } from "../account/use-link-door";
import { CopyButton } from "../frame/cards/CopyButton";
import type { DealFrom } from "../frame/cards/cards-store";
import { COPY_PLACES } from "../frame/cards/cards-words";
import { getHost } from "../host";
import {
  borderCls,
  buttonCls,
  labelCls,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "./settings-ui";
import { errorText, NO_FLOW, type UpdatesFlow, useUpdateRestart } from "./update-flow";
import {
  AUTOMATIC_UPDATES_LINES,
  cannotUpdateHere,
  channelLabel,
  channelUnresolved,
  checkedLabel,
  downgradeWords,
  downloadRefusalFallback,
  isDowngrade,
  LOCATION_WORDS,
  moveRefusalFallback,
  notAppliedWords,
  restartAsks,
  UPDATE_CHANNEL_LINES,
  UPDATE_CHANNEL_OPTIONS,
  type UpdateStateWords,
  unsupportedBelowWords,
  updateStateWords,
  updateWaits,
} from "./update-words";

// WP12d (L3c-ii; build-wp12-updater.md §13, the PM's ruling 2026-10-15 18:17Z) — the desktop updater's card and
// Settings › Diagnostics' updater block. Main owns the ONE updater (C1, the host bridge: it works with fieldd broken);
// the page renders its one projection (`desktopState.update`, the view the tray's item also comes from) and asks
// through the narrow doors. The page IS the consent from Settings (C2): Restart takes ONE snapshot of the sessions an
// update ends, and only the second, red click acts on it — DESIGN.md's two-step destructive confirm, in main's words.
// AU-3 (AU-D8 A; DESIGN.md §8 "Settings → Updates") — the card became a page of its own, first in Support: headed by
// the exact version with Copy (AU-G4), one primary act per state, Download and Download anyway (AU-G5, AU-G6), the
// install that didn't take (AU-G7), and the restart's two phases shared with the Me menu (`update-flow.ts`).
// AU-7 (AU-G8; LC-10, LC-40) — where the app runs: a copy macOS won't let replace itself says so in the attention ink
// with Move to Applications… as its primary; a writable copy elsewhere carries one quiet line with the move beside it.
// The move goes through main's quit gate (`moveToApplications`): its Cancel brings the page back to rest.

// Colour (DESIGN.md §2.5): a state word that has to be READ takes its ink (`--vf-ink-attention`, `--vf-ink-danger`),
// never the fill; a channel with nothing published is quiet (the tertiary ink, LC-31); the notices stay neutral and
// let their words carry the meaning.

// the type the catalog's fixtures import from here (docs/UI_SYSTEM.md's fixture-adapter rule pins the import line)
export type { UpdatesFlow } from "./update-flow";

const HEADLINE_INK: Record<UpdateStateWords["tone"], string> = {
  neutral: "text-black/80 dark:text-white/80",
  attention: "text-[var(--vf-ink-attention)]",
  error: "text-[var(--vf-ink-danger)]",
  quiet: "text-[var(--vf-text-tertiary)]",
};

/** The state's ONE primary act, at the head's end (DESIGN.md §8): none while downloading. Paused and a newer macOS
 * keep Check for updates, so a lifted pause has a door (LC-22); a channel with nothing published is no failure, so it
 * says Check for updates, not Check again (LC-31). AU-7: a copy that can't replace itself moves first (LC-10). */
function primaryAct(
  view: UpdateView,
): { readonly act: "check" | "restart" | "download" | "move"; readonly label: string } | null {
  if (cannotUpdateHere(view)) return { act: "move", label: LOCATION_WORDS.move };
  switch (view.phase) {
    case "downloading":
      return null;
    case "staged":
      return view.applyWired
        ? {
            act: "restart",
            label: restartAsks(view) ? "Restart to update…" : "Restart to update",
          }
        : { act: "check", label: "Check for updates" };
    case "available":
      if (view.declined === true) return { act: "download", label: "Download anyway" };
      return view.enabled
        ? { act: "check", label: "Check for updates" }
        : { act: "download", label: "Download" };
    case "offline":
      return { act: "check", label: "Check again" };
    case "failed":
      return { act: "check", label: channelUnresolved(view) ? "Check for updates" : "Check again" };
    default:
      return { act: "check", label: "Check for updates" };
  }
}

/** Settings → Updates, controller-free: the updater's projection, the flow a Restart is in, and where each act goes.
 * The catalog mounts it over fixtures (docs/UI_SYSTEM.md's fixture-adapter rule). */
export function UpdatesSectionView({
  view,
  now,
  flow = NO_FLOW,
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
  onDownload,
  onMoveToApplications,
  onOpenDiagnostics,
  onCopyVersion,
}: {
  /** null: no updater runs in this build (a development build, a browser harness) */
  view: UpdateView | null;
  /** the clock the "checked" provenance, the ready day and a recent install are read against */
  now: number;
  flow?: UpdatesFlow;
  /** EDP-36 — a lower channel chosen, waiting on its sentence */
  pendingChannel?: UpdateChannel | null;
  /** a door is in flight (check, switch, channel, skip, download): the controls wait */
  busy?: boolean;
  /** the bridge itself failed: said under the page, with what to do */
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
  /** AU-3 (AU-G5, AU-G6) — Download (found with updates off) and Download anyway (skipped), through AU-1's door */
  onDownload?: () => void;
  /** AU-7 (AU-G8) — Move to Applications, through main's quit gate: the read-only copy's primary, elsewhere a
   * secondary act */
  onMoveToApplications?: () => void;
  /** the foot's Updater diagnostics →, a failed check's and a failed install's Diagnostics → (`| undefined`: the
   * controller forwards its own optional prop) */
  onOpenDiagnostics?: (() => void) | undefined;
  /** AU-3 (AU-G4) — Copy the exact version, dealt into the hand from the button's box as every Settings copy is
   * (HN-5): true once it is on the clipboard */
  onCopyVersion?: (version: string, from: DealFrom | null) => Promise<boolean>;
}): ReactElement {
  // LC-9 — Cancel or Esc takes the question away with focus inside it: focus comes back to the head's act, never to
  // the page's body, where the dialog's Tab trap can't hold it (the Me menu brings it back to its row the same way).
  // Only when nothing else took it: a question dropped because its version went leaves focus where it is.
  const primaryRef = useRef<HTMLButtonElement>(null);
  const seenFlow = useRef(flow.kind);
  useLayoutEffect(() => {
    const was = seenFlow.current;
    seenFlow.current = flow.kind;
    if (was !== "consent" || flow.kind !== "none") return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    primaryRef.current?.focus({ preventScroll: true });
  }, [flow.kind]);
  if (view === null) {
    return (
      <SettingsSection title="Updates" description="VibeField's release builds update themselves.">
        <div className={`py-2 ${labelCls}`} data-updates-phase="absent">
          This build doesn't update itself: only release builds carry the identity updates need.
        </div>
      </SettingsSection>
    );
  }
  const words = updateStateWords(view, now);
  const inFlight = flow.kind === "preparing" || flow.kind === "confirming";
  const restarting = flow.kind === "restarting";
  // AU-7 — the move asked; the quit gate answers
  const moving = flow.kind === "moving";
  const held = busy || inFlight || restarting || moving;
  const elsewhere = view.location === "elsewhere";
  const percent = Math.round(view.percent ?? 0);
  // AU-7 — a ready update the copy can't install has no Skip: the move is the act
  const staged = view.phase === "staged" && view.applyWired && !cannotUpdateHere(view);
  const primary = primaryAct(view);
  const notApplied = notAppliedWords(view);
  const currentVersion = view.currentVersion;
  const channelLowered = isDowngrade(view.channel, view.buildChannel);
  return (
    <div className="space-y-4" data-updates-page="">
      <section className={borderCls}>
        {/* the head says exactly what you run (AU-L6): the version to copy, over the channel's word */}
        <div className="flex items-start justify-between gap-4" data-updates-head="">
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-black/85 dark:text-white/85">
              VibeField
            </h3>
            {currentVersion !== undefined && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code
                  className="vf-ui-mono select-text text-[12px] text-black/80 dark:text-white/80"
                  data-updates-version=""
                >
                  {currentVersion}
                </code>
                <CopyButton
                  label="Copy"
                  copy={(from) => onCopyVersion?.(currentVersion, from) ?? Promise.resolve(false)}
                  className={buttonCls}
                />
              </div>
            )}
            <div className={`mt-0.5 ${labelCls}`}>{channelLabel(view.buildChannel)}</div>
          </div>
          {primary !== null && (
            <UiButton
              ref={primaryRef}
              variant="primary"
              className="shrink-0"
              disabled={
                held ||
                flow.kind === "consent" ||
                (primary.act === "check" && view.phase === "checking")
              }
              onClick={
                primary.act === "restart"
                  ? onRestart
                  : primary.act === "download"
                    ? onDownload
                    : primary.act === "move"
                      ? onMoveToApplications
                      : onCheck
              }
            >
              {primary.label}
            </UiButton>
          )}
        </div>

        <div
          className="vf-updates-state mt-4 border-t border-black/5 pt-3 dark:border-white/10"
          data-updates-phase={view.phase}
        >
          <div
            role="status"
            className={`flex items-center gap-2 text-[13px] font-medium leading-5 ${HEADLINE_INK[words.tone]}`}
          >
            {/* AU-D2 — an install waits on you: the 6px cyan dot leads the ready line, as it ends the Me row */}
            {updateWaits(view) && <span className="vf-updates-dot" aria-hidden="true" />}
            {words.headline}
          </div>
          {view.phase === "downloading" && (
            // a bar on real progress only — the number beside it in the headline (DESIGN.md: no spinner)
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label={`Downloading ${releaseName(view.version ?? "")}`}
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

        {staged && flow.kind !== "consent" && (
          <div className="flex flex-wrap items-center gap-2 pt-3">
            <UiButton disabled={held} onClick={onDecline}>
              Skip this version
            </UiButton>
            {flow.kind === "preparing" && (
              <span className={labelCls}>Reading the running sessions…</span>
            )}
            {flow.kind === "confirming" && <span className={labelCls}>Starting the update…</span>}
            {restarting && <span className={labelCls}>Restarting VibeField…</span>}
          </div>
        )}

        {(elsewhere || moving) && (
          // AU-7 (LC-10) — a writable copy outside Applications updates as usual: one quiet line, the move beside it;
          // while the move asks, its words (the read-only copy's move is the head's primary)
          <div
            className="flex flex-wrap items-center gap-2 pt-3"
            data-updates-location={view.location ?? ""}
          >
            {elsewhere && <span className={labelCls}>{LOCATION_WORDS.elsewhere}</span>}
            {elsewhere && (
              <UiButton disabled={held} onClick={onMoveToApplications}>
                {LOCATION_WORDS.move}
              </UiButton>
            )}
            {moving && <span className={labelCls}>{LOCATION_WORDS.moving}</span>}
          </div>
        )}

        {words.tone === "error" && (
          <div className="flex flex-wrap items-center gap-2 pt-3">
            <UiButton onClick={onOpenDiagnostics}>Diagnostics →</UiButton>
          </div>
        )}

        {view.unsupportedBelow !== undefined && (
          <InlineNotice className="mt-3">
            {unsupportedBelowWords(view.unsupportedBelow)}
          </InlineNotice>
        )}

        {notApplied !== null && (
          // AU-G7 (LC-34) — said on the launch right after the install that didn't take, and only then
          <InlineNotice className="mt-3">
            <div data-updates-not-applied="">{notApplied.text}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {!notApplied.ready && (
                <UiButton disabled={held || view.phase === "checking"} onClick={onCheck}>
                  Check for updates
                </UiButton>
              )}
              <UiButton onClick={onOpenDiagnostics}>Diagnostics →</UiButton>
            </div>
          </InlineNotice>
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
          <InlineNotice role="alert" className="mt-3">
            <span className="font-medium">{flow.words.message}.</span> {flow.words.detail}
          </InlineNotice>
        )}
      </section>

      <section className={borderCls}>
        <SettingsRow
          title="Automatic updates"
          description={view.enabled ? AUTOMATIC_UPDATES_LINES.on : AUTOMATIC_UPDATES_LINES.off}
        >
          <SettingsSwitch
            label="Automatic updates"
            checked={view.enabled}
            disabled={busy || restarting || moving}
            onChange={(checked) => onSetEnabled?.(checked)}
          />
        </SettingsRow>
        <SettingsRow
          title="Channel"
          description={
            channelLowered
              ? `This build is ${view.buildChannel}; the next ${view.channel} release replaces it.`
              : UPDATE_CHANNEL_LINES[pendingChannel ?? view.channel]
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
      </section>

      {error !== null && (
        <InlineNotice role="alert">
          VibeField couldn't reach its updater: {error}. Reopen Settings; if it stays, see
          Diagnostics.
        </InlineNotice>
      )}

      <div className="flex flex-wrap items-center gap-3 px-1" data-updates-foot="">
        <UiButton onClick={onOpenDiagnostics}>Updater diagnostics →</UiButton>
        <span className={labelCls}>Plugins update from Settings → Plugins.</span>
      </div>
    </div>
  );
}

/** C2 — the consent from Settings: the snapshot's own words (main's, the same the tray's box and the Me menu's
 * question say) and a two-step destructive act in red text. Cancel leads and holds focus (LC-9, LC-44): nothing ends
 * by accident, and the act trails. */
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
      className="vf-profiles-confirm-box mt-3"
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
        <UiButton ref={cancel} disabled={busy} onClick={onCancel}>
          Cancel
        </UiButton>
        <UiButton variant="danger" disabled={busy} onClick={onConfirm}>
          {words.confirm}
        </UiButton>
      </div>
    </fieldset>
  );
}

/** EDP-36 — a lower channel is a downgrade, and the page says so before it takes. */
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

/** Settings → Updates (AU-3; first in Support). Reads the projection main publishes in `desktopState.update` and asks
 * through `getHost().updates`; absent either, the page says no updater runs here. The devices beside it are a
 * controller of their own (`UpdatesDevicesSection`), so this half works with fieldd broken (EDP §11.3). */
export function UpdatesSection({
  desktopState = null,
  onOpenDiagnostics,
}: {
  desktopState?: DesktopShellState | null;
  /** Settings → Diagnostics, where the updater's doctor lines are */
  onOpenDiagnostics?: (() => void) | undefined;
}): ReactElement {
  const host = getHost().updates;
  const view = host === undefined ? null : (desktopState?.update ?? null);
  const stagedVersion = view?.phase === "staged" ? view.version : undefined;
  const { flow, error, restart, confirm, cancel, setFlow, setError } = useUpdateRestart(
    host,
    stagedVersion,
  );
  const [pendingChannel, setPendingChannel] = useState<UpdateChannel | null>(null);
  const [busy, setBusy] = useState(false);

  const act = useCallback(
    async (run: () => Promise<void>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await run();
      } catch (failure) {
        setError(errorText(failure));
      } finally {
        setBusy(false);
      }
    },
    [setError],
  );

  return (
    <UpdatesSectionView
      view={view}
      now={Date.now()}
      flow={flow}
      pendingChannel={pendingChannel}
      busy={busy}
      error={error}
      // AU-1 (LC-5) — the check answers when it settles, so `busy` ends there; the page does not read the answer
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
      onConfirmRestart={confirm}
      onCancelRestart={cancel}
      // AU-3 (AU-G5, AU-G6) — THIS found version, with updates off or after a skip; a refusal says main's words
      onDownload={() => {
        const version = view?.version;
        if (version === undefined || host === undefined) return;
        setFlow(NO_FLOW);
        void act(async () => {
          const result = await host.download(version);
          if (!result.ok)
            setFlow({
              kind: "refused",
              words: result.words ?? downloadRefusalFallback(result.reason),
            });
        });
      }}
      // AU-7 (AU-G8) — through main's quit gate: a proceed closes the window (the app moves and opens again from
      // Applications), its Cancel brings the page back to rest, a refusal says main's words or the step that didn't
      // happen
      onMoveToApplications={() => {
        if (host === undefined) return;
        setError(null);
        setFlow({ kind: "moving" });
        void (async () => {
          try {
            const result = await host.moveToApplications();
            if (!result.ok)
              setFlow({
                kind: "refused",
                words: result.words ?? moveRefusalFallback(result.reason),
              });
            else if (result.outcome === "cancel") setFlow(NO_FLOW);
          } catch (failure) {
            setFlow(NO_FLOW);
            setError(errorText(failure));
          }
        })();
      }}
      onOpenDiagnostics={onOpenDiagnostics}
      onCopyVersion={(version, from) => copyText(version, COPY_PLACES.settings, from)}
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
