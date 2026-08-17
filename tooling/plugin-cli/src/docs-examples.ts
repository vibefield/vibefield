// The worked examples the reference embeds. Two rules keep them trustworthy:
//
//  1. PREFER THE GOLDEN FIXTURES. `@vibefield/contracts/fixtures` are the
//     manifests the contract's own tests parse (§24.1), so an example lifted
//     from one is an example the schema is already pinned against.
//  2. VALIDATE EVERY EXAMPLE AT GENERATION TIME. Two contribution kinds
//     (commands, surfaces) have no fixture of their own, so they are authored
//     here — and then run through `validatePluginManifest` like the rest. A
//     doc example that does not validate fails generation rather than shipping.
//
// An agent copying any block in these docs gets something the host accepts.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";

export interface ExampleManifest {
  /** where the reader can look it up */
  readonly source: string;
  readonly manifest: Record<string, unknown>;
}

/**
 * The contracts package's directory, found through the DEPENDENCY — never by
 * guessing at the repo's layout from here.
 *
 * Two ways, because two runtimes load this file: plain Node (the bin) offers
 * `import.meta.resolve`, and vitest's SSR transform does not. The fallback is
 * the dependency link itself, which is the same answer by a different road.
 */
export function contractsPackageDir(): string {
  const resolver = (import.meta as { resolve?: (specifier: string) => string }).resolve;
  if (typeof resolver === "function") {
    // <contracts>/src/index.ts → <contracts>
    return resolve(dirname(fileURLToPath(resolver("@vibefield/contracts"))), "..");
  }
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, "node_modules", "@vibefield", "contracts");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir)
      throw new Error("@vibefield/contracts is not resolvable from plugin-cli — run pnpm install");
    dir = parent;
  }
}

export function contractsFixturesDir(): string {
  return join(contractsPackageDir(), "fixtures");
}

function readFixture(name: string): Record<string, unknown> {
  const path = join(contractsFixturesDir(), name);
  if (!existsSync(path))
    throw new Error(`contracts fixture ${name} is missing (looked in ${contractsFixturesDir()})`);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** A minimal renderer-only plugin: one widget, one activation event, nothing
 * else. The §24.1 "minimal real plugin" fixture, verbatim. */
export function minimalExample(): ExampleManifest {
  return {
    source: "@vibefield/contracts fixtures/plugin-manifest.valid.json",
    manifest: readFixture("plugin-manifest.valid.json"),
  };
}

/** Renderer + service, and the kinds that ride with it: custom capabilities,
 * canvas behaviors, settings, dynamic services, MCP. */
export function serviceExample(): ExampleManifest {
  return {
    source: "@vibefield/contracts fixtures/plugin-manifest.service.json",
    manifest: readFixture("plugin-manifest.service.json"),
  };
}

/** Commands and surfaces have no golden fixture, so this one is authored here
 * and validated at generation time. Kept deliberately small: it exists to show
 * the two declaration shapes and their owned-id rule, not to be a tour. */
export function commandsAndSurfacesExample(): ExampleManifest {
  return {
    source: "authored for these docs, validated at generation time",
    manifest: {
      manifestVersion: 1,
      id: "com.example.tools",
      version: "0.1.0",
      title: "Example Tools",
      engines: { app: "^0.1.0", contracts: "^0.1.0" },
      entries: { renderer: "./dist/renderer.js" },
      activation: ["onCommand:com.example.tools.tidy", "onSurface:com.example.tools.panel"],
      capabilities: ["canvas.read", "canvas.write"],
      contributes: {
        commands: [
          {
            id: "com.example.tools.tidy",
            title: "Tidy the selection",
            description: "Align the selected widgets to a grid",
            placements: ["palette", "canvas-context"],
            args: {
              type: "object",
              additionalProperties: false,
              properties: { spacing: { type: "number", minimum: 1 } },
            },
          },
        ],
        surfaces: [
          {
            id: "com.example.tools.panel",
            title: "Tools",
            slot: "hud.side-panel",
            order: 10,
          },
        ],
      },
    },
  };
}

export interface ValidatedExamples {
  readonly minimal: ExampleManifest;
  readonly service: ExampleManifest;
  readonly commandsAndSurfaces: ExampleManifest;
}

/** Load every example and PROVE it — generation fails loudly if a doc example
 * would teach a manifest the host refuses. */
export function loadExamples(): ValidatedExamples {
  const examples: ValidatedExamples = {
    minimal: minimalExample(),
    service: serviceExample(),
    commandsAndSurfaces: commandsAndSurfacesExample(),
  };
  for (const [name, example] of Object.entries(examples)) {
    const result = validatePluginManifest(example.manifest);
    if (!result.ok)
      throw new Error(
        `docs example "${name}" (${example.source}) does not validate: ${result.issues.join(" · ")}`,
      );
  }
  return examples;
}

/** A JSON block for the docs — stable bytes, 2-space indent, no trailing
 * newline (the fence adds one). */
export function jsonBlock(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Pull one contribution kind out of an example manifest, for a section that
 * should show that kind and nothing else. */
export function contributionSlice(
  example: ExampleManifest,
  kind: string,
): { source: string; value: unknown } | undefined {
  const contributes = example.manifest["contributes"];
  if (typeof contributes !== "object" || contributes === null) return undefined;
  const value = (contributes as Record<string, unknown>)[kind];
  if (value === undefined) return undefined;
  return { source: example.source, value };
}
