import { UserFaceView } from "@vibefield/design-kit/face";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { FacePicker } from "../account/FacePicker";
import { faceLabel, faceOf, heldFaces } from "../account/faces";
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

// The Account surface (UA-3; spec §6.3) — who this field belongs to: the
// profile and the users. TS-3a (TS-D3) moved the link and the posture to
// Settings → Devices (DevicesSection), the account's reach. Since UA-3w the
// shared pieces live in `src/account/`, and the wizard imports the same ones.
//
// Profile and residency are SUPERVISOR facts (`users.json`, UA-D10) and travel
// over the host bridge, because main is the only writer. A device with a
// working daemon and no supervisor bridge says which half is reachable, rather
// than greying out the lot.

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
