import { build } from "esbuild";

/**
 * Resolve the local module closure of a plugin service entry — the files the
 * service worker harness will actually load (it imports the entry directly
 * and Node resolves relative imports live from the plugin directory, so a
 * multi-file service is legal at runtime). Bare specifiers stay external
 * (wall R10: services import only SDK packages), which keeps the graph
 * plugin-local and the resolution instant.
 *
 * Returns sorted repo-relative POSIX paths, or null when the entry cannot be
 * resolved — the caller falls back to watching the entry file alone.
 */
export async function resolveServiceModules(repoRoot, entryAbsolute) {
  try {
    const result = await build({
      absWorkingDir: repoRoot,
      entryPoints: [entryAbsolute],
      bundle: true,
      write: false,
      metafile: true,
      platform: "node",
      format: "esm",
      logLevel: "silent",
      plugins: [
        {
          name: "vibefield-externalize-bare-imports",
          setup(pluginBuild) {
            // The filter says "starts with neither `.` nor `/`" — a correct
            // test for a bare specifier only on POSIX. A Windows absolute path
            // opens with a drive letter, so on win32 this matched the ENTRY
            // POINT and marked it external; esbuild refuses that outright
            // ("the entry point cannot be marked as external"), the catch below
            // swallowed the throw, and every service resolved to null. The dev
            // loop then fell back to watching the entry file alone, so editing
            // any sibling module of a plugin service triggered no rebuild —
            // silently, on Windows only. Entry points are never bare.
            pluginBuild.onResolve({ filter: /^[^./]/ }, (args) =>
              args.kind === "entry-point" ? null : { path: args.path, external: true },
            );
          },
        },
      ],
    });
    return Object.keys(result.metafile.inputs)
      .map((path) => path.split("\\").join("/"))
      .sort();
  } catch {
    return null;
  }
}
