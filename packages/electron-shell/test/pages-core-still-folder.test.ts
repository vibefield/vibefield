// EY-1 (2026-11-19) — a still's folder and file: the folder's shape and parts judged before the engine runs, the
// name minted, the command's place forced, and the written file judged by what main opened.
import { PAGES_STILL_MAX_BYTES } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  folderShape,
  judgeFolder,
  judgeWritten,
  mintStillName,
  pngSize,
  STILL_HEAD_BYTES,
  type StillEntryFacts,
  type StillFileFacts,
  stillCommand,
  stillPath,
} from "../src/main/pages/core/still-folder";

const UID = 501;
const FOLDER = "/data/fieldd/stills/run-7";
const dir = (uid: number, mode: number): StillEntryFacts => ({ kind: "directory", uid, mode });
/** The good parts of FOLDER: /data (root's), /data/fieldd, /data/fieldd/stills, the run's folder (ours, 0700). */
const GOOD = [dir(0, 0o755), dir(UID, 0o700), dir(UID, 0o700), dir(UID, 0o700)];

/** A PNG's first 24 bytes for a width and height. */
function pngHead(width: number, height: number): Uint8Array {
  const head = new Uint8Array(STILL_HEAD_BYTES);
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(head.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return head;
}
const FILE: StillFileFacts = { kind: "file", uid: UID, nlink: 1, size: 4096 };
const SENT = `${FOLDER}/still-${"ab".repeat(16)}.png`;

describe("a still's folder and file (EY-1)", () => {
  it("a folder's shape: absolute, no empty, . or .. part, no trailing slash, within bounds; its prefixes in order", () => {
    expect(folderShape(FOLDER)).toEqual({
      ok: true,
      prefixes: ["/data", "/data/fieldd", "/data/fieldd/stills", FOLDER],
    });
    for (const bad of ["data/x", "", "relative/../x"]) {
      expect(folderShape(bad)).toEqual({ ok: false, reason: "folder-not-absolute" });
    }
    for (const bad of [
      "/",
      "/data//x",
      "/data/./x",
      "/data/../etc",
      "/data/x/",
      "/data/x\0y",
      `/data/${"a".repeat(256)}`,
    ]) {
      expect(folderShape(bad), bad).toEqual({ ok: false, reason: "folder-bad-part" });
    }
    expect(folderShape(`/${"a/".repeat(2048)}b`)).toEqual({ ok: false, reason: "folder-too-long" });
  });

  it("a folder reached through a link anywhere, or not a directory, is refused", () => {
    expect(judgeFolder(GOOD, UID)).toEqual({ ok: true });
    for (const at of [0, 1, 3]) {
      const parts = GOOD.map((p, i) => (i === at ? { ...p, kind: "link" as const } : p));
      expect(judgeFolder(parts, UID), `link at ${at}`).toEqual({
        ok: false,
        reason: "folder-link",
      });
    }
    const file = GOOD.map((p, i) => (i === 3 ? { ...p, kind: "file" as const } : p));
    expect(judgeFolder(file, UID)).toEqual({ ok: false, reason: "folder-not-directory" });
    expect(judgeFolder([], UID)).toEqual({ ok: false, reason: "folder-bad-part" });
  });

  it("the folder is ours and private; the parts above are ours or root's and not open to others", () => {
    const at = (i: number, part: StillEntryFacts) => GOOD.map((p, j) => (j === i ? part : p));
    expect(judgeFolder(at(3, dir(0, 0o700)), UID)).toEqual({
      ok: false,
      reason: "folder-not-ours",
    });
    expect(judgeFolder(at(3, dir(UID, 0o770)), UID)).toEqual({
      ok: false,
      reason: "folder-shared",
    });
    expect(judgeFolder(at(3, dir(UID, 0o702)), UID)).toEqual({
      ok: false,
      reason: "folder-shared",
    });
    expect(judgeFolder(at(1, dir(502, 0o755)), UID)).toEqual({
      ok: false,
      reason: "folder-not-ours",
    });
    expect(judgeFolder(at(1, dir(UID, 0o777)), UID)).toEqual({
      ok: false,
      reason: "folder-shared",
    });
    // a sticky shared parent (the shape of /private/tmp) does not let another uid move our folder
    expect(judgeFolder(at(0, dir(0, 0o1777)), UID)).toEqual({ ok: true });
  });

  it("the run's folder is its owner's alone: any group or other bit refuses it, 0750 and 0755 included", () => {
    const at3 = (mode: number) => GOOD.map((p, j) => (j === 3 ? dir(UID, mode) : p));
    expect(judgeFolder(at3(0o700), UID)).toEqual({ ok: true });
    for (const mode of [0o750, 0o755, 0o740, 0o704, 0o710, 0o701]) {
      expect(judgeFolder(at3(mode), UID), mode.toString(8)).toEqual({
        ok: false,
        reason: "folder-shared",
      });
    }
  });

  it("a still's name is minted from 128 random bits, never the agent's", () => {
    const name = mintStillName(new Uint8Array(16).fill(0xab));
    expect(name).toBe(`still-${"ab".repeat(16)}.png`);
    expect(mintStillName(Uint8Array.from({ length: 16 }, (_, i) => i))).toBe(
      "still-000102030405060708090a0b0c0d0e0f.png",
    );
    expect(() => mintStillName(new Uint8Array(15))).toThrow(RangeError);
    expect(stillPath(FOLDER, name)).toBe(SENT);
  });

  it("the command's place is main's: the agent's path and screenshotDir go, PNG is forced, the rest passes", () => {
    const command = stillCommand(
      {
        action: "screenshot",
        selector: "@e3",
        fullPage: true,
        annotate: true,
        ifChanged: true,
        threshold: 0.1,
        path: "/elsewhere/.profile",
        screenshotDir: "/elsewhere",
        format: "jpeg",
        type: "jpeg",
        quality: 80,
      },
      SENT,
    );
    expect(command).toEqual({
      action: "screenshot",
      selector: "@e3",
      fullPage: true,
      annotate: true,
      ifChanged: true,
      threshold: 0.1,
      path: SENT,
      format: "png",
    });
    expect(() => stillCommand({ action: "pdf", path: "/x.pdf" }, SENT)).toThrow(TypeError);
  });

  it("a PNG's size is read from its signature and IHDR; anything else is not a PNG", () => {
    expect(pngSize(pngHead(1280, 800))).toEqual({ width: 1280, height: 800 });
    expect(pngSize(pngHead(0, 800))).toBeNull();
    expect(pngSize(pngHead(1280, 2 ** 31))).toBeNull();
    expect(pngSize(pngHead(1280, 800).subarray(0, 23))).toBeNull();
    const jpeg = new Uint8Array(STILL_HEAD_BYTES);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(pngSize(jpeg)).toBeNull();
  });

  it("the written still: the path sent, a regular file of ours with one link, within the cap, answered as the still", () => {
    expect(
      judgeWritten({ facts: FILE, head: pngHead(1280, 800), sent: SENT, answered: SENT, uid: UID }),
    ).toEqual({
      ok: true,
      still: { path: SENT, mime: "image/png", width: 1280, height: 800, bytes: 4096 },
    });
    const judged = (o: Partial<Parameters<typeof judgeWritten>[0]>) =>
      judgeWritten({
        facts: FILE,
        head: pngHead(1280, 800),
        sent: SENT,
        answered: SENT,
        uid: UID,
        ...o,
      });
    expect(judged({ answered: `${FOLDER}/other.png` })).toEqual({
      ok: false,
      reason: "answered-path",
    });
    expect(judged({ answered: undefined })).toEqual({ ok: false, reason: "answered-path" });
    expect(judged({ facts: { ...FILE, kind: "link" } })).toEqual({
      ok: false,
      reason: "not-a-file",
    });
    expect(judged({ facts: { ...FILE, kind: "other" } })).toEqual({
      ok: false,
      reason: "not-a-file",
    });
    expect(judged({ facts: { ...FILE, uid: 0 } })).toEqual({ ok: false, reason: "not-ours" });
    expect(judged({ facts: { ...FILE, nlink: 2 } })).toEqual({ ok: false, reason: "linked" });
    // an agent's still bound, not the person's screenshot cap: at it a still passes, one byte over it is refused
    expect(judged({ facts: { ...FILE, size: PAGES_STILL_MAX_BYTES } }).ok).toBe(true);
    expect(judged({ facts: { ...FILE, size: PAGES_STILL_MAX_BYTES + 1 } })).toEqual({
      ok: false,
      reason: "too-large",
    });
    expect(judged({ facts: { ...FILE, size: 100 }, maxBytes: 99 })).toEqual({
      ok: false,
      reason: "too-large",
    });
    expect(judged({ head: new Uint8Array(STILL_HEAD_BYTES) })).toEqual({
      ok: false,
      reason: "not-png",
    });
    expect(judged({ facts: { ...FILE, size: 10 } })).toEqual({ ok: false, reason: "not-png" });
  });
});
