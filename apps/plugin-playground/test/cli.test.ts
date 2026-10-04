// The bin itself, as a subprocess — because the exit code and the NDJSON ARE the
// product. Everything else in this package can be right while the thing an agent
// or a CI job actually calls is wrong, and only spawning it proves otherwise.
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { RunSummary, Verdict } from "../src/index";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, "..", "bin", "plugin-playground.mjs");
const REPO = resolve(HERE, "..", "..", "..");
const FIXTURES = join(HERE, "fixtures");

const run = promisify(execFile);

interface Spawned {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function spawn(...args: string[]): Promise<Spawned> {
  try {
    const { stdout, stderr } = await run(process.execPath, [BIN, ...args], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

// DK-5 (desk/landing): the rows that judged the note plugin's states by MOUNTING its React face
// in happy-dom retired with that verdict — the desk draws object kinds, and a widget row binds no
// face since DK-2. What the bin answers now (DK-7, the playground v2): an object kind JUDGED by the
// kind-conformance harness — its row with the export its binding names, the count of states the
// harness drove and its first refusal as a FIELD (`null` when it passed), then the harness's own rows
// (`kind`) — and a widget state judged on its props against the declared schema, with nothing
// mounted. The subject with an object kind is the repo's own: behavior-conformance's carrier (an
// `objects` row since DK-4); the refused one is the fixture of kinds broken one way each.
const KIND_PLUGIN = join(REPO, "examples", "plugins", "behavior-conformance");

describe("the bin", () => {
  it("emits one NDJSON verdict per row and a summary line: the kind's row (its states DRIVEN, a null refusal) and the harness's rows", async () => {
    const { code, stdout } = await spawn(KIND_PLUGIN, "--json");
    expect(code).toBe(0);
    const lines = stdout.trim().split("\n");
    const parsed = lines.map((l) => JSON.parse(l) as Verdict);
    // every line is a verdict, and the LAST one is the summary
    for (const v of parsed.slice(0, -1)) expect(v.kind).not.toBe("summary");
    const summary = parsed.at(-1) as RunSummary;
    expect(summary).toMatchObject({
      kind: "summary",
      plugin: "vibefield.behavior-conformance",
      objects: 1,
      refused: 0,
      exit: 0,
    });
    // the manifest's object, judged: its type, the export that draws it, the states the harness
    // DROVE (its one fixture × idle, selected, held × 20 zooms + at rest by night — it hangs nowhere,
    // so no hang zoom), and the refusal as a FIELD that reads null — never a missing code
    const objects = parsed.filter((v) => v.kind === "object");
    expect(objects).toEqual([
      {
        kind: "object",
        plugin: "vibefield.behavior-conformance",
        type: "vibefield.behavior-conformance.card",
        binding: "card",
        states: 3 * 20 + 1,
        refusal: null,
      },
    ]);
    expect(summary.states).toBe(3 * 20 + 1);
    // …then the harness's own rows, one per verdict: the declaration, the program, the fixture
    expect(
      parsed.filter((v) => v.kind === "kind").map((v) => "subject" in v && [v.subject, v.status]),
    ).toEqual([
      ["declaration", "pass"],
      ["program", "pass"],
      ["defaults", "pass"],
    ]);
    // the exit code IS the summary's claim, not a second opinion
    expect(code).toBe(summary.exit);
  }, 180_000);

  it("exits 1 when a state is refused, and the refusal carries code + pointer + expected", async () => {
    const { code, stdout } = await spawn(join(FIXTURES, "invalid-state"), "--json");
    expect(code).toBe(1);
    const parsed = stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Verdict);
    const refused = parsed.filter((v) => v.kind === "state" && v.status === "refused");
    expect(refused.length).toBe(4);
    for (const row of refused) {
      expect(row).toMatchObject({ code: "state-invalid" });
      expect("pointer" in row && row.pointer).toMatch(/^\/vibefield\.fixture-invalid\.card\//);
      expect("expected" in row && row.expected).toBeTruthy();
    }
    // the fixture's one valid state passes on its schema — and NOTHING MOUNTS: the verdict that
    // a React face "rendered N bytes of DOM" in happy-dom is gone, its spawn with it
    const valid = parsed.filter((v) => v.kind === "state" && v.status === "pass");
    expect(valid).toMatchObject([{ state: "ok" }]);
    expect(stdout).not.toMatch(
      /bytes of DOM|rendered no DOM|state-render-failed|state-spawn-failed/,
    );
    expect((parsed.at(-1) as RunSummary).exit).toBe(1);
  }, 180_000);

  it("exits 1 when a KIND is refused: each broken kind's row names its own code, its harness row the pointer and what passes", async () => {
    const { code, stdout } = await spawn(join(FIXTURES, "broken-kinds"), "--json");
    expect(code).toBe(1);
    const parsed = stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Verdict);
    const refusals = parsed.flatMap((v) =>
      v.kind === "object" && v.refusal !== null ? [v.refusal] : [],
    );
    expect(refusals).toEqual([
      "object-kind-misnamed",
      "object-export-missing",
      "object-kit-piece-unknown",
      "object-wgsl-unread",
      "state-hit-missed",
      "state-spawn-failed",
      "state-render-failed",
    ]);
    const misnamed = parsed.find((v) => v.kind === "kind" && v.code === "object-kind-misnamed");
    expect(misnamed).toMatchObject({
      status: "refused",
      subject: "declaration",
      pointer: "/contributes/objects/1/binding/kind",
      expected: 'name the kind "vibefield.fixture-broken-kinds.misnamed"',
    });
    expect((parsed.at(-1) as RunSummary).exit).toBe(1);
  }, 180_000);

  it("exits 2 — not 1 — when the CALLER is wrong rather than the plugin", async () => {
    const missing = await spawn(join(FIXTURES, "no-such-plugin-dir"));
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("no such directory");

    const noArgs = await spawn();
    expect(noArgs.code).toBe(2);

    const badFlag = await spawn(KIND_PLUGIN, "--nope");
    expect(badFlag.code).toBe(2);
  }, 180_000);

  it("prints a human table when --json is absent", async () => {
    const { code, stdout } = await spawn(KIND_PLUGIN);
    expect(code).toBe(0);
    expect(stdout).toContain("plugin-playground vibefield.behavior-conformance");
    expect(stdout).toMatch(
      /KIND\s+card\s+—\s+export card · 61 states driven by the kind harness · refusal: none/,
    );
    expect(stdout).toMatch(/PASS\s+card\s+declaration\s+`card` is a desk kind named by its type/);
    expect(stdout).toMatch(
      /\d+ passed · \d+ skipped · \d+ refused \(0 widgets, 61 states, 1 object\)/,
    );
    // the table is a projection of the same records, never JSON in disguise
    expect(stdout.trim().startsWith("{")).toBe(false);
  }, 180_000);
});
