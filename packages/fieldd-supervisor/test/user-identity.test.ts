import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tryAdopt } from "../src/index";
import { createHarness, type Harness } from "./helpers";

// UA-2 — the probe's user gate: identity is stricter than build. A daemon
// whose product.json records a different user — or none at all (pre-UA-2, or
// another root's stray) — is never adopted across the partition.

const USER_A = "01J1QDXWDCQ8Z1H8V0M3S5T9BQ";
const USER_B = "01J1QDY55S3GVMFC0J8B2R7NWE";

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe("UA-2 — probe user gate", () => {
  it("adopts on an exact userId match", async () => {
    const { port } = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, { port, pid: process.pid, extra: { userId: USER_A } });
    const result = await tryAdopt(root, 2_000, undefined, undefined, USER_A);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.info.userId).toBe(USER_A);
      result.client.close();
    }
  });

  it("refuses another user's daemon typed", async () => {
    const { port } = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, { port, pid: process.pid, extra: { userId: USER_B } });
    const result = await tryAdopt(root, 2_000, undefined, undefined, USER_A);
    expect(result).toEqual({ ok: false, failure: "user-mismatch" });
  });

  it("refuses a pre-UA-2 daemon when identity is expected — absent is not a match", async () => {
    const { port } = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, { port, pid: process.pid });
    const result = await tryAdopt(root, 2_000, undefined, undefined, USER_A);
    expect(result).toEqual({ ok: false, failure: "user-mismatch" });
  });

  it("no expectation keeps pre-UA-2 adoption working (compat)", async () => {
    const { port } = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, { port, pid: process.pid });
    const result = await tryAdopt(root, 2_000);
    expect(result.ok).toBe(true);
    if (result.ok) result.client.close();
  });
});
