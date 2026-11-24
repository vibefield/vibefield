import FieldDesign
import SwiftUI

// UM-4 (DESIGN.md §8 "The Bands circle": "Each band is the C1 line"; "The phone's corner": every window as Settings'
// C1 line) — SETTINGS' C1 LINE ON THE PHONE: the desktop's `UsageLineView` and `usageFigurePlace`
// (`panels/agents/ProfilesView.tsx`, `profiles-model.ts`; pass 22's Line · Glow · Halo) at the page's 12 tall. The
// track is the window's time, the fill its use with its last 10 lit, the now line the time gone — giving way across
// the figure where it would touch it — and the figure rides the head. A window that meters part of the plan stands
// under its group's heading. Orange only when the window runs hot (`UsageLine.hot`), which a window read before its
// reset never does.
//
// UM-6 (UM-D29 A, UM-D32 T9; DESIGN.md §8 "A meter line's end", 2026-11-24) — THE LINE ENDS IN ITS RESET. The track
// runs square-ended into its END CAP, 2 away: a capsule 64 × 14 in the ink at 15% holding the reset on the clock
// ("15:00", "THU 12:00", "DEC 4"; `ResetClock`). A window read before its reset keeps the cap's place, empty and
// dashed, "RESET 12:30", and its read's age stands under its bar. A window that runs out before its reset is marked
// under its bar: a tick where it runs out on its own time and "out in ~25m" beside it. The cap never turns orange; no
// glyph leads a reset (the page's ↻ is the refresh's). *Before:* a 58 slot at the end held `arrow.counterclockwise` and
// the reset as a length or by its day, or the reading's age, and the plan's forecast was a sentence under its lines.

/// A plan's windows, each a C1 line, under their groups' headings; a kept reading draws at 50% and forecasts nothing.
/// Each window read before its reset (`MeterWindow.passed`) says its own age (`ages`, by its line's id) under its bar.
struct UsageLinesView: View {
  let windows: [MeterWindow]
  var stale = false
  /// each passed window's age, "as of 3h ago", by its line's id (item 274: its own read); none when no window was read
  /// before its reset, or its time cannot be read
  var ages: [String: String] = [:]

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
        // a kept reading (a refresh that failed) forecasts nothing, so it draws no out mark
        UsageLineView(
          line: window.line, clock: window.resetClock, forecast: stale ? nil : window.forecast?.short,
          age: window.passed ? ages[window.line.id] : nil, form: window.resetForm)
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

/// One window's line: its label (36, the old 26 and the 10 that stood after it), the track, and its end cap (64, 2
/// after the track); under it, while it runs out first, its out mark, or for a window read before its reset its read's
/// age.
struct UsageLineView: View {
  let line: UsageLine
  /// its reset on the clock (`MeterWindow.resetClock`); nil for a budget and a window that names no reset
  var clock: ResetClock? = nil
  /// "out in ~25m" (`MeterForecast.short`) while it runs out before its reset; nil for a kept reading
  var forecast: String? = nil
  /// its read's age ("as of 3h ago"), for a window read before its reset
  var age: String? = nil
  /// how its reset is said in words when no clock is handed (the fallback; `MeterWindow.resetForm`)
  var form: MeterRules.ResetForm? = nil

  static let height: CGFloat = 12
  /// The fill's lit head (the desktop's `USAGE_GLOW`); the figure inside the fill stops 2 short of it.
  static let glow: CGFloat = 10
  /// The now line, 2 wide, its four corners opened into 2 quarter circles (`USAGE_NOW_WIDTH`, `USAGE_NOW_FLARE`).
  static let nowWidth: CGFloat = 2
  static let nowFlare: CGFloat = 2
  /// The figure's gap after the head, and the now line's reach toward it.
  static let figureGap: CGFloat = 5
  static let clearance: CGFloat = 3
  /// The label's column: the old 26 and the 10 that stood between it and the track.
  static let labelWidth: CGFloat = 36
  /// The end cap: 64 × 14, a hair taller than the track, 2 after it; its column 66 whether or not it draws, so a
  /// list's bars end together. 64 on both platforms (DESIGN.md §8 "A meter line's end"): "RESET 11:50" with its tabular
  /// figures stands about 57 wide even at the passed cap's tighter spacing, which touched a 60 cap's dashed edge.
  static let capWidth: CGFloat = 64
  static let capHeight: CGFloat = 14
  static let capGap: CGFloat = 2
  /// The row under the bar (the out mark, or a passed line's age): 13 tall, from 2 below the track's foot; its tick
  /// 1.5 × 9 hanging just under the track, its top 1 below the track's foot; its words 5 from the tick.
  static let underHeight: CGFloat = 13
  static let underGap: CGFloat = 2
  static let tickWidth: CGFloat = 1.5
  static let tickHeight: CGFloat = 9
  static let tickDrop: CGFloat = 1
  static let tickGap: CGFloat = 5
  /// The out words' measure before they are drawn (10.5 semibold, tabular), which decides only their side of the tick.
  static let outCharacter: CGFloat = 5.9

  /// A cap stands: a clock, or a reset said only in words (a line handed no clock).
  private var capped: Bool { clock != nil || (line.resets && line.reset != nil) }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 0) {
        Text(line.label)
          .font(ChromeType.sans(9, .semibold))
          .tracking(ChromeType.tracking(0.06, of: 9))
          .foregroundStyle(ChromePalette.inkTertiary)
          .lineLimit(1)
          .frame(width: Self.labelWidth, alignment: .leading)
        GeometryReader { geo in track(geo.size.width) }
          .frame(height: Self.height)
        cap
          .padding(.leading, Self.capGap)
      }
      .frame(height: Self.capHeight)
      if let forecast, let at = outAt {
        under { width in outMark(forecast, at: at, width: width) }
      } else if clock?.passed == true, let age {
        under { _ in
          Text(age)
            .font(ChromeType.sans(10, .medium))
            .monospacedDigit()
            .foregroundStyle(ChromePalette.inkTertiary)
            .lineLimit(1)
            .fixedSize()
            .frame(height: Self.underHeight)
        }
      }
    }
    .accessibilityElement()
    .accessibilityLabel(Self.words(line, clock: clock, forecast: forecast, age: age, form: form))
  }

  /// Where the window runs out on its own time, as a share of the track (the time gone over the share used): the
  /// forecast's own moment, before the reset at the track's end.
  private var outAt: CGFloat? {
    guard let elapsed = line.elapsedPercent, line.usedPercent > 0 else { return nil }
    return CGFloat(min(1, max(0, elapsed / line.usedPercent)))
  }

  /// The row under the bar, in the track's column alone: from 2 below the track's foot, 13 tall.
  private func under<Content: View>(@ViewBuilder _ content: @escaping (CGFloat) -> Content) -> some View {
    GeometryReader { geo in content(geo.size.width) }
      .frame(height: Self.underHeight)
      .padding(.leading, Self.labelWidth)
      .padding(.trailing, Self.capGap + Self.capWidth)
      // the track stands 1 inside the cap's 14, so its foot is 1 above the line's: the row starts 2 below the foot
      .padding(.top, Self.underGap - (Self.capHeight - Self.height) / 2)
      .accessibilityHidden(true)
  }

  /// The out mark: a tick where the window runs out, hanging just under the track (its top 1 below the track's foot,
  /// so 1 above the row's top), and its words beside it — ending 5 before the tick when they fit there, else starting
  /// 5 after it.
  private func outMark(_ words: String, at share: CGFloat, width: CGFloat) -> some View {
    let tick = width * share
    let fits = tick - Self.tickGap >= CGFloat(words.count) * Self.outCharacter
    return ZStack(alignment: .topLeading) {
      RoundedRectangle(cornerRadius: 1, style: .continuous)
        .fill(ChromePalette.attention)
        .frame(width: Self.tickWidth, height: Self.tickHeight)
        .offset(x: tick - Self.tickWidth / 2, y: Self.tickDrop - Self.underGap)
      Text(words)
        .font(ChromeType.sans(10.5, .semibold))
        .monospacedDigit()
        .foregroundStyle(ChromePalette.attention)
        .lineLimit(1)
        .fixedSize()
        .frame(width: fits ? max(0, tick - Self.tickGap) : nil, height: Self.underHeight, alignment: .trailing)
        .offset(x: fits ? 0 : tick + Self.tickGap)
    }
    .frame(width: width, height: Self.underHeight, alignment: .topLeading)
  }

  /// The end cap: the reset on the clock, its day before its time; empty and dashed once it has come; nothing for a
  /// budget or a window that names no reset, its column kept.
  @ViewBuilder
  private var cap: some View {
    if let clock {
      Self.capView(day: clock.passed ? "Reset" : clock.day, time: clock.time, spent: clock.passed)
    } else if line.resets, let reset = line.reset {
      // a line handed no clock says its reset's words in the cap's place
      Self.capView(day: nil, time: reset, spent: form == .now)
    } else {
      Color.clear.frame(width: Self.capWidth, height: Self.capHeight)
    }
  }

  /// A passed cap's word sits closer, so "RESET 12:30" holds inside the 64: its gap 2 and its tracking 0.02em, where a
  /// weekday's or a date's cap keeps 3 and 0.07em.
  private static func capView(day: String?, time: String?, spent: Bool) -> some View {
    let shape = UnevenRoundedRectangle(
      topLeadingRadius: 2, bottomLeadingRadius: 2, bottomTrailingRadius: capHeight / 2,
      topTrailingRadius: capHeight / 2, style: .continuous)
    return HStack(spacing: spent ? 2 : 3) {
      if let day {
        Text(day)
          .font(ChromeType.sans(7.5, .bold))
          .tracking(ChromeType.tracking(spent ? 0.02 : 0.07, of: 7.5))
          .textCase(.uppercase)
          .foregroundStyle(spent ? ChromePalette.inkTertiary : ChromePalette.inkSecondary)
      }
      if let time {
        Text(time)
          .font(ChromeType.sans(9.5, .semibold))
          .monospacedDigit()
          .foregroundStyle(spent ? ChromePalette.inkTertiary : ChromePalette.ink)
      }
    }
    .lineLimit(1)
    .minimumScaleFactor(0.8)
    .padding(.horizontal, 3)
    .frame(width: capWidth, height: capHeight)
    .background {
      if spent {
        // its place kept, empty: a 1 dashed ring in the ink at 28%, inside its edge
        shape
          .stroke(ChromePalette.ink.opacity(0.28), style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
          .padding(0.5)
      } else {
        shape.fill(ChromePalette.ink.opacity(0.15))
      }
    }
  }

  /// The line in words, as the desktop says it (§9 "The meters' words", UM-6): "5H: 91% used, resets at 15:00, in 1h,
  /// ahead of pace, out in ~25m"; on another day "resets Thu 12:00, in 2d 22h"; a week on "resets Dec 4, in 9d 3h";
  /// once it has come "reset at 12:30, as of 3h ago". A line handed no clock keeps the words it said before: "resets
  /// in 2h" by its length, "resets Thu 09:00" or "resets now" by its day or once it has come (the U3 review: never
  /// "resets in Thu 09:00"), or the reading's age in its reset's place.
  static func words(
    _ line: UsageLine, clock: ResetClock?, forecast: String? = nil, age: String? = nil,
    form: MeterRules.ResetForm? = nil
  ) -> String {
    let group = line.group.map { "\($0.label), " } ?? ""
    let reset: String
    if let clock {
      if clock.passed {
        reset = ", reset \(clock.saidAt)" + (age.map { ", \($0)" } ?? "")
      } else {
        reset = ", resets \(clock.saidAt)" + (clock.away.map { ", in \($0)" } ?? "")
      }
    } else if let age {
      reset = ", \(age)"
    } else {
      reset = line.reset.map { form == .length ? ", resets in \($0)" : ", resets \($0)" } ?? ""
    }
    let pace = line.hot ? ", ahead of pace" : ""
    let out = forecast.map { ", \($0)" } ?? ""
    return "\(group)\(line.label): \(wholeWords(line.usedPercent))% used\(reset)\(pace)\(out)"
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
    // the track runs square-ended into its cap; with none it keeps its round end
    let end: CGFloat = capped ? 0 : 4
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
    .clipShape(
      UnevenRoundedRectangle(
        topLeadingRadius: 4, bottomLeadingRadius: 4, bottomTrailingRadius: end, topTrailingRadius: end,
        style: .continuous))
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
