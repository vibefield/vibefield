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
  /// `KERNEL`: the gaussian's weights, offset −10…10; `KERNEL_SUM` their sum, added left to right.
  static let kernel: [Double] = (0...(2 * smoothRadius)).map { index in
    let offset = Double(index - smoothRadius)
    return exp(-(offset * offset) / (2 * smoothSigma * smoothSigma))
  }
  static let kernelSum = kernel.reduce(0, +)

  /// `pulseRowsFor`: every agent lane (not only those in view) but a receded one — the map counts what the stage
  /// counts.
  static func rows(_ lanes: [TimelineLane], nowMs: Double) -> [PulseRow] {
    lanes.filter { $0.kind == .agent && !$0.receded }.map {
      PulseRow(colour: $0.colour, status: $0.current.status, fromMs: $0.current.fromMs, endMs: nowMs)
    }
  }

  /// `addCoverage`: the fraction of each bucket [start + i·dt, start + (i+1)·dt) that [a, b) covers, added into `into`.
  static func addCoverage(_ into: inout [Float], startMs: Double, dt: Double, a: Double, b: Double) {
    if b <= a { return }
    let first = max(0, ((a - startMs) / dt).rounded(.down))
    let last = min(Double(into.count - 1), ((b - startMs) / dt).rounded(.down))
    var index = first
    while index <= last {
      let s0 = startMs + index * dt
      let bucket = Int(index)
      into[bucket] = Float(Double(into[bucket]) + max(0, min(b, s0 + dt) - max(a, s0)) / dt)
      index += 1
    }
  }

  /// `smooth`: a normalised gaussian over buckets, edges held, so the ridge rolls instead of stepping.
  static func smooth(_ values: [Float]) -> [Float] {
    let count = values.count
    var out = [Float](repeating: 0, count: count)
    for index in 0..<count {
      var sum = 0.0
      for offset in -smoothRadius...smoothRadius {
        sum += kernel[offset + smoothRadius] * Double(values[min(count - 1, max(0, index + offset))])
      }
      out[index] = Float(sum / kernelSum)
    }
    return out
  }

  /// `pulseScales`: work fills its zone (at most 6 px an agent), the waits theirs, never larger than work's.
  static func scales(maxUp: Double, maxDown: Double, up: Double, down: Double) -> (kUp: Double, kDn: Double) {
    let kUp = min(up / max(0.5, maxUp), 6)
    return (kUp, min(down / max(0.5, maxDown), kUp))
  }

  /// `pulseMap`: the rows' coverage of the day from `startMs` to `nowMs`, bucketed, smoothed and stacked.
  init(_ rows: [PulseRow], startMs: Double, nowMs: Double, geometry: PulseGeometry) {
    let width = geometry.width
    // `Math.round` ties toward +∞; past the floor of 40 every rounded value is positive, where that is away from zero.
    let count = Int(max(40, (width / 2).rounded(.toNearestOrAwayFromZero)))
    let dt = max(1, nowMs - startMs) / Double(count)
    // The bands in the order rows first name them, keyed as the SDK keys them: by the colour's string.
    var keys: [String] = []
    var colours: [SwarmColor?] = []
    var work: [[Float]] = []
    var blocked = [Float](repeating: 0, count: count)
    var unseen = [Float](repeating: 0, count: count)
    for row in rows {
      let key = row.colour?.hex ?? ""
      let band: Int
      if let known = keys.firstIndex(of: key) {
        band = known
      } else {
        band = keys.count
        keys.append(key)
        colours.append(row.colour)
        work.append([Float](repeating: 0, count: count))
      }
      let a = max(row.fromMs, startMs)
      switch row.status {
      case .working: Self.addCoverage(&work[band], startMs: startMs, dt: dt, a: a, b: row.endMs)
      case .blocked: Self.addCoverage(&blocked, startMs: startMs, dt: dt, a: a, b: row.endMs)
      case .unseen: Self.addCoverage(&unseen, startMs: startMs, dt: dt, a: a, b: row.endMs)
      case .idle: break
      }
    }
    // The project that worked most lies on the line, the least at the crest; a tie keeps the order of first naming.
    let sums = work.map { values in values.reduce(0.0) { $0 + Double($1) } }
    let rank = work.indices.sorted { a, b in
      let order = sums[b] - sums[a]
      return (order != 0 && !order.isNaN ? order : Double(a - b)) < 0
    }
    let bands = rank.map { Self.smooth(work[$0]) }
    let blockedSmooth = Self.smooth(blocked)
    let unseenSmooth = Self.smooth(unseen)
    var maxUp = 0.0
    var maxDown = 0.0
    for index in 0..<count {
      maxUp = max(maxUp, bands.reduce(0.0) { $0 + Double($1[index]) })
      maxDown = max(maxDown, Double(blockedSmooth[index]) + Double(unseenSmooth[index]))
    }
    let (kUp, kDn) = Self.scales(maxUp: maxUp, maxDown: maxDown, up: geometry.up, down: geometry.down)
    let base = 1.5 + geometry.up
    let xs = (0..<count).map { Float((Double($0) + 0.5) / Double(count) * width) }

    var cumulative = [Float](repeating: 0, count: count)
    var workBands: [PulseBand] = []
    for (position, values) in bands.enumerated() {
      var top = [Float](repeating: 0, count: count)
      var bottom = [Float](repeating: 0, count: count)
      for index in 0..<count {
        bottom[index] = Float(base - Double(cumulative[index]) * kUp)
        cumulative[index] = Float(Double(cumulative[index]) + Double(values[index]))
        top[index] = Float(base - Double(cumulative[index]) * kUp)
      }
      workBands.append(PulseBand(colour: colours[rank[position]], top: top, bottom: bottom))
    }
    // A wait hung under the line, below `lower`.
    func hang(_ lower: [Float], _ values: [Float]) -> PulseBand {
      var top = [Float](repeating: 0, count: count)
      var bottom = [Float](repeating: 0, count: count)
      for index in 0..<count {
        top[index] = Float(base + Double(lower[index]) * kDn)
        bottom[index] = Float(base + (Double(lower[index]) + Double(values[index])) * kDn)
      }
      return PulseBand(colour: nil, top: top, bottom: bottom)
    }
    self.init(
      xs: xs, work: workBands, blocked: hang([Float](repeating: 0, count: count), blockedSmooth),
      unseen: hang(blockedSmooth, unseenSmooth), base: base, kUp: kUp, kDn: kDn)
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
