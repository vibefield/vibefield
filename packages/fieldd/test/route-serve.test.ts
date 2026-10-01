// SP-3 (thinking-sync-planes.md §1.4, §6; design-06 §6) — THE ROUTE-PER-PROCESS
// DRIVER, generalized from TM-2's terminal serve. The cell is its first user
// (terminal-serve.test.ts holds every one of TM-2's rows to it, unchanged);
// these rows pin what the generalization ADDS: a process that publishes the
// WHOLE listener onto one loopback port (rosettad's shape), the change key
// that shape needs, and the one reading a ticket mint asks of the live serve.
import { PORTS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import type { ServeSpec, ServeState } from "../src/mesh-client";
import {
  publishedServe,
  RouteServeDriver,
  routeServeSignature,
  routeServeSpec,
  type ServedProcess,
  type ServedTargets,
} from "../src/route-serve";

const LOGIN = "james@github";
const PROCESS: ServedProcess = { serveId: "probe", listenPort: 9499 };
const LOG = {
  declared: "fieldd.probe_serve.declared",
  deferred: "fieldd.probe_serve.declare_deferred",
  declaredMessage: "declared",
  withdrawnMessage: "withdrawn",
  deferredMessage: "deferred",
};

describe("SP-3 — a served process's serve, from its readings", () => {
  const whole: ServedTargets = { kind: "port", port: 51234 };

  it("publishes the WHOLE listener onto one loopback port: nothing stripped, no path secret", () => {
    expect(
      routeServeSpec(PROCESS, { published: true, linkedLogin: LOGIN, targets: whole }),
    ).toEqual({
      serveId: "probe",
      name: "probe",
      listenPort: 9499,
      target: { kind: "port", port: 51234 },
      tls: false,
      allow: [LOGIN],
    } satisfies ServeSpec);
  });

  it("publishes one stripping route per instance, as TM-2 always did", () => {
    expect(
      routeServeSpec(PROCESS, {
        published: true,
        linkedLogin: "a?b@x",
        targets: { kind: "routes", routes: [{ prefix: "/p/1", targetPort: 51001 }] },
      }),
    ).toEqual({
      serveId: "probe",
      name: "probe",
      listenPort: 9499,
      target: { kind: "routes" },
      tls: false,
      allow: ["a\\?b@x"], // the login is a LITERAL in the sidecar's glob
      routes: [{ prefix: "/p/1", targetPort: 51001 }],
    } satisfies ServeSpec);
  });

  it("refuses at every one of the three gates, for every kind of process", () => {
    const base = { published: true, linkedLogin: LOGIN as string | null, targets: whole };
    // 1. no linked login — an empty allow list is the whole tailnet
    expect(routeServeSpec(PROCESS, { ...base, linkedLogin: null })).toBeNull();
    // 2. the owner's word
    expect(routeServeSpec(PROCESS, { ...base, published: false })).toBeNull();
    // 3. nothing routable
    expect(routeServeSpec(PROCESS, { ...base, targets: null })).toBeNull();
    expect(
      routeServeSpec(PROCESS, { ...base, targets: { kind: "routes", routes: [] } }),
    ).toBeNull();
  });
});

describe("SP-3 — the change key", () => {
  const at = (port: number) =>
    routeServeSignature(
      routeServeSpec(PROCESS, {
        published: true,
        linkedLogin: LOGIN,
        targets: { kind: "port", port },
      }),
    );

  it("moves when a whole-listener serve's port moves — its target IS its route", () => {
    expect(at(51234)).toBe(at(51234));
    expect(at(51234)).not.toBe(at(51235));
    expect(routeServeSignature(null)).toBe("none");
  });

  it("is TM-2's key, character for character, for a routes serve", () => {
    const spec = routeServeSpec(
      { serveId: "terminal", listenPort: PORTS.TERMINAL_CELLS_SERVE },
      {
        published: true,
        linkedLogin: LOGIN,
        targets: { kind: "routes", routes: [{ prefix: "/cell/cb-1", targetPort: 51001 }] },
      },
    );
    expect(routeServeSignature(spec)).toBe(
      JSON.stringify([PORTS.TERMINAL_CELLS_SERVE, [LOGIN], [["/cell/cb-1", 51001]]]),
    );
  });
});

describe("SP-3 — the live reading a ticket mint asks", () => {
  const spec: ServeSpec = {
    serveId: "probe",
    name: "probe",
    listenPort: 9499,
    target: { kind: "port", port: 51234 },
  };
  const state = (over: Partial<ServeState>): ServeState => ({ ...spec, status: "active", ...over });

  it("names a serve only while it is active AND has a URL — what is SERVING, never what was asked", () => {
    const url = "http://desk.ts.net:9499";
    expect(publishedServe([state({ url })], "probe")?.url).toBe(url);
    expect(publishedServe([state({ status: "pending", url })], "probe")).toBeUndefined();
    expect(publishedServe([state({ status: "error", url })], "probe")).toBeUndefined();
    expect(publishedServe([state({})], "probe")).toBeUndefined();
    expect(publishedServe([state({ url })], "other")).toBeUndefined();
    // a legacy record keyed by name alone is still found by its name
    const { serveId: _id, ...legacy } = state({ url });
    expect(publishedServe([legacy], "probe")?.url).toBe(url);
  });
});

describe("SP-3 — the reconcile, for a whole-listener process", () => {
  function driver(initial: number | null) {
    let port = initial;
    const declared: Array<ServeSpec | null> = [];
    let unlanded = false;
    const d = new RouteServeDriver({
      desired: () =>
        routeServeSpec(PROCESS, {
          published: true,
          linkedLogin: LOGIN,
          targets: port === null ? null : { kind: "port", port },
        }),
      declare: async (spec) => {
        declared.push(spec);
        return !unlanded;
      },
      log: LOG,
    });
    return {
      d,
      declared,
      setPort: (p: number | null) => (port = p),
      setUnlanded: (v: boolean) => (unlanded = v),
    };
  }

  it("declares the withdrawal first (F-H1), the serve when the process comes up, and re-aims it when it restarts", async () => {
    const { d, declared, setPort } = driver(null);
    await d.refresh();
    expect(declared).toEqual([null]);
    setPort(51234);
    await d.refresh();
    await d.refresh(); // the same reading twice is not news
    setPort(null); // the process restarts: nothing to aim at
    await d.refresh();
    setPort(51240); // …and comes back on a new port
    await d.refresh();
    expect(
      declared.map((s) => (s === null ? null : s.target.kind === "port" ? s.target.port : "?")),
    ).toEqual([null, 51234, null, 51240]);
  });

  it("does not remember a declaration that resolved without landing (F-M5)", async () => {
    const { d, declared, setUnlanded } = driver(51234);
    setUnlanded(true);
    await d.refresh();
    setUnlanded(false);
    await d.refresh();
    await d.refresh();
    expect(declared).toHaveLength(2);
  });
});
