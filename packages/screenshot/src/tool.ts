import { spawn as nodeSpawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access as fsAccess, unlink as fsUnlink } from "node:fs/promises";
import {
  SCREENSHOT_HELPER_ARGS,
  SCREENSHOT_LIMITS,
  type ScreenshotCaptureResult,
  type ScreenshotErrorCode,
  type ScreenshotHelperEvent,
} from "@vibefield/contracts";
import { ScreenshotLineReader } from "./protocol";

// The one-capture-at-a-time owner of the native screenshot helper (SNAP-D1).
//
// What it promises: one live helper at most (the overlay is modal by nature);
// a pre-overlay deadline that `ready` lifts; a terminal line settles the
// capture; a process that ends without one is an error, never a hang; a line
// the contract refuses kills the helper; dispose kills a live helper and
// settles its capture as `disposed`; finished stills stay on disk in a bounded
// ring, the oldest unlinked past it (SNAP-D4).
//
// What it deliberately does not do: resolve the helper's path (that is the
// shell's §4.3 resource contract), touch a clipboard, or talk to a window.

/** The slice of a child process this tool reads — narrow so a test can hand
 * it a scripted fake without a real helper binary. */
export interface ScreenshotToolChild {
  readonly pid?: number | undefined;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

export type ScreenshotToolSpawn = (
  helperPath: string,
  args: readonly string[],
) => ScreenshotToolChild;

export type ScreenshotToolEvent =
  | {
      readonly kind: "lifecycle";
      readonly event:
        | "screenshot.helper.spawned"
        | "screenshot.helper.ready"
        | "screenshot.helper.exited"
        | "screenshot.helper.killed"
        | "screenshot.capture.finished"
        | "screenshot.still.unlinked"
        | "screenshot.still.unlink_failed";
      readonly attrs: Readonly<Record<string, string | number | boolean | null>>;
    }
  | { readonly kind: "diagnostic"; readonly line: string };

export interface ScreenshotToolOptions {
  /** The helper executable, or null when this platform has no helper — then
   * every capture answers `unsupported-platform` and nothing is spawned. */
  readonly helperPath: string | null;
  readonly spawn?: ScreenshotToolSpawn;
  /** Existence + exec-bit check before a spawn; injectable for tests. */
  readonly access?: (path: string) => Promise<void>;
  readonly unlink?: (path: string) => Promise<void>;
  readonly preOverlayTimeoutMs?: number;
  /** How long a helper may linger after its terminal line before it is killed
   * — a lingering overlay would make every later capture `busy`. */
  readonly exitGraceMs?: number;
  readonly retainedStills?: number;
  readonly onEvent?: (event: ScreenshotToolEvent) => void;
}

const MAX_DIAGNOSTIC_LINE_CHARS = 4_096;
const DEFAULT_EXIT_GRACE_MS = 5_000;

function defaultSpawn(helperPath: string, args: readonly string[]): ScreenshotToolChild {
  return nodeSpawn(helperPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
    // A console-subsystem helper (Windows) must not flash a terminal.
    windowsHide: true,
  });
}

const defaultAccess = (path: string): Promise<void> => fsAccess(path, fsConstants.X_OK);
const defaultUnlink = (path: string): Promise<void> => fsUnlink(path);

interface LiveCapture {
  readonly child: ScreenshotToolChild;
  readonly reader: ScreenshotLineReader;
  readonly settle: (result: ScreenshotCaptureResult) => void;
  readonly startedAt: number;
  ready: boolean;
  settled: boolean;
  exited: boolean;
  lastDiagnostic: string | null;
  preOverlayTimer: ReturnType<typeof setTimeout> | null;
  exitGraceTimer: ReturnType<typeof setTimeout> | null;
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function error(code: ScreenshotErrorCode, message: string): ScreenshotCaptureResult {
  return { status: "error", code, message };
}

export class ScreenshotTool {
  readonly #helperPath: string | null;
  readonly #spawn: ScreenshotToolSpawn;
  readonly #access: (path: string) => Promise<void>;
  readonly #unlink: (path: string) => Promise<void>;
  readonly #preOverlayTimeoutMs: number;
  readonly #exitGraceMs: number;
  readonly #retainedStills: number;
  readonly #onEvent: ((event: ScreenshotToolEvent) => void) | undefined;
  readonly #stills: string[] = [];
  #live: LiveCapture | null = null;
  /** The slot is taken the moment `capture()` is called — before the
   * asynchronous exec-bit check — so `busy` never lies to a caller that asks
   * synchronously, and two concurrent callers cannot both pass the gate. */
  #reserved = false;
  #disposed = false;

  constructor(options: ScreenshotToolOptions) {
    this.#helperPath = options.helperPath;
    this.#spawn = options.spawn ?? defaultSpawn;
    this.#access = options.access ?? defaultAccess;
    this.#unlink = options.unlink ?? defaultUnlink;
    this.#preOverlayTimeoutMs = positiveInteger(
      options.preOverlayTimeoutMs,
      SCREENSHOT_LIMITS.PRE_OVERLAY_TIMEOUT_MS,
      "preOverlayTimeoutMs",
    );
    this.#exitGraceMs = positiveInteger(options.exitGraceMs, DEFAULT_EXIT_GRACE_MS, "exitGraceMs");
    this.#retainedStills = positiveInteger(
      options.retainedStills,
      SCREENSHOT_LIMITS.RETAINED_STILLS,
      "retainedStills",
    );
    this.#onEvent = options.onEvent;
  }

  /** True while a helper process is alive — settled or not. A helper that has
   * answered but not yet exited still owns the screen. */
  get busy(): boolean {
    return this.#live !== null || this.#reserved;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** The paths of the finished stills this tool still retains, oldest first. */
  get retainedStills(): readonly string[] {
    return [...this.#stills];
  }

  async capture(): Promise<ScreenshotCaptureResult> {
    if (this.#disposed) return error("disposed", "the screenshot tool was disposed");
    const helperPath = this.#helperPath;
    if (helperPath === null) {
      return error("unsupported-platform", "no native screenshot helper exists for this platform");
    }
    if (this.busy) {
      return error("busy", "a screenshot is already in progress");
    }
    this.#reserved = true;
    try {
      await this.#access(helperPath);
    } catch {
      this.#reserved = false;
      return error("helper-missing", `the screenshot helper is not executable at ${helperPath}`);
    }
    // The access check awaited; dispose may have happened meanwhile.
    if (this.#disposed) {
      this.#reserved = false;
      return error("disposed", "the screenshot tool was disposed");
    }

    let child: ScreenshotToolChild;
    try {
      child = this.#spawn(helperPath, [SCREENSHOT_HELPER_ARGS.once]);
    } catch (cause) {
      this.#reserved = false;
      return error(
        "helper-spawn-failed",
        `the screenshot helper could not be started: ${text(cause)}`,
      );
    }

    return new Promise<ScreenshotCaptureResult>((resolve) => {
      const live: LiveCapture = {
        child,
        reader: new ScreenshotLineReader(),
        settle: (result) => {
          if (live.settled) return;
          live.settled = true;
          this.clearPreOverlayTimer(live);
          this.emitFinished(live, result);
          if (!live.exited) this.armExitGrace(live);
          resolve(result);
        },
        startedAt: Date.now(),
        ready: false,
        settled: false,
        exited: false,
        lastDiagnostic: null,
        preOverlayTimer: null,
        exitGraceTimer: null,
      };
      this.#live = live;
      this.#reserved = false;
      this.emit({
        kind: "lifecycle",
        event: "screenshot.helper.spawned",
        attrs: { pid: child.pid ?? null, helperPath },
      });

      live.preOverlayTimer = setTimeout(() => {
        live.preOverlayTimer = null;
        if (live.ready || live.settled) return;
        live.settle(
          error(
            "helper-timeout",
            `the screenshot helper did not show its overlay within ${this.#preOverlayTimeoutMs} ms`,
          ),
        );
        this.kill(live, "pre-overlay timeout");
      }, this.#preOverlayTimeoutMs);

      child.stdout.on("data", (chunk: Buffer | string) => {
        for (const verdict of live.reader.push(chunk)) {
          if (verdict.kind === "violation") {
            live.settle(
              error(
                "helper-protocol",
                `the screenshot helper printed a line the contract refuses (${verdict.reason}: ${verdict.detail})`,
              ),
            );
            this.kill(live, `protocol violation: ${verdict.reason}`);
            return;
          }
          this.onHelperEvent(live, verdict.event);
        }
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        for (const line of String(chunk).split(/\r?\n/)) {
          const trimmed = line.trim().slice(0, MAX_DIAGNOSTIC_LINE_CHARS);
          if (trimmed.length === 0) continue;
          live.lastDiagnostic = trimmed;
          this.emit({ kind: "diagnostic", line: trimmed });
        }
      });
      child.on("error", (cause) => {
        this.onExit(live, null, null, cause);
      });
      child.on("exit", (code, signal) => {
        this.onExit(live, code, signal, null);
      });
    });
  }

  /** Kill a live helper (its capture settles `disposed`) and refuse every
   * later capture. Idempotent. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const live = this.#live;
    if (live === null) return;
    live.settle(error("disposed", "the screenshot tool was disposed while a capture was live"));
    this.kill(live, "dispose");
  }

  private onHelperEvent(live: LiveCapture, event: ScreenshotHelperEvent): void {
    switch (event.status) {
      case "ready": {
        if (live.ready) return;
        live.ready = true;
        this.clearPreOverlayTimer(live);
        this.emit({
          kind: "lifecycle",
          event: "screenshot.helper.ready",
          attrs: { pid: live.child.pid ?? null, afterMs: Date.now() - live.startedAt },
        });
        return;
      }
      case "ok": {
        const { v: _v, status: _status, ...still } = event;
        this.retain(still.path);
        live.settle({ status: "ok", ...still });
        return;
      }
      case "cancel": {
        live.settle({ status: "cancel" });
        return;
      }
      case "error": {
        live.settle(error(event.code, event.message));
        return;
      }
    }
  }

  private onExit(
    live: LiveCapture,
    code: number | null,
    signal: NodeJS.Signals | null,
    cause: Error | null,
  ): void {
    if (live.exited) return;
    live.exited = true;
    if (live.exitGraceTimer !== null) {
      clearTimeout(live.exitGraceTimer);
      live.exitGraceTimer = null;
    }
    if (this.#live === live) this.#live = null;
    this.emit({
      kind: "lifecycle",
      event: "screenshot.helper.exited",
      attrs: {
        pid: live.child.pid ?? null,
        code,
        signal,
        settled: live.settled,
        ...(cause === null ? {} : { error: text(cause) }),
      },
    });
    if (live.settled) return;
    if (cause !== null) {
      live.settle(
        error("helper-spawn-failed", `the screenshot helper could not be started: ${text(cause)}`),
      );
      return;
    }
    const how = signal !== null ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
    const detail = live.lastDiagnostic === null ? "" : ` — last stderr: ${live.lastDiagnostic}`;
    live.settle(
      error("helper-exited", `the screenshot helper ended without a result (${how})${detail}`),
    );
  }

  private kill(live: LiveCapture, reason: string): void {
    if (live.exited) return;
    let killed = false;
    try {
      killed = live.child.kill("SIGTERM");
    } catch {
      killed = false;
    }
    this.emit({
      kind: "lifecycle",
      event: "screenshot.helper.killed",
      attrs: { pid: live.child.pid ?? null, reason, killed },
    });
  }

  private armExitGrace(live: LiveCapture): void {
    if (live.exitGraceTimer !== null) return;
    live.exitGraceTimer = setTimeout(() => {
      live.exitGraceTimer = null;
      if (!live.exited) this.kill(live, "lingered after its terminal line");
    }, this.#exitGraceMs);
  }

  private clearPreOverlayTimer(live: LiveCapture): void {
    if (live.preOverlayTimer === null) return;
    clearTimeout(live.preOverlayTimer);
    live.preOverlayTimer = null;
  }

  private retain(path: string): void {
    this.#stills.push(path);
    while (this.#stills.length > this.#retainedStills) {
      const oldest = this.#stills.shift();
      if (oldest === undefined) break;
      void this.#unlink(oldest).then(
        () =>
          this.emit({
            kind: "lifecycle",
            event: "screenshot.still.unlinked",
            attrs: { path: oldest },
          }),
        (cause: unknown) =>
          this.emit({
            kind: "lifecycle",
            event: "screenshot.still.unlink_failed",
            attrs: { path: oldest, error: text(cause) },
          }),
      );
    }
  }

  private emitFinished(live: LiveCapture, result: ScreenshotCaptureResult): void {
    this.emit({
      kind: "lifecycle",
      event: "screenshot.capture.finished",
      attrs: {
        pid: live.child.pid ?? null,
        status: result.status,
        ...(result.status === "error" ? { code: result.code } : {}),
        ...(result.status === "ok" ? { width: result.width, height: result.height } : {}),
        elapsedMs: Date.now() - live.startedAt,
      },
    });
  }

  private emit(event: ScreenshotToolEvent): void {
    try {
      this.#onEvent?.(event);
    } catch {
      // An observer must never break a capture.
    }
  }
}

function text(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
