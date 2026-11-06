import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// UM-4 (UM-D25, UM-D26 A; §9 "The meters' words") — the Me menu's Agent Profiles row and the Agent Profiles page say
/// what the home's meters say: the row's word is the tightest percent (orange while a plan runs hot) or "reading…";
/// the page says where its reading comes from, its Profiles (All profiles first with several, the lens's check), its
/// Plans under the lens's head, a need's words with no act, and — wave 1, UM-D14's interim — no Show and no sessions
/// line. The home is the meters fixture's (This Mac, Work, Side and a draft) over the budget batch, read at its stamp.
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

  @Test("the Me menu's row: the tightest percent, orange with its dot while a plan runs hot; reading…; nothing unshared")
  func menuRow() throws {
    let readings = Self.words(try Self.reading())
    #expect(readings.menuWord == "64%")
    #expect(readings.menuHot)
    let first = Self.words(try Self.reading(.waiting))
    #expect(first.menuWord == "reading…")
    #expect(!first.menuHot)
    let refused = Self.words(try Self.reading(.notShared))
    #expect(refused.menuWord == nil)
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
    guard case .reading(let windows, let kept, let forecast, let stale) = first else {
      Issue.record("Work's first plan is not a reading: \(first)")
      return
    }
    let ids = windows.map(\.line.id)
    #expect(ids == ["five-hour", "seven-day"])
    #expect(kept == nil)
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
      guard case .reading(_, let kept, _, _) = row.body else { return nil }
      return kept
    }
    #expect(kept == ["as of 32m ago"])
    let crowded = Set(words.plans.filter { $0.glyph != nil }.map(\.provider))
    #expect(crowded.count == 2)
    let alone = words.plans.filter { $0.glyph == nil }.map(\.provider)
    #expect(alone.allSatisfy { !crowded.contains($0) })
  }

  @Test("an agent with no meter is a line of its own: ‹agent› shows no meter")
  func noMeter() throws {
    var reading = try Self.reading(sets: "agents-profile-sets.valid")
    reading.usage = .batch(try AgentAccountUsageBatch(json: try HomeFixture.json("agent-usage.valid")))
    let work = Self.words(reading, lens: "work")
    let none = work.plans.compactMap { row -> String? in
      guard case .none(let said) = row.body else { return nil }
      return said
    }
    #expect(!none.isEmpty)
    #expect(none.allSatisfy { $0.hasSuffix(" shows no meter") })
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
