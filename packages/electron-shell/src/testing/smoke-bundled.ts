// WP8d (build-wp8-bundled-plugins.md W7) — THE BUNDLED ROOT, KEYED, IN THE PRODUCT: `pnpm smoke:bundled`.
//
// `apps/desktop/packaging/stage-bundled-fixture.mjs` stages the app's own plugins the way a package carries them — the
// producer the stager runs (`bundled-plugins.mjs stage`, dev keys minted in memory) — into a temporary
// `plugins/bundled` + `identity/`, and runs smoke:canvas with `--bundled` three times, each launch keyed to that root
// alone (`FIELDD_PLUGIN_ROOTS` the staged root, `FIELDD_PLUGIN_DEV_ROOTS` empty, `FIELDD_TRUST_ROOT`/`_KEYS` the staged
// trust-root and its root keys — the development layout's passthrough, `main/fieldd.ts`) and told by `VF_BUNDLED_FIXTURE`
// which run it is:
//   loads   — the root as staged: every bundled row `enabled` with its provenance block (`registry`: the index's name,
//             the artifact hash, the publisher) and `installRevision` the artifact hash; every plugin with a renderer
//             came through the STAGED path (`CANVAS_READY.stagedPlugins`); no root problem.
//   corrupt — one byte of one plugin's renderer flipped after staging: that row `invalid` with
//             `PLUGIN_ARTIFACT_MISMATCH` naming the file, the others still enabled and staged.
//   forged  — the same flipped byte, its hash written into the index and the index re-signed by a stranger's key: not
//             one bundled row, ONE root problem naming the signature.
// The rows' judgement is here, pure; the runner (testing/smoke.ts, the `--bundled` branch of runSmokeCanvas) reads the
// window and fieldd and prints one `SMOKE_BUNDLED {…}` line per run.

import { basename } from "node:path";
import {
  BUNDLED_PLUGIN_INDEX_FILE,
  type PluginRecord,
  type PluginRegistrySnapshot,
} from "@vibefield/contracts";

/** The flag the stager passes after `--smoke-canvas`: run the bundled rows instead of the canvas witnesses. */
export const BUNDLED_FLAG = "--bundled";

/** The run's fixture, JSON (the stager's): which run, the staged ids, which file it corrupted. */
export const BUNDLED_FIXTURE_ENV = "VF_BUNDLED_FIXTURE";

export const BUNDLED_RUNS = ["loads", "corrupt", "forged"] as const;
export type BundledRun = (typeof BUNDLED_RUNS)[number];

/** The provenance block's publisher on a first-party row (fieldd `walkKeyedBundled`). */
export const BUNDLED_PUBLISHER = "vibefield";

/** The one refusal kind of both grains (WP8-D5): a row whose bytes are not the index's, a root whose index is not
 * signed by the app's key. */
export const BUNDLED_REFUSAL_KIND = "PLUGIN_ARTIFACT_MISMATCH";

export interface BundledFixture {
  readonly run: BundledRun;
  /** the staged bundled root (`<tmp>/<run>/plugins/bundled`) — its basename names a root problem */
  readonly root: string;
  /** every plugin id the index lists, in the stager's order */
  readonly plugins: readonly string[];
  /** the ids among them that declare a renderer entry — what the staged path loads */
  readonly renderers: readonly string[];
  /** the file this run changed after staging (corrupt, forged), plugin-relative */
  readonly corrupted: { readonly id: string; readonly path: string } | null;
}

/** The run's fixture from the environment, or why there is none — never a guess. */
export function bundledFixture(
  env: NodeJS.ProcessEnv,
): { fixture: BundledFixture } | { problem: string } {
  const raw = env[BUNDLED_FIXTURE_ENV];
  if (raw === undefined || raw.length === 0)
    return {
      problem: `${BUNDLED_FLAG} without ${BUNDLED_FIXTURE_ENV} (packaging/stage-bundled-fixture.mjs stages the root)`,
    };
  let parsed: Partial<BundledFixture> | null;
  try {
    parsed = JSON.parse(raw) as Partial<BundledFixture> | null;
  } catch {
    return { problem: `${BUNDLED_FIXTURE_ENV} is not JSON` };
  }
  const strings = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((s) => typeof s === "string");
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !BUNDLED_RUNS.includes(parsed.run as BundledRun) ||
    typeof parsed.root !== "string" ||
    !strings(parsed.plugins) ||
    parsed.plugins.length === 0 ||
    !strings(parsed.renderers)
  )
    return { problem: `${BUNDLED_FIXTURE_ENV} is not a bundled fixture: ${raw.slice(0, 200)}` };
  const corrupted = parsed.corrupted ?? null;
  if ((parsed.run === "loads") !== (corrupted === null))
    return {
      problem: `${BUNDLED_FIXTURE_ENV}: a ${parsed.run} run with corrupted=${JSON.stringify(corrupted)}`,
    };
  return {
    fixture: {
      run: parsed.run as BundledRun,
      root: parsed.root,
      plugins: parsed.plugins,
      renderers: parsed.renderers,
      corrupted,
    },
  };
}

/** One row as the SMOKE_BUNDLED line says it: the facts a reader of the run needs, nothing of the settings. */
function rowFacts(row: PluginRecord): object {
  return {
    id: row.id,
    source: row.source,
    state: row.state,
    enabled: row.enabled,
    installRevision: row.installRevision,
    ...(row.registry !== undefined ? { registry: row.registry } : {}),
    ...(row.lastError !== undefined ? { lastError: row.lastError } : {}),
  };
}

/** A verified bundled row: enabled, its provenance block, `installRevision` its artifact hash. */
function verifiedRowProblems(row: PluginRecord | undefined, id: string): string[] {
  if (row === undefined) return [`${id}: no row`];
  const problems: string[] = [];
  if (row.state !== "enabled" || !row.enabled)
    problems.push(
      `${id}: ${row.state}${row.lastError ? ` (${row.lastError.kind}: ${row.lastError.message})` : ""}, not enabled`,
    );
  const registry = row.registry;
  if (registry === undefined) problems.push(`${id}: no provenance block`);
  else {
    if (registry.indexRef !== BUNDLED_PLUGIN_INDEX_FILE)
      problems.push(
        `${id}: provenance names ${registry.indexRef}, not ${BUNDLED_PLUGIN_INDEX_FILE}`,
      );
    if (registry.publisher !== BUNDLED_PUBLISHER)
      problems.push(`${id}: provenance publisher ${registry.publisher}, not ${BUNDLED_PUBLISHER}`);
    if (`sha256:${row.installRevision}` !== registry.artifactSha256)
      problems.push(
        `${id}: installRevision ${row.installRevision} is not the artifact hash ${registry.artifactSha256}`,
      );
  }
  return problems;
}

/**
 * The run judged from what the renderer said (`CANVAS_READY.stagedPlugins`) and what fieldd lists (`plugins.list`).
 * Every way it disagrees with the fixture is named. The roots outside the staged one are held EMPTY too — a dev-linked
 * row would mean the run's environment did not reach fieldd, and its counts would prove nothing.
 */
export function judgeBundled(
  fixture: BundledFixture,
  stagedPlugins: number,
  snapshot: PluginRegistrySnapshot,
): { facts: object; problems: string[] } {
  const problems: string[] = [];
  const bundled = snapshot.plugins.filter((row) => row.source === "bundled");
  const others = snapshot.plugins.filter((row) => row.source !== "bundled");
  const byId = new Map(bundled.map((row) => [row.id, row]));
  const facts = {
    run: fixture.run,
    stagedPlugins,
    rows: bundled.map(rowFacts),
    others: others.map((row) => `${row.source}:${row.id}`),
    rootProblems: snapshot.problems,
    ...(fixture.corrupted !== null ? { corrupted: fixture.corrupted } : {}),
  };
  if (others.length > 0)
    problems.push(
      `rows from outside the staged root (${facts.others.join(", ")}) — the run's environment did not key fieldd to it alone`,
    );

  if (fixture.run === "forged") {
    if (bundled.length > 0)
      problems.push(
        `${bundled.length} bundled row(s) from a root whose index a stranger signed: ${bundled.map((r) => r.id).join(", ")}`,
      );
    const rootName = basename(fixture.root);
    if (snapshot.problems.length !== 1) {
      problems.push(`${snapshot.problems.length} root problem(s), not exactly 1`);
    } else {
      const [problem] = snapshot.problems;
      if (problem?.root !== rootName)
        problems.push(`the root problem names ${problem?.root}, not ${rootName}`);
      if (problem?.error.kind !== BUNDLED_REFUSAL_KIND)
        problems.push(`the root problem is ${problem?.error.kind}, not ${BUNDLED_REFUSAL_KIND}`);
      if (!/signature/u.test(problem?.error.message ?? ""))
        problems.push(`the root problem does not name the signature: "${problem?.error.message}"`);
    }
    if (stagedPlugins !== 0)
      problems.push(`${stagedPlugins} plugin(s) staged from a refused root, not 0`);
    return { facts, problems };
  }

  if (snapshot.problems.length > 0)
    problems.push(
      `root problem(s) where the index verifies: ${snapshot.problems.map((p) => `${p.root}: ${p.error.message}`).join(" | ")}`,
    );
  const listed = new Set(fixture.plugins);
  const extra = bundled.filter((row) => !listed.has(row.id)).map((row) => row.id);
  if (extra.length > 0)
    problems.push(`bundled row(s) the index does not list: ${extra.join(", ")}`);

  const refused = fixture.corrupted?.id ?? null;
  for (const id of fixture.plugins) {
    if (id !== refused) {
      problems.push(...verifiedRowProblems(byId.get(id), id));
      continue;
    }
    const row = byId.get(id);
    const path = fixture.corrupted?.path ?? "";
    if (row === undefined) {
      problems.push(`${id}: no row — a corrupted copy is refused ON ITS ROW, never dropped`);
      continue;
    }
    if (row.state !== "invalid")
      problems.push(`${id}: ${row.state} with ${path} corrupted, not invalid`);
    else if (row.enabled) problems.push(`${id}: invalid, yet enabled`);
    if (row.lastError?.kind !== BUNDLED_REFUSAL_KIND)
      problems.push(
        `${id}: refused as ${row.lastError?.kind ?? "nothing"}, not ${BUNDLED_REFUSAL_KIND}`,
      );
    if (!(row.lastError?.message ?? "").includes(path))
      problems.push(`${id}: the refusal does not name ${path}: "${row.lastError?.message ?? ""}"`);
  }
  const expectStaged = fixture.renderers.filter((id) => id !== refused).length;
  if (stagedPlugins !== expectStaged)
    problems.push(
      `${stagedPlugins} plugin(s) came through the staged path, not ${expectStaged} (${fixture.renderers.filter((id) => id !== refused).join(", ")})`,
    );
  return { facts, problems };
}
