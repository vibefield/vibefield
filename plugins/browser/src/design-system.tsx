import type { ArtifactView } from "@vibefield/contracts";
import type { PluginProductClient } from "@vibefield/plugin-sdk";
import { type ReactElement, useMemo } from "react";
import { ArtifactPanel } from "./ArtifactPanel";

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
