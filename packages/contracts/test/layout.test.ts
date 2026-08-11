import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FILES, LAYOUT, SOCKETS } from "../src/registries";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

// UA-0 — LAYOUT is the one authority for on-disk paths. The vector is the
// deliberate-change tripwire: a layout change edits the fixture in the same
// commit, on purpose, and the Rust twin (tests/layout_vector.rs) pins the
// generated side against the same file.
describe("LAYOUT (golden vector)", () => {
  it("matches fixtures/layout.vector.json exactly", () => {
    const fixture = JSON.parse(
      readFileSync(join(here, "..", "fixtures", "layout.vector.json"), "utf8"),
    );
    expect(JSON.parse(JSON.stringify(LAYOUT))).toEqual(fixture);
  });

  it("gen/layout.json (the committed .mjs-consumer artifact) is fresh", () => {
    const generated = JSON.parse(readFileSync(join(here, "..", "gen", "layout.json"), "utf8"));
    expect(JSON.parse(JSON.stringify(LAYOUT))).toEqual(generated);
  });

  it("composes basenames from their own registries, never respelling", () => {
    expect(LAYOUT.MGMT_SOCKET.at(-1)).toBe(SOCKETS.MGMT);
    expect(LAYOUT.MESHDATA_SOCKET.at(-1)).toBe(SOCKETS.MESHDATA);
    expect(LAYOUT.TERMINAL_CONTROL_SOCKET.at(-1)).toBe(SOCKETS.TERMINAL_CONTROL);
    expect(LAYOUT.TERMINAL_FRAME_SOCKET.at(-1)).toBe(SOCKETS.TERMINAL_FRAME);
    expect(LAYOUT.TERMINAL_CONFIG_FILE.at(-1)).toBe(FILES.TERMINAL_CONFIG);
    // the tree hangs together: sockets live in the run dir, run files in theirs
    expect(LAYOUT.MGMT_SOCKET.slice(0, -1)).toEqual([...LAYOUT.NATIVE_RUN_DIR]);
    expect(LAYOUT.PRODUCT_JSON.slice(0, -1)).toEqual([...LAYOUT.FIELDD_RUN_DIR]);
    expect(LAYOUT.SHELL_TOKEN.slice(0, -1)).toEqual([...LAYOUT.FIELDD_RUN_DIR]);
  });

  it("segments never smuggle separators", () => {
    for (const segs of Object.values(LAYOUT)) {
      for (const s of segs) expect(s).not.toMatch(/[/\\]/);
    }
  });
});

// The boundary half of UA-0's exit: the census drift sites (and the owner
// files refactored with them) consume LAYOUT and no longer respell the tree.
// Patterns are join-shaped on purpose — comments and component names stay free.
const LAYOUT_CONSUMERS = [
  "packages/fieldd/src/bin.ts",
  "packages/fieldd/src/daemon.ts",
  "packages/fieldd/src/doc-service.ts",
  "packages/fieldd/src/device-service.ts",
  "packages/fieldd/src/settings-doc.ts",
  "packages/fieldd/src/artifact-service.ts",
  "packages/fieldd-supervisor/src/paths.ts",
  "packages/audit/src/index.ts",
  "packages/electron-shell/src/main/support-bundle.ts",
  "packages/electron-shell/src/main/artifact-preview-capture.ts",
  "packages/electron-shell/src/main/crash-artifacts.ts",
  "tooling/dev-runner/src/product.mjs",
] as const;

const FORBIDDEN_RESPELLINGS = [
  '"fieldd", "run"',
  '"native", "run"',
  '"native", "pairing"',
  '"native", "mesh"',
  '"product.json"',
  '"shell.token"',
  '"mgmt.sock"',
  '"meshdata.sock"',
  '"artifacts", "previews"',
  '"plugins", "installed"',
  '"fieldd", "device-id"',
  '"fieldd", "settings"',
  '"exports", ".staging"',
  'dataDir, "audit"',
  'dataRoot, "audit"',
  'dataDir, "docs"',
  'dataDir, "registries"',
  'dataRoot, "crash"',
] as const;

describe("layout boundary (UA-0 exit)", () => {
  for (const rel of LAYOUT_CONSUMERS) {
    it(`${rel} respells nothing LAYOUT owns`, () => {
      const src = readFileSync(join(repoRoot, rel), "utf8");
      for (const bad of FORBIDDEN_RESPELLINGS) {
        expect(src.includes(bad), `${rel} still contains ${bad}`).toBe(false);
      }
    });
  }
});
