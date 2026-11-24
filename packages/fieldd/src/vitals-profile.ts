import { mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { Session } from "node:inspector";
import { join } from "node:path";
import { type CallerContext, VITALS_CAPTURES } from "@vibefield/contracts";
import {
  type VitalsCaptureFailure,
  VitalsProfileCaptureParams,
  type VitalsProfileCaptureResult,
  vitalsCaptureName,
  vitalsCapturesToRemove,
} from "@vibefield/contracts/vitals";
import type { Logger } from "@vibefield/logging";
import { RpcCallError } from "./native-link";
import type { ProductApi } from "./product-api";

// VT-5 (track VT, 2026-11-24; VT-D12 A; `vitals-captures.ts`) — A CPU PROFILE OF FIELDD, TAKEN FROM INSIDE IT. Armed
// by hand in the Vitals window and asked for by Electron main alone (`vitals.profile.capture`), it runs 10, 20 or 30
// seconds and switches itself off.
//
// It uses `node:inspector`'s in-process `Session`: `connect()` speaks to this process's own V8 inspector over no
// socket at all. It NEVER calls `inspector.open()` and opens no port: a debugging port on this device would be a door
// any same-uid process could walk through (EL7). The session is disconnected on every path: when the profile is
// taken, when a step fails, and when fieldd stops.
//
// One at a time. The `.cpuprofile` is written whole (a temporary, then a rename), 0600, in the captures folder
// under this user's own root, and the folder keeps its newest `VITALS_CAPTURES.KEEP`. It is sent nowhere.

/** The part of `node:inspector`'s `Session` used here. */
export interface ProfilerSession {
  connect(): void;
  post(
    method: string,
    params: object,
    callback: (error: Error | null, result?: unknown) => void,
  ): void;
  disconnect(): void;
}

export interface VitalsProfilerOptions {
  /** the captures folder: `<data root>/LAYOUT.VITALS_CAPTURES_DIR` */
  dir: string;
  logger: Logger;
  /** a new in-process session; `node:inspector`'s unless a test says */
  session?: () => ProfilerSession;
  /** how long a second lasts, in ms: 1,000 unless a test makes a capture short */
  msPerSecond?: number;
  now?: () => number;
}

interface Running {
  session: ProfilerSession;
  timer: ReturnType<typeof setTimeout> | null;
  /** ends the wait early: fieldd is stopping */
  cut: (() => void) | null;
}

function failed(kind: string, message: string, capture: VitalsCaptureFailure): RpcCallError {
  return new RpcCallError(kind, message, false, { capture });
}

function post(session: ProfilerSession, method: string, params: object = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try {
      session.post(method, params, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export class VitalsProfiler {
  private running: Running | null = null;
  private disposed = false;
  private readonly session: () => ProfilerSession;
  private readonly msPerSecond: number;
  private readonly now: () => number;

  constructor(private readonly options: VitalsProfilerOptions) {
    this.session = options.session ?? (() => new Session() as unknown as ProfilerSession);
    this.msPerSecond = options.msPerSecond ?? 1_000;
    this.now = options.now ?? Date.now;
  }

  /** Whether a profile is being taken now. */
  get busy(): boolean {
    return this.running !== null;
  }

  register(api: ProductApi): void {
    api.register("vitals.profile.capture", (ctx, params) => {
      assertShellMain(ctx);
      return this.capture(params);
    });
  }

  async capture(raw: unknown): Promise<VitalsProfileCaptureResult> {
    const parsed = VitalsProfileCaptureParams.safeParse(raw);
    if (!parsed.success) {
      throw new RpcCallError("PRECONDITION_FAILED", "expected { seconds: 10 | 20 | 30 }", false, {
        issues: parsed.error.issues.length,
      });
    }
    if (this.disposed) throw failed("UNAVAILABLE", "fieldd is stopping", "no-fieldd");
    if (this.running !== null) throw failed("CONFLICT", "a profile is already running", "busy");

    const { seconds } = parsed.data;
    const at = this.now();
    const session = this.session();
    const running: Running = { session, timer: null, cut: null };
    this.running = running;
    let profile: unknown;
    try {
      try {
        session.connect();
        await post(session, "Profiler.enable");
        await post(session, "Profiler.setSamplingInterval", {
          interval: VITALS_CAPTURES.PROFILE_SAMPLING_US,
        });
        await post(session, "Profiler.start");
      } catch (error) {
        this.options.logger.warn(
          "fieldd.vitals.profile_not_started",
          "fieldd's profiler would not start",
          { error },
        );
        throw failed("UNAVAILABLE", "the profiler would not start", "not-started");
      }
      const finished = await new Promise<boolean>((resolve) => {
        running.cut = () => resolve(false);
        running.timer = setTimeout(() => resolve(true), seconds * this.msPerSecond);
      });
      if (!finished)
        throw failed("UNAVAILABLE", "fieldd stopped before the profile ended", "cut-short");
      try {
        profile = ((await post(session, "Profiler.stop")) as { profile?: unknown } | undefined)
          ?.profile;
      } catch (error) {
        this.options.logger.warn(
          "fieldd.vitals.profile_not_taken",
          "fieldd's profile did not stop",
          {
            error,
          },
        );
        throw failed("INTERNAL", "the profile could not be taken", "not-saved");
      }
    } finally {
      this.end(running);
    }
    if (typeof profile !== "object" || profile === null) {
      throw failed("INTERNAL", "the profiler answered no profile", "not-saved");
    }
    const samples = (profile as { samples?: unknown }).samples;
    const name = vitalsCaptureName("profile", at);
    const bytes = await this.write(name, JSON.stringify(profile));
    this.options.logger.info("fieldd.vitals.profile_saved", "A CPU profile of fieldd was saved", {
      seconds,
      bytes,
    });
    return {
      name,
      bytes,
      seconds,
      ...(Array.isArray(samples) ? { samples: samples.length } : {}),
    };
  }

  /** The session is disconnected and the timer cleared, whatever happened. */
  private end(running: Running): void {
    if (running.timer !== null) clearTimeout(running.timer);
    running.timer = null;
    running.cut = null;
    try {
      running.session.disconnect();
    } catch {
      // a session that will not disconnect ends with the process; the profiler stops with it
    }
    if (this.running === running) this.running = null;
  }

  private async write(name: string, text: string): Promise<number> {
    const dir = this.options.dir;
    const target = join(dir, name);
    const partial = join(dir, `.${name}.${process.pid}.part`);
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(partial, text, { mode: 0o600 });
      await rename(partial, target);
    } catch (error) {
      await unlink(partial).catch(() => undefined);
      this.options.logger.warn(
        "fieldd.vitals.profile_not_saved",
        "fieldd's profile could not be written",
        {
          error,
        },
      );
      throw failed("INTERNAL", "the profile could not be written", "not-saved");
    }
    await this.prune();
    return Buffer.byteLength(text);
  }

  /** The captures folder's one rule: its newest `KEEP`, whoever wrote them. */
  private async prune(): Promise<void> {
    try {
      const names = await readdir(this.options.dir);
      for (const name of vitalsCapturesToRemove(names)) {
        await unlink(join(this.options.dir, name)).catch(() => undefined);
      }
    } catch {
      // a folder that cannot be read keeps what it holds; the next capture tries again
    }
  }

  /** fieldd is stopping: a profile being taken is cut, its session disconnected, and nothing is written. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const running = this.running;
    if (running === null) return;
    const cut = running.cut;
    this.end(running);
    cut?.();
  }
}

/** The scope names the door; this holds it to Electron main on this device, as the roster's door is held. */
function assertShellMain(ctx: CallerContext): void {
  if (ctx.transport !== "ws-loopback" || ctx.principal.kind !== "shell-main") {
    throw new RpcCallError(
      "FORBIDDEN_SCOPE",
      "a profile of fieldd is taken for Electron main alone",
      false,
    );
  }
}
