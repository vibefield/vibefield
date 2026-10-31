import type { UpdateConsentWords } from "@vibefield/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FieldUpdatesHost } from "../host";
import { refusalFallback } from "./update-words";

// AU-3 (LC-30; AU-L4) — the restart's two phases, shared: Settings → Updates and the Me menu's update row (AU-2) run
// the SAME prepare and confirm (C2), so a question, a refusal and an expired snapshot read alike on both. Moved out of
// `UpdatesSection` whole: Restart takes ONE snapshot of the sessions an update ends, and only the second, red click
// acts on it — DESIGN.md's two-step destructive confirm, in main's words.

/** Where a restart's two-phase apply stands. The token stays with the controller; the view never holds it. */
export type UpdatesFlow =
  | { readonly kind: "none" }
  | { readonly kind: "preparing" }
  | { readonly kind: "consent"; readonly version: string; readonly words: UpdateConsentWords }
  | {
      readonly kind: "confirming";
      /** AU-2 — the question being confirmed, so the Me menu keeps it drawn (busy) until main answers; absent when
       * nothing ends and nothing was asked */
      readonly words?: UpdateConsentWords;
    }
  | { readonly kind: "restarting" }
  /** AU-7 — Move to Applications asked; the quit gate answers (a Cancel brings the page back to rest) */
  | { readonly kind: "moving" }
  | {
      readonly kind: "refused";
      readonly words: { readonly message: string; readonly detail: string };
    };

export const NO_FLOW: UpdatesFlow = { kind: "none" };

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export interface UpdateRestart {
  readonly flow: UpdatesFlow;
  /** the bridge itself failed (a door threw): said under the page, with what to do */
  readonly error: string | null;
  /** C2's first phase: ONE snapshot; a release that ends nothing confirms on the same click */
  restart(): Promise<void>;
  /** C2's second phase, on the snapshot the consent shows */
  confirm(): void;
  /** the person's Cancel (or Escape): the snapshot and its question go */
  cancel(): void;
  /** drop the token alone, so nothing can confirm a question no longer shown (the Me menu folding) */
  dropToken(): void;
  /** back to rest: the token, the flow and the error */
  reset(): void;
  setFlow(next: UpdatesFlow): void;
  setError(error: string | null): void;
}

/** The restart's controller over the host's doors. `stagedVersion` is the version the view says is staged: a consent
 * and a refusal belong to it, and go when it goes. */
export function useUpdateRestart(
  host: FieldUpdatesHost | undefined,
  stagedVersion: string | undefined,
): UpdateRestart {
  const [flow, setFlow] = useState<UpdatesFlow>(NO_FLOW);
  const [error, setError] = useState<string | null>(null);
  const token = useRef<string | null>(null);
  /** the consent's words, beside its token: what a confirm is confirming */
  const asked = useRef<UpdateConsentWords | null>(null);

  // A consent and a refusal belong to the staged version they were about: when that version goes (declined, replaced,
  // applied elsewhere), so do they — main would answer `expired` anyway, but the page never shows a stale list.
  const seenVersion = useRef(stagedVersion);
  useEffect(() => {
    if (seenVersion.current === stagedVersion) return;
    seenVersion.current = stagedVersion;
    setFlow((current) =>
      current.kind === "consent" || current.kind === "refused" ? NO_FLOW : current,
    );
    token.current = null;
    asked.current = null;
  }, [stagedVersion]);

  const confirmWith = useCallback(
    async (prepared: string, words?: UpdateConsentWords): Promise<void> => {
      if (host === undefined) return;
      setFlow(words === undefined ? { kind: "confirming" } : { kind: "confirming", words });
      try {
        const result = await host.confirmRestart(prepared);
        setFlow(
          result.ok
            ? { kind: "restarting" }
            : { kind: "refused", words: result.words ?? refusalFallback(result.reason) },
        );
      } catch (failure) {
        setFlow(NO_FLOW);
        setError(errorText(failure));
      } finally {
        token.current = null;
        asked.current = null;
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
        await confirmWith(prepared.token);
        return;
      }
      token.current = prepared.token;
      asked.current = prepared.consent;
      setFlow({ kind: "consent", version: prepared.version, words: prepared.consent });
    } catch (failure) {
      setFlow(NO_FLOW);
      setError(errorText(failure));
    }
  }, [host, confirmWith]);

  const confirm = useCallback((): void => {
    const prepared = token.current;
    if (prepared !== null) void confirmWith(prepared, asked.current ?? undefined);
  }, [confirmWith]);

  const cancel = useCallback((): void => {
    token.current = null;
    asked.current = null;
    setFlow(NO_FLOW);
  }, []);

  const dropToken = useCallback((): void => {
    token.current = null;
  }, []);

  const reset = useCallback((): void => {
    token.current = null;
    asked.current = null;
    setFlow(NO_FLOW);
    setError(null);
  }, []);

  return { flow, error, restart, confirm, cancel, dropToken, reset, setFlow, setError };
}
