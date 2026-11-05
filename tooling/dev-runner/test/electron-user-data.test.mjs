// BP-1c (BP-D9 (a)) — the dev runner's Electron userData moved to the dev root, so the desk browser's profiles under the
// data root lie inside it. What a developer's desk keeps of its own in the old folder (the theme, the renderer's storage)
// is carried ONCE, by copy: never a cache, never a live profile, never over what the new folder has, and the old folder
// left exactly as it was.
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CARRIED_ENTRIES,
  carryLegacyElectronState,
  carryWords,
  lockHolderAlive,
  STAGING_PREFIX,
} from "../src/electron-user-data.mjs";

/** A dev root with the old folder laid out as James's was (2026-11-05): the desk's own state beside Chromium's caches. */
function devRoot() {
  const root = mkdtempSync(join(tmpdir(), "vf-bp1c-dev-"));
  const from = join(root, "electron-user-data");
  mkdirSync(join(from, "Local Storage", "leveldb"), { recursive: true });
  writeFileSync(join(from, "Local Storage", "leveldb", "000003.log"), "desk-local-storage");
  mkdirSync(join(from, "IndexedDB"), { recursive: true });
  mkdirSync(join(from, "File System", "000", "t"), { recursive: true });
  writeFileSync(join(from, "File System", "000", "t", "still"), "a still");
  mkdirSync(join(from, "WebStorage"), { recursive: true });
  writeFileSync(join(from, "vibefield-theme.json"), '{"preference":"dark"}\n');
  mkdirSync(join(from, "Cache", "Cache_Data"), { recursive: true });
  writeFileSync(join(from, "Cache", "Cache_Data", "data_1"), "x".repeat(64));
  mkdirSync(join(from, "Code Cache"), { recursive: true });
  writeFileSync(join(from, "Cookies"), "shell cookies");
  writeFileSync(join(from, "Local State"), "{}");
  writeFileSync(join(from, "Preferences"), "{}");
  mkdirSync(join(from, "Crashpad"), { recursive: true });
  return { root, from, to: root, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** Every path under `dir`, with each file's bytes: the old folder's whole state, to hold it unchanged. */
function snapshot(dir) {
  const out = {};
  const walk = (at, rel) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const key = rel === "" ? name : `${rel}/${name}`;
      const st = lstatSync(path);
      if (st.isDirectory()) {
        out[key] = "<dir>";
        walk(path, key);
      } else out[key] = st.isSymbolicLink() ? "<link>" : readFileSync(path, "utf8");
    }
  };
  walk(dir, "");
  return out;
}

test("carries the theme and the renderer's storage once, and nothing of Chromium's own", () => {
  const d = devRoot();
  try {
    const before = snapshot(d.from);
    const result = carryLegacyElectronState({ from: d.from, to: d.to });
    assert.deepEqual(result, { carried: [...CARRIED_ENTRIES] });
    assert.equal(
      readFileSync(join(d.to, "Local Storage", "leveldb", "000003.log"), "utf8"),
      "desk-local-storage",
    );
    assert.equal(readFileSync(join(d.to, "File System", "000", "t", "still"), "utf8"), "a still");
    assert.equal(
      readFileSync(join(d.to, "vibefield-theme.json"), "utf8"),
      '{"preference":"dark"}\n',
    );
    for (const never of [
      "Cache",
      "Code Cache",
      "Cookies",
      "Local State",
      "Preferences",
      "Crashpad",
    ])
      assert.equal(existsSync(join(d.to, never)), false, never);
    // each entry took its name whole: no staging copy is left beside it
    assert.deepEqual(
      readdirSync(d.to).filter((n) => n.startsWith(STAGING_PREFIX)),
      [],
    );
    // the old folder is left exactly as it was
    assert.deepEqual(snapshot(d.from), before);
  } finally {
    d.done();
  }
});

test("a copy that fails partway leaves no half entry: the rest come across, and the words name what could not", () => {
  const d = devRoot();
  try {
    const before = snapshot(d.from);
    // a full disk midway through the desk's OPFS store: one file of it written, then ENOSPC
    const fs = {
      ...nodeFs,
      cpSync(source, target, options) {
        if (!source.endsWith("File System")) return nodeFs.cpSync(source, target, options);
        nodeFs.mkdirSync(join(target, "000", "t"), { recursive: true });
        nodeFs.writeFileSync(join(target, "000", "t", "half"), "half a still");
        throw Object.assign(new Error("ENOSPC: no space left on device, write"), {
          code: "ENOSPC",
        });
      },
    };
    const result = carryLegacyElectronState({ from: d.from, to: d.to, fs });
    assert.deepEqual(
      result.carried,
      CARRIED_ENTRIES.filter((n) => n !== "File System"),
    );
    assert.deepEqual(result.failed, [
      { name: "File System", error: "ENOSPC: no space left on device, write" },
    ]);
    assert.equal(result.reason, undefined);
    // the failed entry is ABSENT, never half there, and its staging copy is gone
    assert.equal(existsSync(join(d.to, "File System")), false);
    assert.deepEqual(
      readdirSync(d.to).filter((n) => n.startsWith(STAGING_PREFIX)),
      [],
    );
    // what did come across is whole
    assert.equal(
      readFileSync(join(d.to, "Local Storage", "leveldb", "000003.log"), "utf8"),
      "desk-local-storage",
    );
    assert.deepEqual(snapshot(d.from), before);
    const words = carryWords(result, d);
    assert.match(words, /could not carry File System \(ENOSPC: no space left on device, write\)/);
    assert.match(words, /it starts afresh in the new folder \(nothing half-copied is left there\)/);
    assert.match(words, /carried vibefield-theme\.json, Local Storage, IndexedDB, WebStorage; /);
  } finally {
    d.done();
  }
});

test("a staging copy a stopped runner left behind is cleared first, and the entry comes across whole", () => {
  const d = devRoot();
  try {
    const stale = join(d.to, `${STAGING_PREFIX}Local Storage`);
    mkdirSync(join(stale, "leveldb"), { recursive: true });
    writeFileSync(join(stale, "leveldb", "stale.log"), "half of an earlier copy");
    const result = carryLegacyElectronState({ from: d.from, to: d.to });
    assert.deepEqual(result, { carried: [...CARRIED_ENTRIES] });
    assert.equal(existsSync(stale), false);
    assert.equal(existsSync(join(d.to, "Local Storage", "leveldb", "stale.log")), false);
    assert.equal(
      readFileSync(join(d.to, "Local Storage", "leveldb", "000003.log"), "utf8"),
      "desk-local-storage",
    );
  } finally {
    d.done();
  }
});

test("a staging copy that will not go is never copied into: that entry fails, named, and nothing merges", () => {
  const d = devRoot();
  try {
    const stuck = join(d.to, `${STAGING_PREFIX}IndexedDB`);
    mkdirSync(stuck, { recursive: true });
    writeFileSync(join(stuck, "left"), "an earlier copy");
    const fs = {
      ...nodeFs,
      rmSync(path, options) {
        if (path === stuck) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        return nodeFs.rmSync(path, options);
      },
    };
    const result = carryLegacyElectronState({ from: d.from, to: d.to, fs });
    assert.deepEqual(result.failed, [
      { name: "IndexedDB", error: `its staging copy ${stuck} could not be cleared` },
    ]);
    assert.equal(existsSync(join(d.to, "IndexedDB")), false);
    assert.deepEqual(readdirSync(stuck), ["left"]);
  } finally {
    d.done();
  }
});

test("once Chromium has run on the new folder, nothing is carried again", () => {
  const d = devRoot();
  try {
    writeFileSync(join(d.to, "Local State"), "{}");
    assert.deepEqual(carryLegacyElectronState({ from: d.from, to: d.to }), {
      carried: [],
      reason: "already-moved",
    });
    assert.equal(existsSync(join(d.to, "vibefield-theme.json")), false);
  } finally {
    d.done();
  }
});

test("a live Electron's lock on the old folder stops the carry: a live profile is never copied", {
  // a symlink needs a privilege on Windows; Chromium's lock there is not a link either
  skip: process.platform === "win32",
}, () => {
  const d = devRoot();
  try {
    // a lock this host's LIVE process holds (this test's own pid)
    symlinkSync(`${hostname()}-${process.pid}`, join(d.from, "SingletonLock"));
    const result = carryLegacyElectronState({ from: d.from, to: d.to });
    assert.deepEqual(result, { carried: [], reason: "old-folder-in-use" });
    assert.equal(existsSync(join(d.to, "Local Storage")), false);
    const words = carryWords(result, d);
    // a REFUSAL (prod-builder's L3 review): the runner stops, so one restart carries — nothing is stranded
    assert.match(words, /holds a running Electron's lock, so pnpm dev did not start/);
    assert.match(words, /then run pnpm dev again, and the desk's own state is carried once into/);
    assert.match(
      words,
      /Nothing was carried, nothing was started, and the old folder is left as it was/,
    );
  } finally {
    d.done();
  }
});

test("a crashed Electron's STALE lock (its pid gone on this host) does not stop the carry", {
  skip: process.platform === "win32",
}, () => {
  const d = devRoot();
  try {
    symlinkSync(`${hostname()}-4242`, join(d.from, "SingletonLock"));
    const asked = [];
    const result = carryLegacyElectronState({
      from: d.from,
      to: d.to,
      lockAlive: (target) => {
        asked.push(target);
        return lockHolderAlive(target, { alive: () => false });
      },
    });
    assert.deepEqual(asked, [`${hostname()}-4242`]);
    assert.deepEqual(result, { carried: [...CARRIED_ENTRIES] });
    // the lock is the old folder's, and stays there; it is never carried
    assert.equal(existsSync(join(d.to, "SingletonLock")), false);
    assert.equal(lstatSync(join(d.from, "SingletonLock")).isSymbolicLink(), true);
  } finally {
    d.done();
  }
});

test("a lock's holder is read from Chromium's `<hostname>-<pid>`; anything it cannot read is taken as live", () => {
  const dead = { host: "mac", alive: () => false };
  const live = { host: "mac", alive: () => true };
  assert.equal(lockHolderAlive("mac-4242", dead), false);
  assert.equal(lockHolderAlive("mac-4242", live), true);
  // a hostname with dashes: the pid is after the LAST one
  assert.equal(
    lockHolderAlive("jamess-mac-mini-4242", { ...dead, host: "jamess-mac-mini" }),
    false,
  );
  // another host's lock, an unreadable target, or no pid: never taken as stale
  for (const target of ["other-4242", null, "mac", "mac-", "mac-x1", "mac-0", "-4242"])
    assert.equal(lockHolderAlive(target, dead), true, String(target));
  // the real seam: this process is alive
  assert.equal(lockHolderAlive(`${hostname()}-${process.pid}`), true);
});

test("what the new folder already has is never overwritten", () => {
  const d = devRoot();
  try {
    writeFileSync(join(d.to, "vibefield-theme.json"), '{"preference":"light"}\n');
    const result = carryLegacyElectronState({ from: d.from, to: d.to });
    assert.deepEqual(
      result.carried,
      CARRIED_ENTRIES.filter((n) => n !== "vibefield-theme.json"),
    );
    assert.equal(
      readFileSync(join(d.to, "vibefield-theme.json"), "utf8"),
      '{"preference":"light"}\n',
    );
  } finally {
    d.done();
  }
});

test("no old folder, or one with nothing of the desk's own, carries nothing; the same folder is no move", () => {
  const root = mkdtempSync(join(tmpdir(), "vf-bp1c-empty-"));
  try {
    const from = join(root, "electron-user-data");
    assert.deepEqual(carryLegacyElectronState({ from, to: root }), {
      carried: [],
      reason: "no-old-folder",
    });
    mkdirSync(join(from, "GPUCache"), { recursive: true });
    const result = carryLegacyElectronState({ from, to: root });
    assert.deepEqual(result, { carried: [], reason: "nothing-to-carry" });
    assert.match(carryWords(result, { from, to: root }), /left as it was/);
    assert.deepEqual(carryLegacyElectronState({ from: root, to: root }), {
      carried: [],
      reason: "same-folder",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the runner's words name the new folder, what was carried and that the old one stays; a done move says nothing", () => {
  const words = carryWords(
    { carried: ["vibefield-theme.json", "Local Storage"] },
    { from: "/r/.vibefield/dev/electron-user-data", to: "/r/.vibefield/dev" },
  );
  assert.equal(
    words,
    "BP-1c: Electron's userData is now /r/.vibefield/dev (the desk browser keeps its sign-ins there); carried vibefield-theme.json, Local Storage from /r/.vibefield/dev/electron-user-data, which is left as it was",
  );
  assert.equal(
    carryWords({ carried: [], reason: "already-moved" }, { from: "/a", to: "/b" }),
    null,
  );
  assert.equal(
    carryWords({ carried: [], reason: "no-old-folder" }, { from: "/a", to: "/b" }),
    null,
  );
});

test("BP-1c review: the runner stops on old-folder-in-use, before any Electron, and only there", () => {
  // cli.mjs is the runner's entry (top-level main()), so its shape is held by its source
  const cli = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.mjs"),
    "utf8",
  );
  const carry = cli.indexOf("carryLegacyElectronState({ from, to })");
  const refuse = cli.indexOf('await shutdown(1, "BP-1c: the old Electron folder is in use");');
  const firstElectron = cli.indexOf("createElectronStack(");
  assert.ok(carry > 0 && refuse > carry, "the refusal follows the carry");
  assert.ok(
    firstElectron === -1 || firstElectron > refuse,
    "no Electron is created before the refusal",
  );
  assert.match(
    cli,
    /if \(result\.reason === "old-folder-in-use"\) \{\n\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+carryRefused = true;/u,
  );
  assert.equal(cli.match(/carryRefused = true;/gu)?.length, 1);
});
