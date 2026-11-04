import FieldProduct
import Foundation

// PG-8 — THE RAIN'S FRAME: what puppeteer-views 0.3.3's rain paints, op for op, as a value the Metal surface draws
// (dist `views/rain/RainView.js` at the pin `52d09c8e`): `measureCanvas` (:7-24), `sync` (:62-77), `draw` (:109-211)
// and `agentAt` (:241-249). The ops are the canvas calls in the canvas's order — the stage's fill, then each stream's
// tail from its head up, then its head — so `phone-rain.golden.json`'s still frame is compared op for op (G6).
//
// Transcribed as the desktop draws, kept where it surprises: a glyph is placed at its cell's centre and its row's
// alphabetic BASELINE (`row × cell`), so row 0 sits above the stage's top edge; a drop wraps (`y − tail > rows` → 0)
// in a still too; the head skips the tail's nearest cell. Not transcribed, named: the pane wash (:126-146; the phone
// mounts no panes, fd's Q4). The phone's one addition is J-S4's lit row (`RainAgent.lit`), heading in the dark
// palette's text main with the active row's glow ×1.5.

/// `measureCanvas` (:7-24): the stage in points, cut into cells of the font's size.
struct RainGeometry: Equatable, Sendable {
  let columns: Int
  let rows: Int
  let cell: Double
  let width: Double
  let height: Double

  /// `geometryRef`'s first value (:51): nothing measured yet.
  static let unmeasured = RainGeometry(columns: 0, rows: 0, cell: 14, width: 0, height: 0)

  /// The stage at `width` × `height` points: at least one column and one row.
  static func measure(width: Double, height: Double, fontSize: Double) -> RainGeometry {
    RainGeometry(
      columns: max(1, floorCells(width / fontSize)), rows: max(1, floorCells(height / fontSize)), cell: fontSize,
      width: width, height: height)
  }

  /// `Math.floor` of a cell count; a count that is no number (a stage not laid out) is none, so the floor of one wins.
  private static func floorCells(_ cells: Double) -> Int {
    let floored = cells.rounded(.down)
    return floored.isFinite ? Int(floored) : 0
  }
}

/// One canvas call the frame makes, in its order.
enum RainOp: Equatable, Sendable {
  /// The stage's fill (`fillRect(0, 0, width, height)`, :115-116): the whole frame, first.
  case stage(width: Double, height: Double, fill: String)
  /// One `fillText`.
  case glyph(RainGlyph)
}

/// One glyph as the canvas is told to paint it.
struct RainGlyph: Equatable, Sendable {
  /// One UTF-16 code unit, as `data[i]` and `String.fromCharCode` give.
  let unit: UInt16
  /// The cell's centre (`textAlign = 'center'`).
  let x: Double
  /// The row's alphabetic baseline.
  let y: Double
  let ink: RainInk
  /// `globalAlpha`: the column's recede weight.
  let alpha: Double
  /// `shadowBlur`: a head's glow; 0 for a tail.
  let blur: Double
  /// `shadowColor`'s channels (`rgba(<tail>, 1)`): a head's.
  let glowRgb: String?
}

/// A glyph's `fillStyle`.
enum RainInk: Equatable, Sendable {
  /// A head: the palette's colour, as it spells it.
  case solid(String)
  /// A tail: `rgba(<channels>, <opacity>)`.
  case faded(rgb: String, opacity: Double)
}

/// The rain's state between frames: the stage, the streams, the weights. Owned by the surface; a frame draws from it.
struct RainFrame {
  /// `geometryRef`.
  private(set) var geometry = RainGeometry.unmeasured
  /// `dropsRef`: the streams, in the Map's order (which is the draw order).
  private(set) var drops = RainColumns()
  /// `recedes` (:105): each row's weight as last drawn, by model id.
  private(set) var recedes: [String: Double] = [:]

  /// `sync` (:62-77): measure the stage, then reconcile the streams over the window's order. A new drop is rolled as
  /// the desktop rolls it, its row and then its speed.
  mutating func sync(
    width: Double, height: Double, fontSize: Double, order: [String], random: inout some RainRandom
  ) {
    let measured = RainGeometry.measure(width: width, height: height, fontSize: fontSize)
    geometry = measured
    drops = RainStreams.reconcile(agents: order, columns: measured.columns, previous: drops) { agentId in
      let y = random.next() * Double(measured.rows)
      let speed = 0.3 + random.next() * 0.4
      return RainDrop(agentId: agentId, y: y, speed: speed)
    }
  }

  /// `draw` (:109-211): one frame's ops over `agents` (the window's rows, `agentsRef`). `elapsed` nil is a still (no
  /// drop falls, no glyph scrambles, a receded column sits at its weight); otherwise it is the frame's `deltaMs`.
  /// `hovered` is the row a pointer rests on: the desktop's; the phone's peek is James's (`RainTouchPeek`, nil today).
  mutating func plan(
    agents: [RainAgent], parameters: RainParameters, palette: RainPalette, hovered: String? = nil, elapsed: Double?,
    random: inout some RainRandom
  ) -> [RainOp] {
    let still = elapsed == nil
    let (columns, rows, cell) = (geometry.columns, geometry.rows, geometry.cell)
    let byId = Self.byId(agents)
    var ops: [RainOp] = [.stage(width: geometry.width, height: geometry.height, fill: palette.stage)]

    // A receded column keeps falling, faint (:118-126).
    let every = GodviewRecede.every(byId.values.map(\.receded))
    for id in recedes.keys where byId[id] == nil { recedes[id] = nil }
    for agent in byId.values {
      let target = GodviewRecede.target(receded: agent.receded, every: every)
      if let elapsed {
        recedes[agent.id] = GodviewRecede.approach(recedes[agent.id] ?? target, toward: target, deltaMs: elapsed)
      } else {
        recedes[agent.id] = target
      }
    }

    for (column, drop) in drops.entries {
      if column >= columns { continue }
      guard let agent = byId[drop.agentId] else { continue }
      let data = RainStreams.data(agent)
      let tailLength = RainStreams.tailLength(
        agent, rows: rows, tailMultiplier: parameters.tailMultiplier, dataLength: data.count)
      let presentation = palette.presentation(agent.status)
      let hoveredHere = hovered == agent.id
      // Hover only brightens; the phone's lit row heads in the dark text main (J-S4), the desktop's active one in
      // `activeHead` — the same white on the rain's ground.
      let headColor = hoveredHere ? palette.activeHead : (agent.lit ? palette.litHead : presentation.head)
      let tailRgb = hoveredHere ? palette.hoverTailRgb : presentation.tail
      if !still { drop.y += presentation.speed ?? drop.speed * parameters.speedMultiplier }
      if drop.y - tailLength > Double(rows) { drop.y = 0 }
      let headRow = Int(drop.y.rounded(.down))
      let showHead = agent.status != .idle
      let x = Double(column) * cell + cell / 2
      let weight = recedes[agent.id] ?? 1

      // `glyphAt` (:173-186): one roll per glyph in a moving frame, a second for a scrambled one. A blocked stream's
      // text block stays clear so the stuck agent is the one you can read; an idle one never scrambles.
      func glyph(_ row: Int, _ distance: Double) -> UInt16 {
        let plain = data[row % data.count]
        if still { return plain }
        let scramble: Double
        switch agent.status {
        case .working: scramble = parameters.scrambleWorking
        case .blocked: scramble = distance < Double(data.count) ? 0 : parameters.scramblePending
        case .idle: scramble = 0
        }
        return random.next() < scramble ? Self.matrixGlyph(random.next()) : plain
      }

      let first = min(headRow, rows - 1)
      let last = max(-1, Int((drop.y - tailLength).rounded(.down)))
      var row = first
      while row > last {
        if row < 0 { break }
        let distance = drop.y - Double(row)
        if showHead && distance < 1 {
          row -= 1
          continue
        }
        let opacity = GodviewFormat.jsMax0(1 - distance / tailLength)
        let unit = glyph(row, distance)
        ops.append(
          .glyph(
            RainGlyph(
              unit: unit, x: x, y: Double(row) * cell, ink: .faded(rgb: tailRgb, opacity: opacity), alpha: weight,
              blur: 0, glowRgb: nil)))
        row -= 1
      }
      if showHead && headRow >= 0 && headRow < rows {
        let blur = hoveredHere || agent.lit ? parameters.headGlow * 1.5 : parameters.headGlow
        let unit = glyph(headRow, 0)
        ops.append(
          .glyph(
            RainGlyph(
              unit: unit, x: x, y: Double(headRow) * cell, ink: .solid(headColor), alpha: weight, blur: blur,
              glowRgb: tailRgb)))
      }
    }
    return ops
  }

  /// `agentAt` (:241-249): the row whose stream runs under a point's x, in the stage's points. Columns run the full
  /// height, so the point's row never matters; a column with no stream, or a stream whose row is gone, is no one.
  func agent(atX x: Double, among agents: [RainAgent]) -> RainAgent? {
    guard let column = Int(exactly: (x / geometry.cell).rounded(.down)),
      let drop = drops.drop(at: column)
    else { return nil }
    return Self.byId(agents)[drop.agentId]
  }

  /// `matrixGlyph` (:6): `String.fromCharCode(0x30a0 + Math.random() * 96)`, a katakana; `fromCharCode` truncates.
  static func matrixGlyph(_ roll: Double) -> UInt16 {
    UInt16((12_448 + roll * 96).rounded(.towardZero))
  }

  /// `new Map(agents.map((agent) => [agent.id, agent]))`: a repeated id keeps its last row.
  private static func byId(_ agents: [RainAgent]) -> [String: RainAgent] {
    Dictionary(agents.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
  }
}
