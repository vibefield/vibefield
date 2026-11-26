import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  DAEMON_REPLY_MAX_BYTES,
  type DaemonSocket,
  daemonReady,
  daemonRequestId,
  exchangeDaemon,
} from "../src/main/pages/broker/daemon-client";

// EY-1 (2026-11-19): main's exchange with the page engine's daemon, one JSON line each way, on a
// fake socket: no file, no listener, no engine.

interface Script {
  /** emitted after the connect: the reply's chunks, then an error or a close */
  readonly chunks?: readonly string[];
  readonly error?: boolean;
  readonly close?: boolean;
  /** the write's own callback fails */
  readonly writeFails?: boolean;
  /** never connects (the socket file is missing) */
  readonly refused?: boolean;
}

class FakeSocket extends EventEmitter implements DaemonSocket {
  written = "";
  writes = 0;
  destroyed = false;
  constructor(private readonly script: Script) {
    super();
    setImmediate(() => {
      if (script.refused) this.emit("error", new Error("ENOENT"));
      else this.emit("connect");
    });
  }
  write(data: string, done: (error?: Error | null) => void): boolean {
    this.written += data;
    this.writes += 1;
    done(this.script.writeFails ? new Error("EPIPE") : null);
    setImmediate(() => {
      for (const chunk of this.script.chunks ?? []) this.emit("data", Buffer.from(chunk));
      if (this.script.error) this.emit("error", new Error("ECONNRESET"));
      if (this.script.close) this.emit("close");
    });
    return true;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

function socketOf(script: Script) {
  const made: FakeSocket[] = [];
  const connect = vi.fn((_path: string) => {
    const s = new FakeSocket(script);
    made.push(s);
    return s;
  });
  return { connect, made };
}

const soon = () => Date.now() + 2_000;
const command = { id: "r1", action: "url" };

describe("one command, one reply", () => {
  it("writes one line and reads one line back, whatever its chunks; then closes", async () => {
    const { connect, made } = socketOf({
      chunks: ['{"success":true,', '"data":{"url":"https://a.test/"}}\n'],
    });
    const out = await exchangeDaemon("/s.sock", command, { deadlineAt: soon(), connect });
    expect(out).toEqual({ ok: true, reply: { success: true, data: { url: "https://a.test/" } } });
    expect(made[0]?.written).toBe('{"id":"r1","action":"url"}\n');
    expect(made[0]?.destroyed).toBe(true);
  });

  it("hands back an error reply as a reply: success false is the engine's word", async () => {
    const { connect } = socketOf({ chunks: ['{"success":false,"error":"no page","code":"x"}\n'] });
    const out = await exchangeDaemon("/s.sock", command, { deadlineAt: soon(), connect });
    expect(out).toEqual({ ok: true, reply: { success: false, error: "no page", code: "x" } });
  });

  it("cuts a reply over its bound and refuses it", async () => {
    const big = `{"success":true,"data":"${"x".repeat(200)}"}\n`;
    const { connect, made } = socketOf({ chunks: [big] });
    const out = await exchangeDaemon("/s.sock", command, {
      deadlineAt: soon(),
      connect,
      maxReplyBytes: 64,
    });
    expect(out).toEqual({ ok: false, failure: "too-large" });
    expect(made[0]?.destroyed).toBe(true);
    expect(DAEMON_REPLY_MAX_BYTES).toBeGreaterThan(1024 * 1024);
  });

  it("refuses a line that is not a reply", async () => {
    for (const line of ["nope\n", "{}\n", '{"success":true,"error":7}\n', "[1]\n"]) {
      const { connect } = socketOf({ chunks: [line] });
      const out = await exchangeDaemon("/s.sock", command, { deadlineAt: soon(), connect });
      expect(out, line).toEqual({ ok: false, failure: "bad-reply" });
    }
  });
});

describe("what main can know of a failure, and never a second send", () => {
  it("not-sent: the socket refused before the line went out", async () => {
    const { connect, made } = socketOf({ refused: true });
    const out = await exchangeDaemon("/s.sock", command, { deadlineAt: soon(), connect });
    expect(out).toEqual({ ok: false, failure: "not-sent" });
    expect(made[0]?.writes).toBe(0);
    const throwing = vi.fn(() => {
      throw new Error("EACCES");
    });
    const thrown = await exchangeDaemon("/s.sock", command, {
      deadlineAt: soon(),
      connect: throwing,
    });
    expect(thrown).toEqual({ ok: false, failure: "not-sent" });
  });

  it("outcome-unknown: the line went out and no whole reply came back", async () => {
    for (const script of [{ close: true }, { error: true }, { chunks: ['{"succ'], close: true }]) {
      const { connect, made } = socketOf(script);
      const out = await exchangeDaemon("/s.sock", command, { deadlineAt: soon(), connect });
      expect(out, JSON.stringify(script)).toEqual({ ok: false, failure: "outcome-unknown" });
      expect(made[0]?.writes).toBe(1);
      expect(connect).toHaveBeenCalledTimes(1);
    }
    const { connect } = socketOf({ writeFails: true });
    const failed = await exchangeDaemon("/s.sock", command, { deadlineAt: soon(), connect });
    expect(failed).toEqual({ ok: false, failure: "outcome-unknown" });
  });

  it("timeout: the deadline ends the exchange, saying whether the line went out", async () => {
    const { connect, made } = socketOf({});
    const out = await exchangeDaemon("/s.sock", command, { deadlineAt: Date.now() + 30, connect });
    expect(out).toEqual({ ok: false, failure: "timeout", written: true });
    expect(made[0]?.writes).toBe(1);
    expect(made[0]?.destroyed).toBe(true);
    const late = socketOf({});
    const past = await exchangeDaemon("/s.sock", command, {
      deadlineAt: Date.now() - 1,
      connect: late.connect,
    });
    expect(past).toEqual({ ok: false, failure: "timeout", written: false });
    expect(late.connect).not.toHaveBeenCalled();
  });
});

describe("readiness and ids", () => {
  it("polls a bare connect until the daemon accepts one, and stops at the deadline", async () => {
    let n = 0;
    const flaky = vi.fn(() => {
      n += 1;
      return new FakeSocket({ refused: n < 3 });
    });
    const opts = { deadlineAt: soon(), intervalMs: 1 };
    expect(await daemonReady("/s.sock", { ...opts, connect: flaky })).toBe(true);
    expect(flaky).toHaveBeenCalledTimes(3);
    const never = vi.fn(() => new FakeSocket({ refused: true }));
    const brief = { deadlineAt: Date.now() + 30, intervalMs: 1 };
    expect(await daemonReady("/s.sock", { ...brief, connect: never })).toBe(false);
  });

  it("makes the engine CLI's id shape", () => {
    expect(daemonRequestId()).toMatch(/^r\d{1,6}$/u);
    expect(daemonRequestId(() => 1_700_000_000_123)).toBe("r123000");
  });
});
