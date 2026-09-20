/// Tunable parameters for the swarm field.
///
/// Values and names are ported verbatim from the reference
/// (`packages/views/src/views/swarm/swarm-parameters.ts`, `parametersRevision`
/// `2026-09-09` — the locked design's defaults; the STATE GLOW group of 2026-09-19) so the two surfaces share one
/// feel. Units are Matter.js units: positions in points, time in milliseconds —
/// keeping the units is what lets the constants carry over unchanged.
public struct SwarmParameters: Sendable, Equatable {
  /// Per-step pull toward the field center: `force = displacement * gravityPull`.
  public var gravityPull: Double
  /// Bounciness of bodies and walls. The shipped feel is 0 — collisions
  /// nestle, they never ring.
  public var restitution: Double
  /// Velocity bleed per 16.67 ms frame (Matter `frictionAir`). Clamped to
  /// `SwarmConstants.frictionAirCeiling` wherever it enters the physics.
  public var frictionAir: Double
  /// How often the physics steps, in Hz — decoupled from paint (GT-D15.2).
  /// The render loop interpolates between the last two solved states, so this
  /// is a cost knob and not a smoothness knob. Floored at
  /// `SwarmConstants.physicsHzFloor`.
  public var physicsHz: Double
  /// The body's fill alpha: the status bodies are composited at 72% so they
  /// stay legible glass over whatever is behind the stage.
  public var bubbleFillOpacity: Double
  /// The mounted body's light: how far it reaches (points), how bright, and
  /// how much it breathes (0 is the steady lamp).
  public var glowReach: Double
  public var glowStrength: Double
  public var glowBreath: Double
  /// Visual radii per status (points).
  public var radiusIdle: Double
  public var radiusWorking: Double
  /// The working body with the most tokens among the working sessions; the
  /// least keeps `radiusWorking`.
  public var radiusWorkingMax: Double
  /// Blocked is held at the idle size: the light says it.
  public var radiusBlocked: Double

  // ── The light a blocked or unread body gives (2026-09-18) ──────────────
  /// How much more saturated a state colour is as LIGHT than as a label. 1 is the kit's token untouched.
  public var stateChroma: Double
  /// A dark theme's ground: the fraction of the light's brightness it keeps.
  public var stateGroundDark: Double
  /// A light theme's ground: how far the light is carried toward white.
  public var stateGroundLight: Double
  /// A dark theme's glow: how far the light itself is carried toward white.
  public var stateGlowLift: Double
  /// The glow's own strength where a wave crests.
  public var stateGlowStrength: Double
  /// Where the glow begins, as a fraction of the radius.
  public var stateGlowInner: Double
  /// Where it reaches full. Near the rim, so the ramp crosses most of the body.
  public var stateGlowFull: Double
  /// Wave crests across the radius.
  public var stateWaveCount: Double
  /// Crests passing a second.
  public var stateWaveSpeed: Double
  /// How far a trough dims between crests; 0 is a steady glow.
  public var stateWaveDepth: Double

  public init(
    gravityPull: Double = 0.0002,
    restitution: Double = 0,
    frictionAir: Double = 0.2,
    physicsHz: Double = 30,
    bubbleFillOpacity: Double = 0.72,
    glowReach: Double = 34,
    glowStrength: Double = 0.8,
    glowBreath: Double = 0,
    radiusIdle: Double = 50,
    radiusWorking: Double = 60,
    radiusWorkingMax: Double = 80,
    radiusBlocked: Double = 50,
    stateChroma: Double = 1.22,
    stateGroundDark: Double = 0.5,
    stateGroundLight: Double = 0.45,
    stateGlowLift: Double = 0.55,
    stateGlowStrength: Double = 0.2,
    stateGlowInner: Double = 0.11,
    stateGlowFull: Double = 0.9,
    stateWaveCount: Double = 1.7,
    stateWaveSpeed: Double = 1.75,
    stateWaveDepth: Double = 0.72
  ) {
    self.gravityPull = gravityPull
    self.restitution = restitution
    self.frictionAir = frictionAir
    self.physicsHz = physicsHz
    self.bubbleFillOpacity = bubbleFillOpacity
    self.glowReach = glowReach
    self.glowStrength = glowStrength
    self.glowBreath = glowBreath
    self.radiusIdle = radiusIdle
    self.radiusWorking = radiusWorking
    self.radiusWorkingMax = radiusWorkingMax
    self.radiusBlocked = radiusBlocked
    self.stateChroma = stateChroma
    self.stateGroundDark = stateGroundDark
    self.stateGroundLight = stateGroundLight
    self.stateGlowLift = stateGlowLift
    self.stateGlowStrength = stateGlowStrength
    self.stateGlowInner = stateGlowInner
    self.stateGlowFull = stateGlowFull
    self.stateWaveCount = stateWaveCount
    self.stateWaveSpeed = stateWaveSpeed
    self.stateWaveDepth = stateWaveDepth
  }

  public static let `default` = SwarmParameters()

  /// The physics rate the world actually runs at: the floor is a stability
  /// limit, not a preference (see `SwarmConstants.physicsHzFloor`).
  public var effectivePhysicsHz: Double {
    physicsHz.isFinite ? max(SwarmConstants.physicsHzFloor, physicsHz) : SwarmConstants.physicsHzFloor
  }

  /// The air friction the world actually applies (see `SwarmConstants.frictionAirCeiling`).
  public var effectiveFrictionAir: Double {
    frictionAir.isFinite
      ? min(SwarmConstants.frictionAirCeiling, max(0, frictionAir)) : SwarmConstants.frictionAirCeiling
  }

  /// The step the world solves at, in milliseconds.
  public var stepMs: Double { 1000 / effectivePhysicsHz }
}

/// Fixed constants shared with the reference implementation.
public enum SwarmConstants {
  /// Gap added to the visual radius to form the collision radius.
  public static let physicalGap: Double = 4
  /// How far a chrome obstacle's body overhangs the element it stands for.
  public static let chromeObstaclePadding: Double = 7
  /// Positional spring factor of the drag constraint.
  public static let dragStiffness: Double = 0.2
  /// Extra clearance the spawn search asks for around a candidate.
  public static let spawnClearance: Double = 12
  /// Candidate count of the golden-angle spawn search.
  public static let spawnCandidates: Int = 40
  /// The golden angle, in radians.
  public static let goldenAngle: Double = .pi * (3 - 2.2360679774997896)  // π(3 − √5)
  /// Matter's default body density; mass = π·r²·density.
  public static let density: Double = 0.001
  /// Matter's per-body surface friction (tangential damping on contact).
  public static let friction: Double = 0.1
  /// Matter's baseline frame length for time-scaling `frictionAir`.
  public static let baseDeltaMS: Double = 1000.0 / 60.0
  /// Movement threshold (points) past which a pointer interaction counts as a
  /// drag rather than a tap.
  public static let dragActivationDistance: Double = 5
  /// The click nudge: a random impulse in ±0.0015 on each axis.
  public static let nudgeMagnitude: Double = 0.003

  /// The lowest physics rate that stays stable, and the reason it is a floor
  /// rather than a preference (GT-D15.2). Matter scales air friction by the
  /// step against a 60Hz base (`1 - frictionAir * (deltaTime / _baseDelta)`),
  /// which turns NEGATIVE — friction that accelerates — once the step passes
  /// `_baseDelta / frictionAir`. At the maximum air friction of 0.2 that is
  /// 83ms, about 12Hz, so 15 is the lowest rate that stays stable across the
  /// rest of the panel's own range.
  public static let physicsHzFloor: Double = 15
  /// The other half of that same inequality: the floor is only stable against
  /// a BOUNDED friction, clamped at construction and at every update.
  public static let frictionAirCeiling: Double = 0.2
  /// The most real time one pump may hand the accumulator. A backgrounded app
  /// comes back with a huge delta, and feeding it in would make the swarm
  /// teleport — or spend the next frames catching up through hundreds of
  /// steps. The backlog past this is DROPPED, not banked.
  public static let maxFrameMS: Double = 100
  /// The most steps one pump may solve; the remainder is discarded rather
  /// than allowed to spiral.
  public static let maxStepsPerFrame: Int = 5
}
