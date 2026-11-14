import FieldDesign
import FieldProduct
import Foundation
import Testing

@testable import FieldHistory

// PJ-7 — History's ledger over `project.*`: ONE reader over one door (the
// home's, else another answering desktop's) fills one ledger of projects — no
// longer grouped by desktop — whose location is its desktops' marks; a
// project opened reads what it is now, its sessions (each naming where it ran)
// and its figures; a ping reads again and a key that regrouped re-keys; the
// cache replays the ledger while no door answers. Over the contracts' goldens.

private let studio = "01J9ZK3M5Q8XR2V7N4B6C1D0EF"
private let laptop = "01J9ZM0PQ7W3E6R8T2Y4U1I5O9"
private let vibeField = "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8"
private let moved = "r:01JA0B1C2D3E4F5G6H7J8K9M0N"

private let roster = [
  FieldHistoryModel.RosterDesktop(id: laptop, name: "laptop", platform: "win32", awake: false, isHome: false),
  FieldHistoryModel.RosterDesktop(id: studio, name: "studio", platform: "darwin", awake: true, isHome: true),
]

/// The ledger's door, made of the goldens: what it was asked, and the pings'
/// delta for a test to deliver.
@MainActor
private final class ProjectsDoor: HistoryDoor {
  var asked: [(String, JSONValue?)] = []
  var refuse: FieldProductError?
  var ping: (@MainActor (JSONValue) -> Void)?
  var closed = false
  /// fix7 — what `index.status` answers (nil: this door does not offer it)
  var status: JSONValue?
  /// fix7 — the listing holds no project (the golden's sources, no rows)
  var emptyList = false

  func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
    asked.append((method, params))
    if let refuse { throw refuse }
    switch method {
    case "index.status":
      guard let status else { throw FieldProductError(kind: "NOT_FOUND", message: method) }
      return status
    case "project.list":
      guard emptyList else { return try Fixture.json("project-list.valid") }
      var page = try #require(try Fixture.json("project-list.valid").objectValue)
      page["rows"] = .array([])
      return .object(page)
    case "project.get":
      return params?["key"]?.stringValue == vibeField
        ? try Fixture.json("project-get.valid") : try Fixture.json("project-get.moved")
    case "project.sessions":
      var page = try #require(try Fixture.json("project-sessions.valid").objectValue)
      page["key"] = params?["key"] ?? page["key"]
      return .object(page)
    case "project.figures":
      var figures = try #require(try Fixture.json("project-figures.valid").objectValue)
      figures["key"] = params?["key"] ?? figures["key"]
      return .object(figures)
    default: throw FieldProductError(kind: "NOT_FOUND", message: method)
    }
  }

  func tail(
    _ method: String, params: JSONValue?, shape: SubscriptionShape,
    onSnapshot: @escaping @MainActor (JSONValue) -> Void,
    onDelta: @escaping @MainActor (JSONValue) -> Void
  ) async throws -> HistoryTailHandle {
    asked.append((method, params))
    if let refuse { throw refuse }
    #expect(method == "project.subscribe")
    #expect(shape.kind == .rows && shape.minIntervalMs == HistoryReads.tailIntervalMs)
    #expect(params?["cwd"] == nil && params?["path"] == nil)
    if let snapshot = try Fixture.json("project-changes-open.snapshot")["snapshot"] { onSnapshot(snapshot) }
    ping = onDelta
    return HistoryTailHandle { [weak self] in self?.ping = nil }
  }

  func close() { closed = true }

  func count(_ method: String) -> Int { asked.filter { $0.0 == method }.count }
}

@MainActor
private func settle(_ what: String, timeout: Duration = .seconds(5), _ condition: @MainActor () -> Bool) async {
  let deadline = ContinuousClock.now.advanced(by: timeout)
  while ContinuousClock.now < deadline {
    if condition() { return }
    try? await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("timed out waiting for \(what)")
}

private func scratch() -> URL {
  let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("vf-projects-\(UUID().uuidString)")
  try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

@Suite("PJ-7 — the ledger is one, over project.*")
struct HistoryProjectsTests {
  @Test("the desktops: the answer's, the home first, a sleeping one said with the hour it was heard")
  func desktops() throws {
    let page = try ProjectListResult(json: try Fixture.json("project-list.valid"))
    let now = Date(timeIntervalSince1970: 1_759_284_000)
    let desktops = FieldHistoryModel.desktops(sources: page.sources, roster: roster, now: now)
    #expect(desktops.map(\.name) == ["studio", "laptop"])
    #expect(desktops.map(\.platform) == ["darwin", "win32"])
    #expect(desktops.map(\.asleep) == [false, true])
    #expect(desktops[0].isHome)
    #expect(desktops[1].readAt.count == 5)
    #expect(FieldHistoryModel.asleepSentence(desktops[1]) == "laptop is asleep · read \(desktops[1].readAt)")
    // a desktop the roster does not list keeps the answer's name and no mark
    let bare = FieldHistoryModel.desktops(sources: page.sources, roster: [], now: now)
    #expect(bare.map(\.name) == ["studio", "laptop"], "the answer's own order")
    #expect(bare.allSatisfy { $0.platform == nil })
  }

  @Test("a project is a ledger row whose location is its desktops' marks, its colour its ink, its places by name")
  func aLedgerRow() throws {
    let page = try ProjectListResult(json: try Fixture.json("project-list.valid"))
    let now = Date(timeIntervalSince1970: 1_759_284_000)
    let desktops = FieldHistoryModel.desktops(sources: page.sources, roster: roster, now: now)
    let row = FieldHistoryModel.ledgerProject(page.rows[0], desktops: desktops, now: now)
    #expect(row.id == vibeField)
    #expect(row.ink == 412)
    #expect(row.devices == [studio, laptop])
    #expect(row.path.isEmpty, "the path never travels to the screen")
    #expect(row.figure == "449" && row.unit.isEmpty)
    #expect(row.places.map(\.name) == ["vibe-field", "vf-docs"])
    #expect(row.places[0].branch == nil, "main says nothing the folder does not")
    #expect(row.places[1].branch == "docs")
    #expect(row.places.allSatisfy { $0.reason == nil })
    let groups = FieldHistoryModel.placesByDesktop(row, desktops: desktops, live: [])
    #expect(groups.map(\.desktop) == [studio, laptop])
    #expect(groups[0].words == "1 place")
    #expect(groups[1].words.hasPrefix("asleep · "))
    let busy = FieldHistoryModel.placesByDesktop(
      row, desktops: desktops,
      live: [HistoryLive(id: "l", projectId: vibeField, title: "t", agent: "claude", running: "r", destination: .project, device: studio)])
    #expect(busy[0].words == "1 working" && busy[0].working == 1)
  }

  @Test("a place that cannot take a launch says why; Temporary and a hidden project are not listed")
  func reasonsAndListing() throws {
    var fields = try #require(try Fixture.json("project-summary.valid").objectValue)
    var places = try #require(fields["places"]?.arrayValue)
    var gone = try #require(places[0].objectValue)
    gone["exists"] = .bool(false)
    var unplugged = try #require(places[1].objectValue)
    unplugged["mounted"] = .bool(false)
    places = [.object(gone), .object(unplugged)]
    fields["places"] = .array(places)
    let summary = try ProjectSummary(json: .object(fields))
    let now = Date()
    #expect(summary.places.map { FieldHistoryModel.place($0, now: now).reason } == ["folder gone", "not connected"])
    #expect(FieldHistoryModel.listed(summary))
    #expect(!FieldHistoryModel.listed(try ProjectSummary(json: try Fixture.json("project-summary.hidden"))))
    fields["bucket"] = .string("temp")
    #expect(!FieldHistoryModel.listed(try ProjectSummary(json: .object(fields))))
  }

  @Test("a session row names where it ran — the desktop and the folder — and the id Resume asks by")
  func sessionRows() throws {
    let page = try ProjectSessionsResult(json: try Fixture.json("project-sessions.valid"))
    let project = try ProjectSummary(json: try Fixture.json("project-summary.valid"))
    let desktops = [HistoryDevice(id: studio, name: "studio", platform: "darwin", asleep: false, readAt: "11:42")]
    let rows = FieldHistoryModel.projectSessionRows(
      page.rows, key: vibeField, places: project.places, desktops: desktops, now: Date())
    let row = try #require(rows.first)
    #expect(row.projectId == vibeField)
    #expect(row.device == studio && row.deviceName == "studio")
    #expect(row.folder == "vibe-field")
    #expect(row.provider == "claude")
    #expect(row.nativeSessionId == "665e3e71-7c12-4810-925a-e8b92cb6f29d")
    #expect(row.day != nil)
  }

  @Test("the reader: one list, the desktops and their marks, figures prefetched, the pings open at the floor")
  @MainActor
  func theLedger() async throws {
    let door = ProjectsDoor()
    let projects = HistoryProjects(source: studio, door: door, roster: roster)
    projects.start()
    await settle("the ledger") { projects.corpus.projects.count == 2 }
    #expect(projects.standing == .connected)
    #expect(projects.corpus.projects.map(\.name) == ["vibe-field", "Home"])
    #expect(projects.corpus.desktops.map(\.name) == ["studio", "laptop"])
    #expect(projects.corpus.desktop == "studio")
    #expect(projects.corpus.sessionCount == 452)
    #expect(projects.summaries[vibeField]?.places.count == 2)
    await settle("the figures") { projects.corpus.projects.allSatisfy { $0.stats != nil } }
    #expect(door.count("project.figures") == 2)
    #expect(projects.corpus.projects[0].ink == 412, "the figures keep the ink")
    await settle("the pings") { door.ping != nil }
    let list = try #require(door.asked.first { $0.0 == "project.list" }?.1)
    #expect(list["limit"]?.intValue == Int64(HistoryReads.listRows))
    // no ask names a folder (P1)
    for (_, params) in door.asked {
      #expect(params?["cwd"] == nil && params?["path"] == nil && params?["paths"] == nil)
    }
  }

  @Test("a project opened: what it is now, its sessions with where each ran; a ping reads again and re-keys it")
  @MainActor
  func openAndRegroup() async throws {
    let door = ProjectsDoor()
    let projects = HistoryProjects(source: studio, door: door, roster: roster)
    projects.start()
    await settle("the ledger") { projects.corpus.projects.count == 2 }
    projects.open(vibeField)
    await settle("the sessions") { !projects.corpus.sessions(of: vibeField).isEmpty }
    #expect(door.count("project.get") == 1)
    let row = try #require(projects.corpus.sessions(of: vibeField).first)
    #expect(row.device == studio && row.deviceName == "studio" && row.folder == "vibe-field")
    // the ping: the key moved, and the ledger is read again
    await settle("the pings") { door.ping != nil }
    let lists = door.count("project.list")
    door.ping?(try Fixture.json("project-changes-delta.regrouped"))
    #expect(projects.moves == [ProjectRegrouped(from: vibeField, to: moved)])
    #expect(projects.moved(vibeField) == moved)
    #expect(projects.moved(moved) == nil)
    await settle("the ledger read again") { door.count("project.list") > lists }
    // a get that answers `movedTo` re-keys too
    projects.open("p1:asked-before-it-moved")
    await settle("the move") { projects.moved("p1:asked-before-it-moved") == moved }
  }

  // Item 393 (James, 2026-11-13 23:28:32Z, session qa-01: "for session entry item, they should also show the
  // message count, token count, cost, etc,just like as how desktop session entry is designed, align it") — the
  // reader hands the project's `contribution` to its session rows. The rules are held in SessionFiguresTests.

  @Test("item 393 — an opened project's sessions wear their figures once the project's figures are read")
  @MainActor
  func sessionsWearTheirFigures() async throws {
    let door = ProjectsDoor()
    let projects = HistoryProjects(source: studio, door: door, roster: roster)
    projects.start()
    await settle("the ledger") { projects.corpus.projects.count == 2 }
    projects.open(vibeField)
    await settle("the figures on the row") { projects.corpus.sessions(of: vibeField).first?.messages == 88 }
    let row = try #require(projects.corpus.sessions(of: vibeField).first)
    #expect(row.tokens == 182_000 && row.spend == HistorySpend(costMicroUsd: 1_240_000))
    #expect(row.meta.hasPrefix("88 msgs · 1h 53m · 182K · $1.24 · started "))
    projects.close()
  }

  @Test("no door: the cache's ledger, asleep; a door that stops answering dims what was read")
  @MainActor
  func cacheAndRefusal() async throws {
    let cache = HistoryCache(directory: scratch())
    let door = ProjectsDoor()
    let online = HistoryProjects(source: studio, door: door, cache: cache, roster: roster)
    online.start()
    await settle("the ledger") { online.corpus.projects.count == 2 }
    online.close()
    let offline = HistoryProjects(source: nil, door: nil, cache: cache)
    offline.start()
    #expect(offline.isReplaying)
    #expect(offline.standing == .asleep)
    #expect(offline.corpus.projects.map(\.name) == ["vibe-field", "Home"])
    #expect(offline.corpus.desktops.count == 2)
    // the grouping not ready yet is still a door that answers
    let grouping = ProjectsDoor()
    grouping.refuse = FieldProductError(
      kind: "UNAVAILABLE", message: "grouping", retryable: true,
      details: try Fixture.json("error-data.projects-grouping")["details"])
    let waiting = HistoryProjects(source: studio, door: grouping, roster: roster)
    waiting.start()
    await settle("the refusal") { waiting.failure != nil }
    #expect(waiting.standing == .connected)
    // a door gone: asleep, what was read stands
    door.refuse = FieldProductError(kind: "UNAVAILABLE", message: "the door is gone", retryable: true)
    let gone = HistoryProjects(source: studio, door: door, cache: cache, roster: roster)
    gone.start()
    #expect(gone.corpus.projects.count == 2, "the cache replays first")
    await settle("asleep") { gone.standing == .asleep }
    #expect(gone.corpus.projects.count == 2)
    #expect(gone.failure == "the door is gone")
  }

  // fix7 — PJ-7's first phone run: the desktop's index had FAILED (a schema
  // its rosettad could not open) and the phone said "No project in your
  // desktops' index yet". The ledger reads its door's index beside it.

  @Test("the index failed: the empty ledger says so in fieldd's words — never 'no project'")
  @MainActor
  func indexFailed() async throws {
    let door = ProjectsDoor()
    door.status = try Fixture.json("index-status.failed")
    door.emptyList = true
    let projects = HistoryProjects(source: studio, door: door, roster: roster)
    projects.start()
    await settle("the listing") { door.count("project.list") >= 1 && projects.index != nil }
    let reason = "restart intensity exceeded (5 in 60000ms) — something is wrong with rosettad itself; Restart the index in the desktop's History to try again"
    #expect(projects.index == .failed(reason: reason))
    #expect(projects.standing == .connected, "the door answers; its index does not")
    #expect(projects.sourceName == "studio")
    let empty = FieldHistoryModel.emptyLedger(
      standing: projects.standing, index: projects.index, desktop: projects.sourceName, device: .iPhone)
    #expect(empty.title == "studio's index has stopped")
    #expect(empty.text.hasPrefix("Restart intensity exceeded (5 in 60000ms)"))
    // the restart is the desktop's (P2: the phone reads), and the phone says where
    #expect(
      empty.text.hasSuffix(
        "History on this iPhone reads nothing from it until it runs again; its restart is in History on studio."))
    #expect(!empty.title.contains("No project"))
    #expect(FieldHistoryModel.indexSentence(projects.index, desktop: projects.sourceName) == "studio's index has stopped")
    // the index is asked on the ledger's door, before the listing it explains
    let order = door.asked.map(\.0).filter { $0 == "index.status" || $0 == "project.list" }
    #expect(order.prefix(2) == ["index.status", "project.list"])
    projects.close()
  }

  @Test("the index starting, or rebuilding a projection of another schema: said as coming, in fieldd's words")
  @MainActor
  func indexComing() async throws {
    var starting = try #require(try Fixture.json("index-status.valid").objectValue)
    starting["phase"] = .string("starting")
    starting["rosettad"] = .object([
      "phase": .string("starting"), "detail": .null, "pid": .null, "protocolVersion": .null,
    ])
    let door = ProjectsDoor()
    door.status = .object(starting)
    door.emptyList = true
    let projects = HistoryProjects(source: studio, door: door, roster: roster)
    projects.start()
    await settle("the index") { projects.index != nil }
    #expect(projects.index == .starting(detail: nil))
    let early = FieldHistoryModel.emptyLedger(
      standing: .connected, index: projects.index, desktop: "studio", device: .iPhone)
    #expect(early.title == "studio's index is starting")
    #expect(early.text == "Its projects arrive when it is ready.")
    projects.close()

    let rebuilding = ProjectsDoor()
    rebuilding.status = try Fixture.json("index-status.rebuilding")
    rebuilding.emptyList = true
    let upgrading = HistoryProjects(source: studio, door: rebuilding, roster: roster)
    upgrading.start()
    await settle("the index") { upgrading.index != nil }
    guard case .rebuilding(let detail)? = upgrading.index else {
      Issue.record("not rebuilding: \(String(describing: upgrading.index))")
      return
    }
    #expect(detail?.contains("schema 24 where this rosettad reads 27") == true)
    let empty = FieldHistoryModel.emptyLedger(
      standing: .connected, index: upgrading.index, desktop: "studio", device: .iPhone)
    #expect(empty.title == "studio is rebuilding its index")
    #expect(empty.text.contains("The index's projection is schema 24 where this rosettad reads 27"))
    #expect(FieldHistoryModel.indexSentence(upgrading.index, desktop: "studio") == "studio is rebuilding its index")
    upgrading.close()
  }

  @Test("the index ready but empty: the honest 'no project'; a door with no index.status is believed")
  @MainActor
  func indexReadyEmpty() async throws {
    let door = ProjectsDoor()
    door.status = try Fixture.json("index-status.valid")
    door.emptyList = true
    let projects = HistoryProjects(source: studio, door: door, roster: roster)
    projects.start()
    await settle("the index") { projects.index != nil && door.count("project.list") >= 1 }
    #expect(projects.index == .ready)
    #expect(FieldHistoryModel.indexSentence(projects.index, desktop: "studio") == nil)
    let empty = FieldHistoryModel.emptyLedger(
      standing: projects.standing, index: projects.index, desktop: "studio", device: .iPhone)
    #expect(empty.title == "No project in your desktops' index yet")
    projects.close()
    // an older desktop's door offers no index.status: the listing is believed
    let older = ProjectsDoor()
    older.emptyList = true
    let believed = HistoryProjects(source: studio, door: older, roster: roster)
    believed.start()
    await settle("the listing") { older.count("project.list") >= 1 }
    #expect(believed.index == nil)
    #expect(
      FieldHistoryModel.emptyLedger(
        standing: believed.standing, index: believed.index, desktop: "studio", device: .iPhone).title
        == "No project in your desktops' index yet")
    // and a door that does not answer: not read yet, never "no project"
    #expect(
      FieldHistoryModel.emptyLedger(standing: .asleep, index: nil, desktop: "studio", device: .iPhone).title
        == "Your projects have not been read yet")
    believed.close()
  }

  @Test("while the index is not ready the ledger is read again; once ready, the asking stops")
  @MainActor
  func indexRecheck() async throws {
    let door = ProjectsDoor()
    door.status = try Fixture.json("index-status.failed")
    door.emptyList = true
    let projects = HistoryProjects(source: studio, door: door, roster: roster, indexRecheck: .milliseconds(40))
    projects.start()
    await settle("failed") { projects.index.map { !$0.isReady } == true }
    // the desktop's index comes back (a restart, a rebuild that ended)
    door.status = try Fixture.json("index-status.valid")
    door.emptyList = false
    await settle("ready, and the ledger read again") {
      projects.index == .ready && projects.corpus.projects.count == 2
    }
    let asked = door.count("index.status")
    try await Task.sleep(for: .milliseconds(300))
    #expect(door.count("index.status") == asked, "a ready index is not polled")
    // paused, a failing index is not polled either
    door.status = try Fixture.json("index-status.failed")
    projects.pause()
    projects.resume()
    await settle("failed again") { projects.index.map { !$0.isReady } == true }
    projects.pause()
    let paused = door.count("index.status")
    try await Task.sleep(for: .milliseconds(300))
    #expect(door.count("index.status") == paused)
    projects.close()
  }

  @Test("the desktops choose the ledger's door: the home while it answers, else another; none, the cache")
  @MainActor
  func chooseTheLedger() async throws {
    let cache = HistoryCache(directory: scratch())
    let group = HistoryDesktops(cache: cache)
    let home = ProjectsDoor()
    let other = ProjectsDoor()
    group.attach(deviceId: laptop, name: "laptop", isHome: false, door: other, ownsDoor: true)
    group.attach(deviceId: studio, name: "studio", isHome: true, door: home, ownsDoor: false)
    group.chooseLedger(roster: roster)
    #expect(group.projects.source == studio)
    await settle("the ledger over the home") { group.projects.corpus.projects.count == 2 }
    #expect(home.count("project.list") >= 1 && other.count("project.list") == 0)
    group.need(.project(id: vibeField))
    await settle("the project opened") { home.count("project.get") == 1 }
    // the home sleeps: another answering desktop's door reads the ledger
    group.markOffline(deviceId: studio, name: "studio", isHome: true)
    group.chooseLedger(roster: roster)
    #expect(group.projects.source == laptop)
    await settle("the ledger over the laptop") { other.count("project.list") >= 1 }
    #expect(!home.closed, "a shared door is the link's to close")
    // none answers: the cache, asleep
    group.allOffline()
    group.chooseLedger(roster: roster)
    #expect(group.projects.source == nil && group.projects.isReplaying)
    #expect(group.projects.corpus.projects.count == 2)
    // the mock: its corpus is the ledger too
    group.mount(.fixed(corpus: .mock, standing: .connected))
    #expect(group.projects.corpus.projects.count == 7)
    #expect(group.projects.corpus.desktops.map(\.name) == ["studio"])
  }
}

// MARK: - Item 364

/// A ledger of many projects in one page, with each project's figures answered from the golden a moment after they
/// are asked. It offers no index, no sessions and no sessions' listing: the ledger and its figures alone.
@MainActor
private final class ManyDoor: HistoryDoor {
  let keys: [String]
  var asked: [String] = []
  /// How long the listing takes to answer.
  var listTakes = Duration.zero
  /// How long a project's figures take to answer.
  var figuresTake = Duration.milliseconds(2)

  init(_ count: Int) {
    keys = (0..<count).map { "p1:many-\($0)" }
  }

  func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
    asked.append(method)
    switch method {
    case "project.list":
      if listTakes > .zero { try? await Task.sleep(for: listTakes) }
      return .object([
        "rows": .array(
          keys.map { key in
            .object(["key": .string(key), "name": .string(key), "sessions": .int(1), "lastAt": .int(1_759_000_000_000)])
          }),
        "sources": .array([]), "groupingVersion": .int(2),
      ])
    case "project.figures":
      try? await Task.sleep(for: figuresTake)
      var figures = try #require(try Fixture.json("project-figures.valid").objectValue)
      figures["key"] = params?["key"] ?? figures["key"]
      return .object(figures)
    default:
      throw FieldProductError(kind: "NOT_FOUND", message: method)
    }
  }

  func tail(
    _ method: String, params: JSONValue?, shape: SubscriptionShape,
    onSnapshot: @escaping @MainActor (JSONValue) -> Void,
    onDelta: @escaping @MainActor (JSONValue) -> Void
  ) async throws -> HistoryTailHandle {
    HistoryTailHandle {}
  }

  func close() {}

  func count(_ method: String) -> Int { asked.filter { $0 == method }.count }
}

/// The ledger's fold AS IT WAS before item 364, line for line, over the same values: what `HistoryProjects.folded`
/// is held to. It read the reader's own state on the main actor at every answer; the only line that differs in the
/// fold that replaced it is the scan this keeps (`projects.contains(where:)`), which is a `Set` there.
private func foldAsItWas(_ inputs: HistoryProjects.LedgerInputs) -> HistoryCorpus {
  var corpus = inputs.ledger
  let clock = inputs.clock
  let desktops = FieldHistoryModel.desktops(sources: inputs.sources, roster: inputs.roster, now: clock)
  var projects: [HistoryProject] = []
  var sessions: [String: [HistorySession]] = [:]
  var live: [(key: String, row: IndexSessionRow)] = []
  var agents: Set<String> = []
  var total = 0
  var held: [String: HistoryLifetime] = [:]
  for project in corpus.projects { if let lifetime = project.lifetime { held[project.id] = lifetime } }
  var heldAgents: [String: (agents: [HistoryAgentShare], more: Int)] = [:]
  for project in corpus.projects where !project.agents.isEmpty {
    heldAgents[project.id] = (project.agents, project.moreAgents)
  }
  for key in inputs.order where !projects.contains(where: { $0.id == key }) {
    guard let summary = inputs.summaries[key], FieldHistoryModel.listed(summary) else { continue }
    var project = FieldHistoryModel.ledgerProject(summary, desktops: desktops, now: clock)
    let rows = inputs.sessionsByKey[key] ?? []
    if let result = inputs.figures[key] {
      project = FieldHistoryModel.withFigures(project, result, sessions: rows, now: clock)
    } else if let lifetime = held[key] {
      project = project.with(lifetime: lifetime)
    }
    if let counts = inputs.agentCounts {
      let counted = FieldHistoryModel.agentShares(counts: counts[key] ?? [:])
      project = project.with(agents: counted.shares, more: counted.more)
    } else if inputs.sessionsByKey[key] == nil, project.agents.isEmpty, let kept = heldAgents[key] {
      project = project.with(agents: kept.agents, more: kept.more)
    }
    projects.append(project)
    total += Int(summary.sessions)
    if !rows.isEmpty {
      sessions[key] = FieldHistoryModel.projectSessionRows(
        rows, key: key, places: summary.places, desktops: desktops, now: clock)
      live += rows.map { (key, $0) }
      agents.formUnion(rows.compactMap(\.provider))
    }
  }
  corpus.projects = projects
  corpus.sessions = sessions
  corpus.live = FieldHistoryModel.projectLiveRows(live, now: clock)
  corpus.sessionCount = total
  if let counts = inputs.agentCounts { agents.formUnion(counts.values.flatMap(\.keys)) }
  corpus.agentCount = agents.count
  corpus.desktops = desktops
  corpus.desktop = desktops.first { $0.id == inputs.source }?.name ?? corpus.desktop
  corpus.readAt = FieldHistoryModel.clock(Int64(clock.timeIntervalSince1970 * 1000))
  return corpus
}

/// Everything a ledger is folded from, made of the goldens, at one state of reading. `kept`: the ledger that stands
/// is one this phone folded whole an hour before and kept, so its lifetimes and its marks stand in it.
private func goldenInputs(
  sessions: Bool, figures: Bool, agents: Bool, kept: Bool, now: Date
) throws -> HistoryProjects.LedgerInputs {
  let list = try ProjectListResult(json: try Fixture.json("project-list.valid"))
  var inputs = HistoryProjects.LedgerInputs(
    order: list.rows.map(\.key),
    summaries: Dictionary(list.rows.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first }),
    sessionsByKey: [:], figures: [:], agentCounts: nil, sources: list.sources, roster: roster, source: studio,
    ledger: .empty(desktop: "your desktops", deviceId: studio), clock: now)
  for key in inputs.order {
    if sessions {
      var page = try #require(try Fixture.json("project-sessions.valid").objectValue)
      page["key"] = .string(key)
      inputs.sessionsByKey[key] = try ProjectSessionsResult(json: .object(page)).rows
    }
    if figures {
      var answer = try #require(try Fixture.json("project-figures.valid").objectValue)
      answer["key"] = .string(key)
      inputs.figures[key] = try ProjectFiguresResult(json: .object(answer))
    }
  }
  if agents { inputs.agentCounts = [vibeField: ["claudecode": 3, "codex": 1]] }
  if kept {
    var whole = try goldenInputs(sessions: true, figures: true, agents: true, kept: false, now: now)
    whole.clock = now.addingTimeInterval(-3_600)
    inputs.ledger = foldAsItWas(whole)
  }
  return inputs
}

/// Item 364 (James, 2026-11-12 20:07:53Z, on his phone: "when first open history view on the phone, everything is
/// very janky, after a while seems when things all load it is back to normal") — the ledger was folded whole, and
/// written whole to the cache, on the main actor at every answer, and since item 353 there is an answer for every
/// project. Measured on his phone at a ledger of 166 projects: 171 folds (16,757 ms, the longest 196 ms) and 171
/// writes (3,238 ms) in the first 25.6 s.
///
/// These rows hold what replaced it: the same fold, as a pure function over a snapshot; folds a window apart with
/// no answer dropped; a day's lists read once; a cache that keeps the ledger asked for last.
@Suite("item 364 — the ledger is folded off the main actor, a window apart, and kept in the order asked")
struct HistoryLedgerFoldTests {
  /// 2025-10-01 02:26:40Z: after every stamp the goldens carry.
  private let now = Date(timeIntervalSince1970: 1_759_285_600)

  @Test("the fold over a snapshot is the fold it was, for every golden at every state of reading")
  func theFoldIsTheFoldItWas() throws {
    var states = 0
    for sessions in [false, true] {
      for figures in [false, true] {
        for agents in [false, true] {
          for kept in [false, true] {
            let inputs = try goldenInputs(sessions: sessions, figures: figures, agents: agents, kept: kept, now: now)
            let ledger = HistoryProjects.folded(inputs)
            #expect(
              ledger == foldAsItWas(inputs),
              "sessions \(sessions), figures \(figures), agents \(agents), kept \(kept)")
            #expect(ledger.projects.count == 2)
            states += 1
          }
        }
      }
    }
    #expect(states == 16)
    // a key the listing gave twice is one project, as it was
    var twice = try goldenInputs(sessions: true, figures: true, agents: true, kept: false, now: now)
    twice.order += [twice.order[0]]
    let once = HistoryProjects.folded(twice)
    #expect(once == foldAsItWas(twice))
    #expect(once.projects.count == 2)
    // the fold of a ledger's own inputs is that ledger: nothing to publish, nothing to keep
    var again = try goldenInputs(sessions: true, figures: true, agents: true, kept: false, now: now)
    again.ledger = foldAsItWas(again)
    #expect(HistoryProjects.changed(again) == nil)
    // and a fold that does change it is handed back
    let fresh = try goldenInputs(sessions: true, figures: true, agents: true, kept: false, now: now)
    #expect(HistoryProjects.changed(fresh) == foldAsItWas(fresh))
  }

  @Test("answers that stream are folded a window apart, and the last answer is never dropped")
  @MainActor
  func aWindowApart() async throws {
    let door = ManyDoor(40)
    let window = Duration.milliseconds(40)
    let clock = now
    let projects = HistoryProjects(
      source: studio, door: door, roster: roster, now: { clock }, wantsFigures: true, foldEvery: window)
    let started = ContinuousClock.now
    projects.start()
    await settle("every project's figures", timeout: .seconds(30)) {
      projects.corpus.projects.count == 40 && projects.corpus.projects.allSatisfy { $0.lifetime != nil }
    }
    let elapsed = ContinuousClock.now - started
    #expect(door.count("project.figures") == 40)
    // the last answer is in it: the ledger drawn is the whole fold of everything read
    let read = projects.ledgerInputs
    #expect(projects.corpus == foldAsItWas(read))
    // folds start no closer than a window apart: no more of them than windows gone by, the first, and one more
    #expect(projects.foldsPublished >= 1)
    #expect(projects.foldsPublished <= Int(elapsed / window) + 2)
    projects.close()
  }

  @Test("a day's lists are read once and are the days as formatted: counts, hours, a midnight, a zone, a calendar")
  func theDaysAreTheDays() throws {
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = try #require(TimeZone(identifier: "UTC"))
    var auckland = Calendar(identifier: .gregorian)
    auckland.timeZone = try #require(TimeZone(identifier: "Pacific/Auckland"))
    var losAngeles = Calendar(identifier: .gregorian)
    losAngeles.timeZone = try #require(TimeZone(identifier: "America/Los_Angeles"))
    var buddhist = Calendar(identifier: .buddhist)
    buddhist.timeZone = auckland.timeZone
    // 2026-11-12 20:30Z: the 13th in Auckland, the 12th in Los Angeles
    let instant = try #require(
      utc.date(from: DateComponents(year: 2026, month: 11, day: 12, hour: 20, minute: 30)))
    // every list is the days as the formatter gives them, whatever was read before it
    for calendar in [auckland, losAngeles, buddhist, auckland, losAngeles] {
      for count in [371, 31, 30, 1, 0, 400] {
        for hours in [0.0, 5.5, 23.9] {
          let at = instant.addingTimeInterval(hours * 3_600)
          #expect(
            FieldHistoryModel.lastDays(count, now: at, in: calendar)
              == FieldHistoryModel.formattedDays(count, now: at, in: calendar),
            "\(count) days, \(hours) h on, \(calendar.identifier) in \(calendar.timeZone.identifier)")
        }
      }
    }
    // one instant is two days in two zones (the key is the calendar's day, not the clock's)
    #expect(FieldHistoryModel.lastDays(1, now: instant, in: auckland) == ["2026-11-13"])
    #expect(FieldHistoryModel.lastDays(1, now: instant, in: losAngeles) == ["2026-11-12"])
    #expect(FieldHistoryModel.lastDays(1, now: instant, in: auckland) == ["2026-11-13"])
    // and another year in another calendar
    #expect(
      FieldHistoryModel.lastDays(1, now: instant, in: buddhist)
        != FieldHistoryModel.lastDays(1, now: instant, in: auckland))
    // a midnight passes: the list moves on a day
    #expect(
      FieldHistoryModel.lastDays(3, now: instant, in: losAngeles) == ["2026-11-10", "2026-11-11", "2026-11-12"])
    #expect(
      FieldHistoryModel.lastDays(3, now: instant.addingTimeInterval(86_400), in: losAngeles)
        == ["2026-11-11", "2026-11-12", "2026-11-13"])
    // a shorter list is the tail of the longer one read for its day
    let year = FieldHistoryModel.lastDays(371, now: instant, in: losAngeles)
    #expect(year.count == 371)
    #expect(FieldHistoryModel.lastDays(31, now: instant, in: losAngeles) == Array(year.suffix(31)))
    // the ledger's own call is this one, in the phone's calendar
    #expect(
      FieldHistoryModel.lastDays(31, now: instant)
        == FieldHistoryModel.formattedDays(31, now: instant, in: .autoupdatingCurrent))
  }

  @Test("the cache keeps the ledger asked for last, whichever lands last: a closing write beats a late background one")
  func theLastAskedIsKept() async throws {
    let cache = HistoryCache(directory: scratch())
    func ledger(_ sessions: Int) -> HistoryCorpus {
      var corpus = HistoryCorpus.mock
      corpus.sessionCount = sessions
      return corpus
    }
    // a reader closes: its write was asked later and lands first; the background write, asked earlier, lands late
    cache.keepLedger(ledger(2), device: "d", order: 2)
    cache.keepLedger(ledger(1), device: "d", order: 1)
    #expect(cache.ledger(device: "d")?.corpus.sessionCount == 2, "the earlier ask replaced the later one")
    // a later ask replaces, as ever
    cache.keepLedger(ledger(3), device: "d", order: 3)
    #expect(cache.ledger(device: "d")?.corpus.sessionCount == 3)
    // an order is one device's own
    cache.keepLedger(ledger(7), device: "other", order: 1)
    #expect(cache.ledger(device: "other")?.corpus.sessionCount == 7)
    // a writer that gives no order writes as it always did
    cache.keepLedger(ledger(9), device: "d")
    #expect(cache.ledger(device: "d")?.corpus.sessionCount == 9)
    // forty writers at once, in no order: the last asked is the one kept, and the file reads whole
    let corpora = (10...49).shuffled().map { (order: $0, corpus: ledger($0)) }
    await withTaskGroup(of: Void.self) { group in
      for entry in corpora {
        group.addTask { cache.keepLedger(entry.corpus, device: "raced", order: UInt64(entry.order)) }
      }
    }
    let raced = try #require(cache.ledger(device: "raced"))
    #expect(raced.corpus.sessionCount == 49)
    #expect(raced.corpus.projects.map(\.id) == HistoryCorpus.mock.projects.map(\.id))
  }

  /// The account boundary. A sign-out closes the readers and clears the cache (`HistoryDesktops.signedOut`), and a
  /// write a reader asked for before it closed may still be on its way off the main actor. The cache refuses it by
  /// the MOMENT of the clear, never by a name: the ledger's key (`HistoryProjects.cacheKey`) is the same for every
  /// account, and a desktop's id can be the next account's too.
  @Test("a cleared cache stays clear: a write asked before the clear is refused when it lands, whoever signs in next")
  func aClearedCacheStaysClear() throws {
    let cache = HistoryCache(directory: scratch())
    let key = "@projects"
    func ledger(_ sessions: Int) -> HistoryCorpus {
      var corpus = HistoryCorpus.mock
      corpus.sessionCount = sessions
      return corpus
    }
    func kept() -> Int? { cache.ledger(device: key)?.corpus.sessionCount }
    func uptime() -> UInt64 { DispatchTime.now().uptimeNanoseconds }
    // the first account's reader wrote, and asked for one more write that has not landed
    cache.keepLedger(ledger(1), device: key, order: uptime())
    #expect(kept() == 1)
    let late = uptime()
    // the sign-out
    cache.clear()
    #expect(cache.bytes() == 0)
    // the late write lands on the cleared cache: nothing comes back
    cache.keepLedger(ledger(2), device: key, order: late)
    #expect(kept() == nil, "a ledger asked for before the clear was written after it")
    #expect(cache.bytes() == 0, "something of the account that left is on disk")
    // ANOTHER account signs in, on the same key, and its reader writes
    cache.keepLedger(ledger(7), device: key, order: uptime())
    #expect(kept() == 7)
    // the first account's write lands later still, over the next account's ledger: refused, and theirs stands
    cache.keepLedger(ledger(2), device: key, order: late)
    #expect(kept() == 7, "the account that left wrote over the one that came")
    // a second sign-out, and a write of the second account's asked before it: the same
    let second = uptime()
    cache.clear()
    cache.keepLedger(ledger(8), device: key, order: second)
    #expect(kept() == nil && cache.bytes() == 0)
    // a write asked after a clear is kept
    cache.keepLedger(ledger(9), device: key, order: uptime())
    #expect(kept() == 9)
  }

  @Test("signing out while the ledger reads leaves nothing of the account on disk, then or after")
  @MainActor
  func signingOutWhileTheLedgerReads() async throws {
    let cache = HistoryCache(directory: scratch())
    let group = HistoryDesktops(cache: cache)
    let door = ManyDoor(60)
    group.attach(deviceId: studio, name: "studio", isHome: true, door: door, ownsDoor: false)
    group.chooseLedger(roster: roster)
    group.need(.figures(wanted: true))
    await settle("figures streaming, and a ledger kept") { door.count("project.figures") >= 6 && cache.bytes() > 0 }
    group.signedOut()
    #expect(cache.bytes() == 0)
    // a write the ledger's reader asked for before the sign-out, and still on its way, puts nothing back
    try await Task.sleep(for: .milliseconds(300))
    #expect(cache.bytes() == 0, "a ledger of the account that left came back")
    #expect(group.projects.corpus.projects.isEmpty)
  }

  @Test("what this phone kept last time is drawn at once, before its door answers a thing")
  @MainActor
  func theKeptLedgerIsDrawnAtOnce() async throws {
    let cache = HistoryCache(directory: scratch())
    let first = HistoryProjects(source: studio, door: ProjectsDoor(), cache: cache, roster: roster, wantsFigures: true)
    first.start()
    await settle("the figures") {
      first.corpus.projects.count == 2 && first.corpus.projects.allSatisfy { $0.lifetime != nil }
    }
    first.close()
    // a door that takes its time: nothing has answered when the ledger is first drawn
    let slow = ManyDoor(0)
    slow.listTakes = .seconds(30)
    let second = HistoryProjects(source: studio, door: slow, cache: cache, roster: roster, wantsFigures: true)
    second.start()
    #expect(second.corpus.projects.map(\.name) == ["vibe-field", "Home"])
    #expect(
      second.corpus.projects.allSatisfy { $0.lifetime != nil },
      "the lifetimes this phone kept stand until the door's are read")
    second.close()
  }

  @Test("a reader that closes leaves everything it read: its cache waits for no window and no fold")
  @MainActor
  func aClosingReaderKeepsItsLedger() async throws {
    let cache = HistoryCache(directory: scratch())
    let clock = now
    // a window so long that only the first write could come round by itself
    let projects = HistoryProjects(
      source: studio, door: ProjectsDoor(), cache: cache, roster: roster, now: { clock }, keepEvery: .seconds(600))
    projects.start()
    await settle("the ledger") { projects.corpus.projects.count == 2 }
    projects.open(vibeField)
    await settle("the sessions") { !projects.corpus.sessions(of: vibeField).isEmpty }
    await settle("the figures") { projects.corpus.projects.allSatisfy { $0.stats != nil } }
    projects.close()
    // what it wrote as it closed is the fold of everything it had read, drawn or not
    let kept = try #require(cache.ledger(device: HistoryProjects.cacheKey))
    let whole = foldAsItWas(projects.ledgerInputs)
    #expect(kept.corpus.projects.map(\.name) == ["vibe-field", "Home"])
    #expect(kept.corpus.projects.map(\.id) == whole.projects.map(\.id))
    #expect(kept.corpus.projects.map { $0.stats != nil } == [true, true])
    #expect(kept.corpus.projects.map { $0.lifetime != nil } == whole.projects.map { $0.lifetime != nil })
    #expect(!kept.corpus.sessions(of: vibeField).isEmpty)
    #expect(kept.corpus.sessions(of: vibeField).map(\.id) == whole.sessions(of: vibeField).map(\.id))
  }
}
