// What lands on disk. The template's own files are not linted or typechecked by
// the repo — they carry `{{token}}`s and are not parseable until substitution —
// so THIS is where the template is proven: by scaffolding it and reading the
// result, which is the only artifact anyone downstream ever sees.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { describe, expect, it } from "vitest";
import { classNameFor, packageNameFor, planScaffold } from "../src/plan";
import { MANIFEST_NAME, MANIFEST_SOURCE, scaffoldPlugin } from "../src/scaffold";
import { escapeForDoubleQuoted, templateFiles, tokensIn } from "../src/template";
import { unusedPath, VALID } from "./fixtures";

/** Every file under a directory, as POSIX-relative paths. */
function tree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (statSync(absolute).isFile()) out.push(relative(root, absolute).split(sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

describe("the scaffolded tree", () => {
  it("is the template plus the emitted manifest, and nothing else", async () => {
    const dir = unusedPath();
    await scaffoldPlugin({ ...VALID, dir });

    const expected = [...templateFiles().map((f) => f.path), MANIFEST_NAME].sort();
    expect(tree(dir)).toEqual(expected);
  });

  it("carries the files an author is told to expect", async () => {
    const dir = unusedPath();
    await scaffoldPlugin({ ...VALID, dir });

    // The shape `docs/plugin-authoring/README.md` calls "the shortest real
    // plugin", plus the two the kit's other commands read.
    for (const path of [
      "package.json",
      "tsconfig.json",
      MANIFEST_SOURCE,
      "src/behavior.example.ts",
      "src/renderer.tsx",
      "src/index.ts",
      "scripts/emit-manifest.ts",
      "playground/states.ts",
      "test/manifest.test.ts",
      MANIFEST_NAME,
    ]) {
      expect(existsSync(join(dir, ...path.split("/"))), `${path} is missing`).toBe(true);
    }
  });

  it("leaves no unsubstituted token anywhere", async () => {
    const dir = unusedPath();
    await scaffoldPlugin({ ...VALID, dir });
    for (const path of tree(dir)) {
      const contents = readFileSync(join(dir, ...path.split("/")), "utf8");
      expect(tokensIn(contents), `${path} still carries a template token`).toEqual(new Set());
    }
  });

  it("names the package after the id, and the component after the title", async () => {
    const dir = unusedPath();
    const result = await scaffoldPlugin({ id: "vendor.demo", title: "Mind Map", dir });

    expect(result.plan?.packageName).toBe("@vendor/plugin-demo");
    expect(result.plan?.className).toBe("MindMap");

    const pkg: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect((pkg as { name: string }).name).toBe("@vendor/plugin-demo");
    const renderer = readFileSync(join(dir, "src", "renderer.tsx"), "utf8");
    expect(renderer).toContain("function MindMap(");
    expect(renderer).toContain("component: MindMap");
  });

  it("ships a substituted, React-free behavior authoring example", async () => {
    const dir = unusedPath();
    await scaffoldPlugin({ id: "vendor.demo", title: "Demo", dir });

    const example = readFileSync(join(dir, "src", "behavior.example.ts"), "utf8");
    expect(example).toContain('from "@vibefield/plugin-sdk/behavior"');
    expect(example).toContain('defineBehavior("vendor.demo:counter"');
    expect(example).toContain("declareBehavior(ExampleCounter)");
    expect(example).toContain("ctx.canvas.behaviors.bind");
    expect(example).not.toContain("react");
    expect(example).not.toContain("@vibecook/ice");
  });
});

describe("the manifest is emitted, not templated", () => {
  it("is the canonical emission of the src/manifest.ts beside it", async () => {
    const dir = unusedPath();
    await scaffoldPlugin({ ...VALID, dir });

    // Import the scaffolded source the same way `pnpm gen:manifest` will, and
    // prove the committed bytes are what it emits. This is `manifest-stale`'s
    // exact comparison, run against a scaffold that has never been built.
    const source = (await import(pathToFileURL(join(dir, ...MANIFEST_SOURCE.split("/"))).href)) as {
      manifest: unknown;
    };
    const validated = validatePluginManifest(source.manifest);
    if (!validated.ok) throw new Error(validated.issues.join(" · "));

    expect(readFileSync(join(dir, MANIFEST_NAME), "utf8")).toBe(canonicalJson(validated.manifest));
  });

  it("declares the id, title and widget type it was asked for", async () => {
    const dir = unusedPath();
    await scaffoldPlugin({
      id: "com.example.notes",
      title: "Example Notes",
      widgetType: "com.example.notes.card",
      dir,
    });

    const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_NAME), "utf8")) as {
      id: string;
      title: string;
      activation: string[];
      contributes: { widgets: Array<{ type: string; title: string }> };
    };
    expect(manifest.id).toBe("com.example.notes");
    expect(manifest.title).toBe("Example Notes");
    expect(manifest.activation).toEqual(["onWidget:com.example.notes.card"]);
    expect(manifest.contributes.widgets[0]?.type).toBe("com.example.notes.card");
  });
});

describe("substitution is escaped, not spliced", () => {
  // A title is arbitrary author text and lands inside double-quoted strings in
  // TypeScript and JSON. Unescaped, a title carrying a quote produces a file
  // that will not parse — and a title chosen adversarially produces one that
  // parses into something nobody wrote.
  const HOSTILE = 'A "quoted" \\ back\\slash ${tpl} and\na newline';

  it("survives a title full of string-literal metacharacters", async () => {
    const dir = unusedPath();
    const result = await scaffoldPlugin({ id: VALID.id, title: HOSTILE, dir });
    expect(result.verdicts.filter((v) => v.level === "refuse")).toEqual([]);

    // It imported (the scaffolder itself had to import it to emit), and the
    // title round-tripped through TS source and canonical JSON unchanged.
    const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_NAME), "utf8")) as {
      title: string;
    };
    expect(manifest.title).toBe(HOSTILE);
  });

  it("escapes for the double-quoted context and nothing more", () => {
    expect(escapeForDoubleQuoted('say "hi"')).toBe('say \\"hi\\"');
    expect(escapeForDoubleQuoted("back\\slash")).toBe("back\\\\slash");
    expect(escapeForDoubleQuoted("two\nlines")).toBe("two\\nlines");
    // A template literal's `${` is inert inside a double-quoted string, so it
    // is left alone rather than mangled — the template never puts a token in a
    // backtick string.
    expect(escapeForDoubleQuoted("${x}")).toBe("${x}");
  });

  it("derives an identifier that is always an identifier", () => {
    expect(classNameFor("Mind Map", "vendor.demo")).toBe("MindMap");
    expect(classNameFor("kanban-board", "vendor.demo")).toBe("KanbanBoard");
    expect(classNameFor("3D Viewer", "vendor.demo")).toBe("W3DViewer");
    // A title with nothing an identifier can be made of falls back to the id.
    expect(classNameFor("日本語", "vendor.mind-map")).toBe("MindMap");
    expect(classNameFor("…", "vendor.demo")).toBe("Demo");
    for (const title of ["Mind Map", "kanban-board", "3D Viewer", "日本語", "…"]) {
      expect(classNameFor(title, "vendor.demo")).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
    }
  });

  it("derives the package name from the id", () => {
    expect(packageNameFor("vendor.demo")).toBe("@vendor/plugin-demo");
    expect(packageNameFor("com.example.notes")).toBe("@com/plugin-example-notes");
    // The rule reproduces the canonical plugin's real package name.
    expect(packageNameFor("vibefield.note")).toBe("@vibefield/plugin-note");
  });
});

describe("the template and the plan share one vocabulary", () => {
  it("uses only tokens the plan can fill", () => {
    const planned = planScaffold(VALID);
    if (!planned.ok) throw new Error("the fixture plan must be valid");
    const fields = new Set(Object.keys(planned.plan));

    for (const file of templateFiles()) {
      for (const token of tokensIn(file.contents)) {
        expect(fields, `${file.path} uses {{${token}}}, which the plan has no field for`).toContain(
          token,
        );
      }
    }
  });

  it("refuses a token the plan cannot fill, rather than shipping it verbatim", async () => {
    // The control for the rule above: a template that reaches for something the
    // plan does not carry must fail the scaffold, not write `{{nope}}` into a
    // manifest an author meets three commands later.
    const templateRoot = unusedPath("template");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(templateRoot, { recursive: true });
    writeFileSync(join(templateRoot, "package.json"), '{ "name": "{{nope}}" }\n');

    await expect(scaffoldPlugin({ ...VALID, dir: unusedPath(), templateRoot })).rejects.toThrow(
      /\{\{nope\}\}/,
    );
  });
});

describe("the template tsconfig does not drift from the repo's base", () => {
  it("carries every compilerOption tsconfig.base.json sets", () => {
    const repoRoot = join(import.meta.dirname, "..", "..", "..");
    const base = readJsonc(join(repoRoot, "tsconfig.base.json")) as {
      compilerOptions: Record<string, unknown>;
    };
    const template = readJsonc(join(import.meta.dirname, "..", "template", "tsconfig.json")) as {
      compilerOptions: Record<string, unknown>;
    };

    for (const [option, value] of Object.entries(base.compilerOptions)) {
      // `lib` is deliberately widened for a DOM plugin; it must still contain
      // everything the base declares.
      if (option === "lib") {
        expect(template.compilerOptions["lib"]).toEqual(expect.arrayContaining(value as string[]));
        continue;
      }
      expect(template.compilerOptions[option], `template tsconfig drifted on ${option}`).toEqual(
        value,
      );
    }
  });
});

/** tsconfig files are JSONC; only whole-line `//` comments appear in these two. */
function readJsonc(path: string): unknown {
  const text = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  return JSON.parse(text);
}
