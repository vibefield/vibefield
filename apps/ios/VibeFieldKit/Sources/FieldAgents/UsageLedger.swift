import Foundation

// The UI's USD display history — the reference's `monitor/usage-ledger.ts`
// and `usage-history.ts` after RFC 008 (2026-09-17), transcribed.
//
// Core owns the accounting. Every run it observes carries a corrected estimate
// in API-equivalent USD, its coverage (complete · partial · unavailable — a
// missing pricing lane is UNAVAILABLE, never zero dollars), and its spend in
// fixed thirty-second buckets. This ledger keeps those runs per bubble and
// projects the number the screen shows: the corrected total across a bubble's
// runs, cached ones included, and the buckets as the last ten minutes of
// steps. UI snapshots can neither mint spend nor suppress corrections — there
// is no hold rule and no interpolation any more; a correction lands in the
// bucket it belongs to, including a correction to zero.

/// The bucket: Core's step, and one bar of history is one bucket.
public let usageStepMs: Double = 30_000
/// Twenty steps: the ten minutes of history the swarm keeps.
public let usageStepCount = 20

/// What the views read, one per agent with a ledger.
public struct UsageHistory: Equatable, Sendable {
  /// Estimated API-equivalent USD for work observed across these runs.
  public var total: Double?
  public var coverage: AgentCostCoverage?
  /// Corrected USD in fixed time buckets, oldest first.
  public var steps: [Double]
  public var stepMs: Double

  public init(
    total: Double? = nil, coverage: AgentCostCoverage? = nil, steps: [Double], stepMs: Double = usageStepMs
  ) {
    self.total = total
    self.coverage = coverage
    self.steps = steps
    self.stepMs = stepMs
  }
}

/// The identity a resume continues: the provider and its native session id.
public struct UsageHistoryKey: Equatable, Sendable, Codable {
  public var providerId: String
  public var nativeSessionId: String

  public init(providerId: String, nativeSessionId: String) {
    self.providerId = providerId
    self.nativeSessionId = nativeSessionId
  }
}

/// What one projection says about one agent's usage: Core's aggregate in the
/// mirror's own field names (`AgentUsage`), and the run it belongs to.
public struct UsageReading: Sendable {
  /// The agent's stable monitor identity.
  public var id: String
  /// The live run; the identity itself when the feed names none.
  public var runId: String?
  /// Core's monitor revision; a delayed snapshot cannot undo a correction.
  public var revision: Int?
  public var session: UsageHistoryKey?
  /// Core's usage; absent for a terminal no agent has claimed, which keeps no ledger.
  public var usage: AgentUsage?

  public init(
    id: String, runId: String? = nil, revision: Int? = nil, session: UsageHistoryKey? = nil,
    usage: AgentUsage? = nil
  ) {
    self.id = id
    self.runId = runId
    self.revision = revision
    self.session = session
    self.usage = usage
  }
}

/// A cache of independently observed USD runs. Never reconstructed from transcripts.
public struct UsageRunRecord: Equatable, Sendable, Codable {
  public var runId: String
  /// Core monitor revision; a delayed snapshot cannot undo a correction.
  public var revision: Int?
  public var costUsd: Double?
  public var coverage: AgentCostCoverage
  public var buckets: [AgentCostBucket]

  public init(
    runId: String, revision: Int? = nil, costUsd: Double? = nil, coverage: AgentCostCoverage,
    buckets: [AgentCostBucket]
  ) {
    self.runId = runId
    self.revision = revision
    self.costUsd = costUsd
    self.coverage = coverage
    self.buckets = buckets
  }
}

struct UsageEntry: Equatable, Sendable {
  var session: UsageHistoryKey?
  var liveRunId: String?
  var runs: [String: UsageRunRecord]
}

public struct UsageLedger: Equatable, Sendable {
  var entries: [String: UsageEntry]
  /// What the views read, one per agent with a ledger.
  public private(set) var histories: [String: UsageHistory]

  init(entries: [String: UsageEntry], histories: [String: UsageHistory]) {
    self.entries = entries
    self.histories = histories
  }

  public static let empty = UsageLedger(entries: [:], histories: [:])
}

/// Two absent sessions are the same session; one absent and one present are not.
private func sameSession(_ left: UsageHistoryKey?, _ right: UsageHistoryKey?) -> Bool {
  left?.providerId == right?.providerId && left?.nativeSessionId == right?.nativeSessionId
}

private func boundary(at ms: Double) -> Int {
  Int((ms / usageStepMs).rounded(.down))
}

private func historyOf(_ entry: UsageEntry, nowMs: Double) -> UsageHistory {
  var steps = [Double](repeating: 0, count: usageStepCount)
  let now = boundary(at: nowMs)
  var total: Double?
  var partial = false
  for run in entry.runs.values {
    if let cost = run.costUsd { total = (total ?? 0) + cost }
    if run.coverage != .complete { partial = true }
    for bucket in run.buckets {
      let index = usageStepCount - 1 - (now - boundary(at: bucket.at.timeIntervalSince1970 * 1000))
      if index < 0 || index >= usageStepCount { continue }
      steps[index] += bucket.costUsd
    }
  }
  return UsageHistory(
    total: total,
    coverage: total == nil ? .unavailable : partial ? .partial : .complete,
    steps: steps,
    stepMs: usageStepMs)
}

extension UsageLedger {
  /// Fold one projection into the ledger. Core owns the accounting: UI
  /// snapshots can neither mint spend nor suppress corrections.
  public func reconciling(_ readings: [UsageReading], nowMs: Double) -> UsageLedger {
    var entries: [String: UsageEntry] = [:]
    var histories: [String: UsageHistory] = [:]
    for reading in readings {
      guard let usage = reading.usage else { continue }
      let runId = reading.runId ?? reading.id
      let prior = self.entries[reading.id]
      // A stable bubble can outlive its provider conversation. An initially
      // unknown native id may be filled in only for the same live run.
      let continuesRun = prior?.liveRunId == runId
      let session = reading.session ?? (continuesRun ? prior?.session : nil)
      let retainsHistory =
        (session != nil && sameSession(prior?.session, session)) || (continuesRun && prior?.session == nil)
      var runs = retainsHistory ? (prior?.runs ?? [:]) : [:]
      runs[runId] = UsageRunRecord(
        runId: runId,
        revision: reading.revision,
        costUsd: usage.costUsd,
        coverage: usage.costCoverage ?? .unavailable,
        buckets: usage.costHistory)
      let entry = UsageEntry(session: session, liveRunId: runId, runs: runs)
      entries[reading.id] = entry
      histories[reading.id] = historyOf(entry, nowMs: nowMs)
    }
    return UsageLedger(entries: entries, histories: histories)
  }

  public func history(of id: String) -> UsageHistory? { histories[id] }
}

// MARK: - Persistence (the reference's `usage-history.ts`)

/// Optional display-history persistence for one conversation, not a provider
/// billing record: the runs a host keeps so a resumed session opens with the
/// total it had. Losing it costs nothing but prior observed history.
public struct UsageLedgerRecord: Codable, Equatable, Sendable {
  public var currency: String
  public var providerId: String
  public var nativeSessionId: String
  /// ISO time of the save.
  public var savedAt: String
  public var runs: [UsageRunRecord]

  public init(
    currency: String = "USD", providerId: String, nativeSessionId: String, savedAt: String,
    runs: [UsageRunRecord]
  ) {
    self.currency = currency
    self.providerId = providerId
    self.nativeSessionId = nativeSessionId
    self.savedAt = savedAt
    self.runs = runs
  }
}

public struct UsageLedgerKey: Sendable {
  /// The agent's stable monitor identity, the ledger's key.
  public var id: String
  public var providerId: String
  public var nativeSessionId: String

  public init(id: String, providerId: String, nativeSessionId: String) {
    self.id = id
    self.providerId = providerId
    self.nativeSessionId = nativeSessionId
  }

  var session: UsageHistoryKey { UsageHistoryKey(providerId: providerId, nativeSessionId: nativeSessionId) }
}

extension UsageLedger {
  /// The records worth keeping: only this monitor's authoritative live run per
  /// conversation. Cached runs may have been corrected by another renderer, so
  /// they are never written back.
  public func exported(_ keys: [UsageLedgerKey], nowMs: Double) -> [UsageLedgerRecord] {
    // Built per call: the formatter is not Sendable and this is a rare path.
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let savedAt = formatter.string(from: Date(timeIntervalSince1970: nowMs / 1000))
    var records: [UsageLedgerRecord] = []
    for key in keys {
      guard let entry = entries[key.id], sameSession(entry.session, key.session), let liveRunId = entry.liveRunId,
        let live = entry.runs[liveRunId]
      else { continue }
      records.append(
        UsageLedgerRecord(
          providerId: key.providerId, nativeSessionId: key.nativeSessionId, savedAt: savedAt, runs: [live]))
    }
    return records
  }

  /// Same-run values replace cached values; new runs add only independently
  /// observed work. A record for another conversation on the same visual
  /// identity is refused.
  public func seeded(_ id: String, with record: UsageLedgerRecord, nowMs: Double) -> UsageLedger {
    guard record.currency == "USD" else { return self }
    let session = UsageHistoryKey(providerId: record.providerId, nativeSessionId: record.nativeSessionId)
    let liveEntry = entries[id]
    if let liveSession = liveEntry?.session, !sameSession(liveSession, session) { return self }
    var runs: [String: UsageRunRecord] = [:]
    for run in record.runs { runs[run.runId] = run }
    for (runId, live) in liveEntry?.runs ?? [:] { runs[runId] = live }
    let entry = UsageEntry(session: session, liveRunId: liveEntry?.liveRunId, runs: runs)
    var entries = self.entries
    var histories = self.histories
    entries[id] = entry
    histories[id] = historyOf(entry, nowMs: nowMs)
    return UsageLedger(entries: entries, histories: histories)
  }
}
