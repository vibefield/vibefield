import {
  APP_PREFERENCE_KEYS,
  AppPreferences,
  CommunityStatement,
  type PluginsCatalog,
} from "@vibefield/contracts";
import type { ShelfState } from "./plugins-model";
import type { PluginsDoorClient } from "./plugins-port";
import { COMMUNITY_WORDS } from "./plugins-words";

// THE COMMUNITY SWITCH, AS THE POPUP READS AND SENDS IT (MK-O3D, 2026-11-14; DESIGN.md §8
// "The community tile", drawn 2026-11-14; §9 "Community plugins"). The switch is the person's
// app preference `plugins.community`, in the settings doc that syncs to every desktop (MK-E3).
// The window reads it from fieldd's app preferences and sends a change through the one setter
// fieldd audits (`plugin.community.set`, MK-2a); fieldd alone decides what may install and run
// (MK's J1: the fence is fieldd's, never the window's). The statement is shown once on each
// desktop (James's MK-O1 pick B): fieldd keeps this desktop's mark, never synced, and the window
// reads it and marks it through its two doors (`plugins.community.statement.*`). Pure, beside
// the doors: the controller, the tile and the tests read the same functions.

/** The switch as fieldd's app preferences say it: on only for a stored true (absent, as in an
 * older daemon's snapshot, reads off, as fieldd reads it); null when the snapshot can't be read,
 * so nothing is taken for an answer. */
export function communityFrom(raw: unknown): boolean | null {
  const parsed = AppPreferences.safeParse(raw);
  return parsed.success ? parsed.data.communityPlugins === true : null;
}

/** How many plugins by other people the list held names. */
export function communityCount(catalog: PluginsCatalog | null): number {
  return (catalog?.plugins ?? []).filter((entry) => entry.listedAs === "community").length;
}

/** Discover's community tile, as it stands now. */
export interface CommunityTile {
  /** the switch as fieldd says it */
  readonly on: boolean;
  /** "‹n› plugins by other people. VibeField checks each one before it's listed." */
  readonly line: string;
  /** "Off until you turn them on", or while on, what turning them off does */
  readonly state: string;
}

/** Whether the tile stands, and what it says (§8 "Where it stands until the shelf"): with a list
 * held (Discover's count, the shelf's stand-in), while the list names a plugin by other people or
 * while community plugins are on, so they can always be turned off here. No tile with nothing to
 * discover, a read with no list held, or VibeField's plugins not answering; and none before this
 * window has read the switch (its preferences loading, refused, or a snapshot it can't read), as
 * for fieldd away: a tile then would say off for a switch that may be on. */
export function communityTile(
  shelf: ShelfState,
  catalog: PluginsCatalog | null,
  on: boolean | null,
): CommunityTile | null {
  if (shelf.kind !== "counted" || on === null) return null;
  const count = communityCount(catalog);
  if (count === 0 && !on) return null;
  return {
    on,
    line: COMMUNITY_WORDS.line(count),
    state: on ? COMMUNITY_WORDS.on : COMMUNITY_WORDS.off,
  };
}

/** The switch's one request, the one Settings' preferences send (`storage.appPreferences.set`):
 * it settles when fieldd has answered. Its answer is not read: the preferences fieldd pushes next
 * are the one truth the switch shows (the P5 law), so it never moves on an answer. */
export function communityDoor(client: PluginsDoorClient): (on: boolean) => Promise<void> {
  return async (on) => {
    await client.request("storage.appPreferences.set", {
      key: APP_PREFERENCE_KEYS.COMMUNITY_PLUGINS,
      value: on,
    });
  };
}

/** The statement's mark at this desktop (James's MK-O1 pick B): whether this desktop has shown
 * the statement, and marking it once the person goes on past it here. */
export interface CommunityStatementDoor {
  /** fieldd's `plugins.community.statement.get`, parsed: an answer it can't read rejects */
  shownHere(): Promise<boolean>;
  /** fieldd's `plugins.community.statement.shown`: settles when fieldd has answered */
  markShown(): Promise<void>;
}

export function statementDoor(client: PluginsDoorClient): CommunityStatementDoor {
  return {
    async shownHere() {
      const answer = await client.request("plugins.community.statement.get", {});
      return CommunityStatement.parse(answer).shownHere;
    },
    async markShown() {
      await client.request("plugins.community.statement.shown", {});
    },
  };
}
