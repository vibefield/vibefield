// DS-1 — the egress facade's contract (mgmt.ts). The fixtures pin the shapes
// on both sides (fixtures.test.ts here, field-native's fixture_parity.rs
// there); these rows pin the REFUSALS, which a golden cannot show, and the
// registry facts the floor's belt and fieldd's suspenders both read.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ErrorData } from "../src/errors";
import { METHODS } from "../src/methods";
import {
  MESH_EGRESS,
  MeshEgressLoopbackAddress,
  MeshEgressProxy,
  MeshEgressRouteAddParams,
  MeshEgressRouteBound,
  MeshEgressRouteId,
  MeshEgressRouteTable,
  MeshEgressTarget,
  MeshEgressUnavailableDetails,
} from "../src/mgmt";
import { PORTS } from "../src/registries";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;

describe("DS-1 — an egress listener is a LITERAL loopback address", () => {
  it("admits 127.0.0.1 and [::1] with a real port", () => {
    for (const ok of ["127.0.0.1:1", "127.0.0.1:41641", "127.0.0.1:65535", "[::1]:53212"]) {
      expect(MeshEgressLoopbackAddress.safeParse(ok).success, ok).toBe(true);
    }
  });

  it("refuses a name, another interface, a missing or impossible port", () => {
    // A name is resolved, and a resolver can be pointed elsewhere: the floor
    // hands fieldd a credential with this address, so only a literal will do.
    for (const bad of [
      "localhost:41641",
      "0.0.0.0:41641",
      "10.0.0.7:41641",
      "127.0.0.2:41641",
      "100.64.0.1:41641",
      "127.0.0.1",
      "127.0.0.1:0",
      "127.0.0.1:65536",
      "127.0.0.1:041641",
      "::1:41641",
      "socks5://127.0.0.1:41641",
    ]) {
      expect(MeshEgressLoopbackAddress.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("DS-1 — a route's target is <peer-fqdn-or-ip>:<port>, nothing else", () => {
  it("admits a MagicDNS name, a dotted IPv4 and a bracketed IPv6", () => {
    for (const ok of [
      "truffle-vibefield-studio.tail1234.ts.net:9422",
      "studio:9422",
      "100.101.102.103:9422",
      "[fd7a:115c:a1e0::3]:9422",
    ]) {
      expect(MeshEgressTarget.safeParse(ok).success, ok).toBe(true);
    }
  });

  it("refuses a URL, a path, a bare host and an impossible port", () => {
    for (const bad of [
      "ws://studio.tail1234.ts.net:9422",
      "studio.tail1234.ts.net:9422/cell/x/control",
      "studio.tail1234.ts.net",
      "studio.tail1234.ts.net:0",
      "studio.tail1234.ts.net:65536",
      "-studio.ts.net:9422",
      "studio..ts.net:9422",
      "stu dio.ts.net:9422",
      "user@studio.ts.net:9422",
      "fd7a:115c:a1e0::3:9422",
      "",
    ]) {
      expect(MeshEgressTarget.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("bounds the target's length at a DNS name plus a port", () => {
    const label = "a".repeat(63);
    const long = `${[label, label, label, label].join(".")}:9422`;
    expect(long.length).toBeGreaterThan(259);
    expect(MeshEgressTarget.safeParse(long).success).toBe(false);
  });
});

describe("DS-1 — a route's id is the caller's key, in a charset the sidecar can carry", () => {
  it("admits the id fieldd mints and refuses anything that could be read as structure", () => {
    expect(MeshEgressRouteId.safeParse("egress-01ARZ3NDEKTSV4RRFFQ69G5FAV-9422").success).toBe(
      true,
    );
    for (const bad of ["", "-lead", "a/b", "a b", "a:b", "é", "a".repeat(129)]) {
      expect(MeshEgressRouteId.safeParse(bad).success, bad).toBe(false);
    }
    expect(MeshEgressRouteId.safeParse("a".repeat(128)).success).toBe(true);
  });

  it("keeps login optional but never empty", () => {
    const base = { id: "r1", target: "studio.ts.net:9422" };
    expect(MeshEgressRouteAddParams.safeParse(base).success).toBe(true);
    expect(MeshEgressRouteAddParams.safeParse({ ...base, login: "" }).success).toBe(false);
  });
});

describe("DS-1 — the table and a binding are ordered by the facade's revision", () => {
  it("requires the revision and the floor boot on both, the revision a non-negative integer", () => {
    // The table stream runs beside the handler: a table read just before an
    // add can reach the reader after that add's answer. Without the revision a
    // reader would take that stale table for "the route is gone".
    const bound = { id: "r1", listen: "127.0.0.1:53211", bootId: "boot-1" };
    expect(MeshEgressRouteBound.safeParse(bound).success).toBe(false);
    expect(MeshEgressRouteBound.safeParse({ ...bound, revision: 3 }).success).toBe(true);
    // a revision orders only within ONE floor boot, so the boot rides with it
    expect(
      MeshEgressRouteBound.safeParse({ id: "r1", listen: "127.0.0.1:53211", revision: 3 }).success,
    ).toBe(false);
    for (const revision of [-1, 1.5, "3"]) {
      expect(MeshEgressRouteBound.safeParse({ ...bound, revision }).success, String(revision)).toBe(
        false,
      );
    }
    expect(MeshEgressRouteTable.safeParse({ routes: [] }).success).toBe(false);
    expect(MeshEgressRouteTable.safeParse({ routes: [], revision: 0 }).success).toBe(false);
    expect(
      MeshEgressRouteTable.safeParse({ routes: [], revision: 0, bootId: "boot-1" }).success,
    ).toBe(true);
    const reset = MeshEgressRouteTable.parse(fixture("mesh-egress-route-table.reset.json"));
    const bound3 = MeshEgressRouteBound.parse(fixture("mesh-egress-route-bound.valid.json"));
    expect(reset.routes).toEqual([]);
    expect(reset.revision).toBeGreaterThan(bound3.revision);
  });
});

describe("DS-1 — the two degraded answers are goldens the floor writes", () => {
  it("egress-unsupported is a capability fact and says so by not being retryable", () => {
    const data = ErrorData.parse(fixture("error-data.egress-unsupported.json"));
    expect(data.kind).toBe("UNAVAILABLE");
    expect(data.retryable).toBe(false);
    const details = MeshEgressUnavailableDetails.parse(data.details);
    expect(details).toEqual({ service: MESH_EGRESS.SERVICE, state: MESH_EGRESS.STATE_UNSUPPORTED });
  });

  it("mesh-down is a transient and carries the gateway's own word", () => {
    const data = ErrorData.parse(fixture("error-data.egress-mesh-down.json"));
    expect(data.retryable).toBe(true);
    const details = MeshEgressUnavailableDetails.parse(data.details);
    expect(details.state).toBe(MESH_EGRESS.STATE_MESH_DOWN);
    expect(details.gatewayState).toBe("disabled");
  });

  it("does not read another service's UNAVAILABLE as an egress answer", () => {
    // The node gate's own refusal (`service: "mesh-gateway"`) is what a floor
    // predating DS-1 answers for these verbs while no node is up. It is NOT
    // the egress facade speaking, so it must not parse as if it were.
    expect(
      MeshEgressUnavailableDetails.safeParse({ service: "mesh-gateway", state: "disabled" })
        .success,
    ).toBe(false);
    expect(
      MeshEgressUnavailableDetails.safeParse({ service: "mesh", state: "rebuilding" }).success,
    ).toBe(false);
  });
});

describe("DS-1 — the registry", () => {
  it("routes only doors that demand their own grant (DS-L6)", () => {
    // A cell verifies a MAC on its first frame. The product door trusts the
    // node's login, so an unauthenticated loopback route to it would hand any
    // same-uid process (EL7's adversary) the peer's whole door.
    expect(MESH_EGRESS.ROUTABLE_PORTS).toEqual([PORTS.TERMINAL_CELLS_SERVE]);
    expect(MESH_EGRESS.ROUTABLE_PORTS).not.toContain(PORTS.FIELDD_PRODUCT_SERVE);
    expect(MESH_EGRESS.SOCKS_USERNAME).toBe("tsnet");
  });

  it("declares the six facade verbs as local mgmt methods", () => {
    const egress = METHODS.filter((m) => m.method.startsWith("native.mesh.egress."));
    expect(egress.map((m) => m.method).sort()).toEqual([
      "native.mesh.egress.httpProxy",
      "native.mesh.egress.proxy",
      "native.mesh.egress.route.add",
      "native.mesh.egress.route.list",
      "native.mesh.egress.route.remove",
      "native.mesh.egress.route.subscribe",
    ]);
    for (const m of egress) {
      expect(m.surface, m.method).toBe("mgmt");
      expect(m.locality, m.method).toBe("local");
      expect(m.scope, m.method).toBeNull();
      expect(m.subscription ?? false, m.method).toBe(m.method.endsWith(".subscribe"));
    }
  });

  it("keeps a proxy answer's unknown fields (tolerant reader)", () => {
    const parsed = MeshEgressProxy.parse({
      address: "127.0.0.1:41641",
      credential: "c",
      localApiCredential: "later",
    }) as Record<string, unknown>;
    expect(parsed["localApiCredential"]).toBe("later");
  });
});
