// @vitest-environment node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// THE DOM DOOR (item 570, 2026-11-19). A plugin that draws its own DOM (an object's dialog through `ObjectDomHost`)
// draws DESIGN.md §13's glyphs and wears the kit's control classes without React. `/ui` carries the kit's React
// primitives as .tsx source, so a plugin whose tsconfig sets no `jsx` cannot type-check through it (TS6142, measured on
// the browser pane). `/ui-dom` is the door it can use: it reaches no .tsx. This row type-checks a probe of each door
// under the create-plugin template's own compiler options, what a new plugin compiles with, and holds the DOM door
// clean and the React door refused, so the row is seen to catch the fault.

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_TSCONFIG = join(PACKAGE_ROOT, "../../tooling/create-plugin/template/tsconfig.json");
const PROBE_DIR = join(PACKAGE_ROOT, "test", "__ui-dom-probe__");

/** The template's compiler options as an author gets them, less its ambient `types` (the WebGPU and Node globals a
 * kind's pass names, which this package does not install and neither door needs). */
const templateOptions = (): ts.CompilerOptions => {
  const read = ts.readConfigFile(TEMPLATE_TSCONFIG, ts.sys.readFile);
  if (read.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, " "));
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(TEMPLATE_TSCONFIG));
  return { ...parsed.options, types: [], noEmit: true };
};

/** One probe's diagnostics. The probe is held in memory only, never on disk, so no tsc of this package reads it. */
const diagnose = (name: string, text: string): string[] => {
  const file = join(PROBE_DIR, name);
  const options = templateOptions();
  const host = ts.createCompilerHost(options);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (path) => path === file || fileExists(path);
  host.readFile = (path) => (path === file ? text : readFile(path));
  host.getSourceFile = (path, language, ...rest) =>
    path === file
      ? ts.createSourceFile(path, text, language)
      : getSourceFile(path, language, ...rest);
  return ts
    .getPreEmitDiagnostics(ts.createProgram([file], options, host))
    .map((d) => `TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
};

const probe = (door: string): string =>
  [
    "import {",
    "  GLYPH_NAMES,",
    "  glyphSvg,",
    "  uiButtonClass,",
    "  uiFieldClass,",
    "  uiIconButtonClass,",
    "  uiLabelClass,",
    `} from "${door}";`,
    "export const probe = [",
    '  glyphSvg("close", { size: 14 }),',
    '  glyphSvg("chevron", { turn: 90 }),',
    "  GLYPH_NAMES.length,",
    "  uiButtonClass,",
    "  uiFieldClass,",
    "  uiIconButtonClass,",
    "  uiLabelClass,",
    "];",
    "",
  ].join("\n");

describe("the SDK's DOM door, under the create-plugin template's options (item 570)", () => {
  it("type-checks with no jsx: §13's glyphs and the kit's four control classes, through /ui-dom", () => {
    expect(diagnose("dom.ts", probe("@vibefield/plugin-sdk/ui-dom"))).toEqual([]);
  });

  it("refuses the same probe through /ui (TS6142, a .tsx reached with no jsx), so the row above can see it", () => {
    const seen = diagnose("react.ts", probe("@vibefield/plugin-sdk/ui"));
    expect(seen.filter((line) => line.startsWith("TS6142 "))).not.toEqual([]);
  });
});
