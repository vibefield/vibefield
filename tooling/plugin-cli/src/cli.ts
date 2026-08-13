// The command line. Deliberately small: parse, dispatch, print verdicts, return
// an exit code. No prompts exist anywhere in the kit — an agent runs these
// commands unattended, and a tool that ever waits for a keystroke is a tool it
// cannot use.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PluginManifestV1 } from "@vibefield/contracts";
import { checkPlugin } from "./check";
import { devLink, resolveDevRoot } from "./dev-link";
import { checkDocsFresh, writeDocs } from "./docs-command";
import { formatInspection, inspectPlugin } from "./inspect";
import { checkManifest } from "./manifest-check";
import { artifactNameFor, packPlugin } from "./pack-command";
import { loadPlugin } from "./plugin-dir";
import { lookupRelease, signIndex, submitPlugin } from "./registry-commands";
import { createEmitter, EXIT_HARNESS, EXIT_OK, exitCodeFor, refuse, type Verdict } from "./verdict";

export const HELP = `vibefield-plugin — the VibeField plugin authoring kit

usage: vibefield-plugin <command> [options]

commands:
  check <dir>                     run the authoring suite over a plugin directory
  inspect <dir>                   print what the host will see (contributions, grants, hashes)
  pack <dir> [--out <file>]       write the deterministic .vfplugin and its sha256
  dev-link <dir> [--root <dir>]   copy the plugin where a developer-mode session finds it
                     [--remove]   undo a link this command made
  submit <dir> [--artifact <f>]   print the registry index row for an artifact
  release lookup <id> --index <path> --key <public key file>
                                  verify an index signature, then print the release row
  index sign <index> --key <secret key file>
                                  write the detached signature beside an index
  docs --out <dir> [--check]      generate the authoring reference (or verify it is current)

options:
  --json      one JSON object per line: verdicts, and a result object for data commands
  --help      this text

exit codes:
  0  every row passed        1  at least one refusal        2  the kit itself failed

Nothing here prompts, and nothing here touches the network.`;

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
  // The kit's whole product is these two streams; R11's console rule covers
  // packages/, and a CLI's stdout is not a runtime diagnostic sink.
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

/** Load a plugin dir and validate its manifest — the preamble every plugin
 * command needs. Returns the verdicts to print when it cannot. */
function requireManifest(
  dir: string,
): { ok: true; root: string; manifest: PluginManifestV1 } | { ok: false; verdicts: Verdict[] } {
  const loaded = loadPlugin(dir);
  if (!loaded.ok) return { ok: false, verdicts: [refuse("manifest", loaded.code, loaded.detail)] };
  const row = checkManifest(loaded.plugin);
  if (row.manifest === undefined) return { ok: false, verdicts: row.verdicts };
  return { ok: true, root: loaded.plugin.root, manifest: row.manifest };
}

export async function runCli(argv: readonly string[], io: CliIo = consoleIo): Promise<number> {
  const { command, flags } = parseArgs(argv);
  const json = flags.get("json") === true;

  if (flags.get("help") === true || command.length === 0) {
    io.out(HELP);
    return EXIT_OK;
  }

  const emitter = createEmitter({ json, write: io.out });
  const emitAll = (verdicts: readonly Verdict[]): void => {
    for (const verdict of verdicts) emitter.emit(verdict);
  };

  try {
    switch (command[0]) {
      case "check": {
        const dir = command[1];
        if (dir === undefined) return usage(emitter.emit.bind(emitter), "check <dir>");
        emitAll(await checkPlugin({ dir }));
        break;
      }

      case "inspect": {
        const dir = command[1];
        if (dir === undefined) return usage(emitter.emit.bind(emitter), "inspect <dir>");
        const loaded = requireManifest(dir);
        if (!loaded.ok) {
          emitAll(loaded.verdicts);
          break;
        }
        const inspection = await inspectPlugin(loaded.root, loaded.manifest);
        if (json) io.out(JSON.stringify({ result: "inspect", ...inspection }));
        else io.out(formatInspection(inspection));
        return EXIT_OK;
      }

      case "pack": {
        const dir = command[1];
        if (dir === undefined) return usage(emitter.emit.bind(emitter), "pack <dir>");
        const loaded = requireManifest(dir);
        if (!loaded.ok) {
          emitAll(loaded.verdicts);
          break;
        }
        const out = flagString(flags, "out");
        const result = await packPlugin({
          root: loaded.root,
          manifest: loaded.manifest,
          ...(out !== undefined ? { out } : {}),
        });
        emitAll(result.verdicts);
        if (json && result.sha256 !== undefined)
          io.out(
            JSON.stringify({
              result: "pack",
              artifactPath: result.artifactPath,
              sha256: result.sha256,
            }),
          );
        break;
      }

      case "dev-link": {
        const dir = command[1];
        if (dir === undefined) return usage(emitter.emit.bind(emitter), "dev-link <dir>");
        const loaded = requireManifest(dir);
        if (!loaded.ok) {
          emitAll(loaded.verdicts);
          break;
        }
        const explicit = flagString(flags, "root");
        const devRoot = resolveDevRoot({
          ...(explicit !== undefined ? { explicit } : {}),
          env: process.env["FIELDD_PLUGIN_DEV_ROOTS"],
          from: loaded.root,
        });
        if (devRoot === undefined) {
          emitter.emit(
            refuse(
              "dev-link",
              "dev-root-unknown",
              "no --root, no FIELDD_PLUGIN_DEV_ROOTS, and no workspace above this plugin",
            ),
          );
          break;
        }
        emitAll(
          devLink({
            root: loaded.root,
            manifest: loaded.manifest,
            devRoot,
            remove: flags.get("remove") === true,
          }).verdicts,
        );
        break;
      }

      case "submit": {
        const dir = command[1];
        if (dir === undefined) return usage(emitter.emit.bind(emitter), "submit <dir>");
        const loaded = requireManifest(dir);
        if (!loaded.ok) {
          emitAll(loaded.verdicts);
          break;
        }
        const explicit = flagString(flags, "artifact");
        const artifactPath = explicit ?? join(loaded.root, artifactNameFor(loaded.manifest));
        const result = submitPlugin({ manifest: loaded.manifest, artifactPath });
        emitAll(result.verdicts);
        if (result.indexRow !== undefined) {
          if (json) io.out(JSON.stringify({ result: "submit", indexRow: result.indexRow }));
          else {
            io.out("");
            io.out("index row (registry/index.json → plugins[<id>]):");
            io.out(JSON.stringify(result.indexRow, null, 2));
          }
        }
        break;
      }

      case "release": {
        if (command[1] !== "lookup")
          return usage(
            emitter.emit.bind(emitter),
            "release lookup <id> --index <path> --key <file>",
          );
        const id = command[2];
        const index = flagString(flags, "index");
        const keyPath = flagString(flags, "key");
        if (id === undefined || index === undefined || keyPath === undefined)
          return usage(
            emitter.emit.bind(emitter),
            "release lookup <id> --index <path> --key <file>",
          );
        if (!existsSync(keyPath)) {
          emitter.emit(refuse("registry", "key-unreadable", `no key file at ${keyPath}`));
          break;
        }
        const result = lookupRelease({
          location: index,
          publicKey: readFileSync(keyPath, "utf8").trim(),
          id,
        });
        emitAll(result.verdicts);
        if (result.entry !== undefined && json)
          io.out(JSON.stringify({ result: "release", entry: result.entry }));
        else if (result.entry !== undefined) io.out(JSON.stringify(result.entry, null, 2));
        break;
      }

      case "index": {
        if (command[1] !== "sign")
          return usage(emitter.emit.bind(emitter), "index sign <index> --key <file>");
        const indexPath = command[2];
        const keyPath = flagString(flags, "key");
        if (indexPath === undefined || keyPath === undefined)
          return usage(emitter.emit.bind(emitter), "index sign <index> --key <file>");
        emitAll(signIndex({ indexPath, keyPath }).verdicts);
        break;
      }

      case "docs": {
        const out = flagString(flags, "out");
        if (out === undefined) return usage(emitter.emit.bind(emitter), "docs --out <dir>");
        emitAll(flags.get("check") === true ? checkDocsFresh(out) : writeDocs(out).verdicts);
        break;
      }

      default:
        return usage(emitter.emit.bind(emitter), `unknown command ${String(command[0])}`);
    }
  } catch (error) {
    // Exit 2 is the harness saying "this is my bug, not your plugin's".
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const verdict = refuse("harness", "harness-error", detail);
    io.err(json ? JSON.stringify(verdict) : `REFUSE harness      ${detail}`);
    return EXIT_HARNESS;
  }

  return exitCodeFor(emitter.verdicts);
}

function usage(emit: (verdict: Verdict) => void, expected: string): number {
  emit(refuse("input", "usage", `usage: vibefield-plugin ${expected}`));
  return 1;
}

/** Absolute path helper for callers embedding the CLI (tests, gen scripts). */
export function resolveFromCwd(path: string): string {
  return resolve(process.cwd(), path);
}
