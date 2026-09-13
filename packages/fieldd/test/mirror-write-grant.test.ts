// FD-2 (GM-D5, thinking-godview-mobile-first §10.2) — `terminal.mirrorWriteGrant`:
// the phone stops being handed a secret to TYPE and is granted one instead.
//
// Two blocks, because the door has two halves and they fail differently:
//
//  1. THE WALLS, at the wire. Every refusal this door relies on is declared in
//     the method registry and enforced in ProductApi, not in the handler — so
//     they are probed the way guest-door.test.ts probes UA-4: a standalone
//     ProductApi with the REAL method name bound to an echo. A wall that fires
//     never reaches the handler, so an echo that answers is the CONTROL that
//     keeps the three refusals honest (they are the wall, not a door that
//     refuses everyone).
//  2. THE DOOR, through a real fieldd over a scripted floor (MockMgmtServer):
//     the served grant, the honest UNAVAILABLE, the grants ledger, and the one
//     claim EL7 cares about — the capability appears in the ANSWER and in no
//     file this daemon wrote.
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTRACTS_VERSION,
  LAYOUT,
  type Scope,
  SOCKETS,
  TAILNET_SCOPES,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { MIRROR_WRITE_GRANT_REFUSED_PRINCIPALS } from "../src/daemon";
import { bootstrap, type FielddDaemon } from "../src/index";
import { ProductApi } from "../src/product-api";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import {
  killDaemonTree,
  nativeBinPath,
  nativeEndpoint,
  removeTempRoot,
  shortTmpRoot,
  waitForMgmtEndpoint,
} from "./native-harness";
import { helloAs, type RpcErrorShape, WsRpc } from "./ws-rpc";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const mode = (path: string) => statSync(path).mode & 0o777;

const METHOD = "terminal.mirrorWriteGrant";
const SECRET = "s3cret-route-mirror-write";
const OWNER = "me@jamesyong42.com";
/** The canary: long, unmistakable, and shaped like the floor's own hex mint so
 * a grep that finds it cannot be finding anything else. */
const CAPABILITY = `mfd2canary${"ab".repeat(27)}`;

const sockets: WebSocket[] = [];
const apis: ProductApi[] = [];
const daemons: FielddDaemon[] = [];
const floors: MockMgmtServer[] = [];
const roots: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const api of apis.splice(0)) api.close();
  for (const daemon of daemons.splice(0).reverse()) await daemon.stop().catch(() => undefined);
  for (const floor of floors.splice(0)) await floor.stop().catch(() => undefined);
  // a real floor spawns children of its own: kill the TREE and await the exits
  // before the root is walked away (the ENOTEMPTY race native-harness names)
  await Promise.all(children.splice(0).map((child) => killDaemonTree(child)));
  for (const root of roots.splice(0)) removeTempRoot(root);
});

// ---- 1. the walls ---------------------------------------------------------

/** A door with the REAL method bound to an echo: anything that answers proves
 * the caller passed every wall, and the principal it echoes says which one it
 * was. `device.list` rides along as the federating control D36 needs. */
async function wallDoor(getLinkedLogin?: () => string | null): Promise<number> {
  const api = new ProductApi({
    port: 0,
    tokens: {
      verify: (token) =>
        token === "scopeless-token"
          ? { tokenId: "tk-scopeless", scopes: ["doc.read"], label: "no attach" }
          : token === "attach-token"
            ? { tokenId: "tk-attach", scopes: ["terminal.attach"], label: "attach" }
            : null,
    },
    tailnetPathSecret: SECRET,
    ...(getLinkedLogin !== undefined ? { getLinkedLogin } : {}),
  });
  apis.push(api);
  api.register(METHOD, (ctx) => ({ reached: true, principal: ctx.principal }));
  api.register("device.list", (ctx) => ({ reached: true, principal: ctx.principal }));
  return await api.listen();
}

interface Wire {
  send(frame: unknown): void;
  next(): Promise<Record<string, unknown>>;
}

async function dial(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<Wire> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
  sockets.push(ws);
  const queue: Record<string, unknown>[] = [];
  const waiters: ((m: Record<string, unknown>) => void)[] = [];
  ws.on("message", (data) => {
    const msg = JSON.parse(String(data)) as Record<string, unknown>;
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else queue.push(msg);
  });
  await once(ws, "open");
  return {
    send: (frame) => ws.send(JSON.stringify(frame)),
    next: () => {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

const hello = (id: number, clientKind: string, extra: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id,
  method: "system.hello",
  params: {
    contractsVersion: CONTRACTS_VERSION,
    minCompatible: CONTRACTS_VERSION,
    clientKind,
    ...extra,
  },
});

const call = (id: number, method: string, params: unknown = {}) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
});

const data = (msg: Record<string, unknown>): Record<string, unknown> =>
  (msg["error"] as Record<string, unknown> | undefined)?.["data"] as Record<string, unknown>;

describe("terminal.mirrorWriteGrant — the walls it stands behind", () => {
  it("the self peer passes every wall and reaches the handler (the control)", async () => {
    // A linked device: the WhoIs login MATCHES the stored one, so UA-4 mints a
    // `tailnet` principal with self:true and the D32 preset — which carries
    // terminal.attach, the scope this door declares. Nothing else in this file
    // means anything without this row.
    const port = await wallDoor(() => OWNER);
    const wire = await dial(port, `/t/${SECRET}`, { "tailscale-user-login": OWNER });
    wire.send(hello(1, "ios"));
    const ack = await wire.next();
    expect((ack["result"] as { grantedScopes: string[] }).grantedScopes).toEqual([
      ...TAILNET_SCOPES,
    ]);
    expect(TAILNET_SCOPES).toContain("terminal.attach");

    wire.send(call(2, METHOD));
    const served = (await wire.next())["result"] as {
      reached: boolean;
      principal: { kind: string; self?: boolean };
    };
    expect(served.reached).toBe(true);
    expect(served.principal).toMatchObject({ kind: "tailnet", self: true });
  });

  it("a tailnet GUEST is refused before dispatch (UA-4's choke)", async () => {
    // A colleague on the same tailnet: WhoIs-verified, and not this user. The
    // door declares no `guestOk`, so the choke refuses it ahead of scopes —
    // writing into this user's terminals is exactly what it exists to stop.
    const port = await wallDoor(() => OWNER);
    const wire = await dial(port, `/t/${SECRET}`, {
      "tailscale-user-login": "colleague@example.test",
    });
    wire.send(hello(1, "ios"));
    expect((await wire.next())["result"]).toMatchObject({ grantedScopes: [] });

    wire.send(call(2, METHOD));
    const refusal = await wire.next();
    expect(data(refusal)["kind"]).toBe("FORBIDDEN_SCOPE");
    expect(String((refusal["error"] as { message: string }).message)).toContain("guest");
  });

  it("a peer-fieldd principal is refused by D36 locality, even holding the preset", async () => {
    // Another DESKTOP on the tailnet, with the full tailnet preset (so this is
    // not a scope refusal wearing a locality costume): `locality: "local"` says
    // the grant is this device's to give, and a fieldd does not borrow another
    // fieldd's write key. The federating `device.list` is the control.
    const port = await wallDoor(() => OWNER);
    const wire = await dial(port, `/t/${SECRET}`, { "tailscale-user-login": OWNER });
    wire.send(hello(1, "peer-fieldd", { deviceId: "dev-other-desktop" }));
    expect((await wire.next())["result"]).toMatchObject({ grantedScopes: [...TAILNET_SCOPES] });

    wire.send(call(2, "device.list"));
    const federated = (await wire.next())["result"] as { reached: boolean };
    expect(federated.reached).toBe(true);

    wire.send(call(3, METHOD));
    const refusal = await wire.next();
    expect(data(refusal)["kind"]).toBe("FORBIDDEN_SCOPE");
    expect(data(refusal)["details"]).toMatchObject({ method: METHOD, locality: "local" });
  });

  it("a local caller without terminal.attach is refused by the scope wall", async () => {
    const port = await wallDoor();
    const wire = await dial(port, "/");
    wire.send(hello(1, "renderer", { credential: "scopeless-token" }));
    expect((await wire.next())["result"]).toMatchObject({ grantedScopes: ["doc.read"] });

    wire.send(call(2, METHOD));
    const refusal = await wire.next();
    expect(data(refusal)["kind"]).toBe("FORBIDDEN_SCOPE");
    expect(data(refusal)["details"]).toMatchObject({ required: "terminal.attach" });

    // the same door, the same method, a token that HOLDS the scope: served
    const holder = await dial(port, "/");
    holder.send(hello(3, "renderer", { credential: "attach-token" }));
    await holder.next();
    holder.send(call(4, METHOD));
    expect((await holder.next())["result"]).toMatchObject({ reached: true });
  });
});

// ---- 2. the door ----------------------------------------------------------

interface Fixture {
  daemon: FielddDaemon;
  floor: MockMgmtServer;
  root: string;
  dataDir: string;
  logRoot: string;
}

async function fieldd(capability: string | null): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "vf-mirror-write-"));
  roots.push(root);
  const dataDir = join(root, "data");
  const logRoot = join(root, "logs");
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  // the mock proves possession of this secret (its own default)
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const floor = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  floor.mirrorWriteCapability = capability;
  await floor.start();
  floors.push(floor);
  const daemon = await bootstrap({ dataDir, logRoot, controlPort: 0, dataPort: 0 });
  daemons.push(daemon);
  return { daemon, floor, root, dataDir, logRoot };
}

/** A local client holding exactly `scopes` — the cheapest principal that
 * passes the scope wall (terminal-service.test.ts mints the same way). */
async function client(daemon: FielddDaemon, scopes: Scope[]): Promise<WsRpc> {
  const grant = daemon.tokens.mint(scopes, "mirror-write-test");
  const rpc = await open(daemon.controlPort);
  await helloAs(rpc, grant.token);
  return rpc;
}

async function open(port: number): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(ws);
  await once(ws, "open");
  return new WsRpc(ws);
}

/** Every regular file under `dir`, read as text. Binary files decode to
 * nonsense rather than throwing, which is fine: a 64-char ASCII canary either
 * appears verbatim or it does not. */
function everyFile(dir: string): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        try {
          out.push({ path, text: readFileSync(path, "utf8") });
        } catch {
          /* a socket or a file that vanished mid-walk is not evidence */
        }
      }
    }
  };
  walk(dir);
  return out;
}

interface AuditLine {
  action: string;
  phase: string;
  outcome?: string;
  reasonCode?: string;
  actor: { kind: string };
  target: { kind: string; id: string };
  attrs?: Record<string, unknown>;
}

/** The GRANTS ledger's lines, parsed. Parsed and not grepped: the claim is
 * about actions, phases and attrs, and a grep would pass on a substring. */
function grantLines(dataDir: string): AuditLine[] {
  return everyFile(join(dataDir, "audit"))
    .filter(({ path }) => path.includes("grants") && path.endsWith(".jsonl"))
    .flatMap(({ text }) =>
      text
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as AuditLine),
    );
}

describe("terminal.mirrorWriteGrant — the door over a scripted floor", () => {
  it("serves the floor's capability, names this device, and audits the GRANT without it", async () => {
    const { daemon, floor, dataDir } = await fieldd(CAPABILITY);
    const win = await client(daemon, ["terminal.attach"]);

    const before = Date.now();
    const grant = (await win.call("terminal.mirrorWriteGrant", {})) as {
      capability: string;
      deviceId: string;
      issuedAt: number;
    };

    expect(grant.capability).toBe(CAPABILITY);
    expect(grant.deviceId).toBe(daemon.devices.currentDeviceId());
    expect(grant.issuedAt).toBeGreaterThanOrEqual(before);
    expect(grant.issuedAt).toBeLessThanOrEqual(Date.now());
    // one ask per grant: the capability is not cached anywhere in fieldd, so a
    // rotation on the floor is live at the very next grant
    expect(floor.mirrorWriteAsks).toBe(1);

    // the grants ledger (capability.* routes there by the action's prefix)
    await daemon.stop();
    const lines = grantLines(dataDir).filter((line) => line.action.startsWith("capability."));
    expect(lines.map((line) => line.phase)).toEqual(["attempt", "outcome"]);
    for (const line of lines) {
      expect(line.action).toBe("capability.mirror_write.grant");
      expect(line.target).toMatchObject({ kind: "capability", id: "terminal.mirror-write" });
      expect(line.attrs?.["deviceId"]).toBe(grant.deviceId);
      expect(line.actor.kind).not.toBe("system"); // the CALLER's grant, not fieldd's
    }
    expect(lines.at(-1)?.outcome).toBe("succeeded");
  });

  it("EL7: the capability is in the answer and in NOTHING this daemon wrote", async () => {
    const { daemon, root, dataDir, logRoot } = await fieldd(CAPABILITY);
    const win = await client(daemon, ["terminal.attach"]);
    const grant = (await win.call("terminal.mirrorWriteGrant", {})) as { capability: string };
    expect(grant.capability).toBe(CAPABILITY);
    // stop first: the ledger's outcome line and the log's buffered records are
    // written on the way down, and a scan before that would pass by luck
    await daemon.stop();

    const leaked = everyFile(root)
      .filter(({ text }) => text.includes(CAPABILITY))
      .map(({ path }) => path);
    expect(leaked).toEqual([]);

    // and the two sinks the claim is really about were NOT empty (a scan of an
    // unwritten tree proves nothing)
    const audit = everyFile(join(dataDir, "audit")).filter(({ text }) => text.length > 0);
    const logs = everyFile(logRoot).filter(({ text }) => text.length > 0);
    expect(audit.length).toBeGreaterThan(0);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some(({ text }) => text.includes("fieldd."))).toBe(true);
  });

  it("a floor with no capability answers UNAVAILABLE {terminal, no-mirror-write}", async () => {
    const { daemon, floor, dataDir } = await fieldd(null);
    const win = await client(daemon, ["terminal.attach"]);

    const error: RpcErrorShape = await win.callErr("terminal.mirrorWriteGrant", {});
    expect(error.data?.kind).toBe("UNAVAILABLE");
    expect(error.data?.retryable).toBe(false);
    expect(error.data?.details).toMatchObject({ service: "terminal", state: "no-mirror-write" });
    expect(floor.mirrorWriteAsks).toBe(1);

    // a refused grant is still a grants-ledger event: someone asked this floor
    // for write, and the ledger says so with an honest failed outcome
    await daemon.stop();
    const lines = grantLines(dataDir).filter(
      (line) => line.action === "capability.mirror_write.grant",
    );
    expect(lines.map((line) => line.phase)).toEqual(["attempt", "outcome"]);
    expect(lines.at(-1)).toMatchObject({ outcome: "failed", reasonCode: "UNAVAILABLE" });
  });
});

// ---- 3. the joint ---------------------------------------------------------

// The two halves of FD-2 were written a commit apart and each is proved by its
// own suite — the floor's verb in `field-native`'s mgmt tests, the door here
// over a MOCK that answers whatever this file decided to script. Both spell the
// method name as a literal, so both would stay green if the two spellings ever
// drifted apart. This row is the joint: the REAL Rust floor, told to serve its
// terminals, mints a capability at boot and a real fieldd grants that exact
// string over the product API.
describe("terminal.mirrorWriteGrant — over the REAL floor (the joint)", () => {
  it("grants the capability the floor minted at boot", async () => {
    const dataDir = shortTmpRoot("vf-mw-");
    roots.push(dataDir);
    const child = spawn(nativeBinPath(ROOT), [], {
      env: {
        ...process.env,
        FIELD_NATIVE_DATA_DIR: dataDir,
        FIELD_LOG_DIR: join(dataDir, "logs"),
        FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
        // MF-2a's precondition: a floor that SERVES its terminals mints one.
        // The gateway stays off, so the mesh degrades and the floor serves —
        // which is the point: the capability exists before any tailnet does.
        FIELD_NATIVE_TERMINAL_MESH: "1",
      },
      stdio: "ignore",
    });
    children.push(child);
    await waitForMgmtEndpoint(dataDir, 15_000);

    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    daemons.push(daemon);
    const rpc = await client(daemon, ["terminal.attach"]);

    const grant = (await rpc.call("terminal.mirrorWriteGrant", {})) as {
      capability: string;
      deviceId: string;
      issuedAt: number;
    };
    expect(grant.capability).toMatch(/^[0-9a-f]{64}$/);
    expect(grant.deviceId).toBe(daemon.devices.currentDeviceId());

    // the same string the floor persisted, read from LAYOUT's own path — so a
    // grant is the floor's capability and not something fieldd invented
    const onDisk = readFileSync(join(dataDir, ...LAYOUT.TERMINAL_MIRROR_WRITE_FILE), "utf8").trim();
    expect(grant.capability).toBe(onDisk);
    expect(mode(join(dataDir, ...LAYOUT.TERMINAL_MIRROR_WRITE_FILE))).toBe(0o600);

    await daemon.stop();
  }, 30_000);
});

// ---- 4. the wall the registry cannot state -------------------------------

describe("terminal.mirrorWriteGrant — agent-class principals", () => {
  it("refuses a PLUGIN holding terminal.attach, and ledgers the attempt", async () => {
    // `terminal.attach` is renderer-eligible for plugins
    // (PLUGIN_CAPABILITY_ELIGIBILITY), which is right for the terminal pool and
    // wrong for this door: the capability is a tailnet-wide WRITE credential
    // that outlives the grant and is revoked only by rotating the floor's one
    // secret. EL7's adversary is exactly this principal.
    const { daemon, floor, dataDir } = await fieldd(CAPABILITY);
    const grant = daemon.tokens.mint(["terminal.attach"], "a-plugin", {
      pluginId: "vibefield.test.plugin",
    });
    const rpc = await open(daemon.controlPort);
    await helloAs(rpc, grant.token, "plugin-worker");

    const error: RpcErrorShape = await rpc.callErr("terminal.mirrorWriteGrant", {});
    expect(error.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(error.data?.details).toMatchObject({ principal: "plugin" });
    // the refusal happens BEFORE the floor is asked: a plugin never even
    // causes the capability to be read into this process
    expect(floor.mirrorWriteAsks).toBe(0);

    await daemon.stop();
    const lines = grantLines(dataDir).filter(
      (line) => line.action === "capability.mirror_write.grant",
    );
    expect(lines.map((line) => line.phase)).toEqual(["attempt", "outcome"]);
    expect(lines.at(-1)).toMatchObject({ outcome: "failed", reasonCode: "FORBIDDEN_SCOPE" });
    expect(lines.at(-1)?.actor).toMatchObject({ kind: "plugin" });
  });

  it("the same token WITHOUT the plugin binding is served (the control)", async () => {
    const { daemon, floor } = await fieldd(CAPABILITY);
    const rpc = await client(daemon, ["terminal.attach"]);
    const grant = (await rpc.call("terminal.mirrorWriteGrant", {})) as { capability: string };
    expect(grant.capability).toBe(CAPABILITY);
    expect(floor.mirrorWriteAsks).toBe(1);
  });

  it("refuses a caller CLAIMING an agent client kind, and ledgers that attempt too", async () => {
    // §11.2 — clientKind is a hello claim and may only ever RESTRICT. A liar
    // pays nothing for saying "renderer", which is why the principal half above
    // is the wall; this half costs an HONEST agent integration (an MCP bridge
    // dialing the local door with a terminal.attach token and saying what it is)
    // exactly the key it should not be holding. It is also the only half of the
    // mcp-agent refusal that is reachable from the wire today.
    const { daemon, floor, dataDir } = await fieldd(CAPABILITY);
    const grant = daemon.tokens.mint(["terminal.attach"], "an-agent-bridge");
    const rpc = await open(daemon.controlPort);
    await helloAs(rpc, grant.token, "mcp-agent");

    const error: RpcErrorShape = await rpc.callErr("terminal.mirrorWriteGrant", {});
    expect(error.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(error.data?.details).toMatchObject({ clientKind: "mcp-agent" });
    expect(floor.mirrorWriteAsks).toBe(0);

    await daemon.stop();
    const lines = grantLines(dataDir).filter(
      (line) => line.action === "capability.mirror_write.grant",
    );
    expect(lines.map((line) => line.phase)).toEqual(["attempt", "outcome"]);
    expect(lines.at(-1)).toMatchObject({ outcome: "failed", reasonCode: "FORBIDDEN_SCOPE" });
  });

  it("holds the refused PRINCIPAL kinds, including the one nothing mints yet", async () => {
    // The door's other half cannot be driven from the wire: nothing in this
    // repo constructs an `mcp-agent` PRINCIPAL (contracts declares the kind and
    // audit-service maps it; there is no minting site), so a wire row for it
    // would be a row about nothing. The set is what a test can hold — it fails
    // the day the kind is quietly dropped — and the plugin row above is what
    // proves the set is the thing the door actually consults.
    expect([...MIRROR_WRITE_GRANT_REFUSED_PRINCIPALS].sort()).toEqual(["mcp-agent", "plugin"]);
    // and the principals that must keep reaching it: the desktop's own windows
    // and a self peer on the phone
    for (const served of ["local-token", "shell-main", "tailnet"] as const) {
      expect(MIRROR_WRITE_GRANT_REFUSED_PRINCIPALS.has(served), served).toBe(false);
    }
  });
});
