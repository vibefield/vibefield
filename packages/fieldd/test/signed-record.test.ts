import { createHmac, randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "@vibefield/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { RecordSigner } from "../src/signed-record";

// The one record signer (CP-3's first commit; LEANS P3): what SparkStore signs with today, and the needs-you queue and
// the input queues next. What must hold: a record an agent edited does not verify; the key is made once, 0600, and a
// second signer on its file reads the first's; a key other users could read, or a file that holds no key, is set
// aside and replaced in the same call (SessionRecordStore's rule); and the bytes are SparkStore's own, so a key and
// the records it signed before this commit still verify.

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "vf-signer-"));
  dirs.push(dir);
  return dir;
};
const keyIn = (root: string) => join(root, "fieldd", "store.key");
const aside = (root: string, why: string) =>
  readdirSync(join(root, "fieldd")).filter((name) => name.startsWith(`store.key.${why}-`));

const record = { id: "sp-0a1b2c3d4e5f6a7b", name: "Vela", profiles: ["work", "native"] };

/** A record file as a store writes it: the body, then its signature. */
const writeSigned = (path: string, body: object, signature: unknown, mode = 0o600) =>
  writeFileSync(path, `${JSON.stringify({ ...body, signature }, null, 2)}\n`, { mode });

describe("the one record signer: an edit does not verify (CP-3, LEANS P3; EL7)", () => {
  it("signs and verifies under a key made once, 0600 in a 0700 directory, and a second signer reads the first's", () => {
    const root = tmp();
    const signer = new RecordSigner({ keyPath: keyIn(root) });
    const signature = signer.sign(record);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signer.verifies(record, signature)).toBe(true);
    expect(statSync(keyIn(root)).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, "fieldd")).mode & 0o777).toBe(0o700);
    const key = readFileSync(keyIn(root), "utf8");
    const second = new RecordSigner({ keyPath: keyIn(root) });
    expect(second.verifies(record, signature)).toBe(true);
    expect(readFileSync(keyIn(root), "utf8")).toBe(key);
    // the order of a record's keys is not its content (contracts' canonical form)
    expect(
      second.verifies({ profiles: record.profiles, name: "Vela", id: record.id }, signature),
    ).toBe(true);
  });

  it("refuses a record an agent widened, another key's signature, and a signature that is not one", () => {
    const root = tmp();
    const signer = new RecordSigner({ keyPath: keyIn(root) });
    const signature = signer.sign(record);
    expect(signer.verifies({ ...record, profiles: ["work", "native", "home"] }, signature)).toBe(
      false,
    );
    const stranger = new RecordSigner({ keyPath: join(tmp(), "other.key") });
    expect(signer.verifies(record, stranger.sign(record))).toBe(false);
    for (const malformed of ["", "zz", signature.slice(2), `${signature}00`, `${signature}zz`]) {
      expect(signer.verifies(record, malformed)).toBe(false);
    }
    // the same bytes in either case
    expect(signer.verifies(record, signature.toUpperCase())).toBe(true);
  });

  it("signs the bytes SparkStore always signed, so a key and the records it signed before this commit still verify", () => {
    const root = tmp();
    mkdirSync(join(root, "fieldd"), { recursive: true, mode: 0o700 });
    const hex = randomBytes(32).toString("hex");
    // SparkStore's key file: 64 hex characters, no newline
    writeFileSync(keyIn(root), hex, { mode: 0o600 });
    const before = createHmac("sha256", Buffer.from(hex, "hex"))
      .update(canonicalJson(record))
      .digest("hex");
    const signer = new RecordSigner({ keyPath: keyIn(root) });
    expect(signer.sign(record)).toBe(before);
    expect(signer.verifies(record, before)).toBe(true);
    expect(readFileSync(keyIn(root), "utf8")).toBe(hex);
  });
});

describe("the key's rule: SessionRecordStore's, in the one authority (critique 20c)", () => {
  it("sets aside a key other users could read and makes another in the same call; what it signed reads as forged", () => {
    const root = tmp();
    const signature = new RecordSigner({ keyPath: keyIn(root) }).sign(record);
    const exposedKey = readFileSync(keyIn(root), "utf8");
    chmodSync(keyIn(root), 0o644);
    const after = new RecordSigner({ keyPath: keyIn(root) });
    expect(after.verifies(record, signature)).toBe(false);
    expect(readFileSync(keyIn(root), "utf8")).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(keyIn(root), "utf8")).not.toBe(exposedKey);
    expect(statSync(keyIn(root)).mode & 0o777).toBe(0o600);
    // kept beside the store for a human, never deleted
    const [kept, ...more] = aside(root, "exposed");
    expect(more).toEqual([]);
    expect(readFileSync(join(root, "fieldd", kept ?? ""), "utf8")).toBe(exposedKey);
    // and the new key is the one every signer on the file reads from then on
    expect(new RecordSigner({ keyPath: keyIn(root) }).verifies(record, after.sign(record))).toBe(
      true,
    );
  });

  it("sets aside a file that holds no key, and never signs with what it holds", () => {
    for (const held of ["", "not a key", "ab".repeat(31), `${"ab".repeat(32)}zz`]) {
      const root = tmp();
      mkdirSync(join(root, "fieldd"), { recursive: true, mode: 0o700 });
      writeFileSync(keyIn(root), held, { mode: 0o600 });
      const signature = new RecordSigner({ keyPath: keyIn(root) }).sign(record);
      expect(readFileSync(keyIn(root), "utf8")).toMatch(/^[0-9a-f]{64}$/);
      expect(aside(root, "unreadable")).toHaveLength(1);
      expect(new RecordSigner({ keyPath: keyIn(root) }).verifies(record, signature)).toBe(true);
    }
  });

  it("tolerates the newline a hand-written key ends with", () => {
    const root = tmp();
    mkdirSync(join(root, "fieldd"), { recursive: true, mode: 0o700 });
    const hex = randomBytes(32).toString("hex");
    writeFileSync(keyIn(root), `${hex}\n`, { mode: 0o600 });
    const signer = new RecordSigner({ keyPath: keyIn(root) });
    expect(signer.verifies(record, signer.sign(record))).toBe(true);
    expect(readdirSync(join(root, "fieldd"))).toEqual(["store.key"]);
  });
});

describe("a signed file read back: why it is not served", () => {
  it("serves the body without its signature when it verifies", () => {
    const root = tmp();
    const signer = new RecordSigner({ keyPath: keyIn(root) });
    const path = join(root, "fieldd", "record.json");
    writeSigned(path, record, signer.sign(record));
    expect(signer.read(path)).toEqual({ body: record });
  });

  it("refuses an exposed, an unsigned, a forged and an unparseable file, each by its name", () => {
    const root = tmp();
    const signer = new RecordSigner({ keyPath: keyIn(root) });
    const path = join(root, "fieldd", "record.json");
    writeSigned(path, record, signer.sign(record));
    chmodSync(path, 0o640);
    expect(signer.read(path)).toEqual({ why: "exposed" });
    writeFileSync(path, JSON.stringify(record), { mode: 0o600 });
    chmodSync(path, 0o600);
    expect(signer.read(path)).toEqual({ why: "unsigned" });
    writeSigned(path, record, 7);
    expect(signer.read(path)).toEqual({ why: "unsigned" });
    writeSigned(path, { ...record, profiles: ["work", "native", "home"] }, signer.sign(record));
    expect(signer.read(path)).toEqual({ why: "forged" });
    writeFileSync(path, "{ not json", { mode: 0o600 });
    expect(signer.read(path)).toEqual({ why: "unreadable" });
    writeFileSync(path, "null", { mode: 0o600 });
    expect(signer.read(path)).toEqual({ why: "unreadable" });
    expect(signer.read(join(root, "fieldd", "absent.json"))).toEqual({ why: "unreadable" });
  });
});
