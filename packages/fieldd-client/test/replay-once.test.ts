// Item 469 (2026-11-16) — a subscribe that WAITED for a reconnect's hello was
// installed twice on the new socket: `subscribe()` keeps its entry before it
// waits, the hello wakes it and starts the replay pass over a snapshot of the
// entries, the woken subscribe sends (and marks itself sent) while the pass
// awaits an earlier replay, and the pass then replays it too. The second
// answer's subId replaced the first, so the unsubscribe released one install
// and the other stood on the daemon until the next disconnect.
import { afterEach, describe, expect, it } from "vitest";
import { FielddClient } from "../src/client";
import { fakeDaemon, settle } from "./fake-daemon";

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

describe("FielddClient — a subscribe waiting for a reconnect is installed once (item 469)", () => {
  it("one sent before the blip and one waiting for the hello: each installed once on the new socket, and none left after both unsubscribe", async () => {
    const { daemon, ctor } = fakeDaemon();
    const client = new FielddClient({
      url: "ws://127.0.0.1:9",
      token: "t",
      webSocket: ctor,
      maxBackoffMs: 1,
    });
    cleanup.push(() => client.close());
    const replayed: unknown[] = [];
    const sent = await client.subscribe("one.subscribe", { n: 1 }, (payload, kind) => {
      if (kind === "snapshot") replayed.push(payload);
    });
    const first = daemon.line();
    expect(first.live.size).toBe(1);

    first.drop();
    expect(client.status).toBe("reconnecting");
    // asked while the socket is down: it waits for the next hello
    const waiting = client.subscribe("two.subscribe", { n: 2 }, () => {});
    const second = await waiting;
    await settle();

    const line = daemon.line();
    expect(line).not.toBe(first);
    // main: 2 (the replay pass sent it again) and 3 installs
    expect(line.subscribes("two.subscribe")).toHaveLength(1);
    expect(line.live.size).toBe(2);
    // the one sent on the EARLIER socket is replayed as before: once, with a fresh snapshot
    expect(line.subscribes("one.subscribe")).toHaveLength(1);
    expect(replayed).toHaveLength(1);

    sent.unsubscribe();
    second.unsubscribe();
    await settle();
    expect(line.live.size).toBe(0); // main: 1 — the install no unsubscribe could reach
  });
});
