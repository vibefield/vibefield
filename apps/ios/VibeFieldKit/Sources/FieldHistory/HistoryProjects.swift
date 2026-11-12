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
  /// Item 352 — the listing went on past `HistoryReads.ledgerPages` pages: the ledger holds the most recently active
  /// projects and says so.
  public private(set) var cut = false
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
  /// Item 352 — the next ledger read follows the listing to its end (a start, a resume, a regroup, the index's
  /// wait); a ping's read takes the newest page alone, until the last walk is `HistoryReads.walkSeconds` old.
  @ObservationIgnored private var walkWanted = true
  @ObservationIgnored private var walkedAt: Date?
  /// Item 352 — when each project's sessions were last followed to their end.
  @ObservationIgnored private var sessionsWalkedAt: [String: Date] = [:]
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
    readLedger(whole: true)
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
    readLedger(whole: true)
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

  /// Read the ledger. `whole` follows the listing to its end; without it the newest page is read and laid over
  /// what is held, unless the last walk is old.
  ///
  /// Item 352 (James, 2026-11-12 11:38:00Z: "the history items on the phone does not match the items on the desktop,
  /// desktop have more items") — a desktop answers a phone a page of at most `listRows` projects with a cursor to the
  /// next (fieldd's `tailnetRowLimit`; "a page with a cursor, never a silent cut"). This reader asked the first page
  /// and never the next, so a ledger of more than a hundred projects stopped at a hundred here while the desktop's
  /// window, which walks every page, showed them all.
  private func readLedger(whole: Bool = false) {
    guard let door, !closed else { return }
    if whole { walkWanted = true }
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
        let stale = walkedAt.map { now().timeIntervalSince($0) >= Double(HistoryReads.walkSeconds) } ?? true
        let walk = walkWanted || stale
        walkWanted = false
        let page = try await listPage(door, cursor: nil)
        guard !Task.isCancelled else { return }
        standing = .connected
        failure = nil
        sources = page.sources
        if page.cursor == nil {
          // the whole ledger is this page
          cut = false
          hold(page.rows, whole: true)
          walkedAt = now()
        } else if walk {
          // nothing of this door is drawn yet: each page is drawn as it lands; a ledger already drawn changes once
          let first = order.isEmpty
          var rows = page.rows
          var seen = Set(rows.map(\.key))
          var cursor = page.cursor
          var pages = 1
          var more = false
          if first { hold(rows, whole: true) }
          while let next = cursor {
            guard pages < HistoryReads.ledgerPages else {
              more = true
              break
            }
            let further = try await listPage(door, cursor: next)
            guard !Task.isCancelled else { return }
            let fresh = further.rows.filter { seen.insert($0.key).inserted }
            // a door that answers a page it already gave is not followed round
            guard !fresh.isEmpty else { break }
            rows += fresh
            cursor = further.cursor
            pages += 1
            if first { hold(rows, whole: true) }
          }
          cut = more
          hold(rows, whole: true)
          walkedAt = now()
          if more { HistoryReads.log("ledger: the listing went on past \(pages) pages; \(rows.count) projects held") }
        } else {
          hold(page.rows, whole: false)
        }
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

  /// One page of the ledger, from `cursor` (nil: the newest).
  private func listPage(_ door: any HistoryDoor, cursor: String?) async throws -> ProjectListResult {
    try ProjectListResult(
      json: try await door.call(
        "project.list", params: ProjectListParams(cursor: cursor, limit: HistoryReads.listRows).json))
  }

  /// Hold the rows read. `whole`: they are the ledger. Otherwise they are its newest page, laid over what is held:
  /// its rows lead in its order, and the rows it did not reach stay behind them as they were read.
  private func hold(_ rows: [ProjectSummary], whole: Bool) {
    var kept: [String: ProjectSummary] = whole ? [:] : summaries
    for row in rows { kept[row.key] = row }
    // an opened project the listing did not reach stays as `project.get` read it
    if let openKey, kept[openKey] == nil, let open = summaries[openKey] { kept[openKey] = open }
    let listed = Set(rows.map(\.key))
    order = rows.map(\.key) + (whole ? [] : order.filter { !listed.contains($0) })
    summaries = kept
    rebuild()
    keepLedger()
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

  /// A project's sessions. The opened project's are followed to their end (item 352: the door pages them at
  /// `listRows` for a phone, and this reader asked one page), at its opening and again once that walk is
  /// `walkSeconds` old; between, and for a row's live prefetch, the newest page is laid over what is held.
  private func readSessions(_ key: String) {
    guard let door, !closed, tasks["sessions/\(key)"] == nil else { return }
    tasks["sessions/\(key)"] = Task { [weak self] in
      guard let self else { return }
      defer { tasks["sessions/\(key)"] = nil }
      do {
        let page = try await sessionsPage(door, key: key, cursor: nil)
        guard !Task.isCancelled else { return }
        if let to = page.movedTo, to != key { rekey(from: key, to: to) }
        let stale = sessionsWalkedAt[page.key].map { now().timeIntervalSince($0) >= Double(HistoryReads.walkSeconds) } ?? true
        let walk = page.key == openKey && stale
        var seen = Set(page.rows.map(Self.sessionKey))
        if page.cursor == nil || walk {
          sessionsByKey[page.key] = page.rows
        } else {
          sessionsByKey[page.key] = page.rows + (sessionsByKey[page.key] ?? []).filter { !seen.contains(Self.sessionKey($0)) }
        }
        rebuild()
        var cursor = walk ? page.cursor : nil
        var pages = 1
        while let next = cursor, pages < HistoryReads.sessionPages {
          let further = try await sessionsPage(door, key: page.key, cursor: next)
          guard !Task.isCancelled else { return }
          let fresh = further.rows.filter { seen.insert(Self.sessionKey($0)).inserted }
          guard !fresh.isEmpty else { break }
          sessionsByKey[page.key, default: []] += fresh
          cursor = further.cursor
          pages += 1
          rebuild()
        }
        if walk || page.cursor == nil { sessionsWalkedAt[page.key] = now() }
        keepLedger()
      } catch {
        refused(error)
      }
    }
  }

  private func sessionsPage(_ door: any HistoryDoor, key: String, cursor: String?) async throws -> ProjectSessionsResult {
    try ProjectSessionsResult(
      json: try await door.call(
        "project.sessions", params: ProjectSessionsParams(key: key, cursor: cursor, limit: HistoryReads.listRows).json))
  }

  /// A session row's identity across pages: the desktop that recorded it and its id there.
  private static func sessionKey(_ row: IndexSessionRow) -> String {
    "\(row.device ?? "")\u{0}\(row.sessionId)"
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
      readLedger(whole: true)
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
    // a regroup moves rows anywhere in the listing; a plain ping moves the newest to its head
    readLedger(whole: !delta.regrouped.isEmpty)
  }

  /// D9 — `from` regrouped into `to`: what is held under it moves, and the
  /// move is kept for the routes that name it.
  private func rekey(from: String, to: String) {
    moves.append(ProjectRegrouped(from: from, to: to))
    if openKey == from { openKey = to }
    if let rows = sessionsByKey.removeValue(forKey: from), sessionsByKey[to] == nil { sessionsByKey[to] = rows }
    if let held = figures.removeValue(forKey: from), figures[to] == nil { figures[to] = held }
    if let walked = sessionsWalkedAt.removeValue(forKey: from), sessionsWalkedAt[to] == nil { sessionsWalkedAt[to] = walked }
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
