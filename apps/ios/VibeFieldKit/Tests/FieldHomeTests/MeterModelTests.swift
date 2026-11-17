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

  /// DESIGN.md §8 "The body" — the desktop's veil, case for case (test/profiles-column.test.tsx), made-up forms only.
  @Test("a sign-in veiled: an email to its first letters and its domain's last part, a handle to its first letter")
  func veiledAccount() {
    #expect(MeterModel.veiledAccount("kim@work.example · Northlight") == "k•••@w•••.example")
    #expect(MeterModel.veiledAccount("pat.doe@example.com") == "p•••@e•••.com")
    #expect(MeterModel.veiledAccount("averyverylongname@sub.example.org") == "a•••@s•••.org")
    #expect(MeterModel.veiledAccount("a@example.com") == "a•••@e•••.com")
    #expect(MeterModel.veiledAccount("kimdev") == "k•••")
    #expect(MeterModel.veiledAccount("x@localhost") == "x•••@l•••")
    #expect(MeterModel.veiledAccount("kim@") == "k•••@")
    #expect(MeterModel.veiledAccount("@example.com") == "@•••")
    #expect(MeterModel.veiledAccount("  pat@example.com  ") == "p•••@e•••.com")
    #expect(MeterModel.veiledAccount(nil) == nil)
    #expect(MeterModel.veiledAccount("") == nil)
    #expect(MeterModel.veiledAccount(" · Northlight") == nil)
  }

  /// Item 274 (UM-274-D2 A, 2026-11-10; DESIGN.md §8 "A meter a later reading did not carry"): at puppeteer
  /// 0.4.0 a push carries only the meters it reads, so a plan holds meters of two readings, each kept meter with its
  /// own `fetchedAt`. Every age said is the age of the numbers beside it. The twins of the desktop's U1-U3
  /// (`packages/field-app/test/usage-meters.test.ts`), read at the mock door's `now`, 2026-09-16 12:00Z.
  /// The door is the main actor's (`MetersFixtureDoor`), so this helper and the three rows that call it run there.
  @MainActor static func anthropicRight(_ set: String, _ batch: AgentAccountUsageBatch) throws -> MeterRight? {
    let sets = try AgentProfileSetsResult(json: try HomeFixture.json("agents-profile-sets.meters")).sets
    let rows = try AgentCatalogResult(json: try HomeFixture.json("agent-catalog.valid")).catalog
    let profile = try #require(sets.first { $0.id == set })
    let options = MetersOptions(catalog: MeterCatalog(rows: rows))
    let meters = MeterModel.planMeters(profile, rows: batch.entries, now: MetersFixtureDoor.now, options: options)
    return meters.entries.first { $0.key == "plan:anthropic" }?.right
  }

  @Test("item 274, U1: a kept reading says its tightest window's own age, not the push's")
  @MainActor func keptSaysItsTightestsAge() throws {
    // Side's: kept after a refused refresh; its Fable week, the tightest at 96%, was read at 10:00Z, the push 11:59:30Z
    let batch = try AgentAccountUsageBatch(json: try HomeFixture.json("agent-usage.kept-meters"))
    let right = try Self.anthropicRight("side", batch)
    #expect(right == MeterRight(kind: .kept, words: "as of 2h ago", hot: false, icon: false))
  }

  @Test("item 274, U2: a model week kept from before its reset leaves a pushed tightest its reset")
  @MainActor func keptPassedWeekAgesNothingElse() throws {
    // This Mac's: the push at 11:59:30Z carried the five hours and the week; the Fable week, read at 11:20Z, reset at
    // 11:45Z. The tightest (the week, 47%) was read after it, so the plan keeps its reset
    let batch = try AgentAccountUsageBatch(json: try HomeFixture.json("agent-usage.kept-meters"))
    let right = try Self.anthropicRight("native", batch)
    #expect(right == MeterRight(kind: .reset, words: "12h", hot: false, icon: true))
  }

  @Test("item 274, U3: a tightest kept from an earlier read than a passed window is aged by it, with its own age")
  @MainActor func olderTightestIsAgedByItsOwnRead() throws {
    // pushed at 11:59Z: a five hours spent at 100% whose reset came at 11:55Z; the week, the tightest at 70%, was kept
    // from a read at 10:30Z
    let metric = { (id: String, used: Double, minutes: Int64, resetsAt: String, read: String?) -> JSONValue in
      var fields: [String: JSONValue] = [
        "id": .string(id), "label": .string(id), "kind": .string("window"), "usedPercent": .double(used),
        "durationMinutes": .int(minutes), "resetsAt": .string(resetsAt),
      ]
      if let read { fields["fetchedAt"] = .string(read) }
      return .object(fields)
    }
    let entry: JSONValue = .object([
      "provider": .string("claude"), "label": .string("Claude"), "profileId": .string("claude:native-default"),
      "profileLabel": .string("Default"), "state": .string("available"),
      "fetchedAt": .string("2026-09-16T11:59:00.000Z"), "scope": .string("subscription"),
      "source": .object(["kind": .string("native-statusline"), "stability": .string("documented")]),
      "metrics": .array([
        metric("five-hour", 100, 300, "2026-09-16T11:55:00.000Z", nil),
        metric("seven-day", 70, 10080, "2026-09-17T00:00:00.000Z", "2026-09-16T10:30:00.000Z"),
      ]),
    ])
    let batch = try AgentAccountUsageBatch(
      json: .object(["generatedAt": .string("2026-09-16T11:59:00.000Z"), "entries": .array([entry])]))
    let right = try Self.anthropicRight("native", batch)
    #expect(right == MeterRight(kind: .passed, words: "as of 1h 30m ago", hot: false, icon: false))
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

  private struct Tables: Decodable { let serviceProducts: [String: String] }

  @Test("the plans' products are puppeteer-views' at the pin, as the generated fixture says them")
  func planProductsAreThePins() throws {
    let found = Bundle.module.url(
      forResource: "presentation-tables.golden", withExtension: "json", subdirectory: "Fixtures")
    let url = try #require(found)
    let data = try Data(contentsOf: url)
    let pinned = try JSONDecoder().decode(Tables.self, from: data).serviceProducts
    let products = PlanTitles.products
    #expect(products == pinned)
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

  static let tierNow = Date(timeIntervalSince1970: 1_000_000)

  static func tierOptions() throws -> MetersOptions {
    let catalog = try AgentCatalogResult(json: try HomeFixture.json("agent-catalog.valid")).catalog
    return MetersOptions(catalog: MeterCatalog(rows: catalog))
  }

  /// DESIGN.md §8 "A plan's tier" — the tier and the title come from one record, behind one gate: a plan whose account
  /// no agent named is titled by its product alone and carries no tier, whatever its account says; a named account
  /// keeps both, its namer missing from the profile too (the desktop's `planTierOf` has the same gate).
  @Test("a plan's tier rides on its meter only once an agent named its account, as its title does")
  func planTierOnlyWhenNamed() throws {
    let set = try TierFixture.set([
      .init(id: "a", tier: TierFixture.label("20x")), .init(id: "b", tier: TierFixture.noTier), .init(id: "c"),
      .init(id: "d", tier: TierFixture.label("20x"), named: false),
      .init(id: "e", tier: TierFixture.label("20x"), namer: false),
    ])
    let meters = MeterModel.planMeters(set, rows: [], now: Self.tierNow, options: try Self.tierOptions())
    func entry(_ id: String) -> PlanMeter? { meters.entries.first { $0.key == "plan:\(id)" } }
    let labelled = entry("a")?.plan?.tier
    #expect(labelled == AgentPlanTier(label: "20x"))
    let none = entry("b")?.plan?.tier
    #expect(none == AgentPlanTier(label: nil))
    let unread = try #require(entry("c")?.plan)
    #expect(unread.tier == nil)
    let unnamed = try #require(entry("d"))
    #expect(unnamed.title == "Claude")
    #expect(unnamed.why == .unnamed)
    #expect(unnamed.plan?.tier == nil)
    let named = try #require(entry("a"))
    #expect(named.title == "Claude Max", "the title carries none of the tier")
    // its account named by a sign-in this profile does not hold: no meter, yet the plan keeps its name and its tier
    let orphan = try #require(entry("e"))
    #expect(orphan.why == .unnamed)
    #expect(orphan.title == "Claude Max")
    let orphanTier = orphan.plan?.tier
    #expect(orphanTier == AgentPlanTier(label: "20x"))
  }

  /// DESIGN.md §8 "A plan's tier" — every plan at once: one account in two profiles is one entry, which keeps the shown
  /// profile's entry whole, its tier with it, as the desktop's union (`everyPlan`) does; the other profile's read is
  /// not borrowed into it.
  @Test("in every plan a shared account is one entry, carrying the tier of the profile whose entry it shows")
  func planTierInTheUnion() throws {
    let options = try Self.tierOptions()
    let work = try TierFixture.set([.init(id: "a", email: "kim@example.com", alsoIn: ["side"])])
    let side = try TierFixture.set(
      [.init(id: "a", tier: TierFixture.label("20x"), email: "kim@example.com", alsoIn: ["work"])],
      id: "side", label: "Side", isDefault: false)
    let union = MeterModel.everyPlan([work, side], rows: [], now: Self.tierNow, options: options)
    let shared = union.entries.filter { $0.plan?.id == "a" }
    #expect(shared.count == 1)
    let kept = try #require(shared.first)
    #expect(kept.key == "work/plan:a")
    #expect(kept.profiles.count == 2)
    #expect(kept.plan?.tier == nil, "the entry shown is the first profile's, whose sign-in read no tier")
    let swapped = MeterModel.everyPlan([side, work], rows: [], now: Self.tierNow, options: options)
    let other = swapped.entries.first { $0.plan?.id == "a" }
    let otherTier = other?.plan?.tier
    #expect(otherTier == AgentPlanTier(label: "20x"))
  }

  /// A five hours' reading at 42% for one made-up sign-in (`TierFixture`'s `‹profile›.‹plan›`), read at `tierNow`
  /// with two hours to its reset.
  static func tierUsage(_ profileId: String) throws -> AgentAccountUsageEntry {
    try AgentAccountUsageEntry(
      json: .object([
        "provider": .string("claude"), "label": .string("Claude"), "profileId": .string(profileId),
        "state": .string("available"), "fetchedAt": .string("1970-01-12T13:46:40.000Z"),
        "metrics": .array([
          .object([
            "id": .string("five-hour"), "label": .string("5H"), "kind": .string("window"), "usedPercent": .double(42),
            "durationMinutes": .int(300), "resetsAt": .string("1970-01-12T15:46:40.000Z"),
          ])
        ]),
      ]))
  }

  /// DESIGN.md §8 "A plan's tier" and §9 "The meters' words" — the circle's arc words name a plan as its row does
  /// (`PlanMeter.spokenTitle`): the title and the tier's label joined by a space, in every state the plan is in; a
  /// tier not read, or a record with no label, leaves the title alone (the desktop's `bandsPlanWords`).
  @Test("the circle's arc words say a plan's tier after its title, as its row does, in every state")
  func planTierInTheArcWords() throws {
    let set = try TierFixture.set([
      .init(id: "a", tier: TierFixture.label("20x")), .init(id: "b", tier: TierFixture.noTier), .init(id: "c"),
    ])
    let options = try Self.tierOptions()
    func entry(_ meters: ProfileMeters, _ id: String) -> PlanMeter? { meters.entries.first { $0.key == "plan:\(id)" } }
    // before any reading: a first read
    let waiting = MeterModel.planMeters(set, rows: [], now: Self.tierNow, options: options)
    let first = try #require(entry(waiting, "a"))
    #expect(first.kind == .firstRead)
    #expect(first.spokenTitle == "Claude Max 20x")
    #expect(BandsLayout.planWords(first) == "Claude Max 20x: reading")
    #expect(BandsLayout.circleWords([first], every: false) == "Usage: Claude Max 20x: reading")
    let none = try #require(entry(waiting, "b"))
    #expect(BandsLayout.planWords(none) == "Claude Max: reading", "the agent says it has no tier: the title alone")
    let unread = try #require(entry(waiting, "c"))
    #expect(BandsLayout.planWords(unread) == "Claude Max: reading", "a tier not read says nothing aloud")
    // a reading: the same words as the untiered plan's, the label after the title
    let rows = try [Self.tierUsage("work.a"), Self.tierUsage("work.c")]
    let read = MeterModel.planMeters(set, rows: rows, now: Self.tierNow, options: options)
    let tieredRead = try #require(entry(read, "a"))
    #expect(tieredRead.kind == .reading)
    let tieredWords = BandsLayout.planWords(tieredRead)
    let plainRead = try #require(entry(read, "c"))
    let plainWords = BandsLayout.planWords(plainRead)
    #expect(plainWords.hasPrefix("Claude Max: 42% of "))
    let tail = String(plainWords.dropFirst("Claude Max".count))
    #expect(tieredWords == "Claude Max 20x" + tail)
    // the home's usage door down: a plan with no meter is said by its name alone, tier and all
    var down = options
    down.usageReadable = false
    let unavailable = MeterModel.planMeters(set, rows: [], now: Self.tierNow, options: down)
    let line = try #require(entry(unavailable, "a"))
    #expect(line.kind == .noMeter)
    #expect(BandsLayout.planWords(line) == "Claude Max 20x")
  }
}

/// Made-up profiles for the tier rows: one signed-in sign-in per plan, each naming its own plan (example.com
/// addresses), each plan's account carrying its row's `planTier` (no key when nil); its account named by nobody when
/// not `named`, and its namer a sign-in the profile does not hold when not `namer`.
enum TierFixture {
  struct Plan {
    let id: String
    var service = "anthropic"
    var serviceLabel = "Anthropic"
    var provider = "claude"
    var plan = "max"
    var tier: JSONValue?
    var named = true
    var namer = true
    /// the account's address; nil, `‹id›@example.com`
    var email: String?
    /// the other profiles with the same account
    var alsoIn: [String] = []
  }

  static func label(_ text: String) -> JSONValue { .object(["label": .string(text)]) }

  /// the agent says this plan has no tier
  static let noTier = JSONValue.object([:])

  static func set(
    _ plans: [Plan], id: String = "work", label: String = "Work", isDefault: Bool = true
  ) throws -> AgentProfileSet {
    let personas: [JSONValue] = plans.map { plan in
      .object([
        "profileId": .string("\(id).\(plan.id)"), "provider": .string(plan.provider), "kind": .string("managed"),
        "label": .string(plan.id),
        "identity": .object([
          "loggedIn": .bool(true), "email": .string(plan.email ?? "\(plan.id)@example.com"),
        ]),
      ])
    }
    let rows: [JSONValue] = plans.map { plan in
      var account: [String: JSONValue] = ["plan": .string(plan.plan)]
      if plan.named { account["email"] = .string(plan.email ?? "\(plan.id)@example.com") }
      if let tier = plan.tier { account["planTier"] = tier }
      return .object([
        "id": .string(plan.id), "service": .object(["id": .string(plan.service), "label": .string(plan.serviceLabel)]),
        "account": .object(account), "namedBy": .string(plan.namer ? "\(id).\(plan.id)" : "\(id).gone"),
        "holders": .array([.string("\(id).\(plan.id)")]), "alsoIn": .array(plan.alsoIn.map(JSONValue.string)),
      ])
    }
    return try AgentProfileSet(
      json: .object([
        "id": .string(id), "kind": .string("managed"), "label": .string(label), "default": .bool(isDefault),
        "personas": .array(personas), "plans": .array(rows),
      ]))
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
