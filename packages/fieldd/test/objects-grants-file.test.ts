import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { CUSTODY } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { RecordSigner, UNREADABLE_WORDS } from "../src/signed-record";
import {
  capture,
  cleanupWorlds,
  type DeskWorld,
  type LoggedEvents,
  survivor,
  world,
} from "./desk-fixtures";

// OB custody, C4 (OB-D18 A) — every grant in ONE file, `ObjectGrantsFile` at LAYOUT.OBJECTS_GRANTS_FILE, signed by the
// objects store's signer; an object's record is its name alone and grants nothing (OB-L1). A file that is unsigned,
// edited, unparseable or exposed is set aside and nothing in it is granted. Under custody's `sealed` level the key was
// handed and the file says so: a fieldd at `files` leaves such a file exactly where it is, and the store refuses. So
// that it can, a sealed store never leaves the path empty: it writes the file at boot, before any name.

afterEach(cleanupWorlds);

const MARK = CUSTODY.MARK_OBJECT_GRANTS;
const SPARK = "sp-7k2m9q4x";
/** A record key as a spawner hands it (`CustodyHandoff.records`): 32 bytes, and plainly nobody's. */
const HANDED = Buffer.alloc(32, 0x11);

interface OnDisk {
  format: number;
  sealed: boolean;
  generation: number;
  grants: { ref: string; holder: string; how: string; at: number }[];
  signature?: string;
}

const grantsOf = (h: DeskWorld): OnDisk => JSON.parse(readFileSync(h.grantsPath, "utf8"));
const nameOf = (ref: string) => `${ref.slice("vf:obj/".length)}.json`;
const recordOf = (h: DeskWorld, ref: string) => join(h.root, "objects", nameOf(ref));
/** The grants files this world's store set aside for `why`. */
const asideOf = (h: DeskWorld, why: string) =>
  readdirSync(h.root).filter((name) => name.startsWith(`objects.grants.json.${why}-`));
/** Why the store said it set a grants file aside, each time it did. */
const setAsideWhys = (events: LoggedEvents) =>
  events.filter((e) => e.event === "fieldd.objects.grants_set_aside").map((e) => e.attrs?.why);

/** A world whose spark, Vela, thinks in run-1, and a note handed to her: a grant that outlives a restart. */
function handedToVela(opts: Parameters<typeof world>[0] = {}) {
  const h = world(opts);
  h.sparks.set(SPARK, "Vela");
  h.sparkRuns.set("run-1", SPARK);
  h.runs.set("run-1", "live");
  const ref = h.refOf("k1", "desk.note");
  h.desk.hand(ref, "run-1");
  return { h, ref };
}

/** Vela's next run, launched by the fieldd running now. */
function wake(h: DeskWorld, run = "run-2") {
  h.sparkRuns.set(run, SPARK);
  h.runs.set(run, "live");
  return run;
}

describe("every grant is in one file (OB custody, C4)", () => {
  it("a grant is in the grants file, never in an object's record", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    const record = JSON.parse(readFileSync(recordOf(h, ref), "utf8"));
    expect(Object.keys(record).sort()).toEqual([
      "docId",
      "format",
      "key",
      "kind",
      "ref",
      "signature",
    ]);
    const file = grantsOf(h);
    expect(file).toMatchObject({
      format: 1,
      sealed: false,
      generation: 1,
      grants: [{ ref, holder: "run-a", how: "handed" }],
    });
    expect(file.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(h.grantsPath).mode & 0o777).toBe(0o600);
    // beside the objects' folder, never in it: the store reads every .json there as an object's record
    expect(readdirSync(join(h.root, "objects"))).toEqual([nameOf(ref)]);
  });

  it("is where a restart finds a spark's grant, for the spark's next run", () => {
    const { h, ref } = handedToVela();
    const again = h.reopen();
    again.reconcile();
    expect(again.grantOf(ref, wake(h))?.how).toBe("handed");
    expect(again.grants(ref)).toEqual([
      expect.objectContaining({ ref, holder: `spark:${SPARK}`, name: "Vela", how: "handed" }),
    ]);
  });

  it("grants nothing for an object the store no longer names", () => {
    const { h, ref } = handedToVela();
    rmSync(recordOf(h, ref));
    const again = h.reopen();
    expect(again.grantOf(ref, wake(h))).toBeUndefined();
    expect(again.grants()).toEqual([]);
  });
});

describe("an edited grants file is set aside (OB custody, C4)", () => {
  const edits: Record<string, (h: DeskWorld, ref: string) => void> = {
    // an agent gives itself the object
    forged: (h, ref) => {
      const file = grantsOf(h);
      file.grants.push({ ref, holder: "spark:sp-evil0000", how: "handed", at: 1 });
      writeFileSync(h.grantsPath, JSON.stringify(file), { mode: 0o600 });
    },
    unsigned: (h) => {
      const { signature: _gone, ...bare } = grantsOf(h);
      writeFileSync(h.grantsPath, JSON.stringify(bare), { mode: 0o600 });
    },
    unreadable: (h) => writeFileSync(h.grantsPath, "{ not json", { mode: 0o600 }),
    exposed: (h) => chmodSync(h.grantsPath, 0o644),
  };

  it.each(Object.keys(edits))("an edited grants file is set aside: %s", (why) => {
    const events: LoggedEvents = [];
    const { h, ref } = handedToVela({ logger: capture(events) });
    edits[why]?.(h, ref);
    const again = h.reopen();
    h.sparks.set("sp-evil0000", "Evil");
    h.sparkRuns.set("run-evil", "sp-evil0000");
    h.runs.set("run-evil", "live");
    // not what the agent wrote, and not what the person had granted either: nothing in the file is granted
    expect(again.grantOf(ref, "run-evil")).toBeUndefined();
    expect(again.grantOf(ref, wake(h))).toBeUndefined();
    expect(again.grants()).toEqual([]);
    expect(existsSync(h.grantsPath)).toBe(false);
    expect(asideOf(h, why)).toHaveLength(1);
    expect(setAsideWhys(events)).toEqual([why]);
    // the names are untouched: a name grants nothing
    expect(again.registry.get(ref)?.key).toBe("k1");
  });

  it("sets aside a file its own key signed that is no grants file", () => {
    const { h, ref } = handedToVela();
    const signer = new RecordSigner({ keyPath: join(h.root, "objects.key") });
    const body = { format: 1, sealed: false, generation: 9, grants: "everything" };
    const signed = { ...body, signature: signer.sign(body) };
    writeFileSync(h.grantsPath, JSON.stringify(signed), { mode: 0o600 });
    const again = h.reopen();
    expect(again.grantOf(ref, wake(h))).toBeUndefined();
    expect(asideOf(h, "unreadable")).toHaveLength(1);
  });

  it("holds a grants file a newer VibeField wrote: never served, never written over, and a hand is refused", () => {
    const { h, ref } = handedToVela();
    const signer = new RecordSigner({ keyPath: join(h.root, "objects.key") });
    const { signature: _gone, ...body } = grantsOf(h);
    const newer = { ...body, format: 2 };
    const bytes = JSON.stringify({ ...newer, signature: signer.sign(newer) });
    writeFileSync(h.grantsPath, bytes, { mode: 0o600 });
    const again = h.reopen();
    expect(again.grantOf(ref, wake(h))).toBeUndefined();
    expect(() => again.hand(ref, "run-2")).toThrow(UNREADABLE_WORDS.objects);
    expect(again.grantOf(ref, "run-2")).toBeUndefined();
    expect(readFileSync(h.grantsPath, "utf8")).toBe(bytes);
  });
});

describe("the key that signs it (OB custody, C4: `files` and `sealed`)", () => {
  it("a sealed store signs with the key it was handed, says so in the file, and never writes objects.key", () => {
    const { h } = handedToVela({ key: HANDED });
    expect(grantsOf(h).sealed).toBe(true);
    expect(existsSync(join(h.root, "objects.key"))).toBe(false);
    expect(readdirSync(h.root).sort()).toEqual(["objects", "objects.grants.json"]);
    // what it wrote verifies under the handed key, read by a signer that was handed the same one
    const signer = new RecordSigner({ keyPath: join(h.root, "never.key"), key: HANDED });
    expect(signer.read(h.grantsPath)).toMatchObject({ body: { sealed: true, generation: 1 } });
    expect(existsSync(join(h.root, "never.key"))).toBe(false);
  });

  it("a files store signs with its key file, and says the file is not sealed", () => {
    const { h } = handedToVela();
    expect(grantsOf(h).sealed).toBe(false);
    const signer = new RecordSigner({ keyPath: join(h.root, "objects.key") });
    expect(signer.read(h.grantsPath)).toMatchObject({ body: { sealed: false, generation: 1 } });
  });

  it("a store it holds no key for is left where it is: a files fieldd leaves a sealed grants file, and refuses in the objects' words", () => {
    const events: LoggedEvents = [];
    const { h, ref } = handedToVela({ key: HANDED, logger: capture(events) });
    const bytes = readFileSync(h.grantsPath, "utf8");
    const names = readdirSync(join(h.root, "objects"));
    // a fieldd that was handed nothing: a dev build on this root, or a copy an agent started
    const files = h.reopen({ key: undefined });
    expect(() => files.registry.readable()).toThrow(UNREADABLE_WORDS.objects);
    expect(() => files.registry.refFor("doc-main", "k2")).toThrow(UNREADABLE_WORDS.objects);
    expect(files.grants()).toEqual([]);
    expect(files.registry.get(ref)).toBeUndefined();
    expect(files.grantOf(ref, wake(h))).toBeUndefined();
    // nothing is moved, judged or made: not the file, not one name (each would read as forged), not a key of its own
    expect(readFileSync(h.grantsPath, "utf8")).toBe(bytes);
    expect(readdirSync(join(h.root, "objects"))).toEqual(names);
    expect(readdirSync(h.root).sort()).toEqual(["objects", "objects.grants.json"]);
    expect(events.map((e) => e.event)).toContain("fieldd.objects.grants_sealed");
    // the fieldd that is handed the key again finds everything as it left it
    const sealed = h.reopen();
    expect(sealed.grantOf(ref, wake(h, "run-3"))?.how).toBe("handed");
  });

  it("a files fieldd leaves a sealed grants file where it is even exposed, or with its signature gone", () => {
    const spoils: ((h: DeskWorld) => void)[] = [
      (h) => chmodSync(h.grantsPath, 0o644),
      (h) => {
        const { signature: _gone, ...bare } = grantsOf(h);
        writeFileSync(h.grantsPath, JSON.stringify(bare), { mode: 0o600 });
      },
    ];
    for (const spoil of spoils) {
      const { h } = handedToVela({ key: HANDED });
      spoil(h);
      const bytes = readFileSync(h.grantsPath, "utf8");
      const files = h.reopen({ key: undefined });
      expect(() => files.registry.readable()).toThrow(UNREADABLE_WORDS.objects);
      expect(readFileSync(h.grantsPath, "utf8")).toBe(bytes);
      expect(readdirSync(h.root).sort()).toEqual(["objects", "objects.grants.json"]);
    }
  });

  it("a sealed fieldd sets aside a grants file its key does not verify", () => {
    const events: LoggedEvents = [];
    // written at `files`, under the key file
    const { h, ref } = handedToVela({ logger: capture(events) });
    const sealed = h.reopen({ key: HANDED });
    expect(sealed.grantOf(ref, wake(h))).toBeUndefined();
    expect(sealed.grants()).toEqual([]);
    expect(asideOf(h, "forged")).toHaveLength(1);
    expect(setAsideWhys(events)).toEqual(["forged"]);
    // and the path is not left empty: the sealed store's own file stands there now, at the mark
    expect(grantsOf(h)).toMatchObject({ sealed: true, generation: 1, grants: [] });
  });

  it("a sealed fieldd sets aside a grants file another handed key signed", () => {
    const { h, ref } = handedToVela({ key: HANDED });
    const other = h.reopen({ key: Buffer.alloc(32, 0x22) });
    expect(other.grantOf(ref, wake(h))).toBeUndefined();
    expect(asideOf(h, "forged")).toHaveLength(1);
  });

  it("at `sealed`, a file its key signed that does not say sealed is set aside as forged", () => {
    const events: LoggedEvents = [];
    const { h, ref } = handedToVela({ key: HANDED, logger: capture(events) });
    // the sealed store only ever writes `sealed: true`; the word is under the signature, and this is the belt
    const signer = new RecordSigner({ keyPath: join(h.root, "never.key"), key: HANDED });
    const { signature: _gone, ...body } = grantsOf(h);
    const unsealed = { ...body, sealed: false };
    const signed = { ...unsealed, signature: signer.sign(unsealed) };
    writeFileSync(h.grantsPath, JSON.stringify(signed), { mode: 0o600 });
    const again = h.reopen();
    expect(again.grantOf(ref, wake(h))).toBeUndefined();
    expect(asideOf(h, "forged")).toHaveLength(1);
    expect(setAsideWhys(events)).toEqual(["forged"]);
  });

  it("at `files`, a file that says sealed is left even when the store's own key file signed it", () => {
    const { h } = handedToVela();
    const signer = new RecordSigner({ keyPath: join(h.root, "objects.key") });
    const { signature: _gone, ...body } = grantsOf(h);
    const claimed = { ...body, sealed: true };
    const bytes = JSON.stringify({ ...claimed, signature: signer.sign(claimed) });
    writeFileSync(h.grantsPath, bytes, { mode: 0o600 });
    const again = h.reopen();
    expect(() => again.registry.readable()).toThrow(UNREADABLE_WORDS.objects);
    expect(readFileSync(h.grantsPath, "utf8")).toBe(bytes);
  });
});

describe("a sealed store never leaves the path empty (OB custody, C4)", () => {
  /** A disk whose write of the grants file can be made to fail. */
  function disk(failing: boolean) {
    const state = { failing };
    return {
      state,
      writeFile: (path: string, text: string) => {
        if (state.failing) throw Object.assign(new Error("ENOSPC: no space"), { code: "ENOSPC" });
        writeFileSync(path, text, { mode: 0o600 });
      },
    };
  }

  it("a sealed store with names and no grant yet leaves a grants file, so a files fieldd refuses and its names stay where they are", () => {
    const h = world({ key: HANDED });
    // written at boot, before any name: empty, at the mark. It is no change: nothing is counted, nobody is told.
    expect(grantsOf(h)).toMatchObject({ format: 1, sealed: true, generation: 0, grants: [] });
    expect(h.marks.noted).toEqual([]);
    const ref = h.refOf("k1", "desk.note");
    const names = readdirSync(join(h.root, "objects"));
    const record = readFileSync(recordOf(h, ref), "utf8");
    const files = h.reopen({ key: undefined });
    expect(() => files.registry.readable()).toThrow(UNREADABLE_WORDS.objects);
    expect(readdirSync(join(h.root, "objects"))).toEqual(names);
    expect(readFileSync(recordOf(h, ref), "utf8")).toBe(record);
    // the fieldd that is handed the key again still knows the name
    expect(h.reopen().registry.get(ref)?.key).toBe("k1");
  });

  it("writes it at the mark and not above, and a file at its mark is not stale", () => {
    const marks = survivor({ [MARK]: 7 });
    const h = world({ key: HANDED, marks });
    expect(grantsOf(h).generation).toBe(7);
    expect(marks.noted).toEqual([]);
    const again = h.reopen();
    expect(asideOf(h, "stale")).toEqual([]);
    // the first change is the first count above it
    const ref = again.registry.refFor("doc-main", "k1", "desk.note");
    h.runs.set("run-new", "live");
    expect(again.hand(ref, "run-new")).toEqual({ handed: true });
    expect(grantsOf(h).generation).toBe(8);
  });

  it("a files store writes nothing at boot, or for a name", () => {
    const h = world();
    h.refOf("k1", "desk.note");
    expect(existsSync(h.grantsPath)).toBe(false);
  });

  it("a boot write the disk will not take refuses nothing, and is made again before the next name", () => {
    const events: LoggedEvents = [];
    const { state, writeFile } = disk(true);
    const h = world({ key: HANDED, writeFile, logger: capture(events) });
    expect(existsSync(h.grantsPath)).toBe(false);
    expect(() => h.desk.registry.readable()).not.toThrow();
    expect(events.map((e) => e.event)).toContain("fieldd.objects.grants_unwritten");
    state.failing = false;
    const ref = h.refOf("k1", "desk.note");
    expect(grantsOf(h)).toMatchObject({ sealed: true, generation: 0, grants: [] });
    expect(existsSync(recordOf(h, ref))).toBe(true);
  });

  it("writes it again before a name when a take-back lost the file", () => {
    const { state, writeFile } = disk(false);
    const h = world({ key: HANDED, writeFile, retryMs: 60_000 });
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    state.failing = true;
    h.desk.takeBack(ref, "run-a");
    expect(existsSync(h.grantsPath)).toBe(false);
    state.failing = false;
    h.refOf("k2", "desk.note");
    // memory as it stands, at the count the take-back was told at: no new count for a name
    expect(grantsOf(h)).toMatchObject({ sealed: true, generation: 2, grants: [] });
    expect(h.desk.kept).toBe(true);
  });
});

describe("what says sealed is read with care (OB custody, C4)", () => {
  it.skipIf(process.platform === "win32")(
    "does not follow a link to a file that says sealed: a link takes the ordinary road",
    () => {
      const { h } = handedToVela();
      const elsewhere = join(h.root, "elsewhere.json");
      const says = JSON.stringify({ sealed: true });
      writeFileSync(elsewhere, says, { mode: 0o600 });
      rmSync(h.grantsPath);
      symlinkSync(elsewhere, h.grantsPath);
      const again = h.reopen();
      // not left and refused: read as any file there is, found unsigned, and set aside (the link, not what it names)
      expect(() => again.registry.readable()).not.toThrow();
      expect(asideOf(h, "unsigned")).toHaveLength(1);
      expect(existsSync(h.grantsPath)).toBe(false);
      expect(readFileSync(elsewhere, "utf8")).toBe(says);
    },
  );

  it("reads no more than its bound: a file past it takes the ordinary road", () => {
    const { h } = handedToVela();
    // valid JSON that says sealed, padded past the 4 MiB the peek reads
    const padded = `${JSON.stringify({ sealed: true })}${" ".repeat(4 * 1024 * 1024)}`;
    writeFileSync(h.grantsPath, padded, { mode: 0o600 });
    const again = h.reopen();
    expect(() => again.registry.readable()).not.toThrow();
    expect(asideOf(h, "unsigned")).toHaveLength(1);
  });

  it("takes only `sealed: true` itself for a sealed file: anything else is set aside as any file is", () => {
    for (const sealed of ["true", 1, null]) {
      const { h } = handedToVela();
      writeFileSync(h.grantsPath, JSON.stringify({ sealed }), { mode: 0o600 });
      const again = h.reopen();
      expect(() => again.registry.readable()).not.toThrow();
      expect(asideOf(h, "unsigned")).toHaveLength(1);
    }
  });
});

describe("a hand that cannot be written is refused (OB custody, C4)", () => {
  it("grants nothing in memory that a restart would not find", () => {
    let failing = false;
    const h = world({
      writeFile: (path, text) => {
        if (failing) throw Object.assign(new Error("EROFS: read-only"), { code: "EROFS" });
        writeFileSync(path, text, { mode: 0o600 });
      },
    });
    const ref = h.refOf("k1", "desk.note");
    const other = h.refOf("k2", "desk.note");
    h.desk.hand(other, "run-b");
    failing = true;
    expect(() => h.desk.hand(ref, "run-a")).toThrow("EROFS");
    expect(h.desk.grantOf(ref, "run-a")).toBeUndefined();
    expect(h.desk.grants(ref)).toEqual([]);
    // what the file held before stands, at the count it had: a refused hand is no change
    expect(grantsOf(h)).toMatchObject({
      generation: 1,
      grants: [{ ref: other, holder: "run-b" }],
    });
    expect(h.desk.kept).toBe(true);
    failing = false;
    expect(h.desk.hand(ref, "run-a")).toEqual({ handed: true });
    expect(grantsOf(h).generation).toBe(2);
  });
});
