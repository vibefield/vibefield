import { VITALS } from "@vibefield/contracts/registries";
import {
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  niceBytesMax,
  niceMax,
  type TraceBox,
  type TraceScale,
  timeAt,
  tracePath,
  xOf,
} from "./trace-geometry";
import { lineTone, type VitalsLogLine } from "./vitals-feed";
import {
  groupRows,
  groupSeries,
  loopSeries,
  ownAt,
  processSeries,
  sampleAt,
  seriesPeak,
  type VitalsGroupRows,
  type VitalsModel,
  type VitalsSeries,
  vibeFieldTotal,
} from "./vitals-model";
import {
  clockWords,
  cpuScaleWords,
  cpuWords,
  groupWord,
  lineCountWords,
  memoryScaleWords,
  memoryWords,
  ownWords,
  rowName,
  stateWords,
  VITALS_WORDS,
} from "./vitals-words";

// VT-2 (track VT, 2026-11-24) — THE VITALS WINDOW'S VIEW (DESIGN.md §8 "Vitals"), controller-free: a model and the
// kept log lines in, a page out. It reads no door and holds no clock; what it holds is the pointer's own state (the
// moment held, the span picked, the row chosen). The catalog mounts this same view over fixture readings.

const CPU_LANE_HEIGHT = 96;
const MEMORY_LANE_HEIGHT = 72;
const LOOP_LANE_HEIGHT = 48;
const STRIP_HEIGHT = 16;
const SPARK = { width: 48, height: 14 } as const;
/** a sparkline's scale never falls under a tenth of a core, so an idle process is a low line and not a tall one */
const SPARK_FLOOR = 0.1;
/** the CPU lane's scale never falls under a twentieth of a core */
const CPU_FLOOR = 0.05;
const MEMORY_FLOOR = 64 * 1024 * 1024;
/** a minute's label this near the axis's edge is said inside it, never centred on the edge */
const TICK_EDGE = 20;
/** a press that moves less than this is a press, not a span */
const DRAG_SLOP = 4;
/** the list draws this many of a span's lines, the newest; its head still says how many the span holds */
const LINES_DRAWN_MAX = 500;
/** the groups whose traces the lanes draw as lines, in the order of their inks */
const TRACED = ["shell", "fieldd", "floor"] as const;

export interface VitalsViewProps {
  model: VitalsModel;
  logs: readonly VitalsLogLine[];
  /** the lanes' width before the page is measured (the catalog's plate and the tests) */
  initialWidth?: number;
}

interface Span {
  from: number;
  to: number;
}

function useMeasuredWidth(initial: number): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined && next > 0) setWidth(Math.round(next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function VitalsView({ model, logs, initialWidth = 720 }: VitalsViewProps): ReactElement {
  const [held, setHeld] = useState<number | null>(null);
  const [span, setSpan] = useState<Span | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [lanesRef, width] = useMeasuredWidth(initialWidth);
  const drag = useRef<{ x: number; time: number } | null>(null);

  const newest = model.samples.at(-1)?.time ?? null;
  const scale = useMemo<{ from: number; to: number } | null>(() => {
    if (newest === null) return null;
    return { from: newest - VITALS.SNAPSHOT_SAMPLES * model.intervalMs, to: newest };
  }, [newest, model.intervalMs]);

  // a row that ended is let go: nothing stays chosen that the list no longer shows
  useEffect(() => {
    if (chosen !== null && !model.processes.has(chosen)) setChosen(null);
  }, [chosen, model.processes]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setSpan(null);
      setChosen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sample = sampleAt(model, held);
  const groups = useMemo(() => groupRows(model, sample), [model, sample]);
  const total = vibeFieldTotal(groups);
  const cpuByKey = useMemo(() => processSeries(model, "cpu"), [model]);
  const memByKey = useMemo(() => processSeries(model, "memBytes"), [model]);
  const loopByKey = useMemo(() => loopSeries(model), [model]);
  // the Loop lane reads one process: the chosen row's if it says its own, else the first in the list that does
  const loopKey =
    chosen !== null && loopByKey.has(chosen)
      ? chosen
      : (groups.flatMap((group) => group.rows).find((row) => loopByKey.has(row.process.key))
          ?.process.key ?? null);
  const loopProcess = loopKey === null ? undefined : model.processes.get(loopKey);
  const loopReading =
    loopKey === null || loopProcess === undefined
      ? null
      : ownWords(rowName(loopProcess), ownAt(sample, loopKey));
  const state = stateWords(model.state);

  const box = (height: number): TraceBox => ({ x: 0, width, top: 1, bottom: height - 1 });

  const pointerTime = (event: ReactPointerEvent<HTMLDivElement>): number | null => {
    if (scale === null) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    return timeAt(
      event.clientX - bounds.left,
      { x: 0, width, top: 0, bottom: 0 },
      { ...scale, max: 1 },
    );
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const time = pointerTime(event);
    if (time === null) return;
    drag.current = { x: event.clientX, time };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const time = pointerTime(event);
    if (time === null) return;
    setHeld(time);
    const start = drag.current;
    if (start !== null && Math.abs(event.clientX - start.x) >= DRAG_SLOP) {
      setSpan({ from: Math.min(start.time, time), to: Math.max(start.time, time) });
    }
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = drag.current;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    // a press that picked no span lets the standing one go
    if (start !== null && Math.abs(event.clientX - start.x) < DRAG_SLOP) setSpan(null);
  };
  const onPointerLeave = (): void => {
    if (drag.current === null) setHeld(null);
  };

  const shownLogs = useMemo(() => {
    const from = span?.from ?? scale?.from ?? Number.NEGATIVE_INFINITY;
    const to = span?.to ?? Number.POSITIVE_INFINITY;
    return logs.filter((line) => line.time >= from && line.time <= to);
  }, [logs, span, scale]);

  return (
    <div className="vf-vitals" data-state={model.state}>
      <aside className="vf-vitals__list" aria-label={VITALS_WORDS.title}>
        <div className="vf-vitals__list-head">
          <span className="vf-vitals__when">
            {held === null || sample === null
              ? VITALS_WORDS.now
              : VITALS_WORDS.at(clockWords(sample.time))}
          </span>
          <span className="vf-vitals__col">{VITALS_WORDS.cpu}</span>
          <span className="vf-vitals__col">{VITALS_WORDS.memory}</span>
          <span className="vf-vitals__col vf-vitals__col--spark">{VITALS_WORDS.window}</span>
        </div>
        <div className="vf-vitals__rows">
          {groups.length === 0 ? (
            <p className="vf-vitals__empty">
              {model.state === "off" ? VITALS_WORDS.off : (model.detail ?? VITALS_WORDS.nothingYet)}
            </p>
          ) : (
            groups.map((group) => (
              <GroupBlock
                key={group.group}
                group={group}
                chosen={chosen}
                onChoose={(key) => setChosen((current) => (current === key ? null : key))}
                cpuByKey={cpuByKey}
                scale={scale}
              />
            ))
          )}
        </div>
        {groups.length > 0 ? (
          <div className="vf-vitals__foot">
            <div className="vf-vitals__row vf-vitals__row--total">
              <span className="vf-vitals__name">{VITALS_WORDS.total}</span>
              <span className="vf-vitals__num">{cpuWords(total.cpu, true)}</span>
              <span className="vf-vitals__num">{memoryWords(total.memBytes)}</span>
              <span className="vf-vitals__spark" />
            </div>
            <p className="vf-vitals__note">{VITALS_WORDS.totalNote}</p>
          </div>
        ) : null}
      </aside>

      <section className="vf-vitals__main">
        <div className="vf-vitals__state">
          <span className="vf-vitals__dot" data-recording={state.recording ? "" : undefined} />
          <span>{state.words}</span>
        </div>
        <div
          className="vf-vitals__lanes"
          ref={lanesRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
        >
          <CpuLane
            model={model}
            scale={scale}
            box={box(CPU_LANE_HEIGHT)}
            chosen={chosen === null ? null : (cpuByKey.get(chosen) ?? null)}
          />
          <MemoryLane
            model={model}
            scale={scale}
            box={box(MEMORY_LANE_HEIGHT)}
            chosen={chosen === null ? null : (memByKey.get(chosen) ?? null)}
          />
          {loopByKey.size === 0 ? null : (
            <LoopLane
              model={model}
              scale={scale}
              box={box(LOOP_LANE_HEIGHT)}
              series={loopByKey}
              reading={loopReading}
            />
          )}
          <Axis scale={scale} width={width} />
          <div className="vf-vitals__lane-head">
            <span className="vf-vitals__eyebrow">{VITALS_WORDS.logs}</span>
            <span className="vf-vitals__reading">
              {span === null
                ? lineCountWords(shownLogs.length)
                : `${clockWords(span.from)} – ${clockWords(span.to)} · ${lineCountWords(shownLogs.length)}`}
            </span>
          </div>
          <LogStrip logs={logs} scale={scale} width={width} />
          <Overlay scale={scale} width={width} held={held} span={span} />
        </div>
        <LogLines lines={shownLogs} />
      </section>
    </div>
  );
}

function GroupBlock(props: {
  group: VitalsGroupRows;
  chosen: string | null;
  onChoose: (key: string) => void;
  cpuByKey: ReadonlyMap<string, VitalsSeries>;
  scale: { from: number; to: number } | null;
}): ReactElement {
  const { group, chosen, onChoose, cpuByKey, scale } = props;
  return (
    <div className="vf-vitals__group" data-group={group.group}>
      <div className="vf-vitals__group-head">{groupWord(group.group)}</div>
      {group.rows.map((row) => {
        const series = cpuByKey.get(row.key);
        return (
          <button
            type="button"
            key={row.key}
            className="vf-vitals__row"
            aria-pressed={chosen === row.key}
            onClick={() => onChoose(row.key)}
          >
            <span className="vf-vitals__name">{rowName(row.process, row.point.processes)}</span>
            <span className="vf-vitals__num">{cpuWords(row.point.cpu)}</span>
            <span className="vf-vitals__num">{memoryWords(row.point.memBytes)}</span>
            <span className="vf-vitals__spark">
              {series !== undefined && scale !== null ? (
                <svg
                  width={SPARK.width}
                  height={SPARK.height}
                  viewBox={`0 0 ${SPARK.width} ${SPARK.height}`}
                  aria-hidden="true"
                >
                  <path
                    className="vf-vitals__trace vf-vitals__trace--spark"
                    d={tracePath(
                      series.times,
                      series.values,
                      { x: 0, width: SPARK.width, top: 1, bottom: SPARK.height - 1 },
                      { ...scale, max: seriesPeak([series], SPARK_FLOOR) },
                    )}
                  />
                </svg>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface LaneProps {
  model: VitalsModel;
  scale: { from: number; to: number } | null;
  box: TraceBox;
  /** the chosen row's own series; with one, the groups step back */
  chosen: VitalsSeries | null;
}

function CpuLane({ model, scale, box, chosen }: LaneProps): ReactElement {
  const groups = useMemo(
    () => TRACED.map((group) => ({ group, series: groupSeries(model, group, "cpu") })),
    [model],
  );
  const agents = useMemo(() => groupSeries(model, "agents", "cpu"), [model]);
  const max = niceMax(
    seriesPeak(
      [...groups.map((entry) => entry.series), agents, ...(chosen ? [chosen] : [])],
      CPU_FLOOR,
    ),
  );
  const traced: TraceScale | null = scale === null ? null : { ...scale, max };
  const height = box.bottom + 1;
  return (
    <div className="vf-vitals__lane" data-lane="cpu" data-chosen={chosen === null ? undefined : ""}>
      <div className="vf-vitals__lane-head">
        <span className="vf-vitals__eyebrow">{VITALS_WORDS.cpuLane}</span>
        <span className="vf-vitals__legend">
          {TRACED.map((group) => (
            <span key={group} className="vf-vitals__key" data-group={group}>
              {VITALS_WORDS.legend[group]}
            </span>
          ))}
          <span className="vf-vitals__key" data-group="agents">
            {VITALS_WORDS.legend.agents}
          </span>
        </span>
      </div>
      <div className="vf-vitals__plot">
        {traced === null ? null : <span className="vf-vitals__scale">{cpuScaleWords(max)}</span>}
        <svg
          width={box.width}
          height={height}
          viewBox={`0 0 ${box.width} ${height}`}
          aria-hidden="true"
        >
          {traced === null ? null : (
            <>
              <path className="vf-vitals__area" d={areaPath(agents, box, traced)} />
              {groups.map(({ group, series }) => (
                <path
                  key={group}
                  className="vf-vitals__trace"
                  data-group={group}
                  d={tracePath(series.times, series.values, box, traced)}
                />
              ))}
              {chosen === null ? null : (
                <path
                  className="vf-vitals__trace vf-vitals__trace--chosen"
                  d={tracePath(chosen.times, chosen.values, box, traced)}
                />
              )}
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

function MemoryLane({ model, scale, box, chosen }: LaneProps): ReactElement {
  const groups = useMemo(
    () => TRACED.map((group) => ({ group, series: groupSeries(model, group, "memBytes") })),
    [model],
  );
  const max = niceBytesMax(
    seriesPeak([...groups.map((entry) => entry.series), ...(chosen ? [chosen] : [])], MEMORY_FLOOR),
  );
  const traced: TraceScale | null = scale === null ? null : { ...scale, max };
  const height = box.bottom + 1;
  return (
    <div
      className="vf-vitals__lane"
      data-lane="memory"
      data-chosen={chosen === null ? undefined : ""}
    >
      <div className="vf-vitals__lane-head">
        <span className="vf-vitals__eyebrow">{VITALS_WORDS.memoryLane}</span>
      </div>
      <div className="vf-vitals__plot">
        {traced === null ? null : <span className="vf-vitals__scale">{memoryScaleWords(max)}</span>}
        <svg
          width={box.width}
          height={height}
          viewBox={`0 0 ${box.width} ${height}`}
          aria-hidden="true"
        >
          {traced === null
            ? null
            : groups.map(({ group, series }) => (
                <path
                  key={group}
                  className="vf-vitals__trace"
                  data-group={group}
                  d={tracePath(series.times, series.values, box, traced)}
                />
              ))}
          {traced === null || chosen === null ? null : (
            <path
              className="vf-vitals__trace vf-vitals__trace--chosen"
              d={tracePath(chosen.times, chosen.values, box, traced)}
            />
          )}
        </svg>
      </div>
    </div>
  );
}

/** VT-3 — the Loop lane: one trace for each process that says how busy its own loop was, on a scale that never
 * moves (a share has a whole). Its head reads one process at the moment the list reads. */
function LoopLane(props: {
  model: VitalsModel;
  scale: { from: number; to: number } | null;
  box: TraceBox;
  series: Map<string, VitalsSeries>;
  reading: string | null;
}): ReactElement {
  const { model, scale, box, series, reading } = props;
  const traced: TraceScale | null = scale === null ? null : { ...scale, max: 1 };
  const height = box.bottom + 1;
  return (
    <div className="vf-vitals__lane" data-lane="loop">
      <div className="vf-vitals__lane-head">
        <span className="vf-vitals__eyebrow">{VITALS_WORDS.loopLane}</span>
        {reading === null ? null : <span className="vf-vitals__reading">{reading}</span>}
      </div>
      <div className="vf-vitals__plot">
        {traced === null ? null : (
          <span className="vf-vitals__scale">{VITALS_WORDS.loopScale}</span>
        )}
        <svg
          width={box.width}
          height={height}
          viewBox={`0 0 ${box.width} ${height}`}
          aria-hidden="true"
        >
          {traced === null
            ? null
            : [...series].map(([key, own]) => (
                <path
                  key={key}
                  className="vf-vitals__trace"
                  data-own="loop"
                  data-group={model.processes.get(key)?.group}
                  d={tracePath(own.times, own.values, box, traced)}
                />
              ))}
        </svg>
      </div>
    </div>
  );
}

/** The terminals' area: the trace's own path, each measured run closed down to zero. A gap stays a gap. */
function areaPath(series: VitalsSeries, box: TraceBox, scale: TraceScale): string {
  const line = tracePath(series.times, series.values, box, scale);
  if (line === "") return "";
  return line
    .split("M")
    .filter((run) => run !== "")
    .map((run) => {
      const points = run.replace("h0.1", "").split("L");
      const first = points[0]?.split(" ")[0];
      const last = points.at(-1)?.split(" ")[0];
      if (first === undefined || last === undefined) return "";
      return `M${run}L${last} ${box.bottom}L${first} ${box.bottom}Z`;
    })
    .join("");
}

function Axis(props: { scale: { from: number; to: number } | null; width: number }): ReactElement {
  const { scale, width } = props;
  const ticks: number[] = [];
  if (scale !== null) {
    const minute = 60_000;
    for (let at = Math.ceil(scale.from / minute) * minute; at <= scale.to; at += minute)
      ticks.push(at);
  }
  return (
    <div className="vf-vitals__axis">
      {scale === null
        ? null
        : ticks.map((tick) => {
            const left = xOf(tick, { x: 0, width, top: 0, bottom: 0 }, { ...scale, max: 1 });
            const edge = left < TICK_EDGE ? "start" : left > width - TICK_EDGE ? "end" : undefined;
            return (
              <span key={tick} className="vf-vitals__tick" data-edge={edge} style={{ left }}>
                {clockWords(tick, "minute")}
              </span>
            );
          })}
    </div>
  );
}

function LogStrip(props: {
  logs: readonly VitalsLogLine[];
  scale: { from: number; to: number } | null;
  width: number;
}): ReactElement {
  const { logs, scale, width } = props;
  const box = { x: 0, width, top: 0, bottom: STRIP_HEIGHT };
  return (
    <svg
      className="vf-vitals__strip"
      width={width}
      height={STRIP_HEIGHT}
      viewBox={`0 0 ${width} ${STRIP_HEIGHT}`}
      aria-hidden="true"
    >
      {scale === null
        ? null
        : logs
            .filter((line) => line.time >= scale.from && line.time <= scale.to)
            .map((line) => {
              const tone = lineTone(line.severity);
              const x = Math.round(xOf(line.time, box, { ...scale, max: 1 }) * 10) / 10;
              return (
                <line
                  key={line.id}
                  className="vf-vitals__mark"
                  data-tone={tone}
                  x1={x}
                  x2={x}
                  y1={tone === "plain" ? STRIP_HEIGHT - 5 : 0}
                  y2={STRIP_HEIGHT}
                />
              );
            })}
    </svg>
  );
}

function Overlay(props: {
  scale: { from: number; to: number } | null;
  width: number;
  held: number | null;
  span: Span | null;
}): ReactElement | null {
  const { scale, width, held, span } = props;
  if (scale === null) return null;
  const at = (time: number): number =>
    xOf(
      Math.min(scale.to, Math.max(scale.from, time)),
      { x: 0, width, top: 0, bottom: 0 },
      {
        ...scale,
        max: 1,
      },
    );
  return (
    <div className="vf-vitals__overlay" aria-hidden="true">
      {span === null ? null : (
        <span
          className="vf-vitals__span"
          style={{ left: at(span.from), width: Math.max(1, at(span.to) - at(span.from)) }}
        />
      )}
      {held === null ? null : <span className="vf-vitals__held" style={{ left: at(held) }} />}
    </div>
  );
}

function LogLines({ lines }: { lines: readonly VitalsLogLine[] }): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  // the newest line stays in view while the list is at its end; a reader who scrolled up is left where they are
  useLayoutEffect(() => {
    const element = ref.current;
    if (element !== null && pinned.current) element.scrollTop = element.scrollHeight;
  });
  return (
    <div
      className="vf-vitals__lines"
      ref={ref}
      onScroll={(event) => {
        const element = event.currentTarget;
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
      }}
    >
      {lines.length === 0 ? (
        <p className="vf-vitals__empty">{VITALS_WORDS.noLines}</p>
      ) : (
        lines.slice(-LINES_DRAWN_MAX).map((line) => (
          <div key={line.id} className="vf-vitals__line" data-tone={lineTone(line.severity)}>
            <span className="vf-vitals__line-time">{clockWords(line.time, "milli")}</span>
            <span className="vf-vitals__line-who">{line.service}</span>
            <span className="vf-vitals__line-level">{line.severity.toLowerCase()}</span>
            <span className="vf-vitals__line-msg">{line.msg}</span>
          </div>
        ))
      )}
    </div>
  );
}
