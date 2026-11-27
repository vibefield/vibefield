import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Item 658 (2026-11-26): the pages engine runs only through main's broker. The browser benchmark's agent provider
// started whatever binary its caller named, once per command, with main's whole environment: a door by which an
// unpackaged main started an unchecked agent-browser, under none of the engine's lock-down. It is gone, and these
// rows keep it gone. A source read, as the walls read: literal names, never a census of what main spawns.

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const TESTING = join(REPO, "packages/electron-shell/src/testing");
const BENCHMARK = join(REPO, "scripts/benchmark-browser-pane.mjs");
const SUMMARY = join(REPO, "scripts/summarize-browser-pane.mjs");

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

// The keys of the one `parseArgs({ options: { … } })` the benchmark makes: each option is a line of four spaces, the
// key (bare or quoted) and `: {`, so a comment that says the word decides nothing.
function benchmarkOptions(source: string): string[] {
  const open = "parseArgs({\n  options: {\n";
  const start = source.indexOf(open);
  if (start < 0 || source.indexOf(open, start + 1) >= 0) return [];
  const end = source.indexOf("\n  },\n});", start);
  if (end < 0) return [];
  const block = source.slice(start + open.length, end);
  return [...block.matchAll(/^ {4}(?:"([a-z][a-z-]*)"|([a-z][a-zA-Z]*)): \{/gm)].map(
    (m) => m[1] ?? m[2] ?? "",
  );
}

const PROVIDER_NAMES = [
  "VF_BROWSER_PERF_AGENT_BIN",
  "VF_BROWSER_PERF_NODE_BIN",
  "checkBrowserPerfAgent",
  "agent-browser.plugin.v1",
];

describe("the browser benchmark drives no agent-browser (item 658, 2026-11-26)", () => {
  const testing = filesUnder(TESTING);
  const read = [...testing, BENCHMARK, SUMMARY].filter((path) => existsSync(path));

  it("reads the shell's whole testing folder and both benchmark scripts", () => {
    // Not vacuous: the folder is the smoke and benchmark harness (about eighty files on 2026-11-26), and the two
    // scripts are the benchmark's runner and its reader.
    expect(testing.length).toBeGreaterThan(20);
    expect(testing.some((path) => path.endsWith("browser-perf.ts"))).toBe(true);
    expect(testing.some((path) => path.endsWith("browser-perf-multi.ts"))).toBe(true);
    expect(existsSync(BENCHMARK)).toBe(true);
    expect(existsSync(SUMMARY)).toBe(true);
    expect(read).toHaveLength(testing.length + 2);
  });

  it("the agent provider's file is not in the testing folder", () => {
    const provider = testing
      .filter((path) => path.endsWith("browser-perf-agent.ts"))
      .map((path) => relative(REPO, path));
    expect(provider).toEqual([]);
  });

  it("no file names the provider's binary or node variables, its entry or its plugin protocol", () => {
    const named = read.flatMap((path) => {
      const text = readFileSync(path, "utf8");
      return PROVIDER_NAMES.filter((name) => text.includes(name)).map(
        (name) => `${relative(REPO, path)}: ${name}`,
      );
    });
    expect(named).toEqual([]);
  });

  it("the benchmark's argument parser takes no agent option, so --agent fails it", () => {
    const options = benchmarkOptions(readFileSync(BENCHMARK, "utf8"));
    // The parser was found and read whole: its first and its usual options are there.
    expect(options).toEqual(expect.arrayContaining(["mode", "label", "out", "panes", "ui"]));
    expect(options).not.toContain("agent");
  });
});
