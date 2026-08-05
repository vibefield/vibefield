import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider, useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, useEffect, useState } from "react";
import { AccentChip, AccentPicker, type AccentSlot } from "../../account/AccentPicker";
import { hasLink, linkFace, readableTime, type UserLinkStatus } from "../../account/link";
import { POSTURE_CHOICES, useSyncPosture } from "../../account/posture";
import { type FieldUserProfile, getHost } from "../../host";
import type { BootOnboarding } from "../machine";
import {
  eyebrowCls,
  factCls,
  primaryCls,
  quietCls,
  SkipAction,
  voiceCls,
  WizardError,
  WizardPane,
  WizardStyles,
} from "./wizard-ui";

// The Setup Assistant (UA-3w; spec §6). Held open by the boot machine between
// a warm daemon and an open document, and closed by the only thing that may
// close it: a durable `onboarded: true`.
//
// The laws it implements, and where each one lives:
//   W1 one decision per pane          — the Pane union below; nothing asks twice.
//   W2 the mandatory core is a name   — pane 2 pre-fills it and Continue never
//                                       validates; an empty box keeps the
//                                       pre-filled name rather than blocking.
//   W3 everything else is skippable   — SkipAction, whose subtitle names the
//                                       later home verbatim.
//   W4 honest progress only           — pane 3 lists the stages this boot
//                                       ACTUALLY passed (machine.onboarding
//                                       .stagesDone) and says the rest is
//                                       already running behind the window.
//   W5 it ends inside the product     — the last act is a write, then the boot
//                                       machine carries on to the real field.
//   W6 position derives from facts    — `entryPane` reads users.json fields and
//                                       the link snapshot. There is no wizard
//                                       state store, so quitting and relaunching
//                                       lands on the first incomplete pane by
//                                       construction, not by memory.

/** One beat on the setting-up pane. Long enough to read two finished stages,
 * short enough that a warm machine never feels detained. */
const SETTING_UP_BEAT_MS = 900;
/** One beat on Ready before the flag write — the sentence lands, then it goes. */
const READY_BEAT_MS = 700;
/** How long a RESUMING wizard waits for the link snapshot before deciding
 * where to land. A silent daemon must not park the user on a blank pane, so
 * the derivation proceeds with "no link known" once this elapses. */
const ENTRY_SETTLE_MS = 1_200;

type Pane = "welcome" | "welcome-back" | "field" | "setting-up" | "connect" | "posture" | "ready";

export function OnboardingWizard({
  client,
  onboarding,
  onComplete,
}: {
  client: FielddClient;
  onboarding: BootOnboarding;
  onComplete: () => void;
}): ReactElement {
  return (
    <FielddProvider client={client}>
      <WizardBody onboarding={onboarding} onComplete={onComplete} />
      <WizardStyles />
    </FielddProvider>
  );
}

function WizardBody({
  onboarding,
  onComplete,
}: {
  onboarding: BootOnboarding;
  onComplete: () => void;
}): ReactElement {
  const usersUpdate = getHost().usersUpdate;
  const [profile, setProfile] = useState<FieldUserProfile>(onboarding.profile);
  // A field a version-skewed writer set, never a schema field (host.ts).
  const migrated = profile.setupVariant === "migrated";

  const link = useSubscription<UserLinkStatus>("user.link.subscribe");
  const face = linkFace(link.status, link.status === "live" ? (link.data ?? null) : null);
  const linked = hasLink(face);

  // W6 — the entry pane is DERIVED. A record with no color never finished pane
  // 2, so the wizard starts at the top; a record with one did, so it resumes at
  // the first thing still unanswered.
  const [pane, setPane] = useState<Pane | null>(() =>
    profile.color === undefined ? (migrated ? "welcome-back" : "welcome") : null,
  );
  const [history, setHistory] = useState<Pane[]>([]);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (pane !== null) return;
    const timer = setTimeout(() => setSettled(true), ENTRY_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [pane]);

  useEffect(() => {
    if (pane !== null) return;
    if (link.status === "loading" && !settled) return; // one honest beat, bounded
    // Migration's only remaining pane after the name is Ready — its link, if
    // there is one, is acknowledged rather than re-asked (spec §6, migration).
    setPane(migrated ? "ready" : linked ? "posture" : "connect");
  }, [pane, link.status, settled, migrated, linked]);

  // Plain forward/back over panes. This is the ONLY position state in the
  // wizard and it lives for exactly as long as the window does — where you
  // resume comes from users.json, never from here (W6).
  const go = (next: Pane): void => {
    if (pane !== null) setHistory((stack) => [...stack, pane]);
    setPane(next);
  };
  const back = (): void => {
    const previous = history[history.length - 1];
    if (previous === undefined) return;
    setPane(previous);
    setHistory((stack) => stack.slice(0, -1));
  };
  const canGoBack = history.length > 0;

  // Pane 3 auto-advances: it reports work that is already done, so it is a
  // beat, not a gate.
  useEffect(() => {
    if (pane !== "setting-up") return;
    const timer = setTimeout(() => {
      setHistory((stack) => [...stack, "setting-up"]);
      setPane("connect");
    }, SETTING_UP_BEAT_MS);
    return () => clearTimeout(timer);
  }, [pane]);

  // The last act. The flag is written FIRST and the hold released only on
  // success — a wizard that says it finished when nothing was recorded would
  // reopen next launch with no explanation.
  const [flag, setFlag] = useState<
    { kind: "idle" } | { kind: "writing" } | { kind: "failed"; reason: string }
  >({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (pane !== "ready") return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        if (usersUpdate === undefined) {
          onComplete();
          return;
        }
        setFlag({ kind: "writing" });
        usersUpdate({ onboarded: true })
          .then(() => {
            if (!cancelled) onComplete();
          })
          .catch((cause: unknown) => {
            if (cancelled) return;
            setFlag({
              kind: "failed",
              reason: `${cause instanceof Error ? cause.message : String(cause)} — your field is ready either way.`,
            });
          });
      },
      attempt === 0 ? READY_BEAT_MS : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pane, attempt, usersUpdate, onComplete]);

  const shell = (content: ReactElement): ReactElement => (
    <div className="flex h-full w-full items-center justify-center p-10">{content}</div>
  );

  if (pane === null) {
    // Deriving. A fact, not a spinner (§8: a state is rendered, never blank).
    return shell(
      <div className="vf-wizard-pane w-[min(92vw,30rem)]">
        <span className={eyebrowCls}>Setup</span>
        <p className={`mt-2 ${factCls}`}>Reading what this field already knows…</p>
      </div>,
    );
  }

  const backAction = canGoBack ? (
    <button type="button" className={quietCls} onClick={back}>
      Back
    </button>
  ) : null;

  switch (pane) {
    case "welcome":
      return shell(
        <WizardPane
          eyebrow="VibeField"
          title="A field of your own."
          voice="Terminals, agents and notes on one canvas — running on this machine, for as long as you leave it running."
          actions={
            <button type="submit" className={primaryCls}>
              Continue
            </button>
          }
          onSubmit={() => go("field")}
        />,
      );

    case "welcome-back":
      return shell(
        <WizardPane
          eyebrow="VibeField"
          title="Your field now lives in a user."
          voice="Everything you had is exactly where you left it — it just moved under a user, so this machine can hold more than one. Two questions and you are back."
          actions={
            <button type="submit" className={primaryCls}>
              Continue
            </button>
          }
          onSubmit={() => go("field")}
        />,
      );

    case "field":
      return shell(
        <FieldPane
          profile={profile}
          usersUpdate={usersUpdate}
          back={backAction}
          onDone={(updated) => {
            setProfile(updated);
            go(migrated ? "ready" : "setting-up");
          }}
        />,
      );

    case "setting-up":
      return shell(
        <WizardPane
          eyebrow="Setting up"
          title="Your field is already running."
          voice="Nothing to wait for — this all happened while you were reading."
          actions={
            <button type="submit" className={primaryCls}>
              Continue
            </button>
          }
          onSubmit={() => go("connect")}
        >
          <ul className="flex flex-col gap-1.5">
            {onboarding.stagesDone.map((stage) => (
              <li key={stage} className={`flex items-center gap-2 ${factCls}`}>
                <span aria-hidden="true" style={{ color: "var(--vf-green)" }}>
                  ✓
                </span>
                {stage}
              </li>
            ))}
          </ul>
        </WizardPane>,
      );

    case "connect":
      return shell(
        <ConnectPane
          face={face}
          back={backAction}
          onContinue={() => go(linked ? "posture" : "ready")}
          onSkip={() => go("ready")}
        />,
      );

    case "posture":
      return shell(<PosturePane back={backAction} onDone={() => go("ready")} />);

    case "ready":
      return shell(
        <WizardPane
          eyebrow="Ready"
          title={`Welcome to your field, ${profile.name}.`}
          voice="Everything from here is the real thing."
          actions={
            flag.kind === "failed" ? (
              <>
                <button type="submit" className={primaryCls}>
                  Try again
                </button>
                <button type="button" className={quietCls} onClick={onComplete}>
                  Continue anyway
                </button>
              </>
            ) : null
          }
          // Only a FAILED write is retryable. While one is in flight this pane
          // has no action at all, so a stray Enter cannot start a second.
          onSubmit={() => {
            if (flag.kind === "failed") setAttempt((n) => n + 1);
          }}
        >
          {flag.kind === "failed" && (
            <div className="flex flex-col gap-1">
              <WizardError reason={`Setup could not be recorded. ${flag.reason}`} />
              <span className={factCls}>
                Continuing without it means setup asks again next time.
              </span>
            </div>
          )}
        </WizardPane>,
      );
  }
}

/** Pane 2 — the one mandatory decision, and the only write the wizard needs to
 * make before it can call anything set up. */
function FieldPane({
  profile,
  usersUpdate,
  back,
  onDone,
}: {
  profile: FieldUserProfile;
  usersUpdate: ReturnType<typeof getHost>["usersUpdate"];
  back: ReactElement | null;
  onDone: (updated: FieldUserProfile) => void;
}): ReactElement {
  const [name, setName] = useState(profile.name);
  // Preselected, so Continue always writes both fields — and so `color`'s
  // presence is a trustworthy "pane 2 was completed" fact for W6.
  const [accent, setAccent] = useState<AccentSlot | string>(profile.color ?? "accent-1");
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = (): void => {
    if (writing) return;
    if (usersUpdate === undefined) {
      onDone(profile);
      return;
    }
    // W2 — never blocked by validation. An empty box keeps the name we came in
    // with rather than refusing to move.
    const trimmed = name.trim();
    setWriting(true);
    setError(null);
    void usersUpdate({ name: trimmed.length > 0 ? trimmed : profile.name, color: accent })
      .then((updated) => onDone(updated))
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setWriting(false);
      });
  };

  return (
    <WizardPane
      eyebrow="Your field"
      title="What should this field call you?"
      voice="A name and a color for this machine's user. Both are yours to change later."
      onSubmit={commit}
      actions={
        <>
          <button type="submit" className={primaryCls} disabled={writing}>
            {writing ? "Saving…" : "Continue"}
          </button>
          {back}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className={eyebrowCls}>Name</span>
          <input
            type="text"
            aria-label="Your name"
            value={name}
            disabled={writing}
            // This pane exists to collect one field, so the keyboard starts in
            // it — the wizard is operable without ever reaching for a pointer.
            autoFocus
            onChange={(event) => setName(event.target.value)}
            className="h-11 rounded-[12px] border border-black/10 bg-white px-3.5 text-[15px] text-black/85 outline-none transition-[border-color,box-shadow] placeholder:text-black/30 focus:border-black/25 focus:shadow-[0_0_0_3px_rgba(0,0,0,0.05)] motion-reduce:transition-none disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.06] dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-white/25 dark:focus:shadow-[0_0_0_3px_rgba(255,255,255,0.07)]"
          />
        </label>
        <div className="flex flex-col gap-2">
          <span className={eyebrowCls}>Color</span>
          <AccentPicker
            value={accent}
            disabled={writing}
            name="vf-wizard-accent"
            className="flex flex-wrap gap-2"
            onSelect={(slot) => setAccent(slot)}
          />
          <AccentChip accent={accent} label={name} className="self-start" />
        </div>
        {error !== null && <WizardError reason={`That did not save. ${error}`} />}
      </div>
    </WizardPane>
  );
}

/** Pane 4 — the mesh, in plain words, with the honest state of this device's
 * node. There is no "start linking" verb in the daemon today (only get /
 * subscribe / unlink), so the action here IS the node's own sign-in address the
 * moment it offers one — never a button that pretends to do something. */
function ConnectPane({
  face,
  back,
  onContinue,
  onSkip,
}: {
  face: ReturnType<typeof linkFace>;
  back: ReactElement | null;
  onContinue: () => void;
  onSkip: () => void;
}): ReactElement {
  let body: ReactElement;
  let primary: ReactElement | null = null;

  switch (face.kind) {
    case "loading":
      body = <p className={factCls}>Asking this device about its node…</p>;
      break;
    case "unavailable":
      body = (
        <p className={factCls}>
          This daemon does not report link status, so there is nothing to connect from here.
          Everything local keeps working.
        </p>
      );
      break;
    case "mesh-off":
      body = (
        <div className="flex flex-col gap-1.5">
          <p className={factCls}>
            Mesh networking is off on this device. It is enabled by environment today (
            <span className="font-mono">FIELD_NATIVE_MESH</span>), so there is nothing to link yet.
          </p>
          {face.link !== null && (
            <p className={factCls}>
              A link is already on file for {face.link.login ?? "this device"} — it takes effect
              when the mesh is enabled.
            </p>
          )}
        </div>
      );
      break;
    case "authenticating":
      primary = (
        <a
          href={face.authUrl}
          target="_blank"
          rel="noreferrer"
          className={primaryCls}
          // A link that looks like the pane's action should answer to the
          // keyboard like one.
        >
          Link Tailscale account
        </a>
      );
      body = (
        <p className={factCls}>
          Finish signing in in your browser. This pane names the account as soon as the node comes
          up — you can also carry on and let it land in the background.
        </p>
      );
      break;
    case "linked":
      body = (
        <div className="flex flex-col gap-1.5">
          <p className={voiceCls}>
            Linked as <span className="font-medium">{face.link.login ?? "this device"}</span>
            {face.link.tailnet !== undefined && (
              <>
                {" on "}
                <span className="font-mono text-[13px]">{face.link.tailnet}</span>
              </>
            )}
            .
          </p>
          <p className={factCls}>
            <span className="tabular-nums">{readableTime(face.link.linkedAt)}</span>
            {face.nodeState !== null && ` · node ${face.nodeState}`}
          </p>
        </div>
      );
      break;
    default:
      body = (
        <p className={factCls}>
          This device's node has not offered a sign-in address yet
          {face.nodeState !== null && ` (node ${face.nodeState})`}. When it does, it appears here.
        </p>
      );
  }

  return (
    <WizardPane
      eyebrow="Your devices"
      title="Connect your devices."
      voice="Your devices, your tailnet — nobody else's. Everything here works locally without it; linking is what lets your other machines see the same field."
      onSubmit={onContinue}
      actions={
        <>
          {primary}
          <button type="submit" className={primary === null ? primaryCls : quietCls}>
            Continue
          </button>
          <SkipAction label="Skip" onSkip={onSkip} />
          {back}
        </>
      }
    >
      {body}
    </WizardPane>
  );
}

/** The posture question — the same two cards, the same words, the same key as
 * Settings → Account (they share `POSTURE_CHOICES` and `useSyncPosture`). */
function PosturePane({
  back,
  onDone,
}: {
  back: ReactElement | null;
  onDone: () => void;
}): ReactElement {
  const posture = useSyncPosture();
  const locked = posture.unavailable || posture.pending;

  return (
    <WizardPane
      eyebrow="Your devices"
      title="What should new projects do?"
      voice="This is only the default for new documents. Any single one can go the other way afterwards."
      onSubmit={onDone}
      actions={
        <>
          <button type="submit" className={primaryCls}>
            Continue
          </button>
          <SkipAction label="Skip" onSkip={onDone} />
          {back}
        </>
      }
    >
      <div role="radiogroup" aria-label="Sync posture" className="grid gap-2 sm:grid-cols-2">
        {POSTURE_CHOICES.map((card) => {
          const selected = posture.posture === card.value;
          return (
            <label
              key={card.value}
              className={`rounded-[14px] border p-3 text-left transition-[background-color,border-color,transform] focus-within:ring-2 focus-within:ring-[var(--vf-select)] motion-reduce:transition-none ${
                selected
                  ? "border-black/25 bg-black/[0.04] dark:border-white/30 dark:bg-white/[0.08]"
                  : "border-black/10 hover:bg-black/[0.02] dark:border-white/10 dark:hover:bg-white/[0.04]"
              } ${locked ? "cursor-not-allowed opacity-45" : "cursor-pointer active:scale-[0.99]"}`}
            >
              <input
                type="radio"
                name="vf-wizard-posture"
                className="sr-only"
                checked={selected}
                disabled={locked}
                onChange={() => void posture.set(card.value)}
              />
              <div className="text-[13px] font-medium leading-5 text-black/80 dark:text-white/80">
                {card.title}
              </div>
              <div className={`mt-0.5 ${factCls}`}>{card.description}</div>
            </label>
          );
        })}
      </div>
      {posture.unavailable && posture.status !== "loading" && (
        <p className={factCls}>
          This daemon is not reporting preferences, so the answer cannot be saved from here yet.
        </p>
      )}
      {posture.writeError !== null && <WizardError reason={posture.writeError} />}
    </WizardPane>
  );
}
