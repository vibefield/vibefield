import CoreGraphics
import SwiftUI

// PG-4t — THE VIEWS' FACES AS THEIR MANIFESTS AUTHOR THEM (DESIGN.md §8 "The phone's Stories row"; MV-D6: "each view
// supplies its filled mark … the host has no view mark table"): every view's label and mark, transcribed ONCE from
// puppeteer-views' manifests (`views/<id>/index.ts`, `mark:`) in their authoring form — the bar's 1.6 monoline on the
// 24 grid, round-capped strokes and rings — so the phone draws the manifests' own drawings, never an SF Symbol. All
// five are here before their views land: a PG-5…8 lane adds its case and nothing else.
//
// Held to the manifests by the marks golden (`phone-marks.golden.json`): `outlines` writes each path exactly as the
// view SDK's `mark-outline.js` writes the manifest's filled outline, and a host row compares the two strings. No `#if`.

/// A view's face on the Stories row: its manifest's label and its mark.
struct GodviewViewFace: Equatable, Sendable {
  /// One stroke of a mark on the 24 grid.
  enum Part: Equatable, Sendable {
    /// A straight, round-capped stroke `width` wide (the bar's 1.6); one of no length is a dot as wide as it.
    case stroke(from: CGPoint, to: CGPoint, width: CGFloat)
    /// A stroked circle, the bar's 1.6 wide.
    case ring(center: CGPoint, radius: CGFloat)
  }

  /// The manifest's label (SWARM); the row says it in sentence case (`GodviewStories.name(label:)`).
  let label: String
  /// The manifest's `mark.paths`, in order, each its parts. Empty for a view whose manifest draws no mark: the row
  /// shows its label's initial.
  let paths: [[Part]]
}

/// Every view's face, keyed by manifest id.
enum GodviewViewMarks {
  /// The bar's mark grid: a mark's `viewBox` is `0 0 24 24`.
  static let grid: CGFloat = 24
  /// The bar's monoline weight, in grid units.
  static let weight: CGFloat = 1.6

  /// The five manifests' faces (puppeteer-views `views/{swarm,list,rain,timeline,spend}/index.ts`, `mark:`), each
  /// path as the manifest groups it.
  static let faces: [String: GodviewViewFace] = [
    // Three bodies: rings.
    "swarm": GodviewViewFace(label: "SWARM", paths: [[ring(7.5, 8, 3)], [ring(16, 6.5, 2.2)], [ring(13, 16, 4.2)]]),
    // Three rules.
    "list": GodviewViewFace(
      label: "LIST", paths: [[stroke(5, 7, 19, 7), stroke(5, 12, 19, 12), stroke(5, 17, 19, 17)]]),
    // Three broken columns.
    "rain": GodviewViewFace(
      label: "RAIN",
      paths: [[
        stroke(7, 4, 7, 9), stroke(7, 12.5, 7, 15), stroke(12, 3, 12, 5.5), stroke(12, 8.5, 12, 16.5),
        stroke(17, 5, 17, 8.5), stroke(17, 12, 17, 18),
      ]]),
    // Three spans stopping short of the now line, and the now line.
    "timeline": GodviewViewFace(
      label: "TIMELINE",
      paths: [
        [stroke(4.5, 7.5, 12.5, 7.5), stroke(8, 12, 16.5, 12), stroke(4.5, 16.5, 9.5, 16.5)],
        [stroke(19.5, 4.5, 19.5, 19.5)],
      ]),
    // A line climbing to the now line, its head a dot as wide as the held mark's disc.
    "spend": GodviewViewFace(
      label: "SPEND",
      paths: [
        [stroke(3.5, 18.5, 8, 14), stroke(8, 14, 11.5, 16.5), stroke(11.5, 16.5, 17, 9)],
        [stroke(20.5, 4, 20.5, 20)],
        [stroke(17, 9, 17, 9, width: 4.4)],
      ]),
  ]

  private static func stroke(
    _ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat, width: CGFloat = weight
  ) -> GodviewViewFace.Part {
    .stroke(from: CGPoint(x: x1, y: y1), to: CGPoint(x: x2, y: y2), width: width)
  }

  private static func ring(_ x: CGFloat, _ y: CGFloat, _ radius: CGFloat) -> GodviewViewFace.Part {
    .ring(center: CGPoint(x: x, y: y), radius: radius)
  }
}

extension GodviewViewChoice {
  /// This view's face: its manifest's, or its id's capitals with no mark (the row then shows the initial), so the
  /// lookup is total. Every case has its manifest's face (a host row pins it).
  var face: GodviewViewFace {
    GodviewViewMarks.faces[rawValue] ?? GodviewViewFace(label: rawValue.uppercased(), paths: [])
  }
}

extension GodviewViewFace {
  /// Each path as the view SDK writes the manifest's filled outline (`mark-outline.js`): what the marks golden holds.
  var outlines: [String] {
    paths.map { $0.map(Self.outline).joined() }
  }

  /// One part's filled outline, as `strokeOutline` / `ringOutline` write it.
  static func outline(_ part: Part) -> String {
    switch part {
    case .stroke(let from, let to, let width):
      return strokeOutline(from: from, to: to, width: Double(width))
    case .ring(let center, let radius):
      return ringOutline(center: center, radius: Double(radius), width: Double(GodviewViewMarks.weight))
    }
  }

  /// `strokeOutline`: one side of the stroke half its width off the line, a round cap, the other side, a round cap.
  private static func strokeOutline(from: CGPoint, to: CGPoint, width: Double) -> String {
    let half = width / 2
    let (fx, fy, tx, ty) = (Double(from.x), Double(from.y), Double(to.x), Double(to.y))
    let dx = tx - fx
    let dy = ty - fy
    let length = hypot(dx, dy)
    if length == 0 { return disc(fx, fy, half, sweep: 0) }
    let nx = (-dy / length) * half
    let ny = (dx / length) * half
    let cap = "\(unit(half)) \(unit(half)) 0 0 0"
    return "M\(unit(fx + nx)) \(unit(fy + ny))L\(unit(tx + nx)) \(unit(ty + ny))"
      + "A\(cap) \(unit(tx - nx)) \(unit(ty - ny))L\(unit(fx - nx)) \(unit(fy - ny))"
      + "A\(cap) \(unit(fx + nx)) \(unit(fy + ny))Z"
  }

  /// `ringOutline`: the outer edge, and the inner one wound the other way (a hole) while the circle is wider than its
  /// stroke.
  private static func ringOutline(center: CGPoint, radius: Double, width: Double) -> String {
    let half = width / 2
    let (cx, cy) = (Double(center.x), Double(center.y))
    return disc(cx, cy, radius + half, sweep: 0) + (radius > half ? disc(cx, cy, radius - half, sweep: 1) : "")
  }

  /// `disc`: a disc as one subpath of two half arcs, wound by `sweep`.
  private static func disc(_ cx: Double, _ cy: Double, _ r: Double, sweep: Int) -> String {
    let radius = "\(unit(r)) \(unit(r))"
    return "M\(unit(cx - r)) \(unit(cy))A\(radius) 0 1 \(sweep) \(unit(cx + r)) \(unit(cy))"
      + "A\(radius) 0 1 \(sweep) \(unit(cx - r)) \(unit(cy))Z"
  }

  /// A coordinate as `mark-outline.js`'s `unit` writes it: to four places, rounded as `Math.round` rounds (a tie
  /// toward +∞), with no `-0`, in JavaScript's digits.
  static func unit(_ value: Double) -> String {
    let scaled = value * 1e4
    var whole = scaled.rounded(.down)
    if scaled - whole >= 0.5 { whole += 1 }
    let rounded = whole / 1e4
    if rounded == 0 { return "0" }
    if rounded == rounded.rounded(.towardZero), abs(rounded) < 1e15 { return String(Int64(rounded)) }
    return "\(rounded)"
  }
}

/// A view's mark as one shape: every part drawn opaque black on its 24 grid, scaled to the frame it is given — the
/// MASK the row lays its ink through, so the ink never doubles where a mark's strokes meet. A round-capped stroke
/// covers what the manifest's filled outline covers; a stroke of no length is its dot.
struct GodviewMark: View {
  let face: GodviewViewFace

  var body: some View {
    Canvas { context, size in
      let scale = min(size.width, size.height) / GodviewViewMarks.grid
      context.translateBy(
        x: (size.width - GodviewViewMarks.grid * scale) / 2, y: (size.height - GodviewViewMarks.grid * scale) / 2)
      context.scaleBy(x: scale, y: scale)
      for path in face.paths {
        for part in path { Self.draw(part, in: &context) }
      }
    }
  }

  private static func draw(_ part: GodviewViewFace.Part, in context: inout GraphicsContext) {
    switch part {
    case .stroke(let from, let to, let width) where from == to:
      let dot = CGRect(x: from.x - width / 2, y: from.y - width / 2, width: width, height: width)
      context.fill(Path(ellipseIn: dot), with: .color(.black))
    case .stroke(let from, let to, let width):
      var line = Path()
      line.move(to: from)
      line.addLine(to: to)
      context.stroke(line, with: .color(.black), style: StrokeStyle(lineWidth: width, lineCap: .round))
    case .ring(let center, let radius):
      let circle = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
      context.stroke(Path(ellipseIn: circle), with: .color(.black), lineWidth: GodviewViewMarks.weight)
    }
  }
}
