import {
  type CSSProperties,
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentIcon } from "../../monitor/AgentIcon";
import type { AgentVisualStatus } from "../../monitor/agent-status";
import { monitorChromeElements } from "../../monitor/chrome";
import type { AgentMonitorProps, MonitorAgent } from "../../monitor/types";
import {
  normalizeSwarmParameters,
  radiusForStatus,
  type SwarmParameters,
} from "./swarm-parameters";
import {
  FRAME_COUNT_INDEX,
  FRAME_GENERATION_INDEX,
  FRAME_HEADER_FLOATS,
  FRAME_STRIDE,
  PHYSICS_HZ_FLOOR,
  type SwarmAgentSpec,
  type SwarmObstacleRect,
  type SwarmPhysicsParameters,
} from "./swarm-physics";
import { createSwarmPhysicsDriver, type SwarmPhysicsDriver } from "./swarm-physics-driver";
import type { SwarmPhysicsEvent } from "./swarm-physics-protocol";

// The swarm — the reference app's matter.js agent field, ported.
//
// Status is size and treatment, never a decorative hue: the per-bubble color is
// a §2.6 ORGANIZATIONAL accent (stable per session, groups and labels), and the
// state reading comes from §2.5 through the palette the stage hands down. That
// separation is the whole reason a bubble can be both "this session, always this
// color" and "right now, waiting" without the two fighting.
//
// GT-3c: THE SIMULATION IS NO LONGER HERE. matter, the accumulator, the springs
// and the spawn search live in `swarm-physics.ts`, hosted in a worker
// (`swarm-physics-driver.ts` picks the home). What is left in this file is
// everything that genuinely needs a document: measuring chrome, mapping pointers
// into world coordinates, the spawn animation, and the damage-gated writes.
//
// The render loop is unchanged in SHAPE and in feel. It still interpolates
// between two solved states and still writes only what moved; the difference is
// where the two states come from. They used to be "before and after this frame's
// step" and are now "the last two frames the physics sent", which is the same
// pair of samples a step apart — so the blend, and the one-step latency it costs
// a dragged bubble, are exactly what they were before.
//
// PF6: the driver, the rAF loop and the ResizeObserver are all born in the mount
// effect and destroyed in its cleanup. The stage unmounts when the overlay
// closes, so a closed Godview runs no physics — and now not even a thread to run
// it in, because disposing the driver terminates the worker.

interface IgnitionParticleStyle extends CSSProperties {
  "--ignition-angle": string;
  "--ignition-delay": string;
  "--ignition-distance": string;
  "--ignition-duration": string;
  "--ignition-size": string;
}

function particleNoise(index: number, channel: number): number {
  const value = Math.sin((index + 1) * 12.9898 + (channel + 1) * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

const IGNITION_PARTICLES: readonly IgnitionParticleStyle[] = Array.from(
  { length: 24 },
  (_, index) => ({
    "--ignition-angle": `${(particleNoise(index, 0) * 360).toFixed(2)}deg`,
    "--ignition-delay": `${(-particleNoise(index, 1) * 2.2).toFixed(2)}s`,
    "--ignition-distance": `${(24 + particleNoise(index, 2) * 34).toFixed(2)}px`,
    "--ignition-duration": `${(1.05 + particleNoise(index, 3) * 1.35).toFixed(2)}s`,
    "--ignition-size": `${(2 + particleNoise(index, 4) * 1.5).toFixed(2)}px`,
  }),
);

/** What the last two frames said about one bubble, and what was last written for
 * it. The physics owns the positions; this is the render's own copy, because a
 * transferred frame goes straight back to the sender. */
interface BubbleState {
  /** The newest solved position, and the one before it — the two ends of the
   * blend the renderer draws between (GT-D15.2). */
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  radius: number;
  /** What was last WRITTEN to the DOM, so a frame that changed nothing writes
   * nothing (GT-D15.3). Nine bubbles × three properties × 120Hz is 3,240 style
   * writes a second to say the same thing when the swarm has settled. */
  writtenX: number;
  writtenY: number;
  writtenRadius: number;
}

/** A pointer that has taken hold of a bubble. `dragged` outlives the pointer on
 * purpose: the click that follows a drag has to be told not to select. */
interface BubbleDrag {
  pointerId?: number;
  startX: number;
  startY: number;
  dragged: boolean;
}

const SPAWN_DURATION_MS = 720;
const LONG_PRESS_DURATION_MS = 520;
const LONG_PRESS_MOVE_TOLERANCE = 8;
/** Sub-pixel movement nobody can see. The damage gate's threshold, in CSS px. */
const WRITE_EPSILON_PX = 0.05;

type SwarmVisualState = AgentVisualStatus | "ignited";

/**
 * The swarm's own reading of status, and the reason a live agent is never drawn
 * at the idle size: the smallest body is reserved for a terminal nobody has
 * claimed, so an agent merely sitting ready still reads as present.
 */
function swarmVisualState(agent: MonitorAgent): SwarmVisualState {
  if (!agent.agent) return agent.status;
  switch (agent.status) {
    case "idle":
      return "working";
    case "working":
      return "ignited";
    case "waiting":
      return "waiting";
  }
}

function swarmAppearance(state: SwarmVisualState): AgentVisualStatus {
  return state === "ignited" ? "working" : state;
}

/** The physics' half of the panel's parameters. The rest — fill opacity, the
 * radii — describe how a bubble LOOKS, which the simulation has no use for. */
function physicsParameters(swarm: SwarmParameters): SwarmPhysicsParameters {
  return {
    gravityPull: swarm.gravityPull,
    restitution: swarm.restitution,
    frictionAir: swarm.frictionAir,
    physicsHz: swarm.physicsHz,
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function animateSpawn(element: HTMLButtonElement): void {
  // M6: reduced motion gets the end state, not a spring. The guard also covers
  // the environment where `animate` does not exist at all (tests, and any
  // renderer where the WAAPI surface is stubbed).
  if (typeof element.animate !== "function" || prefersReducedMotion()) {
    return;
  }

  const animation = element.animate(
    [
      { transform: "scale(0)", opacity: 0, offset: 0, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      {
        transform: "scale(1.2)",
        opacity: 1,
        offset: 0.52,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      { transform: "scale(0.96)", opacity: 1, offset: 0.72, easing: "ease-out" },
      { transform: "scale(1.035)", opacity: 1, offset: 0.88, easing: "ease-in-out" },
      { transform: "scale(1)", opacity: 1, offset: 1 },
    ],
    { duration: SPAWN_DURATION_MS, fill: "both" },
  );

  void animation.finished.then(
    () => animation.cancel(),
    () => undefined,
  );
}

interface PendingLongPress {
  pointerId: number;
  clientX: number;
  clientY: number;
  position: { x: number; y: number };
}

export function AgentSwarm({
  agents,
  parameters,
  actions,
  palette,
}: AgentMonitorProps): ReactElement {
  const swarm = useMemo<SwarmParameters>(() => normalizeSwarmParameters(parameters), [parameters]);
  const containerRef = useRef<HTMLElement>(null);
  const elementRefs = useRef(new Map<string, HTMLDivElement>());
  const bubbleRefs = useRef(new Map<string, HTMLButtonElement>());
  const statesRef = useRef(new Map<string, BubbleState>());
  const dragsRef = useRef(new Map<string, BubbleDrag>());
  const spawnedIdsRef = useRef(new Set<string>());
  const longPressRef = useRef<PendingLongPress | undefined>(undefined);
  const longPressTimerRef = useRef<number | undefined>(undefined);
  const driverRef = useRef<SwarmPhysicsDriver | undefined>(undefined);
  const parametersRef = useRef(swarm);
  /** Index → id for the frames arriving now, and the generation it belongs to. */
  const tableRef = useRef<{ generation: number; ids: readonly string[] }>({
    generation: -1,
    ids: [],
  });
  /** When the newest frame landed, in this thread's clock. The blend runs from
   * here forward, so a frame arriving late slides rather than snaps. */
  const frameAtRef = useRef<number | null>(null);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const [longPressPosition, setLongPressPosition] = useState<{ x: number; y: number }>();

  const cancelLongPress = (): void => {
    if (longPressTimerRef.current !== undefined) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = undefined;
    longPressRef.current = undefined;
    setLongPressPosition(undefined);
  };

  useEffect(
    () => () => {
      if (longPressTimerRef.current !== undefined) window.clearTimeout(longPressTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    parametersRef.current = swarm;
    driverRef.current?.post({ type: "updateParameters", parameters: physicsParameters(swarm) });
  }, [swarm]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Shell chrome is solid: bubbles settle around the mock label rather than
    // drifting under it. Which elements those are is the stage's business, and
    // OBSERVING them stays here — a worker has no getBoundingClientRect. What
    // crosses the wire is rectangles.
    const chrome = monitorChromeElements(container);
    const readObstacles = (): SwarmObstacleRect[] => {
      if (chrome.length === 0) return [];
      const containerRect = container.getBoundingClientRect();
      return chrome.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.left - containerRect.left,
          y: rect.top - containerRect.top,
          width: rect.width,
          height: rect.height,
        };
      });
    };

    const applyTable = (event: Extract<SwarmPhysicsEvent, { type: "idTable" }>): void => {
      tableRef.current = { generation: event.generation, ids: event.ids };
      const living = new Set(event.ids);
      for (const id of [...statesRef.current.keys()]) {
        if (living.has(id)) continue;
        statesRef.current.delete(id);
        dragsRef.current.delete(id);
        spawnedIdsRef.current.delete(id);
      }
    };

    const driver = createSwarmPhysicsDriver({
      onEvent: (event) => {
        if (event.type === "idTable") applyTable(event);
      },
      onFrame: (frame) => {
        // Read everything BEFORE handing the buffer back: returning it detaches
        // this view of it, and a detached array reads as empty rather than as an
        // error.
        if (frame[FRAME_GENERATION_INDEX] === tableRef.current.generation) {
          const { ids } = tableRef.current;
          const count = frame[FRAME_COUNT_INDEX] ?? 0;
          for (let index = 0; index < count; index += 1) {
            const id = ids[index];
            if (id === undefined) break;
            const offset = FRAME_HEADER_FLOATS + index * FRAME_STRIDE;
            const x = frame[offset] ?? 0;
            const y = frame[offset + 1] ?? 0;
            const radius = frame[offset + 2] ?? 0;
            const state = statesRef.current.get(id);
            if (state) {
              state.previousX = state.x;
              state.previousY = state.y;
              state.x = x;
              state.y = y;
              state.radius = radius;
            } else {
              statesRef.current.set(id, {
                x,
                y,
                // A new body has no history, so its first blend must be a no-op:
                // from where it is, to where it is. Seeding these with the spawn
                // position is what stops a bubble's first frame from being a
                // streak out of (0, 0).
                previousX: x,
                previousY: y,
                radius,
                // Deliberately NaN rather than the spawn position: the damage
                // gate's first comparison must be guaranteed to fail so the
                // opening write happens, and every comparison against NaN is
                // false.
                writtenX: Number.NaN,
                writtenY: Number.NaN,
                writtenRadius: Number.NaN,
              });
            }
          }
          frameAtRef.current = performance.now();
        }
        driver.post({ type: "releaseFrame", buffer: frame }, [frame.buffer]);
      },
    });
    driverRef.current = driver;

    driver.post({
      type: "init",
      agents: agentSpecs(agentsRef.current, parametersRef.current),
      parameters: physicsParameters(parametersRef.current),
      bounds: { width: container.clientWidth, height: container.clientHeight },
      obstacles: readObstacles(),
      reducedMotion: prefersReducedMotion(),
    });

    const updateBounds = (): void => {
      driver.post({
        type: "updateBounds",
        bounds: { width: container.clientWidth, height: container.clientHeight },
      });
      if (chrome.length > 0) driver.post({ type: "updateObstacles", obstacles: readObstacles() });
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateBounds);
    resizeObserver?.observe(container);
    for (const element of chrome) resizeObserver?.observe(element);

    // THE LOOP (GT-D15.2/3), now with one job fewer. It draws at the display's
    // rate by interpolating between the last two states the physics published,
    // and writes to the DOM only what actually moved. It no longer SOLVES
    // anything — that happens on the other thread, at its own fixed rate, and
    // this loop's cost is the same whether the engine is stepping at 15Hz or
    // 120.
    let frame = 0;
    const render = (time: number): void => {
      const stepMs = 1000 / Math.max(PHYSICS_HZ_FLOOR, parametersRef.current.physicsHz);
      const arrivedAt = frameAtRef.current;
      // Age of the newest frame, as a fraction of a step. It runs 0 → 1 across
      // the interval before the next one is due, which is the same ramp the
      // accumulator used to provide — and it holds at 1 rather than
      // extrapolating if the next frame is late.
      const alpha = arrivedAt === null ? 1 : Math.min(1, Math.max(0, (time - arrivedAt) / stepMs));

      for (const [id, state] of statesRef.current) {
        const element = elementRefs.current.get(id);
        const bubble = bubbleRefs.current.get(id);
        if (!element || !bubble) continue;
        const radius = state.radius;
        const x = state.previousX + (state.x - state.previousX) * alpha;
        const y = state.previousY + (state.y - state.previousY) * alpha;

        const first = !spawnedIdsRef.current.has(id);
        // Radius changes are rare (a status change) and cost a layout, so they
        // are gated on their own — the 0.5px rule the scaling already uses.
        if (first || Math.abs(radius - state.writtenRadius) > 0.5) {
          element.style.width = `${radius * 2}px`;
          element.style.height = `${radius * 2}px`;
          state.writtenRadius = radius;
        }
        if (
          first ||
          Math.abs(x - state.writtenX) > WRITE_EPSILON_PX ||
          Math.abs(y - state.writtenY) > WRITE_EPSILON_PX
        ) {
          element.style.transform = `translate3d(${x - radius}px, ${y - radius}px, 0)`;
          state.writtenX = x;
          state.writtenY = y;
        }
        if (first) {
          spawnedIdsRef.current.add(id);
          animateSpawn(bubble);
          element.style.visibility = "";
        }
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      statesRef.current.clear();
      dragsRef.current.clear();
      // Both halves, in order: the host tears its engine down and stops its
      // timer, then the thread itself goes. Either alone would leave something
      // running past the close PF6 says must run nothing.
      driver.post({ type: "dispose" });
      driver.dispose();
      driverRef.current = undefined;
      frameAtRef.current = null;
      tableRef.current = { generation: -1, ids: [] };
    };
  }, []);

  useEffect(() => {
    driverRef.current?.post({ type: "updateAgents", agents: agentSpecs(agents, swarm) });
  }, [agents, swarm]);

  const pointInContainer = (event: ReactPointerEvent): { x: number; y: number } | undefined => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return undefined;
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const moveBody = (event: ReactPointerEvent<HTMLButtonElement>, id: string): void => {
    const drag = dragsRef.current.get(id);
    const point = pointInContainer(event);
    if (!drag || !point || drag.pointerId !== event.pointerId) return;
    if (Math.hypot(point.x - drag.startX, point.y - drag.startY) >= 5) drag.dragged = true;
    driverRef.current?.post({ type: "dragMove", id, point });
  };

  const statusStyle = {
    "--vf-monitor-working": palette.status.working,
    "--vf-monitor-waiting": palette.status.waiting,
    "--vf-monitor-idle": palette.status.idle,
    "--vf-monitor-bubble-fill-opacity": `${swarm.bubbleFillOpacity * 100}%`,
  } as CSSProperties;

  return (
    <section
      ref={containerRef}
      className="vf-monitor-swarm"
      style={statusStyle}
      aria-label="Running agent status field"
      onPointerDown={(event) => {
        if (event.button !== 0 || event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const pending = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          position: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        };
        cancelLongPress();
        longPressRef.current = pending;
        setLongPressPosition(pending.position);
        event.currentTarget.setPointerCapture(event.pointerId);
        longPressTimerRef.current = window.setTimeout(() => {
          if (longPressRef.current !== pending) return;
          longPressTimerRef.current = undefined;
          longPressRef.current = undefined;
          setLongPressPosition(undefined);
          void actions.createAt(pending.position);
        }, LONG_PRESS_DURATION_MS);
      }}
      onPointerMove={(event) => {
        const pending = longPressRef.current;
        if (!pending || pending.pointerId !== event.pointerId) return;
        if (
          Math.hypot(event.clientX - pending.clientX, event.clientY - pending.clientY) >
          LONG_PRESS_MOVE_TOLERANCE
        ) {
          cancelLongPress();
        }
      }}
      onPointerUp={(event) => {
        if (longPressRef.current?.pointerId === event.pointerId) cancelLongPress();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={(event) => {
        if (longPressRef.current?.pointerId === event.pointerId) cancelLongPress();
      }}
    >
      <div className="vf-monitor-swarm-grid" aria-hidden="true" />
      {longPressPosition ? (
        <span
          className="vf-monitor-long-press"
          style={{ left: longPressPosition.x, top: longPressPosition.y }}
          aria-hidden="true"
        />
      ) : null}
      {agents.length === 0 ? (
        <div className="vf-monitor-empty">
          <span>NO ACTIVE AGENTS</span>
          <small>Launch Claude, Codex, or Grok from a terminal pane.</small>
        </div>
      ) : null}
      {agents.map((agent) => {
        const facet = agent.agent;
        const visualState = swarmVisualState(agent);
        const appearance = swarmAppearance(visualState);
        const ignited = visualState === "ignited";
        const linkedColor = agent.attachment?.primary;
        const style = { "--agent-color": linkedColor ?? agent.color } as CSSProperties;
        const contextWindow = facet?.contextWindow;
        const contextPercent = contextWindow ? Math.floor(contextWindow.usedPercent) : undefined;
        const contextLabel =
          contextPercent === undefined
            ? "CTX:--%"
            : `CTX:${contextPercent.toString().padStart(2, "0")}%`;
        return (
          <div
            key={agent.id}
            className={`vf-monitor-bubble-positioner is-${appearance}`}
            ref={(element) => {
              if (element) {
                elementRefs.current.set(agent.id, element);
                if (!spawnedIdsRef.current.has(agent.id)) element.style.visibility = "hidden";
              } else {
                elementRefs.current.delete(agent.id);
              }
            }}
          >
            <button
              ref={(element) => {
                if (element) bubbleRefs.current.set(agent.id, element);
                else bubbleRefs.current.delete(agent.id);
              }}
              type="button"
              className={`vf-monitor-bubble is-${appearance}${ignited ? " is-ignited" : ""}${
                facet ? "" : " is-unassigned"
              }${linkedColor ? " is-linked" : ""}${agent.active ? " is-active" : ""}`}
              style={style}
              aria-current={agent.active ? "true" : undefined}
              aria-label={
                facet
                  ? `${agent.project}, ${facet.model ?? facet.provider}, ${agent.status}: ${agent.detail}, ${contextLabel}`
                  : `${agent.project}, unassigned terminal, ${agent.status}`
              }
              title={
                facet
                  ? `${agent.project} · ${facet.model ?? facet.provider} · ${agent.detail}`
                  : agent.detail
              }
              onPointerDown={(event) => {
                const point = pointInContainer(event);
                if (!point) return;
                dragsRef.current.set(agent.id, {
                  pointerId: event.pointerId,
                  startX: point.x,
                  startY: point.y,
                  dragged: false,
                });
                driverRef.current?.post({ type: "dragStart", id: agent.id, point });
                event.currentTarget.setPointerCapture(event.pointerId);
                event.preventDefault();
              }}
              onPointerMove={(event) => moveBody(event, agent.id)}
              onPointerUp={(event) => {
                const drag = dragsRef.current.get(agent.id);
                if (!drag) return;
                moveBody(event, agent.id);
                driverRef.current?.post({ type: "dragEnd", id: agent.id });
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                // The pointer is gone but `dragged` is not: the click that
                // follows still has to know this was a drag.
                delete drag.pointerId;
              }}
              onPointerCancel={() => {
                const drag = dragsRef.current.get(agent.id);
                if (!drag) return;
                driverRef.current?.post({ type: "dragEnd", id: agent.id });
                delete drag.pointerId;
              }}
              onClick={() => {
                const drag = dragsRef.current.get(agent.id);
                if (drag?.dragged) {
                  drag.dragged = false;
                  return;
                }
                actions.select(agent);
                driverRef.current?.post({ type: "nudge", id: agent.id });
              }}
            >
              {contextWindow ? (
                <span
                  className="vf-monitor-bubble-context-fill"
                  style={{ height: `${contextWindow.usedPercent}%` }}
                  aria-hidden="true"
                />
              ) : null}
              {ignited ? (
                <span className="vf-monitor-bubble-ignition" aria-hidden="true">
                  <i className="vf-monitor-bubble-core-glow" />
                  <span className="vf-monitor-bubble-particles">
                    {IGNITION_PARTICLES.map((particleStyle, index) => (
                      <i
                        className="vf-monitor-bubble-particle"
                        // The particle set is a fixed, index-addressed constant —
                        // it never reorders, so the index IS the identity.
                        key={index}
                        style={particleStyle}
                      />
                    ))}
                  </span>
                </span>
              ) : null}
              {agent.attachment?.mirrors.length ? (
                <span className="vf-monitor-bubble-mirrors" aria-hidden="true">
                  {agent.attachment.mirrors.map((color, index) => (
                    <i
                      key={`${color}-${index}`}
                      style={{ inset: `${4 + index * 3}px`, borderColor: color }}
                    />
                  ))}
                </span>
              ) : null}
              {facet ? (
                <span className="vf-monitor-bubble-glyph" aria-hidden="true">
                  <AgentIcon agent={facet.kind} />
                </span>
              ) : null}
              <span className="vf-monitor-bubble-copy">
                {facet?.branch ? (
                  <span className="vf-monitor-bubble-branch">{facet.branch}</span>
                ) : null}
                <strong>{agent.project}</strong>
                {facet ? (
                  <span className="vf-monitor-bubble-provider">
                    {facet.model ?? facet.provider}
                  </span>
                ) : null}
              </span>
              {facet ? <span className="vf-monitor-bubble-context">{contextLabel}</span> : null}
            </button>
          </div>
        );
      })}
    </section>
  );
}

/** The agents as the physics needs them: an id, the size to grow toward, and
 * where a deliberate creation gesture happened. */
function agentSpecs(
  agents: readonly MonitorAgent[],
  swarm: SwarmParameters,
): readonly SwarmAgentSpec[] {
  return agents.map((agent) => {
    const spec: SwarmAgentSpec = {
      id: agent.id,
      radius: radiusForStatus(swarm, swarmAppearance(swarmVisualState(agent))),
    };
    if (agent.spawnHint) spec.spawnHint = agent.spawnHint;
    return spec;
  });
}
