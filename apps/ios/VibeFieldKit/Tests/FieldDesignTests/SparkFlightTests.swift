import CoreGraphics
import Testing

@testable import FieldDesign

/// IOS-12f's f6 (PC-D8 A, Q4; DESIGN.md §2.10, §8 "The phone's Chat", Created) — the flight, held by hand to
/// hatch.tsx's own lines (:290–323):
/// - u = (t − t0) / 0.66, clamped to 0…1, and e = 1 − (1 − u)³;
/// - x and y run from → to by e, y lifted by sin(π·e) · min(90, distance · 0.18);
/// - R runs to the row's, its box's width / 2 / 1.26, and the target is the box's centre with the star 0.06 of R1
///   below it;
/// - past u = 0.45 the face wears its row's disc, at faceScale 1.12.
/// Each value below is that arithmetic done by hand (in doubles) for one flight: from (200, 300) at R 120 / 2 / 1.26 to
/// a row face's box at (16, 120), 48 square. No golden: the hatch golden carries no flight, and no script is
/// retro-fitted (VF-PM's Q6 ruling, 17:10:10Z).
@Suite("Created, the face flies to its row as hatch.tsx flies it")
struct SparkFlightTests {
  static let from = SparkFlight.Start(x: 200, y: 300, R: 120 / 2 / 1.26)
  static let box = CGRect(x: 16, y: 120, width: 48, height: 48)

  struct Moment: Sendable, CustomStringConvertible {
    let u: Double
    let x, y, R: Double
    let framed, landed: Bool
    var description: String { "u = \(u)" }
  }

  static let moments = [
    Moment(u: 0, x: 200, y: 300, R: 47.61904761904762, framed: false, landed: false),
    Moment(u: 0.3, x: 94.88, y: 162.95596456366815, R: 28.847619047619048, framed: false, landed: false),
    Moment(u: 0.45, x: 66.62, y: 150.89896910093606, R: 23.801190476190477, framed: false, landed: false),
    Moment(u: 0.46, x: 65.19424000000001, y: 150.498971879926, R: 23.546590476190477, framed: true, landed: false),
    Moment(u: 1, x: 40, y: 145.14285714285714, R: 19.047619047619047, framed: true, landed: true),
  ]

  @Test("at each share of the way it is where hatch.tsx's frame puts it", arguments: moments)
  func pose(_ moment: Moment) {
    let pose = SparkFlight(from: Self.from, t0: 0).pose(u: moment.u, to: Self.box)
    #expect(abs(pose.x - moment.x) < 1e-9)
    #expect(abs(pose.y - moment.y) < 1e-9)
    #expect(abs(pose.R - moment.R) < 1e-9)
    #expect(pose.framed == moment.framed)
    #expect(pose.landed == moment.landed)
  }

  @Test("its clock is its own: u is the time since it left over 0.66 s, held at 0 before and 1 after")
  func share() {
    let flight = SparkFlight(from: Self.from, t0: 2)
    #expect(flight.share(at: 1) == 0)
    #expect(abs(flight.share(at: 2.33) - 0.5) < 1e-12)
    #expect(flight.share(at: 5) == 1)
    let landed = flight.pose(at: 2.66, to: Self.box)
    #expect(landed.landed)
    let leaving = flight.pose(at: 2, to: Self.box)
    #expect(leaving == SparkFlight.Pose(x: 200, y: 300, R: Self.from.R, framed: false, landed: false))
  }

  @Test("past 0.45 of the way the face puts on its row's disc, eyes at 1.12, and keeps it")
  func disc() {
    var buddy = SparkBuddy(seed: 4211, status: "ready", framed: false, cut: nil, random: Mulberry32(seed: 4211))
    let flight = SparkFlight(from: Self.from, t0: 0)
    buddy.fly(flight.pose(u: 0.3, to: Self.box))
    #expect(!buddy.framed)
    let x = buddy.x
    #expect(abs(x - 94.88) < 1e-9)
    buddy.fly(flight.pose(u: 0.46, to: Self.box))
    #expect(buddy.framed)
    #expect(buddy.faceScale == 1.12)
    let R = buddy.R
    #expect(abs(R - 23.546590476190477) < 1e-9)
    // hatch.tsx puts the disc on once (`!flight.framed && u > 0.45`): a pose before it never takes it off
    buddy.fly(flight.pose(u: 0.3, to: Self.box))
    #expect(buddy.framed)
  }

  @Test("the hero leaves the sky for its flight, its place and size with it, and the sky has no face to give again")
  func hero() throws {
    var live = HatchSky.Live()
    live.deal(seed: 4211, draws: .seeded(4211), sky: CGSize(width: 382, height: 300), reducedMotion: false)
    for frame in 1...72 { live.frame(at: Double(frame) / 60) }
    let buddy = try #require(live.faces.first?.buddy)
    let hero = live.takeHero()
    #expect(hero == SparkFlight.Start(x: buddy.x, y: buddy.y, R: buddy.R))
    #expect(live.faces.isEmpty)
    #expect(live.hero == nil)
    let again = live.takeHero()
    #expect(again == nil)
  }
}
