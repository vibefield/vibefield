// Item 148 (2026-11-01) — the two never-overwrite markers (users.json's mint and
// the layout stamp) are created whole: no reader outside the lock may ever see
// one present and incomplete. Push 58's GitHub verify read exactly that in the
// eight-minter row: a loser's `detectLayoutState` (outside the lock) read
// `layout.json` between the winner's create and its write, `layout.json is present
// but unusable`, JSON.parse's "Unexpected end of JSON input".
//
// The window is microseconds wide, so this file makes it a place: `writeFileSync`
// by path runs as the two steps it is (open, then write), and a reader runs
// between them, where another process lands. Every read it makes must find each
// marker absent or whole.
import { readdirSync, realpathSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ensureUsersRoot,
  readLayoutStamp,
  readUsersFile,
  UsersError,
  writeLayoutStamp,
} from "../src";
import { tempDir } from "./temp-dir";

const inWrite = vi.hoisted(() => ({ root: "", reader: null as null | (() => void) }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const writeFileSync = (
    target: import("node:fs").PathOrFileDescriptor,
    data: string | NodeJS.ArrayBufferView,
    options?: import("node:fs").WriteFileOptions,
  ): void => {
    const reader = inWrite.reader;
    if (reader !== null && typeof target === "string" && target.startsWith(inWrite.root)) {
      const opts = typeof options === "object" && options !== null ? options : {};
      const fd = actual.openSync(target, opts.flag ?? "w", opts.mode ?? 0o666);
      try {
        reader();
        actual.writeFileSync(fd, data);
      } finally {
        actual.closeSync(fd);
      }
      return;
    }
    if (reader !== null && typeof target === "number") reader();
    actual.writeFileSync(target, data, options);
  };
  return { ...actual, writeFileSync, default: { ...actual, writeFileSync } };
});

const emptyRoot = () => realpathSync(tempDir("vf-whole-markers-"));

/** What a reader outside the lock finds at this instant, per marker. */
function readEach(root: string): string[] {
  return [() => readLayoutStamp(root), () => readUsersFile(root)].map((read) => {
    try {
      read();
      return "absent-or-whole";
    } catch (error) {
      return error instanceof UsersError ? error.kind : String(error);
    }
  });
}

describe("item 148 — the markers are created whole", () => {
  it("a reader inside every write of a fresh mint finds each marker absent or whole", async () => {
    const root = emptyRoot();
    const seen: string[] = [];
    inWrite.root = root;
    inWrite.reader = () => seen.push(...readEach(root));
    try {
      const ensured = await ensureUsersRoot(root, {});
      expect(ensured.created).toBe(true);
    } finally {
      inWrite.reader = null;
    }
    // the reader ran inside the mint's writes, not only around them
    expect(seen.length).toBeGreaterThanOrEqual(4);
    expect(seen.filter((kind) => kind !== "absent-or-whole")).toEqual([]);
    expect(readLayoutStamp(root)?.previous).toBe("fresh");
  });

  it("an incumbent stamp is kept, never overwritten, and no tmp is left in the root", () => {
    const root = emptyRoot();
    writeLayoutStamp(root, "fresh", () => Date.UTC(2026, 10, 1, 13, 0));
    writeLayoutStamp(root, "flat-v1", () => Date.UTC(2026, 10, 1, 14, 0));
    expect(readLayoutStamp(root)).toMatchObject({
      previous: "fresh",
      migratedAt: "2026-11-01T13:00:00.000Z",
    });
    expect(readdirSync(root).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });
});
