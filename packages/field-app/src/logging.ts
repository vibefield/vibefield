export type RendererLogFields = Readonly<Record<string, unknown>>;

export interface RendererLoggerBindings {
  component?: string | undefined;
  traceId?: string | undefined;
  spanId?: string | undefined;
  operationId?: string | undefined;
  requestId?: string | undefined;
  sessionId?: string | undefined;
  docId?: string | undefined;
  deviceId?: string | undefined;
}

/** Browser-safe mirror of the first-party event API. The Electron host owns
 * transport, validation, process identity, persistence, and diagnostics; the
 * field app sees none of those implementation details. */
export interface RendererLogger {
  child(bindings: RendererLoggerBindings): RendererLogger;
  trace(event: string, message: string, attrs?: RendererLogFields): void;
  debug(event: string, message: string, attrs?: RendererLogFields): void;
  info(event: string, message: string, attrs?: RendererLogFields): void;
  warn(event: string, message: string, attrs?: RendererLogFields): void;
  error(event: string, message: string, error?: unknown, attrs?: RendererLogFields): void;
  fatal(event: string, message: string, error?: unknown, attrs?: RendererLogFields): void;
  isLevelEnabled(level: "trace" | "debug" | "info" | "warn" | "error" | "fatal"): boolean;
}

const noop: RendererLogger = {
  child: () => noop,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  isLevelEnabled: () => false,
};

let current: RendererLogger = noop;

/** mountFieldApp wires the host-owned logger before any product composition.
 * The no-op default keeps browser/unit harnesses explicit and side-effect free. */
export function setRendererLogger(logger: RendererLogger): void {
  current = logger;
}

export function getRendererLogger(): RendererLogger {
  return current;
}
