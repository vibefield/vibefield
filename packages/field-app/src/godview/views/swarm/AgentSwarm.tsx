import {
  type CSSProperties,
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { monitorChromeElements } from "../../monitor/chrome";
import type { AgentMonitorProps, MonitorAgent } from "../../monitor/types";
import { AgentBubbleView, agentBubblePresentation, animateAgentBubbleSpawn } from "./AgentBubble";
import { type BubbleState, readSwarmFrame } from "./swarm-frame";
import {
  normalizeSwarmParameters,
  radiusForStatus,
  type SwarmParameters,
} from "./swarm-parameters";
import {
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

/** A pointer that has taken hold of a bubble. `dragged` outlives the pointer on
 * purpose: the click that follows a drag has to be told not to select. */
interface BubbleDrag {
  pointerId?: number;
  startX: number;
  startY: number;
  dragged: boolean;
}

const LONG_PRESS_DURATION_MS = 520;
const LONG_PRESS_MOVE_TOLERANCE = 8;
/** Sub-pixel movement nobody can see. The damage gate's threshold, in CSS px. */
const WRITE_EPSILON_PX = 0.05;

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
        // READ, THEN RELEASE, and never the other way round: handing the buffer
        // back transfers it, which DETACHES this thread's view of it, and a
        // detached array reads as empty rather than throwing — so the mistake
        // costs a motionless swarm and no error at all. The read is its own
        // module (`readSwarmFrame`) so that this ordering can be played through
        // a genuinely detaching harness; the inline driver drops the transfer
        // list, and under it both orders pass.
        if (readSwarmFrame(frame, tableRef.current, statesRef.current)) {
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
          animateAgentBubbleSpawn(bubble, prefersReducedMotion());
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
        return (
          <AgentBubbleView
            key={agent.id}
            agent={agent}
            positionerRef={(element) => {
              if (element) {
                elementRefs.current.set(agent.id, element);
                if (!spawnedIdsRef.current.has(agent.id)) element.style.visibility = "hidden";
              } else {
                elementRefs.current.delete(agent.id);
              }
            }}
            buttonRef={(element) => {
              if (element) bubbleRefs.current.set(agent.id, element);
              else bubbleRefs.current.delete(agent.id);
            }}
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
            // Both ends check the POINTER ID, the way `moveBody` already does.
            // Without it a second finger landing on a bubble mid-drag ended the
            // first one's grab: `dragEnd` released the spring while the first
            // pointer was still down and still capturing, leaving a bubble that
            // no longer followed anything (GT-5c).
            onPointerUp={(event) => {
              const drag = dragsRef.current.get(agent.id);
              if (!drag || drag.pointerId !== event.pointerId) return;
              moveBody(event, agent.id);
              driverRef.current?.post({ type: "dragEnd", id: agent.id });
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              // The pointer is gone but `dragged` is not: the click that
              // follows still has to know this was a drag.
              delete drag.pointerId;
            }}
            onPointerCancel={(event) => {
              const drag = dragsRef.current.get(agent.id);
              if (!drag || drag.pointerId !== event.pointerId) return;
              driverRef.current?.post({ type: "dragEnd", id: agent.id });
              delete drag.pointerId;
              // A CANCEL is not followed by a click, so the flag that exists to
              // suppress one has nothing to suppress — and left standing it
              // swallowed the user's next genuine click on this bubble instead.
              drag.dragged = false;
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
          />
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
      radius: radiusForStatus(swarm, agentBubblePresentation(agent).appearance),
    };
    if (agent.spawnHint) spec.spawnHint = agent.spawnHint;
    return spec;
  });
}
