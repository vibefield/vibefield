import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { linkedPackages } from "../../../scripts/siblings.mjs";
import { workspacePaths } from "../src/paths.mjs";
import { rendererDevelopmentDefines, withoutProcessExits } from "../src/vite-server.mjs";

// Item 397 (2026-11-18). Under `pnpm dev` the swarm's physics worker is a module graph Vite
// serves raw from the views' dist (`swarm-physics.worker.js` → `host.js` → `world.js`), and
// Vite never discovers a bare import whose importer is inside node_modules: it answers with the
// raw file, so only an `optimizeDeps.include` entry pre-bundles such an import. `world.js`
// imports matter-js, whose package names a UMD build as `main` (no `module`, no `exports`), so
// it has no ES form and the worker's graph cannot link: the view demotes ("the physics run in
// this thread: unknown worker error") and the simulation runs on the renderer's main thread.
// The packaged renderer's production build bundles matter into the worker, so only dev is read
// here.
const linkedViews = linkedPackages(workspacePaths.repoRoot).has("@vibefield/puppeteer-views");

test("the dev server hands the swarm's physics worker matter's optimized ES module", {
  skip: linkedViews && "the views are linked: their worker graph is source, outside node_modules",
  timeout: 300_000,
}, async () => {
  const views = await realpath(
    join(workspacePaths.repoRoot, "packages/field-app/node_modules/@vibefield/puppeteer-views"),
  );
  const world = join(views, "dist/views/swarm/physics/world.js");
  // The worker graph's one import of matter. If the views move it, this row moves with them.
  assert.match(await readFile(world, "utf8"), /^import Matter from 'matter-js';$/m);

  // The real renderer config, as the dev runner starts it, with its own optimizer cache. No
  // listener, no socket and no watcher: the optimizer and the resolver are all this row reads.
  const cacheDir = await realpath(await mkdtemp(join(tmpdir(), "vf-vite-397-")));
  let server;
  try {
    server = await withoutProcessExits(() =>
      createServer({
        configFile: workspacePaths.viteConfig,
        mode: "development",
        clearScreen: false,
        logLevel: "silent",
        define: rendererDevelopmentDefines(),
        cacheDir,
        server: { middlewareMode: true, ws: false, watch: null },
      }),
    );
    const client = server.environments.client;
    // The optimizer's first run is written before anything is read or closed. A server closed
    // mid-run cancels the run, but its bundle goes on writing into the cache dir after the dir
    // is removed (item 397, 2026-11-18: the row's first form left 84 files). The scan adds its
    // dependencies first; each discovered one holds the promise of the run that commits it.
    await client.depsOptimizer.scanProcessing;
    await Promise.all(
      Object.values(client.depsOptimizer.metadata.discovered).map((dep) => dep.processing),
    );
    const resolved = await client.pluginContainer.resolveId("matter-js", world);
    assert.ok(resolved, "matter-js resolves from the worker's graph");
    assert.ok(
      resolved.id.startsWith(`${cacheDir}/`),
      `matter-js from the worker's graph is the optimizer's module, not ${resolved.id}`,
    );
    assert.match(resolved.id, /matter-js\.js(\?|$)/);
    // And the optimizer wrote it: the module the worker is answered with is on disk.
    assert.ok(existsSync(resolved.id.replace(/\?.*$/, "")), `${resolved.id} is on disk`);
  } finally {
    await server?.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});
