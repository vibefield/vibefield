// The command surface. No prompts exist anywhere in the kit (P8-D8), so every
// path here ends in a written verdict and a number.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { toNdjson, toTable } from "./report";
import { type Loader, runPlayground } from "./run";
import type { RunResult } from "./verdict";

const USAGE = `plugin-playground <pluginDir> [--json] [--state <type>[:<name>]]

Renders every declared widget state of a plugin headlessly and answers pass/fail
per state (plugin spec §5.4 item 5, §24.2).

  --json                NDJSON: one verdict per line, then a summary line
  --state <type>[:<n>]  run one widget type, or one state of it

exit 0  every state passed (skipped GL states do not fail a run)
exit 1  at least one refusal
exit 2  the harness itself failed
`;

interface Args {
  readonly pluginDir?: string;
  readonly json: boolean;
  readonly only?: string;
  readonly help: boolean;
  readonly error?: string;
}

export function parseArgs(argv: readonly string[]): Args {
  let pluginDir: string | undefined;
  let json = false;
  let only: string | undefined;
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--state") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-"))
        return { json, help, error: "--state needs a <type>[:<name>] argument" };
      only = value;
      i += 1;
    } else if (arg.startsWith("--state=")) only = arg.slice("--state=".length);
    else if (arg.startsWith("-")) return { json, help, error: `unknown option ${arg}` };
    else if (pluginDir === undefined) pluginDir = arg;
    else return { json, help, error: `unexpected argument ${arg} (one plugin directory per run)` };
  }
  return {
    ...(pluginDir !== undefined ? { pluginDir } : {}),
    json,
    ...(only !== undefined ? { only } : {}),
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
  const result = await runPlayground({ pluginDir, loader, only: args.only });
  process.stdout.write(render(result, args.json));
  return result.summary.exit;
}
