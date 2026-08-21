// The BASE-1 certification corpus, PORTED to TypeScript.
//
// PROVENANCE, stated plainly because the spec's §19.2 gets it wrong: the TC
// spike's corpus is not "22 byte traces" and it is not a set of recordings. It
// is ELEVEN synthetic generators in Rust
// (`draft/terminal-custody-spike/probes/base1/src/traces.rs:205-218`, `corpus()`),
// exercised by BASE-1 as 22 CASES — "11 traces x 2 viewport positions", the
// spike ledger's own words (`LEDGER.md:1162`). Nothing in it was captured from
// vim, htop, `cargo build`, `git log`, or an agent TUI; those programs never ran.
//
// So the corpus arrives here two ways and the manifest says which is which:
//   * `base1-port`  — this file: the eleven generators, ported byte-for-byte so
//                     one corpus really does grade both planes (§19.2's premise).
//   * `recorded`    — `corpus-plan.ts`'s `recordEntries`: vim, top, git log, a
//                     yes flood, a unicode wall and a recursive listing, run for
//                     real in a real cell, which is what §19.2 actually asked
//                     for and what the spike could not supply.
//
// The port is verified against the SPIKE'S OWN RECORDED EVIDENCE, not against
// itself: `test/byte-traces.test.ts` checks all eleven generators against the
// `streamBytes` the BASE-1 run wrote into
// `results/base1/base1-corpus-s1-20260817T222014.json` at scale 4, and they
// match exactly — including `fragmenter`, whose splitmix64 stream is wrapping-u64
// arithmetic no double can represent, and including every scale-dependent
// generator whose length is not linear in scale. CRCs pin the content at the
// scale the capture replays.

/** CRC-32 (IEEE, reflected) — `traces.rs:17-26`, used inside the record format
 * so a replayed stream is self-checking the way the spike's was. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return ~crc >>> 0;
}

const encoder = new TextEncoder();

class ByteSink {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  push(value: string | Uint8Array): void {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    this.chunks.push(bytes);
    this.length += bytes.byteLength;
  }

  /** `s.extend(std::iter::repeat(b).take(n))`. */
  repeat(char: string, count: number): void {
    if (count > 0) this.push(char.repeat(count));
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.length);
    let cursor = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, cursor);
      cursor += chunk.byteLength;
    }
    return out;
  }
}

/** `REC <seq> <tsUs> <payload> <crc>\n` — `traces.rs:28-32`. */
export function formatRecord(seq: number, tsUs: number, payload: string): string {
  const body = `${seq} ${tsUs} ${payload}`;
  return `REC ${body} ${crc32(encoder.encode(body))}\n`;
}

/** `traces.rs:34-48` — the mode/tab-stop/margin/title setter. */
export function modeSetter(records: number): Uint8Array {
  const s = new ByteSink();
  s.push("\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b[?2004h");
  s.push("\x1b[?7l\x1b[?6h\x1b[?25l\x1b[?1004h");
  s.push("\x1b[4h");
  s.push("\x1b(0");
  s.push("\x1b[3g");
  s.push("\r\x1b[5G\x1bH\x1b[15G\x1bH\r");
  s.push("\x1b[3;20r");
  s.push("\x1b]0;spike-title\x07");
  s.push("\x1b[7;13H\x1b7");
  for (let i = 1; i <= records; i += 1) s.push(formatRecord(i, 1000 + i, "payloadxxxx"));
  return s.finish();
}

/** `traces.rs:50-65` — alt-screen enter, write, and optionally exit. */
export function alternateScreen(records: number, stayInAlt: boolean): Uint8Array {
  const s = new ByteSink();
  s.push("PRIMARY-SCREEN-CONTENT\r\n");
  s.push("\x1b[?1049h");
  s.push("\x1b[2;10r");
  s.push("\x1b[5;5H\x1b7");
  for (let i = 1; i <= records; i += 1) s.push(formatRecord(i, 2000 + i, "altpayload"));
  s.push("\x1b8");
  if (!stayInAlt) {
    s.push("\x1b[?1049l");
    s.push("BACK-ON-PRIMARY\r\n");
  }
  return s.finish();
}

/** `traces.rs:67-75` — DSR/CPR queries the emulator must answer. */
export function queryStream(queries: number): Uint8Array {
  const s = new ByteSink();
  for (let i = 1; i <= queries; i += 1) {
    s.push(`Q${i}:`);
    s.push("\x1b[6n\x1b[5n\r\n");
  }
  return s.finish();
}

/** `traces.rs:77-83` — plain append-only line output. */
export function counter(records: number): Uint8Array {
  const s = new ByteSink();
  for (let i = 1; i <= records; i += 1) s.push(formatRecord(i, 3000 + i, "counterpayload"));
  return s.finish();
}

/** `traces.rs:85-98` — styled bulk output with periodic unicode. The `yes`/`cat`
 * flood class: history is the dominant cost. */
export function bulk(targetBytes: number): Uint8Array {
  const s = new ByteSink();
  let length = 0;
  let i = 0;
  while (length < targetBytes) {
    i += 1;
    const sgr = `\x1b[3${i % 8}m`;
    const record = formatRecord(i, 4000 + i, "bulkpayload");
    s.push(sgr);
    s.push(record);
    length += encoder.encode(sgr).byteLength + encoder.encode(record).byteLength;
    if (i % 7 === 0) {
      const unicode = "héllo 日本語 🌍\r\n";
      s.push(unicode);
      length += encoder.encode(unicode).byteLength;
    }
  }
  return s.finish();
}

/** splitmix64, exactly as `traces.rs:100-108` runs it. BigInt because the Rust
 * generator's wrapping u64 multiplies are not representable in a double, and a
 * "close enough" PRNG would silently produce a different corpus. */
function splitmix64(seed: bigint): () => bigint {
  const MASK = (1n << 64n) - 1n;
  let state = (seed ^ 0x9e3779b97f4a7c15n) & MASK;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return (z ^ (z >> 31n)) & MASK;
  };
}

/** `traces.rs:100-128` — randomly interleaved atoms: escape sequences split
 * across the stream in ways a naive parser mis-frames. */
export function fragmenterPayload(seed: bigint, records: number): Uint8Array {
  const next = splitmix64(seed);
  const atoms = [
    "héllo",
    "日本語",
    "🌍",
    "\x1b[31m",
    "\x1b[2;5H",
    "\x1b]0;title\x07",
    "\x1b[?1049h",
    "plain",
  ];
  const s = new ByteSink();
  for (let i = 0; i < records; i += 1) {
    s.push(`F${i}:`);
    const n = Number(next() % 4n) + 1;
    for (let k = 0; k < n; k += 1) {
      s.push(atoms[Number(next() % BigInt(atoms.length))] as string);
    }
    s.push("\n");
  }
  return s.finish();
}

/** `traces.rs:130-152` — a progress bar rewriting one line: raw bytes far
 * exceed the retained model. The `cargo build` / spinner class. */
export function redrawHeavy(frames: number): Uint8Array {
  const s = new ByteSink();
  s.push("starting build\r\n");
  for (let frame = 0; frame < frames; frame += 1) {
    const percent = Math.floor((frame * 100) / Math.max(1, frames));
    const filled = Math.floor(percent / 5);
    s.push("\r\x1b[K");
    s.push(`\x1b[3${frame % 8}m`);
    s.push("[");
    s.repeat("#", filled);
    s.repeat(" ", 20 - filled);
    s.push(`] ${String(percent).padStart(3, " ")}% frame ${frame}`);
    s.push("\x1b[0m");
    if (frame % 500 === 499) s.push(`\r\n\x1b[K step ${Math.floor(frame / 500)} done\r\n`);
  }
  return s.finish();
}

/** `traces.rs:154-186` — a full-grid alt-screen animation with SGR churn and an
 * in-alt scroll region. The htop / TUI-repaint class. */
export function altAnimation(
  frames: number,
  rows: number,
  cols: number,
  stay: boolean,
): Uint8Array {
  const s = new ByteSink();
  s.push("PRIMARY-BEFORE-ANIMATION\r\n");
  for (let i = 0; i < 40; i += 1) s.push(`primary history line ${i}\r\n`);
  s.push("\x1b[?1049h\x1b[2J");
  s.push(`\x1b[2;${rows - 1}r`);
  for (let frame = 0; frame < frames; frame += 1) {
    s.push("\x1b[H");
    for (let row = 0; row < rows; row += 1) {
      s.push(`\x1b[${row + 1};1H\x1b[K`);
      s.push(`\x1b[3${(frame + row) % 8};4${row % 2}m`);
      const width = Math.max(0, cols - 12);
      const phase = (frame + row) % Math.max(1, width);
      s.repeat(".", phase);
      s.push(`<${String(frame).padStart(4, "0")}:${String(row).padStart(2, "0")}>`);
      s.push("\x1b[0m");
    }
    if (frame % 17 === 16) s.push("\x1b[1S");
  }
  s.push("\x1b[5;5H\x1b7\x1b[9;9H");
  if (!stay) s.push("\x1b[?1049l\x1b[0mBACK-ON-PRIMARY\r\n");
  return s.finish();
}

/** `traces.rs:188-203` — long logical lines with no CR, so most physical rows
 * are wrap continuations. */
export function softwrap(lines: number, cols: number): Uint8Array {
  const s = new ByteSink();
  for (let line = 0; line < lines; line += 1) {
    const width = cols * (2 + (line % 3)) + (line % 7);
    s.push(`\x1b[3${line % 8}m`);
    s.push(`L${String(line).padStart(4, "0")}:`);
    const row: string[] = [];
    for (let column = 0; column < width; column += 1) {
      row.push(String.fromCharCode(97 + ((line + column) % 26)));
    }
    s.push(row.join(""));
    s.push("\x1b[0m\r\n");
    if (line % 5 === 4) s.push("short hard line\r\n");
  }
  return s.finish();
}

export interface ByteTrace {
  readonly name: string;
  readonly bytes: Uint8Array;
  /** What the trace is FOR — copied into the manifest so a corpus entry
   * explains itself without a reader opening this file. */
  readonly covers: string;
}

/**
 * The eleven, at `scale`.
 *
 * `traces.rs:205-218` — same order, same arguments. `scale` multiplies the heavy
 * traces so a smoke run and a full run are the same code path, exactly as the
 * spike intended.
 */
export function base1Corpus(seed = 1n, scale = 1): ByteTrace[] {
  return [
    { name: "mode-setter", bytes: modeSetter(60), covers: "mode/tab-stop/margin/title state" },
    {
      name: "alternate-screen-active",
      bytes: alternateScreen(40, true),
      covers: "alt-screen switching, ends in alt",
    },
    {
      name: "alternate-screen-exited",
      bytes: alternateScreen(40, false),
      covers: "alt-screen switching, returns to primary",
    },
    { name: "query", bytes: queryStream(20), covers: "DSR/CPR query round trips" },
    {
      name: "fragmenter",
      bytes: fragmenterPayload(seed, 120),
      covers: "unicode + escape atoms interleaved (mis-framing)",
    },
    { name: "counter", bytes: counter(80), covers: "plain append-only lines" },
    {
      name: "bulk-styled",
      bytes: bulk(64 * 1024 * scale),
      covers: "styled scrollback flood with unicode (yes/cat class)",
    },
    {
      name: "redraw-heavy",
      bytes: redrawHeavy(2_000 * scale),
      covers: "one-line redraw churn (progress bar / cargo build class)",
    },
    {
      name: "alt-animation",
      bytes: altAnimation(200 * scale, 24, 80, true),
      covers: "full-grid alt-screen repaint (htop / TUI class)",
    },
    {
      name: "alt-animation-exited",
      bytes: altAnimation(60 * scale, 24, 80, false),
      covers: "alt-screen animation that exits to primary",
    },
    { name: "softwrap", bytes: softwrap(40 * scale, 80), covers: "soft-wrap continuation rows" },
  ];
}
