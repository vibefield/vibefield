import { ZOOM_MAX, ZOOM_MIN } from "@vibecook/ice/desk";
import type { DocRegistryEntry } from "@vibefield/contracts";
import { ArtifactPanelPreview } from "@vibefield/plugin-browser/design-system";
import { type ReactElement, useState } from "react";
import type { DocManagerApi, DocManagerState } from "../doc-manager";
import type { FrameSurface, SheetShelf } from "../frame/frame-surface";
import { Head } from "../frame/Head";
import { type HeadArtifacts, type HeadDocTile, HeadView } from "../frame/HeadView";
import { artifactsDotWords } from "../frame/head-artifacts";
import type { HeadCanvas, HeadCrumb } from "../frame/head-canvas";
import type { SyncQuestionViewProps } from "../frame/SyncQuestionView";
import type { ViewKeys } from "../frame/views";
import { zoomPercent } from "../frame/zoom";
import { CommandPalettePreview } from "./CommandPalettePreview";

// The head's fixture ADAPTER (One Frame FR-3; docs/UI_SYSTEM.md): the shipping
// head — `HeadView` on fixture state, one plate per state the page's §05 and
// §06 plates draw, and the live head on its REAL controller (`Head`) over
// fixture doors. What it replaces is only what a host supplies: the document
// manager (the fields), the head's canvas door (the path, the zoom) and the
// frame's one owner of the open surface (a local value). The markup and the
// CSS are the product's. HN-8: the Artifacts shelf's plates hold the Hub's
// own fixture adapter (`ArtifactPanelPreview`, the plugin's design-system
// door), where the product hosts its contributed surface; the live head has
// no plugin host, so its shelf says it waits, as a window's does at boot.

const NOW = Date.now();
const MINUTE = 60_000;

/** The page's own five fields (the kit's explorer), the first current. */
export const FIXTURE_FIELDS: readonly DocRegistryEntry[] = [
  ["Studio desk", 0],
  ["Launch notes", 2 * 60 * MINUTE],
  ["Moodboard", 26 * 60 * MINUTE],
  ["Sprint review", 3 * 24 * 60 * MINUTE],
  ["Sketches", 5 * 24 * 60 * MINUTE],
].map(([name, ago], index) => ({
  docId: `0000000${index}-3c44-4b8a-9e51-6d2f8c0a7b19`,
  name: name as string,
  updatedAt: NOW - (ago as number),
  baseEpoch: 0,
  engineSchema: 2,
  sizeBytes: 18_240,
}));

const CURRENT = FIXTURE_FIELDS[0];

/** A document manager over the fixture fields: renaming and switching land. */
export function fixtureHeadManager(): DocManagerApi {
  let state: DocManagerState = {
    phase: "ready",
    loading: null,
    doc: CURRENT === undefined ? null : { docId: CURRENT.docId, name: CURRENT.name },
    docs: [...FIXTURE_FIELDS],
    thumbnailUrls: {},
    pending: null,
  };
  const listeners = new Set<() => void>();
  const say = (): void => {
    for (const fn of [...listeners]) fn();
  };
  return {
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getState: () => state,
    refreshDocs: async () => state.docs,
    rename: async (name) => {
      const id = state.doc?.docId;
      state = {
        ...state,
        doc: state.doc === null ? null : { ...state.doc, name },
        docs: state.docs.map((d) => (d.docId === id ? { ...d, name } : d)),
      };
      say();
    },
    createDoc: async () => undefined,
    switchTo: async (docId) => {
      const next = state.docs.find((d) => d.docId === docId);
      if (next === undefined) return;
      state = { ...state, doc: { docId: next.docId, name: next.name } };
      say();
    },
    setSyncIntent: async (docId, intent) => {
      state = {
        ...state,
        docs: state.docs.map((d) => (d.docId === docId ? { ...d, syncIntent: intent } : d)),
      };
      say();
    },
  };
}

/** The head's canvas door over fixture facts: a path and a camera. To fit
 * frames the fixture's whole field at 86%; going up pops the path. */
export function fixtureHeadCanvas(
  initial: { path?: readonly HeadCrumb[]; zoom?: number } = {},
): HeadCanvas {
  let path: readonly HeadCrumb[] = initial.path ?? [];
  let zoom = initial.zoom ?? 1;
  const pathListeners = new Set<() => void>();
  const zoomListeners = new Set<() => void>();
  const listen = (set: Set<() => void>, fn: () => void): (() => void) => {
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  };
  const say = (set: Set<() => void>): void => {
    for (const fn of [...set]) fn();
  };
  // the desk's own band (ICE's scale-free ZOOM_MIN…ZOOM_MAX), as the engine's door reads it
  const bounds = { min: ZOOM_MIN, max: ZOOM_MAX };
  const moveTo = (next: number): void => {
    zoom = Math.min(bounds.max, Math.max(bounds.min, next));
    say(zoomListeners);
  };
  return {
    path: () => path,
    subscribePath: (fn) => listen(pathListeners, fn),
    percent: () => zoomPercent(zoom),
    subscribePercent: (fn) => listen(zoomListeners, fn),
    zoom: () => zoom,
    bounds: () => bounds,
    zoomTo: moveTo,
    zoomToFit: () => moveTo(0.86),
    exitTo: (depth) => {
      path = path.filter((crumb) => crumb.depth <= depth);
      say(pathListeners);
    },
  };
}

/** The tiles the explorer plate shows: the fields as the controller words
 * them (their times; no sync word to say). */
const FIXTURE_TILES: readonly HeadDocTile[] = FIXTURE_FIELDS.map((entry, index) => ({
  entry,
  caption: ["just now", "2h ago", "1d ago", "3d ago", "5d ago"][index] ?? "",
}));

const IN_A_FOLDER: readonly HeadCrumb[] = [{ depth: 1, label: "Sketches" }];
const DEEP: readonly HeadCrumb[] = [
  { depth: 1, label: "Launch notes" },
  { depth: 2, label: "Moodboard" },
  { depth: 3, label: "Sketches" },
];

/** The states the page's head plates show (§05 "The head", §06 the palette
 * and the fields), plus the two the brief adds: FitPath in a narrow window,
 * and renaming in place. HN-8 adds the package with its standing dot and the
 * sheet on its Artifacts shelf — the Hub's, the plugin off, the Hub opening —
 * and the same sheet under a cover, grown from the package circle. */
export const HEAD_STATES = [
  "top",
  "package-dot",
  "folder",
  "narrow",
  "renaming",
  "explorer",
  "artifacts",
  "artifacts-off",
  "artifacts-opening",
  "covered",
  "zoom",
  "palette",
  "sync-question",
] as const;
export type HeadState = (typeof HEAD_STATES)[number];

export const HEAD_STATE_LABEL: Record<HeadState, string> = {
  top: "At the field's top",
  "package-dot": "A source unavailable",
  folder: "Inside a folder",
  narrow: "Narrow · FitPath",
  renaming: "Renaming",
  explorer: "The fields",
  artifacts: "The artifacts",
  "artifacts-off": "Artifacts off",
  "artifacts-opening": "Opening Artifacts",
  covered: "Under a cover",
  zoom: "The zoom's menu",
  palette: "The palette, ⌘K",
  "sync-question": "The sync question",
};

/** The package's dot as the product words it (PL-D1): one source unavailable, by its title. */
const FIXTURE_DOT = artifactsDotWords(["vibe-field"]);

/** What a plate's Artifacts shelf holds: the Hub's own fixture adapter, populated, or why it is
 * not there; null for the plates that do not open it. */
function plateArtifacts(state: HeadState): HeadArtifacts | null {
  if (state === "artifacts" || state === "covered") {
    return { state: "hub", hub: <ArtifactPanelPreview state="populated" /> };
  }
  if (state === "artifacts-off") return { state: "off" };
  if (state === "artifacts-opening") return { state: "opening" };
  return null;
}

/** TS-6 (TS-D13) — the question New field asks while a link owes it: the
 * posture as it stands, three fields from before the link, one added. */
const FIXTURE_QUESTION: SyncQuestionViewProps = {
  choice: "automatic",
  locked: false,
  earlier: FIXTURE_FIELDS.slice(1, 4).map((entry, index) => ({
    docId: entry.docId,
    name: entry.name,
    caption: ["2h ago", "1d ago", "3d ago"][index] ?? "",
  })),
  added: new Set([FIXTURE_FIELDS[1]?.docId ?? ""]),
  error: null,
};

/** One state of the head, at its place at a plate's top. The plate is the
 * window: a narrow one gives the pill less room, as a narrow window does. */
export function HeadPlate({
  state,
  keys = "mac",
}: {
  state: HeadState;
  keys?: ViewKeys;
}): ReactElement {
  const path = state === "folder" ? IN_A_FOLDER : state === "narrow" ? DEEP : [];
  const artifacts = plateArtifacts(state);
  const shelf: SheetShelf | null =
    state === "explorer" || state === "sync-question"
      ? "fields"
      : artifacts === null
        ? null
        : "artifacts";
  return (
    <div className="vf-ds-head-plate" data-state={state} data-keys={keys}>
      <HeadView
        covered={state === "covered"}
        place={{
          name: CURRENT?.name ?? "…",
          path,
          renaming: state === "renaming" ? (CURRENT?.name ?? "") : null,
          shelf,
          docs: FIXTURE_TILES,
          currentId: CURRENT?.docId ?? null,
          packageDot: state === "package-dot" ? FIXTURE_DOT : null,
          artifacts,
          question: state === "sync-question" ? FIXTURE_QUESTION : null,
        }}
        zoom={{ percent: 100, keys, open: state === "zoom", hot: 0 }}
      />
      {state === "palette" ? <CommandPalettePreview /> : null}
    </div>
  );
}

/** The live head on its real controller over fixture doors — the playground's.
 * The frame's one owner of the open surface is the caller's (it shares it with
 * the playground's Objects); keys are unbound: the catalog is not a window the
 * head owns, and no plugin host runs in it, so its Artifacts shelf waits. */
export function HeadLive({
  surface,
  onSurfaceChange,
}: {
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
}): ReactElement {
  const [manager] = useState(fixtureHeadManager);
  const [canvas] = useState(() => fixtureHeadCanvas({ path: IN_A_FOLDER }));
  return (
    <Head
      manager={manager}
      canvas={canvas}
      view="canvas"
      keys="mac"
      surface={surface}
      onSurfaceChange={onSurfaceChange}
      bindKeys={false}
      windowId="design-system"
    />
  );
}
