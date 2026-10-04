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
    // DK-5 (DK-D20): the canvas card's two scopes (`surface.attach` mints the
    // attachment, `surface.browser` makes it a browser one) left with the card —
    // nothing in the plugin mints a surface now.
    for (const scope of ["surface.attach", "surface.browser"]) {
      expect(browserManifest.capabilities).not.toContain(scope);
    }
    // 03·A §5.5 was superseded at DT-D10: the external-overlay mirror retired
    // unbuilt, and this scope left the browser plugin's future with it.
    expect(browserManifest.capabilities).not.toContain("shell.webcontents");
    expect(browserManifest.capabilities).not.toContain("surface.capture");
    expect(browserManifest.capabilities).not.toContain("surface.control");
  });

  it("DK-5: contributes no canvas widget — the page card retired (DK-D20)", () => {
    // `vibefield.browser` keeps only its Artifacts panel: the page widget, its
    // activation event and its card face are gone, and the page returns as an
    // object kind under PORTALS.
    expect(browserManifest.contributes?.widgets).toBeUndefined();
    expect(browserManifest.contributes?.objects).toBeUndefined();
    expect(browserManifest.activation).toEqual([`onSurface:${ARTIFACT_SURFACE}`]);
  });

  it("activation binds the side panel once, and nothing else", async () => {
    const session = await activateWithMockHost(browserRenderer, {
      id: browserManifest.id,
      version: browserManifest.version,
      declaredSurfaces: [ARTIFACT_SURFACE],
    });
    expect([...session.surfaces.keys()]).toEqual([ARTIFACT_SURFACE]);
    // Activation acquires NOTHING: no card exists to claim a surface.
    expect(session.liveSurfaces.size).toBe(0);
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
