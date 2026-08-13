// `check` — the §5.4 suite, in one pass, as verdicts. The same rows CI runs on
// the built-ins (§24.2), runnable by the author (or the agent) before anything
// is committed.
//
// Row order is dependency order: the manifest is the authority every later row
// reads, so it goes first, and a manifest that does not validate takes the rows
// that would have to guess at it out of the run — honestly, with a note, rather
// than by emitting a cascade of derived failures an author would have to read
// past to find the real one. The import wall is the exception: it reads SOURCE,
// so it runs whatever the manifest says.

import { checkActivation } from "./activation-check";
import { checkArtifacts } from "./artifact-check";
import { checkManifest } from "./manifest-check";
import { loadPlugin } from "./plugin-dir";
import { checkSchemas } from "./schema-check";
import { note, refuse, type Verdict } from "./verdict";
import { checkWall } from "./wall";

export interface CheckOptions {
  /** the plugin directory */
  readonly dir: string;
  /** skip the rows that import the plugin's built module (tests use it to keep
   * a run hermetic; the CLI never sets it) */
  readonly skipActivation?: boolean;
}

export async function checkPlugin(opts: CheckOptions): Promise<Verdict[]> {
  const loaded = loadPlugin(opts.dir);
  if (!loaded.ok) return [refuse("manifest", loaded.code, loaded.detail)];

  const plugin = loaded.plugin;
  const verdicts: Verdict[] = [];

  const manifestRow = checkManifest(plugin);
  verdicts.push(...manifestRow.verdicts);
  verdicts.push(...checkWall(plugin.root));

  const manifest = manifestRow.manifest;
  if (manifest === undefined) {
    verdicts.push(
      note(
        "check",
        "manifest-invalid",
        "schema, activation and artifact rows need a valid manifest and did not run",
      ),
    );
    return verdicts;
  }

  verdicts.push(...checkSchemas(manifest));
  if (opts.skipActivation !== true)
    verdicts.push(...(await checkActivation(plugin.root, manifest)));
  verdicts.push(...checkArtifacts(plugin.root, manifest));

  return verdicts;
}
