import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeDoorInfoResult, SparkRecord } from "@vibefield/contracts";
import type { AgentBriefingCapabilities } from "@vibefield/puppeteer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentBriefings } from "../src/agent-briefing";
import { SparkStore } from "../src/tool-plane/sparks";

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
function harness(capability: AgentBriefingCapabilities | null = supported, doorDown = false) {
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
  const service = new AgentBriefings({
    spark: (id) => store.get(id),
    capabilities: () => capability ?? undefined,
    door,
  });
  return { service, spark, store, root, brief, info, door };
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
