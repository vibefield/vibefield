// From flags to a PLAN — everything the substitution pass needs, decided and
// refused BEFORE anything touches the disk. A scaffolder that writes half a
// directory and then discovers the id is illegal has already broken the promise
// its own `target-not-empty` refusal makes.
//
// Every rule here is the contract's rule, delegated rather than restated: the
// exported predicates (`isDistributablePluginId`, `isWellFormedPluginId`) and
// the exported limits (`PLUGIN_LIMITS`). The one rule this file owns is the
// reserved namespace, because it is a policy about who may scaffold what, not a
// property of the manifest schema.
//
// Nothing downstream re-validates the author's strings, and it does not have to:
// the manifest that lands is EMITTED from the scaffolded `src/manifest.ts`
// through `emitManifest`, which is `validatePluginManifest` with a writer
// attached. If that ever refuses a plan this file accepted, the template is
// wrong — which is exit 2's exact meaning, and not a lie about whose fault it is.

import { isDistributablePluginId, isWellFormedPluginId, PLUGIN_LIMITS } from "@vibefield/contracts";
import { refuse, type Verdict } from "./verdict";

/** The namespace reserved for plugins this repository ships (§6.2). */
export const FIRST_PARTY_NAMESPACE = "vibefield";

export interface PlanInput {
  readonly id: string;
  readonly title: string;
  readonly widgetType?: string | undefined;
  /** allow the reserved `vibefield.*` namespace */
  readonly firstParty?: boolean | undefined;
}

/** The substitution vocabulary — the whole of it. Every `{{token}}` in
 * `template/` is a key of this object, and `template.ts` refuses one that is
 * not. */
export interface Plan {
  readonly id: string;
  readonly title: string;
  readonly widgetType: string;
  /** the workspace package name, derived: `vendor.demo` → `@vendor/plugin-demo` */
  readonly packageName: string;
  /** the component identifier, derived from the title: `Demo Board` → `DemoBoard` */
  readonly className: string;
}

export type PlanResult = { ok: true; plan: Plan } | { ok: false; verdicts: Verdict[] };

export function planScaffold(input: PlanInput): PlanResult {
  const id = input.id.trim();
  const title = input.title.trim();

  if (!isDistributablePluginId(id)) {
    return no(
      refuse("id", "id-invalid", `${JSON.stringify(id)} is not a distributable plugin id`, {
        pointer: "--id",
      }),
    );
  }

  if (id.split(".")[0] === FIRST_PARTY_NAMESPACE && input.firstParty !== true) {
    return no(
      refuse("id", "id-reserved", `${id} is in the reserved ${FIRST_PARTY_NAMESPACE}.* namespace`, {
        pointer: "--id",
      }),
    );
  }

  if (title.length === 0 || title.length > PLUGIN_LIMITS.TITLE_MAX) {
    return no(
      refuse(
        "id",
        "title-invalid",
        title.length === 0
          ? "the title is empty"
          : `the title is ${title.length} characters, over the ${PLUGIN_LIMITS.TITLE_MAX}-character limit`,
        { pointer: "--title" },
      ),
    );
  }

  const widgetType = (input.widgetType ?? id).trim();
  if (!ownsName(id, widgetType)) {
    return no(
      refuse(
        "id",
        "widget-type-invalid",
        `widget type ${JSON.stringify(widgetType)} must be ${id} or ${id}.<name>`,
        { pointer: "--widget-type" },
      ),
    );
  }

  return {
    ok: true,
    plan: {
      id,
      title,
      widgetType,
      packageName: packageNameFor(id),
      className: classNameFor(title, id),
    },
  };
}

/**
 * §6.2 ownership: a contributed name is the plugin id itself, or the id plus
 * exactly ONE more segment. Not two — `vendor.demo.a.b` is refused, and finding
 * that out from the contract rather than assuming it is why this predicate is
 * written against `isOwnedName`'s three lines (contracts/src/plugins.ts) instead
 * of against the sentence they implement.
 *
 * The segment grammar itself stays delegated: `isWellFormedPluginId` is that
 * grammar applied to a dotted name, so a suffix that is well-formed AND carries
 * no dot is exactly one legal segment.
 */
export function ownsName(id: string, name: string): boolean {
  if (name === id) return true;
  if (!name.startsWith(`${id}.`)) return false;
  const suffix = name.slice(id.length + 1);
  return !suffix.includes(".") && isWellFormedPluginId(suffix);
}

/** `vendor.demo` → `@vendor/plugin-demo`; `vibefield.note` → `@vibefield/plugin-note`,
 * which is the name the canonical plugin actually carries. */
export function packageNameFor(id: string): string {
  const [scope, ...rest] = id.split(".");
  return `@${scope}/plugin-${rest.join("-")}`;
}

/** `Demo Board` → `DemoBoard`. Falls back to the id's last segment when the
 * title carries nothing an identifier can be made of — a non-ASCII title is a
 * perfectly good title and must not fail the scaffold. */
export function classNameFor(title: string, id: string): string {
  const fromTitle = pascalCase(title);
  if (fromTitle.length > 0) return fromTitle;
  const fromId = pascalCase((id.split(".").at(-1) ?? id).replaceAll("-", " "));
  return fromId.length > 0 ? fromId : "Widget";
}

/** ASCII-only by construction: the result is spliced into source as an
 * identifier, so anything outside `[A-Za-z0-9]` is dropped rather than trusted. */
function pascalCase(text: string): string {
  const words = text.split(/[^A-Za-z0-9]+/).filter((w) => w.length > 0);
  const joined = words.map((w) => (w[0] ?? "").toUpperCase() + w.slice(1)).join("");
  // An identifier may not start with a digit, and stripping the digit would
  // silently rename the component — prefixing keeps every character visible.
  return /^[0-9]/.test(joined) ? `W${joined}` : joined;
}

function no(verdict: Verdict): PlanResult {
  return { ok: false, verdicts: [verdict] };
}
