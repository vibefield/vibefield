import type { DesktopShellState } from "@vibefield/contracts";
import type { TrayImageKind } from "./resources";
import {
  buildTrayMenu,
  type TrayActions,
  type TrayMenuItem,
  type TrayPlatform,
  type TraySnapshot,
} from "./tray-model";

export interface NativeTrayPort {
  setImage(image: unknown): void;
  setToolTip(tooltip: string): void;
  setContextMenu(menu: unknown): void;
  on(event: "click" | "double-click" | "mouse-enter", listener: () => void): void;
  destroy(): void;
}

export interface TrayRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type TrayPlacement = "visible" | "offscreen" | "unknown";

export interface TrayImageInspection {
  readonly sourcePath: string | null;
  readonly width: number;
  readonly height: number;
  readonly scaleFactors: readonly number[];
  readonly template: boolean;
}

export interface TrayNativeInspection {
  readonly bounds: TrayRectangle | null;
  readonly displayBounds: readonly TrayRectangle[];
  readonly placement: TrayPlacement;
}

export type TrayNativeInspectionReason =
  | "created"
  | "settled"
  | "state-change"
  | "display-change"
  | "interaction";

export interface TrayNativeState {
  readonly reason: TrayNativeInspectionReason;
  readonly platform: TrayPlatform;
  readonly guid: string | null;
  readonly imageKind: TrayImageKind;
  readonly image: TrayImageInspection | null;
  readonly native: TrayNativeInspection;
}

export interface TrayRuntime {
  readonly platform: TrayPlatform;
  readonly guid: string | null;
  loadImage(kind: TrayImageKind): unknown;
  inspectImage(image: unknown, kind: TrayImageKind): TrayImageInspection;
  createTray(image: unknown): NativeTrayPort;
  inspectTray(tray: NativeTrayPort): TrayNativeInspection;
  watchDisplays(callback: () => void): () => void;
  buildMenu(items: readonly TrayMenuItem[]): unknown;
  schedule(callback: () => void, delayMs: number): unknown;
  cancelSchedule(handle: unknown): void;
}

export interface TrayControllerActions {
  openPrimaryWindow(): Promise<void>;
  openSettings(): Promise<void>;
  openDiagnostics(): Promise<void>;
  checkForUpdates?: () => Promise<void>;
  restartToUpdate?: () => Promise<void>;
  setBackgroundShell(enabled: boolean): Promise<void>;
  setTrayVisible(enabled: boolean): Promise<void>;
  /** UA-5 — optional like the update pair: absent hides the submenu. */
  switchUser?: (userId: string) => Promise<void>;
  newUser?: () => Promise<void>;
  quit(): void;
}

export type TrayControllerErrorStage = "create" | "menu" | "image" | "inspect" | "action";

export interface TrayControllerOptions {
  readonly runtime: TrayRuntime;
  readonly initial: TraySnapshot;
  readonly actions: TrayControllerActions;
  readonly onError: (stage: TrayControllerErrorStage, error: unknown) => void;
  readonly onNativeState?: (state: TrayNativeState) => void;
  readonly onDesktopState?: (state: DesktopShellState) => void;
}

const REBUILD_COALESCE_MS = 100;
const NATIVE_LAYOUT_SETTLE_MS = 250;

export function trayImageKind(snapshot: TraySnapshot): TrayImageKind {
  if (snapshot.link === "unavailable") return "offline";
  if (
    snapshot.evidence === "degraded" ||
    snapshot.update.kind === "failed" ||
    snapshot.update.kind === "ready"
  ) {
    return "attention";
  }
  return "base";
}

/** App-lifetime owner for the one native Tray. Window recreation never touches
 * this object; preference changes either destroy it or create exactly one new
 * instance. */
export class TrayController {
  private snapshot: TraySnapshot;
  private tray: NativeTrayPort | null = null;
  private refreshHandle: unknown | null = null;
  private nativeInspectionHandle: unknown | null = null;
  private pendingInspectionReason: TrayNativeInspectionReason | null = null;
  private readonly stopDisplayObservation: () => void;
  private disposed = false;
  private createFailed = false;
  private imageKind: TrayImageKind | null = null;
  private imageInspection: TrayImageInspection | null = null;
  private placement: TrayPlacement = "unknown";
  private lastNativeFingerprint = "";
  private lastDesktopState = "";

  constructor(private readonly options: TrayControllerOptions) {
    this.snapshot = options.initial;
    try {
      this.stopDisplayObservation = options.runtime.watchDisplays(() => {
        this.scheduleNativeInspection("display-change");
      });
    } catch (error) {
      this.stopDisplayObservation = () => undefined;
      options.onError("inspect", error);
    }
    this.reconcileVisibility();
    this.publishDesktopState();
  }

  update(patch: Partial<TraySnapshot>): void {
    if (this.disposed) return;
    const wasVisible = this.snapshot.showTray;
    this.snapshot = { ...this.snapshot, ...patch };
    if (wasVisible && !this.snapshot.showTray) this.createFailed = false;
    const created = this.reconcileVisibility();
    if (this.tray !== null && !created) this.scheduleRefresh();
    if (this.tray !== null) this.scheduleNativeInspection("state-change");
    this.publishDesktopState();
  }

  current(): TraySnapshot {
    return this.snapshot;
  }

  /** Windows/Linux may stay resident only while a real native escape hatch
   * exists. macOS retains the Dock path independently of tray visibility. */
  keepsAliveWithoutWindows(): boolean {
    if (this.options.runtime.platform === "darwin") return true;
    return (
      this.snapshot.backgroundShell &&
      this.snapshot.showTray &&
      this.tray !== null &&
      !this.disposed
    );
  }

  isUsable(): boolean {
    return this.tray !== null && !this.disposed;
  }

  desktopState(): DesktopShellState {
    const availability = !this.snapshot.showTray
      ? "hidden"
      : this.tray !== null && !this.disposed
        ? "available"
        : "unavailable";
    const placement = availability === "available" ? this.placement : "unknown";
    const backgroundShellEffective =
      (this.options.runtime.platform === "win32" || this.options.runtime.platform === "linux") &&
      availability === "available" &&
      this.snapshot.backgroundShell;
    const issue =
      availability === "unavailable"
        ? {
            code: "DESKTOP_TRAY_UNAVAILABLE" as const,
            message:
              this.options.runtime.platform === "darwin"
                ? "The native status item is unavailable for this session. VibeField remains reachable from the Dock."
                : "The native status item is unavailable for this session. Closing the last window will quit VibeField.",
          }
        : placement === "offscreen"
          ? {
              code: "DESKTOP_TRAY_OFFSCREEN" as const,
              message:
                "VibeField created its status item, but macOS placed it outside the visible menu bar. Hide or move another menu-bar item to make room.",
            }
          : null;
    return {
      tray: {
        availability,
        placement,
        backgroundShellEffective,
        issue,
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.snapshot = { ...this.snapshot, quitting: true };
    this.cancelRefresh();
    this.cancelNativeInspection();
    this.stopDisplayObservation();
    this.destroyTray();
    this.publishDesktopState();
  }

  private reconcileVisibility(): boolean {
    if (this.disposed || !this.snapshot.showTray) {
      this.cancelRefresh();
      this.destroyTray();
      return false;
    }
    if (this.tray !== null || this.createFailed) return false;

    let candidate: NativeTrayPort | null = null;
    try {
      const kind = trayImageKind(this.snapshot);
      const { image, inspection } = this.loadInspectedImage(kind);
      candidate = this.options.runtime.createTray(image);
      candidate.setToolTip("VibeField");
      candidate.setContextMenu(
        this.options.runtime.buildMenu(
          buildTrayMenu(this.snapshot, this.guardedActions(), this.options.runtime.platform),
        ),
      );
      if (this.options.runtime.platform === "win32") {
        candidate.on("double-click", () => {
          this.runAction("openPrimaryWindow", this.options.actions.openPrimaryWindow);
        });
      }
      if (this.options.runtime.platform === "darwin") {
        candidate.on("mouse-enter", () => {
          this.inspectNative("interaction");
        });
      }
      this.tray = candidate;
      this.imageKind = kind;
      this.imageInspection = inspection;
      this.inspectNative("created", true);
      this.scheduleNativeInspection("settled");
      return true;
    } catch (error) {
      candidate?.destroy();
      this.tray = null;
      this.imageKind = null;
      this.imageInspection = null;
      this.placement = "unknown";
      this.createFailed = true;
      this.options.onError("create", error);
      return false;
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshHandle !== null) return;
    this.refreshHandle = this.options.runtime.schedule(() => {
      this.refreshHandle = null;
      this.refreshNative();
    }, REBUILD_COALESCE_MS);
  }

  private cancelRefresh(): void {
    if (this.refreshHandle === null) return;
    this.options.runtime.cancelSchedule(this.refreshHandle);
    this.refreshHandle = null;
  }

  private scheduleNativeInspection(reason: TrayNativeInspectionReason): void {
    if (this.disposed || this.tray === null) return;
    this.pendingInspectionReason = reason;
    if (this.nativeInspectionHandle !== null) return;
    this.nativeInspectionHandle = this.options.runtime.schedule(() => {
      this.nativeInspectionHandle = null;
      const pending = this.pendingInspectionReason ?? "settled";
      this.pendingInspectionReason = null;
      this.inspectNative(pending);
    }, NATIVE_LAYOUT_SETTLE_MS);
  }

  private cancelNativeInspection(): void {
    if (this.nativeInspectionHandle !== null) {
      this.options.runtime.cancelSchedule(this.nativeInspectionHandle);
    }
    this.nativeInspectionHandle = null;
    this.pendingInspectionReason = null;
  }

  private inspectNative(reason: TrayNativeInspectionReason, force = false): void {
    const tray = this.tray;
    const imageKind = this.imageKind;
    if (this.disposed || tray === null || imageKind === null) return;
    try {
      const native = this.options.runtime.inspectTray(tray);
      const previousPlacement = this.placement;
      this.placement = native.placement;
      const state: TrayNativeState = {
        reason,
        platform: this.options.runtime.platform,
        guid: this.options.runtime.guid,
        imageKind,
        image: this.imageInspection,
        native,
      };
      const fingerprint = JSON.stringify({
        platform: state.platform,
        guid: state.guid,
        imageKind: state.imageKind,
        image: state.image,
        native: state.native,
      });
      if (force || fingerprint !== this.lastNativeFingerprint) {
        this.lastNativeFingerprint = fingerprint;
        this.options.onNativeState?.(state);
      }
      if (previousPlacement !== this.placement) this.publishDesktopState();
    } catch (error) {
      this.options.onError("inspect", error);
    }
  }

  private loadInspectedImage(kind: TrayImageKind): {
    image: unknown;
    inspection: TrayImageInspection | null;
  } {
    const image = this.options.runtime.loadImage(kind);
    try {
      return { image, inspection: this.options.runtime.inspectImage(image, kind) };
    } catch (error) {
      this.options.onError("inspect", error);
      return { image, inspection: null };
    }
  }

  private refreshNative(): void {
    const tray = this.tray;
    if (this.disposed || tray === null || !this.snapshot.showTray) return;
    const nextKind = trayImageKind(this.snapshot);
    if (nextKind !== this.imageKind) {
      try {
        const { image, inspection } = this.loadInspectedImage(nextKind);
        tray.setImage(image);
        this.imageKind = nextKind;
        this.imageInspection = inspection;
      } catch (error) {
        this.options.onError("image", error);
      }
    }
    try {
      tray.setContextMenu(
        this.options.runtime.buildMenu(
          buildTrayMenu(this.snapshot, this.guardedActions(), this.options.runtime.platform),
        ),
      );
    } catch (error) {
      this.options.onError("menu", error);
    }
  }

  private destroyTray(): void {
    const tray = this.tray;
    this.cancelNativeInspection();
    this.tray = null;
    this.imageKind = null;
    this.imageInspection = null;
    this.placement = "unknown";
    this.lastNativeFingerprint = "";
    tray?.destroy();
  }

  private publishDesktopState(): void {
    const state = this.desktopState();
    const serialized = JSON.stringify(state);
    if (serialized === this.lastDesktopState) return;
    this.lastDesktopState = serialized;
    this.options.onDesktopState?.(state);
  }

  private guardedActions(): TrayActions {
    return {
      openPrimaryWindow: () =>
        this.runAction("openPrimaryWindow", this.options.actions.openPrimaryWindow),
      openSettings: () => this.runAction("openSettings", this.options.actions.openSettings),
      openDiagnostics: () =>
        this.runAction("openDiagnostics", this.options.actions.openDiagnostics),
      ...(this.options.actions.checkForUpdates !== undefined
        ? {
            checkForUpdates: () =>
              this.runAction("checkForUpdates", this.options.actions.checkForUpdates!),
          }
        : {}),
      ...(this.options.actions.restartToUpdate !== undefined
        ? {
            restartToUpdate: () =>
              this.runAction("restartToUpdate", this.options.actions.restartToUpdate!),
          }
        : {}),
      ...(this.options.actions.switchUser !== undefined
        ? {
            switchUser: (userId: string) =>
              this.runAction("switchUser", () => this.options.actions.switchUser!(userId)),
          }
        : {}),
      ...(this.options.actions.newUser !== undefined
        ? {
            newUser: () => this.runAction("newUser", this.options.actions.newUser!),
          }
        : {}),
      setBackgroundShell: (enabled) =>
        this.runAction("setBackgroundShell", () =>
          this.options.actions.setBackgroundShell(enabled),
        ),
      setTrayVisible: (enabled) =>
        this.runAction("setTrayVisible", () => this.options.actions.setTrayVisible(enabled)),
      quit: () => {
        if (this.disposed || this.snapshot.quitting) return;
        this.options.actions.quit();
      },
    };
  }

  private runAction(name: string, action: () => Promise<void>): void {
    if (this.disposed || this.snapshot.quitting) return;
    void action().catch((error) => {
      this.options.onError("action", { action: name, error });
    });
  }
}
