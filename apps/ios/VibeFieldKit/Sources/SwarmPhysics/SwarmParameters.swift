/// Tunable parameters for the swarm field.
///
/// Values and names are ported verbatim from the desktop godview
/// (`apps/godview/src/renderer/swarm-parameters.ts`) so the two surfaces share
/// one feel. Units are Matter.js units: positions in points, time in
/// milliseconds — keeping the units is what lets the constants carry over
/// unchanged.
public struct SwarmParameters: Sendable, Equatable {
  /// Per-frame pull toward the field center: `force = displacement * gravityPull`.
  public var gravityPull: Double
  /// Bounciness of bodies and walls. The shipped feel is 0 — collisions
  /// nestle, they never ring.
  public var restitution: Double
  /// Velocity bleed per 16.67 ms frame (Matter `frictionAir`).
  public var frictionAir: Double
  /// Visual radii per appearance tier (points).
  public var radiusIdle: Double
  public var radiusWorking: Double
  public var radiusWaiting: Double

  public init(
    gravityPull: Double = 0.0002,
    restitution: Double = 0,
    frictionAir: Double = 0.2,
    radiusIdle: Double = 40,
    radiusWorking: Double = 50,
    radiusWaiting: Double = 70
  ) {
    self.gravityPull = gravityPull
    self.restitution = restitution
    self.frictionAir = frictionAir
    self.radiusIdle = radiusIdle
    self.radiusWorking = radiusWorking
    self.radiusWaiting = radiusWaiting
  }

  public static let `default` = SwarmParameters()
}

/// Fixed constants shared with the desktop implementation.
public enum SwarmConstants {
  /// Gap added to the visual radius to form the collision radius.
  public static let physicalGap: Double = 4
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
  /// Frame delta clamp, milliseconds (the desktop render loop's bounds).
  public static let minDeltaMS: Double = 1000.0 / 120.0
  public static let maxDeltaMS: Double = 1000.0 / 30.0
  /// Matter's baseline frame length for time-scaling `frictionAir`.
  public static let baseDeltaMS: Double = 1000.0 / 60.0
  /// Movement threshold (points) past which a pointer interaction counts as a
  /// drag rather than a tap.
  public static let dragActivationDistance: Double = 5
  /// The click nudge: a random impulse in ±0.0015 on each axis.
  public static let nudgeMagnitude: Double = 0.003
}
