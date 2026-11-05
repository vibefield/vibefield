import type { IndexApp, IndexAppsSource } from "@vibefield/contracts";
import type { ReactElement } from "react";
import { FROM_YOUR_AGENTS, type MadeAppsClient } from "./made-apps";
import "./made-apps.css";

// FROM YOUR AGENTS — the group (DESIGN.md §8 "Artifacts — the Artifacts shelf's contents", as amended
// 2026-11-05; §9 "Apps"): its head (the heading and the "Search apps" field that searches it), its
// days newest first, each a row of made tiles three across at the shelf's width, its honest states
// (reading, empty, unreadable, a desktop asleep or on another build, an app not written out yet with
// "Open in ‹host›"), and the in-place Versions step. A controller-free view over a client: the
// shelf's host (4c) hands it the window's FielddClient, the catalog its fixture adapter
// (`design-system.tsx`), the tests theirs.
// RED SKELETON (MA-4a): it draws an empty group.

export interface MadeAppsProps {
  readonly client: MadeAppsClient;
  /** the clock the days are read by (the catalog's is fixed) */
  readonly now?: number;
  /** this desktop's own word when the roster names it none ("This Mac", `thisDeviceWord`) */
  readonly here?: string;
  /** the dates' locale (the window's when absent) */
  readonly locale?: string;
  /** the image transport: the product derives `madeAppImageUrl`; the catalog, which has no tailnet,
   * hands its own stills */
  readonly previewSrc?: (app: IndexApp, sources: readonly IndexAppsSource[]) => string | undefined;
}

export function MadeApps(_props: MadeAppsProps): ReactElement {
  return <section className="vf-apps" aria-label={FROM_YOUR_AGENTS} />;
}
