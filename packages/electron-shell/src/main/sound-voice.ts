import { AgentFieldRow, type SoundAttention } from "@vibefield/contracts";
import {
  type AgentObservation,
  createVoice,
  isQuiet,
  nearestPlace,
  type PlayRequest,
  type RenderOptions,
  type Voice,
  type VoiceClock,
  type VoiceCue,
} from "@vibefield/sound";
import { type AwayNotice, awayNameOf, awayNoticesOf } from "./away-notices";
import type { FielddHandleCoordinator } from "./fieldd-handle-coordinator";

// SD-2 (DESIGN.md §14 "When it speaks", "Where it plays"; SD-D11…D14) — the field's voice, composed in main. Main reads
// every one of the person's desktops through fieldd's mesh board (`agent.subscribe {scope: "mesh", projection:
// "field"}` on the attached user's shell-main client, re-subscribed on every new handle as the needs notices are),
// feeds each row's status to @vibefield/sound's voice, and plays what the voice says while Play sounds is on and Quiet
// does not hold, in front and away.
// - SD-3 (§14 "Away"; James, 2026-11-06: "sound on/off and notification on/off are two separate things"): while no
//   VibeField window is in front, each request the voice says also raises its silent OS notices (away-notices.ts),
//   whether or not the sound plays: the sound is Play sounds' and Quiet's, the notice macOS's and Focus's. Away the
//   sound is centred in the theme's space, never far (you are at none of your desktops), and a reminder is not said
//   at all: the first notice waits in Notification Center.
// - The open, a reconnect's replayed open and one desktop's own reset are FACTS, never news: each row is first
//   forgotten (unknown), so what it is now is heard as the first thing known about it, which the voice never sounds.
// - A row that leaves the board is forgotten the same way, which cancels anything it was about to say.
// - This desktop is the open's first device (the mesh board lists the answering desktop first); every other desktop's
//   agents are heard from across the field (SD-D14), centred, and never focused or placed by this window's panes.
// - The window says where its agents are by FLOOR SESSION (the door's SoundAttention); main maps a session to its run
//   through `row.terminal.runtimeSessionId`. A place is snapped to the five baked places (§14).

export interface SoundPreferences {
  readonly sounds: boolean;
  /** Quiet's end, epoch ms; absent, no Quiet. */
  readonly quietUntil?: number;
}

export interface SoundPorts {
  /** A VibeField window is in front. */
  front(): boolean;
  /** The app's resolved theme: the light day, the dark night (§14 "The spaces"). */
  theme(): "light" | "dark";
  preferences(): SoundPreferences;
  /** The wall clock, epoch ms (Quiet's end is a wall moment). */
  now(): number;
  play(cue: VoiceCue, options: RenderOptions): void;
  /** SD-3 — show one notice, silent; a click opens `notice.opens`. Main's port never shows one in a smoke. */
  notice(notice: AwayNotice): void;
}

/** Why a sound the voice said was not played. */
export interface SoundDrops {
  off: number;
  quiet: number;
  /** a reminder that came due while no window was in front: neither played nor posted (§14 "Away") */
  remindAway: number;
}

interface Known {
  readonly device: string;
  readonly row: AgentFieldRow;
}

const keyOf = (device: string, runId: string): string => `${device}\u0000${runId}`;

const REAL_CLOCK: VoiceClock<ReturnType<typeof setTimeout>> = {
  now: () => performance.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (timer) => clearTimeout(timer),
};

export class SoundObserver {
  private readonly voice: Voice;
  private readonly drops: SoundDrops = { off: 0, quiet: 0, remindAway: 0 };
  private posts = 0;
  private readonly rows = new Map<string, Known>();
  private here: string | null = null;
  private seen: SoundAttention = { focused: null, places: {} };
  private generation = 0;
  private stop: (() => void) | null = null;
  private readonly stopHandles: () => void;

  constructor(
    coordinator: Pick<FielddHandleCoordinator, "onHandle">,
    private readonly ports: SoundPorts,
    private readonly onError: (error: unknown) => void,
    // biome-ignore lint/suspicious/noExplicitAny: the voice is generic over its timer handle; main's and a test's differ
    clock: VoiceClock<any> = REAL_CLOCK,
  ) {
    this.voice = createVoice(clock, (request) => this.said(request));
    this.stopHandles = coordinator.onHandle((handle) => {
      this.generation += 1;
      const generation = this.generation;
      this.unsubscribe();
      this.forgetAll();
      void handle.client
        .subscribe("agent.subscribe", { scope: "mesh", projection: "field" }, (payload, kind) => {
          if (generation !== this.generation) return;
          if (kind === "snapshot") this.open(payload);
          else this.frame(payload);
        })
        .then(
          (subscription) => {
            if (generation !== this.generation) {
              subscription.unsubscribe();
              return;
            }
            this.stop = subscription.unsubscribe;
            this.open(subscription.snapshot);
          },
          (error: unknown) => {
            if (generation === this.generation) this.onError(error);
          },
        );
    });
  }

  /** Sounds the voice said and the gates held back, by gate. */
  get dropped(): Readonly<SoundDrops> {
    return { ...this.drops };
  }

  /** Notices posted while no window was in front. */
  get posted(): number {
    return this.posts;
  }

  /** The window in front says which session has the keyboard and where each shown session sits. */
  attention(attention: SoundAttention): void {
    this.seen = attention;
    for (const [key, known] of this.rows) {
      if (known.device === this.here) this.observe(key, known);
    }
    this.focus();
  }

  dispose(): void {
    this.generation += 1;
    this.stopHandles();
    this.unsubscribe();
    this.forgetAll();
  }

  private unsubscribe(): void {
    const stop = this.stop;
    this.stop = null;
    stop?.();
  }

  private forgetAll(): void {
    this.voice.reset();
    this.rows.clear();
    this.here = null;
  }

  /** The open (or its mid-stream replay): every desktop's board, replaced, heard as facts. */
  private open(raw: unknown): void {
    const devices = Array.isArray((raw as { devices?: unknown } | null)?.devices)
      ? ((raw as { devices: unknown[] }).devices as unknown[])
      : null;
    if (devices === null) return;
    const first = devices[0] as { device?: unknown } | undefined;
    this.here = typeof first?.device === "string" ? first.device : null;
    const next = new Map<string, Known>();
    for (const entry of devices) {
      const device = (entry as { device?: unknown }).device;
      const snapshot = (entry as { snapshot?: unknown }).snapshot;
      if (typeof device !== "string" || snapshot === undefined) {
        // a desktop that has not answered keeps nothing of ours: its last board is not news either way
        if (typeof device === "string") this.keepDevice(device, next);
        continue;
      }
      for (const row of this.rowsOf((snapshot as { rows?: unknown }).rows)) {
        next.set(keyOf(device, row.runtimeRunId), { device, row });
      }
    }
    this.replace(next, () => true);
  }

  /** One frame of one desktop: its delta, its reset, or its state (a state alone changes no row). */
  private frame(raw: unknown): void {
    const device = (raw as { device?: unknown } | null)?.device;
    if (typeof device !== "string") return;
    const delta = (raw as { delta?: unknown }).delta;
    const snapshot = (raw as { snapshot?: unknown }).snapshot;
    if (snapshot !== undefined) {
      const next = new Map<string, Known>();
      for (const row of this.rowsOf((snapshot as { rows?: unknown }).rows)) {
        next.set(keyOf(device, row.runtimeRunId), { device, row });
      }
      this.replace(next, (known) => known.device === device);
      return;
    }
    if (delta === undefined || delta === null) return;
    for (const runId of Array.isArray((delta as { removed?: unknown }).removed)
      ? ((delta as { removed: unknown[] }).removed as unknown[])
      : []) {
      if (typeof runId !== "string") continue;
      const key = keyOf(device, runId);
      if (this.rows.delete(key)) this.voice.observe({ id: key, status: "unknown" });
    }
    for (const row of this.rowsOf((delta as { upserts?: unknown }).upserts)) {
      const key = keyOf(device, row.runtimeRunId);
      const known = { device, row };
      this.rows.set(key, known);
      this.observe(key, known);
    }
    this.focus();
  }

  /** Replace the rows `within` covers with `next`, each heard as a fact. */
  private replace(next: Map<string, Known>, within: (known: Known) => boolean): void {
    for (const [key, known] of this.rows) {
      if (!within(known)) continue;
      this.rows.delete(key);
      this.voice.observe({ id: key, status: "unknown" });
    }
    for (const [key, known] of next) {
      this.rows.set(key, known);
      this.voice.observe({ id: key, status: "unknown" });
      this.observe(key, known);
    }
    this.focus();
  }

  private keepDevice(device: string, next: Map<string, Known>): void {
    for (const [key, known] of this.rows) if (known.device === device) next.set(key, known);
  }

  private rowsOf(raw: unknown): AgentFieldRow[] {
    if (!Array.isArray(raw)) return [];
    const rows: AgentFieldRow[] = [];
    for (const item of raw) {
      const parsed = AgentFieldRow.safeParse(item);
      if (parsed.success) rows.push(parsed.data);
    }
    return rows;
  }

  private observe(key: string, { device, row }: Known): void {
    const remote = device !== this.here;
    const session = row.terminal?.runtimeSessionId;
    const place = !remote && session !== undefined ? this.seen.places[session] : undefined;
    const observation: AgentObservation = {
      id: key,
      status: row.status,
      blockers: row.blockers.map((b) => ({ id: b.id, kind: b.kind })),
      pan: place === undefined ? 0 : nearestPlace(place),
      remote,
    };
    this.voice.observe(observation);
  }

  /** The agent you are typing into never sounds: the focused session's run on THIS desktop, if any. */
  private focus(): void {
    const focused = this.seen.focused;
    let focusedId: string | null = null;
    if (focused !== null && this.here !== null) {
      for (const [key, known] of this.rows) {
        if (known.device === this.here && known.row.terminal?.runtimeSessionId === focused) {
          focusedId = key;
          break;
        }
      }
    }
    this.voice.attention({ focusedId });
  }

  private said(request: PlayRequest): void {
    const away = !this.ports.front();
    if (away) {
      if (request.reminder) {
        this.drops.remindAway++;
        return;
      }
      const notices = awayNoticesOf(request, (id) => {
        const known = this.rows.get(id);
        return known === undefined ? undefined : awayNameOf(known.row);
      });
      for (const notice of notices) {
        this.posts++;
        this.ports.notice(notice);
      }
    }
    const preferences = this.ports.preferences();
    if (!preferences.sounds) {
      this.drops.off++;
      return;
    }
    if (isQuiet(preferences.quietUntil, this.ports.now())) {
      this.drops.quiet++;
      return;
    }
    this.ports.play(request.cue, renderOptionsOf(request, this.ports.theme(), away));
  }
}

/** What the voice asked for, as one render: the space by the theme (or far), at the five baked places. Away (SD-3)
 * every sound is centred in the theme's space. */
export function renderOptionsOf(
  request: PlayRequest,
  theme: "light" | "dark",
  away = false,
): RenderOptions {
  const place = (pan: number): number => (away ? 0 : nearestPlace(pan));
  return {
    space: request.far && !away ? "far" : theme === "dark" ? "night" : "day",
    profile: "desktop",
    count: request.count,
    pan: place(request.pan),
    ...(request.notePans === undefined ? {} : { notePans: request.notePans.map(place) }),
    level: request.level,
    variant: request.variant,
    stretch: request.stretch,
  };
}
