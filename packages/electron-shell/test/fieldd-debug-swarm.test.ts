import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FIELDD_DEBUG_SWARM_CORPUS_ENV,
  FIELDD_PLUGIN_REGISTRY_KEY_ENV,
  FIELDD_PLUGIN_REGISTRY_URL_ENV,
} from "@vibefield/contracts";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, describe, expect, it, vi } from "vitest";

// PG-9 S4c — a package plays no debug swarm. FIELDD_DEBUG_SWARM_CORPUS is a development seam (fieldd
// `debug/swarm-replay.ts`): a packaged app's fieldd is spawned with it BLANK, beside the plugin roots
// and the trust anchor its layout pins (WP8-D9), so an ambient value in the launching shell never
// reaches the package — and a packaged fieldd that met one anyway refuses to boot (fieldd's
// swarm-replay-packaged.test.ts). Development passes the launching shell's value through, as it passes
// every other. `electron` and the supervisor are mocked, the house way (fieldd-rosettad.test.ts): what
// is proven is the environment the pair would be spawned with.
//
// MK-6 (2026-11-14) — and a package reads no plugin list its launching shell named: the plugin list's
// development seam (FIELDD_PLUGIN_REGISTRY_URL and _KEY, fieldd `registry-seam.ts`) is blanked the same
// way, and a packaged fieldd handed either refuses to boot (fieldd's registry-seam-packaged.test.ts). The
// same harness proves it, in its own describe below.

const stub = vi.hoisted(() => ({
  created: [] as { environment?: Record<string, string | undefined> }[],
}));

vi.mock("electron", () => ({
  app: { getPath: () => tmpdir() },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
}));
vi.mock("@vibefield/fieldd-supervisor", () => ({
  createFielddSupervisor: (opts: { environment?: Record<string, string | undefined> }) => {
    stub.created.push(opts);
    return {};
  },
}));

const { buildSupervisor } = await import("../src/main/fieldd");
const { resolveDevelopmentResources, resolvePackagedResources } = await import(
  "../src/main/resources"
);

const CORPUS = "/corpora/n20-60s-s1.jsonl.gz";
/** MK-6: a list's address and a public key, as smoke:market's stager hands them (no real key:
 * nothing verifies here) */
const LIST = "file:///tmp/vf-market-fixture-test/listed/index.json";
const PUBLIC = "MCowBQYDK2VwAyEAplaceholderplaceholderplaceholderplace=";
const SEAMS = [
  FIELDD_DEBUG_SWARM_CORPUS_ENV,
  FIELDD_PLUGIN_REGISTRY_URL_ENV,
  FIELDD_PLUGIN_REGISTRY_KEY_ENV,
] as const;
const cleanup: (() => void)[] = [];
const savedEnv = new Map(SEAMS.map((name) => [name, process.env[name]] as const));
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
  stub.created.length = 0;
  for (const [name, saved] of savedEnv) {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
});

/** A packaged layout on disk: fieldd (buildSupervisor refuses a missing launch target) and the
 * staged identity (WP8c: it refuses a package with no anchor for its own plugins). */
function packagedLayout() {
  const resourcesPath = mkdtempSync(join(tmpdir(), "vf-swarm-layout-"));
  cleanup.push(() => rmSync(resourcesPath, { recursive: true, force: true }));
  mkdirSync(join(resourcesPath, "bin"));
  writeFileSync(join(resourcesPath, "bin", "fieldd"), "");
  mkdirSync(join(resourcesPath, "identity"));
  copyFileSync(
    join(
      import.meta.dirname,
      "..",
      "..",
      "contracts",
      "fixtures",
      "staged-release-identity.valid.json",
    ),
    join(resourcesPath, "identity", "release-identity.json"),
  );
  writeFileSync(join(resourcesPath, "identity", "trust-root.json"), "{}");
  writeFileSync(join(resourcesPath, "identity", "trust-root.json.sig"), "");
  return resolvePackagedResources({
    resourcesPath,
    electronExecPath: join(resourcesPath, "VibeField"),
    platform: "darwin",
  });
}

/** A development tree on disk: fieldd's bundle, and the field-native a smoke refuses to lack. */
function developmentLayout() {
  const repoRoot = mkdtempSync(join(tmpdir(), "vf-swarm-repo-"));
  cleanup.push(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(join(repoRoot, "packages", "fieldd", "dist"), { recursive: true });
  writeFileSync(join(repoRoot, "packages", "fieldd", "dist", "bin.cjs"), "");
  mkdirSync(join(repoRoot, "target", "debug"), { recursive: true });
  writeFileSync(join(repoRoot, "target", "debug", "field-native"), "");
  return resolveDevelopmentResources({ repoRoot, electronExecPath: "/electron" });
}

function spawnEnvironment(
  mode: "production" | "smoke",
  resources: Parameters<typeof buildSupervisor>[0]["resources"],
): Record<string, string | undefined> {
  buildSupervisor({
    mode,
    rendererPolicyMode: mode,
    root: tmpdir(),
    resources,
    viteUrl: "http://localhost:5173",
    logRoot: tmpdir(),
    logger: createNoopLogger(),
  });
  const environment = stub.created.at(-1)?.environment;
  if (environment === undefined) throw new Error("no supervisor was created");
  return environment;
}

describe("buildSupervisor — the debug swarm never reaches a packaged fieldd (PG-9 S4c)", () => {
  it("blanks FIELDD_DEBUG_SWARM_CORPUS for a packaged fieldd, whatever the launching shell holds", () => {
    process.env[FIELDD_DEBUG_SWARM_CORPUS_ENV] = CORPUS;
    expect(spawnEnvironment("production", packagedLayout())[FIELDD_DEBUG_SWARM_CORPUS_ENV]).toBe(
      "",
    );
  });

  it("passes the launching shell's value through in development, and adds none of its own", () => {
    process.env[FIELDD_DEBUG_SWARM_CORPUS_ENV] = CORPUS;
    expect(spawnEnvironment("smoke", developmentLayout())[FIELDD_DEBUG_SWARM_CORPUS_ENV]).toBe(
      CORPUS,
    );
    delete process.env[FIELDD_DEBUG_SWARM_CORPUS_ENV];
    // Item 365: a boolean, never the environment itself, so a red cannot print this process's whole environment.
    const handed = spawnEnvironment("smoke", developmentLayout());
    expect(FIELDD_DEBUG_SWARM_CORPUS_ENV in handed).toBe(false);
  });
});

describe("buildSupervisor — a plugin list the shell named never reaches a packaged fieldd (MK-6)", () => {
  it("blanks both halves of the seam for a packaged fieldd, whatever the launching shell holds", () => {
    process.env[FIELDD_PLUGIN_REGISTRY_URL_ENV] = LIST;
    process.env[FIELDD_PLUGIN_REGISTRY_KEY_ENV] = PUBLIC;
    const environment = spawnEnvironment("production", packagedLayout());
    expect(environment[FIELDD_PLUGIN_REGISTRY_URL_ENV]).toBe("");
    expect(environment[FIELDD_PLUGIN_REGISTRY_KEY_ENV]).toBe("");
  });

  it("passes the launching shell's two values through in development, and adds none of its own", () => {
    process.env[FIELDD_PLUGIN_REGISTRY_URL_ENV] = LIST;
    process.env[FIELDD_PLUGIN_REGISTRY_KEY_ENV] = PUBLIC;
    const environment = spawnEnvironment("smoke", developmentLayout());
    expect(environment[FIELDD_PLUGIN_REGISTRY_URL_ENV]).toBe(LIST);
    expect(environment[FIELDD_PLUGIN_REGISTRY_KEY_ENV]).toBe(PUBLIC);
    delete process.env[FIELDD_PLUGIN_REGISTRY_URL_ENV];
    delete process.env[FIELDD_PLUGIN_REGISTRY_KEY_ENV];
    // booleans, never the environment itself, as item 365 holds the debug swarm's row above: a red
    // cannot print this process's whole environment
    const bare = spawnEnvironment("smoke", developmentLayout());
    expect(FIELDD_PLUGIN_REGISTRY_URL_ENV in bare).toBe(false);
    expect(FIELDD_PLUGIN_REGISTRY_KEY_ENV in bare).toBe(false);
  });
});
