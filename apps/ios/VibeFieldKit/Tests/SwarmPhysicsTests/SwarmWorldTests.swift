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
