import Foundation

// The UI's own account of each agent's token usage — the reference's
// `monitor/usage-ledger.ts`, transcribed.
//
// Core's usage is a corrected estimate: every source that reports moves it, and
// a resync, a reconciliation between two sources, or a source dropping out can
// lower it or blank it for a moment. A figure on screen must not follow those
// excursions, and a chart must not be re-derived from a sliding window of raw
// samples on every frame. So the views read this ledger instead of Core's
// usage: one series per agent that holds the last number the source stood
// behind, snapshotted at every fixed step, from which the bars are the tokens
// each step burned. The ledger is a fold over successive projections, like
// `UnreadLedger`, and the only usage state the UI keeps.

/// The step: the total is snapshotted this often, and one bar is one step.
public let usageStepMs: Double = 30_000
/// Twenty steps: the ten minutes of history the swarm's bars show.
public let usageStepCount = 20
/// A lower reading is shown once it has stood this long; until then the source
/// is treated as having dropped out.
public let usageCorrectionGraceMs: Double = usageStepMs

public struct UsageHistory: Equatable, Sendable {
  /// The presented total: the last number the source stood behind. Absent
  /// until a source reports one.
  public var total: Double?
  /// Tokens burned in each of the last `usageStepCount` steps, oldest first;
  /// zero where nothing is known.
  public var steps: [Double]
  /// The two sides of the burn when the source splits it: completion (output,
  /// reasoning) and prompt (input, cache).
  public var sides: UsageSides?
  public var stepMs: Double

  public init(total: Double? = nil, steps: [Double], sides: UsageSides? = nil, stepMs: Double = usageStepMs) {
    self.total = total
    self.steps = steps
    self.sides = sides
    self.stepMs = stepMs
  }
}

public struct UsageSides: Equatable, Sendable {
  public var output: [Double]
  public var input: [Double]

  public init(output: [Double], input: [Double]) {
    self.output = output
    self.input = input
  }
}

/// What one projection says about one agent's usage: Core's aggregate and its
/// samples, in the mirror's own field names (`AgentUsage`).
public struct UsageReading: Sendable {
  /// The agent's stable monitor identity.
  public var id: String
  /// Core's usage; absent for a terminal no agent has claimed, which keeps no ledger.
  public var usage: AgentUsage?

  public init(id: String, usage: AgentUsage? = nil) {
    self.id = id
    self.usage = usage
  }
}

struct UsageSeries: Equatable, Sendable {
  var held: Double?
  /// When the source first reported below the held value, epoch ms; cleared
  /// when it agrees again.
  var lowerSince: Double?
  /// The held value at each step boundary, oldest first, at most `usageStepCount + 1`.
  var snapshots: [Double]

  init(held: Double? = nil, lowerSince: Double? = nil, snapshots: [Double] = []) {
    self.held = held
    self.lowerSince = lowerSince
    self.snapshots = snapshots
  }
}

struct UsageEntry: Equatable, Sendable {
  /// The last step boundary the series were snapshotted at, in steps since the epoch.
  var boundary: Int
  var total: UsageSeries
  var output: UsageSeries?
  var input: UsageSeries?
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

private func finite(_ value: Double?) -> Double? {
  guard let value, value.isFinite, value >= 0 else { return nil }
  return value
}

private func sum(_ values: Double?...) -> Double? {
  let known = values.compactMap(finite)
  return known.isEmpty ? nil : known.reduce(0, +)
}

/// The prompt side (input, cache reads, cache creation) and the completion side
/// (output, reasoning) of a reading.
private func sidesOf(_ usage: AgentUsage) -> (input: Double?, output: Double?) {
  let last = usage.samples.last
  let input =
    sum(usage.inputTokens, usage.cacheReadTokens, usage.cacheCreationTokens)
    ?? finite(last?.inputTokens)
  let output = sum(usage.outputTokens, usage.reasoningTokens) ?? finite(last?.outputTokens)
  return (input, output)
}

/// The hold rule. A reading at or above what is shown is the new number. A
/// source falling to nothing is never followed. A lower positive reading is
/// shown only once the source has stood below the held value for the grace
/// period, so a passing excursion never reaches the screen while a real
/// correction, or a conversation starting over, shows within a step.
private func hold(_ series: UsageSeries, _ incoming: Double?, nowMs: Double) -> UsageSeries {
  guard let incoming else { return series }
  guard let held = series.held, incoming < held else {
    return UsageSeries(held: incoming, snapshots: series.snapshots)
  }
  if incoming == 0 { return UsageSeries(held: held, snapshots: series.snapshots) }
  let lowerSince = series.lowerSince ?? nowMs
  if nowMs - lowerSince >= usageCorrectionGraceMs {
    return UsageSeries(held: incoming, snapshots: series.snapshots)
  }
  return UsageSeries(held: held, lowerSince: lowerSince, snapshots: series.snapshots)
}

/// Snapshot the held value. The first known number is a snapshot at once, so an
/// agent's first step is what was seen since first sight. When more than one
/// boundary passed since the last snapshot (a throttled clock), the growth is
/// spread evenly over the missed steps: when it happened is unknown, and one
/// spike beside zeros would be a claim, not a reading.
private func snapshot(_ series: UsageSeries, passed: Int) -> UsageSeries {
  guard let held = series.held else { return series }
  guard let last = series.snapshots.last else {
    var next = series
    next.snapshots = [held]
    return next
  }
  if passed <= 0 { return series }
  // Only the last window of steps can survive, so a long absence (a
  // conversation resumed hours later) costs a bounded loop, not one per step.
  var snapshots = series.snapshots
  let first = max(1, passed - usageStepCount)
  if first <= passed {
    for step in first...passed {
      snapshots.append(last + (held - last) * Double(step) / Double(passed))
    }
  }
  var next = series
  next.snapshots = Array(snapshots.suffix(usageStepCount + 1))
  return next
}

/// Per-step growth, oldest first, right-aligned in the window; a correction
/// downward is a silent step.
private func stepsOf(_ series: UsageSeries?) -> [Double] {
  var steps = [Double](repeating: 0, count: usageStepCount)
  guard let series else { return steps }
  let snapshots = series.snapshots
  if snapshots.count > 1 {
    for index in 1..<snapshots.count {
      let slot = usageStepCount - (snapshots.count - index)
      if slot >= 0 { steps[slot] = max(0, snapshots[index] - snapshots[index - 1]) }
    }
  }
  return steps
}

private func historyOf(_ entry: UsageEntry) -> UsageHistory {
  let split = entry.output != nil || entry.input != nil
  return UsageHistory(
    total: entry.total.held,
    steps: stepsOf(entry.total),
    sides: split ? UsageSides(output: stepsOf(entry.output), input: stepsOf(entry.input)) : nil,
    stepMs: usageStepMs)
}

private func boundary(at nowMs: Double) -> Int {
  Int((nowMs / usageStepMs).rounded(.down))
}

extension UsageLedger {
  /// Fold one projection into the ledger.
  public func reconciling(_ readings: [UsageReading], nowMs: Double) -> UsageLedger {
    let boundary = boundary(at: nowMs)
    var entries: [String: UsageEntry] = [:]
    var histories: [String: UsageHistory] = [:]
    for reading in readings {
      guard let usage = reading.usage else { continue }
      let before = self.entries[reading.id] ?? UsageEntry(boundary: boundary, total: UsageSeries())
      let sides = sidesOf(usage)
      let passed = boundary - before.boundary
      // Read first, then snapshot: a number that arrived during a step belongs
      // to the step it closes. A side exists from the first reading that
      // splits the burn and holds its last value if a later reading does not.
      let total = snapshot(hold(before.total, finite(usage.cumulativeTokens), nowMs: nowMs), passed: passed)
      let output: UsageSeries? =
        before.output == nil && sides.output == nil
        ? nil
        : snapshot(hold(before.output ?? UsageSeries(), sides.output, nowMs: nowMs), passed: passed)
      let input: UsageSeries? =
        before.input == nil && sides.input == nil
        ? nil
        : snapshot(hold(before.input ?? UsageSeries(), sides.input, nowMs: nowMs), passed: passed)
      let entry = UsageEntry(
        boundary: max(boundary, before.boundary), total: total, output: output, input: input)
      entries[reading.id] = entry
      histories[reading.id] = historyOf(entry)
    }
    return UsageLedger(entries: entries, histories: histories)
  }

  public func history(of id: String) -> UsageHistory? { histories[id] }
}

// MARK: - Persistence (the reference's `usage-history.ts`)

/// One series of the UI's usage ledger as persisted: the held number and its
/// step snapshots.
public struct UsageSeriesRecord: Codable, Equatable, Sendable {
  public var held: Double?
  public var snapshots: [Double]

  public init(held: Double? = nil, snapshots: [Double]) {
    self.held = held
    self.snapshots = snapshots
  }
}

/// The UI's usage ledger for one conversation, as a host persists it so a
/// resumed session opens with the total and the burn it had. Keyed by the
/// provider and its native session id, the identity a resume continues. This
/// is cache, not state: the ledger owns the numbers, the host only keeps them.
public struct UsageLedgerRecord: Codable, Equatable, Sendable {
  public var providerId: String
  public var nativeSessionId: String
  /// ISO time of the save.
  public var savedAt: String
  /// The last step boundary snapshotted, in steps since the epoch.
  public var boundary: Int
  public var total: UsageSeriesRecord
  public var output: UsageSeriesRecord?
  public var input: UsageSeriesRecord?

  public init(
    providerId: String, nativeSessionId: String, savedAt: String, boundary: Int,
    total: UsageSeriesRecord, output: UsageSeriesRecord? = nil, input: UsageSeriesRecord? = nil
  ) {
    self.providerId = providerId
    self.nativeSessionId = nativeSessionId
    self.savedAt = savedAt
    self.boundary = boundary
    self.total = total
    self.output = output
    self.input = input
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
}

private func seriesRecord(_ series: UsageSeries) -> UsageSeriesRecord {
  UsageSeriesRecord(held: series.held, snapshots: series.snapshots)
}

extension UsageLedger {
  /// The ledgers worth keeping, one record per conversation that has a number to keep.
  public func exported(_ keys: [UsageLedgerKey], nowMs: Double) -> [UsageLedgerRecord] {
    // Built per call: the formatter is not Sendable and this is a rare path.
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let savedAt = formatter.string(from: Date(timeIntervalSince1970: nowMs / 1000))
    var records: [UsageLedgerRecord] = []
    for key in keys {
      guard let entry = entries[key.id], entry.total.held != nil else { continue }
      records.append(
        UsageLedgerRecord(
          providerId: key.providerId,
          nativeSessionId: key.nativeSessionId,
          savedAt: savedAt,
          boundary: entry.boundary,
          total: seriesRecord(entry.total),
          output: entry.output.map(seriesRecord),
          input: entry.input.map(seriesRecord)))
    }
    return records
  }

  /// Give a resumed conversation the ledger it had. The saved series are
  /// rebased to now: the steps since the save are silent unless the live
  /// number has moved, in which case the growth is spread over them as for any
  /// missed boundary, and the live number itself is read through the hold rule
  /// so a partial figure from a source still catching up cannot lower what was
  /// shown. A ledger that has already recorded a burn of its own is left alone:
  /// by then it is the record.
  public func seeded(_ id: String, with record: UsageLedgerRecord, nowMs: Double) -> UsageLedger {
    let existing = entries[id]
    if let existing, stepsOf(existing.total).contains(where: { $0 > 0 }) { return self }
    let boundary = boundary(at: nowMs)
    let passed = max(0, boundary - record.boundary)
    func rebase(_ saved: UsageSeriesRecord?, _ live: UsageSeries?) -> UsageSeries? {
      if saved == nil && live == nil { return nil }
      let base = UsageSeries(held: saved?.held, snapshots: saved?.snapshots ?? [])
      return snapshot(hold(base, live?.held, nowMs: nowMs), passed: passed)
    }
    let total = rebase(record.total, existing?.total) ?? UsageSeries()
    let output = rebase(record.output, existing?.output)
    let input = rebase(record.input, existing?.input)
    let entry = UsageEntry(boundary: boundary, total: total, output: output, input: input)
    var entries = self.entries
    var histories = self.histories
    entries[id] = entry
    histories[id] = historyOf(entry)
    return UsageLedger(entries: entries, histories: histories)
  }
}
