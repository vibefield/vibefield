import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, describe, expect, it, vi } from "vitest";

// AR-8 (L3) — which rosettad the shell hands fieldd. The decision is
// `buildSupervisor`'s: the environment's choice wins, else the layout's when
// the file is there, else nothing (fieldd's index then says this copy has no
// agent history). `electron` and the supervisor are mocked, the house way:
// what is proven is the environment the pair would be spawned with.

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

const cleanup: (() => void)[] = [];
const savedEnv = process.env["FIELDD_ROSETTAD_BIN"];
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
  stub.created.length = 0;
  if (savedEnv === undefined) delete process.env["FIELDD_ROSETTAD_BIN"];
  else process.env["FIELDD_ROSETTAD_BIN"] = savedEnv;
});

/** A packaged layout on disk: fieldd always (buildSupervisor refuses a
 * missing launch target), the staged identity always (WP8c: it refuses a
 * package with no anchor for its own plugins), rosettad only when asked for. */
function packagedLayout(withRosettad: boolean) {
  const resourcesPath = mkdtempSync(join(tmpdir(), "vf-rosettad-layout-"));
  cleanup.push(() => rmSync(resourcesPath, { recursive: true, force: true }));
  mkdirSync(join(resourcesPath, "bin"));
  writeFileSync(join(resourcesPath, "bin", "fieldd"), "");
  if (withRosettad) writeFileSync(join(resourcesPath, "bin", "rosettad"), "");
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

function spawnEnvironment(
  resources: ReturnType<typeof resolvePackagedResources>,
): Record<string, string | undefined> {
  buildSupervisor({
    mode: "production",
    rendererPolicyMode: "production",
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

describe("buildSupervisor — the rosettad fieldd is handed (AR-8, L3)", () => {
  it("hands a packaged fieldd the rosettad staged beside it", () => {
    delete process.env["FIELDD_ROSETTAD_BIN"];
    const resources = packagedLayout(true);
    expect(spawnEnvironment(resources)["FIELDD_ROSETTAD_BIN"]).toBe(resources.rosettadPath);
  });

  it("hands nothing when the package carries no rosettad", () => {
    delete process.env["FIELDD_ROSETTAD_BIN"];
    expect(spawnEnvironment(packagedLayout(false))).not.toHaveProperty("FIELDD_ROSETTAD_BIN");
  });

  it("lets the environment's choice win, and reads an empty one as unset", () => {
    const resources = packagedLayout(true);
    process.env["FIELDD_ROSETTAD_BIN"] = "/elsewhere/rosettad";
    expect(spawnEnvironment(resources)["FIELDD_ROSETTAD_BIN"]).toBe("/elsewhere/rosettad");
    process.env["FIELDD_ROSETTAD_BIN"] = "";
    expect(spawnEnvironment(resources)["FIELDD_ROSETTAD_BIN"]).toBe(resources.rosettadPath);
  });

  it("names none in development — the runner exports the lock's build itself", () => {
    delete process.env["FIELDD_ROSETTAD_BIN"];
    const repoRoot = mkdtempSync(join(tmpdir(), "vf-rosettad-repo-"));
    cleanup.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    mkdirSync(join(repoRoot, "packages", "fieldd", "dist"), { recursive: true });
    writeFileSync(join(repoRoot, "packages", "fieldd", "dist", "bin.cjs"), "");
    const resources = resolveDevelopmentResources({ repoRoot, electronExecPath: "/electron" });
    expect(resources.rosettadPath).toBeNull();
    buildSupervisor({
      mode: "smoke",
      rendererPolicyMode: "smoke",
      root: tmpdir(),
      resources,
      viteUrl: "http://localhost:5173",
      logRoot: tmpdir(),
      logger: createNoopLogger(),
    });
    expect(stub.created.at(-1)?.environment).not.toHaveProperty("FIELDD_ROSETTAD_BIN");
  });
});
