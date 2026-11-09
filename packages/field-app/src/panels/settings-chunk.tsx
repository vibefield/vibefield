import { UiButton, UnavailableState } from "@vibefield/design-kit/primitives";
import {
  Component,
  type ComponentType,
  type LazyExoticComponent,
  lazy,
  type ReactElement,
  type ReactNode,
  Suspense,
  useCallback,
  useState,
} from "react";
import { getRendererLogger } from "../logging";
import type { SettingsPanelProps } from "./SettingsPanel";

// SETTINGS ON DEMAND (Q20; James, 2026-10-28, the housekeeping page; it replaces
// ESR's follow-on). The panel, and every section only it draws, is its own
// chunk, reached by the ONE dynamic import below and by nothing static:
// `ui-system-boundaries` holds the source to that, and `pnpm bundle:assert`
// holds the build. A window that never opens Settings never loads it.
//
// When it loads: at the first open, never before ("loaded when opened"; History
// prefetches because its room is a view the window may show at any ⌘3). While it
// arrives nothing is drawn over the field: the chunk is one of the app's own
// files. A chunk that will not load, or a panel that fails as it draws, is held
// in the dialog's place in what failed's own words, with Retry; it never takes
// the window down with it, and a press outside closes it as it closes the panel.

type PanelModule = typeof import("./SettingsPanel");
type LazyPanel = LazyExoticComponent<ComponentType<SettingsPanelProps>>;

export interface SettingsPanelLoader {
  /** The panel: one lazy component across opens, so a second open draws at once. */
  panel(): LazyPanel;
  /** Drops the lazy component: it keeps a refusal for life, so the next open needs a new one. */
  forget(): void;
}

/** A loader over `importPanel`: the product's is the panel's one dynamic import; a test hands its own. */
export function settingsPanelLoader(importPanel: () => Promise<PanelModule>): SettingsPanelLoader {
  let current: LazyPanel | null = null;
  return {
    panel() {
      current ??= lazy(async () => ({ default: (await importPanel()).SettingsPanel }));
      return current;
    },
    forget() {
      current = null;
    },
  };
}

/** The product's loader: the panel's one dynamic import. */
const SETTINGS_PANEL = settingsPanelLoader(() => import("./SettingsPanel"));

function SettingsOpenFailedState({
  reason,
  onRetry,
  onClose,
}: {
  reason: string;
  onRetry: () => void;
  onClose: () => void;
}): ReactElement {
  return (
    <div
      className="vf-settings-backdrop fixed inset-0 z-[65] flex items-center justify-center p-4 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <UnavailableState
        card
        title="Settings could not open"
        description="The rest of VibeField is still running."
        action={
          <UiButton variant="primary" onClick={onRetry}>
            Retry
          </UiButton>
        }
        detail={reason}
      />
    </div>
  );
}

/** Holds what failed, the chunk refused or the panel as it drew, in the dialog's place. */
class SettingsPanelBoundary extends Component<
  { onFailed: () => void; onRetry: () => void; onClose: () => void; children: ReactNode },
  { reason: string | null }
> {
  override state: { reason: string | null } = { reason: null };
  static getDerivedStateFromError(error: unknown): { reason: string } {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
  override componentDidCatch(error: unknown): void {
    this.props.onFailed();
    getRendererLogger()
      .child({ component: "settings" })
      .error("renderer.settings.panel_failed", "Settings could not open", error);
  }
  private readonly retry = (): void => {
    this.setState({ reason: null });
    this.props.onRetry();
  };
  override render(): ReactNode {
    if (this.state.reason === null) return this.props.children;
    return (
      <SettingsOpenFailedState
        reason={this.state.reason}
        onRetry={this.retry}
        onClose={this.props.onClose}
      />
    );
  }
}

/** Settings through its chunk. `loader` is the product's unless a test hands its own. */
export function SettingsPanelMount({
  loader = SETTINGS_PANEL,
  ...panel
}: SettingsPanelProps & { loader?: SettingsPanelLoader }): ReactElement {
  const [, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((attempt) => attempt + 1), []);
  const Panel = loader.panel();
  return (
    <SettingsPanelBoundary onFailed={loader.forget} onRetry={retry} onClose={panel.onClose}>
      <Suspense fallback={null}>
        <Panel {...panel} />
      </Suspense>
    </SettingsPanelBoundary>
  );
}
