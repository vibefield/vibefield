import { join } from "node:path";
import { VITALS_CAPTURES } from "@vibefield/contracts/registries";
import {
  VitalsCaptureArmParams,
  type VitalsCaptureArmResult,
  type VitalsCaptureFailure,
  type VitalsCaptureKind,
  VitalsCaptureRevealParams,
  type VitalsCaptureSeconds,
  type VitalsCaptureState,
  type VitalsFrameCountFileV1,
  VitalsFrameCountV1,
  VitalsProfileCaptureResult,
  vitalsCaptureName,
  vitalsCapturesToRemove,
} from "@vibefield/contracts/vitals";
import type { Logger } from "@vibefield/logging";

// VT-5 (track VT, 2026-11-24; VT-D5, VT-D9, VT-D12 A; DESIGN.md §8 "Vitals", "Captures") — THE ARMED CAPTURES, MAIN'S
// HALF. The Vitals window arms one by hand; main holds the one in hand (one at a time, for the whole app), runs it for
// its length and switches it off. Three kinds:
//
//   trace    Chromium's `contentTracing`, stopped on the timer, when the window goes, at a quit, on an error;
//   profile  fieldd's own door (`vitals.profile.capture`): fieldd profiles itself from inside and writes the file;
//   frames   the desk window's preload counts its own frames and says what it counted (`vitals-frame-count.ts`).
//
// Main writes the trace and the count into the captures folder under the user's own root, whole (a temporary, then
// a rename) and 0600, and keeps the newest ten by the one rule. Nothing here is sent anywhere. Everything that
// touches Electron or the disk is handed in, so the rules are tested without either.

/** The part of Electron's `contentTracing` used here (electron.d.ts, `ContentTracing`). */
export interface CaptureTracing {
  startRecording(options: {
    included_categories: string[];
    excluded_categories: string[];
    recording_mode: "record-until-full";
    trace_buffer_size_in_kb: number;
  }): Promise<void>;
  /** writes the trace to the path given and resolves with it */
  stopRecording(resultFilePath: string): Promise<string>;
}

export interface CaptureFieldd {
  request(method: string, params?: unknown, opts?: { timeoutMs?: number }): Promise<unknown>;
}

/** The desk window's count, or why there is none. */
export type DeskFramesAnswer =
  | { ok: true; count: unknown }
  | { ok: false; reason: Extract<VitalsCaptureFailure, "no-desk" | "cut-short" | "busy"> };

export interface CaptureFiles {
  mkdir(path: string): Promise<void>;
  writeFile(path: string, text: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  size(path: string): Promise<number>;
  readdir(path: string): Promise<string[]>;
  unlink(path: string): Promise<void>;
}

export interface VitalsCapturesOptions {
  /** the captures folder now (`<user root>/LAYOUT.VITALS_CAPTURES_DIR`), or null while main has no user root */
  dir(): string | null;
  tracing: CaptureTracing;
  /** main's fieldd client now, or null while there is none */
  fieldd(): CaptureFieldd | null;
  /** ask the desk window to count its frames for `seconds` */
  deskFrames(seconds: VitalsCaptureSeconds): Promise<DeskFramesAnswer>;
  files: CaptureFiles;
  /** every change of the state, for the Vitals window */
  onState(state: VitalsCaptureState): void;
  logger: Logger;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

/** A bounded category set: what a person chasing a slow frame or a busy process reads, and not the whole firehose.
 * `disabled-by-default-*` rows are Chromium's own heavier detail for the timeline. */
export const VITALS_TRACE_CATEGORIES: readonly string[] = [
  "toplevel",
  "benchmark",
  "blink",
  "blink.user_timing",
  "cc",
  "gpu",
  "viz",
  "v8",
  "v8.execute",
  "input",
  "latencyInfo",
  "loading",
  "electron",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
];

const TRACE_EXCLUDED: readonly string[] = ["*"];

interface Running {
  id: number;
  kind: VitalsCaptureKind;
  seconds: VitalsCaptureSeconds;
  /** what ends it early: the Vitals window went, or main is leaving */
  cut(why: "window" | "quit"): void;
  /** an end asked for before the kind could hear it (the trace still starting) */
  cutAsked: boolean;
}

const failureOf = (raw: unknown): VitalsCaptureFailure | null => {
  const details = (raw as { details?: { capture?: unknown } } | null)?.details;
  const said = details?.capture;
  return said === "busy" ||
    said === "no-fieldd" ||
    said === "cut-short" ||
    said === "not-saved" ||
    said === "not-started"
    ? said
    : null;
};

export class VitalsCaptures {
  private state: VitalsCaptureState = { state: "idle" };
  private running: Running | null = null;
  private sequence = 0;
  private disposed = false;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;

  constructor(private readonly options: VitalsCapturesOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer =
      options.setTimer ??
      ((fn, ms) => {
        const timer = setTimeout(fn, ms);
        // a quit never waits on a capture: `dispose` stops it
        timer.unref();
        return timer;
      });
    this.clearTimer =
      options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  /** The capture as the window sees it now. */
  current(): VitalsCaptureState {
    return this.state;
  }

  /** The window asked for a capture. What it sent is checked here, field by field, against the closed lists: a kind,
   * a length. A second while one runs is refused, and the one running goes on. */
  arm(raw: unknown): VitalsCaptureArmResult {
    const parsed = VitalsCaptureArmParams.safeParse(raw);
    if (!parsed.success) return { accepted: false, reason: "not-started" };
    if (this.disposed) return { accepted: false, reason: "not-started" };
    if (this.running !== null) return { accepted: false, reason: "busy" };
    const { kind } = parsed.data;
    const seconds = parsed.data.seconds as VitalsCaptureSeconds;
    const dir = this.options.dir();
    if (dir === null) {
      this.finish(null, { state: "failed", kind, reason: "not-saved" });
      return { accepted: false, reason: "not-saved" };
    }
    if (kind === "profile" && this.options.fieldd() === null) {
      this.finish(null, { state: "failed", kind, reason: "no-fieldd" });
      return { accepted: false, reason: "no-fieldd" };
    }
    const at = this.now();
    this.sequence += 1;
    const running: Running = {
      id: this.sequence,
      kind,
      seconds,
      cutAsked: false,
      cut: () => {
        running.cutAsked = true;
      },
    };
    this.running = running;
    this.set({ state: "running", kind, seconds, endsAt: at + seconds * 1_000 });
    this.options.logger.info("desktop.vitals.capture_armed", "A vitals capture was armed by hand", {
      kind,
      seconds,
    });
    const run =
      kind === "trace"
        ? this.trace(running, dir, at)
        : kind === "profile"
          ? this.profile(running)
          : this.frames(running, dir, at);
    void run.catch((error: unknown) => {
      this.options.logger.warn("desktop.vitals.capture_failed", "A vitals capture failed", {
        kind,
        error: error instanceof Error ? error.message : String(error),
      });
      this.finish(running, { state: "failed", kind, reason: "not-saved" });
    });
    return { accepted: true };
  }

  /** The window asked to show a saved file: a capture's own name, joined to the folder here. Null for anything else. */
  revealPath(raw: unknown): string | null {
    const parsed = VitalsCaptureRevealParams.safeParse(raw);
    const dir = this.options.dir();
    if (!parsed.success || dir === null) return null;
    return join(dir, parsed.data.name);
  }

  /** The Vitals window went (closed, or its page gone): a trace or a count is stopped and not saved. A profile fieldd
   * began ends at its own time in fieldd and is saved there: main goes on waiting for its answer, so a window opened
   * again hears it running, then saved (DESIGN.md §8 "Captures": "window or none"). */
  cut(): void {
    this.running?.cut("window");
  }

  /** Main is leaving: whatever runs is stopped now, a profile's wait too (fieldd still ends and keeps its own). */
  dispose(): void {
    if (this.disposed) return;
    // a leaving main tells no window
    this.disposed = true;
    this.running?.cut("quit");
  }

  // -- the three kinds ---------------------------------------------------------------------------------------------

  private async trace(running: Running, dir: string, at: number): Promise<void> {
    const name = vitalsCaptureName("trace", at);
    const partial = join(dir, `.${name}.part`);
    try {
      await this.options.files.mkdir(dir);
      await this.options.tracing.startRecording({
        included_categories: [...VITALS_TRACE_CATEGORIES],
        excluded_categories: [...TRACE_EXCLUDED],
        recording_mode: "record-until-full",
        trace_buffer_size_in_kb: VITALS_CAPTURES.TRACE_BUFFER_KB,
      });
    } catch (error) {
      this.options.logger.warn(
        "desktop.vitals.trace_not_started",
        "Chromium's trace would not start",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      this.finish(running, { state: "failed", kind: "trace", reason: "not-started" });
      return;
    }
    // whatever ends it, the recording is stopped exactly once
    const ended = await new Promise<boolean>((resolve) => {
      if (running.cutAsked) {
        resolve(false);
        return;
      }
      const timer = this.setTimer(() => resolve(true), running.seconds * 1_000);
      running.cut = () => {
        this.clearTimer(timer);
        resolve(false);
      };
    });
    let written: string | null = null;
    try {
      written = await this.options.tracing.stopRecording(partial);
    } catch (error) {
      this.options.logger.warn(
        "desktop.vitals.trace_not_stopped",
        "Chromium's trace did not stop cleanly",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
    if (!ended || written === null) {
      await this.options.files.unlink(partial).catch(() => undefined);
      this.finish(running, {
        state: "failed",
        kind: "trace",
        reason: ended ? "not-saved" : "cut-short",
      });
      return;
    }
    await this.keep(running, "trace", partial, name);
  }

  private async profile(running: Running): Promise<void> {
    const client = this.options.fieldd();
    if (client === null) {
      this.finish(running, { state: "failed", kind: "profile", reason: "no-fieldd" });
      return;
    }
    // the window going changes nothing here: fieldd ends the profile at its own time and keeps it, and main goes on
    // waiting so the window, opened again, hears it. Only main leaving stops the wait.
    let cut = false;
    running.cut = (why) => {
      if (why === "window") return;
      cut = true;
      this.finish(running, { state: "idle" });
    };
    let raw: unknown;
    try {
      raw = await client.request(
        "vitals.profile.capture",
        { seconds: running.seconds },
        { timeoutMs: running.seconds * 1_000 + VITALS_CAPTURES.REPLY_GRACE_MS },
      );
    } catch (error) {
      if (cut) return;
      const kind = (error as { kind?: unknown } | null)?.kind;
      const reason =
        failureOf(error) ??
        (kind === "CONFLICT" ? "busy" : kind === "FORBIDDEN_SCOPE" ? "not-started" : "no-fieldd");
      this.options.logger.warn("desktop.vitals.profile_failed", "fieldd's profile was not taken", {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      this.finish(running, { state: "failed", kind: "profile", reason });
      return;
    }
    if (cut) return;
    const result = VitalsProfileCaptureResult.safeParse(raw);
    if (!result.success) {
      this.finish(running, { state: "failed", kind: "profile", reason: "not-saved" });
      return;
    }
    this.finish(running, {
      state: "saved",
      kind: "profile",
      seconds: running.seconds,
      name: result.data.name,
      bytes: result.data.bytes,
      ...(result.data.samples !== undefined ? { samples: result.data.samples } : {}),
    });
  }

  private async frames(running: Running, dir: string, at: number): Promise<void> {
    let cut = false;
    running.cut = () => {
      cut = true;
      this.finish(running, { state: "failed", kind: "frames", reason: "cut-short" });
    };
    const answer = await this.options.deskFrames(running.seconds);
    if (cut) return;
    if (!answer.ok) {
      this.finish(running, { state: "failed", kind: "frames", reason: answer.reason });
      return;
    }
    const count = VitalsFrameCountV1.safeParse(answer.count);
    if (!count.success) {
      this.finish(running, { state: "failed", kind: "frames", reason: "not-saved" });
      return;
    }
    const name = vitalsCaptureName("frames", at);
    const partial = join(dir, `.${name}.part`);
    const file: VitalsFrameCountFileV1 = { v: 1, kind: "frames", at, ...count.data };
    try {
      await this.options.files.mkdir(dir);
      await this.options.files.writeFile(partial, `${JSON.stringify(file, null, 2)}\n`);
    } catch {
      await this.options.files.unlink(partial).catch(() => undefined);
      this.finish(running, { state: "failed", kind: "frames", reason: "not-saved" });
      return;
    }
    await this.keep(running, "frames", partial, name, count.data);
  }

  /** A written temporary becomes the capture's file: private, renamed whole, then the folder's rule. */
  private async keep(
    running: Running,
    kind: "trace" | "frames",
    partial: string,
    name: string,
    frames?: VitalsFrameCountV1,
  ): Promise<void> {
    const dir = this.options.dir();
    if (dir === null) {
      await this.options.files.unlink(partial).catch(() => undefined);
      this.finish(running, { state: "failed", kind, reason: "not-saved" });
      return;
    }
    const target = join(dir, name);
    let bytes: number;
    try {
      await this.options.files.chmod(partial, 0o600);
      await this.options.files.rename(partial, target);
      bytes = await this.options.files.size(target);
    } catch {
      await this.options.files.unlink(partial).catch(() => undefined);
      this.finish(running, { state: "failed", kind, reason: "not-saved" });
      return;
    }
    await this.prune(dir);
    this.options.logger.info("desktop.vitals.capture_saved", "A vitals capture was saved", {
      kind,
      seconds: running.seconds,
      bytes,
    });
    this.finish(running, {
      state: "saved",
      kind,
      seconds: running.seconds,
      name,
      bytes,
      ...(frames !== undefined ? { frames } : {}),
    });
  }

  private async prune(dir: string): Promise<void> {
    try {
      const names = await this.options.files.readdir(dir);
      for (const name of vitalsCapturesToRemove(names)) {
        await this.options.files.unlink(join(dir, name)).catch(() => undefined);
      }
    } catch {
      // a folder that cannot be read keeps what it holds; the next capture tries again
    }
  }

  /** The capture in hand ended (or none began): the state is said and the slot is free. A late end of a capture
   * that was already ended says nothing. */
  private finish(running: Running | null, next: VitalsCaptureState): void {
    if (running !== null) {
      if (this.running !== running) return;
      this.running = null;
    }
    this.set(next);
  }

  private set(next: VitalsCaptureState): void {
    this.state = next;
    if (this.disposed) return;
    try {
      this.options.onState(next);
    } catch {
      // a window that went between the change and its telling hears the state when it asks
    }
  }
}
