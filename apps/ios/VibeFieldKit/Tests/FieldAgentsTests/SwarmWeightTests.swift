import Testing

@testable import FieldAgents

// The reference's `weight.test.ts`, transcribed.

@Suite struct SwarmWeightTests {
  @Test func risesFromTheFaintestMarkToTheTitleWithNoRungOutOfOrder() {
    let rungs = [
      SwarmWeight.watermark, SwarmWeight.hairline, SwarmWeight.edge, SwarmWeight.absent, SwarmWeight.rim,
      SwarmWeight.supporting, SwarmWeight.secondary, SwarmWeight.title,
    ]
    #expect(rungs.sorted() == rungs)
    // The title is the theme's own extreme; nothing else reaches it.
    #expect(SwarmWeight.title == 1)
  }

  @Test func climbsFromJustAboveTheTrackToTheTitleAndClampsAtBothEnds() {
    #expect(climb(0) == SwarmClimb.from)
    #expect(climb(1) == SwarmClimb.to)
    #expect(climb(-1) == SwarmClimb.from)
    #expect(climb(2) == SwarmClimb.to)
    // A lone flame still reads as more than an unlit slot.
    #expect(climb(0) > SwarmWeight.hairline)
    // The four flames are evenly spaced, the last at the title's weight.
    let flames = [0, 1, 2, 3].map { climb(Double($0) / 3) }
    for (flame, expected) in zip(flames, [0.34, 0.56, 0.78, 1]) {
      #expect(abs(flame - expected) < 1e-12)
    }
  }

  @Test func aColouredGroundCompressesTheLadderUpwardWithoutReorderingIt() {
    #expect(onField(0) == 0.3)
    #expect(onField(1) == 1)
    #expect(onField(SwarmWeight.supporting) > SwarmWeight.supporting)
    #expect(onField(SwarmWeight.supporting) < onField(SwarmWeight.secondary))
    #expect(workingCoreStrength == 0.5)
  }
}
