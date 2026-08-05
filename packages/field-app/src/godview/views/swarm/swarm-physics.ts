import Matter from "matter-js";

// THE SWARM'S PHYSICS, with no view attached (GT-3c, GT-D16).
//
// Everything here used to live inside AgentSwarm.tsx's mount effect. It is the
// same engine, the same forces, the same geometry and the same fixed-timestep
// schedule — what changed is that none of it can see a document any more. There
// is no element, no ResizeObserver, no rAF and no style write in this file, and
// that absence is the whole point: a module that cannot touch the DOM is a
// module that can be hosted in a worker (GT-3m finding 1 established that matter
// itself is pure JS; this establishes that our USE of it is too).
//
// The main thread keeps what it must keep — observing chrome elements, mapping
// pointers to world coordinates, and writing the bubbles — and hands this class
// rectangles and points instead of nodes.
//
// It is deliberately a plain class rather than a message handler: the protocol
// lives one file over, so a test can drive the physics directly with no worker,
// no ports and no ping-pong in the way.

/**
 * The lowest physics rate that stays stable, and the reason it is a floor rather
 * than a preference (GT-D15.2).
 *
 * Matter 0.19 scales air friction by the step against a 60Hz base
 * (`1 - frictionAir * (deltaTime / _baseDelta)`, Body.js:744), which turns
 * NEGATIVE — friction that accelerates — once the step passes
 * `_baseDelta / frictionAir`. At the swarm panel's maximum air friction of 0.2
 * that is 83ms, about 12Hz, so 15 is the lowest rate that stays stable across
 * the rest of the panel's own range.
 *
 * The lab clamps to this and so does the physics, on purpose: the knob is one
 * caller, and a law that only one side enforces is a law that a second caller
 * breaks. Nothing clamps the CEILING here — a high rate costs, it does not
 * destabilise.
 */
export const PHYSICS_HZ_FLOOR = 15;

/** Space between a bubble's drawn edge and its collision edge. */
const PHYSICAL_GAP = 4;
/** How far a chrome obstacle's body overhangs the element it stands for. */
const CHROME_OBSTACLE_PADDING = 7;
const DRAG_STIFFNESS = 0.2;
const WALL_THICKNESS = 5000;
const SPAWN_CLEARANCE = 12;
const SPAWN_CANDIDATES = 40;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** The nudge a click gives a bubble, so selecting one is visible in the field. */
const CLICK_NUDGE = 0.003;

/** The most real time one frame may hand the accumulator. A tab that was hidden
 * or a machine that stalled comes back with a huge delta, and feeding it in
 * would make the swarm teleport — or, worse, spend the next frames catching up
 * through hundreds of steps. The backlog past this is DROPPED, not banked. */
const MAX_FRAME_MS = 100;
/** The most steps one pump may solve. The second half of the same guard: if a
 * pump is somehow still behind after this many steps, the remainder is discarded
 * rather than allowed to spiral. */
const MAX_STEPS_PER_FRAME = 5;

export interface SwarmPhysicsParameters {
  gravityPull: number;
  restitution: number;
  frictionAir: number;
  physicsHz: number;
}

/** An agent as the physics knows it: an identity, a size to grow toward, and
 * optionally where the gesture that created it happened. */
export interface SwarmAgentSpec {
  id: string;
  radius: number;
  spawnHint?: { x: number; y: number };
}

export interface SwarmBounds {
  width: number;
  height: number;
}

/**
 * A piece of shell chrome, in container coordinates, UNPADDED.
 *
 * The main thread measures elements because only it can; it sends the raw
 * rectangle and the physics adds its own padding, because how far a bubble
 * should stand off the mock label is a physics constant and not a layout fact.
 */
export interface SwarmObstacleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SwarmPoint {
  x: number;
  y: number;
}

/** Frame buffer layout: two header floats, then `x, y, radius` per body in
 * id-table order. Flat and fixed so the receiver reads it with arithmetic
 * instead of a parse. */
export const FRAME_HEADER_FLOATS = 2;
export const FRAME_STRIDE = 3;
export const FRAME_GENERATION_INDEX = 0;
export const FRAME_COUNT_INDEX = 1;

export function frameFloatsFor(bodies: number): number {
  return FRAME_HEADER_FLOATS + bodies * FRAME_STRIDE;
}

interface PhysicsBody {
  body: Matter.Body;
  currentRadius: number;
  targetRadius: number;
  dragConstraint?: Matter.Constraint;
}

export interface SwarmPhysicsInit {
  parameters: SwarmPhysicsParameters;
  bounds: SwarmBounds;
  obstacles?: readonly SwarmObstacleRect[];
  agents?: readonly SwarmAgentSpec[];
  /** Injected so a fixture can place spawns and nudges deterministically. */
  random?: () => number;
}

function clampHz(hz: number): number {
  return Number.isFinite(hz) ? Math.max(PHYSICS_HZ_FLOOR, hz) : PHYSICS_HZ_FLOOR;
}

function clampSpawnPosition(
  width: number,
  height: number,
  radius: number,
  position: SwarmPoint,
): SwarmPoint {
  const margin = radius + PHYSICAL_GAP;
  return {
    x: Math.min(Math.max(position.x, margin), Math.max(margin, width - margin)),
    y: Math.min(Math.max(position.y, margin), Math.max(margin, height - margin)),
  };
}

export class SwarmPhysics {
  private readonly engine: Matter.Engine;
  private readonly walls: [Matter.Body, Matter.Body, Matter.Body, Matter.Body];
  private obstacles: { body: Matter.Body; width: number; height: number }[] = [];
  private readonly bodies = new Map<string, PhysicsBody>();
  /** Index → id, the order every frame buffer is written in. */
  private order: readonly string[] = [];
  private tableGeneration = 0;
  private parameters: SwarmPhysicsParameters;
  private width: number;
  private height: number;
  private accumulator = 0;
  private previousTime: number | null = null;
  private readonly random: () => number;

  constructor(init: SwarmPhysicsInit) {
    this.parameters = { ...init.parameters, physicsHz: clampHz(init.parameters.physicsHz) };
    this.width = init.bounds.width;
    this.height = init.bounds.height;
    this.random = init.random ?? Math.random;

    this.engine = Matter.Engine.create();
    this.engine.gravity.x = 0;
    this.engine.gravity.y = 0;

    const wallOptions = { isStatic: true, restitution: this.parameters.restitution };
    this.walls = [
      Matter.Bodies.rectangle(0, 0, 10000, WALL_THICKNESS, wallOptions),
      Matter.Bodies.rectangle(0, 0, 10000, WALL_THICKNESS, wallOptions),
      Matter.Bodies.rectangle(0, 0, WALL_THICKNESS, 10000, wallOptions),
      Matter.Bodies.rectangle(0, 0, WALL_THICKNESS, 10000, wallOptions),
    ];
    Matter.Composite.add(this.engine.world, [...this.walls]);
    this.placeWalls();

    if (init.obstacles) this.setObstacles(init.obstacles);
    if (init.agents) this.syncAgents(init.agents);
  }

  /** The id-table the next frame's indices are addressed by. */
  get generation(): number {
    return this.tableGeneration;
  }

  ids(): readonly string[] {
    return this.order;
  }

  get stepMs(): number {
    return 1000 / this.parameters.physicsHz;
  }

  /**
   * Seed the clock without solving anything.
   *
   * The first pump has no previous timestamp to subtract from, and inventing one
   * would either drop that interval or bank a huge one. The host seeds this the
   * moment it builds the physics, so the first real pump measures from birth.
   */
  seed(now: number): void {
    this.previousTime = now;
  }

  setParameters(next: SwarmPhysicsParameters): void {
    this.parameters = { ...next, physicsHz: clampHz(next.physicsHz) };
    for (const wrapper of this.bodies.values()) {
      wrapper.body.restitution = this.parameters.restitution;
      wrapper.body.frictionAir = this.parameters.frictionAir;
    }
    for (const wall of this.walls) wall.restitution = this.parameters.restitution;
    for (const obstacle of this.obstacles) obstacle.body.restitution = this.parameters.restitution;
  }

  setBounds(bounds: SwarmBounds): void {
    this.width = bounds.width;
    this.height = bounds.height;
    this.placeWalls();
  }

  private placeWalls(): void {
    const [bottom, top, left, right] = this.walls;
    Matter.Body.setPosition(bottom, {
      x: this.width / 2,
      y: this.height + WALL_THICKNESS / 2,
    });
    Matter.Body.setPosition(top, { x: this.width / 2, y: -WALL_THICKNESS / 2 });
    Matter.Body.setPosition(left, { x: -WALL_THICKNESS / 2, y: this.height / 2 });
    Matter.Body.setPosition(right, {
      x: this.width + WALL_THICKNESS / 2,
      y: this.height / 2,
    });
  }

  /**
   * Chrome is solid: bubbles settle around the mock label rather than drifting
   * under it. The count is stable for a mounted stage — the same elements are
   * re-measured on every resize — so a changed count rebuilds rather than
   * pretending the old bodies still stand for something.
   */
  setObstacles(rects: readonly SwarmObstacleRect[]): void {
    if (rects.length !== this.obstacles.length) {
      for (const obstacle of this.obstacles) {
        Matter.Composite.remove(this.engine.world, obstacle.body);
      }
      this.obstacles = rects.map((rect) => {
        const width = Math.max(1, rect.width + CHROME_OBSTACLE_PADDING * 2);
        const height = Math.max(1, rect.height + CHROME_OBSTACLE_PADDING * 2);
        const body = Matter.Bodies.rectangle(0, 0, width, height, {
          isStatic: true,
          restitution: this.parameters.restitution,
        });
        Matter.Composite.add(this.engine.world, body);
        return { body, width, height };
      });
    }
    rects.forEach((rect, index) => {
      const obstacle = this.obstacles[index];
      if (!obstacle) return;
      const width = Math.max(1, rect.width + CHROME_OBSTACLE_PADDING * 2);
      const height = Math.max(1, rect.height + CHROME_OBSTACLE_PADDING * 2);
      Matter.Body.scale(obstacle.body, width / obstacle.width, height / obstacle.height);
      obstacle.width = width;
      obstacle.height = height;
      Matter.Body.setPosition(obstacle.body, {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      });
    });
  }

  /**
   * Bring the body set in line with the agents the stage is showing.
   *
   * Returns whether MEMBERSHIP changed — which is the receiver's cue that the
   * index→id table it has been reading frames with is stale. A radius change is
   * not membership: the frame carries the radius, so nothing above needs telling.
   */
  syncAgents(specs: readonly SwarmAgentSpec[]): boolean {
    const wanted = new Set(specs.map((spec) => spec.id));
    let changed = false;

    for (const [id, wrapper] of this.bodies) {
      if (wanted.has(id)) continue;
      this.releaseDrag(wrapper);
      Matter.Composite.remove(this.engine.world, wrapper.body);
      this.bodies.delete(id);
      changed = true;
    }

    for (const spec of specs) {
      const existing = this.bodies.get(spec.id);
      if (existing) {
        existing.targetRadius = spec.radius;
        continue;
      }
      // The arena a spawn is placed in has a floor, because a stage measured
      // mid-layout can report nothing and a spawn search in a zero-sized box
      // returns the same point for every bubble.
      const width = Math.max(this.width, 320);
      const height = Math.max(this.height, 180);
      const position = spec.spawnHint
        ? clampSpawnPosition(width, height, spec.radius, spec.spawnHint)
        : this.findSpawnPosition(width, height, spec.radius);
      const body = Matter.Bodies.circle(position.x, position.y, spec.radius + PHYSICAL_GAP, {
        restitution: this.parameters.restitution,
        frictionAir: this.parameters.frictionAir,
        friction: 0.1,
      });
      this.bodies.set(spec.id, {
        body,
        currentRadius: spec.radius,
        targetRadius: spec.radius,
      });
      Matter.Composite.add(this.engine.world, body);
      changed = true;
    }

    if (changed) {
      this.order = [...this.bodies.keys()];
      this.tableGeneration += 1;
    }
    return changed;
  }

  private findSpawnPosition(width: number, height: number, radius: number): SwarmPoint {
    const wrappers = [...this.bodies.values()];
    const center = { x: width / 2, y: height / 2 };
    if (wrappers.length === 0) return center;

    const collisionRadius = radius + PHYSICAL_GAP;
    const horizontalReach = Math.max(
      0,
      Math.min(width * 0.28, width / 2 - collisionRadius - SPAWN_CLEARANCE),
    );
    const verticalReach = Math.max(
      0,
      Math.min(height * 0.28, height / 2 - collisionRadius - SPAWN_CLEARANCE),
    );
    const phase = this.random() * Math.PI * 2;
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
      for (const wrapper of wrappers) {
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

  /**
   * Advance real time and solve whatever whole steps it bought. Returns the
   * number solved, which is the caller's cue that there is a new state worth
   * publishing — a pump that solved nothing has nothing new to say.
   */
  advance(now: number): number {
    if (this.previousTime === null) {
      this.previousTime = now;
      return 0;
    }
    const stepMs = this.stepMs;
    // Real elapsed time, clamped. The clamp is a guard against stalls, not a
    // smoothing pass: within a normal pump the full delta goes in.
    this.accumulator += Math.min(MAX_FRAME_MS, Math.max(0, now - this.previousTime));
    this.previousTime = now;

    let steps = 0;
    while (this.accumulator >= stepMs && steps < MAX_STEPS_PER_FRAME) {
      this.step(stepMs);
      this.accumulator -= stepMs;
      steps += 1;
    }
    // Behind after the step cap: drop the debt. Banking it guarantees the next
    // pump is late too.
    if (steps === MAX_STEPS_PER_FRAME && this.accumulator > stepMs) this.accumulator = 0;
    return steps;
  }

  private step(stepMs: number): void {
    const { gravityPull } = this.parameters;
    for (const wrapper of this.bodies.values()) {
      const { body } = wrapper;
      if (!wrapper.dragConstraint) {
        Matter.Body.applyForce(body, body.position, {
          x: (this.width / 2 - body.position.x) * gravityPull,
          y: (this.height / 2 - body.position.y) * gravityPull,
        });
      }
      if (Math.abs(wrapper.targetRadius - wrapper.currentRadius) > 0.5) {
        const scale =
          (wrapper.targetRadius + PHYSICAL_GAP) / (wrapper.currentRadius + PHYSICAL_GAP);
        Matter.Body.scale(body, scale, scale);
        wrapper.currentRadius = wrapper.targetRadius;
      }
    }
    // Forces are per-step by Matter's own contract — it clears them at the end
    // of every update — so applying them inside this loop rather than once per
    // pump is what keeps the drift the same strength at any Hz.
    Matter.Engine.update(this.engine, stepMs);
  }

  /** Write the current state into `target` in id-table order. */
  writeFrame(target: Float32Array): void {
    target[FRAME_GENERATION_INDEX] = this.tableGeneration;
    target[FRAME_COUNT_INDEX] = this.order.length;
    let offset = FRAME_HEADER_FLOATS;
    for (const id of this.order) {
      const wrapper = this.bodies.get(id);
      if (!wrapper) continue;
      target[offset] = wrapper.body.position.x;
      target[offset + 1] = wrapper.body.position.y;
      target[offset + 2] = wrapper.currentRadius;
      offset += FRAME_STRIDE;
    }
  }

  /**
   * Grab a bubble. `pointB` is the vector from the body's centre to the grab
   * point, so the bubble keeps the offset it was grabbed at instead of snapping
   * its centre to the cursor.
   */
  dragStart(id: string, point: SwarmPoint): void {
    const wrapper = this.bodies.get(id);
    if (!wrapper) return;
    this.releaseDrag(wrapper);
    wrapper.dragConstraint = Matter.Constraint.create({
      pointA: { x: point.x, y: point.y },
      bodyB: wrapper.body,
      pointB: { x: point.x - wrapper.body.position.x, y: point.y - wrapper.body.position.y },
      stiffness: DRAG_STIFFNESS,
      render: { visible: false },
    });
    Matter.Composite.add(this.engine.world, wrapper.dragConstraint);
  }

  dragMove(id: string, point: SwarmPoint): void {
    const constraint = this.bodies.get(id)?.dragConstraint;
    if (!constraint) return;
    constraint.pointA.x = point.x;
    constraint.pointA.y = point.y;
  }

  dragEnd(id: string): void {
    const wrapper = this.bodies.get(id);
    if (wrapper) this.releaseDrag(wrapper);
  }

  /** Whether this body is currently on a spring. Fixtures assert on it; the
   * simulation reads it to know which bodies gravity may not touch. */
  isDragging(id: string): boolean {
    return this.bodies.get(id)?.dragConstraint !== undefined;
  }

  private releaseDrag(wrapper: PhysicsBody): void {
    if (!wrapper.dragConstraint) return;
    Matter.Composite.remove(this.engine.world, wrapper.dragConstraint);
    delete wrapper.dragConstraint;
  }

  /** The small shove a selected bubble gets, so a click is visible in the field. */
  nudge(id: string): void {
    const wrapper = this.bodies.get(id);
    if (!wrapper) return;
    Matter.Body.applyForce(wrapper.body, wrapper.body.position, {
      x: (this.random() - 0.5) * CLICK_NUDGE,
      y: (this.random() - 0.5) * CLICK_NUDGE,
    });
  }

  /**
   * Which bubble is under a point, or null.
   *
   * The DOM view never calls this — its bubbles are real elements and the
   * browser does its own hit-testing. It is here for the renderer that replaces
   * them (GT-D16), where a canvas has nothing to hit. The LAST match in table
   * order wins, because that is the one drawn on top.
   */
  queryPoint(point: SwarmPoint): string | null {
    let hit: string | null = null;
    for (const id of this.order) {
      const wrapper = this.bodies.get(id);
      if (!wrapper) continue;
      const distance = Math.hypot(
        point.x - wrapper.body.position.x,
        point.y - wrapper.body.position.y,
      );
      if (distance <= wrapper.currentRadius + PHYSICAL_GAP) hit = id;
    }
    return hit;
  }

  dispose(): void {
    for (const wrapper of this.bodies.values()) this.releaseDrag(wrapper);
    this.bodies.clear();
    this.obstacles = [];
    this.order = [];
    Matter.Engine.clear(this.engine);
    Matter.Composite.clear(this.engine.world, false, true);
  }
}
