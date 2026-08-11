import { type ReactElement, useEffect, useState } from "react";
import { type FrameStatsSample, startFrameStats } from "../perf/frame-stats";
import { COLD_OPEN_PHASES, type ColdOpenReport, godviewColdOpen } from "./cold-open";
import { getLabSwitches, type LabSwitches, setLabSwitches, useLabSwitches } from "./lab-switches";

// THE LAB'S PERF READOUT (GT-3p) — the instrument GT-D15.4 measures with.
//
// It reuses the app's landed frame-stats collector rather than growing a second
// one: `PERF 846ec2c` already crossed rAF cadence with LoAF blocking to answer
// "are frames late, and is our JavaScript to blame", which is strictly more than
// a frame-time average and exactly the question a swarm-versus-compositor
// investigation asks. What this adds is the Godview's own context beside those
// numbers — the cold open's phase breakdown, the live render backend, and the
// switches that let a layer be removed and the difference watched.
//
// The loop runs only while this panel is open (`startFrameStats` is started on
// mount and stopped on unmount), because a rAF loop is itself load: an
// instrument left running would hold the compositor awake at full rate for a
// panel nobody is looking at, which is the cost it exists to find.

function formatMs(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function ColdOpenRows({ report }: { report: ColdOpenReport }): ReactElement {
  if (!report.complete) {
    return <p className="vf-godview-perf-note">no complete open recorded yet</p>;
  }
  const warm = new Set(report.warm);
  return (
    <>
      <dl className="vf-godview-perf-phases">
        {COLD_OPEN_PHASES.filter((phase) => phase !== "open").map((phase) => {
          const value = report.phases[phase];
          if (value === undefined) return null;
          return (
            <div key={phase}>
              <dt>{phase}</dt>
              {/* A warm station says so instead of showing a zero that reads
                  like a suspiciously fast measurement. */}
              <dd>{warm.has(phase) ? "warm" : `${formatMs(value)}ms`}</dd>
            </div>
          );
        })}
      </dl>
      <p className="vf-godview-perf-total">first open · {formatMs(report.totalMs)}ms to frame</p>
    </>
  );
}

export function GodviewPerfReadout({
  rendererBackend,
}: {
  /** Live from the deck's runtime — GT-3f's residual, now on screen. `null`
   * while no deck has been opened, which is honest rather than a guess: the
   * backend is not knowable before a render worker exists. */
  rendererBackend: string | null;
}): ReactElement {
  const [sample, setSample] = useState<FrameStatsSample | null>(null);
  const switches = useLabSwitches();
  const report = godviewColdOpen.report();

  useEffect(() => {
    const handle = startFrameStats({ onSample: setSample });
    return () => handle.stop();
  }, []);

  const toggle = (key: keyof LabSwitches) => (): void =>
    setLabSwitches({ ...getLabSwitches(), [key]: !getLabSwitches()[key] });

  return (
    <fieldset className="vf-godview-tweak-group">
      <legend>PERFORMANCE</legend>

      {sample === null ? (
        <p className="vf-godview-perf-note">sampling…</p>
      ) : (
        <dl className="vf-godview-perf-frames">
          <div>
            <dt>fps</dt>
            <dd>{sample.fps.toFixed(0)}</dd>
          </div>
          <div>
            <dt>frame p50 / p95</dt>
            <dd>
              {formatMs(sample.frameMs.p50)} / {formatMs(sample.frameMs.p95)}ms
            </dd>
          </div>
          <div>
            <dt>dropped · lost</dt>
            <dd>
              {sample.dropped} · {formatMs(sample.lostMs)}ms
            </dd>
          </div>
          <div>
            <dt>blocking</dt>
            {/* null is NOT zero: an engine without LoAF cannot attribute the
                lateness, and saying so is the honest state. */}
            <dd>
              {sample.blockingMs === null ? "unobservable" : `${formatMs(sample.blockingMs)}ms`}
            </dd>
          </div>
          <div>
            <dt>verdict</dt>
            <dd>{sample.verdict}</dd>
          </div>
        </dl>
      )}

      <p className="vf-godview-perf-note">renderer · {rendererBackend ?? "no deck opened yet"}</p>

      <ColdOpenRows report={report} />

      <label className="vf-godview-tweak-check">
        <span>Monitor stage</span>
        <input type="checkbox" checked={switches.monitor} onChange={toggle("monitor")} />
      </label>
      <label className="vf-godview-tweak-check">
        <span>Ambient animations</span>
        <input type="checkbox" checked={switches.animations} onChange={toggle("animations")} />
      </label>
      <p className="vf-godview-perf-note">
        switches are diagnostics — they measure a layer's cost and are not saved
      </p>
    </fieldset>
  );
}
