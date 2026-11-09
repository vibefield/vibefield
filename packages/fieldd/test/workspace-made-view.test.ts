// DR-1b — a made app's VIEW, built by the REAL files worker: fieldd's supervisor over the bundled
// worker (test/files-host-bundle.ts), configured with a user root's two made roots. The
// export-source root is where rosetta's export places a page, and nothing there is served; the
// served root (`artifacts/made`) holds the view alone (`draft/thinking-drive.md` v0.3, DR-D11 (a)
// as its correction rules it). The rows:
//   · the contracts vector's embed, written byte for byte, 0600, its size the whole answer;
//   · a page's bytes copied as they are under each head the vector pins;
//   · a rebuild by rename, never through the old view (a hard link to it keeps the old bytes);
//   · two builds of one folder at once, each whole;
//   · a theme it cannot read, a page it will not read (a link, a link on the way, a folder, a FIFO,
//     none), a page outside its root, a page over the bound, a folder outside its root or behind a
//     link — each refused, with nothing written and a previous view whole;
//   · a page hard-linked to a file outside its root, as rosetta's link placement leaves it, read;
//   · a rename refused after the temp is written: the temp removed, what was there kept;
//   · a worker with no roots, relative roots or roots that overlap refuses every view as internal
//     (its own configuration); a root that is not there is root-missing (any other refusal of a
//     root is internal), and the worker makes neither (fieldd makes both).
import { execFileSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  MADE_APP_VIEW,
  MADE_APP_VIEW_TAIL,
  type MadeAppViewTheme,
  madeAppViewHead,
} from "@vibefield/contracts";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FilesHostLaunch } from "../src/workspace/launch";
import type { MadeViewRoots } from "../src/workspace/protocol";
import { FilesHostRefusal, FilesHostSupervisor } from "../src/workspace/supervisor";
import { filesHostLaunch } from "./files-host-bundle";
import { until } from "./ws-rpc";

interface ViewVector {
  tail: string;
  views: Array<{ case: string; theme: MadeAppViewTheme; head: string }>;
  embed: { theme: MadeAppViewTheme; page: string; view: string };
  refusedVariables: Array<{ case: string; variable: [string, string] }>;
  refusedThemes: Array<{ case: string; theme: unknown }>;
}

const FIXTURES = join(import.meta.dirname, "../../contracts/fixtures");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

const VECTOR = fixture("made-app-view.vector.json") as ViewVector;
const APP = "app-01";
const DIGEST = "a".repeat(64);
const VIEW = MADE_APP_VIEW.FILE;

let launch: FilesHostLaunch;
beforeAll(async () => {
  launch = await filesHostLaunch();
}, 60_000);

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

interface Layout {
  base: string;
  roots: MadeViewRoots;
  /** the exported page, where rosetta's export places it: `<appId>/<digest>/index.html` */
  source: string;
  /** the app's served folder for that digest, not made yet (the worker makes it) */
  folder: string;
}

function layout(): Layout {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "vf-mv-")));
  cleanup.push(() => rmSync(base, { recursive: true, force: true }));
  const roots = { sourceRoot: join(base, "made-src"), servedRoot: join(base, "made") };
  // both roots made, as fieldd makes them: the worker makes neither
  mkdirSync(join(roots.sourceRoot, APP, DIGEST), { recursive: true });
  mkdirSync(roots.servedRoot);
  const source = join(roots.sourceRoot, APP, DIGEST, "index.html");
  writeFileSync(source, VECTOR.embed.page);
  return { base, roots, source, folder: join(roots.servedRoot, APP, DIGEST) };
}

async function ready(made?: MadeViewRoots): Promise<FilesHostSupervisor> {
  const supervisor = new FilesHostSupervisor({
    launch: { kind: "launch", launch },
    ...(made !== undefined ? { made } : {}),
  });
  cleanup.push(() => supervisor.stop());
  supervisor.start();
  await until(() => supervisor.health().phase === "ready", 20_000);
  return supervisor;
}

/** The digest rosetta's export would answer for what stands at `source`. Only a regular file is
 * read (a FIFO would block this test): anything else is a row about the walk, and any digest does. */
function digestOf(source: string): string {
  try {
    return lstatSync(source).isFile() ? bytesToHex(blake3(readFileSync(source))) : DIGEST;
  } catch {
    return DIGEST;
  }
}

function buildAs(
  supervisor: FilesHostSupervisor,
  source: string,
  folder: string,
  theme: MadeAppViewTheme,
  digest: string,
): Promise<{ bytes: number }> {
  return supervisor.request("buildMadeView", { source, folder, theme, blake3: digest });
}

function build(
  supervisor: FilesHostSupervisor,
  source: string,
  folder: string,
  theme: MadeAppViewTheme,
): Promise<{ bytes: number }> {
  return buildAs(supervisor, source, folder, theme, digestOf(source));
}

async function refusal(promise: Promise<unknown>): Promise<FilesHostRefusal> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(FilesHostRefusal);
    return error as FilesHostRefusal;
  }
  throw new Error("expected a refusal");
}

/** The vector's `views` row at `index`: its theme composes exactly its head. */
function viewRow(index: number): ViewVector["views"][number] {
  const row = VECTOR.views[index];
  if (row === undefined) throw new Error(`made-app-view.vector.json has no views row ${index}`);
  return row;
}

/** A whole view as the worker must write it: the head, the page's bytes, the tail. */
function viewOf(head: string, page: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(head, "utf8"), page, Buffer.from(VECTOR.tail, "utf8")]);
}

describe("a made app's view (DR-1b), built by the real files worker", () => {
  it("writes the contracts vector's embed byte for byte, 0600, with its size the whole answer", async () => {
    const { roots, source, folder } = layout();
    const supervisor = await ready(roots);
    const answer = await build(supervisor, source, folder, VECTOR.embed.theme);
    const view = readFileSync(join(folder, VIEW), "utf8");
    expect(view).toBe(VECTOR.embed.view);
    // the answer is the view's size and nothing else: the bytes stay in the worker (EL2, DR-L4)
    expect(answer).toEqual({ bytes: Buffer.byteLength(VECTOR.embed.view) });
    // the view alone in its folder (no temp left), private to this user
    expect(readdirSync(folder)).toEqual([VIEW]);
    const mode = statSync(join(folder, VIEW)).mode & 0o777;
    if (process.platform !== "win32") expect(mode).toBe(0o600);
    // the page's own CSP meta sits in the view's body, where a browser ignores it: the serve's
    // header is the page's one policy (the wave-0 critic)
    const meta = view.indexOf('http-equiv="Content-Security-Policy"');
    const body = view.indexOf("</head><body>");
    expect(body, "the view's head ends where the vector says").toBeGreaterThan(0);
    expect(meta).toBeGreaterThan(body);
    // the export's folder holds its page alone, untouched
    expect(readdirSync(dirname(source))).toEqual(["index.html"]);
    expect(readFileSync(source, "utf8")).toBe(VECTOR.embed.page);
  });

  it("copies a page's bytes as they are under each head the vector pins, rebuilding one folder", async () => {
    const { roots, source, folder } = layout();
    // UTF-8 past ASCII, a NUL, and two bytes no UTF-8 decoder keeps: a page is never decoded
    const page = Buffer.concat([
      Buffer.from("<p>Grüße — 日本</p>", "utf8"),
      Buffer.from([0x00, 0xff, 0xfe]),
    ]);
    writeFileSync(source, page);
    const supervisor = await ready(roots);
    for (const row of VECTOR.views) {
      const answer = await build(supervisor, source, folder, row.theme);
      const expected = viewOf(row.head, page);
      expect(readFileSync(join(folder, VIEW)).equals(expected), row.case).toBe(true);
      expect(answer, row.case).toEqual({ bytes: expected.length });
    }
    expect(readdirSync(folder)).toEqual([VIEW]);
  });

  it("rebuilds by rename, never through the old view: a hard link to it keeps the old bytes", async () => {
    const { base, roots, source, folder } = layout();
    const supervisor = await ready(roots);
    const [before, after] = [viewRow(0), viewRow(2)];
    await build(supervisor, source, folder, before.theme);
    const view = join(folder, VIEW);
    const kept = join(base, "kept-view");
    linkSync(view, kept);
    await build(supervisor, source, folder, after.theme);
    const page = Buffer.from(VECTOR.embed.page, "utf8");
    expect(readFileSync(kept).equals(viewOf(before.head, page))).toBe(true);
    expect(readFileSync(view).equals(viewOf(after.head, page))).toBe(true);
    expect(statSync(view).ino).not.toBe(statSync(kept).ino);
    expect(readdirSync(folder)).toEqual([VIEW]);
  });

  it("lands two builds of one folder at once each whole: the view is one of them, never a mix", async () => {
    const { roots, source, folder } = layout();
    // four MiB: many pieces each, so the two copies interleave
    const page = Buffer.alloc(4 * 1024 * 1024, 0x61);
    writeFileSync(source, page);
    const supervisor = await ready(roots);
    const rows = [viewRow(0), viewRow(1)];
    const answers = await Promise.all(
      rows.map((row) => build(supervisor, source, folder, row.theme)),
    );
    const wholes = rows.map((row) => viewOf(row.head, page));
    const view = readFileSync(join(folder, VIEW));
    expect(wholes.some((whole) => whole.equals(view))).toBe(true);
    expect(answers).toEqual(wholes.map((whole) => ({ bytes: whole.length })));
    expect(readdirSync(folder)).toEqual([VIEW]);
  });

  it("reads a page hard-linked to a file outside the export-source root, as rosetta links it", async () => {
    const { base, roots, source, folder } = layout();
    // R-1's `method: "link"`: the page is one more name for rosetta's stored object, which lives
    // in its own asset root; a hard link is a regular file, never a link the walk refuses
    const stored = join(base, "asset-root", `${DIGEST}.html`);
    mkdirSync(dirname(stored));
    writeFileSync(stored, VECTOR.embed.page);
    rmSync(source);
    linkSync(stored, source);
    const supervisor = await ready(roots);
    const answer = await build(supervisor, source, folder, VECTOR.embed.theme);
    expect(answer).toEqual({ bytes: Buffer.byteLength(VECTOR.embed.view) });
    expect(readFileSync(join(folder, VIEW), "utf8")).toBe(VECTOR.embed.view);
    // the object is read, never written: its two names hold its own bytes
    expect(statSync(source).nlink).toBe(2);
    expect(readFileSync(stored, "utf8")).toBe(VECTOR.embed.page);
  });

  it("refuses a theme it cannot read before it touches anything, and keeps a previous view", async () => {
    const { roots, source, folder } = layout();
    const supervisor = await ready(roots);
    const refused = {
      code: "invalid",
      message: `the view's theme is unreadable (${MADE_APP_VIEW.REFUSED_THEME})`,
    };
    for (const row of VECTOR.refusedThemes) {
      const theme = row.theme as MadeAppViewTheme;
      const error = await refusal(build(supervisor, source, folder, theme));
      expect(error.error, row.case).toEqual(refused);
    }
    // nothing was made: the served root holds no folder
    expect(readdirSync(roots.servedRoot)).toEqual([]);
    await build(supervisor, source, folder, VECTOR.embed.theme);
    const closing = VECTOR.refusedVariables[0];
    if (closing === undefined) throw new Error("the vector has no refusedVariables");
    const closed = { colorScheme: "light", variables: [closing.variable] } as MadeAppViewTheme;
    const rebuild = await refusal(build(supervisor, source, folder, closed));
    expect(rebuild.error, closing.case).toEqual(refused);
    expect(readFileSync(join(folder, VIEW), "utf8")).toBe(VECTOR.embed.view);
    expect(readdirSync(folder)).toEqual([VIEW]);
  });

  it("refuses a page it will not read — a link, a link on the way, a folder, none — and makes nothing", async () => {
    const { base, roots, source, folder } = layout();
    const outside = join(base, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.html"), "<p>not a page of any app</p>");
    const app = join(roots.sourceRoot, APP);
    // a link to a page, within the root and out of it; a link on the way, within it and out of it
    symlinkSync(source, join(app, "linked.html"));
    symlinkSync(join(outside, "secret.html"), join(app, "escape.html"));
    symlinkSync(app, join(roots.sourceRoot, "app-alias"));
    symlinkSync(outside, join(roots.sourceRoot, "outside-alias"));
    const supervisor = await ready(roots);
    for (const page of [
      join(app, "linked.html"),
      join(app, "escape.html"),
      join(roots.sourceRoot, "app-alias", DIGEST, "index.html"),
      join(roots.sourceRoot, "outside-alias", "secret.html"),
      join(app, DIGEST),
      join(app, "gone.html"),
    ]) {
      const error = await refusal(build(supervisor, page, folder, VECTOR.embed.theme));
      expect(error.error.code, page).toBe("not-found");
    }
    // nothing was made below the served root
    expect(readdirSync(roots.servedRoot)).toEqual([]);
  });

  // the walk's lstat refuses it, so the open's no-block flag is a belt no row here can reach: it
  // covers a FIFO swapped in between the walk and the open
  it.skipIf(process.platform === "win32")(
    "refuses a FIFO at the walk, never opening it",
    async () => {
      const { roots, source, folder } = layout();
      const fifo = join(roots.sourceRoot, APP, "pipe.html");
      execFileSync("mkfifo", [fifo]);
      const supervisor = await ready(roots);
      const error = await refusal(build(supervisor, fifo, folder, VECTOR.embed.theme));
      expect(error.error.code).toBe("not-found");
      // no read is left waiting on a writer: the next view is answered
      expect(await build(supervisor, source, folder, VECTOR.embed.theme)).toEqual({
        bytes: Buffer.byteLength(VECTOR.embed.view),
      });
    },
  );

  it("refuses a page outside the export-source root, or the root itself, as a malformed ask", async () => {
    const { base, roots, folder } = layout();
    const outside = join(base, "outside.html");
    writeFileSync(outside, "<p>not exported</p>");
    const served = join(roots.servedRoot, "page.html");
    writeFileSync(served, "<p>a served file</p>");
    const supervisor = await ready(roots);
    // and a path no file can have (a NUL): malformed before the disk is asked
    for (const page of [
      outside,
      served,
      roots.sourceRoot,
      join(APP, DIGEST, "index.html"),
      join(roots.sourceRoot, APP, DIGEST, "index\0.html"),
    ]) {
      const error = await refusal(build(supervisor, page, folder, VECTOR.embed.theme));
      expect(error.error.code, page).toBe("invalid");
    }
    expect(existsSync(folder)).toBe(false);
  });

  it("refuses a page over MADE_APP_VIEW.PAGE_MAX_BYTES and keeps the view; one at the bound is built", async () => {
    const { roots, source, folder } = layout();
    const supervisor = await ready(roots);
    await build(supervisor, source, folder, VECTOR.embed.theme);
    const big = join(roots.sourceRoot, APP, "big.html");
    writeFileSync(big, "");
    truncateSync(big, MADE_APP_VIEW.PAGE_MAX_BYTES + 1);
    const error = await refusal(build(supervisor, big, folder, VECTOR.embed.theme));
    expect(error.error).toEqual({
      code: "too-large",
      message: `a made app's page holds at most ${MADE_APP_VIEW.PAGE_MAX_BYTES} bytes`,
    });
    expect(readFileSync(join(folder, VIEW), "utf8")).toBe(VECTOR.embed.view);
    expect(readdirSync(folder)).toEqual([VIEW]);
    truncateSync(big, MADE_APP_VIEW.PAGE_MAX_BYTES);
    const head = madeAppViewHead(VECTOR.embed.theme);
    if (!head.ok) throw new Error("the embed's theme composes a head");
    const frame = Buffer.byteLength(head.head) + Buffer.byteLength(MADE_APP_VIEW_TAIL);
    const bytes = frame + MADE_APP_VIEW.PAGE_MAX_BYTES;
    expect(await build(supervisor, big, folder, VECTOR.embed.theme)).toEqual({ bytes });
    expect(statSync(join(folder, VIEW)).size).toBe(bytes);
  });

  it("refuses a folder outside the served root or behind a link, never writing in the export's", async () => {
    const { base, roots, source } = layout();
    const exported = dirname(source);
    // links on the way below the served root: one into the export's own folder, one out of the root
    symlinkSync(join(roots.sourceRoot, APP), join(roots.servedRoot, "into-export"));
    symlinkSync(base, join(roots.servedRoot, "out"));
    writeFileSync(join(roots.servedRoot, "a-file"), "");
    const supervisor = await ready(roots);
    const cases: Array<[string, string]> = [
      [exported, "invalid"],
      [roots.servedRoot, "invalid"],
      [join(base, "elsewhere"), "invalid"],
      [join(roots.servedRoot, "a\0b"), "invalid"],
      [join(roots.servedRoot, "into-export", DIGEST), "not-found"],
      [join(roots.servedRoot, "out", "elsewhere"), "not-found"],
      [join(roots.servedRoot, "a-file"), "not-a-directory"],
      [join(roots.servedRoot, "a-file", DIGEST), "not-a-directory"],
    ];
    for (const [target, code] of cases) {
      const error = await refusal(build(supervisor, source, target, VECTOR.embed.theme));
      expect(error.error.code, target).toBe(code);
    }
    // the export's folder holds its page alone, untouched, and nothing was made outside the root
    expect(readdirSync(exported)).toEqual(["index.html"]);
    expect(readFileSync(source, "utf8")).toBe(VECTOR.embed.page);
    expect(existsSync(join(base, "elsewhere"))).toBe(false);
  });

  it("removes its temp when the rename is refused after the view is written, keeping what was there", async () => {
    const { roots, source, folder } = layout();
    // the view's name taken by a folder: the temp is written whole and fsynced, then rename(2)
    // refuses a file over a folder (EISDIR), the one failure a row can make after the temp exists
    mkdirSync(join(folder, VIEW), { recursive: true });
    const supervisor = await ready(roots);
    const error = await refusal(build(supervisor, source, folder, VECTOR.embed.theme));
    expect(error.error.code).toBe("internal");
    expect(readdirSync(folder)).toEqual([VIEW]);
    expect(statSync(join(folder, VIEW)).isDirectory()).toBe(true);
    expect(readdirSync(join(folder, VIEW))).toEqual([]);
  });

  it("refuses every view as internal on a worker with no roots, relative roots or overlapping roots", async () => {
    const { base, roots, source, folder } = layout();
    const bare = await ready();
    const unconfigured = await refusal(build(bare, source, folder, VECTOR.embed.theme));
    expect(unconfigured.error).toEqual({
      code: "internal",
      message: "this files worker was started with no made-view roots",
    });
    // roots that are not absolute: the worker's own configuration, never the ask
    const relative = await ready({ sourceRoot: "made-src", servedRoot: "made" });
    const unrooted = await refusal(build(relative, source, folder, VECTOR.embed.theme));
    expect(unrooted.error).toEqual({
      code: "internal",
      message: "this files worker's made-view roots are not absolute",
    });
    // the served root inside the export-source root, then the same folder through a link: a view
    // could land in an export's folder, so neither worker builds one, and the trouble is the
    // worker's configuration, never the ask
    const nested = join(roots.sourceRoot, APP);
    symlinkSync(nested, join(base, "made-alias"));
    for (const servedRoot of [nested, join(base, "made-alias")]) {
      const overlapping = await ready({ sourceRoot: roots.sourceRoot, servedRoot });
      const target = join(servedRoot, "view");
      const error = await refusal(build(overlapping, source, target, VECTOR.embed.theme));
      expect(error.error, servedRoot).toEqual({
        code: "internal",
        message: "the export-source and served roots overlap",
      });
    }
    expect(readdirSync(nested)).toEqual([DIGEST]);
  });

  it("answers root-missing only for a root that is not there, and makes neither root", async () => {
    const { base, roots, source, folder } = layout();
    // a served root that is not there, and one whose missing tail lies behind a link into the
    // export: fieldd makes the roots, never the worker, so nothing lands in the export's tree
    rmSync(roots.servedRoot, { recursive: true });
    const into = join(base, "into-export");
    symlinkSync(join(roots.sourceRoot, APP), into);
    for (const servedRoot of [roots.servedRoot, join(into, "made")]) {
      const missing = await ready({ sourceRoot: roots.sourceRoot, servedRoot });
      const target = join(servedRoot, APP, DIGEST);
      const error = await refusal(build(missing, source, target, VECTOR.embed.theme));
      expect(error.error, servedRoot).toEqual({
        code: "root-missing",
        message: "the served made folder is not there",
      });
    }
    expect(existsSync(roots.servedRoot)).toBe(false);
    expect(readdirSync(join(roots.sourceRoot, APP))).toEqual([DIGEST]);
    // a root the disk refuses for any other reason (a link loop) is the worker's own trouble:
    // internal, its errno named, never root-missing
    const loop = join(base, "made-loop");
    symlinkSync(loop, loop);
    const looped = await ready({ sourceRoot: roots.sourceRoot, servedRoot: loop });
    const loopFolder = join(loop, APP, DIGEST);
    const trouble = await refusal(build(looped, source, loopFolder, VECTOR.embed.theme));
    expect(trouble.error.code).toBe("internal");
    expect(trouble.error.message).toContain("(ELOOP)");
    // an export-source root that is not there
    mkdirSync(roots.servedRoot);
    const gone = join(base, "made-src-gone");
    const orphan = await ready({ sourceRoot: gone, servedRoot: roots.servedRoot });
    const page = join(gone, APP, DIGEST, "index.html");
    const error = await refusal(build(orphan, page, folder, VECTOR.embed.theme));
    expect(error.error).toEqual({
      code: "root-missing",
      message: "the export-source folder is not there",
    });
    expect(readdirSync(roots.servedRoot)).toEqual([]);
  });

  // MA-3f, DR-L3 (James's board mark `dr-l3-blake3-recheck`, 2026-11-06: "[b] @noble/hashes in fieldd
  // now"): the page is checked against the digest rosetta named, while it is copied, in this process.
  it("MA-3f: checks the page against rosetta's blake3 while copying it, a known answer first", async () => {
    const { roots, source, folder } = layout();
    writeFileSync(source, "abc");
    const known = "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85";
    const supervisor = await ready(roots);
    await buildAs(supervisor, source, folder, VECTOR.embed.theme, known);
    expect(readFileSync(join(folder, VIEW), "utf8")).toContain("abc");
  });

  it("MA-3f: a page that is not the digest named writes no view, leaves no temp, keeps the old view", async () => {
    const { roots, source, folder } = layout();
    const supervisor = await ready(roots);
    await build(supervisor, source, folder, VECTOR.embed.theme);
    const wrong = `${DIGEST.slice(0, 63)}b`;
    const error = await refusal(buildAs(supervisor, source, folder, VECTOR.embed.theme, wrong));
    expect(error.error.code).toBe("mismatch");
    expect(readFileSync(join(folder, VIEW), "utf8")).toBe(VECTOR.embed.view);
    expect(readdirSync(folder)).toEqual([VIEW]);
    expect(readdirSync(dirname(folder))).toEqual([DIGEST]);
  });

  it("MA-3f: refuses a digest that is not lowercase blake3 hex as a malformed ask, touching nothing", async () => {
    const { roots, source, folder } = layout();
    const supervisor = await ready(roots);
    for (const bad of ["", "abc", DIGEST.toUpperCase(), `${DIGEST.slice(0, 63)}g`]) {
      const error = await refusal(buildAs(supervisor, source, folder, VECTOR.embed.theme, bad));
      expect(error.error.code, bad).toBe("invalid");
    }
    expect(readdirSync(roots.servedRoot)).toEqual([]);
  });

  it("MA-3f: stages its temp beside the served folder, never in it (DR-1b's nit 5)", async () => {
    const { roots, source, folder } = layout();
    // many pieces, so the listing below sees the build in flight
    writeFileSync(source, Buffer.alloc(8 * 1024 * 1024, 0x61));
    const supervisor = await ready(roots);
    let done = false;
    const building = build(supervisor, source, folder, VECTOR.embed.theme).finally(() => {
      done = true;
    });
    const seen = new Set<string>();
    while (!done) {
      if (existsSync(folder)) for (const name of readdirSync(folder)) seen.add(name);
      await new Promise((resolve) => setImmediate(resolve));
    }
    await building;
    expect([...seen].filter((name) => name !== VIEW)).toEqual([]);
    expect(readdirSync(dirname(folder))).toEqual([DIGEST]);
  });

  it("MA-3f: records how long a page at the bound takes (a number, not an assertion)", async () => {
    const { roots, source, folder } = layout();
    writeFileSync(source, Buffer.alloc(MADE_APP_VIEW.PAGE_MAX_BYTES, 0x61));
    const digest = digestOf(source);
    const supervisor = await ready(roots);
    const started = performance.now();
    await buildAs(supervisor, source, folder, VECTOR.embed.theme, digest);
    console.log(
      `MA-3f: a ${MADE_APP_VIEW.PAGE_MAX_BYTES}-byte page: ${performance.now() - started} ms`,
    );
  }, 60_000);
});
