// DS-L8 (2026-09-30) — what a peer's DOOR last told this daemon
// (PeerLink.doorState), which the roster turns into `awake` / `restarting` /
// `asleep` / `incompatible` (device-service `deviceState`). A real PeerLink
// against a scripted door: answered, cut, dead, refused, skewed.
import { CONTRACTS_VERSION } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { deviceState, isAnotherContractsMajor } from "../src/device-service";
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

  // S6 (the landing review, 2026-10-01) — DS-L9: another major is not asked,
  // and the roster says so from the version the peer's slice PUBLISHES.
  it("a peer that publishes another contracts major is incompatible whatever else is true", () => {
    const [ours] = CONTRACTS_VERSION.split(".");
    const next = `${Number(ours) + 1}.0.0`;
    expect(isAnotherContractsMajor(next)).toBe(true);
    expect(isAnotherContractsMajor(`${ours}.42.7`)).toBe(false); // a minor is not a major
    expect(isAnotherContractsMajor(CONTRACTS_VERSION)).toBe(false);
    expect(isAnotherContractsMajor(undefined)).toBe(false); // no slice yet: no verdict
    expect(deviceState(false, true, undefined, undefined, next)).toBe("incompatible");
    expect(deviceState(false, false, "silent", undefined, next)).toBe("incompatible");
    expect(deviceState(false, true, "answers", "connected", `${ours}.9.9`)).toBe("awake");
    // self is self, whatever it says
    expect(deviceState(true, true, undefined, undefined, next)).toBe("awake");
  });
});

describe("PeerLink.clearSilent (S6)", () => {
  it("forgets a silent door — no evidence after, not 'answers' — and announces it once", async () => {
    const { link, doors } = linkTo("ws://127.0.0.1:1/", { callTimeoutMs: 300 });
    await expect(link.request("dev-b", "device.list", {})).rejects.toMatchObject({
      details: { state: "unreachable" },
    });
    expect(link.doorState("dev-b")).toBe("silent");
    link.clearSilent("dev-b");
    expect(link.doorState("dev-b")).toBeUndefined();
    expect(doors).toEqual(["silent", undefined]);
    // nothing to forget is nothing to announce
    link.clearSilent("dev-b");
    link.clearSilent("dev-never");
    expect(doors).toEqual(["silent", undefined]);
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

  // DS-2b (2026-10-01) — a standing link's lost socket is recorded as silence
  // WHEN it is lost, and heard again when the client's re-dial is answered:
  // both moves are announced, so the roster neither lags a blip nor sits on
  // `restarting` after the door is back. It was read off `link.state` with no
  // announcement, and no node flip could clear it.
  it("DS-2b: a standing link that loses its socket is silent at once, and heard again when its client re-dials — each move announced", async () => {
    let server: import("ws").WebSocket | undefined;
    const d = await door((msg, ws) => {
      server = ws;
      if (msg.method === "device.subscribe") answer(ws, msg.id, { subId: "s-1", snapshot: {} });
      else answer(ws, msg.id, { devices: [] });
    });
    const { link, doors } = linkTo(d.url);
    let drops = 0;
    await link.subscribe(
      "dev-b",
      "device.subscribe",
      {},
      () => {},
      () => {
        drops += 1;
      },
    );
    expect(link.doorState("dev-b")).toBe("answers");
    server?.terminate(); // the socket goes; the door itself stays up
    await until(() => link.doorState("dev-b") === "silent", 3_000);
    expect(doors).toEqual(["silent"]);
    // the client re-dials on its own and replays the member: heard again
    await until(() => link.doorState("dev-b") === "answers", 5_000);
    expect(doors).toEqual(["silent", "answers"]);
    expect(drops).toBe(0);
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

// D1 (2026-10-01) — the dialler's half of the peer identity is unchanged: its
// hello still ASKS for the peer kind and names its device. Whether it gets it
// is the peer door's call, made from the peer's own sidecar node id and roster
// (product-api's hello; guest-door.test.ts) — never from these two fields.
describe("PeerLink's own hello (D1)", () => {
  it("asks for the peer kind and names this device, and carries no credential", async () => {
    const hellos: unknown[] = [];
    const d = await door((msg, ws) => answer(ws, msg.id, { devices: [] }), {
      hello: (msg, ws) => {
        hellos.push(msg.params);
        answer(ws, msg.id, {
          contractsVersion: CONTRACTS_VERSION,
          serverKind: "fieldd",
          grantedScopes: [],
        });
      },
    });
    const { link } = linkTo(d.url);
    await link.request("dev-b", "device.list", {});
    expect(hellos).toEqual([
      expect.objectContaining({ clientKind: "peer-fieldd", deviceId: "dev-a" }),
    ]);
    expect(hellos[0]).not.toHaveProperty("credential");
  });
});

// The landing review's nit (2026-10-01) — `UnavailableDetails` requires
// `{service, state}`, and PeerLink's own refusals carried no `service`: every
// UNAVAILABLE it raises names it now, whatever the cause.
describe("PeerLink's UNAVAILABLE names its service", () => {
  it("no endpoint, a dead door, a deadline, and a disposed link — each says peer-link", async () => {
    const offline = new PeerLink({ ownDeviceId: () => "dev-a", endpointFor: () => undefined });
    cleanup.push(() => offline.dispose());
    await expect(offline.request("dev-b", "device.list", {})).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "peer-link", device: "dev-b", state: "offline" },
    });

    const d = await door((_msg, ws) => ws.terminate());
    const { link: cut } = linkTo(d.url);
    await expect(cut.request("dev-b", "device.list", {})).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "peer-link", device: "dev-b", state: "unreachable" },
    });

    const { link: dead } = linkTo("ws://127.0.0.1:1/", { callTimeoutMs: 300 });
    await expect(dead.request("dev-b", "device.list", {})).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "peer-link", device: "dev-b", state: "unreachable" },
    });

    const { link: gone } = linkTo("ws://127.0.0.1:1/");
    gone.dispose();
    await expect(gone.request("dev-b", "device.list", {})).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "peer-link", state: "disposed" },
    });
    await expect(
      gone.subscribe(
        "dev-b",
        "device.subscribe",
        {},
        () => {},
        () => {},
      ),
    ).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "peer-link", state: "disposed" },
    });
  });
});
