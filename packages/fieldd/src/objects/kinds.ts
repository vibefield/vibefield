import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type DeskKind as BuiltInKind,
  DESK_KINDS,
  OBJECT_LIMITS,
  type ObjectConcurrency,
  type ObjectContribution,
  type PluginRecord,
} from "@vibefield/contracts";

// OB-3b — the one seam the desk room reads a kind through (OB-L2: one declaration per kind): the built-ins' durable
// halves in `contracts/src/desk-kinds.ts`, and each enabled plugin's kinds with their manifest's `agent` block. A kind
// with no agent half can still be placed and named; it gives an agent no tools.

export interface DeskKindTool {
  readonly name: string;
  readonly readOnly: boolean;
  readonly destructive?: boolean | undefined;
  readonly description: string;
  /** JSON Schema, the kind's declaration unchanged */
  readonly input: Readonly<Record<string, unknown>>;
}

export interface DeskKind {
  readonly kind: string;
  readonly title: string;
  readonly summary?: string;
  /** false: an agent cannot make one, only be handed it */
  readonly placeable: boolean;
  readonly concurrency: ObjectConcurrency;
  readonly tools: readonly DeskKindTool[];
  readonly guide?: string;
  /** whose words the guide is, for a plugin's kind (MT-L6) */
  readonly guideFrom?: string | undefined;
  readonly version: number;
}

/** At most `max` bytes of `text`, ending on a whole character. */
export const cutBytes = (text: string, max: number): string =>
  Buffer.from(text, "utf8")
    .subarray(0, Math.max(0, max))
    .toString("utf8")
    .replace(/\uFFFD+$/, "");

const builtIn = (kind: BuiltInKind): DeskKind => ({
  kind: kind.type,
  title: kind.title,
  summary: kind.agent.summary,
  placeable: kind.placeable,
  concurrency: kind.agent.concurrency,
  tools: kind.agent.tools,
  ...(kind.agent.guide !== undefined ? { guide: kind.agent.guide } : {}),
  version: kind.version,
});

const BUILT_INS: readonly DeskKind[] = DESK_KINDS.map(builtIn);

const readGuide = (root: string | undefined, guide: string | undefined): string | undefined => {
  if (root === undefined || guide === undefined) return undefined;
  try {
    return cutBytes(readFileSync(join(root, guide), "utf8"), OBJECT_LIMITS.GUIDE_BYTES);
  } catch {
    // a guide its plugin no longer ships: the manual goes without it
    return undefined;
  }
};

const fromPlugin = (
  object: ObjectContribution,
  root: string | undefined,
  plugin: string,
): DeskKind => {
  const guide = readGuide(root, object.agent?.guide);
  return {
    kind: object.type,
    title: object.title,
    // no agent half, no declaration of what an agent would be placing: only the person's hand makes one
    placeable: object.agent !== undefined,
    concurrency: object.agent?.concurrency ?? "many",
    tools: object.agent?.tools ?? [],
    ...(object.agent !== undefined ? { summary: object.agent.summary } : {}),
    ...(guide !== undefined ? { guide, guideFrom: plugin } : {}),
    version: object.schemaVersion,
  };
};

/** Each enabled plugin's object kinds, read once per registry change: fieldd holds the list and hands it to `deskKinds`. */
export const pluginDeskKinds = (
  records: readonly PluginRecord[],
  rootPath: (id: string) => string | undefined,
): readonly DeskKind[] =>
  records.flatMap((record) =>
    record.enabled
      ? record.contributions.objects.map((object) =>
          fromPlugin(object, rootPath(record.id), record.title),
        )
      : [],
  );

/** Every kind an agent can place or be handed. The one seam: nothing else reads a kind's declaration. */
export const deskKinds = (plugins: readonly DeskKind[] = []): readonly DeskKind[] => [
  ...BUILT_INS,
  ...plugins,
];
