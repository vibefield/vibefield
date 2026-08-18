import {
  PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS,
  PluginRuntimeReportParams,
  PluginRuntimeReportResult,
  type PluginRuntimeReportParams as PluginRuntimeReportValue,
} from "@vibefield/contracts";
import type { RuntimeTargetControllerDiagnostic } from "@vibefield/plugin-runtime";
import type { RendererLogger } from "../logging";

export interface RendererRuntimeDiagnosticsReporterDeps {
  request(method: string, params?: unknown): Promise<unknown>;
  logger: RendererLogger;
}

/** Best-effort renderer diagnostics sender.
 *
 * One global request may be in flight. Behind it, each bounded plugin slot retains only its latest
 * plain-data projection; replacing a slot refreshes its queue position so a noisy plugin cannot
 * starve quiet peers. Nothing awaits this sender from activation, update acknowledgement, or close.
 */
export class RendererRuntimeDiagnosticsReporter {
  private readonly sequences = new Map<string, number>();
  private readonly pending = new Map<string, PluginRuntimeReportValue>();
  private inFlight: Promise<void> | null = null;
  private failed = false;
  private overflowReported = false;
  private closed = false;

  constructor(private readonly deps: RendererRuntimeDiagnosticsReporterDeps) {}

  publish(pluginId: string, controller: RuntimeTargetControllerDiagnostic): void {
    if (this.closed) return;
    if (
      !this.sequences.has(pluginId) &&
      this.sequences.size >= PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.PLUGINS
    ) {
      this.logOverflow();
      return;
    }
    const previous = this.sequences.get(pluginId) ?? 0;
    const sequence = Math.min(Number.MAX_SAFE_INTEGER, previous + 1);
    const parsed = PluginRuntimeReportParams.safeParse({ pluginId, sequence, controller });
    if (!parsed.success) {
      this.logFailure(
        pluginId,
        `local runtime projection was invalid: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      );
      return;
    }
    this.sequences.set(pluginId, sequence);
    this.pending.delete(pluginId);
    if (
      !this.pending.has(pluginId) &&
      this.pending.size >= PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.PLUGINS
    ) {
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) this.pending.delete(oldest);
      this.logOverflow();
    }
    this.pending.set(pluginId, parsed.data);
    this.drain();
  }

  /** Drops only plain pending reports. The possibly stuck request owns no controller/scope/runtime
   * object and is deliberately not awaited by the window close barrier. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pending.clear();
    this.sequences.clear();
  }

  /** Test/Doctor structural counters; no report values escape. */
  state(): {
    readonly inFlight: number;
    readonly pending: number;
    readonly trackedPlugins: number;
    readonly closed: boolean;
  } {
    return Object.freeze({
      inFlight: this.inFlight === null ? 0 : 1,
      pending: this.pending.size,
      trackedPlugins: this.sequences.size,
      closed: this.closed,
    });
  }

  private drain(): void {
    if (this.closed || this.inFlight !== null) return;
    const next = this.pending.entries().next().value as
      | [string, PluginRuntimeReportValue]
      | undefined;
    if (next === undefined) return;
    const [pluginId, report] = next;
    this.pending.delete(pluginId);
    const task = Promise.resolve()
      .then(async () => {
        const raw = await this.deps.request("plugins.runtime.report", report);
        const result = PluginRuntimeReportResult.safeParse(raw);
        if (!result.success) throw new Error("fieldd returned an invalid diagnostics receipt");
        if (this.failed) {
          this.failed = false;
          try {
            this.deps.logger.info(
              "renderer.plugin_runtime.report_recovered",
              "Plugin runtime diagnostics reporting recovered",
              { pluginId },
            );
          } catch {
            // A logging fault cannot stop the queue drain.
          }
        }
      })
      .catch((error: unknown) => {
        this.logFailure(pluginId, error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (this.inFlight === task) this.inFlight = null;
        this.drain();
      });
    this.inFlight = task;
  }

  private logFailure(pluginId: string, error: string): void {
    if (this.failed) return;
    this.failed = true;
    try {
      this.deps.logger.warn(
        "renderer.plugin_runtime.report_failed",
        "Plugin runtime diagnostics could not reach fieldd; lifecycle remains unaffected",
        { pluginId, error: error.slice(0, 512) },
      );
    } catch {
      // A logging fault cannot escape a best-effort reporter.
    }
  }

  private logOverflow(): void {
    if (this.overflowReported) return;
    this.overflowReported = true;
    try {
      this.deps.logger.warn(
        "renderer.plugin_runtime.report_queue_bounded",
        "Plugin runtime diagnostics exceeded the bounded tracked-plugin queue",
        { pluginLimit: PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.PLUGINS },
      );
    } catch {
      // Observability remains best-effort even if the first-party logger is broken.
    }
  }
}
