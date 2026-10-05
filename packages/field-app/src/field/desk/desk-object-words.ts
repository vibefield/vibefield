import type { PluginRegistrySnapshot } from "@vibefield/contracts";

// THE BAR'S WORDS FOR AN OBJECT (DK-9, DK-11; DK-D18 as amended — "ICE's MISSING FACE is the one face, and
// VibeField's selection bar prints the type's name"; DESIGN.md §8 "The missing face", R11, R12, R24): what the
// chrome says of an object, above all of one the desk draws as missing — its type's human name (the manifest's
// title, a built-in's tray label, else the type id) and WHY it wears that face, in one of five words:
//
//   "plugin off"          — its plugin is disabled (the desk was remounted without its kind);
//   "plugin gone"         — its plugin was uninstalled (a staged plugin whose record left the registry);
//   "no kind"             — a type this build never registered (a ghost stub's faceless type — a board from
//                           another desktop);
//   "remount to draw it"  — its plugin is on, but the desk was mounted without its kind (ICE I25: the kind set
//                           is fixed for a layer's life — a plugin turned on again, or new to this engine, draws
//                           at the next mount);
//   "can't draw"          — its kind FAULTED: refused at create or quarantined (ICE I24, `status().faults`).
//
// The bar prints the label where the kind's acts would stand ("Clock · plugin off"), the grown menu's eyebrow
// says it in capitals, the status line says it once (desk-notices.ts) — each reads THESE words, never the
// desk's raw fault (the plan's Phase 3 addendum (23)).

export type ObjectWordState =
  | "plugin off"
  | "plugin gone"
  | "no kind"
  | "remount to draw it"
  | "can't draw";

export interface ObjectWords {
  readonly type: string;
  /** The type's human name: its plugin's object row title, a built-in's tray label, else the type id. */
  readonly title: string;
  /** Why the desk draws it as missing; null when its kind draws it. */
  readonly state: ObjectWordState | null;
  /** What the bar prints: "Clock · plugin off" (the title alone when the kind draws it). */
  readonly label: string;
}

/** What the words are read from: the registry, and the desk as it was mounted. */
export interface ObjectWordFacts {
  readonly snapshot: PluginRegistrySnapshot | null;
  /** the types whose kinds the desk was MOUNTED without (window-kinds.ts — the layer's, read at its mount) */
  readonly off: ReadonlySet<string>;
  /** the kinds the desk names in `status().faults` */
  readonly faults: readonly string[];
  /** the engine catalog has a kind for it (a type with no kind is a ghost stub's) */
  readonly kinded: boolean;
  /** the desk's own titles, by type (its six) */
  readonly builtIn?: Readonly<Record<string, string>>;
}

export function objectWords(type: string, facts: ObjectWordFacts): ObjectWords {
  const owner = facts.snapshot?.plugins.find((record) =>
    (record.contributions.objects ?? []).some((row) => row.type === type),
  );
  const row = owner?.contributions.objects?.find((candidate) => candidate.type === type);
  const title = row?.title ?? facts.builtIn?.[type] ?? type;
  const state = stateOf(type, facts, owner?.enabled);
  return { type, title, state, label: state === null ? title : `${title} · ${state}` };
}

function stateOf(
  type: string,
  facts: ObjectWordFacts,
  /** its plugin's `enabled`, or undefined when no plugin here declares the type */
  enabled: boolean | undefined,
): ObjectWordState | null {
  if (facts.faults.includes(type)) return "can't draw";
  if (enabled === false) return "plugin off";
  if (facts.off.has(type)) {
    // mounted without its kind, its plugin not disabled: with no registry to read (the daemon away) it is off,
    // as the desk was told; a record gone from the registry was uninstalled; one that is on waits for a mount
    if (facts.snapshot === null) return "plugin off";
    return enabled === undefined ? "plugin gone" : "remount to draw it";
  }
  if (!facts.kinded) {
    if (enabled === true) return "remount to draw it";
    if (facts.builtIn?.[type] === undefined) return "no kind";
  }
  return null;
}

/** The grown menu's eyebrow for one type (DESIGN.md §8 "The bar grown"): its name, and a missing face's word —
 * in the mat's print, capitals: "NOTE", "CLOCK · PLUGIN OFF". */
export const eyebrowOf = (words: ObjectWords): string => words.label.toUpperCase();
