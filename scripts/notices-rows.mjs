// Item 178 (2026-11-05) — the notices rows held to what the stage copies, in both directions.
//
// LP-5's notices name the esbuild bundles by hand (third-party-notices.mjs NODE_BUNDLES), and a bundle with no row
// attributes nothing, silently: SD-2's sound-worker.cjs shipped with none until its own lane added one, and TH-1's
// transcript-host.cjs joined the SEA builder's sidecars with neither a stage row nor a notices row. A notices gate that
// checks only the files it was told about is not a gate, so this module checks three tables against each other:
//   (a) fieldd's sidecars (apps/desktop/packaging/fieldd-sidecars.mjs) ↔ the stage's rows from fieldd's dist/: each
//       sidecar staged exactly once, as `bin/<name>`, and nothing else staged from there;
//   (b) every staged Node bundle (a file row whose source is a dist/ .cjs, .mjs or .js) ↔ a NODE_BUNDLES row naming
//       that same file, and every sidecar that is not a bundle declares where its notices come from;
//   (c) every NODE_BUNDLES row ↔ a staged row's source, or `embeddedIn` naming a staged row (fieldd's bin.cjs, inside
//       the executable).
// Pure on the tables, so scripts/stage-package.mjs runs it on its live PLAN and refuses every stage, --verify
// included, before it copies anything; tooling/dev-runner/test/notices-rows.test.mjs runs it on the committed tables.
// Whether a declared npm package or engine is IN the generated ledger is the notices' own check
// (third-party-notices.mjs `sidecarNoticesProblems`), because only the stage builds the ledger.
//
// Node >=22 ESM, builtins only.

const FIELDD_DIST = "packages/fieldd/dist/";
const NODE_BUNDLE = /\/dist\/.+\.(?:cjs|mjs|js)$/u;
const JS_FILE = /\.(?:cjs|mjs|js)$/u;

/** Is this stage row a Node bundle the notices must name? A file copied from a build's dist/ as JavaScript. The
 * renderer's chunks ride a directory row and are the renderer closure's (`closures`), never a bundle's. */
export function isNodeBundleRow(row) {
  return row.kind === "file" && typeof row.from === "string" && NODE_BUNDLE.test(row.from);
}

/** The problems, each naming its file; empty when the three tables agree. */
export function noticesRowProblems({ plan, sidecars, nodeBundles }) {
  const problems = [];
  const fromOf = (from) => plan.filter((row) => row.from === from);
  const bundleFiles = new Set(nodeBundles.map((b) => b.file));
  const sidecarFroms = new Set(sidecars.map((s) => s.from));

  // (a) the sidecars, staged exactly as the SEA builder lists them
  for (const s of sidecars) {
    const rows = fromOf(s.from);
    if (rows.length === 0) {
      problems.push(
        `${s.from}: a sidecar of the fieldd executable that the stage never copies (want ${s.stage})`,
      );
    } else if (rows.length > 1) {
      problems.push(`${s.from}: staged ${rows.length} times`);
    } else if (rows[0].stage !== s.stage) {
      problems.push(
        `${s.from}: staged as ${rows[0].stage}, but the executable looks beside itself, at ${s.stage}`,
      );
    }
  }
  for (const row of plan) {
    if (
      typeof row.from === "string" &&
      row.from.startsWith(FIELDD_DIST) &&
      !sidecarFroms.has(row.from)
    ) {
      problems.push(
        `${row.from}: staged from fieldd's dist/, and not a sidecar the SEA builder lists`,
      );
    }
  }

  // (b) every staged Node bundle has its notices row; every sidecar says where its notices come from
  for (const row of plan) {
    if (isNodeBundleRow(row) && !bundleFiles.has(row.from)) {
      problems.push(
        `${row.from}: staged as ${row.stage} with no NODE_BUNDLES row, so nothing inside it is attributed`,
      );
    }
  }
  for (const s of sidecars) {
    const n = s.notices ?? {};
    const declared = [n.bundle === true, typeof n.npm === "string", typeof n.engine === "string"];
    if (declared.filter(Boolean).length !== 1) {
      problems.push(
        `${s.from}: declares no single source for its notices ({ bundle }, { npm } or { engine })`,
      );
      continue;
    }
    if (JS_FILE.test(s.name) !== (n.bundle === true)) {
      problems.push(
        JS_FILE.test(s.name)
          ? `${s.from}: JavaScript beside the executable must be a bundle with its own NODE_BUNDLES row`
          : `${s.from}: not JavaScript, so it cannot be a bundle; declare { npm } or { engine }`,
      );
    }
    if (n.bundle === true && !bundleFiles.has(s.from)) {
      problems.push(`${s.from}: a bundle beside the executable with no NODE_BUNDLES row`);
    }
  }

  // (c) every notices row names a file the stage ships
  const stages = new Set(plan.map((row) => row.stage));
  for (const b of nodeBundles) {
    if (b.embeddedIn !== undefined) {
      if (!stages.has(b.embeddedIn)) {
        problems.push(
          `${b.file}: NODE_BUNDLES says it is embedded in ${b.embeddedIn}, which the stage does not ship`,
        );
      }
    } else if (fromOf(b.file).length === 0) {
      problems.push(
        `${b.file}: a NODE_BUNDLES row for a file the stage never copies (stage it, or say embeddedIn)`,
      );
    }
  }
  return problems;
}

/** The stager stages at import, so a test cannot import its PLAN. This reads its rows as written: each line-leading
 * `from:` with the `stage:` line above it, up to its `kind:`, kept when both are string literals. A row naming a dist/
 * path that the reader cannot read that way is a problem, never skipped, so a computed dist row cannot slip past the
 * check unseen (the computed rows today, fieldd's executable and the native binaries, read from no dist/); so is a
 * `from:` with no `kind:` after it. */
export function literalStageRows(source) {
  const rows = [];
  const problems = [];
  let read = 0;
  for (const m of source.matchAll(
    /^([^\n]*)\n[ \t]*from:([\s\S]*?)^[ \t]*kind:\s*"(file|dir)"/gmu,
  )) {
    read += 1;
    const stage = /^\s*stage:\s*"([^"]*)",?\s*$/u.exec(m[1])?.[1];
    const value = m[2].trim().replace(/,$/u, "");
    const from = /^"([^"]*)"$/u.exec(value)?.[1];
    if (stage !== undefined && from !== undefined) rows.push({ stage, from, kind: m[3] });
    else if (value.includes("/dist/") || from?.includes("/dist/")) {
      problems.push(
        `a dist/ row this reader cannot read as literals: ${m[1].trim()} from: ${value}`,
      );
    }
  }
  const froms = source.match(/^[ \t]*from:/gmu)?.length ?? 0;
  if (froms !== read)
    problems.push(`${froms} line-leading from: rows, and ${read} read up to their kind:`);
  return { rows, problems };
}
