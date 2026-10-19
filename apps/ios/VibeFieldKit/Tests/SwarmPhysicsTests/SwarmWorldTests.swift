import Foundation
import Testing

@testable import SwarmPhysics

/// Steps `world` as the display link would: 60 Hz frames.
private func settle(_ world: SwarmWorld, frames: Int) {
  for _ in 0..<frames {
    world.step(deltaMS: 1000.0 / 60.0)
  }
}

@Suite struct SwarmWorldTests {
  private func makeWorld(seed: UInt64 = 7) -> SwarmWorld {
    SwarmWorld(
      bounds: SIMD2(400, 800), parameters: .default, rng: SplitMix64(seed: seed))
  }

  @Test func firstBodySpawnsAtCenter() {
    let world = makeWorld()
    world.upsert(id: SwarmBodyID("a"), visualRadius: 50)
    let state = world.state(of: SwarmBodyID("a"))
    #expect(state?.position == SIMD2(200, 400))
  }

  @Test func fleetSettlesWithoutOverlapInsideBounds() {
    let world = makeWorld()
    let radii: [Double] = [40, 50, 70, 50, 40, 50, 70, 40]
    for (index, radius) in radii.enumerated() {
      world.upsert(id: SwarmBodyID("agent-\(index)"), visualRadius: radius)
    }
    settle(world, frames: 600)

    let states = world.states
    #expect(states.count == radii.count)
    let slop = 0.75
    for i in 0..<states.count {
      for j in (i + 1)..<states.count {
        let a = states[i]
        let b = states[j]
        let delta = a.position - b.position
        let distance = (delta.x * delta.x + delta.y * delta.y).squareRoot()
        let minimum =
          a.visualRadius + b.visualRadius + 2 * SwarmConstants.physicalGap - slop
        #expect(
          distance >= minimum,
          "bodies \(a.id.rawValue)/\(b.id.rawValue) overlap: \(distance) < \(minimum)")
      }
      let radius = states[i].visualRadius + SwarmConstants.physicalGap
      #expect(states[i].position.x >= radius - slop)
      #expect(states[i].position.x <= world.bounds.x - radius + slop)
      #expect(states[i].position.y >= radius - slop)
      #expect(states[i].position.y <= world.bounds.y - radius + slop)
    }
  }

  @Test func centerPullDrawsLoneBodyInward() {
    let world = makeWorld()
    world.upsert(id: SwarmBodyID("far"), visualRadius: 40, spawnPosition: SIMD2(60, 60))
    let center = world.bounds / 2
    let before = world.state(of: SwarmBodyID("far"))!.position
    settle(world, frames: 240)
    let after = world.state(of: SwarmBodyID("far"))!.position
    func distanceToCenter(_ p: SIMD2<Double>) -> Double {
      let d = p - center
      return (d.x * d.x + d.y * d.y).squareRoot()
    }
    #expect(distanceToCenter(after) < distanceToCenter(before) - 20)
  }

  @Test func radiusGrowthShovesNeighborAside() {
    let world = makeWorld()
    world.upsert(id: SwarmBodyID("left"), visualRadius: 50)
    world.upsert(id: SwarmBodyID("right"), visualRadius: 50)
    settle(world, frames: 300)
    let neighborBefore = world.state(of: SwarmBodyID("right"))!.position

    // The permission wall: the left agent grows to the waiting tier.
    world.upsert(id: SwarmBodyID("left"), visualRadius: 70)
    settle(world, frames: 300)

    let grown = world.state(of: SwarmBodyID("left"))!
    let neighbor = world.state(of: SwarmBodyID("right"))!
    #expect(grown.visualRadius == 70)
    let delta = grown.position - neighbor.position
    let distance = (delta.x * delta.x + delta.y * delta.y).squareRoot()
    let minimum = 70.0 + 50.0 + 2 * SwarmConstants.physicalGap - 0.75
    #expect(distance >= minimum)
    #expect(neighbor.position != neighborBefore)
  }

  @Test func spawnSearchClearsExistingBodies() {
    let world = makeWorld()
    world.upsert(id: SwarmBodyID("resident"), visualRadius: 70)
    let position = world.searchSpawnPosition(visualRadius: 40)
    let resident = world.state(of: SwarmBodyID("resident"))!.position
    let delta = position - resident
    let distance = (delta.x * delta.x + delta.y * delta.y).squareRoot()
    #expect(distance >= 40 + 70 + 2 * SwarmConstants.physicalGap)
  }

  @Test func dragConstraintCarriesTheGrabPoint() {
    let world = makeWorld()
    world.upsert(id: SwarmBodyID("held"), visualRadius: 50)
    let start = world.state(of: SwarmBodyID("held"))!.position
    // Grab off-center: 20 pt right of the body center.
    let grab = start + SIMD2(20, 0)
    world.beginDrag(id: SwarmBodyID("held"), at: grab)
    let target = grab + SIMD2(120, -60)
    world.updateDrag(id: SwarmBodyID("held"), to: target)
    settle(world, frames: 120)

    let held = world.state(of: SwarmBodyID("held"))!
    #expect(held.isDragged)
    // The grab point (center + 20,0) converges onto the anchor.
    let grabWorld = held.position + SIMD2(20, 0)
    let miss = grabWorld - target
    let error = (miss.x * miss.x + miss.y * miss.y).squareRoot()
    #expect(error < 2, "grab point missed the finger by \(error) pt")
    #expect(world.endDrag(id: SwarmBodyID("held")))
  }

  @Test func tapBelowThresholdIsNotADrag() {
    let world = makeWorld()
    world.upsert(id: SwarmBodyID("tapped"), visualRadius: 50)
    let position = world.state(of: SwarmBodyID("tapped"))!.position
    world.beginDrag(id: SwarmBodyID("tapped"), at: position)
    world.updateDrag(id: SwarmBodyID("tapped"), to: position + SIMD2(2, 2))
    #expect(world.endDrag(id: SwarmBodyID("tapped")) == false)
  }

  @Test func identicalSeedsProduceIdenticalFields() {
    func run() -> [SIMD2<Double>] {
      let world = makeWorld(seed: 99)
      for index in 0..<6 {
        world.upsert(id: SwarmBodyID("agent-\(index)"), visualRadius: index % 2 == 0 ? 40 : 70)
      }
      for id in ["agent-1", "agent-4"] { world.nudge(id: SwarmBodyID(id)) }
      settle(world, frames: 240)
      return world.states.map(\.position)
    }
    #expect(run() == run())
  }

  @Test func shrinkingBoundsKeepsBodiesInside() {
    let world = makeWorld()
    for index in 0..<4 {
      world.upsert(id: SwarmBodyID("agent-\(index)"), visualRadius: 50)
    }
    settle(world, frames: 120)
    world.setBounds(SIMD2(240, 320))
    settle(world, frames: 240)
    for state in world.states {
      let radius = state.visualRadius + SwarmConstants.physicalGap
      #expect(state.position.x >= radius - 0.75)
      #expect(state.position.x <= 240 - radius + 0.75)
      #expect(state.position.y >= radius - 0.75)
      #expect(state.position.y <= 320 - radius + 0.75)
    }
  }
}

// MARK: - The reference's `physics/world.test.ts`, transcribed (IOS-6b)

/// The reference's arena: 800 × 400, two bodies of 50, a seeded generator.
private func arena(
  physicsHz: Double = 30, gravityPull: Double = 0.0002, frictionAir: Double = 0.2,
  agents: [SwarmWorld.AgentSpec] = [
    SwarmWorld.AgentSpec(id: SwarmBodyID("a"), visualRadius: 50),
    SwarmWorld.AgentSpec(id: SwarmBodyID("b"), visualRadius: 50),
  ]
) -> SwarmWorld {
  let world = SwarmWorld(
    bounds: SIMD2(800, 400),
    parameters: SwarmParameters(gravityPull: gravityPull, frictionAir: frictionAir, physicsHz: physicsHz),
    rng: SplitMix64(seed: 7))
  world.syncAgents(agents)
  return world
}

/// Drive `frames` pumps of `deltaMs` each, from a seeded clock.
private func drive(_ world: SwarmWorld, frames: Int, deltaMs: Double) -> Int {
  var now: TimeInterval = 0
  world.seed(now: now)
  var steps = 0
  for _ in 0..<frames {
    now += deltaMs / 1000
    steps += world.advance(now: now)
  }
  return steps
}

/// Let an already-seeded world run on for `frames` frames at 30Hz.
private func settlePumps(_ world: SwarmWorld, frames: Int) {
  var now: TimeInterval = 0
  for _ in 0..<frames {
    now += 1.0 / 30
    world.advance(now: now)
  }
}

private func position(_ world: SwarmWorld, _ id: String) -> SIMD2<Double> {
  world.state(of: SwarmBodyID(id))!.position
}

@Suite struct FixedTimestepTests {
  @Test func stepsAtPhysicsHzRatherThanOncePerPump() {
    // Twelve pumps × 10ms = 120ms of real time. At 25Hz that is three steps,
    // not twelve — the decoupling, stated as a number.
    #expect(drive(arena(physicsHz: 25), frames: 12, deltaMs: 10) == 3)
  }

  @Test func tracksTheRateTheSameWallClockAt50HzSolvesTwiceAsOften() {
    #expect(drive(arena(physicsHz: 50), frames: 12, deltaMs: 10) == 6)
  }

  @Test func capsCatchUpAfterAStallInsteadOfSpirallingThroughTheBacklog() {
    // A two-second stall — a backgrounded app. Unbounded this would be 120
    // steps in one pump and every pump after it late.
    #expect(drive(arena(physicsHz: 60), frames: 1, deltaMs: 2_000) <= 5)
  }

  @Test func solvesNothingOnItsVeryFirstPumpBecauseItHasNothingToMeasureFrom() {
    let world = arena(physicsHz: 25)
    #expect(world.advance(now: 1.0) == 0)
    #expect(world.advance(now: 1.04) == 1)
  }

  @Test func clampsARateBelowTheFloorAndLeavesOneAboveItAlone() {
    let world = arena(physicsHz: 4)
    #expect(abs(world.parameters.stepMs - 1000 / SwarmConstants.physicsHzFloor) < 1e-6)
    world.parameters.physicsHz = 1
    #expect(abs(world.parameters.stepMs - 1000 / SwarmConstants.physicsHzFloor) < 1e-6)
    world.parameters.physicsHz = 120
    #expect(abs(world.parameters.stepMs - 1000 / 120) < 1e-6)
  }

  @Test func keepsAirFrictionPositiveAtTheFloorWhichIsWhyTheFloorIsThere() {
    let baseDelta = 1000.0 / 60
    let worst = SwarmConstants.frictionAirCeiling
    let floorStepMs = 1000 / SwarmConstants.physicsHzFloor
    #expect(1 - worst * (floorStepMs / baseDelta) > 0)
    // One notch below the floor and the same sum is already negative.
    let belowStepMs = 1000 / (SwarmConstants.physicsHzFloor - 5)
    #expect(1 - worst * (belowStepMs / baseDelta) < 0)
  }

  @Test func putsTheSameFieldInTheSamePlaceTwiceFromTheSameSeedAndActuallyMoved() {
    let first = arena()
    let second = arena()
    let before = first.states.map(\.position)
    _ = drive(first, frames: 60, deltaMs: 1000 / 60)
    _ = drive(second, frames: 60, deltaMs: 1000 / 60)
    #expect(first.states.map(\.position) == second.states.map(\.position))
    #expect(first.states.map(\.position) != before)
  }

  @Test func blendsByTheShareOfTheNextStepTheClockHasRun() {
    let world = arena(physicsHz: 30)  // a 33.3 ms step
    world.seed(now: 0)
    #expect(world.blend == 0)
    #expect(world.advance(now: 0.010) == 0)  // 10 ms into the first step
    #expect(abs(world.blend - 0.3) < 1e-9)
    #expect(world.advance(now: 0.040) == 1)  // one solved, 6.7 ms into the next
    #expect(abs(world.blend - 0.2) < 1e-6)
  }

  /// 2026-10-18 — the drawn clock is the wall clock, one step behind, at every
  /// frame: the blend never stalls a frame and jumps the next, whatever the
  /// paint's jitter (the frame-age blend it replaced did both at 60 over 30).
  @Test func theDrawnClockRunsWithTheWallClockWhateverThePaintsJitter() {
    let world = arena(physicsHz: 30)
    world.seed(now: 0)
    let jitter: [Double] = [0, 1.5, -1.2, 0.8, -0.4, 1.9, -1.7, 0.3]
    var solved = 0
    for frame in 1...120 {
      let nowMs = Double(frame) * 1000 / 60 + jitter[frame % jitter.count]
      solved += world.advance(now: nowMs / 1000)
      let drawnMs = (Double(solved) + world.blend) * world.parameters.stepMs
      #expect(abs(drawnMs - nowMs) < 1e-5, "frame \(frame)")
    }
  }

  @Test func carriesTheLastTwoSolvedPositionsForTheBlend() {
    let world = arena()
    // A new body has no history: its first blend is a no-op.
    for state in world.states { #expect(state.previousPosition == state.position) }
    world.seed(now: 0)
    // The second body: off centre, so the pull moves it in one step (the
    // first sits at the centre and has nothing to move toward).
    let before = position(world, "b")
    #expect(world.advance(now: 1.0 / 30) == 1)
    let state = world.state(of: SwarmBodyID("b"))!
    #expect(state.previousPosition == before)
    #expect(state.position != before)
  }
}

@Suite struct DragSpringTests {
  @Test func addsOnGrabFollowsThePointerAndReleasesOnDrop() {
    let world = arena(gravityPull: 0)
    world.seed(now: 0)
    #expect(world.state(of: SwarmBodyID("a"))?.isDragged == false)
    let start = position(world, "a")
    world.beginDrag(id: SwarmBodyID("a"), at: start)
    #expect(world.state(of: SwarmBodyID("a"))?.isDragged == true)
    world.updateDrag(id: SwarmBodyID("a"), to: start + SIMD2(200, 0))
    settlePumps(world, frames: 30)
    #expect(position(world, "a").x > start.x + 50)
    world.endDrag(id: SwarmBodyID("a"))
    #expect(world.state(of: SwarmBodyID("a"))?.isDragged == false)
  }

  @Test func exemptsAHeldBubbleFromThePullToCentreSoItStaysWhereItIsPut() {
    let world = arena(gravityPull: 0.004)
    world.seed(now: 0)
    let grabbed = SIMD2(700.0, 350.0)
    world.beginDrag(id: SwarmBodyID("a"), at: position(world, "a"))
    world.updateDrag(id: SwarmBodyID("a"), to: grabbed)
    settlePumps(world, frames: 90)
    let held = position(world, "a")
    #expect(abs(held.x - grabbed.x) < 5)
    #expect(abs(held.y - grabbed.y) < 5)
  }

  @Test func dropsTheSpringWhenTheAgentLeavesMidDrag() {
    let world = arena()
    world.beginDrag(id: SwarmBodyID("a"), at: SIMD2(100, 100))
    #expect(world.state(of: SwarmBodyID("a"))?.isDragged == true)
    world.syncAgents([SwarmWorld.AgentSpec(id: SwarmBodyID("b"), visualRadius: 50)])
    #expect(world.state(of: SwarmBodyID("a")) == nil)
    #expect(world.states.map(\.id) == [SwarmBodyID("b")])
  }
}

@Suite struct MembershipTests {
  @Test func reportsAChangeForArrivalsAndDeparturesAndNotForAResize() {
    let world = arena()
    let generation = world.generation
    #expect(
      world.syncAgents([
        SwarmWorld.AgentSpec(id: SwarmBodyID("a"), visualRadius: 70),
        SwarmWorld.AgentSpec(id: SwarmBodyID("b"), visualRadius: 50),
      ]) == false)
    #expect(world.generation == generation)
    #expect(world.syncAgents([SwarmWorld.AgentSpec(id: SwarmBodyID("a"), visualRadius: 70)]))
    #expect(world.generation > generation)
    #expect(world.states.map(\.id) == [SwarmBodyID("a")])
    #expect(
      world.syncAgents([
        SwarmWorld.AgentSpec(id: SwarmBodyID("a"), visualRadius: 70),
        SwarmWorld.AgentSpec(id: SwarmBodyID("c"), visualRadius: 40),
      ]))
    #expect(world.states.map(\.id) == [SwarmBodyID("a"), SwarmBodyID("c")])
  }

  @Test func growsABodyTowardItsNewRadiusInsideAStepRatherThanSnapping() {
    let world = arena(gravityPull: 0, agents: [SwarmWorld.AgentSpec(id: SwarmBodyID("a"), visualRadius: 40)])
    #expect(world.state(of: SwarmBodyID("a"))?.visualRadius == 40)
    world.syncAgents([SwarmWorld.AgentSpec(id: SwarmBodyID("a"), visualRadius: 70)])
    #expect(world.state(of: SwarmBodyID("a"))?.visualRadius == 40)
    _ = drive(world, frames: 1, deltaMs: 1000 / 30)
    #expect(world.state(of: SwarmBodyID("a"))?.visualRadius == 70)
  }

  @Test func placesASpawnHintWhereTheGestureHappenedClampedIntoTheArena() {
    let world = arena(agents: [
      SwarmWorld.AgentSpec(id: SwarmBodyID("a"), visualRadius: 50, spawnPosition: SIMD2(640, 300))
    ])
    #expect(position(world, "a") == SIMD2(640, 300))
    let clamped = arena(agents: [
      SwarmWorld.AgentSpec(id: SwarmBodyID("a"), visualRadius: 50, spawnPosition: SIMD2(2000, -50))
    ])
    #expect(position(clamped, "a") == SIMD2<Double>(800 - 54, 54))
  }

  @Test func namesTheBubbleUnderAPointAndNothingUnderAnEmptyOne() {
    let world = arena(
      gravityPull: 0,
      agents: [
        SwarmWorld.AgentSpec(id: SwarmBodyID("a"), visualRadius: 40, spawnPosition: SIMD2(120, 120)),
        SwarmWorld.AgentSpec(id: SwarmBodyID("b"), visualRadius: 40, spawnPosition: SIMD2(400, 300)),
      ])
    #expect(world.queryPoint(SIMD2(120, 120)) == SwarmBodyID("a"))
    #expect(world.queryPoint(SIMD2(400, 300)) == SwarmBodyID("b"))
    #expect(world.queryPoint(SIMD2(700, 60)) == nil)
    // Just outside the drawn edge plus its collision gap.
    #expect(world.queryPoint(SIMD2(120 + 46, 120)) == nil)
  }
}
