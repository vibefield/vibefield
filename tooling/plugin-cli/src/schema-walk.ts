// Reading the contribution schemas the way a reader needs them: field, type,
// required, constraints. The zod objects in `@vibefield/contracts` are the
// source — §5.4 item 7's "generated from the zod contribution schemas" means
// generated FROM them, not transcribed beside them.
//
// Two techniques, both of which keep the generator honest:
//
//  - STRUCTURE comes from `_def`. zod's internal shape is stable within a pinned
//    major, and the pin is the workspace's (`zod: ^3.24.0`, resolved 3.25.x).
//    An unrecognised node renders as its typeName rather than silently as
//    "unknown", so a schema kind this walker has never seen is VISIBLE in the
//    output instead of quietly missing from it.
//  - REFINEMENT RULES come from running the schema. `.refine(fn, "message")`
//    keeps its message inside a closure, so the only way to state the rule
//    accurately is to make the schema state it: parse a deliberately invalid
//    probe and quote the issue. A rule that changes wording changes the docs.

import type { z } from "zod";

export interface FieldDoc {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly constraints: string[];
}

interface Described {
  readonly type: string;
  readonly constraints: string[];
  readonly optional: boolean;
}

interface ZodDefLike {
  typeName?: string;
  checks?: Array<Record<string, unknown>>;
  innerType?: unknown;
  schema?: unknown;
  type?: unknown;
  shape?: () => Record<string, unknown>;
  values?: readonly string[];
  value?: unknown;
  keyType?: unknown;
  valueType?: unknown;
  options?: readonly unknown[];
  minLength?: { value: number } | null;
  maxLength?: { value: number } | null;
  defaultValue?: () => unknown;
  discriminator?: string;
  getter?: () => unknown;
}

function defOf(schema: unknown): ZodDefLike {
  return (schema as { _def?: ZodDefLike })._def ?? {};
}

/** A `never().optional()` field is a parser tombstone, not author vocabulary.
 * Keep it in the contract for a stable refusal, but omit it from generated
 * shape tables so the reference never teaches a retired contribution. */
function isNeverField(schema: unknown): boolean {
  let current = schema;
  for (let depth = 0; depth < 8; depth++) {
    const def = defOf(current);
    if (def.typeName === "ZodNever") return true;
    if (def.typeName === "ZodOptional" || def.typeName === "ZodDefault") {
      current = def.innerType;
      continue;
    }
    if (def.typeName === "ZodEffects") {
      current = def.schema;
      continue;
    }
    return false;
  }
  return false;
}

export function typeNameOf(schema: unknown): string {
  return defOf(schema).typeName ?? "unknown";
}

/** The first `custom` issue a deliberately invalid probe produces — i.e. what
 * the refinement itself says it wants. Undefined when the schema accepts the
 * probe (nothing to quote) or has no refinement. */
export function refinementRule(schema: unknown): string | undefined {
  const probes: unknown[] = ["\u0000 not a valid value \u0000", -1, {}, []];
  for (const probe of probes) {
    const result = (schema as z.ZodTypeAny).safeParse(probe);
    if (result.success) continue;
    const custom = result.error.issues.find((i) => i.code === "custom");
    if (custom !== undefined) return custom.message;
  }
  return undefined;
}

function stringConstraints(def: ZodDefLike): string[] {
  const out: string[] = [];
  for (const check of def.checks ?? []) {
    const kind = check["kind"];
    const n = Number(check["value"]);
    const unit = n === 1 ? "character" : "characters";
    if (kind === "max") out.push(`at most ${String(check["value"])} ${unit}`);
    else if (kind === "min") out.push(`at least ${String(check["value"])} ${unit}`);
    else if (kind === "regex") out.push(`matches \`${String(check["regex"])}\``);
    else if (kind === "url") out.push("a url");
    else if (typeof kind === "string") out.push(kind);
  }
  return out;
}

function numberConstraints(def: ZodDefLike): string[] {
  const out: string[] = [];
  for (const check of def.checks ?? []) {
    const kind = check["kind"];
    if (kind === "int") out.push("integer");
    else if (kind === "min")
      out.push(`${check["inclusive"] === true ? "≥" : ">"} ${String(check["value"])}`);
    else if (kind === "max")
      out.push(`${check["inclusive"] === true ? "≤" : "<"} ${String(check["value"])}`);
    else if (typeof kind === "string") out.push(kind);
  }
  return out;
}

/**
 * Render one schema node: its type expression, its constraints, and whether a
 * field carrying it may be omitted.
 *
 * `depth` controls how far a nested object is spelled out. One level is the
 * useful amount: `defaultSize` reading as `object` tells an author nothing,
 * while `{ w: number, h: number }` tells them everything they needed. Deeper
 * than that and a table cell stops being a table cell.
 */
export function describe(schema: unknown, depth = 0): Described {
  const def = defOf(schema);
  switch (def.typeName) {
    case "ZodString":
      return { type: "string", constraints: stringConstraints(def), optional: false };
    case "ZodNumber":
      return { type: "number", constraints: numberConstraints(def), optional: false };
    case "ZodBoolean":
      return { type: "boolean", constraints: [], optional: false };
    case "ZodUnknown":
    case "ZodAny":
      return { type: "any JSON value", constraints: [], optional: false };
    case "ZodLiteral":
      return { type: `\`${JSON.stringify(def.value)}\``, constraints: [], optional: false };
    case "ZodEnum":
      return {
        type: (def.values ?? []).map((v) => `\`${v}\``).join(" \\| "),
        constraints: [],
        optional: false,
      };
    case "ZodArray": {
      const inner = describe(def.type, depth);
      // The element's rules belong to the element, and saying so is the
      // difference between "at most 64 characters" reading as a length limit on
      // the ARRAY and reading as what it is.
      const constraints = inner.constraints.map((c) => `each item: ${c}`);
      if (def.minLength != null) constraints.push(`at least ${def.minLength.value} item(s)`);
      if (def.maxLength != null) constraints.push(`at most ${def.maxLength.value} item(s)`);
      return { type: `${inner.type}[]`, constraints, optional: false };
    }
    case "ZodRecord": {
      const value = describe(def.valueType, depth);
      return {
        type: `object mapping name → ${value.type}`,
        constraints: value.constraints,
        optional: false,
      };
    }
    case "ZodObject": {
      const shape = def.shape?.() ?? {};
      const keys = Object.keys(shape).filter((key) => !isNeverField(shape[key]));
      // Nine is where the widget `interaction` flags fit (keyboard/keyboardEscape
      // joined 2026-08-13, S2) — the one nested shape an author configures by
      // hand, and the one worth the width. The docs-anchors test pins the inline
      // rendering, so outgrowing this number reds a suite instead of silently
      // collapsing the vocabulary to "object".
      if (depth > 0 || keys.length === 0 || keys.length > 9)
        return { type: "object", constraints: [], optional: false };
      const fields = keys.map((key) => {
        const described = describe(shape[key], depth + 1);
        return `${key}${described.optional ? "?" : ""}: ${described.type}`;
      });
      return { type: `{ ${fields.join(", ")} }`, constraints: [], optional: false };
    }
    case "ZodOptional": {
      const inner = describe(def.innerType, depth);
      return { ...inner, optional: true };
    }
    case "ZodNullable": {
      const inner = describe(def.innerType, depth);
      return { ...inner, type: `${inner.type} \\| null` };
    }
    case "ZodDefault": {
      const inner = describe(def.innerType, depth);
      const value = def.defaultValue?.();
      return {
        ...inner,
        optional: true,
        constraints: [...inner.constraints, `defaults to \`${JSON.stringify(value)}\``],
      };
    }
    case "ZodEffects": {
      const inner = describe(def.schema, depth);
      const rule = refinementRule(schema);
      return {
        ...inner,
        constraints: [...inner.constraints, ...(rule === undefined ? [] : [rule])],
      };
    }
    case "ZodLazy":
      return { type: "recursive shape", constraints: [], optional: false };
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const variants = [...(def.options ?? [])].map((option) => {
        const shape = shapeOf(option);
        const discriminator = def.discriminator;
        if (shape !== undefined && discriminator !== undefined) {
          const tag = shape[discriminator];
          const tagDef = defOf(tag);
          if (tagDef.typeName === "ZodLiteral") return `\`${String(tagDef.value)}\``;
        }
        return describe(option, depth).type;
      });
      return {
        type: `one of ${variants.join(", ")}`,
        constraints:
          def.discriminator === undefined ? [] : [`discriminated by \`${def.discriminator}\``],
        optional: false,
      };
    }
    default:
      return { type: def.typeName ?? "unknown", constraints: [], optional: false };
  }
}

/** The object shape behind a schema, unwrapping the wrappers that do not change
 * it (optional/default/effects/lazy). Undefined when the node is not an object. */
export function shapeOf(schema: unknown): Record<string, unknown> | undefined {
  let current: unknown = schema;
  for (let depth = 0; depth < 8; depth++) {
    const def = defOf(current);
    if (def.typeName === "ZodObject") return def.shape?.() ?? undefined;
    if (def.typeName === "ZodOptional" || def.typeName === "ZodDefault") {
      current = def.innerType;
      continue;
    }
    if (def.typeName === "ZodEffects") {
      current = def.schema;
      continue;
    }
    if (def.typeName === "ZodLazy") {
      current = def.getter?.();
      continue;
    }
    return undefined;
  }
  return undefined;
}

/** One row per field of an object schema, in declaration order (the order the
 * schema author chose, which reads better than alphabetical). */
export function fieldsOf(schema: unknown): FieldDoc[] {
  const shape = shapeOf(schema);
  if (shape === undefined) return [];
  return Object.entries(shape)
    .filter(([, field]) => !isNeverField(field))
    .map(([name, field]) => {
      const described = describe(field);
      return {
        name,
        type: described.type,
        required: !described.optional,
        constraints: described.constraints,
      };
    });
}

/** The variants of a discriminated union, each with its own field rows — how
 * PropSpec and ServiceMethodContribution actually read. */
export function variantsOf(
  schema: unknown,
): Array<{ discriminant: string; fields: FieldDoc[] }> | undefined {
  const def = defOf(schema);
  if (def.typeName !== "ZodDiscriminatedUnion" || def.discriminator === undefined) return undefined;
  const discriminator = def.discriminator;
  const out: Array<{ discriminant: string; fields: FieldDoc[] }> = [];
  for (const option of def.options ?? []) {
    const shape = shapeOf(option);
    if (shape === undefined) continue;
    const tagDef = defOf(shape[discriminator]);
    out.push({
      discriminant: String(tagDef.value ?? "?"),
      fields: fieldsOf(option).filter((f) => f.name !== discriminator),
    });
  }
  return out;
}
