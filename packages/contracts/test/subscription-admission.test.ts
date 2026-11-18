import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentsExtensionsSubscribeParams } from "../src/agent-extensions";
import { AgentSubscribeParams } from "../src/agent-field";
import {
  IndexAppsSubscribeParams,
  IndexCatalogSubscribeParams,
  IndexChangesSubscribeParams,
} from "../src/agent-index";
import { ComposeSparksCrewsSubscribeParams } from "../src/compose";
import { METHODS, type SubscriptionFrames } from "../src/methods";
import { ObjectsIntentsSubscribeParams } from "../src/objects";
import { PluginRuntimeDiagnosticsSubscribeParams } from "../src/plugin-diagnostics";
import { SettingsSubscribeParams } from "../src/plugin-registry";
import { PluginUpdateSubscribeParams } from "../src/plugin-update";
import { AGENT_FIELD } from "../src/registries";
import {
  PLUGIN_PROVIDED_SUBSCRIPTION,
  resolveSubscriptionAdmission,
  SUBSCRIPTION_ADMISSION,
  type SubscriptionAdmission,
  type SubscriptionCaller,
  subscriptionKey,
} from "../src/subscription-admission";
import { WorkspaceSubscribeParams } from "../src/workspace";

// Item 476 (2026-11-16) — the product door admits a subscription by its KEY, and every product
// subscription row declares its key, class and holders in `subscription-admission.ts`
// (docs/DECISIONS.md, item 476). These rows hold the table to METHODS both ways, each class to its shape,
// the key to one canonical form, and re-derive the plan's figures from the table: 35 closed
// keys, 308 holders at most on one connection, 20 boards at the 16 ms tick. The value set of
// every `variants` field is READ from its params schema (the enums' options, the workspace
// literal), never restated here or in the table. Two facts the contracts cannot see are written
// by hand below, each with its source.

/** The census's other side: every product row of METHODS that is a subscription. */
const PRODUCT_SUBSCRIPTIONS = METHODS.filter(
  (m) => m.surface === "product" && m.subscription !== undefined,
).map((m) => m.method);

/** The params schema each `variants` and `things` row's handler parses its ask with (fieldd
 * `daemon.ts`, `plugin-update-transport.ts`, `plugin-runtime-diagnostics.ts`,
 * `workspace/doors.ts`). The identity fields are read from these, and so are their values. */
const PARAMS: Readonly<Record<string, z.AnyZodObject>> = {
  "agent.subscribe": AgentSubscribeParams,
  "index.catalog.subscribe": IndexCatalogSubscribeParams,
  "index.changes.subscribe": IndexChangesSubscribeParams,
  "index.apps.subscribe": IndexAppsSubscribeParams,
  "workspace.subscribe": WorkspaceSubscribeParams,
  "plugins.update.subscribe": PluginUpdateSubscribeParams,
  "plugins.runtime.subscribe": PluginRuntimeDiagnosticsSubscribeParams,
  "storage.settings.subscribe": SettingsSubscribeParams,
  "agents.extensions.subscribe": AgentsExtensionsSubscribeParams,
  "compose.sparks.crews.subscribe": ComposeSparksCrewsSubscribeParams,
  "objects.intents.subscribe": ObjectsIntentsSubscribeParams,
};

interface RefusedAsk {
  readonly method: string;
  readonly params: Readonly<Record<string, string>>;
}

/** HAND-MADE FACT 1, the figures' one refused combination: the schema admits `{projection:
 * "full", scope: "mesh"}`, and the handler refuses it (PRECONDITION_FAILED, "the mesh board is a
 * board projection (field, model or remote); full is local to its device"): fieldd
 * `agent-field.ts` `refuseBoardAsk`, its `projection === "full"` arm, called by the board's
 * handler at fieldd `daemon.ts:5191`. So that pair is no key a connection can hold. */
const REFUSED_ASKS: readonly RefusedAsk[] = [
  { method: "agent.subscribe", params: { projection: "full", scope: "mesh" } },
];

/** HAND-MADE FACT 2: `flows.subscribe` has a catalog row and no handler in fieldd (item 479;
 * the door answers NOT_FOUND, so 20 `one` keys can be held). Its row is declared and
 * counted in the census; its key is no key a connection can hold, so the figures leave it out.
 * When item 479 lands a handler, this set loses it and the closed keys become 36. */
const HANDLERLESS: ReadonlySet<string> = new Set(["flows.subscribe"]);

const resolve = resolveSubscriptionAdmission;

function rowOf(method: string): SubscriptionAdmission {
  const row = SUBSCRIPTION_ADMISSION[method];
  if (row === undefined) throw new Error(`${method} declares no admission`);
  return row;
}

function key(method: string, params: unknown, caller: SubscriptionCaller = {}): string {
  return subscriptionKey(method, params, rowOf(method), caller);
}

/** The canonical form, spelled once: the method, then each identity field and its value. */
function canonical(method: string, ...fields: Array<[string, string | null]>): string {
  return JSON.stringify([method, fields]);
}

/** A field's values as its schema states them: an enum's options or a literal's value, or
 * `null` for an open field (a string naming a thing); `optional` when the ask may omit it. */
function valueSetOf(
  method: string,
  field: string,
): { readonly values: readonly string[] | null; readonly optional: boolean } {
  const schema = PARAMS[method];
  if (schema === undefined) throw new Error(`${method} names no params schema in this test`);
  let node: unknown = schema.shape[field];
  if (node === undefined) throw new Error(`${method}: ${field} is no param of its schema`);
  let optional = false;
  if (node instanceof z.ZodOptional) {
    optional = true;
    node = node.unwrap();
  }
  if (node instanceof z.ZodEnum) {
    const options: readonly unknown[] = node.options;
    return { values: options.filter((o): o is string => typeof o === "string"), optional };
  }
  if (node instanceof z.ZodLiteral) {
    const value: unknown = node.value;
    return { values: typeof value === "string" ? [value] : [], optional };
  }
  return { values: null, optional };
}

function refused(method: string, params: Readonly<Record<string, string>>): boolean {
  return REFUSED_ASKS.some(
    (ask) =>
      ask.method === method &&
      Object.entries(ask.params).every(([field, value]) => params[field] === value),
  );
}

/** Every ask of a row whose key is CLOSED (no thing of a person's in it): each field takes its
 * schema's values, and an optional field with no default is also absent, its own key. A field
 * that names a thing contributes no closed value, so a `things` row has closed keys only where
 * its ask may name nothing. A `bounded` row is bounded by its method, never by keys. */
function closedAsks(method: string, row: SubscriptionAdmission): Array<Record<string, string>> {
  if (row.class === "bounded") return [];
  let asks: Array<Record<string, string>> = [{}];
  for (const [field, spec] of Object.entries(row.identity)) {
    const { values, optional } = valueSetOf(method, field);
    const closed: Array<string | undefined> = [...(values ?? [])];
    if (optional && spec.default === undefined && spec.defaultFromPrincipal === undefined)
      closed.push(undefined);
    asks = asks.flatMap((ask) =>
      closed.map((value) => (value === undefined ? ask : { ...ask, [field]: value })),
    );
  }
  return asks.filter((params) => !refused(method, params));
}

interface ClosedKey {
  readonly method: string;
  readonly params: Readonly<Record<string, string>>;
  readonly limit: number;
  readonly class: string;
}

/** The closed keys one connection can hold, resolved through the door's own function. */
function closedKeys(): ClosedKey[] {
  const keys = new Map<string, ClosedKey>();
  for (const method of PRODUCT_SUBSCRIPTIONS) {
    if (HANDLERLESS.has(method)) continue;
    for (const params of closedAsks(method, rowOf(method))) {
      const resolved = resolve(method, params, {});
      expect(keys.has(resolved.key), `${method} ${JSON.stringify(params)} folds`).toBe(false);
      keys.set(resolved.key, { method, params, limit: resolved.limit, class: resolved.class });
    }
  }
  return [...keys.values()];
}

/** The frames the board's METHODS row declares for one closed ask: the bare ask (`full`,
 * local) is the row's own; every other is a named variant, which must be there. */
function boardFrames(params: Readonly<Record<string, string>>): SubscriptionFrames {
  const declared = METHODS.find((m) => m.method === "agent.subscribe")?.subscription;
  if (declared === undefined || declared === true)
    throw new Error("agent.subscribe declares no frames");
  const projection = params.projection ?? "full";
  const scope = params.scope ?? "local";
  if (projection === "full" && scope === "local") return declared;
  const variant =
    scope === "mesh"
      ? `{scope: "mesh", projection: "${projection}"}`
      : `{projection: "${projection}"}`;
  const frames = declared.variants?.[variant];
  if (frames === undefined) throw new Error(`agent.subscribe declares no frames for ${variant}`);
  return frames;
}

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/** The default holders, as the door reads them: a method the table does not declare. */
const defaultHolders = (): number => resolve("no.such.subscribe", {}, {}).limit;

describe("item 476 — every product subscription row declares its admission (the census)", () => {
  it("declares exactly the product subscription rows of METHODS, both ways", () => {
    expect(PRODUCT_SUBSCRIPTIONS).toHaveLength(34);
    // a product `.subscribe` row is a subscription row, and the other way round
    const named = METHODS.filter(
      (m) => m.surface === "product" && m.method.endsWith(".subscribe"),
    ).map((m) => m.method);
    expect(named).toEqual(PRODUCT_SUBSCRIPTIONS);
    expect(Object.keys(SUBSCRIPTION_ADMISSION).sort()).toEqual([...PRODUCT_SUBSCRIPTIONS].sort());
  });

  it("classes the 34 rows: 21 one, 5 variants, 6 things, 2 bounded", () => {
    const byClass = (cls: SubscriptionAdmission["class"]): string[] =>
      PRODUCT_SUBSCRIPTIONS.filter((method) => rowOf(method).class === cls).sort();
    // item 521 (2026-11-18): a board's intents are keyed by the board, which fieldd's handler must hold
    expect(byClass("bounded")).toEqual(["diagnostics.subscribe", "index.session.subscribe"].sort());
    expect(byClass("things")).toEqual(
      [
        "plugins.update.subscribe",
        "plugins.runtime.subscribe",
        "storage.settings.subscribe",
        "agents.extensions.subscribe",
        "compose.sparks.crews.subscribe",
        "objects.intents.subscribe",
      ].sort(),
    );
    expect(byClass("variants")).toEqual(
      [
        "agent.subscribe",
        "index.catalog.subscribe",
        "index.changes.subscribe",
        "index.apps.subscribe",
        "workspace.subscribe",
      ].sort(),
    );
    expect(byClass("one")).toHaveLength(21);
    // the schemas this file reads are the variants' and the things' rows, no more, no fewer
    expect(Object.keys(PARAMS).sort()).toEqual(
      [...byClass("variants"), ...byClass("things")].sort(),
    );
  });
});

describe("item 476 — each class has its shape", () => {
  const positive = (n: number | undefined): boolean =>
    n !== undefined && Number.isSafeInteger(n) && n > 0;

  it("one and bounded read no identity; variants and things read one or more", () => {
    for (const method of PRODUCT_SUBSCRIPTIONS) {
      const row = rowOf(method);
      const fields = Object.keys(row.identity);
      expect(row.reason.trim().length, `${method} says why`).toBeGreaterThan(0);
      // a routed device is the door's to add to every key, never a row's identity
      expect(fields, method).not.toContain("device");
      if (row.class === "one" || row.class === "bounded") expect(fields, method).toEqual([]);
      else expect(fields.length, method).toBeGreaterThan(0);
      if (row.class === "bounded") {
        expect(positive(row.bound), `${method}'s bound`).toBe(true);
        expect(row.holders, `${method} counts by its bound`).toBeUndefined();
      } else {
        expect(row.bound, `${method}: only a bounded method has a bound`).toBeUndefined();
      }
      // only a thing defaults to the caller's own plugin
      const fromCaller = Object.values(row.identity).some((spec) => spec.defaultFromPrincipal);
      if (fromCaller) expect(row.class, method).toBe("things");
    }
  });

  it("a variants field is a closed set its schema states, its default one of them", () => {
    for (const method of PRODUCT_SUBSCRIPTIONS) {
      const row = rowOf(method);
      if (row.class !== "variants") continue;
      for (const [field, spec] of Object.entries(row.identity)) {
        const { values } = valueSetOf(method, field);
        expect(values, `${method}.${field} is an enum or a literal`).not.toBeNull();
        expect(values?.length ?? 0, `${method}.${field}`).toBeGreaterThan(0);
        if (spec.default !== undefined) expect(values, method).toContain(spec.default);
      }
    }
  });

  it("a things field names a thing: a param of its schema, an open string, no default", () => {
    for (const method of PRODUCT_SUBSCRIPTIONS) {
      const row = rowOf(method);
      if (row.class !== "things") continue;
      for (const [field, spec] of Object.entries(row.identity)) {
        expect(valueSetOf(method, field).values, `${method}.${field}`).toBeNull();
        expect(spec.default, `${method}.${field}`).toBeUndefined();
      }
    }
  });

  it("holders are positive safe integers, and a map's values cover its field's every value", () => {
    for (const method of PRODUCT_SUBSCRIPTIONS) {
      const row = rowOf(method);
      const holders = row.holders;
      if (holders === undefined) continue;
      if (typeof holders === "number") {
        expect(positive(holders), `${method}'s holders`).toBe(true);
        continue;
      }
      expect(Object.keys(row.identity), `${method} holds by an identity field`).toContain(
        holders.by,
      );
      const { values } = valueSetOf(method, holders.by);
      expect(values, `${method}.${holders.by} is a closed field`).not.toBeNull();
      // both ways: no value the schema states is missing, and none it does not state is named
      expect(Object.keys(holders.values).sort(), `${method} by ${holders.by}`).toEqual(
        [...(values ?? [])].sort(),
      );
      for (const [value, count] of Object.entries(holders.values))
        expect(positive(count), `${method} ${holders.by}=${value}`).toBe(true);
    }
  });
});

describe("item 476 — the key's canonical form", () => {
  it("fills defaults and sorts the identity fields: {} and the spelled default are one key", () => {
    const board = canonical("agent.subscribe", ["projection", "full"], ["scope", "local"]);
    expect(key("agent.subscribe", {})).toBe(board);
    expect(key("agent.subscribe", { projection: "full" })).toBe(board);
    expect(key("agent.subscribe", { scope: "local", projection: "full" })).toBe(board);
    expect(key("agent.subscribe", { scope: "mesh", projection: "model" })).toBe(
      canonical("agent.subscribe", ["projection", "model"], ["scope", "mesh"]),
    );
    expect(key("agent.subscribe", { projection: "model" })).not.toBe(
      key("agent.subscribe", { projection: "model", scope: "mesh" }),
    );
    expect(key("index.changes.subscribe", {})).toBe(
      key("index.changes.subscribe", { scope: "local" }),
    );
    expect(key("index.changes.subscribe", {})).not.toBe(
      key("index.changes.subscribe", { scope: "mesh" }),
    );
  });

  it("drops tuning and passthrough: a thousand asks of one board are one key", () => {
    const asks = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      asks.add(
        key("agent.subscribe", {
          projection: "model",
          ...(i % 2 === 0 ? { scope: "local" } : {}),
          minIntervalMs: 16 + i,
          heartbeatMs: 250 + i,
          since: { loft: { epoch: `e${i}`, revision: i } },
          [`junk${i}`]: { i },
        }),
      );
    }
    expect([...asks]).toEqual([key("agent.subscribe", { projection: "model" })]);
    const pings = { since: { epoch: "e", revision: 1 }, minIntervalMs: 500, junk: 1 };
    expect(key("project.subscribe", pings)).toBe(canonical("project.subscribe"));
    const roots = { scope: "roots", since: { epoch: "e", revision: 2 }, junk: [1] };
    expect(key("workspace.subscribe", roots)).toBe(key("workspace.subscribe", { scope: "roots" }));
    // params that are no object read as no field at all
    for (const params of [undefined, null, [1], "full", 7])
      expect(key("system.health.subscribe", params)).toBe(key("system.health.subscribe", {}));
  });

  it("keys an absent field with no default as its own key, apart from every named thing", () => {
    expect(key("plugins.runtime.subscribe", {})).toBe(
      canonical("plugins.runtime.subscribe", ["pluginId", null]),
    );
    expect(key("plugins.runtime.subscribe", {})).not.toBe(
      key("plugins.runtime.subscribe", { pluginId: "clock" }),
    );
    expect(key("plugins.runtime.subscribe", { pluginId: "clock" })).not.toBe(
      key("plugins.runtime.subscribe", { pluginId: "pad" }),
    );
  });

  it("keys a non-string identity value by its JSON text, apart from any string", () => {
    expect(key("agent.subscribe", { projection: 5 })).not.toBe(
      key("agent.subscribe", { projection: "5" }),
    );
    expect(key("agent.subscribe", { projection: null })).not.toBe(key("agent.subscribe", {}));
    expect(key("plugins.update.subscribe", { pluginId: { id: "clock" } })).not.toBe(
      key("plugins.update.subscribe", { pluginId: JSON.stringify({ id: "clock" }) }),
    );
    expect(key("plugins.update.subscribe", { pluginId: ["clock"] })).toBe(
      key("plugins.update.subscribe", { pluginId: ["clock"], junk: 1 }),
    );
  });

  it("reads an absent settings plugin as the CALLER's own plugin, where the row says so", () => {
    const clock = canonical("storage.settings.subscribe", ["pluginId", "clock"]);
    expect(key("storage.settings.subscribe", {}, { pluginId: "clock" })).toBe(clock);
    const spelled = key("storage.settings.subscribe", { pluginId: "clock" }, { pluginId: "clock" });
    expect(spelled).toBe(clock);
    expect(key("storage.settings.subscribe", { pluginId: "clock" })).toBe(clock);
    expect(key("storage.settings.subscribe", {}, { pluginId: "pad" })).not.toBe(clock);
    // a window's bare ask names no plugin (its handler refuses it: pluginId required)
    expect(key("storage.settings.subscribe", {})).not.toBe(clock);
    // and only where the row declares it: plugins.runtime's bare ask is every plugin's
    expect(key("plugins.runtime.subscribe", {}, { pluginId: "clock" })).toBe(
      key("plugins.runtime.subscribe", {}),
    );
  });

  it("adds a routed ask's device to every key, and never reads `device` from the params", () => {
    const loft = key("needs.subscribe", {}, { device: "loft" });
    expect(loft).toBe(canonical("needs.subscribe", ["device", "loft"]));
    expect(loft).not.toBe(key("needs.subscribe", {}, { device: "attic" }));
    expect(loft).not.toBe(key("needs.subscribe", {}));
    // the door strips a `device` naming this desktop and routes a foreign one as the caller's:
    // the param itself is never identity
    expect(key("needs.subscribe", { device: "loft" })).toBe(key("needs.subscribe", {}));
    const remote = key("agent.subscribe", { projection: "remote" }, { device: "loft" });
    const fields: Array<[string, string]> = [
      ["device", "loft"],
      ["projection", "remote"],
      ["scope", "local"],
    ];
    expect(remote).toBe(canonical("agent.subscribe", ...fields));
  });

  it("keys a bounded method by the method alone, whatever it asks and wherever it routes", () => {
    const session = resolve("index.session.subscribe", { sessionId: "a" }, {});
    const routed = resolve("index.session.subscribe", { sessionId: "b" }, { device: "loft" });
    expect(routed.key).toBe(session.key);
    expect(session.key).toBe(canonical("index.session.subscribe"));
    expect(resolve("diagnostics.subscribe", { level: "warn" }, {}).key).toBe(
      resolve("diagnostics.subscribe", {}, {}).key,
    );
  });
});

describe("item 476 — what each ask is counted against", () => {
  it("resolves a row's holders, by projection on the board", () => {
    expect(defaultHolders()).toBe(8);
    expect(resolve("system.health.subscribe", {}, {})).toEqual({
      key: canonical("system.health.subscribe"),
      limit: defaultHolders(),
      class: "one",
      declared: true,
    });
    const board = (params: Record<string, string>): number =>
      resolve("agent.subscribe", params, {}).limit;
    expect(board({})).toBe(4);
    expect(board({ projection: "full" })).toBe(4);
    expect(board({ projection: "model" })).toBe(8);
    expect(board({ projection: "model", scope: "mesh" })).toBe(8);
    expect(board({ projection: "field" })).toBe(16);
    expect(board({ projection: "remote", scope: "mesh" })).toBe(16);
    // a value the schema does not state (`desk`, retired) is refused by its handler; the door
    // counts it at the default
    expect(board({ projection: "desk" })).toBe(defaultHolders());
    expect(resolve("storage.settings.subscribe", {}, { pluginId: "clock" }).limit).toBe(32);
  });

  it("resolves a board's intents by the board, each at the default holders (item 521)", () => {
    // fieldd's handler refuses a board its documents do not list, so a key names a board that exists
    const board = resolve("objects.intents.subscribe", { docId: "a" }, {});
    expect(board).toMatchObject({ class: "things", limit: defaultHolders(), declared: true });
    expect(resolve("objects.intents.subscribe", { docId: "b" }, {}).key).not.toBe(board.key);
    expect(resolve("objects.intents.subscribe", { docId: "a" }, {}).key).toBe(board.key);
  });

  it("resolves the bounded methods and a plugin-provided `x.` method by their bounds", () => {
    expect(resolve("diagnostics.subscribe", {}, {})).toMatchObject({
      class: "bounded",
      limit: 4,
      declared: true,
    });
    expect(resolve("index.session.subscribe", { sessionId: "a" }, {})).toMatchObject({
      class: "bounded",
      limit: 8,
      declared: true,
    });
    expect(PLUGIN_PROVIDED_SUBSCRIPTION.identity).toEqual({});
    const provided = resolve("x.clock.ticks.subscribe", { a: 1 }, {});
    expect(provided).toMatchObject({ class: "bounded", limit: 32, declared: true });
    expect(provided.limit).toBe(PLUGIN_PROVIDED_SUBSCRIPTION.bound);
    expect(resolve("x.clock.ticks.subscribe", { b: 2 }, {}).key).toBe(provided.key);
    expect(resolve("x.pad.notes.subscribe", { a: 1 }, {}).key).not.toBe(provided.key);
  });

  it("falls back for an undeclared method: one key, the default holders, declared false", () => {
    const undeclared = resolve("no.such.subscribe", { a: 1 }, {});
    expect(undeclared).toMatchObject({ class: "one", declared: false });
    expect(undeclared.limit).toBe(defaultHolders());
    expect(resolve("no.such.subscribe", { a: 2 }, {}).key).toBe(undeclared.key);
    // an inherited name is no row
    expect(resolve("toString", {}, {}).declared).toBe(false);
    for (const method of PRODUCT_SUBSCRIPTIONS)
      expect(resolve(method, {}, {}).declared, method).toBe(true);
  });
});

describe("item 476 — the figures, re-derived from the table (docs/DECISIONS.md)", () => {
  it("35 closed keys: 20 one, 14 variants, 1 things (plugins.runtime naming no plugin)", () => {
    const keys = closedKeys();
    const count = (cls: string): number => keys.filter((k) => k.class === cls).length;
    expect(count("one")).toBe(20);
    expect(count("variants")).toBe(14);
    expect(count("things")).toBe(1);
    expect(count("bounded")).toBe(0);
    expect(keys).toHaveLength(35);
    // the board's 7: four projections by two scopes, less full with mesh (hand-made fact 1)
    expect(keys.filter((k) => k.method === "agent.subscribe")).toHaveLength(7);
  });

  it("308 holders at most on one connection: 28 × 8 + (4 + 8 + 8) + 4 × 16", () => {
    const keys = closedKeys();
    const board = keys.filter((k) => k.method === "agent.subscribe").map((k) => k.limit);
    const rest = keys.filter((k) => k.method !== "agent.subscribe").map((k) => k.limit);
    expect(rest).toHaveLength(28);
    expect(new Set(rest)).toEqual(new Set([8]));
    expect([...board].sort((a, b) => a - b)).toEqual([4, 8, 8, 16, 16, 16, 16]);
    expect(sum(rest)).toBe(28 * 8);
    expect(sum(board)).toBe(4 + 8 + 8 + 4 * 16);
    expect(sum(keys.map((k) => k.limit))).toBe(308);
  });

  it("20 boards at the 16 ms tick on one connection: full 4 + model 8 × 2 scopes", () => {
    expect(AGENT_FIELD.FULL_TICK_MS).toBe(16);
    const fast = closedKeys().filter(
      (k) =>
        k.method === "agent.subscribe" &&
        boardFrames(k.params).cadenceFloorMs === AGENT_FIELD.FULL_TICK_MS,
    );
    const projections = fast.map((k) => k.params.projection ?? "full").sort();
    expect(projections).toEqual(["full", "model", "model"]);
    expect(sum(fast.map((k) => k.limit))).toBe(20);
  });
});
