import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { labProfileProof } from "../src/testing/godview-lab-profile";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vf-lab-profile-test-"));
  roots.push(root);
  const requested = join(root, "isolated");
  const shared = join(root, "shared");
  mkdirSync(requested);
  mkdirSync(shared);
  return { root, requested, shared };
}

describe("Godview lab effective Chromium profile", () => {
  it.each(["", "relative/profile"])("refuses an absent or relative switch: %j", (requested) => {
    const { shared } = fixture();
    expect(() => labProfileProof(requested, { userData: shared, sessionData: shared })).toThrow(
      "absolute --user-data-dir",
    );
  });

  it.each(["userData", "sessionData", "storagePath"] as const)(
    "refuses %s pointing at a shared profile even when the switch is correct",
    (key) => {
      const { requested, shared } = fixture();
      const paths = { userData: requested, sessionData: requested, storagePath: requested };
      expect(() => labProfileProof(requested, { ...paths, [key]: shared })).toThrow(
        `${key} does not use the isolated Chromium profile`,
      );
    },
  );

  it("refuses an in-memory window session", () => {
    const { requested } = fixture();
    expect(() =>
      labProfileProof(requested, {
        userData: requested,
        sessionData: requested,
        storagePath: null,
      }),
    ).toThrow("storagePath does not use");
  });

  it("refuses a missing profile or a regular file", () => {
    const { root } = fixture();
    const requested = join(root, "missing");
    const paths = { userData: requested, sessionData: requested };
    expect(() => labProfileProof(requested, paths)).toThrow();
    writeFileSync(requested, "not a directory");
    expect(() => labProfileProof(requested, paths)).toThrow("not a directory");
  });

  it("canonicalizes aliases and reports only an opaque identity", () => {
    const { root, requested, shared } = fixture();
    const alias = join(root, "alias");
    symlinkSync(requested, alias, process.platform === "win32" ? "junction" : "dir");
    const proof = labProfileProof(requested, {
      userData: alias,
      sessionData: requested,
      storagePath: alias,
    });
    expect(proof).toEqual({
      kind: "isolated-chromium-v1",
      id: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(labProfileProof(alias, { userData: requested, sessionData: alias })).toEqual(proof);
    expect(labProfileProof(shared, { userData: shared, sessionData: shared }).id).not.toBe(
      proof.id,
    );
    expect(JSON.stringify(proof)).not.toContain(root);
  });
});
