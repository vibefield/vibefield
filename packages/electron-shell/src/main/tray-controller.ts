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
  on(event: "click" | "double-click", listener: () => void): void;
  destroy(): void;
}

export interface TrayRuntime {
  readonly platform: TrayPlatform;
  loadImage(kind: TrayImageKind): unknown;
  createTray(image: unknown): NativeTrayPort;
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
  quit(): void;
}

export type TrayControllerErrorStage = "create" | "menu" | "image" | "action";

export interface TrayControllerOptions {
  readonly runtime: TrayRuntime;
  readonly initial: TraySnapshot;
  readonly actions: TrayControllerActions;
  readonly onError: (stage: TrayControllerErrorStage, error: unknown) => void;
}

const REBUILD_COALESCE_MS = 100;

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
  private disposed = false;
  private createFailed = false;
  private imageKind: TrayImageKind | null = null;

  constructor(private readonly options: TrayControllerOptions) {
    this.snapshot = options.initial;
    this.reconcileVisibility();
  }

  update(patch: Partial<TraySnapshot>): void {
    if (this.disposed) return;
    const wasVisible = this.snapshot.showTray;
    this.snapshot = { ...this.snapshot, ...patch };
    if (wasVisible && !this.snapshot.showTray) this.createFailed = false;
    const created = this.reconcileVisibility();
    if (this.tray !== null && !created) this.scheduleRefresh();
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.snapshot = { ...this.snapshot, quitting: true };
    this.cancelRefresh();
    this.destroyTray();
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
      const image = this.options.runtime.loadImage(kind);
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
      this.tray = candidate;
      this.imageKind = kind;
      return true;
    } catch (error) {
      candidate?.destroy();
      this.tray = null;
      this.imageKind = null;
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

  private refreshNative(): void {
    const tray = this.tray;
    if (this.disposed || tray === null || !this.snapshot.showTray) return;
    const nextKind = trayImageKind(this.snapshot);
    if (nextKind !== this.imageKind) {
      try {
        tray.setImage(this.options.runtime.loadImage(nextKind));
        this.imageKind = nextKind;
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
    this.tray = null;
    this.imageKind = null;
    tray?.destroy();
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
