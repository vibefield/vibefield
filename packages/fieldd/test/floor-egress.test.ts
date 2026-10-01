// DS-1b (2026-10-01, review D4 + D5) — the egress ask, once per FLOOR BOOT,
// failing CLOSED (src/egress.ts: `FloorEgress`, `resolveEgressPath`,
// `egressWebSocket`). The OS network is the road only when the floor cannot
// carry egress at all; every other answer fails the dial with the floor's
// state; and the floor is asked once per boot, not once per dial.
import type { MeshEgressRouteBound } from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import {
  type EgressPath,
  type EgressProxyGrant,
  type EgressProxySource,
  type EgressRouteFacade,
  EgressRoutes,
  egressWebSocket,
  FloorEgress,
  resolveEgressPath,
} from "../src/egress";
import { RpcCallError } from "../src/native-link";
import { startFakeSocks5 } from "./socks5-server";

const GRANT: EgressProxyGrant = {
  address: "127.0.0.1:41641",
  username: "tsnet",
  credential: "node-proxy-credential",
};

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function until(fn: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error("until: timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const unsupported = () =>
  new RpcCallError(
    "UNAVAILABLE",
    "egress is unsupported: this floor's tailnet sidecar predates RFC 026",
    false,
    { service: "mesh", state: "egress-unsupported" },
    -32006,
  );

const meshDown = () =>
  new RpcCallError(
    "UNAVAILABLE",
    "egress needs a mesh node and none is up",
    true,
    { service: "mesh", state: "mesh-down", gatewayState: "starting" },
    -32006,
  );

/** A floor whose egress answers the test scripts, counting every ask. */
function scriptedFloor(
  proxy: () => Promise<EgressProxyGrant>,
  routeAdd: () => Promise<MeshEgressRouteBound> = async () => {
    throw unsupported();
  },
): { floor: EgressProxySource & EgressRouteFacade; asks: { proxy: number; routeAdd: number } } {
  const asks = { proxy: 0, routeAdd: 0 };
  return {
    asks,
    floor: {
      egressProxy: async () => {
        asks.proxy += 1;
        return proxy();
      },
      egressRouteAdd: async () => {
        asks.routeAdd += 1;
        return routeAdd();
      },
      egressRouteRemove: async (id) => ({ id }),
      subscribeEgressRoutes: async () => ({
        snapshot: { routes: [], revision: 0, bootId: "floor-boot-1" },
        dispose: () => {},
      }),
    },
  };
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

describe("DS-1b — the egress ask, once per floor boot (D5)", () => {
  it("asks the floor ONCE across three dials, two of them concurrent", async () => {
    const { floor, asks } = scriptedFloor(async () => GRANT);
    const egress = new FloorEgress({ floor, bootId: () => "floor-boot-1" });
    const paths: EgressPath[] = await Promise.all([
      resolveEgressPath(egress),
      resolveEgressPath(egress),
    ]);
    paths.push(await resolveEgressPath(egress));
    expect(paths.map((path) => path.kind)).toEqual(["proxy", "proxy", "proxy"]);
    expect(paths[2]).toMatchObject({ kind: "proxy", ...GRANT });
    expect(asks.proxy).toBe(1);
  });

  it("asks again when the floor boots again", async () => {
    let boot = "floor-boot-1";
    const { floor, asks } = scriptedFloor(async () => GRANT);
    const egress = new FloorEgress({ floor, bootId: () => boot });
    await resolveEgressPath(egress);
    await resolveEgressPath(egress);
    boot = "floor-boot-2"; // the health stream re-snapshotted a respawned floor
    await resolveEgressPath(egress);
    await resolveEgressPath(egress);
    expect(asks.proxy).toBe(2);
  });

  it("keeps nothing while the floor's boot is unknown, or for a boot that ended mid-ask", async () => {
    const unknown = scriptedFloor(async () => GRANT);
    const blind = new FloorEgress({ floor: unknown.floor, bootId: () => undefined });
    await resolveEgressPath(blind);
    await resolveEgressPath(blind);
    expect(unknown.asks.proxy, "no boot, no cache: every dial asks").toBe(2);

    let boot = "floor-boot-1";
    let answer: (grant: EgressProxyGrant) => void = () => {};
    const slow = scriptedFloor(
      () =>
        new Promise<EgressProxyGrant>((resolve) => {
          answer = resolve;
        }),
    );
    const egress = new FloorEgress({ floor: slow.floor, bootId: () => boot });
    const first = resolveEgressPath(egress);
    await until(() => slow.asks.proxy === 1);
    boot = "floor-boot-2"; // the floor restarted while the ask was out
    answer(GRANT);
    expect((await first).kind).toBe("proxy");
    const second = resolveEgressPath(egress);
    await until(() => slow.asks.proxy === 2);
    answer(GRANT);
    await second;
    expect(slow.asks.proxy, "the old boot's answer was not kept for the new one").toBe(2);
  });
});

describe("DS-1b — fail closed: the OS network only for a floor that cannot carry egress (D4)", () => {
  it("a TIMEOUT fails the dial (unavailable, never direct) and is asked again on the next dial", async () => {
    const { floor, asks } = scriptedFloor(async () => {
      throw new RpcCallError("TIMEOUT", "native.mesh.egress.proxy timed out after 2000ms", true);
    });
    const egress = new FloorEgress({ floor, bootId: () => "floor-boot-1" });
    expect(await resolveEgressPath(egress)).toEqual({
      kind: "unavailable",
      state: "native-timeout",
      detail: "native.mesh.egress.proxy timed out after 2000ms",
    });
    await resolveEgressPath(egress);
    expect(asks.proxy, "a moment is never cached").toBe(2);
  });

  it("mesh-down, a reconnecting mgmt link and an off-contract answer fail the dial too", async () => {
    for (const [error, state] of [
      [meshDown(), "mesh-down"],
      [new RpcCallError("UNAVAILABLE", "native link is reconnecting", true), "native-unavailable"],
      [
        new RpcCallError("INTERNAL", "the answer does not match MeshEgressProxy", false),
        "egress-error",
      ],
      [new Error("socket hang up"), "egress-error"],
    ] as const) {
      const path = await resolveEgressPath({
        egressProxy: async () => {
          throw error;
        },
      });
      expect(path, state).toMatchObject({ kind: "unavailable", state });
    }
  });

  it("egress-unsupported is the OS network for the whole boot: asked once, said once", async () => {
    const log = capture();
    const { floor, asks } = scriptedFloor(async () => {
      throw unsupported();
    });
    const egress = new FloorEgress({
      floor,
      bootId: () => "floor-boot-1",
      logger: log.logger,
    });
    for (let dial = 0; dial < 3; dial += 1) {
      expect(await resolveEgressPath(egress)).toEqual({
        kind: "direct",
        state: "egress-unsupported",
      });
    }
    expect(asks.proxy).toBe(1);
    expect(log.events("fieldd.mesh.egress.fallback_os_network")).toEqual([
      { floorBootId: "floor-boot-1", state: "egress-unsupported" },
    ]);
    // a floor older than DS-1 (its mesh answers `method not found`) is the same fact
    const older = scriptedFloor(async () => {
      throw new RpcCallError("NOT_FOUND", "method not found", false, undefined, -32601);
    });
    const old = new FloorEgress({ floor: older.floor, bootId: () => "floor-boot-1" });
    expect(await resolveEgressPath(old)).toEqual({
      kind: "direct",
      state: "egress-unsupported",
      detail: "the floor predates DS-1",
    });
    await resolveEgressPath(old);
    expect(older.asks.proxy).toBe(1);
  });

  it("a grant the proxy refused is forgotten once; an older grant's late refusal keeps the newer", async () => {
    let credential = "first";
    const { floor, asks } = scriptedFloor(async () => ({ ...GRANT, credential }));
    const egress = new FloorEgress({ floor, bootId: () => "floor-boot-1" });
    const first = await resolveEgressPath(egress);
    if (first.kind !== "proxy") throw new Error(`expected a proxy path, got ${first.kind}`);
    first.refused?.();
    first.refused?.(); // two dials found the same grant stale
    credential = "second"; // the node was rebuilt within the boot
    expect(await resolveEgressPath(egress)).toMatchObject({ kind: "proxy", credential: "second" });
    expect(asks.proxy).toBe(2);
    first.refused?.(); // the old grant's failure, arriving late
    await resolveEgressPath(egress);
    expect(asks.proxy, "the newer grant stands").toBe(2);
  });

  it("routes read the same cache: a boot known unsupported binds nothing and asks nothing", async () => {
    const { floor, asks } = scriptedFloor(async () => GRANT);
    const egress = new FloorEgress({ floor, bootId: () => "floor-boot-1" });
    const routes = new EgressRoutes({
      facade: egress,
      roster: { hostFor: () => "desk-b.tail1234.ts.net", onChange: () => () => {} },
    });
    cleanup.push(() => routes.dispose());
    expect(await routes.ensureRoute("dev-b", 9422)).toBeUndefined();
    expect(await routes.ensureRoute("dev-b", 9422)).toBeUndefined();
    expect(asks.routeAdd, "the second ensure was answered by the boot's fact").toBe(1);
    // ... and the dial learned it from the route's answer: the floor is not asked
    expect(await resolveEgressPath(egress)).toEqual({
      kind: "direct",
      state: "egress-unsupported",
    });
    expect(asks.proxy).toBe(0);
  });
});

describe("DS-1b — a dial with no road fails closed (egressWebSocket)", () => {
  it("fails UNAVAILABLE {service: mesh, state}, retryable, and never builds the OS-network socket", async () => {
    let directBuilt = 0;
    class Direct {
      readyState = 0;
      constructor() {
        directBuilt += 1;
      }
      send(): void {}
      close(): void {}
      addEventListener(): void {}
    }
    const Ctor = egressWebSocket({
      path: async () => ({ kind: "unavailable", state: "native-timeout", detail: "late" }),
      direct: Direct as never,
    });
    const socket = new Ctor("ws://device-b.tail1234.ts.net:9423/");
    const errors: unknown[] = [];
    let closed = false;
    socket.addEventListener("error", (ev) => errors.push((ev as { error?: unknown }).error));
    socket.addEventListener("close", () => {
      closed = true;
    });
    await until(() => closed);
    expect(directBuilt, "the OS network was never dialled").toBe(0);
    expect(errors[0]).toBeInstanceOf(RpcCallError);
    expect(errors[0]).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: "mesh", state: "native-timeout", detail: "late" },
    });
  });

  it("forgets a grant its proxy refused, and keeps one whose PEER was refused", async () => {
    const proxy = await startFakeSocks5({
      username: "tsnet",
      password: "the-right-one",
      route: () => undefined, // every CONNECT is refused: the peer, not the grant
    });
    cleanup.push(() => proxy.close());
    let refused = 0;
    const dial = async (credential: string): Promise<void> => {
      const Ctor = egressWebSocket({
        path: async () => ({
          kind: "proxy",
          address: proxy.address,
          username: "tsnet",
          credential,
          refused: () => {
            refused += 1;
          },
        }),
      });
      const socket = new Ctor("ws://device-b.tail1234.ts.net:9423/");
      let closed = false;
      socket.addEventListener("close", () => {
        closed = true;
      });
      await until(() => closed);
    };
    await dial("a-stale-one");
    expect(proxy.refusedAuth()).toBe(1);
    expect(refused, "the proxy refused the credential: the grant is stale").toBe(1);
    await dial("the-right-one");
    expect(proxy.requests).toHaveLength(1);
    expect(refused, "the proxy took the grant and refused the peer").toBe(1);
  });
});
