import { type ReactElement, useMemo, useState } from "react";
import { defaultCanvasGridConfig, type MagnetGridGlyph } from "../../field/canvas-appearance";
import { roundButtonCls } from "../../field/theme-constants";
import { NavigationBreadcrumbsView } from "../../hud/NavigationBreadcrumbs";
import { WidgetTrayFrame, WidgetTrayToolSwitcherView } from "../../hud/WidgetTray";
import { ZoomPillView } from "../../hud/ZoomPill";
import { ThemeToggleButton } from "../../ThemeToggleButton";
import { Icon, type IconName, Section, Specimen } from "../catalog-ui";
import { FilePillPreview } from "../FilePillPreview";
import { InfiniteCanvasGroundPreview } from "../InfiniteCanvasGroundPreview";

export function ChromeSection({
  dark,
  magnetGridGlyph,
  onToggleTheme,
}: {
  dark: boolean;
  magnetGridGlyph: MagnetGridGlyph;
  onToggleTheme: () => void;
}): ReactElement {
  const [docsOpen, setDocsOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [trayTool, setTrayTool] = useState<"select" | "pan" | "connect">("select");
  const [trayCategory, setTrayCategory] = useState("All");
  const [zoom, setZoom] = useState(100);
  const groundGrid = useMemo(
    () => defaultCanvasGridConfig(dark, magnetGridGlyph),
    [dark, magnetGridGlyph],
  );

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
