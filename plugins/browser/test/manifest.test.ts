import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { activateWithMockHost } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_SURFACE,
  BLANK_PAGE,
  BROWSER_PAGE_TYPE,
  browserManifest,
  browserRenderer,
} from "../src";
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
      // DT-3: the canvas card's two, and only these two. `surface.capture` is
      // the devtools pack's (DT-4) and `surface.control` is the DT-5 broker's —
      // a browser card mints neither.
      "surface.attach",
      "surface.browser",
    ]);
    // 03·A §5.5 was superseded at DT-D10: the external-overlay mirror retired
    // unbuilt, and this scope left the browser plugin's future with it.
    expect(browserManifest.capabilities).not.toContain("shell.webcontents");
    expect(browserManifest.capabilities).not.toContain("surface.capture");
    expect(browserManifest.capabilities).not.toContain("surface.control");
  });

  it("declares the canvas browser card with the durable props DT-D7 names", () => {
    const widgets = browserManifest.contributes?.widgets ?? [];
    expect(widgets.map((w) => w.type)).toEqual([BROWSER_PAGE_TYPE]);
    const page = widgets[0];
    if (page === undefined) throw new Error("no widget contribution");

    // Intent persists; runtime identity never (DT-D7's two columns).
    expect(Object.keys(page.props).sort()).toEqual(["showChrome", "title", "url"]);
    expect(page.props.url).toEqual({ kind: "string", default: BLANK_PAGE });
    for (const runtime of ["surfaceId", "attachmentId", "producerEpoch", "geometryRevision"]) {
      expect(Object.keys(page.props)).not.toContain(runtime);
    }
    // The conflict-group split: a rename never fights a re-bind.
    expect(page.groups).toEqual({ address: ["url"], title: ["title"], chrome: ["showChrome"] });

    // DT-D6: the card exists to be typed into, so it claims the keyboard —
    // and Escape is the way back out, which is what makes that claim safe.
    expect(page.interaction?.keyboard).toBe("exclusive");
    expect(page.interaction?.keyboardEscape).toBe("release");
  });

  it("DK-2: activation binds the side panel once — and the page card no face", async () => {
    const session = await activateWithMockHost(browserRenderer, {
      id: browserManifest.id,
      version: browserManifest.version,
      declaredWidgets: (browserManifest.contributes?.widgets ?? []).map((w) => w.type),
      declaredSurfaces: [ARTIFACT_SURFACE],
    });
    expect([...session.surfaces.keys()]).toEqual([ARTIFACT_SURFACE]);
    // the desk draws no DOM under the camera: the page widget compiles faceless
    expect(session.bindings.has(BROWSER_PAGE_TYPE)).toBe(false);
    expect(session.bindings.size).toBe(0);
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
