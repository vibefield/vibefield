import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { useIndexStatus } from "../../../history/first-reading";
import type { FieldHost, FieldUserProfile } from "../../../host";
import type { BootView } from "../../machine";
import {
  historySetupPhase,
  historyToShow,
  START_NOW_AFTER_MS,
  waitsForHistory,
} from "../history-line";
import {
  type OnboardingCompletionFlag,
  OnboardingSettingUpPaneView,
  type OnboardingSetupPhase,
} from "../views/setting-up";

/** The welcome's beat (DESIGN.md §6, the hand-over): long enough to read the
 * welcome and its one line. The old Ready pane's 700ms never was — the splash
 * used to stand in for the rest, and now nothing does. */
export const WELCOME_BEAT_MS = 1_400;

/** Setting up's controller (track AO, AO-D2). Three acts, in order:
 *   1. the answers are recorded — `onboarded: true`, the same durable write the
 *      Ready pane made, now as the questions end. The hold releases only on a
 *      recorded answer or the person's "Continue anyway" (W5's honesty: a
 *      wizard that says it finished when nothing was recorded reopens next
 *      launch with no explanation);
 *   2. the desk opens beneath the glass — its line is the boot machine's own
 *      phase and stage (W4), and a desk that cannot open says why and offers
 *      the boot's Retry, as the splash would;
 *   3. once every fact is in — the desk, and History's first pass when history
 *      was brought in (AO-4b: at most 8s past the desk, then Start now) — the
 *      welcome's beat, then the reveal. A second user's end has no welcome
 *      (§6.2): the glass hands over at once. */
export function SettingUpPane({
  profile,
  welcomeName,
  usersUpdate,
  boot,
  onAnswered,
  onReveal,
  onRetryBoot,
  settingsChord,
}: {
  profile: FieldUserProfile;
  /** Null for a second user. */
  welcomeName: string | null;
  usersUpdate: FieldHost["usersUpdate"];
  boot: BootView;
  /** The questions are answered: the document may open behind the glass. */
  onAnswered: (profile?: FieldUserProfile) => void;
  /** The beat is over: the glass leaves and the desk is revealed. */
  onReveal: () => void;
  onRetryBoot: () => void;
  settingsChord: string;
}): ReactElement {
  const [flag, setFlag] = useState<OnboardingCompletionFlag>({ kind: "idle" });
  const [answered, setAnswered] = useState(false);
  const [ready, setReady] = useState(false);

  // 1 — the answers, recorded: once on entry, and again on Try again.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const record = useCallback((): void => {
    if (usersUpdate === undefined) {
      setAnswered(true);
      onAnswered(profile);
      return;
    }
    setFlag({ kind: "writing" });
    usersUpdate({ onboarded: true }).then(
      (updated) => {
        if (!mounted.current) return;
        setFlag({ kind: "idle" });
        setAnswered(true);
        onAnswered(updated);
      },
      (cause: unknown) => {
        if (!mounted.current) return;
        setFlag({
          kind: "failed",
          reason: `${cause instanceof Error ? cause.message : String(cause)} — your field is ready either way.`,
        });
      },
    );
  }, [usersUpdate, onAnswered, profile]);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    record();
  }, [record]);

  // 2 — the desk, as the boot machine reports it.
  const deskReady = boot.phase === "handing-over" || boot.phase === "interactive";
  const desk: OnboardingSetupPhase =
    answered && boot.unavailable !== null
      ? { key: "desk", label: "Your desk", state: "failed", detail: boot.unavailable.reason }
      : deskReady
        ? { key: "desk", label: "Your desk", state: "done" }
        : answered
          ? {
              key: "desk",
              label: "Your desk",
              state: "live",
              ...(boot.stage === "" ? {} : { detail: boot.stage }),
            }
          : { key: "desk", label: "Your desk", state: "waiting" };

  // AO-4b — History's first pass, when history was brought in (AO-D4): its
  // line in the room's own words, heard pushed, and waited for — but never
  // more than 8s past the desk, when Start now goes on without it.
  const index = useIndexStatus();
  const history = historyToShow(index) ? historySetupPhase(index) : null;
  const waiting = waitsForHistory(index);
  const [slow, setSlow] = useState(false);
  const [startNow, setStartNow] = useState(false);
  useEffect(() => {
    if (!deskReady || !waiting) return;
    const timer = setTimeout(() => setSlow(true), START_NOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [deskReady, waiting]);
  const factsIn = answered && deskReady && (!waiting || startNow);

  // 3 — every fact in: the welcome's beat, then the reveal.
  useEffect(() => {
    if (!factsIn) return;
    if (welcomeName === null) {
      onReveal();
      return;
    }
    setReady(true);
    const timer = setTimeout(onReveal, WELCOME_BEAT_MS);
    return () => clearTimeout(timer);
  }, [factsIn, welcomeName, onReveal]);

  return (
    <OnboardingSettingUpPaneView
      phases={history === null ? [desk] : [desk, history]}
      name={welcomeName}
      ready={ready}
      flag={flag}
      onRetryWrite={record}
      onContinueAnyway={() => {
        setFlag({ kind: "idle" });
        setAnswered(true);
        onAnswered(profile);
      }}
      onRetryPhase={onRetryBoot}
      onStartNow={slow && waiting && !startNow ? () => setStartNow(true) : undefined}
      settingsChord={settingsChord}
    />
  );
}
