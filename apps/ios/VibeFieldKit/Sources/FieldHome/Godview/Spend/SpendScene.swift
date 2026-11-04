import FieldAgents
import Foundation

// PG-7 — WHAT THE SPEND VIEW'S CANVAS DRAWS: each line's ink and fill, and the scene the paint draws from (its grid,
// its now line, the lines in points, the heads, the cross and its dots, the ghost, a start), transcribed from
// puppeteer-views 0.3.3 at the pin `52d09c8e` (the spend module `5abe8f75`): `SpendView.tsx` (dist `SpendView.js`
// :39 the grey, :148-157 the colours, :260-318 the scene) and `spend-paint.js` :42 (`sceneMoves`). Pure, so
// host-built; the paint itself is by eye (Q2). Held by hand rows that tie every point to the frame's own places
// (SpendParityTests S1…S6), which P7 holds to the shipping view's DOM. The scene's `ratio` and `time` are the paint's.

enum SpendScene {
  /// Spend's own fallback ink (`GREY`): a line whose colour has not resolved — the palette not yet read, or a colour
  /// the palette cannot parse — is drawn grey.
  static let grey = SwarmColor(r: 0.5, g: 0.5, b: 0.5, a: 1)
  /// The lines' weight and the lit line's wash (`DEFAULT_SPEND_PARAMETERS`: the phone offers no parameters).
  static let weight = 1.75
  static let wash = 1.0

  /// A line's two inks: its stroke (its project's colour, a sibling a step darker or lighter) and the fill its tag
  /// sits on (a hex).
  struct Colour: Equatable, Sendable {
    let ink: SwarmColor
    let fill: String
  }

  struct Line: Equatable, Sendable {
    let id: String
    let colour: SwarmColor
    let points: [Point]
  }

  struct Point: Equatable, Sendable {
    let x: Double
    let y: Double
  }

  /// A line's head at now, and what its row is doing then (a waiting head waves).
  struct Head: Equatable, Sendable {
    let id: String
    let x: Double
    let y: Double
    let colour: SwarmColor
    let key: SpendWords.State.Key
  }

  struct Dot: Equatable, Sendable {
    let id: String
    let x: Double
    let y: Double
    let colour: SwarmColor
  }

  /// The moment's cross: its x, whether a tap holds it, a dot on each line already started.
  struct Cross: Equatable, Sendable {
    let x: Double
    let held: Bool
    let dots: [Dot]
  }

  /// Where a line pointed at before its birth starts.
  struct Start: Equatable, Sendable {
    let x: Double
    let y: Double
    let colour: SwarmColor
  }

  /// The scene (`SpendScene`): what one paint draws.
  struct Scene: Equatable, Sendable {
    let width: Double
    let height: Double
    let x0: Double
    let x1: Double
    let y0: Double
    let y1: Double
    let weight: Double
    let wash: Double
    let grid: [Double]
    let nowX: Double
    let lines: [Line]
    let hot: String?
    let fadeX: Double?
    let heads: [Head]
    let waves: Bool
    let cross: Cross?
    let ghostX: Double?
    let start: Start?
  }

  /// `colours` (:147): each line's inks from its project's colour (`base`, nil where it has not resolved) and its
  /// sibling index, on the ground's darkness.
  static func colours(
    _ lines: [SpendSeries.Meter], sib: [String: Int], dark: Bool, base: (SpendSeries.Meter) -> SwarmColor?
  ) -> [String: Colour] {
    var out: [String: Colour] = [:]
    for line in lines {
      let colour = base(line) ?? grey
      let n = sib[line.id] ?? 0
      out[line.id] = Colour(
        ink: SpendInk.siblingTone(colour, sib: n, dark: dark), fill: SpendInk.liftedFill(colour, sib: n))
    }
    return out
  }

  /// The scene at one frame (:259-318).
  static func scene(
    _ input: SpendModel.Input, _ state: SpendModel.State, _ frame: SpendModel.Frame, colours: [String: Colour]
  ) -> Scene {
    let g = frame.g
    let span = frame.span
    let xOf = { (t: Double) in SpendModel.xOf(g, span, t) }
    let yOf = { (value: Double) in SpendModel.yOf(g, frame.yMax, value) }
    let inkOf = { (id: String) in colours[id]?.ink ?? grey }
    let lines = frame.lines.map { line in
      Line(
        id: line.id, colour: inkOf(line.id),
        points: SpendSeries.spentPoints(line, span.ta, span.tb).map { Point(x: xOf($0.t), y: yOf($0.v)) })
    }
    // every head is at now, on what its run spent in the window; a row with a total alone has neither line nor head
    let heads: [Head] = frame.lines.compactMap { line in
      guard let spent = SpendSeries.spentAt(line, span.ta, span.tb) else { return nil }
      let state = SpendWords.spendStateAt(bornMs: line.bornMs, agent: line.agent, t: span.tb, nowMs: input.nowMs)
      return Head(id: line.id, x: xOf(span.tb), y: yOf(spent), colour: inkOf(line.id), key: state.key)
    }
    let hot = state.hover
    let hotLine = hot.flatMap { id in frame.lines.last { $0.id == id } }
    // a moment fades the heads, and a faded head has no wave: the loop rests while one is read
    let cross = frame.tCross.map { t in
      Cross(
        x: xOf(t), held: frame.pinned != nil,
        dots: frame.lines.compactMap { line in
          guard let spent = t < line.bornMs ? nil : SpendSeries.spentAt(line, span.ta, t) else { return nil }
          return Dot(id: line.id, x: xOf(t), y: yOf(spent), colour: inkOf(line.id))
        })
    }
    var ghostX: Double?
    if frame.pinned != nil, let pointer = state.pointer { ghostX = xOf(SpendScale.momentIn(pointer.t, span)) }
    var start: Start?
    if let hotLine, let tCross = frame.tCross, tCross < hotLine.bornMs {
      start = Start(x: xOf(Swift.max(hotLine.bornMs, span.ta)), y: yOf(0), colour: inkOf(hotLine.id))
    }
    return Scene(
      width: g.width, height: g.height, x0: g.x0, x1: g.x1, y0: g.y0, y1: g.y1, weight: weight, wash: wash,
      grid: SpendScale.moneyTicks(max: frame.yMax, step: frame.target.step).map(yOf), nowX: xOf(span.tb),
      lines: lines, hot: hot, fadeX: frame.tCross.map(xOf), heads: heads, waves: frame.tCross == nil, cross: cross,
      ghostX: ghostX, start: start)
  }

  /// `sceneMoves` (`spend-paint.js` :43): whether any head moves on its own — the loop repaints only then.
  static func moves(_ scene: Scene) -> Bool {
    scene.waves && scene.heads.contains { $0.key == .blocked || $0.key == .unseen }
  }
}
