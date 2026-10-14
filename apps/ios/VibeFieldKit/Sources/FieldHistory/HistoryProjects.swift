import FieldProduct
import Foundation
import Observation

// PJ-7 (2026-10-14) — History's LEDGER over `project.*` (TP §6.3, H-D2 as
// amended: "its reads become `project.*`"; SP-D10's grouping by desktop is
// superseded). Every self desktop answers the same grouping over every
// desktop's places, so ONE reader asks ONE door — the home's, or another
// answering desktop's while the home sleeps (the lead's call, build-pj7.md):
// `project.list` for the ledger, `project.sessions` for a project's rows (and
// the live ones), `project.get` for an opened project, `project.figures` for
// its numbers, and `project.subscribe`'s pings to read again. A session's
// DOCUMENT is not here: it stays on its owner's door (the row's `device`,
// `HistoryDesktopReader`). The honest states are SP-6's: a door that stops
// answering leaves what was read standing, stamped, and the cache replays it.
//
// fix7 (2026-10-14, PJ-7's first phone run): the door's INDEX is read beside
// the ledger (`index.status` before each `project.list`, as SP-6's reader
// read it) — a door answers an empty listing while its index is starting,
// rebuilding or failed, and the phone had said "no project" over a failed
// one. While the index is not ready the ledger is read again on a cadence: no
// ping says it became ready (the catalog may not move when it does).

/// The ledger of projects, read over one door and kept as values.
@MainActor
@Observable
public final class HistoryProjects {
  /// The cache's key for the one ledger (the documents stay filed per desktop).
  static let cacheKey = "@projects"

  /// The merged ledger: the projects, the live rows, a project's sessions, and
  /// the desktops it was read across. `deviceId` is the door read.
  public private(set) var corpus: HistoryCorpus
  public private(set) var standing: FieldHistoryModel.DesktopStanding
  /// The desktop whose door answers the ledger (nil: none answers).
  public let source: String?
  /// Each project as its door answered it, by key — what a launch reads (the
  /// recipe, the places by ref) and no view draws.
  public private(set) var summaries: [String: ProjectSummary] = [:]
  /// The key moves heard, oldest first (D9): an open route re-keys by them.
  public private(set) var moves: [ProjectRegrouped] = []
  /// The door's last refusal, in its own words.
  public private(set) var failure: String?
  /// fix7 — the door's index (`index.status`): nil before it is read, or when
  /// the door does not offer it (the listing is believed then).
  public private(set) var index: FieldHistoryModel.IndexStanding?
  public var isReplaying: Bool { door == nil || !standing.isAwake }
  /// The desktop whose door answers, by name: the roster's, else the answer's.
  public var sourceName: String {
    roster.first { $0.id == source }?.name ?? corpus.desktops.first { $0.id == source }?.name
      ?? "Your desktop"
  }
  /// Its OS (the mark that leads the index's sentence).
  public var sourcePlatform: String? {
    roster.first { $0.id == source }?.platform ?? corpus.desktops.first { $0.id == source }?.platform
  }

  @ObservationIgnored private let door: (any HistoryDoor)?
  @ObservationIgnored private let ownsDoor: Bool
  @ObservationIgnored private let cache: HistoryCache?
  @ObservationIgnored private let now: @MainActor () -> Date
  @ObservationIgnored private let indexRecheck: Duration
  @ObservationIgnored private var roster: [FieldHistoryModel.RosterDesktop]
  @ObservationIgnored private var order: [String] = []
  @ObservationIgnored private var sources: [CatalogSource] = []
  @ObservationIgnored private var sessionsByKey: [String: [IndexSessionRow]] = [:]
  @ObservationIgnored private var figures: [String: ProjectFiguresResult] = [:]
  @ObservationIgnored private var tasks: [String: Task<Void, Never>] = [:]
  @ObservationIgnored private var pings: HistoryTailHandle?
  @ObservationIgnored private var openKey: String?
  @ObservationIgnored private var rereadWanted = false
  @ObservationIgnored private var paused = false
  @ObservationIgnored private var closed = false

  public init(
    source: String?, door: (any HistoryDoor)?, ownsDoor: Bool = false, cache: HistoryCache? = nil,
    roster: [FieldHistoryModel.RosterDesktop] = [], now: @escaping @MainActor () -> Date = { Date() },
    indexRecheck: Duration = .seconds(HistoryReads.indexRecheckSeconds)
  ) {
    self.source = source
    self.door = door
    self.ownsDoor = ownsDoor
    self.cache = cache
    self.roster = roster
    self.now = now
    self.indexRecheck = indexRecheck
    corpus = .empty(desktop: "your desktops", deviceId: source ?? Self.cacheKey)
    standing = door == nil ? .asleep : .connected
  }

  /// A ledger given whole and never read again — the mock's (`-vf-mock`).
  public static func fixed(corpus: HistoryCorpus, standing: FieldHistoryModel.DesktopStanding) -> HistoryProjects {
    let projects = HistoryProjects(source: corpus.deviceId, door: nil)
    projects.corpus = corpus
    projects.standing = standing
    return projects
  }

  // MARK: Lifecycle

  /// Replay what the cache holds, then read the ledger and open the pings.
  public func start() {
    replayCache()
    guard door != nil else { return }
    readLedger()
    openPings()
  }

  public func pause() {
    guard !paused else { return }
    paused = true
    pings?.cancel()
    pings = nil
    tasks.removeValue(forKey: "index-wait")?.cancel()
  }

  public func resume() {
    guard paused else { return }
    paused = false
    openPings()
    readLedger()
  }

  public func close() {
    closed = true
    for task in tasks.values { task.cancel() }
    tasks.removeAll()
    pings?.cancel()
    pings = nil
    if ownsDoor { door?.close() }
  }

  /// The roster moved (a desktop woke, slept, or was named): the marks and the
  /// honest sentences are drawn again from what was read.
  public func update(roster: [FieldHistoryModel.RosterDesktop]) {
    guard roster != self.roster else { return }
    self.roster = roster
    if door != nil, !order.isEmpty { rebuild() }
  }

  /// A project was opened: what it is now (a key that moved re-keys), its
  /// sessions and its figures.
  public func open(_ key: String) {
    openKey = key
    readProject(key)
  }

  /// Where a key moved, following every move heard (nil: it did not move).
  public func moved(_ key: String) -> String? {
    var current = key
    var seen: Set<String> = [key]
    while let next = moves.last(where: { $0.from == current })?.to, !seen.contains(next) {
      seen.insert(next)
      current = next
    }
    return current == key ? nil : current
  }

  // MARK: The cache

  private func replayCache() {
    guard let cache, let kept = cache.ledger(device: Self.cacheKey) else { return }
    var replayed = kept.corpus
    replayed.readAt = FieldHistoryModel.clock(Int64(kept.readAt.timeIntervalSince1970 * 1000))
    corpus = replayed
  }

  private func keepLedger() {
    cache?.keepLedger(corpus, device: Self.cacheKey, readAt: now())
  }

  // MARK: The reads

  private func readLedger() {
    guard let door, !closed else { return }
    if tasks["ledger"] != nil {
      rereadWanted = true
      return
    }
    tasks["ledger"] = Task { [weak self] in
      guard let self else { return }
      defer {
        tasks["ledger"] = nil
        if rereadWanted, !closed {
          rereadWanted = false
          readLedger()
        } else {
          waitForIndex()
        }
      }
      do {
        await readIndex(door)
        guard !Task.isCancelled else { return }
        let page = try ProjectListResult(
          json: try await door.call("project.list", params: ProjectListParams(limit: HistoryReads.listRows).json))
        guard !Task.isCancelled else { return }
        standing = .connected
        failure = nil
        sources = page.sources
        order = page.rows.map(\.key)
        var kept: [String: ProjectSummary] = [:]
        for row in page.rows { kept[row.key] = row }
        // an opened project the page did not reach stays as `project.get` read it
        if let openKey, kept[openKey] == nil, let open = summaries[openKey] { kept[openKey] = open }
        summaries = kept
        rebuild()
        keepLedger()
        let clock = now()
        let recent = page.rows.filter(FieldHistoryModel.listed).prefix(HistoryReads.prefetchFigures)
        for row in recent where FieldHistoryModel.recencyMinutes(row.lastAt, now: clock) < FieldHistoryModel.liveWithinMinutes {
          readSessions(row.key)
        }
        for row in recent where figures[row.key] == nil { readFigures(row.key) }
        if let openKey { readSessions(openKey) }
      } catch {
        refused(error)
      }
    }
  }

  private func readProject(_ key: String) {
    guard let door, !closed, tasks["project/\(key)"] == nil else { return }
    tasks["project/\(key)"] = Task { [weak self] in
      guard let self else { return }
      defer { tasks["project/\(key)"] = nil }
      do {
        let answer = try ProjectGetResult(json: try await door.call("project.get", params: ProjectGetParams.key(key).json))
        guard !Task.isCancelled else { return }
        if let to = answer.movedTo, to != key { rekey(from: key, to: to) }
        summaries[answer.project.key] = answer.project
        if !order.contains(answer.project.key) { order.append(answer.project.key) }
        rebuild()
        readSessions(answer.project.key)
        if figures[answer.project.key] == nil { readFigures(answer.project.key) }
      } catch {
        refused(error)
      }
    }
  }

  private func readSessions(_ key: String) {
    guard let door, !closed, tasks["sessions/\(key)"] == nil else { return }
    tasks["sessions/\(key)"] = Task { [weak self] in
      guard let self else { return }
      defer { tasks["sessions/\(key)"] = nil }
      do {
        let page = try ProjectSessionsResult(
          json: try await door.call(
            "project.sessions", params: ProjectSessionsParams(key: key, limit: HistoryReads.listRows).json))
        guard !Task.isCancelled else { return }
        if let to = page.movedTo, to != key { rekey(from: key, to: to) }
        sessionsByKey[page.key] = page.rows
        rebuild()
        keepLedger()
      } catch {
        refused(error)
      }
    }
  }

  private func readFigures(_ key: String) {
    guard let door, !closed, tasks["figures/\(key)"] == nil else { return }
    tasks["figures/\(key)"] = Task { [weak self] in
      guard let self else { return }
      defer { tasks["figures/\(key)"] = nil }
      do {
        let since = now().addingTimeInterval(-Double(FieldHistoryModel.figureWindowDays) * 86_400)
        let offset = TimeZone.current.secondsFromGMT() / 60
        let answer = try ProjectFiguresResult(
          json: try await door.call(
            "project.figures",
            params: ProjectFiguresParams(
              key: key, sinceMs: Int64(since.timeIntervalSince1970 * 1000), offsetMinutes: max(-840, min(840, offset))
            ).json))
        guard !Task.isCancelled else { return }
        if let to = answer.movedTo, to != key { rekey(from: key, to: to) }
        figures[answer.key] = answer
        rebuild()
        keepLedger()
      } catch {
        refused(error)
      }
    }
  }

  // MARK: The index (fix7)

  /// The door's index, read before the listing it explains. A door that does
  /// not offer `index.status` to this phone leaves it unknown; a door that does
  /// not answer at all is the listing's own refusal to say.
  private func readIndex(_ door: any HistoryDoor) async {
    do {
      let status = try await door.call("index.status", params: nil).decode(IndexStatusResult.self)
      guard !Task.isCancelled else { return }
      index = FieldHistoryModel.indexStanding(status: status)
    } catch let refusal as FieldProductError where ["NOT_FOUND", "FORBIDDEN_SCOPE", "PRECONDITION_FAILED"].contains(refusal.kind) {
      index = nil
    } catch {
      // the door itself: `project.list` asks next and says so
    }
  }

  /// While the index is not ready, read the ledger (and the index) again.
  private func waitForIndex() {
    // a door that stopped answering is the desktops' to replace, not to poll
    guard let index, !index.isReady, door != nil, standing.isAwake, !closed, !paused, tasks["index-wait"] == nil
    else { return }
    let wait = indexRecheck
    tasks["index-wait"] = Task { [weak self] in
      try? await Task.sleep(for: wait)
      guard let self, !Task.isCancelled else { return }
      tasks["index-wait"] = nil
      readLedger()
    }
  }

  // MARK: The pings

  private func openPings() {
    guard let door, !closed, !paused, pings == nil, tasks["pings"] == nil else { return }
    tasks["pings"] = Task { [weak self] in
      guard let self else { return }
      defer { tasks["pings"] = nil }
      do {
        let handle = try await door.tail(
          "project.subscribe", params: .object([:]), shape: .rows(minIntervalMs: HistoryReads.tailIntervalMs),
          onSnapshot: { _ in }, onDelta: { [weak self] payload in self?.ping(payload) })
        guard !Task.isCancelled, !paused, !closed else {
          handle.cancel()
          return
        }
        pings = handle
      } catch {
        refused(error)
      }
    }
  }

  /// A ping: the key moves first (an open project follows its key), then the
  /// ledger — and the open project's rows — are read again.
  func ping(_ payload: JSONValue) {
    guard let delta = try? ProjectChangesDelta(json: payload) else { return }
    for move in delta.regrouped where move.from != move.to { rekey(from: move.from, to: move.to) }
    readLedger()
  }

  /// D9 — `from` regrouped into `to`: what is held under it moves, and the
  /// move is kept for the routes that name it.
  private func rekey(from: String, to: String) {
    moves.append(ProjectRegrouped(from: from, to: to))
    if openKey == from { openKey = to }
    if let rows = sessionsByKey.removeValue(forKey: from), sessionsByKey[to] == nil { sessionsByKey[to] = rows }
    if let held = figures.removeValue(forKey: from), figures[to] == nil { figures[to] = held }
    order = order.map { $0 == from ? to : $0 }
  }

  // MARK: The values

  private func rebuild() {
    let clock = now()
    let desktops = FieldHistoryModel.desktops(sources: sources, roster: roster, now: clock)
    var projects: [HistoryProject] = []
    var sessions: [String: [HistorySession]] = [:]
    var live: [(key: String, row: IndexSessionRow)] = []
    var agents: Set<String> = []
    var total = 0
    for key in order where !projects.contains(where: { $0.id == key }) {
      guard let summary = summaries[key], FieldHistoryModel.listed(summary) else { continue }
      var project = FieldHistoryModel.ledgerProject(summary, desktops: desktops, now: clock)
      let rows = sessionsByKey[key] ?? []
      if let result = figures[key] {
        project = FieldHistoryModel.withFigures(project, result, sessions: rows, now: clock)
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
    corpus.agentCount = agents.count
    corpus.desktops = desktops
    corpus.desktop = desktops.first { $0.id == source }?.name ?? corpus.desktop
    corpus.readAt = FieldHistoryModel.clock(Int64(clock.timeIntervalSince1970 * 1000))
  }

  // MARK: Refusals

  /// SP-6's rule: a door that cannot answer leaves what was read standing and
  /// dims it; a wrong ask leaves the standing; another contracts version names
  /// both numbers. A grouping that is not ready yet is said, not guessed.
  private func refused(_ error: any Error) {
    if error is CancellationError { return }
    let refusal = (error as? FieldProductError) ?? FieldProductError(kind: "UNAVAILABLE", message: String(describing: error))
    failure = refusal.message
    switch refusal.kind {
    case "INCOMPATIBLE":
      let theirs = refusal.details?["contractsVersion"]?.stringValue
        ?? refusal.details?["serverContractsVersion"]?.stringValue ?? "another"
      standing = .incompatible(theirs: theirs, ours: FieldProductContract.contractsVersion)
    case "NOT_FOUND", "PRECONDITION_FAILED", "FORBIDDEN_SCOPE":
      break
    case "UNAVAILABLE" where refusal.unavailable?.service == "projects":
      // the door answers and its grouping is not ready: still awake
      break
    default:
      standing = .asleep
    }
  }
}
