// Child-output handling (spec §5.3): line-buffered, bounded, and redacted —
// tokens and capability path-secrets never reach a log sink.
import { LOG_TRANSPORT_LIMITS } from "@vibefield/contracts";
import { createBoundedLineFramer } from "@vibefield/logging";

const REDACTIONS: Array<[RegExp, string]> = [
  // capability URLs: /t/<pathSecret> (C3 — Settings-visible, never logged)
  [/\/t\/[A-Za-z0-9_-]{16,}/g, "/t/[redacted]"],
  // bearer-token-shaped values following a token-ish key
  [/(token[^A-Za-z0-9]{0,3})[A-Za-z0-9_/+=-]{16,}/gi, "$1[redacted]"],
];

/** Compatibility names retained for supervisor callers/tests. LOG-L3 moved the
 * actual state machine into @vibefield/logging so UtilityProcess capture and
 * daemon supervision cannot drift. */
export const MAX_PARTIAL_LINE_BYTES = LOG_TRANSPORT_LIMITS.FIRST_PARTY_PARTIAL_LINE_BYTES;
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
  return createBoundedLineFramer({
    maxBytes: MAX_PARTIAL_LINE_BYTES,
    onLine(result) {
      const redacted = redactLine(result.line).trimEnd();
      if (result.truncated) {
        onLine(`${redacted}${redacted.length > 0 ? " " : ""}${PARTIAL_LINE_TRUNCATION_MARKER}`);
      } else if (redacted.length > 0) {
        onLine(redacted);
      }
    },
  });
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
