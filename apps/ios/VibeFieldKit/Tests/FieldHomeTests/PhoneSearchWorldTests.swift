import FieldAgents
import FieldHistory
import FieldMesh
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// SE-2 (SE-D2, SE-D3, SE-D4, SE-D5 A, UM-D28 A; DESIGN.md §8 "The phone's search") — the home's world as search
/// reads it (the window's drawn rows, the roster, the lens) and the sheet's content composed from it; what a chip, a
/// token's ×, an offer and an empty list's act change; and the mock's doors and world.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("search's world: the drawn rows, the desktops, the lens and the sheet's content")
struct PhoneSearchWorldTests {
  static let studio = PhoneSearch.Desk(id: "dev-home", name: "studio", platform: "darwin", asleep: false, isHome: true)
  static let loft = PhoneSearch.Desk(id: "dev-loft", name: "loft", platform: "linux", asleep: false, isHome: false)

  /// ProfileLensTokenTests' eight runs, with the two desktops they run on.
  static func world() throws -> PhoneSearch.Live {
    var live = try ProfileLensTokenTests.field()
    live.desks = [studio, loft]
    return live
  }

  static func lens(_ chosen: String?) throws -> ProfileLens {
    var lens = ProfileLensTests.lens(try ProfileLensTests.three())
    lens.show(chosen)
    return lens
  }

  /// PG-3a's witness: Studio (the home, seven rows), Loft (three, through the home) and Attic (one, asleep).
  @Test("a drawn row as search reads it: its body's id, its facts, its state, the home's profile only on the home's")
  func witnessSessions() throws {
    let rows = try HomeFixture.witnessRows()
    let desks = PhoneSearchWorld.desks(rows: rows)
    let sessions = rows.map { PhoneSearchWorld.session($0, desks: desks) }
    #expect(sessions.count == 11)
    for (row, session) in zip(rows, sessions) {
      let monitor = row.row.monitor
      #expect(session.id == row.visualId)
      #expect(session.device == row.device)
      #expect(session.deviceName == monitor.device.name)
      #expect(session.isHome == row.isSelf)
      // the lens is self-only: a peer's run carries no profile of the home's
      let profile = row.isSelf ? monitor.profileSet : nil
      #expect(session.profileSet == profile)
      #expect(session.nativeSessionId == row.board.nativeSessionId)
      let folder = monitor.project.name.isEmpty ? nil : monitor.project.name
      #expect(session.folder == folder)
      // the title is the body's own line, said as the home says it (the desktop is its pill's)
      let line = MonitorWords.detailLine(monitor, isSelf: true)
      let title = line.isEmpty ? MonitorWords.projectName(monitor) : line
      #expect(session.title == title)
      if monitor.kind == .terminal {
        #expect(session.state == .shell)
        #expect(session.agent == "shell")
      } else {
        let state: PhoneSearch.LiveState =
          switch monitor.status {
          case .blocked: .blocked
          case .working: .working
          case .idle: .idle
          }
        #expect(session.state == state)
      }
    }
    let home = sessions.filter { $0.isHome }.count
    #expect(home == 7)
  }

  @Test("the desktops search names: the roster's, asleep while its door does not answer; or the rows' own, in order")
  func desks() throws {
    let roster = [
      FieldDesktop(deviceId: "dev-1", name: "studio", platform: "darwin", state: .ready, feed: .door),
      FieldDesktop(deviceId: "dev-2", name: "mini", platform: "darwin", state: .noDoor, feed: .none),
    ]
    let named = PhoneSearchWorld.desks(roster, home: "dev-1")
    #expect(
      named == [
        PhoneSearch.Desk(id: "dev-1", name: "studio", platform: "darwin", asleep: false, isHome: true),
        PhoneSearch.Desk(id: "dev-2", name: "mini", platform: "darwin", asleep: true, isHome: false),
      ])

    let fromRows = PhoneSearchWorld.desks(rows: try HomeFixture.witnessRows())
    let names = fromRows.map { $0.name }
    #expect(names == ["Studio", "Loft", "Attic"])
    let platforms = fromRows.map { $0.platform }
    #expect(platforms == ["macos", "linux", "windows"])
    let homes = fromRows.map { $0.isHome }
    #expect(homes == [true, false, false])
    let asleep = fromRows.map { $0.asleep }
    #expect(asleep == [false, false, true])
  }

  @Test("Live now's world names the lens's profiles only while it offers them, and asks each desktop of its own runs")
  func liveWorld() throws {
    let rows = try HomeFixture.witnessRows()
    let desks = PhoneSearchWorld.desks(rows: rows)
    let live = PhoneSearchWorld.live(rows: rows, desks: desks, lens: try Self.lens(nil), lines: [:])
    #expect(live.sessions.count == 11)
    #expect(live.desks == desks)
    let profiles = live.profiles.map { $0.id }
    #expect(profiles == ["native", "work", "side"])
    let one = ProfileLensTests.lens([try ProfileLensTests.set("native", kind: "native")])
    let alone = PhoneSearchWorld.live(rows: rows, desks: desks, lens: one, lines: [:])
    #expect(alone.profiles.isEmpty)

    // the live ask: each desktop's runs that have a conversation, by its native id
    let runs = PhoneSearchWorld.runs(live)
    let asked = live.sessions.filter { $0.nativeSessionId != nil }
    #expect(!asked.isEmpty)
    let total = runs.values.reduce(0) { $0 + $1.count }
    #expect(total == asked.count)
    for session in asked {
      let mine = runs[session.device] ?? []
      #expect(mine.contains(session.nativeSessionId ?? ""))
    }
  }

  @Test("Live now's content: the lens's rows and token, the chips less the chosen, the foot; one profile names none")
  func liveContent() throws {
    let world = try Self.world()
    let work = PhoneSearchWorld.content(
      SearchState(), query: "", lens: try Self.lens("work"), live: world, answers: [], latest: nil,
      agentLabel: { $0 }, feed: .live, asked: .settled)
    #expect(work.scope == .live)
    #expect(work.rows == .live(PhoneSearch.liveRows(world, query: "", profile: "work", desk: nil)))
    let tokens = work.tokens.map { $0.label }
    #expect(tokens == ["Work"])
    #expect(work.chips == PhoneSearch.liveChips(world, profile: "work", desk: nil))
    #expect(work.foot == "3 of 8 live sessions, waiting first")
    #expect(work.empty == nil)
    #expect(work.profiles == world.profiles)
    #expect(work.terms.isEmpty)

    // a desktop with nothing under the lens: the empty words name both, with Clear the filters
    var lens = try Self.lens("work")
    lens.keep(desk: "dev-loft")
    let none = PhoneSearchWorld.content(
      SearchState(), query: "", lens: lens, live: world, answers: [], latest: nil, agentLabel: { $0 }, feed: .live,
      asked: .settled)
    // `PhoneSearch.Empty` has no public init (FieldHistory's own value): its two fields are read instead
    #expect(none.empty?.sentence == "No live session in Work runs on loft.")
    #expect(none.empty?.act == .clearFilters)
    let both = none.tokens.map { $0.label }
    #expect(both == ["Work", "loft"])

    // words: they mark the rows
    let typed = PhoneSearchWorld.content(
      SearchState(), query: "W1 ", lens: try Self.lens(nil), live: world, answers: [], latest: nil,
      agentLabel: { $0 }, feed: .live, asked: .settled)
    #expect(typed.terms == ["w1"])
  }

  /// SE-2l (the S2 review's finding 7; §8 "folder · agent") — Everything's rows name an agent by the catalog's label,
  /// and by its id while no desktop's catalog names it (the tolerant reader, R4). The ids are invented: no agent's.
  @Test("an agent is named by the catalog's label, by its id while no catalog names it")
  func agentLabels() {
    let named = AgentCatalogEntry(id: AgentProvider(rawValue: "agent-a"), label: "Agent A", status: "supported")
    let label = PhoneSearchWorld.agentLabel(AgentCatalog(entries: [named]))
    #expect(label("agent-a") == "Agent A")
    #expect(label("agent-z") == "agent-z")
    #expect(PhoneSearchWorld.agentLabel(.empty)("agent-a") == "agent-a")
  }

  /// SE-2i (the S2 review's finding 4) — the content says what the world has answered: until the home's board answers
  /// nothing says what runs, and words nobody answered never read as "no matches".
  @Test("the content is honest: Asking what runs… before the board answers, and no empty words for unanswered words")
  func honestContent() throws {
    let empty = PhoneSearch.Live(sessions: [], desks: [], profiles: [])
    let asking = PhoneSearchWorld.content(
      SearchState(), query: "", lens: try Self.lens(nil), live: empty, answers: [], latest: nil, agentLabel: { $0 },
      feed: .asking, asked: .settled)
    #expect(asking.foot == "Asking what runs…")
    #expect(asking.empty == nil)

    let unanswered = PhoneSearch.Asked(asking: true, answered: false)
    let past = PhoneSearchWorld.content(
      SearchState(scope: .everything), query: "zebra", lens: try Self.lens(nil), live: empty, answers: [],
      latest: nil, agentLabel: { $0 }, feed: .live, asked: unanswered)
    #expect(past.foot == "0 sessions matched · searching")
    #expect(past.empty == nil)
  }

  /// SE-2i — Live now's world as it stands: the home's live board; else its refusal in its own words, the home asleep
  /// by its name, or asking.
  @Test("the feed: live while the home's board answers, else refused in its words, asleep by name, or asking")
  func feed() {
    let ready = FieldDesktop(deviceId: "dev-1", name: "studio", platform: "darwin", state: .ready, feed: .door)
    #expect(PhoneSearchWorld.feed(isLive: true, home: ready) == .live)
    #expect(PhoneSearchWorld.feed(isLive: false, home: ready) == .asking)
    #expect(PhoneSearchWorld.feed(isLive: false, home: nil) == .asking)
    let refused = FieldDesktop(
      deviceId: "dev-1", name: "studio", platform: "darwin", state: .ready, feed: .none,
      fieldRefusal: "the board is not this account's")
    #expect(PhoneSearchWorld.feed(isLive: false, home: refused) == .refused("the board is not this account's"))
    let failed = FieldDesktop(
      deviceId: "dev-1", name: "studio", platform: "darwin", state: .failed("the door said no"), feed: .none)
    #expect(PhoneSearchWorld.feed(isLive: false, home: failed) == .refused("the door said no"))
    let asleep = FieldDesktop(deviceId: "dev-1", name: "studio", platform: "darwin", state: .noDoor, feed: .none)
    #expect(PhoneSearchWorld.feed(isLive: false, home: asleep) == .asleep("studio"))
    let connecting = FieldDesktop(
      deviceId: "dev-1", name: "studio", platform: "darwin", state: .connecting, feed: .none)
    #expect(PhoneSearchWorld.feed(isLive: false, home: connecting) == .asking)
  }

  /// SE-2i — Everything has answered when every desktop that can be asked answered these words, and at least one
  /// could; a desktop with no door (the mock's corpus) is matched on the phone; an asleep one waits, by name.
  @Test("Everything's answer: every awake desktop answered these words, one with no door always has, asleep by name")
  func pastAsked() {
    typealias Answerer = PhoneSearchWorld.Answerer
    let studio = Answerer(name: "studio", awake: true, asks: true, answered: "migration")
    let mini = Answerer(name: "mini", awake: false, asks: false, answered: nil)
    #expect(
      PhoneSearchWorld.pastAsked([studio, mini], query: " migration ", asking: false)
        == PhoneSearch.Asked(asking: false, answered: true, asleep: ["mini"]))
    // the last answer was to other words: not answered, and the ask out says so
    let behind = Answerer(name: "studio", awake: true, asks: true, answered: "migr")
    #expect(
      PhoneSearchWorld.pastAsked([behind], query: "migration", asking: true)
        == PhoneSearch.Asked(asking: true, answered: false))
    // nobody could be asked: nothing was answered
    #expect(
      PhoneSearchWorld.pastAsked([mini], query: "migration", asking: false)
        == PhoneSearch.Asked(asking: false, answered: false, asleep: ["mini"]))
    #expect(PhoneSearchWorld.pastAsked([], query: "migration", asking: false).answered == false)
    // a corpus with no door is matched here, so it has answered whatever is typed
    let mock = Answerer(name: "studio", awake: true, asks: false, answered: nil)
    #expect(PhoneSearchWorld.pastAsked([mock], query: "migration", asking: false).answered)
  }

  /// SE-2i — Live now has answered when every desktop it asks (one that owns a run) answered these words; with none to
  /// ask the runs match on their facts alone, which is the whole answer; an asleep desktop is not asked.
  @Test("Live now's answer: every awake desktop it asks answered these words; none to ask is answered")
  func liveAsked() {
    typealias Answerer = PhoneSearchWorld.Answerer
    #expect(PhoneSearchWorld.liveAsked([], query: "keep", asking: false) == .settled)
    let studio = Answerer(name: "studio", awake: true, asks: true, answered: "kee")
    #expect(
      PhoneSearchWorld.liveAsked([studio], query: "keep", asking: false)
        == PhoneSearch.Asked(asking: false, answered: false))
    let caught = Answerer(name: "studio", awake: true, asks: true, answered: "keep")
    let loft = Answerer(name: "loft", awake: false, asks: false, answered: nil)
    #expect(PhoneSearchWorld.liveAsked([caught, loft], query: "keep", asking: false) == .settled)
  }

  /// SE-2i — the readers as the answer reads them: a corpus with no door is never asked; an asleep one is not awake;
  /// Live now's are only the desktops that own a run.
  @MainActor
  @Test("the readers as the answer reads them: awake, asking, the words answered; Live now's only the runs' owners")
  func answerersFromReaders() {
    let up = HistoryDesktopReader.fixed(corpus: .mock, standing: .connected)
    let down = HistoryDesktopReader.fixed(corpus: .mock, standing: .asleep)
    let past = PhoneSearchWorld.pastAnswerers([up, down], kind: .any)
    #expect(
      past == [
        PhoneSearchWorld.Answerer(name: "studio", awake: true, asks: false, answered: nil),
        PhoneSearchWorld.Answerer(name: "studio", awake: false, asks: false, answered: nil),
      ])
    let owned = PhoneSearchWorld.liveAnswerers([up], runs: [up.deviceId: ["n-1"]])
    #expect(owned == [PhoneSearchWorld.Answerer(name: "studio", awake: true, asks: false, answered: nil)])
    let none = PhoneSearchWorld.liveAnswerers([up], runs: ["dev-elsewhere": ["n-1"]])
    #expect(none.isEmpty)
  }

  @Test("Everything's content: your latest sessions before a word, no profile, and the foot says the lens comes back")
  func everythingContent() throws {
    let world = try Self.world()
    let state = SearchState(scope: .everything)
    let latest = PhoneSearchWorld.content(
      state, query: "", lens: try Self.lens("work"), live: world, answers: [], latest: .mock, agentLabel: { $0 },
      feed: .live, asked: .settled)
    #expect(latest.scope == .everything)
    #expect(latest.rows == .past(PhoneSearch.latestRows(.mock, project: nil, agentLabel: { $0 })))
    #expect(latest.foot == "Your latest sessions · every profile; Work comes back on Field")
    #expect(latest.tokens.isEmpty)
    #expect(latest.profiles.isEmpty)
    #expect(latest.empty == nil)

    // with words, each desktop's answer; a project and a kind narrow it and stand as tokens
    let groups = FieldHistoryModel.visibleHits(query: "badge", kind: .any, in: .mock)
    #expect(!groups.isEmpty)
    let rows = PhoneSearch.pastRows([(corpus: .mock, groups: groups)], kind: .any, project: nil, agentLabel: { $0 })
    let project = try #require(PhoneSearch.projects(rows).first)
    let narrowed = SearchState(scope: .everything, kind: .prompts, project: project)
    let typed = PhoneSearchWorld.content(
      narrowed, query: "badge", lens: try Self.lens(nil), live: world, answers: [(corpus: .mock, groups: groups)],
      latest: .mock, agentLabel: { $0 }, feed: .live, asked: .settled)
    let expected = PhoneSearch.pastRows(
      [(corpus: .mock, groups: groups)], kind: .prompts, project: project.key, agentLabel: { $0 })
    #expect(typed.rows == .past(expected))
    let tokens = typed.tokens.map { $0.label }
    #expect(tokens == ["Prompts", project.name])
  }

  @Test("a chip or an offer applies its filter, a token's × removes it, and an empty list's act widens")
  func filtersAndActs() throws {
    var state = SearchState()
    var lens = try Self.lens(nil)
    PhoneSearchWorld.apply(.profile("work"), label: "Work", state: &state, lens: &lens)
    #expect(lens.profile == "work")
    PhoneSearchWorld.apply(.desk("dev-loft"), label: "loft", state: &state, lens: &lens)
    #expect(lens.desk == "dev-loft")
    PhoneSearchWorld.apply(.kind(.replies), label: "Replies", state: &state, lens: &lens)
    #expect(state.kind == .replies)
    PhoneSearchWorld.apply(.project("p-billing"), label: "billing-api", state: &state, lens: &lens)
    #expect(state.project == PhoneSearch.Project(key: "p-billing", name: "billing-api"))

    PhoneSearchWorld.remove(.desk("dev-loft"), state: &state, lens: &lens)
    #expect(lens.desk == nil)
    #expect(lens.profile == "work")
    PhoneSearchWorld.remove(.kind(.replies), state: &state, lens: &lens)
    #expect(state.kind == .any)
    PhoneSearchWorld.remove(.project("p-billing"), state: &state, lens: &lens)
    #expect(state.project == nil)
    PhoneSearchWorld.remove(.profile("work"), state: &state, lens: &lens)
    #expect(lens.profile == nil)

    lens.show("side")
    lens.keep(desk: "dev-home")
    PhoneSearchWorld.act(.clearFilters, state: &state, lens: &lens)
    #expect(lens.profile == nil)
    #expect(lens.desk == nil)
    PhoneSearchWorld.act(.searchEverything, state: &state, lens: &lens)
    #expect(state.scope == .everything)
  }

  @Test("the mock's doors: a lens, Everything, and a desktop's filter")
  func doors() {
    let doors = PhoneSearchWorld.Doors.read([
      "-vf-mock", "-vf-mock-tab=search", "-vf-mock-lens=work", "-vf-mock-search-scope=everything",
      "-vf-mock-search-filter=desk:dev-loft",
    ])
    #expect(doors == PhoneSearchWorld.Doors(lens: "work", scope: .everything, desk: "dev-loft"))
    #expect(PhoneSearchWorld.Doors.read(["-vf-mock"]) == PhoneSearchWorld.Doors())
    // a filter search does not know, and a scope it does not know, are no door
    let unknown = PhoneSearchWorld.Doors.read(["-vf-mock-search-filter=shelf:a", "-vf-mock-search-scope=past"])
    #expect(unknown == PhoneSearchWorld.Doors())
  }

  #if DEBUG
    /// The mock is the main actor's (`MockAccount`), so its statics are too: the row runs there.
    @MainActor
    @Test("the mock's world: the witness's drawn rows from the kit's mirror, and the contracts' golden profiles")
    func mockWorld() {
      let rows = MockAccount.searchRows()
      #expect(rows.count == 11)
      let desks = PhoneSearchWorld.desks(rows: rows).map { $0.name }
      #expect(desks == ["Studio", "Loft", "Attic"])
      let profiles = MockAccount.searchProfiles().map { $0.label }
      #expect(profiles == ["This Mac", "Work"])
    }
  #endif
}
