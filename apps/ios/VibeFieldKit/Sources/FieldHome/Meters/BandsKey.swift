import FieldDesign
import SwiftUI

/// UM-4 (DESIGN.md §8 "The phone's corner": "the bands key under it") — the bands key under an open circle: inside,
/// the next five hours; outside, the week; a hairline, a model's own week. Three small arcs (16 × 11) in the ink, the
/// one each names lit at 72% and the others at 16%, beside their words at 10.5 in the tertiary ink (the drawing's
/// `bandsKey`, `round4/src/p4f-frames.js`). Said as one sentence.
struct BandsKey: View {
  var body: some View {
    HStack(spacing: 5) {
      item(.inner, "5 hours")
      item(.outer, "7 days")
      item(.hairline, "a model's week")
    }
    .font(ChromeType.sans(10.5, .medium))
    .foregroundStyle(ChromePalette.inkTertiary)
    .lineLimit(1)
    .accessibilityElement()
    .accessibilityLabel("Inside, the next five hours; outside, the week; a hairline, a model's own week")
  }

  private func item(_ band: BandsArc.Band, _ words: String) -> some View {
    HStack(spacing: 2) {
      Self.icon(band)
      Text(words)
    }
  }

  private static func icon(_ band: BandsArc.Band) -> some View {
    Canvas { context, _ in
      let on = ChromePalette.ink.opacity(0.72)
      let off = ChromePalette.ink.opacity(0.16)
      context.stroke(arc(5.6), with: .color(band == .outer ? on : off), lineWidth: 2.2)
      context.stroke(arc(2.7), with: .color(band == .inner ? on : off), lineWidth: 2.2)
      if band == .hairline {
        context.stroke(arc(7.4), with: .color(on), lineWidth: 1)
      }
    }
    .frame(width: 16, height: 11)
  }

  /// The upper half of a circle about the icon's foot.
  private static func arc(_ r: CGFloat) -> Path {
    var path = Path()
    path.addArc(
      center: CGPoint(x: 8, y: 10.4), radius: r, startAngle: .degrees(180), endAngle: .degrees(360), clockwise: false)
    return path
  }
}
