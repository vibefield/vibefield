import { resolveTheme, type ThemePreference } from "@vibefield/contracts";
import { SegmentedControl } from "@vibefield/design-kit/primitives";
import { type ReactElement, useState } from "react";
import { MeMenuView } from "../../account/MeMenu";
import { roundButtonCls } from "../../field/theme-constants";
import { ComposerLineView } from "../../frame/ComposerLine";
import type { FrameSurface } from "../../frame/frame-surface";
import { ViewsTrackView } from "../../frame/ViewsTrack";
import { EdgeTrayView } from "../../hud/edge-tray/EdgeTrayView";
import {
  FIXTURE_ME,
  FIXTURE_ME_OFFLINE,
  FIXTURE_OTHERS,
  FIXTURE_OTHERS_WAITING,
} from "../account-fixtures";
import { Icon, Section, Specimen } from "../catalog-ui";

const ME_STATES = ["Three users", "Waiting", "One user · offline"] as const;
type MeState = (typeof ME_STATES)[number];

const TRAY_STATES = ["At rest", "Open", "Pinned", "Empty", "No shell"] as const;
type TrayState = (typeof TRAY_STATES)[number];

import { ComposerLinePlate, LINE_STATES } from "../ComposerLinePreview";
import { AppearancePlate, CORNER_PICKS, CornerPlate } from "../CornerPreview";
import { ArtifactsDrawer, EDGE_STATES, EdgesPlate, TRAY_TILES } from "../EdgesPreview";
import { HEAD_STATES, HeadLive, HeadPlate } from "../HeadPreview";
import { InfiniteCanvasGroundPreview } from "../InfiniteCanvasGroundPreview";
import { PEGBOARD_STATES, PegboardPlate, StageBoard } from "../PegboardPreview";
import { BAR_STATES, HAND_STATES, HandPlate, SelectionBarPlate } from "../SelectionBarPreview";
import { SwitchPreview } from "../SwitchPreview";
import { FRAME_STATES, ViewFramePreview, ViewsTrackSpecimen } from "../ViewFramePreview";

export function ChromeSection({
  dark,
  onToggleTheme,
}: {
  dark: boolean;
  onToggleTheme: () => void;
}): ReactElement {
  // The frame's one owner of the open surface, in fixture: the head's
  // explorer and zoom menu and the line's Objects are one value here too.
  const [surface, setSurface] = useState<FrameSurface | null>(null);
  const trayOpen = surface === "objects";
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
  // The playground's Theme drives this page's own theme (the app's stand-in):
  // Auto reads the OS's query, as main's owner reads nativeTheme.
  const [themePick, setThemePick] = useState<ThemePreference>(dark ? "dark" : "light");
  const chooseTheme = (pick: ThemePreference): void => {
    setThemePick(pick);
    const osDark =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    if ((resolveTheme(pick, osDark) === "dark") !== dark) onToggleTheme();
  };
  const playgroundTheme = { preference: themePick, resolved: dark ? "dark" : "light" } as const;

  const changeSurface = (next: FrameSurface | null): void => {
    setSurface(next);
    if (next !== null) setMeOpen(false);
  };

  return (
    <Section
      id="chrome"
      index="06"
      eyebrow="Field chrome"
      title="Islands over the canvas"
      description="The window stays a field. Controls float at the edges, while one physical object morphs between a compact island and its expanded role."
    >
      <Specimen title="Field chrome playground" source="frame/* · hud/*" bleed>
        <div
          className="vf-ds-field-stage"
          data-docs-open={surface === "fields"}
          data-board-open={trayOpen}
        >
          <InfiniteCanvasGroundPreview
            dark={dark}
            background="var(--vf-canvas-bg)"
            className="vf-ds-stage-ground"
            interactive={false}
            label="Production canvas ground behind the field chrome"
          />
          <div className="vf-ds-stage-card card-a" />
          <div className="vf-ds-stage-card card-b" />
          {/* The head on its real controller (One Frame FR-3), in a folder —
              the readout alone at its right since FR-4 (the theme went into
              the Me menu, Artifacts behind the right notch). */}
          <HeadLive surface={surface} onSurfaceChange={changeSurface} />

          {/* Objects: the board risen behind the line (DK-13) — the desk's own drawer in the
              product, a plain board here, the shipping filters in its band; the stage
              behind it neither recedes nor dims (R14). */}
          <StageBoard open={trayOpen} />

          {/* The line is the board's door (One Frame FR-2, DK-13): its create
              raises the pegboard behind it, and its ⊕ is what turns to ✕. */}
          <ComposerLineView
            view="canvas"
            keys="mac"
            track={<ViewsTrackView view="canvas" keys="mac" />}
            objectsOpen={trayOpen}
            onCreate={() => changeSurface(trayOpen ? null : "objects")}
          />

          <div className="vf-ds-demo-me">
            <MeMenuView
              me={FIXTURE_ME}
              others={FIXTURE_OTHERS}
              open={meOpen}
              onOpenChange={(nextOpen) => {
                setMeOpen(nextOpen);
                if (nextOpen) setSurface(null);
              }}
              onOpenSettings={() => undefined}
              onOpenAccount={() => undefined}
              onLink={() => undefined}
              onSwitch={() => undefined}
              onNewUser={() => undefined}
              theme={playgroundTheme}
              onThemeChange={chooseTheme}
            />
          </div>
        </div>
        <p className="vf-ds-stage-caption">
          The head — the field's name pill with its crumbs, which grows the fields explorer, and the
          zoom readout, which grows its menu — the line's Objects and your face are interactive.
          Open one to inspect its motion and the rule that only one of them is open at a time. Your
          menu's Theme sets this page's theme, as it sets the app's.
        </p>
      </Specimen>

      <Specimen
        title="The head — the name pill, the zoom readout, the palette"
        source="frame/HeadView.tsx · hud/CommandPalette.tsx · DESIGN.md §8, §5, §10"
        bleed
      >
        <div className="vf-ds-head-plates">
          {HEAD_STATES.map((state) => (
            <HeadPlate key={state} state={state} />
          ))}
          <HeadPlate state="zoom" keys="other" />
        </div>
        <p className="vf-ds-stage-caption">
          Every state the page's head plates draw — the field's top as one name, the crumbs folded
          into the pill inside a folder, a long path in a narrow window dropping whole leading
          names, renaming in place, the fields explorer grown from the pill, the zoom's solid menu
          with its keys, and the palette under the head — then the zoom's keys as Windows says them,
          in this page's theme. No keycaps and no plus in the head.
        </p>
      </Specimen>

      <Specimen
        title="The view frame — the views track and the cover"
        source="frame/* · DESIGN.md §10, §8, §6"
        bleed
      >
        <ViewFramePreview dark={dark} />
        <p className="vf-ds-stage-caption">
          The canvas is the ground floor; Godview and History are one cover over it, each on its own
          ground at the covers' 72% glass, their content ending 88 above the foot. The track stands
          above every view at the line's left end, each key printed under its glyph. Pick a state,
          or click a cell: the cover rises, swaps in place and lowers, and only the thumb travels.
        </p>
        <div className="vf-ds-views-plates">
          {FRAME_STATES.map((state) => (
            <ViewsTrackSpecimen key={state} state={state} />
          ))}
          <ViewsTrackSpecimen state="rest" keys="other" />
        </div>
        <p className="vf-ds-stage-caption">
          Every state the page's plates show for the track — at rest, ⌘ held, Godview, History, ⌘4's
          note, and the keys as Windows prints them — in this page's theme.
        </p>
      </Specimen>

      <Specimen
        title="The line — [views] create │ draft mic send"
        source="frame/ComposerLine.tsx · DESIGN.md §8, §5, §10"
        bleed
      >
        <div className="vf-ds-line-plates">
          {LINE_STATES.map((state) => (
            <ComposerLinePlate key={state} state={state} />
          ))}
          <ComposerLinePlate state="gv" keys="other" />
        </div>
        <p className="vf-ds-stage-caption">
          Every state the page's §03 plates draw for the line — at rest, typing with a chip in the
          sentence, @ open, aimed, Objects out, Godview's New terminal, History's Resume waiting —
          and Godview's keys as Windows prints them, in this page's theme. One plus: Canvas's create
          — faint while an object is in hand, "Put it down first" (R14).
        </p>
      </Specimen>

      <Specimen
        title="The pegboard — Objects, behind the line"
        source="field/desk/pegboard/* · DESIGN.md §8, R14, R19"
        bleed
      >
        <div className="vf-ds-board-plates">
          {PEGBOARD_STATES.map((state) => (
            <PegboardPlate key={`${state}-${dark ? "dark" : "light"}`} state={state} />
          ))}
        </div>
        <p className="vf-ds-stage-caption">
          The board is the desk's own drawer, risen behind the line by its create or B (its lay
          keeps 88 at the foot, so the last row clears the line); the stage behind it neither
          recedes nor dims. Over it VibeField draws the filters — the kit's segmented control cut
          for the wood, centred in the board's clear header band 12 in from its sides, the track
          sunk at 55 % over a 12 px blur, the thumb sliding 300 ms — All, then the categories the
          lay offers whose plugin is on, no counts; past the band's width they scroll, the end where
          more lies fading. They follow the drawer every frame of its slide and fade in over its
          last 40 %. From the keyboard the board is a stop of Tab after them: the arrows ring the
          specimen in focus where the desk draws it, ⏎ lays it at the view's centre, Esc closes. The
          plates stand a plain board in for the desk's.
        </p>
      </Specimen>

      <Specimen
        title="The edges — both notches in every view, slivers over a covered view"
        source="hud/edge-tray/* · DESIGN.md §8, §10, §6"
        bleed
      >
        <div className="vf-ds-edges-plates">
          {EDGE_STATES.map((state) => (
            <EdgesPlate key={`${state}-${dark ? "dark" : "light"}`} state={state} dark={dark} />
          ))}
        </div>
        <p className="vf-ds-stage-caption">
          The page's edges plates: the clipboard's notch on the left and Artifacts' on the right,
          whole on Canvas; over a covered view each rests as its 7 × 96 sliver in the 8 px the view
          keeps clear — point at one and it grows into the notch (240 ms) — the notch it grows into
          over History; the clipboard's drawer open over Godview; and Artifacts' drawer open with
          the Artifact Hub in its 152 column.
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
            hint="Clipboard  ⇧⌘V"
            emptyWord="nothing here yet — take a screenshot and it lands here"
            onNubClick={() => setTrayState((s) => (s === "Pinned" ? "At rest" : "Pinned"))}
            onPointerEnter={() => undefined}
            onPointerLeave={() => undefined}
            onSnap={() => undefined}
          />
          <ArtifactsDrawer open={false} />
        </div>
        <p className="vf-ds-stage-caption">
          The shipping tray view with fixture stills: the notch (N1, 26 × 116) and the drawer (P4,
          152 wide) are one path in the theme's solid chrome, the drawer's hairline gapped under the
          notch. The right edge is Artifacts' twin at rest — the `package` notch, no count.
        </p>
      </Specimen>

      <Specimen
        title="The corner — your face, and the Me menu above the line with Theme"
        source="account/MeMenu.tsx · panels/AppearanceSection.tsx · DESIGN.md §8, §10"
        bleed
      >
        <div className="vf-ds-corner-plates">
          {CORNER_PICKS.map((pick) => (
            <CornerPlate key={`${pick}-${dark ? "dark" : "light"}`} pick={pick} dark={dark} />
          ))}
        </div>
        <p className="vf-ds-stage-caption">
          The page's "Your face" plates: the face on the foot axis at the corner, its menu opening
          above the line — never around the face — nearest first: you, Settings… ⌘,, Theme, New
          user…, the switch list. Theme is the app's one theme control, held at Light, Dark and
          Auto; Auto follows this page's theme, as it follows the OS in the app.
        </p>
        <AppearancePlate pick="auto" />
        <p className="vf-ds-stage-caption">
          Settings → Appearance — the same setting, the same three (FC-D5).
        </p>
      </Specimen>

      <Specimen
        title="The selection bar — over the desk's selection, and grown into its menu"
        source="field/desk/bar/* · DESIGN.md §8, §13, §10"
        bleed
      >
        <div className="vf-ds-bar-plates">
          {BAR_STATES.map((state) => (
            <SelectionBarPlate key={`${state}-${dark ? "dark" : "light"}`} state={state} />
          ))}
        </div>
        <p className="vf-ds-stage-caption">
          The desk's object chrome (DK-11): the bar on the line's glass, 10 above the selection's
          brackets (or 10 below under the safe top) — Send to… · rule · the kind's acts · Duplicate
          · Tape it down · More · rule · Delete. A kind's own drawing is the bar's one path renderer
          (the clock's stopwatch); an act with no glyph is its label; a name the set lacks is the
          `missing` mark. Taped, Lift the tape and no Duplicate; a missing face names its type and
          word where the acts would stand. More grows the same element into its solid menu — up, or
          down near the top — nearest first, the eyebrow at the far end. Send to… waits for DK-14.
        </p>
      </Specimen>

      <Specimen
        title="The tools in hand — the same bar, under the head"
        source="field/desk/bar/* · DESIGN.md §8 Tools in hand, §13"
        bleed
      >
        <div className="vf-ds-bar-plates">
          {HAND_STATES.map((state) => (
            <HandPlate key={`${state}-${dark ? "dark" : "light"}`} state={state} dark={dark} />
          ))}
        </div>
        <p className="vf-ds-stage-caption">
          An object picked up (DK-12): the same element travels into the hand — 560 ms on the island
          curve, its contents cross-fading over the last 120 — and stands under the head at y 64,
          the held object's reading fit keeping 116 above it and 100 below. Send to… · rule · the
          kind's tools in their declared order (a 6 gap where the run changes between pages, inks
          and tools) · the readout · rule · Done. A pen or a marker is a dot in its own ink, the one
          in hand ringed; a mode without a swatch (the eraser, the calendar's pen) is the inverted
          solid while in hand; the clock draws its own five through the bar's one path renderer.
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
              theme={playgroundTheme}
              onThemeChange={chooseTheme}
            />
          </div>
        </div>
        <p className="vf-ds-stage-caption">
          Your face, where the Settings gear was. The menu grows above it on the island curve, and
          your face never moves — click it again to fold the menu back.
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
