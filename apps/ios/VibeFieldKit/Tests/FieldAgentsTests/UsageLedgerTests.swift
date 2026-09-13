import Foundation
import Testing

@testable import FieldAgents

// The reference's `usage-ledger.test.ts` and `burn-bars.test.ts`, transcribed.

private let t0: Double = 1_789_120_800_000  // 2026-09-11T10:00:00Z, epoch ms

private func usage(_ cumulative: Double? = nil, _ rest: (inout AgentUsage) -> Void = { _ in }) -> AgentUsage {
  var value = AgentUsage(cumulativeTokens: cumulative)
  rest(&value)
  return value
}

private func fold(
  _ ledger: UsageLedger, _ at: Double, _ total: Double? = nil,
  _ rest: (inout AgentUsage) -> Void = { _ in }
) -> UsageLedger {
  ledger.reconciling([UsageReading(id: "a", usage: usage(total, rest))], nowMs: at)
}

private func history(_ ledger: UsageLedger) -> UsageHistory { ledger.history(of: "a")! }
private func steps(_ ledger: UsageLedger, _ count: Int = 3) -> [Double] {
  Array(history(ledger).steps.suffix(count))
}

@Suite struct UsageLedgerTests {
  @Test func keepsNoLedgerForATerminalWithoutAnAgentAndDropsAgentsThatLeft() {
    var ledger = UsageLedger.empty.reconciling(
      [UsageReading(id: "shell"), UsageReading(id: "a", usage: usage(10))], nowMs: t0)
    #expect(ledger.history(of: "shell") == nil)
    #expect(history(ledger).total == 10)
    ledger = ledger.reconciling([UsageReading(id: "b", usage: usage(1))], nowMs: t0 + 1000)
    #expect(ledger.history(of: "a") == nil)
  }

  @Test func holdsTheLastNumberWhenTheSourceBlanksOrFallsToNothing() {
    var ledger = fold(.empty, t0, 1_200)
    ledger = fold(ledger, t0 + 1_000, nil)
    #expect(history(ledger).total == 1_200)
    ledger = fold(ledger, t0 + 2_000, 0)
    ledger = fold(ledger, t0 + usageStepMs * 3, 0)
    #expect(history(ledger).total == 1_200)
    ledger = fold(ledger, t0 + usageStepMs * 3 + 1, 1_300)
    #expect(history(ledger).total == 1_300)
  }

  @Test func showsALowerNumberOnlyOnceTheSourceHasStoodBehindItForAStep() {
    var ledger = fold(.empty, t0, 5_000)
    ledger = fold(ledger, t0 + 1_000, 4_000)
    #expect(history(ledger).total == 5_000)
    // A passing excursion: the source agrees again before the grace ends.
    ledger = fold(ledger, t0 + 2_000, 5_100)
    #expect(history(ledger).total == 5_100)
    ledger = fold(ledger, t0 + 3_000, 4_000)
    ledger = fold(ledger, t0 + 3_000 + usageCorrectionGraceMs - 1, 4_100)
    #expect(history(ledger).total == 5_100)
    ledger = fold(ledger, t0 + 3_000 + usageCorrectionGraceMs, 4_100)
    #expect(history(ledger).total == 4_100)
  }

  @Test func snapshotsTheTotalAtEveryStepAndReportsWhatEachStepBurnedOldestFirst() {
    let start = t0 - t0.truncatingRemainder(dividingBy: usageStepMs) + 5_000
    var ledger = fold(.empty, start, 1_000)
    #expect(history(ledger).steps.count == usageStepCount)
    #expect(history(ledger).steps.allSatisfy { $0 == 0 })
    ledger = fold(ledger, start + 10_000, 1_400)
    #expect(steps(ledger) == [0, 0, 0])
    ledger = fold(ledger, start + usageStepMs, 1_600)
    #expect(steps(ledger) == [0, 0, 600])
    ledger = fold(ledger, start + 2 * usageStepMs + 100, 1_900)
    #expect(steps(ledger) == [0, 600, 300])
    ledger = fold(ledger, start + 3 * usageStepMs + 100, 1_900)
    #expect(steps(ledger) == [600, 300, 0])
  }

  @Test func spreadsGrowthEvenlyOverStepsAThrottledClockMissed() {
    let start = t0 - t0.truncatingRemainder(dividingBy: usageStepMs)
    var ledger = fold(.empty, start, 0)
    ledger = fold(ledger, start + 4 * usageStepMs, 1_200)
    #expect(steps(ledger, 4) == [300, 300, 300, 300])
  }

  @Test func keepsTenMinutesTheOldestStepFallsOffTheLeft() {
    let start = t0 - t0.truncatingRemainder(dividingBy: usageStepMs)
    var ledger = fold(.empty, start, 0)
    for step in 1...(usageStepCount + 5) {
      ledger = fold(ledger, start + Double(step) * usageStepMs, Double(step) * 100)
    }
    #expect(history(ledger).steps.count == usageStepCount)
    #expect(history(ledger).steps.allSatisfy { $0 == 100 })
    #expect(history(ledger).total == Double(usageStepCount + 5) * 100)
  }

  @Test func neverReportsANegativeStepForACorrectionDownward() {
    let start = t0 - t0.truncatingRemainder(dividingBy: usageStepMs)
    var ledger = fold(.empty, start, 5_000)
    ledger = fold(ledger, start + usageStepMs, 4_000)
    ledger = fold(ledger, start + 2 * usageStepMs, 4_000)
    #expect(steps(ledger).allSatisfy { $0 >= 0 })
    #expect(history(ledger).total == 4_000)
  }

  @Test func keepsBothSidesOnceTheSourceSplitsTheBurnFromTheAggregateOrTheLastSample() {
    let start = t0 - t0.truncatingRemainder(dividingBy: usageStepMs)
    var ledger = fold(.empty, start, 1_000) {
      $0.inputTokens = 500
      $0.cacheReadTokens = 300
      $0.outputTokens = 150
      $0.reasoningTokens = 50
    }
    #expect(history(ledger).sides != nil)
    ledger = fold(ledger, start + usageStepMs, 2_000) {
      $0.inputTokens = 1_200
      $0.cacheReadTokens = 500
      $0.outputTokens = 250
      $0.reasoningTokens = 50
    }
    #expect(history(ledger).sides?.input.last == 900)
    #expect(history(ledger).sides?.output.last == 100)
    // A reading without the split keeps the sides at their last value.
    ledger = fold(ledger, start + 2 * usageStepMs, 2_400)
    #expect(history(ledger).sides?.input.last == 0)
    #expect(history(ledger).steps.last == 400)

    let sampled = UsageLedger.empty.reconciling(
      [
        UsageReading(
          id: "a",
          usage: AgentUsage(
            cumulativeTokens: 80,
            samples: [
              AgentUsageSample(
                at: Date(timeIntervalSince1970: start / 1000), cumulativeTokens: 80,
                inputTokens: 60, outputTokens: 20)
            ]))
      ], nowMs: start)
    #expect(history(sampled).sides != nil)
  }
}

@Suite struct UsagePersistenceTests {
  private let start = t0 - t0.truncatingRemainder(dividingBy: usageStepMs)
  private let key = UsageLedgerKey(id: "a", providerId: "claude", nativeSessionId: "native-a")

  @Test func exportsOneRecordPerConversationWithANumberToKeepAndSeedsItBackRebasedToNow() {
    var ledger = fold(.empty, start, 1_000) {
      $0.inputTokens = 800
      $0.outputTokens = 200
    }
    ledger = fold(ledger, start + usageStepMs, 1_600) {
      $0.inputTokens = 1_300
      $0.outputTokens = 300
    }
    ledger = fold(ledger, start + 2 * usageStepMs, 1_900) {
      $0.inputTokens = 1_500
      $0.outputTokens = 400
    }
    let records = ledger.exported(
      [key, UsageLedgerKey(id: "ghost", providerId: "claude", nativeSessionId: "x")], nowMs: start)
    #expect(records.count == 1)
    let record = records[0]
    #expect(record.providerId == "claude")
    #expect(record.nativeSessionId == "native-a")
    #expect(record.boundary == Int(((start + 2 * usageStepMs) / usageStepMs).rounded(.down)))
    #expect(record.total.held == 1_900)
    #expect(record.total.snapshots == [1_000, 1_600, 1_900])
    #expect(record.output?.held == 400)
    #expect(record.input?.held == 1_500)

    // Resumed three steps later with the same number: the old bars shift left, the gap is silent.
    let later = start + 5 * usageStepMs
    let seeded = UsageLedger.empty.seeded("b", with: record, nowMs: later)
    #expect(seeded.history(of: "b")?.total == 1_900)
    #expect(Array(seeded.history(of: "b")!.steps.suffix(5)) == [600, 300, 0, 0, 0])
    #expect(Array(seeded.history(of: "b")!.sides!.output.suffix(5)) == [100, 100, 0, 0, 0])

    // Resumed with a live number already higher: the growth is spread over the gap.
    let live = fold(.empty, later, 2_200)
    let grown = live.seeded("a", with: record, nowMs: later)
    #expect(grown.history(of: "a")?.total == 2_200)
    #expect(Array(grown.history(of: "a")!.steps.suffix(5)) == [600, 300, 100, 100, 100])
  }

  @Test func readsALowerLiveNumberThroughTheHoldRuleAndLeavesALedgerWithItsOwnStepsAlone() {
    var ledger = fold(.empty, start, 1_000)
    ledger = fold(ledger, start + usageStepMs, 1_600)
    let record = ledger.exported([key], nowMs: start + usageStepMs)[0]
    // A source still catching up reports less than was shown: the saved figure stands.
    let partial = fold(.empty, start + 3 * usageStepMs, 900)
    let seeded = partial.seeded("a", with: record, nowMs: start + 3 * usageStepMs)
    #expect(seeded.history(of: "a")?.total == 1_600)
    // A ledger that has recorded a burn of its own is already the record; one
    // that has only sat through silent boundaries still takes the seed.
    var settled = fold(.empty, start + 3 * usageStepMs, 5_000)
    settled = fold(settled, start + 4 * usageStepMs, 5_500)
    #expect(settled.seeded("a", with: record, nowMs: start + 4 * usageStepMs) == settled)
    var silent = fold(.empty, start + 3 * usageStepMs, 1_600)
    silent = fold(silent, start + 4 * usageStepMs, 1_600)
    #expect(
      Array(silent.seeded("a", with: record, nowMs: start + 4 * usageStepMs).history(of: "a")!.steps.suffix(4))
        == [600, 0, 0, 0])
  }

  @Test func survivesAResumeHoursLaterWithoutWalkingEveryStepInBetween() {
    let ledger = fold(.empty, start, 1_000)
    let record = ledger.exported([key], nowMs: start)[0]
    let seeded = UsageLedger.empty.seeded("a", with: record, nowMs: start + 6 * 60 * 60_000)
    #expect(seeded.history(of: "a")?.steps.count == usageStepCount)
    #expect(seeded.history(of: "a")?.total == 1_000)
  }

  @Test func recordsRoundTripThroughJSON() throws {
    let record = UsageLedgerRecord(
      providerId: "claude", nativeSessionId: "n", savedAt: "2026-09-13T00:00:00.000Z", boundary: 12,
      total: UsageSeriesRecord(held: 10, snapshots: [1, 10]), output: UsageSeriesRecord(snapshots: []))
    let data = try JSONEncoder().encode(record)
    #expect(try JSONDecoder().decode(UsageLedgerRecord.self, from: data) == record)
  }
}

@Suite struct BurnBarsTests {
  private func steps(_ values: Double...) -> [Double] {
    [Double](repeating: 0, count: usageStepCount - values.count) + values
  }

  @Test func scalesEveryColumnToTheTallestAndRestsWhenNothingBurned() {
    #expect(burnBarCount == usageStepCount)
    let bars = scaledBars(steps(100, 400, 200))
    #expect(bars.count == burnBarCount)
    #expect(bars[burnBarCount - 2] == 1)
    #expect(abs(bars[burnBarCount - 3] - 0.25) < 1e-6)
    #expect(abs(bars[burnBarCount - 1] - 0.5) < 1e-6)
    #expect(scaledBars(steps()).allSatisfy { $0 == 0 })
  }

  @Test func putsOutputUpAndInputDownWhenTheSourceSplitsItsUsage() {
    let bars = burnBars(
      UsageHistory(
        total: 6_000, steps: steps(600, 300),
        sides: UsageSides(output: steps(100, 50), input: steps(500, 250))))
    #expect(bars.split)
    #expect(bars.up[burnBarCount - 2] == 1)
    #expect(bars.up[burnBarCount - 1] == 0.5)
    #expect(bars.down[burnBarCount - 1] == 0.5)
  }

  @Test func putsTheWholeBurnUpAndNothingDownWithoutASplit() {
    let bars = burnBars(UsageHistory(total: 900, steps: steps(300, 600)))
    #expect(!bars.split)
    #expect(bars.up[burnBarCount - 1] == 1)
    #expect(bars.down.max() == 0)
  }
}
