import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CUSTODY, LAYOUT } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import { createShellCustody, type GatedAsk, type ShellCustody } from "../src/main/custody/custody";
import { resolveCustodyLevel } from "../src/main/custody/level";
import { custodyKeyPath, FIELDD_NOT_STARTED, openCustodyRoot } from "../src/main/custody/root";
import {
  drawsCounted,
  drawsPlainRoot,
  type FakeKeystore,
  fakeDerive,
  fakeKeystore,
  filesBelow,
  OWN,
  PLAIN_ROOT,
  vibefieldTree,
} from "./custody-fakes";

// OB custody, C1 (the shell keeps ONE secret, a 32-byte root,
// and keeps it only as the OS keystore wrapped it. Reading it answers one of two things, `ready` or `unavailable`,
// and never a third that waits for a person: a key that is absent, or present and not opening, is made anew BY
// ITSELF, and only after the keystore has wrapped and opened test bytes in the same reading (a keychain that is
// merely locked gives the same error as a wrong key, and must never be read as "the key no longer opens").
// `unavailable` starts no pair, and its refusal is a plain Error whose words name no key: the custody rule
// is that no key or custody concept reaches a person. Every keystore here is the rows' own arithmetic
// (custody-fakes.ts): no row reaches a keychain.

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath: string): string =>
  readFileSync(join(PACKAGE_ROOT, "src", relativePath), "utf8");
const POSIX = process.platform !== "win32";
/** what §7.3 says the refusal must not hold; the class name is read by a person too, so it is searched as well */
const NOT_FOR_A_PERSON = /key|keychain|custody|pairing|secret|token|restart/iu;

type Tree = ReturnType<typeof vibefieldTree>;

/** A person's ask, as a window's bootstrap, a switch to a person and the status item's Try Again make it. */
const PERSON = { person: true } as const;
/** How far apart two readings of an unavailable root must have started. */
const APART = CUSTODY.ROOT_REREAD_MIN_MS;

function sealed(
  tree: Tree,
  keystore: FakeKeystore,
  extra: {
    randomBytes?: (size: number) => Buffer;
    /** the clock custody measures its own intervals on, as the row moves it */
    monotonic?: () => number;
  } = {},
): ShellCustody {
  return createShellCustody({
    level: { level: "sealed", own: OWN },
    vibefieldRoot: tree.root,
    keystore: () => keystore,
    userRoots: () => tree.users,
    logRoot: tree.logRoot,
    derive: fakeDerive,
    ...extra,
  });
}

const unopenedPath = (tree: Tree): string =>
  join(dirname(custodyKeyPath(tree.root)), "custody.key.unopened");

/** A boot under `key`'s keystore that made and kept a root: the wrapped key it left on disk. */
function keptUnder(tree: Tree, key: string, randomBytes = drawsPlainRoot): Buffer {
  const root = openCustodyRoot({
    vibefieldRoot: tree.root,
    keystore: fakeKeystore(key),
    randomBytes,
  });
  expect(root.state).toBe("ready");
  return readFileSync(custodyKeyPath(tree.root));
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

/** The gate every pair's start goes through refuses, and what it guards was never called. Answers the refusal.
 * `ask` is how it was asked: nothing for an incidental ask, PERSON for a person's. */
async function startsNoPair(custody: ShellCustody, ask?: GatedAsk): Promise<unknown> {
  const start = vi.fn(async () => "a pair");
  const refusal = await custody
    .gate(start)(ask)
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(refusal).toBeInstanceOf(Error);
  expect(start).not.toHaveBeenCalled();
  return refusal;
}

describe("the shell's custody root (C1)", () => {
  it("the root is wrapped, never written plain", () => {
    const tree = vibefieldTree();
    const root = openCustodyRoot({
      vibefieldRoot: tree.root,
      keystore: fakeKeystore(),
      randomBytes: drawsPlainRoot,
    });
    expect(root.state).toBe("ready");
    expect(root.reading).toEqual({ outcome: "made-absent" });
    expect(root.bytes().equals(PLAIN_ROOT)).toBe(true);

    const kept = readFileSync(custodyKeyPath(tree.root));
    // what is on disk is what the keystore made of the root, and nothing else
    expect(kept.equals(fakeKeystore().wrap(PLAIN_ROOT))).toBe(true);
    // and no file under the VibeField root holds the root itself, as bytes, as hex or as base64
    for (const file of filesBelow(tree.root)) {
      const bytes = readFileSync(file);
      expect(bytes.includes(PLAIN_ROOT), file).toBe(false);
      expect(bytes.includes(PLAIN_ROOT.toString("hex")), file).toBe(false);
      expect(bytes.includes(PLAIN_ROOT.toString("base64")), file).toBe(false);
    }
  });

  it("the root is 32 bytes of the system's own randomness when nothing is injected", () => {
    const tree = vibefieldTree();
    const other = vibefieldTree();
    const first = openCustodyRoot({ vibefieldRoot: tree.root, keystore: fakeKeystore() });
    const second = openCustodyRoot({ vibefieldRoot: other.root, keystore: fakeKeystore() });
    expect(first.bytes()).toHaveLength(32);
    expect(second.bytes()).toHaveLength(32);
    expect(first.bytes().equals(second.bytes())).toBe(false);
  });

  it.skipIf(!POSIX)(
    "the key is at LAYOUT.CUSTODY_KEY, 0600 in a 0700 folder, written beside and renamed: nothing is left beside it",
    () => {
      const tree = vibefieldTree();
      openCustodyRoot({ vibefieldRoot: tree.root, keystore: fakeKeystore() });
      const path = custodyKeyPath(tree.root);
      expect(path).toBe(join(tree.root, ...LAYOUT.CUSTODY_KEY));
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
      expect(readdirSync(dirname(path))).toEqual(["custody.key"]);
    },
  );

  it("a later boot reads the same root back and makes nothing", () => {
    const tree = vibefieldTree();
    const kept = keptUnder(tree, "first");
    const keystore = fakeKeystore();
    const second = openCustodyRoot({
      vibefieldRoot: tree.root,
      keystore,
      randomBytes: () => {
        throw new Error("a kept root is read, never made again, and needs no test bytes");
      },
    });
    expect(second.state).toBe("ready");
    expect(second.reading).toEqual({ outcome: "opened" });
    expect(second.bytes().equals(PLAIN_ROOT)).toBe(true);
    // a key that opens is asked about once: no round trip, nothing wrapped
    expect(keystore.asked).toEqual({ available: 1, wrap: 0, unwrap: 1 });
    expect(readFileSync(custodyKeyPath(tree.root)).equals(kept)).toBe(true);
    expect(readdirSync(dirname(custodyKeyPath(tree.root)))).toEqual(["custody.key"]);
  });

  it("a key that is absent is made, and nothing on disk is consulted to decide it", () => {
    const tree = vibefieldTree([1, 2]);
    // what earlier versions read as "a key was lost": a fieldd that booted sealed, and a grants file that says so
    writeJson(join(tree.userRoots[0]!, ...LAYOUT.PRODUCT_JSON), {
      port: 50123,
      pid: 4001,
      bootId: "boot-sealed",
      contractsVersion: "0.1.0",
      startedAt: 1,
      nativePid: 4002,
      custody: "sealed",
    });
    writeJson(join(tree.userRoots[1]!, ...LAYOUT.OBJECTS_GRANTS_FILE), {
      format: 1,
      sealed: true,
      generation: 3,
      grants: [],
    });
    const root = openCustodyRoot({ vibefieldRoot: tree.root, keystore: fakeKeystore() });
    expect(root.state).toBe("ready");
    expect(root.reading).toEqual({ outcome: "made-absent" });
    expect(statSync(custodyKeyPath(tree.root)).isFile()).toBe(true);
    // the reading has no roster to look through and names neither file
    const reading = source("main/custody/root.ts");
    expect(reading).not.toMatch(/PRODUCT_JSON|OBJECTS_GRANTS|userRoots/u);
    expect(reading).not.toMatch(/"changed"/u);
  });

  it("a key that does not open is renewed ONLY after the round trip succeeds", () => {
    const tree = vibefieldTree();
    const old = keptUnder(tree, "before");
    const path = custodyKeyPath(tree.root);
    const keystore = fakeKeystore("after");
    // the key file as it stood at each ask of the keystore, in order
    const stood: string[] = [];
    const note = (ask: string): void =>
      void stood.push(`${ask}:${readFileSync(path).equals(old) ? "old" : "new"}`);
    const { wrap, unwrap } = keystore;
    keystore.wrap = (plain) => {
      note("wrap");
      return wrap(plain);
    };
    keystore.unwrap = (wrapped) => {
      note("unwrap");
      return unwrap(wrapped);
    };

    const root = openCustodyRoot({
      vibefieldRoot: tree.root,
      keystore,
      randomBytes: drawsCounted(),
    });
    expect(root.state).toBe("ready");
    expect(root.reading).toEqual({ outcome: "made-unopenable" });
    // the kept key was tried; then test bytes went out and came back; only then was a root wrapped. The old key
    // stood where it was through all four asks
    expect(stood).toEqual(["unwrap:old", "wrap:old", "unwrap:old", "wrap:old"]);
    // the test bytes were the first draw and the root the second: the root is never what was tried
    expect(root.bytes().equals(Buffer.alloc(32, 2))).toBe(true);
    const kept = readFileSync(path);
    expect(kept.equals(old)).toBe(false);
    expect(fakeKeystore("after").unwrap(kept).equals(Buffer.alloc(32, 2))).toBe(true);
  });

  it.each([
    ["a keychain that is locked: it wraps, and opens nothing", { opens: false }],
    ["a keystore that opens something else than it wrapped", { garbles: true }],
    ["a keystore that says it is there and then will not wrap", { wraps: false }],
  ] as const)("a failed round trip makes nothing and renames nothing (%s)", (_name, fault) => {
    // over a kept key that does not open, and over no key at all
    const withKey = vibefieldTree();
    const old = keptUnder(withKey, "before");
    const bare = vibefieldTree();
    for (const tree of [withKey, bare]) {
      const keystore = Object.assign(fakeKeystore("after"), fault);
      const root = openCustodyRoot({ vibefieldRoot: tree.root, keystore });
      expect(root.state).toBe("unavailable");
      expect(root.reading).toEqual({ outcome: "unavailable", cause: "roundtrip-failed" });
      expect(() => root.bytes()).toThrow(FIELDD_NOT_STARTED);
    }
    expect(readFileSync(custodyKeyPath(withKey.root)).equals(old)).toBe(true);
    expect(readdirSync(dirname(custodyKeyPath(withKey.root)))).toEqual(["custody.key"]);
    expect(filesBelow(bare.root)).toEqual([]);
  });

  it("a keychain that was only locked opens the SAME root at the next reading: nothing was renewed", () => {
    const tree = vibefieldTree();
    const good = keptUnder(tree, "first");
    const keystore = fakeKeystore("first");
    keystore.opens = false;
    const root = openCustodyRoot({ vibefieldRoot: tree.root, keystore });
    expect(root.reading).toEqual({ outcome: "unavailable", cause: "roundtrip-failed" });

    keystore.opens = true;
    expect(root.read()).toEqual({ outcome: "opened" });
    expect(root.state).toBe("ready");
    expect(root.bytes().equals(PLAIN_ROOT)).toBe(true);
    expect(readFileSync(custodyKeyPath(tree.root)).equals(good)).toBe(true);
    expect(existsSync(unopenedPath(tree))).toBe(false);
    // and a root that is ready is never read again
    const asked = { ...keystore.asked };
    expect(root.read()).toEqual({ outcome: "opened" });
    expect(keystore.asked).toEqual(asked);
  });

  it("a root that became ready stays ready: a keystore that stops answering changes nothing and is asked nothing", () => {
    // `unavailable` is reachable only BEFORE the first ready reading. What an incidental ask may read rests on it:
    // were a ready root ever to go back, that road would be a new question.
    const tree = vibefieldTree();
    const keystore = fakeKeystore();
    const root = openCustodyRoot({
      vibefieldRoot: tree.root,
      keystore,
      randomBytes: drawsPlainRoot,
    });
    expect(root.reading).toEqual({ outcome: "made-absent" });
    const asked = { ...keystore.asked };

    keystore.answers = false;
    keystore.opens = false;
    for (let reading = 0; reading < 3; reading += 1) {
      expect(root.read()).toEqual({ outcome: "made-absent" });
    }
    expect(root.state).toBe("ready");
    expect(root.bytes().equals(PLAIN_ROOT)).toBe(true);
    expect(keystore.asked).toEqual(asked);
  });

  it("a keystore that does not answer is unavailable, and nothing is asked of it or made", () => {
    const tree = vibefieldTree();
    const keystore = fakeKeystore();
    keystore.answers = false;
    const root = openCustodyRoot({ vibefieldRoot: tree.root, keystore });
    expect(root.state).toBe("unavailable");
    expect(root.reading).toEqual({ outcome: "unavailable", cause: "keystore-unavailable" });
    expect(keystore.asked).toEqual({ available: 1, wrap: 0, unwrap: 0 });
    expect(filesBelow(tree.root)).toEqual([]);
  });

  it("the unopened key is kept aside, one copy", () => {
    const tree = vibefieldTree();
    const first = keptUnder(tree, "first");
    const dir = dirname(custodyKeyPath(tree.root));

    // the keystore's key changed: the key it cannot open is renamed aside, never overwritten and never removed
    openCustodyRoot({ vibefieldRoot: tree.root, keystore: fakeKeystore("second") });
    const second = readFileSync(custodyKeyPath(tree.root));
    expect(readdirSync(dir).sort()).toEqual(["custody.key", "custody.key.unopened"]);
    expect(readFileSync(unopenedPath(tree)).equals(first)).toBe(true);
    expect(fakeKeystore("second").unwrap(second)).toHaveLength(32);

    // and again: ONE is kept, the newest, in the earlier one's place
    openCustodyRoot({ vibefieldRoot: tree.root, keystore: fakeKeystore("third") });
    expect(readdirSync(dir).sort()).toEqual(["custody.key", "custody.key.unopened"]);
    expect(readFileSync(unopenedPath(tree)).equals(second)).toBe(true);
    expect(fakeKeystore("third").unwrap(readFileSync(custodyKeyPath(tree.root)))).toHaveLength(32);
  });

  it.skipIf(!POSIX)("the key kept aside is 0600 as it was, and the new one is 0600", () => {
    const tree = vibefieldTree();
    keptUnder(tree, "first");
    openCustodyRoot({ vibefieldRoot: tree.root, keystore: fakeKeystore("second") });
    expect(statSync(custodyKeyPath(tree.root)).mode & 0o777).toBe(0o600);
    expect(statSync(unopenedPath(tree)).mode & 0o777).toBe(0o600);
  });

  it("a kept key that opens to something that is not 32 bytes is present and not opening", () => {
    const tree = vibefieldTree();
    const path = custodyKeyPath(tree.root);
    mkdirSync(dirname(path), { recursive: true });
    const short = fakeKeystore().wrap(Buffer.alloc(16, 7));
    writeFileSync(path, short);
    const root = openCustodyRoot({ vibefieldRoot: tree.root, keystore: fakeKeystore() });
    expect(root.reading).toEqual({ outcome: "made-unopenable" });
    expect(root.bytes()).toHaveLength(32);
    expect(readFileSync(unopenedPath(tree)).equals(short)).toBe(true);
  });

  it("a key file too large to be a wrapped root is not read, and is present and not opening", () => {
    const tree = vibefieldTree();
    const path = custodyKeyPath(tree.root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.alloc(8192, 1));
    const keystore = fakeKeystore();
    const root = openCustodyRoot({ vibefieldRoot: tree.root, keystore });
    expect(root.reading).toEqual({ outcome: "made-unopenable" });
    // it was never handed to the keystore: the one unwrap is the round trip's
    expect(keystore.asked.unwrap).toBe(1);
    expect(statSync(unopenedPath(tree)).size).toBe(8192);
  });

  it.skipIf(!POSIX)(
    "a link where the key was is not the key: it is never followed, and is kept aside as a link",
    () => {
      const tree = vibefieldTree();
      const elsewhere = join(tree.root, "elsewhere.key");
      const planted = fakeKeystore().wrap(PLAIN_ROOT);
      writeFileSync(elsewhere, planted);
      const path = custodyKeyPath(tree.root);
      mkdirSync(dirname(path), { recursive: true });
      symlinkSync(elsewhere, path);

      const root = openCustodyRoot({
        vibefieldRoot: tree.root,
        keystore: fakeKeystore(),
        randomBytes: drawsCounted(),
      });
      // the wrapped root the link pointed at would have opened: it was not read
      expect(root.reading).toEqual({ outcome: "made-unopenable" });
      expect(root.bytes().equals(PLAIN_ROOT)).toBe(false);
      expect(lstatSync(path).isFile()).toBe(true);
      expect(lstatSync(unopenedPath(tree)).isSymbolicLink()).toBe(true);
      expect(readFileSync(elsewhere).equals(planted)).toBe(true);
    },
  );

  it("a new root that cannot be kept is unavailable: nothing is ready that is not on disk", () => {
    const tree = vibefieldTree();
    // a file where the key's folder would be: the folder cannot be made
    writeFileSync(dirname(custodyKeyPath(tree.root)), "");
    const root = openCustodyRoot({ vibefieldRoot: tree.root, keystore: fakeKeystore() });
    expect(root.state).toBe("unavailable");
    expect(root.reading).toEqual({ outcome: "unavailable", cause: "write-failed" });
    expect(() => root.bytes()).toThrow(FIELDD_NOT_STARTED);
  });
});

describe("`unavailable` starts no pair (C1)", () => {
  it("a keystore that will not answer refuses the pair and writes no token", async () => {
    const tree = vibefieldTree();
    const keystore = fakeKeystore();
    keystore.answers = false;
    const custody = sealed(tree, keystore);

    // never a fall back to `files`: the level is what the build is, whatever the keystore does
    expect(custody.level).toBe("sealed");
    expect(custody.state()).toBe("unavailable");
    await startsNoPair(custody);
    // nothing is derived for a daemon either: there is no hand-off to write and no secret to pair with
    const userRoot = tree.userRoots[0]!;
    expect(() => custody.forUserRoot(userRoot)?.handoff()).toThrow(FIELDD_NOT_STARTED);
    expect(() => custody.shellSecret(userRoot)).toThrow(FIELDD_NOT_STARTED);
    // and nothing was made: no key, no token, no file at all under the VibeField root
    expect(filesBelow(tree.root)).toEqual([]);
    expect(keystore.asked.wrap).toBe(0);
    expect(keystore.asked.unwrap).toBe(0);
  });

  it("`unavailable` builds no pair: however often a start is asked, the supervisor is never asked", async () => {
    const tree = vibefieldTree();
    const keystore = fakeKeystore();
    keystore.opens = false;
    keptUnder(tree, "first");
    const custody = sealed(tree, keystore);
    const start = vi.fn(async () => "a pair");
    const gated = custody.gate(start);
    for (let ask = 0; ask < 5; ask += 1) {
      await expect(gated()).rejects.toThrow(FIELDD_NOT_STARTED);
    }
    expect(start).not.toHaveBeenCalled();
    expect(custody.state()).toBe("unavailable");
  });

  it("the refusal's message names no key, keychain or custody, and neither does its class", async () => {
    const tree = vibefieldTree();
    const keystore = fakeKeystore();
    keystore.answers = false;
    const refusal = (await startsNoPair(sealed(tree, keystore))) as Error;

    // ONE constant, in the register a failed start already has
    expect(FIELDD_NOT_STARTED).toBe("fieldd was not started");
    expect(refusal.message).toBe(FIELDD_NOT_STARTED);
    // a plain Error: Electron sends main's `toString()` to the splash, so the class name is read by a person too
    expect(Object.getPrototypeOf(refusal)).toBe(Error.prototype);
    expect(refusal.name).toBe("Error");
    expect(String(refusal)).toBe("Error: fieldd was not started");
    expect(String(refusal)).not.toMatch(NOT_FOR_A_PERSON);
    // and it carries nothing else a bootstrap could show
    expect(Object.keys(refusal)).toEqual([]);
    expect("cause" in refusal).toBe(false);
    // the words wait on item 280, and the constant says so where it is written
    expect(source("main/custody/root.ts")).toContain("‹pending item 280›");
  });

  it("no error class of custody's exists to reach a bootstrap", () => {
    for (const file of filesBelow(join(PACKAGE_ROOT, "src", "main", "custody"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\bextends\s+Error\b/u);
    }
  });

  it("a person's ask while `unavailable` reads the root again, and the pair starts once it opens", async () => {
    const tree = vibefieldTree();
    const keystore = fakeKeystore();
    keystore.answers = false;
    const clock = { at: 0 };
    const custody = sealed(tree, keystore, {
      randomBytes: drawsCounted(),
      monotonic: () => clock.at,
    });
    expect(keystore.asked.available).toBe(1);

    // a person's Retry, two seconds after the reading before it began: read again from the top, once
    clock.at += APART;
    await startsNoPair(custody, PERSON);
    expect(keystore.asked.available).toBe(2);
    clock.at += APART;
    await startsNoPair(custody, PERSON);
    expect(keystore.asked.available).toBe(3);

    // the keystore answers: the same ask that finds it out goes on, and the pair starts
    keystore.answers = true;
    clock.at += APART;
    const start = vi.fn(async () => "a pair");
    expect(await custody.gate(start)(PERSON)).toBe("a pair");
    expect(start).toHaveBeenCalledTimes(1);
    expect(custody.state()).toBe("ready");
    expect(keystore.asked.available).toBe(4);
    expect(custody.shellSecret(tree.userRoots[0]!)).toBe(
      fakeDerive(Buffer.alloc(32, 2), CUSTODY.LABELS.shell, tree.userRoots[0]!),
    );

    // a root that is ready is never read again, whoever asks and however much later
    clock.at += APART;
    expect(await custody.gate(start)(PERSON)).toBe("a pair");
    expect(await custody.gate(start)()).toBe("a pair");
    expect(keystore.asked.available).toBe(4);
  });

  it("an incidental ask while `unavailable` reads NOTHING: a hundred of them make no reading", async () => {
    const tree = vibefieldTree();
    const keystore = fakeKeystore();
    keystore.answers = false;
    const clock = { at: 0 };
    const custody = sealed(tree, keystore, { monotonic: () => clock.at });
    const start = vi.fn(async () => "a pair");
    const gated = custody.gate(start);
    const signal = new AbortController().signal;

    // a timer's ask, an audit's, a preview's: none says a person asked, however long after the last reading
    for (let tick = 0; tick < 100; tick += 1) {
      clock.at += 60_000;
      await expect(gated()).rejects.toThrow(FIELDD_NOT_STARTED);
      await expect(gated({ signal })).rejects.toThrow(FIELDD_NOT_STARTED);
      await expect(gated({ person: false })).rejects.toThrow(FIELDD_NOT_STARTED);
    }
    expect(keystore.asked).toEqual({ available: 1, wrap: 0, unwrap: 0 });

    // not even once the keystore would answer: an incidental ask is answered from the last reading
    keystore.answers = true;
    await expect(gated()).rejects.toThrow(FIELDD_NOT_STARTED);
    expect(keystore.asked.available).toBe(1);
    expect(custody.state()).toBe("unavailable");
    expect(start).not.toHaveBeenCalled();
    expect(filesBelow(tree.root)).toEqual([]);
  });

  it("an incidental ask is refused exactly as a fresh reading refuses: no caller can tell the two apart", async () => {
    const tree = vibefieldTree();
    const keystore = fakeKeystore();
    keystore.answers = false;
    const clock = { at: 0 };
    const custody = sealed(tree, keystore, { monotonic: () => clock.at });

    const incidental = (await startsNoPair(custody)) as Error;
    expect(keystore.asked.available).toBe(1);
    clock.at += APART;
    const fresh = (await startsNoPair(custody, PERSON)) as Error;
    expect(keystore.asked.available).toBe(2);
    for (const refusal of [incidental, fresh]) {
      expect(Object.getPrototypeOf(refusal)).toBe(Error.prototype);
      expect(String(refusal)).toBe("Error: fieldd was not started");
      expect(Object.keys(refusal)).toEqual([]);
      expect("cause" in refusal).toBe(false);
    }
  });

  it("ten asks of a person inside two seconds make ONE reading, and the next after them reads again", async () => {
    expect(CUSTODY.ROOT_REREAD_MIN_MS).toBe(2_000);
    const tree = vibefieldTree();
    const keystore = fakeKeystore();
    keystore.answers = false;
    const clock = { at: 0 };
    const custody = sealed(tree, keystore, { monotonic: () => clock.at });

    // Retry pressed fast: the first reads, and the nine after it get that reading's answer
    clock.at = 5_000;
    for (let press = 0; press < 10; press += 1) {
      await startsNoPair(custody, PERSON);
      clock.at += 199;
    }
    expect(keystore.asked.available).toBe(2);
    // the interval runs from when that reading STARTED: one millisecond short of it, nothing is read
    clock.at = 5_000 + APART - 1;
    await startsNoPair(custody, PERSON);
    expect(keystore.asked.available).toBe(2);
    clock.at = 5_000 + APART;
    await startsNoPair(custody, PERSON);
    expect(keystore.asked.available).toBe(3);
  });

  it("the boot's own reading opens the first interval: a person's ask inside it reads nothing more", async () => {
    const tree = vibefieldTree();
    const keystore = fakeKeystore();
    keystore.answers = false;
    const clock = { at: 700 };
    const custody = sealed(tree, keystore, { monotonic: () => clock.at });

    clock.at = 700 + APART - 1;
    await startsNoPair(custody, PERSON);
    expect(keystore.asked.available).toBe(1);
    clock.at = 700 + APART;
    await startsNoPair(custody, PERSON);
    expect(keystore.asked.available).toBe(2);
  });

  it("two asks of a person at once share one reading", async () => {
    const tree = vibefieldTree();
    const keystore = fakeKeystore();
    keystore.answers = false;
    const clock = { at: 0 };
    const custody = sealed(tree, keystore, { monotonic: () => clock.at });
    const start = vi.fn(async () => "a pair");
    const gated = custody.gate(start);

    clock.at += APART;
    const refused = await Promise.allSettled([gated(PERSON), gated(PERSON)]);
    expect(refused.map((settled) => settled.status)).toEqual(["rejected", "rejected"]);
    expect(keystore.asked.available).toBe(2);

    // and when the reading they share finds the keystore answering, both go on
    keystore.answers = true;
    clock.at += APART;
    expect(await Promise.all([gated(PERSON), gated(PERSON)])).toEqual(["a pair", "a pair"]);
    expect(keystore.asked.available).toBe(3);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("a keychain that was locked at boot and is unlocked by a person's next ask opens the root it kept", async () => {
    const tree = vibefieldTree();
    const good = keptUnder(tree, "first");
    const keystore = fakeKeystore("first");
    keystore.opens = false;
    const clock = { at: 0 };
    const custody = sealed(tree, keystore, { monotonic: () => clock.at });
    clock.at += APART;
    await startsNoPair(custody, PERSON);
    expect(readFileSync(custodyKeyPath(tree.root)).equals(good)).toBe(true);

    keystore.opens = true;
    clock.at += APART;
    expect(await custody.gate(async () => "a pair")(PERSON)).toBe("a pair");
    // the same root as before the lock: every secret derived from it is what it was
    expect(custody.shellSecret(tree.userRoots[0]!)).toBe(
      fakeDerive(PLAIN_ROOT, CUSTODY.LABELS.shell, tree.userRoots[0]!),
    );
    expect(readFileSync(custodyKeyPath(tree.root)).equals(good)).toBe(true);
    expect(existsSync(unopenedPath(tree))).toBe(false);
  });

  it("who asked never reaches the start: the gate takes `person` off, at `sealed` and at `files`", async () => {
    const tree = vibefieldTree();
    const below = createShellCustody({
      level: { level: "files" },
      vibefieldRoot: tree.root,
      keystore: () => fakeKeystore(),
      userRoots: () => tree.users,
      logRoot: tree.logRoot,
    });
    const signal = new AbortController().signal;
    for (const custody of [sealed(tree, fakeKeystore()), below]) {
      const start = vi.fn(async (_options?: { signal?: AbortSignal }) => "a pair");
      const gated = custody.gate(start);
      await gated(PERSON);
      await gated({ person: true, signal });
      await gated({ signal });
      await gated();
      // what a supervisor's ensure always took: a signal, or nothing. Strictly: a `person` that is there and
      // `undefined` is not the same as one that is absent, and it must be absent
      expect(start.mock.calls, custody.level).toStrictEqual([
        [undefined],
        [{ signal }],
        [{ signal }],
        [undefined],
      ]);
      for (const [handed] of start.mock.calls) {
        expect(handed !== undefined && "person" in handed, custody.level).toBe(false);
      }
    }
  });

  it("the interval is custody's own clock, one that never runs backwards, and the registry's two seconds", () => {
    const custody = source("main/custody/custody.ts");
    expect(custody).toContain("options.monotonic ?? (() => performance.now())");
    expect(custody).toContain('import { performance } from "node:perf_hooks";');
    expect(custody).toContain("CUSTODY.ROOT_REREAD_MIN_MS");
  });
});

describe("below `sealed` (C1)", () => {
  it("dev never calls the keystore", async () => {
    const tree = vibefieldTree();
    const makeKeystore = vi.fn(() => fakeKeystore());
    const ownIdentity = vi.fn(async () => OWN);
    // an unpackaged build on macOS, and a packaged one off it: neither is asked whose code it is
    const dev = await resolveCustodyLevel({ platform: "darwin", packaged: false, ownIdentity });
    const offMac = await resolveCustodyLevel({ platform: "linux", packaged: true, ownIdentity });
    expect([dev, offMac]).toEqual([{ level: "files" }, { level: "files" }]);
    expect(ownIdentity).not.toHaveBeenCalled();

    const custody = createShellCustody({
      level: { level: "files" },
      vibefieldRoot: tree.root,
      keystore: makeKeystore,
      userRoots: () => tree.users,
      logRoot: tree.logRoot,
    });
    expect(custody.level).toBe("files");
    expect(custody.state()).toBe("ready");
    expect(custody.forUserRoot(tree.userRoots[0]!)).toBeUndefined();
    expect(custody.shellSecret(tree.userRoots[0]!)).toBeUndefined();
    // a pair's start is asked at once and with what it always was: nothing waits, and nothing is read
    const start = vi.fn(async (_options?: { signal?: AbortSignal }) => "a pair");
    const signal = new AbortController().signal;
    expect(await custody.gate(start)()).toBe("a pair");
    expect(await custody.gate(start)({ signal })).toBe("a pair");
    expect(start.mock.calls).toEqual([[undefined], [{ signal }]]);

    expect(makeKeystore).not.toHaveBeenCalled();
    expect(filesBelow(tree.root)).toEqual([]);
  });

  it("`files` never constructs the Electron keystore: main hands its maker, and one file names it", () => {
    const naming = filesBelow(join(PACKAGE_ROOT, "src"))
      .filter((file) => /\bsafeStorage\b/u.test(readFileSync(file, "utf8")))
      .map((file) => relative(PACKAGE_ROOT, file).split(sep).join("/"));
    expect(naming).toEqual(["src/main/custody/keystore-electron.ts"]);
    const main = source("main/index.ts");
    expect(main).toContain("keystore: createElectronKeystore,");
    expect(main).not.toContain("createElectronKeystore(");
    // and nothing in custody's own files makes one: the maker arrives from the composition root
    for (const file of ["custody.ts", "root.ts", "provider.ts", "level.ts", "old-pair.ts"]) {
      expect(source(`main/custody/${file}`), file).not.toContain("keystore-electron");
    }
  });

  it("main starts every pair through custody's gate, and asks a supervisor nowhere else", () => {
    const main = source("main/index.ts");
    expect(main).toContain("upstreamEnsure: custody.gate(startPair),");
    expect(main.match(/\bsup\.ensure\(/gu)).toHaveLength(1);
    // nor the attached pair's supervisor under its other name: main's `ensureFieldd` (item 287) asks the
    // attached pair's coordinator alone
    expect(main).not.toMatch(/\bsupervisor\.ensure\(/u);
  });
});

describe("no key or custody concept reaches a person (C1)", () => {
  // It is either the app runs or it crashed. No sheet, no act a person
  // presses, no bridge row, no words constant in main.

  it("the window has no custody door: the preload, the handlers and the page's types name none", () => {
    for (const file of ["preload/index.ts", "main/ipc.ts", "renderer-host/global.d.ts"]) {
      expect(source(file), file).not.toMatch(/custody/iu);
    }
  });

  it("main keeps no words about its keys, no door and no act a person presses", () => {
    const custodyDir = join(PACKAGE_ROOT, "src", "main", "custody");
    expect(readdirSync(custodyDir).sort()).toEqual([
      "custody.ts",
      "keystore-electron.ts",
      "keystore.ts",
      "level.ts",
      "old-pair.ts",
      "provider.ts",
      "resident-probe.ts",
      "root.ts",
    ]);
    const shell = filesBelow(join(PACKAGE_ROOT, "src"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    for (const withdrawn of [
      "CustodyStatus",
      "custodyStatus",
      "custodyRetry",
      "custodyStartOver",
      "registerCustodyDoors",
      "CUSTODY_REFUSAL_WORDS",
      "CustodyNotReadyError",
      "startOver",
      "keychain didn't answer",
      "no longer open what it holds",
    ]) {
      expect(shell.includes(withdrawn), withdrawn).toBe(false);
    }
  });

  it("every string custody can throw is the one constant, or never leaves main", () => {
    // what a pair's start can be refused with is FIELDD_NOT_STARTED and nothing else: custody.ts and root.ts make no
    // other Error. (keystore-electron.ts throws inside `unwrap`, which root.ts catches: its words stay in main.)
    for (const file of ["custody.ts", "root.ts", "provider.ts", "old-pair.ts"]) {
      const made = source(`main/custody/${file}`).match(/new Error\(([^)]*)\)/gu) ?? [];
      for (const error of made) expect(error, file).toBe("new Error(FIELDD_NOT_STARTED)");
    }
  });
});
