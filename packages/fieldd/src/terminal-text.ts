// A vendor updater writes for a terminal even into a pipe: colour escapes,
// spinners redrawn in place (a carriage return, or `ESC[999D` + `ESC[J`),
// progress bars that erase their line, cursor moves over a few lines. A panel
// shows text, so this renders the bytes the way a terminal would have left
// them on screen: every redraw lands where its cursor went, every erase
// clears, and colours, modes, titles and stray control bytes drop out.
//
// DISPLAY ONLY — nothing reads meaning from the result (RFC 006: an update's
// outcome is the receipt's re-inspection, never its output).

const ESC = "\u001b";
const TAB = 8;
/** How far a cursor MOVE may reach across a line. Text itself runs as long as
 * it runs; only a motion is bounded, so `ESC[999999999C` cannot pad a line out
 * to a billion cells (a terminal clamps it at its right edge the same way). */
const MAX_MOVE_COLUMN = 1024;

/** Render terminal output to the text it leaves on screen, one line per row. */
export function renderTerminalText(raw: string): string {
  const screen = new Screen();
  const chars = Array.from(raw);
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i]!;
    if (ch === ESC) {
      i = escapeSequence(chars, i + 1, screen);
      continue;
    }
    i += 1;
    if (ch === "\n") screen.lineFeed();
    else if (ch === "\r") screen.col = 0;
    else if (ch === "\b") screen.col = Math.max(0, screen.col - 1);
    else if (ch === "\t") screen.moveTo((Math.floor(screen.col / TAB) + 1) * TAB);
    else if (ch >= " " && ch !== "\u007f") screen.put(ch);
    // any other control byte draws nothing
  }
  return screen.text();
}

class Screen {
  rows: string[][] = [[]];
  row = 0;
  col = 0;

  private line(): string[] {
    while (this.rows.length <= this.row) this.rows.push([]);
    return this.rows[this.row]!;
  }

  put(ch: string): void {
    const line = this.line();
    while (line.length < this.col) line.push(" ");
    line[this.col] = ch;
    this.col += 1;
  }

  /** A pipe has no `onlcr`, but output written for a terminal means CR+LF by `\n`. */
  lineFeed(): void {
    this.row += 1;
    this.col = 0;
    this.line();
  }

  /** A cursor move never passes the last line: only a line feed adds lines. */
  moveRows(delta: number): void {
    this.row = Math.min(Math.max(0, this.row + delta), this.rows.length - 1);
  }

  moveTo(col: number): void {
    this.col = Math.min(Math.max(0, col), MAX_MOVE_COLUMN);
  }

  /** `K`: 0 cursor→end · 1 start→cursor · 2 the whole line. */
  eraseLine(mode: number): void {
    const line = this.line();
    if (mode === 0) line.length = Math.min(line.length, this.col);
    else if (mode === 1) for (let c = 0; c <= this.col && c < line.length; c += 1) line[c] = " ";
    else line.length = 0;
  }

  /** `J`: 0 cursor→end of screen · 1 start→cursor · 2 and 3 everything. */
  eraseDisplay(mode: number): void {
    if (mode === 0) {
      this.eraseLine(0);
      this.rows.length = this.row + 1;
    } else if (mode === 1) {
      for (let r = 0; r < this.row; r += 1) this.rows[r] = [];
      this.eraseLine(1);
    } else {
      this.rows = [[]];
      this.row = 0;
      this.col = 0;
    }
  }

  text(): string {
    const lines = this.rows.map((cells) => cells.join("").replace(/\s+$/u, ""));
    while (lines.length > 0 && lines[0] === "") lines.shift();
    while (lines.length > 0 && lines.at(-1) === "") lines.pop();
    return lines.join("\n");
  }
}

/** Consume one escape sequence starting after ESC; returns the next index. */
function escapeSequence(chars: readonly string[], start: number, screen: Screen): number {
  const kind = chars[start];
  if (kind === undefined) return start; // cut mid-sequence: the rest arrives later
  if (kind === "[") return csi(chars, start + 1, screen);
  // OSC (title, hyperlink) and the string controls DCS/SOS/PM/APC run to BEL or ST.
  if (kind === "]" || kind === "P" || kind === "X" || kind === "^" || kind === "_") {
    let i = start + 1;
    while (i < chars.length) {
      if (chars[i] === "\u0007") return i + 1;
      if (chars[i] === ESC && chars[i + 1] === "\\") return i + 2;
      i += 1;
    }
    return i;
  }
  // a two-byte escape (charset, keypad mode, save/restore cursor …)
  return start + 1;
}

function csi(chars: readonly string[], start: number, screen: Screen): number {
  let i = start;
  let params = "";
  // parameter bytes 0x30–0x3F, then intermediates 0x20–0x2F, then the final 0x40–0x7E
  while (i < chars.length && chars[i]! >= "0" && chars[i]! <= "?") params += chars[i++];
  while (i < chars.length && chars[i]! >= " " && chars[i]! <= "/") i += 1;
  const final = chars[i];
  if (final === undefined) return i;
  // a private sequence (`?25h` shows the cursor) moves nothing
  if (params.startsWith("?") || params.startsWith(">") || params.startsWith("=")) return i + 1;
  const numbers = params.split(";").map((part) => (part === "" ? undefined : Number(part)));
  const n = (index: number, fallback: number): number => {
    const value = numbers[index];
    return value === undefined || !Number.isFinite(value) ? fallback : value;
  };
  switch (final) {
    case "A":
      screen.moveRows(-Math.max(1, n(0, 1)));
      break;
    case "B":
      screen.moveRows(Math.max(1, n(0, 1)));
      break;
    case "C":
      screen.moveTo(screen.col + Math.max(1, n(0, 1)));
      break;
    case "D":
      screen.col = Math.max(0, screen.col - Math.max(1, n(0, 1)));
      break;
    case "E":
      screen.moveRows(Math.max(1, n(0, 1)));
      screen.col = 0;
      break;
    case "F":
      screen.moveRows(-Math.max(1, n(0, 1)));
      screen.col = 0;
      break;
    case "G":
      screen.moveTo(n(0, 1) - 1);
      break;
    case "H":
    case "f":
      // absolute on a screen this text has no top for: the row stays, the column moves
      screen.moveTo(n(1, 1) - 1);
      break;
    case "J":
      screen.eraseDisplay(n(0, 0));
      break;
    case "K":
      screen.eraseLine(n(0, 0));
      break;
    default:
      // SGR colour (`m`), scroll regions, modes: nothing to draw
      break;
  }
  return i + 1;
}
