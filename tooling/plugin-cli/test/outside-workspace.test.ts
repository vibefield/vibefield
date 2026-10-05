// DK-10 — THE KIT ON A PLUGIN OUTSIDE ANY WORKSPACE, the way the ten-minute bar's agents held it: the create-plugin
// template scaffolded by its own bin into a temp directory, NOTHING installed (its `workspace:*` dependencies resolve to
// nothing there), built by plugin-build's bin — then THIS kit's bin, as a child process, because what makes it work is
// the bin's import map (`bin/vibefield-plugin.mjs`: a specifier the host binds resolves to the kit's own copy when the
// plugin's own resolution finds nothing). Before it, `check` could not import the built module at all: every object row
// was skipped behind the note `activation-not-loadable-here` ("needs a browser module graph") and `check` exited 0,
// and `inspect` said "its states unknown (no kind in the built module — run check)".
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const KIT = join(REPO, "tooling", "plugin-cli", "bin", "vibefield-plugin.mjs");
const run = promisify(execFile);

interface Row {
  readonly level: string;
  readonly check: string;
  readonly code: string;
  readonly detail: string;
}

async function kit(...args: string[]): Promise<{ code: number; rows: Row[]; out: string }> {
  try {
    const { stdout } = await run(process.execPath, [KIT, ...args, "--json"]);
    return { code: 0, rows: parse(stdout), out: stdout };
  } catch (error) {
    const e = error as { code?: number; stdout?: string };
    return { code: e.code ?? -1, rows: parse(e.stdout ?? ""), out: e.stdout ?? "" };
  }
}

function parse(stdout: string): Row[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith('{"level"'))
    .map((line) => JSON.parse(line) as Row);
}

let root: string;
let plugin: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "dk-10-outside-"));
  plugin = join(root, "card");
  await run(process.execPath, [
    join(REPO, "tooling", "create-plugin", "bin", "create-plugin.mjs"),
    "--id",
    "vendor.card",
    "--title",
    "Card",
    "--dir",
    plugin,
  ]);
  await run(process.execPath, [join(REPO, "tooling", "plugin-build", "bin", "plugin-build.mjs")], {
    cwd: plugin,
  });
}, 120_000);

afterAll(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

describe("the kit on a plugin outside any workspace, nothing installed (DK-10)", () => {
  it("is the case the bar measured: no node_modules anywhere above the scaffold", () => {
    expect(existsSync(join(plugin, "node_modules"))).toBe(false);
    expect(existsSync(join(plugin, "dist", "renderer.js"))).toBe(true);
  });

  it("check JUDGES its kind — the object rows run against the built module, the SDK bound to the kit's copy", async () => {
    const { code, rows } = await kit("check", plugin);
    expect(code).toBe(0);
    expect(rows.map((r) => r.code)).not.toContain("activation-not-loadable-here");
    const activation = rows.filter((r) => r.check === "activation");
    expect(
      activation.some(
        (r) => r.level === "pass" && r.detail.includes("is a desk kind named by its type"),
      ),
    ).toBe(true);
    expect(
      activation.some(
        (r) => r.level === "pass" && r.detail.includes("its WGSL arrived as text and reads"),
      ),
    ).toBe(true);
    expect(activation.some((r) => r.detail.includes("deactivation released every timer"))).toBe(
      true,
    );
  });

  it("check REFUSES a built module that imports a name the SDK's door does not export — the host would never link it", async () => {
    const built = join(plugin, "dist", "renderer.js");
    const original = readFileSync(built, "utf8");
    try {
      // the bundle keeps the door's names as one named import — add a name the door does not have
      writeFileSync(
        built,
        original.replace(
          ' } from "@vibefield/plugin-sdk/desk";',
          ', NOT_A_DOOR_NAME_DK10 } from "@vibefield/plugin-sdk/desk";',
        ),
      );
      expect(readFileSync(built, "utf8")).toContain("NOT_A_DOOR_NAME_DK10");
      const { code, rows } = await kit("check", plugin);
      expect(code).toBe(1);
      const refused = rows.find((r) => r.level === "refuse" && r.check === "activation");
      expect(refused?.code).toBe("import-name-unknown");
      expect(refused?.detail).toContain("NOT_A_DOOR_NAME_DK10");
    } finally {
      writeFileSync(built, original);
    }
  });

  it("inspect counts the states its kind will be driven through, read off the built module", async () => {
    const { stdout } = await run(process.execPath, [KIT, "inspect", plugin, "--json"]);
    const result = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as {
      totalStates?: number;
      contributions?: { objects?: { states?: number | null; refusal?: unknown }[] };
    };
    expect(result.totalStates).toBeGreaterThan(0);
    expect(result.contributions?.objects?.[0]?.states).toBe(result.totalStates);
    expect(result.contributions?.objects?.[0]?.refusal).toBeNull();
  });
});

describe("emit-manifest — the scaffold's gen:manifest, run by the kit with nothing installed (DK-10)", () => {
  // The bar's three agents each wrote an emitter of their own: `pnpm gen:manifest` (tsx + @vibefield/plugin-build)
  // cannot run outside a workspace, and pnpm 11 first tries an install that the template's `catalog:` refuses.
  it("writes vibefield.plugin.json from src/manifest.ts — an edit lands canonical, and check holds it", async () => {
    const source = join(plugin, "src", "manifest.ts");
    const json = join(plugin, "vibefield.plugin.json");
    const original = { source: readFileSync(source, "utf8"), json: readFileSync(json, "utf8") };
    try {
      writeFileSync(
        source,
        original.source.replace('title: "Card",', 'title: "Card, re-emitted",'),
      );
      const emitted = await kit("emit-manifest", plugin);
      expect(emitted.code).toBe(0);
      expect(emitted.rows.map((r) => r.level)).toEqual(["pass"]);
      expect(JSON.parse(readFileSync(json, "utf8")).title).toBe("Card, re-emitted");
      const checked = await kit("check", plugin);
      expect(checked.rows.some((r) => r.detail.includes("its own canonical emission"))).toBe(true);
    } finally {
      writeFileSync(source, original.source);
      writeFileSync(json, original.json);
    }
  });

  it("refuses a manifest that fails the contract, naming the issue, and writes nothing", async () => {
    const source = join(plugin, "src", "manifest.ts");
    const json = join(plugin, "vibefield.plugin.json");
    const original = { source: readFileSync(source, "utf8"), json: readFileSync(json, "utf8") };
    try {
      writeFileSync(source, original.source.replace("schemaVersion: 1,", "schemaVersion: 0,"));
      const emitted = await kit("emit-manifest", plugin);
      expect(emitted.code).toBe(1);
      expect(emitted.rows[0]?.code).toBe("manifest-invalid");
      expect(readFileSync(json, "utf8")).toBe(original.json);
    } finally {
      writeFileSync(source, original.source);
    }
  });

  it("refuses a directory with no src/manifest.ts", async () => {
    const empty = mkdtempSync(join(tmpdir(), "dk-10-no-manifest-"));
    try {
      const emitted = await kit("emit-manifest", empty);
      expect(emitted.code).toBe(1);
      expect(emitted.rows[0]?.code).toBe("manifest-source-missing");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
