import { describe, expect, it } from "vitest";
import { SERVED_TOOLS } from "../gen/tools";
import { AGENT_CATALOG } from "../src/agent-catalog";
import { NEEDS_CHOICES_MAX, NOTIFY_PER_MINUTE } from "../src/compose";
import { METHODS } from "../src/methods";
import { PagesEngineRecordV1, PagesScriptSetV1 } from "../src/pages";
import { PAGES_ENGINE_RECORD, PAGES_SCRIPT_SET } from "../src/pages-record";
import {
  TOOL_AUDIENCES,
  TOOL_CATEGORIES,
  TOOL_FACTS,
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
      // Raised from 24 to 32 on 2026-11-17 (EY-0, plan §2.1 and §6.1): the pages rows keep the pin's own verbs, and
      // `browser_wait_for_selector` is 25. A rename would break the map to the pin.
      expect(name.length, name).toBeLessThanOrEqual(32);
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
      "canvas_kinds",
      "canvas_list",
      "canvas_place",
      "canvas_remove",
      "object_open",
      "object_read",
      "object_act",
      "object_release",
      "ask_user",
      "notify",
      "browser_tools_profiles",
      "browser_open",
      "browser_read",
      "browser_snapshot",
      "browser_back",
      "browser_forward",
      "browser_reload",
      "browser_click",
      "browser_fill",
      "browser_type",
      "browser_press",
      "browser_check",
      "browser_uncheck",
      "browser_select",
      "browser_scroll",
      "browser_wait_ms",
      "browser_wait_for_selector",
      "browser_wait_for_text",
      "browser_wait_for_load",
      "browser_screenshot",
      "browser_get_text",
      "browser_get_url",
      "browser_get_title",
      "browser_tab_new",
      "browser_tab_list",
      "browser_tab_switch",
      "browser_tab_close",
      "browser_eval",
      "browser_close",
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
    const landed = ["CP-1", "CP-2", "CP-3", "OB-3"];
    for (const t of TOOLS.filter((x) => served.has(x.name))) {
      expect(landed, t.name).toContain(t.slice);
      if (t.slice === "CP-1") expect(t.readOnly, t.name).toBe(true);
      if (t.slice === "CP-2") expect(t.audience, t.name).toBe("spark");
      if (t.slice === "CP-2" || t.slice === "CP-3") {
        expect(t.readOnly, t.name).toBe(false);
        expect(typeof t.destructive, t.name).toBe("boolean");
        expect(typeof t.idempotent, t.name).toBe("boolean");
      }
      if (t.slice === "OB-3") {
        expect(t.category, t.name).toBe("desk");
        expect(t.audience, t.name).toBe("agent");
        if (!t.readOnly) expect(typeof t.destructive, t.name).toBe("boolean");
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

describe("the facts a refusal names (the study's §8; EY-0)", () => {
  it("holds the eight fieldd answers today, then the pages room's eight, each once", () => {
    expect(TOOL_FACTS).toEqual([
      "unknown-tool",
      "forbidden",
      "bad-input",
      "outside",
      "not-found",
      "unavailable",
      "limit",
      "failed",
      // the pages room's (draft/thinking-agents-eyes.md, its facts table)
      "not-handed",
      "held",
      "off-site",
      "stale-ref",
      "loading",
      "parked",
      "gone",
      "needs-you",
    ]);
    expect(new Set(TOOL_FACTS).size).toBe(TOOL_FACTS.length);
  });
});

// EY-0 (draft/tool-plane/EY-0-PLAN.md §2.1, §2.7) — the pages rows are written by hand. Until EY-2's generator,
// they are held here to the record the lab's converter writes.
describe("the pages room's rows: the pin's core profile, planned (EY-0)", () => {
  const pages = TOOLS.filter((t) => t.family === "pages");
  const engine = PAGES_ENGINE_RECORD.core;

  it("names the pin's core profile in its own order, with `browser_` for the engine's prefix: 29, and no get_cdp_url (AB-21)", () => {
    expect(engine).toHaveLength(29);
    for (const tool of engine) expect(tool.engineName).toMatch(/^agent_browser_[a-z_]+$/);
    expect(pages.map((t) => t.name)).toEqual(
      engine.map((tool) => tool.engineName.replace(/^agent_browser_/, "browser_")),
    );
    expect(engine.map((tool) => tool.engineName)).not.toContain("agent_browser_get_cdp_url");
  });

  it("takes readOnly from the engine's readOnlyHint, but for the map's two: a still is a read, and fieldd answers the profiles row", () => {
    const departures = new Set(["browser_screenshot", "browser_tools_profiles"]);
    for (const [index, row] of pages.entries()) {
      const hint = engine[index]?.readOnlyHint;
      if (departures.has(row.name)) {
        expect(hint, row.name).toBe(false);
        expect(row.readOnly, row.name).toBe(true);
      } else {
        expect(row.readOnly, row.name).toBe(hint);
      }
    }
    expect(pages.filter((t) => t.readOnly)).toHaveLength(12);
  });

  it("puts every row on the browser pane, for every agent, in slice EY-2, and serves none before EY-2", () => {
    for (const t of pages) {
      expect(t, t.name).toMatchObject({
        category: "desk",
        audience: "agent",
        object: "vibefield.browser-pane",
        slice: "EY-2",
      });
      expect(served.has(t.name), t.name).toBe(false);
      // the words are VibeField's: never the engine's name
      expect(t.description, t.name).not.toMatch(/agent.browser/i);
    }
  });

  it("parses the record and the script set by their schemas, both recorded from one release", () => {
    const record = PagesEngineRecordV1.safeParse(PAGES_ENGINE_RECORD);
    expect(record.success, record.success ? "" : JSON.stringify(record.error.issues)).toBe(true);
    const set = PagesScriptSetV1.safeParse(PAGES_SCRIPT_SET);
    expect(set.success, set.success ? "" : JSON.stringify(set.error.issues)).toBe(true);
    expect(PAGES_SCRIPT_SET.engineVersion).toBe(PAGES_ENGINE_RECORD.version);
  });
});
