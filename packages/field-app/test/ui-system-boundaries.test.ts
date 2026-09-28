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

    const catalogManifest = source("design-system/design-system.css");
    expect(catalogManifest).toContain('@import "./styles/catalog-shell.css";');
    expect(catalogManifest).toContain('@import "./styles/foundations.css";');
    expect(catalogManifest).toContain('@import "./styles/scenes.css";');
    expect(catalogManifest).toContain('@import "./styles/tweaks.css";');
  });

  it("does not let catalog CSS own production component selectors", () => {
    const catalogCss = [
      source("design-system/styles/catalog-shell.css"),
      source("design-system/styles/foundations.css"),
      source("design-system/styles/scenes.css"),
      source("design-system/styles/tweaks.css"),
    ].join("\n");

    expect(catalogCss).not.toMatch(
      /^\.vf-(?:artifact|godview\b|widget-tray\b|command-palette\b|settings-dialog\b|loading-veil\b|zoom-pill\b|navigation-breadcrumbs|terminal-mirror\b|terminal-picker\b|deck-zoom\b|me\b|me-|face\b|face-|face-picker|settings-account|edge-tray\b)/m,
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
    const catalog = `${page}\n${onboarding}\n${swarmBodies}\n${groundWorkbench}\n${groundPreview}\n${mirror}\n${picker}\n${paneFrame}\n${paneLauncher}\n${switchScene}`;
    for (const productionView of [
      "ArtifactPanelPreview",
      "CommandPalettePreview",
      "GodviewPreview",
      "FilePillPreview",
      "LoadingVeilView",
      "NavigationBreadcrumbsView",
      "SettingsDialog",
      "MeMenuView",
      "SwitchSceneView",
      "FacePicker",
      "UserFaceView",
      "WidgetTrayFrame",
      "WidgetTrayToolSwitcherView",
      "ZoomPillView",
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
    ]) {
      expect(catalog).toContain(productionView);
    }

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
      "hud/FilePill.tsx",
      "hud/LoadingVeil.tsx",
      "hud/WidgetTray.tsx",
      "boot/onboarding/wizard-ui.tsx",
      "godview/GodviewMonitor.tsx",
      "plugin-host/faces.tsx",
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
      "hud/FilePill.css",
      "hud/LoadingVeil.css",
      "hud/NavigationBreadcrumbs.css",
      "hud/PluginSurfaceSlot.css",
      "hud/WidgetTray.css",
      "hud/ZoomPill.css",
      "panels/settings.css",
      "panels/terminal/terminal-settings.css",
      "godview/deck-zoom.css",
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
