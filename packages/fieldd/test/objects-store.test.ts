import { chmodSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OBJECT_REF_PATTERN } from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import { RecordSigner, UNREADABLE_WORDS } from "../src/signed-record";
import { cleanupWorlds, DOC, world } from "./desk-fixtures";

// OB-3a — the desk's registry and grants: a ref is a name (OB-L1) and only the person's play grants; records are signed
// per object, read once at boot, and a bad one is set aside and never served. Grants outlive the app (EY-D9 B).
// *Moved 2026-11-10 (OB custody, C4):* a record is the object's name alone now. Every grant is in the one grants file
// (objects-grants-file.test.ts), and whose it is after a restart is objects-this-boot.test.ts's; the rows here that
// read a record's `grants` read the desk's own list instead.
//
// Given an injected `bornFor`, `marks` and (where a row gives one) `key`: every row here builds its desk through
// desk-fixtures.ts, which hands the store and the desk those collaborators, and shows the store's rule given them.
// That production binds the real ones is proved by the rows through the real daemon,
// `packages/fieldd/test/custody-boot.test.ts`.

afterEach(cleanupWorlds);

function capture(events: { event: string; attrs: LogFields | undefined }[]): Logger {
  const logger: Logger = {
    child: () => logger,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: (event, _m, attrs) => void events.push({ event, attrs }),
    error: (event, _m, _e, attrs) => void events.push({ event, attrs }),
    fatal: () => undefined,
    isLevelEnabled: () => true,
  };
  return logger;
}

const fileOf = (root: string, ref: string) =>
  join(root, "objects", `${ref.slice("vf:obj/".length)}.json`);

describe("the registry (OB-3a, OB-L1)", () => {
  it("names an object once: eight lowercase characters, the same ref each time", () => {
    const h = world();
    const ref = h.refOf("k1");
    expect(ref).toMatch(OBJECT_REF_PATTERN);
    expect(h.refOf("k1")).toBe(ref);
    expect(h.refOf("k2")).not.toBe(ref);
    expect(h.desk.resolve(ref)).toEqual({ docId: DOC, key: "k1" });
  });

  it("grants nothing by naming: a ref exists with no grants until the person's play", () => {
    const h = world();
    const ref = h.refOf("k1");
    expect(h.desk.registry.grantOf(ref, "run-a")).toBeUndefined();
    expect(h.desk.hand(ref, "run-a")).toEqual({ handed: true });
    expect(h.desk.registry.grantOf(ref, "run-a")?.how).toBe("handed");
    expect(h.desk.registry.grantOf(ref, "run-b")).toBeUndefined();
  });

  it("keeps each record signed, 0600 in a 0700 directory, and a restart finds refs and grants (EY-D9 B)", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    const dir = join(h.root, "objects");
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    for (const file of readdirSync(dir)) expect(statSync(join(dir, file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(fileOf(h.root, ref), "utf8")).signature).toMatch(
      /^[0-9a-f]{64}$/,
    );
    const again = h.reopen();
    expect(again.registry.refFor(DOC, "k1")).toBe(ref);
    expect(again.registry.grantOf(ref, "run-a")?.how).toBe("handed");
    expect(again.registry.get(ref)?.kind).toBe("desk.note");
  });

  it("sets aside, and never serves, a record an edit touched or one copied to another ref", () => {
    const events: { event: string; attrs: LogFields | undefined }[] = [];
    const h = world({ logger: capture(events) });
    const edited = h.refOf("edited");
    const unsigned = h.refOf("unsigned");
    const copied = h.refOf("copied");
    h.desk.hand(edited, "run-a");
    // an agent points the name at another object, so that what was handed for this one would open that one
    const body = JSON.parse(readFileSync(fileOf(h.root, edited), "utf8"));
    body.key = "another-object";
    writeFileSync(fileOf(h.root, edited), JSON.stringify(body));
    const bare = JSON.parse(readFileSync(fileOf(h.root, unsigned), "utf8"));
    delete bare.signature;
    writeFileSync(fileOf(h.root, unsigned), JSON.stringify(bare));
    // a whole record, well signed, under the name of another ref
    writeFileSync(fileOf(h.root, "vf:obj/aaaaaaaa"), readFileSync(fileOf(h.root, copied)));
    chmodSync(fileOf(h.root, "vf:obj/aaaaaaaa"), 0o600);
    const again = h.reopen();
    expect(again.registry.get(edited)).toBeUndefined();
    expect(again.registry.get(unsigned)).toBeUndefined();
    expect(again.registry.get("vf:obj/aaaaaaaa")).toBeUndefined();
    expect(again.registry.get(copied)?.key).toBe("copied");
    expect(existsSync(fileOf(h.root, edited))).toBe(false);
    const whys = events
      .filter((e) => e.event === "fieldd.objects.set_aside")
      .map((e) => e.attrs?.why);
    expect(whys.sort()).toEqual(["forged", "forged", "unsigned"]);
  });

  it("reads what a same-uid agent signed with the store's own key file (EL7: at `files` it holds against an edit, no wall)", () => {
    const h = world();
    const ref = h.refOf("k1");
    h.desk.hand(ref, "run-a");
    // at `files` the key is a 0600 file of the same uid: an agent that reads it writes itself a grant, and it verifies.
    // Custody's `sealed` level is the wall: the key is handed, and is on no disk (objects-grants-file.test.ts).
    const { signature: _gone, ...unsigned } = JSON.parse(readFileSync(h.grantsPath, "utf8"));
    unsigned.grants.push({ ref, holder: "spark:sp-evil0000", how: "handed", at: 1 });
    const signer = new RecordSigner({ keyPath: join(h.root, "objects.key") });
    const signed = { ...unsigned, signature: signer.sign(unsigned) };
    writeFileSync(h.grantsPath, JSON.stringify(signed), { mode: 0o600 });
    expect(h.reopen().registry.grantOf(ref, "spark:sp-evil0000")?.how).toBe("handed");
  });

  it("a disk that does not answer leaves the file where it is and refuses in fieldd's words", () => {
    const failing = world({
      readFile: (path) => {
        if (path.endsWith(".json")) throw Object.assign(new Error("EMFILE"), { code: "EMFILE" });
        return readFileSync(path, "utf8");
      },
    });
    const ref = failing.refOf("k1");
    const again = failing.reopen();
    expect(again.registry.get(ref)).toBeUndefined();
    expect(existsSync(fileOf(failing.root, ref))).toBe(true);
    expect(() => again.registry.readable()).toThrow(UNREADABLE_WORDS.objects);
  });

  it("holds a record a newer VibeField wrote, never serving or overwriting it", () => {
    const h = world();
    const ref = h.refOf("k1");
    const body = JSON.parse(readFileSync(fileOf(h.root, ref), "utf8"));
    const { signature: _gone, ...unsigned } = body;
    const newer = { ...unsigned, format: 2 };
    const signer = new RecordSigner({ keyPath: join(h.root, "objects.key") });
    writeFileSync(fileOf(h.root, ref), JSON.stringify({ ...newer, signature: signer.sign(newer) }));
    const again = h.reopen();
    expect(again.registry.get(ref)).toBeUndefined();
    expect(existsSync(fileOf(h.root, ref))).toBe(true);
  });
});

describe("the person's acts on who holds what (OB-L1, OB-D9)", () => {
  it("refuses a hand to a run that does not exist or has ended, with a reason, and grants nothing", () => {
    const h = world();
    const ref = h.refOf("k1");
    h.runs.set("run-done", "ended");
    expect(h.desk.hand(ref, "run-none")).toEqual({
      handed: false,
      reason: expect.stringContaining("doesn't know that agent"),
    });
    expect(h.desk.hand(ref, "run-done")).toEqual({
      handed: false,
      reason: expect.stringContaining("has ended"),
    });
    expect(h.desk.grants(ref)).toEqual([]);
    expect(h.desk.hand("vf:obj/zzzzzzzz", "run-a")).toEqual({
      handed: false,
      reason: expect.stringContaining("doesn't know that object"),
    });
  });

  it("takes an object back: the grant ends", () => {
    const h = world();
    const ref = h.refOf("k1");
    h.desk.hand(ref, "run-a");
    h.desk.takeBack(ref, "run-a");
    expect(h.desk.registry.grantOf(ref, "run-a")).toBeUndefined();
  });

  it("a `one` kind's hand moves it: the first holder's grant ends, whichever way it had it", () => {
    const h = world();
    const ref = h.refOf("page", "vibefield.page");
    h.desk.hand(ref, "run-a");
    expect(h.desk.hand(ref, "run-b")).toEqual({ handed: true });
    expect(h.desk.registry.grantOf(ref, "run-a")).toBeUndefined();
    expect(h.desk.registry.grantOf(ref, "run-b")?.how).toBe("handed");
    // a kind that takes many keeps both
    const note = h.refOf("note", "desk.note");
    h.desk.hand(note, "run-a");
    h.desk.hand(note, "run-b");
    const holders = h.desk.grants(note).map((g) => g.holder);
    expect(holders.sort()).toEqual(["run-a", "run-b"]);
  });

  it("a hand never weakens what an agent placed", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    h.desk.registry.grant(ref, "run-a", "placed");
    h.desk.hand(ref, "run-a");
    expect(h.desk.registry.grantOf(ref, "run-a")?.how).toBe("placed");
  });

  it("sets aside a record other users could read", () => {
    const h = world();
    const ref = h.refOf("k1");
    chmodSync(fileOf(h.root, ref), 0o644);
    expect(h.reopen().registry.get(ref)).toBeUndefined();
  });
});
