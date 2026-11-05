import type { BrowserDataClearResult, DesktopBrowserSignIns } from "@vibefield/contracts";
import { InlineNotice, UiButton, UnavailableState } from "@vibefield/design-kit";
import { type ReactElement, useCallback, useState } from "react";
import { getHost } from "../host";
import { labelCls, SettingsRow, SettingsSection } from "./settings-ui";

// BP-D4 (thinking-browser-profile.md §3·3, 2026-10-26) — Settings › General's "Clear browsing data". Every desk page shares
// one browser profile (PT-4 ruling 3), and main owns it. This card asks main to clear it through its one door
// (`host.browserData`), then says what came back, in counts. DESIGN.md's two-step destructive confirm: only the second,
// red click acts.
//
// BP-1c (BP-D9 (a), thinking-browser-profile.md §3·8) — and it says, honestly, when this desktop's browser cannot keep a
// sign-in across a restart (`DesktopShellState.browser.signIns`, main's check at start): its profiles lie outside the
// folder Chromium saves cookies to, so sites stay signed in only until VibeField quits. Nothing is refused; the clear
// still clears.

/** BP-1c — the honest state's words, when the desktop says its browser keeps sign-ins only until VibeField quits
 * (DESIGN.md §9: what happened, then what to do next). Only a copy started with its data set apart from its browser's
 * folder meets it; a packaged VibeField on its own folders never does. */
export const SIGN_INS_UNTIL_QUIT = {
  title: "The desk browser can't keep sign-ins here",
  description:
    "Sites on your desk stay signed in only until VibeField quits. This copy keeps its data outside its browser's own folder, and the browser saves sign-ins to disk only inside it. To keep them, start VibeField with its data inside that folder; the log in Settings › Diagnostics names both.",
} as const;

/** Where the card's clear stands. */
export type BrowserDataFlow =
  | { readonly kind: "idle" }
  | { readonly kind: "confirm" }
  | { readonly kind: "clearing" }
  | { readonly kind: "cleared"; readonly result: BrowserDataClearResult }
  | { readonly kind: "failed"; readonly message: string };

const IDLE: BrowserDataFlow = { kind: "idle" };

/** What a clear's answer is said in: main's counts, never more than they say. */
export function clearedWords(result: BrowserDataClearResult): string {
  if (result.profiles === 0)
    return "Nothing to clear: no page on your desk has stored anything yet.";
  const pages =
    result.pages === 0
      ? ""
      : result.pages === 1
        ? " · 1 open page reloaded"
        : ` · ${result.pages} open pages reloaded`;
  return `Cleared: every site on your desk is signed out${pages}.`;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The card, controller-free: what the clear is doing and where each act goes. */
export function BrowserDataSectionView({
  available,
  signIns,
  flow = IDLE,
  onClear,
  onConfirm,
  onCancel,
}: {
  /** a desktop shell answers the door (absent in a browser harness) */
  available: boolean;
  /** BP-1c — whether the desktop's browser keeps sign-ins across a restart, as main found it; absent: it said nothing */
  signIns?: DesktopBrowserSignIns | undefined;
  flow?: BrowserDataFlow;
  onClear: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  const clearing = flow.kind === "clearing";
  const asking = flow.kind === "confirm" || clearing;
  return (
    <SettingsSection
      title="Browsing data"
      description="The pages on your desk share one browser. Its cookies, site storage and cache stay on this Mac."
    >
      {signIns === "until-quit" && (
        <UnavailableState
          compact
          className="mb-3"
          title={SIGN_INS_UNTIL_QUIT.title}
          description={SIGN_INS_UNTIL_QUIT.description}
        />
      )}
      <SettingsRow
        title="Clear browsing data"
        description={
          available
            ? "Signs you out of every site on your desk, and reloads the pages that are open."
            : "Unavailable here: no desktop shell answers this window."
        }
        divider={false}
      >
        {asking ? (
          <div className="flex items-center gap-2">
            <UiButton variant="danger" disabled={clearing} onClick={onConfirm}>
              {clearing ? "Clearing…" : "Clear and sign out"}
            </UiButton>
            <UiButton disabled={clearing} onClick={onCancel}>
              Cancel
            </UiButton>
          </div>
        ) : (
          <UiButton disabled={!available} onClick={onClear}>
            Clear browsing data…
          </UiButton>
        )}
      </SettingsRow>
      {flow.kind === "cleared" && (
        <p role="status" className={`mt-2 ${labelCls}`}>
          {clearedWords(flow.result)}
        </p>
      )}
      {flow.kind === "failed" && (
        <InlineNotice role="alert" className="mt-3">
          {flow.message}
        </InlineNotice>
      )}
    </SettingsSection>
  );
}

/** Settings › General's browsing-data card on its controller: one door, one flow; `signIns` is the desktop's word (BP-1c). */
export function BrowserDataSection({
  signIns,
}: {
  signIns?: DesktopBrowserSignIns | undefined;
} = {}): ReactElement {
  const door = getHost().browserData;
  const [flow, setFlow] = useState<BrowserDataFlow>(IDLE);
  const confirm = useCallback(async () => {
    if (door === undefined) return;
    setFlow({ kind: "clearing" });
    try {
      setFlow({ kind: "cleared", result: await door.clear() });
    } catch (error) {
      setFlow({
        kind: "failed",
        message: `Browsing data was not cleared: ${errorText(error)}. Try again; the desktop's log says why it failed (Settings › Diagnostics).`,
      });
    }
  }, [door]);
  return (
    <BrowserDataSectionView
      available={door !== undefined}
      signIns={signIns}
      flow={flow}
      onClear={() => setFlow({ kind: "confirm" })}
      onConfirm={() => void confirm()}
      onCancel={() => setFlow(IDLE)}
    />
  );
}
