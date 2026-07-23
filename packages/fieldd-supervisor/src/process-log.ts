// Child-output handling (spec §5.3): line-buffered, bounded, and redacted —
// tokens and capability path-secrets never reach a log sink.

const REDACTIONS: Array<[RegExp, string]> = [
  // capability URLs: /t/<pathSecret> (C3 — Settings-visible, never logged)
  [/\/t\/[A-Za-z0-9_-]{16,}/g, "/t/[redacted]"],
  // bearer-token-shaped values following a token-ish key
  [/(token[^A-Za-z0-9]{0,3})[A-Za-z0-9_/+=-]{16,}/gi, "$1[redacted]"],
];

/** LOG §13.4 pre-slice hygiene: a child that never emits `\n` cannot grow the
 * supervisor indefinitely. The shared logging package will absorb this framer
 * in LOG-L3; until then this constant pins the same first-party limit here. */
export const MAX_PARTIAL_LINE_BYTES = 64 * 1024;
export const PARTIAL_LINE_TRUNCATION_MARKER = "[truncated: logical line exceeded 65536 bytes]";

export function redactLine(line: string): string {
  let out = line;
  for (const [pattern, replacement] of REDACTIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Feed stream chunks in, get whole redacted lines out; `flush()` emits any
 * unterminated tail (child died mid-line). */
export function createLineBuffer(onLine: (line: string) => void): {
  push(chunk: Buffer | string): void;
  flush(): void;
} {
  const pending = Buffer.allocUnsafe(MAX_PARTIAL_LINE_BYTES);
  let pendingBytes = 0;
  let discardingOversizeLine = false;

  const clearPending = (): void => {
    pendingBytes = 0;
  };

  const pendingText = (): string => pending.subarray(0, pendingBytes).toString("utf8").trimEnd();

  const emit = (): void => {
    const line = pendingText();
    if (line.length > 0) onLine(redactLine(line));
  };

  const emitTruncated = (): void => {
    const prefix = redactLine(pendingText());
    onLine(`${prefix}${prefix.length > 0 ? " " : ""}${PARTIAL_LINE_TRUNCATION_MARKER}`);
    clearPending();
    discardingOversizeLine = true;
  };

  const append = (bytes: Buffer): void => {
    if (discardingOversizeLine || bytes.length === 0) return;
    const available = MAX_PARTIAL_LINE_BYTES - pendingBytes;
    if (bytes.length <= available) {
      bytes.copy(pending, pendingBytes);
      pendingBytes += bytes.length;
      return;
    }
    if (available > 0) {
      bytes.copy(pending, pendingBytes, 0, available);
      pendingBytes += available;
    }
    emitTruncated();
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
        if (!discardingOversizeLine) emit();
        clearPending();
        discardingOversizeLine = false;
        start = newline + 1;
      }
    },
    flush() {
      if (!discardingOversizeLine) emit();
      clearPending();
      discardingOversizeLine = false;
    },
  };
}

/** Last-N ring of child output — attached to child-exit errors so the reason a
 * daemon died is IN the rejection, not lost in a console scrollback. */
export function createLogTail(capacity = 10): {
  note(line: string): void;
  lines(): string[];
} {
  const buf: string[] = [];
  return {
    note(line) {
      buf.push(line);
      if (buf.length > capacity) buf.shift();
    },
    lines: () => [...buf],
  };
}
