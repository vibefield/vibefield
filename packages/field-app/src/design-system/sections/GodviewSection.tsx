import { type ReactElement, useMemo } from "react";
import { ApprovalWaitCard } from "../../godview/ApprovalWaitMoment";
import { LimitMomentCard } from "../../godview/LimitMoment";
import { FIXTURE_APPROVAL_WAIT } from "../approval-wait-fixtures";
import { Section, Specimen } from "../catalog-ui";
import { GodviewPreview } from "../GodviewPreview";
import { meshBoardDoor } from "../godview-mesh-fixtures";
import { profileTabsDoor } from "../godview-profiles-fixtures";
import { spendDoor } from "../godview-spend-fixtures";
import { timelineDoor } from "../godview-timeline-fixtures";
import { FIXTURE_LIMIT_MOMENT } from "../limit-moment-fixtures";
import { PaneFrameDeck, PaneFramePreview } from "../PaneFramePreview";
import { PaneLauncherPreview } from "../PaneLauncherPreview";
import { PeekPlate } from "../PeekPreview";
import { SpawnBloomPreview } from "../SpawnBloomPreview";
import { SwarmBodiesPreview } from "../SwarmBodiesPreview";

/** The curtain's specimen question: two agents to resume, a shell pane to
 * reopen, and a bare shell that cannot come back — every line it can say. */
const LAST_RUN_QUESTION = {
  asOf: "2026-10-15T20:39:12.000Z",
  agents: [
    { id: "run-studio-q", name: "Claude Code in vibe-field" },
    { id: "run-studio-r", name: "Codex in puppeteer" },
  ],
  shells: 1,
  unplaced: 1,
};

export function GodviewSection({ dark = false }: { dark?: boolean } = {}): ReactElement {
  // Godview follows the app's theme (FC-D7): in the catalog, the page's.
  const theme = dark ? "dark" : "light";
  const profilesDoor = useMemo(() => profileTabsDoor(), []);
  const afternoonDoor = useMemo(() => timelineDoor(), []);
  const moneyDoor = useMemo(() => spendDoor(), []);
  const meshDoor = useMemo(() => meshBoardDoor(), []);
  return (
    <Section
      id="godview"
      index="11"
      eyebrow="Control room"
      title="A deliberate change of register"
      description="Godview is the instrument-stage exception: compact monospace controls, flat geometry, stark status bodies, and a parchment or graphite terminal deck. The swarm's bodies below are the views package's own fixtures drawn by the shipping renderer, so its state grammar is read as the pixels Godview paints."
    >
      <Specimen
        title="Godview stage — the head's circles switch the monitor's views (GV-D1); System control is the palette's act in the product"
        source="godview/GodviewStage.tsx · godview/GodviewHeadView.tsx"
        bleed
      >
        {/* the terminals up, though a launch opens away (W7, GV-D5): the stage's
            specimen shows the deck and its Lip, which away would hide */}
        <GodviewPreview theme={theme} systemControl deckState="up" />
      </Specimen>
      <Specimen
        title="Timeline — the swarm through time: five runs from their births to now, runtime only"
        source="@vibefield/puppeteer-views/views/timeline"
        bleed
      >
        <div data-godview-timeline-catalog="">
          <GodviewPreview door={afternoonDoor} initialView="timeline" theme={theme} />
        </div>
      </Specimen>
      <Specimen
        title="Spend — where the money went: what each agent spent in the last ten minutes, a line each from $0, runtime only"
        source="@vibefield/puppeteer-views/views/spend"
        bleed
      >
        <div data-godview-spend-catalog="">
          <GodviewPreview door={moneyDoor} initialView="spend" theme={theme} />
        </div>
      </Specimen>
      <Specimen
        title="Profile filter — Work's sessions on the stage, the others receded (chosen in search's Live now, GV-D3)"
        source="godview/GodviewMonitor.tsx"
        bleed
      >
        <div data-godview-profiles-catalog="">
          <GodviewPreview door={profilesDoor} theme={theme} initialProfile="work" />
        </div>
      </Specimen>
      <Specimen
        title="The limit moment — once, on the claims strip: a plan at 90% or more of a window while This Mac is the only profile (AO-6b)"
        source="godview/LimitMoment.tsx"
        bleed
      >
        <div data-godview-limit-catalog="">
          <GodviewPreview
            door={profilesDoor}
            theme={theme}
            moment={
              // the shipping card over the shipping rule's fixture; a catalog acts on no one
              FIXTURE_LIMIT_MOMENT === null ? null : (
                <LimitMomentCard
                  fact={FIXTURE_LIMIT_MOMENT}
                  onAddProfile={() => undefined}
                  onNotNow={() => undefined}
                />
              )
            }
          />
        </div>
      </Specimen>
      <Specimen
        title="The approval line — once, on the claims strip: an approval that waited more than ten minutes, as it clears, while this Mac is not connected (TS-4b)"
        source="godview/ApprovalWaitMoment.tsx"
        bleed
      >
        <div data-godview-approval-wait-catalog="">
          <GodviewPreview
            door={profilesDoor}
            theme={theme}
            moment={
              // the shipping card over the shipping watch's fixture; a catalog acts on no one
              FIXTURE_APPROVAL_WAIT === null ? null : (
                <ApprovalWaitCard
                  fact={FIXTURE_APPROVAL_WAIT}
                  onConnect={() => undefined}
                  onDismiss={() => undefined}
                />
              )
            }
          />
        </div>
      </Specimen>
      <Specimen
        title="Search in Godview — Live now over the monitor's runs, waiting first; the desktops and profiles in its scope row (GV-D3, P2)"
        source="frame/Peek.tsx"
        bleed
      >
        <PeekPlate state="live" />
      </Specimen>
      <Specimen
        title="Search in Godview, this Mac not connected — This Mac alone, and the desktop filter ends on Your other devices · Connect… (TS-4)"
        source="frame/PeekView.tsx"
        bleed
      >
        <PeekPlate state="unconnected" />
      </Specimen>
      <Specimen
        title="Mesh board — every self desktop's agents on one stage, an asleep one greyed"
        source="godview/monitor/mesh-field.ts"
        bleed
      >
        <div data-godview-mesh-catalog="">
          <GodviewPreview door={meshDoor} theme={theme} />
        </div>
      </Specimen>
      <Specimen
        title="Spawn bloom — hold empty ground, reach a profile, let go"
        source="@vibefield/puppeteer-views/views/swarm/AgentSwarm.tsx"
        bleed
      >
        <div data-spawn-bloom-catalog="">
          <SpawnBloomPreview view="swarm" />
        </div>
      </Specimen>
      <Specimen
        title="Spawn bloom — the list's ＋ TERMINAL offers the same tree, in two steps"
        source="@vibefield/puppeteer-views/views/list/AgentList.tsx"
        bleed
      >
        <div data-spawn-bloom-list-catalog="">
          <SpawnBloomPreview view="list" />
        </div>
      </Specimen>
      <Specimen
        title="What the last run left — the curtain over last run's picture, every view still under it, the view circles live (LR, James 2026-10-15)"
        source="godview/LastRunCurtain.tsx · godview/last-run.ts"
        bleed
      >
        <div data-godview-last-run-catalog="">
          <GodviewPreview
            door={profilesDoor}
            theme={theme}
            deckState="away"
            lastRun={{ phase: "asking", question: LAST_RUN_QUESTION }}
          />
        </div>
      </Specimen>
      <Specimen
        title="Deck — the Lip: the groove and the well"
        source="godview/GodviewStage.tsx · godview/GodviewDeckEdge.tsx"
        bleed
      >
        <div data-godview-lip-catalog="">
          <GodviewPreview theme={theme} deck={<PaneFrameDeck theme={theme} />} deckControls />
        </div>
      </Specimen>
      <Specimen
        title="Deck — away: the monitor alone (minimized; every session keeps running)"
        source="godview/GodviewStage.tsx · godview/godview.css"
        bleed
      >
        <div data-godview-away-catalog="">
          <GodviewPreview theme={theme} deckState="away" deck={<PaneFrameDeck theme={theme} />} />
        </div>
      </Specimen>
      <Specimen
        title="Deck — maximized: the bar as the title bar (the frame's search stands before the hairline in the window)"
        source="godview/GodviewStage.tsx · godview/godview.css"
        bleed
      >
        <div data-godview-maximized-catalog="">
          <GodviewPreview
            theme={theme}
            deckState="maximized"
            deckControls
            deck={<PaneFrameDeck theme={theme} />}
          />
        </div>
      </Specimen>
      <Specimen
        title="Pane frame — what the deck draws around every terminal"
        source="@vibefield/puppeteer-views/deck/PaneFrame.tsx"
        bleed
      >
        <PaneFramePreview />
      </Specimen>
      <Specimen
        title="Empty pane launcher — what a fresh shell offers: resume, or launch"
        source="@vibefield/puppeteer-views/launcher/PaneLauncherChrome.tsx"
        bleed
      >
        <PaneLauncherPreview />
      </Specimen>
      <Specimen
        title="Swarm bodies — every drawn state, on the package's own fixtures"
        source="@vibefield/puppeteer-views/views/swarm/AgentSwarm.tsx"
        bleed
      >
        <SwarmBodiesPreview />
      </Specimen>
    </Section>
  );
}
