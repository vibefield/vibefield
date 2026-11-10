// OB custody (C3; CUSTODY-SPEC §2.4) — THE FLOOR'S SEALED SPAWN (`src/native-bootstrap.ts`).
//
// A sealed fieldd spawns its floor with a piped stdin and `FIELD_NATIVE_CUSTODY=stdin`, writes ONE line, mgmt.ts's
// `NativeBootstrap`, and closes the pipe. Nothing of the secret rides the environment or an argument. C6's seam is
// here too: a verifier, when one is configured, is awaited BEFORE the line is written, and a child it refuses is
// ended and never written to. The verifier itself (codesign) is `packages/trust`'s; these rows hand a fake.
//
// The child is a fake with a stdin the row reads back. custody-boot.test.ts runs the same spawn under fieldd's real
// entry, against a stand-in floor that writes down how it was born; native-pairing-sealed.test.ts holds the links.
//
// GIVEN AN INJECTED `verifyNativeChild` (the PM's rows rule, CUSTODY-SPEC v0.19): the C3 rows here hand the spawn a
// verifier of their own and a fake child. They show the hand's own rule given that verifier (asked first; then
// written, or ended and never written to) and are NO proof that production binds one. The binding is proved through
// the real composition root in custody-boot.test.ts: "sealed, a floor that is not ours is written nothing and the
// boot fails by name" (nothing replaced), and the rows after it (only the tool below trust stood in for).
//
// C6, wired (§2.4 "v0.15"): `floorVerifier` is the verifier `bin.ts` hands every sealed spawn, and it takes NOTHING
// from its caller, so no row can hand it a stand-in for trust. What it asks, in what order, and what it refuses are
// those same rows'. What this file holds of it is read from the source: that it has no parameter, that it asks whose
// code fieldd is when it is made, and that the entry makes one and hands it on.
//
// THE BUDGET (§2.4 "v0.21"): everything between the spawn and the write has `CUSTODY.CHILD_CHECK_BUDGET_MS`. Its rows
// are GIVEN AN INJECTED VERIFIER too, and a faked `setTimeout`: they show the hand's rule given a verifier that is
// late or never answers. That production's verifier is under the same budget is the binding the rows above prove:
// `bin.ts` hands `floorVerifier()` to this same hand. How long the real check takes is not measured anywhere here
// (owed to the signed build's witness).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { CUSTODY, NativeBootstrap } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BootstrapChild,
  handNativeBootstrap,
  type SealedSpawnOptions,
  type SpawnBootstrapChild,
  spawnSealedNative,
} from "../src/native-bootstrap";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");
const FLOOR_SECRET = "d7".repeat(32);
const LINE = `${JSON.stringify({ v: 1, pairing: FLOOR_SECRET })}\n`;
const FLOOR_ENV = { FIELD_NATIVE_DATA_DIR: "/tmp/vf-a-root", FIELD_LOG_DIR: "/tmp/vf-a-root/logs" };
const beat = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A child as `spawn` answers one, with a stdin the row reads back. */
class FakeChild implements BootstrapChild {
  readonly stdin: PassThrough | null;
  readonly written: Buffer[] = [];
  readonly kills: Array<NodeJS.Signals | number | undefined> = [];
  unrefs = 0;

  constructor(
    readonly pid: number | undefined,
    piped = true,
  ) {
    this.stdin = piped ? new PassThrough() : null;
    this.stdin?.on("data", (chunk: Buffer) => this.written.push(chunk));
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.kills.push(signal);
    return true;
  }

  unref(): void {
    this.unrefs += 1;
  }

  /** everything the child has been sent on its stdin so far */
  said(): string {
    return Buffer.concat(this.written).toString("utf8");
  }

  /** everything the child was sent, once it has read to the END of its stdin: resolves only if the pipe was closed */
  sent(): Promise<string> {
    const stdin = this.stdin;
    return new Promise((resolve) => {
      if (stdin === null || stdin.readableEnded) resolve(this.said());
      else stdin.once("end", () => resolve(this.said()));
    });
  }
}

/** A pipe whose reader left: the write fails, as EPIPE does. */
class Broken extends Writable {
  override _write(
    _chunk: unknown,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    setImmediate(() => callback(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })));
  }
}

interface SpawnCall {
  file: string;
  args: readonly string[];
  options: SealedSpawnOptions;
}

/** `spawn`, recorded: what it was asked, and the child it answered. */
function fakeSpawn(child: BootstrapChild): { spawn: SpawnBootstrapChild; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  return {
    calls,
    spawn: (file, args, options) => {
      calls.push({ file, args, options });
      return child;
    },
  };
}

describe("the floor's sealed spawn (C3)", () => {
  it("the bootstrap line is one JSON line and stdin is closed after it", async () => {
    const child = new FakeChild(4_242);
    const { spawn, calls } = fakeSpawn(child);
    const spawned = spawnSealedNative({
      bin: "/a/field-native",
      env: FLOOR_ENV,
      pairing: FLOOR_SECRET,
      spawn,
    });
    expect(spawned.pid).toBe(4_242);
    await expect(spawned.handed).resolves.toBe("handed");

    // one line: the contract's shape, a newline, and then the end of the pipe (`sent` waits for that end)
    const said = await child.sent();
    expect(said).toBe(LINE);
    expect(NativeBootstrap.parse(JSON.parse(said))).toMatchObject({ v: 1, pairing: FLOOR_SECRET });
    expect(child.stdin?.writableEnded).toBe(true);

    // the spawn: a pipe for stdin alone, the flag in the environment, the caller's environment kept, no argument
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.file).toBe("/a/field-native");
    expect(call?.args).toEqual([]);
    expect(call?.options.stdio).toEqual(["pipe", "ignore", "inherit"]);
    expect(call?.options.detached).toBe(true);
    expect(call?.options.env).toEqual({ ...FLOOR_ENV, [CUSTODY.NATIVE_ENV]: CUSTODY.STDIN });
    // the secret rides the pipe alone: never the environment
    expect(JSON.stringify(call?.options.env)).not.toContain(FLOOR_SECRET);
    // the floor outlives fieldd: the child is not held
    expect(child.unrefs).toBe(1);
    expect(child.kills).toEqual([]);
  });

  it("a child the verifier refuses is never written to", async () => {
    const child = new FakeChild(4_243);
    const asked: number[] = [];
    const spawned = spawnSealedNative({
      bin: "/a/field-native",
      env: FLOOR_ENV,
      pairing: FLOOR_SECRET,
      spawn: fakeSpawn(child).spawn,
      verifyNativeChild: async (pid) => {
        asked.push(pid);
        return false;
      },
    });
    await expect(spawned.handed).resolves.toBe("child-not-ours");
    expect(asked).toEqual([4_243]);
    // not a byte, then or a beat later
    await beat();
    expect(child.said()).toBe("");
    // the process is ended, by the pid fieldd itself spawned and has not reaped
    expect(child.kills).toEqual(["SIGKILL"]);
  });

  it("the verifier is awaited before the line is written", async () => {
    const child = new FakeChild(4_244);
    let answer: (ours: boolean) => void = () => undefined;
    const spawned = spawnSealedNative({
      bin: "/a/field-native",
      env: FLOOR_ENV,
      pairing: FLOOR_SECRET,
      spawn: fakeSpawn(child).spawn,
      verifyNativeChild: () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    });
    await beat(50);
    // nothing yet: not a byte, and the pipe still open
    expect(child.said()).toBe("");
    expect(child.stdin?.writableEnded).toBe(false);
    answer(true);
    await expect(spawned.handed).resolves.toBe("handed");
    expect(await child.sent()).toBe(LINE);
    expect(child.kills).toEqual([]);
  });

  it("a verifier that throws is a refusal", async () => {
    const child = new FakeChild(4_245);
    const spawned = spawnSealedNative({
      bin: "/a/field-native",
      env: FLOOR_ENV,
      pairing: FLOOR_SECRET,
      spawn: fakeSpawn(child).spawn,
      verifyNativeChild: () => Promise.reject(new Error("codesign did not run")),
    });
    await expect(spawned.handed).resolves.toBe("child-not-ours");
    await beat();
    expect(child.said()).toBe("");
    expect(child.kills).toEqual(["SIGKILL"]);
  });

  it("with no verifier the line is written at once", async () => {
    const child = new FakeChild(4_246);
    const outcome = await handNativeBootstrap(child, FLOOR_SECRET);
    expect(outcome).toBe("handed");
    expect(await child.sent()).toBe(LINE);
  });

  it("a spawn that made no process hands nothing", async () => {
    const asked: number[] = [];
    const verify = async (pid: number): Promise<boolean> => {
      asked.push(pid);
      return true;
    };
    const noPid = new FakeChild(undefined);
    expect(await handNativeBootstrap(noPid, FLOOR_SECRET, verify)).toBe("no-child");
    await beat();
    expect(noPid.said()).toBe("");
    const noPipe = new FakeChild(4_247, false);
    expect(await handNativeBootstrap(noPipe, FLOOR_SECRET, verify)).toBe("no-child");
    // nobody to verify, so nobody was asked
    expect(asked).toEqual([]);
  });

  it("a child that is gone before it reads costs fieldd nothing: the failed write is an answer", async () => {
    const child: BootstrapChild = {
      pid: 4_248,
      stdin: new Broken(),
      kill: () => true,
      unref: () => undefined,
    };
    // an answer, and no stream error left for nobody to hear (which would end the process)
    expect(await handNativeBootstrap(child, FLOOR_SECRET)).toBe("write-failed");
    await beat();
  });

  // A GUARD, not a red row: it holds before the budget and after it. A check that took its time and then said yes
  // writes to a child that may have left meanwhile (the floor waits `CUSTODY.HANDOFF_WAIT_MS` for its line and no
  // longer); that write is an answer too.
  it("given an injected verifier: a child that left while it was being asked about costs fieldd nothing either", async () => {
    const child: BootstrapChild = {
      pid: 4_249,
      stdin: new Broken(),
      kill: () => true,
      unref: () => undefined,
    };
    let answer: (ours: boolean) => void = () => undefined;
    const asked = new Promise<boolean>((resolve) => {
      answer = resolve;
    });
    const handed = handNativeBootstrap(child, FLOOR_SECRET, () => asked);
    await beat();
    answer(true);
    await expect(handed).resolves.toBe("write-failed");
    await beat();
  });
});

// ---- the hand's ONE budget (§2.4 "v0.21"): given an injected verifier, and a faked clock ----

describe("the hand's one budget, given an injected verifier", () => {
  const BUDGET = CUSTODY.CHILD_CHECK_BUDGET_MS;
  /** a verifier whose answer the row gives, when it likes, or never */
  function slowVerifier(): { verify: () => Promise<boolean>; answer: (ours: boolean) => void } {
    let answer: (ours: boolean) => void = () => undefined;
    const asked = new Promise<boolean>((resolve) => {
      answer = resolve;
    });
    return { verify: () => asked, answer: (ours) => answer(ours) };
  }
  const handTo = (child: FakeChild, verify: () => Promise<boolean>) =>
    spawnSealedNative({
      bin: "/a/field-native",
      env: FLOOR_ENV,
      pairing: FLOOR_SECRET,
      spawn: fakeSpawn(child).spawn,
      verifyNativeChild: verify,
    });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a verifier that never settles: a moment before the budget the child still stands, unwritten; at the budget it is ended, and was never written to", async () => {
    // the timers alone: the pipe's own turns stay real
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = new FakeChild(4_250);
    const wrote = vi.spyOn(child.stdin as PassThrough, "end");
    const { verify } = slowVerifier();
    let outcome: string | undefined;
    const spawned = handTo(child, verify);
    void spawned.handed.then((said) => {
      outcome = said;
    });

    await vi.advanceTimersByTimeAsync(BUDGET - 1);
    expect(outcome).toBeUndefined();
    expect(child.kills).toEqual([]);
    expect(child.stdin?.destroyed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    // the outcome a refused child's is: ended by the pid fieldd spawned, its pipe closed, not a byte on it
    await expect(spawned.handed).resolves.toBe("child-not-ours");
    expect(child.kills).toEqual(["SIGKILL"]);
    expect(child.stdin?.destroyed).toBe(true);
    expect(wrote).not.toHaveBeenCalled();
    expect(child.said()).toBe("");
  });

  it("a verifier that says yes only AFTER the budget is not listened to: nothing is written then either", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = new FakeChild(4_251);
    const wrote = vi.spyOn(child.stdin as PassThrough, "end");
    const { verify, answer } = slowVerifier();
    const spawned = handTo(child, verify);
    await vi.advanceTimersByTimeAsync(BUDGET);
    await expect(spawned.handed).resolves.toBe("child-not-ours");

    answer(true);
    await vi.advanceTimersByTimeAsync(BUDGET);
    expect(wrote).not.toHaveBeenCalled();
    expect(child.said()).toBe("");
    // ended once, at the budget, and not again
    expect(child.kills).toEqual(["SIGKILL"]);
  });

  it("a verifier that says yes INSIDE the budget: the line is written, and the budget's end touches nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = new FakeChild(4_252);
    const { verify, answer } = slowVerifier();
    const spawned = handTo(child, verify);
    await vi.advanceTimersByTimeAsync(BUDGET - 1);
    answer(true);
    await expect(spawned.handed).resolves.toBe("handed");
    expect(await child.sent()).toBe(LINE);

    // the budget's timer went with the answer: nothing is left to fire, and the child it handed is not ended
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(BUDGET * 2);
    expect(child.kills).toEqual([]);
  });
});

// ---- C6, wired: the verifier `bin.ts` hands every sealed spawn (§2.4 "v0.15"), read from the source ----

describe("the floor's verifier, as bin.ts makes it (C6)", () => {
  // No seam: a parameter here would be one more thing a row could fake and production could forget to bind.
  it("the verifier takes nothing from its caller: there is no seam to hand it a stand-in for trust", () => {
    const source = readFileSync(join(SRC, "native-bootstrap.ts"), "utf8");
    expect(source).toContain(
      "export function floorVerifier(): (pid: number) => Promise<boolean> {",
    );
    // its two questions and the floor's identifier are trust's, by name
    const taken = /^import \{([^}]+)\} from "@vibefield\/trust";$/m.exec(source)?.[1] ?? "";
    const names = taken.split(",").map((name) => name.trim());
    for (const name of ["childIsOurs", "ownIdentity", "FIELD_NATIVE_SIGNING_IDENTIFIER"])
      expect(names, name).toContain(name);
    // and each is asked with no tool and no host of anybody's: trust's own defaults, which are the machine's
    expect(source).toContain("ownIdentity()");
    expect(source).toContain("childIsOurs(pid, identity, floors);");
    expect(source).toContain("{ identifier: FIELD_NATIVE_SIGNING_IDENTIFIER }");
  });

  // §2.4 "v0.21", item 3 — so that the hand's one budget is spent on the child's check alone. Read from the source,
  // as the row above is; the RUN that shows it is custody-boot.test.ts's "fieldd asks whose code it is itself when it
  // makes its verifier".
  it("the verifier asks whose code fieldd is when it is MADE, once, and not at its first child", () => {
    const source = readFileSync(join(SRC, "native-bootstrap.ts"), "utf8");
    const made = source.indexOf("export function floorVerifier()");
    const asksOwn = source.indexOf("ownIdentity()", made);
    const perChild = source.indexOf("return async (pid) => {", made);
    expect(made).toBeGreaterThan(-1);
    expect(asksOwn).toBeGreaterThan(made);
    // in the maker's own body, ABOVE the function that answers for each child
    expect(perChild).toBeGreaterThan(asksOwn);
    // and that is the one call of it in the file
    expect(source.split("ownIdentity()")).toHaveLength(2);
  });

  it("bin.ts makes ONE verifier and hands it to the spawn the boot and every respawn share", () => {
    const entry = readFileSync(join(SRC, "bin.ts"), "utf8");
    // made once, with no argument
    expect(entry.split("floorVerifier(")).toHaveLength(2);
    expect(entry).toContain("floorVerifier()");
    // and handed to the one spawn (TC-D1: the boot's ensure and every supervisor respawn run the same closure)
    expect(entry).toContain("verifyNativeChild: sealedFloor.verifyNativeChild,");
  });

  // A GUARD, not a red row: it holds before the verifier is wired and after. What it pins is that nothing of this
  // module, and so nothing of trust, is loaded by a fieldd that was handed nothing. custody-boot.test.ts has the
  // same guard as a run: handed nothing, a stand-in is the floor of record and `codesign` was never run.
  it("at files nothing of it is loaded: bin.ts reaches the verifier's module only from a hand-off", () => {
    const entry = readFileSync(join(SRC, "bin.ts"), "utf8");
    // the one place the module is named, in the arm of a conditional that a fieldd handed nothing never takes
    expect(entry.split('import("./native-bootstrap")')).toHaveLength(2);
    expect(entry).toMatch(
      /custody === undefined\s*\?\s*undefined\s*:[^;]*import\("\.\/native-bootstrap"\)/,
    );
    // and the entry itself names trust nowhere: trust is native-bootstrap.ts's import, loaded with it or not at all
    expect(entry).not.toContain("@vibefield/trust");
  });
});
