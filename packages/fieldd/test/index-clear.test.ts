import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type IndexFiles, removeCleared, setIndexAside } from "../src/index-clear";

// HD-1 — what `index.clear` does to the disk (`index-clear.ts`): what is not fieldd's is rosettad's, and goes.

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function indexDir(): IndexFiles {
  const dir = mkdtempSync(join(tmpdir(), "vf-index-clear-"));
  dirs.push(dir);
  return { dir, keep: ["enrollment.json", "daemons", "auth"] };
}

function seed(files: IndexFiles): void {
  for (const name of [
    "enrollment.json",
    "enrollment.json.unreadable-7",
    "rosetta.db",
    "rosetta.db-wal",
  ])
    writeFileSync(join(files.dir, name), name);
  for (const name of ["daemons", "auth", "rosetta.db.assets", "rosetta.ledger", "recovery"]) {
    mkdirSync(join(files.dir, name));
    writeFileSync(join(files.dir, name, "member"), name);
  }
}

describe("index.clear's files (HD-1)", () => {
  it("moves everything that is not fieldd's into one folder, and removes the folder", async () => {
    const files = indexDir();
    seed(files);
    const aside = setIndexAside(files, 42);
    expect(aside).toBe(join(files.dir, ".cleared-42"));
    expect(readdirSync(files.dir).sort()).toEqual([
      ".cleared-42",
      "auth",
      "daemons",
      "enrollment.json",
      "enrollment.json.unreadable-7",
    ]);
    expect(readdirSync(aside as string).sort()).toEqual([
      "recovery",
      "rosetta.db",
      "rosetta.db-wal",
      "rosetta.db.assets",
      "rosetta.ledger",
    ]);
    await removeCleared(files);
    expect(existsSync(aside as string)).toBe(false);
    expect(readdirSync(join(files.dir, "auth"))).toEqual(["member"]);
  });

  it("answers null over a directory that holds nothing of rosettad's, or that does not exist", () => {
    const files = indexDir();
    writeFileSync(join(files.dir, "enrollment.json"), "{}");
    expect(setIndexAside(files, 1)).toBeNull();
    expect(readdirSync(files.dir)).toEqual(["enrollment.json"]);
    expect(setIndexAside({ dir: join(files.dir, "absent"), keep: files.keep }, 1)).toBeNull();
  });

  it("leaves an earlier clear's folder where it is, and removeCleared takes every one", async () => {
    const files = indexDir();
    seed(files);
    mkdirSync(join(files.dir, ".cleared-1"));
    writeFileSync(join(files.dir, ".cleared-1", "rosetta.db"), "old");
    setIndexAside(files, 2);
    expect(readdirSync(join(files.dir, ".cleared-1"))).toEqual(["rosetta.db"]);
    await removeCleared(files);
    expect(readdirSync(files.dir).filter((name) => name.startsWith(".cleared-"))).toEqual([]);
  });

  it("a move that fails puts back what it had moved", () => {
    const files = indexDir();
    seed(files);
    // the folder a move at this instant would make is already there, and not empty where one entry would land
    mkdirSync(join(files.dir, ".cleared-9", "rosetta.ledger"), { recursive: true });
    writeFileSync(join(files.dir, ".cleared-9", "rosetta.ledger", "held"), "x");
    expect(() => setIndexAside(files, 9)).toThrow();
    expect(readdirSync(files.dir).sort()).toEqual([
      ".cleared-9",
      "auth",
      "daemons",
      "enrollment.json",
      "enrollment.json.unreadable-7",
      "recovery",
      "rosetta.db",
      "rosetta.db-wal",
      "rosetta.db.assets",
      "rosetta.ledger",
    ]);
  });
});
