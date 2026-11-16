// Item 457 (2026-11-15; items 442 and 452 add writes to it): the records file. Every plugin's enable, disable and
// grant writes the ONE records file, and two plugins' acts can run together: each plugin has its own lane.
// `saveRecords` wrote one fixed `install-records.json.tmp` and renamed it, with nothing ordering the writes. So a
// second write made while the first stood between its write and its rename renamed the shared tmp file first, and the
// first's rename found no file (ENOENT): that act failed after the file already held its change, and its row in
// memory never moved. And a records file the registry could not read (torn, or another version's) read as FIRST
// BOOT: every decision gone, each revoked power granted again and each disabled plugin on again at the next start.
// The settings doc had both gaps until DS-5c gave it one writer (`system-doc-file.ts`); these rows hold the records
// to the same two guarantees. The interleaving is forced, not hoped for, as settings-doc-persistence forces its own:
// the FIRST armed rename of the records' tmp file (either name) is parked until the row releases it.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LAYOUT } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginRegistryService } from "../src/plugin-registry";

const gate = vi.hoisted(() => ({ armed: false, release: null as null | (() => void) }));

/** Park the first armed rename FROM the records' tmp file: the fixed `<file>.tmp` main wrote, or the per-process
 * `<file>.<pid>.tmp` of the system documents' writer. Pass every other rename. */
function parked(from: string, rename: () => Promise<void>): Promise<void> {
  const name = basename(join(...LAYOUT.PLUGIN_RECORDS_FILE));
  const tmp = basename(from).startsWith(`${name}.`) && /\.(\d+\.)?tmp$/.test(from);
  if (!gate.armed || gate.release !== null || !tmp) return rename();
  return new Promise<void>((resolve, reject) => {
    gate.release = () => {
      rename().then(resolve, reject);
    };
  });
}

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  const rename = ((from: string, to: string) =>
    parked(String(from), () => actual.rename(from, to))) as typeof actual.rename;
  return { ...actual, rename, default: { ...actual, rename } };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = { bundled: [join(HERE, "fixtures", "plugin-roots", "ok")], devLinked: [] };
const ALPHA = "vibefield.fixture.alpha";
const BETA = "vibefield.fixture.beta";
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let cleanup: Array<() => void> = [];
afterEach(() => {
  gate.armed = false;
  gate.release = null;
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

function makeDataDir(): string {
  const dataDir = mkdtempSync(join(tmpdir(), "plugreg-writes-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  return dataDir;
}

function registryOn(dataDir: string): PluginRegistryService {
  const svc = new PluginRegistryService({ dataDir, roots: ROOTS });
  cleanup.push(() => svc.dispose());
  return svc;
}

const recordsFile = (dataDir: string): string => join(dataDir, ...LAYOUT.PLUGIN_RECORDS_FILE);

/** The records' folder's own names, after the file's: what a write or a load left beside it. */
const besideRecords = (dataDir: string): string[] => {
  const name = basename(recordsFile(dataDir));
  return readdirSync(dirname(recordsFile(dataDir))).filter((entry) => entry.startsWith(name));
};

type Entries = Record<string, { enabled: boolean }>;

/** A records file written by hand: the shape the registry writes, version 1 unless said. */
function writeRecords(path: string, plugins: Entries, version = 1): string {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = `${JSON.stringify({ version, plugins }, null, 2)}\n`;
  writeFileSync(path, bytes);
  return bytes;
}

describe("the records file under two plugins' acts at once (item 457)", () => {
  it("two plugins' records writes made together both land, and neither act fails", async () => {
    const dataDir = makeDataDir();
    const svc = registryOn(dataDir);
    await svc.refresh();

    gate.armed = true;
    const first = svc.disable(ALPHA); // its write lands; its rename is parked
    for (let i = 0; i < 80 && gate.release === null; i += 1) await pause(25);
    expect(gate.release, "the first write reached its rename").not.toBeNull();
    const second = svc.disable(BETA);
    // Unordered, the second writes the same tmp file and renames it at once (a move in memory and one small write,
    // far inside the bound). Ordered, it waits behind the parked first, so a green run SPENDS the whole bound every
    // time: only the verdict rests on no clock. Red needs the unordered second to finish inside it.
    await Promise.race([second.catch(() => undefined), pause(250)]);
    gate.release?.();
    const settled = await Promise.allSettled([first, second]);

    const statuses = settled.map((s) => s.status);
    expect(statuses, "both acts").toEqual(["fulfilled", "fulfilled"]); // RED on main: ENOENT
    expect(svc.get(ALPHA)?.enabled, "the first act's row moved").toBe(false);
    const again = registryOn(dataDir);
    await again.refresh();
    expect(again.get(ALPHA)?.enabled, "the file holds the first act").toBe(false);
    expect(again.get(BETA)?.enabled, "the file holds the second act").toBe(false);
  });
});

describe("a records file the registry cannot read is never first boot (item 457)", () => {
  it("a torn records file reads the last good copy, and is kept aside", async () => {
    const dataDir = makeDataDir();
    const file = recordsFile(dataDir);
    // the last good copy holds the earlier write; the newer write tore mid-file
    writeRecords(`${file}.last-good`, { [ALPHA]: { enabled: false } });
    const newer = writeRecords(file, { [ALPHA]: { enabled: false }, [BETA]: { enabled: false } });
    writeFileSync(file, newer.slice(0, Math.floor(newer.length / 2)));
    const svc = registryOn(dataDir);
    await svc.refresh();

    expect(svc.get(ALPHA)?.enabled, "the last good copy's decision stands").toBe(false); // RED on main: first boot
    // the newest write is LOST: the torn copy alone held BETA's off, so BETA reads as the last good copy has it
    expect(svc.get(BETA)?.enabled, "the newest write, lost with the torn copy").toBe(true);
    expect(
      besideRecords(dataDir).filter((entry) => entry.includes(".torn-")),
      "the torn copy is kept aside",
    ).toHaveLength(1);
  });

  it("no records file beside a last good copy (a crash between the renames) reads the last good copy", async () => {
    const dataDir = makeDataDir();
    writeRecords(`${recordsFile(dataDir)}.last-good`, { [ALPHA]: { enabled: false } });
    const svc = registryOn(dataDir);
    await svc.refresh();

    expect(svc.get(ALPHA)?.enabled, "the last good copy's decision stands").toBe(false); // RED on main: first boot
    expect(svc.get(BETA)?.enabled).toBe(true);
  });

  it("another version's records file is kept aside, never written over", async () => {
    const dataDir = makeDataDir();
    const theirs = writeRecords(recordsFile(dataDir), { [ALPHA]: { enabled: false } }, 2);
    const svc = registryOn(dataDir);
    await svc.refresh();
    await svc.disable(BETA); // this build's first write

    const aside = besideRecords(dataDir).filter((entry) => entry.includes(".torn-"));
    expect(aside, "the other version's file is kept aside").toHaveLength(1); // RED on main: written over
    const kept = readFileSync(join(dirname(recordsFile(dataDir)), aside[0] ?? ""), "utf8");
    expect(kept, "byte for byte").toBe(theirs);
    expect(svc.get(ALPHA)?.enabled, "no decision of its is read as this version's").toBe(true);
  });
});
