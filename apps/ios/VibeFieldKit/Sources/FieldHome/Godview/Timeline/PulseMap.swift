import FieldAgents
import Foundation

// PG-6 — THE MAP OF THE DAY, drawn as Pulse (TL-D15), transcribed from puppeteer-views 0.3.3 at the lock's `52d09c8e`
// (the timeline is byte-identical to 0.3.2's `95a70aa7`; its last change `5abe8f75`), `src/views/timeline/pulse-map.ts`
// (dist `pulse-map.js`): `pulseRowsFor` :6-15, `PULSE_GEOMETRY` :38, `addCoverage` :40-50, `SMOOTH_RADIUS` and
// `SMOOTH_SIGMA` :51-52, `KERNEL` :53, `KERNEL_SUM` :54, `smooth` :56-68, `pulseScales` :70-73 and `pulseMap` :75-161.
// The whole field summed into one ridge: work stacks above a line in each project's colour, its height the number of
// agents working; what waited on you hangs below it, orange then blue. Counts are drawn as a shape, never printed
// (FC-D18). Held to `phone-timeline.golden.json` (`TimelineGeometryParityTests`).
//
// FLOAT32 AS JAVASCRIPT DOES IT: the buckets and the edges are `Float32Array`s, so they are `[Float]` here, and every
// write is JavaScript's — the stored float32 read back as a double, the arithmetic in double, the result rounded to
// float32 once on the store (`a[i] = Float(Double(a[i]) + x)`, never `a[i] += Float(x)`). The sums and maxima over
// them are doubles, as JavaScript's numbers are.
//
// RUNTIME ONLY (fd's Q1 ruling, 2026-11-04): each agent gives the map its current state alone, so `pulseMap`'s `past`
// is always empty. NOT transcribed, history alone reaches them: `PulsePast`, `WORKED` :16, `workedOf` :18-25,
// `pulsePastFor` :27-37, `NO_PAST` :74, `pulseMap`'s record loop :104-109, and `pulseRowsFor`'s ended filter.

/// `PulseRow`: an agent's current state for the map — its project's colour (the ledger's deal; rows that share it
/// share a band), its status, and the state's start and now.
struct PulseRow: Equatable, Sendable {
  let colour: SwarmColor?
  let status: TimelineStatus
  let fromMs: Double
  let endMs: Double
}

/// `PulseGeometry`: the map's drawn width and height, and work's zone above the line and the waits' below it, px.
struct PulseGeometry: Equatable, Sendable {
  let width: Double
  let height: Double
  let up: Double
  let down: Double

  /// `PULSE_GEOMETRY`'s height and zones at a drawn width.
  init(width: Double, height: Double = 34, up: Double = 21, down: Double = 10) {
    self.width = width
    self.height = height
    self.up = up
    self.down = down
  }
}

/// `PulseBand`: per bucket, a band's two edges in px (top < bottom), and a work band's project colour (nil for an
/// undealt project, and for the two waits, which the paint inks by name).
struct PulseBand: Equatable, Sendable {
  let colour: SwarmColor?
  let top: [Float]
  let bottom: [Float]
}

/// `PulseMap`: the bucket centres, the work bands from the line up (the project that worked most lies on the line),
/// the two waits hung below it, the line itself, and the px per agent above and below.
struct PulseMap: Equatable, Sendable {
  let xs: [Float]
  let work: [PulseBand]
  let blocked: PulseBand
  let unseen: PulseBand
  let base: Double
  let kUp: Double
  let kDn: Double

  /// `SMOOTH_RADIUS` and `SMOOTH_SIGMA`: σ 4 buckets ≈ 8 px.
  static let smoothRadius = 10
  static let smoothSigma = 4.0

  /// `pulseRowsFor`: every agent lane (not only those in view) but a receded one — the map counts what the stage
  /// counts.
  static func rows(_ lanes: [TimelineLane], nowMs: Double) -> [PulseRow] {
    []
  }

  /// `addCoverage`: the fraction of each bucket [start + i·dt, start + (i+1)·dt) that [a, b) covers, added into `into`.
  static func addCoverage(_ into: inout [Float], startMs: Double, dt: Double, a: Double, b: Double) {}

  /// `smooth`: a normalised gaussian over buckets, edges held, so the ridge rolls instead of stepping.
  static func smooth(_ values: [Float]) -> [Float] {
    []
  }

  /// `pulseScales`: work fills its zone (at most 6 px an agent), the waits theirs, never larger than work's.
  static func scales(maxUp: Double, maxDown: Double, up: Double, down: Double) -> (kUp: Double, kDn: Double) {
    (0, 0)
  }

  /// `pulseMap`: the rows' coverage of the day from `startMs` to `nowMs`, bucketed, smoothed and stacked.
  init(_ rows: [PulseRow], startMs: Double, nowMs: Double, geometry: PulseGeometry) {
    let none = PulseBand(colour: nil, top: [], bottom: [])
    self.init(xs: [], work: [], blocked: none, unseen: none, base: 0, kUp: 0, kDn: 0)
  }

  private init(
    xs: [Float], work: [PulseBand], blocked: PulseBand, unseen: PulseBand, base: Double, kUp: Double, kDn: Double
  ) {
    self.xs = xs
    self.work = work
    self.blocked = blocked
    self.unseen = unseen
    self.base = base
    self.kUp = kUp
    self.kDn = kDn
  }
}
