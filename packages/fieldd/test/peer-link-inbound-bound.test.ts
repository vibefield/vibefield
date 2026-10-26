// Item 60 (2026-10-26) — a reader of another desktop's door takes no more than
// a door takes from a client: PRODUCT_API_LIMITS.WS_MAX_INBOUND_BYTES (4 MiB),
// on EVERY dial PeerLink makes — through the node's SOCKS5, over the OS network
// when the floor cannot carry egress, and with no egress at all. Before it, the
// proxy path's `ws` took 100 MiB (its default `maxPayload`) and the other two
// rode the host's global WebSocket, which bounds nothing; the answer was then
// parsed, and zod 3 builds an issue per bad element (~650 MB for 4 MiB).
//
// Each row puts a door behind one dial that answers `big.read` with a frame
// past the bound: the dial's own `ws` refuses it at its header and closes 1009
// before the rest is buffered, the call hears the link's honest state in the
// registry's words (UNAVAILABLE {service: peer-link, state: frame_refused}, the
// bound said), the structured log names it once per refusal
// (`fieldd.mesh.peer.frame_refused {peer, cap}`), the door is NOT marked
// silent (it answered), and the next call on the same link is served.
import { PRODUCT_API_LIMITS } from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { type EgressProxySource, resolveEgressPath } from "../src/egress";
import { RpcCallError } from "../src/native-link";
import { PeerLink } from "../src/peer-link";
import { startFakeSocks5 } from "./socks5-server";

const CAP = PRODUCT_API_LIMITS.WS_MAX_INBOUND_BYTES;
const DOOR_HOST = "device-b.tail1234.ts.net";
const CREDENTIAL = { username: "tsnet", password: "node-proxy-credential" };

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

/** A peer's door: the hello, `small.read`, and `big.read` answered with a frame
 * of exactly `bigBytes` bytes. Records the close codes its sockets heard. */
async function door(bigBytes: number): Promise<{ port: number; closes: number[] }> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  const closes: number[] = [];
  wss.on("connection", (ws) => {
    ws.on("close", (code) => closes.push(code));
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as { id: number; method: string };
      if (msg.method === "system.hello") {
        const result = { contractsVersion: "0.1.0", serverKind: "fieldd", grantedScopes: [] };
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
      } else if (msg.method === "big.read") {
        const head = `{"jsonrpc":"2.0","id":${msg.id},"result":{"rows":"`;
        const tail = `"}}`;
        ws.send(`${head}${"r".repeat(bigBytes - head.length - tail.length)}${tail}`);
      } else {
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { small: true } }));
      }
    });
  });
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  );
  return { port: (wss.address() as { port: number }).port, closes };
}

function capture(): { logger: Logger; events: (name: string) => Array<LogFields | undefined> } {
  const records: Array<{ event: string; attrs: LogFields | undefined }> = [];
  const make = (): Logger => ({
    child: () => make(),
    trace: (event, _m, attrs) => void records.push({ event, attrs }),
    debug: (event, _m, attrs) => void records.push({ event, attrs }),
    info: (event, _m, attrs) => void records.push({ event, attrs }),
    warn: (event, _m, attrs) => void records.push({ event, attrs }),
    error: (event, _m, _e, attrs) => void records.push({ event, attrs }),
    fatal: (event, _m, _e, attrs) => void records.push({ event, attrs }),
    isLevelEnabled: () => true,
  });
  return {
    logger: make(),
    events: (name) => records.filter((r) => r.event === name).map((r) => r.attrs),
  };
}

type Dial =
  | "through the node's SOCKS5"
  | "over the OS network (no egress on the floor)"
  | "with no egress at all";

async function linkOver(dial: Dial, doorPort: number, logger: Logger): Promise<PeerLink> {
  let source: EgressProxySource | undefined;
  let endpoint = `http://127.0.0.1:${doorPort}`;
  if (dial === "through the node's SOCKS5") {
    const proxy = await startFakeSocks5({
      ...CREDENTIAL,
      route: (host, port) =>
        host === DOOR_HOST && port === 9423 ? { host: "127.0.0.1", port: doorPort } : undefined,
    });
    cleanup.push(() => proxy.close());
    endpoint = `http://${DOOR_HOST}:9423`;
    source = {
      egressProxy: async () => ({
        address: proxy.address,
        username: CREDENTIAL.username,
        credential: CREDENTIAL.password,
      }),
    };
  } else if (dial === "over the OS network (no egress on the floor)") {
    source = {
      egressProxy: async () => {
        throw new RpcCallError("UNAVAILABLE", "egress is unsupported", false, {
          service: "mesh",
          state: "egress-unsupported",
        });
      },
    };
  }
  const peers = new PeerLink({
    ownDeviceId: () => "dev-a",
    endpointFor: (id) => (id === "dev-b" ? endpoint : undefined),
    ...(source !== undefined ? { egress: () => resolveEgressPath(source) } : {}),
    logger,
    callTimeoutMs: 15_000,
  });
  cleanup.push(() => peers.dispose());
  return peers;
}

describe("item 60 — PeerLink takes no frame past the door's inbound bound, on every dial", () => {
  for (const dial of [
    "through the node's SOCKS5",
    "over the OS network (no egress on the floor)",
    "with no egress at all",
  ] as const) {
    it(`${dial}: a frame one byte past ${CAP} is refused at its header, said, and the link serves the next call`, async () => {
      const d = await door(CAP + 1);
      const log = capture();
      const peers = await linkOver(dial, d.port, log.logger);
      const doors: Array<{ deviceId: string; door?: string }> = [];
      peers.on("door-changed", (e: { deviceId: string; door?: string }) => doors.push(e));

      expect(await peers.request("dev-b", "small.read", {})).toEqual({ small: true });
      const refused = await peers.request("dev-b", "big.read", {}).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(refused).toBeInstanceOf(RpcCallError);
      const error = refused as RpcCallError;
      expect(error.kind).toBe("UNAVAILABLE");
      expect(error.retryable).toBe(false);
      expect(error.details).toEqual({
        service: "peer-link",
        device: "dev-b",
        state: "frame_refused",
        maxInboundBytes: CAP,
      });
      expect(error.message).toContain(`${CAP} bytes`);
      // the dial's `ws` refused it at the header, before the rest was buffered:
      // the refusal's record says so (the transport's refusal carries no count)
      expect(log.events("fieldd.mesh.peer.frame_refused")).toEqual([
        { peer: "dev-b", cap: CAP, refusedAt: "header" },
      ]);
      if (dial === "through the node's SOCKS5") {
        // the fake SOCKS5 relay destroys its upstream when the client's socket
        // closes (socks5-server.ts), which can beat the client's close frame
        // across: the door then reads 1006. The real proxy is not this relay;
        // what this dial proves is the header refusal above and the close
        await expect.poll(() => d.closes.length).toBeGreaterThan(0);
      } else {
        await expect.poll(() => d.closes).toContain(1009);
      }
      // the door answered — too large to read — so it is never called silent
      expect(doors.filter((e) => e.door === "silent")).toEqual([]);
      // the link re-dials by itself and serves the next call
      expect(await peers.request("dev-b", "small.read", {})).toEqual({ small: true });
    }, 30_000);
  }

  it("a frame AT the bound is read whole", async () => {
    const d = await door(CAP);
    const log = capture();
    const peers = await linkOver("with no egress at all", d.port, log.logger);
    const answer = (await peers.request("dev-b", "big.read", {})) as { rows: string };
    expect(answer.rows.length).toBeGreaterThan(CAP - 64);
    expect(log.events("fieldd.mesh.peer.frame_refused")).toEqual([]);
    expect(d.closes).toEqual([]);
  }, 30_000);
});
