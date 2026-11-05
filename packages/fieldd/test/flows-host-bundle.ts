// CP-4a2a — a run's flow host, bundled for source runs, as transcript-host-bundle.ts bundles the transcript worker:
// vitest does not bundle, so the rows that start a REAL host build it ONCE per file into a directory under the run's
// root (`fielddRunRoot`, which global-setup.ts removes at the run's end), with fieldd's own build definition
// (scripts/flows-host-build.mjs), and hand the run a launch naming it. Test-local — not shipped.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import type { Socket } from "node:net";
import { join } from "node:path";
import { build } from "esbuild";
import { inject } from "vitest";
import type { FlowsHostLaunch } from "../src/flows/launch";
import type { ToFlowHost } from "../src/flows/protocol";

const PACKAGE_ROOT = join(import.meta.dirname, "..");

let built: Promise<string> | null = null;

/** The built bundle's path. */
export function flowsHostBundle(): Promise<string> {
  built ??= (async () => {
    const definition = (await import(join(PACKAGE_ROOT, "scripts", "flows-host-build.mjs"))) as {
      flowsHostBuildOptions: (opts: { outfile: string }) => Parameters<typeof build>[0];
    };
    const dir = mkdtempSync(join(inject("fielddRunRoot"), "vf-fh-"));
    const outfile = join(dir, "flows-host.cjs");
    await build(definition.flowsHostBuildOptions({ outfile }));
    return outfile;
  })();
  return built;
}

/** A launch of the built bundle under this runtime: the development rule (launch.ts). */
export async function flowsHostLaunch(): Promise<FlowsHostLaunch> {
  return { command: process.execPath, args: [await flowsHostBundle()] };
}

/** A stand-in child's source: it speaks fieldd's pipe as the host does (fd 3 a plain pipe, one JSON message a line;
 * bth's review P2) and runs `body` with `say(message)`, `on(hearer)` and `pipe` in scope. A child given Node's IPC
 * channel on fd 3 instead leaves at once, code 9: raw lines on that channel would end the test's own process. */
export function standInSource(body: readonly string[]): string {
  return [
    "const net = require('node:net');",
    "if (process.channel) process.exit(9);",
    "const pipe = new net.Socket({ fd: 3, readable: true, writable: true });",
    "const say = (m) => pipe.write(JSON.stringify(m) + '\\n');",
    "const hearers = [];",
    "const on = (hearer) => hearers.push(hearer);",
    "let buffered = '';",
    "pipe.setEncoding('utf8');",
    "pipe.on('data', (chunk) => {",
    "  buffered += chunk;",
    "  for (let i = buffered.indexOf('\\n'); i >= 0; i = buffered.indexOf('\\n')) {",
    "    const m = JSON.parse(buffered.slice(0, i));",
    "    buffered = buffered.slice(i + 1);",
    "    for (const hearer of hearers) hearer(m);",
    "  }",
    "});",
    "pipe.on('end', () => process.exit(0));",
    ...body,
  ].join("\n");
}

/** The built bundle started as fieldd starts it (fd 3 a plain pipe, `environment` its whole environment), with every
 * message it says kept in `heard`, `tell` to say one to it, and `close` to close fieldd's end of the pipe. */
export async function directHost(
  environment: NodeJS.ProcessEnv,
  /** node's own options before the bundle (a row's preload door); none by default */
  nodeArgs: readonly string[] = [],
): Promise<{
  child: ChildProcess;
  heard: unknown[];
  tell: (message: ToFlowHost) => void;
  close: () => void;
}> {
  const child = spawn(process.execPath, [...nodeArgs, await flowsHostBundle()], {
    stdio: ["ignore", "ignore", "ignore", "pipe"],
    env: environment,
  });
  const pipe = child.stdio[3] as Socket;
  const heard: unknown[] = [];
  let buffered = "";
  pipe.setEncoding("utf8");
  pipe.on("data", (chunk: string) => {
    buffered += chunk;
    for (let i = buffered.indexOf("\n"); i >= 0; i = buffered.indexOf("\n")) {
      heard.push(JSON.parse(buffered.slice(0, i)) as unknown);
      buffered = buffered.slice(i + 1);
    }
  });
  pipe.on("error", () => {
    // the child left: its exit is the row's to read
  });
  return {
    child,
    heard,
    tell: (message) => {
      if (pipe.writable) pipe.write(`${JSON.stringify(message)}\n`);
    },
    close: () => pipe.end(),
  };
}
