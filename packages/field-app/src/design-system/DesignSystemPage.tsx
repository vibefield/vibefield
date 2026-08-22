import {
  EmptyState,
  StatusDot,
  SegmentedControl as UiSegmentedControl,
  UnavailableState,
} from "@vibefield/design-kit";
import {
  ArtifactPanelPreview,
  type ArtifactPanelPreviewState,
} from "@vibefield/plugin-browser/design-system";
import { WEATHER_GRADIENT } from "@vibefield/plugin-widgetlab";
import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AccentChip, AccentPicker, type AccentSlot } from "../account/AccentPicker";
import { primaryCls, quietCls } from "../boot/onboarding/wizard-ui";
import { defaultCanvasGridConfig } from "../field/canvas-appearance";
import { roundButtonCls } from "../field/theme-constants";
import { LoadingVeilView } from "../hud/LoadingVeil";
import { NavigationBreadcrumbsView } from "../hud/NavigationBreadcrumbs";
import { SidePanelFrame } from "../hud/SidePanelStage";
import { WidgetTrayFrame, WidgetTrayToolSwitcherView } from "../hud/WidgetTray";
import { ZoomPillView } from "../hud/ZoomPill";
import { SettingsDialog, type SettingsPage } from "../panels/SettingsDialog";
import {
  buttonCls,
  fieldCls,
  labelCls,
  SettingsPill,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "../panels/settings-ui";
import { ThemeToggleButton } from "../ThemeToggleButton";
import { AgentBubblePreview } from "./AgentBubblePreview";
import { CanvasGroundWorkbench } from "./CanvasGroundWorkbench";
import { CommandPalettePreview } from "./CommandPalettePreview";
import { FilePillPreview } from "./FilePillPreview";
import { GodviewPreview } from "./GodviewPreview";
import { InfiniteCanvasGroundPreview } from "./InfiniteCanvasGroundPreview";
import { OnboardingPreview } from "./OnboardingPreview";
import { TerminalMirrorPreview } from "./TerminalMirrorPreview";

type IconName =
  | "arrow-left"
  | "canvas"
  | "chevron"
  | "close"
  | "command"
  | "document"
  | "folder"
  | "layers"
  | "plus"
  | "settings"
  | "sparkles";

const NAV_ITEMS = [
  ["overview", "Overview", "01"],
  ["foundations", "Foundations", "02"],
  ["canvas-ground", "Canvas ground", "03"],
  ["controls", "Controls", "04"],
  ["status", "Status & feedback", "05"],
  ["chrome", "Field chrome", "06"],
  ["cards", "Living cards", "07"],
  ["surfaces", "Panels & overlays", "08"],
  ["onboarding", "Onboarding", "09"],
  ["godview", "Control room", "10"],
  ["inventory", "Coverage index", "11"],
] as const;

const SURFACE_COLORS = [
  { label: "Canvas", token: "--vf-canvas-bg", value: "var(--vf-canvas-bg)" },
  { label: "Card", token: "--vf-card", value: "var(--vf-card)" },
  { label: "Deep card", token: "--vf-card-deep", value: "var(--vf-card-deep)" },
  { label: "Inset fill", token: "--vf-fill", value: "var(--vf-fill)" },
] as const;

const STATE_COLORS = [
  { label: "Healthy", token: "--vf-green", value: "var(--vf-green)" },
  { label: "Attention", token: "--vf-orange", value: "var(--vf-orange)" },
  { label: "Destructive", token: "--vf-red", value: "var(--vf-red)" },
  { label: "Content", token: "--vf-yellow", value: "var(--vf-yellow)" },
  { label: "Information", token: "--vf-cyan", value: "var(--vf-cyan)" },
  { label: "Selection", token: "--vf-select", value: "var(--vf-select)" },
] as const;

const ACCENT_COLORS = Array.from({ length: 8 }, (_, index) => ({
  label: `Accent ${index + 1}`,
  token: `--vf-accent-${index + 1}`,
  value: `var(--vf-accent-${index + 1})`,
}));

const INVENTORY = [
  {
    group: "Foundations",
    items: [
      "Chrome material",
      "Surface colors",
      "State colors",
      "Organizational accents",
      "Text opacity ramp",
      "Monospace data",
      "Radii",
      "Ambient shadows",
      "Motion curves",
    ],
  },
  {
    group: "Canvas ground",
    items: [
      "Adaptive three-level dot grid",
      "WebGPU / WebGL2 ground layer",
      "Pan and zoom response",
      "Light and dark canvas palette",
      "Grid spacing and fades",
      "Dot radius and opacity",
      "Overlap feedback projection",
      "Visual preset import / export",
    ],
  },
  {
    group: "Controls",
    items: [
      "Primary action",
      "Quiet action",
      "Settings chip",
      "Destructive action",
      "Round icon button",
      "Text input",
      "Number input",
      "Select",
      "Textarea",
      "Range",
      "Checkbox",
      "Switch",
      "Segmented control",
      "Category pill",
      "Accent picker",
      "Inline link",
    ],
  },
  {
    group: "Field chrome",
    items: [
      "Navigation breadcrumbs",
      "Zoom pill",
      "Theme toggle",
      "Artifact toggle",
      "File pill",
      "Document explorer",
      "Document tile",
      "Sync indicator",
      "Morphing widget tray",
      "Tool switcher",
      "Widget tile",
      "Put-back affordance",
    ],
  },
  {
    group: "Cards & state",
    items: [
      "Default card",
      "Content gradient",
      "Sticky note",
      "Terminal card",
      "Sole-selection ring",
      "Drag lift",
      "Accept overlap",
      "Reject overlap",
      "Status dot",
      "Status badge",
      "Source badge",
      "Change badge",
      "Progress bar",
      "Empty state",
      "Unavailable state",
      "Inline error",
    ],
  },
  {
    group: "Surfaces",
    items: [
      "Settings dialog",
      "Settings sidebar",
      "Settings section",
      "Settings row",
      "Side panel",
      "Command palette",
      "Loading veil",
      "Boot splash",
      "Setup Assistant",
      "Confirmation step",
      "Visual tweak workbench",
      "Frame stats overlay",
    ],
  },
  {
    group: "Control room",
    items: [
      "Instrument header",
      "Source counts",
      "View selector",
      "Theme switch",
      "Agent circle anatomy",
      "Agent circle state matrix",
      "Agent status mapping",
      "Terminal deck",
      "Pane badge",
      "Kill confirmation",
      "Tuning panel",
      "Scanlines",
      "Vignette",
    ],
  },
] as const;

function initialDark(): boolean {
  const stored = window.localStorage.getItem("vf-dark");
  if (stored !== null) return stored === "true";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function DesignSystemPage(): ReactElement {
  const [dark, setDark] = useState(initialDark);
  const [activeSection, setActiveSection] = useState("overview");

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.setAttribute("data-theme", dark ? "dark" : "light");
    window.localStorage.setItem("vf-dark", String(dark));
  }, [dark]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id !== undefined && visible.target.id !== "") {
          setActiveSection(visible.target.id);
        }
      },
      { rootMargin: "-18% 0px -68% 0px", threshold: [0, 0.15, 0.4] },
    );
    for (const [id] of NAV_ITEMS) {
      const section = document.getElementById(id);
      if (section !== null) observer.observe(section);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="vf-ds-shell">
      <Sidebar activeSection={activeSection} />

      <main className="vf-ds-main">
        <header id="overview" className="vf-ds-hero vf-ds-anchor">
          <div className="vf-ds-mobile-brand">
            <BrandMark />
            <span>VibeField interface index</span>
          </div>
          <div className="vf-ds-hero-copy">
            <p className="vf-ds-kicker">Design system · live renderer inventory</p>
            <h1>The field, in one frame.</h1>
            <p>
              The current VibeField visual language, gathered from the production renderer. Use this
              page to compare primitives, interaction states, field chrome, and the control room
              without booting a daemon or opening a document.
            </p>
          </div>
          <div className="vf-ds-hero-actions">
            <div className="vf-ds-live-pill">
              <span />
              renderer styles
            </div>
          </div>
          <div className="vf-ds-hero-facts">
            <HeroFact value="3" label="surface families" />
            <HeroFact value="8" label="accent slots" />
            <HeroFact value="22" label="card radius" suffix="px" />
            <HeroFact value="1" label="shared inventory" />
          </div>
          <div className="vf-ds-callout">
            <Icon name="sparkles" />
            <div>
              <strong>What is live here</strong>
              <span>
                Tokens, primitives, and controller-free production views are mounted directly.
                Fixture adapters replace runtime data only; engine-rendered cards use deterministic
                state fixtures.
              </span>
            </div>
          </div>
        </header>

        <Section
          id="foundations"
          index="02"
          eyebrow="Foundations"
          title="One quiet foundation"
          description="Neutral chrome gives content and honest state the room to speak. Every sample below switches through the same light and dark tokens as the desktop renderer."
        >
          <div className="vf-ds-grid vf-ds-grid-2">
            <Specimen title="Surface palette" source="design-kit/tokens.css">
              <div className="vf-ds-swatches vf-ds-swatches-4">
                {SURFACE_COLORS.map((color) => (
                  <ColorSwatch key={color.token} {...color} />
                ))}
              </div>
            </Specimen>
            <Specimen title="System color" source="DESIGN.md §2.5">
              <div className="vf-ds-swatches vf-ds-swatches-3">
                {STATE_COLORS.map((color) => (
                  <ColorSwatch key={color.token} {...color} />
                ))}
              </div>
            </Specimen>
          </div>

          <Specimen title="Organizational accents" source="AccentPicker.tsx">
            <div className="vf-ds-accent-line">
              {ACCENT_COLORS.map((color) => (
                <ColorSwatch key={color.token} {...color} compact />
              ))}
            </div>
          </Specimen>

          <div className="vf-ds-grid vf-ds-grid-2">
            <Specimen title="Type ramp" source="DESIGN.md §3">
              <div className="vf-ds-type-ramp">
                <div>
                  <span>Eyebrow · 10</span>
                  <p className="vf-ds-type-eyebrow">Field activity</p>
                </div>
                <div>
                  <span>Label · 12</span>
                  <p className="vf-ds-type-label">Needs approval · 4m</p>
                </div>
                <div>
                  <span>Body · 14</span>
                  <p className="vf-ds-type-body">Everything on the field stays within reach.</p>
                </div>
                <div>
                  <span>Hero numeral · 34</span>
                  <p className="vf-ds-type-data">64°</p>
                </div>
                <div>
                  <span>Mono fact · 12</span>
                  <p className="vf-ds-type-mono">agent_02 · 00:04:18</p>
                </div>
              </div>
            </Specimen>
            <Specimen title="Geometry & elevation" source="DESIGN.md §4–5">
              <div className="vf-ds-geometry-row">
                <GeometrySample radius="22px" label="Card" />
                <GeometrySample radius="32px" label="Island" />
                <GeometrySample radius="40px" label="Sheet" />
              </div>
              <div className="vf-ds-shadow-row">
                <div className="vf-ds-shadow-card" data-level="resting">
                  resting
                </div>
                <div className="vf-ds-shadow-card" data-level="island">
                  island
                </div>
                <div className="vf-ds-shadow-card" data-level="lifted">
                  lifted
                </div>
              </div>
            </Specimen>
          </div>

          <Specimen title="Motion vocabulary" source="design-kit/tokens.css">
            <div className="vf-ds-motion-grid">
              <MotionSample name="Island" token="--vf-ease-island" duration="600ms" />
              <MotionSample name="Lift" token="--vf-ease-lift" duration="180ms" />
              <MotionSample name="Pop" token="--vf-ease-pop" duration="280ms" />
            </div>
          </Specimen>
        </Section>

        <CanvasGroundSection dark={dark} />
        <ControlsSection />
        <StatusSection />
        <ChromeSection dark={dark} onToggleTheme={() => setDark((value) => !value)} />
        <CardsSection />
        <SurfacesSection />
        <OnboardingSection dark={dark} onToggleTheme={() => setDark((value) => !value)} />
        <GodviewSection />

        <Section
          id="inventory"
          index="11"
          eyebrow="Coverage index"
          title="The interface, accounted for"
          description="A compact audit list for the current renderer. It makes omissions visible while the rendered specimens keep the visual decisions comparable."
        >
          <div className="vf-ds-inventory-grid">
            {INVENTORY.map((group) => (
              <article key={group.group} className="vf-ds-inventory-card">
                <header>
                  <span>{group.group}</span>
                  <small>{group.items.length}</small>
                </header>
                <ul>
                  {group.items.map((item) => (
                    <li key={item}>
                      <span aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <div className="vf-ds-footer-note">
            <BrandMark />
            <div>
              <strong>Keep the page current.</strong>
              <span>
                When a visual pattern enters the renderer, add its normal, interactive, disabled,
                and failure states here in the same change.
              </span>
            </div>
          </div>
        </Section>
      </main>

      <ThemeToggleButton
        dark={dark}
        onToggle={() => setDark((value) => !value)}
        className="vf-ds-theme-toggle"
      />
    </div>
  );
}

function CanvasGroundSection({ dark }: { dark: boolean }): ReactElement {
  return (
    <Section
      id="canvas-ground"
      index="03"
      eyebrow="Canvas ground"
      title="The actual field, under glass"
      description="This is the production ICE ground—not a radial-gradient stand-in. Pan and zoom the adaptive three-level grid, then tune every former developer control in a specimen-scoped workbench."
    >
      <Specimen
        title="Infinite canvas and visual tuning workbench"
        source="field/InfiniteCanvasGround.tsx · design-system/tweaks/*"
      >
        <CanvasGroundWorkbench dark={dark} />
      </Specimen>
    </Section>
  );
}

function ControlsSection(): ReactElement {
  const [enabled, setEnabled] = useState(true);
  const [segment, setSegment] = useState("Select");
  const [accent, setAccent] = useState<AccentSlot>("accent-1");
  const [range, setRange] = useState(42);

  return (
    <Section
      id="controls"
      index="04"
      eyebrow="Controls"
      title="Actions with a consistent pulse"
      description="Round where an action is compact, softly inset where it belongs to settings, and solid only when hierarchy or selection earns it."
    >
      <div className="vf-ds-grid vf-ds-grid-2">
        <Specimen title="Buttons" source="wizard-ui.tsx · settings-ui.tsx">
          <div className="vf-ds-control-stack">
            <ControlRow label="Primary">
              <button type="button" className={primaryCls}>
                Continue
              </button>
              <button type="button" className={primaryCls} disabled>
                Continue
              </button>
            </ControlRow>
            <ControlRow label="Quiet">
              <button type="button" className={quietCls}>
                Back
              </button>
              <button type="button" className={quietCls} disabled>
                Back
              </button>
            </ControlRow>
            <ControlRow label="Settings">
              <button type="button" className={buttonCls}>
                Zoom to fit
              </button>
              <button type="button" className={`${buttonCls} text-[var(--vf-red)]`}>
                Uninstall
              </button>
            </ControlRow>
          </div>
        </Specimen>

        <Specimen title="Floating controls" source="field/theme-constants.ts">
          <div className="vf-ds-floating-controls">
            <button type="button" className={roundButtonCls(false)} aria-label="Back">
              <Icon name="arrow-left" />
            </button>
            <button type="button" className={roundButtonCls(false)} aria-label="Settings">
              <Icon name="settings" />
            </button>
            <button
              type="button"
              className={roundButtonCls(true)}
              aria-label="Artifacts open"
              aria-pressed="true"
            >
              <Icon name="layers" />
            </button>
            <button type="button" className={roundButtonCls(false)} disabled aria-label="Disabled">
              <Icon name="plus" />
            </button>
          </div>
          <p className="vf-ds-specimen-note">
            40px · solid surface · persistent active is inverted
          </p>
        </Specimen>
      </div>

      <div className="vf-ds-grid vf-ds-grid-2">
        <Specimen title="Fields" source="panels/settings-ui.tsx">
          <div className="vf-ds-fields-grid">
            <label>
              <span className={labelCls}>Text input</span>
              <input className={fieldCls} defaultValue="James’s field" />
            </label>
            <label>
              <span className={labelCls}>Select</span>
              <select className={fieldCls} defaultValue="automatic">
                <option value="automatic">Automatic</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label>
              <span className={labelCls}>Number</span>
              <input className={`${fieldCls} tabular-nums`} type="number" defaultValue="64" />
            </label>
            <label>
              <span className={labelCls}>Disabled</span>
              <input className={fieldCls} value="Unavailable" disabled readOnly />
            </label>
            <label className="vf-ds-field-wide">
              <span className={labelCls}>Textarea</span>
              <textarea
                className={`${fieldCls} h-20 resize-none py-2`}
                defaultValue="Keep a durable note beside the work."
              />
            </label>
          </div>
        </Specimen>

        <Specimen title="Selection controls" source="settings-ui.tsx · WidgetTray.tsx">
          <div className="vf-ds-selection-stack">
            <div className="vf-ds-demo-setting">
              <div>
                <strong>Snap cards</strong>
                <span>Settle nearby edges into place.</span>
              </div>
              <SettingsSwitch checked={enabled} onChange={setEnabled} label="Snap cards" />
            </div>
            <UiSegmentedControl
              options={["Select", "Pan", "Wire"]}
              value={segment}
              onChange={setSegment}
              label="Canvas tool"
            />
            <label className="vf-ds-range-row">
              <span className={labelCls}>Range</span>
              <input
                type="range"
                min="0"
                max="100"
                value={range}
                onChange={(event) => setRange(Number(event.target.value))}
              />
              <output>{range}%</output>
            </label>
            <label className="vf-ds-check-row">
              <input type="checkbox" defaultChecked />
              <span>Show agent labels</span>
            </label>
          </div>
        </Specimen>
      </div>

      <Specimen title="Pills, accents & links" source="AccentPicker.tsx · settings-ui.tsx">
        <div className="vf-ds-pill-layout">
          <div className="vf-ds-pill-group">
            <SettingsPill>Loro-backed</SettingsPill>
            <span className="vf-ds-category-pill is-active">All</span>
            <span className="vf-ds-category-pill">Productivity</span>
            <span className="vf-ds-source-pill">registry · reviewed</span>
            <a href="#controls" className="vf-ds-inline-link">
              Open logs
            </a>
          </div>
          <div className="vf-ds-accent-control">
            <AccentPicker
              value={accent}
              name="vf-design-accent"
              onSelect={setAccent}
              className="flex flex-wrap gap-2"
            />
            <AccentChip accent={accent} label="James’s field" />
          </div>
        </div>
      </Specimen>
    </Section>
  );
}

function StatusSection(): ReactElement {
  return (
    <Section
      id="status"
      index="05"
      eyebrow="Status & feedback"
      title="Color always answers why"
      description="Green means healthy work, orange asks for attention, red marks failure or destruction, and muted facts stay deliberately colorless."
    >
      <div className="vf-ds-grid vf-ds-grid-2">
        <Specimen title="Agent states" source="DESIGN.md §2.5">
          <div className="vf-ds-status-list">
            <StatusLine state="working" detail="editing renderer · 18s" tone="green" />
            <StatusLine state="needs approval" detail="shell command · 4m" tone="orange" />
            <StatusLine state="waiting" detail="on teammate" tone="muted" />
            <StatusLine state="done" detail="finished 12:42:08" tone="green" glyph="✓" />
            <StatusLine state="failed" detail="process exited 1" tone="red" />
            <StatusLine state="unknown" detail="last seen 9m ago" tone="muted" italic />
          </div>
        </Specimen>
        <Specimen title="Badges & provenance" source="settings and plugin surfaces">
          <div className="vf-ds-badge-cloud">
            <StatusBadge tone="green">working</StatusBadge>
            <StatusBadge tone="orange">needs approval · 4m</StatusBadge>
            <StatusBadge tone="red">failed</StatusBadge>
            <StatusBadge tone="muted">peer offline</StatusBadge>
            <span className="vf-ds-change-badge is-positive">+4.8%</span>
            <span className="vf-ds-change-badge is-negative">−1.2%</span>
            <span className="vf-ds-source-pill">built-in</span>
            <span className="vf-ds-source-pill">dev</span>
            <span className="vf-ds-source-pill">sideload</span>
          </div>
        </Specimen>
      </div>
      <div className="vf-ds-grid vf-ds-grid-3">
        <Specimen title="Progress" source="LoadingVeil.tsx">
          <div className="vf-ds-progress-face">
            <div className="vf-ds-progress-track">
              <span style={{ width: "62%" }} />
            </div>
            <p>preparing previews · 62%</p>
          </div>
        </Specimen>
        <Specimen title="Empty" source="DESIGN.md §8">
          <EmptyState
            visual={<Icon name="plus" />}
            title="No documents yet"
            description="Create a field to begin."
          />
        </Specimen>
        <Specimen title="Unavailable" source="plugin-host/faces.tsx">
          <UnavailableState
            title="Plugin unavailable"
            description="The card is kept. Enable Notes to restore it."
          />
        </Specimen>
      </div>
      <div className="vf-ds-feedback-strip">
        <div>
          <StatusDot tone="healthy" />
          <strong>Saved</strong>
          <small>Last exchange 12:42:08</small>
        </div>
        <div>
          <StatusDot tone="attention" />
          <strong>Waiting on 3</strong>
          <small>A peer is offline</small>
        </div>
        <div>
          <StatusDot tone="error" />
          <strong>Export failed</strong>
          <small>Choose a writable folder and retry.</small>
        </div>
      </div>
    </Section>
  );
}

function ChromeSection({
  dark,
  onToggleTheme,
}: {
  dark: boolean;
  onToggleTheme: () => void;
}): ReactElement {
  const [docsOpen, setDocsOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [trayTool, setTrayTool] = useState<"select" | "pan" | "connect">("select");
  const [trayCategory, setTrayCategory] = useState("All");
  const [zoom, setZoom] = useState(100);
  const groundGrid = useMemo(() => defaultCanvasGridConfig(dark), [dark]);

  const openDocs = (): void => {
    setDocsOpen((open) => !open);
    setTrayOpen(false);
  };

  return (
    <Section
      id="chrome"
      index="06"
      eyebrow="Field chrome"
      title="Islands over the canvas"
      description="The window stays a field. Controls float at the edges, while one physical object morphs between a compact island and its expanded role."
    >
      <Specimen title="Field chrome playground" source="hud/*" bleed>
        <div className="vf-ds-field-stage" data-docs-open={docsOpen} data-tray-open={trayOpen}>
          <InfiniteCanvasGroundPreview
            grid={groundGrid}
            background="var(--vf-canvas-bg)"
            className="vf-ds-stage-ground"
            interactive={false}
            label="Production canvas ground behind the field chrome"
          />
          <div className="vf-ds-stage-card card-a" />
          <div className="vf-ds-stage-card card-b" />
          <NavigationBreadcrumbsView
            crumbs={[
              { depth: 0, containerId: null, label: "Root" },
              { depth: 1, containerId: null, label: "Launch notes" },
            ]}
            onBack={() => {}}
            onJump={() => {}}
          />

          <div className="vf-ds-demo-right-chrome">
            <ZoomPillView
              percent={zoom}
              onZoomOut={() => setZoom((value) => Math.max(25, value - 10))}
              onReset={() => setZoom(100)}
              onZoomToFit={() => setZoom(86)}
              onZoomIn={() => setZoom((value) => Math.min(400, value + 10))}
            />
            <ThemeToggleButton dark={dark} onToggle={onToggleTheme} />
            <button type="button" className={roundButtonCls(false)} aria-label="Open artifacts">
              <Icon name="layers" />
            </button>
          </div>

          <FilePillPreview open={docsOpen} onOpenChange={openDocs} />

          <WidgetTrayFrame
            open={trayOpen}
            onOpenChange={(nextOpen) => {
              setTrayOpen(nextOpen);
              if (nextOpen) setDocsOpen(false);
            }}
            toolbar={
              <>
                <WidgetTrayToolSwitcherView active={trayTool} onChange={setTrayTool} />
                <div className="flex-1" />
                <button
                  type="button"
                  className="flex h-11 w-11 items-center justify-center rounded-full text-[17px] transition-all hover:bg-black/5 active:scale-95 dark:hover:bg-white/10"
                  title="Clean up"
                >
                  ✨
                </button>
              </>
            }
          >
            <div className="vf-no-scrollbar vf-mask-fade-right mb-3 flex w-full items-center gap-2 overflow-x-auto px-8">
              {["All", "Writing", "Agents"].map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setTrayCategory(category)}
                  aria-pressed={trayCategory === category}
                  className="vf-widget-tray__category whitespace-nowrap px-4 py-1.5 text-[13px] active:scale-95"
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="vf-no-scrollbar vf-mask-fade-bottom flex-1 overflow-y-auto px-8">
              <div className="vf-ds-widget-tiles">
                <WidgetTile title="Note" tone="note" icon="document" />
                <WidgetTile title="Terminal" tone="terminal" icon="command" wide />
                <WidgetTile title="Folder" tone="folder" icon="folder" />
              </div>
            </div>
          </WidgetTrayFrame>
        </div>
        <p className="vf-ds-stage-caption">
          The document pill and tray are interactive. Open one to inspect its morph and mutual focus
          behavior.
        </p>
      </Specimen>
    </Section>
  );
}

function CardsSection(): ReactElement {
  const [state, setState] = useState("Resting");
  return (
    <Section
      id="cards"
      index="07"
      eyebrow="Living cards"
      title="Content has the color. Chrome has the physics."
      description="Committed widget surfaces survive both app themes. The shared rounded shell supplies ambient depth, lift, selection, and overlap feedback."
    >
      <Specimen title="Content surfaces" source="design-kit/CardShell.tsx">
        <div className="vf-ds-widget-card-grid">
          <WidgetCard kind="weather" />
          <WidgetCard kind="terminal" />
          <WidgetCard kind="note" />
          <WidgetCard kind="market" />
        </div>
      </Specimen>

      <div className="vf-ds-grid vf-ds-grid-asymmetric">
        <Specimen title="Interaction projection" source="CardShell.tsx">
          <div className="vf-ds-card-state-controls">
            {["Resting", "Selected", "Lifted", "Accept", "Reject"].map((option) => (
              <button
                key={option}
                type="button"
                className={option === state ? "is-active" : ""}
                onClick={() => setState(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="vf-ds-living-card-stage">
            <div className="vf-ds-living-card" data-state={state.toLowerCase()}>
              <div className="vf-ds-card-content">
                <span>SESSION · CLAUDE</span>
                <strong>Refining the canvas</strong>
                <small>working · 18s</small>
              </div>
              <div className="vf-ds-card-glow" />
              <div className="vf-ds-card-rim" />
              <div className="vf-ds-card-ring" />
            </div>
          </div>
        </Specimen>
        <Specimen title="Card anatomy" source="DESIGN.md §7–8">
          <ol className="vf-ds-anatomy-list">
            <li>
              <span>01</span>
              <div>
                <strong>Rounded clip</strong>
                <small>22px silhouette on every widget.</small>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Content surface</strong>
                <small>Owns gradients, illustration, and committed color.</small>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Hot-point glow + rim</strong>
                <small>Strong for accept, restrained for reject.</small>
              </div>
            </li>
            <li>
              <span>04</span>
              <div>
                <strong>Selection ring</strong>
                <small>1.5px blue, reserved for interaction.</small>
              </div>
            </li>
            <li>
              <span>05</span>
              <div>
                <strong>Lift plane</strong>
                <small>Scale 1.05, opacity .75, deeper ambient shadow.</small>
              </div>
            </li>
          </ol>
        </Specimen>
      </div>
    </Section>
  );
}

function SurfacesSection(): ReactElement {
  const [settingsOn, setSettingsOn] = useState(true);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("appearance");
  return (
    <Section
      id="surfaces"
      index="08"
      eyebrow="Panels & overlays"
      title="Large surfaces stay calm"
      description="Sheets use space, blur, and hairlines for hierarchy. They do not become a new visual language when the amount of information grows."
    >
      <Specimen title="Settings dialog" source="panels/SettingsPanel.tsx" bleed>
        <div className="vf-ds-settings-stage">
          <SettingsDialog
            className="vf-ds-settings-dialog"
            activePage={settingsPage}
            onSelectPage={setSettingsPage}
            onClose={() => undefined}
            onUndo={() => undefined}
            onRedo={() => undefined}
            historyBusy={false}
            undoAvailable={false}
            redoAvailable={false}
          >
            {settingsPage === "appearance" ? (
              <SettingsSection
                title="Theme"
                description="Set the color mode used by app chrome and cards."
              >
                <SettingsRow
                  title="Use system appearance"
                  description="Follow this device when its appearance changes."
                >
                  <SettingsSwitch
                    checked={settingsOn}
                    onChange={setSettingsOn}
                    label="Use system appearance"
                  />
                </SettingsRow>
                <SettingsRow
                  title="Interface scale"
                  description="Keep controls comfortable without changing canvas zoom."
                  divider={false}
                >
                  <UiSegmentedControl
                    options={["Compact", "Default"]}
                    value="Default"
                    onChange={() => {}}
                    label="Interface scale"
                  />
                </SettingsRow>
              </SettingsSection>
            ) : (
              <UnavailableState
                compact
                title={`${settingsPage[0]?.toUpperCase()}${settingsPage.slice(1)} is runtime-backed`}
                description="The production frame is exact; this page's data stays with its runtime controller."
              />
            )}
          </SettingsDialog>
        </div>
      </Specimen>

      <div className="vf-ds-grid vf-ds-grid-2">
        <Specimen title="Command palette" source="hud/CommandPalette.tsx" darkStage>
          <div className="vf-ds-palette-stage">
            <CommandPalettePreview />
          </div>
        </Specimen>
        <Specimen title="Artifact side panel" source="hud/SidePanelStage.tsx" darkStage>
          <SidePanelSpecimen />
        </Specimen>
      </div>

      <div className="vf-ds-grid vf-ds-grid-3">
        <Specimen title="Loading veil" source="hud/LoadingVeil.tsx">
          <div className="vf-ds-veil-stage">
            <LoadingVeilView view={{ progress: 0.38, stage: "opening doc" }} shown details />
          </div>
        </Specimen>
        <Specimen title="Confirmation" source="destructive flows">
          <div className="vf-ds-confirm-specimen">
            <strong>Remove Notes?</strong>
            <span>Canvas cards it made are kept.</span>
            <div>
              <button type="button" className={`${buttonCls} text-[var(--vf-red)]`}>
                Remove data too
              </button>
              <button type="button" className={buttonCls}>
                Cancel
              </button>
            </div>
          </div>
        </Specimen>
        <Specimen title="Performance diagnostics" source="@vibecook/ice/devtools">
          <PerformanceDiagnosticsSpecimen />
        </Specimen>
      </div>
    </Section>
  );
}

function OnboardingSection({
  dark,
  onToggleTheme,
}: {
  dark: boolean;
  onToggleTheme: () => void;
}): ReactElement {
  return (
    <Section
      id="onboarding"
      index="09"
      eyebrow="Onboarding"
      title="The complete Setup Assistant"
      description="Every shipping pane, alternate entry, transitional face, and completion refusal is mounted from production code. Change a pane once and both onboarding and this catalog move together."
    >
      <Specimen
        title="Production flow and state inventory"
        source="boot/onboarding/onboarding-views.tsx"
        bleed
      >
        <OnboardingPreview dark={dark} onToggleTheme={onToggleTheme} />
      </Specimen>
    </Section>
  );
}

function GodviewSection(): ReactElement {
  return (
    <Section
      id="godview"
      index="10"
      eyebrow="Control room"
      title="A deliberate change of register"
      description="Godview is the instrument-stage exception: compact monospace controls, flat geometry, stark status bodies, and a parchment or graphite terminal deck. The complete circle inventory below makes its state grammar explicit instead of leaving it buried in the physics view."
    >
      <Specimen title="Godview stage" source="godview/GodviewStage.tsx" bleed>
        <GodviewPreview />
      </Specimen>
      <Specimen
        title="Agent circle anatomy and complete state inventory"
        source="godview/views/swarm/AgentBubble.tsx"
        bleed
      >
        <AgentBubblePreview />
      </Specimen>
      <Specimen
        title="Terminal mirror — a session watched from the canvas"
        source="terminal/mirror/TerminalMirrorSurface.tsx"
      >
        <TerminalMirrorPreview />
      </Specimen>
    </Section>
  );
}

function Sidebar({ activeSection }: { activeSection: string }): ReactElement {
  return (
    <aside className="vf-ds-sidebar">
      <div className="vf-ds-brand">
        <BrandMark />
        <div>
          <strong>VibeField</strong>
          <span>Interface index</span>
        </div>
      </div>
      <nav aria-label="Design system sections">
        {NAV_ITEMS.map(([id, label, index]) => (
          <a key={id} href={`#${id}`} className={activeSection === id ? "is-active" : ""}>
            <span>{index}</span>
            {label}
          </a>
        ))}
      </nav>
      <div className="vf-ds-sidebar-foot">
        <span>Current source</span>
        <strong>DESIGN.md</strong>
        <small>Tokens → primitives → surfaces</small>
      </div>
    </aside>
  );
}

function BrandMark(): ReactElement {
  return (
    <span className="vf-ds-brand-mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function Section({
  id,
  index,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string;
  index: string;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section id={id} className="vf-ds-section vf-ds-anchor">
      <header className="vf-ds-section-head">
        <span>{index}</span>
        <div>
          <p>{eyebrow}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="vf-ds-section-body">{children}</div>
    </section>
  );
}

function Specimen({
  title,
  source,
  children,
  bleed = false,
  darkStage = false,
}: {
  title: string;
  source: string;
  children: ReactNode;
  bleed?: boolean;
  darkStage?: boolean;
}): ReactElement {
  return (
    <article
      className={`vf-ds-specimen ${bleed ? "is-bleed" : ""} ${darkStage ? "is-dark-stage" : ""}`}
    >
      <header>
        <span>{title}</span>
        <code>{source}</code>
      </header>
      <div className="vf-ds-specimen-body">{children}</div>
    </article>
  );
}

function HeroFact({ value, label, suffix }: { value: string; label: string; suffix?: string }) {
  return (
    <div>
      <strong>
        {value}
        {suffix !== undefined && <small>{suffix}</small>}
      </strong>
      <span>{label}</span>
    </div>
  );
}

function ColorSwatch({
  label,
  token,
  value,
  compact = false,
}: {
  label: string;
  token: string;
  value: string;
  compact?: boolean;
}): ReactElement {
  return (
    <div className={`vf-ds-swatch ${compact ? "is-compact" : ""}`}>
      <span style={{ background: value }} />
      <div>
        <strong>{label}</strong>
        <code>{token}</code>
      </div>
    </div>
  );
}

function GeometrySample({ radius, label }: { radius: string; label: string }): ReactElement {
  return (
    <div>
      <span style={{ borderRadius: radius }} />
      <strong>{radius}</strong>
      <small>{label}</small>
    </div>
  );
}

function MotionSample({
  name,
  token,
  duration,
}: {
  name: string;
  token: string;
  duration: string;
}): ReactElement {
  return (
    <div
      className="vf-ds-motion-sample"
      style={{ "--motion-ease": `var(${token})` } as CSSProperties}
    >
      <div>
        <span />
      </div>
      <strong>{name}</strong>
      <code>
        {duration} · {token}
      </code>
    </div>
  );
}

function ControlRow({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="vf-ds-control-row">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function StatusLine({
  state,
  detail,
  tone,
  glyph,
  italic = false,
}: {
  state: string;
  detail: string;
  tone: "green" | "orange" | "red" | "muted";
  glyph?: string;
  italic?: boolean;
}): ReactElement {
  const primitiveTone =
    tone === "green"
      ? "healthy"
      : tone === "orange"
        ? "attention"
        : tone === "red"
          ? "error"
          : "muted";
  return (
    <div>
      {glyph === undefined ? (
        <StatusDot tone={primitiveTone} />
      ) : (
        <span className="vf-ds-status-glyph">{glyph}</span>
      )}
      <strong className={italic ? "italic" : ""}>{state}</strong>
      <small>{detail}</small>
    </div>
  );
}

function StatusBadge({ children, tone }: { children: ReactNode; tone: string }): ReactElement {
  return <span className={`vf-ds-status-badge is-${tone}`}>{children}</span>;
}

function WidgetTile({
  title,
  tone,
  icon,
  wide = false,
}: {
  title: string;
  tone: string;
  icon: IconName;
  wide?: boolean;
}): ReactElement {
  return (
    <div className="vf-ds-widget-tile" data-wide={wide}>
      <span className={`vf-ds-widget-sil is-${tone}`}>
        <Icon name={icon} />
      </span>
      <small>{title}</small>
    </div>
  );
}

function WidgetCard({ kind }: { kind: "weather" | "terminal" | "note" | "market" }) {
  if (kind === "weather") {
    return (
      <article className="vf-ds-widget-card is-weather" style={{ background: WEATHER_GRADIENT }}>
        <header>
          <span>SAN FRANCISCO</span>
          <small>NOW</small>
        </header>
        <div>
          <strong>64°</strong>
          <span>Clear</span>
        </div>
        <footer>
          <span>H: 68°</span>
          <span>L: 52°</span>
        </footer>
      </article>
    );
  }
  if (kind === "terminal") {
    return (
      <article className="vf-ds-widget-card is-terminal">
        <header>
          <span>TERMINAL</span>
          <small>LIVE</small>
        </header>
        <code>
          <b>~/vibe-field</b>
          {"\n"}
          <span>$</span> pnpm dev{"\n"}
          <em>renderer ready · 5173</em>
          {"\n"}
          <span>$</span> _
        </code>
      </article>
    );
  }
  if (kind === "note") {
    return (
      <article className="vf-ds-widget-card is-note">
        <header>
          <span>NOTE</span>
          <small>12:42</small>
        </header>
        <p>Polish the space between the controls. Consistency lives in the quiet parts.</p>
        <footer>Launch notes</footer>
      </article>
    );
  }
  return (
    <article className="vf-ds-widget-card is-market">
      <header>
        <span>AAPL</span>
        <small>NASDAQ</small>
      </header>
      <div>
        <strong>$218.31</strong>
        <span className="vf-ds-change-badge is-positive">+1.8%</span>
      </div>
      <svg viewBox="0 0 220 54" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 43 C20 36 26 40 44 27 S74 32 88 21 S113 25 130 13 S160 25 178 10 S201 15 220 3" />
      </svg>
    </article>
  );
}

function SidePanelSpecimen(): ReactElement {
  const [state, setState] = useState<ArtifactPanelPreviewState>("empty");
  const options = ["empty", "populated", "loading", "unavailable"] as const;
  return (
    <div className="vf-ds-side-stage">
      <div className="vf-ds-production-statebar">
        <span>Production state</span>
        <UiSegmentedControl
          options={options}
          value={state}
          onChange={setState}
          label="Artifact panel state"
        />
      </div>
      <SidePanelFrame open label="Artifact Hub preview" className="vf-ds-side-panel-frame">
        <ArtifactPanelPreview state={state} />
      </SidePanelFrame>
    </div>
  );
}

function PerformanceDiagnosticsSpecimen(): ReactElement {
  return (
    <div className="vf-ds-dev-specimen">
      <div className="vf-ds-perf-mini">
        <span>FPS</span>
        <strong>60</strong>
        <small>16.7 ms</small>
      </div>
      <p>
        Runtime frame forensics stay with ICE diagnostics; visual editing now lives in the canvas
        workbench.
      </p>
    </div>
  );
}

function Icon({ name }: { name: IconName }): ReactElement {
  let paths: ReactNode;
  if (name === "arrow-left") paths = <path d="m15 18-6-6 6-6" />;
  else if (name === "canvas") {
    paths = (
      <>
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M8 3v18M16 3v18M3 8h18M3 16h18" />
      </>
    );
  } else if (name === "chevron") paths = <path d="m9 7 5 5-5 5" />;
  else if (name === "close") paths = <path d="m7 7 10 10M17 7 7 17" />;
  else if (name === "command") {
    paths = (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="m7 10 3 2.5L7 15M12.5 15H17" />
      </>
    );
  } else if (name === "document") {
    paths = (
      <>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v5h5M9 12h6M9 16h6" />
      </>
    );
  } else if (name === "folder") paths = <path d="M3 7.5h7l2-2h9v13H3z" />;
  else if (name === "layers") {
    paths = (
      <>
        <path d="m12 3 9 5-9 5-9-5z" />
        <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
      </>
    );
  } else if (name === "plus") paths = <path d="M12 5v14M5 12h14" />;
  else if (name === "settings") {
    paths = (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-4v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
      </>
    );
  } else {
    paths = (
      <>
        <path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z" />
        <path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
      </>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}
