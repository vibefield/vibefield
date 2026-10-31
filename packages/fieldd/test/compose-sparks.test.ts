import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentProfileSet, AgentSessionSummary, SparkRecord } from "@vibefield/contracts";
import { afterAll, describe, expect, it } from "vitest";
import {
  folderRoute,
  LAUNCH_ROUTE,
  type SparkLaunch,
  type SparkRoute,
  SparkService,
  SparkStore,
  sparkSlug,
} from "../src/compose/sparks";

// CP-1c — the sparks fieldd keeps and the doors' work (the compose plane, version 2; NS-D1, NS-D2 B, NS-D5, CR-D11).
// What must hold: an agent that edits a spark's record cannot widen what the spark reaches; a hatch refuses what the
// sheet must not create; and a spark wakes in its last session before it is started again.

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "vf-sparks-"));
  dirs.push(dir);
  return dir;
};
const store = (root = tmp()) =>
  new SparkStore({
    dir: join(root, "fieldd", "sparks"),
    keyPath: join(root, "fieldd", "sparks.key"),
  });

const spark = (over: Partial<SparkRecord> = {}): SparkRecord => ({
  format: 1,
  id: "sp-0a1b2c3d4e5f6a7b",
  name: "Vela",
  face: { seed: 7 },
  agent: "claude",
  profiles: ["work", "native"],
  thinksUnder: "work",
  folder: "/f/sparks/vela",
  createdAt: "2026-10-29T12:00:00.000Z",
  updatedAt: "2026-10-29T12:00:00.000Z",
  ...over,
});

describe("the spark store: signed, and set aside when it does not verify (CP-1c; TL-D5)", () => {
  it("reads back what it wrote, 0600 under a key made once", () => {
    const root = tmp();
    const records = store(root);
    records.write(spark());
    expect(records.get("sp-0a1b2c3d4e5f6a7b")).toEqual(spark());
    expect(statSync(records.path("sp-0a1b2c3d4e5f6a7b")).mode & 0o777).toBe(0o600);
    const key = readFileSync(join(root, "fieldd", "sparks.key"), "utf8");
    expect(statSync(join(root, "fieldd", "sparks.key")).mode & 0o777).toBe(0o600);
    store(root).write(spark({ id: "sp-ffffffffffffffff", name: "Lyra" }));
    expect(readFileSync(join(root, "fieldd", "sparks.key"), "utf8")).toBe(key);
    expect(
      store(root)
        .list()
        .map((s) => s.name),
    ).toEqual(["Vela", "Lyra"]);
  });

  it("sets aside a record an agent widened, one with no signature, and one other users can read", () => {
    const records = store();
    records.write(spark());
    const path = records.path("sp-0a1b2c3d4e5f6a7b");
    const signed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...signed, profiles: ["work", "native", "home"] }), {
      mode: 0o600,
    });
    expect(records.get("sp-0a1b2c3d4e5f6a7b")).toBeUndefined();
    const { signature: _s, ...unsigned } = signed;
    writeFileSync(path, JSON.stringify(unsigned), { mode: 0o600 });
    expect(records.get("sp-0a1b2c3d4e5f6a7b")).toBeUndefined();
    records.write(spark());
    chmodSync(path, 0o644);
    expect(records.get("sp-0a1b2c3d4e5f6a7b")).toBeUndefined();
    expect(records.list()).toEqual([]);
  });

  it("knows a name by its letters, not its case", () => {
    const records = store();
    records.write(spark());
    expect(records.named("  vela ")?.id).toBe("sp-0a1b2c3d4e5f6a7b");
    expect(records.named("Lyra")).toBeUndefined();
  });

  it("mints ids its schema takes, never the same twice", () => {
    const ids = new Set(Array.from({ length: 50 }, () => SparkStore.mintId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^sp-[0-9a-z]{6,32}$/);
  });

  it("names a folder from the name, and never one another spark holds", () => {
    expect(sparkSlug("Vela", () => false)).toBe("vela");
    expect(sparkSlug("Vela", (s) => s === "vela" || s === "vela-2")).toBe("vela-3");
    expect(sparkSlug("Ünïcode Star!", () => false)).toBe("unicode-star");
    expect(sparkSlug("★★★", () => false)).toBe("spark");
  });
});

const persona = (provider: string, loggedIn: boolean) => ({
  profileId: `${provider}:x`,
  provider,
  label: provider,
  kind: "managed" as const,
  createdAt: "x",
  identity: { loggedIn, verifiedAt: "x" },
});
const SETS: AgentProfileSet[] = [
  {
    id: "native",
    kind: "native",
    label: "This Mac",
    default: true,
    createdAt: "x",
    personas: [persona("claude", true)],
  },
  {
    id: "work",
    kind: "managed",
    label: "Work",
    default: false,
    createdAt: "x",
    personas: [persona("claude", true), persona("grok", false)],
  },
];

function service(runs: AgentSessionSummary[] = []) {
  const root = tmp();
  const calls: string[] = [];
  const launched: { launch: SparkLaunch; spark: string }[] = [];
  let resumable = true;
  const route: SparkRoute = { prepare: async (s) => void calls.push(`prepare:${s.name}`) };
  const svc = new SparkService({
    store: store(root),
    homes: join(root, "sparks"),
    route,
    profileSets: async () => SETS,
    runs: () => runs,
    spawn: async (launch, sparkId) => {
      calls.push("spawn");
      launched.push({ launch, spark: sparkId });
      return { runtimeRunId: `run-${launched.length}` };
    },
    resume: async (runtimeRunId) => {
      calls.push(`resume:${runtimeRunId}`);
      return resumable ? { runtimeRunId: `${runtimeRunId}-b` } : undefined;
    },
    now: () => new Date("2026-10-29T12:00:00.000Z"),
  });
  const principal = { kind: "local-token" } as never;
  return {
    svc,
    root,
    calls,
    launched,
    principal,
    notResumable: () => {
      resumable = false;
    },
  };
}
const HATCH = {
  name: "Vela",
  face: { seed: 7 },
  agent: "claude",
  profiles: ["work", "native"],
  thinksUnder: "work",
};

describe("hatch, list and open (CP-1c; NS-D1, NS-D5, CR-D11)", () => {
  it("hatches into a folder of its own with its brief, then starts its session there under the profile it thinks in", async () => {
    const h = service();
    const out = await h.svc.hatch(HATCH, h.principal);
    expect(out).toMatchObject({
      name: "Vela",
      face: { seed: 7 },
      profiles: ["work", "native"],
      thinksUnder: "work",
    });
    expect(out.folder).toBe(join(h.root, "sparks", "vela"));
    expect(readFileSync(join(out.folder, "CLAUDE.md"), "utf8")).toContain(
      "You are Vela, a spark in VibeField.",
    );
    expect(h.calls).toEqual(["prepare:Vela", "spawn"]);
    expect(h.launched[0]).toEqual({
      launch: {
        provider: "claude",
        cwd: out.folder,
        profileSet: "work",
        modelSelection: undefined,
        title: "Vela",
      },
      spark: out.id,
    });
    expect(h.svc.get(out.id)?.session).toEqual({ runtimeRunId: "run-1" });
    expect(out.session).toEqual({ runtimeRunId: "run-1", live: false });
  });

  it("refuses a profile that does not exist, a profile with no sign-in for its agent, and a name another spark holds", async () => {
    const h = service();
    await expect(
      h.svc.hatch({ ...HATCH, profiles: ["work", "nope"] }, h.principal),
    ).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      details: { reason: "unknown-profile", profile: "nope" },
    });
    await expect(h.svc.hatch({ ...HATCH, agent: "grok" }, h.principal)).rejects.toMatchObject({
      details: { reason: "no-sign-in", agent: "grok", profile: "work" },
    });
    await h.svc.hatch(HATCH, h.principal);
    await expect(h.svc.hatch({ ...HATCH, name: "VELA" }, h.principal)).rejects.toMatchObject({
      details: { reason: "name-taken" },
    });
    expect(h.launched).toHaveLength(1);
  });

  it("answers a live spark as it is, wakes a sleeping one in its last session, and starts one again that cannot be", async () => {
    const runs: AgentSessionSummary[] = [];
    const h = service(runs);
    const vela = await h.svc.hatch(HATCH, h.principal);
    runs.push({
      runtimeRunId: "run-1",
      spark: vela.id,
      tier: "managed",
      terminal: { hosted: "local", runtimeSessionId: "sess-1" },
    } as AgentSessionSummary);
    h.calls.length = 0;
    expect((await h.svc.open(vela.id, h.principal)).session).toEqual({
      runtimeRunId: "run-1",
      terminalSessionId: "sess-1",
      live: true,
    });
    expect(h.calls).toEqual([]);
    runs.length = 0;
    await h.svc.open(vela.id, h.principal);
    expect(h.calls).toEqual(["prepare:Vela", "resume:run-1"]);
    expect(h.svc.get(vela.id)?.session).toEqual({ runtimeRunId: "run-1-b" });
    h.notResumable();
    h.calls.length = 0;
    await h.svc.open(vela.id, h.principal);
    expect(h.calls).toEqual(["prepare:Vela", "resume:run-1-b", "prepare:Vela", "spawn"]);
    expect(h.svc.list().map((s) => s.name)).toEqual(["Vela"]);
  });
});

describe("the two routes for the vibefield server (co-spark-door-route)", () => {
  it("A writes nothing into the folder; B writes .mcp.json naming the floor's bridge", async () => {
    const folder = tmp();
    await LAUNCH_ROUTE.prepare(spark({ folder }));
    expect(existsSync(join(folder, ".mcp.json"))).toBe(false);
    await folderRoute(async () => ({
      endpoint: "/run/door.sock",
      command: "/app/field-native",
      args: ["door", "--endpoint", "/run/door.sock"],
    })).prepare(spark({ folder }));
    expect(JSON.parse(readFileSync(join(folder, ".mcp.json"), "utf8"))).toEqual({
      mcpServers: {
        vibefield: { command: "/app/field-native", args: ["door", "--endpoint", "/run/door.sock"] },
      },
    });
  });
});
