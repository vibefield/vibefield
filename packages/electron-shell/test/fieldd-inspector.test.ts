import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, describe, expect, it, vi } from "vitest";

// Item 212 (RV #67) — the shell's liveness watch on its fieldd link ends a wedged fieldd the shell spawned. A fieldd
// under the inspector, paused at a breakpoint, is a loop that does not turn: the watch would read it as a wedge and
// end it, so `buildSupervisor` turns the watch off for one. `electron` and the supervisor are mocked, the house way
// (fieldd-native.test.ts): what is proven is the options the pair would be supervised with.

const stub = vi.hoisted(() => ({ created: [] as { liveness?: unknown }[] }));

vi.mock("electron", () => ({
  app: { getPath: () => tmpdir() },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
}));
vi.mock("@vibefield/fieldd-supervisor", () => ({
  createFielddSupervisor: (opts: { liveness?: unknown }) => {
    stub.created.push(opts);
    return {};
  },
}));

const { buildSupervisor, spawnsUnderInspector } = await import("../src/main/fieldd");
const { resolveDevelopmentResources } = await import("../src/main/resources");

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
  stub.created.length = 0;
});

/** A development tree with fieldd's bundle (buildSupervisor refuses a missing launch target). */
function devTree() {
  const repoRoot = mkdtempSync(join(tmpdir(), "vf-inspector-repo-"));
  cleanup.push(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(join(repoRoot, "packages", "fieldd", "dist"), { recursive: true });
  writeFileSync(join(repoRoot, "packages", "fieldd", "dist", "bin.cjs"), "");
  return resolveDevelopmentResources({ repoRoot, electronExecPath: "/electron" });
}

/** The `liveness` the pair would be supervised with: absent is the supervisor's own, the house watch. */
function livenessFor(environment: Record<string, string>): unknown {
  buildSupervisor({
    mode: "dev",
    rendererPolicyMode: "dev",
    root: tmpdir(),
    resources: devTree(),
    viteUrl: "http://localhost:5173",
    logRoot: tmpdir(),
    logger: createNoopLogger(),
    environment,
  });
  const created = stub.created.at(-1);
  expect(created).toBeDefined();
  return created !== undefined && "liveness" in created ? created.liveness : "the house watch";
}

describe("buildSupervisor — the liveness watch and the inspector (item 212, RV #67)", () => {
  it("arms the house watch for a fieldd that runs free", () => {
    expect(livenessFor({})).toBe("the house watch");
    expect(livenessFor({ NODE_OPTIONS: "--max-old-space-size=4096" })).toBe("the house watch");
  });

  it("turns it off for a fieldd spawned under the inspector, where a paused debugger would read as a wedge", () => {
    const paused = "--max-old-space-size=4096 --inspect-brk=9230";
    expect(livenessFor({ NODE_OPTIONS: "--inspect" })).toBe(false);
    expect(livenessFor({ NODE_OPTIONS: paused })).toBe(false);
  });

  it("reads the inspector's flags in the arguments and NODE_OPTIONS, and never in a packaged app", () => {
    const options = { NODE_OPTIONS: "--inspect=127.0.0.1:9229" };
    expect(spawnsUnderInspector(false, ["--inspect-wait", "bin.cjs"], {})).toBe(true);
    expect(spawnsUnderInspector(false, ["bin.cjs"], options)).toBe(true);
    // the port alone opens nothing
    expect(spawnsUnderInspector(false, ["--inspect-port=9229", "bin.cjs"], {})).toBe(false);
    expect(spawnsUnderInspector(false, [undefined], {})).toBe(false);
    // a package's fuses and its sea executable refuse both, so it is never under one
    expect(spawnsUnderInspector(true, ["--inspect"], options)).toBe(false);
  });
});
