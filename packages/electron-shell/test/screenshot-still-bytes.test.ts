import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkStill,
  createScreenshotStillBytesDoor,
  createScreenshotStillKeptDoor,
  readStill,
  type StillBytesRefusal,
} from "../src/main/screenshot-still-bytes";

// HN-D7 — a retained still's bytes, for the desk's print of a snapshot played onto it. The door
// finds the still by name in the tool's ring (`resolveStill`: a lookup, never the disk), then
// judges WHAT IT OPENS — never through a symlink at the path, a regular file within the cap — and
// reads from that same handle: never a path checked and then opened again (EL7). Its twin (HN-4)
// answers whether a still is still kept by the same lookup and the same handle, reading nothing.
// Real files in a temp dir: what the doors refuse is what the disk holds.

vi.mock("electron", () => ({ protocol: {} }));
const { resolveStill } = await import("../src/main/still-protocol");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Where a FIFO, a device and a mode that locks out a file's owner can be made: not Windows. */
const posix = process.platform !== "win32";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vf-still-bytes-"));
  roots.push(root);
  const path = join(root, "capture.png");
  writeFileSync(path, PNG);
  let retained = [path];
  const sender = { id: 1 };
  const refused: StillBytesRefusal[] = [];
  const find = (url: string) => resolveStill(url, retained);
  const read = vi.fn((file: string) => readStill(file));
  const check = vi.fn((file: string) => checkStill(file));
  const door = createScreenshotStillBytesDoor({
    owns: (candidate: typeof sender) => candidate === sender,
    find,
    read,
    onRefused: (reason) => refused.push(reason),
  });
  // its twin (HN-4), on the same ring and the same files
  const kept = createScreenshotStillKeptDoor({
    owns: (candidate: typeof sender) => candidate === sender,
    find,
    check,
    onRefused: (reason) => refused.push(reason),
  });
  return {
    root,
    path,
    sender,
    read,
    check,
    refused,
    door,
    kept,
    evict: () => {
      retained = [];
    },
  };
}

describe("a retained still's bytes (HN-D7)", () => {
  it("hands over the retained file's own bytes, then null once the ring lets it go", async () => {
    const f = fixture();
    const answer = await f.door(f.sender, { name: "capture.png" });
    expect([...(answer ?? [])]).toEqual([...PNG]);
    expect(f.read).toHaveBeenCalledWith(f.path);
    f.evict();
    expect(await f.door(f.sender, { name: "capture.png" })).toBeNull();
    expect(f.refused).toEqual(["not-retained"]);
    expect(f.read, "a still the ring let go was looked for on the disk").toHaveBeenCalledTimes(1);
  });

  it("refuses a stranger and any name that is not a PNG basename, before opening anything", async () => {
    const f = fixture();
    await expect(f.door({ id: 1 }, { name: "capture.png" })).rejects.toThrow("unregistered");
    for (const name of [f.path, "../capture.png", "..\\capture.png", "secret", "bad\0.png"]) {
      await expect(f.door(f.sender, { name }), name).rejects.toThrow();
    }
    expect(await f.door(f.sender, { name: "other.png" })).toBeNull();
    expect(f.refused).toEqual(["not-retained"]);
    expect(f.read).not.toHaveBeenCalled();
  });

  it("judges what it opens, never the path: gone from the disk, a symlink at the still's path, a directory there — null, and why", async () => {
    const gone = fixture();
    rmSync(gone.path);
    expect(await gone.door(gone.sender, { name: "capture.png" })).toBeNull();
    expect(gone.refused).toEqual(["missing-file"]);

    // planted where the helper wrote the still, pointing at a real PNG: never followed
    const planted = fixture();
    const other = join(planted.root, "other.png");
    writeFileSync(other, PNG);
    rmSync(planted.path);
    symlinkSync(other, planted.path);
    expect(await planted.door(planted.sender, { name: "capture.png" })).toBeNull();
    expect(planted.refused).toEqual(["not-a-file"]);

    const folder = fixture();
    rmSync(folder.path);
    mkdirSync(folder.path);
    expect(await folder.door(folder.sender, { name: "capture.png" })).toBeNull();
    expect(folder.refused).toEqual(["not-a-file"]);
  });

  it.skipIf(!posix)(
    "refuses a FIFO at the still's path at once, never waiting on a writer, and a device is no still",
    async () => {
      const f = fixture();
      rmSync(f.path);
      execFileSync("mkfifo", [f.path]);
      expect(await f.door(f.sender, { name: "capture.png" })).toBeNull();
      expect(f.refused).toEqual(["not-a-file"]);
      expect(await readStill("/dev/zero")).toEqual({ ok: false, reason: "not-a-file" });
    },
  );

  it("refuses a file past the cap, and reads one at it whole", async () => {
    const f = fixture();
    expect(await readStill(f.path, PNG.length - 1)).toEqual({ ok: false, reason: "too-large" });
    expect(await readStill(f.path, PNG.length)).toEqual({ ok: true, value: PNG });
  });

  it.skipIf(!posix || process.getuid?.() === 0)(
    "answers null, and says why, when the retained file cannot be opened",
    async () => {
      const f = fixture();
      chmodSync(f.path, 0o000);
      expect(await f.door(f.sender, { name: "capture.png" })).toBeNull();
      expect(f.refused).toEqual(["unreadable"]);
    },
  );
});

describe("whether a still is still kept (HN-4)", () => {
  it("answers true while the still's path opens to a regular file, false once the ring lets it go — reading nothing", async () => {
    const f = fixture();
    expect(await f.kept(f.sender, { name: "capture.png" })).toBe(true);
    expect(f.check).toHaveBeenCalledWith(f.path);
    expect(await checkStill(f.path)).toEqual({ ok: true, value: true });
    f.evict();
    expect(await f.kept(f.sender, { name: "capture.png" })).toBe(false);
    expect(f.refused).toEqual(["not-retained"]);
    expect(f.check).toHaveBeenCalledTimes(1);
    expect(f.read, "the kept door read the still").not.toHaveBeenCalled();
  });

  it("answers false for a still gone from the disk, a symlink at its path, a directory there", async () => {
    const gone = fixture();
    rmSync(gone.path);
    expect(await gone.kept(gone.sender, { name: "capture.png" })).toBe(false);
    expect(gone.refused).toEqual(["missing-file"]);

    const planted = fixture();
    const other = join(planted.root, "other.png");
    writeFileSync(other, PNG);
    rmSync(planted.path);
    symlinkSync(other, planted.path);
    expect(await planted.kept(planted.sender, { name: "capture.png" })).toBe(false);
    expect(planted.refused).toEqual(["not-a-file"]);

    const folder = fixture();
    rmSync(folder.path);
    mkdirSync(folder.path);
    expect(await folder.kept(folder.sender, { name: "capture.png" })).toBe(false);
    expect(folder.refused).toEqual(["not-a-file"]);
  });

  it.skipIf(!posix)("answers false at once for a FIFO at the still's path", async () => {
    const f = fixture();
    rmSync(f.path);
    execFileSync("mkfifo", [f.path]);
    expect(await f.kept(f.sender, { name: "capture.png" })).toBe(false);
    expect(f.refused).toEqual(["not-a-file"]);
  });

  it("refuses a stranger and any name that is not a PNG basename", async () => {
    const f = fixture();
    await expect(f.kept({ id: 1 }, { name: "capture.png" })).rejects.toThrow("unregistered");
    for (const name of [f.path, "../capture.png", "..\\capture.png", "secret", "bad\0.png"]) {
      await expect(f.kept(f.sender, { name }), name).rejects.toThrow();
    }
    expect(f.refused).toEqual([]);
    expect(f.check).not.toHaveBeenCalled();
  });
});
