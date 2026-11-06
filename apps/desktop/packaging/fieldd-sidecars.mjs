// The fieldd executable's sidecars: the files that ride beside `bin/fieldd` because none of them can live inside the
// SEA's blob (F-10), and each resolves against the EXECUTABLE'S directory (F-11: __dirname in a SEA is the
// executable's dir, not the cwd), so whatever stages the package must copy them beside the binary.
//
// ONE table (item 178, 2026-11-05). build-fieldd-sea.mjs copies each beside the executable it builds, probes it and
// writes it into the artifact's manifest; scripts/stage-package.mjs spreads these rows into its PLAN and stages each
// as `bin/<name>`. Before it each script spelled its own list, and a sidecar could join one without the other: TH-1's
// transcript-host.cjs joined the builder's with neither a stage row nor a notices row (found before it landed).
//
// `notices` declares where a file's third-party notices come from, and scripts/notices-rows.mjs holds each to it:
//   { bundle: true }     an esbuild bundle with its own NODE_BUNDLES row (scripts/third-party-notices.mjs), whose
//                        module comments name every package inside it;
//   { npm: "<name>" }    a file a package ships, attributed with that package; the stage's ledger must hold it;
//   { engine: "mille" }  mille's native engine, attributed by milleEngine (its crates, or its released package).
//
// Builtins only, and no TypeScript: the SEA builder imports nothing else (its header).

/** The executable's name in the stage (`bin/<FIELDD_EXE>`, §7.4's stable name). */
export const FIELDD_EXE = process.platform === "win32" ? "fieldd.exe" : "fieldd";

/** mille's napi triple (fieldd workspace/launch.ts `milleTriple`; mille's own loader names its per-platform binaries
 * the same way). */
export function milleTriple() {
  if (process.platform === "darwin") return `darwin-${process.arch}`;
  if (process.platform === "win32") return `win32-${process.arch}-msvc`;
  const musl = !process.report?.getReport()?.header?.glibcVersionRuntime;
  return `linux-${process.arch}-${musl ? "musl" : "gnu"}`;
}

/** mille's native engine, named by mille's own triple. */
export const MILLE_NATIVE = `mille.${milleTriple()}.node`;

/** puppeteer's spawn-through shim, sealed beside the executable (AR-7j). */
export const AGENT_SHIM_BUNDLE = "agent-shim.cjs";

/** One sidecar. Its stage row follows from its name: fieldd's build writes it to `packages/fieldd/dist/<name>`, and
 * the stage copies it to `bin/<name>`. */
function sidecar({ name, why, notices, produce }) {
  return {
    name,
    why,
    notices,
    stage: `bin/${name}`,
    from: `packages/fieldd/dist/${name}`,
    kind: "file",
    ...(produce ? { produce } : {}),
  };
}

export const SIDECARS = [
  // Outside the ASAR because `new Worker(path)` needs a real file on disk (§7.4, P-A).
  sidecar({
    name: "service-harness.mjs",
    why: "PluginHost worker entry — `new Worker(path)` needs a real path on disk",
    notices: { bundle: true },
  }),
  // 3.1 MB, and loro resolves it via __dirname — unembeddable, hence a resource (§7.4, P-A). loro-crdt's own file,
  // so its notices are loro-crdt's, which fieldd's bundle (bin.cjs) carries into the ledger.
  sidecar({
    name: "loro_wasm_bg.wasm",
    why: "loro-crdt reads it with readFileSync(join(__dirname, …)); bundling the JS carries none of it",
    notices: { npm: "loro-crdt" },
  }),
  // FS-1a (L1) — the files worker. The executable re-runs ITSELF with `--vibefield-role=files-host` and that role
  // loads this bundle from beside it (bin.ts), so it must be a real file next to the executable, like the harness.
  sidecar({
    name: "files-host.cjs",
    why: "the files worker's bundle — the executable's files-host role loads it from beside itself",
    notices: { bundle: true },
  }),
  // TH-1 (TH0-Q5 (b)) — the transcript worker, mille-free. The executable re-runs ITSELF with
  // `--vibefield-role=transcript-host` and that role loads this bundle from beside it (bin.ts, transcripts/launch.ts),
  // as the files worker's role loads its own.
  sidecar({
    name: "transcript-host.cjs",
    why: "the transcript worker's bundle — the executable's transcript-host role loads it from beside itself",
    notices: { bundle: true },
  }),
  // CP-4a2a (4A2-Q1 (a)) — a run's flow host, one child per run. The executable re-runs ITSELF with
  // `--vibefield-role=flows-host` and that role loads this bundle from beside it (bin.ts, flows/launch.ts), as the
  // transcript worker's role loads its own; the bundle starts the run's script in a worker from its own file (4A2-Q7
  // (b)). It carries ses and the host's own files, nothing else of VibeField's (wall R32's host clause).
  sidecar({
    name: "flows-host.cjs",
    why: "a run's flow host's bundle — the executable's flows-host role loads it from beside itself",
    notices: { bundle: true },
  }),
  // FS-1a: mille's native engine. `process.dlopen` needs a real path, and fieldd hands the worker this one explicitly
  // (workspace/launch.ts); never embeddable. fieldd's build stages it from the installed per-platform package.
  sidecar({
    name: MILLE_NATIVE,
    why: "mille's native file engine — the files worker dlopens it by the explicit path fieldd hands it",
    notices: { engine: "mille" },
    produce: "pnpm --filter @vibefield/fieldd build",
  }),
  // AR-7j (LP-D1) — puppeteer's spawn-through shim, SEALED beside the executable. Every launcher in a packaged build
  // execs the executable in its agent-shim role, and the role runs THIS copy (bin.ts) — never the one in the user's
  // shim home, so rewriting that copy steers nothing. The shim home's launchers and rendezvous stay writable by the
  // same uid, as under `pnpm dev`: the role does not close that (roles.ts `agentShimArgv`). fieldd's build bundles it
  // from the pinned kit (package.json's third step); the gateway finds it here too (agent-gateway.ts `bundledShim`,
  // `sealedAgentShim`).
  //
  // The stage's own note (AR-7), moved here with its row: the spawn-through shim the agent gateway writes its
  // launchers over. Staged, it is found — and a packaged gateway still offers no launcher until a launcher runtime
  // exists for a single executable (AR-7j): the shim is the file a launcher runs, not the Node that runs it.
  // *(Corrected 2026-11-05, AR-7j, M128 `45c3680a3`: the runtime exists. A packaged gateway offers fieldd's own
  // executable in its closed `--vibefield-role=agent-shim` role, and that role runs only this staged, sealed copy,
  // never the home's.)*
  sidecar({
    name: AGENT_SHIM_BUNDLE,
    why: "puppeteer's spawn-through shim — the executable's agent-shim role runs this sealed copy, never the shim home's",
    notices: { bundle: true },
  }),
  // RV #1 (item 203; rv-forwarder-role at its lean A) — puppeteer's builtin forwarder entry, SEALED beside the
  // executable. A managed agent's command hooks and status lines run the executable in its agent-forwarder role
  // (fieldd agent-forwarder.ts lends it to puppeteer), and the role runs THIS file and nothing else (bin.ts). fieldd's
  // build bundles it from the pinned kit (package.json's step after the shim's). Without it, fieldd lends nothing and
  // puppeteer refuses a managed Claude launch rather than start it unobserved.
  sidecar({
    name: "agent-forwarder.cjs",
    why: "puppeteer's builtin forwarder — the executable's agent-forwarder role runs this sealed copy for an agent's hooks and status lines",
    notices: { bundle: true },
  }),
];
