import { resolveTheme, type ThemePreference } from "@vibefield/contracts";
import { SegmentedControl } from "@vibefield/design-kit/primitives";
import { type ReactElement, useState } from "react";
import { MeMenuView } from "../../account/MeMenu";
import { ComposerLineView } from "../../frame/ComposerLine";
import { type FrameSurface, sheetShelf } from "../../frame/frame-surface";
import { SNAPSHOT_NO_DOOR } from "../../frame/line-model";
import { ViewsTrackView } from "../../frame/ViewsTrack";
import {
  FIXTURE_ME,
  FIXTURE_ME_OFFLINE,
  FIXTURE_OTHERS,
  FIXTURE_OTHERS_WAITING,
} from "../account-fixtures";
import { Section, Specimen } from "../catalog-ui";

const ME_STATES = ["Three users", "Waiting", "One user · offline"] as const;
type MeState = (typeof ME_STATES)[number];

/** AU-2 — the update row's states, in the page's groups (the fixtures'). */
const UPDATE_GROUP_OPTIONS: readonly { id: UpdateCornerGroup; label: string }[] = [
  { id: "path", label: "The path" },
  { id: "edges", label: "Choices · line 3" },
  { id: "held", label: "Held" },
  { id: "answers", label: "A check's answers" },
  { id: "acts", label: "Restart · Download" },
];

import {
  CARD_FIXTURES,
  CARDS_STATES,
  CardFacesPlate,
  CardsFromPlate,
  CardsPlate,
  COPY_FIXTURES,
  FROM_FIXTURES,
  FROM_REACHED,
  WAITING_FIXTURES,
} from "../CardsPreview";
import { ComposerLinePlate, LINE_STATES } from "../ComposerLinePreview";
import { AppearancePlate, CORNER_PICKS, CornerPlate } from "../CornerPreview";
import { DeskPreview } from "../DeskPreview";
import { HEAD_STATES, HeadLive, HeadPlate } from "../HeadPreview";
import { PACKAGE_CIRCLE_STATES, PackageCirclePlate } from "../PackageCirclePreview";
import { PEERS_STATES, PeersPlate } from "../PeersPreview";
import { PEGBOARD_STATES, PegboardPlate, StageBoard } from "../PegboardPreview";
import { BAR_STATES, HAND_STATES, HandPlate, SelectionBarPlate } from "../SelectionBarPreview";
import { SwitchPreview } from "../SwitchPreview";
import { UpdateFacePlate, UpdateMenuPlate } from "../UpdateCornerPreview";
import {
  UPDATE_CORNER_GROUPS,
  UPDATE_FACE_STATES,
  type UpdateCornerGroup,
  type UpdateCornerState,
} from "../updates-settings-fixtures";
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
  const [updateGroup, setUpdateGroup] = useState<UpdateCornerGroup>("path");
  const [updateState, setUpdateState] = useState<UpdateCornerState>("current");
  const updateStates: readonly UpdateCornerState[] = UPDATE_CORNER_GROUPS[updateGroup];
  const chooseUpdateGroup = (group: UpdateCornerGroup): void => {
    setUpdateGroup(group);
    setUpdateState(UPDATE_CORNER_GROUPS[group][0]);
  };

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
          data-docs-open={sheetShelf(surface) !== null}
          data-board-open={trayOpen}
        >
          <DeskPreview
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
              the Me menu), and Artifacts in the pill since HN-8: its package
              grows the sheet on that shelf, which waits here, with no plugin
              host to bind the Hub. */}
          <HeadLive surface={surface} onSurfaceChange={changeSurface} />

          {/* Objects: the board risen behind the line (DK-13) — the desk's own drawer in the
              product, a plain board here, the shipping filters in its band; the stage
              behind it neither recedes nor dims (R14). */}
          <StageBoard open={trayOpen} />

          {/* The line is the board's door (One Frame FR-2, DK-13): its create
              raises the pegboard behind it, and its ⊕ is what turns to ✕. A
              catalog has no capture door, so its snapshot waits and says so. */}
          <ComposerLineView
            view="canvas"
            keys="mac"
            track={<ViewsTrackView view="canvas" keys="mac" />}
            objectsOpen={trayOpen}
            snapshotWaits={SNAPSHOT_NO_DOOR}
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
          The head — the field's name pill with its crumbs, whose chevron and package grow its sheet
          on Fields or Artifacts, and the zoom readout, which grows its menu — the line's Objects
          and your face are interactive. Open one to inspect its motion and the rule that only one
          of them is open at a time. Your menu's Theme sets this page's theme, as it sets the app's.
        </p>
      </Specimen>

      <Specimen
        title="The head — the name pill, its sheet's two shelves, the zoom readout, the palette"
        source="frame/HeadView.tsx · hud/CommandPalette.tsx · DESIGN.md §8, §5, §6, §10"
        bleed
      >
        <div className="vf-ds-head-plates">
          {HEAD_STATES.map((state) => (
            <HeadPlate key={state} state={state} />
          ))}
          <HeadPlate state="zoom" keys="other" />
        </div>
        <p className="vf-ds-stage-caption">
          Every state the page's head plates draw — the field's top as one name, the package after
          its rule and with its dot while a source is unavailable, the crumbs folded into the pill
          inside a folder, a long path in a narrow window dropping whole leading names, renaming in
          place, the sheet grown from the pill on Fields and on Artifacts (the Hub's tiles, the
          plugin off, the Hub opening), the same sheet under a cover grown from the package circle,
          the zoom's solid menu with its keys, and the palette under the head — then the zoom's keys
          as Windows says them, in this page's theme. No keycaps and no plus in the head.
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
        title="The package circle — Artifacts under a cover"
        source="frame/PackageCircleView.tsx · DESIGN.md §8, §10, §6"
        bleed
      >
        <div className="vf-ds-package-plates">
          {PACKAGE_CIRCLE_STATES.map((state) => (
            <PackageCirclePlate
              key={`${state}-${dark ? "dark" : "light"}`}
              state={state}
              dark={dark}
            />
          ))}
        </div>
        <p className="vf-ds-stage-caption">
          Under a cover the pill is the desk's and hides with it, and Artifacts' door stands alone
          at the head's left: the package circle, 40 on the line's glass at x 96, search's mirror.
          Over Godview the Stories row keeps one head gap from it, a side of 148; over History its
          dot says an artifact's source is unavailable, and its tooltip which — "Artifacts —
          vibe-field's source is unavailable"; while the terminals are maximized it stands at the
          left end of their title bar, 30 × 24 in the deck's ink, as search stands at the right, its
          tooltip saying how many — "Artifacts — 2 sources unavailable". It grows the pill's sheet
          on its Artifacts shelf, which the head's plates draw.
        </p>
      </Specimen>

      <Specimen
        title="The line — [views] snapshot create"
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
          The line, 300 wide at 76 from the left (LN-D1): the views track, the snapshot and the
          view's one act. The snapshot is a ghost until the pointer comes, filled while the tool is
          up, and faint where there is no capture door. The create: Canvas's Objects — faint while
          an object is in hand, "Put it down first" (R14) — Godview's New terminal, History's New
          terminal in the project the room shows (HN-7); Godview's keys as Windows prints them last.
          The note at its two places: a new terminal said over the create, and a paste too large for
          its pane's terminal (D6) said from the line's left edge, its size and how much of it one
          paste carries.
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
        title="Peers on the mat — the room's other people, by face"
        source="field/desk/peers/* · DESIGN.md §8, §2.8, §13"
        bleed
      >
        <div className="vf-ds-peers-plates">
          {PEERS_STATES.map((state) => (
            <PeersPlate key={`${state}-${dark ? "dark" : "light"}`} state={state} />
          ))}
        </div>
        <p className="vf-ds-stage-caption">
          Another person's pointer on the desk is VibeField's own cursor — ICE's are off, so nobody
          is drawn twice (DK-16): the arrow, 18 × 22 with its tip on the pointer, in the presence
          ink on a paper-white edge; the label a chip on the line's glass 14 right of and 18 below
          it, the face first, then the name — never the person's colour. Placed every frame through
          the camera; hidden after 8 s idle, when the pointer leaves its window or its canvas, under
          a cover and while the board is out. The plates lay the lit mat where the desk draws it.
        </p>
      </Specimen>

      <Specimen
        title="The hand — every copy a card at the foot"
        source="frame/cards/* · DESIGN.md §8, §5, §6"
        bleed
      >
        <div className="vf-ds-cards-plates">
          {CARDS_STATES.map((state) => (
            <CardsPlate key={`${state}-${dark ? "dark" : "light"}`} state={state} />
          ))}
          {FROM_REACHED.map((id) => (
            <CardsFromPlate key={`${id}-${dark ? "dark" : "light"}`} reach={id} />
          ))}
        </div>
        <p className="vf-ds-stage-caption">
          The shipping fan over fixture cards, placed by the product's own model: at rest, the top
          68 of each card fanned about a point below the window, clear of the line at the left; the
          reach on the third card — up whole and straight, its × inside its top right and where it
          came from above it; raised (⇧⌘V), every card up and straight, the keyboard's card ringed;
          a card picked up, at reading size in the middle over the window out of focus, the bar
          under the head saying where it came from, with Remove and Done; a card carried out of the
          hand over a pane, its place kept in the fan, the pane ringed and saying "Paste into
          vibe-field" over the card; and where cards came from, each reached in turn — a paste with
          no caret by its act alone, a copy made in Settings by the view under it, and one History's
          room made by History alone.
        </p>
        <CardFacesPlate cards={CARD_FIXTURES} />
        <CardFacesPlate cards={CARD_FIXTURES} night />
        <CardFacesPlate cards={WAITING_FIXTURES} />
        <CardFacesPlate cards={COPY_FIXTURES} />
        <CardFacesPlate cards={FROM_FIXTURES} />
        <p className="vf-ds-stage-caption">
          One stock, six faces (HN-D1), twice their size: text, a file, an agent (the one dark card,
          its project's dot before its project), a terminal's output, a message and a picture — each
          its glyph in two corners and its name first; by this page's light, then by the Moon's
          (86%, its shadow deeper); a drag from another app before it is let go, saying only its
          kind; what the desk's Copy deals — one note's words as a text card, two objects as a
          picture called "2 objects"; and what another app, Settings and History deal — a file that
          is not words, its kind and size; a paste's words; a device's name copied in Settings; a
          path copied in History.
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
          brackets (or 10 below under the safe top) — Copy · rule · the kind's acts · Duplicate ·
          Tape it down · More · rule · Delete. Copy (HN-D3, ⌘C) deals the selection into the hand as
          one card, one object or several. A kind's own drawing is the bar's one path renderer (the
          clock's stopwatch); an act with no glyph is its label; a name the set lacks is the
          `missing` mark. Taped, Lift the tape and no Duplicate; a missing face names its type and
          word where the acts would stand. More grows the same element into its solid menu — up, or
          down near the top — nearest first, the eyebrow at the far end.
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
          the held object's reading fit keeping 116 above it and 100 below. Copy · rule · the kind's
          tools in their declared order (a 6 gap where the run changes between pages, inks and
          tools) · the readout · rule · Done. A pen or a marker is a dot in its own ink, the one in
          hand ringed; a mode without a swatch (the eraser, the calendar's pen) is the inverted
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

      <Specimen
        title="Me menu — the update: the dot and the always-row"
        source="account/MeMenu.tsx · panels/update-words.ts · DESIGN.md §8"
        bleed
      >
        <div className="vf-ds-update-faces">
          {UPDATE_FACE_STATES.map((state) => (
            <UpdateFacePlate key={state} state={state} />
          ))}
        </div>
        <div className="vf-ds-update-controls">
          <SegmentedControl
            options={UPDATE_GROUP_OPTIONS}
            value={updateGroup}
            onChange={chooseUpdateGroup}
            label="Update row group"
          />
          <SegmentedControl
            options={updateStates}
            value={updateState}
            onChange={setUpdateState}
            label="Update row state"
            size="small"
          />
        </div>
        <UpdateMenuPlate
          key={`${updateState}-${dark ? "dark" : "light"}`}
          state={updateState}
          dark={dark}
        />
        <p className="vf-ds-stage-caption">
          AU-2: the menu always carries one row about the app, nearest your face — it checks,
          downloads and restarts in place, and a restart that ends sessions grows the panel to 320
          into main's own question, Cancel first. While an install waits on you, a cyan dot sits
          beside your face: it pops in once, never pulses, and gives way to a waiting count.
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
