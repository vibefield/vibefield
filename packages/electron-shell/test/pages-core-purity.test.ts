// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// EY-1 (2026-11-19): `pages/core` holds the bridge's pure cores. They take no Electron, no file
// system, no network and no child process: each is unit-tested alone, and the endpoint, the owner
// and the broker hand them what they need. Nor does a core name the engine's executable: only the
// broker beside it does (wall R33's namers).

const CORE = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main", "pages", "core");
const ALLOWED = new Set([
  "node:crypto",
  "@vibefield/contracts",
  "@vibefield/contracts/pages-record",
]);
/** a sibling file of the core, never a reach out of it */
const OWN_FILE = /^\.\/[a-z][a-z0-9-]*$/u;
const IMPORTS = [
  /\bfrom\s*["']([^"']+)["']/gu,
  /\bimport\s*["']([^"']+)["']/gu,
  /\bimport\s*\(\s*["']([^"']+)["']/gu,
  /\brequire\s*\(\s*["']([^"']+)["']/gu,
];
/** R33's line pattern: the engine's executable, by its package path or its staged name */
const ENGINE_PATH =
  /\bagent-browser-(?:darwin|linux|linux-musl|win32)-(?:arm64|x64)(?:\.exe)?\b|node_modules\/agent-browser\b|\bbin\/agent-browser\b/u;

function specifiers(text: string): string[] {
  return IMPORTS.flatMap((re) => [...text.matchAll(re)].map((m) => m[1] ?? ""));
}

const files = readdirSync(CORE).filter((name) => name.endsWith(".ts"));

describe("pages/core is pure (EY-1)", () => {
  it("holds the shared shapes", () => {
    expect(files).toContain("types.ts");
  });

  it("reads every form of import (the control)", () => {
    expect(
      specifiers(
        'import type { A } from "node:fs";\nimport "./x";\nconst m = await import("node:net");\nrequire("electron");',
      ).sort(),
    ).toEqual(["./x", "electron", "node:fs", "node:net"]);
  });

  it("imports only node:crypto, @vibefield/contracts, its ./pages-record entry and its own files", () => {
    for (const name of files) {
      for (const spec of specifiers(readFileSync(join(CORE, name), "utf8"))) {
        expect(ALLOWED.has(spec) || OWN_FILE.test(spec), `${name} imports ${spec}`).toBe(true);
      }
    }
  });

  it("names no engine path", () => {
    // EY-1 1a (2026-11-24): the control is built from parts, as wall R33 reads text and this test names
    // no engine path. ENGINE_PATH, the pattern under test, is unchanged.
    expect(`staged at ${["bin", "agent-browser"].join("/")}`).toMatch(ENGINE_PATH);
    for (const name of files) {
      expect(readFileSync(join(CORE, name), "utf8"), name).not.toMatch(ENGINE_PATH);
    }
  });
});
