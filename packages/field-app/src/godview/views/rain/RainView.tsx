import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hexToRgb255 } from "../../../field/theme-constants";
import type { MonitorPalette } from "../../monitor/monitor-palette";
import type { AgentMonitorProps, MonitorAgent } from "../../monitor/types";
import { normalizeRainParameters, type RainParameters } from "./rain-parameters";
import {
  type RainDrop,
  rainDataString,
  rainTailLength,
  reconcileRainColumns,
} from "./rain-streams";

// The rain — the reference app's matrix stream, restyled onto our tokens.
//
// The reference hardcodes its palette (a green tail, a yellow stuck state, a
// magenta hover). Every one of those is now read from the live tokens the stage
// hands down: §2.5's green/orange for working/waiting, §2.4's ramp for idle, and
// the mounted-session tail is the agent's own §2.6 organizational accent — which
// is precisely what an organizational accent is for ("this session", never a
// state). Hover deliberately gains NO color of its own: it brightens the head
// and doubles the glow, because §2.5 hands out no hue for "the pointer is here"
// and inventing one would put a fourth meaning on a three-meaning scale.

interface Geometry {
  columns: number;
  rows: number;
  cell: number;
  width: number;
  height: number;
}

const matrixGlyph = (): string => String.fromCharCode(0x30a0 + Math.random() * 96);

function measureCanvas(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  fontSize: number,
): Geometry {
  const ratio = window.devicePixelRatio || 1;
  const width = container.clientWidth;
  const height = container.clientHeight;
  canvas.width = Math.max(1, Math.floor(width * ratio));
  canvas.height = Math.max(1, Math.floor(height * ratio));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  // Reset before scaling: measure runs again on every resize and font change.
  context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return {
    columns: Math.max(1, Math.floor(width / fontSize)),
    rows: Math.max(1, Math.floor(height / fontSize)),
    cell: fontSize,
    width,
    height,
  };
}

/** The three status readings, resolved from the live tokens. Speeds are the
 * reference's: waiting crawls (stuck, and impossible to miss in a field where
 * everything else moves), idle drifts, working runs at its own drop speed. */
function statusPresentation(
  palette: MonitorPalette,
): Record<MonitorAgent["status"], { head: string; tail: string; speed?: number }> {
  return {
    working: { head: palette.text.primary, tail: palette.statusRgb.working },
    waiting: { head: palette.status.waiting, tail: palette.statusRgb.waiting, speed: 0.02 },
    idle: { head: palette.status.idle, tail: palette.statusRgb.idle, speed: 0.1 },
  };
}

export function RainView({
  agents,
  parameters,
  actions,
  palette,
}: AgentMonitorProps): ReactElement {
  const rain = useMemo<RainParameters>(() => normalizeRainParameters(parameters), [parameters]);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agentsRef = useRef<ReadonlyMap<string, MonitorAgent>>(new Map());
  const orderRef = useRef<readonly string[]>([]);
  const parametersRef = useRef(rain);
  const paletteRef = useRef(palette);
  const dropsRef = useRef(new Map<number, RainDrop>());
  const geometryRef = useRef<Geometry>({ columns: 0, rows: 0, cell: 14, width: 0, height: 0 });
  const hoveredRef = useRef<string | undefined>(undefined);
  const tooltipRef = useRef<HTMLElement>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const [hovered, setHovered] = useState<MonitorAgent>();

  const sync = useCallback((): void => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const geometry = measureCanvas(canvas, container, parametersRef.current.fontSize);
    geometryRef.current = geometry;
    dropsRef.current = reconcileRainColumns({
      agents: orderRef.current,
      columns: geometry.columns,
      previous: dropsRef.current,
      createDrop: (agentId) => ({
        agentId,
        y: Math.random() * geometry.rows,
        speed: 0.3 + Math.random() * 0.4,
      }),
    });
  }, []);

  useEffect(() => {
    agentsRef.current = new Map(agents.map((agent) => [agent.id, agent] as const));
    orderRef.current = agents.map((agent) => agent.id);
    sync();
  }, [agents, sync]);

  useEffect(() => {
    const previousFont = parametersRef.current.fontSize;
    parametersRef.current = rain;
    if (previousFont !== rain.fontSize) sync();
  }, [rain, sync]);

  // The draw loop reads the palette through a ref, so a theme change repaints
  // the next frame without tearing the loop down and re-randomizing the field.
  useEffect(() => {
    paletteRef.current = palette;
  }, [palette]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => sync());
    observer?.observe(container);
    sync();

    let frame = 0;
    let previousTime = performance.now();
    let accumulated = 0;
    // Driven from rAF rather than setInterval so the loop stops with the window
    // instead of repainting behind other applications; the accumulator is what
    // keeps the deliberately chunky sub-60 cadence.
    const render = (time: number): void => {
      frame = requestAnimationFrame(render);
      const settings = parametersRef.current;
      accumulated += time - previousTime;
      previousTime = time;
      const interval = 1000 / settings.refreshRate;
      if (accumulated < interval) return;
      accumulated = Math.min(accumulated - interval, interval);
      draw(context, settings);
    };

    const draw = (context2d: CanvasRenderingContext2D, settings: RainParameters): void => {
      const { columns, rows, cell, width, height } = geometryRef.current;
      const drops = dropsRef.current;
      const byId = agentsRef.current;
      const colors = paletteRef.current;
      const presentationByStatus = statusPresentation(colors);
      context2d.fillStyle = colors.stage;
      context2d.fillRect(0, 0, width, height);

      // Pane linkage rides its own channel — a wash behind the column — so the
      // glyph colors stay free to mean status, selection, and hover.
      if (settings.paneTint > 0) {
        for (const [column, drop] of drops) {
          const attachment = byId.get(drop.agentId)?.attachment;
          if (!attachment) continue;
          context2d.globalAlpha = settings.paneTint;
          context2d.fillStyle = attachment.primary;
          context2d.fillRect(column * cell, 0, cell, height);
          context2d.globalAlpha = Math.min(0.6, settings.paneTint * 2.2);
          attachment.mirrors.forEach((color, index) => {
            context2d.fillStyle = color;
            context2d.fillRect(column * cell + index * 2, 0, 2, height);
          });
        }
        context2d.globalAlpha = 1;
      }

      // §3: data is the mono stack. Terminal text belongs to Ghosttea's
      // renderer; this is our own drawing of our own data, so it takes ours.
      context2d.font = `bold ${cell}px ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace`;
      context2d.textAlign = "center";

      for (const [column, drop] of drops) {
        if (column >= columns) continue;
        const agent = byId.get(drop.agentId);
        if (!agent) continue;

        const data = rainDataString(agent);
        const tailLength = rainTailLength(agent, rows, settings.tailMultiplier, data.length);
        const presentation = presentationByStatus[agent.status];
        const hoveredHere = hoveredRef.current === agent.id;
        // The mounted session is marked by its own §2.6 accent — "this session",
        // the same color its bubble wears in the swarm — while status keeps the
        // whole green/orange/muted scale. Hover only brightens; it takes no hue.
        const headColor = hoveredHere || agent.active ? colors.text.primary : presentation.head;
        const tailColor = agent.active ? hexToRgb255(agent.color) : presentation.tail;

        drop.y += presentation.speed ?? drop.speed * settings.speedMultiplier;
        if (drop.y - tailLength > rows) drop.y = 0;

        const headRow = Math.floor(drop.y);
        const showHead = agent.status !== "idle";
        const x = column * cell + cell / 2;

        const glyphAt = (row: number, distance: number): string => {
          let scramble = settings.scrambleWorking;
          if (agent.status === "waiting") {
            // The text block stays clear while everything past it glitches, so
            // the one agent that is stuck is also the one you can read.
            scramble = distance < data.length ? 0 : settings.scramblePending;
          } else if (agent.status === "idle") {
            scramble = 0;
          }
          return Math.random() < scramble ? matrixGlyph() : (data[row % data.length] as string);
        };

        context2d.shadowBlur = 0;
        // Clamped rather than guarded inside: a long tail on a short stage runs
        // most of its length off-screen, and this is the hot loop.
        const first = Math.min(headRow, rows - 1);
        const last = Math.max(-1, Math.floor(drop.y - tailLength));
        for (let row = first; row > last; row -= 1) {
          if (row < 0) break;
          const distance = drop.y - row;
          if (showHead && distance < 1) continue;
          context2d.fillStyle = `rgba(${tailColor}, ${Math.max(0, 1 - distance / tailLength)})`;
          context2d.fillText(glyphAt(row, distance), x, row * cell);
        }

        if (showHead && headRow >= 0 && headRow < rows) {
          context2d.shadowBlur =
            hoveredHere || agent.active ? settings.headGlow * 1.5 : settings.headGlow;
          context2d.shadowColor = `rgba(${tailColor}, 1)`;
          context2d.fillStyle = headColor;
          context2d.fillText(glyphAt(headRow, 0), x, headRow * cell);
          context2d.shadowBlur = 0;
        }
      }
    };

    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [sync]);

  /** Columns run the full height, so the pointer's row never matters. */
  const agentAt = useCallback((clientX: number): MonitorAgent | undefined => {
    const container = containerRef.current;
    if (!container) return undefined;
    const bounds = container.getBoundingClientRect();
    const column = Math.floor((clientX - bounds.left) / geometryRef.current.cell);
    const drop = dropsRef.current.get(column);
    return drop ? agentsRef.current.get(drop.agentId) : undefined;
  }, []);

  return (
    <div ref={containerRef} className="vf-monitor-rain">
      {/* No `aria-hidden` and no role: a canvas exposes its FALLBACK content to
          the accessible tree and this one has none, so it is already silent.
          The agents it draws are offered as real controls at the bottom of this
          view instead. */}
      <canvas ref={canvasRef} />
      {agents.length === 0 ? (
        <div className="vf-monitor-empty">
          <span>No agents</span>
          <small>The mock field is empty — nothing is running here.</small>
        </div>
      ) : null}
      {/* A pointer hit-target over the canvas, and DELIBERATELY out of the
          accessible tree: it has no name a screen reader could use and its
          keyboard equivalent is the real button list below, one control per
          agent. Adding key handlers here would put a second, worse keyboard
          path on an element whose whole geometry is "which column is under the
          cursor" — a question a keyboard cannot ask. */}
      <div
        className="vf-monitor-rain-surface"
        aria-hidden="true"
        onPointerMove={(event) => {
          const agent = agentAt(event.clientX);
          hoveredRef.current = agent?.id;
          const bounds = event.currentTarget.getBoundingClientRect();
          pointerRef.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
          // The tooltip follows the cursor through the DOM directly. Re-rendering
          // on every move would put a full React pass between two canvas frames.
          if (tooltipRef.current) {
            tooltipRef.current.style.left = `${pointerRef.current.x + 15}px`;
            tooltipRef.current.style.top = `${pointerRef.current.y + 15}px`;
          }
          setHovered((current) => (current?.id === agent?.id ? current : agent));
        }}
        onPointerLeave={() => {
          hoveredRef.current = undefined;
          setHovered(undefined);
        }}
        onClick={(event) => {
          const agent = agentAt(event.clientX);
          if (agent) actions.select(agent);
        }}
      />
      {hovered ? (
        <aside
          ref={tooltipRef}
          className={`vf-monitor-rain-tooltip is-${hovered.status}`}
          style={{ left: pointerRef.current.x + 15, top: pointerRef.current.y + 15 }}
          aria-hidden="true"
        >
          <header className="vf-monitor-rain-tooltip-head">
            <strong>{hovered.project}</strong>
            <span>{hovered.status}</span>
          </header>
          <dl>
            {hovered.agent?.branch ? (
              <>
                <dt>BRN</dt>
                <dd>{hovered.agent.branch}</dd>
              </>
            ) : null}
            <dt>MOD</dt>
            <dd>{hovered.agent ? (hovered.agent.model ?? hovered.agent.provider) : "terminal"}</dd>
            <dt>ACT</dt>
            <dd>{hovered.detail}</dd>
          </dl>
          {hovered.agent?.contextWindow ? (
            <p className="vf-monitor-rain-context">
              <span className="vf-monitor-rain-context-track">
                <i style={{ width: `${hovered.agent.contextWindow.usedPercent}%` }} />
              </span>
              CTX {Math.round(hovered.agent.contextWindow.usedPercent)}%
            </p>
          ) : null}
        </aside>
      ) : null}
      {/* The canvas carries no accessible tree of its own, so the agents it draws are also offered as controls. */}
      <ul className="vf-monitor-rain-agents">
        {agents.map((agent) => (
          <li key={agent.id}>
            <button
              type="button"
              onClick={() => actions.select(agent)}
              aria-current={agent.active ? "true" : undefined}
            >
              {`${agent.project}, ${agent.agent ? (agent.agent.model ?? agent.agent.provider) : "terminal"}, ${agent.status}: ${agent.detail}`}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
