import { FielddClient } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it } from "vitest";
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
