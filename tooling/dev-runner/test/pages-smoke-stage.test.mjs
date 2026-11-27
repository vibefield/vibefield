// Item 658 (2026-11-26) — smoke:pages's stager, apps/desktop/packaging/stage-pages-engine.mjs. It hands the smoke's
// main the checked copy of the page engine's SOURCE BUILD, made by the dev runner's own function in a folder of the
// stager's own, and one fixture page on loopback served from the stager's process. A host without the recorded build
// is BLIND: exit 2 before the command is ever started. Driven two ways: as the smoke drives it (a child process with
// a sentinel for the command) for the blind rows, on the real record; and as a function over a made-up record for
// the row where the copy succeeds, since the real source build is on no test host. It lives beside
// market-smoke-fixture.test.mjs, for the packaging scripts have no test target of their own.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFile,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { pagesEngineDevCopy } from "../../../scripts/pages-pin.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const STAGER = join(REPO_ROOT, "apps/desktop/packaging/stage-pages-engine.mjs");
const SOURCE_ENV = "VIBEFIELD_DEV_PAGES_ENGINE_SOURCE";
/** The signals the stager hears a stop as. */
const STOPS = ["SIGINT", "SIGTERM", "SIGHUP"];
const ENGINE_ENV = "VIBEFIELD_DEV_PAGES_ENGINE";
const work = mkdtempSync(join(tmpdir(), "vf-pages-smoke-stage-"));
after(() => rmSync(work, { recursive: true, force: true }));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** One run of the stager as the smoke runs it, in a temp folder of the row's own, with a sentinel for the command:
 * it leaves a file if it ever starts. Answers the run, whether the sentinel ran, and what the temp folder holds. */
function blindRun(name, env) {
  const tmp = join(work, name);
  mkdirSync(tmp, { recursive: true });
  const ran = join(work, `${name}.ran`);
  const sentinel = `require("node:fs").writeFileSync(${JSON.stringify(ran)}, "ran"); process.exit(9);`;
  const { [SOURCE_ENV]: _source, [ENGINE_ENV]: _engine, ...clean } = process.env;
  const run = spawnSync(process.execPath, [STAGER, "--", process.execPath, "-e", sentinel], {
    encoding: "utf8",
    env: { ...clean, TMPDIR: tmp, ...env },
  });
  const line = run.stdout.split("\n").find((l) => l.startsWith("PAGES_ENGINE_STAGE "));
  return {
    status: run.status,
    stdout: run.stdout,
    said: line === undefined ? null : JSON.parse(line.slice("PAGES_ENGINE_STAGE ".length)),
    ran: existsSync(ran),
    left: readdirSync(tmp),
  };
}

test("a host that names no source build is blind: exit 2, in the copy function's own words, and the command never starts", () => {
  const got = blindRun("unset", {});
  assert.equal(got.status, 2);
  assert.equal(got.said?.verdict, "blind");
  assert.match(got.said?.why, /VIBEFIELD_DEV_PAGES_ENGINE_SOURCE is not set/u);
  assert.equal(got.ran, false);
  assert.deepEqual(got.left, []);
  assert.doesNotMatch(got.stdout, /PAGES_ENGINE_STAGE_DONE/u);
});

test("a file that is not the record's source build is blind, by its sum; so is a path that is not absolute", () => {
  const other = join(work, "not-the-build");
  writeFileSync(other, randomBytes(64), { mode: 0o755 });
  const wrong = blindRun("wrong", { [SOURCE_ENV]: other });
  assert.equal(wrong.status, 2);
  assert.equal(wrong.said?.verdict, "blind");
  assert.match(wrong.said?.why, /names a file with SHA-256 [0-9a-f]{64}/u);
  assert.equal(wrong.ran, false);
  assert.deepEqual(wrong.left, []);
  const relative = blindRun("relative", { [SOURCE_ENV]: "built/agent-browser" });
  assert.equal(relative.status, 2);
  assert.match(relative.said?.why, /must be an absolute path/u);
  assert.equal(relative.ran, false);
});

test("an engine path inherited from the launching shell starts nothing when the copy fails", () => {
  const inherited = join(work, "inherited-engine");
  writeFileSync(inherited, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const got = blindRun("inherited", { [ENGINE_ENV]: inherited });
  assert.equal(got.status, 2);
  assert.equal(got.said?.verdict, "blind");
  assert.equal(got.ran, false);
});

test("with no command after -- the stager says how it is run and starts nothing", () => {
  const ran = join(work, "usage.ran");
  const sentinel = `require("node:fs").writeFileSync(${JSON.stringify(ran)}, "ran");`;
  for (const argv of [[], ["--"], ["x", "--", process.execPath, "-e", sentinel]]) {
    const run = spawnSync(process.execPath, [STAGER, ...argv], { encoding: "utf8" });
    assert.equal(run.status, 2, JSON.stringify(argv));
    assert.match(run.stderr, /stage-pages-engine: no command after --/u);
    assert.match(run.stderr, /usage: node packaging\/stage-pages-engine\.mjs -- <command…>/u);
    // nothing was staged and nothing was started
    assert.doesNotMatch(run.stdout, /PAGES_ENGINE_STAGE/u);
    assert.equal(existsSync(ran), false);
  }
});

/** A made-up repo root: a record in the converter's shape naming `built` as this host's source build, and the
 * registries line the engine variable's name is read from. */
function fixtureRepo(built) {
  const root = join(work, "repo");
  const src = join(root, "packages", "contracts", "src");
  mkdirSync(src, { recursive: true });
  const host = `${process.platform}-${process.arch}`;
  writeFileSync(
    join(src, "pages-record.ts"),
    [
      "export const PAGES_ENGINE_RECORD = {",
      '  package: "made-up-engine",',
      '  version: "1.0.0",',
      '  tagCommit: "0000000000000000000000000000000000000000",',
      '  npmIntegrity: "sha512-made-up",',
      "  binarySha256: {",
      `    "${host}": "${sha("the release binary")}",`,
      "  },",
      "  sourceBuild: {",
      '    tagCommit: "1111111111111111111111111111111111111111",',
      `    patchSha256: "${sha("a patch")}",`,
      "    binarySha256: {",
      `      "${host}": "${sha(built)}",`,
      "    },",
      "  },",
      '  starts: "sourceBuild",',
      "  core: [",
      "  ],",
      "};",
      'export const PAGES_SCRIPT_SET = { v: 1, engineVersion: "1.0.0", scripts: [] };',
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(src, "registries.ts"),
    `export const VIBEFIELD_DEV_PAGES_ENGINE_ENV = "${ENGINE_ENV}" as const;\n`,
  );
  return root;
}

const fetched = (url) =>
  new Promise((resolve) => {
    get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () =>
        resolve({ status: res.statusCode, body, cache: res.headers["cache-control"] }),
      );
    }).on("error", (error) => resolve({ status: null, body: "", error: error.code }));
  });

test("with the source build named, the command gets the checked copy in the stager's own folder and a fixture page on loopback; both are gone after it", async () => {
  const { stagePagesEngine, PAGES_FIXTURE_ENV } = await import(STAGER);
  assert.equal(PAGES_FIXTURE_ENV, "VF_PAGES_FIXTURE");
  const built = Buffer.from("the source build: started with the port off");
  const repoRoot = fixtureRepo(built);
  const source = join(work, "built", "made-up-engine");
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, built, { mode: 0o755 });
  const tmp = join(work, "staged");
  mkdirSync(tmp);
  const sawFile = join(work, "saw.json");
  // the command: what it was handed, and what the fixture page answers while it runs
  const probe = join(work, "probe.mjs");
  writeFileSync(
    probe,
    `import { createHash } from "node:crypto";
import { accessSync, constants, readFileSync, writeFileSync } from "node:fs";
import { get } from "node:http";
const fetched = (url) => new Promise((resolve) => {
  get(url, (res) => { let body = ""; res.setEncoding("utf8"); res.on("data", (c) => { body += c; });
    res.on("end", () => resolve({ status: res.statusCode, body, cache: res.headers["cache-control"] })); })
    .on("error", (error) => resolve({ status: null, body: "", error: error.code }));
});
const engine = process.env[${JSON.stringify(ENGINE_ENV)}];
const fixture = JSON.parse(process.env.VF_PAGES_FIXTURE);
const raw = process.env.VF_PAGES_FIXTURE;
let runs = true;
try { accessSync(engine, constants.X_OK); } catch { runs = false; }
const page = await fetched(fixture.url);
const stray = await fetched(new URL("/elsewhere", fixture.url).href);
const hits = await fetched(fixture.hits);
writeFileSync(${JSON.stringify(sawFile)}, JSON.stringify({
  engine, runs, sum: createHash("sha256").update(readFileSync(engine)).digest("hex"),
  source: process.env[${JSON.stringify(SOURCE_ENV)}] ?? null,
  fixture, raw, page, stray, hits,
}));
process.exit(9);
`,
  );
  const lines = [];
  const devRoots = [];
  const exit = await stagePagesEngine({
    repoRoot,
    command: [process.execPath, probe],
    env: {
      PATH: process.env.PATH,
      TMPDIR: tmp,
      [SOURCE_ENV]: source,
      [ENGINE_ENV]: "/inherited/elsewhere/agent-browser",
    },
    tmpRoot: tmp,
    out: (line) => lines.push(line),
    copy: (root, devRoot, options) => {
      devRoots.push(devRoot);
      return pagesEngineDevCopy(root, devRoot, options);
    },
  });
  // the command's own exit is the stager's
  assert.equal(exit, 9);
  const saw = JSON.parse(readFileSync(sawFile, "utf8"));
  // the engine: the copy, in the stager's own folder, executable, the record's bytes; never the inherited path
  assert.equal(devRoots.length, 1);
  assert.match(basename(devRoots[0]), /^vf-pages-stage-/u);
  assert.equal(dirname(devRoots[0]), tmp);
  assert.notEqual(devRoots[0], join(repoRoot, ".vibefield", "dev"));
  assert.ok(saw.engine.startsWith(`${devRoots[0]}/`), saw.engine);
  assert.equal(saw.runs, true);
  assert.equal(saw.sum, sha(built));
  // what the command is NOT handed: where the source build sits
  assert.equal(saw.source, null);
  // the fixture: loopback, and a DIGEST of the engine copy's path, nothing else. The path itself is in the engine's
  // own variable alone, which main takes out of its environment; the fixture stays in it for everything main starts.
  assert.deepEqual(Object.keys(saw.fixture).sort(), ["engineIs", "hits", "url"]);
  assert.match(saw.fixture.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{16}\/$/u);
  assert.equal(saw.fixture.hits, `${saw.fixture.url}hits`);
  assert.equal(saw.fixture.engineIs, sha(saw.engine));
  assert.equal(saw.raw.includes(devRoots[0]), false);
  // no slash in it but the page's own address: no path at all
  const beside = saw.raw
    .replaceAll("http://127.0.0.1", "")
    .replaceAll(/\/[0-9a-f]{16}\/(hits)?/gu, "");
  assert.equal(beside.includes("/"), false, beside);
  assert.equal(saw.page.status, 200);
  assert.match(saw.page.body, /<title>vf-pages-[0-9a-f]{16}<\/title>/u);
  assert.equal(saw.page.cache, "no-store");
  assert.equal(saw.stray.status, 404);
  assert.deepEqual(JSON.parse(saw.hits.body), { hits: 1 });
  // the stager's two lines, and nothing local in them
  assert.deepEqual(lines, [
    'PAGES_ENGINE_STAGE {"verdict":"ready","sum":"source-build"}',
    'PAGES_ENGINE_STAGE_DONE {"exit":9,"hits":1,"removed":true}',
  ]);
  // after the command: the copy and its folder are gone, and the page is served by nobody
  assert.equal(existsSync(saw.engine), false);
  assert.deepEqual(readdirSync(tmp), []);
  assert.equal((await fetched(saw.fixture.url)).status, null);
});

test("the stager reads the engine's variable name from the registries, never a literal of its own, and names no dev root", () => {
  const text = readFileSync(STAGER, "utf8");
  assert.match(text, /from "\.\.\/\.\.\/\.\.\/scripts\/pages-pin\.mjs"/u);
  assert.match(text, /readPagesEngineEnv/u);
  assert.doesNotMatch(text, /["'`]VIBEFIELD_DEV_PAGES_ENGINE["'`]/u);
  assert.doesNotMatch(text, /\.vibefield/u);
});

/** The stager as a function over the made-up record, with a command and what a row swaps in. */
async function staged(name, command, over = {}) {
  const { stagePagesEngine } = await import(STAGER);
  const built = Buffer.from("the source build: started with the port off");
  const repoRoot = fixtureRepo(built);
  const source = join(work, "built", "made-up-engine");
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, built, { mode: 0o755 });
  const tmp = join(work, name);
  mkdirSync(tmp, { recursive: true });
  const lines = [];
  const exit = await stagePagesEngine({
    repoRoot,
    command,
    env: { PATH: process.env.PATH, TMPDIR: tmp, [SOURCE_ENV]: source },
    tmpRoot: tmp,
    out: (line) => lines.push(line),
    ...(typeof over === "function" ? over({ repoRoot, source, tmp }) : over),
  });
  const said = (prefix) => {
    const line = lines.find((l) => l.startsWith(`${prefix} `));
    return line === undefined ? null : JSON.parse(line.slice(prefix.length + 1));
  };
  return { exit, lines, said, tmp, repoRoot, source };
}
const sentinel = (name) => {
  const ran = join(work, `${name}.ran`);
  return {
    ran,
    command: [
      process.execPath,
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(ran)}, "ran");`,
    ],
  };
};

test("the blind line holds no local place and no pid: the copy function's words with the stager's folder, the checkout and the named file taken out, and a thrown error by its code alone", async () => {
  const mismatch = sentinel("leak-mismatch");
  const a = await staged("leak-mismatch", mismatch.command, ({ repoRoot, source }) => ({
    copy: (_root, devRoot) => ({
      path: null,
      warning: `the copy at ${devRoot}/pages-engine/0123456789abcdef/agent-browser has SHA-256 ${"a".repeat(64)}, and ${repoRoot}/packages/contracts/src/pages-record.ts names ${"b".repeat(64)} for ${source}: main has no engine`,
      held: 0,
    }),
  }));
  assert.equal(a.exit, 2);
  const why = a.said("PAGES_ENGINE_STAGE")?.why;
  assert.equal(a.said("PAGES_ENGINE_STAGE")?.verdict, "blind");
  // the stager's own folder was made before the copy was refused: the line says it is gone
  assert.equal(a.said("PAGES_ENGINE_STAGE")?.removed, true);
  // the words are kept: the sums, and that main has no engine
  assert.match(why, /has SHA-256 a{64}/u);
  assert.match(why, /main has no engine/u);
  for (const place of [a.tmp, a.repoRoot, a.source, work]) {
    assert.equal(why.includes(place), false, `${why} holds ${place}`);
  }
  assert.equal(existsSync(mismatch.ran), false);
  assert.deepEqual(readdirSync(a.tmp), []);

  const thrown = sentinel("leak-thrown");
  const b = await staged("leak-thrown", thrown.command, ({ source }) => ({
    copy: (_root, devRoot) => {
      throw Object.assign(
        new Error(
          `EACCES: permission denied, copyfile '${source}' -> '${devRoot}/agent-browser.${process.pid}.partial'`,
        ),
        { code: "EACCES" },
      );
    },
  }));
  assert.equal(b.exit, 2);
  assert.deepEqual(b.said("PAGES_ENGINE_STAGE"), {
    verdict: "blind",
    why: "the engine's copy could not be made (EACCES)",
    removed: true,
  });
  assert.equal(b.lines.join("\n").includes(String(process.pid)), false);
  assert.equal(existsSync(thrown.ran), false);
  assert.deepEqual(readdirSync(b.tmp), []);
});

test("a stop that comes before the command is started starts nothing: the copy and the folder are removed", async () => {
  const signals = new EventEmitter();
  const never = sentinel("stop-early");
  const got = await staged("stop-early", never.command, {
    signals,
    copy: (root, devRoot, options) => {
      // the stop arrives while the engine is being hashed and copied
      signals.emit("SIGTERM");
      return pagesEngineDevCopy(root, devRoot, options);
    },
  });
  assert.equal(got.exit, 1);
  assert.deepEqual(got.lines, [
    'PAGES_ENGINE_STAGE {"verdict":"stopped","signal":"SIGTERM","removed":true}',
  ]);
  assert.equal(existsSync(never.ran), false);
  assert.deepEqual(readdirSync(got.tmp), []);
  // the page it had bound is closed, once: nothing of the stager's is left listening
  let closed = 0;
  const heard = new EventEmitter();
  const unstarted = sentinel("stop-early-page");
  const again = await staged("stop-early-page", unstarted.command, {
    signals: heard,
    serve: async () => {
      heard.emit("SIGINT");
      return {
        url: "http://127.0.0.1:9/0123456789abcdef/",
        hitsUrl: "http://127.0.0.1:9/0123456789abcdef/hits",
        hits: () => 0,
        close: async () => {
          closed += 1;
        },
      };
    },
  });
  assert.equal(again.exit, 1);
  assert.deepEqual(again.lines, [
    'PAGES_ENGINE_STAGE {"verdict":"stopped","signal":"SIGINT","removed":true}',
  ]);
  assert.equal(closed, 1);
  assert.equal(existsSync(unstarted.ran), false);
});

test("a REAL stop signal that arrives while the engine is hashed and copied is heard before the command is started, and the stager lets go of the signals it listened on", async () => {
  // The row above hands the stager an emitter, whose listeners run at once. The system's own signal
  // does not: its listener runs when the loop next turns, and the hash and the copy are one
  // synchronous stretch. Sent here to this very process, from inside the copy.
  const never = sentinel("stop-real");
  const before = STOPS.map((signal) => process.listenerCount(signal));
  const got = await staged("stop-real", never.command, {
    signals: process,
    copy: (root, devRoot, options) => {
      process.kill(process.pid, "SIGTERM");
      return pagesEngineDevCopy(root, devRoot, options);
    },
  });
  assert.equal(existsSync(never.ran), false);
  assert.equal(got.exit, 1);
  assert.deepEqual(got.lines, [
    'PAGES_ENGINE_STAGE {"verdict":"stopped","signal":"SIGTERM","removed":true}',
  ]);
  assert.deepEqual(readdirSync(got.tmp), []);
  assert.deepEqual(
    STOPS.map((signal) => process.listenerCount(signal)),
    before,
  );
  // and so on every other way it ends: after a command that ran, and when it is blind
  const ran = sentinel("listeners-ran");
  assert.equal((await staged("listeners-ran", ran.command, { signals: process })).exit, 0);
  const blind = await staged("listeners-blind", ran.command, {
    signals: process,
    copy: () => ({ path: null, warning: "no engine", held: 0 }),
  });
  assert.equal(blind.exit, 2);
  assert.deepEqual(
    STOPS.map((signal) => process.listenerCount(signal)),
    before,
  );
});

test("a REAL stop signal that arrives during the copy is heard before the command is started though the stager was entered from an I/O callback: the loop is given two turns, not one", async () => {
  // An immediate asked for from inside an I/O callback runs in that same turn of the loop, BEFORE
  // the loop next reads what the system sent it. One turn hears nothing there, and the command was
  // started. The row above enters the stager from the test's own frame, where one turn is enough.
  const never = sentinel("stop-real-io");
  // loaded before the callback, so that nothing between the callback and the copy waits on I/O
  await import(STAGER);
  const got = await new Promise((resolve, reject) => {
    readFile(STAGER, () => {
      staged("stop-real-io", never.command, {
        signals: process,
        copy: (root, devRoot, options) => {
          process.kill(process.pid, "SIGTERM");
          return pagesEngineDevCopy(root, devRoot, options);
        },
      }).then(resolve, reject);
    });
  });
  // the lines first: a command that was started says its ready line, whatever became of it after
  assert.deepEqual(got.lines, [
    'PAGES_ENGINE_STAGE {"verdict":"stopped","signal":"SIGTERM","removed":true}',
  ]);
  assert.equal(got.exit, 1);
  assert.equal(existsSync(never.ran), false);
  assert.deepEqual(readdirSync(got.tmp), []);
});

test("a temp root the stager cannot make its own folder in is blind, by the error's code alone: one line, no place, and nothing thrown", async () => {
  const never = sentinel("no-tmp");
  const got = await staged("no-tmp", never.command, ({ tmp }) => ({
    tmpRoot: join(tmp, "missing", "deeper"),
  }));
  assert.equal(got.exit, 2);
  assert.deepEqual(got.lines, [
    `PAGES_ENGINE_STAGE {"verdict":"blind","why":"the stager's own folder could not be made (ENOENT)"}`,
  ]);
  assert.equal(existsSync(never.ran), false);
});

test("a folder that could not be removed is said on EVERY line that ends a run once the folder was made: a copy that threw, a page that could not be served, a stop before the command", async () => {
  if (process.platform === "win32" || process.getuid?.() === 0) return;
  const left = async (name, over, mode) => {
    const tmp = join(work, name);
    mkdirSync(tmp, { recursive: true });
    const never = sentinel(name);
    try {
      // each stand-in takes a bit off the folder the stager's own folder sits in: the write bit, so that the folder
      // cannot be removed; or the SEARCH bit (item 658, 2026-11-27), so that it can neither be removed nor looked
      // at. A folder that could not be looked at is not gone: `existsSync` answers false for it.
      const got = await staged(
        name,
        never.command,
        over(() => chmodSync(tmp, mode)),
      );
      assert.equal(existsSync(never.ran), false, name);
      return got;
    } finally {
      chmodSync(tmp, 0o700);
      // the stager's folder is still there, with the bit back
      assert.equal(readdirSync(tmp).length, 1, name);
    }
  };
  for (const [bit, mode] of [
    ["write", 0o500],
    ["search", 0o600],
  ]) {
    const threw = await left(
      `left-copy-threw-${bit}`,
      (lock) => ({
        copy: () => {
          lock();
          throw Object.assign(new Error("the disk failed"), { code: "EIO" });
        },
      }),
      mode,
    );
    assert.equal(threw.exit, 2);
    assert.deepEqual(threw.lines, [
      `PAGES_ENGINE_STAGE {"verdict":"blind","why":"the engine's copy could not be made (EIO)","removed":false}`,
    ]);
    const unserved = await left(
      `left-unserved-${bit}`,
      (lock) => ({
        serve: async () => {
          lock();
          throw Object.assign(new Error("no port"), { code: "EADDRNOTAVAIL" });
        },
      }),
      mode,
    );
    assert.equal(unserved.exit, 2);
    assert.deepEqual(unserved.lines, [
      'PAGES_ENGINE_STAGE {"verdict":"blind","why":"the fixture page could not be served (EADDRNOTAVAIL)","removed":false}',
    ]);
    const signals = new EventEmitter();
    const stopped = await left(
      `left-stopped-${bit}`,
      (lock) => ({
        signals,
        copy: (root, devRoot, options) => {
          signals.emit("SIGHUP");
          const made = pagesEngineDevCopy(root, devRoot, options);
          lock();
          return made;
        },
      }),
      mode,
    );
    assert.equal(stopped.exit, 1);
    assert.deepEqual(stopped.lines, [
      'PAGES_ENGINE_STAGE {"verdict":"stopped","signal":"SIGHUP","removed":false}',
    ]);
  }
});

test("a blind run whose folder could not be removed says so: the line never lets a folder that was left read as gone", async () => {
  if (process.platform === "win32" || process.getuid?.() === 0) return;
  const tmp = join(work, "blind-left");
  mkdirSync(tmp, { recursive: true });
  const never = sentinel("blind-left");
  let got;
  try {
    got = await staged("blind-left", never.command, {
      copy: () => {
        // the write bit is taken off the folder the stager's own folder sits in, then the copy is refused
        chmodSync(tmp, 0o500);
        return { path: null, warning: "the copy is not the record's: main has no engine", held: 0 };
      },
    });
  } finally {
    chmodSync(tmp, 0o700);
  }
  assert.equal(got.exit, 2);
  assert.deepEqual(got.said("PAGES_ENGINE_STAGE"), {
    verdict: "blind",
    why: "the copy is not the record's: main has no engine",
    removed: false,
  });
  assert.equal(existsSync(never.ran), false);
  assert.equal(readdirSync(tmp).length, 1);
});

test("the local places are taken out of the blind line the LONGEST first: a named file inside the checkout is the named file, never the checkout and the rest of its path", async () => {
  const never = sentinel("longest");
  const got = await staged("longest", never.command, ({ repoRoot }) => {
    // the launching shell names a file that sits inside the checkout
    const inside = join(repoRoot, "built", "made-up-engine");
    return {
      env: { PATH: process.env.PATH, [SOURCE_ENV]: inside },
      copy: (root, devRoot, options) => ({
        path: null,
        warning: `the file at ${options.source} is not the build ${root}/record names; nothing was copied to ${devRoot}/pages-engine`,
        held: 0,
      }),
    };
  });
  assert.equal(got.exit, 2);
  assert.equal(
    got.said("PAGES_ENGINE_STAGE")?.why,
    "the file at <the named file> is not the build <the checkout>/record names; nothing was copied to <the stager's folder>/pages-engine",
  );
});

test("a stop while the command runs is handed on to it, and the run is not green though the command ended by itself", {
  timeout: 60_000,
}, async () => {
  const signals = new EventEmitter();
  const started = join(work, "stop-late.started");
  const heard = join(work, "stop-late.heard");
  const command = [
    process.execPath,
    "-e",
    `const fs = require("node:fs");
process.on("SIGTERM", () => { fs.writeFileSync(${JSON.stringify(heard)}, "heard"); process.exit(0); });
fs.writeFileSync(${JSON.stringify(started)}, "started");
// it ends by itself too: a stager that hands no stop on must not leave this row's command running for ever
setTimeout(() => process.exit(3), 20_000);`,
  ];
  const run = staged("stop-late", command, { signals });
  const until = Date.now() + 30_000;
  while (!existsSync(started) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(existsSync(started), true);
  signals.emit("SIGTERM");
  const got = await run;
  assert.equal(existsSync(heard), true);
  assert.equal(got.exit, 1);
  assert.deepEqual(got.said("PAGES_ENGINE_STAGE_DONE"), {
    exit: 1,
    hits: 0,
    removed: true,
    stopped: "SIGTERM",
  });
  assert.deepEqual(readdirSync(got.tmp), []);
});

test("a command that cannot be started, or that dies of a signal, is exit 2; the copy and the folder are removed", async () => {
  const absent = await staged("no-command", [join(work, "no-such-command")]);
  assert.equal(absent.exit, 2);
  assert.deepEqual(absent.said("PAGES_ENGINE_STAGE_DONE"), { exit: 2, hits: 0, removed: true });
  assert.deepEqual(readdirSync(absent.tmp), []);
  const killed = await staged("killed", [
    process.execPath,
    "-e",
    'process.kill(process.pid, "SIGKILL"); setTimeout(() => process.exit(3), 20_000);',
  ]);
  assert.equal(killed.exit, 2);
  assert.deepEqual(readdirSync(killed.tmp), []);
});

test("a page that cannot be served, or an engine variable whose name cannot be read, is blind and starts nothing", async () => {
  const unserved = sentinel("unserved");
  const a = await staged("unserved", unserved.command, {
    serve: async () => {
      throw Object.assign(new Error("listen EADDRINUSE: address already in use 127.0.0.1"), {
        code: "EADDRINUSE",
      });
    },
  });
  assert.equal(a.exit, 2);
  assert.deepEqual(a.said("PAGES_ENGINE_STAGE"), {
    verdict: "blind",
    why: "the fixture page could not be served (EADDRINUSE)",
    removed: true,
  });
  assert.equal(existsSync(unserved.ran), false);
  assert.deepEqual(readdirSync(a.tmp), []);

  const unnamed = sentinel("unnamed");
  const b = await staged("unnamed", unnamed.command, ({ repoRoot }) => ({
    readName: () => {
      throw new Error(`${repoRoot}/packages/contracts/src/registries.ts names no engine variable`);
    },
  }));
  assert.equal(b.exit, 2);
  // no folder was made yet, so the line says nothing of one
  assert.deepEqual(b.said("PAGES_ENGINE_STAGE"), {
    verdict: "blind",
    why: "the engine variable's name could not be read from the registries",
  });
  assert.equal(existsSync(unnamed.ran), false);
  assert.deepEqual(readdirSync(b.tmp), []);
});

test("a folder that cannot be removed is said, and the run is not green: the engine's copy is left where nothing holds it", async () => {
  if (process.platform === "win32" || process.getuid?.() === 0) return;
  // the command takes the write bit off the folder the stager's own folder sits in
  const tmp = join(work, "left");
  mkdirSync(tmp, { recursive: true });
  const command = [
    process.execPath,
    "-e",
    `require("node:fs").chmodSync(${JSON.stringify(tmp)}, 0o500);`,
  ];
  let got;
  try {
    got = await staged("left", command);
  } finally {
    chmodSync(tmp, 0o700);
  }
  assert.deepEqual(got.said("PAGES_ENGINE_STAGE_DONE"), { exit: 1, hits: 0, removed: false });
  assert.equal(got.exit, 1);
  assert.equal(readdirSync(tmp).length, 1);
});

test("a folder the stager can no longer LOOK AT is never said gone, and that run is not green (item 658, 2026-11-27)", async () => {
  if (process.platform === "win32" || process.getuid?.() === 0) return;
  // the command takes the SEARCH bit off the folder the stager's own folder sits in: the stager can neither remove
  // its folder nor see whether it is there. `existsSync` answers false for it, which read as gone, and green.
  const tmp = join(work, "unseen");
  mkdirSync(tmp, { recursive: true });
  const command = [
    process.execPath,
    "-e",
    `require("node:fs").chmodSync(${JSON.stringify(tmp)}, 0o600);`,
  ];
  let got;
  try {
    got = await staged("unseen", command);
  } finally {
    chmodSync(tmp, 0o700);
  }
  assert.deepEqual(got.said("PAGES_ENGINE_STAGE_DONE"), { exit: 1, hits: 0, removed: false });
  assert.equal(got.exit, 1);
  // the folder, with the engine's copy in it, was left
  assert.equal(readdirSync(tmp).length, 1);
});
