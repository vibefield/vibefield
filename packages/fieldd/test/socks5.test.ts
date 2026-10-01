// DS-1 — the SOCKS5 client (src/socks5.ts) against a real RFC 1928/1929
// server on loopback: the happy path end to end, every refusal stage, the
// address encodings, the deadline, and a WebSocket through the agent.
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { ipv6Bytes, Socks5Agent, Socks5Error, socks5Connect, splitHostPort } from "../src/socks5";
import { type FakeSocks5, type FakeSocks5Options, startFakeSocks5 } from "./socks5-server";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const CREDENTIAL = { username: "tsnet", password: "9f2c4e6a8b0d1f3a" };

/** A TCP echo door the proxy splices to. Its close destroys its own
 * connections: `server.close` alone waits for every one of them to end. */
async function echo(): Promise<{ port: number }> {
  const open = new Set<import("node:net").Socket>();
  const server: Server = createServer((sock) => {
    open.add(sock);
    sock.on("close", () => open.delete(sock));
    sock.on("error", () => {});
    sock.pipe(sock);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        for (const sock of open) sock.destroy();
        server.close(() => resolve());
      }),
  );
  return { port: (server.address() as { port: number }).port };
}

async function proxy(
  extra: Partial<FakeSocks5Options> & Pick<FakeSocks5Options, "route">,
): Promise<FakeSocks5> {
  const p = await startFakeSocks5({ ...CREDENTIAL, ...extra });
  cleanup.push(() => p.close());
  return p;
}

async function roundTrip(sock: import("node:net").Socket, payload: string): Promise<string> {
  sock.write(payload);
  return await new Promise<string>((resolve, reject) => {
    let got = "";
    sock.on("data", (d: Buffer) => {
      got += d.toString("utf8");
      if (got.length >= payload.length) resolve(got);
    });
    sock.on("error", reject);
  });
}

describe("DS-1 — socks5Connect", () => {
  it("CONNECTs to a DOMAINNAME through the proxy with the credential, bytes flowing both ways", async () => {
    const door = await echo();
    const p = await proxy({ route: () => ({ host: "127.0.0.1", port: door.port }) });
    const sock = await socks5Connect(
      { proxy: p.address, ...CREDENTIAL },
      { host: "truffle-vibefield-b.tail1234.ts.net", port: 9423 },
    );
    cleanup.push(() => {
      sock.destroy();
    });
    expect(await roundTrip(sock, "through the node")).toBe("through the node");
    // the NAME went to the proxy (ATYP 0x03), so the proxy — the node —
    // resolves MagicDNS, never the OS
    expect(p.requests).toEqual([
      expect.objectContaining({
        atyp: 0x03,
        host: "truffle-vibefield-b.tail1234.ts.net",
        port: 9423,
      }),
    ]);
  });

  it("fails CLOSED on a refused credential, at the auth stage", async () => {
    const p = await proxy({ route: () => undefined });
    const attempt = socks5Connect(
      { proxy: p.address, username: "tsnet", password: "wrong" },
      { host: "peer.ts.net", port: 9423 },
    );
    await expect(attempt).rejects.toMatchObject({ name: "Socks5Error", stage: "auth" });
    expect(p.refusedAuth()).toBe(1);
    expect(p.requests, "no CONNECT is ever sent past a refused credential").toEqual([]);
  });

  it("refuses a proxy that answers 'no authentication' — it is not the node's", async () => {
    const p = await proxy({ route: () => undefined, quirk: "no-auth-method" });
    await expect(
      socks5Connect({ proxy: p.address, ...CREDENTIAL }, { host: "peer.ts.net", port: 9423 }),
    ).rejects.toMatchObject({ stage: "greeting" });
  });

  it("names the proxy's refusal in RFC 1928's words, with its REP code", async () => {
    const p = await proxy({ route: () => undefined, quirk: "refuse-ruleset" });
    const refused = await socks5Connect(
      { proxy: p.address, ...CREDENTIAL },
      { host: "stranger.ts.net", port: 9423 },
    ).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(Socks5Error);
    expect(refused).toMatchObject({ stage: "request", reply: 0x02 });
    expect((refused as Error).message).toContain("connection not allowed by ruleset");
  });

  it("says a hang-up inside the reply at once, not at the deadline", async () => {
    const p = await proxy({ route: () => undefined, quirk: "hang-up-mid-reply" });
    const started = Date.now();
    await expect(
      socks5Connect(
        { proxy: p.address, ...CREDENTIAL, timeoutMs: 5_000 },
        { host: "peer.ts.net", port: 9423 },
      ),
    ).rejects.toMatchObject({ stage: "connect" });
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  it("gives up at its deadline on a proxy that never answers", async () => {
    const p = await proxy({ route: () => undefined, quirk: "silent" });
    await expect(
      socks5Connect(
        { proxy: p.address, ...CREDENTIAL, timeoutMs: 200 },
        { host: "peer.ts.net", port: 9423 },
      ),
    ).rejects.toMatchObject({ stage: "timeout" });
  });

  it("is refused at connect when no proxy listens", async () => {
    const p = await proxy({ route: () => undefined });
    const address = p.address;
    await p.close();
    await expect(
      socks5Connect({ proxy: address, ...CREDENTIAL }, { host: "peer.ts.net", port: 9423 }),
    ).rejects.toMatchObject({ stage: "connect" });
  });

  it("encodes an IPv4 and an IPv6 target as addresses, not names", async () => {
    const door = await echo();
    const p = await proxy({ route: () => ({ host: "127.0.0.1", port: door.port }) });
    const v4 = await socks5Connect(
      { proxy: p.address, ...CREDENTIAL },
      { host: "100.101.102.103", port: 9422 },
    );
    v4.destroy();
    const v6 = await socks5Connect(
      { proxy: p.address, ...CREDENTIAL },
      { host: "fd7a:115c:a1e0::3", port: 9422 },
    );
    v6.destroy();
    expect(p.requests[0]).toMatchObject({ atyp: 0x01, host: "100.101.102.103", port: 9422 });
    expect(p.requests[1]).toMatchObject({ atyp: 0x04, port: 9422 });
    expect(p.requests[1]!.address.toString("hex")).toBe("fd7a115ca1e000000000000000000003");
  });
});

describe("DS-1 — the address helpers", () => {
  it("splits host:port and [v6]:port, refusing anything else", () => {
    expect(splitHostPort("127.0.0.1:41641")).toEqual({ host: "127.0.0.1", port: 41641 });
    expect(splitHostPort("[::1]:41642")).toEqual({ host: "::1", port: 41642 });
    for (const bad of ["127.0.0.1", "127.0.0.1:0", "127.0.0.1:65536", "::1:41642", ""]) {
      expect(() => splitHostPort(bad), bad).toThrow(Socks5Error);
    }
  });

  it("expands IPv6 literals to their 16 bytes, an embedded IPv4 tail included", () => {
    const hex = (a: string) => ipv6Bytes(a).toString("hex");
    expect(hex("::")).toBe("0".repeat(32));
    expect(hex("::1")).toBe(`${"0".repeat(31)}1`);
    expect(hex("fd7a:115c:a1e0::3")).toBe("fd7a115ca1e000000000000000000003");
    expect(hex("1:2:3:4:5:6:7:8")).toBe("00010002000300040005000600070008");
    expect(hex("::ffff:1.2.3.4")).toBe("00000000000000000000ffff01020304");
    expect(hex("::1.2.3.4")).toBe("00000000000000000000000001020304");
    expect(hex("1:2:3:4:5:6:1.2.3.4")).toBe("00010002000300040005000601020304");
    for (const bad of ["1::2::3", "1:2:3:4:5:6:7:8:9", "fe80::1%en0", "1:2:3:4:5:6:7::8"]) {
      expect(() => ipv6Bytes(bad), bad).toThrow(Socks5Error);
    }
  });
});

describe("DS-1 — Socks5Agent carries a WebSocket through the proxy", () => {
  it("opens a ws:// connection to a named door and exchanges a message", async () => {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          for (const client of wss.clients) client.terminate();
          wss.close(() => resolve());
        }),
    );
    const hosts: string[] = [];
    wss.on("connection", (ws, req) => {
      hosts.push(String(req.headers.host));
      ws.on("message", (data) => ws.send(`door:${String(data)}`));
    });
    const doorPort = (wss.address() as { port: number }).port;
    const p = await proxy({ route: () => ({ host: "127.0.0.1", port: doorPort }) });
    const agent = new Socks5Agent({ proxy: p.address, ...CREDENTIAL });
    const ws = new WebSocket("ws://truffle-vibefield-b.tail1234.ts.net:9423/", {
      agent,
      perMessageDeflate: false,
    });
    cleanup.push(() => ws.close());
    const reply = await new Promise<string>((resolve, reject) => {
      ws.once("open", () => ws.send("hello"));
      ws.once("message", (data) => resolve(String(data)));
      ws.once("error", reject);
    });
    expect(reply).toBe("door:hello");
    // the HTTP upgrade names the door by its tailnet name — what the peer's
    // sidecar routes on
    expect(hosts).toEqual(["truffle-vibefield-b.tail1234.ts.net:9423"]);
    expect(p.requests[0]).toMatchObject({
      atyp: 0x03,
      host: "truffle-vibefield-b.tail1234.ts.net",
    });
  });

  it("surfaces a refused credential as the WebSocket's error, never a silent direct dial", async () => {
    const p = await proxy({ route: () => ({ host: "127.0.0.1", port: 1 }) });
    const agent = new Socks5Agent({ proxy: p.address, username: "tsnet", password: "wrong" });
    const ws = new WebSocket("ws://truffle-vibefield-b.tail1234.ts.net:9423/", { agent });
    const error = await new Promise<Error>((resolve) => ws.once("error", resolve));
    expect(error).toBeInstanceOf(Socks5Error);
    expect((error as Socks5Error).stage).toBe("auth");
  });
});
