// DK-16 — PEERS ON THE MAT AND WHEN THE DESK CAN'T DRAW, IN THE PRODUCT (smoke:canvas; DESIGN.md §8 "Peers on the mat",
// "When the desk can't draw"; R17, R18; ICE I26). Two windows of one shell share no presence room — fieldd's rooms fan a
// board's presence out to OTHER desktops, and one desktop holds a board in one window — so the smoke PLAYS THE MESH: window
// A (the canvas smoke's own) and window B (a second window on its own board), each loaded with `?presenceRelay=1`, and every
// payload one window's presence sends handed to the other's as its lane hands a room's. What crosses is ICE's presence —
// since DK-17b (desk.6, I42) its cursor says away and canvas itself — opaque to the relay as it is to fieldd. Then B's
// REAL pointer (the OS's events, sent to its window):
//   ARRIVE  — B's arrow in A with its tip ON B's pointer: B's client point through B's camera into the world, and through
//             A's camera back to A's screen (the record's box and the element's own rect); the chip the face first, then
//             the name, in the chrome's own text ink; ICE's cursors absent (the layer's word `false`, and no element of the
//             desk but the chip saying the name); the stills dk-16-peer-{light,dark}.png and the chip's contrast, measured
//             on the lit mat from the captured pixels;
//   IDLE    — B's pointer still: hidden at 8 s after its last move (by A's own timer), never before 7.5;
//   BOARD   — A's pegboard out: the layer hidden; folded, shown;
//   COVER   — A covered by Godview: hidden; A's own presence says away (ICE's `setAway("cover")`, its cursor away); back
//             to the canvas, shown;
//   AWAY    — B's pointer leaves B's window: hidden in A at once, by ICE's own leave (B's cursor away, no host reason);
//             back in its window over B's line it stays away; back over B's page, shown;
//   EXIT    — B's pointer leaves B's window from BESIDE the desk (ICE I44): through the line, a head control, the head's
//             drag strip — each hidden in A as away within one publish, never by B's idle, and still away back in the
//             window over the chrome until the pointer is on the desk. RED at desk.6 (I42's leave hangs on the desk's
//             container alone: the pointer that crossed onto the chrome is never said away, and A hides it at 8 s by its
//             idle rule) — I44's product red-proof; green at desk.7. Injected input skips the OS's own drag-region
//             handling, so the drag row proves the page's path over the strip, not what a real pointer entering it does;
//   GONE    — B closed: its peer leaves A's roster;
//   COUNTERS — the layer placed every move and rendered only for the roster and its own verdicts.
// And, on A again (`?deskFaults=1`), THE DESK'S FAULTS on its own device:
//   BANNER  — one uncaptured validation error: `degraded`, the status line holding ICE's message and a Reload, the desk
//             drawing on beneath it; dk-16-banner.png; the Reload a remount, the line cleared;
//   LOST    — the device destroyed (a reset): `failed`, the card — "The desk lost its graphics device", what to do, ONE
//             Reload, ICE's message verbatim last — on the plain ground, never a blank; dk-16-card-lost.png; the Reload a
//             remount that draws again.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow, NativeImage } from "electron";

/** The canon's numbers (DESIGN.md §8 "Peers on the mat", R17). */
export const PEERS = {
  idleMs: 8_000,
  /** the arrow's tip in its box */
  tip: { x: 2, y: 2 },
  /** how late an idle hide may come after the pointer's last move: the relay, the throttle, a frame — measured 40–80 ms
   * late; 700 holds that many times over and still fails a hide at 9 s (a mutated build's 9068 ms passed 1500) */
  idleSlackMs: 700,
  /** the earliest a still pointer is looked at again: it must still be drawn */
  idleNotBeforeMs: 7_500,
  /** EXIT (I44): a pointer out of its window is hidden within ONE PUBLISH — the leave a task later, B's throttle, the
   * relay's turn, A's frame — far inside the 8 s idle that hides a pointer nobody said away */
  exitMs: 1_000,
  /** EXIT: how long a pointer back in its window over the chrome is watched for staying away */
  reenterMs: 600,
} as const;

/** EXIT (I44): where B's pointer leaves its window from — beside the desk (the line, a head control, the head's drag
 * strip), or a desk point (DK-16's AWAY, the control). */
export type ExitFrom = "line" | "head" | "drag" | "desk";

export const EXIT_FROM: Readonly<Record<ExitFrom, string>> = {
  line: "the line",
  head: "a head control",
  drag: "the head's drag strip",
  desk: "a desk point",
};

/** A point B's pointer leaves from, as B's page hit-tests it. */
export interface ExitPoint {
  readonly x: number;
  readonly y: number;
  /** the element `elementFromPoint` answers there (its class, or its tag) */
  readonly hit: string | null;
  /** that element is inside the desk's container (`[data-desk]`) */
  readonly inDesk: boolean;
  /** its computed `-webkit-app-region` ("drag", "no-drag", or what Chromium answers) */
  readonly region: string | null;
}

/** What A saw after B's pointer left its window (the EXIT rows and AWAY's control). */
export interface ExitSeen {
  readonly from: ExitFrom;
  readonly point: ExitPoint | null;
  /** A's first verdict on B after the leave ("gone" — no record), or null if none came before B's idle was due */
  readonly hidden: string | null;
  /** ms from the leave to that verdict */
  readonly ms: number | null;
  /** B's own word after the leave: its host's reason and its published cursor */
  readonly said: PeersDoor["said"];
  /** A's verdict once B's pointer was back in its window over the chrome, not yet on the desk */
  readonly reentered: string | null;
}

/** EXIT (I44): out of its window — from anywhere in its page — B's peer is hidden in A as AWAY within one publish, by its
 * own cursor's word, and stays away while the pointer is back over the chrome, until it is back on the desk. */
export function judgeExit(seen: ExitSeen): string[] {
  const where = EXIT_FROM[seen.from];
  const problems: string[] = [];
  if (seen.point === null) return [`${where} is missing from B's page — nothing to leave from`];
  if (seen.from !== "desk" && seen.point.inDesk)
    problems.push(
      `${where} at (${seen.point.x}, ${seen.point.y}) is inside the desk — not beside it`,
    );
  if (seen.hidden !== "away")
    problems.push(
      seen.hidden === null
        ? `B's pointer left its window from ${where} and A never hid it`
        : `B's pointer left its window from ${where} and A hid it only by ${JSON.stringify(seen.hidden)}${seen.ms === null ? "" : `, ${seen.ms} ms after the leave`} — never said away (ICE I44)`,
    );
  else if (seen.ms === null || seen.ms > PEERS.exitMs)
    problems.push(
      `B's pointer left its window from ${where} and A hid it away ${seen.ms} ms after — not within one publish (${PEERS.exitMs} ms)`,
    );
  if (seen.said?.cursor?.away !== true)
    problems.push(`B's own cursor did not say away after leaving from ${where}`);
  if (seen.reentered !== "away")
    problems.push(
      `back in its window over the chrome, not on the desk, A's verdict on B was ${JSON.stringify(seen.reentered)} — not away`,
    );
  return problems;
}

/** The card's words for a lost device (DESIGN.md §8). */
export const LOST_CARD = {
  title: "The desk lost its graphics device",
  body: "The graphics device was reset while the desk was drawing. Your objects are saved in this document; reload to draw them again.",
} as const;

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** One peer as a window's door last placed it (`__vfDesk.peers().record.peers`): its `PresenceCursor` — x/y, and ICE's
 * away and canvas (I42). */
export interface PeerSeen {
  readonly entity: number;
  readonly cursor: {
    readonly x: number;
    readonly y: number;
    readonly away: boolean;
    readonly canvas: string;
  } | null;
  readonly idleMs: number;
  readonly hidden: string | null;
  readonly box: { readonly x: number; readonly y: number } | null;
}

export interface PeersDoor {
  readonly cursors: boolean;
  readonly record: {
    readonly layer: string | null;
    readonly canvas: string;
    readonly camera: Camera | null;
    readonly peers: readonly PeerSeen[];
    readonly flushes: number;
    readonly writes: number;
    readonly idles: number;
  } | null;
  readonly renders: number;
  /** What the window says of its own pointer (ICE's presence, I42): the host's away reason and its cursor as published. */
  readonly said: {
    readonly reason: string | null;
    readonly cursor: { readonly away: boolean; readonly canvas: string } | null;
  } | null;
}

/** COVER: a covered window says its own pointer away — the host's reason "cover" (ICE's `setAway`) and its published
 * cursor away. */
export function judgeCoverSaid(said: PeersDoor["said"]): string[] {
  if (said === null) return ["the window has no presence to say it with"];
  const problems: string[] = [];
  if (said.reason !== "cover")
    problems.push(`its presence holds the reason ${JSON.stringify(said.reason)}, not "cover"`);
  if (said.cursor === null) problems.push("its presence published no cursor to say it on");
  else if (!said.cursor.away) problems.push("its published cursor is not away");
  return problems;
}

/** AWAY: the peer hidden by its pointer's own leave — ICE's (`PointerOutside`): its cursor away with no host reason held. */
export function judgeAwaySaid(said: PeersDoor["said"]): string[] {
  if (said === null) return ["the peer's window has no presence"];
  const problems: string[] = [];
  if (said.reason !== null)
    problems.push(
      `the peer's host holds the reason ${JSON.stringify(said.reason)} — not the pointer's own leave`,
    );
  if (said.cursor?.away !== true) problems.push("the peer's own cursor is not away");
  return problems;
}

/** I45: the first point B's presence sent out is its pointer's own — never the origin a spawned pointer's frame-late world
 * point left in the first publish (ICE `0.15.0-desk.7`). WHICH point is the pointer's: the smoke's first move when it is the
 * first fact B hears — but a real pointer over B's window as it opens is B's pointer too (a run at 05:17Z met one: B's first
 * point (624.2, 323.5), fractional, before any injected move), so the judge holds the defect itself, the origin, and the
 * line says the point beside the move. */
export function judgeFirstPoint(
  first: { readonly x: number; readonly y: number } | null,
): string[] {
  if (first === null) return ["B's presence sent no cursor out"];
  if (first.x === 0 && first.y === 0)
    return [
      "B's first published point is (0, 0) — its spawned pointer's origin, not its own (ICE I45)",
    ];
  return [];
}

/** Where window A must draw B's arrow box: B's client point → the world through B's camera → A's screen, less the tip. */
export function expectedBox(
  pointer: { x: number; y: number },
  b: Camera,
  a: Camera,
): { x: number; y: number } {
  const world = { x: pointer.x / b.zoom + b.x, y: pointer.y / b.zoom + b.y };
  return { x: (world.x - a.x) * a.zoom - PEERS.tip.x, y: (world.y - a.y) * a.zoom - PEERS.tip.y };
}

/** AT THE RIGHT PLACE: one peer drawn, its record's box and its element's rect within a pixel of where B's pointer is. */
export function judgePeerPlace(
  peers: readonly PeerSeen[],
  expected: { x: number; y: number },
  rect: { left: number; top: number } | null,
): string[] {
  const shown = peers.filter((p) => p.hidden === null);
  if (shown.length !== 1) return [`${shown.length} peers drawn, not 1 (${JSON.stringify(peers)})`];
  const box = shown[0]?.box;
  const problems: string[] = [];
  if (box === null || box === undefined) problems.push("the peer drawn has no box");
  else if (Math.abs(box.x - expected.x) > 1 || Math.abs(box.y - expected.y) > 1)
    problems.push(
      `the arrow's box is (${box.x}, ${box.y}), not (${expected.x}, ${expected.y}) — its tip off the pointer`,
    );
  if (rect === null) problems.push("no arrow element is drawn");
  else if (Math.abs(rect.left - expected.x) > 1 || Math.abs(rect.top - expected.y) > 1)
    problems.push(
      `the arrow's element stands at (${rect.left}, ${rect.top}), not (${expected.x}, ${expected.y})`,
    );
  return problems;
}

/** IDLE: hidden at 8 s after the last move — not before `notBefore` was seen drawn, and within the slack after 8 s. */
export function judgeIdle(seenAtNotBefore: string | null, hiddenAfterMs: number | null): string[] {
  const problems: string[] = [];
  if (seenAtNotBefore !== null)
    problems.push(
      `the peer was ${seenAtNotBefore} ${PEERS.idleNotBeforeMs} ms after its last move — before its 8 s`,
    );
  if (hiddenAfterMs === null) problems.push("the idle peer was never hidden");
  else if (hiddenAfterMs < PEERS.idleMs || hiddenAfterMs > PEERS.idleMs + PEERS.idleSlackMs)
    problems.push(`the idle peer hid ${hiddenAfterMs} ms after its last move, not at 8 s`);
  return problems;
}

/** WCAG relative luminance of an sRGB colour (0–255). */
export function luminance([r, g, b]: readonly [number, number, number]): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The contrast of two colours (WCAG 2), ≥ 1. */
export function contrast(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The chip's ink and ground as MEASURED from its captured pixels (BGRA, Electron's `toBitmap`): the ground is the median
 * of the half of the pixels nearest the chip's mean (the glass), the ink the mean of the 2 % farthest from the ground (the
 * glyphs' cores) — and their contrast.
 */
export function measureChip(bgra: Uint8Array): {
  ground: [number, number, number];
  ink: [number, number, number];
  ratio: number;
} {
  const px: [number, number, number][] = [];
  for (let i = 0; i + 3 < bgra.length; i += 4)
    px.push([bgra[i + 2] as number, bgra[i + 1] as number, bgra[i] as number]);
  const mean = [0, 1, 2].map(
    (c) => px.reduce((s, p) => s + (p[c] as number), 0) / Math.max(1, px.length),
  );
  const dist = (p: readonly number[], q: readonly number[]): number =>
    Math.hypot(
      (p[0] as number) - (q[0] as number),
      (p[1] as number) - (q[1] as number),
      (p[2] as number) - (q[2] as number),
    );
  const byMean = [...px].sort((p, q) => dist(p, mean) - dist(q, mean));
  const near = byMean.slice(0, Math.max(1, Math.floor(byMean.length / 2)));
  const median = (c: number): number => {
    const v = near.map((p) => p[c] as number).sort((x, y) => x - y);
    return v[Math.floor(v.length / 2)] as number;
  };
  const ground: [number, number, number] = [median(0), median(1), median(2)];
  const far = [...px].sort((p, q) => dist(q, ground) - dist(p, ground));
  const core = far.slice(0, Math.max(1, Math.floor(far.length * 0.02)));
  const ink = [0, 1, 2].map((c) =>
    Math.round(core.reduce((s, p) => s + (p[c] as number), 0) / core.length),
  ) as [number, number, number];
  return { ground, ink, ratio: Math.round(contrast(ground, ink) * 10) / 10 };
}

/** The card a lost device shows, as read off the stage. */
export interface CardSeen {
  readonly kind: string | null;
  readonly title: string | null;
  readonly body: string | null;
  readonly buttons: readonly string[];
  readonly detail: string | null;
  /** the stage's ground under the card (its computed background colour) */
  readonly ground: string | null;
}

/** THE LOST CARD in the canon's words: one Reload, ICE's message verbatim last, on the plain ground. */
export function judgeLostCard(card: CardSeen | null, canvasBg: string): string[] {
  if (card === null) return ["no card stands in the stage"];
  const problems: string[] = [];
  if (card.kind !== "lost") problems.push(`the card is ${card.kind}, not the lost device's`);
  if (card.title !== LOST_CARD.title) problems.push(`the card says ${JSON.stringify(card.title)}`);
  if (card.body !== LOST_CARD.body)
    problems.push(`the card's what-to-do reads ${JSON.stringify(card.body)}`);
  if (card.buttons.join("|") !== "Reload")
    problems.push(`the card offers ${JSON.stringify(card.buttons)}, not ONE Reload`);
  if (card.detail === null || !card.detail.startsWith("the device was lost"))
    problems.push(`the card's detail is ${JSON.stringify(card.detail)}, not ICE's message`);
  if (card.ground !== canvasBg)
    problems.push(`the card stands on ${card.ground}, not the plain ground (${canvasBg})`);
  return problems;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface PeersRowsDriver {
  readonly win: BrowserWindow;
  /** Open window B, loaded with the relay (`presenceRelay=1`) on its own board, its desk drawn. */
  readonly openPeer: () => Promise<BrowserWindow>;
  readonly shotDir: string | undefined;
  readonly say: (line: string) => void;
}

/** What the stage's card says, read in the page. */
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

/** The canvas token as the page resolves it (a probe element). */
const CANVAS_BG = `(() => {
  const el = document.createElement("div");
  el.style.backgroundColor = "var(--vf-canvas-bg)";
  document.body.append(el);
  const c = getComputedStyle(el).backgroundColor;
  el.remove();
  return c;
})()`;

/** A peer's arrow and chip as A draws them. */
/** B's page: where its pointer can leave from beside the desk — the line's centre, a head control's (no-drag), a point
 * of the head's drag strip that no control covers — each as the page hit-tests it. */
const READ_EXIT_POINTS = `(() => {
  const desk = document.querySelector("[data-desk]");
  const regionOf = (el) => {
    const s = getComputedStyle(el);
    return s.getPropertyValue("-webkit-app-region") || s.getPropertyValue("app-region") || null;
  };
  const nameOf = (el) => (typeof el.className === "string" && el.className !== "" ? el.className : el.tagName);
  const at = (x, y) => {
    const hit = document.elementFromPoint(x, y);
    return {
      x: Math.round(x),
      y: Math.round(y),
      hit: hit === null ? null : nameOf(hit),
      inDesk: desk !== null && hit !== null && desk.contains(hit),
      region: hit === null ? null : regionOf(hit),
      el: hit,
    };
  };
  const centre = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? at(r.left + r.width / 2, r.top + r.height / 2) : null;
  };
  const strip = (p) => (p === null ? null : { x: p.x, y: p.y, hit: p.hit, inDesk: p.inDesk, region: p.region });
  const line = document.querySelector(".vf-line-input");
  let head = null;
  for (const el of document.querySelectorAll(".vf-head-place button, .vf-head-place [role='button'], .vf-head-tools button")) {
    const c = centre(el);
    if (c !== null && c.el !== null && (c.el === el || el.contains(c.el))) { head = c; break; }
  }
  let drag = null;
  const app = document.querySelector(".app-drag");
  if (app !== null) {
    const r = app.getBoundingClientRect();
    for (let x = r.right - 24; x > r.left + 96 && drag === null; x -= 24) {
      const p = at(x, r.top + r.height / 2);
      if (p.el === app) drag = p;
    }
  }
  return { h: innerHeight, line: line === null ? null : strip(centre(line)), head: strip(head), drag: strip(drag) };
})()`;

const READ_PEER = `(() => {
  const els = [...document.querySelectorAll(".vf-peers .vf-peer")];
  const shown = els.filter((el) => getComputedStyle(el).visibility === "visible");
  const el = shown[0] ?? null;
  const chip = el?.querySelector(".vf-peer__chip") ?? null;
  const layer = document.querySelector(".vf-peers");
  const rect = el === null ? null : el.getBoundingClientRect();
  const chipRect = chip === null ? null : chip.getBoundingClientRect();
  const label = chip?.textContent ?? null;
  // ICE's remote cursors would draw the name in a plane of their own in the desk's box: any element there, other than the
  // chip, whose own text is the name
  const elsewhere = label === null ? [] : [...document.querySelectorAll("[data-ice-canvas] *")].filter(
    (n) => n !== chip && !n.closest(".vf-peers") && n.childElementCount === 0 && n.textContent === label,
  ).length;
  return {
    count: els.length,
    shown: shown.length,
    layer: layer === null ? null : { hidden: layer.getAttribute("data-hidden"), visibility: getComputedStyle(layer).visibility },
    rect: rect === null ? null : { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    chip: chipRect === null ? null : {
      left: chipRect.left, top: chipRect.top, width: chipRect.width, height: chipRect.height,
      color: getComputedStyle(chip).color,
      background: getComputedStyle(chip).backgroundColor,
      font: getComputedStyle(chip).fontSize + " " + getComputedStyle(chip).fontWeight,
    },
    label,
    elsewhere,
  };
})()`;

interface PeerDom {
  readonly count: number;
  readonly shown: number;
  readonly layer: { readonly hidden: string | null; readonly visibility: string } | null;
  readonly rect: { left: number; top: number; width: number; height: number } | null;
  readonly chip: {
    left: number;
    top: number;
    width: number;
    height: number;
    color: string;
    background: string;
    font: string;
  } | null;
  readonly label: string | null;
  readonly elsewhere: number;
}

/** DK-16's peers rows (above). Returns the problems, each in words. */
export async function peersRows(d: PeersRowsDriver): Promise<string[]> {
  const { win: a, say } = d;
  const problems: string[] = [];
  const js = <T>(w: BrowserWindow, expression: string): Promise<T> =>
    w.webContents.executeJavaScript(expression, true) as Promise<T>;
  const door = (w: BrowserWindow): Promise<PeersDoor> =>
    js<PeersDoor>(w, "globalThis.__vfDesk.peers()");
  const dom = (): Promise<PeerDom> => js<PeerDom>(a, READ_PEER);
  const until = async (
    label: string,
    timeoutMs: number,
    test: () => Promise<boolean>,
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await test()) return;
      await sleep(60);
    }
    throw new Error(
      `${label} did not happen within ${timeoutMs}ms (${JSON.stringify(await door(a))})`,
    );
  };
  const peerOf = async (): Promise<PeerSeen | undefined> => (await door(a)).record?.peers[0];
  const shoot = async (name: string): Promise<void> => {
    if (d.shotDir === undefined) return;
    mkdirSync(d.shotDir, { recursive: true });
    writeFileSync(join(d.shotDir, name), (await a.capturePage()).toPNG());
  };
  const theme = async (name: "light" | "dark"): Promise<void> => {
    await js(a, `globalThis.vibefield.theme.set(${JSON.stringify(name)})`);
    await until(
      `the desk dressed ${name}`,
      10_000,
      async () => (await js<string>(a, "globalThis.__vfDesk.theme()")) === name,
    );
    await sleep(600);
  };

  const b = await d.openPeer();
  // THE MESH, played: each window's presence handed to the other as its lane hands a room's
  let relaying = true;
  let relayed = 0;
  const relay = (async () => {
    while (relaying) {
      try {
        const fromA = await js<string[]>(a, "globalThis.__vfDesk?.presenceTap?.() ?? []");
        const fromB = b.isDestroyed()
          ? []
          : await js<string[]>(b, "globalThis.__vfDesk?.presenceTap?.() ?? []");
        if (fromA.length > 0 && !b.isDestroyed())
          await js(b, `globalThis.__vfDesk?.presenceApply?.(${JSON.stringify(fromA)})`);
        if (fromB.length > 0)
          await js(a, `globalThis.__vfDesk?.presenceApply?.(${JSON.stringify(fromB)})`);
        relayed += fromA.length + fromB.length;
      } catch {
        // a window between mounts (its door re-installing) — the next turn hands it on
      }
      await sleep(30);
    }
  })();
  let lastMove = 0;
  const point = { x: 520, y: 340 };
  const moveB = async (at: { x: number; y: number } = point): Promise<void> => {
    // two moves a pixel apart, so the second always says something new to the adapter (I33 drops a repeat)
    b.webContents.sendInputEvent({ type: "mouseMove", x: at.x - 1, y: at.y });
    await sleep(30);
    b.webContents.sendInputEvent({ type: "mouseMove", x: at.x, y: at.y });
    lastMove = Date.now();
  };
  const shownInA = async (): Promise<boolean> => (await peerOf())?.hidden === null;

  try {
    // ── ARRIVE: B's arrow in A, its tip on B's pointer ─────────────────────────────────────────────────────────────────
    await theme("light");
    b.focus();
    await moveB();
    await until("B's peer drawn in A", 15_000, async () => {
      const p = await peerOf();
      if (p === undefined || p.cursor === null) {
        await moveB();
        return false;
      }
      return p.hidden === null;
    });
    await sleep(400);
    const doorA = await door(a);
    const doorB = await door(b);
    const camA = doorA.record?.camera ?? null;
    const camB = doorB.record?.camera ?? null;
    // I45: the point B's presence FIRST sent out — B's pointer's own, never (0, 0)
    const firstB = await js<{ x: number; y: number } | null>(
      b,
      "globalThis.__vfDesk?.presenceFirst?.() ?? null",
    );
    problems.push(...judgeFirstPoint(firstB).map((p) => `PEERS ARRIVE: ${p}`));
    const seen = await dom();
    if (camA === null || camB === null)
      problems.push(`PEERS ARRIVE: no camera to place by (${JSON.stringify({ camA, camB })})`);
    else {
      const expected = expectedBox(point, camB, camA);
      problems.push(
        ...judgePeerPlace(doorA.record?.peers ?? [], expected, seen.rect).map(
          (p) => `PEERS ARRIVE: ${p}`,
        ),
      );
      say(
        `SMOKE_CANVAS_PEERS_ARRIVE ${JSON.stringify({ pointer: point, camB, camA, expected, first: firstB, record: doorA.record?.peers, rect: seen.rect, chip: seen.chip, label: seen.label, relayed })}`,
      );
    }
    if (doorA.cursors !== false)
      problems.push("PEERS ARRIVE: the layer was mounted with ICE's remote cursors");
    if (seen.elsewhere > 0)
      problems.push(
        `PEERS ARRIVE: the name is drawn ${seen.elsewhere} more time(s) in the desk — ICE's cursors`,
      );
    if (seen.label === null || !/^\S+ \S/u.test(seen.label) || /^[A-Za-z]/u.test(seen.label))
      problems.push(
        `PEERS ARRIVE: the chip reads ${JSON.stringify(seen.label)}, not the face then the name`,
      );
    if (seen.chip !== null && Math.abs(seen.chip.height - 22) > 0.5)
      problems.push(`PEERS ARRIVE: the chip is ${seen.chip.height} tall, not 22`);
    if (seen.rect !== null && seen.chip !== null) {
      const dx = seen.chip.left - seen.rect.left;
      const dy = seen.chip.top - seen.rect.top;
      if (Math.abs(dx - 14) > 0.5 || Math.abs(dy - 18) > 0.5)
        problems.push(
          `PEERS ARRIVE: the chip stands (${dx}, ${dy}) from the arrow's box, not (14, 18)`,
        );
    }
    // the stills, and the chip's contrast measured on the lit mat by day and by night
    const measure = async (): Promise<ReturnType<typeof measureChip> | null> => {
      const now = await dom();
      if (now.chip === null) return null;
      const inset = 3;
      const image: NativeImage = await a.capturePage({
        x: Math.round(now.chip.left + inset + 6),
        y: Math.round(now.chip.top + inset),
        width: Math.max(4, Math.round(now.chip.width - 2 * inset - 6)),
        height: Math.max(4, Math.round(now.chip.height - 2 * inset)),
      });
      return measureChip(new Uint8Array(image.toBitmap()));
    };
    await moveB();
    await sleep(500);
    await shoot("dk-16-peer-light.png");
    const day = await measure();
    await theme("dark");
    await moveB();
    await sleep(500);
    await shoot("dk-16-peer-dark.png");
    const night = await measure();
    say(`SMOKE_CANVAS_PEERS_CONTRAST ${JSON.stringify({ day, night })}`);
    for (const [name, m] of [
      ["day", day],
      ["night", night],
    ] as const) {
      if (m === null) problems.push(`PEERS CONTRAST: no chip to measure by ${name}`);
      else if (m.ratio < 4.5)
        problems.push(
          `PEERS CONTRAST: the chip's words measure ${m.ratio}:1 by ${name}, under 4.5`,
        );
    }
    await theme("light");

    // ── IDLE: hidden at 8 s after B's last move ────────────────────────────────────────────────────────────────────────
    await moveB();
    await until("B drawn again before the idle row", 5_000, shownInA);
    const still = lastMove;
    await sleep(Math.max(0, still + PEERS.idleNotBeforeMs - Date.now()));
    const atNotBefore = await peerOf();
    const early = atNotBefore === undefined ? "gone" : atNotBefore.hidden;
    let hiddenAfter: number | null = null;
    const deadline = still + PEERS.idleMs + PEERS.idleSlackMs + 2_000;
    while (Date.now() < deadline) {
      if ((await peerOf())?.hidden === "idle") {
        hiddenAfter = Date.now() - still;
        break;
      }
      await sleep(40);
    }
    problems.push(...judgeIdle(early, hiddenAfter).map((p) => `PEERS IDLE: ${p}`));
    const idleDom = await dom();
    if (idleDom.shown !== 0) problems.push("PEERS IDLE: the idle peer's arrow is still visible");
    say(
      `SMOKE_CANVAS_PEERS_IDLE ${JSON.stringify({ early, hiddenAfterMs: hiddenAfter, shown: idleDom.shown })}`,
    );
    // a move brings it back
    await moveB({ x: point.x + 20, y: point.y });
    await until("B drawn again after its idle", 5_000, shownInA);

    // ── BOARD: A's pegboard out — the layer hidden; folded — shown ─────────────────────────────────────────────────────
    const createAt = await js<{ x: number; y: number } | null>(
      a,
      `(() => { const el = document.querySelector(".vf-line-create"); if (el === null) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
    );
    if (createAt === null) problems.push("PEERS BOARD: no line create to raise the board");
    else {
      a.focus();
      a.webContents.sendInputEvent({ type: "mouseMove", x: createAt.x, y: createAt.y });
      await sleep(40);
      a.webContents.sendInputEvent({
        type: "mouseDown",
        x: createAt.x,
        y: createAt.y,
        button: "left",
        clickCount: 1,
      });
      await sleep(50);
      a.webContents.sendInputEvent({
        type: "mouseUp",
        x: createAt.x,
        y: createAt.y,
        button: "left",
        clickCount: 1,
      });
      await until("the board out in A", 5_000, async () => (await dom()).layer?.hidden === "board");
      await moveB();
      await sleep(300);
      const out = await dom();
      if (out.layer?.visibility !== "hidden" || out.shown !== 0)
        problems.push(
          `PEERS BOARD: a peer drawn over the board (${JSON.stringify(out.layer)}, ${out.shown} shown)`,
        );
      a.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      a.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until("the board folded in A", 5_000, async () => (await dom()).layer?.hidden === null);
      await moveB();
      await until("B drawn again after the board", 5_000, shownInA);
      say(
        `SMOKE_CANVAS_PEERS_BOARD ${JSON.stringify({ out: out.layer, shownWhileOut: out.shown })}`,
      );
    }

    // ── COVER: A covered — hidden; back — shown ────────────────────────────────────────────────────────────────────────
    await js(a, `globalThis.vibefield.view.set("godview")`);
    await until(
      "the cover over A's peers",
      10_000,
      async () => (await dom()).layer?.hidden === "cover",
    );
    await moveB();
    await sleep(300);
    const covered = await dom();
    if (covered.layer?.visibility !== "hidden" || covered.shown !== 0)
      problems.push(`PEERS COVER: a peer drawn under the cover (${JSON.stringify(covered.layer)})`);
    const saidCovered = (await door(a)).said;
    problems.push(
      ...judgeCoverSaid(saidCovered).map(
        (p) =>
          `PEERS COVER: A's own pointer under the cover — ${p} (${JSON.stringify(saidCovered)})`,
      ),
    );
    await js(a, `globalThis.vibefield.view.set("canvas")`);
    await until("A back on the canvas", 10_000, async () => (await dom()).layer?.hidden === null);
    const saidBack = (await door(a)).said;
    if (saidBack?.reason !== null)
      problems.push(`PEERS COVER: A back on the canvas still holds ${JSON.stringify(saidBack)}`);
    await moveB();
    await until("B drawn again after the cover", 5_000, shownInA);
    say(
      `SMOKE_CANVAS_PEERS_COVER ${JSON.stringify({ covered: covered.layer, said: saidCovered, back: saidBack })}`,
    );

    // ── AWAY: B's pointer leaves B's window from a desk point (the EXIT rows' control) ─────────────────────────────────
    const exitPoints = await js<{
      readonly h: number;
      readonly line: ExitPoint | null;
      readonly head: ExitPoint | null;
      readonly drag: ExitPoint | null;
    }>(b, READ_EXIT_POINTS);
    /** A's first verdict on B from `since`, polled until B's idle is due (its last move + 8 s and the slack) */
    const firstVerdict = async (
      since: number,
    ): Promise<{ hidden: string | null; ms: number | null }> => {
      const deadline = lastMove + PEERS.idleMs + PEERS.idleSlackMs + 1_000;
      while (Date.now() < deadline) {
        const p = await peerOf();
        if (p === undefined || p.hidden !== null)
          return { hidden: p === undefined ? "gone" : p.hidden, ms: Date.now() - since };
        await sleep(20);
      }
      return { hidden: null, ms: null };
    };
    /** back in B's window over the chrome (`at`), not yet on the desk: A's verdict once it has had a publish */
    const reenter = async (at: ExitPoint | null): Promise<string | null> => {
      if (at === null) return null;
      b.webContents.sendInputEvent({ type: "mouseMove", x: at.x, y: at.y });
      await sleep(PEERS.reenterMs);
      const p = await peerOf();
      return p === undefined ? "gone" : p.hidden;
    };
    b.webContents.sendInputEvent({ type: "mouseLeave", x: point.x, y: -4 });
    const awayAt = Date.now();
    const awayVerdict = await firstVerdict(awayAt);
    const saidAway = (await door(b)).said;
    const awayBy = awayVerdict.hidden === "away" ? "the OS's leave" : "none";
    if (awayVerdict.hidden !== "away")
      problems.push(
        `PEERS AWAY: B's pointer left its window and A still drew it (${JSON.stringify(awayVerdict)}; B said ${JSON.stringify(saidAway)})`,
      );
    else
      problems.push(
        ...judgeAwaySaid(saidAway).map((p) => `PEERS AWAY: ${p} (${JSON.stringify(saidAway)})`),
      );
    const away: ExitSeen = {
      from: "desk",
      point: { x: point.x, y: point.y, hit: "[data-desk]", inDesk: true, region: null },
      ...awayVerdict,
      said: saidAway,
      reentered: await reenter(exitPoints.line),
    };
    problems.push(...judgeExit(away).map((p) => `PEERS AWAY: ${p}`));
    await moveB();
    await until("B drawn again over its page", 5_000, shownInA);
    say(
      `SMOKE_CANVAS_PEERS_AWAY ${JSON.stringify({ by: awayBy, said: saidAway, ms: away.ms, reentered: away.reentered })}`,
    );

    // ── EXIT (ICE I44): B's pointer leaves B's window from BESIDE the desk — through the line, a head control, the
    // head's drag strip — hidden in A as away within one publish; back over the chrome, still away. RED at desk.6 ──────
    const exits: ExitSeen[] = [];
    for (const from of ["line", "head", "drag"] as const) {
      const at = exitPoints[from];
      if (at === null) {
        exits.push({ from, point: null, hidden: null, ms: null, said: null, reentered: null });
        continue;
      }
      await moveB();
      await until(`B drawn before its exit through ${EXIT_FROM[from]}`, 5_000, shownInA);
      await sleep(300); // its two moves land as two, never coalesced with the next
      b.webContents.sendInputEvent({ type: "mouseMove", x: at.x, y: at.y });
      await sleep(300);
      b.webContents.sendInputEvent({
        type: "mouseLeave",
        x: at.x,
        y: at.y < exitPoints.h / 2 ? -4 : exitPoints.h + 4,
      });
      const left = Date.now();
      const verdict = await firstVerdict(left);
      const said = (await door(b)).said;
      const seen: ExitSeen = { from, point: at, ...verdict, said, reentered: await reenter(at) };
      exits.push(seen);
      await moveB();
      await until(`B drawn again after its exit through ${EXIT_FROM[from]}`, 5_000, shownInA);
    }
    for (const seen of exits) problems.push(...judgeExit(seen).map((p) => `PEERS EXIT: ${p}`));
    say(`SMOKE_CANVAS_PEERS_EXIT ${JSON.stringify(exits)}`);

    // ── COUNTERS: placed every move, rendered only for the roster and the layer's verdicts ────────────────────────────
    const c0 = await door(a);
    for (let i = 0; i < 12; i += 1) {
      await moveB({ x: point.x + 40 + i * 6, y: point.y + i * 3 });
      await sleep(60);
    }
    await sleep(400);
    const c1 = await door(a);
    if (c1.renders !== c0.renders)
      problems.push(
        `PEERS COUNTERS: the layer rendered ${c1.renders - c0.renders} times for 12 moves — a render per frame`,
      );
    if ((c1.record?.writes ?? 0) <= (c0.record?.writes ?? 0))
      problems.push("PEERS COUNTERS: twelve moves wrote no place — not placed every move");
    say(
      `SMOKE_CANVAS_PEERS_COUNTERS ${JSON.stringify({ renders: [c0.renders, c1.renders], writes: [c0.record?.writes, c1.record?.writes], flushes: [c0.record?.flushes, c1.record?.flushes] })}`,
    );

    // ── GONE: B closed — its peer leaves A's roster ────────────────────────────────────────────────────────────────────
    b.destroy();
    try {
      await until("B gone from A's roster", 10_000, async () => (await dom()).count === 0);
    } catch {
      problems.push("PEERS GONE: B closed and its peer stayed in A's roster");
    }
  } catch (error) {
    // a row that cannot go on ends the rows, never what the earlier rows found
    problems.push(`PEERS: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    relaying = false;
    await relay;
    if (!b.isDestroyed()) b.destroy();
  }
  return problems;
}

export interface FaultRowsDriver {
  readonly win: BrowserWindow;
  readonly shotDir: string | undefined;
  readonly say: (line: string) => void;
}

/** The degraded desk's sentence, the canon's words (DESIGN.md §8 "When the desk can't draw"; DK-17, plan (75)). */
export const DEGRADED_SENTENCE =
  "The graphics device reported an error. The desk is still drawing — Reload restarts it.";

/** The status line under a degraded desk, as the page shows it. */
export interface DegradedLineSeen {
  readonly text: string | null;
  readonly detail: string | null;
  readonly act: string | null;
}

/** VibeField's sentence FIRST, ICE's message after it as the detail, verbatim, and ONE act: Reload. */
export function judgeDegradedBanner(line: DegradedLineSeen, message: string | undefined): string[] {
  const problems: string[] = [];
  if (line.text !== DEGRADED_SENTENCE)
    problems.push(
      `FAULT BANNER: the line reads ${JSON.stringify(line.text)}, not VibeField's sentence ${JSON.stringify(DEGRADED_SENTENCE)}`,
    );
  if (line.detail !== (message ?? null))
    problems.push(
      `FAULT BANNER: the line's detail is ${JSON.stringify(line.detail)}, not ICE's message ${JSON.stringify(message)}`,
    );
  if (line.act !== "Reload")
    problems.push(`FAULT BANNER: the line's act is ${JSON.stringify(line.act)}, not Reload`);
  return problems;
}

/** DK-16's fault rows on window A (above). Returns the problems, each in words. */
export async function faultRows(d: FaultRowsDriver): Promise<string[]> {
  const { win, say } = d;
  const problems: string[] = [];
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const until = async (label: string, timeoutMs: number, expression: string): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await js<unknown>(expression)) === true) return;
      await sleep(60);
    }
    throw new Error(
      `${label} did not happen within ${timeoutMs}ms (${JSON.stringify(await js("globalThis.__vfDesk?.status() ?? null"))})`,
    );
  };
  const shoot = async (name: string): Promise<void> => {
    if (d.shotDir === undefined) return;
    mkdirSync(d.shotDir, { recursive: true });
    writeFileSync(join(d.shotDir, name), (await win.capturePage()).toPNG());
  };
  const frames = (): Promise<number> => js<number>("globalThis.__vfDesk?.perf().frames ?? -1");
  const mountOf = (): Promise<number> => js<number>("globalThis.__vfDesk?.mount ?? -1");
  await js(`globalThis.vibefield.theme.set("light")`);
  await sleep(500);

  // ── BANNER: one uncaptured error — degraded, the status line with VibeField's sentence, ICE's message as its detail,
  //    and Reload, the desk drawing on (DK-17, plan (75)) ───────────────────────────────────────────────────────────────
  // (each row on its own: one that cannot go on is said, and the next still runs)
  try {
    const mount0 = await mountOf();
    const faultedAt = Date.now();
    const faulted = await js<boolean>(`globalThis.__vfDesk.gpuFault?.("error") ?? false`);
    if (!faulted) problems.push("FAULT BANNER: the door had no device to fault (?deskFaults=1)");
    await until("the desk degraded", 10_000, `globalThis.__vfDesk.status().state === "degraded"`);
    const toldAfterMs = Date.now() - faultedAt;
    await sleep(300);
    const line = await js<{
      text: string | null;
      detail: string | null;
      act: string | null;
      id: string | null;
    } | null>(`(() => {
      const el = document.querySelector(".vf-status-line");
      return el === null ? null : { text: el.querySelector(".vf-status-line__text")?.textContent ?? null, detail: el.querySelector(".vf-status-line__detail")?.textContent ?? null, act: el.querySelector(".vf-status-line__act")?.textContent ?? null, id: el.getAttribute("data-status-line") };
    })()`);
    const status = await js<{ state: string; message?: string }>("globalThis.__vfDesk.status()");
    if (line === null || line.id !== "desk-degraded")
      problems.push(
        `FAULT BANNER: the status line says ${JSON.stringify(line)}, not the degraded desk`,
      );
    else problems.push(...judgeDegradedBanner(line, status.message));
    if (await js<boolean>(`document.querySelector(".vf-desk-unavailable") !== null`))
      problems.push("FAULT BANNER: a degraded desk shows the card — it still draws");
    // the desk draws on beneath it
    await js(`globalThis.__vfDesk.ambient("live")`);
    const f0 = await frames();
    await sleep(600);
    const f1 = await frames();
    await js(`globalThis.__vfDesk.ambient("idle")`);
    if (!(f1 > f0)) problems.push(`FAULT BANNER: the degraded desk drew nothing (${f0} → ${f1})`);
    await shoot("dk-16-banner.png");
    say(
      `SMOKE_CANVAS_FAULT_BANNER ${JSON.stringify({ status, line, frames: [f0, f1], toldAfterMs })}`,
    );
    // its Reload: a remount, the line cleared
    const actAt = await js<{ x: number; y: number } | null>(
      `(() => { const el = document.querySelector(".vf-status-line__act"); if (el === null) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
    );
    if (actAt !== null) {
      win.focus();
      win.webContents.sendInputEvent({ type: "mouseMove", x: actAt.x, y: actAt.y });
      await sleep(40);
      win.webContents.sendInputEvent({
        type: "mouseDown",
        x: actAt.x,
        y: actAt.y,
        button: "left",
        clickCount: 1,
      });
      await sleep(50);
      win.webContents.sendInputEvent({
        type: "mouseUp",
        x: actAt.x,
        y: actAt.y,
        button: "left",
        clickCount: 1,
      });
      await until(
        "the banner's Reload remounted the desk",
        15_000,
        `(globalThis.__vfDesk?.mount ?? -1) > ${mount0} && globalThis.__vfDesk.status().state === "ready" && globalThis.__vfDesk.perf().frames > 0`,
      );
      await sleep(400);
      if (
        await js<boolean>(`document.querySelector('[data-status-line="desk-degraded"]') !== null`)
      )
        problems.push("FAULT BANNER: the banner stood after its Reload");
    }
  } catch (error) {
    problems.push(`FAULT BANNER: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ── LOST: the device destroyed — the card, its words, ONE Reload; the Reload draws again ─────────────────────────────
  try {
    const mount0 = await mountOf();
    const faultedAt = Date.now();
    const faulted = await js<boolean>(`globalThis.__vfDesk.gpuFault?.("lose") ?? false`);
    if (!faulted) problems.push("FAULT LOST: the door had no device to lose");
    await until(
      "the lost device's card",
      10_000,
      `document.querySelector('[data-desk-unavailable="lost"]') !== null`,
    );
    const toldAfterMs = Date.now() - faultedAt;
    await sleep(400);
    const card = await js<CardSeen | null>(READ_CARD);
    const canvasBg = await js<string>(CANVAS_BG);
    problems.push(...judgeLostCard(card, canvasBg).map((p) => `FAULT LOST: ${p}`));
    await shoot("dk-16-card-lost.png");
    say(
      `SMOKE_CANVAS_FAULT_LOST ${JSON.stringify({ card, canvasBg, status: await js("globalThis.__vfDesk.status()"), toldAfterMs })}`,
    );
    const reloadAt = await js<{ x: number; y: number } | null>(
      `(() => { const b = [...document.querySelectorAll(".vf-desk-unavailable button")].find((x) => x.textContent === "Reload"); if (b === undefined) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
    );
    if (reloadAt === null) problems.push("FAULT LOST: no Reload to press");
    else {
      win.webContents.sendInputEvent({ type: "mouseMove", x: reloadAt.x, y: reloadAt.y });
      await sleep(40);
      win.webContents.sendInputEvent({
        type: "mouseDown",
        x: reloadAt.x,
        y: reloadAt.y,
        button: "left",
        clickCount: 1,
      });
      await sleep(50);
      win.webContents.sendInputEvent({
        type: "mouseUp",
        x: reloadAt.x,
        y: reloadAt.y,
        button: "left",
        clickCount: 1,
      });
      await until(
        "the lost device's Reload drew the desk again",
        15_000,
        `(globalThis.__vfDesk?.mount ?? -1) > ${mount0} && globalThis.__vfDesk.status().state === "ready" && globalThis.__vfDesk.perf().frames > 0`,
      );
      await sleep(500);
      const sample = await js<{ colors: number; lumaMin: number; lumaMax: number } | null>(
        "globalThis.__vfDesk.sample()",
      );
      if (sample === null || sample.colors < 2 || sample.lumaMax <= sample.lumaMin)
        problems.push(
          `FAULT LOST: after its Reload the desk drew ${JSON.stringify(sample)} — not the desk`,
        );
      if (await js<boolean>(`document.querySelector(".vf-desk-unavailable") !== null`))
        problems.push("FAULT LOST: the card stood after its Reload drew the desk again");
      say(
        `SMOKE_CANVAS_FAULT_LOST_RELOAD ${JSON.stringify({ mount: [mount0, await mountOf()], sample })}`,
      );
    }
  } catch (error) {
    problems.push(`FAULT LOST: ${error instanceof Error ? error.message : String(error)}`);
  }
  return problems;
}
