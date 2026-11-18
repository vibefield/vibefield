import type { LiveSurfaceIosSimulatorBindingV1 } from "@vibefield/contracts";
import { pickDevice, type SimctlService } from "./simctl";

type DeviceControl = Pick<SimctlService, "list" | "invalidate" | "create" | "boot"> &
  Partial<Pick<SimctlService, "shutdown">>;
export interface OwnedSimulatorLease {
  start(): Promise<string>;
  release(): void;
}
interface DeviceUse {
  users: number;
  booted?: string;
  starting: Promise<string> | undefined;
  stopping: Promise<void> | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** One host-side lease per pane, model and OS. An installed runtime is shared,
 * but the guest data and the decision to power down belong to this configuration. */
export class OwnedSimulatorDevices {
  readonly #uses = new Map<string, DeviceUse>();
  #closed = false;

  constructor(
    private readonly simctl: DeviceControl,
    private readonly graceMs = 10 * 60_000,
    private readonly shutdownFailed?: () => void,
  ) {}

  acquire(binding: LiveSurfaceIosSimulatorBindingV1): OwnedSimulatorLease {
    if (this.#closed || !binding.instance)
      throw new Error("Expected an active pane-owned simulator");
    const key = JSON.stringify([binding.instance, binding.deviceType, binding.runtime]);
    const use = this.#uses.get(key) ?? {
      users: 0,
      starting: undefined,
      stopping: undefined,
      timer: undefined,
    };
    this.#uses.set(key, use);
    clearTimeout(use.timer);
    use.timer = undefined;
    use.users++;
    let released = false;
    return {
      start: () => {
        if (released || this.#closed) return Promise.reject(new Error("Simulator pane closed"));
        if (use.starting) return use.starting;
        const pending = this.boot(binding, use).finally(() => {
          use.starting = undefined;
        });
        use.starting = pending;
        return pending;
      },
      release: () => {
        if (released) return;
        released = true;
        if (--use.users === 0) this.idle(key, use);
      },
    };
  }

  private async boot(binding: LiveSurfaceIosSimulatorBindingV1, use: DeviceUse): Promise<string> {
    if (use.stopping) await use.stopping;
    this.simctl.invalidate();
    const pick = pickDevice(await this.simctl.list(), binding);
    if (this.#closed || !use.users) throw new Error("Simulator pane closed");
    if (pick.device?.state === "Booted" || pick.device?.state === "Booting")
      return pick.device.udid;
    const plan = pick.create;
    const udid =
      pick.device?.udid ??
      (plan && (await this.simctl.create(plan.name, plan.deviceType, plan.runtime)));
    if (!udid) throw new Error("Simulator configuration unavailable");
    if (this.#closed || !use.users) throw new Error("Simulator pane closed");
    await this.simctl.boot(udid);
    use.booted = udid;
    return udid;
  }

  private idle(key: string, use: DeviceUse): void {
    if (this.#closed || use.users || use.stopping) return;
    if (!use.booted && !use.starting) {
      this.#uses.delete(key);
      return;
    }
    if (use.timer) return;
    use.timer = setTimeout(() => {
      use.timer = undefined;
      void this.stop(key, use);
    }, this.graceMs);
    use.timer.unref?.();
  }

  private stop(key: string, use: DeviceUse): Promise<void> {
    if (use.stopping) return use.stopping;
    const startup = use.starting;
    const stop = async () => {
      if (startup) await startup.catch(() => {});
      if ((!this.#closed && use.users) || !use.booted) return;
      await this.simctl.shutdown?.(use.booted);
      delete use.booted;
    };
    use.stopping = stop()
      .catch(() => this.shutdownFailed?.())
      .finally(() => {
        use.stopping = undefined;
        if (this.#closed) this.#uses.delete(key);
        else this.idle(key, use);
      });
    return use.stopping;
  }

  async dispose(): Promise<void> {
    this.#closed = true;
    await Promise.all(
      Array.from(this.#uses, ([key, use]) => {
        clearTimeout(use.timer);
        return this.stop(key, use);
      }),
    );
  }
}
