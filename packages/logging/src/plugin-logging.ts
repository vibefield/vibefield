import { LOG_TRANSPORT_LIMITS, type PluginRecord } from "@vibefield/contracts";
import {
  type LogTruncationV1,
  PluginLogProvenanceV1,
  type PluginLogProvenanceV1 as PluginProvenance,
} from "@vibefield/contracts/logging";
import type { LogFields, NodeLogging } from "./types";

type PluginLevel = "debug" | "info" | "warn" | "error";
type PluginEvent = "plugin.log" | "plugin.output";

export interface PluginLogInput {
  level: PluginLevel;
  message: string;
  fields?: LogFields;
  event?: PluginEvent;
  time?: number;
  observedTime?: number;
  pid?: number;
  truncation?: LogTruncationV1;
}

export interface PluginLogRouterHealth {
  accepted: number;
  droppedRate: number;
  rejected: number;
  activeEntries: number;
}

interface RateState {
  provenance: PluginProvenance;
  tokens: number;
  lastRefill: number;
  lastSeen: number;
  dropped: Record<PluginLevel, number>;
  summaryTimer: NodeJS.Timeout | null;
}

const PLUGIN_LEVELS = new Set<PluginLevel>(["debug", "info", "warn", "error"]);

/** Resolve the complete public install tuple from fieldd's validated registry.
 * Caller input never supplies version/source/revision/trust. */
export function pluginLogProvenance(
  record: PluginRecord,
  entry: "renderer" | "service",
  windowId?: string,
): PluginProvenance | null {
  if (!record.enabled || record[entry] === "none") return null;
  const source =
    record.source === "bundled"
      ? { installSource: "bundled" as const, trust: "r0-bundled" as const }
      : record.source === "dev-linked"
        ? { installSource: "dev-link" as const, trust: "r3-dev" as const }
        : null;
  if (source === null) return null;
  return {
    id: record.id,
    version: record.version,
    installRevision: record.installRevision,
    entry,
    ...(entry === "renderer" && windowId !== undefined ? { windowId } : {}),
    ...source,
  };
}

/** One bounded, host-owned route shared by Electron and fieldd. It does not
 * own a file: each process supplies its single category writer. */
export class PluginLogRouter {
  private readonly rates = new Map<string, RateState>();
  private accepted = 0;
  private droppedRate = 0;
  private rejected = 0;
  private closed = false;

  constructor(
    private readonly options: {
      sink: NodeLogging;
      now?: () => number;
      dropWindowMs?: number;
    },
  ) {}

  accept(provenance: PluginProvenance, input: PluginLogInput): boolean {
    if (this.closed) return false;
    const parsed = PluginLogProvenanceV1.safeParse(provenance);
    if (
      !parsed.success ||
      !PLUGIN_LEVELS.has(input.level) ||
      typeof input.message !== "string" ||
      (input.event !== undefined && input.event !== "plugin.log" && input.event !== "plugin.output")
    ) {
      this.rejected += 1;
      return false;
    }
    if (!this.options.sink.logger.isLevelEnabled(input.level)) return true;
    const now = this.now();
    const rate = this.rate(parsed.data, now);
    this.refill(rate, now);
    const highSeverity = input.level === "warn" || input.level === "error";
    const floor = highSeverity ? 0 : LOG_TRANSPORT_LIMITS.PLUGIN_RATE_HIGH_SEVERITY_RESERVE;
    if (rate.tokens < 1 || rate.tokens - 1 < floor) {
      rate.dropped[input.level] += 1;
      this.droppedRate += 1;
      this.scheduleDropSummary(rate);
      return false;
    }
    rate.tokens -= 1;
    this.options.sink.ingest({
      time: input.time ?? now,
      observedTime: input.observedTime ?? now,
      level: input.level,
      event: input.event ?? "plugin.log",
      message: input.message,
      component: `plugin.${parsed.data.entry}`,
      ...(input.fields !== undefined ? { attrs: input.fields } : {}),
      ...(parsed.data.windowId !== undefined ? { windowId: parsed.data.windowId } : {}),
      ...(input.pid !== undefined ? { pid: input.pid } : {}),
      ...(input.truncation !== undefined ? { truncation: input.truncation } : {}),
      plugin: parsed.data,
    });
    this.accepted += 1;
    return true;
  }

  health(): PluginLogRouterHealth {
    return {
      accepted: this.accepted,
      droppedRate: this.droppedRate,
      rejected: this.rejected,
      activeEntries: this.rates.size,
    };
  }

  /** WebContents generations own renderer rate state. Reload/destroy must not
   * leak one bucket per historical window. */
  releaseWindow(windowId: string): void {
    for (const [key, rate] of this.rates) {
      if (rate.provenance.windowId !== windowId) continue;
      if (rate.summaryTimer !== null) clearTimeout(rate.summaryTimer);
      rate.summaryTimer = null;
      this.emitDropSummary(rate);
      this.rates.delete(key);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const rate of this.rates.values()) {
      if (rate.summaryTimer !== null) clearTimeout(rate.summaryTimer);
      rate.summaryTimer = null;
      this.emitDropSummary(rate);
    }
    this.rates.clear();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private rate(provenance: PluginProvenance, now: number): RateState {
    const key = JSON.stringify([
      provenance.id,
      provenance.installRevision,
      provenance.entry,
      provenance.windowId ?? "",
    ]);
    let state = this.rates.get(key);
    if (state === undefined) {
      if (this.rates.size >= LOG_TRANSPORT_LIMITS.PLUGIN_RATE_TRACKED_ENTRIES) {
        let oldestKey: string | null = null;
        let oldestSeen = Number.POSITIVE_INFINITY;
        for (const [candidateKey, candidate] of this.rates) {
          if (candidate.lastSeen < oldestSeen) {
            oldestKey = candidateKey;
            oldestSeen = candidate.lastSeen;
          }
        }
        if (oldestKey !== null) {
          const oldest = this.rates.get(oldestKey);
          if (oldest?.summaryTimer) clearTimeout(oldest.summaryTimer);
          if (oldest !== undefined) this.emitDropSummary(oldest);
          this.rates.delete(oldestKey);
        }
      }
      state = {
        provenance,
        tokens: LOG_TRANSPORT_LIMITS.PLUGIN_RATE_BURST,
        lastRefill: now,
        lastSeen: now,
        dropped: { debug: 0, info: 0, warn: 0, error: 0 },
        summaryTimer: null,
      };
      this.rates.set(key, state);
    }
    state.lastSeen = now;
    return state;
  }

  private refill(state: RateState, now: number): void {
    const elapsed = Math.max(0, now - state.lastRefill);
    state.tokens = Math.min(
      LOG_TRANSPORT_LIMITS.PLUGIN_RATE_BURST,
      state.tokens + (elapsed * LOG_TRANSPORT_LIMITS.PLUGIN_RATE_PER_SECOND) / 1_000,
    );
    state.lastRefill = now;
  }

  private scheduleDropSummary(state: RateState): void {
    if (state.summaryTimer !== null) return;
    state.summaryTimer = setTimeout(() => {
      state.summaryTimer = null;
      this.emitDropSummary(state);
    }, this.options.dropWindowMs ?? 1_000);
    state.summaryTimer.unref?.();
  }

  private emitDropSummary(state: RateState): void {
    const count = Object.values(state.dropped).reduce((sum, value) => sum + value, 0);
    if (count === 0) return;
    const now = this.now();
    this.options.sink.ingest({
      time: now,
      observedTime: now,
      level: "warn",
      event: "plugin.logging.records_dropped",
      message: "Plugin log records were dropped at the host rate boundary",
      component: `plugin.${state.provenance.entry}`,
      attrs: { reason: "rate", ...state.dropped },
      ...(state.provenance.windowId !== undefined ? { windowId: state.provenance.windowId } : {}),
      plugin: state.provenance,
    });
    state.dropped = { debug: 0, info: 0, warn: 0, error: 0 };
  }
}
