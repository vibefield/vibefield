import type { LiveDeskChoice, LiveFilters, LiveProfileChoice } from "./find-door";
import type { PeekLiveRow } from "./peek-live";
import type { PeekFilters, PeekKind, PeekScope } from "./peek-model";
import type { PeekProject } from "./peek-port";

// THE PEEK'S FILTERS (SE-D1 A "Tokens" and SE-D2 A "one filter everywhere",
// ruled 2026-11-06 on the page The Bands Meter; DESIGN.md §8 "Search — the
// Peek", §9 "Search's words"; the drawing is round 4's `p5-peek.js`, variant
// `tokens`) — everything the field's tokens, ⌫, a typed name's offer, + Filter's
// menu and the live peek's head decide without a DOM, so the view draws props
// and the tests read words. Live now's filters are Godview's own (GV-D3, the
// find door's); Everything's are the popup's.
//
// RED (SE-1b): every function answers a wrong value — the green decides.

/** What was said, as Said by and a token name it (§9). */
export const KIND_WORDS: Readonly<Record<PeekKind, string>> = {
  any: "Prompts and replies",
  user: "Prompts only",
  agent: "Replies only",
};

/** A filter of the Peek's: Live now's desktop and profile (Godview's), and
 * Everything's project, what was said and agent (the popup's). */
export type PeekFilterName = "desk" | "profile" | "project" | "kind" | "agent";

/** What a pick sets: one filter to one value — null, or `any` for what was
 * said, is every one. */
export type PeekPick =
  | { readonly filter: "desk" | "profile" | "project" | "agent"; readonly value: string | null }
  | { readonly filter: "kind"; readonly value: PeekKind };

/** The mark a token, a menu row or an offer leads with (§8): the desktop's OS
 * mark, the profile's glyph (filled for the default), `folder`, `message`, the
 * agent's mark, or the ghost row's `plus`. */
export type PeekMark =
  | { readonly kind: "os"; readonly os: LiveDeskChoice["os"] }
  | {
      readonly kind: "profile";
      readonly glyph: string | undefined;
      readonly profileKind: LiveProfileChoice["kind"];
      readonly filled: boolean;
    }
  | { readonly kind: "glyph"; readonly name: "folder" | "message" | "plus" }
  | { readonly kind: "agent"; readonly id: string };

/** A filter that is on, as the field draws it: its mark, its name, its ×. */
export interface PeekFieldToken {
  readonly filter: PeekFilterName;
  readonly label: string;
  readonly mark: PeekMark;
}

/** An agent Everything can narrow to: the catalog's id and label. */
export interface PeekAgentChoice {
  readonly id: string;
  readonly label: string;
}

/** What the filters are read from. */
export interface PeekFilterState {
  readonly scope: PeekScope;
  /** Godview's filters (Live now's), or null where the view lends none (History) */
  readonly live: LiveFilters | null;
  /** Everything's, the popup's own */
  readonly filters: PeekFilters;
  readonly projects: readonly PeekProject[];
  readonly agents: readonly PeekAgentChoice[];
}

/** The field's tokens, in the order they read (§8 "A token"). */
export function peekFieldTokens(_state: PeekFilterState): readonly PeekFieldToken[] {
  return [];
}

/** What a token's × — or ⌫ — sets: its one filter back to every one. */
export function clearPick(_token: PeekFieldToken): PeekPick {
  return { filter: "desk", value: null };
}

/** The token ⌫ takes back, or null while ⌫ is the words'. */
export function backspaceTakes(
  _tokens: readonly PeekFieldToken[],
  _caret: { readonly start: number | null; readonly end: number | null },
): PeekFieldToken | null {
  return null;
}

/** A typed name's offer: the list's first row while it stands (§8 "A typed
 * name offers its filter"). */
export interface PeekOffer {
  readonly kind: "offer";
  readonly id: string;
  readonly pick: PeekPick;
  readonly mark: PeekMark;
  /** "Show only Work's sessions", "Show only what runs on studio" */
  readonly title: string;
  /** its sessions, every one's ("4 sessions") */
  readonly note: string;
}

/** The offer the words typed make, or null. */
export function peekOffer(
  _query: string,
  _scope: PeekScope,
  _live: LiveFilters | null,
): PeekOffer | null {
  return null;
}

/** The words once an offer is taken: its word leaves them. */
export function withoutLastWord(query: string): string {
  return query;
}

/** What the offer's peek says under its circle. */
export function offerWords(_offer: PeekOffer): string {
  return "";
}

/** A row of + Filter's menu: a radio, or TS-4's Connect… */
export interface PeekMenuRow {
  readonly key: string;
  readonly label: string;
  /** the filter as it stands: in the ready fill, `aria-checked` */
  readonly on: boolean;
  /** what a pick sets, or the ghost row's Connect… */
  readonly pick: PeekPick | "connect";
  readonly mark: PeekMark | null;
  /** the word at its end: its sessions or agents, "waiting", a standing, Connect… */
  readonly note: string | null;
  /** a desktop that is not answering */
  readonly quiet: boolean;
}

/** One group of the menu, under the menus' eyebrow. */
export interface PeekMenuGroup {
  readonly eyebrow: string;
  readonly rows: readonly PeekMenuRow[];
}

/** + Filter's menu: empty when the scope has nothing to filter. */
export function filterMenu(_state: PeekFilterState): readonly PeekMenuGroup[] {
  return [];
}

/** The profile a live row says, or null. */
export function rowProfile(_row: PeekLiveRow, _live: LiveFilters | null): LiveProfileChoice | null {
  return null;
}

/** The live peek's head words. */
export function liveHeadWords(
  _row: PeekLiveRow,
  _profile: LiveProfileChoice | null,
  _here: string,
): string {
  return "";
}

/** UM-D28 — what Everything's foot adds while the lens is on. */
export function everythingLensWords(_live: LiveFilters | null): string {
  return "";
}
