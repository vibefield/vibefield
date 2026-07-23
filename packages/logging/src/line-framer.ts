import { LOG_TRANSPORT_LIMITS } from "@vibefield/contracts";

export interface FramedLine {
  /** UTF-8 with replacement for invalid byte sequences. A CR that belongs to
   * CRLF framing is removed; other whitespace is preserved. */
  line: string;
  /** True when only the bounded prefix is present and the rest of the logical
   * line is being discarded through its next newline. */
  truncated: boolean;
  /** Bytes observed when this result was emitted. For a truncated line this is
   * a lower bound because later discarded chunks remain intentionally unheld. */
  inputBytes: number;
}

export interface BoundedLineFramer {
  push(chunk: Buffer | string): void;
  /** Emits a bounded unterminated tail once, then resets the framer. */
  flush(): void;
}

export function createBoundedLineFramer(options: {
  onLine: (line: FramedLine) => void;
  maxBytes?: number;
}): BoundedLineFramer {
  const maxBytes = options.maxBytes ?? LOG_TRANSPORT_LIMITS.FIRST_PARTY_PARTIAL_LINE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("line-framer maxBytes must be a positive safe integer");
  }

  const pending = Buffer.allocUnsafe(maxBytes);
  let pendingBytes = 0;
  let logicalBytes = 0;
  let discarding = false;

  const reset = (): void => {
    pendingBytes = 0;
    logicalBytes = 0;
    discarding = false;
  };

  const decodePrefix = (): string => {
    const end =
      pendingBytes > 0 && pending[pendingBytes - 1] === 0x0d ? pendingBytes - 1 : pendingBytes;
    return pending.subarray(0, end).toString("utf8");
  };

  const emitComplete = (): void => {
    if (pendingBytes === 0) return;
    options.onLine({ line: decodePrefix(), truncated: false, inputBytes: logicalBytes });
  };

  const emitTruncated = (): void => {
    options.onLine({ line: decodePrefix(), truncated: true, inputBytes: logicalBytes });
    pendingBytes = 0;
    discarding = true;
  };

  const append = (bytes: Buffer): void => {
    if (bytes.length === 0) return;
    logicalBytes += bytes.length;
    if (discarding) return;
    const available = maxBytes - pendingBytes;
    const accepted = Math.min(available, bytes.length);
    if (accepted > 0) {
      bytes.copy(pending, pendingBytes, 0, accepted);
      pendingBytes += accepted;
    }
    if (accepted < bytes.length) emitTruncated();
  };

  return {
    push(chunk) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      let start = 0;
      for (;;) {
        const newline = bytes.indexOf(0x0a, start);
        if (newline < 0) {
          append(bytes.subarray(start));
          return;
        }
        append(bytes.subarray(start, newline));
        if (!discarding) emitComplete();
        reset();
        start = newline + 1;
      }
    },
    flush() {
      if (!discarding) emitComplete();
      reset();
    },
  };
}
