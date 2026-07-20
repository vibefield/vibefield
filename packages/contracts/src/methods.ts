import { SCOPES, type Scope } from "./registries";

// Method registry (design-01 §3 + D36): every method declares surface, scope,
// idempotency, and its LOCALITY CLASS. The registry lint (test/registry.test.ts)
// rejects unclassified methods — an unregistered method doesn't ship.

export const SURFACES = ["product", "mgmt", "mcp", "push"] as const;
export type Surface = (typeof SURFACES)[number];

/** D36 locality classes. */
export const LOCALITIES = [
  "local",
  "sync",
  "replicate",
  "stream",
  "federate",
  "native-plane",
] as const;
export type Locality = (typeof LOCALITIES)[number];

export interface MethodDef {
  surface: Surface;
  /** dotted method name, e.g. "system.hello" */
  method: string;
  /** required scope, or null = any authenticated principal */
  scope: Scope | null;
  idempotent: boolean;
  locality: Locality;
  subscription?: boolean;
}

export function defineMethod(def: MethodDef): MethodDef {
  if (!def.method.includes(".")) throw new Error(`method missing namespace: ${def.method}`);
  if (def.scope !== null && !(SCOPES as readonly string[]).includes(def.scope))
    throw new Error(`unknown scope on ${def.method}: ${def.scope}`);
  if (!(LOCALITIES as readonly string[]).includes(def.locality))
    throw new Error(`unknown locality on ${def.method}: ${def.locality}`);
  return def;
}

/** Seed entries — the catalog grows with M2 (mgmt channel) and M3 (product core). */
export const METHODS: MethodDef[] = [
  defineMethod({ surface: "product", method: "system.hello", scope: null, idempotent: true, locality: "local" }),
  defineMethod({ surface: "product", method: "system.health", scope: null, idempotent: true, locality: "local" }),
  defineMethod({ surface: "product", method: "system.capabilities", scope: null, idempotent: true, locality: "local" }),
];
