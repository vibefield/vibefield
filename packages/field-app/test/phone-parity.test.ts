/**
 * PG-3a (Q-J1 (a), James 2026-11-01 03:55Z) — THE PHONE'S PARITY GOLDENS: the home's window over
 * the witness wire goldens, row for row, as the phone's Swift fold and body model will be held to
 * it (PG-3d, PG-3e) through the kit's byte-identical copies.
 *
 * The committed goldens ARE what the computation writes today (`perf/lib/phone-goldens.ts`): a
 * change to the fold, the replica's join, the window's rows, puppeteer's body model or the witness
 * moves them, and moving them is a deliberate regeneration (`phone:goldens`) whose commit says
 * what moved and why, never a quiet drift, and never over a defect (PG-3a0's rule: a defect the
 * goldens show is fixed in its own item first). The semantic rows below do not read the goldens'
 * bytes, so a re-bless cannot carry a behaviour past them.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentModelMeshFrame } from "@vibefield/contracts";
import { MONITOR_SKIN } from "@vibefield/puppeteer-view-sdk";
import { MONITOR_VIEWS } from "@vibefield/puppeteer-views";
import { beforeAll, describe, expect, it } from "vitest";
import {
  computePhoneGoldens,
  goldenChanges,
  orphanGoldens,
  PHONE_BODY_GOLDEN,
  PHONE_BODY_NOW_MS,
  PHONE_FOLD_GOLDEN,
  PHONE_GOLDEN_MIRRORS,
  PHONE_GOLDENS_COMMAND,
  PHONE_GOLDENS_DIR,
  PHONE_GOLDENS_LIB_DIR,
  PHONE_TOOLKIT_GOLDEN,
  PHONE_VIEW_GOLDENS,
  PHONE_VIEW_MIRROR,
  PHONE_VISIBLE,
  PHONE_WITNESS_INPUTS,
  type PhoneBodyStep,
  type PhoneFoldStep,
  type PhoneGoldens,
  type PhoneViewGoldens,
  phoneAllGoldenFiles,
  phoneGoldenMirrors,
  phoneViewGoldenName,
  phoneVisible,
  puppeteerVersions,
  readWitnessInputs,
  unregisteredViewFiles,
} from "../perf/lib/phone-goldens";
import { importPuppeteerViews } from "../perf/lib/puppeteer-views-path";
import { BoardScreen } from "../src/godview/monitor/board-screen";

const HOME = "dev-01HQ9S7UD1";
const LOFT = "dev-01HQ9S7XZ2";
const ATTIC = "dev-01HQ9S7Y44";

let goldens: PhoneGoldens;
beforeAll(async () => {
  goldens = await computePhoneGoldens(readWitnessInputs());
});

const foldAt = (at: PhoneFoldStep["at"]): PhoneFoldStep => {
  const found = goldens.fold.find((step) => step.at === at);
  if (found === undefined) throw new Error(`no fold step at ${at}`);
  return found;
};
const bodyAt = (at: PhoneFoldStep["at"]): PhoneBodyStep => {
  const found = goldens.body.find((step) => step.at === at);
  if (found === undefined) throw new Error(`no body step at ${at}`);
  return found;
};
const rowsOn = (step: PhoneFoldStep, device: string) =>
  (step.rows ?? []).filter((row) => row.device === device);

describe("PG-3a — the phone's parity goldens: the home's window over the witness", () => {
  it("the committed goldens are byte for byte what the computation writes (a regeneration is a re-bless, said)", async () => {
    // PG-4s: every golden the one writer writes (fold, body, the toolkit's and each registered view's)
    const files = await phoneAllGoldenFiles(goldens);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([PHONE_FOLD_GOLDEN, PHONE_BODY_GOLDEN, PHONE_TOOLKIT_GOLDEN]),
    );
    for (const [name, bytes] of Object.entries(files)) {
      const path = join(PHONE_GOLDENS_DIR, name);
      const mirrors = (PHONE_GOLDEN_MIRRORS[name] ?? []).map(
        (folder) => `cp packages/field-app/test/fixtures/phone-godview/${name} ${folder}/${name}`,
      );
      // an absent golden says what to run, never a bare ENOENT
      expect(
        existsSync(path),
        [
          `${name} is not committed: run ${PHONE_GOLDENS_COMMAND}, then copy it to the kit:`,
          ...mirrors.map((line) => `  ${line}`),
        ].join("\n"),
      ).toBe(true);
      const stored = readFileSync(path, "utf8");
      const moved = goldenChanges(stored, bytes);
      expect(
        stored === bytes,
        [
          `${name} is not what the computation writes; moved: ${moved.join("; ")}`,
          `If the move is meant, regenerate (${PHONE_GOLDENS_COMMAND}) and copy it to the kit (PG-3c on):`,
          ...mirrors.map((line) => `  ${line}`),
          "A regeneration is a re-bless: name the step, the field and the cause in the commit body. Never",
          "re-bless over a defect (PG-3a0's rule): a defect the golden shows is its own item, fixed first.",
        ].join("\n"),
      ).toBe(true);
    }
  });

  it("the fold golden's header states the visibility rule the computation hands the replica", () => {
    const stored = JSON.parse(readFileSync(join(PHONE_GOLDENS_DIR, PHONE_FOLD_GOLDEN), "utf8")) as {
      visible: unknown;
    };
    expect(stored.visible).toEqual(PHONE_VISIBLE);
    // and the rule says what the header says: alive, or a failure with a terminal join here
    const joined = new Map([["pty-h3", "pty-h3"]]);
    const visible = phoneVisible(joined);
    const row = (over: Record<string, unknown>) =>
      ({ id: "pty-h3", kind: "agent", alive: true, ...over }) as unknown as Parameters<
        typeof visible
      >[0];
    const failure = { alive: false, wait: { kind: "failure", since: 1 } };
    expect(visible(row({}))).toBe(true);
    expect(visible(row(failure))).toBe(true);
    expect(visible(row({ ...failure, id: "run-elsewhere" }))).toBe(false);
    expect(visible(row({ alive: false }))).toBe(false);
  });

  it("names the three puppeteer packages it was computed by, as installed (a puppeteer EL8 regenerates it)", async () => {
    // the pin's authority is the manifests (pnpm-workspace.yaml, preflight's PIN_EXPECTATIONS): no literal here
    const installed = puppeteerVersions();
    // PG-4s (G6b): every golden on disk the one writer writes, the toolkit's and each view's with fold and body
    const names = Object.keys(await phoneAllGoldenFiles(goldens));
    expect(names).toEqual(
      expect.arrayContaining([PHONE_FOLD_GOLDEN, PHONE_BODY_GOLDEN, PHONE_TOOLKIT_GOLDEN]),
    );
    for (const name of names) {
      const stored = JSON.parse(readFileSync(join(PHONE_GOLDENS_DIR, name), "utf8")) as {
        versions: unknown;
        "//": string;
      };
      expect(
        stored.versions,
        `${name} was computed by other puppeteer packages: ${PHONE_GOLDENS_COMMAND}, and copy it to the kit`,
      ).toEqual(installed);
      expect(stored["//"]).toMatch(/never over a defect/);
    }
  });

  it("the screen passes every witness frame as it came: nothing screened out shapes the golden", () => {
    const { open, deliveries } = readWitnessInputs();
    const screen = new BoardScreen();
    expect(screen.open(open)).toEqual(open);
    for (const delivery of deliveries) {
      if ("resync" in delivery) {
        expect(screen.open(delivery.resync)).toEqual(delivery.resync);
        continue;
      }
      expect(screen.frame(delivery.frame)).toEqual([delivery.frame]);
      expect(AgentModelMeshFrame.safeParse(delivery.frame).success).toBe(true);
    }
  });

  // Each step is a cut after ONE delivery, as the window draws if its frame lands there. Two frames
  // the owner sends back to back are two steps: a re-attached peer's snapshot and then its live
  // state (fieldd mesh-board.ts `#onUpstream`), so step 4's grey Loft is a cut 3d reproduces and
  // does not design for.
  it("one step per delivery up to the gap: PG-1c's resync after frame 7, the old chain's delta at 8 ends the run (M23)", () => {
    expect(goldens.fold.map((step) => step.at)).toEqual([
      "open",
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      "resync",
      8,
    ]);
    expect(foldAt(8)).toEqual({ at: 8, frame: "delta", gap: true });
    expect(bodyAt(8)).toEqual({ at: 8, frame: "delta", gap: true });
  });

  it("item 137 — the promotion in one delta keeps pty-h2, an agent now, updated in place", () => {
    const step = foldAt(0);
    expect(step.fold).toEqual({ upserts: ["pty-h2"], removed: [] });
    expect(step.changes).toEqual({ added: [], updated: ["pty-h2"], removed: [] });
    expect(step.rows?.find((row) => row.id === "pty-h2")).toMatchObject({ key: "run-h-typed" });
  });

  it("the fold's chain and the replica's publication differ on a frame that changes nothing", () => {
    // frame 2: the peer re-presented row for row: the fold moves its chain, the replica publishes nothing
    expect(foldAt(2).changes).toBeNull();
    expect(foldAt(2).fold?.upserts).toEqual(["pty-p3", "pty-p1", "run-p-done"]);
    expect(foldAt(2).foldRevision).toBe((foldAt(1).foldRevision ?? 0) + 1);
    expect(foldAt(2).modelRevision).toBe(foldAt(1).modelRevision);
    // a state frame moves neither
    expect(foldAt(3)).toMatchObject({
      fold: null,
      changes: null,
      foldRevision: foldAt(2).foldRevision,
    });
    // the re-attach publishes the answered question and the shell gone, at the fold's revision
    expect(foldAt(4).fold?.removed).toEqual(["pty-p1"]);
    expect(foldAt(4).changes).toEqual({ added: [], updated: ["pty-p3"], removed: ["pty-p1"] });
    expect(foldAt(4).modelRevision).toBe(foldAt(4).foldRevision);
  });

  it("J1 (a) — home rows are self and keep their owner's stale; a peer greys by its desktop's standing", () => {
    const open = foldAt("open");
    for (const row of open.rows ?? []) expect(row.self, row.id).toBe(row.device === HOME);
    // the owner calls h6 stale and p1 stale: the home keeps its own, a live peer's is its standing's
    expect(rowsOn(open, HOME).find((row) => row.id === "run-h-quiet")?.stale).toBe(true);
    expect(rowsOn(open, LOFT).find((row) => row.id === "pty-p3")?.stale).toBe(false);
    // an asleep desktop's rows are grey from the open
    expect(rowsOn(open, ATTIC).map((row) => [row.id, row.stale])).toEqual([["run-a-idle", true]]);
    for (const at of [0, 1, 2, 5, 6, 7, "resync"] as const)
      for (const row of rowsOn(foldAt(at), LOFT)) expect(row.stale, `${at} ${row.id}`).toBe(false);
    // the peer greys whole when it goes stale, through its re-attach, and lights again when live
    for (const at of [3, 4] as const) {
      expect(rowsOn(foldAt(at), LOFT).length, String(at)).toBeGreaterThan(0);
      for (const row of rowsOn(foldAt(at), LOFT)) expect(row.stale, `${at} ${row.id}`).toBe(true);
    }
    for (const at of [0, 1, 2, 3, 4, 5, 6] as const)
      expect(rowsOn(foldAt(at), HOME).find((row) => row.id === "run-h-quiet")?.stale).toBe(true);
    expect(foldAt(7).drawn).not.toContain("run-h-quiet");
  });

  it("J1 (a) — the window's order: the home's agents by birth, its terminals, then each desktop in its place (item 138)", () => {
    const open = foldAt("open");
    // the contract's order interleaves the desktops by birth; the window's puts the home first
    expect(open.ids?.slice(0, 4)).toEqual(["run-a-idle", "pty-h1", "pty-p3", "run-h-partial"]);
    expect(open.drawn).toEqual([
      "pty-h1",
      "run-h-partial",
      "run-h-nocwd",
      "run-h-root",
      "run-h-quiet",
      "pty-h3",
      "pty-h2",
      "pty-p3",
      "pty-p1",
      "run-p-done",
      "run-a-idle",
    ]);
    // a re-present moves nothing, and a re-attach keeps the peer before the asleep desktop
    expect(foldAt(2).drawn).toEqual(foldAt(1).drawn);
    const devicesOf = (step: PhoneFoldStep) => [
      ...new Set((step.rows ?? []).map((row) => row.device)),
    ];
    for (const step of goldens.fold.filter((entry) => entry.gap !== true))
      expect(devicesOf(step), String(step.at)).toEqual([HOME, LOFT, ATTIC]);
    expect(foldAt(4).drawn?.slice(-3)).toEqual(["pty-p3", "run-p-done", "run-a-idle"]);
  });

  it("unread and cost are the owner's, row for row", () => {
    const open = foldAt("open");
    const unread = (step: PhoneFoldStep) =>
      (step.rows ?? []).filter((row) => row.unread).map((row) => row.id);
    expect(unread(open)).toEqual(["pty-h1", "run-p-done"]);
    expect(unread(foldAt(1))).toEqual(["pty-h1", "run-h-partial", "run-p-done"]);
    expect(open.rows?.find((row) => row.id === "run-h-partial")?.cost).toEqual({
      usd: 0.62,
      coverage: "partial",
      burnPerHour: 30,
    });
    expect(open.rows?.find((row) => row.id === "pty-h2")?.cost).toBeNull();
  });

  it("the bodies: a peer's wear their desktop's name and the home's none; priced flames, an unpriced hollow", () => {
    const bodies = bodyAt("open").bodies ?? [];
    const host = (id: string) =>
      bodies.find((body) => body.id === id)?.copy.find((line) => line.key === "host")?.text;
    for (const id of ["pty-h1", "run-h-partial", "pty-h2", "run-h-quiet"])
      expect(host(id), id).toBeUndefined();
    expect(host("pty-p3")).toBe("Loft");
    expect(host("pty-p1")).toBe("Loft");
    expect(host("run-a-idle")).toBe("Attic");
    const partial = bodies.find((body) => body.id === "run-h-partial");
    // 30/h is 0.5/min: three of the four flames, the ladder's (0.05, 0.15, 0.4, 1)
    // 83% of the context: a hot ring and a hot top figure
    expect(partial).toMatchObject({
      state: "working",
      burn: { lit: 3, priced: true },
      ring: { percent: 83, hot: true },
      top: { text: "83%", hot: true, none: false },
    });
    // a configured effort is launch intent, set in italics; an observed one is not
    expect(partial?.copy.find((line) => line.key === "model")).toEqual({
      key: "model",
      text: "GPT-5.5 · medium",
      italic: true,
    });
    expect(
      bodies.find((body) => body.id === "pty-h1")?.copy.find((line) => line.key === "model"),
    ).toEqual({ key: "model", text: "Opus 5.5 · high" });
    expect(partial?.bottom).toEqual({ text: "~$0.62+", none: false });
    const quiet = bodies.find((body) => body.id === "run-h-quiet");
    expect(quiet).toMatchObject({
      burn: { lit: 0, priced: false },
      bottom: { text: "—", none: true },
    });
    expect(bodies.find((body) => body.id === "pty-p3")).toMatchObject({
      state: "blocked",
      blockerKind: "question",
      light: "orange",
      stale: false,
    });
    expect(
      bodies.find((body) => body.id === "pty-p3")?.copy.find((line) => line.key === "state")?.icon,
    ).toBe("question");
    expect(bodies.find((body) => body.id === "pty-h1")).toMatchObject({
      unread: true,
      light: "blue",
    });
    // the running shell: the window's elapsed line reads its own first-sight clock, left out (BODY_NOTE)
    expect(bodies.find((body) => body.id === "pty-h2")).toMatchObject({
      state: "terminal-running",
      running: true,
      copy: [
        { key: "name", text: "notes" },
        { key: "command", text: "running" },
      ],
    });
  });

  it("Q06 — a crashed home run is drawn from the open on its terminal join, its failure on its body", () => {
    // which publication carries it is the window's race (its render against its frame), not a fact
    // 3d holds: it is drawn from the open on
    expect(foldAt("open").drawn).toContain("pty-h3");
    for (const step of goldens.fold.filter((entry) => entry.gap !== true)) {
      expect(step.drawn, String(step.at)).toContain("pty-h3");
      expect(
        step.rows?.find((row) => row.id === "pty-h3"),
        String(step.at),
      ).toMatchObject({
        key: "run-h-crash",
        self: true,
        stale: true,
      });
    }
    const crashed = bodyAt("open").bodies?.find((body) => body.id === "pty-h3");
    expect(crashed).toMatchObject({ state: "blocked", blockerKind: "failure", light: "orange" });
    expect(crashed?.copy.find((line) => line.key === "state")).toMatchObject({
      text: "The process exited with code 1.",
      icon: "failure",
    });
  });

  it("PG-1c — the whole-mesh resync keeps every place and publishes only what it heals", () => {
    const before = foldAt(7);
    const resync = foldAt("resync");
    expect(resync.frame).toBe("resync");
    // the open replaces the fold's copy on a chain of its own, one past the frames'
    expect(resync.foldRevision).toBe((before.foldRevision ?? 0) + 1);
    expect(resync.modelRevision).toBe(resync.foldRevision);
    // every desktop where it was, every row in its place (item 138)
    expect(resync.drawn).toEqual(before.drawn);
    expect(resync.ids).toEqual(before.ids);
    expect(resync.devices).toEqual(before.devices);
    // the one change the reader never heard: the home's window read run-h-turn
    expect(resync.changes).toEqual({ added: [], updated: ["pty-h1"], removed: [] });
    expect(resync.rejoined).toBeNull();
    expect(resync.rows?.find((row) => row.id === "pty-h1")?.unread).toBe(false);
    // and the old chain is still a gap after it
    expect(foldAt(8).gap).toBe(true);
  });
});

/** PG-4s — a view the registry does not hold, passed as `views`: what a lane's line will do, proven with no lane. */
const PROBE_NOTE = "PG-4s's probe view: each step's drawn ids, never over a defect";
const probeLane: PhoneViewGoldens[string] = async () => ({
  golden: {
    note: PROBE_NOTE,
    compute: ({ steps, nowMs }) =>
      steps.map((step) => ({
        at: step.at,
        ...(step.gap === true ? { gap: true } : {}),
        ids: (step.rows ?? []).map((row) => row.id),
        nowMs,
      })),
  },
});
const probeViews: PhoneViewGoldens = { probe: probeLane };
const PROBE_GOLDEN = phoneViewGoldenName("probe");

describe("PG-4s — every phone golden has one writer, and a view's golden is one registry line", () => {
  it("G1 — a registered view is written as phone-<view>.golden.json under the one header", async () => {
    const files = await phoneAllGoldenFiles(goldens, probeViews);
    expect(Object.keys(files)).toContain(PROBE_GOLDEN);
    const bytes = files[PROBE_GOLDEN] ?? "";
    expect(bytes.endsWith("}\n")).toBe(true);
    const written = JSON.parse(bytes) as Record<string, unknown>;
    expect(Object.keys(written)).toEqual([
      "//",
      "versions",
      "self",
      "view",
      "nowMs",
      "inputs",
      "steps",
    ]);
    expect(written["//"]).toBe(PROBE_NOTE);
    expect(written.versions).toEqual(puppeteerVersions());
    expect(written.self).toBe("home");
    expect(written.view).toBe("probe");
    expect(written.nowMs).toBe(PHONE_BODY_NOW_MS);
    expect(written.inputs).toEqual([...PHONE_WITNESS_INPUTS]);
    const steps = written.steps as Array<{ at: unknown; ids: string[]; nowMs: number }>;
    expect(steps.map((step) => step.at)).toEqual(goldens.fold.map((step) => step.at));
    expect(steps[0]?.ids).toEqual(foldAt("open").drawn);
    expect(steps[0]?.nowMs).toBe(PHONE_BODY_NOW_MS);
  });

  it("G2 — the window's drawn rows are kept whole at every step, cloned when recorded (Q-S9)", () => {
    const { windowRows } = goldens;
    expect(windowRows).toHaveLength(11);
    expect(windowRows.map((step) => step.at)).toEqual(goldens.fold.map((step) => step.at));
    expect(windowRows.map((step) => step.frame)).toEqual(goldens.fold.map((step) => step.frame));
    for (const [index, step] of windowRows.entries()) {
      const fold = goldens.fold[index];
      if (step.gap === true) {
        expect(fold?.gap).toBe(true);
        expect(step.rows).toBeUndefined();
        continue;
      }
      expect((step.rows ?? []).map((row) => row.id)).toEqual(fold?.drawn);
    }
    expect(windowRows.at(-1)?.gap).toBe(true);
    // the clone: a later step never shares (so never rewrites) an earlier step's row
    const open = windowRows[0]?.rows?.[0];
    const next = windowRows[1]?.rows?.find((row) => row.id === open?.id);
    expect(open).toBeDefined();
    expect(next).toBeDefined();
    expect(next).not.toBe(open);
  });

  it("G3 — the toolkit's golden is written, its clock pinned by wall components, never an instant", async () => {
    const files = await phoneAllGoldenFiles(goldens);
    expect(Object.keys(files)).toContain(PHONE_TOOLKIT_GOLDEN);
    const toolkit = JSON.parse(files[PHONE_TOOLKIT_GOLDEN] ?? "{}") as {
      calls?: { formatClock?: Array<Record<string, unknown>> };
    };
    const clock = toolkit.calls?.formatClock ?? [];
    expect(clock.length).toBeGreaterThan(0);
    for (const entry of clock) {
      expect(Object.keys(entry).sort()).toEqual(["frac", "out", "wall", "withSeconds"]);
      expect(entry.wall).toHaveLength(7);
    }
  });

  it("G4 — a lane file the registry does not name is found; the real folder has none", () => {
    const dir = mkdtempSync(join(tmpdir(), "pg4s-lib-"));
    try {
      for (const name of ["phone-goldens.ts", "phone-goldens-zzz.ts", "other.ts"])
        writeFileSync(join(dir, name), "");
      expect(unregisteredViewFiles(dir, PHONE_VIEW_GOLDENS)).toEqual(["phone-goldens-zzz.ts"]);
      expect(unregisteredViewFiles(dir, { ...PHONE_VIEW_GOLDENS, zzz: probeLane })).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(unregisteredViewFiles(PHONE_GOLDENS_LIB_DIR)).toEqual([]);
  });

  it("G5 — a committed golden the one writer does not write is found; the real folder has none", async () => {
    const files = await phoneAllGoldenFiles(goldens);
    const dir = mkdtempSync(join(tmpdir(), "pg4s-goldens-"));
    try {
      for (const name of [PHONE_FOLD_GOLDEN, "phone-zzz.golden.json", "notes.json"])
        writeFileSync(join(dir, name), "{}");
      expect(orphanGoldens(dir, files)).toEqual(["phone-zzz.golden.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(orphanGoldens(PHONE_GOLDENS_DIR, files)).toEqual([]);
  });

  it("G6a — every golden the one writer returns names the puppeteer packages and refuses a defect", async () => {
    const files = await phoneAllGoldenFiles(goldens, probeViews);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        PHONE_FOLD_GOLDEN,
        PHONE_BODY_GOLDEN,
        PHONE_TOOLKIT_GOLDEN,
        PROBE_GOLDEN,
      ]),
    );
    for (const [name, bytes] of Object.entries(files)) {
      const parsed = JSON.parse(bytes) as { versions: unknown; "//": string };
      expect(parsed.versions, name).toEqual(puppeteerVersions());
      expect(parsed["//"], name).toMatch(/never over a defect/);
    }
  });

  it("G7 — the mirrors are derived from the registry: the toolkit's and each view's in FieldHomeTests", () => {
    const mirrors = phoneGoldenMirrors(probeViews);
    expect(mirrors[PROBE_GOLDEN]).toEqual([PHONE_VIEW_MIRROR]);
    expect(mirrors[PHONE_TOOLKIT_GOLDEN]).toEqual([PHONE_VIEW_MIRROR]);
    expect(mirrors[PHONE_FOLD_GOLDEN]).toEqual([
      "apps/ios/VibeFieldKit/Tests/FieldMeshTests/Fixtures",
      "apps/ios/VibeFieldKit/Tests/FieldProductTests/Fixtures",
    ]);
    expect(mirrors[PHONE_BODY_GOLDEN]).toEqual([
      "apps/ios/VibeFieldKit/Tests/FieldMeshTests/Fixtures",
    ]);
  });

  it("G7b — the mirrors the generator and the byte row read are the registry's", () => {
    expect(PHONE_GOLDEN_MIRRORS[PHONE_TOOLKIT_GOLDEN]).toEqual([PHONE_VIEW_MIRROR]);
    expect(PHONE_GOLDEN_MIRRORS).toEqual(phoneGoldenMirrors());
  });
});

describe("PG-4t — the phone's monitor skin", () => {
  it("T2 — GodviewSkin's keys are MONITOR_SKIN's colours; its other names are the four the kit names", () => {
    const swift = readFileSync(
      join(
        process.cwd(),
        "../../apps/ios/VibeFieldKit/Sources/FieldHome/Godview/GodviewSkin.swift",
      ),
      "utf8",
    );
    const keys = [...swift.matchAll(/^ {4}case \w+ = "([a-z-]+)"$/gm)].map(([, raw]) => `--${raw}`);
    const colours = MONITOR_SKIN.filter((name) => !name.startsWith("--vf-"));
    expect(keys).toHaveLength(9);
    expect([...keys].sort()).toEqual([...colours].sort());
    // The easings and the sans: FieldMotion's curves and ChromeType.sans (DESIGN.md §8 "The monitor view owns its
    // drawing"); a tenth name the SDK adds reds here, and the phone answers it first.
    const others = MONITOR_SKIN.filter((name) => name.startsWith("--vf-"));
    expect([...others].sort()).toEqual([
      "--vf-ease-island",
      "--vf-ease-lift",
      "--vf-ease-pop",
      "--vf-font-sans",
    ]);
  });
});

describe("PG-4t — a puppeteer-views module by its path", () => {
  it("L1 — the registry by path is the root's own module: the installed package, not a second copy", async () => {
    const registry = await importPuppeteerViews<{ MONITOR_VIEWS: typeof MONITOR_VIEWS }>(
      "monitor/registry.js",
    );
    expect(registry.MONITOR_VIEWS).toBe(MONITOR_VIEWS);
  });

  it("L2 — it never leaves dist, and loads only .js", async () => {
    for (const path of [
      "../package.json",
      "views/../../package.json",
      "/etc/hosts",
      "monitor/registry.d.ts",
    ]) {
      await expect(importPuppeteerViews(path), path).rejects.toThrow(
        /never leaves dist|loads only \.js/,
      );
    }
  });

  it("L3 — a path the installed package lacks rejects with the path and the version", async () => {
    const { views } = puppeteerVersions();
    await expect(importPuppeteerViews("views/nope/missing.js")).rejects.toThrow(
      "views/nope/missing.js",
    );
    await expect(importPuppeteerViews("views/nope/missing.js")).rejects.toThrow(
      `puppeteer-views ${views}`,
    );
  });
});
