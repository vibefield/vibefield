import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

let arms: {
  assertLabBuilt(root: string): void;
  assertLabDeckProof(state: unknown, context: string): void;
};
const roots: string[] = [];

beforeAll(async () => {
  const url = pathToFileURL(
    join(import.meta.dirname, "..", "..", "..", "scripts", "godview-lab-arms.mjs"),
  ).href;
  arms = await import(/* @vite-ignore */ url);
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function artifact(root: string, name: string): string {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "fixture", { mode: 0o755 });
  return path;
}

function fixture(): { root: string; native: string; cell: string } {
  const root = mkdtempSync(join(tmpdir(), "vf-godview-lab-build-"));
  roots.push(root);
  artifact(root, "packages/electron-shell/dist/testing/smoke.cjs");
  artifact(root, "packages/fieldd/dist/bin.cjs");
  const suffix = process.platform === "win32" ? ".exe" : "";
  const native = artifact(root, `target/debug/field-native${suffix}`);
  return { root, native, cell: join(root, `target/debug/field-terminal-host${suffix}`) };
}

describe("a Godview lab arm's reported workload", () => {
  const healthy = {
    active: true,
    panes: 1,
    sessions: 1,
    poolPhase: "open",
    rosterState: "observed",
    rendererBackend: "webgpu",
  };

  it.each([
    ["historical report without deck proof", undefined],
    ["absent marker", null],
    ["partial proof", { active: true, panes: 1 }],
    ["empty workspace", { ...healthy, panes: 0, sessions: 0 }],
    ["inactive deck", { ...healthy, active: false }],
    ["extra pane", { ...healthy, panes: 2 }],
    ["extra session", { ...healthy, sessions: 2 }],
    ["closed pool", { ...healthy, poolPhase: "closed" }],
    ["unread roster", { ...healthy, rosterState: "unread" }],
    ["fallback renderer", { ...healthy, rendererBackend: "canvas" }],
    ["reported error", { ...healthy, error: "terminal unavailable" }],
  ])("rejects %s before grading a sample or comparing a capture", (_name, state) => {
    expect(() => arms.assertLabDeckProof(state, "A round 1 cell 0 end")).toThrow(
      "A round 1 cell 0 end: missing healthy one-pane deck proof",
    );
  });

  it("accepts healthy proof and tolerates unrelated report fields", () => {
    expect(() => arms.assertLabDeckProof(healthy, "A")).not.toThrow();
    expect(() => arms.assertLabDeckProof({ ...healthy, futureField: true }, "A")).not.toThrow();
  });
});

describe("a Godview lab arm's built artifacts", () => {
  it("rejects the historical control with JS and field-native but no terminal cell binary", () => {
    const { root, cell } = fixture();
    expect(() => arms.assertLabBuilt(root)).toThrow(cell);
    writeFileSync(cell, "fixture", { mode: 0o755 });
    expect(() => arms.assertLabBuilt(root)).not.toThrow();
  });

  it("rejects a directory where the terminal executable should be", () => {
    const { root, cell } = fixture();
    mkdirSync(cell);
    expect(() => arms.assertLabBuilt(root)).toThrow(cell);
  });

  it.skipIf(process.platform === "win32")(
    "rejects a native binary without execute permission",
    () => {
      const { root, native, cell } = fixture();
      writeFileSync(cell, "fixture", { mode: 0o755 });
      chmodSync(native, 0o644);
      expect(() => arms.assertLabBuilt(root)).toThrow(native);
    },
  );
});
