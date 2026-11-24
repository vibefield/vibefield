import { LOG_STREAMS } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { VitalsIncidentAsks } from "./vitals-incidents";

// VT-2 (track VT, 2026-11-24) — THE VITALS WINDOW'S FEED, main's half. The window holds no daemon token and asks
// for nothing: while it is open, main hears fieldd's vitals door and the two log doors on its OWN connection and
// hands what arrives down one MessagePort. The page can therefore do nothing but read, and a closed window costs
// main nothing (PF2: main relays only while the window is open, and never on a timer of its own).
//
// One envelope each way down, none up: `{ v: 1, kind, origin?, event, payload? }` as a JSON string.

/** The lines the window asks each log door for when it opens. */
export const VITALS_LOG_LIMIT = 500;
/** How far back the lanes reach, so the lines under them reach as far. */
export const VITALS_LOG_BACK_MS = 5 * 60_000;
/** A subscribe that was refused is asked again after this long, while the window stays open. */
export const VITALS_FEED_RETRY_MS = 5_000;
/** A frame larger than this is not sent: its door is said to be down instead, and the log says why. */
export const VITALS_FRAME_BYTES_MAX = 32 * 1024 * 1024;

export interface VitalsFeedPort {
  postMessage(message: string): void;
  start(): void;
  close(): void;
  /** `close`, and (VT-4b) `message`: the window's one ask, an incident to open. A `close` carries no event. */
  on(event: "close" | "message", listener: (event?: { data: unknown }) => void): unknown;
}

type FeedEventKind = "snapshot" | "delta";

/** What the feed reads of main's fieldd client. */
export interface VitalsFielddClient {
  readonly status: string;
  onStatusChange(listener: () => void): () => void;
  subscribe(
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: FeedEventKind) => void,
  ): Promise<{ snapshot: unknown; unsubscribe: () => void }>;
  /** VT-4b — one request, for an incident the window opened (`vitals.incidents.get`) */
  request?(method: string, params?: unknown): Promise<unknown>;
}

/** What the feed reads of main's own log door (`ElectronLocalDiagnostics`). */
export interface VitalsShellLogs {
  subscribe(
    query: unknown,
    emit: (payload: unknown, kind: FeedEventKind) => void,
  ): Promise<{ snapshot: unknown; dispose: () => void }>;
}

export interface VitalsFeedSources {
  /** Hears main's fieldd client now and every one after it (a daemon bounce, a user switch); `null` when none. */
  onFieldd(listener: (client: VitalsFielddClient | null) => void): () => void;
  /** Main's own log lines; absent in a mode that keeps none. */
  shellLogs?: VitalsShellLogs;
  logger: Logger;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

type Origin = "fieldd" | "shell";

const FIELDD_LOG_SOURCES = [LOG_STREAMS.SYSTEM_FIELDD, LOG_STREAMS.SYSTEM_FIELD_NATIVE] as const;
const SHELL_LOG_SOURCES = [
  LOG_STREAMS.SYSTEM_DESKTOP,
  LOG_STREAMS.SYSTEM_RENDERER,
  LOG_STREAMS.SYSTEM_UTILITY,
] as const;

/** One window generation's feed. Exported for its tests, which drive it with a fake port and fake doors. */
export class VitalsFeedSession {
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private closed = false;
  /** bumped whenever the fieldd client changes, so a late answer from an old one is dropped */
  private generation = 0;
  private fielddDisposers: Array<() => void> = [];
  private shellDispose: (() => void) | null = null;
  private stopHearingFieldd: (() => void) | null = null;
  private retry: unknown = null;
  /** VT-4b — the fieldd client now, which reads an incident the window opens */
  private client: VitalsFielddClient | null = null;
  private readonly asks = new VitalsIncidentAsks(
    (id) => this.client?.request?.("vitals.incidents.get", { id }) ?? null,
    (message) => this.post(message),
  );

  constructor(
    private readonly port: VitalsFeedPort,
    private readonly sources: VitalsFeedSources,
  ) {
    this.now = sources.now ?? Date.now;
    this.setTimer = sources.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      sources.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  start(): void {
    this.port.on("message", (event) => this.asks.hear(event?.data));
    this.port.on("close", () => this.close());
    this.port.start();
    void this.attachShellLogs();
    this.stopHearingFieldd = this.sources.onFieldd((client) => this.attachFieldd(client));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopHearingFieldd?.();
    this.stopHearingFieldd = null;
    this.releaseFieldd();
    this.shellDispose?.();
    this.shellDispose = null;
    try {
      this.port.close();
    } catch {
      // the window's document is already gone
    }
  }

  private releaseFieldd(): void {
    if (this.retry !== null) this.clearTimer(this.retry);
    this.retry = null;
    for (const dispose of this.fielddDisposers.splice(0)) {
      try {
        dispose();
      } catch {
        // a client that is already closed has nothing left to release
      }
    }
  }

  private logQuery(sources: readonly string[]): Record<string, unknown> {
    return {
      sources,
      minLevel: "info",
      sinceTime: Math.max(0, this.now() - VITALS_LOG_BACK_MS),
      limit: VITALS_LOG_LIMIT,
    };
  }

  private async attachShellLogs(): Promise<void> {
    const logs = this.sources.shellLogs;
    if (logs === undefined) return;
    try {
      const subscription = await logs.subscribe(this.logQuery(SHELL_LOG_SOURCES), (payload, kind) =>
        this.post({ kind: "logs", origin: "shell", event: kind, payload }),
      );
      if (this.closed) {
        subscription.dispose();
        return;
      }
      this.shellDispose = subscription.dispose;
      this.post({
        kind: "logs",
        origin: "shell",
        event: "snapshot",
        payload: subscription.snapshot,
      });
    } catch (error) {
      this.sources.logger.warn(
        "desktop.vitals.shell_logs_unavailable",
        "The Vitals window could not read the shell's own log lines",
        { error: error instanceof Error ? error.message : String(error) },
      );
      this.post({ kind: "logs", origin: "shell", event: "down" });
    }
  }

  private attachFieldd(client: VitalsFielddClient | null): void {
    if (this.closed) return;
    this.generation += 1;
    const generation = this.generation;
    this.client = client;
    this.releaseFieldd();
    if (client === null) {
      this.sayFielddDown();
      return;
    }
    // a client that lost its socket replays its subscriptions itself, each with a fresh snapshot; until then the
    // window is told the door is shut, and keeps what it drew
    let ready = client.status === "ready";
    this.fielddDisposers.push(
      client.onStatusChange(() => {
        if (this.closed || generation !== this.generation) return;
        const next = client.status === "ready";
        if (ready && !next) this.sayFielddDown();
        ready = next;
      }),
    );
    void this.subscribeFieldd(client, generation);
  }

  private async subscribeFieldd(client: VitalsFielddClient, generation: number): Promise<void> {
    const current = (): boolean => !this.closed && generation === this.generation;
    const open = async (
      method: string,
      params: unknown,
      envelope: (event: FeedEventKind, payload: unknown) => Record<string, unknown>,
    ): Promise<void> => {
      const subscription = await client.subscribe(method, params, (payload, kind) => {
        if (current()) this.post(envelope(kind, payload));
      });
      if (!current()) {
        subscription.unsubscribe();
        return;
      }
      this.fielddDisposers.push(subscription.unsubscribe);
      this.post(envelope("snapshot", subscription.snapshot));
    };
    try {
      await open("vitals.subscribe", {}, (event, payload) => ({ kind: "vitals", event, payload }));
      await open("diagnostics.subscribe", this.logQuery(FIELDD_LOG_SOURCES), (event, payload) => ({
        kind: "logs",
        origin: "fieldd" satisfies Origin,
        event,
        payload,
      }));
    } catch (error) {
      if (!current()) return;
      this.sources.logger.warn(
        "desktop.vitals.fieldd_feed_refused",
        "fieldd refused the Vitals window's feed; main asks again while the window is open",
        { error: error instanceof Error ? error.message : String(error) },
      );
      this.releaseFieldd();
      this.sayFielddDown();
      this.retry = this.setTimer(() => {
        this.retry = null;
        if (current()) void this.subscribeFieldd(client, generation);
      }, VITALS_FEED_RETRY_MS);
    }
  }

  private sayFielddDown(): void {
    this.post({ kind: "vitals", event: "down" });
    this.post({ kind: "logs", origin: "fieldd", event: "down" });
  }

  private post(message: Record<string, unknown>): void {
    if (this.closed) return;
    let serialized: string;
    try {
      serialized = JSON.stringify({ v: 1, ...message });
    } catch {
      return;
    }
    if (Buffer.byteLength(serialized, "utf8") > VITALS_FRAME_BYTES_MAX) {
      this.sources.logger.warn(
        "desktop.vitals.frame_too_large",
        "A Vitals frame passed its byte bound and was not sent",
        { kind: message["kind"], event: message["event"], bytes: serialized.length },
      );
      serialized = JSON.stringify({
        v: 1,
        kind: message["kind"],
        ...(message["origin"] === undefined ? {} : { origin: message["origin"] }),
        event: "down",
      });
    }
    try {
      this.port.postMessage(serialized);
    } catch {
      this.close();
    }
  }
}
