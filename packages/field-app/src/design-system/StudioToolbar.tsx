// The Studio hero toolbar and its honest status copy. Rendered only when the
// page is hosted by VibeField Studio (a controller is supplied); the
// catalog-only browser build never mounts it.
import type { ReactElement } from "react";
import type { DesignSystemStudioController, DesignSystemStudioState } from "./studio-controller";

export function StudioToolbar({
  controller,
  state,
}: {
  controller: DesignSystemStudioController;
  state: DesignSystemStudioState;
}): ReactElement {
  const status = studioStatusCopy(state);
  return (
    <div
      className="vf-ds-studio-toolbar"
      data-live={state.live ? "true" : "false"}
      data-connection={state.productConnection}
    >
      <div className="vf-ds-studio-toolbar__status" role="status">
        <span aria-hidden="true" />
        <div>
          <strong>{status.title}</strong>
          <small>{status.detail}</small>
        </div>
      </div>
      <div className="vf-ds-studio-toolbar__context">
        <span>{productConnectionLabel(state.productConnection)}</span>
        <span>
          {state.productContext === null
            ? "Theme and zoom unavailable"
            : `${state.productContext.theme === "dark" ? "Dark" : "Light"} · ${Math.round(
                state.productContext.zoom * 100,
              )}%`}
        </span>
      </div>
      <div className="vf-ds-studio-toolbar__actions">
        <button
          type="button"
          className="vf-ds-studio-live"
          aria-pressed={state.live}
          onClick={() => controller.setLive(!state.live)}
        >
          {state.live ? "Live on" : "Go live"}
        </button>
        <button
          type="button"
          className="vf-ds-studio-focus"
          disabled={state.productConnection !== "connected"}
          onClick={() => controller.focusProduct()}
        >
          Bring App Forward
        </button>
      </div>
    </div>
  );
}

function studioStatusCopy(state: DesignSystemStudioState): {
  title: string;
  detail: string;
} {
  if (state.transportError !== null) {
    return {
      title: "Studio disconnected",
      detail: studioDisconnectCopy(state.transportError),
    };
  }
  if (!state.live) {
    return {
      title: "Local changes",
      detail: "Live preview is off. Product settings are unchanged.",
    };
  }
  if (state.productConnection === "connecting") {
    return {
      title: "Connecting",
      detail: "Waiting for the product renderer to establish its preview endpoint.",
    };
  }
  if (state.productConnection === "reconnecting") {
    return {
      title: "Reconnecting",
      detail: "The app reloaded; the current snapshot will replay after a fresh acknowledgement.",
    };
  }
  if (state.productConnection === "unavailable") {
    return {
      title: "App unavailable",
      detail: "Changes stay local until the product reconnects.",
    };
  }
  if (state.rejection !== null) {
    return {
      title: "Snapshot rejected",
      detail: "The last valid product appearance remains active.",
    };
  }
  if (state.revision !== null && state.appliedRevision === state.revision) {
    return {
      title: `Applied revision ${state.revision}`,
      detail: "Previewing in the running app. Product settings are unchanged.",
    };
  }
  return {
    title: state.revision === null ? "Connecting" : `Sending revision ${state.revision}`,
    detail: "Waiting for the running app to acknowledge the complete snapshot.",
  };
}

function productConnectionLabel(connection: DesignSystemStudioState["productConnection"]): string {
  switch (connection) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "unavailable":
      return "App unavailable";
  }
}

function studioDisconnectCopy(
  error: NonNullable<DesignSystemStudioState["transportError"]>,
): string {
  switch (error) {
    case "version-mismatch":
      return "Studio and the app use different preview protocol versions. Restart the dev host.";
    case "rate-limited":
      return "The preview publisher exceeded its bounded update rate. Reopen Studio to reconnect.";
    case "oversized":
      return "The appearance snapshot exceeded the Studio transport limit.";
    case "malformed":
      return "The host rejected an invalid Studio protocol message.";
    case "transport-closed":
      return "The Studio transport closed. Reload Studio or restart the development host.";
  }
}

export function studioWorkbenchCopy(state: DesignSystemStudioState): string {
  if (state.transportError !== null) {
    return "Changes remain local because Studio is disconnected from its development host.";
  }
  if (!state.live) return "Changes are local to Studio. Product settings are unchanged.";
  if (state.productConnection !== "connected") {
    return "Changes are local; no ready product window is connected.";
  }
  if (state.rejection !== null) {
    return "The running app rejected this snapshot; the last valid revision remains active.";
  }
  if (state.revision !== null && state.revision === state.appliedRevision) {
    return `Previewing revision ${state.revision} in the running app. Product settings are unchanged.`;
  }
  return "Sending one complete appearance snapshot to the running app.";
}
