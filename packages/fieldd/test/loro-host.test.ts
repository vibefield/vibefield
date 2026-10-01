// DS-5 — the Loro-level host's primitives, against the spike's REAL
// renderer-written fixtures (test/probes/ice1-envelope), and the one law the
// host exists under: fieldd merges and never interprets, so NOTHING in src/
// links ICE or strata.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LoroDoc, VersionVector } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { hasIce1Magic, liftIce1, wrapIce1 } from "../src/ice1-envelope";
import {
  covers,
  decodeVersion,
  EMPTY_VERSION,
  HostedDoc,
  LoroHost,
  loroBlobMode,
  meetVersions,
  provenVersion,
  snapshotVersion,
  updateCarriesChanges,
  versionFromBase64,
  versionToBase64,
  watermark,
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

// ---- DS-5d — compaction's primitives ----

const vvOf = (entries: Record<string, number>): VersionVector =>
  VersionVector.parseJSON(new Map(Object.entries(entries).map(([p, c]) => [p as `${number}`, c])));
const json = (v: VersionVector): Record<string, number> =>
  Object.fromEntries([...v.toJSON()].map(([p, c]) => [String(p), c]));

/** A doc with history from two peers, as a canvas with two writers has. */
function historied(): { doc: LoroDoc; mid: VersionVector } {
  const one = new LoroDoc();
  one.setPeerId(1n);
  for (let i = 0; i < 4; i += 1) {
    one.getMap("board").set(`k${i}`, i);
    one.commit();
  }
  const two = new LoroDoc();
  two.setPeerId(2n);
  two.import(one.export({ mode: "snapshot" }));
  two.getMap("board").set("two", "yes");
  two.commit();
  one.import(two.export({ mode: "update", from: one.oplogVersion() }));
  const mid = one.oplogVersion();
  one.getMap("board").set("after", "the watermark");
  one.commit();
  return { doc: one, mid };
}

describe("DS-5d — a shallow payload states its version, as a full one does", () => {
  it("snapshotVersion and provenVersion read a shallow snapshot's whole version", () => {
    // A compacted canvas's base is a shallow snapshot, and so is every
    // checkpoint ICE writes once its doc was opened from one (the probe:
    // ICE's own next `put` payload reads "shallow-snapshot"). Reading null
    // here sent the canvas to opaque custody on its first post-compaction save.
    const { doc, mid } = historied();
    const shallow = doc.export({ mode: "shallow-snapshot", frontiers: doc.vvToFrontiers(mid) });
    expect(loroBlobMode(shallow)).toBe("shallow-snapshot");
    expect(json(snapshotVersion(shallow) ?? EMPTY_VERSION())).toEqual(json(doc.oplogVersion()));
    expect(json(provenVersion(shallow) ?? EMPTY_VERSION())).toEqual(json(doc.oplogVersion()));
    // and a doc loaded from it can only export the same species
    const loaded = new LoroDoc();
    loaded.import(shallow);
    expect(loroBlobMode(loaded.export({ mode: "snapshot" }))).toBe("shallow-snapshot");
  });
});

describe("DS-5d — the meet and the watermark", () => {
  it("meetVersions keeps what BOTH hold — a peer one side never heard from is in neither", () => {
    expect(json(meetVersions(vvOf({ 1: 5, 2: 3 }), vvOf({ 1: 2, 2: 7, 3: 1 })))).toEqual({
      1: 2,
      2: 3,
    });
    expect(json(meetVersions(vvOf({ 1: 5 }), EMPTY_VERSION()))).toEqual({});
  });

  it("is the meet of every KNOWN holder's acknowledgement and this desktop's own version", () => {
    const now = 1_800_000_000_000;
    const own = vvOf({ 1: 10, 2: 6 });
    const mark = watermark(
      own,
      [
        { device: "studio", ack: vvOf({ 1: 7, 2: 6 }), seenAt: now },
        { device: "laptop", ack: vvOf({ 1: 9, 2: 4 }), seenAt: now - 10 * 86_400_000 },
      ],
      now,
      30 * 86_400_000,
    );
    expect(mark.ok).toBe(true);
    if (!mark.ok) return;
    expect(json(mark.version)).toEqual({ 1: 7, 2: 4 });
    expect(mark.counted).toEqual(["laptop", "studio"]);
    expect(mark.retired).toEqual([]);
  });

  it("a holder unseen past the horizon is not waited for (DS-D17)", () => {
    const now = 1_800_000_000_000;
    const mark = watermark(
      vvOf({ 1: 10 }),
      [
        { device: "studio", ack: vvOf({ 1: 9 }), seenAt: now },
        { device: "attic", ack: vvOf({ 1: 1 }), seenAt: now - 31 * 86_400_000 },
      ],
      now,
      30 * 86_400_000,
    );
    expect(mark).toMatchObject({ ok: true, counted: ["studio"], retired: ["attic"] });
    if (mark.ok) expect(json(mark.version)).toEqual({ 1: 9 });
  });

  it("a holder that acknowledges nothing, or more than this desktop holds, holds the trim", () => {
    const now = 1_800_000_000_000;
    expect(
      watermark(vvOf({ 1: 10 }), [{ device: "studio", ack: null, seenAt: now }], now, 1),
    ).toMatchObject({ ok: false, reason: "unacknowledged", device: "studio" });
    // The empty version is the same unknown: an open window nobody vouches for.
    expect(
      watermark(vvOf({ 1: 10 }), [{ device: "studio", ack: EMPTY_VERSION(), seenAt: now }], now, 1),
    ).toMatchObject({ ok: false, reason: "unacknowledged", device: "studio" });
    // Ahead of here: it holds ops this desktop lacks, and those may be
    // concurrent with anything this desktop would fold into its base.
    expect(
      watermark(vvOf({ 1: 10 }), [{ device: "studio", ack: vvOf({ 1: 11 }), seenAt: now }], now, 1),
    ).toMatchObject({ ok: false, reason: "ahead-of-here", device: "studio" });
    // Nobody else holds it: the whole history is this desktop's to trim.
    const alone = watermark(vvOf({ 1: 10 }), [], now, 1);
    expect(alone.ok && json(alone.version)).toEqual({ 1: 10 });
  });

  it("an acknowledgement rides the slice as base64 and comes back whole; garbage is null", () => {
    const v = vvOf({ 1: 4, 7: 2 });
    expect(json(versionFromBase64(versionToBase64(v)) ?? EMPTY_VERSION())).toEqual({ 1: 4, 7: 2 });
    expect(versionFromBase64(versionToBase64(EMPTY_VERSION()))?.length()).toBe(0);
    expect(versionFromBase64("")).toBeNull();
    expect(versionFromBase64("////")).toBeNull();
  });
});

describe("DS-5d — a compacted doc: its root, what it can answer, and the trial", () => {
  it("a shallow doc knows its root, and answers a holder only from at or above it", () => {
    const { doc, mid } = historied();
    const full = new HostedDoc("full", doc);
    expect(full.isShallow()).toBe(false);
    expect(full.rootVersion().length()).toBe(0);
    expect(full.canAnswer(EMPTY_VERSION())).toBe(true);
    const compacted = full.compactTo(mid);
    if (!compacted.ok) throw new Error(compacted.reason);
    const shallow = new HostedDoc("shallow", compacted.doc);
    expect(shallow.isShallow()).toBe(true);
    expect(json(shallow.rootVersion())).toEqual(json(mid));
    expect(json(shallow.version())).toEqual(json(doc.oplogVersion()));
    // Loro answers an export "from" below the root FROM the root — a holder
    // there would get ops whose base it can never be sent.
    expect(shallow.canAnswer(EMPTY_VERSION())).toBe(false);
    expect(shallow.canAnswer(mid)).toBe(true);
    expect(shallow.canAnswer(doc.oplogVersion())).toBe(true);
  });

  it("compactTo trial-loads its base: a doc holding an op concurrent with the trim point is refused", () => {
    // Measured (loro-crdt 1.13.8): the shallow export SUCCEEDS and the base it
    // writes cannot be imported ("You cannot switch a document to a version
    // before the shallow history's start version") — a base nobody could open.
    const one = new LoroDoc();
    one.setPeerId(1n);
    one.getMap("board").set("base", "b");
    one.commit();
    const two = new LoroDoc();
    two.setPeerId(2n);
    two.import(one.export({ mode: "snapshot" }));
    one.getMap("board").set("z", "Z");
    one.commit();
    two.getMap("board").set("x", "X"); // concurrent with z
    two.commit();
    const both = new LoroDoc();
    both.import(one.export({ mode: "snapshot" }));
    both.import(two.export({ mode: "snapshot" }));
    const hosted = new HostedDoc("doc", both);
    const refused = hosted.compactTo(one.oplogVersion()); // z in, x out
    expect(refused).toMatchObject({ ok: false, reason: "unloadable" });
    // The host is untouched and healthy.
    expect(hosted.doc.getMap("board").toJSON()).toEqual({ base: "b", z: "Z", x: "X" });
    // At its head nothing is concurrent with the trim point: it compacts.
    const fine = hosted.compactTo(hosted.version());
    expect(fine.ok).toBe(true);
    // A point it does not hold is no point to trim at.
    expect(hosted.compactTo(vvOf({ 9: 1 }))).toMatchObject({ ok: false, reason: "not-held" });
  });
});
