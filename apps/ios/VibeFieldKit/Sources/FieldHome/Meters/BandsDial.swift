import FieldDesign
import SwiftUI

// UM-4 (DESIGN.md §8 "The Bands circle"; §13 "A meter is never a glyph") — THE BANDS CIRCLE, DRAWN: `BandsLayout`'s
// geometry in ChromePalette's inks, never a number of its own. Its four tones map as §8 says: the ink at a share
// (`ChromePalette.ink`), the hot fill (`ChromePalette.attention` at its share), the light (white at a share, a hot
// fill's lit head), and the attention ink for a figure or a mark that runs hot. The hot dot is the attention orange
// ringed in the ground the circle stands on. Marks are the agents' own (`AgentGlyph`, the catalog's mark key) and a
// profile's glyph is `ProfileGlyphSymbols`'.
//
// A first read breathes on §6's breath (1.1 s, alternate, ease-in-out), its ink from 35% to all of it — the circle's
// one loop — and under Reduce Motion stands still at 60%.

struct BandsDial: View {
  let geometry: BandsGeometry
  /// The profile whose glyph stands in the middle (a circle for one profile), or nil.
  var profile: MeterProfile? = nil
  /// The ground the circle stands on, which the hot dot is ringed in.
  var ground: Color = ChromePalette.menuSurface
  /// An agent's mark key from its id (the home's catalog's `mark`, else the id).
  var mark: (String) -> String = { $0 }

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var breathing = false

  var body: some View {
    let size = CGFloat(geometry.size)
    ZStack {
      Canvas { context, _ in draw(into: &context, breath: false) }
      if hasBreath {
        Canvas { context, _ in draw(into: &context, breath: true) }
          .opacity(reduceMotion ? 0.6 : breathing ? 1 : 0.35)
          .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { breathing = true }
          }
          // a breath that leaves and comes back (a reading, then another home's first read) starts again from 35%,
          // never frozen at full ink
          .onDisappear { breathing = false }
      }
      ForEach(Array(marks.enumerated()), id: \.offset) { _, mark in markView(mark) }
      ForEach(Array(geometry.centre.items.enumerated()), id: \.offset) { _, item in centreView(item) }
      if let dot = geometry.hotDot {
        Circle()
          .fill(ChromePalette.attention)
          .overlay { Circle().strokeBorder(ground, lineWidth: CGFloat(dot.ring)) }
          .frame(width: CGFloat(dot.r * 2), height: CGFloat(dot.r * 2))
          .position(x: CGFloat(dot.x), y: CGFloat(dot.y))
      }
    }
    .frame(width: size, height: size)
    .accessibilityElement()
    .accessibilityLabel(geometry.label)
    .accessibilityAddTraits(.isImage)
  }

  private var hasBreath: Bool { geometry.plans.contains { plan in plan.arcs.contains { $0.part == .breath } } }

  private var marks: [BandsMark] { geometry.plans.compactMap(\.mark) }

  // MARK: - Paints

  private func color(_ paint: BandsPaint) -> Color {
    switch paint {
    case .ink(let percent): ChromePalette.ink.opacity(percent / 100)
    case .hot(let percent): ChromePalette.attention.opacity(percent / 100)
    case .light(let percent): Color.white.opacity(percent / 100)
    case .attention: ChromePalette.attention
    }
  }

  // MARK: - The arcs and notches (or the dashed ring)

  private func draw(into context: inout GraphicsContext, breath: Bool) {
    let c = geometry.size / 2
    if let empty = geometry.empty, !breath {
      let ring = Path(
        ellipseIn: CGRect(x: c - empty.r, y: c - empty.r, width: empty.r * 2, height: empty.r * 2))
      context.stroke(
        ring, with: .color(color(empty.paint)),
        style: StrokeStyle(lineWidth: empty.width, dash: empty.dash.map { CGFloat($0) }))
    }
    for plan in geometry.plans {
      for arc in plan.arcs where (arc.part == .breath) == breath {
        var path = Path()
        path.addArc(
          center: CGPoint(x: c, y: c), radius: arc.r, startAngle: .degrees(arc.from), endAngle: .degrees(arc.to),
          clockwise: false)
        context.stroke(
          path, with: .color(color(arc.paint).opacity(arc.opacity)),
          style: StrokeStyle(
            lineWidth: arc.width, lineCap: arc.cap == .round ? .round : .butt,
            dash: (arc.dash ?? []).map { CGFloat($0) }))
      }
      guard !breath else { continue }
      for notch in plan.notches {
        var path = Path()
        path.move(to: CGPoint(x: notch.x1, y: notch.y1))
        path.addLine(to: CGPoint(x: notch.x2, y: notch.y2))
        context.stroke(path, with: .color(color(notch.paint).opacity(notch.opacity)), lineWidth: notch.width)
      }
    }
  }

  // MARK: - Marks, glyphs and words

  private func markView(_ item: BandsMark) -> some View {
    ZStack {
      AgentGlyph(mark: mark(item.provider), letterSize: CGFloat(item.size * 0.8))
        .foregroundStyle(color(item.paint))
        .frame(width: CGFloat(item.size), height: CGFloat(item.size))
        .opacity(item.opacity)
        .position(x: CGFloat(item.x), y: CGFloat(item.y))
      if let badge = item.badge {
        Circle()
          .fill(ChromePalette.attention)
          .overlay {
            Image(systemName: badge.need == .signIn ? "key.fill" : "exclamationmark")
              .font(.system(size: CGFloat(badge.r * 1.1), weight: .bold))
              .foregroundStyle(ground)
          }
          .frame(width: CGFloat(badge.r * 2), height: CGFloat(badge.r * 2))
          .position(x: CGFloat(badge.x), y: CGFloat(badge.y))
      }
      if let glyph = item.glyph {
        glyphView(glyph.profile, size: glyph.size, paint: glyph.paint)
          .position(x: CGFloat(glyph.x), y: CGFloat(glyph.y))
      }
    }
  }

  private func glyphView(_ profile: MeterProfile?, size: Double, paint: BandsPaint) -> some View {
    Image(
      systemName: profile.map {
        ProfileGlyphSymbols.symbol(glyph: $0.glyph, native: $0.kind == "native", filled: $0.filled)
      } ?? ProfileGlyphSymbols.everyProfile
    )
    .font(.system(size: CGFloat(size) * 0.8, weight: .regular))
    .foregroundStyle(color(paint))
    .frame(width: CGFloat(size), height: CGFloat(size))
  }

  @ViewBuilder
  private func centreView(_ item: BandsCentreItem) -> some View {
    switch item {
    case .glyph(let x, let y, let size, let paint):
      glyphView(profile, size: size, paint: paint).position(x: CGFloat(x), y: CGFloat(y))
    case .mark(let centreMark):
      markView(centreMark)
    case .text(let words):
      textView(words)
    }
  }

  /// A word stands on its baseline (the layout's y): its middle is set a third of its size above it.
  private func textView(_ words: BandsText) -> some View {
    let size = CGFloat(words.size)
    let weight = Self.weight(words.weight)
    let font: Font =
      words.font == .display ? .system(size: size, weight: weight) : ChromeType.sans(size, weight)
    return HStack(alignment: .firstTextBaseline, spacing: size * 0.04) {
      Text(words.text).font(font)
      if words.percent {
        Text("%").font(.system(size: size / 2, weight: .bold))
      }
    }
    .monospacedDigit()
    .foregroundStyle(color(words.paint))
    .fixedSize()
    .position(x: CGFloat(words.x), y: CGFloat(words.y) - size * 0.35)
  }

  /// The layout's CSS weights as the system's.
  static func weight(_ css: Double) -> Font.Weight {
    switch css {
    case 800...: .heavy
    case 700..<800: .bold
    case 600..<700: .semibold
    case 500..<600: .medium
    default: .regular
    }
  }
}
