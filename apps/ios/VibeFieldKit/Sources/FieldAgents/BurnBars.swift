// The burn bars' data — the reference's `burn-bars.ts`: the ledger's steps as
// column heights, oldest first, the newest at the right. Each side is scaled to
// its own tallest column, so the chart always fills the band and reads as the
// session's rhythm rather than its place on an absolute scale. The shape here
// is exactly what the body shader samples: one value per column, both sides.

/// One column per ledger step: twenty, ten minutes.
public let burnBarCount = usageStepCount

public struct BurnBars: Equatable, Sendable {
  /// The completion side (output, reasoning), 0 to 1 against its tallest column.
  public var up: [Double]
  /// The prompt side (input, cache), 0 to 1 against its tallest column.
  public var down: [Double]
  /// Whether the source split its usage; without a split `up` is the total and `down` rests.
  public var split: Bool

  public init(up: [Double], down: [Double], split: Bool) {
    self.up = up
    self.down = down
    self.split = split
  }
}

/// Heights against the tallest step; all zero while nothing has burned.
public func scaledBars(_ steps: [Double]) -> [Double] {
  var bars = [Double](repeating: 0, count: burnBarCount)
  let tallest = steps.max() ?? 0
  guard tallest > 0 else { return bars }
  let offset = burnBarCount - steps.count
  for (index, step) in steps.enumerated() where offset + index >= 0 && offset + index < burnBarCount {
    bars[offset + index] = max(0, step) / tallest
  }
  return bars
}

/// Output up, input down when the source splits its usage; otherwise the whole
/// burn up and nothing down.
public func burnBars(_ history: UsageHistory) -> BurnBars {
  if let sides = history.sides {
    return BurnBars(up: scaledBars(sides.output), down: scaledBars(sides.input), split: true)
  }
  return BurnBars(
    up: scaledBars(history.steps), down: [Double](repeating: 0, count: burnBarCount), split: false)
}
