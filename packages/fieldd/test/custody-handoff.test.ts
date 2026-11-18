// OB custody (C2) — the hand-off's reader (`src/custody-handoff.ts`): what `bin.ts` asks of
// its stdin when its environment says `FIELDD_CUSTODY=stdin`.
//
// One line of JSON, a newline, then nothing more is read. The flag set and no valid line (absent, late, too long,
// not a hand-off) is a refusal to boot, never a fall back to `files`, and the refusal's one line names no secret.
// These rows hold the reader against a stream of their own; custody-boot.test.ts runs it under the real entry.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { CUSTODY, CustodyHandoff } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  CustodyHandoffError,
  custodyAsked,
  custodyOf,
  readCustodyHandoff,
} from "../src/custody-handoff";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../contracts/fixtures");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;
const VALID = CustodyHandoff.parse(fixture("custody-handoff.valid.json"));
const NO_MARKS = CustodyHandoff.parse(fixture("custody-handoff.no-marks.json"));
const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

/** The refusal a read ends in, or a failure that it did not refuse. */
async function refusal(read: Promise<unknown>): Promise<CustodyHandoffError> {
  try {
    await read;
  } catch (error) {
    expect(error).toBeInstanceOf(CustodyHandoffError);
    return error as CustodyHandoffError;
  }
  throw new Error("the hand-off was read, not refused");
}

describe("the custody flag (CUSTODY.ENV)", () => {
  it("unset or blank asks for nothing: files", () => {
    expect(custodyAsked({})).toBe(false);
    expect(custodyAsked({ [CUSTODY.ENV]: "" })).toBe(false);
  });

  it("`stdin` asks for the hand-off", () => {
    expect(custodyAsked({ [CUSTODY.ENV]: CUSTODY.STDIN })).toBe(true);
  });

  it("any other word is a custody this build does not have: refused, never read as files", () => {
    // the last is a word nobody would write but by mistake: what was set is never said back
    const mistaken = "kc-7f3a9d-not-a-level";
    for (const word of ["files", "sealed", "STDIN", "keychain", "1", " stdin", mistaken]) {
      let thrown: unknown;
      try {
        custodyAsked({ [CUSTODY.ENV]: word });
      } catch (error) {
        thrown = error;
      }
      expect(thrown, word).toBeInstanceOf(CustodyHandoffError);
      expect((thrown as CustodyHandoffError).reason, word).toBe("unknown");
      expect((thrown as Error).message, word).not.toContain(mistaken);
    }
  });
});

describe("the hand-off's reader", () => {
  it("reads the one line a spawner writes", async () => {
    const stdin = new PassThrough();
    const read = readCustodyHandoff(stdin);
    stdin.end(line(VALID));
    await expect(read).resolves.toEqual(VALID);
  });

  it("a hand-off that remembers no marks is one too", async () => {
    const stdin = new PassThrough();
    const read = readCustodyHandoff(stdin);
    stdin.end(line(NO_MARKS));
    const handed = await read;
    expect(handed).toEqual(NO_MARKS);
    expect(handed.expect).toBeUndefined();
  });

  it("a line that arrives in pieces is one line", async () => {
    const stdin = new PassThrough();
    const read = readCustodyHandoff(stdin);
    const whole = line(VALID);
    stdin.write(whole.slice(0, 40));
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write(whole.slice(40, 90));
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write(whole.slice(90));
    await expect(read).resolves.toEqual(VALID);
  });

  it("reads to the first newline and no further", async () => {
    const stdin = new PassThrough();
    const read = readCustodyHandoff(stdin);
    // what follows the line is nobody's: it is neither read as a hand-off nor waited for
    stdin.write(`${line(VALID)}${line({ v: 1, shell: "not", pairing: "a", records: "hand-off" })}`);
    await expect(read).resolves.toEqual(VALID);
    // and the reader has let go of the stream: nothing more is taken from it
    expect(stdin.listenerCount("data")).toBe(0);
    expect(stdin.isPaused()).toBe(true);
  });

  it("no line before stdin closes is a refusal", async () => {
    const closed = new PassThrough();
    const read = readCustodyHandoff(closed);
    closed.end();
    expect((await refusal(read)).reason).toBe("absent");

    // a line begun and never ended is no line
    const cut = new PassThrough();
    const half = readCustodyHandoff(cut);
    cut.end(JSON.stringify(VALID));
    expect((await refusal(half)).reason).toBe("absent");
  });

  it("a line that does not come in time is a refusal", async () => {
    const stdin = new PassThrough();
    const started = Date.now();
    const error = await refusal(readCustodyHandoff(stdin, { waitMs: 60 }));
    expect(error.reason).toBe("late");
    expect(Date.now() - started).toBeLessThan(2_000);
    // the wait is the registry's when no row shortens it
    expect(CUSTODY.HANDOFF_WAIT_MS).toBe(10_000);
    // a line that comes after the refusal changes nothing
    stdin.end(line(VALID));
    expect(stdin.listenerCount("data")).toBe(0);
  });

  it("a line longer than the bound is a refusal, its newline counted", async () => {
    const body = JSON.stringify(VALID);
    const padded = (bytes: number): string => `${body}${" ".repeat(bytes - body.length - 1)}\n`;

    // exactly the bound, newline included: read (JSON takes the trailing blanks)
    const fits = new PassThrough();
    const read = readCustodyHandoff(fits);
    fits.end(padded(CUSTODY.HANDOFF_MAX_BYTES));
    await expect(read).resolves.toEqual(VALID);

    // one byte more: refused, though it would parse
    const over = new PassThrough();
    const tooLong = readCustodyHandoff(over);
    over.end(padded(CUSTODY.HANDOFF_MAX_BYTES + 1));
    expect((await refusal(tooLong)).reason).toBe("too-long");

    // and a writer that never sends a newline is refused at the bound, not waited on
    const endless = new PassThrough();
    const never = readCustodyHandoff(endless, { waitMs: 60_000 });
    endless.write("x".repeat(CUSTODY.HANDOFF_MAX_BYTES + 1));
    expect((await refusal(never)).reason).toBe("too-long");

    // a row's own bound, for a reader handed one
    const small = new PassThrough();
    const bounded = readCustodyHandoff(small, { maxBytes: 16 });
    small.end(line(VALID));
    expect((await refusal(bounded)).reason).toBe("too-long");
  });

  it("a line that is not a hand-off is a refusal", async () => {
    const notHandoffs: string[] = [
      "not json\n",
      "\n",
      "[]\n",
      line({ ...VALID, v: 2 }),
      line({ v: 1, shell: VALID.shell, pairing: VALID.pairing }),
      line({ ...VALID, records: VALID.records.toUpperCase() }),
      line({ ...VALID, shell: VALID.shell.slice(2) }),
      line({ ...VALID, expect: { "objects.grants": -1 } }),
    ];
    for (const text of notHandoffs) {
      const stdin = new PassThrough();
      const read = readCustodyHandoff(stdin);
      stdin.end(text);
      expect((await refusal(read)).reason, JSON.stringify(text)).toBe("invalid");
    }
  });

  it("a refusal is one line that names no secret", async () => {
    // a hand-off that is whole but for one field: every secret in it is real to the refusal
    const almost = { ...VALID, v: 2 };
    const stdin = new PassThrough();
    const read = readCustodyHandoff(stdin);
    stdin.end(line(almost));
    const error = await refusal(read);
    const said = `${error.message}\n${String(error)}\n${JSON.stringify(error)}`;
    for (const secret of [VALID.shell, VALID.pairing, VALID.records]) {
      expect(said).not.toContain(secret);
      expect(said).not.toContain(secret.slice(0, 16));
    }
    expect(error.message).not.toContain("\n");
    expect(error.cause).toBeUndefined();
    // every refusal's words say which variable asked, so the one line stands alone in a log
    for (const reason of ["absent", "late", "too-long", "invalid", "unknown"] as const) {
      const words = new CustodyHandoffError(reason).message;
      expect(words, reason).toContain(CUSTODY.ENV);
      expect(words, reason).not.toContain("\n");
    }
  });
});

describe("what a read hand-off becomes (FielddConfig.custody)", () => {
  it("is the sealed level with its three secrets and the marks the spawner remembers", () => {
    expect(custodyOf(VALID)).toEqual({
      level: "sealed",
      shell: VALID.shell,
      pairing: VALID.pairing,
      records: VALID.records,
      expect: { "objects.grants": 7 },
    });
    const none = custodyOf(NO_MARKS);
    expect(none.level).toBe("sealed");
    expect("expect" in none).toBe(false);
  });
});
