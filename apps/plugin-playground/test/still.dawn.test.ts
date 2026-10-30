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
//    named flag — it reads none of the hand a still lends, so it is drawn as a still always was (its desk state would read
//    the wall clock); and, staged exactly as ICE stages its own clock still, it draws ICE's committed golden byte for byte —
//    the port, the product's type build and the still door all ICE's, pixel for pixel;
//  - the comment pad (plugins/comment-pad — VibeField's own first kind): held to ITS golden over its four playground states,
//    blessed once by the named flag — its dress AND its writing (DK-17b; ICE I35): a still lends the desk's hand
//    (`TEXT_RASTER`, the product's faces on a Node canvas) and the pad reads it, so `written` and `long` carry their
//    comments, each inside the pad's own box;
//  - the browser pane (plugins/browser-pane — PORTALS' first kind, PT-1): held to ITS golden over its five playground states (PT-2's
//    `live` a web page's face, filled by `stillLive` over the pane's own playground/live.ts — the one that READS what was lent),
//    blessed once by the named flag — it reads none of the desk's hand (its head is its own lent service's, and a Node still
//    draws the committed heads); and a PHONE-SIZE pane, drawn at a phone's cut, judged by its face's colour count and
//    contrast, never a hash: its page the phone's own 66.59 mm display across, light with contrast by day and dark by night,
//    its head frosted.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { WidgetType } from "@vibecook/ice";
import { createStill, service, TEXT_RASTER } from "@vibecook/ice/desk";
import type { ObjectContribution } from "@vibefield/contracts";
import { buildObjectType } from "@vibefield/field-app/object-types";
import type { ObjectBinding } from "@vibefield/plugin-sdk";
import { kindOfBinding, productPalette } from "@vibefield/plugin-sdk/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STILL_GOLDEN, type StillGolden, type StillGpu, stillFrame, stillGpu } from "../src/still";
import { stillTextRaster } from "../src/text-raster";
import type { RunSummary, StillVerdict, Verdict } from "../src/verdict";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, "..", "bin", "plugin-playground.mjs");
const REPO = resolve(HERE, "..", "..", "..");
const FIXTURE = join(HERE, "fixtures", "still-kinds");
const CLOCK = join(REPO, "examples", "plugins", "desk-clock");
const PAD = join(REPO, "plugins", "comment-pad");
const PANE = join(REPO, "plugins", "browser-pane");

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

it("keeps Dawn alive through device loss, then releases it without a crash or a leaked event loop", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--expose-gc", join(HERE, "fixtures", "still-gpu-lifetime.mjs")],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  expect(stdout).toContain('"phase":"complete"');
  expect(stdout.match(/"phase":"collected"/gu)).toHaveLength(12);
});

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
    // DK-17b: it reads none of the desk's hand, so it is drawn with no desk state — a clock's would read the wall clock
    for (const s of ran.stills) expect(s.lent, `${s.state} · ${s.theme}`).toBeUndefined();
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
      await gpu.destroy();
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

  it("draws its dress AND its writing (DK-17b; ICE I35): it reads the desk's hand a still lends, so each state is its own", () => {
    // the pad writes through the host's TEXT_RASTER, which a still now lends (the product's faces on a Node canvas) — so its
    // comments are in its still: `written` and `long` differ from the blank pad and from each other, and its accent still does
    const sha = (state: string, theme: string) =>
      ran.stills.find((s) => s.state === state && s.theme === theme)?.sha256;
    for (const theme of ["day", "night"]) {
      expect(sha("written", theme), theme).not.toBe(sha("default", theme));
      expect(sha("long", theme), theme).not.toBe(sha("default", theme));
      expect(sha("long", theme), theme).not.toBe(sha("written", theme));
      expect(sha("pink", theme), theme).not.toBe(sha("default", theme));
    }
    for (const s of ran.stills) expect(s.lent, `${s.state} · ${s.theme}`).toEqual(["text"]);
  });

  it("lays its writing INSIDE its box: every pixel the hand changes on the blank pad lies within the pad's own rect", async () => {
    const gpu: StillGpu = await stillGpu();
    try {
      const text = await stillTextRaster();
      const mod = (await import(/* @vite-ignore */ join(PAD, "src", "index.ts"))) as {
        readonly commentPad: ObjectBinding;
        readonly commentPadManifest: {
          readonly contributes?: { readonly objects?: readonly ObjectContribution[] };
        };
      };
      const states = (
        (await import(/* @vite-ignore */ join(PAD, "playground", "states.ts"))) as {
          readonly default: Record<string, Record<string, Readonly<Record<string, unknown>>>>;
        }
      ).default["vibefield.comment-pad"];
      const row = mod.commentPadManifest.contributes?.objects?.[0] as ObjectContribution;
      const type: WidgetType = buildObjectType({ ...row, behaviors: [] }, mod.commentPad);
      const frame = stillFrame(row.size, kindOfBinding(mod.commentPad)?.reach ?? 0);
      const draw = (props: Readonly<Record<string, unknown>>) =>
        createStill({
          device: gpu.device,
          format: "rgba8unorm",
          size: frame.size,
          dpr: 2,
          objects: [type],
          theme: "light",
          palette: productPalette.light,
          services: [service(TEXT_RASTER, text)],
          stage: ({ engine }) => {
            engine.ops.spawnWidget(row.type, {
              x: frame.at.x,
              y: frame.at.y,
              w: row.size.w,
              h: row.size.h,
              props: { ...props },
              undoable: false,
            });
          },
        });
      const blank = await draw(states?.["default"] ?? {});
      for (const state of ["written", "long"]) {
        const written = await draw(states?.[state] ?? {});
        let changed = 0;
        let outside = 0;
        for (let y = 0; y < written.height; y += 1)
          for (let x = 0; x < written.width; x += 1) {
            const i = (y * written.width + x) * 4;
            if (
              written.rgba[i] === blank.rgba[i] &&
              written.rgba[i + 1] === blank.rgba[i + 1] &&
              written.rgba[i + 2] === blank.rgba[i + 2]
            )
              continue;
            changed += 1;
            const inside =
              x >= frame.box.x0 && x < frame.box.x1 && y >= frame.box.y0 && y < frame.box.y1;
            if (!inside) outside += 1;
          }
        expect(changed, state).toBeGreaterThan(2_000);
        expect(outside, state).toBe(0);
        written.dispose();
      }
      blank.dispose();
    } finally {
      await gpu.destroy();
    }
  });
});

describe("the browser pane — PORTALS' first kind (PT-1)", () => {
  let ran: Ran;
  beforeAll(async () => {
    ran = await still(PANE);
  });

  it("is held to its golden: its five playground states by day and by night, blessed once by the named flag", () => {
    expect(ran.code).toBe(0);
    expect(ran.stills.map((s) => `${s.state} · ${s.theme}: ${s.code}`)).toEqual([
      "default · day: ok",
      "smoke · day: ok",
      "bronze · day: ok",
      "blank · day: ok",
      "live · day: ok",
      "default · night: ok",
      "smoke · night: ok",
      "bronze · night: ok",
      "blank · night: ok",
      "live · night: ok",
    ]);
    for (const s of ran.stills) expect(s.detail).toContain("held to its golden");
  });

  it("reads none of the desk's hand — its head is its own service's, and a Node still draws the committed heads — but a web page READS the faces lent (PT-2), and each state is its own", () => {
    for (const s of ran.stills)
      expect(s.lent, `${s.state} · ${s.theme}`).toEqual(s.state === "live" ? ["live"] : undefined);
    for (const theme of ["day", "night"]) {
      const shas = ran.stills.filter((s) => s.theme === theme).map((s) => s.sha256);
      expect(new Set(shas).size, theme).toBe(5);
    }
  });

  it("a PHONE-SIZE pane — drawn at a phone's cut: its page the phone's own display across, light with contrast by day and dark by night, its head frosted (judged by colour count and contrast, never a hash)", async () => {
    const gpu: StillGpu = await stillGpu();
    try {
      const mod = (await import(/* @vite-ignore */ join(PANE, "src", "index.ts"))) as {
        readonly browserPane: ObjectBinding;
        readonly browserPaneManifest: {
          readonly contributes?: { readonly objects?: readonly ObjectContribution[] };
        };
        readonly cutOf: (d: unknown) => { readonly w: number; readonly h: number };
        readonly deviceById: (id: string) => unknown;
        readonly shapeOf: (
          size: { readonly w: number; readonly h: number },
          d: unknown,
        ) => {
          readonly half: readonly [number, number];
          readonly page: readonly [number, number, number, number];
          readonly band: number;
          readonly viewport: readonly [number, number];
        };
        readonly MM: number;
        readonly IPHONE_17_PRO_DISPLAY_MM: number;
      };
      const row = mod.browserPaneManifest.contributes?.objects?.[0] as ObjectContribution;
      const type: WidgetType = buildObjectType({ ...row, behaviors: [] }, mod.browserPane);
      const phone = mod.deviceById("phone");
      const cut = mod.cutOf(phone);
      const S = mod.shapeOf(cut, phone);
      expect(S.viewport).toEqual([402, 874]);
      const frame = stillFrame(cut, kindOfBinding(mod.browserPane)?.reach ?? 0);
      const dpr = 2;
      const draw = (theme: "light" | "dark") =>
        createStill({
          device: gpu.device,
          format: "rgba8unorm",
          size: frame.size,
          dpr,
          objects: [type],
          theme,
          palette: productPalette[theme],
          stage: ({ engine }) => {
            engine.ops.spawnWidget(row.type, {
              x: frame.at.x,
              y: frame.at.y,
              w: cut.w,
              h: cut.h,
              props: { device: "phone" },
              undoable: false,
            });
          },
        });
      // world (the pane's own frame, its centre the world's origin at the still's centre) → the still's device px
      const W = frame.size.width;
      const H = frame.size.height;
      const px = (x: number, y: number) =>
        [Math.round((x + W / 2) * dpr), Math.round((y + H / 2) * dpr)] as const;
      const region = (
        shot: { readonly width: number; readonly rgba: Uint8Array },
        x0: number,
        y0: number,
        x1: number,
        y1: number,
      ) => {
        const [a, b] = px(x0, y0);
        const [c, d] = px(x1, y1);
        const colours = new Set<number>();
        let min = 255;
        let max = 0;
        let sum = 0;
        let n = 0;
        for (let y = b; y < d; y++)
          for (let x = a; x < c; x++) {
            const i = (y * shot.width + x) * 4;
            const r = shot.rgba[i] as number;
            const g = shot.rgba[i + 1] as number;
            const bl = shot.rgba[i + 2] as number;
            colours.add(((r >> 3) << 10) | ((g >> 3) << 5) | (bl >> 3));
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
            min = Math.min(min, luma);
            max = Math.max(max, luma);
            sum += luma;
            n += 1;
          }
        return { colours: colours.size, min, max, mean: sum / Math.max(n, 1), n };
      };
      const [pcx, pcy, phx, phy] = S.page;
      const day = await draw("light");
      const night = await draw("dark");
      try {
        // the page, inset from its edges: a light page with dark bars on it (its contrast), its colours many
        const page = region(day, pcx - phx + 4, pcy - phy + 4, pcx + phx - 4, pcy + phy - 4);
        expect(page.colours, "page colours by day").toBeGreaterThan(25);
        expect(page.max - page.min, "page contrast by day").toBeGreaterThan(150);
        expect(page.mean, "page mean luma by day").toBeGreaterThan(160);
        const dark = region(night, pcx - phx + 4, pcy - phy + 4, pcx + phx - 4, pcy + phy - 4);
        // by night the page follows the desk into its dark scheme: under half the day page's light
        expect(dark.mean, "page mean luma by night (the desk's scheme)").toBeLessThan(
          page.mean / 2,
        );
        expect(dark.colours, "page colours by night").toBeGreaterThan(20);
        // the page is the phone's own display across (66.59 mm): from the first light pixel to the last on a row near its
        // top, where its ground reaches both of its edges
        const [, rowY] = px(0, pcy - phy * 0.94);
        let first = -1;
        let last = -1;
        for (let x = 0; x < day.width; x++) {
          const i = (rowY * day.width + x) * 4;
          const luma =
            0.2126 * (day.rgba[i] as number) +
            0.7152 * (day.rgba[i + 1] as number) +
            0.0722 * (day.rgba[i + 2] as number);
          if (luma > 150) {
            if (first < 0) first = x;
            last = x;
          }
        }
        // the eye's parallax magnifies the face a hair (~1 %): within 3 % of the display's width
        const display = mod.IPHONE_17_PRO_DISPLAY_MM * mod.MM * dpr;
        const across = last - first + 1;
        expect(
          Math.abs(across - display) / display,
          `${across} px across vs ${display}`,
        ).toBeLessThan(0.03);
        // the head: its capsule frosted pale over the mat's green (the committed compact head — the address alone)
        const top = -S.half[1];
        const head = region(day, -S.half[0] + 14, top + 6, S.half[0] - 14, S.band - 6);
        const mat = region(day, -S.half[0] - 60, top - 60, -S.half[0] - 30, top - 30);
        expect(head.max - mat.mean, "the frost over the mat").toBeGreaterThan(80);
        expect(head.colours, "the head's colours").toBeGreaterThan(20);
      } finally {
        day.dispose();
        night.dispose();
      }
    } finally {
      await gpu.destroy();
    }
  });
});
