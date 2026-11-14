import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMMUNITY_STATEMENT_FILE,
  CommunityStatementMark,
} from "../src/plugin-community-statement";
import { SettingsDocService } from "../src/settings-doc";

// MK-O3D — the community statement's mark (James's MK-O1 pick B: each desktop shows the statement
// once, and keeps a mark of its own that it has, never synced). Every data root here is the test's
// own temp folder. No daemon, no network, no child.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-statement-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Every file under a root, by its path from the root. */
function files(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort();
}

describe("the community statement's mark (MK-O3D; MK-O1 B)", () => {
  it("is absent until marked, then read; it writes its one file and nothing else", async () => {
    const dataDir = temp();
    const mark = new CommunityStatementMark(dataDir, () => 1_731_550_000_000);
    expect(await mark.shownHere()).toBe(false);
    expect(files(dataDir)).toEqual([]);
    await mark.markShown();
    expect(await mark.shownHere()).toBe(true);
    expect(files(dataDir)).toEqual([join(...COMMUNITY_STATEMENT_FILE)]);
    // another reader over the same root, as a restarted fieldd, reads it too
    expect(await new CommunityStatementMark(dataDir).shownHere()).toBe(true);
  });

  it("keeps the first time it was marked: marking again moves nothing", async () => {
    const dataDir = temp();
    let now = 1_000;
    const mark = new CommunityStatementMark(dataDir, () => now);
    await mark.markShown();
    now = 2_000;
    await mark.markShown();
    const kept = JSON.parse(readFileSync(join(dataDir, ...COMMUNITY_STATEMENT_FILE), "utf8"));
    expect(kept).toEqual({ version: 1, shownAt: 1_000 });
  });

  it("reads a file it can't use as no mark, so the statement shows again", async () => {
    const dataDir = temp();
    const path = join(dataDir, ...COMMUNITY_STATEMENT_FILE);
    mkdirSync(join(dataDir, "fieldd", "plugins"), { recursive: true });
    const mark = new CommunityStatementMark(dataDir);
    for (const body of [
      "not json",
      "null",
      "true",
      "[]",
      "{}",
      JSON.stringify({ version: 2, shownAt: 1 }),
      JSON.stringify({ version: 1 }),
      JSON.stringify({ version: 1, shownAt: -1 }),
      JSON.stringify({ version: 1, shownAt: 1.5 }),
      JSON.stringify({ version: 1, shownAt: "1" }),
    ]) {
      writeFileSync(path, body);
      expect(await mark.shownHere(), body).toBe(false);
    }
    // marking over a file it can't use writes a whole one
    await mark.markShown();
    expect(await mark.shownHere()).toBe(true);
  });

  it("never enters the settings doc, which syncs", async () => {
    const dataDir = temp();
    await new CommunityStatementMark(dataDir).markShown();
    const doc = new SettingsDocService({ dataDir });
    cleanup.push(() => doc.dispose());
    await doc.setAppValue("plugins.community", true, "test");
    expect(await doc.appValues()).toEqual({ "plugins.community": true });
    // and the doc's own writes leave the mark as it was
    expect(await new CommunityStatementMark(dataDir).shownHere()).toBe(true);
  });
});
