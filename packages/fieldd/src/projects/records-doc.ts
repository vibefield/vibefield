import type { LoroDoc, LoroMap } from "loro-crdt";
import type { GroupingIntents, GroupingLink, GroupingRecord, GroupingSplit } from "./grouping";

// PJ-2 (build-pj23.md D1; `thinking-project-places.md` §3, PJ-D19) — the
// person's PROJECT RECORDS and intents, as they live in the LIBRARY (DS-5's
// per-account Loro system document, library-doc.ts), so every desktop of one
// account reads the same records and a rename made on one desktop reads on the
// other.
//
// LAYOUT — NEW ROOT maps beside the canvases' (`names`, `created`, …), each
// named `projects.*`, never a nested container (two desktops creating one at
// once would make two, and one side's keys would be lost) and never the
// settings document (its undo could resurrect a deleted act). An older desktop
// imports root containers it does not know untouched, and its `entries()`
// reads only the canvases' maps, so it neither sees nor drops these.
//
//   GROW-ONLY (a key is written once and never deleted):
//     projects.created     record → createdAt (epoch ms): the record EXISTS
//     projects.anchors     record \0 anchor → addedAt (written once: read back
//                          oldest first — `bindRecords` breaks a tie on the
//                          oldest anchor)
//     projects.acted       record \0 placeId → the latest act there (D6)
//     projects.links       placeA \0 placeB (sorted) → the act's time
//     projects.splits      placeId \0 notRecord → the act's time
//     projects.dismissals  recordA \0 recordB (sorted) → the act's time
//   A link or a split made again moves its time (the later act wins, D2).
//   LAST WRITER WINS, per record:
//     projects.names · projects.inks (P3: frozen at the first act) ·
//     projects.recipes (JSON text) · projects.pinned · projects.hidden
//
// Reads are tolerant: a key or value of another shape (a newer desktop's, a
// half-merged one) is skipped, never fatal.

export const PROJECT_MAPS = {
  created: "projects.created",
  anchors: "projects.anchors",
  acted: "projects.acted",
  links: "projects.links",
  splits: "projects.splits",
  dismissals: "projects.dismissals",
  names: "projects.names",
  inks: "projects.inks",
  recipes: "projects.recipes",
  pinned: "projects.pinned",
  hidden: "projects.hidden",
} as const;

/** One write to the records, as an act makes it. */
export type ProjectWrite =
  | {
      readonly kind: "create";
      readonly record: string;
      readonly createdAt: number;
      readonly ink?: number;
    }
  | {
      readonly kind: "anchor";
      readonly record: string;
      readonly anchor: string;
      readonly at: number;
    }
  | { readonly kind: "acted"; readonly record: string; readonly place: string; readonly at: number }
  | { readonly kind: "name"; readonly record: string; readonly name: string }
  | { readonly kind: "pinned"; readonly record: string; readonly value: boolean }
  | { readonly kind: "hidden"; readonly record: string; readonly value: boolean }
  | { readonly kind: "recipe"; readonly record: string; readonly recipe: unknown }
  | { readonly kind: "link"; readonly a: string; readonly b: string; readonly at: number }
  | {
      readonly kind: "split";
      readonly place: string;
      readonly notRecord: string;
      readonly at: number;
    }
  | { readonly kind: "dismiss"; readonly a: string; readonly b: string; readonly at: number };

const SEP = "\u0000";
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const strength = (anchor: string): number =>
  anchor.startsWith("root:") ? 0 : anchor.startsWith("remote:") ? 1 : 2;
const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const map = (doc: LoroDoc, name: keyof typeof PROJECT_MAPS): LoroMap =>
  doc.getMap(PROJECT_MAPS[name]);

function part(id: string, what: string): string {
  if (id.length === 0 || id.includes(SEP))
    throw new Error(`a project ${what} must be a non-empty id`);
  return id;
}

const pair = (a: string, b: string): string => [a, b].sort(byString).join(SEP);

/** Every id a write names, checked before anything is applied: a write
 * refused halfway would leave the rest pending for the next commit. */
function check(w: ProjectWrite): void {
  switch (w.kind) {
    case "link":
      part(w.a, "place");
      part(w.b, "place");
      return;
    case "split":
      part(w.place, "place");
      part(w.notRecord, "record");
      return;
    case "dismiss":
      part(w.a, "record");
      part(w.b, "record");
      return;
    case "anchor":
      part(w.anchor, "anchor");
      break;
    case "acted":
      part(w.place, "place");
      break;
    default:
      break;
  }
  part(w.record, "record");
}

/** Apply writes to the document, uncommitted; answers how many keys moved.
 * Throws, applying nothing, when a write names an id that cannot be a key. */
export function applyProjectWrites(doc: LoroDoc, writes: readonly ProjectWrite[]): number {
  for (const w of writes) check(w);
  let moved = 0;
  const set = (m: LoroMap, key: string, value: string | number | boolean): void => {
    if (m.get(key) === value) return;
    m.set(key, value);
    moved += 1;
  };
  const once = (m: LoroMap, key: string, value: number): void => {
    if (m.get(key) === undefined) set(m, key, value);
  };
  for (const w of writes) {
    switch (w.kind) {
      case "create":
        if (map(doc, "created").get(w.record) !== undefined) break;
        set(map(doc, "created"), w.record, w.createdAt);
        if (w.ink !== undefined) set(map(doc, "inks"), w.record, w.ink);
        break;
      case "anchor":
        once(map(doc, "anchors"), `${w.record}${SEP}${w.anchor}`, w.at);
        break;
      case "acted": {
        const acted = map(doc, "acted");
        const key = `${w.record}${SEP}${w.place}`;
        const before = acted.get(key);
        if (!isTime(before) || before < w.at) set(acted, key, w.at);
        break;
      }
      case "name":
        set(map(doc, "names"), w.record, w.name);
        break;
      case "pinned":
        set(map(doc, "pinned"), w.record, w.value);
        break;
      case "hidden":
        set(map(doc, "hidden"), w.record, w.value);
        break;
      case "recipe":
        set(map(doc, "recipes"), w.record, JSON.stringify(w.recipe));
        break;
      case "link":
        set(map(doc, "links"), pair(w.a, w.b), w.at);
        break;
      case "split":
        set(map(doc, "splits"), `${w.place}${SEP}${w.notRecord}`, w.at);
        break;
      case "dismiss":
        once(map(doc, "dismissals"), pair(w.a, w.b), w.at);
        break;
    }
  }
  return moved;
}

/** `a \0 b` → [a, b], or null for a key of another shape. */
function halves(key: string): [string, string] | null {
  const at = key.indexOf(SEP);
  if (at <= 0 || at === key.length - 1 || key.indexOf(SEP, at + 1) !== -1) return null;
  return [key.slice(0, at), key.slice(at + 1)];
}

function entries(doc: LoroDoc, name: keyof typeof PROJECT_MAPS): Array<[string, unknown]> {
  return Object.entries(map(doc, name).toJSON() as Record<string, unknown>);
}

/** Every record and intent the document holds, as the engine reads them. */
export function readProjectIntents(doc: LoroDoc): Required<GroupingIntents> {
  const created = new Map<string, number>();
  for (const [record, at] of entries(doc, "created")) if (isTime(at)) created.set(record, at);

  const anchors = new Map<string, Array<{ anchor: string; at: number }>>();
  for (const [key, at] of entries(doc, "anchors")) {
    const split = halves(key);
    if (split === null || !isTime(at) || !created.has(split[0])) continue;
    const list = anchors.get(split[0]) ?? [];
    list.push({ anchor: split[1], at });
    anchors.set(split[0], list);
  }
  const acted = new Map<string, Array<{ placeId: string; at: number }>>();
  for (const [key, at] of entries(doc, "acted")) {
    const split = halves(key);
    if (split === null || !isTime(at) || !created.has(split[0])) continue;
    const list = acted.get(split[0]) ?? [];
    list.push({ placeId: split[1], at });
    acted.set(split[0], list);
  }
  const names = map(doc, "names");
  const inks = map(doc, "inks");
  const recipes = map(doc, "recipes");
  const pinned = map(doc, "pinned");
  const hidden = map(doc, "hidden");

  const records: GroupingRecord[] = [];
  for (const [id, createdAt] of created) {
    const name = names.get(id);
    const ink = inks.get(id);
    const recipe = recipeOf(recipes.get(id));
    const pin = pinned.get(id);
    const hide = hidden.get(id);
    records.push({
      id,
      anchors: (anchors.get(id) ?? [])
        .sort(
          (a, b) =>
            a.at - b.at || strength(a.anchor) - strength(b.anchor) || byString(a.anchor, b.anchor),
        )
        .map((a) => a.anchor),
      ...(typeof name === "string" && name.length > 0 ? { name } : {}),
      ...(typeof ink === "number" && Number.isInteger(ink) && ink >= 0 ? { ink } : {}),
      ...(recipe !== undefined ? { recipe } : {}),
      ...(typeof pin === "boolean" ? { pinned: pin } : {}),
      ...(typeof hide === "boolean" ? { hidden: hide } : {}),
      places: (acted.get(id) ?? []).sort((a, b) => byString(a.placeId, b.placeId)),
      createdAt,
    });
  }
  records.sort((a, b) => a.createdAt - b.createdAt || byString(a.id, b.id));

  const links: GroupingLink[] = [];
  for (const [key, at] of entries(doc, "links")) {
    const split = halves(key);
    if (split !== null && isTime(at)) links.push({ a: split[0], b: split[1], at });
  }
  const splits: GroupingSplit[] = [];
  for (const [key, at] of entries(doc, "splits")) {
    const split = halves(key);
    if (split !== null && isTime(at)) splits.push({ place: split[0], notRecord: split[1], at });
  }
  const dismissals: Array<[string, string]> = [];
  for (const [key, at] of entries(doc, "dismissals")) {
    const split = halves(key);
    if (split !== null && isTime(at)) dismissals.push(split);
  }
  const order = (a: string, b: string) => byString(a, b);
  links.sort((x, y) => x.at - y.at || order(x.a, y.a) || order(x.b, y.b));
  splits.sort((x, y) => x.at - y.at || order(x.place, y.place) || order(x.notRecord, y.notRecord));
  dismissals.sort((x, y) => order(x[0], y[0]) || order(x[1], y[1]));
  return { records, links, splits, dismissals };
}

function recipeOf(text: unknown): unknown {
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** D5 — the writes that bring `to` every record `from` holds and it lacks
 * (idempotent by record id: a record `to` already holds is left as it is), and
 * every link, split and dismissal it lacks. */
export function projectCopyWrites(from: LoroDoc, to: LoroDoc): ProjectWrite[] {
  const source = readProjectIntents(from);
  const held = new Set(readProjectIntents(to).records.map((r) => r.id));
  const writes: ProjectWrite[] = [];
  const addedAt = new Map<string, number>();
  for (const [key, at] of entries(from, "anchors")) if (isTime(at)) addedAt.set(key, at);
  for (const r of source.records) {
    if (held.has(r.id)) continue;
    writes.push({
      kind: "create",
      record: r.id,
      createdAt: r.createdAt,
      ...(r.ink !== undefined ? { ink: r.ink } : {}),
    });
    for (const anchor of r.anchors) {
      const at = addedAt.get(`${r.id}${SEP}${anchor}`) ?? r.createdAt;
      writes.push({ kind: "anchor", record: r.id, anchor, at });
    }
    for (const place of r.places ?? [])
      writes.push({ kind: "acted", record: r.id, place: place.placeId, at: place.at });
    if (r.name !== undefined) writes.push({ kind: "name", record: r.id, name: r.name });
    if (r.recipe !== undefined) writes.push({ kind: "recipe", record: r.id, recipe: r.recipe });
    if (r.pinned !== undefined) writes.push({ kind: "pinned", record: r.id, value: r.pinned });
    if (r.hidden !== undefined) writes.push({ kind: "hidden", record: r.id, value: r.hidden });
  }
  const has = (name: keyof typeof PROJECT_MAPS, key: string) =>
    map(to, name).get(key) !== undefined;
  for (const l of source.links)
    if (!has("links", pair(l.a, l.b))) writes.push({ kind: "link", ...l });
  for (const s of source.splits)
    if (!has("splits", `${s.place}${SEP}${s.notRecord}`)) writes.push({ kind: "split", ...s });
  for (const [a, b] of source.dismissals) {
    const at = map(from, "dismissals").get(pair(a, b));
    if (!has("dismissals", pair(a, b)) && isTime(at)) writes.push({ kind: "dismiss", a, b, at });
  }
  return writes;
}
