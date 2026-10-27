import { describe, expect, it, vi } from "vitest";
import {
  createQuitGate,
  type QuitBox,
  type QuitBoxAnswer,
  type QuitGatePort,
  type QuitPair,
  quitConsentBox,
  unknownCensusBox,
} from "../src/main/quit-gate";
import type { CensusSnapshot, StopOutcome } from "../src/main/updates/apply";

// AL-3 (`draft/thinking-app-lifecycle.md` §4) — a PERSON's quit: census 0 quits without a word, census > 0 asks once
// naming what it ends, an unknown census ends nothing it cannot name, a logout never asks, and a session born after
// the census refuses the stop and is asked about again. Every row drives the real gate through plain fakes.

const session = (id: string, title?: string, cwd?: string) => ({
  sessionId: id,
  ...(title !== undefined ? { title } : {}),
  ...(cwd !== undefined ? { cwd } : {}),
});

function pair(
  label: string,
  censuses: CensusSnapshot[],
  outcomes: StopOutcome[] = [{ ok: true }],
  attached = true,
) {
  const stops: Array<{ sessions: readonly string[]; reason: string }> = [];
  let read = 0;
  let stopped = 0;
  const value: QuitPair = {
    label,
    attached,
    census: async () => censuses[Math.min(read++, censuses.length - 1)] ?? { known: false },
    stop: async (sessions, reason) => {
      stops.push({ sessions: [...sessions], reason });
      return outcomes[Math.min(stopped++, outcomes.length - 1)] ?? { ok: true };
    },
  };
  return { value, stops };
}

function port(pairs: QuitPair[], answers: QuitBoxAnswer[] = [], confirmEnabled = true) {
  const boxes: QuitBox[] = [];
  const calls = { hold: 0, release: 0, suppress: 0 };
  let answered = 0;
  const value: QuitGatePort = {
    pairs: async () => pairs,
    confirmEnabled: () => confirmEnabled,
    confirm: async (box) => {
      boxes.push(box);
      return answers[answered++] ?? { confirmed: false, suppress: false };
    },
    suppress: () => void calls.suppress++,
    hold: () => void calls.hold++,
    release: () => void calls.release++,
    log: { info: vi.fn(), warn: vi.fn() },
  };
  return { value, boxes, calls };
}

const yes: QuitBoxAnswer = { confirmed: true, suppress: false };
const no: QuitBoxAnswer = { confirmed: false, suppress: false };

describe("the quit gate (AL-3)", () => {
  it("census 0: no box, the pair is asked to stop with nothing to end", async () => {
    const p = pair("Me", [{ known: true, sessions: [] }]);
    const h = port([p.value]);
    const gate = createQuitGate(h.value);
    expect(await gate.decide({ unattended: false })).toBe("proceed");
    expect(h.boxes).toEqual([]);
    expect(h.calls.hold).toBe(1);
    expect(await gate.stop()).toBe("done");
    expect(p.stops).toEqual([{ sessions: [], reason: "quit" }]);
  });

  it("census > 0: ONE box naming them; Cancel changes nothing — no hold, no stop", async () => {
    const p = pair("Me", [{ known: true, sessions: [session("a", "zsh", "~/p")] }]);
    const h = port([p.value], [no]);
    const gate = createQuitGate(h.value);
    expect(await gate.decide({ unattended: false })).toBe("cancel");
    expect(h.boxes).toHaveLength(1);
    expect(h.boxes[0]?.message).toBe("Quit VibeField and end 1 terminal session?");
    expect(h.boxes[0]?.buttons).toEqual(["Cancel", "Quit and end 1 session"]);
    expect(h.calls.hold).toBe(0);
    expect(await gate.stop()).toBe("done");
    expect(p.stops).toEqual([]);
  });

  it("census > 0, confirmed: the consented set is exactly the census, byte for byte", async () => {
    const p = pair("Me", [{ known: true, sessions: [session("a"), session("b")] }]);
    const h = port([p.value], [yes]);
    const gate = createQuitGate(h.value);
    expect(await gate.decide({ unattended: false })).toBe("proceed");
    expect(await gate.stop()).toBe("done");
    expect(p.stops).toEqual([{ sessions: ["a", "b"], reason: "quit" }]);
  });

  it("'Do not ask again' turns the preference off; with it off, the next quit asks nothing and still ends what it read", async () => {
    const first = pair("Me", [{ known: true, sessions: [session("a")] }]);
    const h1 = port([first.value], [{ confirmed: true, suppress: true }]);
    await createQuitGate(h1.value).decide({ unattended: false });
    expect(h1.calls.suppress).toBe(1);

    const second = pair("Me", [{ known: true, sessions: [session("a")] }]);
    const h2 = port([second.value], [], false);
    const gate = createQuitGate(h2.value);
    expect(await gate.decide({ unattended: false })).toBe("proceed");
    expect(h2.boxes).toEqual([]);
    await gate.stop();
    expect(second.stops).toEqual([{ sessions: ["a"], reason: "quit" }]);
  });

  it("census unknown: the box says so, and a confirmed quit LEAVES that pair running — nothing unnamed ends", async () => {
    const p = pair("Me", [{ known: false }]);
    const h = port([p.value], [yes]);
    const gate = createQuitGate(h.value);
    expect(await gate.decide({ unattended: false })).toBe("proceed");
    expect(h.boxes[0]).toEqual(unknownCensusBox());
    expect(await gate.stop()).toBe("done");
    expect(p.stops).toEqual([]);
  });

  it("one census unknown, another with sessions: the box names none, so NO session ends — only an empty pair stops", async () => {
    const unknownPair = pair("Kid", [{ known: false }], [{ ok: true }], false);
    const busy = pair(
      "Me",
      [{ known: true, sessions: [session("a", "zsh")] }],
      [{ ok: true }],
      true,
    );
    const empty = pair("Guest", [{ known: true, sessions: [] }], [{ ok: true }], false);
    const h = port([unknownPair.value, busy.value, empty.value], [yes]);
    const gate = createQuitGate(h.value);
    expect(await gate.decide({ unattended: false })).toBe("proceed");
    expect(h.boxes).toEqual([unknownCensusBox()]);
    expect(h.boxes[0]?.buttons).toEqual(["Cancel", "Quit and leave it running"]);
    expect(await gate.stop()).toBe("done");
    expect(busy.stops).toEqual([]);
    expect(unknownPair.stops).toEqual([]);
    expect(empty.stops).toEqual([{ sessions: [], reason: "quit" }]);
  });

  it("a logout never asks, and ends what it read with the logout reason", async () => {
    const p = pair("Me", [{ known: true, sessions: [session("a")] }]);
    const h = port([p.value]);
    const gate = createQuitGate(h.value);
    expect(await gate.decide({ unattended: true })).toBe("proceed");
    expect(h.boxes).toEqual([]);
    await gate.stop();
    expect(p.stops).toEqual([{ sessions: ["a"], reason: "logout" }]);
  });

  it("every pair stops, the attached one LAST, and the box names whose session is whose", async () => {
    const mine = pair(
      "Me",
      [{ known: true, sessions: [session("m", "zsh")] }],
      [{ ok: true }],
      true,
    );
    const theirs = pair(
      "Kid",
      [{ known: true, sessions: [session("k", "vim")] }],
      [{ ok: true }],
      false,
    );
    const order: string[] = [];
    const tap = (p: QuitPair): QuitPair => ({
      ...p,
      stop: async (s, r) => {
        order.push(p.label);
        return p.stop(s, r);
      },
    });
    const h = port([tap(mine.value), tap(theirs.value)], [yes]);
    const gate = createQuitGate(h.value);
    await gate.decide({ unattended: false });
    expect(h.boxes[0]?.message).toBe("Quit VibeField and end 2 terminal sessions?");
    expect(h.boxes[0]?.detail).toContain("zsh (Me)");
    expect(h.boxes[0]?.detail).toContain("vim (Kid)");
    await gate.stop();
    expect(order).toEqual(["Kid", "Me"]);
  });

  it("a session born after the census refuses the stop; the box asks again with the new set, and its Cancel gives the app back", async () => {
    const p = pair(
      "Me",
      [
        { known: true, sessions: [session("a")] },
        { known: true, sessions: [session("a"), session("b", "new")] },
      ],
      [{ ok: false, reason: "the live sessions differ", live: ["a", "b"] }],
    );
    const h = port([p.value], [yes, no]);
    const gate = createQuitGate(h.value);
    await gate.decide({ unattended: false });
    expect(await gate.stop()).toBe("aborted");
    expect(h.boxes[1]?.detail).toContain("A session started while VibeField was quitting");
    expect(h.boxes[1]?.suppressible).toBe(false);
    expect(h.calls.release).toBe(1);
    expect(p.stops).toEqual([{ sessions: ["a"], reason: "quit" }]);
  });

  it("… and its confirm stops with exactly the set the second box named", async () => {
    const p = pair(
      "Me",
      [
        { known: true, sessions: [session("a")] },
        { known: true, sessions: [session("a"), session("b")] },
      ],
      [{ ok: false, reason: "differ", live: ["a", "b"] }, { ok: true }],
    );
    const h = port([p.value], [yes, yes]);
    const gate = createQuitGate(h.value);
    await gate.decide({ unattended: false });
    expect(await gate.stop()).toBe("done");
    expect(p.stops.map((s) => s.sessions)).toEqual([["a"], ["a", "b"]]);
  });

  it("a stop that fails for any other reason leaves the pair running, said, and the quit goes on", async () => {
    const p = pair(
      "Me",
      [{ known: true, sessions: [] }],
      [{ ok: false, reason: "fieldd did not stop" }],
    );
    const h = port([p.value]);
    const gate = createQuitGate(h.value);
    await gate.decide({ unattended: false });
    expect(await gate.stop()).toBe("done");
    expect(h.value.log.warn).toHaveBeenCalledWith(
      "desktop.quit.pair_left_running",
      expect.any(String),
      expect.objectContaining({ reason: "fieldd did not stop" }),
    );
  });
});

describe("the consent box's words (DESIGN.md §9)", () => {
  it("lists five sessions, then counts the rest, and an untitled one says so", () => {
    const box = quitConsentBox(
      Array.from({ length: 7 }, (_, i) => session(`s${i}`, i === 0 ? undefined : `t${i}`, "~/w")),
    );
    expect(box.message).toBe("Quit VibeField and end 7 terminal sessions?");
    expect(box.detail.split("\n")).toEqual([
      "Quitting stops the terminal service, which ends:",
      "untitled session — ~/w",
      "t1 — ~/w",
      "t2 — ~/w",
      "t3 — ~/w",
      "t4 — ~/w",
      "and 2 more",
    ]);
    expect(box.buttons).toEqual(["Cancel", "Quit and end 7 sessions"]);
    expect(box.cancelId).toBe(0);
    expect(box.suppressible).toBe(true);
  });
});
