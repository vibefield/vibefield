import { describe, expect, it } from "vitest";
import { SERVED_TOOLS } from "../gen/tools";
import { AGENT_CATALOG } from "../src/agent-catalog";
import { METHODS } from "../src/methods";
import {
  TOOL_AUDIENCES,
  TOOL_CATEGORIES,
  TOOL_FAMILIES,
  TOOL_SCHEMAS,
  TOOL_SCOPES,
  TOOL_SLICES,
  TOOLS,
  toolRow,
} from "../src/tools";

// MT — the tool plane's catalog (draft/thinking-tool-plane.md §3 and §8; the MT lead's rulings 1 and 2, 2026-10-30
// 21:45Z). What these hold: one row per tool, named `<noun>_<verb>` with the family as a column; every row carries its
// audience, scope, slice and description; a schema belongs to a row, and a row with schemas is exactly a served one; an
// acting row says whether it destroys and whether it repeats; and the projection fieldd lists carries all four
// annotations, closed-world.

const names = TOOLS.map((t) => t.name);
const served = new Set(Object.keys(TOOL_SCHEMAS));

describe("the catalog's names (MT-L1, ruling 1)", () => {
  it("names every row once: lowercase, underscores, no dot, short", () => {
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name, name).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
      expect(name.length, name).toBeLessThanOrEqual(24);
    }
  });

  it("never uses a vendor's word (AR-L1): no part of a name is an agent the catalog offers", () => {
    const vendors = new Set<string>(AGENT_CATALOG.map((a) => a.id));
    for (const name of names)
      for (const part of name.split("_")) expect(vendors.has(part), `${name}: ${part}`).toBe(false);
  });

  it("keeps the names its editor chose: a rename is a retirement, made here on purpose (the study's §8)", () => {
    expect(names).toEqual([
      "agents_available",
      "agent_spawn",
      "agents_list",
      "agent_read",
      "agent_watch",
      "agent_unwatch",
      "agent_send",
      "agent_interrupt",
      "agent_stop",
      "flow_run",
      "flow_read",
      "flow_stop",
      "flow_propose",
      "history_search",
      "history_read",
      "projects_list",
      "canvas_place",
      "canvas_update",
      "ask_user",
      "notify",
    ]);
  });

  it("has an approve tool nowhere: approvals stay the user's (CP-L4, TL-D4)", () => {
    for (const name of names) expect(name).not.toMatch(/approv|permission|allow/);
  });

  it("keeps every tool out of METHODS: a tool's name is never a dotted method", () => {
    const methods = new Set(METHODS.map((m) => m.method));
    for (const name of names) expect(methods.has(name), name).toBe(false);
  });
});

describe("the catalog's columns (ruling 2)", () => {
  it("gives every row its family, category, audience, scope, slice and a description in the onboarding voice", () => {
    for (const t of TOOLS) {
      expect(TOOL_FAMILIES, t.name).toContain(t.family);
      expect(TOOL_CATEGORIES, t.name).toContain(t.category);
      expect(TOOL_AUDIENCES, t.name).toContain(t.audience);
      expect(TOOL_SCOPES, t.name).toContain(t.scope);
      expect(TOOL_SLICES, t.name).toContain(t.slice);
      expect(t.description.length, t.name).toBeGreaterThan(20);
      expect(t.description.length, t.name).toBeLessThanOrEqual(300);
      expect(t.description, t.name).toMatch(/\.$/);
    }
  });

  it("states destructive and idempotent on every acting row, and leaves both off a read-only one", () => {
    for (const t of TOOLS) {
      if (t.readOnly) {
        expect(t.destructive, t.name).toBeUndefined();
        expect(t.idempotent, t.name).toBeUndefined();
      } else {
        expect(typeof t.destructive, t.name).toBe("boolean");
        expect(typeof t.idempotent, t.name).toBe("boolean");
      }
    }
  });

  it("keeps the compose rooms a spark's, and opens History and the projects list to every agent (MT-D2, MT-D5)", () => {
    for (const t of TOOLS.filter((x) => ["agents", "watch", "talk", "flows"].includes(x.family)))
      expect(t.audience, t.name).toBe("spark");
    for (const name of ["history_search", "history_read", "projects_list"])
      expect(toolRow(name)?.audience, name).toBe("agent");
    // MT-D11: asking the person waits in the needs-you queue, a spark's; telling them is everyone's
    expect(toolRow("ask_user")?.audience).toBe("spark");
    expect(toolRow("notify")?.audience).toBe("agent");
  });

  it("holds projects_list to the device: it reads no profile and answers this desktop's projects (ruling 11)", () => {
    expect(toolRow("projects_list")).toMatchObject({ family: "projects", scope: "device" });
  });
});

describe("served and planned (ruling 2)", () => {
  it("gives every schema a row, and every served row a schema", () => {
    for (const name of served) expect(toolRow(name), name).toBeDefined();
  });

  it("serves only rows whose slice has landed, and every one of them only reads", () => {
    for (const t of TOOLS.filter((x) => served.has(x.name))) {
      expect(t.slice, t.name).toBe("CP-1");
      expect(t.readOnly, t.name).toBe(true);
    }
    for (const t of TOOLS.filter((x) => x.slice === "CP-1"))
      expect(served.has(t.name), t.name).toBe(true);
  });

  it("projects exactly the served rows, in catalog order, with all four annotations and closed-world", () => {
    expect(SERVED_TOOLS.map((t) => t.name)).toEqual(names.filter((n) => served.has(n)));
    for (const t of SERVED_TOOLS) {
      const row = toolRow(t.name)!;
      expect(t.audience, t.name).toBe(row.audience);
      expect(t.scope, t.name).toBe(row.scope);
      expect(t.annotations, t.name).toEqual({
        readOnlyHint: row.readOnly,
        destructiveHint: row.readOnly ? false : row.destructive,
        idempotentHint: row.readOnly ? true : row.idempotent,
        openWorldHint: false,
      });
      expect(t.inputSchema.type, t.name).toBe("object");
      expect(t.outputSchema.type, t.name).toBe("object");
    }
  });
});
