import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { activateWithMockHost } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { ARTIFACT_SURFACE, browserManifest, browserRenderer } from "../src";
import { createUlid, parseArtifactSnapshot, pathBasename } from "../src/ArtifactPanel";

describe("plugin-browser", () => {
  it("declares the Artifact Hub fixed surface and its complete least-power grant", () => {
    const result = validatePluginManifest(browserManifest);
    if (!result.ok) throw new Error(result.issues.join(" · "));
    expect(browserManifest.contributes?.surfaces).toEqual([
      expect.objectContaining({ id: ARTIFACT_SURFACE, slot: "hud.side-panel", title: "Artifacts" }),
    ]);
    expect(browserManifest.capabilities).toEqual([
      "artifact.publish",
      "workspace.read",
      "shell.dialog",
      "shell.open",
    ]);
  });

  it("activation binds exactly the declared side-panel surface", async () => {
    const session = await activateWithMockHost(browserRenderer, {
      id: browserManifest.id,
      version: browserManifest.version,
      declaredWidgets: [],
      declaredSurfaces: [ARTIFACT_SURFACE],
    });
    expect([...session.surfaces.keys()]).toEqual([ARTIFACT_SURFACE]);
    expect(session.bindings.size).toBe(0);
  });

  it("creates contract-valid ULIDs and never exposes a folder's parent path", () => {
    expect(createUlid(1_722_000_000_000)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(pathBasename("/Users/james/Sites/demo/")).toBe("demo");
    expect(pathBasename("C:\\Sites\\demo")).toBe("demo");
  });

  it("rejects malformed subscription snapshots as a whole", () => {
    expect(parseArtifactSnapshot([])).toEqual([]);
    expect(parseArtifactSnapshot([{ artifactId: "not-an-id" }])).toBeNull();
  });

  it("keeps the committed manifest artifact canonical", () => {
    const result = validatePluginManifest(browserManifest);
    if (!result.ok) throw new Error(result.issues.join(" · "));
    const artifact = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json"),
      "utf8",
    );
    expect(artifact).toBe(canonicalJson(result.manifest));
  });
});
