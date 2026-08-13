// The command line. One command, no subcommands, no prompts: an agent runs this
// unattended, and a scaffolder that asks "what shall I call it?" is a scaffolder
// it cannot use. Every answer comes from a flag, and a missing flag is a usage
// refusal that names the whole invocation rather than a question.

import { resolve } from "node:path";
import { scaffoldPlugin } from "./scaffold";
import { createEmitter, EXIT_HARNESS, EXIT_OK, exitCodeFor, refuse, type Verdict } from "./verdict";

export const HELP = `create-plugin — scaffold a VibeField plugin

usage: create-plugin --id <vendor.name> --title <title> --dir <target> [options]

required:
  --id <vendor.name>     the plugin id: two or more dot-separated segments (§6.1)
  --title <title>        the human name, 1-80 characters
  --dir <target>         where to write it — must be empty or not exist

options:
  --widget-type <type>   the contributed widget type (default: the plugin id)
  --first-party          allow the reserved vibefield.* namespace
  --json                 one JSON object per line: verdicts, then a result object
  --help                 this text

exit codes:
  0  the scaffold was written   1  a refusal (nothing was written)   2  the scaffolder failed

The scaffold is a working plugin: a manifest, one widget, playground states and a
conformance test. Nothing here prompts, and nothing here touches the network.`;

interface ParsedArgs {
  readonly command: string[];
  readonly flags: Map<string, string | true>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const command: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      command.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(name, next);
      i++;
    } else {
      flags.set(name, true);
    }
  }
  return { command, flags };
}

function flagString(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

const consoleIo: CliIo = {
  // The scaffolder's whole product is these two streams; R11's console rule
  // covers packages/, and a CLI's stdout is not a runtime diagnostic sink.
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

export async function runCli(argv: readonly string[], io: CliIo = consoleIo): Promise<number> {
  const { flags } = parseArgs(argv);
  const json = flags.get("json") === true;

  if (flags.get("help") === true || argv.length === 0) {
    io.out(HELP);
    return EXIT_OK;
  }

  const emitter = createEmitter({ json, write: io.out });

  try {
    const id = flagString(flags, "id");
    const title = flagString(flags, "title");
    const dir = flagString(flags, "dir");
    const missing = [
      ...(id === undefined ? ["--id <vendor.name>"] : []),
      ...(title === undefined ? ["--title <title>"] : []),
      ...(dir === undefined ? ["--dir <target>"] : []),
    ];
    if (id === undefined || title === undefined || dir === undefined) {
      emitter.emit(
        refuse("input", "usage", `create-plugin needs ${missing.join(", ")}`, {
          expected: "create-plugin --id <vendor.name> --title <title> --dir <target>",
        }),
      );
      return exitCodeFor(emitter.verdicts);
    }

    const result = await scaffoldPlugin({
      id,
      title,
      dir,
      widgetType: flagString(flags, "widget-type"),
      firstParty: flags.get("first-party") === true,
    });
    for (const verdict of result.verdicts) emitter.emit(verdict);

    if (json && result.plan !== undefined) {
      io.out(
        JSON.stringify({
          result: "create",
          root: result.root,
          id: result.plan.id,
          title: result.plan.title,
          widgetType: result.plan.widgetType,
          packageName: result.plan.packageName,
          files: result.files,
        }),
      );
    }
    return exitCodeFor(emitter.verdicts);
  } catch (error) {
    // Exit 2 is the scaffolder saying "this is my bug, not your input".
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const verdict: Verdict = refuse("harness", "harness-error", detail);
    io.err(json ? JSON.stringify(verdict) : `REFUSE harness    ${detail}`);
    return EXIT_HARNESS;
  }
}

/** Absolute path helper for callers embedding the scaffolder (tests). */
export function resolveFromCwd(path: string): string {
  return resolve(process.cwd(), path);
}
