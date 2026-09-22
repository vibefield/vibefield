import { UserFaceView } from "@vibefield/design-kit/face";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { FacePicker } from "../account/FacePicker";
import { faceLabel, faceOf, heldFaces } from "../account/faces";
import {
  LINK_ACT_LABEL,
  LINK_ACT_PENDING_LABEL,
  type LinkBeginStep,
  linkFace,
  readableTime,
  type UserLinkStatus,
} from "../account/link";
import { POSTURE_CHOICES, useSyncPosture } from "../account/posture";
import { UserSwitcher } from "../account/UserSwitcher";
import { accountChanged } from "../account/use-account";
import { type FieldUserFace, type FieldUserProfile, getHost } from "../host";
import {
  buttonCls,
  fieldCls,
  labelCls,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "./settings-ui";

// The Account surface (UA-3; spec §6.3) — the Setup Assistant's permanent home.
// Everything the wizard asks lives on here, and the two skins drive the same
// machinery: `usersUpdate` for the profile, the §7.1 link flow, the posture
// preference. Since UA-3w that is literal — the shared pieces live in
// `src/account/` and the wizard imports the same ones.
//
// Two owners, deliberately not one. Profile and residency are SUPERVISOR facts
// (`users.json`, UA-D10) and travel over the host bridge, because main is the
// only writer. Posture is a fieldd user-scope preference and travels over the
// product socket like every other preference. The page does not hide that split
// — a device with a working daemon and no supervisor bridge shows exactly which
// half is reachable, rather than greying out the lot.

/** How the profile half of the page currently reads. `loading` is the honest
 * first beat: the record is read through the same door that writes it. */
type ProfileState =
  | { kind: "unavailable" }
  | { kind: "loading" }
  | { kind: "ready"; profile: FieldUserProfile }
  | { kind: "failed"; reason: string };

export function AccountSection({
  onSettingsChanged,
}: {
  onSettingsChanged?: (undoable: boolean) => void;
} = {}): ReactElement {
  // Same shape as every other host capability (DiagnosticsSection:187): read it
  // once, and let `undefined` mean "this build cannot do that" out loud.
  const usersUpdate = getHost().usersUpdate;
  const usersList = getHost().usersList;
  const [profile, setProfile] = useState<ProfileState>(
    usersUpdate === undefined ? { kind: "unavailable" } : { kind: "loading" },
  );
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The face just chosen, shown while its write is in flight; null = the
  // stored one. And the writes themselves, one at a time (`chooseFace`).
  const [faceDraft, setFaceDraft] = useState<FieldUserFace | null>(null);
  const faceWrites = useRef<{ inFlight: boolean; next: FieldUserFace | null }>({
    inFlight: false,
    next: null,
  });
  // UA-D17 — who else is here decides which faces are free (I-2). Read once,
  // and again after every write, through the roster door the switcher uses.
  const [roster, setRoster] = useState<readonly FieldUserProfile[]>([]);
  const [rosterGeneration, setRosterGeneration] = useState(0);

  useEffect(() => {
    if (usersList === undefined) return;
    let cancelled = false;
    void usersList().then(
      (snapshot) => {
        if (!cancelled) setRoster(snapshot.users);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [usersList, rosterGeneration]);

  // An EMPTY update is the read (host.ts): the seam answers with the whole
  // record, so asking it to change nothing is how this page learns the user it
  // is about to edit. There is no separate read method to keep in step.
  useEffect(() => {
    if (usersUpdate === undefined) return;
    let cancelled = false;
    void usersUpdate({})
      .then((current) => {
        if (!cancelled) setProfile({ kind: "ready", profile: current });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setProfile({
          kind: "failed",
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [usersUpdate]);

  const write = async (params: {
    name?: string;
    face?: FieldUserFace;
    resident?: boolean;
  }): Promise<void> => {
    if (usersUpdate === undefined) return;
    setWriting(true);
    setWriteError(null);
    try {
      const updated = await usersUpdate(params);
      setProfile({ kind: "ready", profile: updated });
      setNameDraft(null);
      setRosterGeneration((n) => n + 1);
      // The corner and the head of Settings re-read: the face changes there
      // the moment it changes here.
      accountChanged();
      onSettingsChanged?.(false);
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWriting(false);
    }
  };

  /** Every choice writes (UA-D17), and writes never overlap: a choice made
   * while one is in flight waits, and only the LATEST waiting one is written.
   * The deck stays enabled throughout — disabling it would drop focus from the
   * radio an arrow key just moved to, since a disabled control cannot hold it,
   * and a keyboard user would get one step per trip back into the deck. */
  const chooseFace = (next: FieldUserFace): void => {
    setFaceDraft(next);
    const queue = faceWrites.current;
    queue.next = next;
    if (queue.inFlight) return;
    queue.inFlight = true;
    void (async () => {
      while (queue.next !== null) {
        const face = queue.next;
        queue.next = null;
        await write({ face });
      }
      queue.inFlight = false;
      setFaceDraft(null);
    })();
  };

  const current = profile.kind === "ready" ? profile.profile : null;
  const editable = current !== null && !writing;
  const name = nameDraft ?? current?.name ?? "";
  // A user with no written face is SHOWN with the machine's deal (UA-D17) —
  // the same one pane 2 proposes and main's silent deal would write.
  const face: FieldUserFace | null = current === null ? null : faceOf(current, roster);

  const commitName = (): void => {
    const next = name.trim();
    if (next.length === 0 || next === current?.name) {
      setNameDraft(null);
      return;
    }
    void write({ name: next });
  };

  return (
    <div className="space-y-4">
      <SettingsSection
        title="Profile"
        description="Your name and face on this machine. They stay on this machine for now — once settings sync between your devices, they will follow your login."
      >
        <SettingsRow
          title="Name"
          description="What this field calls you. Used on the tray, and wherever a session names its owner."
        >
          <input
            type="text"
            className={`${fieldCls} w-56`}
            aria-label="Your name"
            value={name}
            disabled={!editable}
            placeholder={profile.kind === "loading" ? "Reading profile…" : "Your name"}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                setNameDraft(null);
              }
            }}
          />
        </SettingsRow>

        <SettingsRow
          title="Face"
          description="How this machine shows you: in the corner, at the head of Settings, and in the tray. One emoji — a sticker, or a coin if you would rather look issued."
        >
          <div className="flex items-center gap-3">
            {face !== null && current !== null && (
              <UserFaceView
                emoji={face.emoji}
                frame={face.frame}
                size={48}
                seed={current.userId}
                label={faceLabel(current.name, face)}
              />
            )}
            <button
              type="button"
              className={buttonCls}
              disabled={!editable}
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((open) => !open)}
            >
              {pickerOpen ? "Done" : "Change…"}
            </button>
          </div>
        </SettingsRow>
        {pickerOpen && face !== null && current !== null && (
          <div className="pt-3">
            <FacePicker
              value={faceDraft ?? face}
              held={heldFaces(roster, current.userId)}
              name="vf-account-face"
              onChange={chooseFace}
            />
          </div>
        )}

        {current !== null && (
          <div className={`pt-2 ${labelCls}`}>
            <span className="font-mono tabular-nums">user {current.fuid}</span> ·{" "}
            <span className="font-mono">{current.userId}</span>
          </div>
        )}
        {profile.kind === "unavailable" && (
          <div className={`pt-2 ${labelCls}`}>
            Profile editing needs the desktop shell — this window has no supervisor bridge, so your
            name and face cannot be changed from here.
          </div>
        )}
        {profile.kind === "failed" && (
          <div className="pt-2 text-[12px] text-amber-600 dark:text-amber-400">
            Profile unavailable. {profile.reason}
          </div>
        )}
        {writeError !== null && (
          <div className="pt-2 text-[12px] text-amber-600 dark:text-amber-400">{writeError}</div>
        )}
      </SettingsSection>

      {/* Who you are, then who else is here — the switcher reads the same
          supervisor door the Profile block above it writes (UA-5 §6.3). */}
      <UserSwitcher />

      <LinkBlock />

      <SyncPostureSection onSettingsChanged={onSettingsChanged} />

      <SettingsSection
        title="Keep running in background"
        description="Whether this user's daemons stay up when you are not attached."
      >
        <SettingsRow
          title="Keep running in background"
          description="Sessions and agents keep working while this window is closed. Turning it off stops this user's pair once you detach — running sessions end with it."
          divider={false}
        >
          <SettingsSwitch
            label="Keep running in background"
            checked={current?.resident ?? true}
            disabled={!editable}
            onChange={(checked) => void write({ resident: checked })}
          />
        </SettingsRow>
        {profile.kind === "unavailable" && (
          <div className={`pt-2 ${labelCls}`}>
            Residency is a supervisor setting — unavailable without the desktop shell.
          </div>
        )}
      </SettingsSection>
    </div>
  );
}

/** How the unlink affordance reads. Two steps, never one, for the reason the
 * deck's retired kill chip had them (GT-3, gone at GT-6a): the act is
 * irreversible in the one way that matters — a relink is a NEW node identity,
 * never the old one back. */
type UnlinkStep =
  | { kind: "idle" }
  | { kind: "arming" }
  | { kind: "unlinking" }
  | { kind: "failed"; reason: string };

/** UA-P-0g — the act, in this page's chrome. One button, because linking is
 * not the irreversible half: it asks the floor for a node and hands the
 * browser a sign-in, and the subscription takes the face from there. */
function LinkAction({ step, onBegin }: { step: LinkBeginStep; onBegin: () => void }): ReactElement {
  return (
    <div className="flex flex-col items-end gap-2 pt-2">
      {step.kind === "failed" && (
        <div className="text-right text-[12px] text-amber-600 dark:text-amber-400" role="alert">
          {step.reason}
        </div>
      )}
      <button
        type="button"
        className={buttonCls}
        disabled={step.kind === "pending"}
        onClick={onBegin}
      >
        {step.kind === "pending" ? LINK_ACT_PENDING_LABEL : LINK_ACT_LABEL}
      </button>
    </div>
  );
}

function LinkBlock(): ReactElement {
  const client = useFielddClient();
  const status = useSubscription<UserLinkStatus>("user.link.subscribe");
  const [step, setStep] = useState<UnlinkStep>({ kind: "idle" });
  const [beginStep, setBeginStep] = useState<LinkBeginStep>({ kind: "idle" });

  // Esc disarms, consistently (DESIGN.md §7).
  useEffect(() => {
    if (step.kind !== "arming") return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setStep({ kind: "idle" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step.kind]);

  const unlink = async (): Promise<void> => {
    setStep({ kind: "unlinking" });
    try {
      await client.request("user.link.unlink", {});
      setStep({ kind: "idle" });
    } catch (cause) {
      setStep({
        kind: "failed",
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  /** UA-P-0g — the link act. The answer IS a `UserLinkStatus`, and it is
   * deliberately NOT applied here: `user.link.subscribe` is the one thing that
   * moves this face, and a response written into local state could only ever
   * disagree with it. What this step owns is the two things the subscription
   * cannot say — that a click is in flight, and that the daemon refused. */
  const begin = async (): Promise<void> => {
    setBeginStep({ kind: "pending" });
    try {
      await client.request("user.link.begin", {});
      setBeginStep({ kind: "idle" });
    } catch (cause) {
      setBeginStep({
        kind: "failed",
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  // One reading of the snapshot, shared with the Setup Assistant's pane 4.
  const face = linkFace(status.status, status.status === "live" ? (status.data ?? null) : null);

  let body: ReactElement;
  if (face.kind === "loading") {
    body = <div className={labelCls}>Reading link status…</div>;
  } else if (face.kind === "unavailable") {
    // The daemon half of this slice may not be there yet, and a page that
    // crashes on a missing method is worse than one that says so.
    body = (
      <div className={labelCls}>
        Link service unavailable — this daemon does not report link status. Everything local keeps
        working.
      </div>
    );
  } else if (face.kind === "offline") {
    // UA-P-0g — the ordinary unlinked desktop, and the whole point of this
    // slice: before it, this face said the mesh was env-gated and offered
    // nothing, so a fresh install (or anything that pressed Unlink) could
    // never link from the UI at all.
    body = (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className={labelCls}>account</span>
          <span>not linked</span>
        </div>
        {face.nodeState !== null && (
          <div className="flex items-center justify-between gap-2">
            <span className={labelCls}>node</span>
            <span>{face.nodeState}</span>
          </div>
        )}
        <div className={labelCls}>
          This device is offline: no tailnet, no other machines, nothing published. Everything local
          keeps working. Linking signs you in to Tailscale in your browser.
        </div>
        <LinkAction step={beginStep} onBegin={() => void begin()} />
      </div>
    );
  } else if (face.kind === "refused") {
    // The daemon's own sentence, verbatim — it names the file, or the other
    // local user, which is the only part that makes the refusal actionable.
    body = (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className={labelCls}>account</span>
          <span className="vf-ui-tone-attention">{face.title}</span>
        </div>
        <div className={labelCls}>{face.detail}</div>
        {face.canBegin ? (
          <LinkAction step={beginStep} onBegin={() => void begin()} />
        ) : (
          <div className={labelCls}>
            Linking is refused until that file is moved aside — this field never overwrites an
            identity record by guessing.
          </div>
        )}
      </div>
    );
  } else if (face.kind === "linked") {
    const link = face.link;
    body = (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className={labelCls}>account</span>
          <span>{link.login ?? "learning the login…"}</span>
        </div>
        {link.tailnet !== undefined && (
          <div className="flex items-center justify-between gap-2">
            <span className={labelCls}>tailnet</span>
            <span>{link.tailnet}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className={labelCls}>linked</span>
          <span className="tabular-nums">{readableTime(link.linkedAt)}</span>
        </div>
        {face.nodeState !== null && (
          <div className="flex items-center justify-between gap-2">
            <span className={labelCls}>node</span>
            <span>{face.nodeState}</span>
          </div>
        )}

        <div className="flex flex-col items-end gap-2 pt-2">
          {step.kind === "arming" ? (
            <>
              <div className={`text-right ${labelCls}`}>
                Unlink this device? Every local byte stays. Linking again mints a fresh node
                identity — peers see a new device, and the old one ages out.
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`${buttonCls} text-[var(--vf-red)]`}
                  onClick={() => void unlink()}
                >
                  Unlink
                </button>
                <button
                  type="button"
                  className={buttonCls}
                  onClick={() => setStep({ kind: "idle" })}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              {step.kind === "failed" && (
                <div className="text-right text-[12px] text-amber-600 dark:text-amber-400">
                  {step.reason}
                </div>
              )}
              <button
                type="button"
                className={`${buttonCls} text-[var(--vf-red)]`}
                disabled={step.kind === "unlinking"}
                onClick={() => setStep({ kind: "arming" })}
              >
                {step.kind === "unlinking" ? "Unlinking…" : "Unlink"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  } else if (face.authUrl !== null) {
    // Capturing, with an address: the node is up and the browser has the ball.
    body = (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className={labelCls}>node</span>
          <span className="flex items-center gap-1.5">
            <a
              href={face.authUrl}
              target="_blank"
              rel="noreferrer"
              className="vf-ui-tone-info underline"
            >
              authenticate
            </a>
            {face.nodeState ?? "waiting for authentication"}
          </span>
        </div>
        <div className={labelCls}>
          Waiting for you to finish in the browser. This page names the account as soon as the node
          comes up.
        </div>
      </div>
    );
  } else {
    // Capturing, before the node has offered one. Nothing is declared and
    // nothing is published in this window (UA-P-0a), so the honest line is
    // what we are waiting on rather than a promise of what comes next.
    body = (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className={labelCls}>node</span>
          <span>{face.nodeState ?? "starting"}</span>
        </div>
        <div className={labelCls}>
          Linking: asking the tailnet who this node is. The sign-in address appears here as soon as
          the node offers one.
        </div>
      </div>
    );
  }

  return (
    <SettingsSection
      title="Connect your devices"
      description="Your devices, your tailnet. Everything here works locally without it."
    >
      {body}
    </SettingsSection>
  );
}

function SyncPostureSection({
  onSettingsChanged,
}: {
  // Explicitly `| undefined`: under `exactOptionalPropertyTypes` a forwarded
  // optional prop is a value that may BE undefined, not an absent one.
  onSettingsChanged?: ((undoable: boolean) => void) | undefined;
}): ReactElement {
  const posture = useSyncPosture();
  const locked = posture.unavailable || posture.pending;

  return (
    <SettingsSection
      title="Sync posture"
      description="What a new document does by default. You can change any single document afterwards."
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
                name="vf-sync-posture"
                className="sr-only"
                checked={selected}
                disabled={locked}
                onChange={() => {
                  void posture.set(card.value).then((landed) => {
                    if (landed) onSettingsChanged?.(true);
                  });
                }}
              />
              <div className="text-[13px] font-medium leading-5 text-black/80 dark:text-white/80">
                {card.title}
              </div>
              <div className={`mt-0.5 ${labelCls}`}>{card.description}</div>
            </label>
          );
        })}
      </div>
      {posture.status === "loading" && (
        <div className={`pt-2 ${labelCls}`}>Loading preferences…</div>
      )}
      {posture.status === "error" && (
        <div className="pt-2 text-[12px] text-amber-600 dark:text-amber-400">
          Preferences unavailable.
        </div>
      )}
      {posture.writeError !== null && (
        <div className="pt-2 text-[12px] text-amber-600 dark:text-amber-400">
          {posture.writeError}
        </div>
      )}
    </SettingsSection>
  );
}
