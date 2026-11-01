import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, describe, expect, it, vi } from "vitest";

// Item 134b — a smoke's field-native. In development a missing one is handed to no one and the dev runner starts the
// floor itself; a smoke has no runner, so `buildSupervisor` names the missing path at once (PT-S3 L1 read fieldd's
// ten-second "did not come up" instead). `electron` and the supervisor are mocked, the house way
// (fieldd-rosettad.test.ts): what is proven is what the pair would be spawned with, or the refusal.

const stub = vi.hoisted(() => ({ created: [] as { nativeExecutable?: string }[] }));

vi.mock("electron", () => ({
  app: { getPath: () => tmpdir() },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
}));
vi.mock("@vibefield/fieldd-supervisor", () => ({
  createFielddSupervisor: (opts: { nativeExecutable?: string }) => {
    stub.created.push(opts);
    return {};
  },
}));

const { buildSupervisor, sayFatalSmokeHome } = await import("../src/main/fieldd");
const { resolveDevelopmentResources } = await import("../src/main/resources");

const cleanup: (() => void)[] = [];
const savedNative = process.env["FIELDD_NATIVE_BIN"];
const savedDataDir = process.env["FIELDD_DATA_DIR"];
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
  stub.created.length = 0;
  vi.restoreAllMocks();
  if (savedNative === undefined) delete process.env["FIELDD_NATIVE_BIN"];
  else process.env["FIELDD_NATIVE_BIN"] = savedNative;
  if (savedDataDir === undefined) delete process.env["FIELDD_DATA_DIR"];
  else process.env["FIELDD_DATA_DIR"] = savedDataDir;
});

/** A development tree: fieldd's bundle always (buildSupervisor refuses a missing launch target), the cargo debug
 * field-native only when asked for. */
function devTree(withNative: boolean) {
  const repoRoot = mkdtempSync(join(tmpdir(), "vf-native-repo-"));
  cleanup.push(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(join(repoRoot, "packages", "fieldd", "dist"), { recursive: true });
  writeFileSync(join(repoRoot, "packages", "fieldd", "dist", "bin.cjs"), "");
  if (withNative) {
    mkdirSync(join(repoRoot, "target", "debug"), { recursive: true });
    writeFileSync(join(repoRoot, "target", "debug", "field-native"), "");
  }
  return resolveDevelopmentResources({ repoRoot, electronExecPath: "/electron" });
}

function build(mode: "smoke" | "dev", resources: ReturnType<typeof devTree>): void {
  buildSupervisor({
    mode,
    rendererPolicyMode: mode,
    root: tmpdir(),
    resources,
    viteUrl: "http://localhost:5173",
    logRoot: tmpdir(),
    logger: createNoopLogger(),
  });
}

describe("buildSupervisor — a smoke's field-native (item 134b)", () => {
  it("refuses a smoke whose field-native is missing, naming the path and its build", () => {
    delete process.env["FIELDD_NATIVE_BIN"];
    const resources = devTree(false);
    expect(() => build("smoke", resources)).toThrow(
      `field-native bin missing (build it: cargo build -p field-native): ${resources.fieldNativePath}`,
    );
    expect(stub.created).toHaveLength(0);
  });

  it("names FIELDD_NATIVE_BIN's path when that is the one missing", () => {
    process.env["FIELDD_NATIVE_BIN"] = "/nowhere/field-native";
    expect(() => build("smoke", devTree(true))).toThrow(/: \/nowhere\/field-native$/u);
  });

  it("hands a smoke the field-native that is there", () => {
    delete process.env["FIELDD_NATIVE_BIN"];
    const resources = devTree(true);
    build("smoke", resources);
    expect(stub.created.at(-1)?.nativeExecutable).toBe(resources.fieldNativePath);
  });

  it("still tolerates a missing one in development: the dev runner builds and starts the floor itself", () => {
    delete process.env["FIELDD_NATIVE_BIN"];
    build("dev", devTree(false));
    expect(stub.created.at(-1)).not.toHaveProperty("nativeExecutable");
  });
});

/** What `sayFatalSmokeHome` wrote to stdout. */
function said(run: () => void): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  run();
  vi.restoreAllMocks();
  return lines;
}

describe("sayFatalSmokeHome — a smoke gone fatal before its run names its kept HOME (item 134)", () => {
  it("names the root dataRoot minted, kept, in the line a red run's teardown writes", () => {
    delete process.env["FIELDD_DATA_DIR"];
    const home = mkdtempSync(join(tmpdir(), "vf-smoke-"));
    cleanup.push(() => rmSync(home, { recursive: true, force: true }));
    expect(said(() => sayFatalSmokeHome("smoke-canvas", home))).toEqual([
      `SMOKE_HOME ${JSON.stringify({ home, removed: false })}\n`,
    ]);
  });

  it("names nothing outside a smoke, or for an injected FIELDD_DATA_DIR (someone else's data)", () => {
    const home = mkdtempSync(join(tmpdir(), "vf-smoke-"));
    cleanup.push(() => rmSync(home, { recursive: true, force: true }));
    delete process.env["FIELDD_DATA_DIR"];
    expect(said(() => sayFatalSmokeHome("dev", home))).toEqual([]);
    expect(said(() => sayFatalSmokeHome("production", home))).toEqual([]);
    process.env["FIELDD_DATA_DIR"] = home;
    expect(said(() => sayFatalSmokeHome("smoke", home))).toEqual([]);
  });
});
