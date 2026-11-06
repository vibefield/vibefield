import Foundation
import Testing

@testable import FieldProduct

// UM-4 (UM-D8 A) — EL9 on the third side for the home's usage batch: the bytes the contracts' zod parses
// (`agent-usage.ts`) are the bytes these parse, and a reading is refused exactly where zod would refuse it — a required
// field missing or of another type, `null` at an optional key, a bound or a grammar broken — while a state this build
// cannot name folds to `unknown` (zod's `.catch`), never a refusal. Every agent id is the fixture's, carried opaque.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("the home's usage batch reads as zod reads it")
struct AgentUsageShapeTests {
  /// The first entry of `agent-usage.valid.json`, with `fields` changed (a nil value removes the key).
  static func entry(_ fields: [String: JSONValue?]) throws -> JSONValue {
    let batch = try Fixture.json("agent-usage.valid")
    guard case .object(var first)? = batch["entries"]?.arrayValue?.first else {
      throw WireDecodeError(shape: "test", reason: "the fixture's first entry is not an object")
    }
    for (key, value) in fields { first[key] = value }
    return .object(first)
  }

  /// The first entry's first metric, with `fields` changed.
  static func metric(_ fields: [String: JSONValue?]) throws -> JSONValue {
    let first = try entry([:])
    guard case .object(var metric)? = first["metrics"]?.arrayValue?.first else {
      throw WireDecodeError(shape: "test", reason: "the fixture's first metric is not an object")
    }
    for (key, value) in fields { metric[key] = value }
    return .object(metric)
  }

  @Test("a batch's readings: each agent's account, its state, its meters in the adapter's order, and its credits")
  func validBatch() throws {
    let batch = try AgentAccountUsageBatch(json: try Fixture.json("agent-usage.valid"))
    #expect(batch.generatedAt == "2026-09-13T12:00:01.000Z")
    #expect(batch.entries.count == 3)
    #expect(batch.unknownFields.isEmpty)
    let states = batch.entries.map(\.state)
    #expect(states == [.available, .rateLimited, .unauthenticated])
    let accounts = batch.entries.map(\.profileId)
    #expect(accounts == ["claude:native-default", "claude:work", nil])
    let first = try #require(batch.entries.first)
    #expect(first.label == "Claude")
    #expect(first.profileLabel == "Default")
    #expect(first.fetchedAt == "2026-09-13T12:00:00.000Z")
    #expect(first.scope == "subscription")
    #expect(first.source?.kind == "native-protocol")
    #expect(first.source?.stability == "experimental")
    let ids = first.metrics.map(\.id)
    let labels = first.metrics.map(\.label)
    let kinds = first.metrics.map(\.kind)
    let used = first.metrics.map(\.usedPercent)
    let lengths = first.metrics.map(\.durationMinutes)
    #expect(ids == ["five-hour", "seven-day", "fable"])
    #expect(labels == ["5H", "7D", "FABLE"])
    #expect(kinds == ["window", "window", "window"])
    #expect(used == [42.5, 103.2, 4])
    #expect(lengths == [300, 10080, 10080])
    #expect(first.metrics[0].startsAt == "2026-09-13T09:00:00.000Z")
    #expect(first.metrics[0].resetsAt == "2026-09-13T14:00:00.000Z")
    #expect(first.metrics[0].description == "Rolling five-hour window")
    let group = first.metrics[2].group
    #expect(group == AgentAccountUsageGroup(id: "scope:fable", label: "Fable only", standby: nil))
    let credits = try #require(first.credits)
    #expect(credits.balance == "$12.40")
    #expect(credits.hasCredits == true)
    #expect(credits.unlimited == false)
    #expect(credits.resetCreditsAvailable == 2)
    let limited = batch.entries[1]
    #expect(limited.metrics.isEmpty)
    #expect(limited.retryable == true)
    #expect(limited.retryAt == "2026-09-13T12:30:00.000Z")
    #expect(limited.message?.isEmpty == false)
  }

  @Test("before the first refresh the batch is an honest empty, stamped")
  func emptyBatch() throws {
    let batch = try AgentAccountUsageBatch(json: try Fixture.json("agent-usage.empty"))
    #expect(batch.entries.isEmpty)
    #expect(batch.generatedAt == "2026-09-13T12:00:00.000Z")
  }

  @Test("a budget meter, and a reading kept after a refresh failed: its numbers stand beside the failure")
  func budgetAndKept() throws {
    let batch = try AgentAccountUsageBatch(json: try Fixture.json("agent-usage.budget"))
    #expect(batch.entries.count == 5)
    let budget = try #require(batch.entries.first { $0.metrics.first?.kind == "budget" })
    #expect(budget.metrics.first?.usedPercent == 46)
    #expect(budget.metrics.first?.durationMinutes == nil)
    #expect(budget.metrics.first?.resetsAt == nil)
    let kept = try #require(batch.entries.first { $0.stale == true })
    #expect(kept.state == .unavailable)
    let keptUsed = kept.metrics.map(\.usedPercent)
    #expect(keptUsed == [30, 22])
    #expect(kept.fetchedAt == "2026-09-16T11:28:00.000Z")
    #expect(kept.source == nil)
  }

  @Test("a state this build cannot name, or none, is `unknown` — never a refusal (zod's .catch)")
  func unknownState() throws {
    let newer = try AgentAccountUsageEntry(json: try Self.entry(["state": .string("paused")]))
    #expect(newer.state == .unknown)
    let none = try AgentAccountUsageEntry(json: try Self.entry(["state": nil]))
    #expect(none.state == .unknown)
    let odd = try AgentAccountUsageEntry(json: try Self.entry(["state": .int(3)]))
    #expect(odd.state == .unknown)
  }

  @Test("a newer desktop's fields are kept and named, never refused (passthrough)")
  func unknownFieldsNamed() throws {
    let entry = try AgentAccountUsageEntry(json: try Self.entry(["tier": .string("team")]))
    #expect(entry.unknownFields == ["tier"])
    let metric = try AgentAccountUsageMetric(json: try Self.metric(["unit": .string("tokens")]))
    #expect(metric.unknownFields == ["unit"])
  }

  @Test(
    "an entry is refused where zod refuses it",
    arguments: [
      ["label": JSONValue.string("")],
      ["label": nil],
      ["provider": .string("-claude")],
      ["provider": .string("")],
      ["profileId": .string(" work")],
      ["profileId": .null],
      ["fetchedAt": nil],
      ["metrics": nil],
      ["metrics": .string("none")],
      ["stale": .string("yes")],
      ["credits": .string("$5")],
    ] as [[String: JSONValue?]])
  func entryRefused(_ fields: [String: JSONValue?]) throws {
    let raw = try Self.entry(fields)
    #expect(throws: WireDecodeError.self) { try AgentAccountUsageEntry(json: raw) }
  }

  @Test(
    "a meter is refused where zod refuses it",
    arguments: [
      ["id": JSONValue.string("")],
      ["label": nil],
      ["kind": nil],
      ["usedPercent": .double(-1)],
      ["usedPercent": .string("42")],
      ["durationMinutes": .int(0)],
      ["durationMinutes": .double(2.5)],
      ["resetsAt": .null],
      ["group": .object(["id": .string(""), "label": .string("Fable only")])],
      ["group": .object(["id": .string("scope:fable")])],
    ] as [[String: JSONValue?]])
  func metricRefused(_ fields: [String: JSONValue?]) throws {
    let raw = try Self.metric(fields)
    #expect(throws: WireDecodeError.self) { try AgentAccountUsageMetric(json: raw) }
  }

  @Test("a batch with an entry zod refuses is refused whole, as `z.array` refuses it")
  func batchRefusedWhole() throws {
    let bad = try Self.entry(["label": .string("")])
    let raw = JSONValue.object(["entries": .array([bad]), "generatedAt": .string("2026-09-13T12:00:01.000Z")])
    #expect(throws: WireDecodeError.self) { try AgentAccountUsageBatch(json: raw) }
    let unstamped = JSONValue.object(["entries": .array([])])
    #expect(throws: WireDecodeError.self) { try AgentAccountUsageBatch(json: unstamped) }
  }

  @Test("the phone's ask never refreshes: it is answered from the home's cache (UM-D8)")
  func askNeverRefreshes() {
    let ask = AgentsUsageParams.cached.json
    #expect(ask == .object([:]))
    #expect(ask["refresh"] == nil)
  }
}
