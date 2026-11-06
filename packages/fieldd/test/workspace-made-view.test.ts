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
//   · a worker with no roots, or with roots that overlap, refuses every view.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  linkSync,
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
  mkdirSync(join(roots.sourceRoot, APP, DIGEST), { recursive: true });
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

function build(
  supervisor: FilesHostSupervisor,
  source: string,
  folder: string,
  theme: MadeAppViewTheme,
): Promise<{ bytes: number }> {
  return supervisor.request("buildMadeView", { source, folder, theme });
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
    expect(meta).toBeGreaterThan(view.indexOf("</head><body>"));
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
    // nothing was made: not the folder, not even the served root
    expect(existsSync(roots.servedRoot)).toBe(false);
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
    expect(existsSync(folder)).toBe(false);
  });

  it.skipIf(process.platform === "win32")("refuses a FIFO without opening it", async () => {
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
  });

  it("refuses a page outside the export-source root, or the root itself, as a malformed ask", async () => {
    const { base, roots, folder } = layout();
    const outside = join(base, "outside.html");
    writeFileSync(outside, "<p>not exported</p>");
    mkdirSync(roots.servedRoot, { recursive: true });
    const served = join(roots.servedRoot, "page.html");
    writeFileSync(served, "<p>a served file</p>");
    const supervisor = await ready(roots);
    for (const page of [outside, served, roots.sourceRoot, join(APP, DIGEST, "index.html")]) {
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
    mkdirSync(roots.servedRoot, { recursive: true });
    // links on the way below the served root: one into the export's own folder, one out of the root
    symlinkSync(join(roots.sourceRoot, APP), join(roots.servedRoot, "into-export"));
    symlinkSync(base, join(roots.servedRoot, "out"));
    writeFileSync(join(roots.servedRoot, "a-file"), "");
    const supervisor = await ready(roots);
    const cases: Array<[string, string]> = [
      [exported, "invalid"],
      [roots.servedRoot, "invalid"],
      [join(base, "elsewhere"), "invalid"],
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

  it("refuses every view on a worker with no roots, or with roots that overlap", async () => {
    const { base, roots, source, folder } = layout();
    const bare = await ready();
    const unconfigured = await refusal(build(bare, source, folder, VECTOR.embed.theme));
    expect(unconfigured.error).toEqual({
      code: "internal",
      message: "this files worker was started with no made-view roots",
    });
    // the served root inside the export-source root, then the same folder through a link: a view
    // could land in an export's folder, so neither worker builds one
    const nested = join(roots.sourceRoot, APP);
    symlinkSync(nested, join(base, "made-alias"));
    for (const servedRoot of [nested, join(base, "made-alias")]) {
      const overlapping = await ready({ sourceRoot: roots.sourceRoot, servedRoot });
      const target = join(servedRoot, "view");
      const error = await refusal(build(overlapping, source, target, VECTOR.embed.theme));
      expect(error.error, servedRoot).toEqual({
        code: "invalid",
        message: "the export-source and served roots overlap",
      });
    }
    expect(readdirSync(nested)).toEqual([DIGEST]);
  });
});
