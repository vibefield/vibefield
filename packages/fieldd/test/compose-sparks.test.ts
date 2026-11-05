import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentProfileSet, AgentSessionSummary, SparkRecord } from "@vibefield/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { type SparkLaunch, SparkService, SparkStore, sparkSlug } from "../src/tool-plane/sparks";

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

  it("sets aside a key other users can read and makes another, so what it signed reads as forged (one signer, SessionRecordStore's rule)", () => {
    const root = tmp();
    const keyPath = join(root, "fieldd", "sparks.key");
    store(root).write(spark());
    const exposedKey = readFileSync(keyPath, "utf8");
    chmodSync(keyPath, 0o644);
    const after = store(root);
    expect(after.get("sp-0a1b2c3d4e5f6a7b")).toBeUndefined();
    expect(readFileSync(keyPath, "utf8")).not.toBe(exposedKey);
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    // kept beside it for a human, never deleted
    const aside = readdirSync(join(root, "fieldd")).filter((name) =>
      name.startsWith("sparks.key.exposed-"),
    );
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(root, "fieldd", aside[0] ?? ""), "utf8")).toBe(exposedKey);
    after.write(spark());
    expect(store(root).get("sp-0a1b2c3d4e5f6a7b")).toEqual(spark());
  });

  it("sets aside a key file that holds no key, and never signs with what it holds", () => {
    const root = tmp();
    const keyPath = join(root, "fieldd", "sparks.key");
    mkdirSync(join(root, "fieldd"), { recursive: true, mode: 0o700 });
    writeFileSync(keyPath, "not a key", { mode: 0o600 });
    store(root).write(spark());
    expect(readFileSync(keyPath, "utf8")).toMatch(/^[0-9a-f]{64}$/);
    expect(
      readdirSync(join(root, "fieldd")).filter((name) => name.startsWith("sparks.key.unreadable-")),
    ).toHaveLength(1);
    expect(store(root).get("sp-0a1b2c3d4e5f6a7b")).toEqual(spark());
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

function service(
  runs: AgentSessionSummary[] = [],
  requireSupport: (provider: string) => void = () => undefined,
) {
  const root = tmp();
  const calls: string[] = [];
  const launched: { launch: SparkLaunch; spark: string }[] = [];
  let resumable = true;
  // a resume that takes its time until the test lets it answer, or refuse
  let held: Promise<void> = Promise.resolve();
  // the runtime's claim (claimConversation): a second resume of a conversation already being resumed is refused, and
  // the daemon's wrapper reads that refusal as "cannot be resumed", so the spark would be started again beside it
  const resuming = new Set<string>();
  const svc = new SparkService({
    store: store(root),
    homes: join(root, "sparks"),
    requireSupport,
    profileSets: async () => SETS,
    runs: () => runs,
    spawn: async (launch, sparkId) => {
      calls.push("spawn");
      launched.push({ launch, spark: sparkId });
      return { runtimeRunId: `run-${launched.length}` };
    },
    resume: async (runtimeRunId) => {
      calls.push(`resume:${runtimeRunId}`);
      if (resuming.has(runtimeRunId)) return undefined;
      resuming.add(runtimeRunId);
      try {
        await held;
        return resumable ? { runtimeRunId: `${runtimeRunId}-b` } : undefined;
      } finally {
        resuming.delete(runtimeRunId);
      }
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
    /** Hold every resume until the returned call: it answers, or refuses with `error`. */
    holdResume: () => {
      let settle: (error?: Error) => void = () => undefined;
      held = new Promise<void>((resolve, reject) => {
        settle = (error) => (error === undefined ? resolve() : reject(error));
      });
      return settle;
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
  it("refuses unsupported briefing support before creating a spark's folder or record", async () => {
    const h = service([], () => {
      throw new Error("unsupported briefing");
    });
    await expect(h.svc.hatch(HATCH, h.principal)).rejects.toThrow("unsupported briefing");
    expect(h.svc.list()).toEqual([]);
    expect(h.launched).toEqual([]);
    expect(existsSync(join(h.root, "sparks"))).toBe(false);
  });

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
    expect(h.calls).toEqual(["spawn"]);
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
    expect(h.calls).toEqual(["resume:run-1"]);
    expect(h.svc.get(vela.id)?.session).toEqual({ runtimeRunId: "run-1-b" });
    h.notResumable();
    h.calls.length = 0;
    await h.svc.open(vela.id, h.principal);
    expect(h.calls).toEqual(["resume:run-1-b", "spawn"]);
    expect(h.svc.list().map((s) => s.name)).toEqual(["Vela"]);
  });

  it("answers an open asked while one is under way with that same wake: one resume, one run, for both callers", async () => {
    const h = service();
    const vela = await h.svc.hatch(HATCH, h.principal);
    h.calls.length = 0;
    const answer = h.holdResume();
    // two windows, or a window and the phone, open the sleeping spark at once
    const first = h.svc.open(vela.id, h.principal);
    const second = h.svc.open(vela.id, h.principal);
    answer();
    const [a, b] = await Promise.all([first, second]);
    expect(h.calls).toEqual(["resume:run-1"]);
    expect(h.launched).toHaveLength(1);
    expect(a.session).toEqual({ runtimeRunId: "run-1-b", live: false });
    expect(b).toEqual(a);
    expect(h.svc.get(vela.id)?.session).toEqual({ runtimeRunId: "run-1-b" });
    // answered, the wake is let go: the next open is a wake of its own
    h.calls.length = 0;
    await h.svc.open(vela.id, h.principal);
    expect(h.calls).toEqual(["resume:run-1-b"]);
  });

  it("refuses every caller of a wake that fails, and lets it go, so the next open wakes again", async () => {
    const h = service();
    const vela = await h.svc.hatch(HATCH, h.principal);
    h.calls.length = 0;
    const refuse = h.holdResume();
    const first = h.svc.open(vela.id, h.principal);
    const second = h.svc.open(vela.id, h.principal);
    refuse(new Error("the floor did not answer"));
    await expect(first).rejects.toThrow("the floor did not answer");
    await expect(second).rejects.toThrow("the floor did not answer");
    expect(h.calls).toEqual(["resume:run-1"]);
    expect(h.launched).toHaveLength(1);
    h.holdResume()();
    await h.svc.open(vela.id, h.principal);
    expect(h.calls).toEqual(["resume:run-1", "resume:run-1"]);
    expect(h.svc.get(vela.id)?.session).toEqual({ runtimeRunId: "run-1-b" });
  });
});

describe("TU-1 (Q1) — a spark says whether it has worked", () => {
  const T1 = "2026-10-29T12:05:00.000Z";
  const T2 = "2026-10-29T12:09:00.000Z";

  it("is hatched never having worked, on its signed record and in its summary", async () => {
    const h = service();
    const vela = await h.svc.hatch(HATCH, h.principal);
    expect(vela.turnedAt).toBeNull();
    expect(h.svc.get(vela.id)?.turnedAt).toBeNull();
    expect(store(h.root).get(vela.id)).toHaveProperty("turnedAt", null);
    expect(h.svc.list().map((s) => s.turnedAt)).toEqual([null]);
  });

  it("keeps the first time it is told, and a later one changes nothing; a spark from before TU-1 is told too; a spark set aside, or one whose record cannot be written, is left alone without a throw; `updatedAt` never moves", async () => {
    const h = service();
    const vela = await h.svc.hatch(HATCH, h.principal);
    const updatedAt = h.svc.get(vela.id)?.updatedAt;
    h.svc.turned(vela.id, T1);
    h.svc.turned(vela.id, T2);
    expect(h.svc.get(vela.id)?.turnedAt).toBe(T1);
    expect(h.svc.get(vela.id)?.updatedAt).toBe(updatedAt);
    expect(h.svc.list().find((s) => s.id === vela.id)?.turnedAt).toBe(T1);

    // a spark from before TU-1 says nothing, and is told as a hatched one is
    const older = spark({ id: "sp-0123456789abcdef", name: "Juno", folder: "/f/sparks/juno" });
    store(h.root).write(older);
    expect(h.svc.get(older.id)).not.toHaveProperty("turnedAt");
    h.svc.turned(older.id, T2);
    expect(h.svc.get(older.id)).toEqual({ ...older, turnedAt: T2 });

    // one an agent edited is set aside: not read, not written over (item 172: renamed beside itself, as the other
    // stores' are, where it was only said before)
    const forged = spark({ id: "sp-fedcba9876543210", name: "Lyra", folder: "/f/sparks/lyra" });
    store(h.root).write(forged);
    const path = store(h.root).path(forged.id);
    const signed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...signed, profiles: ["work", "native", "home"] }), {
      mode: 0o600,
    });
    const bytes = readFileSync(path, "utf8");
    expect(() => h.svc.turned(forged.id, T1)).not.toThrow();
    const asides = readdirSync(join(h.root, "fieldd", "sparks")).filter((name) =>
      name.startsWith(`${forged.id}.json.forged-`),
    );
    expect(asides).toHaveLength(1);
    expect(readFileSync(join(h.root, "fieldd", "sparks", asides[0] ?? ""), "utf8")).toBe(bytes);
    expect(() => h.svc.turned("sp-0000000000000000", T1)).not.toThrow();

    // a record that cannot be written keeps what it says, and the caller hears no throw
    const pyxis = await h.svc.hatch({ ...HATCH, name: "Pyxis" }, h.principal);
    const dir = join(h.root, "fieldd", "sparks");
    chmodSync(dir, 0o500);
    try {
      expect(() => h.svc.turned(pyxis.id, T1)).not.toThrow();
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(h.svc.get(pyxis.id)?.turnedAt).toBeNull();
  });

  it("keeps a turn told while a wake's resume is under way: the wake keeps the record as it stands on disk (D6)", async () => {
    const h = service();
    const vela = await h.svc.hatch(HATCH, h.principal);
    const answer = h.holdResume();
    const waking = h.svc.open(vela.id, h.principal);
    // the spark's record moves while the resume is held: its run took a turn
    const records = store(h.root);
    const current = records.get(vela.id);
    if (current === undefined) throw new Error("the hatched spark's record did not read back");
    records.write({ ...current, turnedAt: T1 });
    answer();
    await waking;
    expect(h.svc.get(vela.id)?.session).toEqual({ runtimeRunId: "run-1-b" });
    expect(h.svc.get(vela.id)?.turnedAt).toBe(T1);
  });

  it("produces what the sparks golden shows: every key a summary carries is the golden's, and each of the golden's three states (EL9)", async () => {
    const golden = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "..",
          "..",
          "contracts",
          "fixtures",
          "compose-sparks-list.turned.json",
        ),
        "utf8",
      ),
    ) as { sparks: Array<Record<string, unknown>> };
    const goldenKeys = new Set(golden.sparks.flatMap((s) => Object.keys(s)));
    const stateOf = (s: Record<string, unknown>) =>
      !("turnedAt" in s) ? "absent" : s["turnedAt"] === null ? "null" : typeof s["turnedAt"];
    const h = service();
    await h.svc.hatch(HATCH, h.principal);
    const lyra = await h.svc.hatch({ ...HATCH, name: "Lyra" }, h.principal);
    h.svc.turned(lyra.id, T1);
    store(h.root).write(
      spark({ id: "sp-0123456789abcdef", name: "Juno", folder: "/f/sparks/juno" }),
    );
    const produced = h.svc.list() as unknown as Array<Record<string, unknown>>;
    for (const summary of produced)
      expect(Object.keys(summary).filter((key) => !goldenKeys.has(key))).toEqual([]);
    expect(new Set(produced.map(stateOf))).toEqual(new Set(golden.sparks.map(stateOf)));
    expect(new Set(produced.map(stateOf))).toEqual(new Set(["absent", "null", "string"]));
  });
});
