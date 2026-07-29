import Foundation

/// Stable identifier of a body in the field (the agent's session id).
public struct SwarmBodyID: Hashable, Sendable {
  public let rawValue: String
  public init(_ rawValue: String) { self.rawValue = rawValue }
}

/// A read-only view of one body for rendering.
public struct SwarmBodyState: Equatable, Sendable {
  public let id: SwarmBodyID
  public let position: SIMD2<Double>
  public let visualRadius: Double
  public let isDragged: Bool
}

/// The bubble-field solver.
///
/// A deliberate re-implementation of the Matter.js subset the desktop godview
/// uses (`AgentSwarm.tsx`): Verlet integration with per-frame air friction,
/// a per-body center-pull force, circle–circle and circle–bounds contacts at
/// restitution 0 (positional projection — the "nestle"), static rectangle
/// obstacles for floating chrome, a soft positional drag constraint with
/// grab-point invariance, and instant collision-radius growth so a status
/// change physically shoves neighbors (the ripple). Same constants, same
/// millisecond units, so the desktop's tuned feel carries over.
///
/// Not thread-safe by design: step it from exactly one isolation context
/// (the display-link driver in the app, the test body in tests).
public final class SwarmWorld {
  private final class Body {
    let id: SwarmBodyID
    var position: SIMD2<Double>
    var previous: SIMD2<Double>
    var force: SIMD2<Double> = .zero
    var visualRadius: Double
    var targetVisualRadius: Double
    var dragAnchor: SIMD2<Double>?
    var dragLocalOffset: SIMD2<Double> = .zero
    var dragDistance: Double = 0

    init(id: SwarmBodyID, position: SIMD2<Double>, visualRadius: Double) {
      self.id = id
      self.position = position
      self.previous = position
      self.visualRadius = visualRadius
      self.targetVisualRadius = visualRadius
    }

    var collisionRadius: Double { visualRadius + SwarmConstants.physicalGap }
    var mass: Double { .pi * collisionRadius * collisionRadius * SwarmConstants.density }
    var isDragged: Bool { dragAnchor != nil }
  }

  public var parameters: SwarmParameters
  public private(set) var bounds: SIMD2<Double>
  /// Static rectangles bodies flow around (origin = min corner). The desktop
  /// analog is the account-usage panel obstacle.
  public var obstacles: [ObstacleRect] = []

  private var bodies: [Body] = []
  private var indexByID: [SwarmBodyID: Int] = [:]
  private var rng: AnyRandomSource
  private var previousDeltaMS: Double = SwarmConstants.baseDeltaMS
  private var lastStepTime: TimeInterval?

  public struct ObstacleRect: Equatable, Sendable {
    public var origin: SIMD2<Double>
    public var size: SIMD2<Double>
    public init(origin: SIMD2<Double>, size: SIMD2<Double>) {
      self.origin = origin
      self.size = size
    }
  }

  public init(
    bounds: SIMD2<Double>,
    parameters: SwarmParameters = .default,
    rng: some RandomNumberGenerator = SystemRandomNumberGenerator()
  ) {
    self.bounds = bounds
    self.parameters = parameters
    self.rng = AnyRandomSource(rng)
  }

  // MARK: - Population

  public var states: [SwarmBodyState] {
    bodies.map {
      SwarmBodyState(
        id: $0.id, position: $0.position, visualRadius: $0.visualRadius, isDragged: $0.isDragged)
    }
  }

  public func state(of id: SwarmBodyID) -> SwarmBodyState? {
    guard let index = indexByID[id] else { return nil }
    let body = bodies[index]
    return SwarmBodyState(
      id: body.id, position: body.position, visualRadius: body.visualRadius,
      isDragged: body.isDragged)
  }

  public func contains(_ id: SwarmBodyID) -> Bool { indexByID[id] != nil }

  /// Adds the body if unknown (at `spawnPosition`, or a searched position when
  /// nil) and retargets its radius if known. Mirrors the desktop reconcile
  /// effect: existing bodies only ever have their target radius updated.
  public func upsert(id: SwarmBodyID, visualRadius: Double, spawnPosition: SIMD2<Double>? = nil) {
    if let index = indexByID[id] {
      bodies[index].targetVisualRadius = visualRadius
      return
    }
    let position: SIMD2<Double>
    if let spawnPosition {
      position = clampedSpawnPosition(spawnPosition, visualRadius: visualRadius)
    } else {
      position = searchSpawnPosition(visualRadius: visualRadius)
    }
    let body = Body(id: id, position: position, visualRadius: visualRadius)
    indexByID[id] = bodies.count
    bodies.append(body)
  }

  public func remove(id: SwarmBodyID) {
    guard let index = indexByID[id] else { return }
    bodies.remove(at: index)
    reindex()
  }

  public func setBounds(_ next: SIMD2<Double>) {
    bounds = next
  }

  // MARK: - Interaction

  /// Starts the soft drag constraint. The grab point stays under the finger
  /// (the offset from body center is captured once and preserved).
  public func beginDrag(id: SwarmBodyID, at point: SIMD2<Double>) {
    guard let index = indexByID[id] else { return }
    let body = bodies[index]
    body.dragAnchor = point
    body.dragLocalOffset = point - body.position
    body.dragDistance = 0
  }

  public func updateDrag(id: SwarmBodyID, to point: SIMD2<Double>) {
    guard let index = indexByID[id], let anchor = bodies[index].dragAnchor else { return }
    let body = bodies[index]
    body.dragDistance = max(body.dragDistance, length(point - anchor))
    body.dragAnchor = point
  }

  /// Ends the drag. Returns true when the interaction moved far enough to be
  /// a drag (suppressing the tap), mirroring the desktop `dragged` flag.
  @discardableResult
  public func endDrag(id: SwarmBodyID) -> Bool {
    guard let index = indexByID[id] else { return false }
    let body = bodies[index]
    let dragged = body.dragDistance >= SwarmConstants.dragActivationDistance
    body.dragAnchor = nil
    body.dragDistance = 0
    return dragged
  }

  /// The playful tap nudge: a small random impulse (desktop click behavior).
  public func nudge(id: SwarmBodyID) {
    guard let index = indexByID[id] else { return }
    let magnitude = SwarmConstants.nudgeMagnitude
    bodies[index].force += SIMD2(
      (Double.random(in: 0..<1, using: &rng) - 0.5) * magnitude,
      (Double.random(in: 0..<1, using: &rng) - 0.5) * magnitude)
  }

  // MARK: - Stepping

  /// Steps using a wall-clock timestamp, clamping the delta exactly like the
  /// desktop render loop (8.33…33.3 ms).
  public func step(now: TimeInterval) {
    defer { lastStepTime = now }
    guard let last = lastStepTime else { return }
    let deltaMS = min(
      SwarmConstants.maxDeltaMS, max(SwarmConstants.minDeltaMS, (now - last) * 1000))
    step(deltaMS: deltaMS)
  }

  /// Steps by an explicit delta in milliseconds (the testable entry point).
  public func step(deltaMS: Double) {
    let center = bounds / 2

    for body in bodies {
      // Instant collision-radius change; neighbors get shoved next contacts.
      if abs(body.targetVisualRadius - body.visualRadius) > 0.5 {
        body.visualRadius = body.targetVisualRadius
      }
      // Center pull, skipped while dragged (the constraint owns the body).
      if !body.isDragged {
        body.force += (center - body.position) * parameters.gravityPull
      }
    }

    integrate(deltaMS: deltaMS)
    solveDrag()
    for _ in 0..<6 { solveContacts() }
    confineToBounds()

    previousDeltaMS = deltaMS
  }

  /// Matter.js `Body.update`: velocity-Verlet with time-corrected air
  /// friction. `frictionAir` bleeds velocity per 16.67 ms baseline frame.
  private func integrate(deltaMS: Double) {
    let frictionFactor = max(
      0, 1 - parameters.frictionAir * (deltaMS / SwarmConstants.baseDeltaMS))
    let correction = deltaMS / previousDeltaMS
    let deltaSquared = deltaMS * deltaMS
    for body in bodies {
      let velocity =
        (body.position - body.previous) * correction * frictionFactor
        + (body.force / body.mass) * deltaSquared
      body.previous = body.position
      body.position += velocity
      body.force = .zero
    }
  }

  /// The soft positional spring toward the pointer (Matter constraint,
  /// stiffness 0.2). Moving `position` while leaving `previous` untouched
  /// imparts velocity, which is what makes released bubbles glide.
  private func solveDrag() {
    for body in bodies {
      guard let anchor = body.dragAnchor else { continue }
      let grabWorld = body.position + body.dragLocalOffset
      body.position += (anchor - grabWorld) * SwarmConstants.dragStiffness
    }
  }

  /// Circle–circle and circle–obstacle contacts. Restitution 0 resolves as
  /// pure positional projection split by inverse mass — the damped Verlet
  /// integration turns the correction into the soft nestle the design wants.
  private func solveContacts() {
    if bodies.count > 1 {
      for i in 0..<(bodies.count - 1) {
        for j in (i + 1)..<bodies.count {
          let a = bodies[i]
          let b = bodies[j]
          let minDistance = a.collisionRadius + b.collisionRadius
          var normal = b.position - a.position
          var distance = length(normal)
          if distance == 0 {
            normal = SIMD2(Double.random(in: -1...1, using: &rng), Double.random(in: -1...1, using: &rng))
            let n = length(normal)
            normal = n == 0 ? SIMD2(1, 0) : normal / n
            distance = 0.001
          } else {
            normal /= distance
          }
          let overlap = minDistance - distance
          guard overlap > 0 else { continue }
          let inverseMassA = a.isDragged ? 0 : 1 / a.mass
          let inverseMassB = b.isDragged ? 0 : 1 / b.mass
          let totalInverse = inverseMassA + inverseMassB
          guard totalInverse > 0 else { continue }
          a.position -= normal * (overlap * (inverseMassA / totalInverse))
          b.position += normal * (overlap * (inverseMassB / totalInverse))
        }
      }
    }

    for body in bodies {
      for obstacle in obstacles {
        let minCorner = obstacle.origin
        let maxCorner = obstacle.origin + obstacle.size
        let closest = SIMD2(
          min(max(body.position.x, minCorner.x), maxCorner.x),
          min(max(body.position.y, minCorner.y), maxCorner.y))
        var away = body.position - closest
        var distance = length(away)
        if distance == 0 {
          // Center inside the rect: exit through the nearest face.
          let leftGap = body.position.x - minCorner.x
          let rightGap = maxCorner.x - body.position.x
          let topGap = body.position.y - minCorner.y
          let bottomGap = maxCorner.y - body.position.y
          let smallest = min(leftGap, rightGap, topGap, bottomGap)
          if smallest == leftGap { away = SIMD2(-1, 0) } else if smallest == rightGap {
            away = SIMD2(1, 0)
          } else if smallest == topGap { away = SIMD2(0, -1) } else { away = SIMD2(0, 1) }
          distance = 0.001
        } else {
          away /= distance
        }
        let overlap = body.collisionRadius - distance
        guard overlap > 0 else { continue }
        body.position += away * overlap
        reflectVelocity(of: body, along: away)
      }
    }
  }

  /// The screen edges are the walls. Clamping plus a restitution-scaled
  /// velocity reflection reproduces the static wall bodies of the desktop
  /// (whose restitution follows the same parameter).
  private func confineToBounds() {
    for body in bodies {
      let radius = body.collisionRadius
      let maxX = max(radius, bounds.x - radius)
      let maxY = max(radius, bounds.y - radius)
      if body.position.x < radius {
        body.position.x = radius
        reflectVelocity(of: body, along: SIMD2(1, 0))
      } else if body.position.x > maxX {
        body.position.x = maxX
        reflectVelocity(of: body, along: SIMD2(-1, 0))
      }
      if body.position.y < radius {
        body.position.y = radius
        reflectVelocity(of: body, along: SIMD2(0, 1))
      } else if body.position.y > maxY {
        body.position.y = maxY
        reflectVelocity(of: body, along: SIMD2(0, -1))
      }
    }
  }

  /// Removes (restitution 0) or reflects (restitution > 0) the velocity
  /// component moving into a contact normal, by rewriting `previous`.
  private func reflectVelocity(of body: Body, along normal: SIMD2<Double>) {
    let velocity = body.position - body.previous
    let approach = dot(velocity, -normal)
    guard approach > 0 else { return }
    let tangent = velocity + normal * approach
    let damped = tangent * (1 - SwarmConstants.friction)
    let bounce = normal * (approach * parameters.restitution)
    body.previous = body.position - (damped + bounce)
  }

  // MARK: - Spawn placement (desktop `findSpawnPosition`, verbatim mechanics)

  /// Golden-angle candidate search: the first body lands center; later ones
  /// take the first candidate with clearance, else the best found.
  public func searchSpawnPosition(visualRadius: Double) -> SIMD2<Double> {
    let center = bounds / 2
    if bodies.isEmpty { return center }

    let collisionRadius = visualRadius + SwarmConstants.physicalGap
    let horizontalReach = max(
      0,
      min(bounds.x * 0.28, bounds.x / 2 - collisionRadius - SwarmConstants.spawnClearance))
    let verticalReach = max(
      0,
      min(bounds.y * 0.28, bounds.y / 2 - collisionRadius - SwarmConstants.spawnClearance))
    let phase = Double.random(in: 0..<(2 * .pi), using: &rng)
    var bestPosition = center
    var bestClearance = -Double.infinity

    for index in 0..<SwarmConstants.spawnCandidates {
      let progress =
        index == 0 ? 0 : (Double(index) / Double(SwarmConstants.spawnCandidates - 1)).squareRoot()
      let angle = phase + Double(index) * SwarmConstants.goldenAngle
      let candidate = SIMD2(
        center.x + cos(angle) * horizontalReach * progress,
        center.y + sin(angle) * verticalReach * progress)
      var clearance = Double.infinity
      for body in bodies {
        let distance = length(candidate - body.position)
        clearance = min(
          clearance,
          distance
            - (collisionRadius + body.visualRadius + SwarmConstants.physicalGap
              + SwarmConstants.spawnClearance))
      }
      if clearance > bestClearance {
        bestPosition = candidate
        bestClearance = clearance
      }
      if clearance >= 0 { return candidate }
    }

    return bestPosition
  }

  /// Keeps an explicit spawn point inside the walls (desktop `clampSpawnPosition`).
  public func clampedSpawnPosition(_ position: SIMD2<Double>, visualRadius: Double)
    -> SIMD2<Double>
  {
    let margin = visualRadius + SwarmConstants.physicalGap
    return SIMD2(
      min(max(position.x, margin), max(margin, bounds.x - margin)),
      min(max(position.y, margin), max(margin, bounds.y - margin)))
  }

  private func reindex() {
    indexByID = [:]
    for (index, body) in bodies.enumerated() {
      indexByID[body.id] = index
    }
  }
}

private func length(_ v: SIMD2<Double>) -> Double { (v.x * v.x + v.y * v.y).squareRoot() }
private func dot(_ a: SIMD2<Double>, _ b: SIMD2<Double>) -> Double { a.x * b.x + a.y * b.y }
