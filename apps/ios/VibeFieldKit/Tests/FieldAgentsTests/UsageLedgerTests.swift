import Foundation
import Testing

@testable import FieldAgents

// The reference's `usage-ledger.test.ts` after RFC 008 (USD display history),
// transcribed.

private let t0: Double = 1_789_560_000_000  // 2026-09-16T12:00:00Z, epoch ms
private let session = UsageHistoryKey(providerId: "claude", nativeSessionId: "session")

private func usage(_ costUsd: Double, at: Double = t0) -> AgentUsage {
  AgentUsage(
    costUsd: costUsd, costCoverage: .complete,
    costHistory: [AgentCostBucket(at: Date(timeIntervalSince1970: at / 1000), costUsd: costUsd)])
}

private func reading(
  _ costUsd: Double, _ runId: String = "run-1", at: Double = t0, revision: Int? = nil,
  session: UsageHistoryKey? = session
) -> UsageReading {
  UsageReading(id: "a", runId: runId, revision: revision, session: session, usage: usage(costUsd, at: at))
}

private func history(_ ledger: UsageLedger) -> UsageHistory? { ledger.history(of: "a") }
private let key = UsageLedgerKey(id: "a", providerId: "claude", nativeSessionId: "session")

@Suite struct UsageLedgerTests {
  @Test func neverSubstitutesTokensForUSDOrInventsAZeroPrice() {
    let ledger = UsageLedger.empty.reconciling(
      [UsageReading(id: "a", usage: AgentUsage(cumulativeTokens: 1_000_000)), UsageReading(id: "shell")], nowMs: t0)
    #expect(history(ledger)?.coverage == .unavailable)
    #expect(history(ledger)?.total == nil)
    #expect(ledger.history(of: "shell") == nil)
  }

  @Test func reflectsCorrectionsImmediatelyIncludingZeroInTheirOriginalBucket() {
    var ledger = UsageLedger.empty.reconciling([reading(2)], nowMs: t0)
    ledger = ledger.reconciling([reading(1)], nowMs: t0 + usageStepMs)
    #expect(history(ledger)?.total == 1)
    #expect(Array(history(ledger)!.steps.suffix(2)) == [1, 0])
    ledger = ledger.reconciling([reading(3)], nowMs: t0 + usageStepMs * 2)
    #expect(Array(history(ledger)!.steps.suffix(3)) == [3, 0, 0])
    ledger = ledger.reconciling([reading(0)], nowMs: t0 + usageStepMs * 3)
    #expect(history(ledger)?.total == 0)
    #expect(history(ledger)!.steps.allSatisfy { $0 == 0 })
  }

  @Test func agesEventBucketsWithoutInterpolatingAThrottledUIOrAResumedSession() {
    let ledger = UsageLedger.empty.reconciling([reading(2)], nowMs: t0)
    let record = ledger.exported([key], nowMs: t0)[0]
    let seeded = UsageLedger.empty.seeded("a", with: record, nowMs: t0 + 60 * 60_000)
    #expect(history(seeded)?.total == 2)
    #expect(history(seeded)!.steps.allSatisfy { $0 == 0 })
  }

  @Test func deduplicatesTheSameRunPreservesALateLiveCorrectionAndAddsANewObservedRunOnce() {
    let old = UsageLedger.empty.reconciling([reading(2)], nowMs: t0)
    let record = old.exported([key], nowMs: t0)[0]
    let corrected = UsageLedger.empty.reconciling([reading(1)], nowMs: t0)
    #expect(history(corrected.seeded("a", with: record, nowMs: t0))?.total == 1)
    var resumed = UsageLedger.empty.reconciling([reading(0.5, "run-2")], nowMs: t0)
    resumed = resumed.seeded("a", with: record, nowMs: t0)
    resumed = resumed.seeded("a", with: record, nowMs: t0)
    #expect(history(resumed)?.total == 2.5)
  }

  @Test func marksMissingObservationsPartial() {
    var partial = usage(0.2)
    partial.costCoverage = .partial
    let ledger = UsageLedger.empty.reconciling([UsageReading(id: "a", usage: partial)], nowMs: t0)
    #expect(history(ledger)?.total == 0.2)
    #expect(history(ledger)?.coverage == .partial)
  }

  @Test func isolatesADifferentConversationReusingTheSameVisualIdentity() {
    let old = UsageLedger.empty.reconciling([reading(2)], nowMs: t0)
    let cached = old.exported([key], nowMs: t0)[0]
    let nextSession = UsageHistoryKey(providerId: "claude", nativeSessionId: "different-session")
    var next = old.reconciling([reading(0.5, "run-2", session: nextSession)], nowMs: t0)
    #expect(history(next)?.total == 0.5)
    next = next.seeded("a", with: cached, nowMs: t0)
    #expect(history(next)?.total == 0.5)
    #expect(next.exported([key], nowMs: t0).isEmpty)
  }

  @Test func exportsOnlyTheAuthoritativeLiveRunNeverStaleCopiesOfSeededRuns() {
    let old = UsageLedger.empty.reconciling([reading(2)], nowMs: t0)
    let cached = old.exported([key], nowMs: t0)[0]
    let live = UsageLedger.empty.reconciling([reading(0.5, "run-2", revision: 4)], nowMs: t0)
    let seeded = live.seeded("a", with: cached, nowMs: t0)
    let saved = seeded.exported([key], nowMs: t0)[0]
    #expect(history(seeded)?.total == 2.5)
    #expect(saved.runs.map(\.runId) == ["run-2"])
    #expect(saved.runs[0].costUsd == 0.5 && saved.runs[0].revision == 4)
    #expect(saved.currency == "USD")
  }

  @Test func keepsARunsHistoryAcrossProjectionsWithoutASessionAndDropsItWhenTheRunChanges() {
    // The phone's fold names the run and never the native session: the same
    // run continues its runs; a new run on the same bubble starts afresh.
    var ledger = UsageLedger.empty.reconciling([reading(2, "run-1", session: nil)], nowMs: t0)
    ledger = ledger.reconciling([reading(3, "run-1", session: nil)], nowMs: t0 + usageStepMs)
    #expect(history(ledger)?.total == 3)
    ledger = ledger.reconciling([reading(0.25, "run-2", session: nil)], nowMs: t0 + usageStepMs * 2)
    #expect(history(ledger)?.total == 0.25)
    #expect(ledger.exported([key], nowMs: t0).isEmpty)
  }

  @Test func distinguishesUnavailableZeroAndSubCentUSDEstimates() {
    #expect(formatUsd(nil) == "—")
    #expect(formatUsd(0) == "$0.00")
    #expect(formatUsd(0.0001) == "<$0.001")
    #expect(formatUsd(0.005) == "$0.005")
    #expect(formatUsd(1.24) == "$1.24")
    #expect(formatUsd(1234.5) == "$1,234.50")
  }

  @Test func recordsRoundTripThroughJSON() throws {
    let record = UsageLedgerRecord(
      providerId: "claude", nativeSessionId: "n", savedAt: "2026-09-16T12:00:00.000Z",
      runs: [
        UsageRunRecord(
          runId: "run-1", revision: 2, costUsd: 0.5, coverage: .complete,
          buckets: [AgentCostBucket(at: Date(timeIntervalSince1970: t0 / 1000), costUsd: 0.5)])
      ])
    let data = try JSONEncoder().encode(record)
    #expect(try JSONDecoder().decode(UsageLedgerRecord.self, from: data) == record)
  }
}
