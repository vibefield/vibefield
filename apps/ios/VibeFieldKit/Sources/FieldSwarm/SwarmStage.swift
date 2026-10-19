import CoreGraphics
import FieldAgents
import FieldDesign
import Foundation
import SwarmPhysics

// The stage — the reference's `AgentSwarm.tsx` without React: what genuinely
// needs a screen or a GPU stays here (mapping touches into world coordinates,
// the models the bodies draw, the blend between the last two solved states,
// the visual-radius spring, the arrival curve, draw order, hit testing, the
// hold-to-create timer). `SwarmBodyModel` owns what a body says; `SwarmWorld`
// owns where it is; `SwarmRenderer` owns how it is painted.

public let longPressDuration = FieldMotion.longPressDuration
public let longPressMoveTolerance = Double(FieldMotion.longPressMoveTolerance)
public let spawnDuration = FieldMotion.spawnDuration
/// Critically damped: about 90% of a size change lands within 300ms.
let radiusSpringOmega = 16.0
public let gridPitch = 24.0
/// The burn rate moves on its own: models are refreshed on this cadence even
/// when nothing else changed.
let modelRefreshSeconds = 1.0

/// The arrival curve: 0 → 1.2 → 0.96 → 1.035 → 1 over 720ms.
public func arrivalCurve(elapsed: Double) -> (scale: Double, opacity: Double) {
  let t = elapsed / spawnDuration
  if t >= 1 { return (1, 1) }
  if t <= 0 { return (0, 0) }
  func outQuint(_ u: Double) -> Double { 1 - pow(1 - u, 5) }
  func outQuad(_ u: Double) -> Double { 1 - pow(1 - u, 2) }
  func inOut(_ u: Double) -> Double { u < 0.5 ? 2 * u * u : 1 - pow(-2 * u + 2, 2) / 2 }
  if t < 0.52 {
    let u = outQuint(t / 0.52)
    return (1.2 * u, u)
  }
  if t < 0.72 { return (1.2 + (0.96 - 1.2) * outQuint((t - 0.52) / 0.2), 1) }
  if t < 0.88 { return (0.96 + (1.035 - 0.96) * outQuad((t - 0.72) / 0.16), 1) }
  return (1.035 + (1 - 1.035) * inOut((t - 0.88) / 0.12), 1)
}

/// Draw order: idle under working under blocked, later arrivals on top.
func statusRank(_ status: AgentVisualStatus) -> Int {
  switch status {
  case .idle: 0
  case .working: 1
  case .blocked: 2
  }
}

/// One step of the critically damped spring the visual radius follows the
/// physics radius on. Pure, for the tests.
func springRadius(current: Double, velocity: Double, target: Double, dt: Double) -> (radius: Double, velocity: Double) {
  let displacement = current - target
  var nextVelocity = velocity + (-radiusSpringOmega * radiusSpringOmega * displacement - 2 * radiusSpringOmega * velocity) * dt
  var next = current + nextVelocity * dt
  if abs(next - target) < 0.01 && abs(nextVelocity) < 0.01 {
    next = target
    nextVelocity = 0
  }
  return (next, nextVelocity)
}

@MainActor
public final class SwarmStage {
  /// What this thread keeps about one body beyond the physics' own state.
  private struct BodyVisual {
    var visualRadius: Double
    var visualVelocity: Double
    var spawnedAt: Double
    var seed: Double
    /// Arrival order, for a stable draw order within one status.
    var arrival: Int
  }

  private struct Drag {
    let id: String
    let start: SIMD2<Double>
    var dragged: Bool
  }

  private struct Hold {
    let start: SIMD2<Double>
    let startedAt: Double
    var fired: Bool
  }

  public var parameters: SwarmParameters {
    didSet {
      world.parameters = parameters
      modelsAt = 0
    }
  }
  public private(set) var bubbles: [FieldBubble] = []
  public let world: SwarmWorld
  public var reducedMotion = false
  /// What a touch on a body means, and what a hold on empty ground raises.
  public var onSelect: (FieldBubble) -> Void = { _ in }
  /// Returns the new session's id so the field can place its body exactly
  /// under the finger, or nil when creation is unavailable.
  public var onCreate: ((SIMD2<Double>) -> String?)?
  /// The body whose accessibility element has VoiceOver focus (D-i2's §3).
  public var focusedID: String?
  /// The clock the models read (the elapsed line, the freshness); a fixture
  /// drives it.
  public var now: () -> Date = { .now }

  private var models: [String: SwarmBodyModel] = [:]
  private var modelsAt = 0.0
  private var visuals: [String: BodyVisual] = [:]
  /// When this terminal's foreground job was first seen, per row.
  private var runningSince: [String: Date] = [:]
  private var states: [String: SwarmPhysics.SwarmBodyState] = [:]
  #if DEBUG
    /// The paint's own measure, said every few seconds (`SwarmFrameMeter`).
    private var meter = SwarmFrameMeter()
  #endif
  private var previousTime: Double?
  private var arrivalCounter = 0
  private var pendingSpawns: [String: SIMD2<Double>] = [:]
  private var drag: Drag?
  private var hold: Hold?
  private(set) var order: [RenderBody] = []
  /// Every body's model, for the accessibility mirror and the card.
  public var bodyModels: [SwarmBodyModel] { order.map(\.model) }

  public init(parameters: SwarmParameters = .default, rng: some RandomNumberGenerator = SystemRandomNumberGenerator()) {
    self.parameters = parameters
    world = SwarmWorld(bounds: .zero, parameters: parameters, rng: rng)
  }

  // MARK: - The stage's facts

  public func setBounds(_ size: CGSize) {
    world.setBounds(SIMD2(Double(size.width), Double(size.height)))
  }

  /// Chrome is solid: bubbles settle around it rather than drifting under it.
  /// The rectangles arrive unpadded; how far a body stands off is a physics
  /// constant, not a layout fact.
  public func setObstacles(_ rects: [CGRect]) {
    let padding = SwarmConstants.chromeObstaclePadding
    world.obstacles = rects.map { rect in
      SwarmWorld.ObstacleRect(
        origin: SIMD2(Double(rect.minX) - padding, Double(rect.minY) - padding),
        size: SIMD2(Double(rect.width) + padding * 2, Double(rect.height) + padding * 2))
    }
  }

  /// The rows changed: refresh the running clocks, the models, and the
  /// world's membership and sizes.
  public func update(bubbles next: [FieldBubble], time: Double) {
    bubbles = next
    let nowDate = now()
    let ids = Set(next.map(\.id))
    for id in runningSince.keys where !ids.contains(id) { runningSince[id] = nil }
    for bubble in next {
      // The clock starts at the first sight of a foreground job and stops
      // when the shell goes quiet or an agent claims the terminal.
      if bubble.agent == nil && bubble.status == .working {
        if runningSince[bubble.id] == nil { runningSince[bubble.id] = nowDate }
      } else {
        runningSince[bubble.id] = nil
      }
    }
    refreshModels(time: time)
    syncWorld()
  }

  private func refreshModels(time: Double) {
    let nowDate = now()
    let shares = workingShares(bubbles)
    var next: [String: SwarmBodyModel] = [:]
    for bubble in bubbles {
      next[bubble.id] = bodyModel(
        BodyModelInput(
          bubble: bubble, parameters: parameters, now: nowDate, runningSince: runningSince[bubble.id],
          workingShare: shares[bubble.id] ?? 0))
    }
    models = next
    modelsAt = time
  }

  private func syncWorld() {
    let specs = bubbles.map { bubble in
      SwarmWorld.AgentSpec(
        id: SwarmBodyID(bubble.id),
        visualRadius: models[bubble.id]?.radius ?? parameters.radiusIdle,
        spawnPosition: pendingSpawns.removeValue(forKey: bubble.id))
    }
    if world.syncAgents(specs) {
      let living = Set(bubbles.map(\.id))
      for id in states.keys where !living.contains(id) {
        states[id] = nil
        visuals[id] = nil
        if drag?.id == id { drag = nil }
      }
      // A membership change publishes at once rather than waiting for the
      // next solved step: a new body is invisible until its first state
      // arrives, and at 30Hz that wait would be a thirtieth of a second of
      // nothing where the arrival should have started (the reference's host).
      for state in world.states { states[state.id.rawValue] = state }
    }
  }

  // MARK: - The loop

  /// Advance the physics to `time` (seconds) and fire a hold that has run
  /// its course. Called once per frame by the view.
  public func pump(time: Double) {
    let steps = world.advance(now: time)
    if steps > 0 {
      for state in world.states { states[state.id.rawValue] = state }
    }
    #if DEBUG
      if let line = meter.record(time: time, steps: steps) { print(line) }
    #endif
    if var pending = hold, !pending.fired, time - pending.startedAt >= longPressDuration {
      pending.fired = true
      hold = pending
      if let id = onCreate?(pending.start) { pendingSpawns[id] = pending.start }
      hold = nil
    }
  }

  /// The bodies as the renderer draws them at `time`, and the hold indicator.
  public func frame(time: Double, motion: Bool) -> (bodies: [RenderBody], hold: SwarmHold?) {
    let previous = previousTime ?? time
    previousTime = time
    let delta = min(1.0 / 30, max(1.0 / 120, time - previous))
    if time - modelsAt >= modelRefreshSeconds { refreshModels(time: time) }
    // The fixed step's own blend (`SwarmWorld.blend`): how far the clock has
    // run into the next step. Every frame draws the state for its own time,
    // one step behind the newest, whatever the paint's jitter.
    let alpha = world.blend
    var bodies: [RenderBody] = []
    for (id, state) in states {
      guard let model = models[id] else { continue }
      var visual = visuals[id] ?? {
        arrivalCounter += 1
        return BodyVisual(
          visualRadius: model.radius, visualVelocity: 0, spawnedAt: time,
          seed: Double.random(in: 0..<(2 * .pi)), arrival: arrivalCounter)
      }()
      // The visual radius follows the model's on a critically damped spring;
      // the physics body already jumped.
      let sprung = springRadius(
        current: visual.visualRadius, velocity: visual.visualVelocity, target: model.radius, dt: delta)
      visual.visualRadius = sprung.radius
      visual.visualVelocity = sprung.velocity
      visuals[id] = visual
      let landing = motion ? arrivalCurve(elapsed: time - visual.spawnedAt) : (scale: 1.0, opacity: 1.0)
      let position = state.previousPosition + (state.position - state.previousPosition) * alpha
      bodies.append(
        RenderBody(
          model: model, x: position.x, y: position.y, radius: visual.visualRadius,
          scale: landing.scale, opacity: landing.opacity, focus: focusedID == id, seed: visual.seed,
          accent: model.accent ?? .transparent, mounted: model.mounted))
    }
    bodies.sort { left, right in
      let rank = statusRank(left.model.appearance) - statusRank(right.model.appearance)
      if rank != 0 { return rank < 0 }
      return (visuals[left.model.id]?.arrival ?? 0) < (visuals[right.model.id]?.arrival ?? 0)
    }
    order = bodies
    let holdIndicator = hold.map {
      SwarmHold(x: $0.start.x, y: $0.start.y, progress: (time - $0.startedAt) / longPressDuration)
    }
    return (bodies, holdIndicator)
  }

  // MARK: - Touches

  /// The topmost body under the point, in draw order.
  public func hitTest(_ point: SIMD2<Double>) -> RenderBody? {
    for candidate in order.reversed() {
      let dx = point.x - candidate.x
      let dy = point.y - candidate.y
      if (dx * dx + dy * dy).squareRoot() <= candidate.radius * candidate.scale { return candidate }
    }
    return nil
  }

  private func bubble(_ id: String) -> FieldBubble? {
    bubbles.first { $0.id == id }
  }

  /// A finger came down. On a body it begins a drag; on empty ground it begins
  /// the hold that creates a terminal there.
  public func pointerDown(at point: SIMD2<Double>, time: Double) {
    hold = nil
    if let hit = hitTest(point) {
      endDrag()
      world.beginDrag(id: SwarmBodyID(hit.model.id), at: point)
      drag = Drag(id: hit.model.id, start: point, dragged: false)
      return
    }
    guard onCreate != nil else { return }
    hold = Hold(start: point, startedAt: time, fired: false)
  }

  public func pointerMoved(to point: SIMD2<Double>) {
    if var current = drag {
      let dx = point.x - current.start.x
      let dy = point.y - current.start.y
      if (dx * dx + dy * dy).squareRoot() >= SwarmConstants.dragActivationDistance { current.dragged = true }
      drag = current
      world.updateDrag(id: SwarmBodyID(current.id), to: point)
      return
    }
    if let pending = hold {
      let dx = point.x - pending.start.x
      let dy = point.y - pending.start.y
      if (dx * dx + dy * dy).squareRoot() > longPressMoveTolerance { hold = nil }
    }
  }

  public func pointerUp(at point: SIMD2<Double>) {
    if let current = drag {
      world.updateDrag(id: SwarmBodyID(current.id), to: point)
      let wasDragged = current.dragged
      let id = current.id
      endDrag()
      if !wasDragged {
        if let bubble = bubble(id) { onSelect(bubble) }
        world.nudge(id: SwarmBodyID(id))
      }
    }
    hold = nil
  }

  public func pointerCancelled() {
    endDrag()
    hold = nil
  }

  private func endDrag() {
    guard let current = drag else { return }
    world.endDrag(id: SwarmBodyID(current.id))
    drag = nil
  }

  /// VoiceOver's activate on a body's element: the same act as a tap.
  public func activate(_ id: String) {
    guard let bubble = bubble(id) else { return }
    onSelect(bubble)
    world.nudge(id: SwarmBodyID(id))
  }
}
