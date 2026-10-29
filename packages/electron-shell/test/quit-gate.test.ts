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
    expect(await gate.stop()).toEqual({ kind: "done", complete: true, ended: 0 });
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
    // no decision proved a stop
    expect(await gate.stop()).toEqual({ kind: "done", complete: false, ended: 0 });
    expect(p.stops).toEqual([]);
  });

  it("census > 0, confirmed: the consented set is exactly the census, byte for byte", async () => {
    const p = pair("Me", [{ known: true, sessions: [session("a"), session("b")] }]);
    const h = port([p.value], [yes]);
    const gate = createQuitGate(h.value);
    expect(await gate.decide({ unattended: false })).toBe("proceed");
    expect(await gate.stop()).toEqual({ kind: "done", complete: true, ended: 2 });
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
    expect(await gate.stop()).toEqual({ kind: "done", complete: false, ended: 0 });
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
    expect(await gate.stop()).toEqual({ kind: "done", complete: false, ended: 0 });
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
    expect(await gate.stop()).toEqual({ kind: "aborted" });
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
    expect(await gate.stop()).toEqual({ kind: "done", complete: true, ended: 2 });
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
    expect(await gate.stop()).toEqual({ kind: "done", complete: false, ended: 0 });
    expect(h.value.log.warn).toHaveBeenCalledWith(
      "desktop.quit.pair_left_running",
      expect.any(String),
      expect.objectContaining({ reason: "fieldd did not stop" }),
    );
  });

  // AU-7 (LC-25; main-process.md §7.2) — a move to Applications runs only after a COMPLETE stop: every census read,
  // the attached pair among them, and every planned stop answered.
  it("complete counts what the stopped pairs ended, and is false when the attached pair was never reached", async () => {
    const mine = pair("Me", [{ known: true, sessions: [session("m")] }], [{ ok: true }], true);
    const theirs = pair("Kid", [{ known: true, sessions: [session("k")] }], [{ ok: true }], false);
    const both = createQuitGate(port([mine.value, theirs.value]).value);
    await both.decide({ unattended: true });
    expect(await both.stop()).toEqual({ kind: "done", complete: true, ended: 2 });

    const orphan = pair("Kid", [{ known: true, sessions: [] }], [{ ok: true }], false);
    const gate = createQuitGate(port([orphan.value]).value);
    expect(await gate.decide({ unattended: false })).toBe("proceed");
    expect(await gate.stop()).toEqual({ kind: "done", complete: false, ended: 0 });
    expect(orphan.stops).toEqual([{ sessions: [], reason: "quit" }]);
  });

  it("a pair whose changed sessions cannot be read again is left running: incomplete", async () => {
    const p = pair(
      "Me",
      [{ known: true, sessions: [session("a")] }, { known: false }],
      [{ ok: false, reason: "differ", live: ["a", "b"] }],
    );
    const gate = createQuitGate(port([p.value], [yes]).value);
    await gate.decide({ unattended: false });
    expect(await gate.stop()).toEqual({ kind: "done", complete: false, ended: 0 });
  });
});

// AU-5 (AU-D9 A; LC-24, LC-25, LC-36) — the consent box's last line, only while main will install the ready update as
// the quit ends. Main decides (`installLine`: null with nothing staged, updates off, a policy that asks first or a move
// waiting); the gate reads it only for a person's quit whose census box shows.
describe("AU-5 — the quit box says a ready update installs as you quit", () => {
  const LINE = "The Oct 28 nightly installs as you quit.";

  function withLine(h: ReturnType<typeof port>, line: string | null) {
    const installLine = vi.fn(() => line);
    return { gate: createQuitGate({ ...h.value, installLine }), installLine };
  }

  it("census > 0: the line is the detail's LAST, after the sessions, and the box keeps its two buttons", async () => {
    const p = pair("Me", [{ known: true, sessions: [session("a", "zsh", "~/p")] }]);
    const h = port([p.value], [yes]);
    const { gate } = withLine(h, LINE);
    expect(await gate.decide({ unattended: false })).toBe("proceed");
    expect(h.boxes[0]?.detail.split("\n")).toEqual([
      "Quitting stops the terminal service, which ends:",
      "zsh — ~/p",
      LINE,
    ]);
    expect(h.boxes[0]?.message).toBe("Quit VibeField and end 1 terminal session?");
    expect(h.boxes[0]?.buttons).toEqual(["Cancel", "Quit and end 1 session"]);
  });

  it("main says nothing installs (null): the box is the AL-3 box, word for word", async () => {
    const p = pair("Me", [{ known: true, sessions: [session("a", "zsh", "~/p")] }]);
    const h = port([p.value], [yes]);
    const { gate, installLine } = withLine(h, null);
    await gate.decide({ unattended: false });
    expect(installLine).toHaveBeenCalled();
    expect(h.boxes).toEqual([quitConsentBox([session("a", "zsh", "~/p")])]);
  });

  it("never on the unknown-census box: an unknown census leaves a pair running, so nothing installs", async () => {
    const p = pair("Me", [{ known: false }]);
    const h = port([p.value], [yes]);
    const { gate, installLine } = withLine(h, LINE);
    await gate.decide({ unattended: false });
    expect(h.boxes).toEqual([unknownCensusBox()]);
    expect(installLine).not.toHaveBeenCalled();
  });

  it("never read on a logout (it never asks), at census 0 (no box), or with the box turned off", async () => {
    const logout = pair("Me", [{ known: true, sessions: [session("a")] }]);
    const h1 = port([logout.value]);
    const one = withLine(h1, LINE);
    await one.gate.decide({ unattended: true });
    expect(h1.boxes).toEqual([]);
    expect(one.installLine).not.toHaveBeenCalled();

    const empty = pair("Me", [{ known: true, sessions: [] }]);
    const h2 = port([empty.value]);
    const two = withLine(h2, LINE);
    expect(await two.gate.decide({ unattended: false })).toBe("proceed");
    expect(h2.boxes).toEqual([]);
    expect(two.installLine).not.toHaveBeenCalled();

    const quiet = pair("Me", [{ known: true, sessions: [session("a")] }]);
    const h3 = port([quiet.value], [], false);
    const three = withLine(h3, LINE);
    expect(await three.gate.decide({ unattended: false })).toBe("proceed");
    expect(h3.boxes).toEqual([]);
    expect(three.installLine).not.toHaveBeenCalled();
  });

  it("the second box (a session born during the quit) asks about the sessions only", async () => {
    const p = pair(
      "Me",
      [
        { known: true, sessions: [session("a")] },
        { known: true, sessions: [session("a"), session("b", "new")] },
      ],
      [{ ok: false, reason: "the live sessions differ", live: ["a", "b"] }, { ok: true }],
    );
    const h = port([p.value], [yes, yes]);
    const { gate } = withLine(h, LINE);
    await gate.decide({ unattended: false });
    expect(h.boxes[0]?.detail.split("\n").at(-1)).toBe(LINE);
    expect(await gate.stop()).toEqual({ kind: "done", complete: true, ended: 2 });
    expect(h.boxes[1]?.detail).not.toContain(LINE);
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

  it("AU-5 — the ready update's sentence comes after the count, as the detail's last line (LC-36)", () => {
    const sessions = Array.from({ length: 6 }, (_, i) => session(`s${i}`, `t${i}`));
    const box = quitConsentBox(sessions, { installs: "VibeField 0.2.0 installs as you quit." });
    expect(box.detail.split("\n").slice(-2)).toEqual([
      "and 1 more",
      "VibeField 0.2.0 installs as you quit.",
    ]);
    expect(box.buttons).toEqual(["Cancel", "Quit and end 6 sessions"]);
  });
});
