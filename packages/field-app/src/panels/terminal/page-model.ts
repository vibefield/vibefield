import type { TerminalConfigSnapshot, TerminalConfigValidation } from "@vibefield/contracts";
import type { DeckAppearance } from "../../godview/deck-appearance";
import type { ManagedValues } from "./config-text";
import type { PreviewMode } from "./theme-view";

// What every tab of Settings → Terminal reads (GT-7): the viewer's appearance
// (this window's, live) and the device's document (this Mac's, saved through
// the bar). The controller builds it from fieldd and the appearance store; the
// catalog builds it from fixtures — so the tabs never know which.

export type TerminalTab = "look" | "behavior" | "keyboard" | "file";

export type ThemeBrowserTarget = { kind: "window"; mode: PreviewMode } | { kind: "palette" };

export type DeviceState =
  | { kind: "loading" }
  | { kind: "unavailable"; title: string; detail: string; retryable: boolean }
  | {
      kind: "ready";
      path: string;
      exists: boolean;
      savedText: string;
      draft: string;
      dirty: boolean;
      /** the snapshot to SHOW: the draft's own once validated, else the saved one */
      snapshot: TerminalConfigSnapshot | null;
      savedSnapshot: TerminalConfigSnapshot | null;
      /** the current draft's validation (null while clean or while checking) */
      validation: TerminalConfigValidation | null;
      checking: boolean;
      /** the managed block cannot be rewritten (a marker is missing or repeated) */
      blockMalformed: boolean;
    };

export interface TerminalPageModel {
  readonly appearance: DeckAppearance;
  setAppearance(next: DeckAppearance): void;
  readonly previewMode: PreviewMode;
  setPreviewMode(mode: PreviewMode): void;
  readonly device: DeviceState;
  /** the managed block's values, as the draft holds them */
  readonly managed: ManagedValues;
  /** rewrite the draft's managed block to hold exactly these values */
  setManaged(values: ManagedValues): void;
  setDraft(text: string): void;
  /** this Mac's sixteen program colours, as the shown snapshot resolves them */
  readonly palette: readonly string[];
  /** indices the draft sets in config.ghostty, and indices only the user's Ghostty file sets */
  readonly paletteHere: ReadonlySet<number>;
  readonly paletteElsewhere: ReadonlySet<number>;
  openThemes(target: ThemeBrowserTarget): void;
  onImport(): void;
  onExport(): void;
  onReveal(): void;
  retry(): void;
  /** a search result's anchor, flashed once it is scrolled to */
  readonly highlight: string | null;
}
