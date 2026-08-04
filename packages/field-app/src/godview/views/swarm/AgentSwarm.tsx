import Matter from "matter-js";
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

// The swarm — the reference app's matter.js agent field, ported.
//
// Status is size and treatment, never a decorative hue: the per-bubble color is
// a §2.6 ORGANIZATIONAL accent (stable per session, groups and labels), and the
// state reading comes from §2.5 through the palette the stage hands down. That
// separation is the whole reason a bubble can be both "this session, always this
// color" and "right now, waiting" without the two fighting.
//
// PF6: the engine, the rAF loop and the ResizeObserver are all born in the mount
// effect and destroyed in its cleanup. The stage unmounts when the overlay
// closes, so a closed Godview runs no physics — there is no paused engine to
// forget about, because there is no engine.

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

interface PhysicsBody {
  body: Matter.Body;
  currentRadius: number;
  targetRadius: number;
  pointerId?: number;
  pointerStartX: number;
  pointerStartY: number;
  dragConstraint?: Matter.Constraint;
  dragged: boolean;
}

interface ChromeObstacle {
  element: HTMLElement;
  body: Matter.Body;
  width: number;
  height: number;
}

interface PhysicsWorld {
  engine: Matter.Engine;
  walls: [Matter.Body, Matter.Body, Matter.Body, Matter.Body];
  obstacles: readonly ChromeObstacle[];
}

const PHYSICAL_GAP = 4;
const CHROME_OBSTACLE_PADDING = 7;
const DRAG_STIFFNESS = 0.2;
const WALL_THICKNESS = 5000;
const SPAWN_DURATION_MS = 720;
const SPAWN_CLEARANCE = 12;
const SPAWN_CANDIDATES = 40;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const LONG_PRESS_DURATION_MS = 520;
const LONG_PRESS_MOVE_TOLERANCE = 8;

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

function animateSpawn(element: HTMLButtonElement): void {
  // M6: reduced motion gets the end state, not a spring. The guard also covers
  // the environment where `animate` does not exist at all (tests, and any
  // renderer where the WAAPI surface is stubbed).
  if (
    typeof element.animate !== "function" ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  ) {
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

function findSpawnPosition(
  width: number,
  height: number,
  radius: number,
  existingBodies: Iterable<PhysicsBody>,
): Matter.Vector {
  const bodies = [...existingBodies];
  const center = { x: width / 2, y: height / 2 };
  if (bodies.length === 0) return center;

  const collisionRadius = radius + PHYSICAL_GAP;
  const horizontalReach = Math.max(
    0,
    Math.min(width * 0.28, width / 2 - collisionRadius - SPAWN_CLEARANCE),
  );
  const verticalReach = Math.max(
    0,
    Math.min(height * 0.28, height / 2 - collisionRadius - SPAWN_CLEARANCE),
  );
  const phase = Math.random() * Math.PI * 2;
  let bestPosition = center;
  let bestClearance = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < SPAWN_CANDIDATES; index += 1) {
    const progress = index === 0 ? 0 : Math.sqrt(index / (SPAWN_CANDIDATES - 1));
    const angle = phase + index * GOLDEN_ANGLE;
    const candidate = {
      x: center.x + Math.cos(angle) * horizontalReach * progress,
      y: center.y + Math.sin(angle) * verticalReach * progress,
    };
    let clearance = Number.POSITIVE_INFINITY;
    for (const wrapper of bodies) {
      const distance = Math.hypot(
        candidate.x - wrapper.body.position.x,
        candidate.y - wrapper.body.position.y,
      );
      clearance = Math.min(
        clearance,
        distance - (collisionRadius + wrapper.currentRadius + PHYSICAL_GAP + SPAWN_CLEARANCE),
      );
    }
    if (clearance > bestClearance) {
      bestPosition = candidate;
      bestClearance = clearance;
    }
    if (clearance >= 0) return candidate;
  }

  return bestPosition;
}

function clampSpawnPosition(
  width: number,
  height: number,
  radius: number,
  position: Matter.Vector,
): Matter.Vector {
  const margin = radius + PHYSICAL_GAP;
  return {
    x: Math.min(Math.max(position.x, margin), Math.max(margin, width - margin)),
    y: Math.min(Math.max(position.y, margin), Math.max(margin, height - margin)),
  };
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
  const bodiesRef = useRef(new Map<string, PhysicsBody>());
  const spawnedIdsRef = useRef(new Set<string>());
  const longPressRef = useRef<PendingLongPress | undefined>(undefined);
  const longPressTimerRef = useRef<number | undefined>(undefined);
  const worldRef = useRef<PhysicsWorld | undefined>(undefined);
  const parametersRef = useRef(swarm);
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
    const world = worldRef.current;
    if (!world) return;
    for (const wrapper of bodiesRef.current.values()) {
      wrapper.body.restitution = swarm.restitution;
      wrapper.body.frictionAir = swarm.frictionAir;
    }
    for (const wall of world.walls) wall.restitution = swarm.restitution;
    for (const obstacle of world.obstacles) obstacle.body.restitution = swarm.restitution;
  }, [swarm]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let width = container.clientWidth;
    let height = container.clientHeight;
    const engine = Matter.Engine.create();
    engine.gravity.x = 0;
    engine.gravity.y = 0;
    const wallOptions = { isStatic: true, restitution: parametersRef.current.restitution };
    const walls: [Matter.Body, Matter.Body, Matter.Body, Matter.Body] = [
      Matter.Bodies.rectangle(
        width / 2,
        height + WALL_THICKNESS / 2,
        10000,
        WALL_THICKNESS,
        wallOptions,
      ),
      Matter.Bodies.rectangle(width / 2, -WALL_THICKNESS / 2, 10000, WALL_THICKNESS, wallOptions),
      Matter.Bodies.rectangle(-WALL_THICKNESS / 2, height / 2, WALL_THICKNESS, 10000, wallOptions),
      Matter.Bodies.rectangle(
        width + WALL_THICKNESS / 2,
        height / 2,
        WALL_THICKNESS,
        10000,
        wallOptions,
      ),
    ];
    // Shell chrome is solid: bubbles settle around the mock label rather than
    // drifting under it. Which elements those are is the stage's business.
    const obstacles: ChromeObstacle[] = monitorChromeElements(container).map((element) => {
      const rect = element.getBoundingClientRect();
      const obstacleWidth = Math.max(1, rect.width + CHROME_OBSTACLE_PADDING * 2);
      const obstacleHeight = Math.max(1, rect.height + CHROME_OBSTACLE_PADDING * 2);
      return {
        element,
        body: Matter.Bodies.rectangle(0, 0, obstacleWidth, obstacleHeight, wallOptions),
        width: obstacleWidth,
        height: obstacleHeight,
      };
    });
    Matter.Composite.add(engine.world, [...walls, ...obstacles.map((obstacle) => obstacle.body)]);
    worldRef.current = { engine, walls, obstacles };

    const updateBounds = (): void => {
      width = container.clientWidth;
      height = container.clientHeight;
      Matter.Body.setPosition(walls[0], { x: width / 2, y: height + WALL_THICKNESS / 2 });
      Matter.Body.setPosition(walls[1], { x: width / 2, y: -WALL_THICKNESS / 2 });
      Matter.Body.setPosition(walls[2], { x: -WALL_THICKNESS / 2, y: height / 2 });
      Matter.Body.setPosition(walls[3], { x: width + WALL_THICKNESS / 2, y: height / 2 });
      if (obstacles.length === 0) return;
      const containerRect = container.getBoundingClientRect();
      for (const obstacle of obstacles) {
        const rect = obstacle.element.getBoundingClientRect();
        const nextWidth = Math.max(1, rect.width + CHROME_OBSTACLE_PADDING * 2);
        const nextHeight = Math.max(1, rect.height + CHROME_OBSTACLE_PADDING * 2);
        Matter.Body.scale(obstacle.body, nextWidth / obstacle.width, nextHeight / obstacle.height);
        obstacle.width = nextWidth;
        obstacle.height = nextHeight;
        Matter.Body.setPosition(obstacle.body, {
          x: rect.left - containerRect.left + rect.width / 2,
          y: rect.top - containerRect.top + rect.height / 2,
        });
      }
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateBounds);
    resizeObserver?.observe(container);
    for (const obstacle of obstacles) resizeObserver?.observe(obstacle.element);
    updateBounds();

    let frame = 0;
    let previousTime = performance.now();
    const render = (time: number): void => {
      const delta = Math.min(1000 / 30, Math.max(1000 / 120, time - previousTime));
      previousTime = time;
      const currentParameters = parametersRef.current;
      for (const wrapper of bodiesRef.current.values()) {
        const { body } = wrapper;
        if (!wrapper.dragConstraint) {
          Matter.Body.applyForce(body, body.position, {
            x: (width / 2 - body.position.x) * currentParameters.gravityPull,
            y: (height / 2 - body.position.y) * currentParameters.gravityPull,
          });
        }
        if (Math.abs(wrapper.targetRadius - wrapper.currentRadius) > 0.5) {
          const scale =
            (wrapper.targetRadius + PHYSICAL_GAP) / (wrapper.currentRadius + PHYSICAL_GAP);
          Matter.Body.scale(body, scale, scale);
          wrapper.currentRadius = wrapper.targetRadius;
        }
      }

      Matter.Engine.update(engine, delta);

      for (const [id, wrapper] of bodiesRef.current) {
        const element = elementRefs.current.get(id);
        const bubble = bubbleRefs.current.get(id);
        if (!element || !bubble) continue;
        const radius = wrapper.currentRadius;
        element.style.width = `${radius * 2}px`;
        element.style.height = `${radius * 2}px`;
        element.style.transform = `translate3d(${wrapper.body.position.x - radius}px, ${wrapper.body.position.y - radius}px, 0)`;
        if (!spawnedIdsRef.current.has(id)) {
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
      bodiesRef.current.clear();
      Matter.Engine.clear(engine);
      Matter.Composite.clear(engine.world, false, true);
      worldRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const world = worldRef.current;
    const container = containerRef.current;
    if (!world || !container) return;
    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 180);
    const ids = new Set(agents.map((agent) => agent.id));
    for (const [id, wrapper] of bodiesRef.current) {
      if (ids.has(id)) continue;
      if (wrapper.dragConstraint)
        Matter.Composite.remove(world.engine.world, wrapper.dragConstraint);
      Matter.Composite.remove(world.engine.world, wrapper.body);
      bodiesRef.current.delete(id);
      spawnedIdsRef.current.delete(id);
    }
    for (const agent of agents) {
      const targetRadius = radiusForStatus(swarm, swarmAppearance(swarmVisualState(agent)));
      const existing = bodiesRef.current.get(agent.id);
      if (existing) {
        existing.targetRadius = targetRadius;
        continue;
      }
      const spawnPosition = agent.spawnHint
        ? clampSpawnPosition(width, height, targetRadius, agent.spawnHint)
        : findSpawnPosition(width, height, targetRadius, bodiesRef.current.values());
      const body = Matter.Bodies.circle(
        spawnPosition.x,
        spawnPosition.y,
        targetRadius + PHYSICAL_GAP,
        {
          restitution: swarm.restitution,
          frictionAir: swarm.frictionAir,
          friction: 0.1,
        },
      );
      bodiesRef.current.set(agent.id, {
        body,
        currentRadius: targetRadius,
        targetRadius,
        pointerStartX: 0,
        pointerStartY: 0,
        dragged: false,
      });
      Matter.Composite.add(world.engine.world, body);
    }
  }, [agents, swarm]);

  const moveBody = (event: ReactPointerEvent<HTMLButtonElement>, id: string): void => {
    const wrapper = bodiesRef.current.get(id);
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!wrapper || !bounds || wrapper.pointerId !== event.pointerId || !wrapper.dragConstraint)
      return;
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (Math.hypot(x - wrapper.pointerStartX, y - wrapper.pointerStartY) >= 5)
      wrapper.dragged = true;
    wrapper.dragConstraint.pointA.x = x;
    wrapper.dragConstraint.pointA.y = y;
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
                const wrapper = bodiesRef.current.get(agent.id);
                const world = worldRef.current;
                const bounds = containerRef.current?.getBoundingClientRect();
                if (!wrapper || !world || !bounds) return;
                const x = event.clientX - bounds.left;
                const y = event.clientY - bounds.top;
                if (wrapper.dragConstraint) {
                  Matter.Composite.remove(world.engine.world, wrapper.dragConstraint);
                }
                wrapper.dragConstraint = Matter.Constraint.create({
                  pointA: { x, y },
                  bodyB: wrapper.body,
                  pointB: { x: x - wrapper.body.position.x, y: y - wrapper.body.position.y },
                  stiffness: DRAG_STIFFNESS,
                  render: { visible: false },
                });
                Matter.Composite.add(world.engine.world, wrapper.dragConstraint);
                event.currentTarget.setPointerCapture(event.pointerId);
                wrapper.pointerId = event.pointerId;
                wrapper.pointerStartX = x;
                wrapper.pointerStartY = y;
                wrapper.dragged = false;
                event.preventDefault();
              }}
              onPointerMove={(event) => moveBody(event, agent.id)}
              onPointerUp={(event) => {
                const wrapper = bodiesRef.current.get(agent.id);
                const world = worldRef.current;
                if (!wrapper) return;
                moveBody(event, agent.id);
                if (world && wrapper.dragConstraint) {
                  Matter.Composite.remove(world.engine.world, wrapper.dragConstraint);
                }
                delete wrapper.dragConstraint;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                delete wrapper.pointerId;
              }}
              onPointerCancel={() => {
                const wrapper = bodiesRef.current.get(agent.id);
                const world = worldRef.current;
                if (!wrapper) return;
                if (world && wrapper.dragConstraint) {
                  Matter.Composite.remove(world.engine.world, wrapper.dragConstraint);
                }
                delete wrapper.dragConstraint;
                delete wrapper.pointerId;
              }}
              onClick={() => {
                const wrapper = bodiesRef.current.get(agent.id);
                if (wrapper?.dragged) {
                  wrapper.dragged = false;
                  return;
                }
                actions.select(agent);
                if (wrapper) {
                  Matter.Body.applyForce(wrapper.body, wrapper.body.position, {
                    x: (Math.random() - 0.5) * 0.003,
                    y: (Math.random() - 0.5) * 0.003,
                  });
                }
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
