import Foundation
import Testing

@testable import FieldHome
@testable import FieldProduct

/// UM-4 (UM-D3, UM-D4, UM-D13, UM-D15) — the phone's meter rules where the golden does not reach: Settings' pace rule
/// at its edges, a plan's product name (puppeteer-views' `planTitle`, 0.3.3, transcribed), which profiles stand on a
/// circle, and the catalog the meters read (the home's: its order, names and who reports usage). BandsParityTests
/// holds the rest to the desktop's numbers.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("the phone's meter rules: the pace, a plan's name, a profile's circle and the home's catalog")
struct MeterModelTests {
  @Test("Settings' pace rule: spent is hot; with no pace, 80; else past 40 and 1.05 ahead; no time gone, only 100")
  func paceRule() {
    #expect(MeterRules.isHot(used: 100, elapsed: 90))
    #expect(MeterRules.isHot(used: 80, elapsed: nil))
    #expect(!MeterRules.isHot(used: 79.9, elapsed: nil))
    #expect(MeterRules.isHot(used: 64, elapsed: 50))
    #expect(!MeterRules.isHot(used: 40, elapsed: 20))
    #expect(!MeterRules.isHot(used: 52, elapsed: 50))
    #expect(!MeterRules.isHot(used: 90, elapsed: 0))
  }

  @Test("a length and a reset as the drawing says them")
  func lengths() {
    #expect(MeterRules.durationWords(0.2) == "1m")
    #expect(MeterRules.durationWords(115) == "1h 55m")
    #expect(MeterRules.durationWords(120) == "2h")
    #expect(MeterRules.durationWords(5035) == "3d 12h")
    #expect(MeterRules.windowWords(label: "5H", durationMinutes: 300) == "5 hours")
    #expect(MeterRules.windowWords(label: "7D", durationMinutes: 10080) == "7 days")
    #expect(MeterRules.windowWords(label: "Credits", durationMinutes: nil) == "Credits")
    #expect(MeterRules.resetForm(resetIn: nil) == nil)
    #expect(MeterRules.resetForm(resetIn: -1) == .now)
    #expect(MeterRules.resetForm(resetIn: 1439.4) == .length)
    #expect(MeterRules.resetForm(resetIn: 1439.5) == .day)
    let now = Date(timeIntervalSince1970: 1_000_000)
    #expect(MeterRules.resetWords(at: now.addingTimeInterval(130 * 60), now: now) == "2h 10m")
    #expect(MeterRules.resetWords(at: now.addingTimeInterval(-60), now: now) == "now")
  }

  /// A window as the wire carries it.
  static func window(_ id: String, used: Double, minutes: Int, resetsAt: String) throws -> AgentAccountUsageMetric {
    try AgentAccountUsageMetric(
      json: .object([
        "id": .string(id), "label": .string(id), "kind": .string("window"), "usedPercent": .double(used),
        "durationMinutes": .int(Int64(minutes)), "resetsAt": .string(resetsAt),
      ]))
  }

  /// DESIGN.md §8 "A window read before its reset" (the desktop's `outranks`, c5b4972d4): the golden's passed cases
  /// never tie at 0, so this row holds the tie — a passed window ranks below a running window at 0%, never the first of
  /// equals.
  @Test("a window read before its reset is unlit, runs no forecast, presses 0 and ranks below a running window at 0%")
  func passedRanksLast() throws {
    // 2026-09-16 15:00Z: a five hours spent at 100% whose reset came at 14:00Z, beside a week at 0% still running
    let now = Date(timeIntervalSince1970: 1_789_570_800)
    let spent = try Self.window("five-hour", used: 100, minutes: 300, resetsAt: "2026-09-16T14:00:00.000Z")
    let week = try Self.window("seven-day", used: 0, minutes: 10080, resetsAt: "2026-09-20T00:00:00.000Z")
    let windows = MeterModel.meterWindows([spent, week], now: now)
    let passed = windows.map(\.passed)
    #expect(passed == [true, false])
    let first = try #require(windows.first)
    #expect(!first.line.hot)
    #expect(first.forecast == nil)
    #expect(first.pressure == 0)
    let tightest = MeterModel.mostPressed(windows, window: { $0 })
    #expect(tightest?.line.id == "seven-day")
    let reversed = MeterModel.mostPressed(Array(windows.reversed()), window: { $0 })
    #expect(reversed?.line.id == "seven-day")
  }

  @Test("a plan by its product's name, as Settings' card says it")
  func planTitles() {
    let anthropic = AgentSignInService(id: "anthropic", label: "Anthropic")
    let xai = AgentSignInService(id: "xai", label: "xAI")
    let openai = AgentSignInService(id: "openai", label: "OpenAI")
    let unknown = AgentSignInService(id: "acme", label: "Acme")
    #expect(PlanTitles.title(service: anthropic, plan: "max") == "Claude Max")
    #expect(PlanTitles.title(service: openai, plan: "individual_pro") == "ChatGPT Individual Pro")
    #expect(PlanTitles.title(service: xai, plan: "SuperGrok") == "SuperGrok")
    #expect(PlanTitles.title(service: openai, plan: nil) == "ChatGPT")
    #expect(PlanTitles.title(service: openai, plan: "  ") == "ChatGPT")
    #expect(PlanTitles.title(service: unknown, plan: "team") == "Acme Team")
  }

  @Test("a draft profile no agent has signed in to stands on no circle (ruling 7)")
  func draftsHaveNoCircle() throws {
    let sets = try AgentProfileSetsResult(json: try HomeFixture.json("agents-profile-sets.meters")).sets
    let circles = sets.map(MeterModel.hasCircle)
    #expect(circles == [true, true, true, false])
  }

  @Test("the home's catalog orders and names the agents, and says which report usage")
  func catalog() throws {
    let rows = try AgentCatalogResult(json: try HomeFixture.json("agent-catalog.valid")).catalog
    let catalog = MeterCatalog(rows: rows)
    let first = try #require(rows.first)
    #expect(catalog.rank(first.id) == 0)
    #expect(catalog.rank("not-in-the-catalog") == rows.count)
    #expect(catalog.name(first.id) == first.label)
    #expect(catalog.name("not-in-the-catalog") == "not-in-the-catalog")
    #expect(catalog.readsUsage(first.id) == first.offersUsage)
    #expect(!catalog.readsUsage("not-in-the-catalog"))
    // a deprecated agent is shown and offers nothing new: no reading is waited for
    let deprecated = try AgentCatalogRow(
      json: .object([
        "id": .string(first.id), "label": .string(first.label), "status": .string("deprecated"),
        "offers": .object(["usage": .bool(true)]),
      ]))
    let reads = MeterCatalog(rows: [deprecated]).readsUsage(first.id)
    #expect(!reads)
  }

  @Test("an agent's own folder reads the unkeyed row; a managed sign-in reads only its own")
  func settingsJoin() throws {
    let sets = try AgentProfileSetsResult(json: try HomeFixture.json("agents-profile-sets.meters")).sets
    let rows = try AgentAccountUsageBatch(json: try HomeFixture.json("agent-usage.budget")).entries
    let native = try #require(sets.first?.personas.first)
    let nativeRow = MeterModel.usageOf(rows, native)
    #expect(nativeRow?.profileId == native.profileId)
    let unkeyed = try rows.map(AgentAccountUsageEntry.unkeyed)
    let fallback = MeterModel.usageOf(unkeyed, native)
    #expect(fallback?.provider == native.provider)
    let managed = try #require(sets.dropFirst().first?.personas.first)
    let managedRow = MeterModel.usageOf(unkeyed, managed)
    #expect(managedRow == nil)
  }
}

extension AgentAccountUsageEntry {
  /// The row with its account key removed: the agent's own folder's default, as an older desktop reported it.
  static func unkeyed(_ row: AgentAccountUsageEntry) throws -> AgentAccountUsageEntry {
    try AgentAccountUsageEntry(
      json: .object([
        "provider": .string(row.provider), "label": .string(row.label), "state": .string(row.state.rawValue),
        "metrics": .array([]), "fetchedAt": .string(row.fetchedAt),
      ]))
  }
}
