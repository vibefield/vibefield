import { spawn as nodeSpawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access as fsAccess, unlink as fsUnlink } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {
  SCREENSHOT_HELPER_ARGS,
  SCREENSHOT_HELPER_PROTOCOL_VERSION,
  SCREENSHOT_LIMITS,
  type ScreenshotCaptureError,
  type ScreenshotCaptureResult,
  type ScreenshotErrorCode,
  ScreenshotHelperCommand,
  type ScreenshotHelperEvent,
} from "@vibefield/contracts";
import { ScreenshotLineReader } from "./protocol";

/** A helper is either one-shot or a host-owned service. A service can be idle
 * between captures, but never has two captures or outlives its host. */
export interface ScreenshotToolChild {
  readonly pid?: number | undefined;
  readonly stdin?: NodeJS.WritableStream | null;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
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
        | "screenshot.helper.idle"
        | "screenshot.helper.prepare_failed"
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
  readonly helperPath: string | null;
  /** Only opt in for a helper that implements --service (currently macOS). */
  readonly persistent?: boolean;
  readonly spawn?: ScreenshotToolSpawn;
  readonly access?: (path: string) => Promise<void>;
  readonly unlink?: (path: string) => Promise<void>;
  readonly preOverlayTimeoutMs?: number;
  /** Deadline for exit (--once) or an idle acknowledgement (--service) after
   * the terminal result. Until then the helper may still own an overlay. */
  readonly exitGraceMs?: number;
  readonly retainedStills?: number;
  readonly onEvent?: (event: ScreenshotToolEvent) => void;
}

const MAX_DIAGNOSTIC_LINE_CHARS = 4_096;
const DEFAULT_EXIT_GRACE_MS = 5_000;
const KILL_GRACE_MS = 1_000;
type Timer = ReturnType<typeof setTimeout>;

function defaultSpawn(helperPath: string, args: readonly string[]): ScreenshotToolChild {
  return nodeSpawn(helperPath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
    windowsHide: true,
  });
}

interface LiveCapture {
  readonly settle: (result: ScreenshotCaptureResult) => void;
  readonly startedAt: number;
  readonly reused: boolean;
  sent: boolean;
  ready: boolean;
  settled: boolean;
  timer: Timer | null;
}

interface LiveHelper {
  readonly child: ScreenshotToolChild;
  readonly reader: ScreenshotLineReader;
  readonly startedAt: number;
  booted: boolean;
  exited: boolean;
  stopping: boolean;
  capture: LiveCapture | null;
  failure: ScreenshotCaptureError | null;
  lastDiagnostic: string | null;
  bootTimer: Timer | null;
  exitTimer: Timer | null;
  killTimer: Timer | null;
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function error(code: ScreenshotErrorCode, message: string): ScreenshotCaptureError {
  return { status: "error", code, message };
}

export class ScreenshotTool {
  readonly #helperPath: string | null;
  readonly #persistent: boolean;
  readonly #spawn: ScreenshotToolSpawn;
  readonly #access: (path: string) => Promise<void>;
  readonly #unlink: (path: string) => Promise<void>;
  readonly #preOverlayTimeoutMs: number;
  readonly #exitGraceMs: number;
  readonly #retainedStills: number;
  readonly #onEvent: ((event: ScreenshotToolEvent) => void) | undefined;
  readonly #stills: string[] = [];
  #helper: LiveHelper | null = null;
  #starting: Promise<LiveHelper | ScreenshotCaptureError> | null = null;
  #reserved = false;
  #disposed = false;

  constructor(options: ScreenshotToolOptions) {
    this.#helperPath = options.helperPath;
    this.#persistent = options.persistent ?? false;
    this.#spawn = options.spawn ?? defaultSpawn;
    this.#access = options.access ?? ((path) => fsAccess(path, fsConstants.X_OK));
    this.#unlink = options.unlink ?? fsUnlink;
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

  get busy(): boolean {
    const helper = this.#helper;
    return (
      this.#reserved ||
      (helper !== null && (!this.#persistent || helper.stopping || helper.capture !== null))
    );
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get retainedStills(): readonly string[] {
    return [...this.#stills];
  }

  /** Boot native frameworks without permission prompts, pixels, windows or
   * activation. Failure is nonfatal; the next capture attempts a fresh start. */
  async prepare(): Promise<void> {
    if (!this.#persistent || this.#disposed || this.#helperPath === null) return;
    const result = await this.ensureHelper();
    if ("status" in result) {
      this.emit({
        kind: "lifecycle",
        event: "screenshot.helper.prepare_failed",
        attrs: { code: result.code, message: result.message },
      });
    }
  }

  async capture(): Promise<ScreenshotCaptureResult> {
    if (this.#disposed) return error("disposed", "the screenshot tool was disposed");
    if (this.busy) return error("busy", "a screenshot is already in progress");
    // Reserve synchronously, including a capture racing the prewarm/access check.
    this.#reserved = true;
    const startedAt = performance.now();
    const helper = await this.ensureHelper();
    this.#reserved = false;
    if (this.#disposed) return error("disposed", "the screenshot tool was disposed");
    if ("status" in helper) return helper;
    if (helper.exited || helper.stopping) {
      return helper.failure ?? error("helper-exited", "the screenshot helper ended before capture");
    }
    return new Promise<ScreenshotCaptureResult>((resolve) => {
      const capture: LiveCapture = {
        startedAt,
        reused: this.#persistent && helper.booted,
        sent: !this.#persistent,
        ready: false,
        settled: false,
        timer: null,
        settle: (result) => {
          if (capture.settled) return;
          capture.settled = true;
          if (capture.timer !== null) clearTimeout(capture.timer);
          capture.timer = null;
          this.emit({
            kind: "lifecycle",
            event: "screenshot.capture.finished",
            attrs: {
              pid: helper.child.pid ?? null,
              status: result.status,
              ...(result.status === "error" ? { code: result.code } : {}),
              ...(result.status === "ok" ? { width: result.width, height: result.height } : {}),
              elapsedMs: performance.now() - startedAt,
            },
          });
          if (!helper.exited && !helper.stopping) {
            helper.exitTimer = setTimeout(() => {
              helper.exitTimer = null;
              this.kill(helper, "lingered after its terminal line");
            }, this.#exitGraceMs);
          }
          resolve(result);
        },
      };
      helper.capture = capture;
      capture.timer = setTimeout(() => {
        this.fail(
          helper,
          error(
            "helper-timeout",
            `the screenshot helper did not show its overlay within ${this.#preOverlayTimeoutMs} ms`,
          ),
        );
      }, this.#preOverlayTimeoutMs);
      if (this.#persistent && helper.booted) this.sendCapture(helper);
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#helper !== null) {
      this.fail(this.#helper, error("disposed", "the screenshot tool was disposed"));
    }
  }

  private async ensureHelper(): Promise<LiveHelper | ScreenshotCaptureError> {
    if (this.#helper !== null) return this.#helper;
    if (this.#starting !== null) return this.#starting;
    const starting = this.startHelper();
    this.#starting = starting;
    try {
      return await starting;
    } finally {
      if (this.#starting === starting) this.#starting = null;
    }
  }

  private async startHelper(): Promise<LiveHelper | ScreenshotCaptureError> {
    const helperPath = this.#helperPath;
    if (helperPath === null) {
      return error("unsupported-platform", "no native screenshot helper exists for this platform");
    }
    try {
      await this.#access(helperPath);
    } catch {
      return error("helper-missing", `the screenshot helper is not executable at ${helperPath}`);
    }
    if (this.#disposed) return error("disposed", "the screenshot tool was disposed");
    let child: ScreenshotToolChild;
    const startedAt = performance.now();
    try {
      child = this.#spawn(helperPath, [
        this.#persistent ? SCREENSHOT_HELPER_ARGS.service : SCREENSHOT_HELPER_ARGS.once,
      ]);
    } catch (cause) {
      return error(
        "helper-spawn-failed",
        `the screenshot helper could not be started: ${text(cause)}`,
      );
    }
    const helper: LiveHelper = {
      child,
      reader: new ScreenshotLineReader(),
      startedAt,
      booted: false,
      exited: false,
      stopping: false,
      capture: null,
      failure: null,
      lastDiagnostic: null,
      bootTimer: null,
      exitTimer: null,
      killTimer: null,
    };
    this.#helper = helper;
    this.emit({
      kind: "lifecycle",
      event: "screenshot.helper.spawned",
      attrs: { pid: child.pid ?? null, helperPath, persistent: this.#persistent },
    });
    if (this.#persistent) {
      helper.bootTimer = setTimeout(() => {
        this.fail(helper, error("helper-timeout", "the screenshot helper did not become idle"));
      }, this.#preOverlayTimeoutMs);
    }
    child.stdout.on("data", (chunk: Buffer | string) => {
      for (const verdict of helper.reader.push(chunk)) {
        if (helper.stopping || helper.exited) return;
        if (verdict.kind === "violation") {
          this.fail(
            helper,
            error(
              "helper-protocol",
              `the screenshot helper printed a line the contract refuses (${verdict.reason}: ${verdict.detail})`,
            ),
          );
          return;
        }
        this.onHelperEvent(helper, verdict.event);
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const trimmed = line.trim().slice(0, MAX_DIAGNOSTIC_LINE_CHARS);
        if (trimmed.length === 0) continue;
        helper.lastDiagnostic = trimmed;
        this.emit({ kind: "diagnostic", line: trimmed });
      }
    });
    child.stdin?.on("error", (cause: Error) => {
      this.fail(
        helper,
        error("helper-exited", `the screenshot command pipe closed: ${text(cause)}`),
      );
    });
    child.on("error", (cause) => this.onExit(helper, null, null, cause));
    // close, not exit: the final stdout bytes must be drained before deciding
    // that a process died without sending its result.
    child.on("close", (code, signal) => this.onExit(helper, code, signal, null));
    return helper;
  }

  private sendCapture(helper: LiveHelper): void {
    const capture = helper.capture;
    if (capture === null || capture.sent || capture.settled) return;
    capture.sent = true;
    try {
      if (helper.child.stdin == null) throw new Error("helper has no command pipe");
      const command = ScreenshotHelperCommand.parse({
        v: SCREENSHOT_HELPER_PROTOCOL_VERSION,
        action: "capture",
      });
      helper.child.stdin.write(`${JSON.stringify(command)}\n`);
    } catch (cause) {
      this.fail(
        helper,
        error("helper-exited", `the screenshot command could not be sent: ${text(cause)}`),
      );
    }
  }

  private onHelperEvent(helper: LiveHelper, event: ScreenshotHelperEvent): void {
    const capture = helper.capture;
    if (event.status === "idle") {
      if (!this.#persistent || (helper.booted && (capture === null || !capture.settled))) {
        this.fail(helper, error("helper-protocol", "unexpected screenshot idle acknowledgement"));
        return;
      }
      const initial = !helper.booted;
      helper.booted = true;
      if (helper.bootTimer !== null) clearTimeout(helper.bootTimer);
      helper.bootTimer = null;
      if (helper.exitTimer !== null) clearTimeout(helper.exitTimer);
      helper.exitTimer = null;
      if (!initial) helper.capture = null;
      this.emit({
        kind: "lifecycle",
        event: "screenshot.helper.idle",
        attrs: {
          pid: helper.child.pid ?? null,
          initial,
          afterMs: performance.now() - helper.startedAt,
        },
      });
      if (initial && capture !== null) this.sendCapture(helper);
      return;
    }
    if (capture === null || !capture.sent) {
      this.fail(
        helper,
        error("helper-protocol", "the screenshot helper answered without a capture request"),
      );
      return;
    }
    // Never retain a second terminal result, even if it arrives in the same chunk.
    if (capture.settled) return;
    switch (event.status) {
      case "ready":
        if (capture.ready) return;
        capture.ready = true;
        if (capture.timer !== null) clearTimeout(capture.timer);
        capture.timer = null;
        this.emit({
          kind: "lifecycle",
          event: "screenshot.helper.ready",
          attrs: {
            pid: helper.child.pid ?? null,
            afterMs: performance.now() - capture.startedAt,
            reused: capture.reused,
            ...event.timings,
          },
        });
        return;
      case "ok": {
        const { v: _v, status: _status, ...still } = event;
        this.retain(still.path);
        capture.settle({ status: "ok", ...still });
        return;
      }
      case "cancel":
        capture.settle({ status: "cancel" });
        return;
      case "error":
        capture.settle(error(event.code, event.message));
        return;
    }
  }

  private fail(helper: LiveHelper, result: ScreenshotCaptureError): void {
    if (helper.exited) return;
    helper.failure ??= result;
    helper.capture?.settle(result);
    this.kill(helper, result.code);
  }

  private onExit(
    helper: LiveHelper,
    code: number | null,
    signal: NodeJS.Signals | null,
    cause: Error | null,
  ): void {
    if (helper.exited) return;
    helper.exited = true;
    for (const timer of [helper.bootTimer, helper.exitTimer, helper.killTimer]) {
      if (timer !== null) clearTimeout(timer);
    }
    if (this.#helper === helper) this.#helper = null;
    const how = signal !== null ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
    const detail = helper.lastDiagnostic === null ? "" : ` — last stderr: ${helper.lastDiagnostic}`;
    const result =
      cause !== null
        ? error("helper-spawn-failed", `the screenshot helper could not be started: ${text(cause)}`)
        : error("helper-exited", `the screenshot helper ended without a result (${how})${detail}`);
    helper.failure ??= result;
    helper.capture?.settle(result);
    this.emit({
      kind: "lifecycle",
      event: "screenshot.helper.exited",
      attrs: {
        pid: helper.child.pid ?? null,
        code,
        signal,
        settled: helper.capture?.settled ?? false,
      },
    });
  }

  private kill(helper: LiveHelper, reason: string): void {
    if (helper.exited || helper.stopping) return;
    helper.stopping = true;
    for (const timer of [helper.bootTimer, helper.exitTimer]) {
      if (timer !== null) clearTimeout(timer);
    }
    const send = (signal: NodeJS.Signals): void => {
      let killed = false;
      try {
        killed = helper.child.kill(signal);
      } catch {
        /* already gone */
      }
      this.emit({
        kind: "lifecycle",
        event: "screenshot.helper.killed",
        attrs: { pid: helper.child.pid ?? null, reason, signal, killed },
      });
    };
    send("SIGTERM");
    helper.killTimer = setTimeout(() => {
      if (!helper.exited) send("SIGKILL");
    }, KILL_GRACE_MS);
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
