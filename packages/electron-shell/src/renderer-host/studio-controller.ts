import {
  defaultProductAppearance,
  deserializeVisualTweaks,
  type ProductAppearance,
  serializeVisualTweaks,
} from "@vibefield/field-app/appearance";
import type {
  DesignSystemStudioController,
  DesignSystemStudioState,
} from "@vibefield/field-app/design-system/studio-controller";
import type { HostToStudio } from "../studio/protocol";
import type { StudioRendererApi } from "../studio/studio-preload-bridge";

/** Renderer-owned view model. The product only ever receives complete documents. */
export class ElectronStudioController implements DesignSystemStudioController {
  private state: DesignSystemStudioState = Object.freeze({
    appearance: defaultProductAppearance(),
    live: false,
    productConnected: false,
    revision: null,
    appliedRevision: null,
    rejection: null,
  });
  private readonly listeners = new Set<() => void>();
  private readonly stopMessages: () => void;

  constructor(private readonly api: StudioRendererApi) {
    this.stopMessages = api.onMessage((message) => this.receive(message));
  }

  snapshot = (): DesignSystemStudioState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setAppearance = (appearance: ProductAppearance): void => {
    this.update({ appearance });
    if (this.state.live) this.api.publishAppearance(serializeVisualTweaks(appearance));
  };

  setLive = (live: boolean): void => {
    if (live === this.state.live) return;
    this.update({ live, rejection: null });
    if (live) this.api.publishAppearance(serializeVisualTweaks(this.state.appearance));
    else this.api.clearAppearance();
  };

  focusProduct = (): void => this.api.focusProduct();

  dispose(): void {
    this.stopMessages();
    this.listeners.clear();
  }

  private receive(message: HostToStudio): void {
    switch (message.type) {
      case "studio.snapshot": {
        if (message.serialized === null) {
          this.update({ live: message.live, revision: message.revision });
          return;
        }
        try {
          this.update({
            appearance: deserializeVisualTweaks(message.serialized),
            live: message.live,
            revision: message.revision,
          });
        } catch {
          this.update({
            live: message.live,
            revision: message.revision,
            rejection: "invalid-document",
          });
        }
        return;
      }
      case "studio.status":
        this.update(message.status);
        return;
      case "appearance.accepted":
        this.update({ revision: message.revision, appliedRevision: null, rejection: null });
        return;
      case "appearance.applied":
        if (message.revision === this.state.revision) {
          this.update({ appliedRevision: message.revision, rejection: null });
        }
        return;
      case "appearance.rejected":
        if (message.revision === this.state.revision) {
          this.update({ rejection: message.code });
        }
    }
  }

  private update(patch: Partial<DesignSystemStudioState>): void {
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of [...this.listeners]) listener();
  }
}
