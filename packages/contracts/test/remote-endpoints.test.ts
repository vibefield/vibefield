// SP-3 (thinking-sync-planes.md §1.4, §5.4, §6; design-06 §6) — THE TICKET
// TEMPLATE. A ticketed data plane (L2) hands a client WHERE to dial — one
// tailnet URL per LEG of a served process — and the GRANTS the far door
// verifies. The template generalizes the first half from the cell's pair
// (TM-2): the cell's set is its first instance, byte for byte, and rosettad's
// session socket (the direct plane, DS-7/SP-7) its second.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  REMOTE_INDEX_SESSION_PATH_PREFIX,
  RemoteIndexEndpointSet,
  remoteIndexEndpointsFor,
  remoteIndexSessionPath,
} from "../src/agent-index";
import { CellEndpointSet } from "../src/envelope";
import {
  composeRemoteEndpoints,
  REMOTE_ENDPOINT_LEG,
  RemoteEndpointSet,
  remoteDoorUrl,
  remoteEndpointSet,
} from "../src/remote-endpoints";
import { RemoteCellEndpointSet, remoteCellEndpointsFor } from "../src/terminal-pipeline";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;

/** The cell's remote URL rule exactly as TM-2 shipped it (main `fa31207f`,
 * terminal-pipeline.ts) — a FROZEN copy, so the generalization below is held
 * to the old verdicts rather than to its own. */
const TM2_REMOTE_WS =
  /^wss?:\/\/(?!127\.0\.0\.1(:|\/|$))(?!\[::1\](:|\/|$))(?!localhost(:|\/|$))[^/?#\s]+\/cell\/[^/?#\s]+\/(control|frames)$/;

describe("the template (SP-3) — the cell's pair is its first instance", () => {
  const golden = fixture("tp-remote-open-ticket.valid.json")["endpoints"];

  it("parses the cell's golden and writes back the same bytes: the wire did not move", () => {
    expect(JSON.stringify(RemoteCellEndpointSet.parse(golden))).toBe(JSON.stringify(golden));
    // the template admits every instance's set
    expect(RemoteEndpointSet.safeParse(golden).success).toBe(true);
    // and the instance's members are the template's spelling: `<leg>Url`
    expect(Object.keys(RemoteCellEndpointSet.shape)).toEqual(["controlUrl", "framesUrl"]);
  });

  it("judges every URL the way TM-2's own rule did", () => {
    const hosts = [
      "desk.tail1234.ts.net:9422",
      "desk.tail1234.ts.net",
      "100.64.0.7:9422",
      "[fd7a:115c:a1e0::7]:9422",
      "127.0.0.1:9422",
      "127.0.0.10:9422",
      "[::1]:9422",
      "localhost:9422",
      "localhost.tail1234.ts.net:9422",
    ];
    const paths = [
      "/cell/cb-1/control",
      "/cell/cb-1/frames",
      "/cell/cb-1/mirror",
      "/cell/cb-1/control?token=x",
      "/cell/cb-1/control#t",
      "/control",
      "/t/secret/cell/cb-1/control",
      "/cell//control",
      "/cell/cb 1/control",
    ];
    let checked = 0;
    for (const scheme of ["ws", "wss", "http", "ftp"])
      for (const host of hosts)
        for (const path of paths) {
          const url = `${scheme}://${host}${path}`;
          const frozen = TM2_REMOTE_WS.test(url);
          const now = RemoteCellEndpointSet.safeParse({ controlUrl: url, framesUrl: url }).success;
          expect(now, url).toBe(frozen);
          checked += 1;
        }
    expect(checked).toBe(4 * 9 * 9);
  });

  it("composes from the serve's base URL exactly as before (the one http→ws mapping)", () => {
    expect(remoteCellEndpointsFor("http://desk.tail1234.ts.net:9422", "cb-1")).toEqual({
      controlUrl: "ws://desk.tail1234.ts.net:9422/cell/cb-1/control",
      framesUrl: "ws://desk.tail1234.ts.net:9422/cell/cb-1/frames",
    });
    expect(remoteCellEndpointsFor("https://desk.tail1234.ts.net/", "cb-1")?.controlUrl).toBe(
      "wss://desk.tail1234.ts.net/cell/cb-1/control",
    );
    expect(remoteCellEndpointsFor("http://127.0.0.1:9422", "cb-1")).toBeUndefined();
    expect(remoteCellEndpointsFor("not a url", "cb-1")).toBeUndefined();
  });

  it("the loopback shape is never a remote set — D36's split, now for every instance", () => {
    const loopback = fixture("tp-open-ticket.valid.json")["endpoints"];
    expect(CellEndpointSet.safeParse(loopback).success).toBe(true);
    expect(RemoteEndpointSet.safeParse(loopback).success).toBe(false);
  });
});

describe("the template's own reader (any served process's set)", () => {
  it("is one `<leg>Url` per leg, each a tailnet door URL with no query and no fragment", () => {
    expect(RemoteEndpointSet.safeParse({ sessionUrl: "ws://desk.ts.net:9424/x" }).success).toBe(
      true,
    );
    expect(RemoteEndpointSet.safeParse({ pageUrl: "https://desk.ts.net/a/b" }).success).toBe(true);
    for (const bad of [
      { sessionUrl: "ws://127.0.0.1:9424/x" },
      { sessionUrl: "ws://localhost/x" },
      { sessionUrl: "ws://[::1]:9424/x" },
      { sessionUrl: "ws://desk.ts.net/x?grant=g" },
      { sessionUrl: "ws://desk.ts.net/x#g" },
      { sessionUrl: "ftp://desk.ts.net/x" },
      { sessionUrl: 42 },
      {},
      { device: "dev-1" },
    ]) {
      expect(RemoteEndpointSet.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("carries a member that is not a leg untouched (the tolerant reader)", () => {
    const parsed = RemoteEndpointSet.parse({ sessionUrl: "ws://desk.ts.net/x", note: { a: 1 } });
    expect(parsed).toEqual({ sessionUrl: "ws://desk.ts.net/x", note: { a: 1 } });
  });

  it("the factory refuses a leg that would not read as a member, and a repeated one", () => {
    expect(REMOTE_ENDPOINT_LEG.test("control")).toBe(true);
    expect(() => remoteEndpointSet(["Control"], remoteDoorUrl("wss?", "/x"), "m")).toThrow(/leg/);
    expect(() => remoteEndpointSet(["control-leg"], remoteDoorUrl("wss?", "/x"), "m")).toThrow(
      /leg/,
    );
    expect(() =>
      remoteEndpointSet(["control", "control"], remoteDoorUrl("wss?", "/x"), "m"),
    ).toThrow(/leg/);
  });

  it("composes every leg from the serve's base URL, and nothing it cannot honestly build", () => {
    const one = remoteEndpointSet(["page"], remoteDoorUrl("wss?", "\\/p"), "m");
    expect(composeRemoteEndpoints(one, "https://desk.ts.net:443", { page: "/p" })).toEqual({
      pageUrl: "wss://desk.ts.net/p",
    });
    expect(composeRemoteEndpoints(one, "http://desk.ts.net:8080/", { page: "/p" })).toEqual({
      pageUrl: "ws://desk.ts.net:8080/p",
    });
    // a leg the paths do not name, a path the instance refuses, a base that is
    // not an http(s) origin, a loopback base: never a URL nothing can dial
    expect(composeRemoteEndpoints(one, "http://desk.ts.net", {})).toBeUndefined();
    expect(composeRemoteEndpoints(one, "http://desk.ts.net", { page: "/q" })).toBeUndefined();
    expect(composeRemoteEndpoints(one, "ftp://desk.ts.net", { page: "/p" })).toBeUndefined();
    expect(composeRemoteEndpoints(one, "http://127.0.0.1:1", { page: "/p" })).toBeUndefined();
    // a path for a leg the instance does not have is not smuggled in
    expect(composeRemoteEndpoints(one, "http://desk.ts.net", { page: "/p", extra: "/x" })).toEqual({
      pageUrl: "ws://desk.ts.net/p",
    });
  });
});

describe("rosettad's direct plane — the template's second instance (one leg)", () => {
  const golden = fixture("remote-endpoint-set.rosetta.json");

  it("parses its golden with its own reader and with the template's", () => {
    expect(RemoteIndexEndpointSet.parse(golden)).toEqual(golden);
    expect(RemoteEndpointSet.safeParse(golden).success).toBe(true);
    expect(Object.keys(RemoteIndexEndpointSet.shape)).toEqual(["sessionUrl"]);
  });

  it("dials rosetta's own session socket at the ROOT of the index listener", () => {
    // the serve proxies the whole listener onto rosettad's loopback port with
    // nothing stripped (`kind: "port"`), so the path is rosetta's own route
    // and an asset path a timeline names stays dialable as it stands
    expect(REMOTE_INDEX_SESSION_PATH_PREFIX).toBe("/ws/sessions/");
    expect(remoteIndexSessionPath("s1")).toBe("/ws/sessions/s1");
    expect(remoteIndexEndpointsFor("http://studio-mbp.tail9f2c.ts.net:9424", "s1")).toEqual(golden);
    expect(remoteIndexEndpointsFor("https://studio-mbp.tail9f2c.ts.net/", "s1")).toEqual({
      sessionUrl: "wss://studio-mbp.tail9f2c.ts.net/ws/sessions/s1",
    });
  });

  it("percent-encodes the session id — rosetta's ids are any text (its own grant vectors)", () => {
    // rosetta's second valid grant vector names a sid with a quote, a
    // backslash, controls, `/` and non-ASCII; the path must carry it as ONE
    // segment or the route would answer for a different session
    const sid = 's"1\\2\u0001\n\t\u007f/é \u{1f600}';
    const path = remoteIndexSessionPath(sid);
    expect(path.split("/")).toHaveLength(4);
    expect(decodeURIComponent(path.slice(REMOTE_INDEX_SESSION_PATH_PREFIX.length))).toBe(sid);
    expect(remoteIndexEndpointsFor("http://desk.ts.net:9424", sid)?.sessionUrl).toBe(
      `ws://desk.ts.net:9424${path}`,
    );
  });

  it("refuses loopback, a query, a foreign path — and composes nothing from an unusable base", () => {
    for (const sessionUrl of [
      "ws://127.0.0.1:9424/ws/sessions/s1",
      "ws://localhost:9424/ws/sessions/s1",
      "ws://desk.ts.net:9424/ws/sessions/s1?grant=g",
      "ws://desk.ts.net:9424/ws/sessions/s1#g",
      "ws://desk.ts.net:9424/ws/meta",
      "ws://desk.ts.net:9424/api/sessions/s1",
      "ws://desk.ts.net:9424/index/ws/sessions/s1",
      "http://desk.ts.net:9424/ws/sessions/s1",
      "ws://desk.ts.net:9424/ws/sessions/",
    ]) {
      expect(RemoteIndexEndpointSet.safeParse({ sessionUrl }).success, sessionUrl).toBe(false);
    }
    expect(remoteIndexEndpointsFor("http://127.0.0.1:9424", "s1")).toBeUndefined();
    expect(remoteIndexEndpointsFor("ftp://desk.ts.net", "s1")).toBeUndefined();
    expect(remoteIndexEndpointsFor("not a url", "s1")).toBeUndefined();
    expect(remoteIndexEndpointsFor("http://desk.ts.net:9424", "")).toBeUndefined();
  });
});
