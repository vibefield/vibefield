// The declaration ↔ binding row and its leak twin (§24.2's "declaration ↔
// implementation exact-match" and "activation/deactivation leak test"), driven
// through the SDK's own mock host so the kit tests the contract it documents
// rather than a copy of it.
//
// TWO HONEST LIMITS, both surfaced as notes rather than papered over:
//
//  - No build, no rows. `check` must never require `plugin-build` to have run,
//    so an absent renderer artifact is `activation-unbuilt` — a note, not a
//    refusal.
//  - A widget bundle's module graph is a BROWSER graph. It reaches JSX and CSS
//    through the SDK's `/ui` and `/canvas` doors, and plain Node can import
//    neither. When the import dies for that reason the row says so
//    (`activation-not-loadable-here`) and names the playground, which owns a
//    real engine; it never pretends the plugin passed, and it never blames the
//    plugin for the harness's ceiling.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginManifestV1 } from "@vibefield/contracts";
import type { RendererPluginModule } from "@vibefield/plugin-sdk";
import { activateWithMockHost, type MockPluginHostOptions } from "@vibefield/plugin-sdk/testing";
import { note, pass, refuse, type Verdict } from "./verdict";

/** The §10.1 module shape, from either spelling — the staged loader's own rule
 * (`asRendererModule`), so a module this row accepts is one the host accepts. */
export function asRendererModule(imported: unknown): RendererPluginModule | null {
  const candidates = [
    imported,
    typeof imported === "object" && imported !== null
      ? (imported as { default?: unknown }).default
      : undefined,
  ];
  for (const candidate of candidates) {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      typeof (candidate as { activate?: unknown }).activate === "function"
    ) {
      return candidate as RendererPluginModule;
    }
  }
  return null;
}

/** Timer-class handles, the leak evidence this harness can honestly see. A
 * plugin that leaves a `setInterval` running after deactivation is the §24.2
 * row's whole point; sockets and file handles belong to the daemon planes and
 * would only produce noise here. */
const LEAK_KINDS = new Set(["Timeout", "Immediate"]);

function timerCensus(): Map<string, number> {
  const out = new Map<string, number>();
  for (const kind of process.getActiveResourcesInfo()) {
    if (!LEAK_KINDS.has(kind)) continue;
    out.set(kind, (out.get(kind) ?? 0) + 1);
  }
  return out;
}

/** Is this import failure the harness's ceiling (a browser-only graph) rather
 * than the plugin's defect? Attributed from the failure kind, and the offending
 * module is named in the verdict so the answer stays checkable. */
function isBrowserGraphFailure(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  if (
    code === "ERR_MODULE_NOT_FOUND" ||
    code === "ERR_UNKNOWN_FILE_EXTENSION" ||
    code === "ERR_UNSUPPORTED_DIR_IMPORT"
  )
    return true;
  return error instanceof SyntaxError;
}

export async function checkActivation(
  root: string,
  manifest: PluginManifestV1,
): Promise<Verdict[]> {
  const declaredWidgets = (manifest.contributes?.widgets ?? []).map((w) => w.type);
  const declaredCommands = (manifest.contributes?.commands ?? []).map((c) => c.id);
  const declaredSurfaces = (manifest.contributes?.surfaces ?? []).map((s) => s.id);

  const entry = manifest.entries?.renderer;
  if (entry === undefined)
    return [pass("activation", "no renderer entry declared (service-only plugin)")];

  const entryPath = resolve(root, entry);
  if (!existsSync(entryPath))
    return [
      note(
        "activation",
        "activation-unbuilt",
        `${entry} is not on disk, so binding and leak rows did not run`,
        { pointer: entry },
      ),
    ];

  let imported: unknown;
  try {
    imported = await import(pathToFileURL(entryPath).href);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isBrowserGraphFailure(error))
      return [
        note(
          "activation",
          "activation-not-loadable-here",
          `${entry} needs a browser module graph: ${message}`,
          { pointer: entry },
        ),
      ];
    return [
      refuse("activation", "module-unloadable", `${entry} threw while importing: ${message}`, {
        pointer: entry,
      }),
    ];
  }

  const mod = asRendererModule(imported);
  if (mod === null)
    return [
      refuse("activation", "module-shape-invalid", `${entry} exports no activate(ctx)`, {
        pointer: entry,
      }),
    ];

  // The context the REAL harness would build for this manifest: commands and
  // surfaces present iff declared, canvas present iff the manifest requests a
  // canvas capability (renderer-harness's own `hasCanvas` rule).
  const options: MockPluginHostOptions = {
    id: manifest.id,
    version: manifest.version,
    declaredWidgets,
    ...(declaredCommands.length > 0 ? { declaredCommands } : {}),
    ...(declaredSurfaces.length > 0 ? { declaredSurfaces } : {}),
    ...(manifest.capabilities.includes("canvas.read") ||
    manifest.capabilities.includes("canvas.write")
      ? { canvasEngine: { note: "plugin-cli check: opaque canvas handle, no engine behind it" } }
      : {}),
  };

  const before = timerCensus();
  const verdicts: Verdict[] = [];
  let session: Awaited<ReturnType<typeof activateWithMockHost>>;
  try {
    session = await activateWithMockHost(mod, options);
  } catch (error) {
    return [
      refuse(
        "activation",
        "activation-failed",
        `activate(ctx) failed: ${error instanceof Error ? error.message : String(error)}`,
        { pointer: entry },
      ),
    ];
  }

  verdicts.push(
    ...exactMatch("widget type", declaredWidgets, [...session.bindings.keys()]),
    ...exactMatch("command", declaredCommands, [...session.commands.keys()]),
    ...exactMatch("surface", declaredSurfaces, [...session.surfaces.keys()]),
  );

  // Deactivation, the host's own sequence (§18.1): abort the context, then
  // dispose everything the plugin handed back. The mock's registration handles
  // are the host's business — a plugin that never tracks its own registration
  // is not leaking, because `endActivation` clears that map either way.
  session.abort();
  for (const disposable of session.disposables) {
    try {
      await disposable.dispose();
    } catch (error) {
      verdicts.push(
        refuse(
          "activation",
          "activation-leak",
          `a disposable threw during deactivation: ${error instanceof Error ? error.message : String(error)}`,
          { pointer: entry },
        ),
      );
    }
  }

  const after = timerCensus();
  const leaked = [...after.entries()]
    .map(([kind, count]) => ({ kind, delta: count - (before.get(kind) ?? 0) }))
    .filter((row) => row.delta > 0);
  if (leaked.length > 0) {
    verdicts.push(
      refuse(
        "activation",
        "activation-leak",
        `deactivation left ${leaked.map((l) => `${l.delta} ${l.kind}`).join(", ")} running`,
        { pointer: entry },
      ),
    );
  } else {
    verdicts.push(pass("activation", "deactivation released every timer this activation created"));
  }

  return verdicts;
}

/** Both directions, because both are real failures: a binding with no
 * declaration is refused by the host at register time, and a declaration with no
 * binding is a contribution the user can reach and nothing implements. */
function exactMatch(kind: string, declared: string[], bound: string[]): Verdict[] {
  const declaredSet = new Set(declared);
  const boundSet = new Set(bound);
  const verdicts: Verdict[] = [];
  for (const id of bound)
    if (!declaredSet.has(id))
      verdicts.push(
        refuse("activation", "binding-undeclared", `bound ${kind} ${id} is not declared`, {
          expected: `declare ${id} in the manifest, or stop registering it`,
        }),
      );
  for (const id of declared)
    if (!boundSet.has(id))
      verdicts.push(
        refuse("activation", "binding-missing", `declared ${kind} ${id} was never bound`, {
          expected: `register ${id} during activate(ctx)`,
        }),
      );
  if (verdicts.length === 0 && declared.length > 0)
    verdicts.push(pass("activation", `${declared.length} declared ${kind}(s) bound exactly`));
  return verdicts;
}
