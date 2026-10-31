#!/usr/bin/env node
// DK-17 — the RETIRED NAMES (the desk migration's retire table, thinking-desk-migration.md §6; its §9
// Phase 5 witnesses: "the deletion's grep and wall witnesses"). R25 in check-import-boundaries fails a
// re-IMPORT of what the desk replaced; this fails the NAME coming back anywhere in code — a component, a
// token, a package declared or named as a module — comments included, so the code does not go on
// teaching the world the desk retired. Docs and evidence are history and are not read: `*.md`, `docs/`,
// `draft/`, `work/` (evidence logs) and the lockfile.
//
// A file that must NAME a retired thing to hold it absent — a wall, an absence test — is allowed exactly
// the names it holds (ALLOWED below, each with its reason); any other retired name in it still fails.
//
// Usage: node scripts/check-retired-names.mjs [--root <dir>]
//   exit 0 when nothing retired is named; exit 1 with every `file:line  name` otherwise. Cheap: one
//   `git ls-files` and a read of each code file (verify's chain runs it after check:deps).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const argRoot = process.argv.indexOf("--root");
const ROOT = resolve(
  argRoot >= 0 ? (process.argv[argRoot + 1] ?? ".") : join(import.meta.dirname, ".."),
);

/** The retired names: what the retire table deleted, as the code once spelled it. */
export const RETIRED = [
  // the R3F ground, its GL bridge's views and its catalog specimen's old name (row 1)
  { name: "InfiniteCanvasGround", pattern: /\bInfiniteCanvasGround\w*/u },
  { name: "GLViews", pattern: /\bGLViews\b/u },
  // the 0.11 ground's grid and its glyph (row 2)
  {
    name: "the magnet grid's code",
    pattern:
      /\b(?:MagnetGridSection|useMagnetGridGlyph|canvasGridConfig|defaultCanvasGridConfig)\b/u,
  },
  // the tray island (row 4)
  { name: "WidgetTray", pattern: /\bWidgetTray\w*/u },
  // the design kit's card dressing and its overlap knobs (row 6)
  { name: "CardShell", pattern: /\bCardShell\b/u },
  { name: "GlCardChrome", pattern: /\b(?:make)?GlCardChrome\b/u },
  { name: "GlLiftGroup", pattern: /\bGlLiftGroup\b/u },
  { name: "useDragLift", pattern: /\buseDragLift\b/u },
  { name: "--ic-glow / --ic-rim", pattern: /--ic-(?:glow|rim)-/u },
  // the SDK's face mock (row 7)
  { name: "MockSurfaceView", pattern: /\bMockSurfaceView\b/u },
  // the terminal widget's mirror (row 11)
  { name: "the terminal mirror", pattern: /\bTerminalMirror(?:Surface|Preview|Widget)\b/u },
  // the inert stage holds (row 16)
  { name: "useStageHold", pattern: /\buseStageHold\b/u },
  // the R3F packages and ICE's retired entries (row 15; ICE 0.14.0) — three as a MODULE (imported, a
  // `three/` subpath, or declared in a package.json): the word "three" is a fine word in a test
  {
    name: "three (a module)",
    pattern:
      /\b(?:from|import|require)\s*\(?\s*["'`]three(?:\/[^"'`]*)?["'`]|["'`]three\/[^"'`\s]+["'`]/u,
  },
  {
    name: "three (declared)",
    pattern: /"(?:@types\/)?three"\s*:/u,
    only: (rel) => rel === "package.json" || rel.endsWith("/package.json"),
  },
  { name: "@react-three/*", pattern: /@react-three\//u },
  { name: "@vibecook/ice/r3f · /ground", pattern: /@vibecook\/ice\/(?:r3f|ground)\b/u },
  // the dots (the plan's addendum (76)) — and widgetlab's alias for them
  { name: "--vf-canvas-dot", pattern: /--vf-canvas-dot\b/u },
  { name: "--canvas-dot", pattern: /(?<![\w-])--canvas-dot\b/u },
  // DK-17b — what ICE's last prerelease replaced (desk.6; the plan's addendum (72)): the interim presence facet (I42 — the
  // cursor's own `away` and `canvas`), the park poll (I41 — `frame.onParked`), Send to…'s clear-and-restore wait (I40 —
  // `capture({ marks: false })`), the pegboard's re-derived take, walk and scroll (I37 — `tray.lay`, `tray.focus`)
  {
    name: "the interim presence facet",
    pattern: /\b(?:PeerWhere\w*|attachPeerFacet|peerFacetSent)\b|\bpeer-facet\b/u,
  },
  { name: "the park poll", pattern: /\b(?:parkWaitMs|watchPark)\b/u },
  {
    name: "Send to…'s clear-and-restore",
    pattern: /\b(?:marksLeft|MARKS_LEAVE_MS|MARKS_PATIENCE_MS)\b/u,
  },
  { name: "the pegboard's re-derived take", pattern: /\blayAtViewCentre\b|\bpegboard-insert\b/u },
  { name: "the pegboard's own walk and scroll", pattern: /\b(?:stepSpecimen|revealScroll)\b/u },
  // HN — what Cards in Hand retired (LN-D3, HN-1, HN-D3; 2026-10-29): the clipboard tray — its drawer, its store, its
  // fly-in and its chord's row (into the hand); the line's draft, @'s list and their plates, and the line's send (into
  // Chat's thread and a card's play); Send to… (into the desk's Copy) — and the smokes' rows of each
  {
    name: "the clipboard tray",
    pattern: /\b(?:ClipboardTray\w*|[Cc]lipboardStore|useClipboardItems)\b|\bclipboard-store\b/u,
  },
  {
    name: "the clipboard tray's flight and chord",
    pattern: /\btray-flight\b|\b(?:flyToNotch|isClipboardTrayChord)\b|["']clipboard-tray["']/u,
  },
  { name: "@'s list", pattern: /\b(?:AtMenuView|vf-at-menu)\b|(?<![\w-])at-list\b/u },
  {
    name: "the line's draft",
    pattern: /\b(?:ChipFlierView|SendFlightPlate)\b|\bvf-line-(?:input|send|mic|rule|chip)\b/u,
  },
  {
    name: "the line's send",
    pattern: /(?<![\w-])line-send\b|\b(?:sendToLine|useLineSendPhase)\b/u,
  },
  {
    name: "Send to…",
    pattern: /\b(?:sendSelection|sendToRows)\b|(?<![\w-])send-face\b|__vfDesk\.sent\b/u,
  },
  // HN-8 — what Artifacts in the head retired (PL-D1…PL-D3; 2026-10-30): the edge tray — its notch, its sliver, its
  // drawer, their controllers and its sheet (Artifacts into the pill's sheet and the covered views' circle) — the
  // catalog's plates of it, and the covered views' gutter for its slivers
  {
    name: "the edge tray",
    pattern:
      /\b(?:EdgeTray\w*|ArtifactsTray|useEdgeDrawer|EdgeDrawer\w*|EdgesPreview|EdgesPlate|ArtifactsDrawer|COVER_EDGE_CLEAR_PX)\b|\bnotch-path\b|\bvf-edge-tray\b|\bhud\/edge-tray\b/u,
  },
];

/** Files that hold a retired thing ABSENT by naming it — each allowed exactly these names. */
export const ALLOWED = {
  // this file: the list itself
  "scripts/check-retired-names.mjs": "*",
  // the import walls: R2's forbid list and R25's retired specifiers and their self-test fixtures
  "scripts/check-import-boundaries.mjs": "*",
  // bundle:assert's tripwire: three's marker in any chunk fails the build's assert
  "scripts/bundle-report.mjs": ["three (a module)"],
  // the dev server's optimizer names no R3F package
  "tooling/dev-runner/test/vite-server.test.mjs": ["@react-three/*"],
  // no generated page and no scaffold teaches the DOM card
  "tooling/plugin-cli/test/docs-anchors.test.ts": ["CardShell"],
  "tooling/create-plugin/test/output.test.ts": ["CardShell"],
  // the catalog's boundary: the tray island's files stay gone, the field hands no grid projection, and the edge tray,
  // its plates and its suite stay gone with nothing mounting, importing or styling it (HN-8)
  "packages/field-app/test/ui-system-boundaries.test.ts": [
    "WidgetTray",
    "the magnet grid's code",
    "the edge tray",
  ],
  // ChromeLayer takes no stage hold
  "packages/field-app/test/godview-freeze.test.tsx": ["useStageHold"],
  // the dots named nowhere in the product
  "packages/field-app/test/wearing-the-mat.test.tsx": ["--vf-canvas-dot", "--canvas-dot"],
  // the SDK hands a plugin no terminal surface
  "packages/plugin-sdk/test/terminal-wall.test.ts": ["the terminal mirror"],
  // the local peer carries ICE's cursor and no facet of VibeField's (DK-17b)
  "packages/field-app/test/peers-on-the-mat.test.tsx": ["the interim presence facet"],
  // HN: the chrome mounts no clipboard tray, the chords keep no tray row, and neither the line nor its catalog plates
  // draw the draft's field, its send, its mic, its rule or @'s list
  "packages/field-app/test/cards.test.tsx": ["the clipboard tray"],
  "packages/field-app/test/product-chords.test.tsx": ["the clipboard tray's flight and chord"],
  "packages/field-app/test/composer-line.test.tsx": ["the line's draft"],
  "packages/field-app/test/design-system.test.tsx": ["@'s list", "the line's draft"],
};

const CODE = /\.(?:[cm]?[jt]sx?|css|json|ya?ml|html)$/u;
const SKIP = (rel) =>
  rel.endsWith(".md") ||
  rel === "pnpm-lock.yaml" ||
  rel.startsWith("docs/") ||
  rel.startsWith("draft/") ||
  rel.startsWith("work/") ||
  rel.includes("/work/") ||
  rel.includes("node_modules/");

export function findRetired(root = ROOT) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter((rel) => rel !== "" && CODE.test(rel) && !SKIP(rel));
  const hits = [];
  for (const rel of files) {
    let text;
    try {
      text = readFileSync(join(root, rel), "utf8");
    } catch {
      continue; // deleted in the work tree, not yet staged
    }
    const allowed = ALLOWED[rel];
    if (allowed === "*") continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      for (const { name, pattern, only } of RETIRED) {
        if (allowed?.includes(name)) continue;
        if (only !== undefined && !only(rel)) continue;
        if (pattern.test(lines[i])) hits.push({ file: rel, line: i + 1, name });
      }
    }
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hits = findRetired();
  if (hits.length > 0) {
    for (const h of hits) console.error(`${h.file}:${h.line}  ${h.name}`);
    console.error(
      `\ncheck-retired-names: FAIL — ${hits.length} retired name(s) in code (DK-17; the retire table, ` +
        "thinking-desk-migration.md §6). Delete the reference, or — for a wall or an absence test that " +
        "must name it — allow that file exactly that name in scripts/check-retired-names.mjs.",
    );
    process.exit(1);
  }
  console.log("check-retired-names: clean — no retired name in code");
}
