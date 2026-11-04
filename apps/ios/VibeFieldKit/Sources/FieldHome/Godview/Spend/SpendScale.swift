import Foundation

// PG-7 — SPEND'S SCALES, transcribed from puppeteer-views 0.3.3 at the pin `52d09c8e` (the spend module `5abe8f75`):
// `src/views/spend/spend-scale.ts` :7-95 (dist `spend-scale.js` :6-70). Money up the right of the plot, linear from $0
// to a round top (SV-D8, no Log); time along the foot over the last ten minutes Core holds, always ending at now
// (runtime only, §B′: no ranges, no pan, no zoom). JavaScript's double arithmetic in its own order; held to
// `phone-spend.golden.json` (SpendParityTests P5, V0, V2, V3).

enum SpendScale {
  static let minute = 60_000.0
  /// A cost series' step and its length, as the model carries them (`MonitorCost.series`: 20 × 30 s).
  static let stepMs = 30_000.0
  static let stepCount = 20.0
  /// The window: the nine and a half minutes every row's buckets always cover (`SPEND_WINDOW_MS`).
  static let windowMs = (stepCount - 1) * stepMs
  /// A tick every two minutes.
  static let timeTickMs = 2 * minute

  struct Window: Equatable, Sendable {
    let ta: Double
    let tb: Double
  }

  struct Tick: Equatable, Sendable {
    let t: Double
    let x: Double
  }

  /// `spendWindow` (:27): the last window, ending at now.
  static func spendWindow(nowMs: Double) -> Window { Window(ta: nowMs - windowMs, tb: nowMs) }

  /// `momentIn` (:30): a moment the pointer reads or a click sets, never outside the window.
  static func momentIn(_ t: Double, _ span: Window) -> Double { Swift.min(span.tb, Swift.max(span.ta, t)) }

  /// `heldIn` (:33): a moment a click set, while the window holds it; once the window has slid past, it lets go.
  static func heldIn(_ held: Double?, _ span: Window) -> Double? {
    guard let held, held >= span.ta, held <= span.tb else { return nil }
    return held
  }

  /// `niceStep` (:37): the step that puts about `count` round lines under `max` — 1, 2, 2.5 or 5 of a power of ten.
  static func niceStep(_ max: Double, _ count: Double) -> Double {
    let raw = Swift.max(max, 1e-6) / count
    let power = pow(10, log10(raw).rounded(.down))
    let fraction = raw / power
    let unit: Double = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
    return unit * power
  }

  /// `moneyScale` (:45): the step and its round top for the highest line — at least half a dollar, 6% of air above.
  static func moneyScale(top: Double, compact: Bool) -> (step: Double, max: Double) {
    let high = Swift.max(0.5, top) * 1.06
    let step = niceStep(high, compact ? 3 : 7)
    return (step, (high / step).rounded(.up) * step)
  }

  /// `easeTop` (:52): one frame of the eased top — a new high never jumps (0.18 a frame).
  static func easeTop(shown: Double?, target: Double) -> Double {
    guard let shown else { return target }
    let next = shown + (target - shown) * 0.18
    return abs(target - next) <= target * 0.002 ? target : next
  }

  /// `moneyTicks` (:59): the money ticks from $0 to the top, each cleaned to six places (`+value.toFixed(6)`).
  static func moneyTicks(max: Double, step: Double) -> [Double] {
    var out: [Double] = []
    var value = 0.0
    while value <= max + 1e-9 {
      out.append(Double(SpendNumber.fixed(value, 6)) ?? value)
      value += step
    }
    return out
  }

  /// `timeTicks` (:73): every two minutes inside [ta, tb], every four (and on) where labels would touch; none by the
  /// left edge or within `clear` px of a chip.
  static func timeTicks(
    ta: Double, tb: Double, x0: Double, x1: Double, chips: [Double], clear: Double = 46
  ) -> [Tick] {
    let perMs = (x1 - x0) / Swift.max(1, tb - ta)
    var step = timeTickMs
    while step * perMs < 48 { step *= 2 }
    var out: [Tick] = []
    var t = (ta / step).rounded(.up) * step
    while t <= tb {
      let x = x0 + (t - ta) * perMs
      if !(x < x0 + 18 || chips.contains(where: { abs(x - $0) < clear })) { out.append(Tick(t: t, x: x)) }
      t += step
    }
    return out
  }
}
