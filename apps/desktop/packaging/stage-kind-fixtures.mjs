#!/usr/bin/env node
// `node packaging/stage-kind-fixtures.mjs <restart|faults> -- <command…>` — DK-9's plugin fixtures, staged for
// ONE run and removed after it (the plan's §8.6; DK-7's note: a fault plugin is staged through
// `FIELDD_PLUGIN_DEV_ROOTS` for one run, NEVER under `examples/plugins`, which every dev session stages).
//
// It builds a temporary dev root holding COPIES of the repo's dev plugins (the conformance carrier, the kv
// service — a copy, never a symlink: fieldd proves containment by real path) and a desk clock of the mode's
// own, then runs the command with `FIELDD_PLUGIN_DEV_ROOTS` pointing at that root alone (the env wins over
// the shell's own dev roots, `main/fieldd.ts`) and `VF_KIND_FIXTURES` telling the smoke where things are:
//   restart — the clock as built (v1); a plugin new to the renderers for the ENABLE row (the clock's kind
//     under a type of its own, a minute dial); and beside the root a v2 the smoke swaps in for its UPDATE row: the
//     clock's row at `schemaVersion` 2 with one prop more (`stamp`) and a `migrate` chain (1 → 2) that marks
//     what it ran (`stamp: "migrated-from-v1"`, the dial turned `station`); the smoke's REGRESSION row
//     writes a `schemaVersion` 1 manifest back over it, which fieldd refuses (§18.5).
//   faults — the clock declaring DK-7's fault fixture beside its own row (`BROKEN_CLOCK_ROWS`), its renderer
//     exporting `clockBroken` and `clockFaulty` beside `clock` — the clock's own id, as the types are its
//     own; `VF_SMOKE_KIND_FAULTS=1` runs smoke:canvas's fault rows. PT-5a: and the clock that breaks IN HAND
//     (`FRAGILE_CLOCK_ROW`, `clockFragile`) — the PUT-DOWN row's.
// Each variant's renderer is built by plugin-build itself (the bundle a dev would ship). The command's exit
// code is this script's; the temporary root goes either way.

import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const [mode, separator, ...command] = process.argv.slice(2);
if ((mode !== "restart" && mode !== "faults") || separator !== "--" || command.length === 0) {
  process.stderr.write("usage: stage-kind-fixtures.mjs <restart|faults> -- <command…>\n");
  process.exit(2);
}

// The workspace's sources run as plugin-build runs them (bin/plugin-build.mjs): Node strips the types, an
// extensionless relative import is retried as `.ts`, and a `.wgsl` import is its text (plugin-build's own
// `wgsl()` rule, byte for byte).
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !specifier.endsWith(".ts") &&
        context.parentURL !== undefined &&
        !context.parentURL.includes("/node_modules/")
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".wgsl")) {
      const text = readFileSync(fileURLToPath(url), "utf8");
      return {
        format: "module",
        source: `export default ${JSON.stringify(text)};\n`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const clockDir = join(repo, "examples/plugins/desk-clock");
const clockSrc = join(clockDir, "src");
const { BROKEN_CLOCK_ROWS, FRAGILE_CLOCK_ROW, deskClockManifest } = await import(
  pathToFileURL(join(clockSrc, "index.ts")).href
);
const { buildPlugin } = await import(
  pathToFileURL(join(repo, "tooling/plugin-build/src/build.ts")).href
);

const root = mkdtempSync(join(tmpdir(), "vf-kind-fixtures-"));
const roots = join(root, "roots");
mkdirSync(roots, { recursive: true });

/** A dev plugin copied into the root as its built artifact stands — never its node_modules. */
function copyPlugin(name) {
  const from = join(repo, "examples/plugins", name);
  cpSync(from, join(roots, name), {
    recursive: true,
    filter: (path) => !path.includes(`${from}/node_modules`) && !path.endsWith("/node_modules"),
  });
}

/** A variant of the clock: its manifest, a renderer module re-exporting what it names, built by plugin-build. */
async function clockVariant(dir, manifest, rendererSource) {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "vibefield.plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "vf-kind-fixture", private: true, type: "module" }, null, 2)}\n`,
  );
  writeFileSync(join(dir, "src", "renderer.ts"), rendererSource);
  const report = await buildPlugin({ root: dir });
  process.stdout.write(
    `KIND_FIXTURE_BUILT ${JSON.stringify({ dir, stages: report.stages.map((s) => s.stage) })}\n`,
  );
}

const clockRow = deskClockManifest.contributes.objects[0];
const at = (path) => JSON.stringify(join(clockSrc, path));
const fixtures = { mode, root: roots };

copyPlugin("behavior-conformance");
copyPlugin("kv-service");
if (mode === "restart") {
  copyPlugin("desk-clock");
  rmSync(join(roots, "desk-clock", "test"), { recursive: true, force: true });
  const v2 = join(root, "variants", "desk-clock-v2");
  await clockVariant(
    v2,
    {
      ...deskClockManifest,
      version: "0.2.0",
      contributes: {
        ...deskClockManifest.contributes,
        objects: [
          {
            ...clockRow,
            schemaVersion: 2,
            props: { ...clockRow.props, stamp: { kind: "string", default: "v2-default" } },
          },
        ],
      },
    },
    [
      "// DK-9's UPDATE fixture (packaging/stage-kind-fixtures.mjs): the desk clock at schemaVersion 2 — its",
      "// binding's migrate chain (1 → 2) marks what it ran on each clock it carries forward.",
      `import base, { clock as v1 } from ${at("renderer.ts")};`,
      "export const clock = {",
      "  ...v1,",
      "  migrate: {",
      '    1: (prev: Record<string, unknown>) => ({ ...prev, style: "station", stamp: "migrated-from-v1" }),',
      "  },",
      "};",
      "export default base;",
      "",
    ].join("\n"),
  );
  // a plugin NEW to the renderers for the ENABLE row: the clock's own kind under a type of its own, a MINUTE
  // dial (a seconds hand would wake every resting desk once a second) and no tray entry — a well-behaved kind,
  // unlike the conformance carrier, whose card's behaviors tick every frame by design
  const dialType = "vibefield.kind-fixture.dial";
  const { tray: _tray, description: _description, ...dialRow } = clockRow;
  await clockVariant(
    join(roots, "kind-fixture"),
    {
      ...deskClockManifest,
      id: "vibefield.kind-fixture",
      title: "Kind fixture",
      description:
        "DK-9's ENABLE fixture — the desk clock's kind under a type of its own; staged for one run",
      version: "0.1.0",
      activation: [`onObject:${dialType}`],
      contributes: {
        ...deskClockManifest.contributes,
        objects: [
          {
            ...dialRow,
            type: dialType,
            title: "Dial",
            props: { ...clockRow.props, seconds: { kind: "boolean", default: false } },
            provides: [dialType, "desk.object", "desk.containable"],
            binding: { kind: "dial" },
          },
        ],
      },
    },
    [
      "// DK-9's ENABLE fixture (packaging/stage-kind-fixtures.mjs): the desk clock's kind under a type of its",
      "// own — a plugin these renderers never staged, enabled mid-session.",
      `import base from ${at("renderer.ts")};`,
      `import { clockKind } from ${at("kind.ts")};`,
      `export const dial = { kind: { ...clockKind(), name: ${JSON.stringify(dialType)} } };`,
      "export default base;",
      "",
    ].join("\n"),
  );
  Object.assign(fixtures, {
    clock: deskClockManifest.id,
    clockRoot: join(roots, "desk-clock"),
    clockV2: v2,
    fresh: "vibefield.kind-fixture",
    freshType: dialType,
  });
} else {
  await clockVariant(
    join(roots, "desk-clock"),
    {
      ...deskClockManifest,
      contributes: {
        ...deskClockManifest.contributes,
        objects: [
          ...deskClockManifest.contributes.objects,
          ...BROKEN_CLOCK_ROWS,
          FRAGILE_CLOCK_ROW,
        ],
      },
    },
    [
      "// DK-9's FAULT fixture (packaging/stage-kind-fixtures.mjs): the desk clock with DK-7's broken kinds",
      "// beside it — staged for ONE smoke through FIELDD_PLUGIN_DEV_ROOTS, never under examples/plugins.",
      `export { clock, default } from ${at("renderer.ts")};`,
      `export { clockBroken, clockFaulty, clockFragile } from ${at("broken.ts")};`,
      "",
    ].join("\n"),
  );
  Object.assign(fixtures, {
    clock: deskClockManifest.id,
    broken: BROKEN_CLOCK_ROWS.map((row) => row.type),
    fragile: FRAGILE_CLOCK_ROW.type,
  });
}

process.stdout.write(`KIND_FIXTURES ${JSON.stringify(fixtures)}\n`);
const child = spawn(command[0], command.slice(1), {
  stdio: "inherit",
  env: {
    ...process.env,
    FIELDD_PLUGIN_DEV_ROOTS: roots,
    VF_KIND_FIXTURES: JSON.stringify(fixtures),
    ...(mode === "faults" ? { VF_SMOKE_KIND_FAULTS: "1" } : {}),
  },
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
child.once("exit", (code, signal) => {
  rmSync(root, { recursive: true, force: true });
  process.stdout.write(`KIND_FIXTURES_REMOVED ${JSON.stringify({ root })}\n`);
  process.exit(code ?? (signal === null ? 1 : 2));
});
