import type { ScreenshotShortcutState } from "@vibefield/contracts";
import { screenshotAccelerator } from "./app-menu-model";

export interface ScreenshotShortcutPort {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

/** One app-lifetime registration. No window or display owns a global shortcut;
 * closing/recreating the field must not change its delivery. Only unregister
 * the binding this owner successfully acquired, never other app shortcuts. */
export class ScreenshotShortcutController {
  private enabled = false;
  private registered = false;
  private disposed = false;
  private state: ScreenshotShortcutState;

  constructor(
    private readonly options: {
      port: ScreenshotShortcutPort;
      platform: NodeJS.Platform;
      helperAvailable: boolean;
      capture: () => void;
      onChanged: (state: ScreenshotShortcutState) => void;
    },
  ) {
    this.state = {
      status: "disabled",
      accelerator: screenshotAccelerator(options.platform === "darwin" ? "darwin" : "other"),
      message: null,
    };
  }

  current(): ScreenshotShortcutState {
    return { ...this.state };
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.release();
      this.publish("disabled", null);
      return;
    }
    if (!this.options.helperAvailable) {
      this.publish("unavailable", "The screenshot helper is unavailable on this device.");
      return;
    }
    try {
      this.registered = this.options.port.register(this.state.accelerator, () => {
        if (!this.disposed && this.enabled && this.registered) this.options.capture();
      });
    } catch {
      this.registered = false;
    }
    this.publish(
      this.registered ? "registered" : "conflict",
      this.registered
        ? null
        : "The screenshot shortcut could not be registered. Another app may be using it. Turn this setting off and on to retry; Take Screenshot still works inside VibeField.",
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
  }

  private release(): void {
    if (!this.registered) return;
    this.registered = false;
    this.options.port.unregister(this.state.accelerator);
  }

  private publish(status: ScreenshotShortcutState["status"], message: string | null): void {
    this.state = { ...this.state, status, message };
    this.options.onChanged(this.current());
  }
}
