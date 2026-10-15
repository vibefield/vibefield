import { once } from "node:events";
import { CONTRACTS_VERSION } from "@vibefield/contracts";
import { FielddClient } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ProductApi } from "../src/product-api";

// UA-2 — the hello user gate: the client MAY carry its expectation of which
// user the daemon serves; a configured daemon refuses a mismatch INCOMPATIBLE
// (terminal — the client must not retry), and an unconfigured daemon accepts
// any expectation (restrict-only: the claim narrows, never escalates).

const TOKEN = "tok-0123456789abcdef";
const tokens = {
  verify: (t: string) => (t === TOKEN ? { tokenId: "t1", scopes: [], label: "test" } : null),
};

let api: ProductApi | null = null;
let client: FielddClient | null = null;
afterEach(() => {
  client?.close();
  client = null;
  api?.close();
  api = null;
});

async function boot(userId?: string): Promise<number> {
  api = new ProductApi({ port: 0, tokens, ...(userId !== undefined ? { userId } : {}) });
  return api.listen();
}

describe("UA-2 — hello user gate", () => {
  it("a matching expectation connects", async () => {
    const port = await boot("01SERVERUSERAAAAAAAAAAAAAA");
    client = new FielddClient({
      url: `ws://127.0.0.1:${port}`,
      token: TOKEN,
      clientKind: "shell-main",
      userId: "01SERVERUSERAAAAAAAAAAAAAA",
    });
    client.connect();
    await client.ready();
  });

  it("a mismatched expectation is refused INCOMPATIBLE, terminally", async () => {
    const port = await boot("01SERVERUSERAAAAAAAAAAAAAA");
    client = new FielddClient({
      url: `ws://127.0.0.1:${port}`,
      token: TOKEN,
      clientKind: "shell-main",
      userId: "01OTHERUSERBBBBBBBBBBBBBBB",
    });
    client.connect();
    await expect(client.ready()).rejects.toMatchObject({ kind: "INCOMPATIBLE" });
  });

  it("an unconfigured daemon accepts any expectation (restrict-only)", async () => {
    const port = await boot();
    client = new FielddClient({
      url: `ws://127.0.0.1:${port}`,
      token: TOKEN,
      clientKind: "shell-main",
      userId: "01ANYUSERCCCCCCCCCCCCCCCCC",
    });
    client.connect();
    await client.ready();
  });
});

/** One raw hello, and the first reply as it went over the wire (the refusal's data included). */
async function rawHello(
  port: number,
  params: Record<string, unknown>,
): Promise<{ error?: { message: string; data?: Record<string, unknown> } }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await once(ws, "open");
  ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "system.hello", params }));
  const [data] = await once(ws, "message");
  ws.close();
  return JSON.parse(String(data));
}

// WP12 L2a — EL7: a refusal sent before the credential is checked must carry no server details. Until 2026-10-15 the
// user gate ran BEFORE the credential, so any local process that could reach the loopback door was told this
// daemon's userId; and the contracts-major refusal named the server's version to anyone.
describe("the hello's order (EL7, WP12 L2a)", () => {
  const SERVER_USER = "01SERVERUSERAAAAAAAAAAAAAA";

  it("an UNAUTHENTICATED hello claiming another user is refused UNAUTHORIZED and learns nothing of this daemon's user", async () => {
    const port = await boot(SERVER_USER);
    const reply = await rawHello(port, {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "shell-main",
      credential: "not-the-token",
      userId: "01OTHERUSERBBBBBBBBBBBBBBB",
    });
    expect(reply.error?.message).toBe("invalid token");
    expect(JSON.stringify(reply)).not.toContain(SERVER_USER);
  });

  it("an AUTHENTICATED hello claiming another user is refused INCOMPATIBLE, with the mismatch said", async () => {
    const port = await boot(SERVER_USER);
    const reply = await rawHello(port, {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "shell-main",
      credential: TOKEN,
      userId: "01OTHERUSERBBBBBBBBBBBBBBB",
    });
    expect(reply.error?.message).toBe("user mismatch");
    expect(reply.error?.data).toMatchObject({ details: { server: SERVER_USER } });
  });

  it("a contracts-major refusal, sent before the credential, carries no server details", async () => {
    const port = await boot(SERVER_USER);
    const reply = await rawHello(port, {
      contractsVersion: "99.0.0",
      minCompatible: "99.0.0",
      clientKind: "shell-main",
    });
    expect(reply.error?.message).toBe("contracts major mismatch");
    expect(JSON.stringify(reply)).not.toContain(CONTRACTS_VERSION);
    expect(JSON.stringify(reply)).not.toContain(SERVER_USER);
  });
});
