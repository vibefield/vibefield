import { AGENT_CATALOG, type AgentProviderSummary } from "@vibefield/contracts";
import {
  buildLauncherResults,
  cantLaunchLine,
  LAUNCH_PATCH_RADIUS,
  type LauncherBusy,
  type LauncherHistoryStatus,
  type LauncherScope,
  type LauncherSession,
  type LauncherUnder,
  type LauncherWordHit,
  launchCaption,
  launchCentre,
  launcherFolder,
  launchReach,
  orderAgents,
  PaneLaunchChrome,
  PaneLauncherChrome,
} from "@vibefield/puppeteer-views/launcher";
import type { CSSProperties, ReactElement } from "react";
import { DEFAULT_DECK_APPEARANCE } from "../godview/deck-appearance";
import { godviewTerminalTheme, terminalGround } from "../godview/deck-theme";
import { launcherAgents, launcherSession, NO_SIGN_IN } from "../godview/launcher-doors";

/**
 * THE EMPTY PANE LAUNCHER, as the deck ships it (QL-1, Minimal Pane Frame
 * pass 3 §19 — every face L1 can show).
 *
 * Mounted whole: `PaneLauncherChrome` is the shipping markup,
 * `buildLauncherResults` the shipping model over the list, and `launcherAgents`
 * the shipping projection VibeField feeds the agents through. This file owns no
 * markup and no stylesheet of its own (docs/UI_SYSTEM.md's fixture-adapter
 * rule): it supplies what a HOST supplies — a pane to stand in, the terminal
 * ground and ink, the pane colour, and door answers that never happened. The
 * agents are the contract's own catalog rows, so no agent id is written here.
 *
 * The markup half and not the portal: the launcher's states are its own (the
 * field open, a query typed, a history answer), set by keys and ports the
 * catalog has none of, so each specimen forces one as the tests do.
 */

/** A fixed clock, so the ages read the same in every capture. */
const NOW = Date.parse("2026-09-28T21:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CWD = "/Users/j/src/puppeteer";
const PANE_COLOR = "oklch(0.62 0.15 250)";

/** The catalog's own rows as `agent.providers` would answer them: every agent
 * installed except the fourth (the can't-launch face), two launched lately. */
const PROVIDERS: readonly AgentProviderSummary[] = AGENT_CATALOG.map((row, index) => ({
  id: row.id,
  label: row.label,
  available: index !== 3,
  resumable: row.offers.resume,
  personas: [],
  status: row.status,
  offers: row.offers,
  ...(index === 1 ? { lastLaunchedAt: NOW - 2 * HOUR } : {}),
  ...(index === 0 ? { lastLaunchedAt: NOW - DAY } : {}),
}));

const AGENTS = orderAgents(launcherAgents(PROVIDERS)).slice(0, 10);

/** SB-3 — a shell born under Work, the desktop's default profile: Work holds
 * sign-ins for the catalog's first two agents, so every other agent reads
 * `no sign-in` there, through the same shipping projection. */
const UNDER_WORK: LauncherUnder = {
  label: "Work",
  glyph: "briefcase",
  kind: "managed",
  isDefault: true,
  agents: orderAgents(
    launcherAgents(PROVIDERS, [], {
      label: "Work",
      kind: "managed",
      personas: PROVIDERS.slice(0, 2).map((provider) => ({
        profileId: `work-${provider.id}`,
        provider: provider.id,
        label: provider.label,
        kind: "managed" as const,
        createdAt: "2026-09-28T00:00:00.000Z",
      })),
    }),
  ).slice(0, 10),
};
const noSignIn = UNDER_WORK.agents?.findIndex((agent) => agent.unavailable === NO_SIGN_IN) ?? -1;
const noSignInAgent = UNDER_WORK.agents?.[noSignIn];
const FIRST = AGENTS[0]?.providerId;
const SECOND = AGENTS[1]?.providerId;

function session(
  key: string,
  title: string,
  options: Partial<LauncherSession> & { agoMs: number },
): LauncherSession {
  const { agoMs, ...rest } = options;
  return {
    key,
    title,
    here: true,
    cwd: CWD,
    lastAt: NOW - agoMs,
    resumable: true,
    ...(FIRST !== undefined ? { providerId: FIRST } : {}),
    ...rest,
  };
}

const SESSIONS: readonly LauncherSession[] = [
  session("s1", "Launcher ledger: the clearing and the two-column legend", { agoMs: 2 * HOUR }),
  session("s2", "Pane frame narrow tiers", {
    agoMs: 5 * HOUR,
    ...(SECOND !== undefined ? { providerId: SECOND } : {}),
    branch: "feat/pane-launcher",
  }),
  session("s3", "Find sheet: the words lane", { agoMs: DAY + HOUR }),
  session("s4", "Rosetta project grouping for worktrees", {
    agoMs: 18 * DAY,
    here: false,
    cwd: "/Users/j/src/rosetta",
  }),
  // the gone folder is fieldd's answer, not the catalog's words: an
  // `index.recent` row saying its folder is not on this device, through the
  // shipping projection
  launcherSession(
    {
      sessionId: "s5",
      nativeSessionId: "catalog-s5",
      rootSessionId: "s5",
      title: "Ledger import from the old checkout",
      cwd: "/Users/j/src/old-ledger",
      updatedAt: NOW - 30 * DAY,
      activity: { firstAt: NOW - 30 * DAY - HOUR, lastAt: NOW - 30 * DAY },
      streamState: "indexed",
      ...(FIRST !== undefined ? { provider: FIRST } : {}),
      here: false,
      cwdExists: false,
    },
    PROVIDERS,
  ),
];

const WORD_HITS: readonly LauncherWordHit[] = [
  {
    sessionKey: "s3",
    kind: "user",
    snippet: "keep the [ledger] rows in the order the index gives",
  },
];

interface LauncherSpecimen {
  id: string;
  caption: string;
  active?: boolean;
  open?: boolean;
  query?: string;
  scope?: LauncherScope;
  history?: LauncherHistoryStatus;
  /** false: nothing has answered yet */
  sessions?: readonly LauncherSession[] | false;
  hits?: readonly LauncherWordHit[];
  hoverIndex?: number;
  busy?: LauncherBusy;
  failure?: string;
  width?: number;
  height?: number;
  /** A launch in this pane (QL-2): the launch's face instead of the launcher's. */
  launch?: { phase: "starting" | "opening"; elapsedMs: number };
  /** The Agent Profile the pane's shell was born under (SB-3), with its agents. */
  under?: LauncherUnder;
}

const READY: LauncherHistoryStatus = { readiness: "ready" };
const unavailable = AGENTS.findIndex((agent) => agent.unavailable !== undefined);
const unavailableAgent = AGENTS[unavailable];

const SPECIMENS: readonly LauncherSpecimen[] = [
  { id: "rest", caption: "a fresh shell, selected — the field and the agents, last used first" },
  {
    id: "hover",
    caption: "an agent under the pointer — the preview names what a launch would run",
    hoverIndex: 1,
  },
  {
    id: "cant-launch",
    caption: "an agent that can't start here — its reason where the key was, and a click says so",
    hoverIndex: unavailable,
    // the launcher's own sentence (the specimen test also clicks the real
    // component and holds the two together)
    ...(unavailableAgent !== undefined ? { failure: cantLaunchLine(unavailableAgent) } : {}),
  },
  {
    id: "resting",
    caption: "an empty pane that is not selected keeps only its field",
    active: false,
  },
  {
    id: "focus",
    caption: "⌥↵ — this folder's latest sessions at once, the first highlighted",
    open: true,
    history: READY,
  },
  {
    id: "typed-here",
    caption: "typed, here — the title matched, and a transcript line where the words matched",
    open: true,
    query: "ledger",
    history: READY,
    hits: WORD_HITS,
  },
  {
    id: "typed-all",
    caption: "typed, all folders — elsewhere names its folder; a gone folder withholds ↵",
    open: true,
    query: "ledger",
    scope: "all",
    history: READY,
    hits: WORD_HITS,
  },
  {
    id: "no-match",
    caption: "nothing matched — the sentence says where it looked",
    open: true,
    query: "zeppelin",
    history: READY,
  },
  {
    id: "catching-up",
    caption: "history still reading — the rows found so far, and the count read",
    open: true,
    history: { readiness: "catching-up", progress: { done: 1204, total: 3880 } },
  },
  {
    id: "not-answering",
    caption: "history not answering — one sentence; the agents still launch",
    open: true,
    history: { readiness: "unreachable", detail: "the agent index is stopped" },
    sessions: [],
  },
  {
    id: "launch-starting",
    caption:
      "⌥2 — the launcher left toward the mark in the click's frame; the cell grid wakes around it while the agent starts",
    launch: { phase: "starting", elapsedMs: 2_400 },
  },
  {
    id: "launch-opening",
    caption: "the agent runs in the pane — the grid reaches the corners until its first frame",
    launch: { phase: "opening", elapsedMs: 3_100 },
  },
  {
    id: "under-work",
    caption:
      "a shell born under Work — New · Under Work, Work's own agents, and one it holds no sign-in for, off",
    under: UNDER_WORK,
  },
  {
    id: "under-work-no-sign-in",
    caption: "…and a click on that one says why — the launch would run under Work, which has none",
    under: UNDER_WORK,
    hoverIndex: noSignIn,
    ...(noSignInAgent !== undefined ? { failure: cantLaunchLine(noSignInAgent) } : {}),
  },
  { id: "narrow", caption: "narrow — under 250px, five marks and Resume…", width: 240 },
  { id: "short", caption: "short — under 220px tall, the marks in one row", height: 200 },
];

function Specimen({
  specimen,
  ground,
}: {
  specimen: LauncherSpecimen;
  ground: { background: string; ink: string };
}): ReactElement {
  const scope = specimen.scope ?? "here";
  const query = specimen.query ?? "";
  const folder = launcherFolder(CWD);
  const agents = specimen.under?.agents ?? AGENTS;
  const sessions = specimen.sessions === undefined ? SESSIONS : specimen.sessions;
  const results =
    specimen.open === true && sessions !== false
      ? buildLauncherResults({
          sessions,
          hits: specimen.hits ?? [],
          query,
          scope,
          folder,
          agents,
          nowMs: NOW,
        })
      : undefined;
  const height = specimen.height ?? 300;
  const width = specimen.width ?? 380;
  const launching = AGENTS[1];
  const centre = launchCentre(width, height);
  return (
    <figure className="vf-ds-pane-frame-figure">
      {/* The host's pane, standing in for ghosttea's: its class, the colour
          the workspace sets, the ground the terminal draws on, and a real size
          — the launcher's own container queries decide the narrow tiers. */}
      <div
        className="ghostty-pane is-active"
        data-pane-accent=""
        style={
          {
            position: "relative",
            width,
            height,
            background: ground.background,
            "--ghostty-pane-color": PANE_COLOR,
          } as CSSProperties
        }
      >
        {specimen.launch && launching ? (
          // The launch the shipping deck draws, at one moment of its wait: the
          // agent is the catalog's second row, as ⌥2 would launch it.
          <PaneLaunchChrome
            launchId={`catalog-${specimen.id}`}
            verb="launch"
            providerId={launching.providerId}
            label={launching.label}
            phase={specimen.launch.phase}
            caption={launchCaption("launch", specimen.launch.phase, specimen.launch.elapsedMs)}
            color={PANE_COLOR}
            centre={centre}
            reach={
              specimen.launch.phase === "opening"
                ? launchReach(width, height, centre)
                : LAUNCH_PATCH_RADIUS
            }
            lit
            waiting
          />
        ) : (
          <PaneLauncherChrome
            sessionId={`catalog-${specimen.id}`}
            agents={agents}
            {...(specimen.under ? { under: specimen.under } : {})}
            folder={folder}
            color={PANE_COLOR}
            active={specimen.active ?? true}
            short={height < 220}
            open={specimen.open === true}
            query={query}
            scope={scope}
            {...(results ? { results } : {})}
            highlight={results && results.rows.length > 0 ? 0 : -1}
            {...(specimen.history ? { history: specimen.history } : {})}
            {...(specimen.hoverIndex !== undefined ? { hoverIndex: specimen.hoverIndex } : {})}
            {...(specimen.busy ? { busy: specimen.busy } : {})}
            {...(specimen.failure ? { failure: specimen.failure } : {})}
          />
        )}
      </div>
      <figcaption>{specimen.caption}</figcaption>
    </figure>
  );
}

export function PaneLauncherPreview(): ReactElement {
  const light = terminalGround(godviewTerminalTheme(DEFAULT_DECK_APPEARANCE, "light"));
  const dark = terminalGround(godviewTerminalTheme(DEFAULT_DECK_APPEARANCE, "dark"));
  return (
    <div className="vf-ds-pane-frames">
      {[
        { id: "light", ground: light },
        { id: "dark", ground: dark },
      ].map((theme) => (
        <div
          key={theme.id}
          className="vf-deck-framed vf-ds-pane-frame-deck"
          style={
            {
              "--vf-godview-terminal-ink": theme.ground.ink,
              "--vf-pane-launcher-ground": theme.ground.background,
            } as CSSProperties
          }
        >
          {SPECIMENS.map((specimen) => (
            <Specimen key={specimen.id} specimen={specimen} ground={theme.ground} />
          ))}
        </div>
      ))}
    </div>
  );
}
