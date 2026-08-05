import { AppPreferences } from "@vibefield/contracts";
import { useFielddClient, useSubscription } from "@vibefield/fieldd-client/react";
import { type ReactElement, useEffect, useState } from "react";
import { type FieldUserProfile, getHost } from "../host";
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
// preference.
//
// Two owners, deliberately not one. Profile and residency are SUPERVISOR facts
// (`users.json`, UA-D10) and travel over the host bridge, because main is the
// only writer. Posture is a fieldd user-scope preference and travels over the
// product socket like every other preference. The page does not hide that split
// — a device with a working daemon and no supervisor bridge shows exactly which
// half is reachable, rather than greying out the lot.

/** §7.1's `link.json`, as the subscription reports it. Local rather than
 * imported: `user.link.subscribe` is fieldd's to define and lands with the
 * daemon half of this slice. Kept a tolerant shape so an early daemon that
 * omits a field renders honestly instead of throwing. */
type UserLinkStatus = {
  link: { login: string | null; tailnet?: string; linkedAt: string } | null;
  meshEnabled: boolean;
  nodeState: string | null;
  authUrl: string | null;
};

type SyncPosture = "automatic" | "opt-in";

/** The eight §2.6 accent slots by NAME (DESIGN.md: slot names, never hex — the
 * value belongs to the token, so a palette revision moves one file). */
const ACCENT_SLOTS = [
  "accent-1",
  "accent-2",
  "accent-3",
  "accent-4",
  "accent-5",
  "accent-6",
  "accent-7",
  "accent-8",
] as const;

/** The posture key as `storage.appPreferences.set` takes it (spec §8). Written
 * as a plain string: UA-6 owns its registration in `APP_PREFERENCE_KEYS`, and
 * this surface asks for it by name until that lands. */
const SYNC_POSTURE_KEY = "mesh.syncPosture";

/** Tolerant read (design-00): the snapshot's field name for a key UA-6 has not
 * shipped yet is not knowable here — today's daemon shortens `desktop.showTray`
 * to `showTray`, so accept both spellings and default to today's behavior. */
function readPosture(raw: unknown): SyncPosture {
  if (typeof raw !== "object" || raw === null) return "automatic";
  const record = raw as Record<string, unknown>;
  const value = record.syncPosture ?? record[SYNC_POSTURE_KEY];
  return value === "opt-in" ? "opt-in" : "automatic";
}

/** A timestamp reads as a time or as itself — never as "Invalid Date". */
function readableTime(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}

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
  const [profile, setProfile] = useState<ProfileState>(
    usersUpdate === undefined ? { kind: "unavailable" } : { kind: "loading" },
  );
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

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
    color?: string;
    resident?: boolean;
  }): Promise<void> => {
    if (usersUpdate === undefined) return;
    setWriting(true);
    setWriteError(null);
    try {
      const updated = await usersUpdate(params);
      setProfile({ kind: "ready", profile: updated });
      setNameDraft(null);
      onSettingsChanged?.(false);
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWriting(false);
    }
  };

  const current = profile.kind === "ready" ? profile.profile : null;
  const editable = current !== null && !writing;
  const name = nameDraft ?? current?.name ?? "";
  const accent = current?.color ?? null;

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
        description="Your name and color on this machine. They travel with this device's user, not with the mesh."
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
          title="Color"
          description="An accent for this user. It tints where you appear, and never signals state."
          align="start"
        >
          <div className="flex flex-col items-end gap-2">
            <div
              role="radiogroup"
              aria-label="Accent color"
              className="flex flex-wrap justify-end gap-1.5"
            >
              {/* Real radios, not buttons wearing the role: arrow-key traversal
                  and the group semantics come free, and the swatch is the
                  label's own face. */}
              {ACCENT_SLOTS.map((slot) => {
                const selected = accent === slot;
                return (
                  <label
                    key={slot}
                    className={`inline-flex rounded-full transition-transform focus-within:ring-2 focus-within:ring-[var(--vf-select)] ${
                      editable ? "cursor-pointer hover:scale-105 active:scale-95" : "opacity-40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="vf-account-accent"
                      className="sr-only"
                      aria-label={slot}
                      checked={selected}
                      disabled={!editable}
                      onChange={() => void write({ color: slot })}
                    />
                    <span
                      aria-hidden="true"
                      className="block h-7 w-7 rounded-full"
                      style={{
                        background: `var(--vf-${slot})`,
                        // §7: the sole-selection ring, 1.5px in --vf-select.
                        ...(selected
                          ? { outline: "1.5px solid var(--vf-select)", outlineOffset: "2px" }
                          : {}),
                      }}
                    />
                  </label>
                );
              })}
            </div>
            {/* The live chip — the §2.6 tint recipe (12% body, 35% hairline,
                label at full), so the choice is shown doing its actual job
                rather than as a bare swatch. */}
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium text-black/75 dark:text-white/75"
              style={{
                background:
                  accent === null
                    ? "transparent"
                    : `color-mix(in srgb, var(--vf-${accent}) 12%, transparent)`,
                borderColor:
                  accent === null
                    ? "color-mix(in srgb, currentColor 15%, transparent)"
                    : `color-mix(in srgb, var(--vf-${accent}) 35%, transparent)`,
              }}
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    accent === null
                      ? "color-mix(in srgb, currentColor 30%, transparent)"
                      : `var(--vf-${accent})`,
                }}
              />
              {name.trim().length > 0 ? name : "your field"}
            </span>
          </div>
        </SettingsRow>

        {current !== null && (
          <div className={`pt-2 ${labelCls}`}>
            <span className="font-mono tabular-nums">user {current.fuid}</span> ·{" "}
            <span className="font-mono">{current.userId}</span>
          </div>
        )}
        {profile.kind === "unavailable" && (
          <div className={`pt-2 ${labelCls}`}>
            Profile editing needs the desktop shell — this window has no supervisor bridge, so your
            name and color cannot be changed from here.
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

/** How the unlink affordance reads. Two steps, never one, and for the same
 * reason the deck's kill chip has them (KillActivePane): the act is
 * irreversible in the one way that matters — a relink is a NEW node identity,
 * never the old one back. */
type UnlinkStep =
  | { kind: "idle" }
  | { kind: "arming" }
  | { kind: "unlinking" }
  | { kind: "failed"; reason: string };

function LinkBlock(): ReactElement {
  const client = useFielddClient();
  const status = useSubscription<UserLinkStatus>("user.link.subscribe");
  const [step, setStep] = useState<UnlinkStep>({ kind: "idle" });

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

  const data = status.status === "live" ? (status.data ?? null) : null;

  let body: ReactElement;
  if (status.status === "loading") {
    body = <div className={labelCls}>Reading link status…</div>;
  } else if (status.status === "error" || data === null) {
    // The daemon half of this slice may not be there yet, and a page that
    // crashes on a missing method is worse than one that says so.
    body = (
      <div className={labelCls}>
        Link service unavailable — this daemon does not report link status. Everything local keeps
        working.
      </div>
    );
  } else if (!data.meshEnabled) {
    body = (
      <div className="space-y-1">
        <div className={labelCls}>
          Mesh networking is off on this device. It is enabled by environment today (
          <span className="font-mono">FIELD_NATIVE_MESH</span>), so there is nothing to link from
          here yet.
        </div>
        {data.link !== null && (
          <div className={labelCls}>
            A link is on file for {data.link.login ?? "this device"} — it takes effect when the mesh
            is enabled.
          </div>
        )}
      </div>
    );
  } else if (data.link !== null) {
    const link = data.link;
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
        {data.nodeState !== null && (
          <div className="flex items-center justify-between gap-2">
            <span className={labelCls}>node</span>
            <span>{data.nodeState}</span>
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
  } else if (data.authUrl !== null) {
    body = (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className={labelCls}>node</span>
          <span className="flex items-center gap-1.5">
            <a
              href={data.authUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
              style={{ color: "var(--vf-cyan)" }}
            >
              authenticate
            </a>
            {data.nodeState ?? "waiting for authentication"}
          </span>
        </div>
        <div className={labelCls}>
          Waiting for you to finish in the browser. This page names the account as soon as the node
          comes up.
        </div>
      </div>
    );
  } else {
    body = (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className={labelCls}>node</span>
          <span>{data.nodeState ?? "not linked"}</span>
        </div>
        <div className={labelCls}>
          No account linked yet. When the node offers a sign-in address it appears here.
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
  const client = useFielddClient();
  const subscription = useSubscription<unknown>("storage.appPreferences.subscribe", {});
  const parsed = AppPreferences.safeParse(subscription.data);
  const preferences = parsed.success ? parsed.data : null;
  const [pending, setPending] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  const unavailable = subscription.status !== "live" || preferences === null;
  const posture = readPosture(subscription.data);

  const setPosture = async (value: SyncPosture): Promise<void> => {
    setPending(true);
    setWriteError(null);
    try {
      await client.request("storage.appPreferences.set", { key: SYNC_POSTURE_KEY, value });
      onSettingsChanged?.(true);
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  const cards = [
    {
      value: "automatic" as const,
      title: "Sync new projects automatically",
      description: "New documents join your mesh as you make them.",
    },
    {
      value: "opt-in" as const,
      title: "Ask per project",
      description: "New documents stay on this device until you say otherwise.",
    },
  ];

  return (
    <SettingsSection
      title="Sync posture"
      description="What a new document does by default. You can change any single document afterwards."
    >
      <div role="radiogroup" aria-label="Sync posture" className="grid gap-2 sm:grid-cols-2">
        {cards.map((card) => {
          const selected = posture === card.value;
          const locked = unavailable || pending;
          return (
            <label
              key={card.value}
              className={`rounded-[14px] border p-3 text-left transition-[background-color,border-color,transform] focus-within:ring-2 focus-within:ring-[var(--vf-select)] ${
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
                onChange={() => void setPosture(card.value)}
              />
              <div className="text-[13px] font-medium leading-5 text-black/80 dark:text-white/80">
                {card.title}
              </div>
              <div className={`mt-0.5 ${labelCls}`}>{card.description}</div>
            </label>
          );
        })}
      </div>
      {subscription.status === "loading" && (
        <div className={`pt-2 ${labelCls}`}>Loading preferences…</div>
      )}
      {subscription.status === "error" && (
        <div className="pt-2 text-[12px] text-amber-600 dark:text-amber-400">
          Preferences unavailable.
        </div>
      )}
      {writeError !== null && (
        <div className="pt-2 text-[12px] text-amber-600 dark:text-amber-400">{writeError}</div>
      )}
    </SettingsSection>
  );
}
