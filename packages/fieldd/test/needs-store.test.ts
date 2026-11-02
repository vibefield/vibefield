import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NEEDS_RECORD_FORMAT, type NeedsRecord } from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import { NeedsStore } from "../src/tool-plane/rooms/you/store";

// CP-3 — the needs-you queue's store (cp3-the-person.md §5.1): one signed record per item, 0600 in a 0700 directory,
// read back oldest asked first; a record an edit touched, or one copied to another item's name, is set aside for a
// human and never served (EL7, against an edit).

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

function store() {
  const root = mkdtempSync(join(tmpdir(), "vf-needs-"));
  dirs.push(root);
  const dir = join(root, "needs");
  const events: { event: string; attrs: LogFields | undefined }[] = [];
  const open = () =>
    new NeedsStore({ dir, keyPath: join(root, "needs.key"), logger: capture(events) });
  return { root, dir, events, store: open(), open };
}

const question = (id: string, asked: string): NeedsRecord => ({
  format: NEEDS_RECORD_FORMAT,
  item: {
    id,
    kind: "question",
    state: "open",
    from: { name: "Vela", session: "run-vela", spark: "sp-vela00000000" },
    spark: "sp-vela00000000",
    asked,
    words: "Push the fix?",
    choices: ["Push", "Not now"],
  },
});

describe("the needs-you store", () => {
  it("keeps each record signed, 0600 in a 0700 directory, and reads them back oldest asked first", () => {
    const h = store();
    const later = NeedsStore.mintId();
    const first = NeedsStore.mintId();
    h.store.write(question(later, "2026-10-31T16:05:00.000Z"));
    h.store.write(question(first, "2026-10-31T16:01:00.000Z"));
    expect(statSync(h.dir).mode & 0o777).toBe(0o700);
    for (const file of readdirSync(h.dir))
      expect(statSync(join(h.dir, file)).mode & 0o777).toBe(0o600);
    expect(statSync(join(h.root, "needs.key")).mode & 0o777).toBe(0o600);
    const kept = JSON.parse(readFileSync(join(h.dir, `${first}.json`), "utf8"));
    expect(kept.signature).toMatch(/^[0-9a-f]{64}$/);
    // a second store on the same root (a restart) reads them, in order
    expect(
      h
        .open()
        .list()
        .map((r) => r.item.id),
    ).toEqual([first, later]);
    h.store.remove(first);
    expect(
      h
        .open()
        .list()
        .map((r) => r.item.id),
    ).toEqual([later]);
  });

  it("mints ids the contract takes", () => {
    expect(NeedsStore.mintId()).toMatch(/^ny-[0-9a-f]{16}$/);
    expect(NeedsStore.noticeId()).toMatch(/^nt-[0-9a-f]{16}$/);
  });

  it("sets aside, and never serves, a record that is unsigned, forged, exposed, unreadable or copied", () => {
    const h = store();
    const ids = Array.from({ length: 6 }, () => NeedsStore.mintId());
    const [good, unsigned, forged, exposed, unreadable, copied] = ids as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    for (const id of [good, forged, exposed])
      h.store.write(question(id, "2026-10-31T16:00:00.000Z"));
    const path = (id: string) => join(h.dir, `${id}.json`);
    writeFileSync(path(unsigned), JSON.stringify(question(unsigned, "2026-10-31T16:00:00.000Z")), {
      mode: 0o600,
    });
    const edited = JSON.parse(readFileSync(path(forged), "utf8"));
    edited.item.state = "answered";
    edited.item.answer = { choice: 0, at: "2026-10-31T16:00:01.000Z", outcome: "done", told: true };
    writeFileSync(path(forged), JSON.stringify(edited), { mode: 0o600 });
    chmodSync(path(exposed), 0o644);
    writeFileSync(path(unreadable), "{not json", { mode: 0o600 });
    // a signed record of another item, put under this id's name
    copyFileSync(path(good), path(copied));
    writeFileSync(join(h.dir, "notes.txt"), "a human's file");

    expect(
      h
        .open()
        .list()
        .map((r) => r.item.id),
    ).toEqual([good]);
    const why = Object.fromEntries(
      h.events
        .filter((e) => e.event === "fieldd.needs.set_aside")
        .map((e) => [String(e.attrs?.file).replace(/\.json$/, ""), e.attrs?.why]),
    );
    expect(why).toEqual({
      [unsigned]: "unsigned",
      [forged]: "forged",
      [exposed]: "exposed",
      [unreadable]: "unreadable",
      [copied]: "forged",
    });
    // set aside beside the store for a human, never read again
    for (const id of [unsigned, forged, exposed, unreadable, copied])
      expect(existsSync(path(id))).toBe(false);
    expect(readdirSync(h.dir).filter((f) => f.includes(".forged-"))).toHaveLength(2);
    expect(
      h
        .open()
        .list()
        .map((r) => r.item.id),
    ).toEqual([good]);
  });

  it("refuses to keep a record its contract does not take", () => {
    const h = store();
    const bad = question(NeedsStore.mintId(), "2026-10-31T16:00:00.000Z");
    expect(() =>
      h.store.write({ ...bad, item: { ...bad.item, from: { name: "x".repeat(65) } } }),
    ).toThrow();
    expect(existsSync(h.dir) ? readdirSync(h.dir) : []).toEqual([]);
  });
});
