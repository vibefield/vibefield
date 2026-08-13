// The template, and the pass that turns it into a plugin.
//
// `template/` holds REAL FILES — the scaffold is a directory copy with a
// substitution, never code assembled from strings in TypeScript. What you read
// in `template/src/renderer.tsx` is what lands, modulo the `{{token}}`s, so the
// template can be diffed against `plugins/note` (the shape it was derived from)
// instead of reconstructed from a generator.
//
// ESCAPING, which is the one subtle thing here. `{{id}}`, `{{widgetType}}`,
// `{{packageName}}` and `{{className}}` are grammar-restricted or derived, so
// they are safe by construction. `{{title}}` is arbitrary author text and every
// place it appears is inside a double-quoted string in TS, JSON or a JSX
// attribute — so it is escaped for exactly that context. Without this a title
// carrying a quote produces a template that will not parse, and a title chosen
// adversarially writes code. The escape is applied to every value uniformly:
// escaping a value that needed no escaping changes nothing.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plan } from "./plan";

/** The template root — `tooling/create-plugin/template`. */
export const TEMPLATE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "template");

const TOKEN = /\{\{([a-zA-Z]+)\}\}/g;

export interface TemplateFile {
  /** path relative to the plugin root, POSIX-separated */
  readonly path: string;
  readonly contents: string;
}

/** Every file under `template/`, in a stable order (a scaffold that writes its
 * files in readdir order is a scaffold whose failures depend on the filesystem). */
export function templateFiles(root: string = TEMPLATE_ROOT): TemplateFile[] {
  const out: TemplateFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!statSync(absolute).isFile()) continue;
      out.push({
        path: relative(root, absolute).split(sep).join("/"),
        contents: readFileSync(absolute, "utf8"),
      });
    }
  };
  walk(root);
  return out;
}

/**
 * Substitute one file's `{{token}}`s.
 *
 * An unknown token THROWS rather than surviving into the output: a `{{titel}}`
 * that scaffolded silently would ship a plugin with a literal `{{titel}}` in its
 * manifest, and the author would meet it as a mystery three commands later.
 * This is the template's own bug — exit 2, not a refusal.
 */
export function substitute(contents: string, plan: Plan): string {
  return contents.replaceAll(TOKEN, (_match, token: string) => {
    const value = (plan as unknown as Record<string, unknown>)[token];
    if (typeof value !== "string")
      throw new Error(
        `template token {{${token}}} is not a field of the scaffold plan (have: ${Object.keys(plan).join(", ")})`,
      );
    return escapeForDoubleQuoted(value);
  });
}

/** The double-quoted-string escape shared by TS, JSON and JSX attributes.
 * `JSON.stringify` is the authority for it; the outer quotes are the template's
 * own, so they come off. */
export function escapeForDoubleQuoted(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/** The template's tokens, for the test that proves the vocabulary in
 * `template/` and the fields on `Plan` are the same set. */
export function tokensIn(contents: string): Set<string> {
  const found = new Set<string>();
  for (const match of contents.matchAll(TOKEN)) if (match[1] !== undefined) found.add(match[1]);
  return found;
}
