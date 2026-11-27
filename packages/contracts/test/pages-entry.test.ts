import { createHash } from "node:crypto";
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
      stagedCdhash: {},
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

// Item 658 (2026-11-26): the record's source build is tied to its build note and its patch, by bytes. The tree carries
// a redacted copy of the lab's note (local paths are placeholders, a person is "the owner") and the patch byte for byte,
// in src/notes/. The record's header names the copy's SHA-256 by hand and keeps the converter's line for the draft
// original.
describe("the source build is tied to its build note and its patch (item 658, 2026-11-26)", () => {
  const NOTE_COPY = "54496b61c93eeb201941cd47e676995187d615b9fb90b015adb539a73867a623";
  const NOTE_ORIGINAL = "8fcb9077ba97fd477c16fbe280b23bbf8fa5d6a2e4d990891a77c9f923c1f385";
  const sha256 = (path: string) =>
    createHash("sha256")
      .update(readFileSync(new URL(path, import.meta.url)))
      .digest("hex");
  const header = () => {
    const source = read("../src/pages-record.ts");
    return source.slice(0, source.indexOf("\nimport "));
  };

  // The note's own account of revision 2: everything from its "**Revision 2 (" label on, with the one sentence that
  // states revision 1's binary and diff as superseded taken out, so a value written only there is never read.
  const SUPERSEDED =
    /Revision 1's binary\s+\(`([0-9a-f]{64})`\) and diff\s+\(`([0-9a-f]{64})`\) are \*\*superseded\*\*/;
  const section = (text: string, heading: string) => {
    const start = text.indexOf(`\n## ${heading}\n`);
    if (start < 0) return "";
    const end = text.indexOf("\n## ", start + 1);
    return text.slice(start, end < 0 ? undefined : end);
  };
  const statedForRevision2 = (note: string) => {
    const label = note.indexOf("**Revision 2 (");
    if (label < 0) return undefined;
    const revision2 = note.slice(label).replace(SUPERSEDED, "");
    const binary = section(revision2, "The binary");
    return {
      tagCommit: /agent-browser v0\.41\.0, commit\s+`([0-9a-f]{40})`/.exec(
        section(revision2, "Source"),
      )?.[1],
      patchSha256: /^- SHA-256: `([0-9a-f]{64})` \(903 lines\)\.$/m.exec(
        section(revision2, "The patch"),
      )?.[1],
      recordedBinary: section(revision2, "Build time").includes(
        "**Revision 2 (the recorded binary):**",
      ),
      darwinArm64: binary.includes("Mach-O 64-bit arm64 executable")
        ? /^- SHA-256 \(hex\): `([0-9a-f]{64})`$/m.exec(binary)?.[1]
        : undefined,
    };
  };

  it("names the tree's redacted copy of the note by its SHA-256, and the copy's bytes have it", () => {
    const named = /^\/\/ the redacted copy: ([0-9a-f]{64}) {2}src\/notes\/bu14-build\.md$/m.exec(
      header(),
    )?.[1];
    expect(named).toBe(NOTE_COPY);
    expect(sha256("../src/notes/bu14-build.md")).toBe(NOTE_COPY);
  });

  it("keeps the converter's line for the draft original, revision 2, and says the copy redacts it", () => {
    const text = header();
    expect(text).toMatch(new RegExp(`^// ${NOTE_ORIGINAL} {2}notes/bu14-build\\.md$`, "m"));
    expect(text).toContain("revision 2");
    expect(text).toMatch(/^\/\/ .*a redaction of the draft original/m);
  });

  it("states the record's tag, patch sum and darwin-arm64 binary sum under revision 2, never revision 1's", () => {
    const note = read("../src/notes/bu14-build.md");
    const source = PAGES_ENGINE_RECORD.sourceBuild;
    expect(statedForRevision2(note)).toEqual({
      tagCommit: source.tagCommit,
      patchSha256: source.patchSha256,
      recordedBinary: true,
      darwinArm64: source.binarySha256["darwin-arm64"],
    });
    // revision 1's superseded sums are in the note, and the record takes neither
    const superseded = SUPERSEDED.exec(note);
    expect(superseded).not.toBeNull();
    const [, binary1, diff1] = superseded ?? [];
    expect(binary1).not.toBe(source.binarySha256["darwin-arm64"]);
    expect(diff1).not.toBe(source.patchSha256);
    // a note whose revision-2 lines are gone states nothing, though revision 1's sums are still in it
    const noRevision2 = note
      .replace(/^- SHA-256 \(hex\): `[0-9a-f]{64}`\n/m, "")
      .replace(/^- SHA-256: `[0-9a-f]{64}` \(903 lines\)\.\n/m, "");
    expect(noRevision2).toContain(binary1);
    const stated = statedForRevision2(noRevision2);
    expect(stated?.darwinArm64).toBeUndefined();
    expect(stated?.patchSha256).toBeUndefined();
    // and one that writes the record's sums only into revision 1's sentence states them nowhere
    const onlyUnderRevision1 = noRevision2
      .replace(binary1 ?? "", source.binarySha256["darwin-arm64"] ?? "")
      .replace(diff1 ?? "", source.patchSha256);
    expect(onlyUnderRevision1).toContain(source.patchSha256);
    expect(statedForRevision2(onlyUnderRevision1)?.darwinArm64).toBeUndefined();
    expect(statedForRevision2(onlyUnderRevision1)?.patchSha256).toBeUndefined();
  });

  it("carries the patch byte for byte: its bytes' SHA-256 is the record's patchSha256", () => {
    expect(sha256("../src/notes/bu14-patch-1453dd3.diff")).toBe(
      PAGES_ENGINE_RECORD.sourceBuild.patchSha256,
    );
    expect(header()).toContain("src/notes/bu14-patch-1453dd3.diff");
  });

  it("carries agent-browser's licence beside the patch, and no local path in the note or the README", () => {
    const licence = read("../src/notes/LICENSE-agent-browser");
    expect(licence).toMatch(/Apache License\s+Version 2\.0/);
    for (const name of ["bu14-build.md", "README.md"]) {
      const text = read(`../src/notes/${name}`);
      expect(text, name).not.toContain("/Volumes/");
      expect(text, name).not.toContain("/Users/");
    }
  });
});

// Item 658 (2026-11-26): a package starts no engine until the record names a STAGED engine's digest. A package's engine
// is re-signed by the app's team, which moves its bytes at every signing, so it is named by its CodeDirectory's SHA-256
// (the cdhash) by platform. Nothing stages an engine yet, so the record names none.
describe("a package starts no engine until a staged engine is recorded (item 658, 2026-11-26)", () => {
  const STAGED = "c".repeat(64);
  const parses = (sourceBuild: unknown) =>
    PagesEngineRecordV1.safeParse({ ...PAGES_ENGINE_RECORD, sourceBuild }).success;

  it("names no staged engine today", () => {
    expect(PAGES_ENGINE_RECORD.sourceBuild.stagedCdhash).toEqual({});
  });

  it("refuses a source build that says nothing of a staged engine", () => {
    const { stagedCdhash: _staged, ...unsaid } = {
      ...PAGES_ENGINE_RECORD.sourceBuild,
      stagedCdhash: {},
    };
    expect(parses(unsaid)).toBe(false);
  });

  it("refuses a staged platform the source build names no binary for", () => {
    const source = PAGES_ENGINE_RECORD.sourceBuild;
    expect(parses({ ...source, stagedCdhash: { "darwin-x64": STAGED } })).toBe(false);
  });

  it("takes none, and darwin-arm64 by 64 hex; never another value or key", () => {
    const source = PAGES_ENGINE_RECORD.sourceBuild;
    expect(parses({ ...source, stagedCdhash: {} })).toBe(true);
    expect(parses({ ...source, stagedCdhash: { "darwin-arm64": STAGED } })).toBe(true);
    for (const staged of [
      { "darwin-arm64": "C".repeat(64) },
      { "darwin-arm64": "c".repeat(63) },
      { "darwin-arm64": "" },
      { darwin: STAGED },
      [],
      "none",
    ]) {
      expect(parses({ ...source, stagedCdhash: staged }), JSON.stringify(staged)).toBe(false);
    }
  });
});

describe("the dev runner's name for the engine's path (EY-1 1b)", () => {
  it("is a VIBEFIELD_DEV_ name, the runner's family for what it hands main", () => {
    expect(VIBEFIELD_DEV_PAGES_ENGINE_ENV).toBe("VIBEFIELD_DEV_PAGES_ENGINE");
  });
});
