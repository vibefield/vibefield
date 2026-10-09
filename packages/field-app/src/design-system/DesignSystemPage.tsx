import { type ReactElement, useEffect, useState, useSyncExternalStore } from "react";
import { defaultProductAppearance } from "../appearance/product-appearance";
import { ThemeToggleButton } from "../ThemeToggleButton";
import { BrandMark } from "./catalog-ui";
import { CanvasGroundSection } from "./sections/CanvasGroundSection";
import { ChromeSection } from "./sections/ChromeSection";
import { ControlsSection } from "./sections/ControlsSection";
import { FaceStickersSection } from "./sections/FaceStickersSection";
import { FoundationsSection } from "./sections/FoundationsSection";
import { GlyphsSection } from "./sections/GlyphsSection";
import { GodviewSection } from "./sections/GodviewSection";
import { HistorySection } from "./sections/HistorySection";
import { IconsSection } from "./sections/IconsSection";
import { InventorySection } from "./sections/InventorySection";
import { LiveSurfacesSection } from "./sections/LiveSurfacesSection";
import { OnboardingSection } from "./sections/OnboardingSection";
import { OverviewSection } from "./sections/OverviewSection";
import { StatusSection } from "./sections/StatusSection";
import { SurfacesSection } from "./sections/SurfacesSection";
import type { DesignSystemStudioController, DesignSystemStudioState } from "./studio-controller";

const NAV_ITEMS = [
  ["overview", "Overview", "01"],
  ["foundations", "Foundations", "02"],
  ["fieldmarks", "After Hours", "02a"],
  ["face-stickers", "Face Club", "02b"],
  ["glyphs", "Glyphs", "02d"],
  ["canvas-ground", "Canvas ground", "03"],
  ["controls", "Controls", "04"],
  ["status", "Status & feedback", "05"],
  ["chrome", "Field chrome", "06"],
  ["surfaces", "Panels & overlays", "08"],
  ["live-surfaces", "Live surfaces", "09"],
  ["onboarding", "Onboarding", "10"],
  ["godview", "Control room", "11"],
  ["history", "History", "11a"],
  ["inventory", "Coverage index", "12"],
] as const;

function initialDark(): boolean {
  const stored = window.localStorage.getItem("vf-dark");
  if (stored !== null) return stored === "true";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

const CATALOG_STUDIO_STATE: DesignSystemStudioState = Object.freeze({
  appearance: defaultProductAppearance(),
  live: false,
  productConnection: "unavailable",
  productContext: null,
  transportError: null,
  requestedSection: null,
  navigationRevision: 0,
  revision: null,
  appliedRevision: null,
  rejection: null,
});
const CATALOG_STUDIO_CONTROLLER: Pick<DesignSystemStudioController, "snapshot" | "subscribe"> =
  Object.freeze({
    snapshot: () => CATALOG_STUDIO_STATE,
    subscribe: () => () => undefined,
  });

export function DesignSystemPage({
  studio,
}: {
  studio?: DesignSystemStudioController;
}): ReactElement {
  const [dark, setDark] = useState(initialDark);
  const [activeSection, setActiveSection] = useState("overview");
  const [catalogAppearance, setCatalogAppearance] = useState(defaultProductAppearance);
  const studioSource = studio ?? CATALOG_STUDIO_CONTROLLER;
  const studioState = useSyncExternalStore(studioSource.subscribe, studioSource.snapshot);
  const appearance = studio === undefined ? catalogAppearance : studioState.appearance;
  const setAppearance = studio === undefined ? setCatalogAppearance : studio.setAppearance;

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

  useEffect(() => {
    if (studio === undefined || studioState.requestedSection === null) return;
    const sectionId = studioState.requestedSection === "appearance" ? "canvas-ground" : "overview";
    const section = document.getElementById(sectionId);
    if (section === null) return;
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSection(sectionId);
  }, [studio, studioState.navigationRevision, studioState.requestedSection]);

  return (
    <div className="vf-ds-shell">
      <Sidebar activeSection={activeSection} />

      <main className="vf-ds-main">
        <OverviewSection studio={studio} state={studioState} />
        <FoundationsSection />
        <IconsSection />
        <FaceStickersSection />
        <GlyphsSection />
        <CanvasGroundSection
          dark={dark}
          appearance={appearance}
          onAppearanceChange={setAppearance}
        />
        <ControlsSection />
        <StatusSection />
        <ChromeSection dark={dark} onToggleTheme={() => setDark((value) => !value)} />
        <SurfacesSection />
        <LiveSurfacesSection />
        <OnboardingSection dark={dark} onToggleTheme={() => setDark((value) => !value)} />
        <GodviewSection dark={dark} />
        <HistorySection />
        <InventorySection />
      </main>

      <ThemeToggleButton
        dark={dark}
        onToggle={() => setDark((value) => !value)}
        className="vf-ds-theme-toggle"
      />
    </div>
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
