// @vitest-environment happy-dom
/**
 * The switch's conductor (DESIGN.md §8 "The switch"; boot/switch.ts). A user
 * switch reloads the window, so the transition is two halves that meet on one
 * frame: the leaving window asks main only once its frame has converged, and
 * hands the face across the reload in sessionStorage; the arriving window
 * opens held on that face. These rows pin the order of those acts and every
 * way a handoff can be wrong — a wrong handoff must boot plainly, never
 * strand a splash on someone else's face.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSwitchState,
  leaveFor,
  registerSwitchStage,
  resetSwitchForTests,
  revealArrival,
  SWITCH_MOTION,
  type SwitchPersona,
  switchLeft,
  switchReturned,
  switchRevealed,
} from "../src/boot/switch";

const KEY = "vf:switch-arrival";
const WORK: SwitchPersona = {
  userId: "01J9B7Q2MXC5D8F3G6H9J2K4N7",
  name: "James (work)",
  face: { emoji: "🐙", frame: "coin" },
};

let unregister: (() => void) | null = null;

/** A scene is mounted to play the switch (BootRoot's SwitchLayer, in the product). */
function stage(): void {
  unregister = registerSwitchStage();
}

/** A row holding a face, like the Me menu's. */
function row(): { button: HTMLButtonElement; face: HTMLSpanElement } {
  const button = document.createElement("button");
  const face = document.createElement("span");
  face.className = "vf-face";
  button.appendChild(face);
  document.body.appendChild(button);
  return { button, face };
}

beforeEach(() => {
  sessionStorage.clear();
  resetSwitchForTests();
});

afterEach(() => {
  unregister?.();
  unregister = null;
  resetSwitchForTests();
  sessionStorage.clear();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("the leaving window", () => {
  it("goes straight to main when nothing here plays a switch", async () => {
    const act = vi.fn(async () => undefined);
    await leaveFor(WORK, row().button, act);
    expect(act).toHaveBeenCalledTimes(1);
    expect(getSwitchState()).toEqual({ kind: "idle" });
    // No scene on this side: none promised on the other either.
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("asks main only once the frame has converged, and hands the face across", async () => {
    stage();
    const { button, face } = row();
    const act = vi.fn(async () => undefined);
    const done = leaveFor(WORK, button, act);

    const leaving = getSwitchState();
    expect(leaving).toMatchObject({ kind: "leaving", phase: "leaving", persona: WORK });
    // The face inside the pressed row travels, from where it was pressed.
    expect(leaving.kind === "leaving" ? leaving.origin?.element : null).toBe(face);
    expect(act).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();

    switchLeft(); // the scene: converged
    await done;
    expect(getSwitchState()).toMatchObject({ kind: "leaving", phase: "held" });
    expect(act).toHaveBeenCalledTimes(1);
    const handoff = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as {
      v: number;
      at: number;
      persona: SwitchPersona;
    };
    expect(handoff.v).toBe(1);
    expect(handoff.persona).toEqual(WORK);
    expect(Date.now() - handoff.at).toBeLessThan(1_000);
  });

  it("does not strand a switch whose scene never reports", async () => {
    vi.useFakeTimers();
    stage();
    const act = vi.fn(async () => undefined);
    const done = leaveFor(WORK, null, act);
    await vi.advanceTimersByTimeAsync(SWITCH_MOTION.converge);
    expect(act).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("plays a refusal backwards and rejects with main's own words", async () => {
    stage();
    const refusal = new Error("a user switch is already in flight");
    const done = leaveFor(WORK, row().button, async () => {
      throw refusal;
    });
    switchLeft();
    await expect(done).rejects.toBe(refusal);
    expect(getSwitchState()).toMatchObject({ kind: "leaving", phase: "returning" });
    // Nothing is waiting on the other side of a reload that is not coming.
    expect(sessionStorage.getItem(KEY)).toBeNull();
    switchReturned(); // the scene: back where it started
    expect(getSwitchState()).toEqual({ kind: "idle" });
  });

  it("refuses a second switch while one is in flight", async () => {
    stage();
    void leaveFor(WORK, null, async () => undefined);
    await expect(leaveFor(WORK, null, async () => undefined)).rejects.toThrow(
      "a user switch is already in flight",
    );
  });

  it("hands no face across for a new user — the plain splash is how that window begins", async () => {
    stage();
    const act = vi.fn(async () => undefined);
    const done = leaveFor(null, null, act);
    expect(getSwitchState()).toMatchObject({ kind: "leaving", persona: null });
    switchLeft();
    await done;
    expect(act).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("goes away when main answered but never reloaded the window", async () => {
    vi.useFakeTimers();
    stage();
    const done = leaveFor(WORK, null, async () => undefined);
    switchLeft();
    await done;
    expect(getSwitchState()).toMatchObject({ phase: "held" });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(getSwitchState()).toMatchObject({ kind: "leaving", phase: "returning" });
    expect(sessionStorage.getItem(KEY)).toBeNull();
    await vi.advanceTimersByTimeAsync(SWITCH_MOTION.returned + 400);
    expect(getSwitchState()).toEqual({ kind: "idle" });
  });
});

describe("the arriving window", () => {
  const write = (value: unknown): void => sessionStorage.setItem(KEY, JSON.stringify(value));

  it("opens held on the face the handoff carried, and consumes it", () => {
    write({ v: 1, at: Date.now(), persona: WORK });
    expect(getSwitchState()).toEqual({ kind: "arriving", persona: WORK, phase: "held" });
    // Read once: a later reload of this window (a crash, a dev refresh) boots plainly.
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it.each([
    ["stale", { v: 1, at: Date.now() - 61_000, persona: WORK }],
    ["future", { v: 1, at: Date.now() + 600_000, persona: WORK }],
    ["other-version", { v: 2, at: Date.now(), persona: WORK }],
    ["faceless", { v: 1, at: Date.now(), persona: { userId: WORK.userId, name: WORK.name } }],
    [
      "unknown-frame",
      { v: 1, at: Date.now(), persona: { ...WORK, face: { emoji: "🐙", frame: "medal" } } },
    ],
    ["nameless", { v: 1, at: Date.now(), persona: { userId: WORK.userId, face: WORK.face } }],
  ])("boots plainly on a %s handoff", (_, value) => {
    write(value);
    expect(getSwitchState()).toEqual({ kind: "idle" });
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("boots plainly on a handoff that is not JSON", () => {
    sessionStorage.setItem(KEY, "{not json");
    expect(getSwitchState()).toEqual({ kind: "idle" });
  });

  it("reveals once, then rests", () => {
    write({ v: 1, at: Date.now(), persona: WORK });
    expect(getSwitchState()).toMatchObject({ kind: "arriving", phase: "held" });
    revealArrival();
    expect(getSwitchState()).toMatchObject({ kind: "arriving", phase: "revealing" });
    revealArrival(); // a second reason to reveal changes nothing
    expect(getSwitchState()).toMatchObject({ phase: "revealing" });
    switchRevealed();
    expect(getSwitchState()).toEqual({ kind: "idle" });
  });

  it("does not strand a reveal whose scene never reports", async () => {
    vi.useFakeTimers();
    write({ v: 1, at: Date.now(), persona: WORK });
    getSwitchState();
    revealArrival();
    await vi.advanceTimersByTimeAsync(SWITCH_MOTION.revealed + 400);
    expect(getSwitchState()).toEqual({ kind: "idle" });
  });
});
