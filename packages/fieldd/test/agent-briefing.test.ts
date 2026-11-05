import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentCatalogEntry,
  createAgentCatalogReaders,
  type NativeDoorInfoResult,
  type SparkRecord,
} from "@vibefield/contracts";
import type { AgentBriefingCapabilities } from "@vibefield/puppeteer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentBriefings, sparkFactsRefusal, sparkHatchRefusal } from "../src/agent-briefing";
import { SparkStore } from "../src/tool-plane/sparks";
import { catalogWith, SCRIPTED_CATALOG, SCRIPTED_ROW } from "./agent-catalog-fixture";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const supported: AgentBriefingCapabilities = {
  mcpServers: true,
  allowTools: true,
  instructions: true,
  mcpServerProcess: "terminal",
};

// `null` is an agent that declares no briefing at all (a default parameter would read `undefined` as `supported`).
// The catalog is the test seam's table, whose scripted row claims `spark` (CP-5a), unless a test composes another.
function harness(
  capability: AgentBriefingCapabilities | null = supported,
  doorDown = false,
  catalog: readonly AgentCatalogEntry[] = SCRIPTED_CATALOG,
) {
  const root = mkdtempSync(join(tmpdir(), "vf-briefing-"));
  roots.push(root);
  const spark: SparkRecord = {
    format: 1,
    id: "sp-7k2m9q4x",
    name: "Vela",
    face: { seed: 7 },
    agent: "scripted",
    profiles: ["native"],
    thinksUnder: "native",
    folder: root,
    createdAt: "2026-10-29T12:00:00.000Z",
    updatedAt: "2026-10-29T12:00:00.000Z",
  };
  const store = new SparkStore({ dir: join(root, "records"), keyPath: join(root, "key") });
  store.write(spark);
  const brief = join(root, "CLAUDE.md");
  writeFileSync(brief, "The first brief.");
  const info: NativeDoorInfoResult = {
    command: "/app/field-native",
    args: ["door", "--endpoint", "/run/door.sock"],
    endpoint: "/run/door.sock",
  };
  const door = vi.fn(async () => {
    if (doorDown) throw new Error("the floor offers no door");
    return info;
  });
  const capabilities = vi.fn(() => capability ?? undefined);
  const service = new AgentBriefings({
    spark: (id) => store.get(id),
    catalog: createAgentCatalogReaders(catalog),
    capabilities,
    door,
  });
  return { service, spark, store, root, brief, info, door, capabilities };
}

describe("CP-1d: a fresh briefing for each spark process", () => {
  it("reads the current native door and edited brief on every preparation, with no folder config or credential", async () => {
    const h = harness();
    const first = await h.service.prepare(h.spark.id, "scripted");
    expect(first).toEqual({
      mcpServers: { vibefield: { command: h.info.command, args: [...h.info.args] } },
      allowTools: ["vibefield/*"],
      instructions: "The first brief.",
    });
    h.info.command = "/updated/field-native";
    h.info.args[2] = "/new/door.sock";
    writeFileSync(h.brief, "The edited brief.");
    const next = await h.service.prepare(h.spark.id, "scripted");
    expect(next.mcpServers?.vibefield).toEqual({
      command: "/updated/field-native",
      args: ["door", "--endpoint", "/new/door.sock"],
    });
    expect(next.instructions).toBe("The edited brief.");
    expect(first.mcpServers?.vibefield?.args?.[2]).toBe("/run/door.sock");
    expect(h.door).toHaveBeenCalledTimes(2);
    expect(existsSync(join(h.root, ".mcp.json"))).toBe(false);
  });

  it.each(["mcpServers", "allowTools", "instructions"] as const)(
    "refuses a missing %s capability before asking for a door",
    async (field) => {
      const h = harness({ ...supported, [field]: false });
      await expect(h.service.prepare(h.spark.id, "scripted")).rejects.toMatchObject({
        details: { reason: "spark-briefing-unsupported" },
      });
      expect(h.door).not.toHaveBeenCalled();
    },
  );

  it.each(["helper", "external", undefined] as const)(
    "refuses %s process ancestry even when all briefing fields are supported",
    async (mcpServerProcess) => {
      const { mcpServerProcess: _terminal, ...fields } = supported;
      const h = harness({ ...fields, ...(mcpServerProcess ? { mcpServerProcess } : {}) });
      await expect(h.service.prepare(h.spark.id, "scripted")).rejects.toMatchObject({
        details: { reason: "spark-door-identity-unsupported" },
      });
      expect(h.door).not.toHaveBeenCalled();
    },
  );

  it("refuses missing, forged and other-agent records before reading a door", async () => {
    const h = harness();
    await expect(h.service.prepare("sp-00000000", "scripted")).rejects.toMatchObject({
      details: { reason: "spark-unavailable" },
    });
    await expect(h.service.prepare(h.spark.id, "another-agent")).rejects.toMatchObject({
      details: { reason: "spark-agent-mismatch" },
    });
    writeFileSync(h.store.path(h.spark.id), JSON.stringify({ ...h.spark, profiles: ["other"] }));
    await expect(h.service.prepare(h.spark.id, "scripted")).rejects.toMatchObject({
      details: { reason: "spark-unavailable" },
    });
    expect(h.door).not.toHaveBeenCalled();
  });

  it("refuses an unreadable brief without silently starting an ordinary run", async () => {
    const h = harness();
    rmSync(h.brief);
    await expect(h.service.prepare(h.spark.id, "scripted")).rejects.toMatchObject({
      details: { reason: "spark-brief-unavailable" },
    });
    expect(h.door).not.toHaveBeenCalled();
  });

  it.each(["a\0brief", "x".repeat(65_537)])(
    "validates the edited brief during preparation, before a replacement can end its old process",
    async (instructions) => {
      const h = harness();
      writeFileSync(h.brief, instructions);
      await expect(h.service.prepare(h.spark.id, "scripted")).rejects.toMatchObject({
        details: { reason: "spark-brief-invalid", field: "instructions" },
      });
    },
  );
});

// MT-0 (MT-D9; the MT lead's ruling 7) — a plain run is briefed with the tool plane's door and the allowance of its
// read-only `agent` rows by name, and no instructions (the server's own paragraph says the rest; provisional on the
// history room's sentinel eval). It degrades: an agent that cannot take it, a process the door cannot name, or a door
// that does not answer means a run with no briefing, never a refused spawn.
describe("MT-0: a plain run's briefing, which degrades and never refuses", () => {
  it("carries the door and the read-only agent rows by name, and no instructions", async () => {
    const h = harness();
    expect(await h.service.forRun("scripted")).toEqual({
      mcpServers: { vibefield: { command: h.info.command, args: [...h.info.args] } },
      allowTools: ["vibefield/history_search", "vibefield/history_read", "vibefield/projects_list"],
    });
  });

  it("needs no instructions capability: an agent that takes servers and allowances is briefed", async () => {
    const h = harness({ ...supported, instructions: false });
    expect((await h.service.forRun("scripted")).allowTools).toHaveLength(3);
  });

  it.each([
    ["no servers", { ...supported, mcpServers: false }],
    ["no allowances", { ...supported, allowTools: false }],
    ["a helper's process", { ...supported, mcpServerProcess: "helper" as const }],
    ["no capabilities at all", null],
  ])("starts an agent with %s bare, before asking for a door", async (_label, capability) => {
    const h = harness(capability);
    expect(await h.service.forRun("scripted")).toEqual({});
    expect(h.door).not.toHaveBeenCalled();
  });

  it("starts a run bare when the door does not answer, where a spark's birth refuses", async () => {
    const h = harness(supported, true);
    expect(await h.service.forRun("scripted")).toEqual({});
    await expect(h.service.prepare(h.spark.id, "scripted")).rejects.toThrow(
      "the floor offers no door",
    );
  });
});

// CP-5a (CP5-Q9 (a), ruled 2026-11-04) — whether VibeField lets the agent be a spark is the catalog's claim, and the
// gate reads it before any fact: hatch needs the row offered and claiming (`isOffered(id, "spark")`), every later
// birth needs it visible and claiming, so a deprecated agent's sparks still wake (AC-D3). A plain run reads no claim.
describe("CP-5a: the catalog's spark claim, read before the facts", () => {
  const unclaimed = catalogWith("scripted", { offers: { ...SCRIPTED_ROW.offers, spark: false } });
  const notOffered = { details: { reason: "spark-not-offered", provider: "scripted" } };

  it("refuses an unclaimed row `spark-not-offered` at hatch and at every birth, before a fact, the brief or the door is read", async () => {
    const h = harness(supported, false, unclaimed);
    expect(() => h.service.requireSupported("scripted")).toThrow(
      "VibeField does not offer this agent as a spark",
    );
    expect(() => h.service.requireSupported("scripted")).toThrow(
      expect.objectContaining(notOffered),
    );
    await expect(h.service.prepare(h.spark.id, "scripted")).rejects.toMatchObject(notOffered);
    expect(h.capabilities).not.toHaveBeenCalled();
    expect(h.door).not.toHaveBeenCalled();
  });

  it("refuses an agent the catalog never decided on, whatever it declares", () => {
    const h = harness();
    expect(() => h.service.requireSupported("nobody")).toThrow(
      expect.objectContaining({ details: { reason: "spark-not-offered", provider: "nobody" } }),
    );
    expect(h.capabilities).not.toHaveBeenCalled();
  });

  it("hatches only an offered row; a deprecated row that keeps its claim is born again, a declined one is not", async () => {
    const deprecated = harness(supported, false, catalogWith("scripted", { status: "deprecated" }));
    expect(() => deprecated.service.requireSupported("scripted")).toThrow(
      expect.objectContaining(notOffered),
    );
    expect((await deprecated.service.prepare(deprecated.spark.id, "scripted")).allowTools).toEqual([
      "vibefield/*",
    ]);
    const declined = harness(supported, false, catalogWith("scripted", { status: "declined" }));
    await expect(declined.service.prepare(declined.spark.id, "scripted")).rejects.toMatchObject(
      notOffered,
    );
    expect(declined.door).not.toHaveBeenCalled();
  });

  it("reads the facts after the claim: a claimed row the pin cannot brief keeps CP-1d's reasons", async () => {
    const h = harness({ ...supported, mcpServerProcess: "helper" });
    expect(() => h.service.requireSupported("scripted")).toThrow(
      expect.objectContaining({
        details: { reason: "spark-door-identity-unsupported", provider: "scripted" },
      }),
    );
    expect(h.capabilities).toHaveBeenCalled();
  });

  it("leaves a plain run's briefing to the facts alone (MT-D9): an unclaimed agent's run is still briefed", async () => {
    const h = harness(supported, false, unclaimed);
    expect((await h.service.forRun("scripted")).allowTools).toHaveLength(3);
  });

  it("exports the one predicate: the hatch's verdict is the claim, then the facts", () => {
    const claimed = createAgentCatalogReaders(SCRIPTED_CATALOG);
    const none = createAgentCatalogReaders(unclaimed);
    const asked = vi.fn(() => supported);
    expect(sparkHatchRefusal(none, "scripted", asked)).toBe("spark-not-offered");
    // the declaration is read only once the claim stands
    expect(asked).not.toHaveBeenCalled();
    expect(sparkHatchRefusal(claimed, "scripted", () => supported)).toBeUndefined();
    expect(
      sparkHatchRefusal(claimed, "scripted", () => ({ ...supported, instructions: false })),
    ).toBe("spark-briefing-unsupported");
    expect(
      sparkHatchRefusal(claimed, "scripted", () => ({ ...supported, mcpServerProcess: "helper" })),
    ).toBe("spark-door-identity-unsupported");
    expect(sparkFactsRefusal(undefined)).toBe("spark-briefing-unsupported");
    // a plain run's facts need no instructions
    expect(sparkFactsRefusal({ ...supported, instructions: false }, false)).toBeUndefined();
  });
});
