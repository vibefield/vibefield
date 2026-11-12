import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "./temp-dir";

// ESP-18 (item 341) — the person's PATH reaches a pair as `PATH` in
// `production` alone, and only when the pair is SPAWNED: buildSupervisor hands
// the supervisor a `spawnEnvironment` hook, which a spawn awaits and an
// adoption never calls, so neither the window nor an adoption waits on the
// login shell. Every other mode keeps the PATH it was launched with, whatever
// it is handed. `electron` and the supervisor are mocked, the house way
// (fieldd-debug-swarm.test.ts): what is proven is what the supervisor would be
// built with. The rows assert by booleans: a red prints no PATH and no
// environment (item 320).

type Created = {
  environment?: Record<string, string | undefined>;
  spawnEnvironment?: () => Promise<Readonly<Record<string, string>>>;
};

const stub = vi.hoisted(() => ({ created: [] as Created[] }));

vi.mock("electron", () => ({
  app: { getPath: () => tmpdir() },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
}));
vi.mock("@vibefield/fieldd-supervisor", () => ({
  createFielddSupervisor: (opts: Created) => {
    stub.created.push(opts);
    return {};
  },
}));

const { buildSupervisor } = await import("../src/main/fieldd");
const { resolveDevelopmentResources, resolvePackagedResources } = await import(
  "../src/main/resources"
);

const ANSWER = "/sentinel-341/bin:/opt/homebrew/bin:/usr/bin:/bin";
afterEach(() => {
  stub.created.length = 0;
});

/** A packaged layout on disk: fieldd (buildSupervisor refuses a missing launch target) and the
 * staged identity (WP8c: it refuses a package with no anchor for its own plugins). */
function packagedLayout() {
  const resourcesPath = tempDir("vf-person-path-layout-");
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
  const repoRoot = tempDir("vf-person-path-repo-");
  mkdirSync(join(repoRoot, "packages", "fieldd", "dist"), { recursive: true });
  writeFileSync(join(repoRoot, "packages", "fieldd", "dist", "bin.cjs"), "");
  mkdirSync(join(repoRoot, "target", "debug"), { recursive: true });
  writeFileSync(join(repoRoot, "target", "debug", "field-native"), "");
  return resolveDevelopmentResources({ repoRoot, electronExecPath: "/electron" });
}

/** What the supervisor is built with, for one mode and one `personPath`. */
function built(
  mode: "production" | "smoke" | "dev",
  resources: Parameters<typeof buildSupervisor>[0]["resources"],
  personPath?: () => Promise<string | undefined>,
): Created & { environment: Record<string, string | undefined> } {
  buildSupervisor({
    mode,
    rendererPolicyMode: mode,
    root: tmpdir(),
    resources,
    viteUrl: "http://localhost:5173",
    logRoot: tmpdir(),
    logger: createNoopLogger(),
    ...(personPath !== undefined ? { personPath } : {}),
  });
  const created = stub.created.at(-1);
  if (created?.environment === undefined) throw new Error("no supervisor was created");
  return { ...created, environment: created.environment };
}

/** An environment's key names, in order: what a pair is handed, never what it holds. */
function keyNames(environment: Readonly<Record<string, string | undefined>>): string {
  return Object.keys(environment).sort().join(",");
}

describe("buildSupervisor — the pair's PATH (ESP-18, item 341)", () => {
  it("hands a packaged pair's spawn the person's PATH, asked for only when it spawns", async () => {
    let asked = 0;
    const supervisor = built("production", packagedLayout(), async () => {
      asked += 1;
      return ANSWER;
    });
    // building the supervisor asks nothing: an adoption, and the window, never wait on it
    expect(asked === 0).toBe(true);
    expect(typeof supervisor.spawnEnvironment === "function").toBe(true);
    const answer = (await supervisor.spawnEnvironment?.()) ?? {};
    expect(asked === 1).toBe(true);
    expect(keyNames(answer) === "PATH" && answer["PATH"] === ANSWER).toBe(true);
    // no answer is no key: the pair keeps the PATH it was given
    const none = built("production", packagedLayout(), async () => undefined);
    expect(keyNames((await none.spawnEnvironment?.()) ?? { unset: "" }) === "").toBe(true);
  });

  it("leaves development and smokes the PATH they were launched with, and adds nothing", () => {
    for (const mode of ["smoke", "dev"] as const) {
      const handed = built(mode, developmentLayout(), async () => ANSWER);
      const plain = built(mode, developmentLayout());
      expect(handed.spawnEnvironment === undefined).toBe(true);
      expect(handed.environment["PATH"] === process.env["PATH"]).toBe(true);
      expect(keyNames(handed.environment) === keyNames(plain.environment)).toBe(true);
    }
  });
});
