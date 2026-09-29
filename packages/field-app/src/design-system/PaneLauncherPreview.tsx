import {
  buildLauncherResults,
  cantLaunchLine,
  type LauncherBusy,
  type LauncherHistoryStatus,
  type LauncherScope,
  type LauncherSession,
  type LauncherWordHit,
  launcherFolder,
  orderAgents,
  PaneLauncherChrome,
} from "@vibecook/puppeteer-views/launcher";
import { AGENT_CATALOG, type AgentProviderSummary } from "@vibefield/contracts";
import type { CSSProperties, ReactElement } from "react";
import { DEFAULT_DECK_APPEARANCE } from "../godview/deck-appearance";
import { godviewTerminalTheme, terminalGround } from "../godview/deck-theme";
import { launcherAgents, launcherSession } from "../godview/launcher-doors";

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
    id: "launching",
    caption: "⌥2 pressed — the row fills in the pane colour until the launch answers",
    busy: { kind: "launch", index: 1 },
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
  const sessions = specimen.sessions === undefined ? SESSIONS : specimen.sessions;
  const results =
    specimen.open === true && sessions !== false
      ? buildLauncherResults({
          sessions,
          hits: specimen.hits ?? [],
          query,
          scope,
          folder,
          agents: AGENTS,
          nowMs: NOW,
        })
      : undefined;
  const height = specimen.height ?? 300;
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
            width: specimen.width ?? 380,
            height,
            background: ground.background,
            "--ghostty-pane-color": PANE_COLOR,
          } as CSSProperties
        }
      >
        <PaneLauncherChrome
          sessionId={`catalog-${specimen.id}`}
          agents={AGENTS}
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
