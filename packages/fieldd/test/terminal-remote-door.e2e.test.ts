import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { type AddressInfo, connect as tcpConnect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CELL_RECEIVER_CAPS,
  decodePresentationEnvelope,
  PRESENTATION_ENVELOPE_MAGIC,
  remoteCellEndpointsFor,
  TerminalCreateOpenResult,
  TP_PROTOCOL_VERSION,
  tagTpMessage,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import type { ServeSpec } from "../src/mesh-client";
import { terminalServeSpec } from "../src/terminal-serve";
import { killDaemonTree, nativeBinPath, shortTmpRoot, waitForMgmtEndpoint } from "./native-harness";
import { helloAs, WsRpc } from "./ws-rpc";

// TM-2 — THE END-TO-END WITNESS: a real floor, a real cell, a real ticket, and
// a real WebSocket that reaches `ConnectionAccepted` and a seed frame THROUGH
// the cell-route path rather than at the loopback door.
//
// WHAT IS REAL HERE, and it is most of it: `field-native` is the shipped
// binary, the cell is a real `field-terminal-host` with a real PTY behind it,
// fieldd mints the grants, and the route table the proxy is built from is
// `terminalServeSpec()` — fieldd's OWN policy function, run over the floor's
// OWN route rows. The URLs dialed are composed by `remoteCellEndpointsFor`,
// the same contracts function the ticket uses. So the prefix discipline, the
// prefix STRIPPING, the loopback target derivation, the login gate and the
// cell's acceptance of a proxied upgrade are all under test against real code.
//
// WHAT IS A STAND-IN, stated plainly: the sidecar. There is no loopback preview
// of a served route to dial — `preview_routes` in `mgmt/mesh.rs` is a static
// preview DIRECTORY mounted at `/.vibefield/preview`, not a local view of a
// proxied route, and truffle's proxy listener is a tsnet listener with no
// loopback face. And the live tailnet pair needs `TRUFFLE_TEST_AUTHKEY`, which
// this host does not have exported. So the splice here is a Node server
// implementing the route semantics truffle documents (RFC 023 §7/§9.7: longest
// prefix wins, `stripPrefix` rewrites the path, the upgrade is hijacked to the
// target, the login allow-list gates it, the identity headers are injected).
// The ONE link that remains unproven is the real sidecar's fidelity to that
// contract — which is exactly what James's hardware run covers, and nothing
// smaller can.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN = nativeBinPath(ROOT);
const LOGIN = "me@jamesyong42.com";
const STRANGER = "someone-else@example.com";
const SHELL = process.platform === "win32" ? (process.env["COMSPEC"] ?? "cmd.exe") : "/bin/sh";

let children: ChildProcess[] = [];
let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* already stopped is fine */
    }
  }
  cleanup = [];
  await Promise.all(children.map((c) => killDaemonTree(c)));
  children = [];
});

// ---------------------------------------------------------------------------
// The stand-in sidecar: truffle RFC 023 §7 route semantics over loopback.

interface StandInSidecar {
  /** the loopback listener the test dials in place of the tailnet one */
  port: number;
  refusals: string[];
}

/** Go `path.Match` for the shapes an allow-list actually holds: a literal
 * login, with `\` escaping the metacharacters the product serve escapes. */
function allows(globs: readonly string[], login: string): boolean {
  if (globs.length === 0) return true; // RFC 023 §9.7 — empty is the whole tailnet
  return globs.some((glob) => glob.replace(/\\(.)/g, "$1").toLowerCase() === login.toLowerCase());
}

async function standInSidecar(spec: ServeSpec): Promise<StandInSidecar> {
  const routes = [...(spec.routes ?? [])].sort((a, b) => b.prefix.length - a.prefix.length);
  const refusals: string[] = [];
  const server: Server = createServer((_req, res) => {
    res.writeHead(404).end();
  });
  server.on("upgrade", (req, socket, head) => {
    const path = req.url ?? "/";
    const login = String(req.headers["tailscale-user-login"] ?? "");
    // the gate is WhoIs at the sidecar, BEFORE anything reaches a backend —
    // the same bare 403 truffle answers on the hijack path
    if (!allows(spec.allow ?? [], login)) {
      refusals.push(login);
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    // longest prefix wins (RFC 023 D11), order-independent
    const route = routes.find((r) => path.startsWith(r.prefix));
    if (route === undefined) {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    // stripPrefix: true — the cell door matches /control and /frames EXACTLY
    const rewritten = path.slice(route.prefix.length - 1);
    const upstream = tcpConnect(route.targetPort, "127.0.0.1", () => {
      const headers = Object.entries(req.headers)
        .filter(([k]) => k !== "tailscale-user-login" && k !== "tailscale-user-name")
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
      // the identity headers are INJECTED by the sidecar and cannot be smuggled
      headers.push(`Tailscale-User-Login: ${login}`);
      upstream.write(`GET ${rewritten} HTTP/1.1\r\n${headers.join("\r\n")}\r\n\r\n`, "utf8", () => {
        if (head.length > 0) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  );
  return { port: (server.address() as AddressInfo).port, refusals };
}

// ---------------------------------------------------------------------------
// A T1 client, the `runTerminalDoorProbe` shape, in Node.

const HELLO_BASE = {
  protocolMajor: TP_PROTOCOL_VERSION.major,
  protocolMinor: TP_PROTOCOL_VERSION.minor,
  capabilities: [] as string[],
};

interface Leg {
  ws: WebSocket;
  next: (
    pred: (m: Record<string, unknown>) => boolean,
    ms?: number,
  ) => Promise<Record<string, unknown>>;
  nextBinary: (ms?: number) => Promise<Buffer>;
  send: (message: unknown) => void;
}

async function openLeg(url: string, login: string): Promise<Leg> {
  const ws = new WebSocket(url, {
    headers: { "Tailscale-User-Login": login },
    // the cell door refuses permessage-deflate and reads the hello first: the
    // upgrade must carry no compression negotiation through the proxy
    perMessageDeflate: false,
  });
  cleanup.push(() => ws.close());
  const text: Record<string, unknown>[] = [];
  const binary: Buffer[] = [];
  let closed: string | null = null;
  ws.on("message", (data, isBinary) => {
    if (isBinary) binary.push(Buffer.from(data as Buffer));
    else text.push(JSON.parse(String(data)) as Record<string, unknown>);
  });
  ws.on("close", (code, reason) => {
    closed = `closed ${code} ${String(reason)}`;
  });
  ws.on("error", (error) => {
    closed = `error ${error.message}`;
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
  const waitFor = async <T>(take: () => T | undefined, what: string, ms: number): Promise<T> => {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = take();
      if (hit !== undefined) return hit;
      if (closed !== null) throw new Error(`${what}: the leg ${closed}`);
      if (Date.now() > deadline) throw new Error(`${what}: nothing in ${ms}ms`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  return {
    ws,
    next: (pred, ms = 10_000) =>
      waitFor(
        () => {
          const at = text.findIndex(pred);
          return at === -1 ? undefined : text.splice(at, 1)[0];
        },
        "a matching frame",
        ms,
      ),
    nextBinary: (ms = 15_000) => waitFor(() => binary.shift(), "a binary frame", ms),
    send: (message) => ws.send(JSON.stringify(message)),
  };
}

// ---------------------------------------------------------------------------

async function boot(): Promise<{ daemon: FielddDaemon; dataDir: string }> {
  const dataDir = shortTmpRoot("vf-tm-e2e-");
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "fieldd"), { recursive: true });
  writeFileSync(
    join(dataDir, "fieldd", "link.json"),
    JSON.stringify({
      login: LOGIN,
      tailnet: "tail1234.ts.net",
      linkedAt: "2026-09-14T00:00:00.000Z",
    }),
  );
  const child = spawn(BIN, [], {
    env: {
      ...process.env,
      FIELD_NATIVE_DATA_DIR: dataDir,
      FIELD_LOG_DIR: join(dataDir, "logs"),
      FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
    },
    stdio: "ignore",
  });
  children.push(child);
  await waitForMgmtEndpoint(dataDir, 20_000);
  const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  return { daemon, dataDir };
}

describe("TM-2 — a cell route carries a real T1 connection to a real cell", () => {
  it("reaches ConnectionAccepted and a seed frame through the cell route, and refuses a stranger at the gate", async () => {
    const { daemon } = await boot();
    const grant = daemon.tokens.mint(["terminal.attach"], "tm-2-e2e");
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    cleanup.push(() => ws.close());
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const rpc = new WsRpc(ws);
    await helloAs(rpc, grant.token);

    // A REAL session on a REAL cell, with the cell's own grants and doors.
    const created = TerminalCreateOpenResult.parse(
      await rpc.call("terminal.create", { shell: SHELL }),
    );
    const cellBootId = created.route.cellBootId;
    expect(created.endpoints.controlUrl).toMatch(/^ws:\/\/127\.0\.0\.1:/);

    // THE ROUTE TABLE, computed by fieldd's own policy over the floor's own
    // rows — not a table this test wrote.
    const spec = terminalServeSpec({
      routes: daemon.native.terminalRoutes,
      published: true,
      linkedLogin: LOGIN,
    });
    if (spec === null) throw new Error("the floor's rows produced no terminal serve");
    expect(spec.routes?.some((r) => r.prefix === `/cell/${cellBootId}/`)).toBe(true);

    const sidecar = await standInSidecar(spec);
    // The URLs are composed by the SAME contracts function the ticket uses,
    // against a realistic tailnet origin — `RemoteCellEndpointSet` REFUSES a
    // loopback host by construction (D36), which is the property the contract
    // tests pin, so a stand-in listening on 127.0.0.1 could never be composed
    // into one. The ORIGIN is therefore swapped for the dial and nothing else
    // is: the paths under test are the composer's own output, verbatim.
    const minted = remoteCellEndpointsFor(
      `http://desk.tail1234.ts.net:${spec.listenPort}`,
      cellBootId,
    );
    if (minted === undefined) throw new Error("the composer refused a tailnet base URL");
    expect(new URL(minted.controlUrl).pathname).toBe(`/cell/${cellBootId}/control`);
    const dial = (url: string): string => `ws://127.0.0.1:${sidecar.port}${new URL(url).pathname}`;
    const remote = { controlUrl: dial(minted.controlUrl), framesUrl: dial(minted.framesUrl) };

    // ---- the control leg, through the route ----
    const control = await openLeg(remote.controlUrl, LOGIN);
    control.send(
      tagTpMessage("ConnectionHello", {
        ...HELLO_BASE,
        channel: "control",
        transportGrant: created.transportGrant as never,
      }),
    );
    const accepted = await control.next((m) => m["type"] === "ConnectionAccepted");
    expect(accepted["type"]).toBe("ConnectionAccepted");

    // ---- the frames leg, through the route ----
    const frames = await openLeg(remote.framesUrl, LOGIN);
    frames.send(
      tagTpMessage("ConnectionHello", {
        ...HELLO_BASE,
        channel: "frames",
        transportGrant: created.transportGrant as never,
        receiverCapacities: DEFAULT_CELL_RECEIVER_CAPS,
      }),
    );
    expect((await frames.next((m) => m["type"] === "ConnectionAccepted"))["type"]).toBe(
      "ConnectionAccepted",
    );

    // ---- the ATTACH, which is where the attach grant is verified ----
    const activationId = "act-tm2-e2e-1";
    control.send(
      tagTpMessage("AttachControlLeg", {
        activationId,
        attachGrant: created.attachGrant as never,
        initialDemand: { mode: "live" },
      }),
    );
    const attached = await control.next(
      (m) => m["type"] === "ControlLegAttached" || m["type"] === "AttachRefused",
    );
    expect(attached["type"], JSON.stringify(attached)).toBe("ControlLegAttached");
    expect(attached["sessionId"]).toBe(created.sessionId);

    frames.send(
      tagTpMessage("AttachFramesLeg", {
        activationId,
        attachGrant: created.attachGrant as never,
      }),
    );
    const framesAttached = await frames.next(
      (m) => m["type"] === "FramesLegAttached" || m["type"] === "AttachRefused",
    );
    expect(framesAttached["type"], JSON.stringify(framesAttached)).toBe("FramesLegAttached");

    // ---- the SEED: real bytes, off a real PTY, through the route ----
    const envelope = await frames.nextBinary();
    process.stdout.write(
      `TM2_WITNESS ${JSON.stringify({
        cellBootId,
        sessionId: created.sessionId,
        routes: spec.routes?.length ?? 0,
        targetPort: spec.routes?.[0]?.targetPort ?? null,
        dialed: remote.controlUrl,
        minted: minted.controlUrl,
        envelopeBytes: envelope.length,
      })}\n`,
    );
    expect([envelope[0], envelope[1]]).toEqual([...PRESENTATION_ENVELOPE_MAGIC]);
    const decoded = decodePresentationEnvelope(envelope);
    expect(decoded.ok, JSON.stringify(decoded)).toBe(true);

    // ---- the gate: a WhoIs-verified stranger never reaches the cell ----
    await expect(openLeg(remote.controlUrl, STRANGER)).rejects.toThrow(/403/);
    expect(sidecar.refusals).toEqual([STRANGER]);
  }, 120_000);

  // The `doors_not_published` refusal is NOT re-proved here: reaching it needs
  // the tailnet DOOR (a self peer's dial), and a real floor with no truffle node
  // has no product serve URL to dial at all. `terminal-remote-ticket.test.ts`
  // drives that refusal through the real door against a mock floor, which is
  // the only composition where both halves exist at once.
});
