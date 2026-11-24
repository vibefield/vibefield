import FieldHistory
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
/// and a reset a day or more off is said by its day. *(Corrected 2026-11-09, UM-5b: wave 1 ended. "No Show and no
/// sessions line" now holds only while the field is not live; the live rows are at the end of the suite's page rows.)*
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
    guard case .reading(let windows, let kept, let ages, let stale) = first else {
      Issue.record("Work's first plan is not a reading: \(first)")
      return
    }
    let ids = windows.map(\.line.id)
    #expect(ids == ["five-hour", "seven-day"])
    #expect(kept == nil)
    #expect(ages.isEmpty)
    // UM-6 (UM-D29): no forecast sentence; the five hours marks its own run-out under its bar
    let five = windows.first { $0.line.id == "five-hour" }
    let out = five?.forecast?.short
    #expect(out == "out in ~1h 30m")
    #expect(!stale)
    #expect(bodies.dropFirst().first == .needs("Couldn't read · retry"))
    #expect(bodies.last == .needs("Not signed in · sign in on studio"))
    let glyphs = work.plans.map(\.glyph)
    #expect(glyphs.allSatisfy { $0 == nil })
  }

  /// UM-5b — a run on a plan, and the field as the page reads it.
  static func run(
    _ id: String, key: String?, state: PhoneSearch.LiveState = .working, profile: String? = nil
  ) -> PhoneSearch.LiveSession {
    PhoneSearch.LiveSession(
      id: id, title: id, folder: nil, agent: nil, state: state, profileSet: profile, device: "dev-1",
      deviceName: "studio", platform: "darwin", isHome: true, nativeSessionId: nil, planKey: key)
  }

  static func field(_ sessions: [PhoneSearch.LiveSession]) -> PhoneSearch.Live {
    PhoneSearch.Live(sessions: sessions, desks: [], profiles: [])
  }

  /// A row of the page's Plans by what its body is.
  static func row(
    _ words: AgentProfilesWords, _ matches: (AgentProfilesWords.PlanRow.Body) -> Bool
  ) -> AgentProfilesWords.PlanRow? {
    words.plans.first { matches($0.body) }
  }

  static func isReading(_ body: AgentProfilesWords.PlanRow.Body) -> Bool {
    if case .reading = body { return true }
    return false
  }

  static func isNeed(_ body: AgentProfilesWords.PlanRow.Body) -> Bool {
    if case .needs = body { return true }
    return false
  }

  @Test("while the field is live a plan says its sessions and draws Show; none says no sessions and draws none")
  func sessionsAndShow() throws {
    let reading = try Self.reading()
    let lens = Self.lens(reading)
    let at = AgentProfilesWords(reading: reading, lens: lens, home: "studio", now: Self.now, live: Self.field([]))
    let found = Self.row(at, Self.isReading)
    let plan = try #require(found)
    #expect(plan.sessions == "no sessions")
    #expect(plan.show == nil)

    let live = Self.field([
      Self.run("a", key: plan.key), Self.run("b", key: plan.key, state: .blocked), Self.run("c", key: nil),
    ])
    let words = AgentProfilesWords(reading: reading, lens: lens, home: "studio", now: Self.now, live: live)
    let row = words.plans.first { $0.key == plan.key }
    let said = try #require(row)
    #expect(said.sessions == "2 sessions · 1 working · 1 waiting for you")
    #expect(said.show == .show(plan.key))
  }

  @Test("the plan shown says Showing, with one profile too")
  func showing() throws {
    var reading = try Self.reading()
    reading.sets = reading.sets.filter { $0.kind == "native" }
    var lens = Self.lens(reading)
    let every = Self.words(reading)
    let found = Self.row(every, Self.isReading)
    let plan = try #require(found)
    lens.showPlan(plan.key)
    let live = Self.field([Self.run("a", key: plan.key)])
    let words = AgentProfilesWords(reading: reading, lens: lens, home: "studio", now: Self.now, live: live)
    let row = words.plans.first { $0.key == plan.key }
    let said = try #require(row)
    #expect(said.show == .showing)
  }

  @Test("under a lens Show carries the plan's whole key")
  func showUnderALens() throws {
    let reading = try Self.reading()
    let lens = Self.lens(reading, "work")
    let shown = Self.words(reading, lens: "work")
    let found = Self.row(shown, Self.isReading)
    let plan = try #require(found)
    let key = "work/\(plan.key)"
    let live = Self.field([Self.run("a", key: key, profile: "work")])
    let words = AgentProfilesWords(reading: reading, lens: lens, home: "studio", now: Self.now, live: live)
    let row = words.plans.first { $0.key == plan.key }
    let said = try #require(row)
    #expect(said.show == .show(key))
  }

  /// UM-5b (the review's finding; §8 "The phone's corner") — Show promises only what the filter would keep: under a lens a
  /// twin's run under another profile counts on its own row, never this one. With no lens both profiles' runs count.
  @Test("under a lens a plan's line and Show count only that profile's sessions, never a twin's under another")
  func twinUnderALens() throws {
    let reading = try Self.reading()
    let lens = Self.lens(reading, "work")
    let shown = Self.words(reading, lens: "work")
    let found = Self.row(shown, Self.isReading)
    let plan = try #require(found)
    let work = "work/\(plan.key)"
    let native = "native/\(plan.key)"
    // only a twin's run: Work's row has none of its own, so no sessions and no Show
    let twin = Self.field([Self.run("n", key: native, profile: "native")])
    let none = AgentProfilesWords(reading: reading, lens: lens, home: "studio", now: Self.now, live: twin)
    let noneRow = none.plans.first { $0.key == plan.key }
    let empty = try #require(noneRow)
    #expect(empty.sessions == "no sessions")
    #expect(empty.show == nil)
    // Work's run counts, the twin's does not; Show carries the plan's whole key
    let both = Self.field([Self.run("n", key: native, profile: "native"), Self.run("w", key: work, profile: "work")])
    let under = AgentProfilesWords(reading: reading, lens: lens, home: "studio", now: Self.now, live: both)
    let underRow = under.plans.first { $0.key == plan.key }
    let one = try #require(underRow)
    #expect(one.sessions == "1 session · 1 working")
    #expect(one.show == .show(work))
    // with no lens a plan two profiles share counts both
    let every = AgentProfilesWords(reading: reading, lens: Self.lens(reading), home: "studio", now: Self.now, live: both)
    let everyRow = every.plans.first { $0.key == native || $0.key == work }
    let shared = try #require(everyRow)
    #expect(shared.sessions == "2 sessions · 2 working")
  }

  /// UM-5b (the review's F8) — the twin's row says Showing while its plan is the one chosen, under a lens on the other
  /// profile too (`family`, not the key); a plan with no meter has no sessions line and no act, even live.
  @Test("Showing stands on a twin's row under a lens on the other profile")
  func showingOnATwin() throws {
    let reading = try Self.reading()
    var lens = Self.lens(reading, "work")
    let shown = Self.words(reading, lens: "work")
    let found = Self.row(shown, Self.isReading)
    let plan = try #require(found)
    lens.showPlan("native/\(plan.key)")
    let live = Self.field([])
    let words = AgentProfilesWords(reading: reading, lens: lens, home: "studio", now: Self.now, live: live)
    let row = words.plans.first { $0.key == plan.key }
    let said = try #require(row)
    #expect(said.show == .showing)
  }

  @Test("a plan with no meter draws no sessions line and no act, even while the field is live")
  func noMeterNoAct() throws {
    var reading = try Self.reading(sets: "agents-profile-sets.valid")
    reading.usage = .batch(try AgentAccountUsageBatch(json: try HomeFixture.json("agent-usage.valid")))
    let shown = Self.words(reading, lens: "work")
    let found = shown.plans.first { row in
      if case .none = row.body { return true }
      return false
    }
    let none = try #require(found)
    let live = Self.field([Self.run("a", key: "work/\(none.key)", profile: "work")])
    let words = AgentProfilesWords(
      reading: reading, lens: Self.lens(reading, "work"), home: "studio", now: Self.now, live: live)
    let row = words.plans.first { $0.key == none.key }
    let said = try #require(row)
    #expect(said.sessions == nil)
    #expect(said.show == nil)
  }

  @Test("a plan that needs you says its sessions and draws no Show; with no live field nothing is said")
  func needsNoShow() throws {
    let reading = try Self.reading()
    let lens = Self.lens(reading)
    let every = Self.words(reading)
    let found = Self.row(every, Self.isNeed)
    let need = try #require(found)
    #expect(need.sessions == nil)
    #expect(need.show == nil)
    let live = Self.field([Self.run("a", key: need.key)])
    let words = AgentProfilesWords(reading: reading, lens: lens, home: "studio", now: Self.now, live: live)
    let row = words.plans.first { $0.key == need.key }
    let said = try #require(row)
    #expect(said.sessions == "1 session · 1 working")
    #expect(said.show == nil)
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

  /// DESIGN.md §8 "A window read before its reset", §9 "A reading" — the phone's common case (UM-D8): the home's batch
  /// read three hours on, after the five hours reset. A window read before its reset says the reading's age, unlit, as
  /// Settings' C1 line says it (48a30767d); a window still running keeps its reset; the plan's word is its tightest
  /// still running. A kept reading keeps its own age above its lines too. *Since UM-6 (§8 "A meter line's end"):* the
  /// passed line's cap says when it reset ("RESET 12:30") and its age stands under its bar; the running week's cap says
  /// its reset on the clock, and its words how far off it is. The clock is the simulator's own zone, so the words are
  /// held to the window's own clock, never to a literal time.
  @Test("a window read before its reset says when it reset and the reading's age; the tightest still runs")
  func passedSaysItsAge() throws {
    let reading = try Self.reading()
    let later = Self.now.addingTimeInterval(3 * 3600)
    let words = AgentProfilesWords(reading: reading, lens: Self.lens(reading, "native"), home: "studio", now: later)
    let anthropic = try #require(words.plans.first { $0.key == "plan:anthropic" })
    guard case .reading(let windows, let kept, let ages, _) = anthropic.body else {
      Issue.record("This Mac's Anthropic plan is not a reading: \(anthropic.body)")
      return
    }
    #expect(kept == nil)
    let age = ages["five-hour"]
    #expect(age == "as of 3h 1m ago")
    let passed = windows.filter { $0.passed }.map(\.line.id)
    #expect(passed == ["five-hour"])
    let five = try #require(windows.first { $0.passed })
    #expect(five.forecast == nil)
    let fiveClock = try #require(five.resetClock)
    #expect(fiveClock.passed)
    #expect(fiveClock.away == nil)
    #expect(fiveClock.day == nil)
    let fiveSaid = UsageLineView.words(five.line, clock: fiveClock, age: age)
    #expect(fiveSaid == "5H: 64% used, reset \(fiveClock.saidAt), as of 3h 1m ago")
    let week = try #require(windows.first { $0.line.id == "seven-day" })
    let weekClock = try #require(week.resetClock)
    #expect(!weekClock.passed)
    #expect(weekClock.away == "9h")
    let weekSaid = UsageLineView.words(week.line, clock: weekClock)
    #expect(weekSaid == "7D: 47% used, resets \(weekClock.saidAt), in 9h")
    let openai = try #require(words.plans.first { $0.key == "plan:openai" })
    guard case .reading(_, let openaiKept, let openaiAges, let stale) = openai.body else {
      Issue.record("This Mac's OpenAI plan is not a reading: \(openai.body)")
      return
    }
    #expect(stale)
    #expect(openaiKept == "as of 3h 32m ago")
    // Codex's passed line is its primary window (reset 13:30Z, read at 11:28Z): the one key `ages` holds
    let openaiAge = openaiAges["primary"]
    #expect(openaiAge == "as of 3h 32m ago")
    let native = try #require(words.profiles.first { $0.profileId == "native" })
    #expect(native.word == "47%")
    #expect(!native.hot)
  }

  /// Item 274 (UM-274-D2 A, 2026-11-10; DESIGN.md §8 "A meter a later reading did not carry"): the phone's twin
  /// of Settings' S1. A push half a minute old over meters kept from earlier reads (`agent-usage.kept-meters`, the
  /// mock door's `-vf-mock-usage=kept-meters`, read at its `now`): each passed line says its own read, and a kept plan
  /// says its tightest's.
  @Test("item 274: each passed line says its own read's age, and a kept plan its tightest's, never the push's")
  func keptMetersSayTheirOwnRead() throws {
    let batch = try AgentAccountUsageBatch(json: try HomeFixture.json("agent-usage.kept-meters"))
    let reading = try Self.reading(.batch(batch))
    let mac = AgentProfilesWords(reading: reading, lens: Self.lens(reading, "native"), home: "studio", now: Self.now)
    let anthropic = try #require(mac.plans.first { $0.key == "plan:anthropic" })
    guard case .reading(_, let kept, let ages, _) = anthropic.body else {
      Issue.record("This Mac's Anthropic plan is not a reading: \(anthropic.body)")
      return
    }
    // the Fable week was read at 11:20Z and its reset came at 11:45Z; the push came at 11:59:30Z
    #expect(kept == nil)
    #expect(ages == ["fable": "as of 40m ago"])
    let side = AgentProfilesWords(reading: reading, lens: Self.lens(reading, "side"), home: "studio", now: Self.now)
    let sideAnthropic = try #require(side.plans.first { $0.key == "plan:anthropic" })
    guard case .reading(_, let sideKept, let sideAges, let stale) = sideAnthropic.body else {
      Issue.record("Side's Anthropic plan is not a reading: \(sideAnthropic.body)")
      return
    }
    // kept after a refused refresh; its tightest, the Fable week at 96%, was read at 10:00Z and still runs
    #expect(stale)
    #expect(sideKept == "as of 2h ago")
    #expect(sideAges.isEmpty)
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

  /// A line handed no clock (none since UM-6: every window that names a reset carries one) keeps the words it said
  /// before; `MeterLineEndTests` holds the clock's words.
  @Test("a line with no clock says its reset as before: \"resets in 2h\", \"resets Thu 09:00\", or \"resets now\"")
  func resetSaid() {
    func line(_ reset: String) -> UsageLine {
      UsageLine(
        id: "seven-day", label: "7D", group: nil, usedPercent: 42, elapsedPercent: 50, reset: reset, resets: true,
        hot: false)
    }
    #expect(UsageLineView.words(line("2h"), clock: nil, form: .length) == "7D: 42% used, resets in 2h")
    #expect(UsageLineView.words(line("Thu 09:00"), clock: nil, form: .day) == "7D: 42% used, resets Thu 09:00")
    #expect(UsageLineView.words(line("now"), clock: nil, form: .now) == "7D: 42% used, resets now")
    // a window read before its reset says the reading's age in its reset's place (a reading whose time cannot be
    // read hands no age, and keeps "resets now")
    let aged = UsageLineView.words(line("now"), clock: nil, age: "as of 3h ago", form: .now)
    #expect(aged == "7D: 42% used, as of 3h ago")
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

  /// The page's plan rows say each named plan's sign-in veiled, and never the address whole.
  @Test("a plan's row says its sign-in veiled beside its title, never whole")
  func planRowSignIn() throws {
    let reading = try Self.reading()
    let words = Self.words(reading)
    let named = reading.meters(of: nil, now: Self.now).entries.filter { $0.plan?.account != nil }
    #expect(!named.isEmpty)
    for entry in named {
      let row = try #require(words.plans.first { $0.key == entry.key })
      #expect(row.account == MeterModel.veiledAccount(entry.plan?.account))
      let who = entry.plan?.account?.components(separatedBy: " · ").first ?? ""
      #expect(who.count > 1)
      let said = [row.title, row.account ?? ""].joined(separator: " ")
      #expect(!said.contains(who))
    }
  }

  /// DESIGN.md §8 "A plan's tier" — the page's Plans over made-up profiles (`TierFixture`), under a lens or none.
  static func tieredSets(
    _ sets: [AgentProfileSet], usage: MetersReading.Usage = .waiting, lens profile: String? = nil
  ) throws -> AgentProfilesWords {
    var reading = MetersReading()
    reading.connected = true
    reading.home = "dev-1"
    reading.sets = sets
    reading.catalog = try AgentCatalogResult(json: try HomeFixture.json("agent-catalog.valid")).catalog
    reading.usage = usage
    return Self.words(reading, lens: profile)
  }

  /// One made-up profile's Plans, before any reading (or with the home's usage door down).
  static func tiered(
    _ plans: [TierFixture.Plan], usage: MetersReading.Usage = .waiting
  ) throws -> AgentProfilesWords {
    try Self.tieredSets([try TierFixture.set(plans)], usage: usage)
  }

  /// A plan's row by its plan's id: `plan:‹id›` under a lens, `‹profile›/plan:‹id›` in every plan.
  static func tierRow(_ words: AgentProfilesWords, _ id: String) -> AgentProfilesWords.PlanRow? {
    words.plans.first { $0.key == "plan:\(id)" || $0.key.hasSuffix("/plan:\(id)") }
  }

  static func isLine(_ row: AgentProfilesWords.PlanRow) -> Bool {
    if case .none = row.body { return true }
    return false
  }

  @Test("a plan's badge is its label as given; its unread sibling's the empty capsule; a plan with no tier draws none")
  func tierBesideItsFamily() throws {
    let words = try Self.tiered([
      .init(id: "a", tier: TierFixture.label("20x")), .init(id: "b", tier: TierFixture.noTier), .init(id: "c"),
      .init(id: "x", service: "openai", serviceLabel: "OpenAI", provider: "codex", plan: "pro"),
    ])
    let tiered = try #require(Self.tierRow(words, "a"))
    #expect(tiered.title == "Claude Max")
    #expect(tiered.tier == .label("20x"))
    let none = try #require(Self.tierRow(words, "b"))
    #expect(none.tier == nil, "the agent says it has no tier: nothing, beside a tiered sibling too")
    let unread = try #require(Self.tierRow(words, "c"))
    #expect(unread.tier == .unread)
    let other = try #require(Self.tierRow(words, "x"))
    #expect(other.tier == nil, "another service's plan is no family of a tiered one")
  }

  @Test("with no labelled plan of its family in view, a plan whose tier was not read draws nothing")
  func tierAlone() throws {
    let alone = try Self.tiered([.init(id: "c")])
    let only = try #require(Self.tierRow(alone, "c"))
    #expect(only.tier == nil)
    // a sibling that says it has no tier is no reason for the capsule
    let besideNone = try Self.tiered([.init(id: "b", tier: TierFixture.noTier), .init(id: "c")])
    let quiet = try #require(Self.tierRow(besideNone, "c"))
    #expect(quiet.tier == nil)
    // another title of the same service is another family
    let besidePro = try Self.tiered([.init(id: "a", plan: "pro", tier: TierFixture.label("20x")), .init(id: "c")])
    let otherTitle = try #require(Self.tierRow(besidePro, "c"))
    #expect(otherTitle.tier == nil)
  }

  @Test("the tier names the plan, not its reading: a plan with no meter keeps its badge and is a sibling")
  func tierWithNoMeter() throws {
    // an agent that reports no usage: its plan is a line, still titled, and its label still stands
    let unreported = try Self.tiered([
      .init(id: "h", provider: "hermes", tier: TierFixture.label("20x")), .init(id: "c"),
    ])
    let line = try #require(Self.tierRow(unreported, "h"))
    #expect(Self.isLine(line))
    #expect(line.tier == .label("20x"))
    let beside = try #require(Self.tierRow(unreported, "c"))
    #expect(beside.tier == .unread)
    // the home's usage door down: every plan is a line, and each keeps what its sign-in read
    let down = try Self.tiered([.init(id: "a", tier: TierFixture.label("20x")), .init(id: "c")], usage: .unavailable)
    let labelled = try #require(Self.tierRow(down, "a"))
    #expect(Self.isLine(labelled))
    #expect(labelled.tier == .label("20x"))
    #expect(labelled.spoken == "Claude Max 20x")
    let unread = try #require(Self.tierRow(down, "c"))
    #expect(unread.tier == .unread)
  }

  @Test("a family is read among the plans in view: every plan's, or the lens's profile's alone")
  func tierUnderALens() throws {
    let work = try TierFixture.set([.init(id: "a", tier: TierFixture.label("20x"))])
    let side = try TierFixture.set([.init(id: "c")], id: "side", label: "Side", isDefault: false)
    let every = try Self.tieredSets([work, side])
    let everyRow = try #require(Self.tierRow(every, "c"))
    #expect(everyRow.tier == .unread)
    let onSide = try Self.tieredSets([work, side], lens: "side")
    #expect(onSide.plansHead == "Plans in Side")
    let sideRow = try #require(Self.tierRow(onSide, "c"))
    #expect(sideRow.tier == nil, "under the lens its labelled sibling is out of view")
    let onWork = try Self.tieredSets([work, side], lens: "work")
    let workRow = try #require(Self.tierRow(onWork, "a"))
    #expect(workRow.tier == .label("20x"))
  }

  @Test("a plan is spoken with its tier's label after its title, a space between; the badge cuts past the cap")
  func tierSpoken() throws {
    let words = try Self.tiered([.init(id: "a", tier: TierFixture.label("20x")), .init(id: "c")])
    let tiered = try #require(Self.tierRow(words, "a"))
    #expect(tiered.spoken == "Claude Max 20x")
    let unread = try #require(Self.tierRow(words, "c"))
    #expect(unread.spoken == "Claude Max", "a tier not read says nothing aloud")
    #expect(AgentProfilesWords.badgeWords("20x") == "20x")
    #expect(AgentProfilesWords.badgeWords("12345678") == "12345678")
    #expect(AgentProfilesWords.badgeWords("123456789") == "1234567…")
  }
}
