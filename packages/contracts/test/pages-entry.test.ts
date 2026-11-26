import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAGES_ENGINE_STARTS, PagesEngineRecordV1 } from "../src/pages";
import { PAGES_ENGINE_RECORD, PAGES_SCRIPT_SET } from "../src/pages-record";
import { VIBEFIELD_DEV_PAGES_ENGINE_ENV } from "../src/registries";

// EY-1 (2026-11-19): the pin's record reaches Electron main by its own entry, `@vibefield/contracts/pages-record`, for
// the bridge's script matcher. No source file of this package imports it, so the root entry, which every renderer
// bundle takes, never carries the script set.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("the pin's record has its own entry (EY-1)", () => {
  it("is `./pages-record` in the package's exports, beside `./registries`", () => {
    const pkg = JSON.parse(read("../package.json")) as { exports: Record<string, string> };
    expect(pkg.exports["./pages-record"]).toBe("./src/pages-record.ts");
    expect(pkg.exports["./registries"]).toBe("./src/registries.ts");
  });

  it("is imported by no source file of the package, so the root entry never carries it", () => {
    const sources = readdirSync(new URL("../src/", import.meta.url)).filter(
      (name) => name.endsWith(".ts") && name !== "pages-record.ts",
    );
    expect(sources).toContain("index.ts");
    for (const name of sources)
      expect(read(`../src/${name}`), name).not.toMatch(/from "\.\/pages-record(\.ts)?"/);
    expect(PAGES_ENGINE_RECORD.core).toHaveLength(29);
    expect(PAGES_SCRIPT_SET.engineVersion).toBe(PAGES_ENGINE_RECORD.version);
  });
});

// The release binary's stream port (2026-11-24): the pin has TWO identities. The release binary (the npm package's)
// always opens a loopback port that relays any command to the engine for any local process, so it is never started;
// the source build is the same tag with the switch patch laid on it, and the only one main starts.
describe("the pin's two identities: the release binary and the source build (2026-11-24)", () => {
  const RELEASE = "a402fef2489c221b17522aa21f103ca5dc47f00ff5879d4a72c39881544730ab";
  const SOURCE = "f3a53cbce43fe30875d7d785a6f67647af4e96d987b8ea889fee8f0e68213dea";
  const PATCH = "08274e8604452e6cfe1c167d98e6c3d63988e353a6c9cbe462d014140c7810f7";
  const parses = (record: unknown) => PagesEngineRecordV1.safeParse(record).success;

  it("names both, and says the source build is the one that may be started", () => {
    expect(PAGES_ENGINE_RECORD.binarySha256).toEqual({ "darwin-arm64": RELEASE });
    expect(PAGES_ENGINE_RECORD.sourceBuild).toEqual({
      tagCommit: PAGES_ENGINE_RECORD.tagCommit,
      patchSha256: PATCH,
      binarySha256: { "darwin-arm64": SOURCE },
    });
    expect(PAGES_ENGINE_RECORD.starts).toBe("sourceBuild");
    expect(PAGES_ENGINE_STARTS).toBe("sourceBuild");
    expect(parses(PAGES_ENGINE_RECORD)).toBe(true);
  });

  it("refuses a record with no source build, and one that says anything else is started", () => {
    const { sourceBuild: _source, ...noSource } = PAGES_ENGINE_RECORD;
    expect(parses(noSource)).toBe(false);
    const { starts: _starts, ...unsaid } = PAGES_ENGINE_RECORD;
    expect(parses(unsaid)).toBe(false);
    for (const starts of ["release", "binarySha256", "npm", ""]) {
      expect(parses({ ...PAGES_ENGINE_RECORD, starts }), starts).toBe(false);
    }
  });

  it("refuses a source build of another commit, and one whose bytes are a release binary's", () => {
    const source = PAGES_ENGINE_RECORD.sourceBuild;
    const otherTag = { ...source, tagCommit: "0".repeat(40) };
    expect(parses({ ...PAGES_ENGINE_RECORD, sourceBuild: otherTag })).toBe(false);
    const release = { ...source, binarySha256: { "darwin-arm64": RELEASE } };
    expect(parses({ ...PAGES_ENGINE_RECORD, sourceBuild: release })).toBe(false);
    // the release's bytes under another platform's name are still the release's
    const renamed = { ...source, binarySha256: { "darwin-x64": RELEASE } };
    expect(parses({ ...PAGES_ENGINE_RECORD, sourceBuild: renamed })).toBe(false);
  });

  it("takes a source build that names no platform: no host has an engine then", () => {
    const none = { ...PAGES_ENGINE_RECORD.sourceBuild, binarySha256: {} };
    expect(parses({ ...PAGES_ENGINE_RECORD, sourceBuild: none })).toBe(true);
  });
});

describe("the dev runner's name for the engine's path (EY-1 1b)", () => {
  it("is a VIBEFIELD_DEV_ name, the runner's family for what it hands main", () => {
    expect(VIBEFIELD_DEV_PAGES_ENGINE_ENV).toBe("VIBEFIELD_DEV_PAGES_ENGINE");
  });
});
