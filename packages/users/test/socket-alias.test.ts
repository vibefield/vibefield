import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { nativeRunDirFor, socketAliasFor } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { UsersError } from "../src/errors";
import { ensureSocketDir } from "../src/socket-alias";
import { tempDir } from "./temp-dir";

const uid = process.getuid?.() ?? 0;
/** A root whose worst real path is far over 103, so it takes the alias. */
const longRoot = (): string => join(tempDir("vf-long-"), "x".repeat(80));
/** The test's own alias parent (never the real /tmp/vf-<uid>). */
const parentDir = (): string => tempDir("vf-p-");
const refused = (run: () => unknown, words: RegExp): void => {
  let caught: unknown = null;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(UsersError);
  expect((caught as UsersError).kind).toBe("socket-alias-refused");
  expect((caught as UsersError).message).toMatch(words);
};

describe.runIf(process.platform !== "win32")("item 345 — the socket alias (unix)", () => {
  it("a root over the line gets a 0700 folder of ours and a link to its run dir", () => {
    const root = longRoot();
    const parent = parentDir();
    const dir = ensureSocketDir(root, { parent });
    expect(dir).toBe(socketAliasFor(uid, root, parent));
    const folder = lstatSync(join(parent, `vf-${uid}`));
    expect(folder.isDirectory() && !folder.isSymbolicLink()).toBe(true);
    expect(folder.mode & 0o777).toBe(0o700);
    expect(lstatSync(dir).isSymbolicLink()).toBe(true);
    expect(readlinkSync(dir)).toBe(nativeRunDirFor(root));
  });

  it("a root that fits returns its real run dir and makes nothing", () => {
    const parent = parentDir();
    const root = "/tmp/fits";
    expect(ensureSocketDir(root, { parent })).toBe(nativeRunDirFor(root));
    expect(readdirSync(parent)).toEqual([]);
  });

  it("refuses a folder that is a link", () => {
    const parent = parentDir();
    symlinkSync(tempDir("vf-elsewhere-"), join(parent, `vf-${uid}`));
    refused(() => ensureSocketDir(longRoot(), { parent }), /is a link/);
  });

  it("refuses a folder another uid owns (the seam names a uid that is not the folder's)", () => {
    const parent = parentDir();
    mkdirSync(join(parent, `vf-${uid + 1}`), { mode: 0o700 });
    refused(() => ensureSocketDir(longRoot(), { parent, uid: uid + 1 }), /belongs to uid/);
  });

  it("refuses a folder open to group or others (0755)", () => {
    const parent = parentDir();
    const folder = join(parent, `vf-${uid}`);
    mkdirSync(folder);
    chmodSync(folder, 0o755);
    refused(() => ensureSocketDir(longRoot(), { parent }), /open to others/);
  });

  it("refuses a file where the alias belongs", () => {
    const parent = parentDir();
    const root = longRoot();
    mkdirSync(join(parent, `vf-${uid}`), { mode: 0o700 });
    writeFileSync(socketAliasFor(uid, root, parent), "not a link");
    refused(() => ensureSocketDir(root, { parent }), /is not a link/);
  });

  it("replaces an alias pointing elsewhere, by a rename inside our own folder, removing nothing else", () => {
    const parent = parentDir();
    const root = longRoot();
    const folder = join(parent, `vf-${uid}`);
    mkdirSync(folder, { mode: 0o700 });
    writeFileSync(join(folder, "neighbour"), "stays");
    symlinkSync(tempDir("vf-elsewhere-"), socketAliasFor(uid, root, parent));
    expect(readdirSync(parent)).toEqual([`vf-${uid}`]);
    ensureSocketDir(root, { parent });
    expect(readlinkSync(socketAliasFor(uid, root, parent))).toBe(nativeRunDirFor(root));
    expect(readdirSync(folder).sort()).toEqual(
      ["neighbour", socketAliasFor(uid, root, parent).split("/").pop() ?? ""].sort(),
    );
    expect(readdirSync(parent)).toEqual([`vf-${uid}`]);
  });

  it("two spellings of one root reach the same socket: two links, one run dir (no case fold, VF-PM 10:54:44Z)", () => {
    const parent = parentDir();
    const base = tempDir("vf-case-");
    const lower = join(base, "x".repeat(80));
    mkdirSync(join(lower, "native", "run"), { recursive: true });
    const upper = join(base, "X".repeat(80));
    // Meaningful only where the volume folds case (APFS's default): there `upper` names the same folder.
    if (!existsSync(join(upper, "native", "run"))) return;
    const a = ensureSocketDir(lower, { parent });
    const b = ensureSocketDir(upper, { parent });
    expect(a).not.toBe(b);
    // the same directory by identity, not spelling: Node's realpathSync keeps the case it is given
    const [atA, atB] = [statSync(a), statSync(b)];
    expect([atA.dev, atA.ino]).toEqual([atB.dev, atB.ino]);
  });

  it("is idempotent: a second ensure keeps the same link", () => {
    const parent = parentDir();
    const root = longRoot();
    const first = ensureSocketDir(root, { parent });
    expect(first).toBe(socketAliasFor(uid, root, parent));
    const inode = lstatSync(first).ino;
    expect(ensureSocketDir(root, { parent })).toBe(first);
    expect(lstatSync(first).ino).toBe(inode);
  });
});
