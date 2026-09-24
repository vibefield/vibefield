import { SegmentedControl } from "@vibefield/design-kit/primitives";
import { type ReactElement, useMemo, useState } from "react";
import { MeMenuView } from "../../account/MeMenu";
import { defaultCanvasGridConfig, type MagnetGridGlyph } from "../../field/canvas-appearance";
import { roundButtonCls } from "../../field/theme-constants";
import { type EdgeTrayTile, EdgeTrayView } from "../../hud/edge-tray/EdgeTrayView";
import { NavigationBreadcrumbsView } from "../../hud/NavigationBreadcrumbs";
import { WidgetTrayFrame, WidgetTrayToolSwitcherView } from "../../hud/WidgetTray";
import { ZoomPillView } from "../../hud/ZoomPill";
import { ThemeToggleButton } from "../../ThemeToggleButton";
import {
  FIXTURE_ME,
  FIXTURE_ME_OFFLINE,
  FIXTURE_OTHERS,
  FIXTURE_OTHERS_WAITING,
} from "../account-fixtures";
import { Icon, type IconName, Section, Specimen } from "../catalog-ui";

const ME_STATES = ["Three users", "Waiting", "One user · offline"] as const;
type MeState = (typeof ME_STATES)[number];

const TRAY_STATES = ["At rest", "Open", "Pinned", "Empty", "No shell"] as const;
type TrayState = (typeof TRAY_STATES)[number];

/** A fixture still: an SVG the catalog draws itself, so the tile shows a real
 * image without a screenshot on disk (the product's stills come through the
 * shell's `vibefield-still://` scheme, which the catalog does not have). */
function fixtureStill(label: string, hue: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue} 70% 62%)'/><stop offset='1' stop-color='hsl(${hue + 30} 70% 40%)'/></linearGradient></defs>` +
    `<rect width='256' height='256' fill='url(#g)'/>` +
    `<rect x='28' y='40' width='200' height='120' rx='14' fill='rgba(255,255,255,0.22)'/>` +
    `<text x='40' y='190' font-family='ui-sans-serif' font-size='18' fill='rgba(255,255,255,0.9)'>${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const TRAY_TILES: readonly EdgeTrayTile[] = [
  {
    id: "t1",
    kind: "capture",
    label: "Screenshot · 1440 × 900",
    imageUrl: fixtureStill("Godview · swarm", 214),
    time: "15:04",
    day: "today",
    meta: "Screen · on the clipboard",
  },
  {
    id: "t2",
    kind: "capture",
    label: "Screenshot · 820 × 512",
    imageUrl: fixtureStill("Terminal", 28),
    time: "14:38",
    day: "today",
    meta: "Screen · on the clipboard",
  },
  {
    id: "t3",
    kind: "capture",
    label: "Screenshot · 1200 × 750",
    imageUrl: null,
    time: "22:12",
    day: "yesterday",
    meta: "the still is gone from disk",
  },
  {
    id: "t4",
    kind: "capture",
    label: "Screenshot · 640 × 400",
    imageUrl: fixtureStill("Settings", 150),
    time: "Tue",
    day: "earlier",
    meta: "Screen · on the clipboard",
  },
];

import { FilePillPreview } from "../FilePillPreview";
import { InfiniteCanvasGroundPreview } from "../InfiniteCanvasGroundPreview";
import { SwitchPreview } from "../SwitchPreview";

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
  const [meOpen, setMeOpen] = useState(false);
  const [meSpecimenOpen, setMeSpecimenOpen] = useState(true);
  const [trayState, setTrayState] = useState<TrayState>("Pinned");
  const [trayBumped, setTrayBumped] = useState(false);
  const trayOpenState = trayState !== "At rest";
  const trayTiles =
    trayState === "Empty"
      ? []
      : trayState === "No shell"
        ? TRAY_TILES.map((tile) => ({ ...tile, imageUrl: null }))
        : TRAY_TILES;
  const [meState, setMeState] = useState<MeState>("Three users");
  const groundGrid = useMemo(
    () => defaultCanvasGridConfig(dark, magnetGridGlyph),
    [dark, magnetGridGlyph],
  );

  const openDocs = (): void => {
    setDocsOpen((open) => !open);
    setTrayOpen(false);
    setMeOpen(false);
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
              if (nextOpen) {
                setDocsOpen(false);
                setMeOpen(false);
              }
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

          <div className="vf-ds-demo-me">
            <MeMenuView
              me={FIXTURE_ME}
              others={FIXTURE_OTHERS}
              open={meOpen}
              onOpenChange={(nextOpen) => {
                setMeOpen(nextOpen);
                if (nextOpen) {
                  setDocsOpen(false);
                  setTrayOpen(false);
                }
              }}
              onOpenSettings={() => undefined}
              onOpenAccount={() => undefined}
              onLink={() => undefined}
              onSwitch={() => undefined}
              onNewUser={() => undefined}
            />
          </div>
        </div>
        <p className="vf-ds-stage-caption">
          The document pill, the tray and your face are interactive. Open one to inspect its morph
          and the rule that only one of them is open at a time.
        </p>
      </Specimen>

      <Specimen
        title="Edge trays — the notch and its drawer"
        source="hud/edge-tray/* · DESIGN.md §8"
        bleed
      >
        <div className="vf-ds-edge-controls">
          <SegmentedControl
            options={TRAY_STATES}
            value={trayState}
            onChange={setTrayState}
            label="Tray state"
          />
          <button
            type="button"
            className={roundButtonCls(false)}
            aria-label="Play the fly-in's bump"
            title="Bump the notch — what a landing still does"
            onClick={() => {
              setTrayBumped(false);
              window.setTimeout(() => setTrayBumped(true), 0);
              window.setTimeout(() => setTrayBumped(false), 460);
            }}
          >
            <Icon name="sparkles" />
          </button>
        </div>
        <div className="vf-ds-edge-stage">
          <EdgeTrayView
            side="left"
            label="Clipboard"
            open={trayOpenState}
            pinned={trayState === "Pinned" || trayState === "Empty"}
            count={trayTiles.length}
            items={trayTiles}
            filter=""
            snap={
              trayState === "No shell"
                ? { state: "unavailable", word: "no capture here" }
                : { state: "ready", word: "snap" }
            }
            bumped={trayBumped}
            hint="Clipboard — hover to open, click to keep open (⌘⇧V)"
            emptyWord="nothing here yet — take a screenshot and it lands here"
            onNubClick={() => setTrayState((s) => (s === "Pinned" ? "At rest" : "Pinned"))}
            onPointerEnter={() => undefined}
            onPointerLeave={() => undefined}
            onSnap={() => undefined}
          />
          <EdgeTrayView
            side="right"
            label="Artifacts"
            open={false}
            pinned={false}
            count={3}
            items={[]}
            filter=""
            snap={null}
            bumped={false}
            hint="Artifacts — reserved for the right edge's twin (D-7)"
            emptyWord="no artifacts yet"
            onNubClick={() => undefined}
            onPointerEnter={() => undefined}
            onPointerLeave={() => undefined}
          />
        </div>
        <p className="vf-ds-stage-caption">
          The shipping tray view with fixture stills: the notch (N1, 26 × 116) and the drawer (P4,
          152 wide) are one path in the theme's solid chrome, the drawer's hairline gapped under the
          notch. The right edge shows the twin at rest, reserved for Artifacts.
        </p>
      </Specimen>

      <Specimen title="Me menu" source="account/MeMenu.tsx · DESIGN.md §8" bleed>
        <div className="vf-ds-me-stage">
          <div className="vf-ds-me-controls">
            <SegmentedControl
              options={ME_STATES}
              value={meState}
              onChange={setMeState}
              label="Account state"
            />
          </div>
          <div className="vf-ds-demo-me">
            <MeMenuView
              me={meState === "One user · offline" ? FIXTURE_ME_OFFLINE : FIXTURE_ME}
              others={
                meState === "One user · offline"
                  ? []
                  : meState === "Waiting"
                    ? FIXTURE_OTHERS_WAITING
                    : FIXTURE_OTHERS
              }
              open={meSpecimenOpen}
              onOpenChange={setMeSpecimenOpen}
              onOpenSettings={() => undefined}
              onOpenAccount={() => undefined}
              onLink={() => undefined}
              onSwitch={() => undefined}
              onNewUser={() => undefined}
            />
          </div>
        </div>
        <p className="vf-ds-stage-caption">
          Your face, where the Settings gear was. The circle around it grows into the menu on the
          island curve, and your face never moves — click it again to fold the menu back.
        </p>
      </Specimen>

      <Specimen title="The switch" source="boot/SwitchScene.tsx · DESIGN.md §8" bleed>
        <SwitchPreview />
        <p className="vf-ds-stage-caption">
          Open your face and choose another user. The field defocuses as the splash rises wearing
          their face; the window reloads under that exact frame; then the new field comes into focus
          as the face flies home to the corner. "Refused" plays it back.
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
