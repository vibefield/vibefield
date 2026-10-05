// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
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
      /^\.vf-(?:artifact|godview\b|widget-tray\b|command-palette\b|palette-|settings-dialog\b|loading-veil\b|terminal-mirror\b|terminal-picker\b|deck-zoom\b|me\b|me-|face\b|face-|face-picker|settings-account|edge-tray\b|views\b|views-|cover\b|cover-|history\b|history-|line\b|line-|at-|head\b|head-|menu\b|menu-|ah-|tr-)/m,
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

  it("keeps the terminal mirror's fixture an ADAPTER, never a replica (TP-S2)", () => {
    // The rule that bites hardest on a widget whose live state needs a daemon:
    // the catalog cannot show terminal pixels, and the tempting fix is to draw a
    // convincing fake. So the fixture is held to supplying only what a HOST
    // supplies — the cull answer and the camera — and to owning none of the
    // widget's own classes.
    const fixture = source("design-system/TerminalMirrorPreview.tsx");
    expect(fixture).toContain("TerminalMirrorSurface");
    expect(fixture).not.toMatch(/vf-terminal-mirror/);
    expect(fixture).not.toContain("<style");
    // And the widget's props are the whole seam: a fixture reaching for the
    // pool or a runtime would be building a second host.
    expect(fixture).not.toContain("terminalPool");
    expect(fixture).not.toContain("watchOnlyRuntime");
  });

  it("keeps the session picker's fixture an ADAPTER too (TP-S2b-widget)", () => {
    // The picker was split out of the widget precisely so the catalog could reach
    // its five roster states with no daemon under it. That only pays if the
    // fixture supplies DATA — rows and a state — and never markup: a catalog
    // that redrew the list would be showing a picture of a picker while the
    // shipping one drifted.
    const fixture = source("design-system/TerminalSessionPickerPreview.tsx");
    expect(fixture).toContain("SessionPickerView");
    expect(fixture).not.toMatch(/vf-terminal-picker/);
    expect(fixture).not.toContain("<style");
    // And it must not reach the pool: the picker's whole seam is its props.
    expect(fixture).not.toContain("refreshTerminalRoster");
    expect(fixture).not.toContain("useTerminalPool");
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
    const groundPreview = source("design-system/InfiniteCanvasGroundPreview.tsx");
    const mirror = source("design-system/TerminalMirrorPreview.tsx");
    const picker = source("design-system/TerminalSessionPickerPreview.tsx");
    const paneFrame = source("design-system/PaneFramePreview.tsx");
    const paneLauncher = source("design-system/PaneLauncherPreview.tsx");
    const switchScene = source("design-system/SwitchPreview.tsx");
    const deviceFilter = source("design-system/DeviceFilterPreview.tsx");
    const viewFrame = source("design-system/ViewFramePreview.tsx");
    const line = source("design-system/ComposerLinePreview.tsx");
    const head = source("design-system/HeadPreview.tsx");
    const palette = source("design-system/CommandPalettePreview.tsx");
    const corner = source("design-system/CornerPreview.tsx");
    const edges = source("design-system/EdgesPreview.tsx");
    const history = source("design-system/HistoryPreview.tsx");
    const catalog = `${history}\n${corner}\n${edges}\n${page}\n${onboarding}\n${swarmBodies}\n${groundWorkbench}\n${groundPreview}\n${mirror}\n${picker}\n${paneFrame}\n${paneLauncher}\n${switchScene}\n${deviceFilter}\n${viewFrame}\n${line}\n${head}\n${palette}`;
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
      // One Frame FR-2 — the tray keeps its sheet only (its island, tool
      // switcher and ⊕ retired into the line)
      "WidgetTrayFrame",
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
      "InfiniteCanvasGroundPreview",
      "InfiniteCanvasGround",
      "LiveSurfaceView",
      "TerminalMirrorPreview",
      "TerminalMirrorSurface",
      "TerminalSessionPickerPreview",
      "SessionPickerView",
      "PaneFramePreview",
      "PaneFrameChrome",
      "PaneLauncherPreview",
      "PaneLauncherChrome",
      // DS-3 — the device filter's shipping chip, on fixtures, never a copy
      "DeviceFilterPreview",
      "DeviceFilterChip",
      // One Frame FR-1 — the view frame: the track, the cover, History's room
      "ViewFramePreview",
      "ViewsTrackView",
      "ViewCoverView",
      // AR-8c — History: the shipping view over the room package's fixtures,
      // in every state the host owns, and the line's Resume live for a choice
      "HistoryPreview",
      "HistoryRoomView",
      "HistoryResumePlate",
      // …and its search until the Peek lands — a search held, the room's own
      // sheet a press on the pill away (the search interim, 2026-10-04)
      "HistorySearchPlate",
      // …and the two faces before the room, as they ship (2026-10-04)
      "HistoryOpeningState",
      "HistoryOpenFailedState",
      // One Frame FR-2 — the line: its view, @'s list, the plates, and the
      // live line on its real controller with fixture doors
      "ComposerLinePlate",
      "ComposerLineView",
      "AtMenuView",
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
    // …and History's plates mounted on the page in each state the host owns
    // (AR-8c): the room, a choice with Resume live, unavailable, consent.
    expect(page).toMatch(/<HistoryPreview state="room"/u);
    expect(page).toMatch(/<HistoryResumePlate\s/u);
    expect(page).toMatch(/<HistorySearchPlate\s/u);
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
    expect(field).toContain("canvasGridConfig(effectiveAppearance, dark)");
    expect(field).toContain("productAppearanceCssVariables(effectiveAppearance, dark)");
    expect(stage).toContain("InfiniteCanvasGround");
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
      "hud/WidgetTray.tsx",
      "boot/onboarding/wizard-ui.tsx",
      "godview/GodviewMonitor.tsx",
      "plugin-host/faces.tsx",
      "frame/ViewFrame.tsx",
      "frame/ViewsTrack.tsx",
      "frame/ViewCover.tsx",
      "history/HistoryRoomView.tsx",
      "history/HistoryView.tsx",
      "frame/Composer.tsx",
      "frame/ComposerLine.tsx",
      "frame/Head.tsx",
      "frame/HeadView.tsx",
      "account/MeMenu.tsx",
      "panels/AppearanceSection.tsx",
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
      "cursor/overlay.css",
      "hud/CommandPalette.css",
      "hud/edge-tray/edge-tray.css",
      "hud/LoadingVeil.css",
      "hud/PluginSurfaceSlot.css",
      "hud/WidgetTray.css",
      "panels/settings.css",
      "panels/terminal/terminal-settings.css",
      "godview/deck-zoom.css",
      "frame/view-frame.css",
      "history/history-room-view.css",
      "frame/composer.css",
      "frame/head.css",
      "frame/menu.css",
      "terminal/mirror/mirror.css",
      "terminal/widget/mirror-widget.css",
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

  it("keeps the swarm's own styling in the views package, never in godview.css (AR-5)", () => {
    // The swarm, its bodies and its type are the package's (RFC 005, drawn by
    // WebGPU); what VibeField keeps beside the view is its physics THREAD — a
    // timer and a mailbox — and the driver that owns it. No swarm stylesheet
    // is colocated here any more, and godview.css owns none of the swarm's
    // selectors: a rule for a body drawn upstream would be a replica.
    const godview = source("godview/godview.css");
    expect(godview).not.toMatch(/^\.vf-monitor-bubble/m);
    expect(godview).not.toMatch(/^\.vf-monitor-swarm(?:\s|\{)/m);
    const swarmDir = readdirSync(join(PACKAGE_ROOT, "src", "godview", "views", "swarm")).sort();
    expect(swarmDir).toEqual(["swarm-physics-driver.ts", "swarm-physics.worker.ts"]);
  });
});
