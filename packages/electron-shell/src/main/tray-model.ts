import type { UpdateView } from "@vibefield/contracts";
import { stagedTrayLabel } from "./updates/apply";

export type TrayLinkState = "starting" | "ready" | "reconnecting" | "unavailable";
export type TrayEvidenceState = "healthy" | "degraded";
export type TrayUpdateState =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  // AU-4 (AU-G5; X13) — found and not downloading: the person skipped it, or turned automatic updates off. With updates
  // off it waits for the person's Download; a skip is theirs to take back on the page
  | {
      readonly kind: "available";
      readonly version: string;
      readonly declined: boolean;
      readonly enabled: boolean;
    }
  | { readonly kind: "downloading"; readonly percent: number }
  // EDP §11.1 / WP12 D14: "ready" renamed — macOS stages, nothing installs in place (EDP-34)
  | {
      readonly kind: "staged";
      readonly version: string;
      /** WP12c — the live sessions the census read: the verb says them (EDP-35); `"unknown"` holds the verb */
      readonly sessions?: number | "unknown";
      /** L3b-i (B3) — the release leaves the floor alone, so the verb ends no session whatever the count */
      readonly keepsSessions?: boolean;
      /** AU-4 (AU-G14) — an apply exists on this platform, so the install waits on the person: the status item wears
       * the update image. Absent or false (no apply here) wears the base image. */
      readonly applyWired?: boolean;
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
  /** TS-4 (TS-D7) — the attached user's Mac is not connected: offer Connect Your
   * Devices…. Absent or false hides the row (older callers, tests, a link not
   * read yet). */
  readonly connectDevices?: boolean;
}

export type TrayPlatform = "darwin" | "win32" | "linux" | "other";

export interface TrayActions {
  openPrimaryWindow(): void;
  openSettings(): void;
  openDiagnostics(): void;
  /** TS-4 — the Connect door the face menu's row opens */
  connectDevices?: () => void;
  takeScreenshot?: () => void;
  checkForUpdates?: () => void;
  restartToUpdate?: () => void;
  /** AU-4 (AU-G5) — Download Update: this found version, with automatic updates off */
  downloadUpdate?: (version: string) => void;
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

/** AU-4 (AU-L4) — the acts an update item runs. The status item and the app menu hand the same three. */
export interface UpdateMenuActs {
  readonly check?: () => void;
  readonly restart?: () => void;
  readonly download?: (version: string) => void;
}

/** AU-4 (AU-L4) — one update item, said the same way in the status item and the app menu: its label, whether it
 * acts, and what it runs. Pure; each menu maps it into its own item. */
export interface UpdateMenuEntry {
  readonly label: string;
  readonly enabled: boolean;
  readonly click?: () => void;
}

/** An entry acts exactly when it has something to run. */
function menuEntry(label: string, click?: () => void): UpdateMenuEntry {
  return click === undefined ? { label, enabled: false } : { label, enabled: true, click };
}

/** AU-4 (AU-L4) — the update item from the one projection (`trayUpdateOf`). macOS menus say the verbs in title case,
 * and "…" only where the act asks or answers in a box before it completes (DESIGN.md §9, LC-41): Check for Updates…,
 * Download Update, Restart to Update, Update Ends 3 Sessions…. Nothing acts while the app quits (`actionable`). */
export function updateMenuEntry(
  update: TrayUpdateState,
  acts: UpdateMenuActs,
  actionable: boolean,
): UpdateMenuEntry {
  switch (update.kind) {
    case "idle":
      return menuEntry("Check for Updates…", actionable ? acts.check : undefined);
    case "checking":
      return menuEntry("Checking for Updates…");
    case "available": {
      // AU-4 (AU-G5) — found with automatic updates off: it waits for the person's Download, this one version. A
      // skipped version is theirs to take back on the page (Download anyway), so the item checks, as at rest
      if (!update.declined && !update.enabled) {
        const { download } = acts;
        const version = update.version;
        return menuEntry(
          "Download Update",
          actionable && download !== undefined ? () => download(version) : undefined,
        );
      }
      return menuEntry("Check for Updates…", actionable ? acts.check : undefined);
    }
    case "downloading": {
      const percent = Math.max(0, Math.min(100, Math.round(update.percent)));
      return menuEntry(`Downloading Update… ${percent}%`);
    }
    case "staged": {
      // The verb renders only when an apply exists (WP12c's gate) and the census could be read; otherwise the update
      // is downloaded and the item says so instead of offering a restart that would do nothing. With live sessions
      // the verb IS the consequence (EDP-35): "Update Ends N Sessions…" — the plain verb never renders beside it.
      const sessions = update.sessions;
      const keepsSessions = update.keepsSessions === true;
      if (
        acts.restart === undefined ||
        sessions === undefined ||
        (sessions === "unknown" && !keepsSessions)
      ) {
        return menuEntry(stagedTrayLabel(undefined));
      }
      return menuEntry(
        stagedTrayLabel(sessions, keepsSessions),
        actionable ? acts.restart : undefined,
      );
    }
    case "paused":
      return menuEntry("Updates Paused");
    case "unsupported":
      return menuEntry("Update Needs a Newer macOS");
    case "failed":
      return menuEntry("Update Check Failed");
  }
}

/** The status item's mapping of the update entry (the availability rule: on macOS, action presence is the policy). */
function updateItem(
  snapshot: TraySnapshot,
  actions: TrayActions,
  platform: TrayPlatform,
): TrayMenuItem {
  const entry = updateMenuEntry(
    snapshot.update,
    {
      ...(actions.checkForUpdates !== undefined ? { check: actions.checkForUpdates } : {}),
      ...(actions.restartToUpdate !== undefined ? { restart: actions.restartToUpdate } : {}),
      ...(actions.downloadUpdate !== undefined ? { download: actions.downloadUpdate } : {}),
    },
    !snapshot.quitting,
  );
  return {
    id: "update",
    label: entry.label,
    ...availability(platform, entry.enabled),
    ...(entry.click !== undefined ? { click: entry.click } : {}),
  };
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
    // TS-4 (TS-D7; DESIGN.md §8 "Asking again") — a row, never a badge, in title
    // case as macOS menus are; gone the moment the link lands
    ...(snapshot.connectDevices === true && actions.connectDevices !== undefined
      ? [
          {
            id: "connect-devices",
            label: "Connect Your Devices…",
            ...availability(platform, actionable),
            ...(actionable ? { click: actions.connectDevices } : {}),
          },
        ]
      : []),
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
    // AU-4 (AU-G5; X13) — a found update that is not downloading (skipped, or updates off) stays found: with updates off
    // the item offers its Download (L3c-ii kept it quiet as idle)
    case "available":
      return {
        kind: "available",
        version: view.version ?? "",
        declined: view.declined === true,
        enabled: view.enabled,
      };
    case "downloading":
      return { kind: "downloading", percent: view.percent ?? 0 };
    case "staged":
      return {
        kind: "staged",
        version: view.version ?? "",
        ...(view.sessions !== undefined ? { sessions: view.sessions } : {}),
        ...(view.keepsSessions === true ? { keepsSessions: true } : {}),
        applyWired: view.applyWired,
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
