import { useSyncExternalStore } from "react";
import { type FieldUserFace, peekHost } from "../host";

// The switch (DESIGN.md §8 "The switch"; UA-D15). Changing users reloads the
// window, so the transition is two halves that meet on one frame: the window
// you leave converges on the boot splash wearing the face of the user you are
// going to, and the window you enter paints exactly that frame first. This
// module is the conductor both halves share — which half this window is in,
// who is arriving, and the handoff that carries the face across the reload.
//
// Boot-reachable and small on purpose: the splash reads it in the first,
// synchronous render (mount.tsx), before anything heavy has loaded.

/** Who the window is changing hands to. */
export interface SwitchPersona {
  readonly userId: string;
  readonly name: string;
  readonly face: FieldUserFace;
}

/** Where the face leaves from, measured when it was clicked: the refused
 * switch flies it back to the same place. */
export interface SwitchOrigin {
  readonly element: Element;
  readonly rect: DOMRectReadOnly;
}

export type SwitchState =
  | { readonly kind: "idle" }
  | {
      /** This window is the one being left. `persona` null: a new user — the
       * plain splash, because that is how a new user's window begins. */
      readonly kind: "leaving";
      readonly persona: SwitchPersona | null;
      readonly origin: SwitchOrigin | null;
      readonly phase: "leaving" | "held" | "returning";
    }
  | {
      /** This window was reloaded by a switch and opens on the held frame. */
      readonly kind: "arriving";
      readonly persona: SwitchPersona;
      readonly phase: "held" | "revealing";
    };

/** DESIGN.md §8 "The switch" — every number the choreography runs on. The
 * scene projects these into its CSS, so the doc, the timers and the
 * transitions cannot disagree. Milliseconds unless named otherwise. */
export const SWITCH_MOTION = Object.freeze({
  faceSize: 128,
  blurPx: 40,
  recede: 0.98,
  // leaving
  travel: 560,
  blurIn: 360,
  groundDelay: 120,
  groundIn: 360,
  wordsDelay: 200,
  wordsIn: 240,
  /** The face is set down before the frame converges (§2.8's lift is 180ms). */
  setDown: 380,
  converge: 600,
  // arriving
  wordsOut: 120,
  homeDelay: 80,
  homeTravel: 600,
  groundOut: 420,
  blurOut: 560,
  handover: 120,
  revealed: 800,
  // refused
  returnGroundOut: 360,
  returnBlurOut: 480,
  returned: 800,
  // reduced motion (M6): no travel, blur or recede
  reducedFade: 120,
  reducedGroundIn: 180,
  reducedGroundOut: 120,
  reducedConverge: 300,
  reducedDone: 240,
});

const IDLE: SwitchState = { kind: "idle" };
const HANDOFF_KEY = "vf:switch-arrival";
/** A handoff older than this is not this reload's: a cold pair can take a
 * while to wake, but not a minute. */
const HANDOFF_FRESH_MS = 60_000;
/** The safety margin past a phase's own length: a scene that never reports
 * (not mounted, a stalled compositor) must not strand the switch. */
const SAFETY_MS = 400;
/** A resolved switch whose window is still here this long after was not
 * reloaded — nothing happened, so the scene says so by going away. */
const WATCHDOG_MS = 8_000;

let state: SwitchState | null = null;
const listeners = new Set<() => void>();
let stages = 0;
let onCovered: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Item 315 — main's quit has gone ahead (its gate's hold), as the desktop state says it (`quitting`). */
let quitHeld = false;

/** Item 315 (James, 2026-11-10: "it should not do anything, ignore the press"; "2. C") — a switch or a new user pressed
 * while VibeField quits. Every door swallows it and draws nothing; it never crosses to main, so its words are never
 * a person's. */
export class QuitHeldRefusal extends Error {
  constructor() {
    super("VibeField is quitting");
    this.name = "QuitHeldRefusal";
  }
}

/** Item 315 — the desktop state main publishes: `quitting` true from the quit's hold until its release. A state
 * without the field (an older shell) leaves the window not held. */
export function followQuitState(desktop: { readonly quitting?: boolean | undefined }): void {
  quitHeld = desktop.quitting === true;
}

/** Item 315 — whether this window knows VibeField is quitting. */
export function isQuitHeld(): boolean {
  return quitHeld;
}

function set(next: SwitchState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

function arm(ms: number, run: () => void): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    run();
  }, ms);
}

function disarm(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function isPersona(value: unknown): value is SwitchPersona {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  const face = p.face as Record<string, unknown> | null | undefined;
  return (
    typeof p.userId === "string" &&
    p.userId.length > 0 &&
    typeof p.name === "string" &&
    p.name.length <= 200 &&
    typeof face === "object" &&
    face !== null &&
    typeof face.emoji === "string" &&
    face.emoji.length > 0 &&
    face.emoji.length <= 32 &&
    (face.frame === undefined || face.frame === "sticker" || face.frame === "coin")
  );
}

/** Read the handoff once and consume it: a later reload of the same window
 * (a crash, a dev refresh) boots plainly. */
function takeArrival(): SwitchPersona | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(HANDOFF_KEY) ?? null;
    if (raw === null) return null;
    globalThis.sessionStorage.removeItem(HANDOFF_KEY);
    const parsed = JSON.parse(raw) as { v?: unknown; at?: unknown; persona?: unknown };
    if (parsed.v !== 1 || typeof parsed.at !== "number") return null;
    const age = Date.now() - parsed.at;
    if (age < 0 || age > HANDOFF_FRESH_MS) return null;
    if (!isPersona(parsed.persona)) return null;
    const { userId, name, face } = parsed.persona;
    return {
      userId,
      name,
      face:
        face.frame === undefined ? { emoji: face.emoji } : { emoji: face.emoji, frame: face.frame },
    };
  } catch {
    return null;
  }
}

function writeArrival(persona: SwitchPersona): void {
  try {
    globalThis.sessionStorage?.setItem(
      HANDOFF_KEY,
      JSON.stringify({ v: 1, at: Date.now(), persona }),
    );
  } catch {
    // No handoff: the next window opens on the plain splash — honest, only plainer.
  }
}

function clearArrival(): void {
  try {
    globalThis.sessionStorage?.removeItem(HANDOFF_KEY);
  } catch {
    // nothing to clear
  }
}

export function getSwitchState(): SwitchState {
  if (state === null) {
    const persona = takeArrival();
    state = persona === null ? IDLE : { kind: "arriving", persona, phase: "held" };
  }
  return state;
}

export function subscribeSwitch(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSwitchState(): SwitchState {
  return useSyncExternalStore(subscribeSwitch, getSwitchState, getSwitchState);
}

/** True while this window is covered by a switch it is leaving — the field
 * under it freezes (M5: chrome that covers the window parks the engine). */
export function isSwitchCovering(s: SwitchState): boolean {
  return s.kind === "leaving" && s.phase !== "returning";
}

/** The scene that plays the switch registers here. With nobody to play it (a
 * browser harness, a unit test) a switch goes straight to main's call. */
export function registerSwitchStage(): () => void {
  stages++;
  return () => {
    stages--;
  };
}

/** The face inside a clicked control: the row, tile or button that holds it. */
function faceIn(from: Element): Element | null {
  return from.matches(".vf-face") ? from : from.querySelector(".vf-face");
}

/** Item 315 — a press ignored while VibeField quits: said once to the log, then refused as the quit's, which every
 * door swallows. `what` is "new-user" for a leaving with no persona (the chooser's rare missing person is logged so
 * too, a known wrong label). `refused` is main's failure when the hold landed while main was asked: whatever it was,
 * the press is the quit's and nothing is said, so its message rides the log line (bounded, as the preload's
 * reader-failure line) and is the one place the real cause is kept. */
function ignoredWhileQuitting(persona: SwitchPersona | null, refused?: { cause: unknown }): never {
  try {
    const log = peekHost()?.logger.child({ component: "switch" });
    const attrs: Record<string, string> = { what: persona === null ? "new-user" : "switch" };
    if (refused !== undefined) {
      const { cause } = refused;
      attrs.cause = (cause instanceof Error ? cause.message : String(cause)).slice(0, 512);
    }
    log?.info(
      "renderer.switch.ignored_while_quitting",
      "A press was ignored: VibeField is quitting",
      attrs,
    );
  } catch {
    // a logging fault never stops the press being ignored
  }
  throw new QuitHeldRefusal();
}

/** Leave this window for another user: play the leaving, and only once the
 * frame has converged ask main (`act`) — main re-targets and reloads, and the
 * next window opens on the same frame. A refusal plays the leaving backwards
 * and rejects with main's error, for the caller to say where it always does.
 * Item 315: while VibeField quits the press is ignored. It rejects with
 * `QuitHeldRefusal` before anything moves, and a refusal from main that lands
 * once the quit has gone ahead rejects so too, as the return begins. */
export async function leaveFor(
  persona: SwitchPersona | null,
  from: Element | null,
  act: () => Promise<unknown>,
): Promise<void> {
  if (getSwitchState().kind !== "idle") {
    throw new Error("a user switch is already in flight");
  }
  // Item 315 — once VibeField's quit has gone ahead the press is ignored: nothing leaves and main is not asked.
  if (quitHeld) ignoredWhileQuitting(persona);
  // Nobody here plays a switch (a browser harness, a unit test): nothing to
  // converge, and no scene on the other side to hand a face to — straight to
  // main, which is what a switch was before it had a scene.
  if (stages === 0) {
    try {
      await act();
    } catch (error) {
      // item 315 — main's refusal that lands after the quit went ahead is the quit's
      if (quitHeld) ignoredWhileQuitting(persona, { cause: error });
      throw error;
    }
    return;
  }
  const face = from === null ? null : faceIn(from);
  const origin: SwitchOrigin | null =
    face === null ? null : { element: face, rect: face.getBoundingClientRect() };
  const leaving = { kind: "leaving", persona, origin } as const;
  const covered = new Promise<void>((resolve) => {
    onCovered = resolve;
  });
  set({ ...leaving, phase: "leaving" });
  arm(SWITCH_MOTION.converge + SAFETY_MS, switchLeft);
  await covered;
  if (persona !== null) writeArrival(persona);
  try {
    await act();
  } catch (error) {
    clearArrival();
    set({ ...leaving, phase: "returning" });
    arm(SWITCH_MOTION.returned + SAFETY_MS, switchReturned);
    // item 315 — a switch already leaving when the quit went ahead comes back and says nothing
    if (quitHeld) ignoredWhileQuitting(persona, { cause: error });
    throw error;
  }
  arm(WATCHDOG_MS, () => {
    clearArrival();
    const now = getSwitchState();
    if (now.kind === "leaving") set({ ...now, phase: "returning" });
    arm(SWITCH_MOTION.returned + SAFETY_MS, switchReturned);
  });
}

/** The scene: the leaving has converged — this is the frame the next window
 * paints first. */
export function switchLeft(): void {
  const now = getSwitchState();
  if (now.kind !== "leaving" || now.phase !== "leaving") return;
  disarm();
  set({ ...now, phase: "held" });
  const resolve = onCovered;
  onCovered = null;
  resolve?.();
}

/** The scene: a refused switch has played backwards; the window is whole. */
export function switchReturned(): void {
  const now = getSwitchState();
  if (now.kind !== "leaving" || now.phase !== "returning") return;
  disarm();
  set(IDLE);
}

/** The arriving window is ready to be seen (the boot reached the field, or
 * Setup): the scene reveals it. */
export function revealArrival(): void {
  const now = getSwitchState();
  if (now.kind !== "arriving" || now.phase !== "held") return;
  set({ ...now, phase: "revealing" });
  arm(SWITCH_MOTION.revealed + SAFETY_MS, switchRevealed);
}

/** The scene: the face is home and the field is in focus. */
export function switchRevealed(): void {
  const now = getSwitchState();
  if (now.kind !== "arriving") return;
  disarm();
  set(IDLE);
}

/** Tests only: forget the state and the handoff read — unmount first, since
 * a mounted scene keeps its stage and its subscription. */
export function resetSwitchForTests(): void {
  disarm();
  state = null;
  onCovered = null;
  quitHeld = false;
}
