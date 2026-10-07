// DK-16 — WHEN THE DESK CAN'T DRAW AT ALL, IN THE PRODUCT (smoke:canvas's GPU-less runs; DESIGN.md §8 "When the desk
// can't draw"; DK-D32; R18). `--disable-gpu` — the smokes' GPU-less mode: WebGPU is there and this computer's graphics offer
// it NO ADAPTER (hardware acceleration off), so after the heal's three tries the no-adapter card. `--smoke-no-webgpu` — the
// GPU kept, the page given no `navigator.gpu` at all, as a remote desktop has none (`withoutWebgpu`, below): the NO-WEBGPU
// card, never retried. Each in the canon's words exactly, with NO Reload (reloading won't help), ICE's message verbatim
// last, centred on the plain ground, never ICE's screen and never a blank. Then THE COVER over a desk that never drew (plan
// addendum (68)): the mat's ground under it and no words said there — the card is the Canvas stage's — and, as the cover
// lowers, the card standing again.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { CardSeen } from "./smoke-peers";

/** The canon's words for a desk this computer cannot draw (DESIGN.md §8), and how ICE's message ends. */
export const NO_DRAW_CARDS = {
  "no-adapter": {
    title: "This computer can't draw the desk",
    body: "The desk draws with WebGPU, and this computer's graphics offered it no adapter — hardware acceleration may be off — so reloading won't help. Your objects are saved in this document.",
    detailEnds: "requestAdapter() returned null",
  },
  "no-webgpu": {
    title: "This computer can't draw the desk",
    body: "The desk draws with WebGPU, which this graphics setup doesn't offer — a remote desktop has none — so reloading won't help. Your objects are saved in this document.",
    detailEnds: "WebGPU is unavailable here (no navigator.gpu)",
  },
} as const;

export type NoDrawKind = keyof typeof NO_DRAW_CARDS;

/** The smoke switch for a run whose page has no WebGPU at all (smoke.ts). */
export const NO_WEBGPU_FLAG = "--smoke-no-webgpu";

/** What the window's DevTools protocol is asked, in `withoutWebgpu`'s order. */
export const WITHOUT_WEBGPU = {
  first: "about:blank",
  script: "delete Navigator.prototype.gpu;",
} as const;

/** The part of a window `withoutWebgpu` drives. */
export interface WebgpuTaker {
  loadURL(url: string): Promise<void>;
  readonly webContents: {
    readonly debugger: {
      attach(version: string): void;
      sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
    };
  };
}

/**
 * Take `navigator.gpu` from every document this window loads, before any of its scripts — a page with no WebGPU, as a
 * remote desktop's is, on a machine whose GPU is kept. No switch does it in Electron 43 (measured 2026-10-07 on a secure
 * page: `--disable-blink-features=WebGPU`, `--disable-features=WebGPU`, that switch appended in main and
 * `webPreferences.disableBlinkFeatures` all leave `navigator.gpu` and its adapter; `--disable-features=WebGPUService`
 * leaves it with NO adapter — `--disable-gpu`'s no-adapter card again), so the run asks the window's own DevTools
 * protocol for a script on every new document. `Page.enable` needs a live page (asked before one, it never answers), so
 * the window opens on about:blank first.
 */
export async function withoutWebgpu(win: WebgpuTaker): Promise<void> {
  await win.loadURL(WITHOUT_WEBGPU.first);
  const dbg = win.webContents.debugger;
  dbg.attach("1.3");
  await dbg.sendCommand("Page.enable");
  await dbg.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: WITHOUT_WEBGPU.script });
}

/** The mat's ground as the light theme lights it (DESIGN.md §2.1; `--vf-mat-ground`). */
export const MAT_GROUND_DAY = "rgb(61, 90, 48)";

/** A card this computer cannot draw past: its kind, the canon's words, NO act, ICE's message last, the plain ground. */
export function judgeNoDrawCard(
  card: CardSeen | null,
  kind: NoDrawKind,
  canvasBg: string,
): string[] {
  if (card === null) return ["no card stands in the stage"];
  const want = NO_DRAW_CARDS[kind];
  const problems: string[] = [];
  if (card.kind !== kind) problems.push(`the card is ${card.kind}, not ${kind}`);
  if (card.title !== want.title) problems.push(`the card says ${JSON.stringify(card.title)}`);
  if (card.body !== want.body)
    problems.push(`the card's what-to-do reads ${JSON.stringify(card.body)}`);
  if (card.buttons.length > 0)
    problems.push(`the card offers ${JSON.stringify(card.buttons)} where reloading won't help`);
  if (card.detail === null || !card.detail.endsWith(want.detailEnds))
    problems.push(`the card's detail is ${JSON.stringify(card.detail)}, not ICE's message`);
  if (card.ground !== canvasBg)
    problems.push(`the card stands on ${card.ground}, not the plain ground (${canvasBg})`);
  return problems;
}

/** One cover over a desk that never drew, as the door records it and the page shows it. */
export interface NeverDrewCover {
  readonly face: string | null;
  readonly said: string | null;
  readonly still: { readonly face: string | null; readonly background: string } | null;
  readonly line: string | null;
  readonly cardUnder: boolean;
}

/** UNDER A COVER a desk that never drew shows the mat's ground and says nothing; lowered, its card stands again. */
export function judgeNeverDrewCover(
  up: NeverDrewCover,
  backCard: string | null,
  kind: NoDrawKind,
  matGround: string,
): string[] {
  const problems: string[] = [];
  if (up.face !== "ground")
    problems.push(`under the cover the face is ${up.face}, not the mat's ground`);
  if (up.still?.face !== "ground" || up.still.background !== matGround)
    problems.push(
      `under the cover the still is ${JSON.stringify(up.still)}, not the mat's ground (${matGround})`,
    );
  if (up.said !== null)
    problems.push(
      `under the cover the line was asked ${JSON.stringify(up.said)} — a desk that never drew says nothing there`,
    );
  if (up.line !== null)
    problems.push(`under the cover the status line reads ${JSON.stringify(up.line)}`);
  if (backCard !== kind)
    problems.push(`back on the canvas the card is ${backCard}, not ${kind} standing again`);
  return problems;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const READ_CARD = `(() => {
  const stage = document.querySelector(".vf-desk-unavailable");
  const card = stage?.querySelector(".vf-ui-unavailable-state") ?? null;
  return card === null ? null : {
    kind: stage.getAttribute("data-desk-unavailable"),
    title: card.querySelector("strong")?.textContent ?? null,
    body: card.querySelector("span")?.textContent ?? null,
    buttons: [...card.querySelectorAll("button")].map((b) => b.textContent ?? ""),
    detail: card.querySelector(".vf-ui-unavailable-state__detail")?.textContent ?? null,
    ground: getComputedStyle(stage).backgroundColor,
  };
})()`;

const CANVAS_BG = `(() => {
  const el = document.createElement("div");
  el.style.backgroundColor = "var(--vf-canvas-bg)";
  document.body.append(el);
  const c = getComputedStyle(el).backgroundColor;
  el.remove();
  return c;
})()`;

export interface UnavailableRowsDriver {
  readonly win: BrowserWindow;
  readonly kind: NoDrawKind;
  /** Keep the card's still (a shown window only — a hidden one captures nothing). */
  readonly shot: string | null;
  readonly shotDir: string | undefined;
  readonly say: (line: string) => void;
}

/** DK-16's rows for a desk this computer cannot draw (above). Returns the problems, each in words. */
export async function unavailableRows(d: UnavailableRowsDriver): Promise<string[]> {
  const { win, kind, say } = d;
  const problems: string[] = [];
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const until = async (label: string, timeoutMs: number, expression: string): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await js<unknown>(expression)) === true) return;
      await sleep(80);
    }
    throw new Error(`${label} did not happen within ${timeoutMs}ms`);
  };
  await js(`globalThis.vibefield.theme.set("light")`);
  await until(
    "the light theme",
    10_000,
    `document.documentElement.classList.contains("dark") === false`,
  );
  await sleep(300);

  // THE CARD, in the canon's words
  const card = await js<CardSeen | null>(READ_CARD);
  const canvasBg = await js<string>(CANVAS_BG);
  problems.push(...judgeNoDrawCard(card, kind, canvasBg).map((p) => `CARD ${kind}: ${p}`));
  if (d.shot !== null && d.shotDir !== undefined) {
    mkdirSync(d.shotDir, { recursive: true });
    writeFileSync(join(d.shotDir, d.shot), (await win.capturePage()).toPNG());
  }
  say(`SMOKE_CANVAS_CARD_WORDS ${JSON.stringify({ kind, card, canvasBg })}`);

  // THE COVER over a desk that never drew: the mat's ground, nothing said; lowered, the card again (a row that cannot go
  // on is said beside what the card's row found, never instead of it)
  try {
    problems.push(...(await neverDrewCoverRow(kind, js, until, say)));
  } catch (error) {
    problems.push(`CARD ${kind} COVER: ${error instanceof Error ? error.message : String(error)}`);
  }
  return problems;
}

async function neverDrewCoverRow(
  kind: NoDrawKind,
  js: <T>(expression: string) => Promise<T>,
  until: (label: string, timeoutMs: number, expression: string) => Promise<void>,
  say: (line: string) => void,
): Promise<string[]> {
  const problems: string[] = [];
  const seq = await js<number>(`(globalThis.__vfDesk?.covers().at(-1)?.seq ?? 0) + 1`);
  await js(`globalThis.vibefield.view.set("godview")`);
  await until(
    "the cover over a desk that never drew",
    10_000,
    `(() => { const r = globalThis.__vfDesk?.covers().at(-1); return r !== undefined && r.seq === ${seq} && r.passes[0]?.face !== undefined; })()`,
  );
  await sleep(600);
  const up = await js<NeverDrewCover>(`(() => {
    const r = globalThis.__vfDesk.covers().at(-1);
    const still = document.querySelector(".field-still");
    return {
      face: r.passes[0]?.face ?? null,
      said: r.said,
      still: still === null ? null : { face: still.getAttribute("data-still"), background: getComputedStyle(still).backgroundColor },
      line: document.querySelector(".vf-status-line__text")?.textContent ?? null,
      cardUnder: document.querySelector(".vf-desk-unavailable") !== null,
    };
  })()`);
  await js(`globalThis.vibefield.view.set("canvas")`);
  await until(
    "the canvas again",
    10_000,
    `document.querySelector(".vf-cover")?.getAttribute("data-cover") === "down"`,
  );
  await sleep(500);
  const back = await js<string | null>(
    `document.querySelector(".vf-desk-unavailable")?.getAttribute("data-desk-unavailable") ?? null`,
  );
  problems.push(
    ...judgeNeverDrewCover(up, back, kind, MAT_GROUND_DAY).map((p) => `CARD ${kind} COVER: ${p}`),
  );
  say(`SMOKE_CANVAS_CARD_COVER ${JSON.stringify({ kind, up, back })}`);
  return problems;
}
