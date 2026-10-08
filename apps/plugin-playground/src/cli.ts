// The command surface. No prompts exist anywhere in the kit (P8-D8), so every
// path here ends in a written verdict and a number.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { TextRaster } from "@vibecook/ice/desk";
import { toNdjson, toTable } from "./report";
import { type Loader, runPlayground } from "./run";
import { STILL_GOLDEN, STILL_SHOTS, type StillGpu, stillGpu } from "./still";
import { stillTextRaster } from "./text-raster";
import { messageOf, type RunResult } from "./verdict";

const USAGE = `plugin-playground <pluginDir> [--json] [--state <type>[:<name>]] [--still [--bless]]

Judges a plugin headlessly (plugin spec §5.4 item 5, §24.2): every OBJECT KIND
through the kind-conformance harness (@vibefield/plugin-sdk/testing) with no device and no
DOM — its declaration, its program (its WGSL read as text: entry points and
bindings, never compiled), every declared state (each fixture in playground/
states.ts × idle, selected, held, open, contained × the zooms the desk's LOD
names) through resolve, record, hit, frame, chip, the opening, prepare and
drawRange, and its dispose. Without --still nothing here compiles a kind's WGSL:
\`vibefield-plugin try <dir>\` does, in the app, and draws it.

  --json                NDJSON: one verdict per line, then a summary line
  --state <type>[:<n>]  run one object type, or one state of it
  --still               also DRAW each state on Dawn (Node's WebGPU, no window):
                        one object on a bare mat by day and by night, its WGSL
                        COMPILED, judged drawn, inside its reach and steady, and
                        held to the plugin's golden (${STILL_GOLDEN});
                        PNGs in <pluginDir>/${STILL_SHOTS}/
  --bless               with --still: WRITE the golden from these stills — once,
                        deliberately (say so in the commit). A golden is Dawn's
                        bytes on the host that blessed it.

exit 0  every row passed (notes are not refusals)
exit 1  at least one refusal
exit 2  the harness itself failed
`;

interface Args {
  readonly pluginDir?: string;
  readonly json: boolean;
  readonly only?: string;
  /** `--still` — draw each state on Dawn (DK-11) */
  readonly still: boolean;
  /** `--bless` — with `--still`, write the golden */
  readonly bless: boolean;
  readonly help: boolean;
  readonly error?: string;
}

export function parseArgs(argv: readonly string[]): Args {
  let pluginDir: string | undefined;
  let json = false;
  let only: string | undefined;
  let still = false;
  let bless = false;
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--json") json = true;
    else if (arg === "--still") still = true;
    else if (arg === "--bless") bless = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--state") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-"))
        return { json, still, bless, help, error: "--state needs a <type>[:<name>] argument" };
      only = value;
      i += 1;
    } else if (arg.startsWith("--state=")) only = arg.slice("--state=".length);
    else if (arg.startsWith("-"))
      return { json, still, bless, help, error: `unknown option ${arg}` };
    else if (pluginDir === undefined) pluginDir = arg;
    else
      return {
        json,
        still,
        bless,
        help,
        error: `unexpected argument ${arg} (one plugin directory per run)`,
      };
  }
  // a golden is written only from stills drawn in the same run — never by a flag on its own
  if (bless && !still)
    return { json, still, bless, help, error: "--bless writes the still's golden: add --still" };
  return {
    ...(pluginDir !== undefined ? { pluginDir } : {}),
    json,
    ...(only !== undefined ? { only } : {}),
    still,
    bless,
    help,
  };
}

export function render(result: RunResult, json: boolean): string {
  return json ? toNdjson(result) : toTable(result);
}

export async function main(argv: readonly string[], loader: Loader): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.error !== undefined) {
    process.stderr.write(`plugin-playground: ${args.error}\n\n${USAGE}`);
    return 2;
  }
  if (args.pluginDir === undefined) {
    process.stderr.write(`plugin-playground: no plugin directory given\n\n${USAGE}`);
    return 2;
  }
  const pluginDir = resolve(args.pluginDir);
  if (!existsSync(pluginDir)) {
    // A path that is not there is the CALLER's mistake, not the plugin's — so it
    // is a harness error (2), never a refusal (1) that would read as "your
    // plugin failed".
    process.stderr.write(`plugin-playground: no such directory: ${pluginDir}\n`);
    return 2;
  }
  // `--still`: Dawn's device, made once for the run and destroyed after it. No adapter is the HOST's fact — a harness error
  // (2), never a refusal that would read as "your plugin failed".
  let gpu: StillGpu | undefined;
  let text: TextRaster | undefined;
  if (args.still) {
    try {
      gpu = await stillGpu();
    } catch (error) {
      process.stderr.write(
        `plugin-playground: --still needs a WebGPU device and Dawn gave none on this host: ${messageOf(error)}\n`,
      );
      return 2;
    }
    try {
      text = await stillTextRaster();
    } catch (error) {
      gpu.destroy();
      process.stderr.write(
        `plugin-playground: --still lends the kinds the desk's hand, and this host's Node canvas could not draw it: ${messageOf(error)}\n`,
      );
      return 2;
    }
  }
  try {
    const result = await runPlayground({
      pluginDir,
      loader,
      only: args.only,
      ...(gpu !== undefined && text !== undefined
        ? { still: { bless: args.bless, gpu, text } }
        : {}),
    });
    process.stdout.write(render(result, args.json));
    return result.summary.exit;
  } finally {
    gpu?.destroy();
  }
}
