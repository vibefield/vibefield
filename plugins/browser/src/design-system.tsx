import type { ArtifactView } from "@vibefield/contracts";
import type {
  PluginProductClient,
  PluginSurfaceHandle,
  PluginSurfaceState,
  PluginSurfaceStatus,
  PluginSurfaceViewProps,
} from "@vibefield/plugin-sdk";
import { type ComponentType, type ReactElement, useMemo } from "react";
import { ArtifactPanel } from "./ArtifactPanel";
import { BrowserPageView } from "./BrowserPageView";

export type ArtifactPanelPreviewState = "empty" | "loading" | "populated" | "unavailable";

const PREVIEW_ARTIFACTS: readonly ArtifactView[] = [
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

function previewClient(state: ArtifactPanelPreviewState): PluginProductClient {
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
        snapshot: state === "populated" ? PREVIEW_ARTIFACTS : [],
        unsubscribe: () => undefined,
      });
    },
  };
}

/** Design-page adapter for the real contributed surface. Only the product
 * client is replaced; markup, local interaction state, accessibility, and CSS
 * are exactly the component shipped in the side-panel slot. */
export function ArtifactPanelPreview({
  state = "empty",
}: {
  state?: ArtifactPanelPreviewState;
}): ReactElement {
  const client = useMemo(() => previewClient(state), [state]);
  return (
    <ArtifactPanel
      client={client}
      surface={{
        slot: "hud.side-panel",
        windowId: "design-system",
        requestClose: () => undefined,
      }}
    />
  );
}

// --- the canvas browser card (DT-3d) -----------------------------------------

/** The states a browser card can actually be in, as the catalog needs to see
 * them: attaching, live with committed truth, live before any truth has
 * arrived (the read-only address bar), and lost. */
export type BrowserPagePreviewState = "attaching" | "loading" | "live" | "blank" | "lost";

/** A handle that reports one fixed state and swallows every command. Not a mock
 * of the pool — a FIXTURE for the face: the card under it is the shipping
 * component, and this is the only thing a catalog page has no way to supply. */
function fixtureHandle(state: BrowserPagePreviewState): PluginSurfaceHandle {
  const status: PluginSurfaceStatus =
    state === "attaching" ? "attaching" : state === "lost" ? "lost" : "live";
  const browser =
    status !== "live" || state === "blank"
      ? null
      : {
          url: "https://vibefield.example/board",
          title: "The field, as a page",
          loading: state === "loading",
          canGoBack: true,
          canGoForward: false,
        };
  const snapshot: PluginSurfaceState = Object.freeze({
    status,
    browser,
    error: state === "lost" ? new Error("the producer went away") : null,
  });
  return Object.freeze({
    status,
    browser,
    error: snapshot.error,
    onState(listener: (next: PluginSurfaceState) => void): () => void {
      listener(snapshot);
      return () => undefined;
    },
    setDemand: () => undefined,
    navigate: () => false,
    retry: () => undefined,
    release: () => undefined,
  });
}

/**
 * Design-page adapter for the real canvas browser card.
 *
 * `SurfaceView` is INJECTED because the card cannot reach the host's shipping
 * presentation from inside a plugin (R10 — the SDK is the only door, and the
 * real view arrives through `ctx.pool`). The catalog holds that component and
 * passes it in, so the specimen keeps the production markup, interaction state
 * and CSS, with only the handle and the document write replaced.
 */
export function BrowserPagePreview({
  SurfaceView,
  state = "live",
}: {
  SurfaceView: ComponentType<PluginSurfaceViewProps>;
  state?: BrowserPagePreviewState;
}): ReactElement {
  const handle = useMemo(() => fixtureHandle(state), [state]);
  return (
    <BrowserPageView
      handle={handle}
      SurfaceView={SurfaceView}
      url="https://vibefield.example/board"
      title={state === "blank" ? "" : "The field, as a page"}
      showChrome
      onCommit={() => undefined}
    />
  );
}
