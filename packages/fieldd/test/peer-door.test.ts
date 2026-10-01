// DS-L8 (2026-09-30) — what a peer's DOOR last told this daemon
// (PeerLink.doorState), which the roster turns into `awake` / `restarting` /
// `asleep` / `incompatible` (device-service `deviceState`). A real PeerLink
// against a scripted door: answered, cut, dead, refused, skewed.
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { deviceState } from "../src/device-service";
import { PeerLink } from "../src/peer-link";
import { answer, refuse, scriptedDoor } from "./scripted-door";
import { until } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

function linkTo(url: string, opts: { idleCloseMs?: number; callTimeoutMs?: number } = {}) {
  const link = new PeerLink({
    ownDeviceId: () => "dev-a",
    endpointFor: () => url,
    webSocket: WebSocket,
    callTimeoutMs: opts.callTimeoutMs ?? 2_000,
    ...(opts.idleCloseMs !== undefined ? { idleCloseMs: opts.idleCloseMs } : {}),
  });
  const doors: string[] = [];
  link.on("door-changed", (ev: { door: string }) => doors.push(ev.door));
  cleanup.push(() => link.dispose());
  return { link, doors };
}

async function door(...args: Parameters<typeof scriptedDoor>) {
  const opened = await scriptedDoor(...args);
  cleanup.push(() => opened.close());
  return opened;
}

describe("the roster's state (deviceState)", () => {
  it("self is awake; a skewed peer is incompatible; off the tailnet is asleep; a silent door on a live node is restarting", () => {
    expect(deviceState(true, true, "silent", undefined)).toBe("awake");
    expect(deviceState(false, true, undefined, "incompatible")).toBe("incompatible");
    expect(deviceState(false, false, "incompatible", undefined)).toBe("incompatible");
    expect(deviceState(false, false, "silent", undefined)).toBe("asleep");
    expect(deviceState(false, false, undefined, undefined)).toBe("asleep");
    expect(deviceState(false, true, "silent", undefined)).toBe("restarting");
    expect(deviceState(false, true, "answers", "connected")).toBe("awake");
    // never dialled is not silent
    expect(deviceState(false, true, undefined, undefined)).toBe("awake");
  });
});

describe("PeerLink.doorState", () => {
  it("no evidence before a dial; answers while the link is ready; no evidence again once an idle link is swept", async () => {
    const d = await door((msg, ws) => answer(ws, msg.id, { devices: [] }));
    const { link } = linkTo(d.url, { idleCloseMs: 60 });
    expect(link.doorState("dev-b")).toBeUndefined();
    await link.request("dev-b", "device.list", {});
    expect(link.doorState("dev-b")).toBe("answers");
    await until(() => link.linkState("dev-b") === undefined, 3_000);
    expect(link.doorState("dev-b")).toBeUndefined(); // it answered; quiet is not silent
  });

  it("a request in flight is use: an answer slower than the idle window is not cut by the sweep", async () => {
    // the sweep runs every idle window and used to drop a link whose ask had
    // outlasted it — a loaded host's dial, or a slow owner — and report the
    // cut as the peer's silence
    const d = await door((msg, ws) => {
      setTimeout(() => answer(ws, msg.id, { devices: [] }), 400);
    });
    const { link } = linkTo(d.url, { idleCloseMs: 60 });
    await expect(link.request("dev-b", "device.list", {})).resolves.toEqual({ devices: [] });
    expect(link.doorState("dev-b")).toBe("answers");
    // and once it is over, quiet is idle again
    await until(() => link.linkState("dev-b") === undefined, 3_000);
  });

  it("a forward the door cut leaves it silent; the next answer clears it, and each move is announced", async () => {
    const d = await door((msg, ws, n) => {
      if (n === 1) ws.terminate();
      else answer(ws, msg.id, { devices: [] });
    });
    const { link, doors } = linkTo(d.url);
    await expect(link.request("dev-b", "device.list", {})).rejects.toMatchObject({
      details: { state: "unreachable" },
    });
    expect(link.doorState("dev-b")).toBe("silent");
    await link.request("dev-b", "device.list", {});
    expect(link.doorState("dev-b")).toBe("answers");
    expect(doors).toEqual(["silent", "answers"]);
  });

  it("a door that never answers the dial is silent once the deadline passes", async () => {
    const { link } = linkTo("ws://127.0.0.1:1/", { callTimeoutMs: 300 });
    await expect(link.request("dev-b", "device.list", {})).rejects.toMatchObject({
      details: { state: "unreachable" },
    });
    expect(link.doorState("dev-b")).toBe("silent");
  });

  it("the owner's own refusal is an answer", async () => {
    const d = await door((msg, ws) =>
      refuse(ws, msg.id, { code: -32003, message: "no such run", kind: "NOT_FOUND" }),
    );
    const { link } = linkTo(d.url);
    await expect(link.request("dev-b", "agent.interrupt", {})).rejects.toMatchObject({
      kind: "NOT_FOUND",
    });
    expect(link.doorState("dev-b")).toBe("answers");
  });

  it("a door that refuses our contracts major is incompatible", async () => {
    const d = await door((msg, ws) => answer(ws, msg.id, {}), {
      hello: (msg, ws) =>
        refuse(ws, msg.id, {
          code: -32009,
          message: "contracts major mismatch",
          kind: "INCOMPATIBLE",
        }),
    });
    const { link } = linkTo(d.url);
    await expect(link.request("dev-b", "device.list", {})).rejects.toMatchObject({
      kind: "INCOMPATIBLE",
    });
    expect(link.doorState("dev-b")).toBe("incompatible");
    expect(d.seen).toHaveLength(0); // never asked
  });
});
