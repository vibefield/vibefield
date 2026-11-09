import {
  AGENT_CATALOG,
  type ArtifactView,
  type IndexApp,
  type IndexAppsResult,
  type IndexAppsSource,
  type ProjectListResult,
  type ProjectSummary,
} from "@vibefield/contracts";
import { projectInkHex } from "@vibefield/design-kit";
import { type ReactElement, useMemo } from "react";
import { LiveApps } from "./LiveApps";
import { MadeApps } from "./MadeApps";
import type { MadeAppsClient } from "./made-apps";

// THE CATALOG'S ADAPTER for From your agents (docs/UI_SYSTEM.md "Catalog fidelity"): the SHIPPING `MadeApps` over a fixture
// client per state. Only what a host supplies is replaced — the client's answers, the clock, and the
// image transport (the catalog has no tailnet, so its stills are pictures it draws itself, as the
// hand's plates draw theirs). The markup, the interaction state, the accessibility and the CSS are
// the product's. Its states: populated, fallback icons, a library still reading, the apps a desktop
// cannot write out yet (rosetta 0.1.3, MA-4's witness), and empty.

export type MadeAppsPreviewState = "populated" | "fallback" | "reading" | "unbuilt" | "empty";

export const MADE_APPS_PREVIEW_STATES: readonly MadeAppsPreviewState[] = [
  "populated",
  "fallback",
  "reading",
  "unbuilt",
  "empty",
];

/** The plates' clock: 2026-11-05 at 15:00 on the viewer's own clock, since the days are local
 * calendar days (Chat's `dayWords`): a UTC clock would read "Yesterday" for an hour ago east of
 * UTC+9. */
export const MADE_APPS_FIXTURE_NOW = new Date(2026, 10, 5, 15, 0).getTime();
const hoursAgo = (h: number): number => MADE_APPS_FIXTURE_NOW - h * 3_600_000;

/** The agent the plates name, picked by index as the other fixtures pick theirs (R23b: never a
 * literal). */
const AGENT = AGENT_CATALOG[0];
const AGENT_KIND = AGENT?.seams.rosetta?.kind;

const STUDIO = "01J9ZK3M5Q8XR2V7N4B6C1D0EF";
const MINI = "01J9ZM0PQ7W3E6R8T2Y4U1I5O9";

const PROJECTS: readonly { key: string; name: string; ink: number }[] = [
  { key: "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8", name: "vibe-field", ink: 412 },
  { key: "p1:q2w4e6r8t0y1u3i5o7p9a2s4d6f8", name: "rosetta", ink: 77 },
];

function fixtureProject(project: { key: string; name: string; ink: number }): ProjectSummary {
  return {
    key: project.key,
    provisional: false,
    name: project.name,
    nameFrom: "folder",
    ink: project.ink,
    kind: "repo",
    bucket: null,
    devices: [STUDIO],
    places: [],
    sessions: 12,
    allGone: false,
    anchors: [],
    asOf: {},
    groupingVersion: 1,
  };
}

function hex64(seed: number): string {
  return seed.toString(16).padStart(2, "0").repeat(32).slice(0, 64);
}

function fixtureApp(
  seed: number,
  facts: {
    title: string;
    device?: string;
    at: number;
    project?: number;
    preview?: boolean;
    openable?: boolean;
    hostedUrl?: string;
    availability?: IndexApp["availability"];
  },
): IndexApp {
  const device = facts.device ?? STUDIO;
  const appId = hex64(seed);
  const project = facts.project === undefined ? undefined : PROJECTS[facts.project];
  return {
    appKey: `${device}:${appId}`,
    foldKey: facts.hostedUrl !== undefined ? `hosted:${facts.hostedUrl}` : `app:${device}:${appId}`,
    device,
    appId,
    devices: [device],
    presentationId: hex64(seed + 100),
    title: facts.title,
    filename: `${facts.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.html`,
    ...(AGENT_KIND !== undefined ? { kind: AGENT_KIND } : {}),
    ...(AGENT !== undefined ? { provider: AGENT.id } : {}),
    sessionId: `ses-${seed}`,
    timelineId: `artifact-message-${seed}`,
    versions: 1,
    publishedAt: facts.at,
    availability: facts.availability ?? "captured",
    ...(facts.hostedUrl !== undefined ? { hostedUrl: facts.hostedUrl } : {}),
    ...(facts.preview === true
      ? {
          preview: {
            id: "01JBD3ZJ4KX8Q9R2S6T7V0W1Y5",
            digest: hex64(seed + 200),
            pageDigest: hex64(seed + 300),
            capturedAt: facts.at,
          },
        }
      : {}),
    ...(project !== undefined ? { projectKey: project.key, ink: project.ink } : {}),
    openable: facts.openable ?? true,
  };
}

const STUDIO_SOURCE: IndexAppsSource = {
  device: STUDIO,
  name: "studio",
  self: true,
  state: "live",
  rows: 4,
  libraryReady: true,
  previewsBase: "https://studio.tail1234.ts.net:14211/",
};
const MINI_SOURCE: IndexAppsSource = {
  device: MINI,
  name: "mini",
  self: false,
  state: "asleep",
  rows: 1,
  libraryReady: true,
};
const SOURCES: readonly IndexAppsSource[] = [STUDIO_SOURCE, MINI_SOURCE];

const HOSTED = "https://claude.ai/public/artifacts/7d0c2f3a-1b4e-4f6a-9c8d-2e5b7a9c1d3f";

function fixtureAnswer(state: MadeAppsPreviewState): IndexAppsResult {
  switch (state) {
    case "populated":
      return {
        rows: [
          fixtureApp(1, {
            title: "Release notes, 0.9",
            at: hoursAgo(2),
            project: 0,
            preview: true,
          }),
          fixtureApp(2, { title: "Bundle size", at: hoursAgo(5), project: 0, preview: true }),
          fixtureApp(3, { title: "Palette study", at: hoursAgo(6), preview: true }),
          fixtureApp(4, {
            title: "Launch checklist",
            device: MINI,
            at: hoursAgo(26),
            project: 1,
            openable: false,
          }),
        ],
        sources: [...SOURCES],
      };
    case "fallback":
      return {
        rows: [
          fixtureApp(5, { title: "Release notes, 0.9", at: hoursAgo(2), project: 0 }),
          fixtureApp(6, { title: "Search ranking", at: hoursAgo(3), project: 1 }),
          fixtureApp(7, { title: "Onboarding copy", at: hoursAgo(26) }),
        ],
        sources: [...SOURCES],
      };
    case "reading":
      return {
        rows: [],
        sources: [{ ...STUDIO_SOURCE, rows: 0, libraryReady: false }],
      };
    case "unbuilt":
      return {
        rows: [
          fixtureApp(8, {
            title: "Release notes, 0.9",
            at: hoursAgo(2),
            project: 0,
            openable: false,
            hostedUrl: HOSTED,
          }),
          fixtureApp(9, { title: "Bundle size", at: hoursAgo(4), project: 0, openable: false }),
        ],
        sources: [...SOURCES],
      };
    case "empty":
      return { rows: [], sources: [{ ...STUDIO_SOURCE, rows: 0 }] };
  }
}

/** The plates' client: it answers the feed's two reads and its pings for one state, and every fieldd
 * act with nothing (an open or a mark on a plate never settles, so it reaches no daemon). The
 * shipping "Open in ‹host›" stays what it is, a real link to its fixture's hosted address. */
export function madeAppsPreviewClient(state: MadeAppsPreviewState): MadeAppsClient {
  const projects: ProjectListResult = {
    rows: PROJECTS.map(fixtureProject),
    sources: [],
    groupingVersion: 1,
  };
  return {
    async request(method): Promise<unknown> {
      if (method === "index.apps.list") return fixtureAnswer(state);
      if (method === "project.list") return projects;
      return new Promise(() => undefined);
    },
    subscribe() {
      return Promise.resolve({ snapshot: null, unsubscribe: () => undefined });
    },
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** A still the catalog draws itself, in two of the project inks (no colour literal): a page's ground
 * at the capture's 640 by 400 and a card on it. It is composed as a document and travels as an
 * address, as the product's previews do, so the well shows it exactly as it shows a capture. */
function fixtureStill(app: IndexApp): string {
  const ground = projectInkHex(app.ink ?? 0, "light");
  const paper = projectInkHex((app.ink ?? 0) + 5, "dark");
  const picture = document.createElementNS(SVG_NS, "svg");
  picture.setAttribute("width", "640");
  picture.setAttribute("height", "400");
  const shapes: readonly Record<string, string>[] = [
    { width: "640", height: "400", fill: ground },
    {
      x: "48",
      y: "56",
      width: "544",
      height: "220",
      rx: "18",
      fill: paper,
      "fill-opacity": "0.35",
    },
  ];
  for (const attributes of shapes) {
    const shape = document.createElementNS(SVG_NS, "rect");
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
    picture.appendChild(shape);
  }
  const markup = new XMLSerializer().serializeToString(picture);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

/** Design-page adapter for the shipping group. Only the client, the clock and the image transport
 * are replaced. Its form is its host's: a stage at the Apps shelf's width, a container. */
export function MadeAppsPreview({
  state = "populated",
}: {
  state?: MadeAppsPreviewState;
}): ReactElement {
  const client = useMemo(() => madeAppsPreviewClient(state), [state]);
  return (
    <MadeApps
      key={state}
      client={client}
      now={MADE_APPS_FIXTURE_NOW}
      locale="en-US"
      previewSrc={(app) => (app.preview === undefined ? undefined : fixtureStill(app))}
    />
  );
}

// LIVE's adapter, beside the group's own (FL-2; it was the plugin's `/design-system` door): the
// SHIPPING `LiveApps` over a fixture client per state. Only the product client is replaced: the
// markup, the interaction state, the accessibility and the CSS are the product's.

export type LiveAppsPreviewState = "empty" | "loading" | "populated" | "unavailable";

const LIVE_APPS_FIXTURE: readonly ArtifactView[] = [
  {
    artifactId: "01J3QH5XX6M8QPK7R2B4F9C1TZ",
    artifactKey: "device-a:01J3QH5XX6M8QPK7R2B4F9C1TZ",
    title: "VibeField docs",
    kind: "folder",
    originDeviceId: "device-a",
    originDeviceName: "Studio Mac",
    originBootId: "boot-a",
    originOnline: true,
    url: "https://studio-mac.example.ts.net:12000/",
    advertisedAvailability: "active",
    availability: "active",
    availabilityAt: 1_722_000_000_000,
    publishedAt: 1_722_000_000_000,
    updatedAt: 1_722_000_000_000,
    openable: true,
    editable: true,
  },
  {
    artifactId: "01J3QH5XX6M8QPK7R2B4F9C1TY",
    artifactKey: "device-b:01J3QH5XX6M8QPK7R2B4F9C1TY",
    title: "Renderer preview",
    kind: "proxy",
    originDeviceId: "device-b",
    originDeviceName: "Travel Mac",
    originBootId: "boot-b",
    originOnline: false,
    advertisedAvailability: "active",
    availability: "source-unavailable",
    availabilityAt: 1_722_000_000_000,
    publishedAt: 1_722_000_000_000,
    updatedAt: 1_722_000_000_000,
    openable: false,
    editable: false,
  },
];

function liveAppsPreviewClient(state: LiveAppsPreviewState): MadeAppsClient {
  return {
    async request(): Promise<unknown> {
      return {};
    },
    subscribe(_method, _params, _onEvent) {
      if (state === "loading") return new Promise(() => undefined);
      if (state === "unavailable") {
        return Promise.reject(
          Object.assign(new Error("preview unavailable"), { kind: "UNAVAILABLE" }),
        );
      }
      return Promise.resolve({
        snapshot: state === "populated" ? LIVE_APPS_FIXTURE : [],
        unsubscribe: () => undefined,
      });
    },
  };
}

/** Design-page adapter for Live. Only the product client is replaced. Its form is its host's: a
 * stage at the Apps shelf's width, a container, draws its tiles. */
export function LiveAppsPreview({
  state = "empty",
}: {
  state?: LiveAppsPreviewState;
}): ReactElement {
  const client = useMemo(() => liveAppsPreviewClient(state), [state]);
  return <LiveApps client={client} />;
}
