// DS-5 — the Loro-level host's primitives, against the spike's REAL
// renderer-written fixtures (test/probes/ice1-envelope), and the one law the
// host exists under: fieldd merges and never interprets, so NOTHING in src/
// links ICE or strata.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { hasIce1Magic, liftIce1, wrapIce1 } from "../src/ice1-envelope";
import {
  covers,
  decodeVersion,
  EMPTY_VERSION,
  HostedDoc,
  LoroHost,
  loroBlobMode,
  snapshotVersion,
  updateCarriesChanges,
} from "../src/loro-host";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = join(HERE, "..");
const FIXTURES = join(HERE, "probes", "ice1-envelope", "fixtures");
const fixture = (file: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, file)));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(name)) out.push(path);
  }
  return out;
}

describe("the host merges and never interprets (DS-D18, B3 shape A's protection)", () => {
  it("no file under fieldd/src imports ICE or strata, and the package does not depend on them", () => {
    const offenders: string[] = [];
    for (const file of sources(join(PACKAGE, "src"))) {
      const text = readFileSync(file, "utf8");
      if (
        /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']@vibecook\/(?:ice|strata-ecs)(?:["'/])/.test(
          text,
        )
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
    const pkg = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      expect(Object.keys(pkg[field] ?? {})).not.toContain("@vibecook/ice");
      expect(Object.keys(pkg[field] ?? {})).not.toContain("@vibecook/strata-ecs");
    }
  });
});

describe("ice1-envelope — the fixed frame rule", () => {
  it("lifts every real checkpoint and re-wraps it byte for byte", () => {
    for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith(".ice1"))) {
      const bytes = fixture(file);
      const lifted = liftIce1(bytes);
      if (!lifted.ok) throw new Error(`${file}: ${lifted.reason}`);
      expect(loroBlobMode(lifted.payload)).toBe("snapshot");
      expect(
        Buffer.compare(Buffer.from(wrapIce1(lifted.header, lifted.payload)), Buffer.from(bytes)),
      ).toBe(0);
    }
  });

  it("names why a frame is not one it can lift — the opaque-custody cases", () => {
    // The test suites' synthetic checkpoint: magic, then text. Custody stays opaque.
    const synthetic = new Uint8Array([
      0x49,
      0x43,
      0x45,
      0x31,
      ...new TextEncoder().encode("board"),
    ]);
    expect(hasIce1Magic(synthetic)).toBe(true);
    expect(liftIce1(synthetic)).toEqual({ ok: false, reason: "version" });
    expect(liftIce1(new Uint8Array([1, 2, 3]))).toEqual({ ok: false, reason: "magic" });
    expect(liftIce1(new Uint8Array([0x49, 0x43, 0x45, 0x31, 1]))).toEqual({
      ok: false,
      reason: "truncated",
    });
    const overrun = wrapIce1(new Uint8Array(4), new Uint8Array(0)).slice(0, 11);
    expect(liftIce1(overrun)).toEqual({ ok: false, reason: "header-overrun" });
  });
});

describe("loro-host — versions, imports, exports", () => {
  it("a full snapshot's header states the version it brings", () => {
    const lifted = liftIce1(fixture("a-checkpoint-1.ice1"));
    if (!lifted.ok) throw new Error(lifted.reason);
    const doc = new LoroDoc();
    doc.import(lifted.payload);
    const stated = snapshotVersion(lifted.payload);
    expect(stated).not.toBeNull();
    expect(doc.oplogVersion().compare(stated as NonNullable<typeof stated>)).toBe(0);
    expect(snapshotVersion(fixture("a-update-1.loro"))).toBeNull();
    expect(loroBlobMode(new Uint8Array([9, 9, 9]))).toBeNull();
  });

  it("an import reports what it changed and what it holds pending", () => {
    const lifted = liftIce1(fixture("a-checkpoint-0.ice1"));
    if (!lifted.ok) throw new Error(lifted.reason);
    const host = new LoroHost();
    const a = host.set(new HostedDoc("doc-a"));
    expect(a.isEmpty()).toBe(true);
    // An update before its base: held, not applied.
    const early = a.import(fixture("a-update-2.loro"));
    expect(early).toMatchObject({ changed: false, pending: true });
    const base = a.import(lifted.payload);
    expect(base.changed).toBe(true);
    const next = a.import(fixture("a-update-1.loro"));
    expect(next.changed).toBe(true); // and it resolved the held record with it
    expect(next.pending).toBe(false);
    const again = a.import(fixture("a-update-2.loro"));
    expect(again).toMatchObject({ changed: false, pending: false });
    expect(host.get("doc-a")).toBe(a);
    expect(host.ids()).toEqual(["doc-a"]);
  });

  it("exportSince answers exactly what a holder lacks — and nothing, once it lacks nothing", () => {
    const lifted = liftIce1(fixture("a-checkpoint-1.ice1"));
    if (!lifted.ok) throw new Error(lifted.reason);
    const a = new HostedDoc("a");
    a.import(lifted.payload);
    const b = new HostedDoc("b");
    expect(a.isAheadOf(b.version())).toBe(true);
    const wire = decodeVersion(b.encodedVersion());
    expect(wire).not.toBeNull();
    const answer = a.exportSince(wire ?? EMPTY_VERSION());
    expect(updateCarriesChanges(answer)).toBe(true);
    b.import(answer);
    expect(covers(b.version(), a.version())).toBe(true);
    expect(a.holdsAll(b.version())).toBe(true);
    expect(updateCarriesChanges(a.exportSince(b.version()))).toBe(false);
    expect(decodeVersion(new Uint8Array([0xff, 0xff, 0xff]))).toBeNull();
  });
});

describe("DS-5c — a hosted doc knows what it holds pending (eviction's guard)", () => {
  it("holds a span pending until the base that resolves it lands", () => {
    const writer = new LoroDoc();
    writer.setPeerId(7n);
    writer.getMap("m").set("x", 1);
    writer.commit();
    const v1 = writer.oplogVersion();
    const first = writer.export({ mode: "update" });
    writer.getMap("m").set("y", 2);
    writer.commit();
    const second = writer.export({ mode: "update", from: v1 });

    const hosted = new HostedDoc("doc");
    expect(hosted.hasPending()).toBe(false);
    expect(hosted.import(second).pending).toBe(true);
    expect(hosted.hasPending()).toBe(true);
    hosted.import(first);
    expect(hosted.hasPending()).toBe(false);
    expect(hosted.doc.getMap("m").toJSON()).toEqual({ x: 1, y: 2 });
  });
});
