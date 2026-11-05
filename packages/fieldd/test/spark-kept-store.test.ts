import {
  chmodSync,
  copyFileSync,
  existsSync,
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
import { SPARK_KEPT_FILE, SPARK_KEPT_FORMAT } from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import { RecordSigner } from "../src/signed-record";
import { SparkKeptStore } from "../src/tool-plane/spark-kept";

// Item 159 (step0-items-158-159.md §4; TH0-Q11 (b)) — the spark's kept record: one signed file in each spark's own
// folder under LAYOUT.SPARK_FILES_DIR, 0600 in 0700, its key its own; an update re-reads first, so a section another
// writer kept meanwhile survives, and so does one this build does not know; a file an edit touched, or one copied into
// another spark's folder, is set aside for a human and never served (EL7, against an edit).

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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

const VELA = "sp-vela00000000";
const KIWI = "sp-kiwi00000000";

function store() {
  const root = mkdtempSync(join(tmpdir(), "vf-spark-kept-"));
  dirs.push(root);
  const dir = join(root, "spark-files");
  const keyPath = join(root, "spark-files.key");
  const events: { event: string; attrs: LogFields | undefined }[] = [];
  const open = () => new SparkKeptStore({ dir, keyPath, logger: capture(events) });
  const file = (spark: string) => join(dir, spark, SPARK_KEPT_FILE);
  /** a record as a fieldd before this one kept it: signed with the store's key, in the spark's folder */
  const seed = (spark: string, body: Record<string, unknown> = {}) => {
    mkdirSync(join(dir, spark), { recursive: true, mode: 0o700 });
    const unsigned = {
      format: SPARK_KEPT_FORMAT,
      spark,
      updatedAt: "2026-11-05T01:00:00.000Z",
      ...body,
    };
    const signature = new RecordSigner({ keyPath }).sign(unsigned);
    writeFileSync(file(spark), JSON.stringify({ ...unsigned, signature }), { mode: 0o600 });
  };
  return { root, dir, keyPath, events, store: open(), open, file, seed };
}

describe("the spark's kept record (item 159)", () => {
  it("P1 · keeps a spark's record signed in its own folder, 0600 in 0700 under a 0700 directory, its key its own, and reads it back after a restart", () => {
    const h = store();
    const kept = h.store.update(VELA, (record) => ({ ...record, watches: ["run-ada"] }));
    expect(kept).toMatchObject({ format: SPARK_KEPT_FORMAT, spark: VELA, watches: ["run-ada"] });
    expect(existsSync(h.file(VELA))).toBe(true);
    expect(statSync(h.dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(h.dir, VELA)).mode & 0o777).toBe(0o700);
    expect(statSync(h.file(VELA)).mode & 0o777).toBe(0o600);
    expect(statSync(h.keyPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(h.file(VELA), "utf8")).signature).toMatch(/^[0-9a-f]{64}$/);
    // a second store on the same root (a restart) reads it
    const again = h.open();
    expect(again.get(VELA)).toMatchObject({ spark: VELA, watches: ["run-ada"] });
    expect(again.list().map((record) => record.spark)).toEqual([VELA]);
    expect(again.get(KIWI)).toBeUndefined();
  });

  it("P2 · an update re-reads first: a section another writer kept meanwhile survives", () => {
    const h = store();
    const watcher = h.open();
    const crews = h.open();
    watcher.update(VELA, (record) => ({ ...record, watches: ["run-ada"] }));
    // a writer that read nothing before the first wrote keeps what that one wrote
    crews.update(VELA, (record) => ({
      ...record,
      crews: [{ name: "review", sessions: ["run-31"] }],
    }));
    expect(h.open().get(VELA)).toMatchObject({
      watches: ["run-ada"],
      crews: [{ name: "review", sessions: ["run-31"] }],
    });
  });

  it("P3 · a section this build does not know survives an update, and the store names the spark and the time itself", () => {
    const h = store();
    h.seed(VELA, { later: { kept: "by a newer build" } });
    const kept = h.store.update(VELA, (record) => ({ ...record, spark: KIWI, watches: [] }));
    expect(kept).toMatchObject({ spark: VELA, later: { kept: "by a newer build" }, watches: [] });
    expect(kept.updatedAt).not.toBe("2026-11-05T01:00:00.000Z");
    expect(h.open().get(VELA)).toMatchObject({ later: { kept: "by a newer build" }, watches: [] });
  });

  it("P4 · sets aside, and never serves, a record that is unsigned, forged, exposed, unreadable or copied into another spark's folder; the rest still lists", () => {
    const h = store();
    const sparks = [
      "sp-good0000000",
      "sp-unsigned000",
      "sp-forged00000",
      "sp-exposed0000",
      "sp-junk0000000",
    ];
    const [good, unsigned, forged, exposed, junk] = sparks as [
      string,
      string,
      string,
      string,
      string,
    ];
    for (const spark of [good, forged, exposed]) h.seed(spark);
    mkdirSync(join(h.dir, unsigned), { mode: 0o700 });
    writeFileSync(
      h.file(unsigned),
      JSON.stringify({ format: 1, spark: unsigned, updatedAt: "2026-11-05T01:00:00.000Z" }),
      { mode: 0o600 },
    );
    const edited = JSON.parse(readFileSync(h.file(forged), "utf8"));
    edited.watches = ["run-mine"];
    writeFileSync(h.file(forged), JSON.stringify(edited), { mode: 0o600 });
    chmodSync(h.file(exposed), 0o644);
    mkdirSync(join(h.dir, junk), { mode: 0o700 });
    writeFileSync(h.file(junk), "{not json", { mode: 0o600 });
    // the good spark's own signed record, copied into another spark's folder
    mkdirSync(join(h.dir, KIWI), { mode: 0o700 });
    copyFileSync(h.file(good), h.file(KIWI));
    // a folder not named as a spark, and a spark's folder that holds only other files (TH-1's runs): passed over
    mkdirSync(join(h.dir, "notes"), { mode: 0o700 });
    writeFileSync(join(h.dir, "notes", SPARK_KEPT_FILE), "a human's file");
    mkdirSync(join(h.dir, "sp-runsonly0000"), { mode: 0o700 });
    writeFileSync(join(h.dir, "sp-runsonly0000", "run-1.jsonl"), "");

    expect(
      h
        .open()
        .list()
        .map((record) => record.spark),
    ).toEqual([good]);
    const why = Object.fromEntries(
      h.events
        .filter((e) => e.event === "fieldd.spark_kept.set_aside")
        .map((e) => [String(e.attrs?.spark), e.attrs?.why]),
    );
    expect(why).toEqual({
      [unsigned]: "unsigned",
      [forged]: "forged",
      [exposed]: "exposed",
      [junk]: "unreadable",
      [KIWI]: "forged",
    });
    // set aside beside it for a human, never read again
    for (const spark of [unsigned, forged, exposed, junk, KIWI]) {
      expect(existsSync(h.file(spark))).toBe(false);
      expect(readdirSync(join(h.dir, spark)).some((f) => f.startsWith(`${SPARK_KEPT_FILE}.`))).toBe(
        true,
      );
    }
    expect(readFileSync(join(h.dir, "notes", SPARK_KEPT_FILE), "utf8")).toBe("a human's file");
    expect(h.open().get(KIWI)).toBeUndefined();
    expect(h.open().get(good)).toMatchObject({ spark: good });
  });

  it("P5 · a write the disk does not take throws, and keeps nothing", () => {
    const h = store();
    mkdirSync(h.dir, { recursive: true, mode: 0o700 });
    // a file stands where the spark's folder is made
    writeFileSync(join(h.dir, VELA), "in the way", { mode: 0o600 });
    expect(() => h.store.update(VELA, (record) => ({ ...record, watches: [] }))).toThrow();
    expect(h.open().get(VELA)).toBeUndefined();
  });
});
