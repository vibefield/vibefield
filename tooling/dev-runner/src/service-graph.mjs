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
            pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => ({
              path: args.path,
              external: true,
            }));
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
