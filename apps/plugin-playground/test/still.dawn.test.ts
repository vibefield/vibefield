// THE STILLS ON DAWN (DK-11; ICE petition I30, `createStill`): the bin's `--still`, spawned as an author or an agent spawns
// it, drawing on Node's WebGPU (the `webgpu` package — this CLI's devDependency). Not part of `test` (vitest.config.ts
// excludes it): CI's hosts carry no GPU the goldens were blessed on, and a golden is Dawn's bytes on the host that blessed
// it. `pnpm still` runs it. What it holds:
//  - the still fixture's kinds — each passes the kind harness and is refused by its STILL its own way: drawn nothing
//    (`still-blank`), a WGSL type error the harness's reading cannot see (`still-failed`, the compiler's own line at the
//    file's line and column), drawn past its reach (`still-past-reach`), a colour that moves (`still-unsteady`) — beside one
//    drawn whole;
//  - the create-plugin template, scaffolded as an author scaffolds it (nothing installed): blessed ONCE by the named flag,
//    then held; a still that moved is refused against its golden, naming the host; a `--state` bless mends that one state
//    and keeps the rest;
//  - under strata's DEV build (`node --conditions=development`, as vitest loads it) every still names ICE core's `Tray`
//    line as core's, on its own row;
//  - the desk clock (examples/plugins/desk-clock — ICE's kind ported as a plugin): held to ITS golden, blessed once by the
//    named flag; and, staged exactly as ICE stages its own clock still, it draws ICE's committed golden byte for byte —
//    the port, the product's type build and the still door all ICE's, pixel for pixel;
//  - the comment pad (plugins/comment-pad — VibeField's own first kind): held to ITS golden over its four playground states,
//    blessed once by the named flag — its dress drawn, its writing NOT: a still lends no host service, so no text raster.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { WidgetType } from "@vibecook/ice";
import { createStill } from "@vibecook/ice/desk";
import type { ObjectContribution } from "@vibefield/contracts";
import { buildObjectType } from "@vibefield/field-app/object-types";
import type { ObjectBinding } from "@vibefield/plugin-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STILL_GOLDEN, type StillGolden, type StillGpu, stillGpu } from "../src/still";
import type { RunSummary, StillVerdict, Verdict } from "../src/verdict";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, "..", "bin", "plugin-playground.mjs");
const REPO = resolve(HERE, "..", "..", "..");
const FIXTURE = join(HERE, "fixtures", "still-kinds");
const CLOCK = join(REPO, "examples", "plugins", "desk-clock");
const PAD = join(REPO, "plugins", "comment-pad");

interface Ran {
  readonly code: number;
  readonly stills: StillVerdict[];
  readonly summary: RunSummary;
  readonly stderr: string;
}

/** The bin with `--still --json` over `dir`; `node` are Node's own flags before it. */
async function still(
  dir: string,
  args: readonly string[] = [],
  node: readonly string[] = [],
): Promise<Ran> {
  let out: { code: number; stdout: string; stderr: string };
  try {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [...node, BIN, dir, "--still", "--json", ...args],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    out = { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    out = { code: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
  const rows = out.stdout
    .trim()
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as Verdict);
  const summary = rows.at(-1) as RunSummary;
  if (summary?.kind !== "summary")
    throw new Error(`no summary line — exit ${out.code}: ${out.stderr}`);
  return {
    code: out.code,
    stills: rows.filter((v): v is StillVerdict => v.kind === "still"),
    summary,
    stderr: out.stderr,
  };
}

const short = (type: string): string => type.slice(type.lastIndexOf(".") + 1);
const byKind = (stills: readonly StillVerdict[]): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const s of stills) {
    const rows = out[short(s.type)] ?? [];
    rows.push(`${s.state} · ${s.theme}: ${s.code}`);
    out[short(s.type)] = rows;
  }
  return out;
};

let root: string;
let scaffold: string;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "dk-11-still-"));
  scaffold = join(root, "demo");
  await promisify(execFile)(process.execPath, [
    join(REPO, "tooling", "create-plugin", "bin", "create-plugin.mjs"),
    "--id",
    "vendor.demo",
    "--title",
    "Demo",
    "--dir",
    scaffold,
  ]);
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(join(FIXTURE, ".vibefield-still"), { recursive: true, force: true });
});

describe("--still over kinds the harness passes and only a still refuses", () => {
  it("answers each kind with its own still verdict — the type error as Dawn's compiler says it, at its line and column", async () => {
    const ran = await still(FIXTURE);
    expect(ran.code).toBe(1);
    const each = (code: string) => [`default · day: ${code}`, `default · night: ${code}`];
    expect(byKind(ran.stills)).toEqual({
      drawn: each("still-unblessed"),
      blank: each("still-blank"),
      uncompiled: each("still-failed"),
      "past-reach": each("still-past-reach"),
      unsteady: each("still-unsteady"),
    });
    const failed = ran.stills.find((s) => short(s.type) === "uncompiled");
    expect(failed?.detail).toContain(
      "uncompiled.wgsl:42:7  cannot initialize 'let' of type 'f32' with value of type 'u32'",
    );
    // the whole one is drawn, its WGSL compiled, a PNG for a reader's eye
    const whole = ran.stills.find((s) => short(s.type) === "drawn");
    expect(whole).toMatchObject({ status: "note", width: 368, height: 368 });
    expect(existsSync(whole?.png as string)).toBe(true);
    expect(ran.summary).toMatchObject({ objects: 5, stills: 10, refused: 8, exit: 1 });
  });
});

describe("the create-plugin template, scaffolded with nothing installed: blessed once by the named flag, then held", () => {
  const golden = (): StillGolden =>
    JSON.parse(readFileSync(join(scaffold, STILL_GOLDEN), "utf8")) as StillGolden;

  it("says each state unblessed until a golden is blessed — then `--bless` writes one, naming this host", async () => {
    const before = await still(scaffold);
    expect(before.code).toBe(0);
    expect(new Set(before.stills.map((s) => s.code))).toEqual(new Set(["still-unblessed"]));
    const blessed = await still(scaffold, ["--bless"]);
    expect(blessed.code).toBe(0);
    expect(blessed.stills.map((s) => `${s.state} · ${s.theme}`)).toEqual([
      "default · day",
      "coral · day",
      "unparsed · day",
      "default · night",
      "coral · night",
      "unparsed · night",
    ]);
    for (const s of blessed.stills) expect(s.detail).toContain("BLESSED");
    const g = golden();
    expect(g.host).toMatch(/· webgpu 0\.4\.0$/);
    expect(Object.keys(g.stills)).toHaveLength(6);
    expect(g.stills["vendor.demo:coral:night"]).toMatchObject({ width: 368, height: 368 });
  });

  it("holds every still to it — and refuses one whose golden says other bytes, naming the host that blessed it", async () => {
    const held = await still(scaffold);
    expect(held.code).toBe(0);
    for (const s of held.stills) expect(s).toMatchObject({ status: "pass", code: "ok" });
    const g = golden();
    const tampered: StillGolden = {
      host: g.host,
      stills: {
        ...g.stills,
        "vendor.demo:coral:day": { width: 368, height: 368, sha256: "0".repeat(64) },
      },
    };
    writeFileSync(join(scaffold, STILL_GOLDEN), `${JSON.stringify(tampered, null, 2)}\n`);
    const moved = await still(scaffold);
    expect(moved.code).toBe(1);
    expect(
      moved.stills
        .filter((s) => s.status === "refused")
        .map((s) => `${s.state} · ${s.theme}: ${s.code}`),
    ).toEqual(["coral · day: still-golden-mismatch"]);
    expect(moved.stills.find((s) => s.code === "still-golden-mismatch")?.detail).toContain(
      `blessed on ${g.host}`,
    );
  });

  it("a --state bless mends that one state and keeps the rest of this host's golden", async () => {
    const before = golden();
    const mended = await still(scaffold, ["--bless", "--state", "vendor.demo:coral"]);
    expect(mended.code).toBe(0);
    expect(mended.stills.map((s) => `${s.state} · ${s.theme}`)).toEqual([
      "coral · day",
      "coral · night",
    ]);
    const after = golden();
    expect(Object.keys(after.stills)).toHaveLength(6);
    expect(after.stills["vendor.demo:default:day"]).toEqual(
      before.stills["vendor.demo:default:day"],
    );
    expect(after.stills["vendor.demo:coral:day"]?.sha256).not.toBe("0".repeat(64));
    expect((await still(scaffold)).code).toBe(0);
  });
});

describe("under strata's dev build, a still says nothing of ICE's (desk.5, I34)", () => {
  it("each still's row says nothing — core's two Tray writers are ordered, so strata's access check is quiet at every engine a still makes", async () => {
    const ran = await still(
      scaffold,
      ["--state", "vendor.demo:default"],
      ["--conditions=development"],
    );
    expect(ran.code).toBe(0);
    expect(ran.stills).toHaveLength(2);
    // three stills are drawn for each row — the state twice, the bare mat once — and not one engine says a line (until
    // desk.5 each said strata's `Tray` warning: ICE core's `trayInput` and `trayLay` shared a write in one phase)
    for (const s of ran.stills) expect(s.said).toBeUndefined();
    // and the bin under Node's default conditions (strata's production build) is as quiet
    const quiet = await still(scaffold, ["--state", "vendor.demo:default"]);
    for (const s of quiet.stills) expect(s.said).toBeUndefined();
  });
});

/** ICE's own clock still — `examples/desk-clock/test/still.ts` and its `test/still.golden.json` at 0.15.0-desk.3 (ICE
 * `189c84d`): three 150-unit dials at 2026-09-28 10:08:42 UTC (the oracle's hour), 480 × 200 CSS px at dpr 2, ICE's still
 * palette. A golden is Dawn's bytes on the host that blessed it — this suite's host draws them. */
const ICE_CLOCK = {
  at: Date.UTC(2026, 8, 28, 10, 8, 42),
  dials: [
    { cx: -160, props: { style: "classic", zone: "+00:00" } },
    { cx: 0, props: { style: "station", ring24: true, zone: "+09:00" } },
    { cx: 160, props: { style: "graphite", seconds: false, zone: "-05:00" } },
  ],
  golden: {
    light: "27fe69ee68f5e3886673f34376af7993e9aa88c310728b8d3ae09f1a84e3dd33",
    dark: "9285a72f63a5cb59de1ad80fc9a5879991bbc5a6d2957c6c2a49b0155f707107",
  },
} as const;

describe("the desk clock — ICE's kind as VibeField's plugin", () => {
  it("is held to its golden: its default state by day and by night, blessed once by the named flag", async () => {
    const ran = await still(CLOCK);
    expect(ran.code).toBe(0);
    expect(ran.stills.map((s) => `${s.state} · ${s.theme}: ${s.code}`)).toEqual([
      "default · day: ok",
      "default · night: ok",
    ]);
    for (const s of ran.stills) expect(s.detail).toContain("held to its golden");
  });

  it("draws ICE's own clock still byte for byte, staged as ICE stages it — through the product's type build", async () => {
    const gpu: StillGpu = await stillGpu();
    try {
      // the clock's code half and durable half, as the plugin ships them (its .wgsl inlined as text by the config's plugin)
      const src = join(CLOCK, "src", "index.ts");
      const mod = (await import(/* @vite-ignore */ src)) as {
        readonly clock: ObjectBinding;
        readonly deskClockManifest: {
          readonly contributes?: { readonly objects?: readonly ObjectContribution[] };
        };
      };
      const row = mod.deskClockManifest.contributes?.objects?.[0] as ObjectContribution;
      const type: WidgetType = buildObjectType({ ...row, behaviors: [] }, mod.clock);
      for (const theme of ["light", "dark"] as const) {
        const shot = await createStill({
          device: gpu.device,
          format: "rgba8unorm",
          size: { width: 480, height: 200 },
          dpr: 2,
          objects: [type],
          theme,
          stage: ({ engine, pinAsset }) => {
            for (const d of ICE_CLOCK.dials) {
              const e = engine.ops.spawnWidget(row.type, {
                x: d.cx - 75,
                y: -75,
                w: 150,
                h: 150,
                props: { ...d.props },
                undoable: false,
              });
              pinAsset(e, { at: ICE_CLOCK.at });
            }
          },
        });
        expect([shot.width, shot.height]).toEqual([960, 400]);
        expect(createHash("sha256").update(shot.rgba).digest("hex"), theme).toBe(
          ICE_CLOCK.golden[theme],
        );
        shot.dispose();
      }
    } finally {
      gpu.destroy();
    }
  });
});

describe("the comment pad — VibeField's own first kind", () => {
  let ran: Ran;
  beforeAll(async () => {
    ran = await still(PAD);
  });

  it("is held to its golden: its four playground states by day and by night, blessed once by the named flag", () => {
    expect(ran.code).toBe(0);
    expect(ran.stills.map((s) => `${s.state} · ${s.theme}: ${s.code}`)).toEqual([
      "default · day: ok",
      "written · day: ok",
      "long · day: ok",
      "pink · day: ok",
      "default · night: ok",
      "written · night: ok",
      "long · night: ok",
      "pink · night: ok",
    ]);
  });

  it("draws its dress and not its writing: a still lends no text raster, so `written` and `long` are the blank pad's bytes", () => {
    // ICE's `createStill` hands a kind no host service — the pad writes through the host's TEXT_RASTER — so its comments
    // are not in its still; its accent is. When a still can carry a text raster this row turns, and the golden is re-blessed.
    const sha = (state: string, theme: string) =>
      ran.stills.find((s) => s.state === state && s.theme === theme)?.sha256;
    for (const theme of ["day", "night"]) {
      expect(sha("written", theme), theme).toBe(sha("default", theme));
      expect(sha("long", theme), theme).toBe(sha("default", theme));
      expect(sha("pink", theme), theme).not.toBe(sha("default", theme));
    }
  });
});
