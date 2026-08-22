// @vitest-environment node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath: string): string =>
  readFileSync(join(PACKAGE_ROOT, "src", relativePath), "utf8");

describe("UI system ownership boundaries", () => {
  it("keeps the app and catalog stylesheets as manifests", () => {
    const appManifest = source("styles.css");
    expect(appManifest).toContain('@import "./styles/base.css";');
    expect(appManifest).toContain('@import "./styles/utilities.css";');
    expect(appManifest).toContain('@import "./panels/settings.css";');
    expect(appManifest).toContain('@import "./godview/godview.css";');
    expect(appManifest).toContain('@import "./godview/deck-zoom.css";');
    expect(appManifest).toContain('@import "./godview/views/swarm/swarm.css";');
    expect(appManifest).toContain('@import "./godview/views/swarm/agent-bubble.css";');

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
      /^\.vf-(?:artifact|godview\b|widget-tray\b|command-palette\b|settings-dialog\b|loading-veil\b|zoom-pill\b|navigation-breadcrumbs|terminal-mirror\b|deck-zoom\b)/m,
    );
  });

  it("keeps the terminal mirror's fixture an ADAPTER, never a replica (TP-S2)", () => {
    // The rule that bites hardest on a widget whose live state needs a daemon:
    // the bench cannot show terminal pixels, and the tempting fix is to draw a
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

  it("mounts production views instead of the retired catalog replicas", () => {
    const page = source("design-system/DesignSystemPage.tsx");
    const onboarding = source("design-system/OnboardingPreview.tsx");
    const agentBubbles = source("design-system/AgentBubblePreview.tsx");
    const groundWorkbench = source("design-system/CanvasGroundWorkbench.tsx");
    const groundPreview = source("design-system/InfiniteCanvasGroundPreview.tsx");
    const mirror = source("design-system/TerminalMirrorPreview.tsx");
    const catalog = `${page}\n${onboarding}\n${agentBubbles}\n${groundWorkbench}\n${groundPreview}\n${mirror}`;
    for (const productionView of [
      "ArtifactPanelPreview",
      "CommandPalettePreview",
      "GodviewPreview",
      "FilePillPreview",
      "LoadingVeilView",
      "NavigationBreadcrumbsView",
      "SettingsDialog",
      "WidgetTrayFrame",
      "WidgetTrayToolSwitcherView",
      "ZoomPillView",
      "OnboardingConnectPaneView",
      "OnboardingDerivingPaneView",
      "OnboardingFieldPaneView",
      "OnboardingFinishingPaneView",
      "OnboardingPosturePaneView",
      "OnboardingReadyPaneView",
      "OnboardingSettingUpPaneView",
      "OnboardingWelcomeBackPaneView",
      "OnboardingWelcomePaneView",
      "WizardShellView",
      "AgentBubblePreview",
      "AgentBubbleView",
      "CanvasGroundWorkbench",
      "InfiniteCanvasGroundPreview",
      "InfiniteCanvasGround",
      "TerminalMirrorPreview",
      "TerminalMirrorSurface",
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

  it("keeps visual experimentation in the bench and the product appearance stable", () => {
    const boot = source("boot/BootRoot.tsx");
    const field = source("field.tsx");
    const stage = source("field/CanvasStage.tsx");

    expect(boot).not.toContain("VisualTweak");
    expect(boot).not.toContain("dev-tweaks");
    expect(field).not.toContain("VisualTweak");
    expect(field).toContain("defaultCanvasGridConfig");
    expect(stage).toContain("InfiniteCanvasGround");
  });

  it("keeps static component styling out of embedded style tags", () => {
    for (const component of [
      "boot/BootRoot.tsx",
      "hud/CommandPalette.tsx",
      "hud/FilePill.tsx",
      "hud/LoadingVeil.tsx",
      "hud/WidgetTray.tsx",
      "boot/onboarding/wizard-ui.tsx",
      "godview/views/swarm/AgentBubble.tsx",
      "godview/views/swarm/AgentSwarm.tsx",
      "plugin-host/faces.tsx",
    ]) {
      expect(source(component)).not.toContain("<style");
    }
  });

  it("keeps colocated production CSS on semantic tokens", () => {
    for (const stylesheet of [
      "account/AccentPicker.css",
      "boot/boot.css",
      "boot/onboarding/wizard-ui.css",
      "cursor/overlay.css",
      "hud/CommandPalette.css",
      "hud/FilePill.css",
      "hud/LoadingVeil.css",
      "hud/NavigationBreadcrumbs.css",
      "hud/PluginSurfaceSlot.css",
      "hud/WidgetTray.css",
      "hud/ZoomPill.css",
      "panels/settings.css",
      "godview/deck-zoom.css",
      "godview/views/swarm/agent-bubble.css",
      "godview/views/swarm/swarm.css",
      "terminal/mirror/mirror.css",
    ]) {
      expect(source(stylesheet), stylesheet).not.toMatch(/#[\da-f]{3,8}\b/i);
    }
  });

  it("keeps swarm field and circle styling beside their production views", () => {
    const godview = source("godview/godview.css");
    expect(godview).not.toMatch(/^\.vf-monitor-bubble/m);
    expect(godview).not.toMatch(/^\.vf-monitor-swarm(?:\s|\{)/m);
    expect(source("godview/views/swarm/agent-bubble.css")).toContain(
      ".vf-monitor-bubble.is-waiting",
    );
    expect(source("godview/views/swarm/swarm.css")).toContain(".vf-monitor-swarm-grid");
  });
});
