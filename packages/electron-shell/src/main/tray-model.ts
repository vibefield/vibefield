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
  quit(): void;
}

export interface TrayMenuItem {
  readonly id?: string;
  readonly type?: "normal" | "checkbox" | "separator";
  readonly label?: string;
  readonly enabled?: boolean;
  readonly checked?: boolean;
  readonly click?: () => void;
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

function updateItem(snapshot: TraySnapshot, actions: TrayActions): TrayMenuItem {
  switch (snapshot.update.kind) {
    case "idle":
      return {
        id: "update",
        label: "Check for Updates…",
        enabled: !snapshot.quitting && actions.checkForUpdates !== undefined,
        ...(actions.checkForUpdates !== undefined ? { click: actions.checkForUpdates } : {}),
      };
    case "checking":
      return { id: "update", label: "Checking for Updates…", enabled: false };
    case "downloading": {
      const percent = Math.max(0, Math.min(100, Math.round(snapshot.update.percent)));
      return {
        id: "update",
        label: `Downloading Update… ${percent}%`,
        enabled: false,
      };
    }
    case "ready":
      return {
        id: "update",
        label: "Restart to Update",
        enabled: !snapshot.quitting && actions.restartToUpdate !== undefined,
        ...(actions.restartToUpdate !== undefined ? { click: actions.restartToUpdate } : {}),
      };
    case "failed":
      return { id: "update", label: "Update Check Failed", enabled: false };
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
      enabled: actionable,
      click: actions.openPrimaryWindow,
    },
    {
      id: "status",
      label: serviceStatus(snapshot),
      enabled: false,
    },
    {
      id: "settings",
      label: "Settings…",
      enabled: actionable,
      click: actions.openSettings,
    },
    {
      id: "diagnostics",
      label: "Open Diagnostics…",
      enabled: actionable,
      click: actions.openDiagnostics,
    },
    updateItem(snapshot, actions),
    { type: "separator" },
  ];

  if (platform === "win32" || platform === "linux") {
    items.push({
      id: "background-shell",
      type: "checkbox",
      label: "Close window keeps VibeField running",
      checked: snapshot.backgroundShell,
      enabled: actionable,
      click: () => actions.setBackgroundShell(!snapshot.backgroundShell),
    });
  }

  items.push(
    {
      id: "show-tray",
      type: "checkbox",
      label: "Show status item",
      checked: snapshot.showTray,
      enabled: actionable,
      click: () => actions.setTrayVisible(!snapshot.showTray),
    },
    { type: "separator" },
    {
      id: "quit",
      label: "Quit VibeField",
      enabled: actionable,
      click: actions.quit,
    },
  );
  return items;
}
