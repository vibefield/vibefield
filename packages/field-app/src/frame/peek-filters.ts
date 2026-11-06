import { GHOST_ROW_ACT, GHOST_ROW_LABEL } from "../account/link";
import {
  filterToken,
  type LiveDeskChoice,
  type LiveFilters,
  type LiveProfileChoice,
} from "./find-door";
import { type PeekListRow, type PeekLiveRow, plural } from "./peek-live";
import { hasOpenQuote, type PeekFilters, type PeekKind, type PeekScope } from "./peek-model";
import type { PeekProject } from "./peek-port";

// THE PEEK'S FILTERS (SE-D1 A "Tokens" and SE-D2 A "one filter everywhere",
// ruled 2026-11-06 on the page The Bands Meter; DESIGN.md §8 "Search — the
// Peek", §9 "Search's words"; the drawing is round 4's `p5-peek.js`, variant
// `tokens`) — everything the field's tokens, ⌫, a typed name's offer, + Filter's
// menu and the live peek's head decide without a DOM, so the view draws props
// and the tests read words. Live now's filters are Godview's own (GV-D3, the
// find door's); Everything's are the popup's.

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

const deskMark = (desk: LiveDeskChoice): PeekMark => ({ kind: "os", os: desk.os });

const profileMark = (profile: LiveProfileChoice): PeekMark => ({
  kind: "profile",
  glyph: profile.glyph,
  profileKind: profile.kind,
  filled: profile.isDefault === true,
});

/** The field's tokens, in the order they read (§8 "A token"): Live now's the
 * desktop's then the profile's — the button's token, the same state (SE-D2) —
 * and Everything's the project's, what was said (only when it is not every
 * kind) and the agent's. A scope shows only its own: Everything shows no
 * profile or desktop, as it looks through every profile (UM-D28). A filter
 * that was not chosen draws none, so This Mac alone (TS-4) draws none. */
export function peekFieldTokens(state: PeekFilterState): readonly PeekFieldToken[] {
  const tokens: PeekFieldToken[] = [];
  if (state.scope === "live") {
    const on = state.live === null ? null : filterToken(state.live);
    if (on?.desk) tokens.push({ filter: "desk", label: on.desk.name, mark: deskMark(on.desk) });
    if (on?.profile) {
      tokens.push({ filter: "profile", label: on.profile.label, mark: profileMark(on.profile) });
    }
    return tokens;
  }
  const { filters } = state;
  if (filters.project !== null) {
    const name = state.projects.find((entry) => entry.id === filters.project)?.name;
    tokens.push({
      filter: "project",
      label: name ?? filters.project,
      mark: { kind: "glyph", name: "folder" },
    });
  }
  if (filters.kind !== "any") {
    tokens.push({
      filter: "kind",
      label: KIND_WORDS[filters.kind],
      mark: { kind: "glyph", name: "message" },
    });
  }
  if (filters.agent !== null) {
    const label = state.agents.find((entry) => entry.id === filters.agent)?.label;
    tokens.push({
      filter: "agent",
      label: label ?? filters.agent,
      mark: { kind: "agent", id: filters.agent },
    });
  }
  return tokens;
}

/** What a token's × — or ⌫ — sets: its one filter back to every one (what was
 * said back to every kind). A desktop's or a profile's is Godview's, so the
 * stage, the button and the column's ring let go of it too (SE-D2). */
export function clearPick(token: PeekFieldToken): PeekPick {
  const { filter } = token;
  return filter === "kind" ? { filter, value: "any" } : { filter, value: null };
}

/** ⌫ with the caret at the field's start and nothing selected takes the last
 * token back — the tokens' own order from its end: in Everything the agent's,
 * then what was said, then the project's; in Live now the profile's, then the
 * desktop's. Null while ⌫ is the words'. */
export function backspaceTakes(
  tokens: readonly PeekFieldToken[],
  caret: { readonly start: number | null; readonly end: number | null },
): PeekFieldToken | null {
  if (caret.start !== 0 || caret.end !== 0) return null;
  return tokens[tokens.length - 1] ?? null;
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

/** A row of the list: a session, live or past, or a typed name's offer, which
 * stands first. */
export type PeekListItem = PeekListRow | PeekOffer;

export function isOffer(row: PeekListItem): row is PeekOffer {
  return (row as PeekOffer).kind === "offer";
}

/** The last word typed (the space after it kept out), and where it starts. */
function lastWord(query: string): { readonly word: string; readonly at: number } | null {
  const found = /(\S+)\s*$/u.exec(query);
  return found === null ? null : { word: found[1] ?? "", at: found.index };
}

/** A desktop that can be chosen: none while This Mac alone stands for every
 * desktop (TS-4, not connected). */
function choosableDesks(live: LiveFilters): readonly LiveDeskChoice[] {
  return live.connect === true && live.desks.length === 1 ? [] : live.desks;
}

/** The offer the words typed make, in Live now only: when the last word, of
 * two letters or more and outside quotes (words in quotes still search as
 * words), begins a word of the name of a profile or a desktop that could be
 * chosen — while none of its kind is — a profile before a desktop. Its count
 * is every session's, as the menu's are. */
export function peekOffer(
  query: string,
  scope: PeekScope,
  live: LiveFilters | null,
): PeekOffer | null {
  if (scope !== "live" || live === null) return null;
  const last = lastWord(query);
  if (last === null || last.word.length < 2) return null;
  if (last.word.includes('"') || hasOpenQuote(query.slice(0, last.at))) return null;
  const typed = last.word.toLocaleLowerCase();
  const begins = (name: string): boolean =>
    name
      .toLocaleLowerCase()
      .split(/\s+/u)
      .some((word) => word.startsWith(typed));
  if (live.profile === null) {
    const profile = live.profiles.find((entry) => begins(entry.label));
    if (profile !== undefined) {
      return {
        kind: "offer",
        id: `offer:profile:${profile.id}`,
        pick: { filter: "profile", value: profile.id },
        mark: profileMark(profile),
        title: `Show only ${profile.label}'s sessions`,
        note: plural(profile.sessions, "session"),
      };
    }
  }
  if (live.desk === null) {
    const desk = choosableDesks(live).find((entry) => begins(entry.name));
    if (desk !== undefined) {
      return {
        kind: "offer",
        id: `offer:desk:${desk.id}`,
        pick: { filter: "desk", value: desk.id },
        mark: deskMark(desk),
        title: `Show only what runs on ${desk.name}`,
        note: plural(desk.sessions, "session"),
      };
    }
  }
  return null;
}

/** The words once an offer is taken: its word leaves them, and the space after it. */
export function withoutLastWord(query: string): string {
  return query.replace(/\S+\s*$/u, "");
}

/** What the offer's peek says under its circle. */
export function offerWords(offer: PeekOffer): string {
  return `${offer.title}. The field, the button and the stage keep it until you remove it.`;
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

/** A radio row, with no mark, no note, never quiet unless it says so. */
function choice(
  row: Pick<PeekMenuRow, "key" | "label" | "on" | "pick"> &
    Partial<Pick<PeekMenuRow, "mark" | "note" | "quiet">>,
): PeekMenuRow {
  return { mark: null, note: null, quiet: false, ...row };
}

/** Live now's groups (Godview's): Profiles, only while a profile besides This
 * Mac exists — Every profile, then each, "waiting" beside one a session waits
 * in, else its sessions — then Desktops, only with a choice to make — All
 * desktops with its agents, then each, "name · here" beside this one, its note
 * beside it, one not answering quiet; while this Mac is not connected, This
 * Mac alone stands for All desktops and TS-4's ghost row closes the group. */
function liveGroups(live: LiveFilters): PeekMenuGroup[] {
  const groups: PeekMenuGroup[] = [];
  if (live.profiles.length > 0) {
    groups.push({
      eyebrow: "Profiles",
      rows: [
        choice({
          key: "every",
          label: "Every profile",
          on: live.profile === null,
          pick: { filter: "profile", value: null },
          note: plural(live.sessions, "session"),
        }),
        ...live.profiles.map((entry) =>
          choice({
            key: entry.id,
            label: entry.label,
            on: live.profile === entry.id,
            pick: { filter: "profile", value: entry.id },
            mark: profileMark(entry),
            note: entry.blocked === true ? "waiting" : plural(entry.sessions, "session"),
          }),
        ),
      ],
    });
  }
  if (live.desks.length > 0) {
    const only = live.connect === true && live.desks.length === 1 ? live.desks[0] : undefined;
    const agents = live.desks.reduce((sum, entry) => sum + entry.agents, 0);
    groups.push({
      eyebrow: "Desktops",
      rows: [
        ...(only === undefined
          ? [
              choice({
                key: "all",
                label: "All desktops",
                on: live.desk === null,
                pick: { filter: "desk", value: null },
                note: plural(agents, "agent"),
              }),
            ]
          : []),
        ...live.desks.map((entry) =>
          choice({
            key: entry.id,
            label: entry.here ? `${entry.name} · here` : entry.name,
            on: live.desk === entry.id || entry === only,
            pick: { filter: "desk", value: entry === only ? null : entry.id },
            mark: deskMark(entry),
            note: entry.note,
            quiet: entry.quiet,
          }),
        ),
        ...(live.connect === true
          ? [
              choice({
                key: "connect",
                label: GHOST_ROW_LABEL,
                on: false,
                pick: "connect",
                mark: { kind: "glyph", name: "plus" },
                note: GHOST_ROW_ACT,
              }),
            ]
          : []),
      ],
    });
  }
  return groups;
}

/** + Filter's menu (§8 "The Filter menu"): Live now's Profiles and Desktops
 * in Godview, Everything's Projects, Said by and Agents — empty when the scope
 * has nothing to filter (History's Live now; Godview with This Mac alone and
 * one profile), and + Filter is then not drawn. */
export function filterMenu(state: PeekFilterState): readonly PeekMenuGroup[] {
  if (state.scope === "live") return state.live === null ? [] : liveGroups(state.live);
  const { filters } = state;
  return [
    {
      eyebrow: "Projects",
      rows: [
        choice({
          key: "every",
          label: "Every project",
          on: filters.project === null,
          pick: { filter: "project", value: null },
        }),
        ...state.projects.map((entry) =>
          choice({
            key: entry.id,
            label: entry.name,
            on: filters.project === entry.id,
            pick: { filter: "project", value: entry.id },
            mark: { kind: "glyph", name: "folder" },
          }),
        ),
      ],
    },
    {
      eyebrow: "Said by",
      rows: (["any", "user", "agent"] as const).map((kind) =>
        choice({
          key: kind,
          label: KIND_WORDS[kind],
          on: filters.kind === kind,
          pick: { filter: "kind", value: kind },
        }),
      ),
    },
    {
      eyebrow: "Agents",
      rows: [
        choice({
          key: "any",
          label: "Any agent",
          on: filters.agent === null,
          pick: { filter: "agent", value: null },
        }),
        ...state.agents.map((entry) =>
          choice({
            key: entry.id,
            label: entry.label,
            on: filters.agent === entry.id,
            pick: { filter: "agent", value: entry.id },
            mark: { kind: "agent", id: entry.id },
          }),
        ),
      ],
    },
  ];
}

/** The profile a live row says (SE-D1; UM-D12, a lens and no profile words
 * while This Mac is the only one): its run's, as the offered profiles name it. */
export function rowProfile(row: PeekLiveRow, live: LiveFilters | null): LiveProfileChoice | null {
  if (row.profile === null || live === null) return null;
  return live.profiles.find((entry) => entry.id === row.profile) ?? null;
}

/** The live peek's head (SE-D1, the past peek's recipe): its folder, its agent,
 * its profile as its row says one, where it runs — `here` for this desktop's
 * run, "on this Mac" in the device's own word (`onThisDeviceWords`), or "on
 * ‹desktop›" for a peer's — and its state, joined by " · ". */
export function liveHeadWords(
  row: PeekLiveRow,
  profile: LiveProfileChoice | null,
  here: string,
): string {
  const where = row.remote === null ? here : `on ${row.remote.name}`;
  return [row.folder, row.agent, profile?.label ?? null, where, row.when]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/** UM-D28 A — Everything looks through every profile: while Godview's profile
 * filter is on, its foot says so and where the filter comes back. */
export function everythingLensWords(live: LiveFilters | null): string {
  const profile = live === null ? null : (filterToken(live)?.profile ?? null);
  return profile === null ? "" : ` · every profile; ${profile.label} comes back on Live now`;
}
