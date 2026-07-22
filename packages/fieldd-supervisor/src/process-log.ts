// Child-output handling (spec §5.3): line-buffered, bounded, and redacted —
// tokens and capability path-secrets never reach a log sink.

const REDACTIONS: Array<[RegExp, string]> = [
  // capability URLs: /t/<pathSecret> (C3 — Settings-visible, never logged)
  [/\/t\/[A-Za-z0-9_-]{16,}/g, "/t/[redacted]"],
  // bearer-token-shaped values following a token-ish key
  [/(token[^A-Za-z0-9]{0,3})[A-Za-z0-9_/+=-]{16,}/gi, "$1[redacted]"],
];

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
  let pending = "";
  return {
    push(chunk) {
      pending += chunk.toString();
      for (let i = pending.indexOf("\n"); i >= 0; i = pending.indexOf("\n")) {
        const line = pending.slice(0, i).trimEnd();
        pending = pending.slice(i + 1);
        if (line.length > 0) onLine(redactLine(line));
      }
    },
    flush() {
      const line = pending.trimEnd();
      pending = "";
      if (line.length > 0) onLine(redactLine(line));
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
