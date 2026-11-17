// OB custody (C5) — THE MARKS' HOLDER (`src/custody-marks.ts`), by itself.
//
// fieldd's own view of every mark: a name and a number that only rises. It starts from what the spawner remembered
// (`CustodyHandoff.expect`), is raised by the floor's word at each hello (`HelloAck.marks`) and by a store's `note`,
// and every rise is said whole to whoever listens (the product stream the shell reads). A `note` also tells the
// floor, which outlives fieldd, and answers what the floor keeps; with no floor behind the holder (the `files`
// level), or a floor that does not answer, it answers the view. The store that notes does not import this class: it
// names the two methods it needs, `get` and `note` (§2.5, v0.6), so those two are the surface these rows hold hardest.
//
// The floor here is a fake that keeps marks as the real one is specified to. custody-marks.test.ts runs the holder
// inside the daemon, over the mock floor and the product door.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CUSTODY, type CustodyMarksFrame } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { describe, expect, it } from "vitest";
import { CustodyMarks, type CustodyMarksFloor } from "../src/custody-marks";

const GRANTS = CUSTODY.MARK_OBJECT_GRANTS;

/** A path under a home, as a file's error would name one: the canary no log line may hold. */
const PLANTED = join(tmpdir(), "a-home", "Library", "Application Support", "VibeField", "a.key");

/** One line a holder logged: its event and what it was given to print. */
interface Line {
  level: string;
  event: string;
  attrs: unknown;
}

/** What a log would keep of a value: an error with its message, its code and its stack, as the real serializer keeps
 * them (`JSON.stringify` alone drops an error's message, and a row that looked for a path there would find none
 * whatever the line was given). */
function kept(value: unknown): unknown {
  if (value instanceof Error) {
    return { ...value, name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) out[key] = kept(inner);
  return out;
}

/** A logger that keeps every line it is told, at EVERY level. */
function everyLine(lines: Line[]): Logger {
  const keep = (level: string, event: string, attrs: unknown): void => {
    lines.push({ level, event, attrs: kept(attrs) });
  };
  const logger: Logger = {
    child: () => logger,
    trace: (event, _message, attrs) => keep("trace", event, attrs),
    debug: (event, _message, attrs) => keep("debug", event, attrs),
    info: (event, _message, attrs) => keep("info", event, attrs),
    warn: (event, _message, attrs) => keep("warn", event, attrs),
    error: (event, _message, error, attrs) => keep("error", event, { error, attrs }),
    fatal: (event, _message, error, attrs) => keep("fatal", event, { error, attrs }),
    isLevelEnabled: () => true,
  };
  return logger;
}

/** A floor as the link presents one: it keeps the highest value per name and answers what it keeps. */
class FakeFloor implements CustodyMarksFloor {
  readonly kept = new Map<string, number>();
  readonly asks: Array<{ name: string; value: number }> = [];
  /** a floor that does not answer: every ask fails, as a link that is down fails it */
  down = false;
  /** when set, an ask waits on it before it is answered */
  gate: Promise<void> | null = null;

  async setMark(name: string, value: number): Promise<number> {
    this.asks.push({ name, value });
    if (this.gate !== null) await this.gate;
    if (this.down) throw new Error("native link is closed");
    const mark = Math.max(this.kept.get(name) ?? 0, value);
    this.kept.set(name, mark);
    return mark;
  }
}

describe("the marks' holder (C5)", () => {
  it("a name nobody holds reads 0, and the view starts empty", () => {
    const marks = new CustodyMarks();
    expect(marks.get(GRANTS)).toBe(0);
    expect(marks.frame()).toEqual({ marks: {} });
    // a name every object has is still nobody's mark
    expect(marks.get("constructor")).toBe(0);
  });

  it("it starts from what the spawner remembered", () => {
    const marks = new CustodyMarks({ expect: { [GRANTS]: 5, "store.shell": 9 } });
    expect(marks.get(GRANTS)).toBe(5);
    expect(marks.get("store.shell")).toBe(9);
    expect(marks.frame()).toEqual({ marks: { [GRANTS]: 5, "store.shell": 9 } });
  });

  it("what it was handed is read on its own terms", () => {
    // the hand-off's contract admits any string for a name: one off the pattern, or a value that is no count, is not
    // a mark, and the rest still are
    const marks = new CustodyMarks({
      expect: { "Not A Name": 4, "store.negative": -1, "store.half": 1.5, [GRANTS]: 2 },
    });
    expect(marks.frame()).toEqual({ marks: { [GRANTS]: 2 } });
  });

  it("a note raises the view, tells the floor, and answers what the floor keeps", async () => {
    const floor = new FakeFloor();
    const marks = new CustodyMarks({ floor });
    await expect(marks.note(GRANTS, 3)).resolves.toBe(3);
    expect(marks.get(GRANTS)).toBe(3);
    expect(floor.asks).toEqual([{ name: GRANTS, value: 3 }]);
    expect(floor.kept.get(GRANTS)).toBe(3);
  });

  it("the view is raised at once, before the floor has answered", async () => {
    const floor = new FakeFloor();
    let answer: () => void = () => undefined;
    floor.gate = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const marks = new CustodyMarks({ floor });
    const noted = marks.note(GRANTS, 3);
    // a reader of the view never waits on the floor
    expect(marks.get(GRANTS)).toBe(3);
    answer();
    await expect(noted).resolves.toBe(3);
  });

  it("a floor that keeps more raises the view to what it keeps", async () => {
    const floor = new FakeFloor();
    floor.kept.set(GRANTS, 10);
    const marks = new CustodyMarks({ floor });
    await expect(marks.note(GRANTS, 4)).resolves.toBe(10);
    expect(marks.get(GRANTS)).toBe(10);
  });

  it("a note that is not a rise changes nothing and asks nobody", async () => {
    const floor = new FakeFloor();
    const marks = new CustodyMarks({ expect: { [GRANTS]: 5 }, floor });
    await expect(marks.note(GRANTS, 5)).resolves.toBe(5);
    await expect(marks.note(GRANTS, 2)).resolves.toBe(5);
    // 0 is where every name starts: noting it holds nothing
    await expect(marks.note("store.none", 0)).resolves.toBe(0);
    expect(marks.frame()).toEqual({ marks: { [GRANTS]: 5 } });
    expect(floor.asks).toEqual([]);
  });

  it("with no floor behind it a note answers the view", async () => {
    const marks = new CustodyMarks();
    await expect(marks.note(GRANTS, 3)).resolves.toBe(3);
    await expect(marks.note(GRANTS, 1)).resolves.toBe(3);
    expect(marks.get(GRANTS)).toBe(3);
  });

  it("a floor that does not answer costs the note nothing: it answers the view and does not reject", async () => {
    const floor = new FakeFloor();
    floor.down = true;
    const marks = new CustodyMarks({ floor });
    await expect(marks.note(GRANTS, 3)).resolves.toBe(3);
    expect(marks.get(GRANTS)).toBe(3);
    expect(floor.asks).toEqual([{ name: GRANTS, value: 3 }]);
  });

  it("a name off the pattern or a value that is no count is refused, and changes nothing", async () => {
    const floor = new FakeFloor();
    const marks = new CustodyMarks({ floor });
    const said: CustodyMarksFrame[] = [];
    marks.onChange((frame) => {
      said.push(frame);
    });
    const refused: Array<[string, number]> = [
      ["Not A Name", 1],
      ["", 1],
      [`a${"b".repeat(64)}`, 1],
      [GRANTS, -1],
      [GRANTS, 1.5],
      [GRANTS, Number.NaN],
      [GRANTS, 2 ** 53],
    ];
    for (const [name, value] of refused) {
      await expect(marks.note(name, value), `${name} = ${value}`).rejects.toThrow();
    }
    expect(marks.frame()).toEqual({ marks: {} });
    expect(said).toEqual([]);
    expect(floor.asks).toEqual([]);
  });

  it("it holds at most MARKS_MAX names, and a held name still rises", async () => {
    const floor = new FakeFloor();
    const marks = new CustodyMarks({ floor });
    for (let i = 0; i < CUSTODY.MARKS_MAX; i += 1) await marks.note(`held.${i}`, 1);
    expect(Object.keys(marks.frame().marks)).toHaveLength(CUSTODY.MARKS_MAX);
    // one more name is refused: the frame stays one a hand-off can carry
    await expect(marks.note("one.more", 1)).rejects.toThrow();
    expect(marks.get("one.more")).toBe(0);
    expect(floor.kept.has("one.more")).toBe(false);
    await expect(marks.note("held.0", 5)).resolves.toBe(5);
  });

  it("the floor's word at a hello raises the view, and the floor is told what it lacks", async () => {
    const floor = new FakeFloor();
    const marks = new CustodyMarks({ expect: { "store.both": 7, "store.shell": 9 }, floor });
    floor.kept.set(GRANTS, 8).set("store.both", 4);
    const telling = marks.heard(new Map(floor.kept));
    // the view holds the floor's word at once: whoever reads it next (a store at boot) reads the higher of the two
    expect(marks.frame()).toEqual({
      marks: { [GRANTS]: 8, "store.both": 7, "store.shell": 9 },
    });
    await telling;
    // the floor was told the two it held less of, and nothing it already held as high
    const told = floor.asks.map((ask) => ask.name);
    expect(told.sort()).toEqual(["store.both", "store.shell"]);
    expect(Object.fromEntries(floor.kept)).toEqual({
      [GRANTS]: 8,
      "store.both": 7,
      "store.shell": 9,
    });
  });

  it("the floor's word is read on its own terms too, and a floor that cannot be told is no failure", async () => {
    const floor = new FakeFloor();
    floor.down = true;
    const marks = new CustodyMarks({ expect: { "store.shell": 9 }, floor });
    const word = new Map<string, number>([
      ["Not A Name", 4],
      ["store.negative", -1],
      [GRANTS, 2],
    ]);
    await expect(marks.heard(word)).resolves.toBeUndefined();
    expect(marks.frame()).toEqual({ marks: { [GRANTS]: 2, "store.shell": 9 } });
  });

  it("every rise is said whole, a non-rise is not, and one who left hears nothing", async () => {
    const floor = new FakeFloor();
    const marks = new CustodyMarks({ expect: { "store.shell": 9 }, floor });
    const said: CustodyMarksFrame[] = [];
    const leave = marks.onChange((frame) => {
      said.push(frame);
    });

    await marks.note(GRANTS, 3);
    expect(said).toEqual([{ marks: { [GRANTS]: 3, "store.shell": 9 } }]);
    // not rises
    await marks.note(GRANTS, 3);
    await marks.note(GRANTS, 2);
    await marks.heard(new Map([[GRANTS, 3]]));
    expect(said).toHaveLength(1);
    // the floor's word is a rise like any other
    await marks.heard(new Map([["store.floor", 2]]));
    expect(said).toHaveLength(2);
    expect(said[1]).toEqual({ marks: { [GRANTS]: 3, "store.floor": 2, "store.shell": 9 } });
    // a frame is a value of its own: a later rise did not rewrite the one already said
    expect(said[0]).toEqual({ marks: { [GRANTS]: 3, "store.shell": 9 } });

    leave();
    await marks.note(GRANTS, 4);
    expect(said).toHaveLength(2);
    expect(marks.get(GRANTS)).toBe(4);
  });

  // : the floor's count has no ceiling of its own (a u64), and a number past the safe integers
  // that read as NOTHING would be a mark that fell. It reads as the top, and a store whose next count would pass the
  // top cannot write: the safe side.
  it("a mark past the safe integers reads as the top, never as nothing", async () => {
    const top = Number.MAX_SAFE_INTEGER;
    // from the spawner
    expect(new CustodyMarks({ expect: { [GRANTS]: 2 ** 60 } }).get(GRANTS)).toBe(top);
    // from the floor's word at a hello
    const atHello = new CustodyMarks({ expect: { [GRANTS]: 5 } });
    await atHello.heard(new Map([[GRANTS, 2 ** 60]]));
    expect(atHello.get(GRANTS)).toBe(top);
    // and from what the floor keeps when it is told
    const floor = new FakeFloor();
    floor.kept.set(GRANTS, 2 ** 60);
    const told = new CustodyMarks({ floor });
    await expect(told.note(GRANTS, 3)).resolves.toBe(top);
    expect(told.frame()).toEqual({ marks: { [GRANTS]: top } });
    // a store's own note is still a count it could have written
    await expect(told.note(GRANTS, 2 ** 60)).rejects.toThrow();
  });

  it("a listener that throws does not stop a note or the listeners after it", async () => {
    const marks = new CustodyMarks();
    const said: CustodyMarksFrame[] = [];
    marks.onChange(() => {
      throw new Error("a subscriber's socket is gone");
    });
    marks.onChange((frame) => {
      said.push(frame);
    });
    await expect(marks.note(GRANTS, 3)).resolves.toBe(3);
    expect(said).toEqual([{ marks: { [GRANTS]: 3 } }]);
  });

  // A custody log line prints an error's
  // `code`, never its message. Node's file errors name a whole path, which holds the person's home and rides into a
  // support bundle. What `note` rejects with is printed by its caller (the grants file's `grants_mark_unanswered`),
  // which prints a code too, so a rejection carries one.
  it("what a note is refused for is said as a code", async () => {
    const marks = new CustodyMarks();
    await expect(marks.note("Not A Name", 1)).rejects.toMatchObject({ code: "mark-name" });
    await expect(marks.note(GRANTS, -1)).rejects.toMatchObject({ code: "mark-count" });
    await expect(marks.note(GRANTS, 2 ** 53)).rejects.toMatchObject({ code: "mark-count" });
    for (let i = 0; i < CUSTODY.MARKS_MAX; i += 1) await marks.note(`held.${i}`, 1);
    await expect(marks.note("one.more", 1)).rejects.toMatchObject({ code: "marks-full" });
  });

  it("a floor that cannot be told is logged by its code alone: no line at any level holds what its error said", async () => {
    const lines: Line[] = [];
    let failure: unknown;
    const floor: CustodyMarksFloor = { setMark: () => Promise.reject(failure) };
    const marks = new CustodyMarks({ floor, logger: everyLine(lines) });
    const untold = (): Line[] => lines.filter((line) => line.event.endsWith("floor_untold"));

    // a file's error, as Node says one: its message names the whole path
    const noFile = new Error(`ENOENT: no such file or directory, open '${PLANTED}'`);
    failure = Object.assign(noFile, { code: "ENOENT", path: PLANTED });
    await marks.note(GRANTS, 1);
    expect(untold()).toHaveLength(1);
    expect(untold()[0]?.attrs).toEqual({ name: GRANTS, code: "ENOENT" });

    // the link's own refusal carries its word as `kind` (native-link.ts `RpcCallError`), its `code` a number
    const noAnswer = new Error(`no answer from ${PLANTED}`);
    failure = Object.assign(noAnswer, { kind: "TIMEOUT", code: -32004 });
    await marks.note(GRANTS, 2);
    expect(untold()[1]?.attrs).toEqual({ name: GRANTS, code: "TIMEOUT" });

    // and an error with no word at all is `unknown`
    failure = new Error(`something about ${PLANTED}`);
    await marks.note(GRANTS, 3);
    expect(untold()[2]?.attrs).toEqual({ name: GRANTS, code: "unknown" });

    expect(JSON.stringify(lines)).not.toContain(PLANTED);
    expect(JSON.stringify(lines)).not.toContain("a-home");
  });

  it("a listener that throws is logged by its code alone too", async () => {
    const lines: Line[] = [];
    const marks = new CustodyMarks({ logger: everyLine(lines) });
    marks.onChange(() => {
      throw Object.assign(new Error(`EPIPE: write to ${PLANTED}`), { code: "EPIPE" });
    });
    await marks.note(GRANTS, 3);
    const failed = lines.filter((line) => line.event.endsWith("listener_failed"));
    expect(failed).toHaveLength(1);
    expect(failed[0]?.attrs).toEqual({ code: "EPIPE" });
    expect(JSON.stringify(lines)).not.toContain(PLANTED);
  });
});
