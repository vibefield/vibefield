import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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

/** Item 568 (2026-11-19) — what this shell booted, kept where it outlives the shell (main's userData): at its next
 * start, a device it booted and left running when it ended without its quit (a crash, a Force Quit) is told from one
 * another VibeField is running, which is never this shell's to shut down. */
export interface OwnedDeviceLedger {
  has(udid: string): boolean;
  add(udid: string): void;
  remove(udid: string): void;
}

/** simctl's UDID alphabet (`simctl.ts`): a row in another shape is dropped as the ledger is read. */
const LEDGER_UDID = /^[A-Za-z0-9][A-Za-z0-9-]{7,127}$/u;

/** The ledger's file as read, before it is held to its shape. */
type LedgerFile = { v?: unknown; booted?: unknown } | null;

/** The ledger as one small file, `{ v: 1, booted: [udid…] }`, written whole (a temporary, then a rename). A file that
 * cannot be read as one starts the ledger empty, and `warn` says so; a write that fails is said too, and this run's
 * devices are still shut down when their panes let them go. */
export function fileOwnedDeviceLedger(
  path: string,
  warn?: (message: string) => void,
): OwnedDeviceLedger {
  const booted = new Set<string>();
  try {
    const record = JSON.parse(readFileSync(path, "utf8")) as LedgerFile;
    if (record?.v !== 1 || !Array.isArray(record.booted)) throw new Error("not a v1 ledger");
    for (const udid of record.booted)
      if (typeof udid === "string" && LEDGER_UDID.test(udid)) booted.add(udid);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      warn?.("the record of the simulators this shell booted could not be read; it starts empty");
  }
  const write = (): void => {
    try {
      mkdirSync(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify({ v: 1, booted: [...booted] })}\n`);
      renameSync(temporary, path);
    } catch {
      warn?.("the record of the simulators this shell booted could not be written");
    }
  };
  return {
    has: (udid) => booted.has(udid),
    add: (udid) => {
      if (booted.has(udid)) return;
      booted.add(udid);
      write();
    },
    remove: (udid) => {
      if (booted.delete(udid)) write();
    },
  };
}

/** One host-side lease per pane, model and OS. An installed runtime is shared,
 * but the guest data and the decision to power down belong to this configuration.
 * Item 568 (2026-11-19): with a ledger, a device this shell booted before it ended without its quit is its own again;
 * a running device the ledger does not hold stays alone. */
export class OwnedSimulatorDevices {
  readonly #uses = new Map<string, DeviceUse>();
  #closed = false;

  constructor(
    private readonly simctl: DeviceControl,
    private readonly graceMs = 10 * 60_000,
    private readonly shutdownFailed?: () => void,
    private readonly ledger?: OwnedDeviceLedger,
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
    if (pick.device?.state === "Booted" || pick.device?.state === "Booting") {
      // Item 568: one this shell booted before it ended without its quit is its own again; any other stays alone
      if (this.ledger?.has(pick.device.udid)) use.booted = pick.device.udid;
      return pick.device.udid;
    }
    const plan = pick.create;
    const udid =
      pick.device?.udid ??
      (plan && (await this.simctl.create(plan.name, plan.deviceType, plan.runtime)));
    if (!udid) throw new Error("Simulator configuration unavailable");
    if (this.#closed || !use.users) throw new Error("Simulator pane closed");
    // recorded before the boot, so a shell that ends mid-boot still knows the device at its next start
    this.ledger?.add(udid);
    try {
      await this.simctl.boot(udid);
    } catch (error) {
      this.ledger?.remove(udid);
      throw error;
    }
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
      if (this.simctl.shutdown) {
        await this.simctl.shutdown(use.booted);
        this.ledger?.remove(use.booted);
      }
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
