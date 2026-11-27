// Item 658 (2026-11-26) — smoke:pages's stager: the pages smoke's main is handed the page engine it may start, and
// one page to open.
//
//   node packaging/stage-pages-engine.mjs -- <command…>
//
// THE ENGINE. Main starts only the SOURCE BUILD the record names, and an unpackaged main takes its place from one
// variable (contracts' VIBEFIELD_DEV_PAGES_ENGINE_ENV), as the dev runner hands it. This stager hands it the same
// way, by the same function (scripts/pages-pin.mjs `pagesEngineDevCopy`): the file the launching shell names
// (VIBEFIELD_DEV_PAGES_ENGINE_SOURCE) is hashed, held to the record, and copied into a folder of the stager's OWN
// under the OS temp, never the checkout's dev root (that function strips the execute bits of every other copy under
// the root it is given). The command is not handed where the source build sits, and an engine path inherited from
// the launching shell is replaced, never used.
//
// BLIND, never green. A host with no source build to name (the variable unset, a file of other bytes, the release
// binary, a host the record names no build for) cannot run this smoke. The stager says so in the copy function's own
// words and exits 2 before the command is started. A gate counts that red. A gate quotes that line, so it holds no
// local place and no pid: the stager's folder, the checkout and the named file are taken out of the words, and an
// error that was thrown is said by its code alone.
//
// THE PAGE. One fixture page on 127.0.0.1, served from THIS process, not from main: the smoke reads main's own
// listeners as its control, and a server in main would be one more. `VF_PAGES_FIXTURE` tells the command its
// address, the address that answers how often it was fetched, and the SHA-256 of the engine copy's PATH. It holds no
// path: main's environment is inherited by everything main starts, and main takes the engine's own variable out of
// it for that reason. It holds no secret.
//
// A STOP (SIGINT, SIGTERM, SIGHUP) that has come by the time the engine is copied and the page bound starts nothing;
// one that comes after that is handed on to the command, and the run is then never green. The engine is hashed and
// copied in one synchronous stretch, in which no signal's listener can run: the loop is given two turns after it,
// so a stop that came in that stretch is heard before the command is started, wherever in the loop the stager was
// entered (an immediate asked for from inside an I/O callback runs before the loop next reads the system's
// signals, so one turn hears nothing there). A folder that could not be removed is said on every line that ends a
// run once the folder was made, and a run whose command ended with 0 is then not green either. The stager lets go
// of the signals when it ends.
//
// Lines: `PAGES_ENGINE_STAGE {"verdict":"ready","sum":"source-build"}`, or `{"verdict":"blind","why"[,"removed"]}`
// (`removed` once the stager's folder was made), or `{"verdict":"stopped","signal","removed"}`; and, after the command,
// `PAGES_ENGINE_STAGE_DONE {"exit","hits","removed"[,"stopped"]}`. Exit: the command's own; 2 when blind or
// misused; 1 when it was stopped or its folder was left though the command ended with 0.

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstatSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PAGES_ENGINE_SOURCE_ENV,
  pagesEngineDevCopy,
  readPagesEngineEnv,
} from "../../../scripts/pages-pin.mjs";

/** The command's fixture: `{ url, hits, engineIs }` as JSON. */
export const PAGES_FIXTURE_ENV = "VF_PAGES_FIXTURE";

/** The signals a stop arrives as. */
const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

const say = (line) => process.stdout.write(`${line}\n`);

/** `text` with every local place taken out, the longest first: each `[place, what to call it]`. */
function withoutPlaces(text, places) {
  let out = String(text);
  for (const [place, name] of [...places].sort((a, b) => b[0].length - a[0].length)) {
    if (place !== "") out = out.split(place).join(name);
  }
  return out;
}

/** One loopback page under a path nobody can guess, counted; every other path is 404. */
function servePage() {
  const nonce = randomBytes(8).toString("hex");
  let hits = 0;
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === `/${nonce}/`) {
      hits += 1;
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(`<!doctype html><title>vf-pages-${nonce}</title><p>the pages smoke's page</p>\n`);
      return;
    }
    if (req.method === "GET" && req.url === `/${nonce}/hits`) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ hits }));
      return;
    }
    res.writeHead(404, { "cache-control": "no-store" });
    res.end();
  });
  return new Promise((done, failed) => {
    server.once("error", failed);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const url = `http://127.0.0.1:${port}/${nonce}/`;
      done({
        url,
        hitsUrl: `${url}hits`,
        hits: () => hits,
        close: () =>
          new Promise((closed) => {
            server.closeAllConnections?.();
            server.close(() => closed());
          }),
      });
    });
  });
}

/** Runs the command to its end; its exit code, or 2 when it could not start or died of a signal. */
function runCommand(command, env, onChild) {
  return new Promise((done) => {
    const child = spawn(command[0], command.slice(1), { stdio: "inherit", env });
    onChild(child);
    child.once("error", (error) => {
      process.stderr.write(`stage-pages-engine: ${command[0]} did not start: ${error.message}\n`);
      done(2);
    });
    child.once("exit", (status, signal) => done(status ?? (signal === null ? 1 : 2)));
  });
}

/**
 * The stager as a function: the exit code it would end with. `repoRoot` is the checkout whose record and registries
 * are read; `env` is the launching shell's; `tmpRoot` is where the stager's own folder is made; `copy`, `readName`,
 * `serve` and `out` are the dev runner's functions, the page and stdout unless a row gives its own; `signals` is what
 * the stop signals are heard on (the process, when it is run as a command).
 */
export async function stagePagesEngine({
  repoRoot,
  command,
  env = process.env,
  tmpRoot = tmpdir(),
  copy = pagesEngineDevCopy,
  readName = readPagesEngineEnv,
  serve = servePage,
  out = say,
  signals = null,
}) {
  // `removed`: whether the stager's own folder is gone, said once there was one to remove
  const blind = (why, removed) => {
    out(
      `PAGES_ENGINE_STAGE ${JSON.stringify({ verdict: "blind", why, ...(removed === undefined ? {} : { removed }) })}`,
    );
    return 2;
  };
  let engineEnv;
  try {
    engineEnv = readName(repoRoot);
  } catch {
    return blind("the engine variable's name could not be read from the registries");
  }
  let child = null;
  let stopped = null;
  const heard = STOP_SIGNALS.map((signal) => {
    const stop = () => {
      stopped = signal;
      child?.kill(signal);
    };
    signals?.on(signal, stop);
    return [signal, stop];
  });
  try {
    return await staged();
  } finally {
    // the stager lets go of every signal it listened on, however it ended
    for (const [signal, stop] of heard) signals?.off(signal, stop);
  }

  async function staged() {
    let own;
    try {
      own = mkdtempSync(join(tmpRoot, "vf-pages-stage-"));
    } catch (error) {
      // by its code alone: the error's own words hold the place
      return blind(
        `the stager's own folder could not be made (${error?.code ?? "an unknown error"})`,
      );
    }
    const remove = () => {
      try {
        rmSync(own, { recursive: true, force: true });
      } catch {
        // said by what is left
      }
      // Gone only when the folder was LOOKED AT and is not there (item 658, 2026-11-27). A look that fails says
      // nothing of it: with the folder it sits in no longer searchable, `existsSync` answered false, which read as
      // gone, and on a command that exited 0 as a green run with the engine's copy left behind.
      try {
        return lstatSync(own, { throwIfNoEntry: false }) === undefined;
      } catch {
        return false;
      }
    };
    const source = env[PAGES_ENGINE_SOURCE_ENV];
    let made;
    try {
      made = copy(repoRoot, own, { source });
    } catch (error) {
      return blind(
        `the engine's copy could not be made (${error?.code ?? "an unknown error"})`,
        remove(),
      );
    }
    if (made.path === null) {
      return blind(
        withoutPlaces(made.warning, [
          [own, "<the stager's folder>"],
          [repoRoot, "<the checkout>"],
          [source ?? "", "<the named file>"],
        ]),
        remove(),
      );
    }
    let page;
    try {
      page = await serve();
    } catch (error) {
      return blind(
        `the fixture page could not be served (${error?.code ?? "an unknown error"})`,
        remove(),
      );
    }
    // The hash and the copy are one synchronous stretch, and binding the page yields only to ticks: a signal the
    // system sent in that time has run no listener yet. TWO turns of the loop let it: the first immediate may run in
    // the very turn this was reached in (when the stager was entered from an I/O callback), before the loop has
    // read the system's signals again; the second runs after it has. No await lies between this check and the
    // spawn: a stop after it is handed on to the command.
    await new Promise((turned) => setImmediate(() => setImmediate(turned)));
    if (stopped !== null) {
      await page.close();
      out(
        `PAGES_ENGINE_STAGE ${JSON.stringify({ verdict: "stopped", signal: stopped, removed: remove() })}`,
      );
      return 1;
    }
    const { [PAGES_ENGINE_SOURCE_ENV]: _source, ...rest } = env;
    const childEnv = {
      ...rest,
      [engineEnv]: made.path,
      [PAGES_FIXTURE_ENV]: JSON.stringify({
        url: page.url,
        hits: page.hitsUrl,
        engineIs: createHash("sha256").update(made.path).digest("hex"),
      }),
    };
    out(`PAGES_ENGINE_STAGE ${JSON.stringify({ verdict: "ready", sum: "source-build" })}`);
    const ended = await runCommand(command, childEnv, (started) => {
      child = started;
    });
    const hits = page.hits();
    await page.close();
    const removed = remove();
    // never green when it was stopped, or when the engine's copy was left behind
    const exit = ended === 0 && (stopped !== null || !removed) ? 1 : ended;
    out(
      `PAGES_ENGINE_STAGE_DONE ${JSON.stringify({
        exit,
        hits,
        removed,
        ...(stopped === null ? {} : { stopped }),
      })}`,
    );
    return exit;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const separator = argv.indexOf("--");
  if (separator !== 0 || argv.length === 1) {
    process.stderr.write(
      "stage-pages-engine: no command after --\nusage: node packaging/stage-pages-engine.mjs -- <command…>\n",
    );
    process.exit(2);
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  process.exit(await stagePagesEngine({ repoRoot, command: argv.slice(1), signals: process }));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
