// @vitest-environment happy-dom

/**
 * MA-4a — FROM YOUR AGENTS, the Apps shelf's second group (DESIGN.md §8 "Artifacts — the Artifacts
 * shelf's contents", as amended 2026-11-05; §2.9's one exception, "a made app's fallback icon"; §9
 * "Apps"; the build plan's §3 "4a" as the lead's RULINGS amend it). Its reading (`index.apps.list`
 * paged, `index.apps.subscribe`'s pings), its acts (`artifact.open {appId, device, reveal: true}` —
 * the home opens the URL, the window never holds `shell.open`; `artifact.mark {foldKey, …}` once;
 * Versions over `index.artifacts {device, appId}`), its tile (the 16:10 well with the preview and
 * its two retries, or the fallback squircle), its honest states (a library still reading, a desktop
 * asleep or on another build, a page not kept or too large, and MA-4's witness, C4: an app its
 * desktop cannot write out yet, with "Open in ‹host›" when it is hosted), its tile form in CSS, and
 * the catalog's plate on its fixture adapter. Every door is a FAKE here: fieldd's handlers are
 * MA-3e's and are proven on the mini.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_CATALOG,
  AGENT_CATALOG_READERS,
  type IndexApp,
  type IndexAppsResult,
  type IndexAppsSource,
  type IndexArtifactEntry,
  madeAppPreviewUrl,
  PROJECT_DOORS,
  type ProjectSummary,
} from "@vibefield/contracts";
import { projectInk } from "@vibefield/design-kit";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dayWords } from "../src/chat/transcript-items";
import {
  MADE_APPS_FIXTURE_NOW,
  MADE_APPS_PREVIEW_STATES,
  MadeAppsPreview,
  madeAppsPreviewClient,
} from "../src/frame/apps/design-system";
import { MadeApps } from "../src/frame/apps/MadeApps";
import {
  FROM_YOUR_AGENTS,
  MADE_APP_OPEN_RETRY_DELAYS_MS,
  MADE_APP_OPENING_LATE_MS,
  MADE_APP_PREVIEW_RETRY_DELAYS_MS,
  MADE_APP_SERVING_HELD_MS,
  MADE_APPS_MAX_PAGES,
  MADE_APPS_PAGE_LIMIT,
  MADE_APPS_QUERY_MAX,
  MADE_APPS_SEARCH_DEBOUNCE_MS,
  MADE_APPS_VERSIONS_LIMIT,
  type MadeAppsClient,
  madeAppAgentLabel,
  madeAppAt,
  madeAppAway,
  madeAppDays,
  madeAppDesktop,
  madeAppErrorWords,
  madeAppFacts,
  madeAppHost,
  madeAppImageUrl,
  madeAppInitial,
  madeAppProjectNames,
  madeAppRefusalOf,
  madeAppStateOf,
  madeAppsReadingLines,
  madeAppVersions,
  markMadeApp,
  openMadeApp,
  pageMadeApps,
  SEARCH_APPS,
} from "../src/frame/apps/made-apps";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS = readFileSync(join(PACKAGE_ROOT, "src/frame/apps/made-apps.css"), "utf8");
const TOKENS = readFileSync(join(PACKAGE_ROOT, "../design-kit/src/tokens.css"), "utf8");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
});

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────

/** 15:00 on the host's own clock: the days are local calendar days (Chat's `dayWords`), so a UTC clock
 * would fail these rows east of UTC+9. */
const NOW = new Date(2026, 10, 5, 15, 0).getTime();
const hoursAgo = (h: number): number => NOW - h * 3_600_000;
/** The agent the rows name, by index (never a literal, as the product's fixtures pick theirs). */
const AGENT = AGENT_CATALOG[0];
const AGENT_KIND = AGENT?.seams.rosetta?.kind;
const STUDIO = "01J9ZK3M5Q8XR2V7N4B6C1D0EF";
const MINI = "01J9ZM0PQ7W3E6R8T2Y4U1I5O9";
const HOSTED = "https://claude.ai/public/artifacts/7d0c2f3a-1b4e-4f6a-9c8d-2e5b7a9c1d3f";
const VIBE_FIELD = { key: "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8", name: "vibe-field", ink: 412 };
const PREVIEW_ID = "01JBD3ZJ4KX8Q9R2S6T7V0W1Y5";

const hex64 = (seed: number): string =>
  seed.toString(16).padStart(2, "0").repeat(32).slice(0, 64);

function app(seed: number, over: Partial<IndexApp> = {}): IndexApp {
  const device = over.device ?? STUDIO;
  const appId = hex64(seed);
  return {
    appKey: `${device}:${appId}`,
    foldKey: `app:${device}:${appId}`,
    device,
    appId,
    devices: [device],
    presentationId: hex64(seed + 100),
    title: `App ${seed}`,
    filename: `app-${seed}.html`,
    ...(AGENT_KIND !== undefined ? { kind: AGENT_KIND } : {}),
    ...(AGENT !== undefined ? { provider: AGENT.id } : {}),
    sessionId: `ses-${seed}`,
    timelineId: `artifact-message-${seed}`,
    versions: 1,
    publishedAt: hoursAgo(seed),
    availability: "captured",
    projectKey: VIBE_FIELD.key,
    ink: VIBE_FIELD.ink,
    openable: true,
    ...over,
  };
}

const preview = (seed: number): NonNullable<IndexApp["preview"]> => ({
  id: PREVIEW_ID,
  digest: hex64(seed + 200),
  pageDigest: hex64(seed + 300),
  capturedAt: hoursAgo(seed),
});

const STUDIO_SOURCE: IndexAppsSource = {
  device: STUDIO,
  name: "studio",
  self: true,
  state: "live",
  rows: 3,
  libraryReady: true,
  previewsBase: "https://studio.tail1234.ts.net:14211/",
};
const MINI_SOURCE: IndexAppsSource = {
  device: MINI,
  name: "mini",
  self: false,
  state: "live",
  rows: 1,
  libraryReady: true,
  previewsBase: "https://mini.tail1234.ts.net:15002/",
};

function project(summary: { key: string; name: string; ink: number }): ProjectSummary {
  return {
    key: summary.key,
    provisional: false,
    name: summary.name,
    nameFrom: "folder",
    ink: summary.ink,
    kind: "repo",
    bucket: null,
    devices: [STUDIO],
    places: [],
    sessions: 3,
    allGone: false,
    anchors: [],
    asOf: {},
    groupingVersion: 1,
  };
}

function entry(seed: number, at: number, over: Partial<IndexArtifactEntry> = {}): IndexArtifactEntry {
  return {
    device: STUDIO,
    presentationId: hex64(seed),
    appId: hex64(1),
    sessionId: "ses-1",
    timelineId: `artifact-message-${seed}`,
    title: "App 1",
    filename: "app-1.html",
    publishedAt: at,
    availability: "captured",
    recovered: false,
    versions: 2,
    ...over,
  };
}

/** An error as the window's client throws one (FielddRpcError's fields). */
function rpcError(kind: string, details?: unknown): Error {
  return Object.assign(new Error(kind), { kind, retryable: false, details });
}

// ── the fake client ─────────────────────────────────────────────────────────────────────────────

interface Call {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

type Route = (params: Record<string, unknown>) => unknown;

function fakeClient(routes: Partial<Record<string, Route>> = {}) {
  const calls: Call[] = [];
  const pings: Array<(payload: unknown) => void> = [];
  const defaults: Record<string, Route> = {
    "index.apps.list": () => ({ rows: [], sources: [STUDIO_SOURCE] }) satisfies IndexAppsResult,
    "project.list": () => ({ rows: [project(VIBE_FIELD)], sources: [], groupingVersion: 1 }),
    "artifact.open": () => ({ state: "serving", url: "https://studio.tail1234.ts.net:13001/" }),
    "artifact.mark": (params) => ({
      foldKey: params["foldKey"],
      kept: params["kept"] === true,
      hidden: params["hidden"] === true,
    }),
    "index.artifacts": () => ({ entries: [], canonicalReady: true }),
  };
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    const route = routes[method] ?? defaults[method];
    if (route === undefined) throw rpcError("NOT_FOUND");
    return await route(params);
  });
  const subscribe = vi.fn(
    async (method: string, params: Record<string, unknown>, onEvent: (payload: unknown) => void) => {
      calls.push({ method, params });
      pings.push(onEvent);
      return { snapshot: null, unsubscribe: () => undefined };
    },
  );
  const client: MadeAppsClient = { request, subscribe };
  return {
    client,
    calls,
    callsOf: (method: string): Call[] => calls.filter((call) => call.method === method),
    ping: async (): Promise<void> => {
      await act(async () => {
        for (const ping of pings) ping({ rows: [] });
      });
      await settle();
    },
  };
}

// ── mounting and reading the DOM (no helper throws: a missing element fails its own assertion) ──

async function settle(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(client: MadeAppsClient, here = "This Mac"): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<MadeApps client={client} now={NOW} locale="en-US" here={here} />);
  });
  await settle();
}

const text = (): string => container?.textContent ?? "";
const tiles = (): HTMLLIElement[] => [
  ...(container?.querySelectorAll<HTMLLIElement>(".vf-apps-tile") ?? []),
];
const tileTitles = (): string[] =>
  tiles().map((tile) => tile.querySelector("strong")?.textContent ?? "");
const tileOf = (title: string): HTMLLIElement | undefined =>
  tiles().find((tile) => tile.querySelector("strong")?.textContent === title);
const statusOf = (title: string): string | undefined =>
  tileOf(title)?.querySelector(".vf-apps-status")?.textContent ?? undefined;
const toneOf = (title: string): string | null | undefined =>
  tileOf(title)?.querySelector(".vf-ui-status-dot")?.getAttribute("data-tone");
const openOf = (title: string): HTMLButtonElement | undefined =>
  tileOf(title)?.querySelector<HTMLButtonElement>(".vf-apps-tile__open") ?? undefined;
const actIn = (scope: Element | undefined, label: string): HTMLElement | undefined =>
  [...(scope?.querySelectorAll<HTMLElement>("button, a") ?? [])].find(
    (element) => element.textContent?.trim() === label,
  );
const notice = (): Element | undefined =>
  container?.querySelector(".vf-apps-notice") ?? undefined;
const dayHeadings = (): string[] =>
  [...(container?.querySelectorAll(".vf-apps-day > h3") ?? [])].map(
    (heading) => heading.textContent ?? "",
  );

async function press(element: HTMLElement | undefined): Promise<void> {
  await act(async () => {
    element?.click();
  });
  await settle();
}

function setSearch(value: string): void {
  const input = container?.querySelector<HTMLInputElement>('input[type="search"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (input !== null && input !== undefined) {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

// ── the group's reading, pure ───────────────────────────────────────────────────────────────────

describe("the group's reading (pure)", () => {
  it("orders an app by publishedAt, then capturedAt, then nothing (H6)", () => {
    expect(madeAppAt(app(1, { publishedAt: 5, capturedAt: 9 }))).toBe(5);
    const { publishedAt: _published, ...unpublished } = app(2, { capturedAt: 7 });
    expect(madeAppAt(unpublished)).toBe(7);
    const { publishedAt: _none, ...undated } = app(3);
    expect(madeAppAt(undated)).toBe(0);
  });

  it("groups newest first by day — Today, Yesterday, the weekday and date — and an undated app last", () => {
    const { publishedAt: _none, ...undated } = app(9, { title: "Undated" });
    const days = madeAppDays(
      [
        app(2, { title: "An hour ago", publishedAt: hoursAgo(1) }),
        app(3, { title: "Two hours ago", publishedAt: hoursAgo(2) }),
        app(4, { title: "Yesterday's", publishedAt: hoursAgo(26) }),
        app(5, { title: "Last week's", publishedAt: hoursAgo(72) }),
        undated,
      ],
      NOW,
      "en-US",
    );
    expect(days.map((day) => day.label)).toEqual([
      "Today",
      "Yesterday",
      dayWords(hoursAgo(72), NOW, "en-US"),
      "No date",
    ]);
    expect(days.map((day) => day.apps.map((one) => one.title))).toEqual([
      ["An hour ago", "Two hours ago"],
      ["Yesterday's"],
      ["Last week's"],
      ["Undated"],
    ]);
  });

  it("names the agent by the catalog's label — the provider, else the kind — and no literal (R23b)", () => {
    expect(AGENT, "the catalog has a first row").toBeDefined();
    expect(madeAppAgentLabel(app(1))).toBe(AGENT?.label);
    const { provider: _provider, ...kindOnly } = app(2);
    expect(madeAppAgentLabel(kindOnly)).toBe(
      AGENT_CATALOG_READERS.entry(AGENT_CATALOG_READERS.idForKind(AGENT_KIND ?? "") ?? "")?.label,
    );
    const { provider: _p, kind: _k, ...nobody } = app(3);
    expect(madeAppAgentLabel(nobody)).toBeUndefined();
  });

  it("says the fact line ‹agent› · ‹project›, either alone, else the page's file name (§8)", () => {
    const names = new Map([[VIBE_FIELD.key, VIBE_FIELD.name]]);
    expect(madeAppFacts(app(1), names)).toBe(`${AGENT?.label} · vibe-field`);
    expect(madeAppFacts(app(1), new Map())).toBe(AGENT?.label);
    const { provider: _p, kind: _k, ...nobody } = app(2);
    expect(madeAppFacts(nobody, names)).toBe("vibe-field");
    const { projectKey: _key, ...orphan } = nobody;
    expect(madeAppFacts(orphan, names)).toBe("app-2.html");
  });

  it("draws the fallback's letter from the title's first letter or digit, upper case (§2.9)", () => {
    expect(madeAppInitial({ title: "release notes", filename: "a.html" })).toBe("R");
    expect(madeAppInitial({ title: "  3d chart", filename: "a.html" })).toBe("3");
    expect(madeAppInitial({ title: "— éclair", filename: "a.html" })).toBe("É");
    expect(madeAppInitial({ title: "!!!", filename: "x-ray.html" })).toBe("X");
  });

  it("reads the host of a hosted link as data, and nothing from what is no link (L22)", () => {
    expect(madeAppHost(HOSTED)).toBe("claude.ai");
    expect(madeAppHost(undefined)).toBeUndefined();
    expect(madeAppHost("not a link")).toBeUndefined();
  });

  it("derives the image from the app's OWN desktop's previewsBase, never another's, never stored (RULINGS L2, C6)", () => {
    const own = app(1, { preview: preview(1) });
    expect(madeAppImageUrl(own, [STUDIO_SOURCE, MINI_SOURCE])).toBe(
      madeAppPreviewUrl(STUDIO_SOURCE.previewsBase ?? "", preview(1)),
    );
    const { previewsBase: _base, ...bare } = MINI_SOURCE;
    const peer = app(2, { device: MINI, preview: preview(2) });
    expect(madeAppImageUrl(peer, [STUDIO_SOURCE, bare])).toBeUndefined();
    expect(madeAppImageUrl(app(3), [STUDIO_SOURCE])).toBeUndefined();
  });

  it("names a desktop as the roster does, this one by its own word, and a stranger plainly", () => {
    expect(madeAppDesktop(STUDIO_SOURCE, STUDIO, "This Mac")).toBe("studio");
    const { name: _name, ...nameless } = STUDIO_SOURCE;
    expect(madeAppDesktop(nameless, STUDIO, "This Mac")).toBe("This Mac");
    expect(madeAppDesktop(undefined, MINI, "This Mac")).toBe("Another desktop");
  });

  it("says each desktop whose library is still reading its history, and only those (libraryReady false)", () => {
    const { libraryReady: _unknown, ...unheard } = MINI_SOURCE;
    expect(
      madeAppsReadingLines([{ ...STUDIO_SOURCE, libraryReady: false }, unheard], "This Mac"),
    ).toEqual([{ key: STUDIO, words: "studio is still reading its history" }]);
    expect(madeAppsReadingLines([STUDIO_SOURCE, MINI_SOURCE], "This Mac")).toEqual([]);
  });

  it("says this desktop is still reading while its own source is stale — 3e's mark before its first walk — and never a peer's stale", () => {
    const { libraryReady: _unheard, name: _name, ...bare } = STUDIO_SOURCE;
    const unread = { ...bare, state: "stale" as const, rows: 0 };
    expect(madeAppsReadingLines([unread], "This Mac")).toEqual([
      { key: STUDIO, words: "This Mac is still reading its history" },
    ]);
    // one line for this desktop, whether or not its library also said false
    expect(madeAppsReadingLines([{ ...unread, libraryReady: false }], "This Mac")).toHaveLength(1);
    expect(madeAppsReadingLines([{ ...MINI_SOURCE, state: "stale" }], "This Mac")).toEqual([]);
    expect(madeAppAway(unread)).toBe(false);
    expect(madeAppAway({ ...MINI_SOURCE, state: "stale" })).toBe(true);
    expect(madeAppAway({ ...MINI_SOURCE, state: "asleep" })).toBe(true);
    expect(madeAppAway(STUDIO_SOURCE)).toBe(false);
  });

  it("keys each reading line by its desktop, so two the roster names none are two lines", () => {
    const { name: _a, ...first } = MINI_SOURCE;
    const second = { ...first, device: "01J9ZQ1A2B3C4D5E6F7G8H9J0K" };
    const lines = madeAppsReadingLines(
      [
        { ...first, libraryReady: false },
        { ...second, libraryReady: false },
      ],
      "This Mac",
    );
    expect(lines.map((line) => line.words)).toEqual([
      "Another desktop is still reading its history",
      "Another desktop is still reading its history",
    ]);
    expect(new Set(lines.map((line) => line.key)).size).toBe(2);
  });
});

// ── a made tile's state ─────────────────────────────────────────────────────────────────────────

describe("a made tile's state (§8: serving green, failed red, the rest muted, each in words)", () => {
  const release = app(1, { title: "Release notes" });

  it("rests ready, with no word, on a live desktop; serves green once this window's open answered", () => {
    expect(madeAppStateOf(release, STUDIO_SOURCE, undefined, "studio")).toEqual({
      tone: "muted",
      word: null,
      opens: true,
      why: null,
    });
    expect(madeAppStateOf(release, STUDIO_SOURCE, { kind: "serving" }, "studio")).toEqual({
      tone: "healthy",
      word: null,
      opens: true,
      why: null,
    });
    // §9's "Opening on ‹desktop›…" is the tile's to draw, late: no word of its own
    expect(madeAppStateOf(release, STUDIO_SOURCE, { kind: "opening" }, "studio")).toEqual({
      tone: "muted",
      word: null,
      opens: false,
      why: null,
      opening: true,
    });
    expect(madeAppStateOf(release, STUDIO_SOURCE, { kind: "starting" }, "studio")).toEqual({
      tone: "muted",
      word: "starting",
      opens: true,
      why: null,
    });
  });

  it("says an app its desktop cannot write out yet, from the row or from the door's refusal (C4, MA-4's witness)", () => {
    const unbuilt = {
      tone: "muted",
      word: "not written out yet",
      opens: false,
      why: { title: "studio can't write this app out yet", detail: null },
    };
    expect(
      madeAppStateOf({ ...release, openable: false }, STUDIO_SOURCE, undefined, "studio"),
    ).toEqual(unbuilt);
    expect(
      madeAppStateOf(
        release,
        STUDIO_SOURCE,
        { kind: "refused", state: "export-unbuilt" },
        "studio",
      ),
    ).toEqual(unbuilt);
  });

  it("says a desktop asleep, not answering, or on another build before anything of the app (DS-L8)", () => {
    expect(
      madeAppStateOf(release, { ...MINI_SOURCE, state: "asleep" }, undefined, "mini"),
    ).toEqual({
      tone: "muted",
      word: "asleep",
      opens: false,
      why: { title: "mini is asleep", detail: "This app runs on mini. It opens when mini wakes." },
    });
    expect(
      madeAppStateOf(release, { ...MINI_SOURCE, state: "stale" }, undefined, "mini"),
    ).toEqual({
      tone: "muted",
      word: "not answering",
      opens: false,
      why: { title: "Can't reach mini", detail: "It isn't answering." },
    });
    expect(
      madeAppStateOf(release, { ...MINI_SOURCE, state: "incompatible" }, undefined, "mini"),
    ).toEqual({
      tone: "muted",
      word: "another build",
      opens: false,
      why: {
        title: "mini runs another build of VibeField",
        detail: "Its apps open here once it's updated.",
      },
    });
  });

  it("lets this desktop's own apps open while its first walk lands — it is reading, not unreachable", () => {
    const unread = { ...STUDIO_SOURCE, state: "stale" as const };
    expect(madeAppStateOf(release, unread, undefined, "studio")).toEqual({
      tone: "muted",
      word: null,
      opens: true,
      why: null,
    });
  });

  it("judges an older version by its OWN availability; the serving row says only whether its desktop can write it out", () => {
    const tooLarge = { ...release, availability: "too_large" as const, openable: false };
    expect(madeAppStateOf(tooLarge, STUDIO_SOURCE, undefined, "studio").opens).toBe(false);
    expect(
      madeAppStateOf(tooLarge, STUDIO_SOURCE, undefined, "studio", { availability: "captured" }),
    ).toEqual({ tone: "muted", word: null, opens: true, why: null });
    expect(
      madeAppStateOf(release, STUDIO_SOURCE, undefined, "studio", { availability: "missing" }).why,
    ).toEqual({ title: "This page wasn't kept", detail: null });
    // a captured serving row that does not open: its desktop can't write any version out
    expect(
      madeAppStateOf({ ...release, openable: false }, STUDIO_SOURCE, undefined, "studio", {
        availability: "captured",
      }).why,
    ).toEqual({ title: "studio can't write this app out yet", detail: null });
  });

  it("says a page not kept, too large to keep, or one rosetta cannot keep (rosetta's availability)", () => {
    for (const availability of ["not_captured", "missing", "changed_during_read"] as const)
      expect(
        madeAppStateOf(
          { ...release, availability, openable: false },
          STUDIO_SOURCE,
          undefined,
          "studio",
        ),
        availability,
      ).toEqual({
        tone: "muted",
        word: "not kept",
        opens: false,
        why: { title: "This page wasn't kept", detail: null },
      });
    expect(
      madeAppStateOf(
        { ...release, availability: "too_large", openable: false },
        STUDIO_SOURCE,
        undefined,
        "studio",
      ),
    ).toEqual({
      tone: "muted",
      word: "too large",
      opens: false,
      why: { title: "Too large to keep", detail: null },
    });
    expect(
      madeAppStateOf(
        { ...release, availability: "unsupported", openable: false },
        STUDIO_SOURCE,
        undefined,
        "studio",
      ),
    ).toEqual({
      tone: "muted",
      word: "can't be kept",
      opens: false,
      why: { title: "This page can't be kept", detail: null },
    });
  });

  it("says a word rosetta added that this build has not heard (availability unknown): muted, and it asks nothing", () => {
    expect(
      madeAppStateOf({ ...release, availability: "unknown" }, STUDIO_SOURCE, undefined, "studio"),
    ).toEqual({
      tone: "muted",
      word: "unknown",
      opens: false,
      why: { title: "This app can't open here yet", detail: null },
    });
  });

  it("says each refusal of the open in its own words, a failed export in red", () => {
    expect(
      madeAppStateOf(release, STUDIO_SOURCE, { kind: "refused", state: "export-failed" }, "studio"),
    ).toEqual({
      tone: "error",
      word: "failed",
      opens: true,
      why: { title: "studio couldn't open Release notes", detail: "Try again." },
    });
    expect(
      madeAppStateOf(release, STUDIO_SOURCE, { kind: "refused", state: "not-linked" }, "studio"),
    ).toEqual({
      tone: "muted",
      word: "not linked",
      opens: true,
      why: { title: "Can't reach studio", detail: "It isn't connected to your tailnet yet." },
    });
    expect(
      madeAppStateOf(
        release,
        STUDIO_SOURCE,
        { kind: "refused", state: "library-reading" },
        "studio",
      ),
    ).toEqual({
      tone: "muted",
      word: "reading",
      opens: true,
      why: { title: "studio is still reading its history", detail: null },
    });
  });

  it("reads a refusal state only from UNAVAILABLE {service: \"apps\"} with a word this build knows", () => {
    expect(
      madeAppRefusalOf(rpcError("UNAVAILABLE", { service: "apps", state: "export-unbuilt" })),
    ).toBe("export-unbuilt");
    expect(
      madeAppRefusalOf(rpcError("UNAVAILABLE", { service: "apps", state: "too-large", device: MINI })),
    ).toBe("too-large");
    expect(madeAppRefusalOf(rpcError("UNAVAILABLE", { service: "index", state: "x" }))).toBeNull();
    expect(madeAppRefusalOf(rpcError("UNAVAILABLE", { service: "apps", state: "new-word" }))).toBeNull();
    expect(madeAppRefusalOf(rpcError("NOT_FOUND"))).toBeNull();
  });

  it("says an act that failed otherwise in plain words, never a code", () => {
    expect(madeAppErrorWords(rpcError("NOT_FOUND"), "open", "Release notes", "studio")).toBe(
      "Release notes is no longer in Apps.",
    );
    expect(
      madeAppErrorWords(
        rpcError("RESOURCE_EXHAUSTED", { resource: "apps" }),
        "open",
        "Release notes",
        "studio",
      ),
    ).toBe("studio has too many apps open right now.");
    expect(madeAppErrorWords(rpcError("FORBIDDEN_SCOPE"), "open", "Release notes", "studio")).toBe(
      "This window can't open apps yet.",
    );
    // until slice 3h the home has no intent to write a mark to, and says so (3e's own word)
    expect(
      madeAppErrorWords(
        rpcError("UNAVAILABLE", { service: "apps", state: "intent-unbuilt" }),
        "keep",
        "Release notes",
        "studio",
      ),
    ).toBe("Keeping and hiding apps isn't ready yet.");
    expect(madeAppErrorWords(rpcError("TIMEOUT"), "versions", "Release notes", "studio")).toBe(
      "The versions of Release notes can't be read right now.",
    );
    expect(madeAppErrorWords(rpcError("INTERNAL"), "open", "Release notes", "studio")).toBe(
      "Couldn't open Release notes. Try again.",
    );
  });

  it("says a mark that failed other than by 3h's wait in plain words, by its act", () => {
    expect(madeAppErrorWords(rpcError("FORBIDDEN_SCOPE"), "hide", "Release notes", "studio")).toBe(
      "This window can't keep or hide apps yet.",
    );
    expect(madeAppErrorWords(rpcError("UNAUTHORIZED"), "keep", "Release notes", "studio")).toBe(
      "This window can't keep or hide apps yet.",
    );
    // another service's UNAVAILABLE is no wait for 3h
    const elsewhere = rpcError("UNAVAILABLE", { service: "rosetta", state: "starting" });
    expect(madeAppErrorWords(elsewhere, "keep", "Release notes", "studio")).toBe(
      "Couldn't keep Release notes. Try again.",
    );
    expect(madeAppErrorWords(rpcError("INTERNAL"), "unkeep", "Release notes", "studio")).toBe(
      "Couldn't stop keeping Release notes. Try again.",
    );
    expect(madeAppErrorWords(rpcError("TIMEOUT"), "hide", "Release notes", "studio")).toBe(
      "Couldn't hide Release notes. Try again.",
    );
    expect(madeAppErrorWords(rpcError("NOT_FOUND"), "keep", "Release notes", "studio")).toBe(
      "Release notes is no longer in Apps.",
    );
  });
});

// ── the feed and the acts over the door ─────────────────────────────────────────────────────────

describe("the doors the group asks (fakes: fieldd's handlers are MA-3e's)", () => {
  it("pages index.apps.list {scope: mesh} by its cursor, keeps the last page's sources and says clipped", async () => {
    const pages: IndexAppsResult[] = [
      { rows: [app(1)], cursor: "c1", sources: [STUDIO_SOURCE] },
      { rows: [app(2)], sources: [STUDIO_SOURCE, MINI_SOURCE], clipped: true },
    ];
    const door = fakeClient({ "index.apps.list": () => pages.shift() });
    const read = await pageMadeApps(door.client, "");
    expect(door.callsOf("index.apps.list").map((call) => call.params)).toEqual([
      { scope: "mesh", limit: MADE_APPS_PAGE_LIMIT },
      { scope: "mesh", limit: MADE_APPS_PAGE_LIMIT, cursor: "c1" },
    ]);
    expect(read.apps.map((one) => one.appId)).toEqual([hex64(1), hex64(2)]);
    expect(read.sources.map((source) => source.device)).toEqual([STUDIO, MINI]);
    expect(read.clipped).toBe(true);
  });

  it("asks with the search's q, and stops at its page bound on a cursor that never ends, saying so", async () => {
    const door = fakeClient({
      "index.apps.list": () => ({ rows: [], cursor: "again", sources: [STUDIO_SOURCE] }),
    });
    const read = await pageMadeApps(door.client, "chart");
    const asks = door.callsOf("index.apps.list");
    expect(asks).toHaveLength(MADE_APPS_MAX_PAGES);
    expect(asks[0]?.params).toEqual({ scope: "mesh", limit: MADE_APPS_PAGE_LIMIT, q: "chart" });
    expect(read.clipped, "a walk stopped with pages left is clipped").toBe(true);
  });

  it("bounds the walk by one desktop's rows FOR EACH desktop in the reading, since the mesh holds them all", async () => {
    const door = fakeClient({
      "index.apps.list": () => ({
        rows: [],
        cursor: "again",
        sources: [STUDIO_SOURCE, MINI_SOURCE],
      }),
    });
    const read = await pageMadeApps(door.client, "");
    expect(door.callsOf("index.apps.list")).toHaveLength(MADE_APPS_MAX_PAGES * 2);
    expect(read.clipped).toBe(true);
    const whole = fakeClient({
      "index.apps.list": () => ({ rows: [app(1)], sources: [STUDIO_SOURCE] }),
    });
    const ended = await pageMadeApps(whole.client, "");
    expect(ended.clipped, "a walk that ended is whole").toBe(false);
  });

  it("names the projects from project.list, and none when it is refused", async () => {
    const door = fakeClient();
    expect([...(await madeAppProjectNames(door.client))]).toEqual([[VIBE_FIELD.key, "vibe-field"]]);
    expect(door.callsOf("project.list").map((call) => call.params)).toEqual([
      { limit: PROJECT_DOORS.PAGE_MAX_LIMIT },
    ]);
    const refused = fakeClient({
      "project.list": () => {
        throw rpcError("FORBIDDEN_SCOPE");
      },
    });
    expect([...(await madeAppProjectNames(refused.client))]).toEqual([]);
  });

  it("opens through artifact.open {appId, device, reveal: true} — the home opens the URL, never shell.openExternal (RULINGS L4)", async () => {
    const door = fakeClient();
    const answer = await openMadeApp(door.client, app(1, { device: MINI }));
    expect(door.calls).toEqual([
      { method: "artifact.open", params: { appId: hex64(1), device: MINI, reveal: true } },
    ]);
    expect(answer).toEqual({ state: "serving", url: "https://studio.tail1234.ts.net:13001/" });
    await openMadeApp(door.client, app(1), hex64(77));
    expect(door.calls[1]).toEqual({
      method: "artifact.open",
      params: { appId: hex64(1), device: STUDIO, presentationId: hex64(77), reveal: true },
    });
    expect(door.callsOf("shell.openExternal")).toEqual([]);
  });

  it("marks ONCE at the home by the fold key, never once per holder (RULINGS L8, C5)", async () => {
    const door = fakeClient();
    const held = app(1, { devices: [STUDIO, MINI], foldKey: `hosted:${HOSTED}` });
    const answer = await markMadeApp(door.client, held, { kept: true });
    expect(door.calls).toEqual([
      { method: "artifact.mark", params: { foldKey: `hosted:${HOSTED}`, kept: true } },
    ]);
    expect(answer).toEqual({ foldKey: `hosted:${HOSTED}`, kept: true, hidden: false });
  });

  it("reads Versions from index.artifacts {device, appId}, every page, newest first, with whether the library is read", async () => {
    const pages = [
      { entries: [entry(11, hoursAgo(30))], nextCursor: "v1", canonicalReady: true },
      { entries: [entry(12, hoursAgo(2))], canonicalReady: true },
    ];
    const door = fakeClient({ "index.artifacts": () => pages.shift() });
    const versions = await madeAppVersions(door.client, app(1, { device: MINI }));
    expect(door.callsOf("index.artifacts").map((call) => call.params)).toEqual([
      { device: MINI, appId: hex64(1), limit: MADE_APPS_VERSIONS_LIMIT },
      { device: MINI, appId: hex64(1), limit: MADE_APPS_VERSIONS_LIMIT, cursor: "v1" },
    ]);
    expect(versions.entries.map((one) => one.presentationId)).toEqual([hex64(12), hex64(11)]);
    expect(versions.canonicalReady).toBe(true);
    const reading = fakeClient({
      "index.artifacts": () => ({ entries: [], canonicalReady: false }),
    });
    expect((await madeAppVersions(reading.client, app(1))).canonicalReady).toBe(false);
  });
});

// ── the group over a client ─────────────────────────────────────────────────────────────────────

describe("<MadeApps> — the group over its client", () => {
  it("follows the pings and pages the fold, and draws its head, its days and its tiles newest first", async () => {
    const door = fakeClient({
      "index.apps.list": () => ({
        rows: [
          app(2, { title: "Release notes" }),
          app(5, { title: "Bundle size" }),
          app(26, { title: "Launch checklist" }),
        ],
        sources: [STUDIO_SOURCE],
      }),
    });
    await mount(door.client);
    expect(door.callsOf("index.apps.subscribe").map((call) => call.params)).toEqual([
      { scope: "mesh" },
    ]);
    expect(door.callsOf("index.apps.list")[0]?.params).toEqual({
      scope: "mesh",
      limit: MADE_APPS_PAGE_LIMIT,
    });
    expect(container?.querySelector(".vf-apps-head h2")?.textContent).toBe(FROM_YOUR_AGENTS);
    const search = container?.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search?.placeholder).toBe(SEARCH_APPS);
    expect(search?.getAttribute("aria-label")).toBe(SEARCH_APPS);
    expect(dayHeadings()).toEqual(["Today", "Yesterday"]);
    expect(tileTitles()).toEqual(["Release notes", "Bundle size", "Launch checklist"]);
    expect(tileOf("Release notes")?.querySelector("small")?.textContent).toBe(
      `${AGENT?.label} · vibe-field`,
    );
    expect(statusOf("Release notes")).toBe("studio");
  });

  it("re-pages on every ping, so an app another desktop made arrives without a reload (L3)", async () => {
    let rows = [app(2, { title: "Release notes" })];
    const door = fakeClient({ "index.apps.list": () => ({ rows, sources: [STUDIO_SOURCE] }) });
    await mount(door.client);
    expect(tileTitles()).toEqual(["Release notes"]);
    rows = [app(1, { title: "New dashboard" }), ...rows];
    await door.ping();
    expect(door.callsOf("index.apps.list").length).toBeGreaterThanOrEqual(2);
    expect(tileTitles()).toEqual(["New dashboard", "Release notes"]);
  });

  it("searches its own apps by the door's q once the field settles, and clearing it reads them all again", async () => {
    vi.useFakeTimers();
    const door = fakeClient({
      "index.apps.list": (params) => ({
        rows:
          params["q"] === "chart"
            ? [app(3, { title: "Burn-down chart" })]
            : [app(2, { title: "Release notes" }), app(3, { title: "Burn-down chart" })],
        sources: [STUDIO_SOURCE],
      }),
    });
    await mount(door.client);
    await act(async () => setSearch("chart"));
    await act(async () => vi.advanceTimersByTime(MADE_APPS_SEARCH_DEBOUNCE_MS));
    await settle();
    expect(door.callsOf("index.apps.list").at(-1)?.params).toEqual({
      scope: "mesh",
      limit: MADE_APPS_PAGE_LIMIT,
      q: "chart",
    });
    expect(tileTitles()).toEqual(["Burn-down chart"]);
    await act(async () => setSearch(""));
    await act(async () => vi.advanceTimersByTime(MADE_APPS_SEARCH_DEBOUNCE_MS));
    await settle();
    expect(door.callsOf("index.apps.list").at(-1)?.params).toEqual({
      scope: "mesh",
      limit: MADE_APPS_PAGE_LIMIT,
    });
    expect(tileTitles()).toEqual(["Release notes", "Burn-down chart"]);
  });

  it("opens a tile ONCE through artifact.open with reveal, never shell.openExternal, and wears green once it serves", async () => {
    const door = fakeClient({
      "index.apps.list": () => ({ rows: [app(2, { title: "Release notes" })], sources: [STUDIO_SOURCE] }),
    });
    await mount(door.client);
    expect(openOf("Release notes"), "the tile's face").toBeDefined();
    await act(async () => {
      openOf("Release notes")?.click();
      openOf("Release notes")?.click();
    });
    await settle();
    expect(door.callsOf("artifact.open").map((call) => call.params)).toEqual([
      { appId: hex64(2), device: STUDIO, reveal: true },
    ]);
    expect(door.callsOf("shell.openExternal")).toEqual([]);
    expect(toneOf("Release notes")).toBe("healthy");
    expect(statusOf("Release notes")).toBe("studio");
  });

  it("asks a starting app again, still revealing, until it serves", async () => {
    vi.useFakeTimers();
    const answers = [{ state: "starting" }, { state: "serving", url: "https://studio.tail1234.ts.net:13001/" }];
    const door = fakeClient({
      "index.apps.list": () => ({ rows: [app(2, { title: "Release notes" })], sources: [STUDIO_SOURCE] }),
      "artifact.open": () => answers.shift(),
    });
    await mount(door.client);
    await press(openOf("Release notes"));
    expect(statusOf("Release notes")).toBe("studio · starting");
    await act(async () => vi.advanceTimersByTime(MADE_APP_OPEN_RETRY_DELAYS_MS[0]));
    await settle();
    expect(door.callsOf("artifact.open").map((call) => call.params)).toEqual([
      { appId: hex64(2), device: STUDIO, reveal: true },
      { appId: hex64(2), device: STUDIO, reveal: true },
    ]);
    expect(toneOf("Release notes")).toBe("healthy");
  });

  it("says an app its desktop cannot write out yet, and offers Open in ‹host› when it is hosted (C4, MA-4's witness)", async () => {
    const door = fakeClient({
      "index.apps.list": () => ({
        rows: [
          app(2, { title: "Release notes", openable: false, hostedUrl: HOSTED }),
          app(3, { title: "Bundle size", openable: false }),
        ],
        sources: [STUDIO_SOURCE],
      }),
    });
    await mount(door.client);
    expect(statusOf("Release notes")).toBe("studio · not written out yet");
    expect(toneOf("Release notes")).toBe("muted");
    await press(openOf("Release notes"));
    expect(door.callsOf("artifact.open")).toEqual([]);
    expect(notice()?.querySelector("strong")?.textContent).toBe(
      "studio can't write this app out yet",
    );
    const hosted = actIn(notice(), "Open in claude.ai") as HTMLAnchorElement | undefined;
    expect(hosted, "the notice's Open in ‹host›").toBeDefined();
    expect(hosted?.getAttribute("href")).toBe(HOSTED);
    expect(hosted?.getAttribute("target")).toBe("_blank");
    expect(hosted?.getAttribute("rel")).toContain("noreferrer");
    await press(openOf("Bundle size"));
    expect(notice()?.querySelector("strong")?.textContent).toBe(
      "studio can't write this app out yet",
    );
    expect(notice()?.querySelector("a")).toBeNull();
  });

  it("says the door's export-unbuilt refusal the same way, with the hosted link", async () => {
    const door = fakeClient({
      "index.apps.list": () => ({
        rows: [app(2, { title: "Release notes", hostedUrl: HOSTED })],
        sources: [STUDIO_SOURCE],
      }),
      "artifact.open": () => {
        throw rpcError("UNAVAILABLE", { service: "apps", state: "export-unbuilt" });
      },
    });
    await mount(door.client);
    await press(openOf("Release notes"));
    expect(door.callsOf("artifact.open")).toHaveLength(1);
    expect(statusOf("Release notes")).toBe("studio · not written out yet");
    expect(notice()?.querySelector("strong")?.textContent).toBe(
      "studio can't write this app out yet",
    );
    expect(actIn(notice(), "Open in claude.ai")?.getAttribute("href")).toBe(HOSTED);
  });

  it("says a desktop asleep or on another build, greys its tiles and asks nothing of it", async () => {
    const door = fakeClient({
      "index.apps.list": () => ({
        rows: [
          app(2, { title: "Launch checklist", device: MINI, hostedUrl: HOSTED }),
          app(3, { title: "Old dashboard", device: "01J9ZQ1A2B3C4D5E6F7G8H9J0K" }),
        ],
        sources: [
          STUDIO_SOURCE,
          { ...MINI_SOURCE, state: "asleep" },
          {
            device: "01J9ZQ1A2B3C4D5E6F7G8H9J0K",
            name: "attic",
            self: false,
            state: "incompatible",
            rows: 1,
          },
        ],
      }),
    });
    await mount(door.client);
    expect(statusOf("Launch checklist")).toBe("mini · asleep");
    expect(tileOf("Launch checklist")?.getAttribute("data-muted")).toBe("true");
    expect(statusOf("Old dashboard")).toBe("attic · another build");
    await press(openOf("Launch checklist"));
    expect(door.callsOf("artifact.open")).toEqual([]);
    expect(notice()?.querySelector("strong")?.textContent).toBe("mini is asleep");
    expect(notice()?.textContent).toContain("This app runs on mini. It opens when mini wakes.");
    expect(actIn(notice(), "Open in claude.ai")?.getAttribute("href")).toBe(HOSTED);
  });

  it("keeps ONCE at the home by the fold key, whoever holds it, and the menu then says Stop keeping", async () => {
    let kept = false;
    const held = app(2, { title: "Release notes", devices: [STUDIO, MINI] });
    const door = fakeClient({
      "index.apps.list": () => ({
        rows: [kept ? { ...held, kept: true as const } : held],
        sources: [STUDIO_SOURCE, MINI_SOURCE],
      }),
      "artifact.mark": (params) => {
        kept = params["kept"] === true;
        return { foldKey: held.foldKey, kept, hidden: false };
      },
    });
    await mount(door.client);
    const keep = actIn(tileOf("Release notes"), "Keep");
    expect(keep, "the menu's Keep").toBeDefined();
    await press(keep);
    expect(door.callsOf("artifact.mark").map((call) => call.params)).toEqual([
      { foldKey: held.foldKey, kept: true },
    ]);
    const stop = actIn(tileOf("Release notes"), "Stop keeping");
    expect(stop, "the menu's Stop keeping").toBeDefined();
    await press(stop);
    expect(door.callsOf("artifact.mark").map((call) => call.params)).toEqual([
      { foldKey: held.foldKey, kept: true },
      { foldKey: held.foldKey, kept: false },
    ]);
  });

  it("hides ONCE by the fold key, and the tile leaves the group", async () => {
    let hidden = false;
    const release = app(2, { title: "Release notes" });
    const door = fakeClient({
      "index.apps.list": () => ({
        rows: hidden ? [app(3, { title: "Bundle size" })] : [release, app(3, { title: "Bundle size" })],
        sources: [STUDIO_SOURCE],
      }),
      "artifact.mark": () => {
        hidden = true;
        return { foldKey: release.foldKey, kept: false, hidden: true };
      },
    });
    await mount(door.client);
    const hide = actIn(tileOf("Release notes"), "Hide from Apps");
    expect(hide, "the menu's Hide from Apps").toBeDefined();
    await press(hide);
    expect(door.callsOf("artifact.mark").map((call) => call.params)).toEqual([
      { foldKey: release.foldKey, hidden: true },
    ]);
    expect(tileTitles()).toEqual(["Bundle size"]);
  });

  it("says honestly that Keep and Hide wait, while the home has no intent to write (until 3h)", async () => {
    const door = fakeClient({
      "index.apps.list": () => ({ rows: [app(2, { title: "Release notes" })], sources: [STUDIO_SOURCE] }),
      "artifact.mark": () => {
        throw rpcError("UNAVAILABLE", { service: "apps", state: "intent-unbuilt" });
      },
    });
    await mount(door.client);
    await press(actIn(tileOf("Release notes"), "Keep"));
    expect(door.callsOf("artifact.mark")).toHaveLength(1);
    const alert = container?.querySelector('.vf-apps-error[role="alert"]');
    expect(alert?.textContent).toBe("Keeping and hiding apps isn't ready yet.");
    expect(tileTitles()).toEqual(["Release notes"]);
    expect(actIn(tileOf("Release notes"), "Keep"), "Keep still offered").toBeDefined();
  });

  it("shows Versions in place, newest first, and opens the one chosen by its presentation", async () => {
    const door = fakeClient({
      "index.apps.list": () => ({
        rows: [app(2, { title: "Release notes", versions: 2 })],
        sources: [STUDIO_SOURCE],
      }),
      "index.artifacts": () => ({
        entries: [entry(11, hoursAgo(30)), entry(12, hoursAgo(2))],
        canonicalReady: true,
      }),
    });
    await mount(door.client);
    await press(actIn(tileOf("Release notes"), "Versions"));
    expect(door.callsOf("index.artifacts").map((call) => call.params)).toEqual([
      { device: STUDIO, appId: hex64(2), limit: MADE_APPS_VERSIONS_LIMIT },
    ]);
    const step = container?.querySelector(".vf-apps-versions");
    expect(step, "the Versions step").not.toBeNull();
    expect(step?.getAttribute("aria-label")).toBe("Versions of Release notes");
    const rows = [...(step?.querySelectorAll<HTMLButtonElement>(".vf-apps-version") ?? [])];
    expect(rows.map((row) => row.querySelector("strong")?.textContent)).toEqual([
      dayWords(hoursAgo(2), NOW, "en-US"),
      dayWords(hoursAgo(30), NOW, "en-US"),
    ]);
    await press(rows[1]);
    expect(door.callsOf("artifact.open").map((call) => call.params)).toEqual([
      { appId: hex64(2), device: STUDIO, presentationId: hex64(11), reveal: true },
    ]);
    await press(actIn(step ?? undefined, "Back"));
    expect(container?.querySelector(".vf-apps-versions")).toBeNull();
    expect(tileTitles()).toEqual(["Release notes"]);
  });

  it("shows the preview at its derived address, tries it twice more, then stands the fallback", async () => {
    vi.useFakeTimers();
    const shown = app(2, { title: "Release notes", preview: preview(2) });
    const door = fakeClient({
      "index.apps.list": () => ({ rows: [shown], sources: [STUDIO_SOURCE] }),
    });
    await mount(door.client);
    const address = madeAppPreviewUrl(STUDIO_SOURCE.previewsBase ?? "", preview(2));
    const image = (): HTMLImageElement | null =>
      tileOf("Release notes")?.querySelector<HTMLImageElement>(".vf-apps-well img") ?? null;
    const attempt = (): string | null => {
      const src = image()?.getAttribute("src");
      return src === null || src === undefined ? null : new URL(src).searchParams.get("vf-preview-attempt");
    };
    expect(image()?.getAttribute("src")).toBe(address);
    expect(image()?.referrerPolicy).toBe("no-referrer");
    act(() => image()?.dispatchEvent(new Event("error")));
    await act(async () => vi.advanceTimersByTime(MADE_APP_PREVIEW_RETRY_DELAYS_MS[0]));
    expect(attempt()).toBe("1");
    act(() => image()?.dispatchEvent(new Event("error")));
    await act(async () => vi.advanceTimersByTime(MADE_APP_PREVIEW_RETRY_DELAYS_MS[1]));
    expect(attempt()).toBe("2");
    act(() => image()?.dispatchEvent(new Event("error")));
    expect(image()).toBeNull();
    expect(tileOf("Release notes")?.querySelector(".vf-apps-well .vf-apps-icon")?.textContent).toBe(
      "R",
    );
  });

  it("stands the fallback squircle before a preview: the project's ink and the initial, the theme's fill with no project (§2.9)", async () => {
    const { projectKey: _key, ink: _ink, ...orphan } = app(3, { title: "Onboarding copy" });
    const door = fakeClient({
      "index.apps.list": () => ({
        rows: [app(2, { title: "Release notes" }), orphan],
        sources: [STUDIO_SOURCE],
      }),
    });
    await mount(door.client);
    const inked = tileOf("Release notes")?.querySelector<HTMLElement>(".vf-apps-well .vf-apps-icon");
    expect(inked?.textContent).toBe("R");
    expect(inked?.getAttribute("data-ink")).toBe("true");
    expect(inked?.style.getPropertyValue("--vf-apps-ink")).toBe(projectInk(VIBE_FIELD.ink));
    expect(inked?.getAttribute("aria-hidden")).toBe("true");
    const plain = tileOf("Onboarding copy")?.querySelector<HTMLElement>(".vf-apps-well .vf-apps-icon");
    expect(plain?.textContent).toBe("O");
    expect(plain?.hasAttribute("data-ink")).toBe(false);
  });

  it("says this desktop is still reading before its first walk — as 3e answers a mesh ask — never an empty group, and fills when a ping comes", async () => {
    // 3e's fold for `scope: "mesh"` never refuses: its own source is `stale` with no rows until the
    // first walk completes, and `libraryReady` is absent until a page is heard
    const { name: _name, libraryReady: _unheard, ...bare } = STUDIO_SOURCE;
    let ready = false;
    const door = fakeClient({
      "index.apps.list": () =>
        ready
          ? { rows: [app(2, { title: "Release notes" })], sources: [STUDIO_SOURCE] }
          : { rows: [], sources: [{ ...bare, state: "stale", rows: 0 }] },
    });
    await mount(door.client);
    expect(text()).toContain("This Mac is still reading its history");
    expect(text()).not.toContain("No apps from your agents yet");
    ready = true;
    await door.ping();
    expect(tileTitles()).toEqual(["Release notes"]);
    expect(text()).not.toContain("is still reading its history");
  });

  it("says the door's library-reading refusal of a list the same way (its word for a local ask)", async () => {
    const door = fakeClient({
      "index.apps.list": () => {
        throw rpcError("UNAVAILABLE", { service: "apps", state: "library-reading" });
      },
    });
    await mount(door.client);
    expect(text()).toContain("This Mac is still reading its history");
    expect(text()).not.toContain("No apps from your agents yet");
    expect(text()).not.toContain("can't be read right now");
  });

  it("says each desktop whose library is still reading, over the tiles it has or in place of an empty group", async () => {
    let rows: IndexApp[] = [];
    const door = fakeClient({
      "index.apps.list": () => ({ rows, sources: [{ ...STUDIO_SOURCE, libraryReady: false }] }),
    });
    await mount(door.client);
    expect(text()).toContain("studio is still reading its history");
    expect(text()).not.toContain("No apps from your agents yet");
    rows = [app(2, { title: "Release notes" })];
    await door.ping();
    expect(tileTitles()).toEqual(["Release notes"]);
    expect(text()).toContain("studio is still reading its history");
  });

  it("says an empty group, and an unreadable one with Try again", async () => {
    const empty = fakeClient();
    await mount(empty.client);
    expect(container?.querySelector(".vf-apps-quiet strong")?.textContent).toBe(
      "No apps from your agents yet",
    );
    act(() => root?.unmount());
    root = null;
    container?.remove();
    let refuse = true;
    const broken = fakeClient({
      "index.apps.list": () => {
        if (refuse) throw rpcError("FORBIDDEN_SCOPE");
        return { rows: [app(2, { title: "Release notes" })], sources: [STUDIO_SOURCE] };
      },
    });
    await mount(broken.client);
    expect(container?.querySelector(".vf-apps-quiet strong")?.textContent).toBe(
      "Your agents' apps can't be read right now",
    );
    refuse = false;
    await press(actIn(container ?? undefined, "Try again"));
    expect(tileTitles()).toEqual(["Release notes"]);
  });

  it("refuses an answer it cannot read rather than drawing half of it (tolerant reader, whole-page parse)", async () => {
    const door = fakeClient({ "index.apps.list": () => ({ rows: [{ appKey: 7 }], sources: [] }) });
    await mount(door.client);
    expect(tileTitles()).toEqual([]);
    expect(container?.querySelector(".vf-apps-quiet strong")?.textContent).toBe(
      "Your agents' apps can't be read right now",
    );
  });

  // ── the review's rows (fix pass, 2026-11-05) ──

  const RELEASE_LIST = (): IndexAppsResult => ({
    rows: [app(2, { title: "Release notes" })],
    sources: [STUDIO_SOURCE],
  });
  const SERVING = { state: "serving", url: "https://studio.tail1234.ts.net:13001/" };
  const versionRows = (): HTMLButtonElement[] => [
    ...(container?.querySelectorAll<HTMLButtonElement>(".vf-apps-version") ?? []),
  ];

  it("asks a starting app at most three times — the press and its two re-asks — then leaves it starting", async () => {
    vi.useFakeTimers();
    const door = fakeClient({
      "index.apps.list": RELEASE_LIST,
      "artifact.open": () => ({ state: "starting" }),
    });
    await mount(door.client);
    await press(openOf("Release notes"));
    for (const delay of MADE_APP_OPEN_RETRY_DELAYS_MS) {
      await act(async () => vi.advanceTimersByTime(delay));
      await settle();
    }
    await act(async () => vi.advanceTimersByTime(10_000));
    await settle();
    expect(door.callsOf("artifact.open")).toHaveLength(1 + MADE_APP_OPEN_RETRY_DELAYS_MS.length);
    expect(statusOf("Release notes")).toBe("studio · starting");
    expect(openOf("Release notes")?.disabled, "a starting app may be pressed again").toBe(false);
  });

  it("says §9's Opening on ‹desktop›… LATE: the desktop's name for 120ms, then the line", async () => {
    vi.useFakeTimers();
    const door = fakeClient({
      "index.apps.list": RELEASE_LIST,
      "artifact.open": () => new Promise(() => undefined),
    });
    await mount(door.client);
    await press(openOf("Release notes"));
    expect(door.callsOf("artifact.open")).toHaveLength(1);
    expect(statusOf("Release notes")).toBe("studio");
    await act(async () => vi.advanceTimersByTime(MADE_APP_OPENING_LATE_MS - 1));
    expect(statusOf("Release notes")).toBe("studio");
    await act(async () => vi.advanceTimersByTime(1));
    expect(statusOf("Release notes")).toBe("Opening on studio…");
    expect(tileOf("Release notes")?.querySelector(".vf-apps-status__late")).not.toBeNull();
  });

  it("says an app no longer in Apps in an alert, and re-pages so its tile leaves", async () => {
    let gone = false;
    const door = fakeClient({
      "index.apps.list": () => (gone ? { rows: [], sources: [STUDIO_SOURCE] } : RELEASE_LIST()),
      "artifact.open": () => {
        gone = true;
        throw rpcError("NOT_FOUND");
      },
    });
    await mount(door.client);
    await press(openOf("Release notes"));
    expect(container?.querySelector('.vf-apps-error[role="alert"]')?.textContent).toBe(
      "Release notes is no longer in Apps.",
    );
    expect(door.callsOf("index.apps.list")).toHaveLength(2);
    expect(tileTitles()).toEqual([]);
  });

  it("says a search that finds nothing in its own words, and never sends a search longer than the door admits", async () => {
    vi.useFakeTimers();
    const door = fakeClient({
      "index.apps.list": (params) =>
        params["q"] === undefined ? RELEASE_LIST() : { rows: [], sources: [STUDIO_SOURCE] },
    });
    await mount(door.client);
    await act(async () => setSearch("zebra"));
    await act(async () => vi.advanceTimersByTime(MADE_APPS_SEARCH_DEBOUNCE_MS));
    await settle();
    expect(container?.querySelector(".vf-apps-quiet strong")?.textContent).toBe(
      "No apps match “zebra”",
    );
    expect(MADE_APPS_QUERY_MAX, "IndexAppsParams bounds q").toBe(512);
    const search = container?.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search?.getAttribute("maxlength")).toBe(String(MADE_APPS_QUERY_MAX));
    // a value set past the field's bound (a paste a script made) is still cut to the door's
    await act(async () => setSearch("a".repeat(600)));
    await act(async () => vi.advanceTimersByTime(MADE_APPS_SEARCH_DEBOUNCE_MS));
    await settle();
    const asked = door.callsOf("index.apps.list").at(-1)?.params["q"];
    expect(typeof asked === "string" ? asked.length : 0).toBe(MADE_APPS_QUERY_MAX);
    expect(text()).not.toContain("can't be read right now");
  });

  it("closes the notice with its Close", async () => {
    const door = fakeClient({
      "index.apps.list": () => ({
        rows: [app(3, { title: "Bundle size", openable: false })],
        sources: [STUDIO_SOURCE],
      }),
    });
    await mount(door.client);
    await press(openOf("Bundle size"));
    expect(notice(), "the notice").toBeDefined();
    await press(actIn(notice(), "Close"));
    expect(notice()).toBeUndefined();
  });

  it("says a refused Versions read in the step's alert, with no empty words over it", async () => {
    const door = fakeClient({
      "index.apps.list": RELEASE_LIST,
      "index.artifacts": () => {
        throw rpcError("TIMEOUT");
      },
    });
    await mount(door.client);
    await press(actIn(tileOf("Release notes"), "Versions"));
    const step = container?.querySelector(".vf-apps-versions");
    expect(step, "the Versions step").not.toBeNull();
    expect(step?.querySelector('.vf-apps-error[role="alert"]')?.textContent).toBe(
      "The versions of Release notes can't be read right now.",
    );
    expect(text()).not.toContain("No versions found");
  });

  it("says Versions' library still reading, and an empty Versions, in words — never a blank step (MA-L10)", async () => {
    let canonicalReady = false;
    const door = fakeClient({
      "index.apps.list": RELEASE_LIST,
      "index.artifacts": () => ({ entries: [], canonicalReady }),
    });
    await mount(door.client);
    await press(actIn(tileOf("Release notes"), "Versions"));
    expect(text()).toContain("studio is still reading its history");
    expect(text()).not.toContain("No versions found");
    await press(actIn(container ?? undefined, "Back"));
    canonicalReady = true;
    await press(actIn(tileOf("Release notes"), "Versions"));
    expect(container?.querySelector(".vf-apps-versions .vf-apps-quiet strong")?.textContent).toBe(
      "No versions found",
    );
  });

  it("holds a refused older version under its own presentation: Back, and the tile still asks artifact.open", async () => {
    const door = fakeClient({
      "index.apps.list": () => ({
        rows: [app(2, { title: "Release notes", versions: 2 })],
        sources: [STUDIO_SOURCE],
      }),
      "index.artifacts": () => ({
        entries: [entry(11, hoursAgo(30)), entry(12, hoursAgo(2))],
        canonicalReady: true,
      }),
      "artifact.open": (params) => {
        if (params["presentationId"] !== undefined)
          throw rpcError("UNAVAILABLE", { service: "apps", state: "not-kept" });
        return SERVING;
      },
    });
    await mount(door.client);
    await press(actIn(tileOf("Release notes"), "Versions"));
    await press(versionRows()[1]);
    expect(notice()?.querySelector("strong")?.textContent).toBe("This page wasn't kept");
    await press(versionRows()[1]);
    expect(door.callsOf("artifact.open"), "not asked again over the same row").toHaveLength(1);
    await press(actIn(container ?? undefined, "Back"));
    expect(notice()).toBeUndefined();
    expect(statusOf("Release notes")).toBe("studio");
    await press(openOf("Release notes"));
    expect(door.callsOf("artifact.open").map((call) => call.params)).toEqual([
      { appId: hex64(2), device: STUDIO, presentationId: hex64(11), reveal: true },
      { appId: hex64(2), device: STUDIO, reveal: true },
    ]);
    expect(toneOf("Release notes")).toBe("healthy");
  });

  it("opens a kept older version even when the newest page was not kept, and says the one that wasn't", async () => {
    const door = fakeClient({
      "index.apps.list": () => ({
        rows: [
          app(2, { title: "Release notes", availability: "too_large", openable: false }),
        ],
        sources: [STUDIO_SOURCE],
      }),
      "index.artifacts": () => ({
        entries: [entry(11, hoursAgo(30)), entry(12, hoursAgo(2), { availability: "too_large" })],
        canonicalReady: true,
      }),
    });
    await mount(door.client);
    expect(statusOf("Release notes")).toBe("studio · too large");
    await press(actIn(tileOf("Release notes"), "Versions"));
    await press(versionRows()[0]);
    expect(door.callsOf("artifact.open")).toEqual([]);
    expect(notice()?.querySelector("strong")?.textContent).toBe("Too large to keep");
    await press(versionRows()[1]);
    expect(door.callsOf("artifact.open").map((call) => call.params)).toEqual([
      { appId: hex64(2), device: STUDIO, presentationId: hex64(11), reveal: true },
    ]);
  });

  it("lets a refusal stand over its row, and lets the row's truth back in once a newer reading moves it", async () => {
    let presentation = 2;
    let refuse = true;
    const door = fakeClient({
      "index.apps.list": () => ({
        rows: [app(2, { title: "Release notes", presentationId: hex64(presentation) })],
        sources: [STUDIO_SOURCE],
      }),
      "artifact.open": () => {
        if (refuse) throw rpcError("UNAVAILABLE", { service: "apps", state: "not-kept" });
        return SERVING;
      },
    });
    await mount(door.client);
    await press(openOf("Release notes"));
    expect(statusOf("Release notes")).toBe("studio · not kept");
    await door.ping();
    expect(statusOf("Release notes"), "the same row: the refusal stands").toBe("studio · not kept");
    await press(openOf("Release notes"));
    expect(door.callsOf("artifact.open")).toHaveLength(1);
    refuse = false;
    presentation = 3;
    await door.ping();
    expect(statusOf("Release notes"), "a new presentation: the row's truth").toBe("studio");
    await press(openOf("Release notes"));
    expect(door.callsOf("artifact.open")).toHaveLength(2);
    expect(toneOf("Release notes")).toBe("healthy");
  });

  it("keeps a serving tile green over its row, and lets it go once its desktop goes away", async () => {
    let mini: IndexAppsSource = MINI_SOURCE;
    const door = fakeClient({
      "index.apps.list": () => ({
        rows: [app(2, { title: "Launch checklist", device: MINI })],
        sources: [STUDIO_SOURCE, mini],
      }),
    });
    await mount(door.client);
    await press(openOf("Launch checklist"));
    expect(toneOf("Launch checklist")).toBe("healthy");
    await door.ping();
    expect(toneOf("Launch checklist"), "the same row: still green").toBe("healthy");
    mini = { ...MINI_SOURCE, state: "asleep" };
    await door.ping();
    expect(statusOf("Launch checklist")).toBe("mini · asleep");
    mini = MINI_SOURCE;
    await door.ping();
    expect(statusOf("Launch checklist")).toBe("mini");
    expect(toneOf("Launch checklist"), "a serve from before it slept is not claimed").toBe("muted");
  });

  it("lets a serving tile's green go once a serve nobody opened could have closed (the idle close)", async () => {
    vi.useFakeTimers();
    const door = fakeClient({ "index.apps.list": RELEASE_LIST });
    await mount(door.client);
    expect(MADE_APP_SERVING_HELD_MS, "the origin's idle close").toBe(24 * 60 * 60_000);
    await press(openOf("Release notes"));
    expect(toneOf("Release notes")).toBe("healthy");
    await act(async () => vi.advanceTimersByTime(MADE_APP_SERVING_HELD_MS - 1));
    expect(toneOf("Release notes"), "inside the idle close: still green").toBe("healthy");
    await act(async () => vi.advanceTimersByTime(1));
    expect(toneOf("Release notes"), "past it the window cannot know it serves").toBe("muted");
    expect(statusOf("Release notes")).toBe("studio");
    await press(openOf("Release notes"));
    expect(door.callsOf("artifact.open"), "a rested tile asks again").toHaveLength(2);
    expect(toneOf("Release notes")).toBe("healthy");
  });

  it("reads the project names again with every re-page, so the fact line follows PJ's grouping", async () => {
    let name = "vibe-field";
    const door = fakeClient({
      "index.apps.list": RELEASE_LIST,
      "project.list": () => ({
        rows: [project({ ...VIBE_FIELD, name })],
        sources: [],
        groupingVersion: 1,
      }),
    });
    await mount(door.client);
    const facts = (): string | null | undefined =>
      tileOf("Release notes")?.querySelector("small")?.textContent;
    expect(facts()).toBe(`${AGENT?.label} · vibe-field`);
    name = "field";
    await door.ping();
    expect(door.callsOf("project.list")).toHaveLength(2);
    expect(facts()).toBe(`${AGENT?.label} · field`);
  });

  it("says a reading that holds fewer apps than the fold, never silently", async () => {
    const door = fakeClient({
      "index.apps.list": () => ({
        rows: [app(2), app(3)],
        sources: [STUDIO_SOURCE],
        clipped: true,
      }),
    });
    await mount(door.client);
    expect(text()).toContain("Showing the newest 2 apps");
  });

  it("draws one reading line for each of two desktops the roster names none, without a key clash", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { name: _name, ...unnamed } = MINI_SOURCE;
      const door = fakeClient({
        "index.apps.list": () => ({
          rows: [],
          sources: [
            STUDIO_SOURCE,
            { ...unnamed, libraryReady: false },
            { ...unnamed, device: "01J9ZQ1A2B3C4D5E6F7G8H9J0K", libraryReady: false },
          ],
        }),
      });
      await mount(door.client);
      expect(container?.querySelectorAll(".vf-apps-reading")).toHaveLength(2);
      expect(errors.mock.calls.flat().map(String).join(" ")).not.toContain("same key");
    } finally {
      errors.mockRestore();
    }
  });
});

// ── the tile form, in CSS ───────────────────────────────────────────────────────────────────────

/** UA-7's spelling of a colour literal (ui-system-boundaries.test.ts). */
const COLOUR_LITERAL = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch)\(/i;

/** One rule's body, by its exact selector. */
const rule = (selector: string): string => {
  const at = CSS.indexOf(`\n${selector} {`);
  return at < 0 ? "" : CSS.slice(at, CSS.indexOf("\n}", at));
};

describe("the made tile's form (made-apps.css; tokens only)", () => {
  it("lays each day out three across, 16 between rows and 14 between columns, as the Hub's tiles are", () => {
    const tilesRule = rule(".vf-apps-tiles");
    expect(tilesRule).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(tilesRule).toContain("gap: 16px 14px;");
  });

  it("draws the well 16:10, corners 10, the hairline ring — strong under the pointer", () => {
    const well = rule(".vf-apps-well");
    expect(well).toContain("aspect-ratio: 16 / 10;");
    expect(well).toContain("border-radius: 10px;");
    expect(well).toContain("box-shadow: 0 0 0 1px var(--vf-hairline);");
    expect(rule(".vf-apps-tile:hover .vf-apps-well")).toContain(
      "box-shadow: 0 0 0 1px var(--vf-hairline-strong);",
    );
    expect(rule('.vf-apps-tile[data-muted="true"] .vf-apps-well img')).toContain("opacity: 0.55;");
  });

  it("moves as the fields' tiles do — 1.03 under the pointer, 0.95 pressed, 200ms ease — and holds still under reduced motion (§7, M6)", () => {
    expect(rule(".vf-apps-tile")).toContain("transition: transform 200ms ease;");
    expect(rule(".vf-apps-tile:hover")).toContain("transform: scale(1.03);");
    expect(CSS).toMatch(/\.vf-apps-tile:has\(> \.vf-apps-tile__open:not\(:disabled\):active\) \{\s*transform: scale\(0\.95\);/u);
    const reduced = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(CSS).toContain("@media (prefers-reduced-motion: reduce)");
    expect(reduced).toMatch(/\.vf-apps-tile:hover,[^{]*\{\s*transform: none;/u);
  });

  it("draws the fallback squircle at 60 with a 26 initial at 650, by day on the ink, by night on the dark tile (§2.9's exception)", () => {
    const icon = rule(".vf-apps-icon");
    expect(icon).toContain("width: 60px;");
    expect(icon).toContain("height: 60px;");
    expect(icon).toContain("font: 650 26px/1 var(--vf-font-sans);");
    expect(icon).toContain("background: var(--vf-fill);");
    expect(icon).toContain("color: var(--vf-text-primary);");
    const day = rule('.vf-apps-icon[data-ink="true"]');
    expect(day).toContain("background: var(--vf-apps-ink);");
    expect(day).toContain("color: var(--vf-foreground-inverse);");
    const night = rule('.dark .vf-apps-icon[data-ink="true"]');
    expect(night).toContain("background: var(--vf-app-fallback-tile);");
    expect(night).toContain("color: var(--vf-apps-ink);");
  });

  it("dims a greyed tile's image alone, never the fallback squircle (§2.9's 3:1 floor for the mark)", () => {
    expect(CSS).not.toMatch(/\[data-muted="true"\][^{]*\.vf-apps-icon[^{]*\{/u);
  });

  it("fades Opening on ‹desktop›… in over 180ms plain ease once the tile has held it 120ms (§9, late)", () => {
    expect(MADE_APP_OPENING_LATE_MS).toBe(120);
    expect(rule(".vf-apps-status__late")).toContain("animation: vf-apps-late 180ms ease both;");
    expect(CSS).toMatch(/@keyframes vf-apps-late \{\s*from \{\s*opacity: 0;/u);
  });

  it("takes the night tile from tokens.css, at DESIGN.md §2.9's value (the doc first, then the token)", () => {
    const dark = TOKENS.slice(TOKENS.indexOf("\n.dark {"));
    expect(dark).toMatch(/\s--vf-app-fallback-tile:\s*#232326;/u);
  });

  it("names no colour and owns only its own selectors (.vf-apps-*, never the Hub's .vf-artifact-*)", () => {
    const offending = CSS.split("\n").filter(
      (line) => !line.trimStart().startsWith("/*") && !line.trimStart().startsWith("*") && COLOUR_LITERAL.test(line),
    );
    expect(offending).toEqual([]);
    expect(CSS).not.toContain(".vf-artifact");
    const selectors = [...CSS.matchAll(/^([^\s@/*}][^{]*)\{/gmu)].map((match) => match[1]?.trim() ?? "");
    expect(selectors.length, "the stylesheet has rules").toBeGreaterThan(0);
    for (const selector of selectors) expect(selector, selector).toMatch(/\.vf-apps/u);
  });
});

// ── the catalog's plate ─────────────────────────────────────────────────────────────────────────

describe("the catalog's made-apps plate (docs/UI_SYSTEM.md: the shipping view on a fixture adapter)", () => {
  async function plate(state: (typeof MADE_APPS_PREVIEW_STATES)[number]): Promise<void> {
    if (root !== null) act(() => root?.unmount());
    container?.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<MadeAppsPreview state={state} />);
    });
    await settle();
  }

  it("PIN: offers the five states the plan names, on the plates' fixed clock (15:00 on the viewer's own)", () => {
    expect(MADE_APPS_PREVIEW_STATES).toEqual(["populated", "fallback", "reading", "unbuilt", "empty"]);
    expect(MADE_APPS_FIXTURE_NOW).toBe(new Date(2026, 10, 5, 15, 0).getTime());
  });

  it("mounts the shipping group in every state over its fixture client", async () => {
    await plate("populated");
    expect(dayHeadings()).toEqual(["Today", "Yesterday"]);
    expect(tiles()).toHaveLength(4);
    const stills = [...(container?.querySelectorAll<HTMLImageElement>(".vf-apps-well img") ?? [])];
    expect(stills).toHaveLength(3);
    for (const still of stills) expect(still.getAttribute("src")).toMatch(/^data:image\/svg\+xml/u);
    expect(statusOf("Launch checklist")).toBe("mini · asleep");

    await plate("fallback");
    expect(container?.querySelectorAll(".vf-apps-well .vf-apps-icon")).toHaveLength(3);
    expect(container?.querySelectorAll('.vf-apps-icon[data-ink="true"]')).toHaveLength(2);

    await plate("reading");
    expect(text()).toContain("studio is still reading its history");

    await plate("unbuilt");
    expect(statusOf("Release notes, 0.9")).toBe("studio · not written out yet");
    expect(statusOf("Bundle size")).toBe("studio · not written out yet");
    expect(actIn(tileOf("Release notes, 0.9"), "Open in claude.ai"), "the menu's hosted link").toBeDefined();

    await plate("empty");
    expect(container?.querySelector(".vf-apps-quiet strong")?.textContent).toBe(
      "No apps from your agents yet",
    );
  });

  it("PIN: its client answers a fieldd act with nothing, so an open on a plate never settles", async () => {
    const client = madeAppsPreviewClient("populated");
    const answer = await Promise.race([
      client.request("artifact.open", { appId: hex64(1) }).then(() => "answered"),
      new Promise((done) => setTimeout(() => done("pending"), 20)),
    ]);
    expect(answer).toBe("pending");
  });
});
