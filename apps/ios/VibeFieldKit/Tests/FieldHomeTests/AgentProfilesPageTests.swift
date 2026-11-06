import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// UM-4 (UM-D25, UM-D26 A; §9 "The meters' words") — the Me menu's Agent Profiles row and the Agent Profiles page say
/// what the home's meters say: the row's word is the tightest percent (orange while a plan runs hot) or "reading…";
/// the page says where its reading comes from, its Profiles (All profiles first with several, the lens's check), its
/// Plans under the lens's head, a need's words with no act, and — wave 1, UM-D14's interim — no Show and no sessions
/// line. The home is the meters fixture's (This Mac, Work, Side and a draft) over the budget batch, read at its stamp.
/// Since the U3 review: the home's honest empty is a first read, only an agent that never meters "shows no meter",
/// and a reset a day or more off is said by its day.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("the Me menu's row and the Agent Profiles page say what the home's meters say")
@MainActor
struct AgentProfilesPageTests {
  static let now = MetersFixtureDoor.now

  /// The home as the feed would hold it.
  static func reading(
    _ usage: MetersReading.Usage? = nil, sets: String = "agents-profile-sets.meters"
  ) throws -> MetersReading {
    var reading = MetersReading()
    reading.connected = true
    reading.home = "dev-1"
    reading.sets = try AgentProfileSetsResult(json: try HomeFixture.json(sets)).sets
    reading.catalog = try AgentCatalogResult(json: try HomeFixture.json("agent-catalog.valid")).catalog
    if let usage {
      reading.usage = usage
    } else {
      reading.usage = .batch(try AgentAccountUsageBatch(json: try HomeFixture.json("agent-usage.budget")))
    }
    return reading
  }

  static func lens(_ reading: MetersReading, _ profile: String? = nil) -> ProfileLens {
    var lens = ProfileLens()
    lens.adopt(reading.profiles)
    lens.show(profile)
    return lens
  }

  static func words(_ reading: MetersReading, lens profile: String? = nil) -> AgentProfilesWords {
    AgentProfilesWords(reading: reading, lens: lens(reading, profile), home: "studio", now: now)
  }

  /// The Me menu's row as the corner draws it (`AgentProfilesMenuRow`, the one value both menus hold).
  static func menu(_ reading: MetersReading) -> AgentProfilesMenuRow {
    AgentProfilesMenuRow(reading: reading, now: now, open: {})
  }

  @Test("the Me menu's row: the tightest percent, orange with its dot while a plan runs hot; reading…; nothing unshared")
  func menuRow() throws {
    let readings = Self.menu(try Self.reading())
    #expect(readings.word == "64%")
    #expect(readings.hot)
    let first = Self.menu(try Self.reading(.waiting))
    #expect(first.word == "reading…")
    #expect(!first.hot)
    let refused = Self.menu(try Self.reading(.notShared))
    #expect(refused.word == nil)
  }

  @Test("where the reading comes from: its age and the home, reading, not shared, or unavailable — never a blank")
  func readWords() throws {
    let read = Self.words(try Self.reading()).read
    #expect(read == "Read a minute ago, from studio")
    let first = Self.words(try Self.reading(.waiting)).read
    #expect(first == "Reading usage…")
    let refused = Self.words(try Self.reading(.notShared)).read
    #expect(refused == "studio doesn't share usage yet")
    let down = Self.words(try Self.reading(.unavailable)).read
    #expect(down == "Usage unavailable")
  }

  @Test("Profiles: All profiles first with several, each profile's line and tightest word, the lens's check")
  func profiles() throws {
    let reading = try Self.reading()
    let words = Self.words(reading)
    let names = words.profiles.map(\.name)
    #expect(names == ["All profiles", "This Mac", "Work", "Side"])
    let lines = words.profiles.map(\.line)
    #expect(
      lines == ["3 profiles · 7 plans", "the agents' own sign-ins · 3 plans", "default · 3 plans", "2 plans"])
    let said = words.profiles.map(\.word)
    #expect(said == ["64%", "64%", "64%", "reading…"])
    let hot = words.profiles.map(\.hot)
    #expect(hot == [true, true, true, false])
    let checked = words.profiles.map(\.checked)
    #expect(checked == [true, false, false, false])
    let onWork = Self.words(reading, lens: "work").profiles.map(\.checked)
    #expect(onWork == [false, false, true, false])
  }

  @Test("with one profile nothing names a profile: no All profiles, no check, no default (UM-D12)")
  func oneProfile() throws {
    var reading = try Self.reading()
    reading.sets = reading.sets.filter { $0.kind == "native" }
    let words = Self.words(reading)
    let names = words.profiles.map(\.name)
    #expect(names == ["This Mac"])
    #expect(words.profiles.first?.checked == false)
    #expect(words.plansHead == "Plans")
  }

  @Test("Plans: Every plan with several, Plans in ‹profile› under the lens; a need is said where it is fixed, no act")
  func plans() throws {
    let reading = try Self.reading()
    #expect(Self.words(reading).plansHead == "Every plan")
    let work = Self.words(reading, lens: "work")
    #expect(work.plansHead == "Plans in Work")
    let titles = work.plans.map(\.title)
    #expect(titles == ["Claude Max", "ChatGPT Business", "Kimi Code"])
    let bodies = work.plans.map(\.body)
    let first = try #require(bodies.first)
    guard case .reading(let windows, let kept, let age, let forecast, let stale) = first else {
      Issue.record("Work's first plan is not a reading: \(first)")
      return
    }
    let ids = windows.map(\.line.id)
    #expect(ids == ["five-hour", "seven-day"])
    #expect(kept == nil)
    #expect(age == nil)
    #expect(forecast == "Runs out in ~1h 30m at this pace")
    #expect(!stale)
    #expect(bodies.dropFirst().first == .needs("Couldn't read · retry"))
    #expect(bodies.last == .needs("Not signed in · sign in on studio"))
    let glyphs = work.plans.map(\.glyph)
    #expect(glyphs.allSatisfy { $0 == nil })
  }

  @Test("every plan at once: a kept reading says its age, and the crowded agents wear their profile's glyph")
  func everyPlan() throws {
    let words = Self.words(try Self.reading())
    #expect(words.plans.count == 7)
    let kept = words.plans.compactMap { row -> String? in
      guard case .reading(_, let kept, _, _, _) = row.body else { return nil }
      return kept
    }
    #expect(kept == ["as of 32m ago"])
    let crowded = Set(words.plans.filter { $0.glyph != nil }.map(\.provider))
    #expect(crowded.count == 2)
    let alone = words.plans.filter { $0.glyph == nil }.map(\.provider)
    #expect(alone.allSatisfy { !crowded.contains($0) })
  }

  /// DESIGN.md §8 "A window read before its reset", §9 "A reading" — the phone's common case (UM-D8): the home's batch
  /// read three hours on, after the five hours reset. A window read before its reset says the reading's age where its
  /// reset stood, unlit and with no reset mark, as Settings' C1 line says it (48a30767d); a window still running keeps
  /// its reset; the plan's word is its tightest still running. A kept reading keeps its own age above its lines too.
  @Test("a window read before its reset says the reading's age where its reset stood; the tightest still runs")
  func passedSaysItsAge() throws {
    let reading = try Self.reading()
    let later = Self.now.addingTimeInterval(3 * 3600)
    let words = AgentProfilesWords(reading: reading, lens: Self.lens(reading, "native"), home: "studio", now: later)
    let anthropic = try #require(words.plans.first { $0.key == "plan:anthropic" })
    guard case .reading(let windows, let kept, let age, let forecast, _) = anthropic.body else {
      Issue.record("This Mac's Anthropic plan is not a reading: \(anthropic.body)")
      return
    }
    #expect(kept == nil)
    #expect(age == "as of 3h 1m ago")
    #expect(forecast == nil)
    let passed = windows.filter { $0.passed }.map(\.line.id)
    #expect(passed == ["five-hour"])
    let five = try #require(windows.first { $0.passed })
    let fiveSaid = UsageLineView.words(five.line, form: five.resetForm, age: age)
    #expect(fiveSaid == "5H: 64% used, as of 3h 1m ago")
    let week = try #require(windows.first { $0.line.id == "seven-day" })
    let weekSaid = UsageLineView.words(week.line, form: week.resetForm)
    #expect(weekSaid == "7D: 47% used, resets in 9h")
    let openai = try #require(words.plans.first { $0.key == "plan:openai" })
    guard case .reading(_, let openaiKept, let openaiAge, _, let stale) = openai.body else {
      Issue.record("This Mac's OpenAI plan is not a reading: \(openai.body)")
      return
    }
    #expect(stale)
    #expect(openaiKept == "as of 3h 32m ago")
    #expect(openaiAge == "as of 3h 32m ago")
    let native = try #require(words.profiles.first { $0.profileId == "native" })
    #expect(native.word == "47%")
    #expect(!native.hot)
  }

  @Test("an agent with no meter says ‹agent› shows no meter; a plan no agent named says its title alone")
  func noMeter() throws {
    var reading = try Self.reading(sets: "agents-profile-sets.valid")
    reading.usage = .batch(try AgentAccountUsageBatch(json: try HomeFixture.json("agent-usage.valid")))
    let catalog = MeterCatalog(rows: reading.catalog)
    let meters = reading.meters(of: "work", now: Self.now)
    let why = Dictionary(uniqueKeysWithValues: meters.entries.compactMap { entry in entry.why.map { (entry.key, $0) } })
    let work = Self.words(reading, lens: "work")
    var unreported = 0
    var unnamed = 0
    for row in work.plans {
      guard case .none(let said) = row.body else { continue }
      switch why[row.key] {
      case .unreported?:
        unreported += 1
        #expect(said == "\(catalog.name(row.provider)) shows no meter")
      case .unnamed?, .noWindows?:
        unnamed += 1
        #expect(said == row.title, "\(row.key): an agent that meters is said to show no meter")
      default:
        Issue.record("\(row.key) says \(said) with no reason to show no meter")
      }
    }
    #expect(unreported == 1)
    #expect(unnamed == 2)
  }

  @Test("the home's honest empty, before its first refresh, is a first read: Reading usage…, never Read 3d ago")
  func emptyBatchIsAFirstRead() throws {
    let raw = try #require(MetersFixtureDoor.fixture("agent-usage.empty"))
    let empty = try Self.reading(.batch(try AgentAccountUsageBatch(json: raw)))
    #expect(empty.firstRead)
    let words = Self.words(empty)
    #expect(words.read == "Reading usage…")
    let menu = Self.menu(empty)
    #expect(menu.word == "reading…")
    let waiting = try Self.reading(.waiting)
    #expect(waiting.firstRead)
    let read = try Self.reading()
    #expect(!read.firstRead)
    let refused = try Self.reading(.notShared)
    #expect(!refused.firstRead)
    let down = try Self.reading(.unavailable)
    #expect(!down.firstRead)
  }

  @Test("a window's reset aloud: by its length \"resets in 2h\", by its day \"resets Thu 09:00\", or \"resets now\"")
  func resetSaid() {
    func line(_ reset: String) -> UsageLine {
      UsageLine(
        id: "seven-day", label: "7D", group: nil, usedPercent: 42, elapsedPercent: 50, reset: reset, resets: true,
        hot: false)
    }
    #expect(UsageLineView.words(line("2h"), form: .length) == "7D: 42% used, resets in 2h")
    #expect(UsageLineView.words(line("Thu 09:00"), form: .day) == "7D: 42% used, resets Thu 09:00")
    #expect(UsageLineView.words(line("now"), form: .now) == "7D: 42% used, resets now")
    // a window read before its reset says the reading's age in its reset's place (a reading whose time cannot be
    // read hands no age, and keeps "resets now")
    #expect(UsageLineView.words(line("now"), form: .now, age: "as of 3h ago") == "7D: 42% used, as of 3h ago")
  }

  @Test("a tap on a plan's arc focuses it; a tap in the middle focuses none")
  func tapFocuses() throws {
    let reading = try Self.reading()
    let meters = reading.meters(of: nil, now: Self.now)
    var options = BandsOptions()
    options.hit = true
    options.every = true
    let geometry = BandsLayout.geometry(214, meters.entries, options)
    let plan = try #require(geometry.plans.first)
    let hit = try #require(plan.hit)
    let spot = BandsLayout.at(107, hit.r, plan.from + plan.span / 2)
    #expect(geometry.plan(at: spot.x, spot.y) == plan.key)
    #expect(geometry.plan(at: 107, 107) == nil)
  }
}
