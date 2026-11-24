import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// UM-6 (UM-D29 A, UM-D31 K3, UM-D32 T9, 2026-11-24; DESIGN.md §8 "A meter line's end", §9 "The meters' words") — a
/// meter line ends in its reset. The end cap's clock in a fixed zone and locale: a reset today by its time alone, on
/// one of the next six days by its weekday and time, a week or more off by its date, and once it has come by when it
/// came; the line's words around it ("resets at 15:00, in 1h"); and the bands key naming only what the circle draws.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("UM-6: a meter line ends in its reset, and the bands key names only what the circle draws")
@MainActor
struct MeterLineEndTests {
  static let posix = Locale(identifier: "en_US_POSIX")
  /// Monday 2026-11-23 14:00 UTC, the canvas's now
  static let now = Date(timeIntervalSince1970: 1_795_442_400)

  static func calendar(_ zone: String) -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: zone) ?? .gmt
    return calendar
  }

  static func clock(_ seconds: TimeInterval, now: Date = now, zone: String = "UTC") -> ResetClock? {
    MeterRules.resetClock(
      at: Date(timeIntervalSince1970: seconds), now: now, calendar: calendar(zone), locale: posix)
  }

  @Test("today is its time alone; one of the next six days its weekday and time; a week on its date alone")
  func clockAhead() {
    let today = Self.clock(1_795_446_000)  // Mon 15:00
    #expect(today == ResetClock(day: nil, time: "15:00", at: "15:00", away: "1h", passed: false))
    let thursday = Self.clock(1_795_694_400)  // Thu 12:00
    #expect(thursday == ResetClock(day: "Thu", time: "12:00", at: "Thu 12:00", away: "2d 22h", passed: false))
    let sunday = Self.clock(1_795_957_200)  // Sun 29th 13:00, six days on
    let sundayDay = sunday?.day
    #expect(sundayDay == "Sun")
    let monday = Self.clock(1_796_043_600)  // Mon 30th 13:00, seven days on: today's weekday, so its date
    #expect(monday == ResetClock(day: "Nov 30", time: nil, at: "Nov 30", away: "6d 23h", passed: false))
    let december = Self.clock(1_796_385_600)  // Fri Dec 4 12:00
    #expect(december == ResetClock(day: "Dec 4", time: nil, at: "Dec 4", away: "10d 22h", passed: false))
    let none = MeterRules.resetClock(at: nil, now: Self.now, calendar: Self.calendar("UTC"), locale: Self.posix)
    #expect(none == nil)
  }

  @Test("once it has come it says when: its time on the same day, its weekday and time on an earlier one")
  func clockPassed() {
    let sameDay = Self.clock(1_795_437_000)  // Mon 12:30
    #expect(sameDay == ResetClock(day: nil, time: "12:30", at: "12:30", away: nil, passed: true))
    let sameDayAt = sameDay?.saidAt
    #expect(sameDayAt == "at 12:30")
    let yesterday = Self.clock(1_795_388_400)  // Sun 22nd 23:00
    #expect(yesterday == ResetClock(day: nil, time: "23:00", at: "Sun 23:00", away: nil, passed: true))
    let yesterdayAt = yesterday?.saidAt
    #expect(yesterdayAt == "Sun 23:00")
    let atNow = Self.clock(1_795_442_400)
    let atNowPassed = atNow?.passed
    #expect(atNowPassed == true)
  }

  @Test("the days are the calendar's: the night the clocks go back is still one day")
  func clockAcrossTheClockChange() {
    // 2026-11-01 00:30 PDT, the night the clocks go back an hour; the reset 25 hours later, 00:30 PST the next day
    let before = Date(timeIntervalSince1970: 1_793_518_200)
    let next = Self.clock(1_793_608_200, now: before, zone: "America/Los_Angeles")
    #expect(next == ResetClock(day: "Mon", time: "00:30", at: "Mon 00:30", away: "1d 1h", passed: false))
  }

  static func line(_ used: Double, label: String = "5H", group: String? = nil, hot: Bool = false) -> UsageLine {
    UsageLine(
      id: label.lowercased(), label: label, group: group.map { UsageLine.Group(id: "scope:\($0)", label: $0) },
      usedPercent: used, elapsedPercent: 80, reset: "1h", resets: true, hot: hot)
  }

  @Test("a line says its reset on the clock and how far off it is, its pace, and when it runs out")
  func lineWords() {
    let today = ResetClock(day: nil, time: "15:00", at: "15:00", away: "1h", passed: false)
    let hot = UsageLineView.words(Self.line(91, hot: true), clock: today, forecast: "out in ~25m")
    #expect(hot == "5H: 91% used, resets at 15:00, in 1h, ahead of pace, out in ~25m")
    let thursday = ResetClock(day: "Thu", time: "12:00", at: "Thu 12:00", away: "2d 22h", passed: false)
    let opus = UsageLineView.words(Self.line(22, label: "7D", group: "Opus only"), clock: thursday)
    #expect(opus == "Opus only, 7D: 22% used, resets Thu 12:00, in 2d 22h")
    let december = ResetClock(day: "Dec 4", time: nil, at: "Dec 4", away: "10d 22h", passed: false)
    let far = UsageLineView.words(Self.line(38, label: "7D"), clock: december)
    #expect(far == "7D: 38% used, resets Dec 4, in 10d 22h")
  }

  @Test("a window read before its reset says when it reset, and the age of its read when there is one")
  func passedWords() {
    let sameDay = ResetClock(day: nil, time: "12:30", at: "12:30", away: nil, passed: true)
    let aged = UsageLineView.words(Self.line(97), clock: sameDay, age: "as of 3h ago")
    #expect(aged == "5H: 97% used, reset at 12:30, as of 3h ago")
    let unaged = UsageLineView.words(Self.line(97), clock: sameDay)
    #expect(unaged == "5H: 97% used, reset at 12:30")
    let yesterday = ResetClock(day: nil, time: "23:00", at: "Sun 23:00", away: nil, passed: true)
    let earlier = UsageLineView.words(Self.line(97), clock: yesterday, age: "as of 16h ago")
    #expect(earlier == "5H: 97% used, reset Sun 23:00, as of 16h ago")
  }

  // MARK: - The bands key (UM-D31)

  /// The meters fixture's home over a batch.
  static func home(_ batch: JSONValue) throws -> MetersReading {
    var reading = MetersReading()
    reading.connected = true
    reading.home = "dev-1"
    reading.sets = try AgentProfileSetsResult(json: try HomeFixture.json("agents-profile-sets.meters")).sets
    reading.catalog = try AgentCatalogResult(json: try HomeFixture.json("agent-catalog.valid")).catalog
    reading.usage = .batch(try AgentAccountUsageBatch(json: batch))
    return reading
  }

  static let fixtureNow = MetersFixtureDoor.now

  @Test("a plan that reads five hours and a week: the key names those two and nothing else")
  func keyOfTwoBands() throws {
    let reading = try Self.home(try HomeFixture.json("agent-usage.budget"))
    let work = reading.meters(of: "work", now: Self.fixtureNow)
    let items = BandsLayout.keyItems(work.entries)
    #expect(
      items == [BandsKeyItem(band: .inner, words: "5 hours"), BandsKeyItem(band: .outer, words: "7 days")])
    let said = BandsLayout.keyWords(items)
    #expect(said == "Inside, 5 hours; outside, 7 days")
  }

  @Test("every plan: the budget is credits, and the hairline is named by its group's own word")
  func keyOfEveryBand() throws {
    let reading = try Self.home(try HomeFixture.json("agent-usage.budget"))
    let every = reading.meters(of: nil, now: Self.fixtureNow)
    let items = BandsLayout.keyItems(every.entries)
    #expect(
      items == [
        BandsKeyItem(band: .inner, words: "5 hours"), BandsKeyItem(band: .outer, words: "7 days"),
        BandsKeyItem(band: .budget, words: "credits"), BandsKeyItem(band: .hairline, words: "Fable"),
      ])
    let said = BandsLayout.keyWords(items)
    #expect(said == "Inside, 5 hours; outside, 7 days; both bands, credits; a hairline, Fable")
  }

  struct NoWindows: Error {}

  /// One plan reading these windows (the key reads only its bands; its words and its tightest are not the key's).
  static func plan(_ key: String, _ metrics: [JSONValue]) throws -> PlanMeter {
    let parsed = try metrics.map { try AgentAccountUsageMetric(json: $0) }
    let windows = MeterModel.meterWindows(parsed, now: now)
    guard let first = windows.first else { throw NoWindows() }
    let reading = MeterReading(
      windows: windows, tightest: first, hot: false, stale: false, fetchedAt: "2026-11-23T13:59:00.000Z")
    return PlanMeter(
      key: key, provider: "agent-\(key)", agent: "Agent \(key)", title: "Plan \(key)", profileId: nil, plan: nil,
      profiles: [], state: .reading(reading), right: nil)
  }

  static func window(_ id: String, minutes: Int64, group: String? = nil) -> JSONValue {
    var fields: [String: JSONValue] = [
      "id": .string(id), "label": .string(id.uppercased()), "kind": .string("window"), "usedPercent": .int(20),
      "durationMinutes": .int(minutes), "resetsAt": .string("2026-11-26T12:00:00.000Z"),
    ]
    if let group {
      fields["group"] = .object(["id": .string("scope:\(group)"), "label": .string("\(group) only")])
    }
    return .object(fields)
  }

  @Test("two groups of two names are a model's week; one group's name stands alone")
  func keyOfTwoGroups() throws {
    let first = try Self.plan(
      "a", [Self.window("short", minutes: 300), Self.window("week", minutes: 10080, group: "Opus")])
    let second = try Self.plan("b", [Self.window("week", minutes: 10080, group: "Fable")])
    let one = BandsLayout.keyItems([first])
    #expect(one == [BandsKeyItem(band: .inner, words: "5 hours"), BandsKeyItem(band: .hairline, words: "Opus")])
    let two = BandsLayout.keyItems([first, second])
    #expect(
      two == [BandsKeyItem(band: .inner, words: "5 hours"), BandsKeyItem(band: .hairline, words: "a model's week")])
  }

  @Test("with nothing read yet the key names nothing")
  func keyOfNothing() throws {
    let empty = try #require(MetersFixtureDoor.fixture("agent-usage.empty"))
    let reading = try Self.home(empty)
    let every = reading.meters(of: nil, now: Self.fixtureNow)
    let items = BandsLayout.keyItems(every.entries)
    #expect(items.isEmpty)
  }
}
