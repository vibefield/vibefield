// S3 (the DS landing review, 2026-10-01) — a peer restart must not drop the
// whole shared link. A REAL PeerLink dials a real ProductApi through its
// tailnet door (the path secret, the sidecar's WhoIs login header, a linked
// login: the peer-fieldd principal and its preset), two standing members ride
// the one link, and the door "restarts": every socket is severed and, for a
// while, the history catalog is not ready. Before the fix the client replayed
// both subscriptions inside hello's try — refused PRECONDITION_FAILED (the
// door's old answer) it failed the client and PeerLink dropped the link, so
// BOTH owners heard onDrop; refused UNAVAILABLE it closed the socket and
// replayed everything again, forever, while the owner heard nothing.
import type { WsCtor } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { PeerLink, ProductApi, TokenService } from "../src/index";
import { RpcCallError } from "../src/native-link";
import { peerRoster } from "./peer-roster";
import { until } from "./ws-rpc";

const LOGIN = "me@jamesyong42.com";
const SECRET = "s3-route-secret";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

/** The sidecar's half of a dial: the WhoIs login a caller cannot forge, and
 * (D1, 2026-10-01) the dialling node's id, which the door's roster must
 * correlate to a desktop before it mints the peer kind. */
function sidecar(): { ctor: WsCtor; dials: () => number } {
  let count = 0;
  class SidecarSim extends WebSocket {
    constructor(url: string) {
      count += 1;
      super(url, { headers: { "Tailscale-User-Login": LOGIN, "Tailscale-Node-Id": "node-a" } });
    }
  }
  return { ctor: SidecarSim, dials: () => count };
}

/** A peer's door: `device.subscribe` always serves; `index.catalog.subscribe`
 * serves while `ready`, else refuses with `refusal()` — what a desktop that
 * just restarted answers until its catalog has read the index. */
async function peerDoor(refusal: () => RpcCallError) {
  const api = new ProductApi({
    port: 0,
    tokens: new TokenService(),
    tailnetPathSecret: SECRET,
    getLinkedLogin: () => LOGIN,
    ...peerRoster({ "node-a": { deviceId: "dev-a", docHost: true } }),
  });
  const state = { ready: true, catalogAsks: [] as unknown[] };
  api.registerSubscription("device.subscribe", () => ({
    snapshot: [{ deviceId: "dev-b" }],
    dispose: () => {},
  }));
  api.registerSubscription("index.catalog.subscribe", (_ctx, params) => {
    state.catalogAsks.push(params);
    if (!state.ready) throw refusal();
    return {
      snapshot: { snapshot: { epoch: "e-b", revision: 5, rows: [] } },
      dispose: () => {},
    };
  });
  const port = await api.listen();
  cleanup.push(() => api.close());
  return { api, state, endpoint: `ws://127.0.0.1:${port}/t/${SECRET}` };
}

const refusals: Array<[string, () => RpcCallError]> = [
  [
    "UNAVAILABLE {service, state} — the door's honest answer, restored",
    () =>
      new RpcCallError("UNAVAILABLE", "the history catalog has not read the index yet", true, {
        service: "index",
        state: "waiting",
      }),
  ],
  [
    "PRECONDITION_FAILED — the door's old answer, terminal at a hello",
    () =>
      new RpcCallError(
        "PRECONDITION_FAILED",
        "the history catalog has not read the index yet",
        true,
        {
          service: "index",
          state: "waiting",
        },
      ),
  ],
];

describe("PeerLink — a refused replay drops ONE member, never the link (S3)", () => {
  it.each(refusals)(
    "refused %s",
    async (_name, refusal) => {
      const { api, state, endpoint } = await peerDoor(refusal);
      const { ctor, dials } = sidecar();
      const link = new PeerLink({
        ownDeviceId: () => "dev-a",
        endpointFor: () => endpoint,
        webSocket: ctor,
      });
      cleanup.push(() => link.dispose());

      const drops = { device: 0, catalog: 0 };
      const deviceKinds: string[] = [];
      let catalogFrames = 0;
      await link.subscribe(
        "dev-b",
        "device.subscribe",
        {},
        (_payload, kind) => deviceKinds.push(kind),
        () => {
          drops.device += 1;
        },
      );
      let cursor = { epoch: "e-b", revision: 5 };
      await link.subscribe(
        "dev-b",
        "index.catalog.subscribe",
        { table: "sessions", since: cursor },
        () => {
          catalogFrames += 1;
        },
        () => {
          drops.catalog += 1;
        },
        { params: () => ({ table: "sessions", since: cursor }) },
      );
      expect(dials()).toBe(1);

      // the peer restarts: its sockets go, and its catalog is not ready yet
      cursor = { epoch: "e-b", revision: 8 }; // the owner moved on meanwhile
      state.ready = false;
      api.dropConnections();
      await until(() => drops.catalog === 1 && deviceKinds.includes("snapshot"), 8000);

      // ONE member heard it; the other replayed over the same, standing link
      expect(drops.device).toBe(0);
      expect(catalogFrames).toBe(0);
      expect(link.linkState("dev-b")).toBe("connected");
      expect(link.doorState("dev-b")).toBe("answers");
      // the refused replay asked from where its owner WAS, not where it began
      expect(state.catalogAsks.at(-1)).toEqual({
        table: "sessions",
        since: { epoch: "e-b", revision: 8 },
      });

      // the owner re-attaches on its own: while the door still refuses, the
      // refusal is the peer's answer — passed through, the link untouched
      await expect(
        link.subscribe(
          "dev-b",
          "index.catalog.subscribe",
          { table: "sessions" },
          () => {},
          () => {},
        ),
      ).rejects.toMatchObject({ retryable: true, details: { service: "index", state: "waiting" } });
      expect(link.linkState("dev-b")).toBe("connected");

      state.ready = true;
      const again = await link.subscribe(
        "dev-b",
        "index.catalog.subscribe",
        { table: "sessions", since: cursor },
        () => {},
        () => {},
      );
      expect(again.snapshot).toEqual({ snapshot: { epoch: "e-b", revision: 5, rows: [] } });
      expect(drops).toEqual({ device: 0, catalog: 1 });
      expect(dials()).toBe(2); // the restart's one re-dial; no refusal cost a socket
    },
    20_000,
  );
});
