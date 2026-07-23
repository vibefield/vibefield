// Canonical JSON — deterministic, key-sorted, byte-stable serialization
// (plugin-architecture spec §5.4 item 1). The manifest's `manifestHash`
// (§6.3/§9.2) and the `.vfplugin` artifact's sha256 (§5.3.1) both derive
// from THIS exact byte sequence: the same bytes, on any machine, for any
// two inputs that mean the same thing. Object keys are sorted recursively;
// array order is author-meaningful (prop groups, ports, activation lists)
// and is preserved untouched.
//
// Silent coercion is the enemy of a hash. `undefined`, functions, symbols,
// bigints, non-finite numbers, and non-plain objects have no canonical
// JSON form, so they are rejected with a pathed error rather than dropped
// or stringified into something misleading — degrade loudly here, never
// quietly (the tolerant-reader law runs the other way for wire traffic;
// a hash source gets no such mercy).

export class CanonicalJsonError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} (at ${path})`);
    this.name = "CanonicalJsonError";
  }
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function describeInstance(value: object): string {
  const name = value.constructor?.name;
  return name && name !== "Object" ? name : "object";
}

function canonicalize(value: unknown, seen: Set<object>, path: string): JsonValue {
  if (value === null) return null;
  if (value === undefined)
    throw new CanonicalJsonError("undefined has no canonical JSON form", path);

  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number":
      if (!Number.isFinite(value))
        throw new CanonicalJsonError(`${value} has no canonical JSON form`, path);
      return value;
    case "function":
      throw new CanonicalJsonError("functions have no canonical JSON form", path);
    case "symbol":
      throw new CanonicalJsonError("symbols have no canonical JSON form", path);
    case "bigint":
      throw new CanonicalJsonError("bigint has no canonical JSON form", path);
  }

  // only object|array can reach here — null/undefined/primitives all
  // returned or threw above.
  const obj = value as object;
  if (seen.has(obj)) throw new CanonicalJsonError("cyclic reference", path);
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      return obj.map((item, i) => canonicalize(item, seen, `${path}[${i}]`));
    }
    if (!isPlainObject(obj))
      throw new CanonicalJsonError(
        `${describeInstance(obj)} instance is not JSON-shaped data`,
        path,
      );

    const record = obj as Record<string, unknown>;
    const sorted: Record<string, JsonValue> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalize(record[key], seen, `${path}.${key}`);
    }
    return sorted;
  } finally {
    seen.delete(obj);
  }
}

/**
 * Serialize `value` as canonical JSON: object keys sorted recursively,
 * array element order preserved, 2-space indent, one trailing newline.
 *
 * Throws {@link CanonicalJsonError} on `undefined`, functions, symbols,
 * bigints, non-finite numbers, non-plain objects (class instances —
 * `Date`, `Map`, `Set`, …), and cyclic references. Every one of those is
 * either silently lossy or infinite under plain `JSON.stringify`; a
 * manifest hash built on a silent loss is worse than a build failure.
 */
export function canonicalJson(value: unknown): string {
  const canonical = canonicalize(value, new Set(), "<root>");
  return `${JSON.stringify(canonical, null, 2)}\n`;
}
