// MA-D16 (2026-11-24) — main's one rule for the file `shell.openMadeApp` hands the browser
// (main/made-app-local.ts): a made app's local view, derived from the app and its page's digest
// under main's own user root, and held to the disk before anything opens. The rows are a real
// folder tree: the good file, and every way the derived path could be something else.
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LAYOUT, MADE_APP_VIEW } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { madeAppLocalFile } from "../src/main/made-app-local";

const APP = "a".repeat(64);
const DIGEST = "b".repeat(64);
const NOT_FOUND = { ok: false, kind: "NOT_FOUND" };
const MALFORMED = { ok: false, kind: "PRECONDITION_FAILED" };

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

interface Tree {
  userRoot: string;
  madeRoot: string;
  folder: string;
  file: string;
  /** a folder beside the user root, outside everything main may open */
  outside: string;
}

/** A user root with one app's local view written, as fieldd's files worker leaves it. */
function tree(): Tree {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "vf-mal-")));
  cleanup.push(() => rmSync(base, { recursive: true, force: true }));
  const userRoot = join(base, "user");
  const madeRoot = join(userRoot, ...LAYOUT.ARTIFACT_MADE_DIR);
  const folder = join(madeRoot, APP, DIGEST);
  mkdirSync(folder, { recursive: true });
  const file = join(folder, MADE_APP_VIEW.LOCAL_FILE);
  writeFileSync(file, "<!doctype html><title>local</title>");
  const outside = join(base, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.html"), "<!doctype html><title>not an app</title>");
  return { userRoot, madeRoot, folder, file, outside };
}

const ask = (t: Tree, appId = APP, digest = DIGEST) =>
  madeAppLocalFile(t.userRoot, { appId, digest });

describe("a made app's local view, as main finds it (MA-D16)", () => {
  it("answers the file's own `file:` URL for the app and digest it was asked", async () => {
    const t = tree();
    expect(await ask(t)).toEqual({ ok: true, url: pathToFileURL(t.file).href });
    expect(pathToFileURL(t.file).href).toMatch(
      new RegExp(`/artifacts/made/${APP}/${DIGEST}/local\\.html$`),
    );
  });

  it("refuses a word that is not 64 lowercase hex before it reads the disk", async () => {
    const t = tree();
    for (const [appId, digest] of [
      ["..", DIGEST],
      [APP, ".."],
      [APP, `${"b".repeat(60)}/../`],
      [APP.toUpperCase(), DIGEST],
      [APP.slice(1), DIGEST],
      [`${APP}0`, DIGEST],
      ["", DIGEST],
    ] as const) {
      expect(await madeAppLocalFile(t.userRoot, { appId, digest }), `${appId} ${digest}`).toEqual(
        MALFORMED,
      );
    }
    // a caller's path is no part of the ask: the file is still the derived one
    const stray = { appId: APP, digest: DIGEST, path: join(t.outside, "secret.html") };
    expect(await madeAppLocalFile(t.userRoot, stray)).toEqual({
      ok: true,
      url: pathToFileURL(t.file).href,
    });
  });

  it("says there is none for an app, a page or a file that is not there", async () => {
    const t = tree();
    expect(await ask(t, "c".repeat(64))).toEqual(NOT_FOUND);
    expect(await ask(t, APP, "d".repeat(64))).toEqual(NOT_FOUND);
    // the served view alone, as an app opened only while linked leaves its folder
    renameSync(t.file, join(t.folder, MADE_APP_VIEW.FILE));
    expect(await ask(t)).toEqual(NOT_FOUND);
    // a user root with no made folder at all
    expect(
      await madeAppLocalFile(join(t.userRoot, "nobody"), { appId: APP, digest: DIGEST }),
    ).toEqual(NOT_FOUND);
  });

  it("refuses a file that is a link, a folder, or anything but a regular file", async () => {
    const t = tree();
    rmSync(t.file);
    symlinkSync(join(t.outside, "secret.html"), t.file);
    expect(await ask(t), "a link out of the made root").toEqual(NOT_FOUND);
    rmSync(t.file);
    // a link to a file INSIDE the made root is refused too: main opens what was written, never what is pointed at
    writeFileSync(join(t.folder, MADE_APP_VIEW.FILE), "<!doctype html><title>served</title>");
    symlinkSync(join(t.folder, MADE_APP_VIEW.FILE), t.file);
    expect(await ask(t), "a link inside the made root").toEqual(NOT_FOUND);
    rmSync(t.file);
    mkdirSync(t.file);
    expect(await ask(t), "a folder of that name").toEqual(NOT_FOUND);
  });

  it("refuses a folder on the way that is a link, whichever folder it is", async () => {
    // the digest's folder is a link out
    const t = tree();
    rmSync(t.folder, { recursive: true });
    mkdirSync(join(t.outside, "page"));
    writeFileSync(join(t.outside, "page", MADE_APP_VIEW.LOCAL_FILE), "<!doctype html>");
    symlinkSync(join(t.outside, "page"), t.folder);
    expect(await ask(t), "the digest's folder").toEqual(NOT_FOUND);

    // the app's folder is a link out
    const u = tree();
    rmSync(join(u.madeRoot, APP), { recursive: true });
    mkdirSync(join(u.outside, "app", DIGEST), { recursive: true });
    writeFileSync(join(u.outside, "app", DIGEST, MADE_APP_VIEW.LOCAL_FILE), "<!doctype html>");
    symlinkSync(join(u.outside, "app"), join(u.madeRoot, APP));
    expect(await ask(u), "the app's folder").toEqual(NOT_FOUND);

    // the app's folder is a link to ANOTHER app's folder inside the made root
    const v = tree();
    const other = "e".repeat(64);
    symlinkSync(join(v.madeRoot, APP), join(v.madeRoot, other));
    expect(await ask(v, other), "one app's name pointing at another's folder").toEqual(NOT_FOUND);
  });

  it("opens a real file whose made root sits behind a link, as a data root on another volume does", async () => {
    const t = tree();
    const linked = join(t.outside, "user-link");
    symlinkSync(t.userRoot, linked);
    const answer = await madeAppLocalFile(linked, { appId: APP, digest: DIGEST });
    // the URL is the REAL file's, never the spelling behind the link
    expect(answer).toEqual({ ok: true, url: pathToFileURL(t.file).href });
  });

  it("PIN: a file hard-linked from elsewhere is a regular file where main derived it, and opens", async () => {
    // the rule's limit, said: a hard link is a name, not a pointer, and whoever can make one in this
    // user's made folder can write any file there. The rule keeps main from FOLLOWING a pointer.
    const t = tree();
    rmSync(t.file);
    linkSync(join(t.outside, "secret.html"), t.file);
    expect(await ask(t)).toEqual({ ok: true, url: pathToFileURL(t.file).href });
  });
});
