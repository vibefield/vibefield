/**
 * SD-2 (DESIGN.md §14 "When it speaks", "Where it plays") — the voice composed in main. Main reads every desktop's
 * agents through fieldd's mesh board (`agent.subscribe {scope: "mesh", projection: "field"}`), feeds
 * `@vibefield/sound`'s voice, and plays what it says while Play sounds is on and Quiet does not hold. SD-3 (§14 "Away"):
 * while no VibeField window is in front it plays too, centred in the theme's space, says no reminder, and each request
 * raises its silent notices, played or not. The frames are contracts' EL9 fixture rows, re-dressed; the clock is
 * virtual.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentFieldRow } from "@vibefield/contracts";
import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import type { RenderOptions, VoiceCue } from "@vibefield/sound";
import { describe, expect, it, vi } from "vitest";
import type { AwayNotice } from "../src/main/away-notices";
import { SoundObserver, type SoundPorts } from "../src/main/sound-voice";

const BASE = AgentFieldRow.parse(
  (
    JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../contracts/fixtures/agent-field-snapshot.valid.json"),
        "utf8",
      ),
    ) as { rows: unknown[] }
  ).rows[0],
);

const HERE = "dev-here";
const THERE = "dev-there";

function row(
  id: string,
  status: "working" | "idle" | "blocked",
  extra: { device?: string; blockers?: { id: string; kind: string }[]; session?: string } = {},
): AgentFieldRow {
  return {
    ...BASE,
    runtimeRunId: id,
    device: extra.device ?? HERE,
    status,
    blockers: (extra.blockers ?? []).map((b) => ({ ...b, since: BASE.statusSince })),
    terminal: {
      hosted: "local",
      runtimeSessionId: extra.session ?? `pty-${id}`,
      workloadClass: "agent",
    },
  };
}

let revision = 1;
const snapshotOf = (rows: AgentFieldRow[]) => ({ epoch: "e1", revision: revision++, rows });
const open = (here: AgentFieldRow[], there?: AgentFieldRow[]) => ({
  devices: [
    { device: HERE, state: "live", asOf: "2026-11-05T02:00:00.000Z", snapshot: snapshotOf(here) },
    ...(there === undefined
      ? []
      : [
          {
            device: THERE,
            state: "live",
            asOf: "2026-11-05T02:00:00.000Z",
            snapshot: snapshotOf(there),
          },
        ]),
  ],
});
const delta = (device: string, upserts: AgentFieldRow[], removed: string[] = []) => ({
  device,
  delta: { epoch: "e1", since: revision - 1, revision: revision++, upserts, removed },
});

type OnEvent = (payload: unknown, kind: "snapshot" | "delta") => void;

interface Heard {
  readonly at: number;
  readonly cue: VoiceCue;
  readonly options: RenderOptions;
}

function rig(
  opts: { front?: boolean; theme?: "light" | "dark"; sounds?: boolean; quietUntil?: number } = {},
) {
  let t = 0;
  let nextId = 1;
  const timers: { id: number; at: number; fn: () => void }[] = [];
  const clock = {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ id, at: t + ms, fn });
      return id;
    },
    clearTimer: (id: number) => {
      const i = timers.findIndex((x) => x.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const x = timers[0];
      if (!x || x.at > end) break;
      timers.shift();
      t = x.at;
      x.fn();
    }
    t = end;
  };
  const state = {
    front: opts.front ?? true,
    theme: opts.theme ?? "light",
    sounds: opts.sounds ?? true,
    quietUntil: opts.quietUntil as number | undefined,
    wall: Date.UTC(2026, 10, 5, 15),
  };
  const heard: Heard[] = [];
  const posted: (AwayNotice & { readonly at: number })[] = [];
  const ports: SoundPorts = {
    front: () => state.front,
    theme: () => state.theme,
    preferences: () => ({
      sounds: state.sounds,
      ...(state.quietUntil === undefined ? {} : { quietUntil: state.quietUntil }),
    }),
    now: () => state.wall + t,
    play: (cue, options) => heard.push({ at: t, cue, options }),
    notice: (notice) => posted.push({ at: t, ...notice }),
  };
  let onEvent: OnEvent = () => {};
  const unsubscribe = vi.fn();
  const subscribed: { method: string; params: unknown }[] = [];
  let answer!: (snapshot: unknown) => void;
  const handle = {
    info: { bootId: "boot-1", port: 4242 },
    client: {
      subscribe: vi.fn((method: string, params: unknown, listener: OnEvent) => {
        subscribed.push({ method, params });
        onEvent = listener;
        return new Promise((resolve) => {
          answer = (snapshot) => resolve({ subId: "s1", snapshot, unsubscribe });
        });
      }),
    },
  } as unknown as FielddHandle;
  const listeners = new Set<(handle: FielddHandle) => void>();
  const errors: unknown[] = [];
  const observer = new SoundObserver(
    {
      onHandle: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    ports,
    (error) => errors.push(error),
    clock,
  );
  const attach = async (snapshot: unknown) => {
    for (const listener of listeners) listener(handle);
    answer(snapshot);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return {
    observer,
    heard,
    posted,
    errors,
    state,
    subscribed,
    unsubscribe,
    attach,
    advance,
    frame: (payload: unknown) => onEvent(payload, "delta"),
    reopen: (payload: unknown) => onEvent(payload, "snapshot"),
    said: () => heard.map((h) => `${h.at} ${h.cue}`),
  };
}

describe("main hears every desktop's agents through fieldd's mesh board", () => {
  it("asks for the field board at the mesh scope, on each new handle", async () => {
    const r = rig();
    await r.attach(open([]));
    expect(r.subscribed).toEqual([
      { method: "agent.subscribe", params: { scope: "mesh", projection: "field" } },
    ]);
  });
  it("says Done when an agent here finishes, in the day space by the light theme, centred", async () => {
    const r = rig();
    await r.attach(open([row("a", "working"), row("b", "working")]));
    r.advance(100);
    r.frame(delta(HERE, [row("a", "idle")]));
    r.advance(10_000);
    expect(r.said()).toEqual(["1320 done"]);
    expect(r.heard[0]!.options).toMatchObject({
      space: "day",
      profile: "desktop",
      count: 1,
      pan: 0,
      variant: 0,
    });
  });
  it("hears the dark theme as night", async () => {
    const r = rig({ theme: "dark" });
    await r.attach(open([row("a", "working"), row("b", "working")]));
    r.frame(delta(HERE, [row("a", "idle")]));
    r.advance(10_000);
    expect(r.heard[0]!.options.space).toBe("night");
  });
  it("hears another desktop's agent from across the field (SD-D14)", async () => {
    const r = rig();
    await r.attach(open([row("a", "working")], [row("r", "working", { device: THERE })]));
    r.frame(delta(THERE, [row("r", "idle", { device: THERE })]));
    r.advance(10_000);
    expect(r.heard.map((h) => h.options.space)).toEqual(["far"]);
  });
  it("plays a permission under a running subagent as an approval: the blocker wins (§14 rule 1)", async () => {
    const r = rig();
    await r.attach(open([row("a", "working"), row("z", "working")]));
    r.frame(delta(HERE, [row("a", "working", { blockers: [{ id: "p1", kind: "permission" }] })]));
    r.advance(3_000);
    expect(r.said()).toEqual(["770 approval"]);
  });
  it("hears the open, and a desktop's own reset, as facts, not news", async () => {
    const r = rig();
    await r.attach(
      open([
        row("a", "blocked", { blockers: [{ id: "p1", kind: "permission" }] }),
        row("b", "idle"),
      ]),
    );
    r.reopen(open([row("a", "idle"), row("b", "working")]));
    r.frame({ device: HERE, snapshot: snapshotOf([row("a", "working"), row("b", "idle")]) });
    r.advance(60_000);
    expect(r.heard).toEqual([]);
  });
  it("says nothing for an agent that leaves the board, and cancels what it was about to say", async () => {
    const r = rig();
    await r.attach(open([row("a", "working"), row("b", "working")]));
    r.frame(delta(HERE, [row("a", "idle")]));
    r.advance(200);
    r.frame(delta(HERE, [], ["a"]));
    r.advance(10_000);
    expect(r.heard).toEqual([]);
  });
  it("passes over a row it cannot read and hears the rest", async () => {
    const r = rig();
    await r.attach(open([row("a", "working"), row("b", "working")]));
    r.frame(
      delta(HERE, [{ runtimeRunId: "broken" } as unknown as AgentFieldRow, row("a", "idle")]),
    );
    r.advance(10_000);
    expect(r.said()).toEqual(["1220 done"]);
  });
});

describe("the gates: in front, Play sounds, Quiet (§14 'Where it plays', §8 'Settings → Sound')", () => {
  const done = async (r: ReturnType<typeof rig>) => {
    await r.attach(open([row("a", "working"), row("b", "working")]));
    r.frame(delta(HERE, [row("a", "idle")]));
    r.advance(10_000);
  };
  it("plays nothing while Play sounds is off, and posts no notice in front", async () => {
    const r = rig({ sounds: false });
    await done(r);
    expect(r.heard).toEqual([]);
    expect(r.posted).toEqual([]);
    expect(r.observer.dropped).toEqual({ off: 1, quiet: 0, remindAway: 0 });
  });
  it("plays nothing while Quiet holds, and plays again once it has ended by itself", async () => {
    const r = rig({ quietUntil: Date.UTC(2026, 10, 5, 15) + 20_000 });
    await done(r);
    expect(r.heard).toEqual([]);
    expect(r.observer.dropped.quiet).toBe(1);
    r.frame(delta(HERE, [row("a", "working")]));
    r.advance(15_000);
    r.frame(delta(HERE, [row("a", "idle")]));
    r.advance(10_000);
    expect(r.heard.map((h) => h.cue)).toEqual(["done"]);
  });
});

describe("away: VibeField plays the sound itself, and a silent notice says it (SD-3, §14 'Away')", () => {
  const AGENT = "Claude Code in vibe-field";
  it("plays the sound with no window in front, and posts its notice, which opens Godview", async () => {
    const r = rig({ front: false });
    await r.attach(open([row("a", "working"), row("b", "working")]));
    r.frame(delta(HERE, [row("a", "idle")]));
    r.advance(10_000);
    expect(r.said()).toEqual(["1220 done"]);
    expect(r.posted).toEqual([{ at: 1220, title: AGENT, body: "Done", opens: "godview" }]);
    expect(r.observer.posted).toBe(1);
    expect(r.observer.dropped).toEqual({ off: 0, quiet: 0, remindAway: 0 });
  });
  it("posts the notice, silent, with Play sounds off: the two are separate things (Q1)", async () => {
    const r = rig({ front: false, sounds: false });
    await r.attach(open([row("a", "working"), row("b", "working")]));
    r.frame(delta(HERE, [row("a", "working", { blockers: [{ id: "q1", kind: "question" }] })]));
    r.advance(3_000);
    expect(r.heard).toEqual([]);
    expect(r.posted.map((n) => [n.title, n.body])).toEqual([[AGENT, "Has a question"]]);
    expect(r.observer.dropped.off).toBe(1);
  });
  it("posts the notice while Quiet holds, and plays nothing", async () => {
    const r = rig({ front: false, quietUntil: Date.UTC(2026, 10, 5, 15) + 60_000 });
    await r.attach(open([row("a", "working"), row("b", "working")]));
    r.frame(delta(HERE, [row("a", "working", { blockers: [{ id: "p1", kind: "permission" }] })]));
    r.advance(3_000);
    expect(r.heard).toEqual([]);
    expect(r.posted.map((n) => n.body)).toEqual(["Needs your approval"]);
    expect(r.observer.dropped.quiet).toBe(1);
  });
  it("posts nothing while a window is in front: the window says it there", async () => {
    const r = rig();
    await r.attach(open([row("a", "working"), row("b", "working")]));
    r.frame(delta(HERE, [row("a", "idle")]));
    r.advance(10_000);
    expect(r.said()).toEqual(["1220 done"]);
    expect(r.posted).toEqual([]);
  });
  it("centres every sound in the theme's space, never far, and never by a pane", async () => {
    const r = rig({ front: false, theme: "dark" });
    await r.attach(
      open(
        [
          row("a", "working", { session: "pty-a" }),
          row("b", "working", { session: "pty-b" }),
          row("z", "working"),
        ],
        [row("r", "working", { device: THERE })],
      ),
    );
    r.observer.attention({ focused: null, places: { "pty-a": -0.9, "pty-b": 0.6 } });
    r.frame(delta(THERE, [row("r", "idle", { device: THERE })]));
    r.frame(
      delta(HERE, [row("a", "idle", { session: "pty-a" }), row("b", "idle", { session: "pty-b" })]),
    );
    r.advance(10_000);
    expect(r.heard.map((h) => [h.options.space, h.options.pan])).toEqual([
      ["night", 0],
      ["night", 0],
    ]);
    const chord = r.heard.find((h) => h.options.count === 2);
    expect(chord?.options.notePans).toEqual([0, 0]);
  });
  it("titles a Done chord by its number, and All quiet by the app (Q2)", async () => {
    const r = rig({ front: false });
    await r.attach(open([row("a", "working"), row("b", "working"), row("c", "working")]));
    r.frame(delta(HERE, [row("a", "idle"), row("b", "idle")]));
    r.advance(10_000);
    r.frame(delta(HERE, [row("c", "idle")]));
    r.advance(10_000);
    expect(r.posted.map((n) => [n.title, n.body])).toEqual([
      ["2 agents", "Done"],
      ["VibeField", "All quiet"],
    ]);
  });
  it("names each agent of a request two agents share, and plays it once", async () => {
    const r = rig({ front: false });
    await r.attach(open([row("a", "working"), row("b", "working"), row("z", "working")]));
    r.frame(
      delta(HERE, [
        row("a", "working", { blockers: [{ id: "q1", kind: "question" }] }),
        row("b", "working", { blockers: [{ id: "q2", kind: "question" }] }),
      ]),
    );
    r.advance(3_000);
    expect(r.heard.map((h) => h.cue)).toEqual(["question"]);
    expect(r.posted.map((n) => [n.title, n.body])).toEqual([
      [AGENT, "Has a question"],
      [AGENT, "Has a question"],
    ]);
  });
  it("says no reminder away, and saves none for later: the first notice waits (Q6)", async () => {
    const r = rig({ front: false });
    await r.attach(open([row("a", "working"), row("b", "working")]));
    r.frame(delta(HERE, [row("a", "working", { blockers: [{ id: "p1", kind: "permission" }] })]));
    r.advance(700_000);
    expect(r.heard.map((h) => h.cue)).toEqual(["approval"]);
    expect(r.posted).toHaveLength(1);
    expect(r.observer.dropped.remindAway).toBe(2);
    r.state.front = true;
    r.advance(1_000_000);
    expect(r.heard.map((h) => h.cue)).toEqual(["approval"]);
  });
});

describe("the window's attention: focus and place, by floor session (SD-D11, SD-D12)", () => {
  it("never sounds the agent whose pane you are typing into", async () => {
    const r = rig();
    await r.attach(open([row("a", "working", { session: "pty-a" }), row("b", "working")]));
    r.observer.attention({ focused: "pty-a", places: {} });
    r.frame(
      delta(HERE, [
        row("a", "blocked", { session: "pty-a", blockers: [{ id: "p1", kind: "permission" }] }),
      ]),
    );
    r.advance(100_000);
    expect(r.heard).toEqual([]);
  });
  it("places a sound toward its pane, snapped to the five baked places", async () => {
    const r = rig();
    await r.attach(
      open([row("a", "working", { session: "pty-a" }), row("b", "working", { session: "pty-b" })]),
    );
    r.observer.attention({ focused: null, places: { "pty-a": -0.9, "pty-b": 0.2 } });
    r.frame(delta(HERE, [row("a", "idle", { session: "pty-a" })]));
    r.advance(10_000);
    expect(r.heard[0]!.options.pan).toBe(-0.6);
  });
  it("places each agent of a Done chord on its own side", async () => {
    const r = rig();
    await r.attach(
      open([
        row("a", "working", { session: "pty-a" }),
        row("b", "working", { session: "pty-b" }),
        row("z", "working"),
      ]),
    );
    r.observer.attention({ focused: null, places: { "pty-a": -0.5, "pty-b": 0.35 } });
    r.frame(
      delta(HERE, [row("a", "idle", { session: "pty-a" }), row("b", "idle", { session: "pty-b" })]),
    );
    r.advance(10_000);
    expect(r.heard[0]!.options).toMatchObject({ count: 2, notePans: [-0.6, 0.3] });
  });
  it("never places another desktop's agent by a pane of this window", async () => {
    const r = rig();
    await r.attach(
      open([row("a", "working")], [row("r", "working", { device: THERE, session: "pty-r" })]),
    );
    r.observer.attention({ focused: "pty-r", places: { "pty-r": -0.6 } });
    r.frame(delta(THERE, [row("r", "idle", { device: THERE, session: "pty-r" })]));
    r.advance(10_000);
    expect(r.heard.map((h) => [h.options.space, h.options.pan])).toEqual([["far", 0]]);
  });
});

describe("held in main's source (main/index.ts runs at its load, so no unit reaches its wiring)", () => {
  const index = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
  const start = index.indexOf("new SoundObserver(");
  const wiring = index.slice(start, index.indexOf("const offerConnect", start));
  it("listens where a player can play or the OS can show a notice (SD-3)", () => {
    expect(start).toBeGreaterThan(0);
    expect(index.slice(0, start)).toMatch(
      /const voice =\s*desktopSound\?\.state\(\) === "ready" \|\| Notification\.isSupported\(\)\s*\? $/u,
    );
  });
  it("shows a notice silent, and never in a smoke or a marked run", () => {
    expect(wiring).toMatch(
      /notice: \(words\) => \{\s*if \(isSmokeLike\(MODE\) \|\| process\.env\["VF_SMOKE_RUN"\] !== undefined\) return;\s*if \(!Notification\.isSupported\(\)\) return;\s*showViewNotice\(words, \{ silent: true, event: "desktop\.away_notice\.reveal_failed" \}\);/u,
    );
  });
});

describe("its life", () => {
  it("unsubscribes when disposed and says nothing after", async () => {
    const r = rig();
    await r.attach(open([row("a", "working"), row("b", "working")]));
    r.observer.dispose();
    expect(r.unsubscribe).toHaveBeenCalledTimes(1);
    r.frame(delta(HERE, [row("a", "idle")]));
    r.advance(10_000);
    expect(r.heard).toEqual([]);
  });
});
