import FieldDesign
import SwiftUI

/// UM-4 (DESIGN.md §8 "The phone's corner": "the bands key under it") — the bands key under an open circle. Small arcs
/// (16 × 11) in the ink, the one each names lit at 72% and the others at 16%, beside their words at 10.5 in the
/// tertiary ink (the drawing's `bandsKey`, `round4/src/p4f-frames.js`). Said as one sentence.
///
/// UM-6 (UM-D31 K3, 2026-11-24; DESIGN.md §8 "Godview's profiles column", the body) — it names only what its circle
/// draws (`BandsLayout.keyItems`): the inside band by its window's length, the outside band by its, a budget's
/// "credits" (both arcs lit), and the hairline by its group's own word ("Opus"); on ONE line, the last word giving way.
/// *Before:* the same three words always, "5 hours · 7 days · a model's week".
struct BandsKey: View {
  let items: [BandsKeyItem]

  var body: some View {
    HStack(spacing: 5) {
      ForEach(Array(items.enumerated()), id: \.offset) { index, item in
        HStack(spacing: 2) {
          Self.icon(item.band)
          Text(item.words)
            .truncationMode(.tail)
        }
        // the last word gives way first, never a second line
        .layoutPriority(index == items.count - 1 ? 0 : 1)
      }
    }
    .font(ChromeType.sans(10.5, .medium))
    .foregroundStyle(ChromePalette.inkTertiary)
    .lineLimit(1)
    .accessibilityElement()
    .accessibilityLabel(BandsLayout.keyWords(items))
  }

  private static func icon(_ band: BandsKeyItem.Band) -> some View {
    Canvas { context, _ in
      let on = ChromePalette.ink.opacity(0.72)
      let off = ChromePalette.ink.opacity(0.16)
      let outer = band == .outer || band == .budget
      let inner = band == .inner || band == .budget
      context.stroke(arc(5.6), with: .color(outer ? on : off), lineWidth: 2.2)
      context.stroke(arc(2.7), with: .color(inner ? on : off), lineWidth: 2.2)
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
