import type {
  PluginRecord,
  PluginRegistrySnapshot,
  PluginsCatalog,
  PluginsCatalogEntry,
  PluginsCatalogState,
} from "@vibefield/contracts";
import {
  boardSet,
  cardPowers,
  type InstallCard,
  type InstallRefusal,
  installLive,
  type PageAct,
} from "./plugins-install";
import { type InstalledRow, installedMatches, installedRows } from "./plugins-model";
import { listNames, listTime, releaseDay, UPDATE_CARD_WORDS, UPDATE_WORDS } from "./plugins-words";

// UPDATES' ROWS AND THE UPDATE CARD'S WINDOW HALF (MK-UC's UC-C; DESIGN.md §8 "Updates", drawn
// 2026-11-14, and §9 "Updates"; James's pick on the board, 2026-11-12 06:08:01Z: "Yes: show the
// card when an update asks for more"). Updates lists each plugin this desktop has from the plugin
// list whose list entry is newer, from the registry snapshot the window holds and the list the
// popup already read: its head, its rows, what each changes in the set, its act and its steps. An
// Update downloads first (`plugins.install.prepare` with `update`, MK-UC's door), and fieldd says
// what the downloaded plugin can do that the version you have can't; when that is nothing and it
// removes no object it is taken at once, still one press, and otherwise the update card stands
// where the act stood: the install card (`plugins-install.ts`, `InstallCard.tsx`), its ask, its
// lead and its act's word its own, naming the new powers alone. Pure: the controller holds the
// flow, and the tests read the same functions. MK-4d (K4 at its lean, pending VF-PM's ruling): a
// page whose update is taken, or can't run here, says Installed with the set Show them on the
// pegboard hands the board (`boardSet` of the snapshot's record, read by the row's act).

/** fieldd's own compare (`fieldd/src/plugin-install.ts`, `semverNewer`): a.b.c only, a prerelease
 * tag dropped, so the window lists the updates fieldd counts for the Me menu's row. */
export function versionNewer(candidate: string, installed: string): boolean {
  const parse = (version: string): number[] => version.split("-")[0]?.split(".").map(Number) ?? [];
  const a = parse(candidate);
  const b = parse(installed);
  for (let i = 0; i < 3; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** One of Updates' rows (§8 "Updates", "A row"). */
export interface UpdateRow {
  readonly id: string;
  readonly title: string;
  /** the source pill's word and "Community", as Installed's row says them */
  readonly source: string;
  readonly community: boolean;
  /** the version you have, and the update's */
  readonly from: string;
  readonly to: string;
  /** "0.6.1 → 0.7.0 · Nov 7" */
  readonly line: string;
  /** "Adds Watch · Removes Burndown", when the list's listing says what it changes; else null */
  readonly changes: string | null;
  /** the list says it removes an object, so its act is Update… */
  readonly asksFirst: boolean;
  /** the list says it can run here (the catalog's `compatible`) */
  readonly compatible: boolean;
  /** how many objects the version you have adds: Update all takes those with none first */
  readonly objects: number;
  /** the version this popup's opening took it to; null while it waits */
  readonly done: string | null;
}

/** Each object a plugin adds, by its type, said by its pegboard label (or its title). */
function labelsOf(record: PluginRecord): Map<string, string> {
  return new Map<string, string>(
    record.contributions.objects.map((object) => [object.type, object.tray?.label ?? object.title]),
  );
}

/** The objects `installed` adds that `update` doesn't, by their labels: what an update leaves
 * missing on your desks. */
export function removedObjects(installed: PluginRecord, update: PluginRecord): string[] {
  const kept = new Set(update.contributions.objects.map((object) => object.type));
  return [...labelsOf(installed)].filter(([type]) => !kept.has(type)).map(([, label]) => label);
}

/** What a row says the update changes in the set, from the list's listing for its latest release
 * (its objects, by type), and whether it removes one: nothing when the list carries no listing. */
function changesOf(
  record: PluginRecord,
  listed: PluginsCatalogEntry,
): { readonly words: string | null; readonly removes: boolean } {
  if (listed.listing === undefined) return { words: null, removes: false };
  const have = labelsOf(record);
  const next = new Set(listed.listing.objects.map((object) => object.type));
  const adds = listed.listing.objects
    .filter((object) => !have.has(object.type))
    .map((object) => object.label);
  const removes = [...have].filter(([type]) => !next.has(type)).map(([, label]) => label);
  const said = [
    ...(adds.length > 0 ? [UPDATE_WORDS.adds(listNames(adds))] : []),
    ...(removes.length > 0 ? [UPDATE_WORDS.removes(listNames(removes))] : []),
  ];
  return { words: said.length > 0 ? said.join(" · ") : null, removes: removes.length > 0 };
}

/** Updates' rows (§8 "Updates", "Which updates"): each plugin this desktop has from the plugin list
 * whose list entry's latest is newer, and each this opening took (`updated`, by id and version),
 * that holds the typed words, by title. */
export function updateRows(
  snapshot: PluginRegistrySnapshot,
  catalog: PluginsCatalog,
  query = "",
  updated: ReadonlyMap<string, string> = new Map(),
): UpdateRow[] {
  const pills = new Map<string, InstalledRow>(
    installedRows(snapshot, catalog).map((row) => [row.id, row]),
  );
  const rows: UpdateRow[] = [];
  for (const record of snapshot.plugins) {
    if (record.source !== "registry" || !installedMatches(record, query)) continue;
    const listed = catalog.plugins.find((entry) => entry.id === record.id);
    const done = updated.get(record.id) ?? null;
    const newer = listed !== undefined && versionNewer(listed.latest.version, record.version);
    if (done === null && !newer) continue;
    const to = done ?? listed?.latest.version ?? record.version;
    const changes =
      done === null && listed !== undefined
        ? changesOf(record, listed)
        : { words: null, removes: false };
    const pill = pills.get(record.id);
    rows.push({
      id: record.id,
      title: record.title,
      source: pill?.source ?? "",
      community: pill?.community ?? false,
      from: record.version,
      to,
      line: UPDATE_WORDS.line(
        record.version,
        to,
        releaseDay(listed?.latest.publishedAt ?? catalog.checkedAt ?? 0),
      ),
      changes: changes.words,
      asksFirst: changes.removes,
      compatible: listed?.compatible ?? true,
      objects: record.contributions.objects.length,
      done,
    });
  }
  return rows.sort((a, b) => a.title.localeCompare(b.title));
}

/** Whether a row can be taken: the list says it can run here, and this opening hasn't taken it. */
export function takeable(row: UpdateRow): boolean {
  return row.compatible && row.done === null;
}

/** The tab's head (§9 "Updates"): how many can be taken and when the list was read, or that
 * everything is up to date. */
export function updatesHead(
  rows: readonly UpdateRow[],
  catalog: PluginsCatalog,
  now: number,
): string {
  const when = catalog.checkedAt === null ? "" : listTime(catalog.checkedAt, now);
  const count = rows.filter(takeable).length;
  return count > 0 ? UPDATE_WORDS.head(count, when) : UPDATE_WORDS.current(when);
}

/** The order Update all takes the rows in (§8 "Update all"): plugins with no object first, so the
 * window comes back fresh as late as it can, then the rows' order. */
export function updateAllOrder(rows: readonly UpdateRow[]): string[] {
  const taken = rows.filter(takeable);
  return [
    ...taken.filter((row) => row.objects === 0),
    ...taken.filter((row) => row.objects > 0),
  ].map((row) => row.id);
}

/** Where one update stands, for the plugin it updates: its download, its card (the row fieldd
 * answered for the download, what it can do that the version you have can't — null when fieldd
 * didn't say — and the objects it leaves missing), or its Update sent. */
export type UpdateStep =
  | { readonly step: "downloading" }
  | {
      readonly step: "card";
      readonly candidate: string;
      readonly record: PluginRecord;
      readonly asksFor: readonly string[] | null;
      readonly removes: readonly string[];
    }
  | { readonly step: "updating"; readonly version: string };

/** One update under way, the only one: on a row of Updates or on its plugin's page, and whether
 * Update all took it. */
export interface UpdateFlow {
  readonly id: string;
  readonly where: "row" | "page";
  readonly all: boolean;
  readonly at: UpdateStep;
}

/** Whether an update's download stops at its card: fieldd says it can do more (or doesn't say), or
 * it leaves an object missing. Otherwise it is taken at once: one press. */
export function asksFirst(asksFor: readonly string[] | null, removes: readonly string[]): boolean {
  return asksFor === null || asksFor.length > 0 || removes.length > 0;
}

/** The update card (§9 "Updates", the update card): the install card's own, read from the plugin
 * just downloaded — its ask, the new powers alone under "This version can also:", the objects it
 * leaves missing, where it updates (this desktop alone), and its act's word. */
export function updateCard(
  record: PluginRecord,
  asksFor: readonly string[] | null,
  removes: readonly string[],
  snapshot: PluginRegistrySnapshot | null,
  onMac: boolean,
): InstallCard {
  const powers = asksFor === null ? [] : cardPowers(record, snapshot, onMac, asksFor);
  return {
    ask: UPDATE_CARD_WORDS.ask(record.title),
    adds: null,
    objects: [],
    tools: null,
    can: powers.length > 0 ? UPDATE_CARD_WORDS.can : null,
    powers,
    reaches: UPDATE_CARD_WORDS.here(onMac),
    desktops: [],
    missing: removes.length > 0 ? UPDATE_CARD_WORDS.missing(listNames(removes)) : null,
    confirm: UPDATE_CARD_WORDS.confirm,
  };
}

/** What stands at a row's end, or under it (§8 "Its steps"). MK-4d (K4 at its lean): one whose
 * plugin stands installed (its update can't run here, or is taken) carries `show`, the set its
 * page's Installed hands the board (`boardSet` of the snapshot's record), which no row draws. */
export type RowAct =
  | { readonly kind: "update"; readonly live: boolean; readonly asks: boolean }
  | { readonly kind: "needs-newer"; readonly show: readonly string[] }
  | { readonly kind: "downloading" }
  | { readonly kind: "card"; readonly card: InstallCard; readonly live: boolean }
  | { readonly kind: "updating" }
  | { readonly kind: "failed"; readonly live: boolean }
  | { readonly kind: "updated"; readonly show: readonly string[] };

/** A row's act, from the row, the update under way, the updates that didn't happen (by the kind of
 * their refusal, as an install's: `installRefusal`), whether another update or an install holds the
 * presses (`busy`), the list's state and whether fieldd answers. One refused as needing a newer
 * VibeField says so, with no Try again, since trying again fails the same way. */
export function rowAct(input: {
  readonly row: UpdateRow;
  readonly flow: UpdateFlow | null;
  readonly failed: ReadonlyMap<string, InstallRefusal>;
  readonly busy: boolean;
  readonly state: PluginsCatalogState | null;
  readonly away: boolean;
  readonly snapshot: PluginRegistrySnapshot | null;
  readonly onMac: boolean;
}): RowAct {
  const { row, flow, failed, busy, state, away, snapshot, onMac } = input;
  // MK-4d (K4): the set the board hangs of the plugin as the snapshot holds it now
  const hung = (): string[] => boardSet(snapshot?.plugins.find((plugin) => plugin.id === row.id));
  if (row.done !== null) return { kind: "updated", show: hung() };
  if (flow !== null && flow.id === row.id) {
    switch (flow.at.step) {
      case "downloading":
        return { kind: "downloading" };
      case "card":
        return {
          kind: "card",
          card: updateCard(flow.at.record, flow.at.asksFor, flow.at.removes, snapshot, onMac),
          live: !away,
        };
      case "updating":
        return { kind: "updating" };
    }
  }
  const refusal = failed.get(row.id);
  if (!row.compatible || refusal === "incompatible") return { kind: "needs-newer", show: hung() };
  const live = installLive(state, away) && !busy;
  if (refusal !== undefined) return { kind: "failed", live };
  return { kind: "update", live, asks: row.asksFirst };
}

/** A page's act from its row's (§8 "A page's act"): Update where Installed stood, its steps the
 * install's words but its own Updating… and failure, and Installed again once it is taken. One
 * whose update can't run here keeps Installed: the plugin you have runs, only its update can't,
 * and its row on Updates says so. MK-4d (K4 at its lean, pending VF-PM's ruling): either
 * Installed carries its row's set, so Show them on the pegboard stands again with it. */
export function updatePageAct(act: RowAct, title: string): PageAct {
  switch (act.kind) {
    case "update":
      return { kind: "update", live: act.live, asks: act.asks };
    case "needs-newer":
      return { kind: "installed", show: act.show };
    case "downloading":
      return { kind: "downloading" };
    case "card":
      return { kind: "card", card: act.card, live: act.live };
    case "updating":
      return { kind: "installing", words: UPDATE_WORDS.updating };
    case "failed":
      return { kind: "failed", words: UPDATE_WORDS.failed(title), live: act.live };
    case "updated":
      return { kind: "installed", show: act.show };
  }
}

/** Update all's own act at the head's end (§8 "The head"): while any row can be taken, Update all —
 * Update all… while one of them removes an object — taking no press while another update or an
 * install holds the presses; null when none can be taken. */
export function updateAllAct(
  rows: readonly UpdateRow[],
  busy: boolean,
  state: PluginsCatalogState | null,
  away: boolean,
): { readonly words: string; readonly live: boolean } | null {
  const taken = rows.filter(takeable);
  if (taken.length === 0) return null;
  return {
    words: taken.some((row) => row.asksFirst) ? UPDATE_WORDS.allAsks : UPDATE_WORDS.all,
    live: installLive(state, away) && !busy,
  };
}
