import FieldDesign
import SwiftUI

// UM-4 (DESIGN.md §8 "The Bands circle": "Each band is the C1 line"; "The phone's corner": every window as Settings'
// C1 line) — SETTINGS' C1 LINE ON THE PHONE: the desktop's `UsageLineView` and `usageFigurePlace`
// (`panels/agents/ProfilesView.tsx`, `profiles-model.ts`; pass 22's Line · Glow · Halo) at the page's 12 tall. The
// track is the window's time, the fill its use with its last 10 lit, the now line the time gone — giving way across
// the figure where it would touch it — and the figure rides the head; the reset closes the line. A window that meters
// part of the plan stands under its group's heading. Orange only when the window runs hot (`UsageLine.hot`).

/// A plan's windows, each a C1 line, under their groups' headings; a kept reading draws at 50%.
struct UsageLinesView: View {
  let windows: [MeterWindow]
  var stale = false

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      ForEach(Array(windows.enumerated()), id: \.element.line.id) { index, window in
        if let group = window.line.group, group.id != (index > 0 ? windows[index - 1].line.group?.id : nil) {
          Text(group.label)
            .font(ChromeType.sans(10.5, .semibold))
            .foregroundStyle(ChromePalette.inkSecondary)
            .lineLimit(1)
            .accessibilityHidden(true)
        }
        UsageLineView(line: window.line, form: window.resetForm)
      }
    }
    .opacity(stale ? 0.5 : 1)
  }

  /// The first read's silhouette (the drawing's `c1Load`): two tracks, no label and no figure invented.
  struct Loading: View {
    var body: some View {
      VStack(alignment: .leading, spacing: 10) {
        ForEach(0..<2, id: \.self) { _ in
          HStack(spacing: 10) {
            Capsule().frame(width: 20, height: 7)
            Capsule().frame(maxWidth: .infinity, maxHeight: 7)
            Capsule().frame(width: 44, height: 7)
          }
          .foregroundStyle(ChromePalette.ink.opacity(0.07))
        }
      }
      .padding(.vertical, 3)
      .accessibilityElement()
      .accessibilityLabel("Reading usage")
    }
  }
}

/// One window's line: its label (26), the track, and the reset (58).
struct UsageLineView: View {
  let line: UsageLine
  /// how its reset is said: by its length, by its day, or now
  let form: MeterRules.ResetForm?

  static let height: CGFloat = 12
  /// The fill's lit head (the desktop's `USAGE_GLOW`); the figure inside the fill stops 2 short of it.
  static let glow: CGFloat = 10
  /// The now line, 2 wide, its four corners opened into 2 quarter circles (`USAGE_NOW_WIDTH`, `USAGE_NOW_FLARE`).
  static let nowWidth: CGFloat = 2
  static let nowFlare: CGFloat = 2
  /// The figure's gap after the head, and the now line's reach toward it.
  static let figureGap: CGFloat = 5
  static let clearance: CGFloat = 3

  var body: some View {
    HStack(spacing: 10) {
      Text(line.label)
        .font(ChromeType.sans(9, .semibold))
        .tracking(ChromeType.tracking(0.06, of: 9))
        .foregroundStyle(ChromePalette.inkTertiary)
        .lineLimit(1)
        .frame(width: 26, alignment: .leading)
      GeometryReader { geo in track(geo.size.width) }
        .frame(height: Self.height)
      HStack(spacing: 4) {
        if line.resets, line.reset != nil {
          Image(systemName: "arrow.counterclockwise")
            .font(.system(size: 8, weight: .semibold))
        }
        Text(line.reset ?? "")
          .font(ChromeType.sans(10.5))
          .monospacedDigit()
          .lineLimit(1)
      }
      .foregroundStyle(line.hot ? ChromePalette.attention : ChromePalette.inkTertiary)
      .frame(width: 58, alignment: .leading)
    }
    .accessibilityElement()
    .accessibilityLabel(Self.words(line, form: form))
  }

  /// The line in words, as the desktop says it; a reset is said "resets in 2h" by its length, and "resets Thu 09:00"
  /// or "resets now" by its day or once it has come (the U3 review: never "resets in Thu 09:00").
  static func words(_ line: UsageLine, form: MeterRules.ResetForm?, age: String? = nil) -> String {
    // RED STUB (UM-4d, M-phone): a window read before its reset does not say the reading's age yet
    let group = line.group.map { "\($0.label), " } ?? ""
    let reset = line.reset.map { form == .length ? ", resets in \($0)" : ", resets \($0)" } ?? ""
    return "\(group)\(line.label): \(wholeWords(line.usedPercent))% used\(reset)\(line.hot ? ", ahead of pace" : "")"
  }

  private func track(_ width: CGFloat) -> some View {
    let used = CGFloat(min(100, max(0, line.usedPercent)))
    let head = width * used / 100
    let figure = "\(wholeWords(line.usedPercent))%"
    // the drawing's measure of a 9.5/700 figure, so the place is laid out before it is drawn
    let figureWidth = CGFloat(figure.count) * 5.55 + 1
    let inner = head - (Self.glow + 2) - figureWidth
    let inside = inner >= 3
    let x = max(0, min(inside ? inner : head + Self.figureGap, width - figureWidth))
    let now = line.elapsedPercent.map { width * CGFloat(min(100, max(0, $0))) / 100 }
    let reach = Self.nowWidth / 2 + Self.clearance
    let gives = now.map { $0 >= x - reach && $0 <= x + figureWidth + reach } ?? false
    let box = Self.nowWidth + 2 * Self.nowFlare
    return ZStack(alignment: .topLeading) {
      ChromePalette.ink.opacity(0.07)
      fill(head)
        .frame(width: head)
      if let now {
        Self.nowPath(Self.height)
          .fill(ChromePalette.ink.opacity(0.75))
          .frame(width: box, height: Self.height)
          .mask {
            // near the figure the line gives way across the digits' band and keeps its flared ends
            VStack(spacing: gives ? 9.5 : 0) {
              Rectangle()
              Rectangle()
            }
          }
          .offset(x: now - box / 2)
      }
      Text(figure)
        .font(.system(size: 9.5, weight: .bold))
        .monospacedDigit()
        .foregroundStyle(line.hot && inside ? Color.white : ChromePalette.ink)
        .fixedSize()
        .frame(height: Self.height)
        .offset(x: x)
    }
    .frame(width: width, height: Self.height, alignment: .topLeading)
    .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
  }

  /// The fill: a pale body whose last 10 brighten to its lit head — the ink's, or the hot fill's toward white.
  private func fill(_ head: CGFloat) -> some View {
    let lit = head > 0 ? max(0, (head - Self.glow) / head) : 0
    let pale = line.hot ? ChromePalette.attention.opacity(0.85) : ChromePalette.ink.opacity(0.2)
    let tip = line.hot ? ChromePalette.attention.mix(with: .white, by: 0.45) : ChromePalette.ink.opacity(0.58)
    return RoundedRectangle(cornerRadius: 4, style: .continuous)
      .fill(
        LinearGradient(
          stops: [.init(color: pale, location: 0), .init(color: pale, location: lit), .init(color: tip, location: 1)],
          startPoint: .leading, endPoint: .trailing))
  }

  /// The now line's outline (the desktop's `usageNowPath`) in a box `nowWidth + 2 × nowFlare` wide: a bar whose four
  /// corners open into quarter circles, meeting the track's edges wider than it runs through the middle.
  static func nowPath(_ height: CGFloat) -> Path {
    let w = nowWidth
    let r = nowFlare
    let c = w + 2 * r
    var path = Path()
    path.move(to: .zero)
    path.addQuadCurve(to: CGPoint(x: r, y: r), control: CGPoint(x: r, y: 0))
    path.addLine(to: CGPoint(x: r, y: height - r))
    path.addQuadCurve(to: CGPoint(x: 0, y: height), control: CGPoint(x: r, y: height))
    path.addLine(to: CGPoint(x: c, y: height))
    path.addQuadCurve(to: CGPoint(x: r + w, y: height - r), control: CGPoint(x: r + w, y: height))
    path.addLine(to: CGPoint(x: r + w, y: r))
    path.addQuadCurve(to: CGPoint(x: c, y: 0), control: CGPoint(x: r + w, y: 0))
    path.closeSubpath()
    return path
  }
}
