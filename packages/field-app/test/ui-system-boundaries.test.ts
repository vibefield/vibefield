// @vitest-environment node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath: string): string =>
  readFileSync(join(PACKAGE_ROOT, "src", relativePath), "utf8");

/** Every catalog page module: the shell plus each section, discovered so a new
 * section is covered by these boundaries the moment it exists. */
const catalogPageSources = (): string => {
  const sections = readdirSync(join(PACKAGE_ROOT, "src", "design-system", "sections"))
    .filter((name) => name.endsWith(".tsx"))
    .sort()
    .map((name) => source(`design-system/sections/${name}`));
  return [source("design-system/DesignSystemPage.tsx"), ...sections].join("\n");
};

describe("UI system ownership boundaries", () => {
  it("keeps the app and catalog stylesheets as manifests", () => {
    const appManifest = source("styles.css");
    expect(appManifest).toContain('@import "./styles/base.css";');
    expect(appManifest).toContain('@import "./styles/utilities.css";');
    expect(appManifest).toContain('@import "./panels/settings.css";');
    expect(appManifest).toContain('@import "./godview/godview.css";');
    expect(appManifest).toContain('@import "./godview/deck-zoom.css";');
    // AR-5: the monitor's views ship in the puppeteer views package, and their
    // stylesheet enters through the manifest like any other — one row, the
    // package's own bundle, never a copy of its rules.
    expect(appManifest).toContain('@import "@vibecook/puppeteer-views/styles/views.css";');
    // GT-6: the deck's pane frame (record §07) ships in the same package since
    // PU-14 and enters the same way — and AFTER godview.css, so the record's
    // pane rules outrank anything a host still says about a pane.
    expect(appManifest).toContain('@import "@vibecook/puppeteer-views/styles/deck-frame.css";');
    expect(appManifest.indexOf("deck-frame.css")).toBeGreaterThan(
      appManifest.indexOf("godview.css"),
    );
    // AR-8c: History is rosetta's room, and its sheet rides the ROOM'S chunk,
    // never this manifest (2026-10-04): the first paint does not carry it. It
    // enters with the room — one row, the package's own bundle, never a copy of
    // its rules — and lands after the kit's tokens, whose --vf-* names it reads
    // (its README's one ordering rule), by load order: the manifest is the
    // entry's sheet, the room's chunk comes later. The chunk itself is held by
    // the row below and by `pnpm bundle:assert`.
    expect(appManifest).not.toMatch(/@import\s+"@rosetta\/room/);
    expect(source("history/HistoryRoomView.tsx")).toContain(
      'import "@rosetta/room/styles/room.css";',
    );

    const catalogManifest = source("design-system/design-system.css");
    expect(catalogManifest).toContain('@import "./styles/catalog-shell.css";');
    expect(catalogManifest).toContain('@import "./styles/foundations.css";');
    expect(catalogManifest).toContain('@import "./styles/scenes.css";');
    expect(catalogManifest).toContain('@import "./styles/tweaks.css";');
  });

  it("keeps History's room behind its chunk's one dynamic import — nothing in the product imports it statically (2026-10-04)", () => {
    // The room's chunk (`history/room-chunk.tsx`) reaches `HistoryRoomView` —
    // and through it everything under `@rosetta/room`, its sheet included — by
    // ONE dynamic import. A static import anywhere in the product pulls the
    // room back onto the canvas's chunk (or the first paint); `import type` is
    // erased and costs nothing, while `import { type X }` is NOT (under
    // verbatimModuleSyntax it stays a bare import of the module). The catalog
    // mounts the view directly — it is its own build.
    const offenders: string[] = [];
    const walk = (relativeDir: string): void => {
      for (const entry of readdirSync(join(PACKAGE_ROOT, "src", relativeDir), {
        withFileTypes: true,
      })) {
        const relativePath = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (relativePath !== "design-system") walk(relativePath);
        } else if (/\.tsx?$/.test(entry.name) && relativePath !== "history/HistoryRoomView.tsx") {
          const text = source(relativePath);
          if (/^import\s+(?!type\s)[^;]*?from\s+"[^"]*\/HistoryRoomView"/m.test(text)) {
            offenders.push(`${relativePath}: imports HistoryRoomView statically`);
          }
          if (
            /^import\s+(?!type\s)[^;]*?from\s+"@rosetta\/room(?:\/[^"]*)?"/m.test(text) ||
            /^import\s+"@rosetta\/room/m.test(text)
          ) {
            offenders.push(`${relativePath}: imports @rosetta/room's code or sheet`);
          }
        }
      }
    };
    walk("");
    expect(offenders).toEqual([]);
    expect(source("history/room-chunk.tsx")).toContain('import("./HistoryRoomView")');
    expect(source("history/HistoryView.tsx")).toMatch(/<HistoryRoomMount\s/u);
  });

  it("does not let catalog CSS own production component selectors", () => {
    const catalogCss = [
      source("design-system/styles/catalog-shell.css"),
      source("design-system/styles/foundations.css"),
      source("design-system/styles/scenes.css"),
      source("design-system/styles/tweaks.css"),
    ].join("\n");

    expect(catalogCss).not.toMatch(
      /^\.vf-(?:artifact|godview\b|widget-tray\b|command-palette\b|palette-|settings-dialog\b|loading-veil\b|terminal-picker\b|deck-zoom\b|me\b|me-|face\b|face-|face-picker|settings-account|edge-tray\b|views\b|views-|cover\b|cover-|history\b|history-|line\b|line-|at-|head\b|head-|menu\b|menu-|ah-|tr-|bar\b|bar-|status-line|stories\b|stories-|story\b|story-)/m,
    );
  });

  it("keeps the face's own styling free of colour literals of any spelling (UA-7)", () => {
    // The one colour a face carries is its emoji's (DESIGN.md §2.8, I-1).
    for (const stylesheet of [
      source("account/FacePicker.css"),
      source("account/MeMenu.css"),
      readFileSync(join(PACKAGE_ROOT, "../design-kit/src/face.css"), "utf8"),
    ]) {
      expect(stylesheet).not.toMatch(/#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch)\(/i);
    }
  });

  it("keeps UA-7's boot-reachable modules on leaf entries, never a barrel", () => {
    // The Setup Assistant mounts these, so they take the kit's and the face
    // policy's leaf entries (`/face`, `/primitives`, `/user-face`).
    for (const module of [
      "account/FacePicker.tsx",
      "account/faces.ts",
      "account/use-account.ts",
      "boot/onboarding/onboarding-views.tsx",
      "boot/onboarding/OnboardingWizard.tsx",
    ]) {
      expect(source(module), module).not.toMatch(/from "@vibefield\/(?:contracts|design-kit)";/);
    }
  });

  it("keeps the spend specimen's fixture an ADAPTER: the package's own afternoon on a door, never the view's markup (MV-7)", () => {
    // The specimen is the shipping spend view through the shipping Godview
    // (`GodviewPreview`), and its fixture supplies only what a desktop's model
    // board supplies — rows, from the views package's own afternoon — never a
    // drawing, a class of the view's or a cost of its own making.
    const section = source("design-system/sections/GodviewSection.tsx");
    expect(section).toMatch(/<GodviewPreview door=\{moneyDoor\} initialView="spend"/);
    const fixture = source("design-system/godview-spend-fixtures.ts");
    expect(fixture).toMatch(
      /import \{[^}]*spendAfternoon[^}]*spendRows[^}]*\} from "@vibecook\/puppeteer-views"/,
    );
    expect(fixture).not.toMatch(/vf-monitor-spend|mv-spend/);
    expect(fixture).not.toMatch(/<[a-z]+[\s/>]/);
    expect(fixture).not.toMatch(/\b(usd|series|steps):/);
  });

  it("keeps the view frame's fixture an ADAPTER — the owner's value, never the frame's markup (FR-1)", () => {
    // The catalog stands in for the one thing a host supplies — the window's
    // view, which main owns in the product — and for the keys' timing, which the
    // controller owns. The track, the cover and History's room are the shipping
    // views, and their selectors are the product's alone. (AR-8c: History's
    // room is the shipping view over the package's fixture ports.)
    const fixture = source("design-system/ViewFramePreview.tsx");
    expect(fixture).toContain("ViewsTrackView");
    expect(fixture).toContain("ViewCoverView");
    expect(fixture).toContain("HistoryPreview");
    // the cover's motion is the product's own rule, not a fixture's copy of it
    expect(fixture).toContain("coverAfter");
    expect(fixture).not.toMatch(/className="vf-(?:views|cover|history-room)/);
    expect(fixture).not.toContain("<style");
    // and the fixture never reaches the owner a host would hold
    expect(fixture).not.toContain("requestView");
    expect(fixture).not.toContain("getHost");
  });

  it("starts History's layer at the head band's foot and ends it at the reserve, so the room's dialogs never cover the band (2026-10-04; the Peek's button, 2026-10-08)", () => {
    // The room's dialogs centre in the layer they portal into: the band 0–52 is
    // the head's and keeps the window's lights and the frame's search button
    // (DESIGN.md §8 "History"). vitest loads no CSS, so the rule is held here
    // and its geometry by the catalog's photographs.
    const css = source("history/history-room-view.css");
    const rule = css.match(/^\.vf-history-layers \{([^}]*)\}/m)?.[1] ?? "";
    expect(rule).toContain("inset: var(--vf-history-head) 0 var(--vf-history-reserve) 0;");
    expect(rule).toContain("contain: layout;");
    const view = source("history/HistoryRoomView.tsx");
    expect(view).toMatch(/"--vf-history-head": `\$\{HEAD_BAND_PX\}px`/u);
    expect(view).toContain("portalContainer={layers}");
  });

  it("retires rosetta's room glass on the desk — the room's fades are the cover's tint, never a backdrop filter (DK-15, R16)", () => {
    // DESIGN.md §8 "The covers over the desk": under a cover the desk is a still
    // blurred once, and the room's host-surface frost (a 14px backdrop filter on
    // the transcript's top fade and the sticky day heads) would re-blur it every
    // frame anything beneath moved. vitest loads no CSS; the rule is held here and
    // the computed style by smoke:canvas's COVER HISTORY row.
    const css = source("history/history-room-glass.css");
    const block =
      /\.vf-history \.ah-frame\[data-ah-surface="host"\] \.tr-frost::before,\s*\.vf-history \.ah-frame\[data-ah-surface="host"\] \.ah-day::before \{([^}]*)\}/u.exec(
        css,
      )?.[1] ?? "";
    expect(block).toContain("backdrop-filter: none;");
    expect(block).toContain("-webkit-backdrop-filter: none;");
    expect(block).toContain("background: var(--vf-chrome-solid);");
    expect(css).not.toMatch(/backdrop-filter:\s*blur/);
    // in the room's own chunk: only the room's view imports it, after the room's sheet
    const view = source("history/HistoryRoomView.tsx");
    expect(view.indexOf('import "./history-room-glass.css";')).toBeGreaterThan(
      view.indexOf('import "@rosetta/room/styles/room.css";'),
    );
    expect(source("history/HistoryOpening.tsx")).not.toContain("history-room-glass.css");
  });

  it("keeps History's fixture an ADAPTER — the package's fixture ports, never the room's markup (AR-8c)", () => {
    // The catalog stands in for what a host supplies — the room's four ports —
    // and takes them from the room package's own fixture entry; the view it
    // mounts is the shipping composition, and the room's markup and CSS are
    // the package's. Never the room's or the view's own classes, never a
    // stylesheet, never the product's doors or the host.
    const preview = source("design-system/HistoryPreview.tsx");
    const fixtures = source("design-system/history-fixtures.ts");
    expect(preview).toContain("HistoryRoomView");
    expect(preview).toMatch(/<Composer\s/u);
    expect(fixtures).toContain('from "@rosetta/room/fixtures"');
    for (const file of [preview, fixtures]) {
      expect(file).not.toMatch(/className="(?:ah-|tr-|vf-history)/);
      expect(file).not.toContain("<style");
      expect(file).not.toContain("getHost");
      expect(file).not.toContain("useFielddClient");
      expect(file).not.toContain("historyPortsOver");
    }
    // The product composition is the room's ONLY mount: the view draws no
    // replica of a column, a panel or a state the package draws.
    const view = source("history/HistoryRoomView.tsx");
    expect(view).toMatch(/<HistoryRoom\s/u);
    expect(view).not.toMatch(/className="(?:ah-|tr-)/);
  });

  it("keeps the Peek's fixture an ADAPTER — the shipping controller over a port drawn from the room's demo, never its markup (2026-10-08)", () => {
    // The catalog stands in for what the frame supplies — the Peek's port, the
    // open surface, the place a pick opens — and draws the plate's view by the
    // product's own recede rule. Never the Peek's classes, never a stylesheet,
    // never the product's doors or fieldd's client.
    const preview = source("design-system/PeekPreview.tsx");
    const fixtures = source("design-system/peek-fixtures.ts");
    // P2: Live now's plate — the same controller in Godview over the door the
    // monitor publishes, as a fixture holds it; never the live pane's terminals
    const live = source("design-system/peek-live-fixtures.ts");
    expect(preview).toContain("peekLiveFixtureDoor");
    expect(preview).not.toContain("LivePeekPane");
    expect(preview).toMatch(/<Peek\s/u);
    expect(preview).toMatch(/<HistoryRoomView\s/u);
    expect(preview).toContain("peekFixturePort");
    expect(preview).toContain("data-peek-recede");
    expect(fixtures).toContain('from "@rosetta/room/fixtures"');
    for (const file of [preview, fixtures, live]) {
      expect(file).not.toMatch(/className="(?:vf-peek|ah-|tr-|vf-history)/);
      expect(file).not.toContain("<style");
      expect(file).not.toContain("getHost");
      expect(file).not.toContain("useFielddClient");
      expect(file).not.toContain("peekPortOver");
      expect(file).not.toContain("openHistoryAt");
    }
  });

  it("recedes the field under the Peek and holds it out of reach — at rest no transform, so no stacking context (2026-10-08)", () => {
    // DESIGN.md §6: the view AND the frame recede to 0.98 about 50% 46% over
    // 420ms on the island curve while the Peek stands; its scrim and popup are
    // drawn on the document's body, outside the field. A resting transform
    // would bury the head under the drag strip (BootRoot, 2026-07-22).
    const field = source("field.tsx");
    expect(field).toContain(
      '<div className="field-recede" data-peek-recede={searching ? "true" : "false"}>',
    );
    expect(field).toContain("inert={searching}");
    // What recedes is what you see — the still and the chrome, the cover with
    // it — and never the desk's own box (DK-15): the keyed scene comes BEFORE
    // the recede's box and outside it; the still and the chrome inside it; the
    // field's wrapper carries no recede of its own.
    const wrap = field.slice(field.indexOf('className="field-wrap"'));
    const at = (needle: string): number => wrap.indexOf(needle);
    expect(wrap.slice(0, at('className="field-scene"'))).not.toContain("data-peek-recede");
    expect(at('className="field-scene"')).toBeGreaterThan(-1);
    expect(at('className="field-scene"')).toBeLessThan(at('className="field-recede"'));
    expect(at("<CoverStill")).toBeGreaterThan(at('className="field-recede"'));
    expect(at("<ChromeLayer")).toBeGreaterThan(at("<CoverStill"));
    // At rest the box is only a box: no transform, z-index, opacity, filter,
    // isolation, containment or will-change — so no stacking context, and the
    // chrome stacks as the field's own children did — and it takes no pointer
    // while its children take theirs back at NO specificity (a child's own
    // `pointer-events` still rules).
    const base = source("styles/base.css");
    const box = base.match(/^\.field-recede \{([^}]*)\}/m)?.[1] ?? "";
    expect(box).toContain("position: absolute;");
    expect(box).toContain("inset: 0;");
    expect(box).toContain("pointer-events: none;");
    expect(box).not.toMatch(/transform|z-index|opacity|filter|isolation|contain|will-change/);
    expect(base).toMatch(/^:where\(\.field-recede\) > \* \{\s*pointer-events: auto;\s*\}/m);
    const css = source("frame/peek.css");
    const resting = css.match(/^\[data-peek-recede\] \{([^}]*)\}/m)?.[1] ?? "";
    expect(resting).toContain("transform-origin: 50% 46%;");
    expect(resting).toContain("transition: transform 420ms var(--vf-ease-island);");
    expect(resting).not.toMatch(/transform:/);
    const receding = css.match(/^\[data-peek-recede="true"\] \{([^}]*)\}/m)?.[1] ?? "";
    expect(receding).toContain("transform: scale(0.98);");
    // the scrim and the popup: the search tokens, the popup's corners and ring
    expect(css).toContain("background: var(--vf-search-scrim);");
    expect(css).toContain("backdrop-filter: blur(18px) saturate(0.9);");
    expect(css).toContain("var(--vf-shadow-search)");
    expect(css).toContain("animation: vf-peek-pop 260ms var(--vf-ease-island);");
    const peek = source("frame/Peek.tsx");
    expect(peek).toContain("container === undefined ? document.body : container");
  });

  it("keeps the head's fixture an ADAPTER — the doors' facts, never the head's markup (FR-3)", () => {
    // The catalog stands in for what a host supplies — the document manager,
    // the head's canvas door (the path, the zoom) and the frame's one owner of
    // the open surface — and mounts the shipping head over them: the view on
    // fixture props for the plates, the real controller for the playground.
    const fixture = source("design-system/HeadPreview.tsx");
    expect(fixture).toContain("HeadView");
    expect(fixture).toMatch(/<Head\s/u);
    expect(fixture).not.toMatch(/className="vf-(?:head|menu)/);
    expect(fixture).not.toContain("<style");
    // …and never the engine a host would hold, or the host itself.
    expect(fixture).not.toContain("canvasHead");
    expect(fixture).not.toContain("createCanvasEngine");
    expect(fixture).not.toContain("getHost");
    // The palette's fixture draws the product's own table of the frame's acts.
    const palette = source("design-system/CommandPalettePreview.tsx");
    expect(palette).toContain("CommandPaletteView");
    expect(palette).toContain("frameActGroups");
    expect(palette).not.toMatch(/className="vf-(?:palette|menu|command-palette)/);
  });

  it("keeps Godview's head the monitor's own — the catalog mounts the monitor, never the head's markup or CSS (GV-D1)", () => {
    // The head is the monitor host's chrome: `GodviewMonitor` mounts the
    // shipping `GodviewHeadView` in its slot, and the catalog shows it by
    // mounting the monitor on its fixture doors (`GodviewPreview`). No catalog
    // module writes one of the head's classes, imports its view to rebuild it,
    // or restyles it; the one thing the catalog stages is its own button for
    // the System control panel, which the product reaches from the palette.
    const monitor = source("godview/GodviewMonitor.tsx");
    expect(monitor).toMatch(/const MonitorHead = memo\(GodviewHeadView\);/);
    expect(monitor).toMatch(
      /<div className="vf-stories-slot">\s*<ChromeBoundary name="Monitor views">\s*<MonitorHead\s/u,
    );
    expect(monitor).not.toContain("InstrumentBar");
    expect(monitor).not.toContain("BarControl");
    expect(source("godview/GodviewHeadView.tsx")).toContain('import "./godview-head.css";');
    // System control left with the bar for the palette: the frame runs it
    // through the door the overlay publishes, never a prop through the frame.
    expect(source("field/ChromeLayer.tsx")).toMatch(
      /case "system-control":\s*runSystemControl\(\);/,
    );
    expect(source("godview/GodviewOverlay.tsx")).toContain("publishSystemControlDoor(");
    expect(monitor).not.toContain("tuningOpen");
    expect(monitor).not.toContain("onToggleTuning");
    const preview = source("design-system/GodviewPreview.tsx");
    expect(preview).toMatch(/<GodviewMonitor\s/u);
    expect(preview).not.toContain("GodviewHeadView");
    const catalogCss = [
      source("design-system/styles/catalog-shell.css"),
      source("design-system/styles/foundations.css"),
      source("design-system/styles/scenes.css"),
      source("design-system/styles/tweaks.css"),
    ].join("\n");
    expect(catalogCss).not.toMatch(/vf-stor(?:y|ies)/);
    const walk = (relativeDir: string): string[] =>
      readdirSync(join(PACKAGE_ROOT, "src", relativeDir), { withFileTypes: true }).flatMap(
        (entry) =>
          entry.isDirectory()
            ? walk(`${relativeDir}/${entry.name}`)
            : /\.tsx?$/.test(entry.name)
              ? [`${relativeDir}/${entry.name}`]
              : [],
      );
    for (const module of walk("design-system")) {
      expect(source(module), module).not.toMatch(/vf-stor(?:y|ies)/);
      expect(source(module), module).not.toMatch(/from "[^"]*\/GodviewHeadView"/);
    }
  });

  it("keeps the corner's fixture an ADAPTER — the account's and the theme's facts, never the menu's markup (FR-4)", () => {
    // The catalog stands in for what a host supplies — the account and the
    // theme's owner (main's) — and mounts the shipping Me menu and Settings →
    // Appearance over them. Never the menu's own classes, never the owner.
    const fixture = source("design-system/CornerPreview.tsx");
    expect(fixture).toContain("MeMenuView");
    expect(fixture).toContain("AppearanceSectionView");
    expect(fixture).not.toMatch(/className="vf-(?:me|ui-segmented)/);
    expect(fixture).not.toContain("<style");
    expect(fixture).not.toContain("getHost");
    expect(fixture).not.toContain("useAppTheme");
    expect(fixture).not.toContain("setAppTheme");
  });

  it("keeps the edges' fixture an ADAPTER — tiles and an open drawer, never the trays' markup (FR-4)", () => {
    // The catalog stands in for what a host supplies — the stills, which drawer
    // the owner holds, the view — and mounts the shipping tray view on both
    // sides, with the Hub through its plugin's own fixture door.
    const fixture = source("design-system/EdgesPreview.tsx");
    expect(fixture).toContain("EdgeTrayView");
    expect(fixture).toContain("ArtifactPanelPreview");
    expect(fixture).not.toMatch(/className="vf-(?:edge-tray|artifact|side-panel)/);
    expect(fixture).not.toContain("<style");
    expect(fixture).not.toContain("getHost");
    expect(fixture).not.toContain("useVisiblePluginSurfaces");
  });

  it("keeps the selection bar's fixture an ADAPTER — the product's own model over fixture selections, never the bar's markup (DK-11)", () => {
    // The catalog stands in for what a host supplies — the desk's anchor (a box on the plate) and the selection's
    // facts — and mounts the shipping bar over them, its cells and rows read by the product's own model. Never the
    // bar's own classes, never a stylesheet, never the desk's doors or the host.
    const fixture = source("design-system/SelectionBarPreview.tsx");
    expect(fixture).toContain("SelectionBarView");
    // the CALLS, not the names (an import alone would satisfy a name) — DK-12: the tools in hand's too
    for (const model of ["barCells(", "menuGroups(", "menuEyebrow(", "handCells("])
      expect(fixture).toContain(model);
    expect(fixture).not.toMatch(/className="vf-bar/);
    expect(fixture).not.toContain("<style");
    // the doors a host holds, and the controller (`<SelectionBar` — never `SelectionBarView`)
    for (const door of [/\bgetHost\b/, /\bcurrentDesk\b/, /\bpublishDesk\b/, /<SelectionBar\s/]) {
      expect(fixture).not.toMatch(door);
    }
  });

  it("keeps the pegboard's fixture an ADAPTER — the product's model over a fixture tray, never its markup (DK-13)", () => {
    // The board is the desk's (drawn on the GPU); the catalog stands a plain board in where it lies and mounts the
    // shipping chrome over a fixture anchor, placed and filled by the product's own model — never the pegboard's own
    // classes, never a stylesheet, never the desk's doors or the controller.
    const fixture = source("design-system/PegboardPreview.tsx");
    expect(fixture).toMatch(/<PegboardView\s/u);
    for (const model of ["placeFilters(", "filterOptions("]) expect(fixture).toContain(model);
    expect(fixture).not.toMatch(/className="vf-pegboard/u);
    expect(fixture).not.toContain("<style");
    for (const door of [/\bgetHost\b/u, /\bcurrentDesk\b/u, /\bpublishDesk\b/u, /<Pegboard\s/u])
      expect(fixture).not.toMatch(door);
  });

  it("keeps the peers' fixture an ADAPTER — the product's model over fixture peers, never their markup (DK-16)", () => {
    // The arrows and chips are the shipping views; the catalog stands in what a host supplies — a camera and the room's
    // names — and places them by the product's own model. Never the peers' own classes, never a stylesheet, never the
    // desk's doors, the presence session or the controller.
    const fixture = source("design-system/PeersPreview.tsx");
    expect(fixture).toMatch(/<PeersLayerView\s/u);
    expect(fixture).toMatch(/<PeerCursorView\s/u);
    for (const model of ["arrowBoxAt(", "peerLabel("]) expect(fixture).toContain(model);
    expect(fixture).not.toMatch(/className="vf-peer/u);
    expect(fixture).not.toContain("<style");
    for (const door of [
      /\bgetHost\b/u,
      /\bcurrentDesk\b/u,
      /\busePresencePeers\b/u,
      /<PeersOnTheMat\s/u,
    ])
      expect(fixture).not.toMatch(door);
  });

  it("keeps the live-surface fixture an ADAPTER — a host, never a painter (DT-2b-2)", () => {
    // The temptation for a widget whose pixels need a privileged producer is to
    // draw convincing ones. The catalog is held to supplying what a HOST
    // supplies — a transport, a pool, a ticket, frames — and to owning no
    // painting: a second canvas here would be a replica of the shipping view,
    // drifting from it the moment either changed.
    const section = source("design-system/sections/LiveSurfacesSection.tsx");
    expect(section).toContain("LiveSurfaceView");
    expect(section).not.toContain("<canvas");
    // A CALL, not a mention: the section's own prose names the view's
    // `drawImage` path, and a bare substring match would forbid explaining it.
    expect(section).not.toMatch(/drawImage\s*\(/);
    expect(section).not.toContain("<style");
    // The ACQUIRER releases (03·A C-3): a section mounts and unmounts, and a
    // claim it forgot would hold an attachment for the life of the tab.
    expect(section).toMatch(/\.release\(\)/);
    expect(section).toMatch(/\.dispose\(\)/);
    // And the fixture host stays OUT of the catalog tree on purpose: it needs
    // the real `@vibefield/live-surfaces` transport (the attachment class has
    // private fields, so no structural fake can reach `LiveSurfacePresentation`),
    // which the cross-package door rule below forbids inside design-system/.
    expect(source("surfaces/fixture/fixture-surface-host.ts")).toContain(
      "LiveSurfaceRendererTransport",
    );
  });

  it("keeps cross-package catalog composition on design-system doors", () => {
    // The catalog composes another workspace package only through its stated
    // doors — the design-kit foundation, contracts types, or the package's own
    // `/design-system` fixture-adapter entry (the plugin-browser precedent,
    // docs/UI_SYSTEM.md §Catalog fidelity). Any other internal path would let
    // the catalog quietly grow a private copy of a package's seam, which is the
    // replica rule's failure mode arriving through the import graph.
    const allowedDoor = (specifier: string): boolean =>
      specifier === "@vibefield/contracts" ||
      specifier === "@vibefield/design-kit" ||
      specifier.startsWith("@vibefield/design-kit/") ||
      /^@vibefield\/[^/]+\/design-system$/.test(specifier);
    const offenders: string[] = [];
    const visit = (relativeDir: string): void => {
      for (const entry of readdirSync(join(PACKAGE_ROOT, "src", relativeDir), {
        withFileTypes: true,
      })) {
        const relativePath = `${relativeDir}/${entry.name}`;
        if (entry.isDirectory()) {
          visit(relativePath);
        } else if (/\.tsx?$/.test(entry.name)) {
          for (const match of source(relativePath).matchAll(/from\s+"(@vibefield\/[^"]+)"/g)) {
            const specifier = match[1] ?? "";
            if (!allowedDoor(specifier)) offenders.push(`${relativePath} → ${specifier}`);
          }
        }
      }
    };
    visit("design-system");
    expect(offenders).toEqual([]);
  });

  it("mounts production views instead of the retired catalog replicas", () => {
    const page = catalogPageSources();
    const onboarding = source("design-system/OnboardingPreview.tsx");
    const swarmBodies = source("design-system/SwarmBodiesPreview.tsx");
    const groundWorkbench = source("design-system/CanvasGroundWorkbench.tsx");
    const groundPreview = source("design-system/DeskPreview.tsx");
    const paneFrame = source("design-system/PaneFramePreview.tsx");
    const paneLauncher = source("design-system/PaneLauncherPreview.tsx");
    const switchScene = source("design-system/SwitchPreview.tsx");
    const viewFrame = source("design-system/ViewFramePreview.tsx");
    const line = source("design-system/ComposerLinePreview.tsx");
    const head = source("design-system/HeadPreview.tsx");
    const palette = source("design-system/CommandPalettePreview.tsx");
    const corner = source("design-system/CornerPreview.tsx");
    const edges = source("design-system/EdgesPreview.tsx");
    const history = source("design-system/HistoryPreview.tsx");
    const bar = source("design-system/SelectionBarPreview.tsx");
    const pegboard = source("design-system/PegboardPreview.tsx");
    const peers = source("design-system/PeersPreview.tsx");
    const peek = source("design-system/PeekPreview.tsx");
    const catalog = `${peers}\n${pegboard}\n${bar}\n${history}\n${peek}\n${corner}\n${edges}\n${page}\n${onboarding}\n${swarmBodies}\n${groundWorkbench}\n${groundPreview}\n${paneFrame}\n${paneLauncher}\n${switchScene}\n${viewFrame}\n${line}\n${head}\n${palette}`;
    for (const productionView of [
      "ArtifactPanelPreview",
      "CommandPalettePreview",
      "CommandPaletteView",
      "GodviewPreview",
      "LoadingVeilView",
      "SettingsDialog",
      "MeMenuView",
      "SwitchSceneView",
      "FacePicker",
      "UserFaceView",
      // DK-13 — the scenes' board: the pegboard's chrome over the desk's drawer's stand-in (the old
      // Objects sheet, `WidgetTrayFrame`, deleted with its island's state — R21)
      "StageBoard",
      "EdgeTrayView",
      "OnboardingConnectPaneView",
      "OnboardingDerivingPaneView",
      "OnboardingFieldPaneView",
      "OnboardingFinishingPaneView",
      "OnboardingPosturePaneView",
      "OnboardingReadyPaneView",
      "OnboardingSettingUpPaneView",
      "OnboardingUsersPaneView",
      "OnboardingWelcomeBackPaneView",
      "OnboardingWelcomePaneView",
      "WizardShellView",
      "SwarmBodiesPreview",
      "swarmMonitorView",
      "CanvasGroundWorkbench",
      // the ground specimen mounts the desk through the field's own layer (DK-3)
      "DeskPreview",
      "fieldDeskLayer",
      // DK-3 — when the desk can't draw: the stage's card and the status line's banner
      "DeskUnavailableView",
      "StatusLineView",
      "LiveSurfaceView",
      "PaneFramePreview",
      "PaneFrameChrome",
      "PaneLauncherPreview",
      "PaneLauncherChrome",
      // One Frame FR-1 — the view frame: the track, the cover, History's room
      "ViewFramePreview",
      "ViewsTrackView",
      "ViewCoverView",
      // AR-8c — History: the shipping view over the room package's fixtures,
      // in every state the host owns, and the line's Resume live for a choice
      "HistoryPreview",
      "HistoryRoomView",
      "HistoryResumePlate",
      // …and its search, the frame's Peek (2026-10-08): the shipping
      // controller over a fixture port drawn from the same room demo
      "PeekPlate",
      "Peek",
      // …and the two faces before the room, as they ship (2026-10-04)
      "HistoryOpeningState",
      "HistoryOpenFailedState",
      // One Frame FR-2 — the line: its view, @'s list, the plates, and the
      // live line on its real controller with fixture doors
      "ComposerLinePlate",
      "ComposerLineView",
      "AtMenuView",
      // DK-14 — Send to…'s chip faces on the shipping line, and its flier frozen in flight
      "SendFlightPlate",
      "ChipFlierView",
      // One Frame FR-3 — the head: its view, a plate per state, and the live
      // head on its real controller over fixture doors (the file pill, the
      // breadcrumbs and the − % + pill retired into it)
      "HeadPlate",
      "HeadView",
      "HeadLive",
      // One Frame FR-4 — the corner: the Me menu above the line with Theme, a
      // plate per Theme it holds, and Settings → Appearance, the same setting
      "CornerPlate",
      "AppearancePlate",
      "AppearanceSectionView",
      // One Frame FR-4 — the edges: both notches in every view, the slivers,
      // and Artifacts' drawer holding the Hub (the side panel retired into it)
      "EdgesPlate",
      "ArtifactsDrawer",
      // DK-11 — the desk's selection bar over fixture selections, and grown into its menu
      "SelectionBarPlate",
      "SelectionBarView",
      // DK-12 — the same bar as the tools in hand, over the four specimens' fixture hands
      "HandPlate",
      // DK-13 — the pegboard's chrome over a fixture tray, placed by the product's own model
      "PegboardPlate",
      "PegboardView",
      "placeFilters",
      "filterOptions",
      // DK-16 — the peers on the mat over fixture peers, placed by the product's own model
      "PeersPlate",
      "PeersLayerView",
      "PeerCursorView",
      "arrowBoxAt",
      "peerLabel",
    ]) {
      expect(catalog).toContain(productionView);
    }
    // …and the line's and the head's own controllers, live on fixture doors —
    // the elements, not the views' names they prefix.
    expect(catalog).toMatch(/<Composer\s/u);
    expect(catalog).toMatch(/<Head\s/u);
    // …and the corner's and the edges' plates MOUNTED on the page, not merely
    // defined (FR-4).
    expect(page).toMatch(/<CornerPlate\s/u);
    expect(page).toMatch(/<AppearancePlate\s/u);
    expect(page).toMatch(/<EdgesPlate\s/u);
    expect(page).toMatch(/<ArtifactsDrawer\s/u);
    // …and the selection bar's plates mounted (DK-11), and the pegboard's (DK-13).
    expect(page).toMatch(/<SelectionBarPlate\s/u);
    expect(page).toMatch(/<PegboardPlate\s/u);
    // …and the peers' plates (DK-16)
    expect(page).toMatch(/<PeersPlate\s/u);
    // …and Send to…'s flight (DK-14)
    expect(page).toMatch(/<SendFlightPlate\s/u);
    // …and the board risen behind the line in both scenes that raise Objects (the playground, the view frame's stage)
    expect(page).toMatch(/<StageBoard\s/u);
    expect(viewFrame).toMatch(/<StageBoard\s/u);
    // …and History's plates mounted on the page in each state the host owns
    // (AR-8c): the room, a choice with Resume live, unavailable, consent.
    expect(page).toMatch(/<HistoryPreview state="room"/u);
    expect(page).toMatch(/<HistoryResumePlate\s/u);
    // …and a choice that runs here, the line's create saying Jump to (P3)
    expect(page).toMatch(/<HistoryResumePlate live\s/u);
    expect(page).toMatch(/<PeekPlate state="closed"/u);
    expect(page).toMatch(/<PeekPlate state="open"/u);
    expect(page).toMatch(/<HistoryPreview state="unavailable"/u);
    expect(page).toMatch(/<HistoryPreview state="consent"/u);
    // …and the faces before the room (2026-10-04): opening, could not open.
    expect(page).toMatch(/<HistoryOpeningState\s*\/>/u);
    expect(page).toMatch(/<HistoryOpenFailedState\s/u);

    // The Settings specimen's Appearance page was a replica the product never
    // had (a system-appearance switch, an interface scale); it is the shipping
    // view now (FR-4).
    expect(page).not.toContain("Use system appearance");
    expect(page).not.toContain("Interface scale");
    for (const retiredReplica of [
      "vf-ds-artifact-panel",
      "vf-ds-file-island",
      "vf-ds-godview-stage",
      "vf-ds-palette-results",
      "vf-ds-settings-demo",
      "vf-ds-tray-island",
    ]) {
      expect(page).not.toContain(retiredReplica);
    }
  });

  it("keeps visual experimentation in Studio and the product appearance stable", () => {
    const boot = source("boot/BootRoot.tsx");
    const field = source("field.tsx");
    const stage = source("field/CanvasStage.tsx");
    const workbench = source("design-system/CanvasGroundWorkbench.tsx");

    expect(boot).not.toContain("VisualTweak");
    expect(boot).not.toContain("dev-tweaks");
    expect(field).not.toContain("VisualTweak");
    expect(field).toContain("effectiveProductAppearance");
    expect(field).toContain("productAppearanceCssVariables(effectiveAppearance, dark)");
    // DK-3 (the host swap): the stage mounts ICE's desk with the field's own layer,
    // and the appearance document's GRID half no longer reaches it — the desk's
    // grid is the layer's (the mat, rulers at 60; DESIGN.md §2.1's erratum), so the
    // 0.11 magnet projection the field once handed the ground has no consumer.
    expect(stage).toMatch(/<Desk\s+engine=\{ce\}\s+layer=\{layer\}/u);
    expect(stage).toContain("fieldDeskLayer(");
    // DK-16: the room's other people are the desk's child — in its own box, under its engine — while it draws
    expect(stage).toMatch(/<Desk[^>]*>\s*<PeersOnTheMat\s+drawing=\{drawing\}\s*\/>\s*<\/Desk>/u);
    expect(field).not.toContain("canvasGridConfig(");
    expect(workbench).toContain("ProductAppearance");
    expect(workbench).not.toContain("useState");
  });

  it("keeps static component styling out of embedded style tags", () => {
    for (const component of [
      "boot/BootRoot.tsx",
      "hud/CommandPalette.tsx",
      "hud/edge-tray/EdgeTray.tsx",
      "hud/edge-tray/EdgeTrayView.tsx",
      "hud/LoadingVeil.tsx",
      "boot/onboarding/wizard-ui.tsx",
      "godview/GodviewMonitor.tsx",
      "godview/GodviewHeadView.tsx",
      "frame/ViewFrame.tsx",
      "frame/ViewsTrack.tsx",
      "frame/ViewCover.tsx",
      "history/HistoryRoomView.tsx",
      "history/HistoryView.tsx",
      "frame/Peek.tsx",
      "frame/PeekView.tsx",
      "frame/Composer.tsx",
      "frame/ComposerLine.tsx",
      "frame/Head.tsx",
      "frame/HeadView.tsx",
      "account/MeMenu.tsx",
      "panels/AppearanceSection.tsx",
      "field/desk/bar/SelectionBar.tsx",
      "field/desk/bar/SelectionBarView.tsx",
      "field/desk/bar/KindGlyph.tsx",
      "frame/StatusLine.tsx",
      "field/desk/pegboard/Pegboard.tsx",
      "field/desk/pegboard/PegboardView.tsx",
      "field/desk/peers/PeersOnTheMat.tsx",
      "field/desk/peers/PeersView.tsx",
    ]) {
      expect(source(component)).not.toContain("<style");
    }
  });

  it("keeps colocated production CSS on semantic tokens", () => {
    for (const stylesheet of [
      "account/FacePicker.css",
      "account/MeMenu.css",
      "boot/boot.css",
      "boot/onboarding/wizard-ui.css",
      "hud/CommandPalette.css",
      "hud/edge-tray/edge-tray.css",
      "hud/LoadingVeil.css",
      "hud/PluginSurfaceSlot.css",
      "panels/settings.css",
      "panels/terminal/terminal-settings.css",
      "godview/deck-zoom.css",
      "godview/godview-head.css",
      "frame/view-frame.css",
      "history/history-room-view.css",
      "history/history-room-glass.css",
      "field/desk/cover-still.css",
      "frame/composer.css",
      "frame/head.css",
      "frame/menu.css",
      "frame/status-line.css",
      "frame/peek.css",
      "field/desk/bar/selection-bar.css",
      "field/desk/pegboard/pegboard.css",
      "field/desk/peers/peers.css",
    ]) {
      expect(source(stylesheet), stylesheet).not.toMatch(/#[\da-f]{3,8}\b/i);
    }
  });

  it("gives the chrome slot its rule — the usage column stands in the stage's left edge (AR-5b)", () => {
    // The review's blocker: the slot's class had a comment and no rule, so the
    // column laid out in flow — below the clipped swarm, across the list. The
    // rule is the reference host's; the claims strip starts at 72px beside it.
    const godview = source("godview/godview.css");
    const rule = godview.match(/^\.vf-monitor-chrome \{([^}]*)\}/m)?.[1] ?? "";
    expect(rule).toContain("position: absolute");
    expect(rule).toContain("left: 13px");
    expect(rule).toContain("width: 46px");
    expect(godview).toMatch(/^\.vf-monitor-claims \{[^}]*left: 72px/m);
  });

  it("keeps the pane frame's own styling in the views package, never in a host's (GT-6)", () => {
    // The frame — the badge, the readout, the verbs, the meter — is the
    // record's drawing and ships in `@vibecook/puppeteer-views`. A `.vf-pane-*`
    // rule written here would be VibeField's second reading of one record, and
    // two readings of a record is how they drift (the AR-5b chrome-rule
    // precedent, applied to the deck). The host keeps what a host owns: the
    // deck's ground, the access chip's colours, and the exit face on
    // GHOSTTEA's own badge element.
    const godview = source("godview/godview.css");
    // A RULE, not a mention (the same carve-out its two neighbours make): the
    // prose above these rules names the selectors to say who owns them, and a
    // bare substring would forbid explaining the ownership it is enforcing.
    expect(godview).not.toMatch(/\.vf-pane-[\w-]*[^\n{]*\{/);
    // The two the host used to draw for itself, now the package's: the line and
    // the glow on the selected pane, and the divider between two resting ones.
    // A RULE, not a mention: the prose above these lines names both selectors
    // to say who owns them, and a bare substring would forbid explaining it.
    expect(godview).not.toMatch(/\[data-pane-accent\]::before[^\n{]*\{/);
    expect(godview).not.toMatch(/\.ghostty-split-divider[^\n{]*\{/);

    const catalogCss = [
      source("design-system/styles/catalog-shell.css"),
      source("design-system/styles/foundations.css"),
      source("design-system/styles/scenes.css"),
      source("design-system/styles/tweaks.css"),
    ].join("\n");
    expect(catalogCss).not.toMatch(/\.vf-pane-[\w-]*[^\n{]*\{/);

    // And the catalog's fixture is an ADAPTER: the shipping chrome over
    // fixture facts, with no markup and no stylesheet of its own.
    const preview = source("design-system/PaneFramePreview.tsx");
    expect(preview).toContain("PaneFrameChrome");
    expect(preview).toContain("paneFrameAgentFacts");
    expect(preview).not.toContain("<style");
    expect(preview).not.toMatch(/className="vf-pane-/);
    // GT-6 review: the specimens mount the PORTAL, not only the markup half —
    // a pane element, a real width, and the package's own observer deciding
    // what that width means. The narrow tier is the case that bites: a fixture
    // writing `data-vf-narrow` by hand shows a state nothing computed, and the
    // smoke selects on that same attribute.
    expect(preview).toMatch(/<PaneFrame\s/);
    expect(preview).not.toContain('"data-vf-narrow"');
  });

  it("keeps the Lip's specimen an ADAPTER: the shipping stage holding shipping frames, never the wrapper's markup or rules (round 3)", () => {
    // The wrapper — the Lip, the groove in its pill, the well — is drawn by
    // `GodviewStage` and `godview.css` alone. The specimen hands that stage a
    // deck fixture, as the overlay hands it the deck: panes wearing the views
    // package's frame, on the terminal's ground at the viewer's opacity.
    const section = source("design-system/sections/GodviewSection.tsx");
    expect(section).toContain("Deck — the Lip: the groove and the well");
    expect(section).toMatch(/<GodviewPreview\s[^>]*deck=\{<PaneFrameDeck\s/);
    // GV-D6: the terminals away are the same stage handed that state — never a
    // picture of a monitor without a deck
    expect(section).toContain("Deck — away: the monitor alone");
    expect(section).toContain("Deck — maximized: the bar as the title bar");
    expect(section).toMatch(/<GodviewPreview\s[^>]*deckState="maximized"/);
    expect(section).toMatch(/<GodviewPreview\s[^>]*deckState="away"/);
    // W7: a launch opens away, and the stage's own specimen says up explicitly
    // so it shows the deck and its Lip, never by a default
    expect(section).toMatch(/<GodviewPreview\s[^>]*systemControl[^>]*deckState="up"/);
    expect(source("design-system/GodviewPreview.tsx")).toMatch(/<GodviewStage\s/);
    const fixture = source("design-system/PaneFramePreview.tsx");
    expect(fixture).toMatch(/export function PaneFrameDeck\(/);
    expect(fixture).toContain("DEFAULT_DECK_APPEARANCE.opacity");
    // no catalog module spells a class of the wrapper's, and no catalog sheet a rule for one
    const modules = readdirSync(join(PACKAGE_ROOT, "src", "design-system"), { recursive: true })
      .map(String)
      .filter((name) => /\.(?:tsx?|css)$/.test(name));
    expect(modules.length).toBeGreaterThan(20);
    for (const name of modules) {
      expect(source(`design-system/${name}`), name).not.toMatch(
        /vf-godview-(?:deck-(?:lip|grip|groove|well)|terminal-deck)/,
      );
    }
  });

  it("keeps the empty pane launcher's styling in the views package, and its specimen an ADAPTER (QL-1)", () => {
    // The launcher — the field, the legend, the list — is the design's drawing
    // and ships in `@vibecook/puppeteer-views` with its own stylesheet, entering
    // through the manifest after the frame's. A host rule for it would be a
    // second reading of one design.
    const manifest = source("styles.css");
    expect(manifest).toContain('@import "@vibecook/puppeteer-views/styles/pane-launcher.css";');
    expect(manifest.indexOf("pane-launcher.css")).toBeGreaterThan(
      manifest.indexOf("deck-frame.css"),
    );
    const hostCss = [
      source("godview/godview.css"),
      source("design-system/styles/catalog-shell.css"),
      source("design-system/styles/foundations.css"),
      source("design-system/styles/scenes.css"),
      source("design-system/styles/tweaks.css"),
    ].join("\n");
    expect(hostCss).not.toMatch(/\.vf-pane-launcher[\w-]*[^\n{]*\{/);
    // What the host DOES own: the clearing's colour, which is the deck sheet's
    // own paint (pass 3 §22), set as a token on the sheet.
    expect(source("godview/godview.css")).toMatch(
      /^\.vf-godview-terminal-deck \{[^}]*--vf-pane-launcher-ground:/m,
    );
    // …never thinner than DESIGN.md §2.7's floor, whatever the stage's glass:
    // the prompt the launcher stands on must not read through its rows
    expect(source("godview/godview.css")).toMatch(
      /--vf-pane-launcher-ground: color-mix\([^;]*max\(var\(--vf-godview-stage-opacity, 100%\), var\(--vf-godview-launcher-clearing-floor\)\)/,
    );

    // The specimen supplies what a host supplies — a pane, the ground, door
    // answers — and mounts the shipping chrome over the shipping projection.
    const preview = source("design-system/PaneLauncherPreview.tsx");
    expect(preview).toContain("PaneLauncherChrome");
    expect(preview).toContain("launcherAgents");
    expect(preview).toContain("buildLauncherResults");
    expect(preview).not.toContain("<style");
    expect(preview).not.toMatch(/className="vf-pane-launcher/);
  });

  it("keeps the swarm's own styling and its physics in the views package, never in godview.css (AR-5, MV-5)", () => {
    // The swarm, its bodies and its type are the package's (RFC 005, drawn by
    // WebGPU), and since MV-5 so is its physics THREAD: the view brings its own
    // worker through the SDK's helper (MV-D7) and reports where it runs. No
    // swarm stylesheet or driver is colocated here any more, and godview.css
    // owns none of the swarm's selectors: a rule for a body drawn upstream
    // would be a replica.
    const godview = source("godview/godview.css");
    expect(godview).not.toMatch(/^\.vf-monitor-bubble/m);
    expect(godview).not.toMatch(/vf-monitor-swarm/);
    expect(existsSync(join(PACKAGE_ROOT, "src", "godview", "views"))).toBe(false);
  });
  it("keeps the segmented control's thumb and keys the kit's (R19, DK-13)", () => {
    // The primitive owns the anatomy — the thumb element, ids distinct from labels, ← → Home End — so no
    // composition grows a thumb of its own and no catalog replica draws one; a composition may only CUT the
    // kit's (the pegboard's filters, cut for the wood).
    const kitDir = join(PACKAGE_ROOT, "../design-kit/src");
    const primitives = readFileSync(join(kitDir, "primitives.tsx"), "utf8");
    const primitivesCss = readFileSync(join(kitDir, "primitives.css"), "utf8");
    expect(primitives).toContain('className="vf-ui-segmented-thumb"');
    expect(primitives).toContain("export function segmentForKey(");
    expect(primitives).toContain("export interface SegmentedOption<T extends string>");
    expect(primitivesCss).toMatch(
      /^\.vf-ui-segmented-thumb \{[^}]*transform 300ms var\(--vf-ease-island\)/m,
    );
    // reduced motion: the thumb does not travel — it stands under the new choice at once (M6)
    expect(primitivesCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^@]*\.vf-ui-segmented-thumb \{\s*transition: none;/su,
    );
    const cuts = new Set(["field/desk/pegboard/pegboard.css"]);
    const walk = (dir: string): string[] =>
      readdirSync(join(PACKAGE_ROOT, "src", dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name))
          : /\.(?:css|tsx?)$/u.test(entry.name)
            ? [join(dir, entry.name)]
            : [],
      );
    for (const file of walk(".")) {
      const text = source(file);
      if (cuts.has(file)) continue;
      // a RULE, not a mention: prose may name the class to say who owns it
      expect(text, file).not.toMatch(/\.vf-ui-segmented-thumb[^\n{]*\{/u);
      expect(text, file).not.toMatch(/className="[^"]*vf-ui-segmented-thumb/u);
    }
  });
  it("raises the pegboard behind the line — no recede, no backdrop, the bar hidden under it (DK-13, R14, addendum 47)", () => {
    const chrome = source("field/ChromeLayer.tsx");
    const field = source("field.tsx");
    const css = source("field/desk/pegboard/pegboard.css");
    // the pegboard's chrome over the desk, after the bar in the document (Tab: the filters, then the board)
    expect(chrome).toMatch(
      /<Pegboard surface=\{surface\} onSurfaceChange=\{onSurfaceChange\} \/>/u,
    );
    expect(chrome.indexOf("<Pegboard")).toBeGreaterThan(chrome.indexOf("<SelectionBar"));
    // the selection bar hides while the board is out; the selection persists under it
    expect(chrome).toMatch(/hidden=\{covered \|\| boardOut \|\| docsOpen \|\| showSettings\}/u);
    // the stage neither recedes nor dims for Objects: only the explorer and Settings recede it
    expect(field).toContain("const sheetOpen = docsOpen || chrome.showSettings;");
    expect(field).not.toMatch(/surface === "objects"/u);
    // chrome does not dim by night: the anchor's night is never read, nor the night's dimming
    expect(source("field/desk/pegboard/Pegboard.tsx")).not.toMatch(/\.night\b/u);
    expect(css).not.toContain("backdrop-dim");
    // the track sunk at 55 % over a 12 px blur; segments 30 tall, padded 0 15, 13/500; the thumb's night hairline
    expect(css).toContain(
      "background: color-mix(in srgb, var(--vf-chrome-solid) 55%, transparent);",
    );
    expect(css).toContain("backdrop-filter: blur(12px);");
    expect(css).toContain("inset 0 1px 3px rgb(0 0 0 / 16%)");
    expect(css).toMatch(
      /height: 30px;[^}]*padding: 0 15px;[^}]*font-size: 13px;[^}]*font-weight: 500;/su,
    );
    expect(css).toMatch(
      /\.dark \.vf-pegboard-track \.vf-ui-segmented-thumb \{\s*border-color: var\(--vf-hairline-strong\);/u,
    );
    expect(css).toContain("box-shadow: 0 2px 6px rgb(0 0 0 / 12%);");
    // reduced motion: the ring does not travel
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^@]*\.vf-pegboard-ring \{\s*transition: opacity 60ms ease-out;/su,
    );
  });
  it("keeps the old Objects sheet, its tray island's state, its tile list and its preview silhouettes gone (DK-13, R21) — the pegboard replaced them", () => {
    const exists = (relativePath: string): boolean => {
      try {
        source(relativePath);
        return true;
      } catch {
        return false;
      }
    };
    for (const gone of ["hud/WidgetTray.tsx", "hud/WidgetTray.css", "hud/tray-catalog.ts"])
      expect(exists(gone), gone).toBe(false);
    // …and the sheet's tile list's own test with it
    expect(readdirSync(join(PACKAGE_ROOT, "test"))).not.toContain("tray-catalog.test.ts");
    // …and design-kit's preview silhouettes — the registry the sheet's tiles and the SDK's /ui door read (DK-8: never
    // written since the widget rows' `preview` retired): no module, no barrel export, no SDK re-export
    const kit = (file: string): string =>
      readFileSync(join(PACKAGE_ROOT, "../design-kit/src", file), "utf8");
    expect(readdirSync(join(PACKAGE_ROOT, "../design-kit/src"))).not.toContain("preview.ts");
    expect(kit("index.ts")).not.toMatch(/from "\.\/preview"/u);
    const sdkUi = readFileSync(join(PACKAGE_ROOT, "../plugin-sdk/src/ui.ts"), "utf8");
    expect(sdkUi).not.toMatch(/^\s*previewBackground,$/mu);
    const walk = (dir: string): string[] =>
      readdirSync(join(PACKAGE_ROOT, "src", dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name))
          : /\.(?:css|tsx?)$/u.test(entry.name)
            ? [join(dir, entry.name)]
            : [],
      );
    for (const file of walk(".")) {
      const text = source(file);
      // no reader left: no import of the sheet, no mount of its frame, none of its selectors
      expect(text, file).not.toMatch(/from "[./]*(?:hud\/)?(?:WidgetTray|tray-catalog)"/u);
      expect(text, file).not.toMatch(/<WidgetTray(?:Frame)?\s/u);
      expect(text, file).not.toMatch(/\.vf-widget-tray[\w-]*[^\n{]*\{/u);
      expect(text, file).not.toMatch(/className="[^"]*vf-widget-tray/u);
    }
  });
});
