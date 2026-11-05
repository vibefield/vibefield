/**
 * SD-2 (DESIGN.md §14 "When it speaks", "Where it plays") — the voice composed in main. Main reads every desktop's
 * agents through fieldd's mesh board (`agent.subscribe {scope: "mesh", projection: "field"}`), feeds
 * `@vibefield/sound`'s voice, and plays what it says only while a VibeField window is in front, Play sounds is on and
 * Quiet does not hold. The frames are contracts' EL9 fixture rows, re-dressed; the clock is virtual.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentFieldRow } from "@vibefield/contracts";
import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import type { RenderOptions, VoiceCue } from "@vibefield/sound";
import { describe, expect, it, vi } from "vitest";
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
  const ports: SoundPorts = {
    front: () => state.front,
    theme: () => state.theme,
    preferences: () => ({
      sounds: state.sounds,
      ...(state.quietUntil === undefined ? {} : { quietUntil: state.quietUntil }),
    }),
    now: () => state.wall + t,
    play: (cue, options) => heard.push({ at: t, cue, options }),
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
  it("plays nothing while no VibeField window is in front (until SD-3's notices)", async () => {
    const r = rig({ front: false });
    await done(r);
    expect(r.heard).toEqual([]);
    expect(r.observer.dropped).toEqual({ away: 1, off: 0, quiet: 0 });
  });
  it("plays nothing while Play sounds is off", async () => {
    const r = rig({ sounds: false });
    await done(r);
    expect(r.heard).toEqual([]);
    expect(r.observer.dropped).toEqual({ away: 0, off: 1, quiet: 0 });
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
