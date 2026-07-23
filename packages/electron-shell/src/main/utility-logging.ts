import { LOG_TRANSPORT_LIMITS } from "@vibefield/contracts";
import { LogIngressRecordV1 } from "@vibefield/contracts/logging";
import {
  createBoundedLineFramer,
  type FramedLine,
  type Logger,
  type NodeLogging,
} from "@vibefield/logging";

interface ReadableLike {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  off(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  off(event: "end", listener: () => void): unknown;
}

export interface UtilityProcessLike {
  readonly pid?: number;
  readonly stdout?: ReadableLike | null;
  readonly stderr?: ReadableLike | null;
  on(event: "exit", listener: (code: number) => void): unknown;
  off(event: "exit", listener: (code: number) => void): unknown;
}

export function captureUtilityProcessLogging(options: {
  process: UtilityProcessLike;
  sink: NodeLogging;
  desktopLogger: Logger;
  component: string;
  windowId?: string;
}): () => void {
  const child = options.process;
  const pid = Math.max(0, child.pid ?? 0);
  let disposed = false;
  const detachStreams: Array<() => void> = [];

  const ingest = (stream: "stdout" | "stderr", framed: FramedLine): void => {
    const observedTime = Date.now();
    if (!framed.truncated) {
      try {
        const decoded = JSON.parse(framed.line);
        const parsed = LogIngressRecordV1.safeParse(decoded);
        if (parsed.success) {
          const record = parsed.data;
          options.sink.ingest({
            time: record.time,
            observedTime,
            level: record.level,
            event: record.event,
            message: record.msg,
            component: record.component,
            ...(record.err !== undefined ? { error: record.err } : {}),
            attrs: {
              ...(record.attrs ?? {}),
              stream,
              utilityPid: pid,
            },
            bindings: {
              ...(record.traceId !== undefined ? { traceId: record.traceId } : {}),
              ...(record.spanId !== undefined ? { spanId: record.spanId } : {}),
              ...(record.operationId !== undefined ? { operationId: record.operationId } : {}),
              ...(record.requestId !== undefined ? { requestId: record.requestId } : {}),
              ...(record.sessionId !== undefined ? { sessionId: record.sessionId } : {}),
              ...(record.docId !== undefined ? { docId: record.docId } : {}),
              ...(record.deviceId !== undefined ? { deviceId: record.deviceId } : {}),
            },
            ...(options.windowId !== undefined ? { windowId: options.windowId } : {}),
            pid,
            ...(record.truncation !== undefined ? { truncation: record.truncation } : {}),
          });
          return;
        }
      } catch {
        // Unstructured output follows the bounded raw fallback below.
      }
    }

    const level = stream === "stderr" ? "error" : "info";
    const droppedBytes = Math.max(
      0,
      framed.inputBytes - LOG_TRANSPORT_LIMITS.FIRST_PARTY_PARTIAL_LINE_BYTES,
    );
    options.sink.ingest({
      time: observedTime,
      observedTime,
      level,
      event: framed.truncated
        ? "utility.process.output_truncated"
        : "utility.process.unstructured_output",
      message: framed.truncated
        ? "Utility process output exceeded the bounded line limit"
        : "Utility process emitted unstructured output",
      component: options.component,
      attrs: {
        stream,
        utilityPid: pid,
        raw: true,
        rawLine: framed.line,
        inputBytes: framed.inputBytes,
      },
      ...(options.windowId !== undefined ? { windowId: options.windowId } : {}),
      pid,
      ...(framed.truncated
        ? {
            truncation: {
              reasons: ["partial-line"] as const,
              originalBytes: framed.inputBytes,
              droppedBytes,
              fields: ["attrs.rawLine"],
            },
          }
        : {}),
    });
  };

  const attach = (stream: "stdout" | "stderr", readable: ReadableLike | null | undefined): void => {
    if (readable == null) return;
    let ended = false;
    const framer = createBoundedLineFramer({
      maxBytes: LOG_TRANSPORT_LIMITS.FIRST_PARTY_PARTIAL_LINE_BYTES,
      onLine: (line) => ingest(stream, line),
    });
    const onData = (chunk: Buffer | string): void => framer.push(chunk);
    const onEnd = (): void => {
      if (ended) return;
      ended = true;
      framer.flush();
    };
    readable.on("data", onData);
    readable.on("end", onEnd);
    detachStreams.push(() => {
      readable.off("data", onData);
      readable.off("end", onEnd);
      onEnd();
    });
  };

  attach("stdout", child.stdout);
  attach("stderr", child.stderr);

  const onExit = (code: number): void => {
    options.desktopLogger.info("desktop.utility.process_gone", "Utility process exited", {
      component: options.component,
      utilityPid: pid,
      exitCode: code,
    });
    dispose();
  };
  child.on("exit", onExit);
  options.desktopLogger.info("desktop.utility.capture_started", "Utility output capture started", {
    component: options.component,
    utilityPid: pid,
  });

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    child.off("exit", onExit);
    for (const detach of detachStreams.splice(0)) detach();
  };
  return dispose;
}
