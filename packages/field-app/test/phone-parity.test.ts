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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentModelMeshFrame } from "@vibefield/contracts";
import { beforeAll, describe, expect, it } from "vitest";
import {
  computePhoneGoldens,
  goldenChanges,
  PHONE_BODY_GOLDEN,
  PHONE_FOLD_GOLDEN,
  PHONE_GOLDEN_MIRRORS,
  PHONE_GOLDENS_COMMAND,
  PHONE_GOLDENS_DIR,
  type PhoneBodyStep,
  type PhoneFoldStep,
  type PhoneGoldens,
  phoneGoldenFiles,
  puppeteerVersions,
  readWitnessInputs,
} from "../perf/lib/phone-goldens";
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
  it("the committed goldens are byte for byte what the computation writes (a regeneration is a re-bless, said)", () => {
    const files = phoneGoldenFiles(goldens);
    for (const [name, bytes] of Object.entries(files)) {
      const path = join(PHONE_GOLDENS_DIR, name);
      const stored = readFileSync(path, "utf8");
      const moved = goldenChanges(stored, bytes);
      const mirrors = (PHONE_GOLDEN_MIRRORS[name] ?? []).map(
        (folder) => `cp packages/field-app/test/fixtures/phone-godview/${name} ${folder}/${name}`,
      );
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

  it("names the three puppeteer packages it was computed by, as installed (a puppeteer EL8 regenerates it)", () => {
    // the pin's authority is the manifests (pnpm-workspace.yaml, preflight's PIN_EXPECTATIONS): no literal here
    const installed = puppeteerVersions();
    for (const name of [PHONE_FOLD_GOLDEN, PHONE_BODY_GOLDEN]) {
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

  it("Q06 — a crashed home run stays drawn on its terminal join, its failure on its body, published by the window's re-join", () => {
    // the open's own publication is the model's visible rows; the window then hands the replica the
    // board's joins, and the kept failure is added by that re-join
    expect(foldAt("open").changes?.added).not.toContain("pty-h3");
    expect(foldAt("open").rejoined).toEqual({ added: ["pty-h3"], updated: [], removed: [] });
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
