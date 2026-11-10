// OB custody (C3; CUSTODY-SPEC §2.4) — THE FLOOR'S SEALED SPAWN (`src/native-bootstrap.ts`).
//
// A sealed fieldd spawns its floor with a piped stdin and `FIELD_NATIVE_CUSTODY=stdin`, writes ONE line, mgmt.ts's
// `NativeBootstrap`, and closes the pipe. Nothing of the secret rides the environment or an argument. C6's seam is
// here too: a verifier, when one is configured, is awaited BEFORE the line is written, and a child it refuses is
// ended and never written to. The verifier itself (codesign) is `packages/trust`'s; these rows hand a fake.
//
// The child is a fake with a stdin the row reads back. custody-boot.test.ts runs the same spawn under fieldd's real
// entry, against a stand-in floor that writes down how it was born; native-pairing-sealed.test.ts holds the links.
import { PassThrough, Writable } from "node:stream";
import { CUSTODY, NativeBootstrap } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  type BootstrapChild,
  handNativeBootstrap,
  type SealedSpawnOptions,
  type SpawnBootstrapChild,
  spawnSealedNative,
} from "../src/native-bootstrap";

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
