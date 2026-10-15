import type { UpdateView } from "@vibefield/contracts";
import { stagedTrayLabel } from "./updates/apply";

export type TrayLinkState = "starting" | "ready" | "reconnecting" | "unavailable";
export type TrayEvidenceState = "healthy" | "degraded";
export type TrayUpdateState =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "downloading"; readonly percent: number }
  // EDP §11.1 / WP12 D14: "ready" renamed — macOS stages, nothing installs in place (EDP-34)
  | {
      readonly kind: "staged";
      readonly version: string;
      /** WP12c — the live sessions the census read: the verb says them (EDP-35); `"unknown"` holds the verb */
      readonly sessions?: number | "unknown";
      /** L3b-i (B3) — the release leaves the floor alone, so the verb ends no session whatever the count */
      readonly keepsSessions?: boolean;
    }
  // L3b-i (B1) — the policy's answers, which are not failures: the kill switch, and an OS below the release's floor
  | { readonly kind: "paused" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "failed" };

export interface TraySnapshot {
  readonly link: TrayLinkState;
  readonly evidence: TrayEvidenceState;
  readonly update: TrayUpdateState;
  /** UA-2 — the attached user's display name; absent hides the row (older
   * callers, tests). UA-3's Account section renames it live. */
  readonly userName?: string;
  /** UA-7 — the attached user's face, which leads the user row (UA-D17). It is
   * the EFFECTIVE face: the one written, or the machine's deal for a user who
   * has none yet, so a pre-v0.3 user is never a bare name. Only the emoji
   * travels, because a native menu draws no frame (DESIGN.md §2.8). Absent keeps
   * the `User:` label (older callers, tests). */
  readonly userFace?: string;
  /** UA-5 — the roster behind the Switch User submenu; absent hides it. UA-7:
   * each user's effective face leads their row, as it leads the user row. */
  readonly users?: ReadonlyArray<{
    readonly userId: string;
    readonly name: string;
    readonly face?: string;
    readonly attached: boolean;
  }>;
  readonly backgroundShell: boolean;
  readonly showTray: boolean;
  readonly windowOpen: boolean;
  readonly quitting: boolean;
}

export type TrayPlatform = "darwin" | "win32" | "linux" | "other";

export interface TrayActions {
  openPrimaryWindow(): void;
  openSettings(): void;
  openDiagnostics(): void;
  takeScreenshot?: () => void;
  checkForUpdates?: () => void;
  restartToUpdate?: () => void;
  setBackgroundShell(enabled: boolean): void;
  setTrayVisible(enabled: boolean): void;
  /** UA-5 — attach another user (UA-D15: re-target + window reload). */
  switchUser?: (userId: string) => void;
  /** UA-5 — mint-and-attach; the reloaded window runs the §6.2 wizard. */
  newUser?: () => void;
  quit(): void;
}

export interface TrayMenuItem {
  readonly id?: string;
  readonly type?: "normal" | "checkbox" | "separator";
  readonly label?: string;
  readonly enabled?: boolean;
  readonly checked?: boolean;
  readonly click?: () => void;
  /** UA-5 — one level deep is all the tray needs (the Switch User submenu);
   * the native mapping recurses regardless. Submenu ITEMS honor `enabled`
   * even on macOS — only top-level tray items don't (the availability rule). */
  readonly submenu?: readonly TrayMenuItem[];
}

function serviceStatus(snapshot: TraySnapshot): string {
  switch (snapshot.link) {
    case "starting":
      return "Field service: Starting…";
    case "ready":
      return snapshot.evidence === "degraded"
        ? "Field service: Ready — diagnostics need attention"
        : "Field service: Ready";
    case "reconnecting":
      return "Field service: Reconnecting…";
    case "unavailable":
      return "Field service: Unavailable";
  }
}

/** UA-7 — who a row names: the face leads and the name makes it certain
 * (DESIGN.md §2.8, I-4). With no face it is the name alone. */
function userLabel(name: string, face: string | undefined): string {
  return face === undefined ? name : `${face} ${name}`;
}

function availability(platform: TrayPlatform, enabled: boolean): Pick<TrayMenuItem, "enabled"> {
  // Electron documents enabled/visibility as unsupported for top-level macOS
  // tray menu items. There, action presence is the policy boundary.
  return platform === "darwin" ? {} : { enabled };
}

function updateItem(
  snapshot: TraySnapshot,
  actions: TrayActions,
  platform: TrayPlatform,
): TrayMenuItem {
  const actionable = !snapshot.quitting;
  switch (snapshot.update.kind) {
    case "idle": {
      const enabled = actionable && actions.checkForUpdates !== undefined;
      return {
        id: "update",
        label: "Check for Updates…",
        ...availability(platform, enabled),
        ...(enabled ? { click: actions.checkForUpdates } : {}),
      };
    }
    case "checking":
      return {
        id: "update",
        label: "Checking for Updates…",
        ...availability(platform, false),
      };
    case "downloading": {
      const percent = Math.max(0, Math.min(100, Math.round(snapshot.update.percent)));
      return {
        id: "update",
        label: `Downloading Update… ${percent}%`,
        ...availability(platform, false),
      };
    }
    case "staged": {
      // The verb renders only when an apply exists (WP12c's gate) and the census could be read; otherwise the update
      // is downloaded and the item says so instead of offering a restart that would do nothing. With live sessions
      // the verb IS the consequence (EDP-35): "Update Ends N Sessions…" — the plain verb never renders beside it.
      const sessions = snapshot.update.sessions;
      const keepsSessions = snapshot.update.keepsSessions === true;
      if (
        actions.restartToUpdate === undefined ||
        sessions === undefined ||
        (sessions === "unknown" && !keepsSessions)
      ) {
        return {
          id: "update",
          label: stagedTrayLabel(undefined),
          ...availability(platform, false),
        };
      }
      const enabled = actionable;
      return {
        id: "update",
        label: stagedTrayLabel(sessions, keepsSessions),
        ...availability(platform, enabled),
        ...(enabled ? { click: actions.restartToUpdate } : {}),
      };
    }
    case "paused":
      return {
        id: "update",
        label: "Updates Paused",
        ...availability(platform, false),
      };
    case "unsupported":
      return {
        id: "update",
        label: "Update Needs a Newer macOS",
        ...availability(platform, false),
      };
    case "failed":
      return {
        id: "update",
        label: "Update Check Failed",
        ...availability(platform, false),
      };
  }
}

/** Pure tray projection. Localization can replace these labels later without
 * moving policy into Electron callbacks. */
export function buildTrayMenu(
  snapshot: TraySnapshot,
  actions: TrayActions,
  platform: TrayPlatform,
): readonly TrayMenuItem[] {
  const actionable = !snapshot.quitting;
  const items: TrayMenuItem[] = [
    {
      id: "open",
      label: "Open VibeField",
      ...availability(platform, actionable),
      ...(actionable ? { click: actions.openPrimaryWindow } : {}),
    },
    ...(actions.takeScreenshot === undefined
      ? []
      : [
          {
            id: "screenshot",
            label: "Take Screenshot",
            ...availability(platform, actionable),
            ...(actionable ? { click: actions.takeScreenshot } : {}),
          },
        ]),
    ...(snapshot.userName !== undefined
      ? [
          {
            id: "user",
            label:
              snapshot.userFace === undefined
                ? `User: ${snapshot.userName}`
                : userLabel(snapshot.userName, snapshot.userFace),
            ...availability(platform, false),
          },
        ]
      : []),
    ...(snapshot.users !== undefined &&
    snapshot.users.length > 0 &&
    actions.switchUser !== undefined
      ? [
          {
            id: "switch-user",
            label: "Switch User",
            ...availability(platform, actionable),
            submenu: [
              ...snapshot.users.map(
                (u): TrayMenuItem => ({
                  id: `switch-user-${u.userId}`,
                  type: "checkbox",
                  label: userLabel(u.name, u.face),
                  checked: u.attached,
                  enabled: actionable && !u.attached,
                  ...(actionable && !u.attached
                    ? { click: () => actions.switchUser?.(u.userId) }
                    : {}),
                }),
              ),
              ...(actions.newUser !== undefined
                ? ([
                    { type: "separator" },
                    {
                      id: "new-user",
                      label: "New User…",
                      enabled: actionable,
                      ...(actionable ? { click: actions.newUser } : {}),
                    },
                  ] satisfies TrayMenuItem[])
                : []),
            ],
          } satisfies TrayMenuItem,
        ]
      : []),
    {
      id: "status",
      label: serviceStatus(snapshot),
      ...availability(platform, false),
    },
    {
      id: "settings",
      label: "Settings…",
      ...availability(platform, actionable),
      ...(actionable ? { click: actions.openSettings } : {}),
    },
    {
      id: "diagnostics",
      label: "Open Diagnostics…",
      ...availability(platform, actionable),
      ...(actionable ? { click: actions.openDiagnostics } : {}),
    },
    updateItem(snapshot, actions, platform),
    { type: "separator" },
  ];

  if (platform === "win32" || platform === "linux") {
    items.push({
      id: "background-shell",
      type: "checkbox",
      label: "Close window keeps VibeField running",
      checked: snapshot.backgroundShell,
      ...availability(platform, actionable),
      ...(actionable ? { click: () => actions.setBackgroundShell(!snapshot.backgroundShell) } : {}),
    });
  }

  items.push(
    {
      id: "show-tray",
      type: "checkbox",
      label: "Show status item",
      checked: snapshot.showTray,
      ...availability(platform, actionable),
      ...(actionable ? { click: () => actions.setTrayVisible(!snapshot.showTray) } : {}),
    },
    { type: "separator" },
    {
      id: "quit",
      label: "Quit VibeField",
      ...availability(platform, actionable),
      ...(actionable ? { click: actions.quit } : {}),
    },
  );
  return items;
}

/** The tray's item, from the controller's ONE projection (C6; the Settings card renders the same view). Offline is
 * quiet and retryable (EDP §11.2), so it reads as idle; a refusal or a failure reads as failed, with its details in
 * doctor and the audit, never in the menu — except the policy's own answers (L3b-i, B1), which are not failures. */
export function trayUpdateOf(view: UpdateView): TrayUpdateState {
  switch (view.phase) {
    case "checking":
      return { kind: "checking" };
    case "downloading":
      return { kind: "downloading", percent: view.percent ?? 0 };
    case "staged":
      return {
        kind: "staged",
        version: view.version ?? "",
        ...(view.sessions !== undefined ? { sessions: view.sessions } : {}),
        ...(view.keepsSessions === true ? { keepsSessions: true } : {}),
      };
    case "paused":
      return { kind: "paused" };
    case "unsupported":
      return { kind: "unsupported" };
    case "failed":
      return { kind: "failed" };
    default:
      return { kind: "idle" };
  }
}
