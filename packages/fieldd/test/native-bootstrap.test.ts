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
// C6, wired (§2.4 "v0.15"): `floorVerifier` is the verifier `bin.ts` hands every sealed spawn. The rows below script
// trust's two questions to say what it asks and in what order. The ONE row with nothing scripted, through fieldd's
// real entry and trust's real questions, is custody-boot.test.ts's ("a floor that is not ours is written nothing").
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { CUSTODY, NativeBootstrap } from "@vibefield/contracts";
import {
  type CodeIdentity,
  type ExpectedCode,
  FIELD_NATIVE_SIGNING_IDENTIFIER,
  FIELDD_SIGNING_IDENTIFIER,
} from "@vibefield/trust";
import { describe, expect, it } from "vitest";
import {
  type BootstrapChild,
  type FloorIdentityQuestions,
  floorVerifier,
  handNativeBootstrap,
  type SealedNativeSpawned,
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
    /** a pipe whose reader left: the write fails, as EPIPE does */
    class Broken extends Writable {
      override _write(
        _chunk: unknown,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
      ): void {
        setImmediate(() => callback(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })));
      }
    }
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
});

// ---- C6, wired: the verifier `bin.ts` hands every sealed spawn (§2.4 "v0.15") ----

/** fieldd's own identity in these rows: a team's, hardened. No team of anybody's. */
const OWN: CodeIdentity = { team: "ABCDE12345", hardened: true };

interface AskedOfAChild {
  pid: number;
  own: CodeIdentity;
  expect: ExpectedCode;
}

/** trust's two questions, scripted and counted: whose code fieldd is itself, and which children are its floor. */
function questions(
  own: CodeIdentity | null,
  ours: (pid: number) => boolean = () => true,
): { ask: FloorIdentityQuestions; children: AskedOfAChild[]; ownAsked: () => number } {
  const children: AskedOfAChild[] = [];
  let ownAsked = 0;
  const ask: FloorIdentityQuestions = {
    ownIdentity: async () => {
      ownAsked += 1;
      return own;
    },
    childIsOurs: async (pid, mine, which) => {
      children.push({ pid, own: mine, expect: which });
      return ours(pid);
    },
  };
  return { ask, children, ownAsked: () => ownAsked };
}

/** One sealed spawn of a fake child under a verifier, as `bin.ts`'s closure makes each of its own. */
function sealedSpawn(
  child: FakeChild,
  verifyNativeChild: (pid: number) => Promise<boolean>,
): SealedNativeSpawned {
  return spawnSealedNative({
    bin: "/a/field-native",
    env: FLOOR_ENV,
    pairing: FLOOR_SECRET,
    spawn: fakeSpawn(child).spawn,
    verifyNativeChild,
  });
}

describe("the floor's verifier, as bin.ts makes it (C6)", () => {
  it("a sealed spawn whose child does not verify writes no line", async () => {
    const { ask, children } = questions(OWN, () => false);
    const child = new FakeChild(4_250);
    const spawned = sealedSpawn(child, floorVerifier(ask));
    await expect(spawned.handed).resolves.toBe("child-not-ours");
    expect(children.map((one) => one.pid)).toEqual([4_250]);
    // not a byte, then or a beat later, and the child is ended
    await beat();
    expect(child.said()).toBe("");
    expect(child.kills).toEqual(["SIGKILL"]);
  });

  it("a child that verifies is handed its line, after it was asked about", async () => {
    const { ask, children } = questions(OWN);
    const child = new FakeChild(4_251);
    const spawned = sealedSpawn(child, floorVerifier(ask));
    await expect(spawned.handed).resolves.toBe("handed");
    expect(await child.sent()).toBe(LINE);
    expect(children).toHaveLength(1);
    expect(child.kills).toEqual([]);
  });

  it("a null own identity is a refusal: the child is not asked about, not written to, and ended", async () => {
    const { ask, children, ownAsked } = questions(null);
    const verify = floorVerifier(ask);
    const child = new FakeChild(4_252);
    await expect(sealedSpawn(child, verify).handed).resolves.toBe("child-not-ours");
    await beat();
    expect(child.said()).toBe("");
    expect(child.kills).toEqual(["SIGKILL"]);
    // nobody to compare a child with: the second question is never asked
    expect(children).toEqual([]);
    // and it stays a refusal: a fieldd that could not say whose code it is does not ask again for a better answer
    const next = new FakeChild(4_253);
    await expect(sealedSpawn(next, verify).handed).resolves.toBe("child-not-ours");
    await beat();
    expect(next.said()).toBe("");
    expect(children).toEqual([]);
    expect(ownAsked()).toBe(1);
  });

  it("the identifier asked for is the floor's, with fieldd's own identity and the child's pid", async () => {
    const { ask, children } = questions(OWN);
    await expect(floorVerifier(ask)(4_254)).resolves.toBe(true);
    const floors: ExpectedCode = { identifier: FIELD_NATIVE_SIGNING_IDENTIFIER };
    expect(children).toEqual([{ pid: 4_254, own: OWN, expect: floors }]);
    // the floor's is not fieldd's own: another of the team's binaries in the floor's place is not the floor
    expect(FIELD_NATIVE_SIGNING_IDENTIFIER).toBe("field-native");
    expect(FIELD_NATIVE_SIGNING_IDENTIFIER).not.toBe(FIELDD_SIGNING_IDENTIFIER);
  });

  it("a respawn is verified too: one verifier, each child asked about, fieldd's own identity asked once", async () => {
    const { ask, children, ownAsked } = questions(OWN, (pid) => pid === 4_255);
    // ONE verifier for the process, as bin.ts holds it: the boot's spawn, then a respawn's
    const verify = floorVerifier(ask);
    const first = new FakeChild(4_255);
    await expect(sealedSpawn(first, verify).handed).resolves.toBe("handed");
    const respawned = new FakeChild(4_256);
    await expect(sealedSpawn(respawned, verify).handed).resolves.toBe("child-not-ours");
    expect(children.map((one) => one.pid)).toEqual([4_255, 4_256]);
    expect(ownAsked()).toBe(1);
    // the first holds its line; the respawned one, which did not verify, was written nothing and ended
    expect(await first.sent()).toBe(LINE);
    await beat();
    expect(respawned.said()).toBe("");
    expect(respawned.kills).toEqual(["SIGKILL"]);
  });

  it("a question that could not be asked is a refusal", async () => {
    const ask: FloorIdentityQuestions = {
      ownIdentity: () => Promise.reject(new Error("codesign did not run")),
      childIsOurs: async () => true,
    };
    const child = new FakeChild(4_257);
    const spawned = sealedSpawn(child, floorVerifier(ask));
    await expect(spawned.handed).resolves.toBe("child-not-ours");
    await beat();
    expect(child.said()).toBe("");
    expect(child.kills).toEqual(["SIGKILL"]);
  });

  // The binding, read from the entry's source (the row that RUNS it is custody-boot.test.ts's). `floorVerifier` takes
  // its questions as a parameter so the rows above can script them; what production gets is the default, trust's
  // own, and only as long as `bin.ts` hands it nothing.
  it("bin.ts makes ONE verifier, with trust's own questions, and hands it to the sealed spawn", () => {
    const entry = readFileSync(join(SRC, "bin.ts"), "utf8");
    // made once, with no argument: nothing stands in for trust
    expect(entry.split("floorVerifier(")).toHaveLength(2);
    expect(entry).toContain("floorVerifier()");
    // and handed to the spawn the boot and every respawn share
    expect(entry).toContain("verifyNativeChild: sealedFloor.verifyNativeChild,");
    // the verifier's own questions are trust's, by default and by name
    const source = readFileSync(join(SRC, "native-bootstrap.ts"), "utf8");
    expect(source).toContain("ask: FloorIdentityQuestions = { ownIdentity, childIsOurs }");
    const taken = /^import \{([^}]+)\} from "@vibefield\/trust";$/m.exec(source)?.[1] ?? "";
    const names = taken.split(",").map((name) => name.trim());
    for (const name of ["childIsOurs", "ownIdentity", "FIELD_NATIVE_SIGNING_IDENTIFIER"])
      expect(names, name).toContain(name);
  });

  // A GUARD, not a red row: it holds before the verifier is wired and after. What it pins is that nothing of this
  // module, and so nothing of trust, is loaded by a fieldd that was handed nothing. custody-boot.test.ts has the
  // same guard as a run: handed nothing, a stand-in no verifier would pass is the floor of record.
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
