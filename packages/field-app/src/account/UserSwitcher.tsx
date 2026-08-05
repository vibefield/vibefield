import { type ReactElement, useEffect, useState } from "react";
import { type FieldUserProfile, type FieldUserRoster, getHost } from "../host";
import { buttonCls, labelCls, SettingsSection } from "../panels/settings-ui";

// The user switcher (UA-5; spec §6.3) — the Account page's roster, and the only
// place in the product where one user hands this window to another.
//
// Deliberately a THIN surface over three host calls. Everything hard about a
// switch (re-targeting the attach, what happens to the pair you leave, the
// reload) belongs to main; what this owns is the roster, an honest "current"
// marker, and saying so when the bridge is not there. It sits beside the other
// UA-3 account pieces but borrows the panels module's chrome — so unlike
// AccentPicker it must never be pulled into the boot bundle.
//
// THE RELOAD IS THE FEEDBACK (host.ts): switch and create re-target this window
// and reload it, so their promises may resolve into a dying context or never
// settle at all. Nothing here waits for one. The pressed control disables and
// the window goes away underneath it — no spinner, because a spinner would be
// a promise about a page that will not be here to keep it.

/** How the roster reads. `unavailable` is a host without the UA-5 door — an
 * older shell, or a browser harness — which is a FACT, not a failure. */
type RosterState =
  | { kind: "unavailable" }
  | { kind: "loading" }
  | { kind: "ready"; roster: FieldUserRoster }
  | { kind: "failed"; reason: string };

/** Which control was pressed. Never cleared on success: re-enabling a control
 * on a page that is already reloading would misdescribe what is happening. */
type Pressed = { kind: "none" } | { kind: "switch"; userId: string } | { kind: "create" };

export function UserSwitcher(): ReactElement {
  // Read once, and let `undefined` mean "this build cannot do that" out loud —
  // the same shape as every other host capability (AccountSection:44).
  const host = getHost();
  const usersList = host.usersList;
  const usersCreate = host.usersCreate;
  const usersSwitch = host.usersSwitch;

  const [roster, setRoster] = useState<RosterState>(
    usersList === undefined ? { kind: "unavailable" } : { kind: "loading" },
  );
  const [pressed, setPressed] = useState<Pressed>({ kind: "none" });
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (usersList === undefined) return;
    let cancelled = false;
    void usersList()
      .then((snapshot) => {
        if (!cancelled) setRoster({ kind: "ready", roster: snapshot });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setRoster({
          kind: "failed",
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [usersList]);

  /** One shape for both reloading acts: disable, fire, and only ever hear back
   * about a REFUSAL — a resolution means the window is already on its way out.
   * One at a time, because two attach re-targets would race for the same
   * window. */
  const fireAndForget = (mark: Pressed, act: () => Promise<unknown>): void => {
    if (pressed.kind !== "none") return;
    setPressed(mark);
    setActionError(null);
    void act().catch((cause: unknown) => {
      setPressed({ kind: "none" });
      setActionError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  const busy = pressed.kind !== "none";

  let body: ReactElement;
  if (roster.kind === "unavailable") {
    body = (
      <div className={labelCls}>
        Switching users needs the desktop shell — this window has no supervisor bridge, so the users
        on this machine cannot be listed or switched from here.
      </div>
    );
  } else if (roster.kind === "loading") {
    body = <div className={labelCls}>Reading the users on this machine…</div>;
  } else if (roster.kind === "failed") {
    body = (
      <div className="text-[12px] text-amber-600 dark:text-amber-400">
        Users unavailable. {roster.reason}
      </div>
    );
  } else {
    body = (
      <>
        <ul className="flex flex-col gap-0.5">
          {roster.roster.users.map((user) => (
            <li key={user.userId}>
              <UserRow
                user={user}
                current={user.userId === roster.roster.attachedUserId}
                disabled={usersSwitch === undefined || busy}
                onSwitch={() => {
                  if (usersSwitch === undefined) return;
                  fireAndForget({ kind: "switch", userId: user.userId }, () =>
                    usersSwitch({ userId: user.userId }),
                  );
                }}
              />
            </li>
          ))}
        </ul>
        {usersSwitch === undefined && (
          // A host may hold one verb of this door without the others. A roster
          // of rows that answer nothing is the blank state in disguise, so the
          // disabling says why (§8).
          <div className={`pt-2 ${labelCls}`}>
            This window can see the other users but not switch to them — that needs the desktop
            shell.
          </div>
        )}
      </>
    );
  }

  return (
    <SettingsSection
      title="Users"
      description="Everyone with a field on this machine. Each keeps its own sessions, agents and documents — nothing crosses between them."
    >
      {body}

      <div className="flex flex-col items-start gap-1.5 pt-3">
        <button
          type="button"
          className={buttonCls}
          disabled={usersCreate === undefined || busy}
          onClick={() => {
            if (usersCreate === undefined) return;
            // No name is asked for here. The mint only has to exist; the
            // reloaded window's Setup Assistant is where identity is decided.
            fireAndForget({ kind: "create" }, () => usersCreate({}));
          }}
        >
          New user…
        </button>
        <span className={labelCls}>
          Creates a user and switches to it. This window reloads, and setup asks the new user for a
          name.
        </span>
      </div>

      {actionError !== null && (
        <div className="pt-2 text-[12px] text-amber-600 dark:text-amber-400">{actionError}</div>
      )}
    </SettingsSection>
  );
}

/** One user. The attached one is not a button: switching to the user you are
 * already using is main's no-op, and a control that answers a click with
 * nothing is worse than no control. It wears the §7 sole-selection ring
 * instead, because "current" here IS the selection. */
function UserRow({
  user,
  current,
  disabled,
  onSwitch,
}: {
  user: FieldUserProfile;
  current: boolean;
  disabled: boolean;
  onSwitch: () => void;
}): ReactElement {
  const face = (
    <>
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{
          // §2.6 accent slots by name. A user with no color yet is muted, not
          // assigned one on their behalf.
          background:
            user.color === undefined
              ? "color-mix(in srgb, currentColor 30%, transparent)"
              : `var(--vf-${user.color})`,
        }}
      />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-black/80 dark:text-white/80">
        {user.name}
      </span>
      <span className={`shrink-0 ${labelCls}`}>
        {current ? "current" : <span className="tabular-nums">user {user.fuid}</span>}
      </span>
    </>
  );

  if (current) {
    return (
      <div
        aria-current="true"
        className="flex items-center gap-2.5 rounded-[12px] px-3 py-2.5"
        style={{ outline: "1.5px solid var(--vf-select)", outlineOffset: "-1.5px" }}
      >
        {face}
      </div>
    );
  }

  return (
    <button
      type="button"
      // The row is a face; the button says what pressing it DOES (§9).
      aria-label={`Switch to ${user.name}`}
      disabled={disabled}
      onClick={onSwitch}
      className="flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left transition-[background-color,transform] hover:bg-black/[0.03] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vf-select)] disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none dark:hover:bg-white/[0.05]"
    >
      {face}
    </button>
  );
}
