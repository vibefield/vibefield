export type TrayLinkState = "starting" | "ready" | "reconnecting" | "unavailable";
export type TrayEvidenceState = "healthy" | "degraded";
export type TrayUpdateState =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "downloading"; readonly percent: number }
  | { readonly kind: "ready"; readonly version: string }
  | { readonly kind: "failed" };

export interface TraySnapshot {
  readonly link: TrayLinkState;
  readonly evidence: TrayEvidenceState;
  readonly update: TrayUpdateState;
  /** UA-2 — the attached user's display name; absent hides the row (older
   * callers, tests). UA-3's Account section renames it live. */
  readonly userName?: string;
  /** UA-5 — the roster behind the Switch User submenu; absent hides it. */
  readonly users?: ReadonlyArray<{
    readonly userId: string;
    readonly name: string;
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
    case "ready": {
      const enabled = actionable && actions.restartToUpdate !== undefined;
      return {
        id: "update",
        label: "Restart to Update",
        ...availability(platform, enabled),
        ...(enabled ? { click: actions.restartToUpdate } : {}),
      };
    }
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
    ...(snapshot.userName !== undefined
      ? [
          {
            id: "user",
            label: `User: ${snapshot.userName}`,
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
                  label: u.name,
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
