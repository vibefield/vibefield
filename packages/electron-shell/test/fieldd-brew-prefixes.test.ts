import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as contracts from "@vibefield/contracts";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, describe, expect, it, vi } from "vitest";

// RV item 354, F1 — FIELDD_AGENT_BREW_PREFIXES is a harness's seam (fieldd boot-env
// `agentBrewPrefixes`): a packaged app's fieldd is spawned WITHOUT it, beside the debug corpus
// and the plugin roots its layout pins (WP8-D9), so an ambient value in the launching shell never
// narrows a person's install inventory. Without, not "": fieldd reads "" as "probe no prefix",
// while a package probes the person's own Homebrew, puppeteer's default (an entry left undefined
// is one Node's spawn does not pass). Development passes the launching shell's value through.
// fieldd-debug-swarm.test.ts's shape: `electron` and the supervisor are mocked, and what is
// proven is the environment the pair would be spawned with. That environment is built on this
// process's own, so it is never handed to the runner: every assertion is a boolean or the
// planted value.

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

// Read through the namespace, so a missing name is a failed assertion, not a failed import.
const NAME: unknown = Reflect.get(contracts, "FIELDD_AGENT_BREW_PREFIXES_ENV");
const PLANTED = "/nonexistent-brew-prefix";
const cleanup: (() => void)[] = [];
const saved = typeof NAME === "string" ? process.env[NAME] : undefined;
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
  stub.created.length = 0;
  if (typeof NAME !== "string") return;
  if (saved === undefined) delete process.env[NAME];
  else process.env[NAME] = saved;
});

/** A packaged layout on disk, as fieldd-debug-swarm.test.ts makes it. */
function packagedLayout() {
  const resourcesPath = mkdtempSync(join(tmpdir(), "vf-brew-layout-"));
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

/** A development tree on disk, as fieldd-debug-swarm.test.ts makes it. */
function developmentLayout() {
  const repoRoot = mkdtempSync(join(tmpdir(), "vf-brew-repo-"));
  cleanup.push(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(join(repoRoot, "packages", "fieldd", "dist"), { recursive: true });
  writeFileSync(join(repoRoot, "packages", "fieldd", "dist", "bin.cjs"), "");
  mkdirSync(join(repoRoot, "target", "debug"), { recursive: true });
  writeFileSync(join(repoRoot, "target", "debug", "field-native"), "");
  return resolveDevelopmentResources({ repoRoot, electronExecPath: "/electron" });
}

/** What the spawn environment holds for the variable: a value or absence, never the environment. */
function brewEntry(
  mode: "production" | "smoke",
  resources: Parameters<typeof buildSupervisor>[0]["resources"],
): { present: boolean; value: string | undefined } {
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
  const name = NAME as string;
  return { present: name in environment, value: environment[name] };
}

describe("buildSupervisor — a package probes the person's Homebrew (RV item 354, F1)", () => {
  it("spawns a packaged fieldd without FIELDD_AGENT_BREW_PREFIXES, whatever the shell has", () => {
    expect(typeof NAME).toBe("string");
    process.env[NAME as string] = PLANTED;
    expect(brewEntry("production", packagedLayout()).value === undefined).toBe(true);
  });

  it("passes the launching shell's value through in development, and adds none of its own", () => {
    expect(typeof NAME).toBe("string");
    process.env[NAME as string] = PLANTED;
    expect(brewEntry("smoke", developmentLayout()).value === PLANTED).toBe(true);
    delete process.env[NAME as string];
    expect(brewEntry("smoke", developmentLayout()).present).toBe(false);
  });
});
