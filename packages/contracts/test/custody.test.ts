// OB custody (custody.ts; mgmt.ts `NativeBootstrap` and `NativeMarksSet*`; envelope.ts `HelloAck.marks`; registries.ts
// `CUSTODY`). The shapes' own rows: what a spawner hands a daemon, the level a daemon says it runs at, the marks and
// their one verb, and the inputs of the shell pairing's vector. The vector's two MACs are not read here: contracts
// holds no recipe, and the maker's test and the verifier's are the ones that compute them.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CustodyHandoff, CustodyLevel, CustodyMarksFrame, CustodySecret } from "../src/custody";
import { HelloAck, PairingMac } from "../src/envelope";
import { METHODS } from "../src/methods";
import { NativeBootstrap, NativeMarksSetParams, NativeMarksSetResult } from "../src/mgmt";
import { CUSTODY, ENV_PREFIXES, TAILNET_SCOPES } from "../src/registries";
import { ProductInfo } from "../src/shell";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const record = (name: string) => fixture(name) as Record<string, unknown>;
const without = (whole: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(whole).filter(([k]) => k !== key));

describe("OB custody — what a spawner hands fieldd", () => {
  it("carries three secrets and the marks its spawner remembers, on one line a daemon will read", () => {
    const handoff = CustodyHandoff.parse(fixture("custody-handoff.valid.json"));
    expect(handoff.v).toBe(1);
    expect(new Set([handoff.shell, handoff.pairing, handoff.records]).size).toBe(3);
    expect(handoff.expect).toEqual({ [CUSTODY.MARK_OBJECT_GRANTS]: 7 });
    // a spawner that remembers no mark leaves `expect` out
    const first = CustodyHandoff.parse(fixture("custody-handoff.no-marks.json"));
    expect(first.expect).toBeUndefined();
    const line = `${JSON.stringify(handoff)}\n`;
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(CUSTODY.HANDOFF_MAX_BYTES);
  });

  it("refuses a secret that is not 32 bytes of lowercase hex", () => {
    const good = "a3".repeat(32);
    expect(CustodySecret.safeParse(good).success).toBe(true);
    const bad = [good.slice(2), `${good}a3`, good.toUpperCase(), `${good.slice(2)}zz`, ""];
    for (const secret of bad) {
      expect(CustodySecret.safeParse(secret).success, secret).toBe(false);
    }
  });

  it("refuses a hand-off missing a secret, of another version, or with a mark that is no count", () => {
    const whole = record("custody-handoff.valid.json");
    for (const key of ["v", "shell", "pairing", "records"]) {
      expect(CustodyHandoff.safeParse(without(whole, key)).success, key).toBe(false);
    }
    expect(CustodyHandoff.safeParse({ ...whole, v: 2 }).success).toBe(false);
    for (const value of [-1, 1.5, "7", null]) {
      const marked = { ...whole, expect: { [CUSTODY.MARK_OBJECT_GRANTS]: value } };
      expect(CustodyHandoff.safeParse(marked).success, String(value)).toBe(false);
    }
  });

  it("names two levels, and product.json says one or says nothing", () => {
    expect(CustodyLevel.options).toEqual(["files", "sealed"]);
    const product = {
      port: 49213,
      pid: 84217,
      bootId: "fieldd-1a2b3c4d5e6f7a8b",
      contractsVersion: "0.1.0",
      startedAt: 1753203698123,
      nativePid: null,
    };
    expect(ProductInfo.parse({ ...product, custody: "sealed" }).custody).toBe("sealed");
    expect(ProductInfo.parse({ ...product, custody: "files" }).custody).toBe("files");
    // a daemon from before custody says nothing, and its file still reads
    expect(ProductInfo.parse(product).custody).toBeUndefined();
    expect(ProductInfo.safeParse({ ...product, custody: "keychain" }).success).toBe(false);
  });

  it("puts both flags under the prefixes an agent's PTY is stripped of, with one value", () => {
    for (const name of [CUSTODY.ENV, CUSTODY.NATIVE_ENV]) {
      const stripped = ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
      expect(stripped, name).toBe(true);
    }
    expect(CUSTODY.ENV).not.toBe(CUSTODY.NATIVE_ENV);
    expect(CUSTODY.STDIN).toBe("stdin");
    expect(new Set(Object.values(CUSTODY.LABELS)).size).toBe(3);
  });
});

describe("OB custody — the floor's half", () => {
  it("hands the floor its pairing secret in a line of its own", () => {
    const line = NativeBootstrap.parse(fixture("native-bootstrap.valid.json"));
    expect(line).toEqual({ v: 1, pairing: "b4".repeat(32) });
    // the secret the hand-off carries for the floor, and nothing else of it
    const handoff = CustodyHandoff.parse(fixture("custody-handoff.valid.json"));
    expect(line.pairing).toBe(handoff.pairing);
    expect(Object.keys(NativeBootstrap.shape)).toEqual(["v", "pairing"]);
    const bytes = Buffer.byteLength(`${JSON.stringify(line)}\n`);
    expect(bytes).toBeLessThanOrEqual(CUSTODY.HANDOFF_MAX_BYTES);
  });

  it("refuses a bootstrap of another version or without a whole secret", () => {
    const line = record("native-bootstrap.valid.json");
    for (const v of [0, 2, 1.5, "1"]) {
      expect(NativeBootstrap.safeParse({ ...line, v }).success, String(v)).toBe(false);
    }
    expect(NativeBootstrap.safeParse(without(line, "v")).success).toBe(false);
    expect(NativeBootstrap.safeParse(without(line, "pairing")).success).toBe(false);
    expect(NativeBootstrap.safeParse({ ...line, pairing: "b4".repeat(31) }).success).toBe(false);
  });

  it("sets a mark by a name on the registry's pattern and a count, and answers the mark", () => {
    const set = NativeMarksSetParams.parse(fixture("native-marks-set-params.valid.json"));
    expect(set).toEqual({ name: CUSTODY.MARK_OBJECT_GRANTS, value: 8 });
    const kept = NativeMarksSetResult.parse(fixture("native-marks-set-result.valid.json"));
    expect(kept.value).toBe(8);
    expect(new RegExp(CUSTODY.MARK_NAME).test(CUSTODY.MARK_OBJECT_GRANTS)).toBe(true);
    const longest = `a${"b".repeat(63)}`;
    expect(NativeMarksSetParams.safeParse({ name: longest, value: 0 }).success).toBe(true);
    const names = ["", "Objects.grants", "9lives", "a b", "objects/grants", `${longest}b`];
    for (const name of names) {
      expect(NativeMarksSetParams.safeParse({ name, value: 1 }).success, name).toBe(false);
    }
    for (const value of [-1, 1.5, "8"]) {
      const params = { name: CUSTODY.MARK_OBJECT_GRANTS, value };
      expect(NativeMarksSetParams.safeParse(params).success, String(value)).toBe(false);
    }
    expect(NativeMarksSetResult.safeParse({ value: -1 }).success).toBe(false);
  });

  it("lets the hello ack carry the floor's marks, and say nothing when it holds none", () => {
    const ack = HelloAck.parse(fixture("hello-ack.marks.json"));
    expect(ack.marks).toEqual({ [CUSTODY.MARK_OBJECT_GRANTS]: 8 });
    expect(HelloAck.parse(fixture("hello-ack.pid.json")).marks).toBeUndefined();
    expect("marks" in record("hello-ack.pid.json")).toBe(false);
    const floor = { contractsVersion: "0.1.0", serverKind: "field-native", grantedScopes: [] };
    expect(HelloAck.safeParse({ ...floor, marks: { "objects.grants": -1 } }).success).toBe(false);
    expect(HelloAck.safeParse({ ...floor, marks: ["objects.grants"] }).success).toBe(false);
  });

  it("declares the marks verb on the mgmt surface, idempotent as a mark is", () => {
    expect(METHODS.find((m) => m.method === "native.marks.set")).toEqual({
      surface: "mgmt",
      method: "native.marks.set",
      scope: null,
      idempotent: true,
      locality: "local",
    });
  });
});

describe("OB custody — fieldd's marks, as the shell hears them", () => {
  it("frames every mark whole, and an empty record when fieldd holds none", () => {
    const frame = CustodyMarksFrame.parse(fixture("custody-marks.valid.json"));
    expect(frame.marks).toEqual({ [CUSTODY.MARK_OBJECT_GRANTS]: 8 });
    expect(CustodyMarksFrame.parse(fixture("custody-marks.empty.json")).marks).toEqual({});
    expect(CustodyMarksFrame.safeParse({}).success).toBe(false);
  });

  it("declares the stream local and under the mint's scope, which no tailnet preset holds", () => {
    const stream = METHODS.find((m) => m.method === "system.custody.marks.subscribe");
    expect(stream).toEqual({
      surface: "product",
      method: "system.custody.marks.subscribe",
      scope: "tokens.mint",
      idempotent: true,
      locality: "local",
      subscription: true,
    });
    const mint = METHODS.find((m) => m.method === "system.mintWindowToken");
    expect(stream?.scope).toBe(mint?.scope);
    expect(TAILNET_SCOPES).not.toContain("tokens.mint");
  });
});

describe("OB custody — the shell's pairing vector", () => {
  const ShellPairingVector = z
    .object({
      note: z.string().min(1),
      secretHex: CustodySecret,
      port: z.number().int().min(1).max(65_535),
      bootId: z.string().min(1),
      userId: z.string(),
      nonce: z.string().regex(new RegExp(`^[0-9a-f]{${CUSTODY.NONCE_HEX}}$`)),
      ts: z.number().int().positive(),
      mac: z.string().min(1),
      ackMac: z.string().min(1),
    })
    .strict();

  it("names every input the recipe reads, each in the form the registry gives it", () => {
    const vector = ShellPairingVector.parse(fixture("shell-pairing.vector.json"));
    // the hello it stands for is the envelope's own PairingMac, with the nonce a shell must send
    const { bootId, ts, mac, nonce } = vector;
    expect(PairingMac.safeParse({ bootId, ts, mac, nonce }).success).toBe(true);
    // two contexts, neither of them D8's: no transcript replays the other way or at the floor
    const contexts = [CUSTODY.SHELL_CONTEXT, CUSTODY.SHELL_ACK_CONTEXT, "fn-boot", "fn-ack"];
    expect(new Set(contexts).size).toBe(4);
    expect(vector.note).toContain(`'${CUSTODY.SHELL_CONTEXT}'`);
    expect(vector.note).toContain(`'${CUSTODY.SHELL_ACK_CONTEXT}'`);
  });
});
