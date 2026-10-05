// The scaffold itself: refuse, create, copy, emit, then say what to run next.
//
// The order is the promise. Everything that can refuse refuses BEFORE the first
// mkdir, so a refused run leaves the filesystem exactly as it found it — which
// is what makes `target-not-empty` a rule an author can rely on rather than a
// race they have to clean up after.
//
// The manifest is EMITTED, not templated. `template/src/manifest.ts` carries
// only type imports, so plain Node's type stripping can import it from a
// directory that has no node_modules yet — which means the canonical
// `vibefield.plugin.json` comes out of the scaffold's own `gen:manifest` path
// on its first breath, from the one source of truth the plugin will keep using.
// A scaffold whose manifest was written by a second producer would be born
// stale the first time the template's declaration changed (PA-2).

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { emitManifest } from "@vibefield/plugin-build";
import { type Plan, type PlanInput, planScaffold } from "./plan";
import { substitute, TEMPLATE_ROOT, templateFiles } from "./template";
import { note, pass, refuse, type Verdict } from "./verdict";
import { DEV_ROOTS_ENV, placementFor, type WorkspacePlacement } from "./workspace";

export const MANIFEST_NAME = "vibefield.plugin.json";

/** Where the emitted manifest's source lives, relative to the plugin root. */
export const MANIFEST_SOURCE = "src/manifest.ts";

export interface ScaffoldOptions extends PlanInput {
  /** the target directory — created if absent, refused if non-empty */
  readonly dir: string;
  /** template root override (tests point this at a fixture) */
  readonly templateRoot?: string;
}

export interface ScaffoldResult {
  readonly verdicts: Verdict[];
  /** present only when the scaffold was written */
  readonly plan?: Plan;
  readonly root?: string;
  readonly files?: string[];
}

export async function scaffoldPlugin(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const planned = planScaffold(options);
  if (!planned.ok) return { verdicts: planned.verdicts };
  const plan = planned.plan;

  const root = resolve(options.dir);
  const occupied = targetRefusal(root);
  if (occupied !== undefined) return { verdicts: [occupied] };

  try {
    mkdirSync(root, { recursive: true });
  } catch (error) {
    return {
      verdicts: [
        refuse("target", "dir-uncreatable", `${root}: ${messageOf(error)}`, { pointer: root }),
      ],
    };
  }

  const verdicts: Verdict[] = [];
  const written: string[] = [];
  for (const file of templateFiles(options.templateRoot ?? TEMPLATE_ROOT)) {
    const absolute = join(root, ...file.path.split("/"));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, substitute(file.contents, plan));
    written.push(file.path);
  }
  verdicts.push(
    pass("write", `${plan.packageName} scaffolded into ${root} (${written.length} files)`),
  );

  // The plugin's own gen:manifest path, run once so the scaffold is check-clean
  // from birth — including the freshness row, which compares these exact bytes.
  const manifestPath = join(root, MANIFEST_NAME);
  const source = await import(
    `${pathToFileURL(join(root, ...MANIFEST_SOURCE.split("/"))).href}?scaffold=${Date.now()}`
  );
  emitManifest((source as { manifest: unknown }).manifest, manifestPath);
  written.push(MANIFEST_NAME);
  verdicts.push(
    pass(
      "manifest",
      `emitted ${MANIFEST_NAME} from ${MANIFEST_SOURCE} (pnpm gen:manifest re-runs it)`,
    ),
  );

  const placement = placementFor(root);
  verdicts.push(placementVerdict(root, placement));
  verdicts.push(nextStepsVerdict(root, placement, plan.packageName));

  return { verdicts, plan, root, files: written };
}

/** The global scaffolding law, as a refusal: never write into a directory that
 * already holds something. There is no `--force`, deliberately — the failure
 * this prevents is silent and unrecoverable, and an author who meant a fresh
 * directory can always name one. */
function targetRefusal(root: string): Verdict | undefined {
  if (!existsSync(root)) return undefined;

  const stats = statSync(root);
  if (!stats.isDirectory())
    return refuse("target", "dir-uncreatable", `${root} exists and is not a directory`, {
      pointer: root,
    });

  const entries = readdirSync(root);
  if (entries.length === 0) return undefined;
  return refuse(
    "target",
    "target-not-empty",
    `${root} already contains ${entries.length} entr${entries.length === 1 ? "y" : "ies"} (${entries.slice(0, 3).join(", ")}${entries.length > 3 ? ", …" : ""})`,
    { pointer: root },
  );
}

function placementVerdict(root: string, placement: WorkspacePlacement): Verdict {
  if (placement.member)
    return note(
      "workspace",
      "workspace-member",
      `inside the ${placement.root} workspace (matched ${placement.glob}) — its workspace:* and catalog: dependencies resolve once pnpm install has run`,
      { pointer: root },
    );
  return note(
    "workspace",
    "workspace-outside",
    `outside a pnpm workspace: NOTHING TO INSTALL — the kit's own commands (plugin-build, vibefield-plugin, plugin-playground) build, judge and try this plugin, binding the SDK to the copy they run from, as the app's import map binds it. Only the scaffold's own pnpm scripts (gen:manifest, test, typecheck) need an install, and their workspace:* and catalog: dependencies resolve only inside a checkout's workspace; vibefield-plugin emit-manifest stands in for gen:manifest. A person's dev session finds it through ${DEV_ROOTS_ENV} (vibefield-plugin dev-link)`,
    { pointer: root },
  );
}

/** The next commands, named verbatim, in the order they answer. An agent
 * should never have to guess the next call from prose. DK-6: the BUILD sits
 * before `check` — an object kind's rows (its export a desk kind named by its
 * type, its WGSL arrived as text) read the built module, and without one
 * `check` can only note that it is unbuilt. DK-10: the last step puts it ON
 * THE DESK (`try`); and OUTSIDE a workspace the steps are the kit's own
 * commands, never the checkout's `pnpm` scripts (`pnpm plugin`, `pnpm
 * playground` run only at a checkout's root — the bar's agents could not). */
function nextStepsVerdict(
  root: string,
  placement: WorkspacePlacement,
  packageName: string,
): Verdict {
  if (placement.member && placement.root !== undefined) {
    const target = relative(placement.root, root).split(sep).join("/");
    const steps = [
      "pnpm install",
      `pnpm --filter ${packageName} build`,
      `pnpm plugin check ${target}`,
      `pnpm playground ${target}`,
      `pnpm plugin try ${target}`,
    ];
    return note("next", "next-steps", steps.join(" · "), { pointer: root });
  }
  const steps = [
    `plugin-build ${root}`,
    `vibefield-plugin check ${root}`,
    `plugin-playground ${root}`,
    `vibefield-plugin try ${root}`,
  ];
  return note(
    "next",
    "next-steps",
    `${steps.join(" · ")} (after an edit of src/manifest.ts: vibefield-plugin emit-manifest ${root})`,
    { pointer: root },
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
