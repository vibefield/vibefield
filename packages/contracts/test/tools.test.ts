import { describe, expect, it } from "vitest";
import { SERVED_TOOLS } from "../gen/tools";
import { AGENT_CATALOG } from "../src/agent-catalog";
import { NEEDS_CHOICES_MAX, NOTIFY_PER_MINUTE } from "../src/compose";
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

  // CP-1's rows only read; CP-2's act (start and talk; `draft/compose-plane/cp2-talk-room.md`, ruled 2026-10-31), each a
  // spark's alone, with its destructive and idempotent hints said. CP-3's two act too (the person;
  // `draft/compose-plane/cp3-the-person.md`, ruled 2026-10-31): asking is a spark's, telling every agent's (MT-D11).
  it("serves exactly the rows whose slice has landed: CP-1's read, CP-2's and CP-3's act", () => {
    const landed = ["CP-1", "CP-2", "CP-3"];
    for (const t of TOOLS.filter((x) => served.has(x.name))) {
      expect(landed, t.name).toContain(t.slice);
      if (t.slice === "CP-1") expect(t.readOnly, t.name).toBe(true);
      if (t.slice === "CP-2") expect(t.audience, t.name).toBe("spark");
      if (t.slice === "CP-2" || t.slice === "CP-3") {
        expect(t.readOnly, t.name).toBe(false);
        expect(typeof t.destructive, t.name).toBe("boolean");
        expect(typeof t.idempotent, t.name).toBe("boolean");
      }
    }
    for (const t of TOOLS.filter((x) => landed.includes(x.slice)))
      expect(served.has(t.name), t.name).toBe(true);
    expect(toolRow("ask_user")?.audience).toBe("spark");
    expect(toolRow("notify")?.audience).toBe("agent");
  });

  it("says agent_spawn may answer the item it waits in, never only a session (CP3-D4 A)", () => {
    expect(toolRow("agent_spawn")!.description).toContain("the item it waits in");
  });

  it("says a spark's first words to the user's session wait for the user's OK (CP3-D3 B)", () => {
    expect(toolRow("agent_send")!.description).toContain(
      "Your first words to a session the user started wait for the user's OK.",
    );
  });

  it("states the you room's bounds from contracts, each said once (ask_user's choices, notify's minute)", () => {
    for (const name of ["ask_user", "notify"]) {
      const projected = SERVED_TOOLS.find((t) => t.name === name);
      expect(projected?.description, name).toBe(toolRow(name)?.description);
    }
    expect(toolRow("ask_user")!.description).toContain(`with 1 to ${NEEDS_CHOICES_MAX} choices`);
    expect(toolRow("notify")!.description).toContain(`At most ${NOTIFY_PER_MINUTE} a minute`);
  });

  it("says agent_send's words land marked as the spark's, sent on the user's behalf (CP2-D1)", () => {
    const send = toolRow("agent_send")!;
    expect(send.description).toContain("marked as yours, sent on the user's behalf");
    expect(send.description).not.toContain("as the user's words");
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
