import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MacosCaptureHelperSupervisor,
  type MacosCaptureNativeAdapter,
  type MacosCaptureNativeFrame,
} from "../src/main/live-surfaces/macos-capture-helper";
import type {
  SckCaptureClientStartRequest,
  SckCaptureFrame,
} from "../src/main/live-surfaces/sck-producer";

class FakeNativeAdapter implements MacosCaptureNativeAdapter {
  readonly starts: Array<{ serviceName: string; capabilityHex: string }> = [];
  readonly expectedPids: number[] = [];
  readonly released: string[] = [];
  readonly queue: MacosCaptureNativeFrame[] = [];
  stopCount = 0;

  start(serviceName: string, capabilityHex: string): void {
    this.starts.push({ serviceName, capabilityHex });
  }

  setExpectedPeerPid(pid: number): void {
    this.expectedPids.push(pid);
  }

  drain(maximum: number): readonly MacosCaptureNativeFrame[] {
    return this.queue.splice(0, maximum);
  }

  release(frameId: string): boolean {
    this.released.push(frameId);
    return true;
  }

  stats() {
    return {
      received: this.released.length + this.queue.length,
      accepted: this.released.length + this.queue.length,
      rejectedIdentity: 0,
      rejectedCapability: 0,
      rejectedProtocol: 0,
      outstanding: this.queue.length,
    };
  }

  stop(): void {
    this.stopCount += 1;
    this.queue.length = 0;
  }
}

interface FakeHelperOptions {
  readonly sourceRef?: string;
  readonly readyPid?: number;
  readonly windowId?: number;
  readonly ownerPid?: number;
}

class FakeHelper extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly commands: Record<string, unknown>[] = [];
  readonly args: readonly string[];
  readonly pid: number;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;

  constructor(
    pid: number,
    args: readonly string[],
    readonly options: FakeHelperOptions = {},
  ) {
    super();
    this.pid = pid;
    this.args = args;
    let input = "";
    this.stdin.on("data", (chunk: Buffer | string) => {
      input += String(chunk);
      for (;;) {
        const newline = input.indexOf("\n");
        if (newline < 0) break;
        const line = input.slice(0, newline);
        input = input.slice(newline + 1);
        if (line.length === 0) continue;
        const command = JSON.parse(line) as Record<string, unknown>;
        this.commands.push(command);
        this.respond(command);
      }
    });
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    if (this.exitCode !== null) return false;
    this.killed = true;
    this.signalCode = signal;
    this.emit("exit", null, signal);
    return true;
  }

  crash(): void {
    if (this.exitCode !== null) return;
    this.exitCode = 7;
    this.emit("exit", 7, null);
  }

  emitMalformed(line = "not-json\n"): void {
    this.stdout.write(line);
  }

  private respond(command: Record<string, unknown>): void {
    const type = command["type"];
    const requestId = command["requestId"];
    if (type === "release") return;
    if (type === "shutdown") {
      this.exitCode = 0;
      this.emit("exit", 0, null);
      return;
    }
    if (typeof requestId !== "string") return;
    const base = { v: 1, requestId };
    if (type === "hello") {
      this.output({
        ...base,
        event: "ready",
        protocolVersion: 1,
        pid: this.options.readyPid ?? this.pid,
      });
      return;
    }
    if (type === "enumerate") {
      this.output({
        ...base,
        event: "sources",
        sources: [
          {
            sourceRef: this.options.sourceRef ?? "0123456789abcdef0123456789abcdef",
            applicationName: "Fixture",
            bundleIdentifier: "test.fixture",
            title: "Animated stripes",
            windowId: this.options.windowId ?? 77,
            ownerPid: this.options.ownerPid ?? 900,
            frame: { x: -10, y: 20, width: 320, height: 180 },
            onScreen: false,
          },
        ],
      });
      return;
    }
    const events: Record<string, string> = {
      start: "started",
      demand: "demand-applied",
      stop: "stopped",
      "request-permission": "permission",
    };
    const event = events[String(type)];
    if (event !== undefined) {
      this.output({ ...base, event, ...(type === "request-permission" ? { granted: true } : {}) });
    }
  }

  private output(message: unknown): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

function sourceRef(index: number): string {
  return index.toString(16).padStart(32, "0");
}

function deterministicHex() {
  let counter = 0;
  return (bytes: number): string => {
    counter += 1;
    return counter.toString(16).padStart(bytes * 2, "0");
  };
}

function setup(helperOptions?: (index: number, pid: number) => FakeHelperOptions) {
  const adapter = new FakeNativeAdapter();
  const helpers: FakeHelper[] = [];
  const supervisor = new MacosCaptureHelperSupervisor({
    helperPath: "/absolute/live-surface-capture-helper",
    adapter,
    randomHex: deterministicHex(),
    pollIntervalMs: 4,
    requestTimeoutMs: 1_000,
    spawnHelper: (_path, args) => {
      const index = helpers.length + 1;
      const pid = 400 + index;
      const helper = new FakeHelper(
        pid,
        args,
        helperOptions?.(index, pid) ?? { sourceRef: sourceRef(index + 2) },
      );
      helpers.push(helper);
      return helper as unknown as ChildProcessWithoutNullStreams;
    },
  });
  return { adapter, helpers, supervisor };
}

function request(
  source: string,
  onFrame: (frame: SckCaptureFrame) => void = () => undefined,
  onFault: SckCaptureClientStartRequest["onFault"] = () => undefined,
): SckCaptureClientStartRequest {
  return {
    producerEpoch: 1,
    source: { kind: "sck-window", sourceRef: source, captureCursor: false },
    demand: { revision: 1, mode: "live", targetFps: 30 },
    onFrame,
    onFault,
  };
}

function nativeFrame(sessionKey: string, override: Partial<MacosCaptureNativeFrame> = {}) {
  return {
    frameId: "1",
    sessionKey,
    producerEpoch: 1,
    sequence: "1",
    slot: 0,
    width: 640,
    height: 360,
    logicalWidth: 320,
    logicalHeight: 180,
    timestampUs: "42",
    ioSurface: Buffer.alloc(8),
    ...override,
  } satisfies MacosCaptureNativeFrame;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("MacosCaptureHelperSupervisor", () => {
  it("mutually binds the child/token and forwards a native frame with exact release provenance", async () => {
    vi.useFakeTimers();
    const result = setup();
    const sources = await result.supervisor.enumerateWindows(true);
    expect(sources[0]).toMatchObject({
      sourceRef: sourceRef(3),
      windowId: 77,
      ownerPid: 900,
      frame: { x: -10, y: 20, width: 320, height: 180 },
    });
    const frames: SckCaptureFrame[] = [];
    await result.supervisor.startSession(
      request(sources[0]!.sourceRef, (frame) => frames.push(frame)),
    );
    const helper = result.helpers[0]!;
    const hello = helper.commands[0]!;
    const start = helper.commands.find((command) => command["type"] === "start")!;
    expect(helper.args).toHaveLength(2);
    expect(helper.args[0]).toBe("--mach-service");
    expect(helper.args).not.toContain(hello["token"]);
    expect(hello).toMatchObject({ type: "hello", expectedParentPid: process.pid });
    expect(start["token"]).toBe(hello["token"]);
    expect(result.adapter.expectedPids).toEqual([helper.pid]);
    expect(result.adapter.starts[0]).toMatchObject({ capabilityHex: hello["token"] });

    const sessionKey = start["sessionKey"] as string;
    result.adapter.queue.push(nativeFrame(sessionKey));
    await vi.advanceTimersByTimeAsync(4);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      producerEpoch: 1,
      sequence: 1n,
      codedSize: { width: 640, height: 360 },
      logicalSize: { width: 320, height: 180 },
      timestampUs: 42n,
    });
    frames[0]?.releaseLocal();
    frames[0]?.releaseLease("quarantined");
    expect(result.adapter.released).toEqual(["1"]);
    expect(helper.commands.at(-1)).toMatchObject({
      type: "release",
      sessionKey,
      producerEpoch: 1,
      sequence: "1",
      slot: 0,
      disposition: "quarantined",
      token: hello["token"],
    });
    expect(result.supervisor.stats).toMatchObject({ framesReceived: 1, releaseCommands: 1 });
    await result.supervisor.dispose();
  });

  it("rejects a helper whose ready identity does not match the spawned PID", async () => {
    const result = setup((_index, pid) => ({ readyPid: pid + 1 }));
    await expect(result.supervisor.enumerateWindows()).rejects.toThrow(/identity handshake/);
    expect(result.helpers[0]?.killed).toBe(true);
    expect(result.adapter.stopCount).toBe(1);
    await result.supervisor.dispose();
  });

  it("rebinds an enumerated window by exact PID and window ID after helper restart", async () => {
    const result = setup((index) => ({ sourceRef: sourceRef(index + 2) }));
    const original = (await result.supervisor.enumerateWindows())[0]!;
    const firstFault = vi.fn();
    await result.supervisor.startSession(request(original.sourceRef, () => undefined, firstFault));
    result.helpers[0]?.crash();
    expect(firstFault).toHaveBeenCalledWith({
      code: "producer-crashed",
      message: "Screen capture helper exited",
      recovery: "automatic",
    });

    await result.supervisor.startSession(request(original.sourceRef));
    expect(result.helpers).toHaveLength(2);
    const second = result.helpers[1]!;
    const commands = second.commands.map((command) => command["type"]);
    expect(commands).toEqual(["hello", "enumerate", "start"]);
    expect(second.commands.at(-1)?.["sourceRef"]).toBe(sourceRef(4));
    expect(result.supervisor.stats).toMatchObject({ helperStarts: 2, helperExits: 1 });
    await result.supervisor.dispose();
  });

  it("releases and rejects a native frame for an unknown session", async () => {
    vi.useFakeTimers();
    const result = setup();
    await result.supervisor.enumerateWindows();
    const unknown = nativeFrame("ffffffffffffffffffffffffffffffff", { frameId: "9" });
    result.adapter.queue.push(unknown);
    await vi.advanceTimersByTimeAsync(4);
    expect(result.adapter.released).toEqual(["9"]);
    expect(result.helpers[0]?.commands.at(-1)).toMatchObject({
      type: "release",
      sessionKey: unknown.sessionKey,
      disposition: "dropped",
    });
    expect(result.supervisor.stats).toMatchObject({ framesRejected: 1, releaseCommands: 1 });
    await result.supervisor.dispose();
  });

  it("fails the authenticated generation closed on malformed helper output", async () => {
    const result = setup();
    await result.supervisor.enumerateWindows();
    result.helpers[0]?.emitMalformed();
    expect(result.helpers[0]?.killed).toBe(true);
    expect(result.adapter.stopCount).toBe(1);
    expect(result.supervisor.stats.helperExits).toBe(1);
    await result.supervisor.dispose();
  });
});
