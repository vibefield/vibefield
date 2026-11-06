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
      agentLabel: { $0 })
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
      SearchState(), query: "", lens: lens, live: world, answers: [], latest: nil, agentLabel: { $0 })
    // `PhoneSearch.Empty` has no public init (FieldHistory's own value): its two fields are read instead
    #expect(none.empty?.sentence == "No live session in Work runs on loft.")
    #expect(none.empty?.act == .clearFilters)
    let both = none.tokens.map { $0.label }
    #expect(both == ["Work", "loft"])

    // words: they mark the rows
    let typed = PhoneSearchWorld.content(
      SearchState(), query: "W1 ", lens: try Self.lens(nil), live: world, answers: [], latest: nil,
      agentLabel: { $0 })
    #expect(typed.terms == ["w1"])
  }

  @Test("Everything's content: your latest sessions before a word, no profile, and the foot says the lens comes back")
  func everythingContent() throws {
    let world = try Self.world()
    let state = SearchState(scope: .everything)
    let latest = PhoneSearchWorld.content(
      state, query: "", lens: try Self.lens("work"), live: world, answers: [], latest: .mock, agentLabel: { $0 })
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
      latest: .mock, agentLabel: { $0 })
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
