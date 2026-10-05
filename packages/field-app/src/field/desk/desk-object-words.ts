import type { PluginRegistrySnapshot } from "@vibefield/contracts";

// THE BAR'S WORDS FOR AN OBJECT (DK-9; DK-D18 as amended — "ICE's MISSING FACE is the one face, and
// VibeField's selection bar prints the type's name"): what the bar says of an object, above all of one the
// desk draws as missing — its type's title and why it wears that face: its plugin is OFF (disabled; the
// desk was remounted without its kind), NOT INSTALLED (a type no plugin here declares — a board from
// another desktop, its ghost stub), or its kind FAULTED (refused at create or quarantined — ICE I24). The
// bar itself is DK-11's; until it draws, the desk door reads these words (`__vfDesk.words`).

export type ObjectWordState = "plugin off" | "not installed" | "faulted";

export interface ObjectWords {
  readonly type: string;
  /** The object row's title, its plugin's (the type when no plugin here declares it). */
  readonly title: string;
  /** Why it wears the missing face; null when its kind draws it. */
  readonly state: ObjectWordState | null;
  /** What the bar prints: "Clock · plugin off". */
  readonly label: string;
}

export function objectWords(
  type: string,
  facts: {
    readonly snapshot: PluginRegistrySnapshot | null;
    /** the types whose kinds the desk was mounted WITHOUT (window-kinds.ts) */
    readonly off: ReadonlySet<string>;
    /** the kinds the desk names in `status().faults` */
    readonly faults: readonly string[];
    /** the engine catalog has a kind for it (a type with no kind is a ghost stub's) */
    readonly kinded: boolean;
    /** the desk's own titles, by type (its six) */
    readonly builtIn?: Readonly<Record<string, string>>;
  },
): ObjectWords {
  const owner = facts.snapshot?.plugins.find((record) =>
    (record.contributions.objects ?? []).some((row) => row.type === type),
  );
  const row = owner?.contributions.objects?.find((candidate) => candidate.type === type);
  const title = row?.title ?? facts.builtIn?.[type] ?? type;
  const state: ObjectWordState | null =
    facts.off.has(type) || owner?.enabled === false
      ? "plugin off"
      : facts.faults.includes(type)
        ? "faulted"
        : !facts.kinded && owner === undefined && facts.builtIn?.[type] === undefined
          ? "not installed"
          : null;
  return { type, title, state, label: state === null ? title : `${title} · ${state}` };
}
