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
    let empty = FieldHistoryModel.emptyLedger(standing: projects.standing, index: projects.index, desktop: projects.sourceName)
    #expect(empty.title == "studio's index has stopped")
    #expect(empty.text.hasPrefix("Restart intensity exceeded (5 in 60000ms)"))
    // the restart is the desktop's (P2: the phone reads), and the phone says where
    #expect(empty.text.hasSuffix("History on this phone reads nothing from it until it runs again; its restart is in History on studio."))
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
    let early = FieldHistoryModel.emptyLedger(standing: .connected, index: projects.index, desktop: "studio")
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
    let empty = FieldHistoryModel.emptyLedger(standing: .connected, index: upgrading.index, desktop: "studio")
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
    let empty = FieldHistoryModel.emptyLedger(standing: projects.standing, index: projects.index, desktop: "studio")
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
      FieldHistoryModel.emptyLedger(standing: believed.standing, index: believed.index, desktop: "studio").title
        == "No project in your desktops' index yet")
    // and a door that does not answer: not read yet, never "no project"
    #expect(
      FieldHistoryModel.emptyLedger(standing: .asleep, index: nil, desktop: "studio").title
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
