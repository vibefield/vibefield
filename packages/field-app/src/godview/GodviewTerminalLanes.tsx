import { type ReactElement, useEffect, useState } from "react";
import { getRendererLogger } from "../logging";
import {
  type TerminalPerfMode,
  type TerminalPerfState,
  terminalPerf,
  toJsonLine,
} from "../perf/terminal-perf";

// THE TERMINAL LANES (TP-S0a) — §19.3's "in-app live lanes", beside the frame
// stats they belong with.
//
// It renders in the readout's existing instrument voice and reuses its classes
// rather than growing a parallel look: `vf-godview-perf-frames` for a lane
// group, `vf-godview-perf-phases` for a subordinate one, `vf-godview-perf-note`
// for the prose. No colour, size or spacing is decided here, so nothing in this
// file can drift from DESIGN.md.
//
// The honesty rule the lanes are built around: a lane that has no measurement
// says WHY, and never shows a zero. `production` mode genuinely cannot know the
// frame rate — ghosttea has no always-on counter to read it from (see
// `perf/terminal-perf.ts` for the citation) — so in `production` the frame
// lanes read `metrics only`, which is a true statement, where `0` would be a
// false one.

function ms(value: number): string {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function rate(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}

const MODES: readonly TerminalPerfMode[] = ["off", "production", "metrics"];

function Lane({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function GodviewTerminalLanes(): ReactElement {
  const [state, setState] = useState<TerminalPerfState>(() => terminalPerf.state());

  useEffect(() => terminalPerf.subscribe(setState), []);

  // The sampler is never started by mounting this panel. A rAF loop is load and
  // so is a measurement window — `startFrameStats` may start on mount because
  // its cost is bounded and local, but a terminal window blocks on a GPU drain,
  // so opening one has to be a decision someone made.
  const sample = state.sample;
  const off = state.mode === "off";

  return (
    <>
      <dl className="vf-godview-perf-phases">
        <Lane label="terminal probe" value={state.mode} />
        <Lane label="runtime" value={state.sourceAttached ? "attached" : "none"} />
        <Lane
          label="windows · timeout · err"
          value={`${state.counters.windows} · ${state.counters.windowsTimedOut} · ${state.counters.windowErrors}`}
        />
      </dl>

      <div className="vf-godview-terminal-modes">
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={state.mode === mode}
            className="vf-godview-terminal-mode"
            onClick={() => terminalPerf.setMode(mode)}
          >
            {mode}
          </button>
        ))}
      </div>

      {state.mode === "metrics" && sample === null ? (
        <p className="vf-godview-perf-note">
          {state.sourceAttached
            ? "sampling — the first window closes after a second"
            : "no terminal runtime is mounted; open a deck"}
        </p>
      ) : null}

      {sample === null ? null : (
        <dl className="vf-godview-perf-frames">
          <Lane
            label="frames/s · bytes/s"
            value={`${sample.rates.framesPerSecond} · ${rate(sample.rates.bytesPerSecond)}`}
          />
          <Lane
            label="apply p50/p99"
            value={
              sample.stages.frameApplyMs.count === 0
                ? "no frames"
                : `${ms(sample.stages.frameApplyMs.p50)} / ${ms(sample.stages.frameApplyMs.p99)}ms`
            }
          />
          <Lane
            label="render cpu p50/p99"
            value={
              sample.stages.renderCpuMs.count === 0
                ? "no flushes"
                : `${ms(sample.stages.renderCpuMs.p50)} / ${ms(sample.stages.renderCpuMs.p99)}ms`
            }
          />
          <Lane
            label="arrival→render p50/p99"
            value={
              sample.stages.frameArrivalToRenderMs.count === 0
                ? "no frames"
                : `${ms(sample.stages.frameArrivalToRenderMs.p50)} / ${ms(sample.stages.frameArrivalToRenderMs.p99)}ms`
            }
          />
          <Lane
            label="gpu drain"
            value={
              // null is NOT zero: a Canvas2D backend has no queue to drain, and
              // saying so beats reporting a 0ms GPU.
              sample.gpuQueueDrainMs === null ? "unavailable" : `${ms(sample.gpuQueueDrainMs)}ms`
            }
          />
          <Lane
            label="submits/s · passes"
            value={`${sample.rates.submitsPerSecond} · ${sample.renderer.renderPasses}`}
          />
          <Lane
            label="stale · resync"
            value={`${sample.frames.stale} · ${sample.frames.resyncRequested}`}
          />
          <Lane
            label="geom hit/miss"
            value={`${sample.renderer.geometryCacheHits}/${sample.renderer.geometryCacheMisses}`}
          />
          <Lane
            label="window"
            value={`${ms(sample.windowMs)}ms${sample.timedOutWaitingForIdle ? " · busy" : " · idle"}`}
          />
        </dl>
      )}

      {off ? (
        <p className="vf-godview-perf-note">
          probes are off and cost nothing — the render worker keeps no measurement at all until one
          is opened
        </p>
      ) : (
        <p className="vf-godview-perf-note">
          {state.mode === "production"
            ? "production counters only — frame lanes need `metrics`, because ghosttea exposes no always-on counters"
            : "`metrics` opens a measurement window every second and its finish drains the GPU queue — that cost is the `gpu drain` lane, not a background number"}
        </p>
      )}

      {sample === null ? null : (
        <button
          type="button"
          className="vf-godview-terminal-mode"
          onClick={() => {
            // The dump the baseline consumes, through the renderer's event
            // logger rather than `console` — the lab's output is collected by
            // the host, so a line written here reaches the results home instead
            // of only a devtools pane someone had to have open.
            getRendererLogger().info("godview.terminal_perf.dump", "terminal perf sample", {
              jsonl: toJsonLine(state, "in-app"),
            });
          }}
        >
          dump JSONL
        </button>
      )}
    </>
  );
}
