import FieldAgents
import Foundation
import SwiftUI

// PG-7 — THE SPEND VIEW'S CANVAS (kit-only): `paintSpend` (`spend-paint.js` :46-224, puppeteer-views 0.3.3 at the
// pin `52d09c8e`) drawn into a SwiftUI `GraphicsContext`, one call for one call. A canvas `save()`/`clip()`/
// `restore()` is a copy of the context clipped; `css(colour, a)` is the colour with its alpha scaled
// (`SwarmColor.withAlpha`); `Math.round` is `JSNumber.round`. The device ratio is SwiftUI's, so the paint draws in
// points. It paints from the scene alone (`SpendScene.scene`, which S1…S6 hold to the frame's places); the paint
// itself is checked by eye on the stills (Q2).

enum SpendPaint {
  /// The swarm's wave: 1.1 s out of a head waiting on you (`WAVE_MS`).
  static let waveMs = 1100.0

  /// `paintSpend`: the grid, the now line, the lines (the one pointed at last), then the heads, the cross, a start.
  /// `time` is the wave's clock in ms (`scene.time`); `waves`, whether the view moves at all (the window paints
  /// `waves: current.waves && motion`).
  static func paint(
    _ context: inout GraphicsContext, _ scene: SpendScene.Scene, _ inks: SpendInks, time: Double, waves: Bool
  ) {
    let x0 = scene.x0
    let x1 = scene.x1
    let y0 = scene.y0
    let y1 = scene.y1
    let hot = scene.hot
    for (index, gy) in scene.grid.enumerated() {
      let y = JSNumber.round(gy) + 0.5
      context.stroke(
        segment(x0, y, x1, y), with: .color(inks.ink.withAlpha(index == 0 ? 0.14 : 0.06).spendColor), lineWidth: 1)
    }
    let nowX = JSNumber.round(scene.nowX) + 0.5
    context.stroke(
      segment(nowX, y0 - 6, nowX, y1), with: .color(inks.ink.withAlpha(0.16).spendColor),
      style: StrokeStyle(lineWidth: 1, dash: [2, 3]))
    // The lines, the one pointed at last (a stable sort, as the window's).
    let lines = scene.lines.enumerated().sorted {
      let a = $0.element.id == hot ? 1 : 0
      let b = $1.element.id == hot ? 1 : 0
      return a != b ? a < b : $0.offset < $1.offset
    }.map(\.element)
    let zeroY = scene.grid.first ?? y1
    for line in lines {
      let dim = hot != nil && line.id != hot
      let lit = line.id == hot
      let alpha = dim ? 0.18 : 1
      let width = hot == nil ? scene.weight : scene.weight + (lit ? 0.75 : 0.25)
      let future = alpha * (lit && scene.start == nil ? 0.5 : 0.22)
      guard line.points.count >= 2, let first = line.points.first, let last = line.points.last else { continue }
      if lit && scene.wash > 0 {
        var washed = context
        washed.clip(to: Path(CGRect(x: x0, y: 0, width: (scene.fadeX ?? x1) - x0, height: scene.height)))
        var area = polyline(line.points)
        area.addLine(to: CGPoint(x: last.x, y: zeroY))
        area.addLine(to: CGPoint(x: first.x, y: zeroY))
        area.closeSubpath()
        let gradient = Gradient(stops: [
          .init(color: line.colour.withAlpha(Swift.min(1, 0.16 * scene.wash)).spendColor, location: 0),
          .init(color: line.colour.withAlpha(Swift.min(1, 0.02 * scene.wash)).spendColor, location: 1),
        ])
        washed.fill(
          area, with: .linearGradient(gradient, startPoint: CGPoint(x: 0, y: y0), endPoint: CGPoint(x: 0, y: y1)))
      }
      let path = polyline(line.points)
      func stroke(_ from: Double, _ to: Double, _ a: Double) {
        var clipped = context
        clipped.clip(to: Path(CGRect(x: from, y: 0, width: to - from, height: scene.height)))
        clipped.stroke(
          path, with: .color(line.colour.withAlpha(a).spendColor),
          style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
      }
      if let fadeX = scene.fadeX {
        stroke(x0 - 4, fadeX, alpha)
        stroke(fadeX, x1 + 8, future)
      } else {
        stroke(x0 - 4, x1 + 8, alpha)
      }
    }
    heads(&context, scene, inks, time: time, waves: scene.waves && waves)
    cross(&context, scene, inks)
    if let start = scene.start { self.start(&context, scene, start, inks) }
  }

  /// `paintHeads`: in two passes, so a ring never covers another head — every wave and ring, then every dot.
  private static func heads(
    _ context: inout GraphicsContext, _ scene: SpendScene.Scene, _ inks: SpendInks, time: Double, waves: Bool
  ) {
    let faded = scene.fadeX != nil
    for head in scene.heads where head.key == .blocked || head.key == .unseen {
      let dim = scene.hot != nil && head.id != scene.hot
      let r = head.id == scene.hot ? 4.5 : 4
      let light = head.key == .blocked ? inks.orange : inks.blue
      let base = faded ? 0.22 : dim ? 0.35 : 1
      if waves && !faded {
        let phase = (time / waveMs).truncatingRemainder(dividingBy: 1)
        let eased = 1 - pow(1 - phase, 3)
        let wave = light.withAlpha((dim ? 0.3 : 0.7) * (1 - phase))
        context.stroke(circle(head.x, head.y, 6 + eased * 11), with: .color(wave.spendColor), lineWidth: 2)
      }
      context.stroke(circle(head.x, head.y, r + 3.5), with: .color(light.withAlpha(base).spendColor), lineWidth: 2)
    }
    for head in scene.heads {
      let dim = scene.hot != nil && head.id != scene.hot
      let r = head.id == scene.hot ? 4.5 : 4
      let alpha = faded ? 0.3 : dim ? 0.35 : 1
      context.fill(circle(head.x, head.y, r + 1.5), with: .color(inks.ground.withAlpha(alpha).spendColor))
      if head.key == .idle {
        let ring = head.colour.withAlpha(alpha)
        context.stroke(circle(head.x, head.y, r - 1), with: .color(ring.spendColor), lineWidth: 2)
      } else {
        context.fill(circle(head.x, head.y, r), with: .color(head.colour.withAlpha(alpha).spendColor))
      }
    }
  }

  /// `paintCross`: the ghost where the finger is while a moment is held, the moment's line, a dot on each started line.
  private static func cross(_ context: inout GraphicsContext, _ scene: SpendScene.Scene, _ inks: SpendInks) {
    guard let cross = scene.cross else { return }
    if let ghostX = scene.ghostX, abs(ghostX - cross.x) > 3 {
      let gx = JSNumber.round(ghostX) + 0.5
      context.stroke(
        segment(gx, scene.y0 - 4, gx, scene.y1), with: .color(inks.ink.withAlpha(0.22).spendColor),
        style: StrokeStyle(lineWidth: 1, dash: [3, 4]))
    }
    let x = JSNumber.round(cross.x) + 0.5
    context.stroke(
      segment(x, scene.y0 - 4, x, scene.y1), with: .color(inks.ink.withAlpha(cross.held ? 0.5 : 0.32).spendColor),
      lineWidth: 1)
    for dot in cross.dots {
      let alpha = scene.hot != nil && dot.id != scene.hot ? 0.4 : 1
      context.fill(circle(x, dot.y, 5.5), with: .color(inks.ground.withAlpha(alpha).spendColor))
      context.fill(circle(x, dot.y, 3.5), with: .color(dot.colour.withAlpha(alpha).spendColor))
    }
  }

  /// `paintStart`: where a line pointed at before its birth will start — a dotted hair in its colour, a ring on $0.
  private static func start(
    _ context: inout GraphicsContext, _ scene: SpendScene.Scene, _ start: SpendScene.Start, _ inks: SpendInks
  ) {
    let x = JSNumber.round(start.x) + 0.5
    context.stroke(
      segment(x, scene.y0 - 4, x, start.y), with: .color(start.colour.withAlpha(0.7).spendColor),
      style: StrokeStyle(lineWidth: 1, dash: [2, 3]))
    let ring = circle(x, start.y, 4)
    context.fill(ring, with: .color(inks.ground.spendColor))
    context.stroke(ring, with: .color(start.colour.spendColor), lineWidth: 2)
  }

  private static func segment(_ ax: Double, _ ay: Double, _ bx: Double, _ by: Double) -> Path {
    var path = Path()
    path.move(to: CGPoint(x: ax, y: ay))
    path.addLine(to: CGPoint(x: bx, y: by))
    return path
  }

  private static func polyline(_ points: [SpendScene.Point]) -> Path {
    var path = Path()
    for (index, point) in points.enumerated() {
      let p = CGPoint(x: point.x, y: point.y)
      if index == 0 { path.move(to: p) } else { path.addLine(to: p) }
    }
    return path
  }

  private static func circle(_ x: Double, _ y: Double, _ r: Double) -> Path {
    Path(ellipseIn: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r))
  }
}
