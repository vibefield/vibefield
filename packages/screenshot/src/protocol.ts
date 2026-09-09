import { SCREENSHOT_LIMITS, ScreenshotHelperEvent } from "@vibefield/contracts";

// The helper's stdout, read the way the contract describes it (SNAP-D2): one
// JSON object per line, nothing else. The reader is strict on purpose — a line
// the contract does not admit means a mis-wired helper, and the honest answer
// is `helper-protocol`, not a guess. It is also bounded: a helper that never
// prints a newline cannot grow the host's memory past MAX_LINE_BYTES.

export type LineVerdict =
  | { readonly kind: "event"; readonly event: ScreenshotHelperEvent }
  | {
      readonly kind: "violation";
      readonly reason: "not-json" | "unrecognized" | "line-too-long";
      readonly detail: string;
    };

/** Judge one complete stdout line. Exported so a test can pin the verdicts
 * without a stream. */
export function parseScreenshotHelperLine(line: string): LineVerdict {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { kind: "violation", reason: "not-json", detail: excerpt(line) };
  }
  const parsed = ScreenshotHelperEvent.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      kind: "violation",
      reason: "unrecognized",
      detail:
        first === undefined ? "unrecognized line" : `${first.path.join(".")}: ${first.message}`,
    };
  }
  return { kind: "event", event: parsed.data };
}

function excerpt(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/** Splits a byte stream into lines (`\n` or `\r\n`, empty lines ignored) and
 * judges each. After the first violation the reader is POISONED: it reports
 * nothing more, because everything after a broken line is noise from a process
 * the host is about to kill. */
export class ScreenshotLineReader {
  #buffer: Buffer = Buffer.alloc(0);
  #poisoned = false;
  readonly #maxLineBytes: number;

  constructor(maxLineBytes: number = SCREENSHOT_LIMITS.MAX_LINE_BYTES) {
    if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0) {
      throw new RangeError("maxLineBytes must be a positive safe integer");
    }
    this.#maxLineBytes = maxLineBytes;
  }

  get poisoned(): boolean {
    return this.#poisoned;
  }

  push(chunk: Buffer | string): LineVerdict[] {
    if (this.#poisoned) return [];
    this.#buffer = Buffer.concat([this.#buffer, Buffer.from(chunk)]);
    const verdicts: LineVerdict[] = [];
    for (;;) {
      const newline = this.#buffer.indexOf(0x0a);
      if (newline < 0) {
        if (this.#buffer.byteLength > this.#maxLineBytes) {
          verdicts.push(this.poison("line-too-long", `${this.#buffer.byteLength} bytes`));
        }
        return verdicts;
      }
      let line = this.#buffer.subarray(0, newline);
      this.#buffer = this.#buffer.subarray(newline + 1);
      if (line.byteLength > 0 && line[line.byteLength - 1] === 0x0d) {
        line = line.subarray(0, line.byteLength - 1);
      }
      if (line.byteLength === 0) continue;
      if (line.byteLength > this.#maxLineBytes) {
        verdicts.push(this.poison("line-too-long", `${line.byteLength} bytes`));
        return verdicts;
      }
      const verdict = parseScreenshotHelperLine(line.toString("utf8"));
      verdicts.push(verdict);
      if (verdict.kind === "violation") {
        this.#poisoned = true;
        this.#buffer = Buffer.alloc(0);
        return verdicts;
      }
    }
  }

  private poison(reason: "line-too-long", detail: string): LineVerdict {
    this.#poisoned = true;
    this.#buffer = Buffer.alloc(0);
    return { kind: "violation", reason, detail };
  }
}
