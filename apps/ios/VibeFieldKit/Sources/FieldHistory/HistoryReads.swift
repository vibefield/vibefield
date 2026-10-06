import FieldProduct
import Foundation
import Observation

// SP-6 (2026-10-04) — the History tab's READS over one desktop's door (H-1/
// H-2/H-4/H-5 as built; thinking-sync-planes.md §5.4 "Catalogs on L1",
// "Until RO-1"): `index.status` for the standing, `index.projects` for the
// ledger, `index.sessions` for the rows and the live ones, `index.project`
// for a project's figures, `index.session` + `index.timeline` for a document
// and `index.session.subscribe` for its tail, `index.search` for the hits.
// Every answer fills the same VALUES the mock fills (`HistoryCorpus`), one
// corpus per desktop; the views never learn which filled them.
//
// Honest states (H-D7, SP-L8): a door that stops answering leaves the corpus
// as it was read, stamped (`readAt`), with the standing `asleep` — figures
// dim, green withheld — and the cache replays the last read while the
// desktop cannot answer. Nothing here guesses; nothing is blank.

/// The numbers the phone's reads hold to, each with its reason.
public enum HistoryReads {
  /// A phone's page of a session: tens of rows, never rosetta's 200-row
  /// snapshot (§1.9 item 8 — a row weighs ~1 KB before its prose); the door
  /// cuts at its own bound anyway, this is the phone's smaller ask.
  public static let pageRows = 40
  /// The ledger's and a project's listing: the tailnet bound's own figure, the
  /// most a page carries across the door for a phone.
  public static let listRows = 100
  /// The tail's cadence the phone asks: the registry's floor (a slower ask is
  /// honoured, a faster one served at the floor); one second is a reader's pace.
  public static let tailIntervalMs = 1_000
  /// How many of the most recent projects get their figures read as the ledger
  /// opens (three rosetta GETs each on the desktop): the rest read when opened.
  public static let prefetchFigures = 6
  /// Recent searches kept per desktop.
  public static let recentSearches = 8
}

/// An open tail, held until it is cancelled.
@MainActor
public struct HistoryTailHandle {
  public let cancel: @MainActor () -> Void

  public init(cancel: @escaping @MainActor () -> Void) {
    self.cancel = cancel
  }
}

/// The door a reader asks: `FieldProductClient`'s two verbs and its close, so
/// a test can hand a script and the home screen the real client.
@MainActor
public protocol HistoryDoor: AnyObject {
  func call(_ method: String, params: JSONValue?) async throws -> JSONValue
  func tail(
    _ method: String, params: JSONValue?, shape: SubscriptionShape,
    onSnapshot: @escaping @MainActor (JSONValue) -> Void,
    onDelta: @escaping @MainActor (JSONValue) -> Void
  ) async throws -> HistoryTailHandle
  func close()
}

extension FieldProductClient: HistoryDoor {
  public func tail(
    _ method: String, params: JSONValue?, shape: SubscriptionShape,
    onSnapshot: @escaping @MainActor (JSONValue) -> Void,
    onDelta: @escaping @MainActor (JSONValue) -> Void
  ) async throws -> HistoryTailHandle {
    let subscription = try await subscribe(
      method, params: params, shape: shape, onSnapshot: onSnapshot, onDelta: onDelta)
    return HistoryTailHandle { subscription.cancel() }
  }
}

/// One desktop's History, read over its door and kept as values.
@MainActor
@Observable
public final class HistoryDesktopReader: Identifiable {
  public let deviceId: String
  public let name: String
  public let isHome: Bool
  public private(set) var corpus: HistoryCorpus
  public private(set) var standing: FieldHistoryModel.DesktopStanding
  /// Rows the tail appended to a document since the reader last saw its end:
  /// the arrival pill's count.
  public private(set) var arrivals: [String: Int] = [:]
  /// Sessions whose document is being read right now (the route shows a
  /// reading note, never a blank).
  public private(set) var reading: Set<String> = []
  /// The door's last refusal, in its own words, for the record.
  public private(set) var failure: String?
  /// Whether this reader replays the cache (no door, or a door that stopped).
  public var isReplaying: Bool { door == nil || !standing.isAwake }

  public nonisolated var id: String { deviceId }

  @ObservationIgnored private let door: (any HistoryDoor)?
  @ObservationIgnored private let ownsDoor: Bool
  @ObservationIgnored private let cache: HistoryCache?
  @ObservationIgnored private let agentLabel: @MainActor (String) -> String
  @ObservationIgnored private let now: @MainActor () -> Date
  @ObservationIgnored private var ledgerTask: Task<Void, Never>?
  @ObservationIgnored private var tasks: [String: Task<Void, Never>] = [:]
  @ObservationIgnored private var tail: (session: String, handle: HistoryTailHandle)?
  @ObservationIgnored private var tailWanted: String?
  /// every row held per session, by timeline id: the pages and the tail merged
  @ObservationIgnored private var rows: [String: [String: IndexTimelineRow]] = [:]
  @ObservationIgnored private var headers: [String: IndexSessionRow] = [:]
  @ObservationIgnored private var cursors: [String: String] = [:]
  @ObservationIgnored private var watermarks: [String: String] = [:]
  @ObservationIgnored private var liveSince: [String: String] = [:]
  @ObservationIgnored private var projectRows: [IndexProjectRow] = []
  @ObservationIgnored private var recent: [IndexSessionRow] = []
  @ObservationIgnored private var sessionsByProject: [String: [IndexSessionRow]] = [:]
  @ObservationIgnored private var figures: [String: IndexProjectResult] = [:]
  @ObservationIgnored private var paused = false
  @ObservationIgnored private var closed = false

  public init(
    deviceId: String, name: String, isHome: Bool = false, door: (any HistoryDoor)?, ownsDoor: Bool = false,
    cache: HistoryCache? = nil, agentLabel: @escaping @MainActor (String) -> String = { $0 },
    now: @escaping @MainActor () -> Date = { Date() }
  ) {
    self.deviceId = deviceId
    self.name = name
    self.isHome = isHome
    self.door = door
    self.ownsDoor = ownsDoor
    self.cache = cache
    self.agentLabel = agentLabel
    self.now = now
    corpus = .empty(desktop: name, deviceId: deviceId)
    standing = door == nil ? .asleep : .connected
  }

  /// A reader whose corpus is given whole and never read again — the mock's
  /// (`-vf-mock`, `-vf-demo-history`) under the standing the mock decides.
  public static func fixed(
    corpus: HistoryCorpus, standing: FieldHistoryModel.DesktopStanding, isHome: Bool = true
  ) -> HistoryDesktopReader {
    let reader = HistoryDesktopReader(
      deviceId: corpus.deviceId, name: corpus.desktop, isHome: isHome, door: nil)
    reader.corpus = corpus
    reader.standing = standing
    return reader
  }

  // MARK: Lifecycle

  /// Replay what the cache holds for this desktop, then read the ledger.
  public func start() {
    replayCache()
    guard door != nil else { return }
    readLedger()
  }

  /// The app went away: the tail goes (the socket's bytes are where the cost
  /// is), the rows stay; `resume` re-opens it for a fresh snapshot (P5).
  public func pause() {
    guard !paused else { return }
    paused = true
    closeTail()
  }

  public func resume() {
    guard paused else { return }
    paused = false
    if let session = tailWanted { openTail(session) }
  }

  public func close() {
    closed = true
    ledgerTask?.cancel()
    for task in tasks.values { task.cancel() }
    tasks.removeAll()
    closeTail()
    if ownsDoor { door?.close() }
  }

  // MARK: Needs

  public func need(_ need: HistoryNeed) {
    switch need {
    case .project(_, let id): readProject(id)
    case .session(_, let id): openSession(id)
    case .older(_, let session): readOlder(session)
    case .seen(_, let session): arrivals[session] = nil
    }
  }

  // MARK: The cache

  func replayCache() {
    guard let cache else { return }
    if let kept = cache.ledger(device: deviceId) {
      var replayed = kept.corpus
      replayed.desktop = name
      replayed.deviceId = deviceId
      replayed.readAt = FieldHistoryModel.clock(Int64(kept.readAt.timeIntervalSince1970 * 1000))
      corpus = replayed
    }
  }

  /// A cached document for a session this reader cannot read right now.
  public func replayDocument(_ sessionId: String) {
    guard corpus.documents[sessionId] == nil, let cache,
      let kept = cache.latestDocument(device: deviceId, session: sessionId)
    else { return }
    corpus.documents[sessionId] = kept.document
  }

  private func keepLedger() {
    cache?.keepLedger(corpus, device: deviceId, readAt: now())
  }

  private func stampOf(_ header: IndexSessionRow) -> String {
    "\(header.updatedAt ?? 0)"
  }

  // MARK: The ledger

  private func readLedger() {
    guard let door, !closed else { return }
    ledgerTask?.cancel()
    ledgerTask = Task { [weak self] in
      guard let self else { return }
      do {
        let status = try await door.call("index.status", params: nil).decode(IndexStatusResult.self)
        guard !Task.isCancelled else { return }
        standing = FieldHistoryModel.standing(status: status)
        let projects = try await door.call(
          "index.projects", params: .object(["limit": .int(Int64(HistoryReads.listRows))])
        ).decode(IndexProjectsResult.self)
        let sessions = try await door.call(
          "index.sessions", params: .object(["limit": .int(Int64(HistoryReads.listRows))])
        ).decode(IndexSessionsResult.self)
        guard !Task.isCancelled else { return }
        projectRows = projects.rows.sorted { ($0.lastActivityAt ?? 0) > ($1.lastActivityAt ?? 0) }
        recent = sessions.rows
        var byProject: [String: [IndexSessionRow]] = [:]
        for row in sessions.rows { byProject[row.projectId ?? "", default: []].append(row) }
        for (project, rows) in byProject { sessionsByProject[project] = rows }
        rebuildLedger()
        keepLedger()
        for project in projectRows.prefix(HistoryReads.prefetchFigures) where figures[project.projectId] == nil {
          readFigures(project.projectId)
        }
      } catch {
        refused(error)
      }
    }
  }

  private func rebuildLedger() {
    let clock = now()
    let counts = FieldHistoryModel.counts(projects: projectRows, sessions: recent)
    var projects: [HistoryProject] = []
    for (seq, row) in projectRows.enumerated() {
      var project = FieldHistoryModel.ledgerProject(row, seq: seq, now: clock)
      if let result = figures[row.projectId] {
        project = FieldHistoryModel.withFigures(
          project, result, sessions: sessionsByProject[row.projectId] ?? [], now: clock)
      }
      projects.append(project)
    }
    var sessions: [String: [HistorySession]] = [:]
    for (projectId, rows) in sessionsByProject where !projectId.isEmpty {
      sessions[projectId] = FieldHistoryModel.sessionRows(rows, projectId: projectId, now: clock)
    }
    corpus.projects = projects
    corpus.sessions = sessions
    corpus.live = FieldHistoryModel.liveRows(recent, now: clock)
    corpus.sessionCount = counts.sessions
    corpus.agentCount = counts.agents
    corpus.readAt = FieldHistoryModel.clock(Int64(clock.timeIntervalSince1970 * 1000))
  }

  // MARK: A project

  private func readProject(_ projectId: String) {
    guard let door, !closed, tasks["project/\(projectId)"] == nil else { return }
    tasks["project/\(projectId)"] = Task { [weak self] in
      guard let self else { return }
      defer { tasks["project/\(projectId)"] = nil }
      do {
        let listing = try await door.call(
          "index.sessions",
          params: .object(["projectId": .string(projectId), "limit": .int(Int64(HistoryReads.listRows))])
        ).decode(IndexSessionsResult.self)
        guard !Task.isCancelled else { return }
        sessionsByProject[projectId] = listing.rows
        rebuildLedger()
        keepLedger()
      } catch {
        refused(error)
      }
    }
    if figures[projectId] == nil { readFigures(projectId) }
  }

  private func readFigures(_ projectId: String) {
    guard let door, !closed, tasks["figures/\(projectId)"] == nil else { return }
    tasks["figures/\(projectId)"] = Task { [weak self] in
      guard let self else { return }
      defer { tasks["figures/\(projectId)"] = nil }
      do {
        let since = now().addingTimeInterval(-Double(FieldHistoryModel.figureWindowDays) * 86_400)
        let offset = TimeZone.current.secondsFromGMT() / 60
        let result = try await door.call(
          "index.project",
          params: .object([
            "projectId": .string(projectId),
            "sinceMs": .int(Int64(since.timeIntervalSince1970 * 1000)),
            "offsetMinutes": .int(Int64(max(-840, min(840, offset)))),
          ])
        ).decode(IndexProjectResult.self)
        guard !Task.isCancelled else { return }
        figures[projectId] = result
        rebuildLedger()
        keepLedger()
      } catch {
        refused(error)
      }
    }
  }

  // MARK: A session

  private func openSession(_ sessionId: String) {
    tailWanted = sessionId
    guard let door, !closed else {
      replayDocument(sessionId)
      return
    }
    if headers[sessionId] != nil {
      openTail(sessionId)
      return
    }
    guard tasks["session/\(sessionId)"] == nil else { return }
    reading.insert(sessionId)
    tasks["session/\(sessionId)"] = Task { [weak self] in
      guard let self else { return }
      defer {
        tasks["session/\(sessionId)"] = nil
        reading.remove(sessionId)
      }
      do {
        let header = try await door.call("index.session", params: .object(["sessionId": .string(sessionId)]))
          .decode(IndexSessionResult.self).session
        let page = try await door.call(
          "index.timeline",
          params: .object(["sessionId": .string(sessionId), "limit": .int(Int64(HistoryReads.pageRows))])
        ).decode(IndexTimelineResult.self)
        guard !Task.isCancelled else { return }
        headers[sessionId] = header
        var held: [String: IndexTimelineRow] = [:]
        for row in page.entries { held[row.timelineId] = row }
        rows[sessionId] = held
        if let next = page.nextCursor { cursors[sessionId] = next } else { cursors[sessionId] = nil }
        watermarks[sessionId] = page.watermark
        rebuildDocument(sessionId)
        openTail(sessionId)
      } catch {
        replayDocument(sessionId)
        refused(error)
      }
    }
  }

  private func readOlder(_ sessionId: String) {
    guard let door, !closed, let cursor = cursors[sessionId], tasks["older/\(sessionId)"] == nil else { return }
    tasks["older/\(sessionId)"] = Task { [weak self] in
      guard let self else { return }
      defer { tasks["older/\(sessionId)"] = nil }
      do {
        let page = try await door.call(
          "index.timeline",
          params: .object([
            "sessionId": .string(sessionId), "cursor": .string(cursor),
            "limit": .int(Int64(HistoryReads.pageRows)),
          ])
        ).decode(IndexTimelineResult.self)
        guard !Task.isCancelled else { return }
        for row in page.entries { rows[sessionId, default: [:]][row.timelineId] = row }
        cursors[sessionId] = page.nextCursor
        rebuildDocument(sessionId)
      } catch {
        // the session was rewritten under the cursor: the head is read again
        if let refusal = error as? FieldProductError, refusal.kind == "PRECONDITION_FAILED" {
          headers[sessionId] = nil
          rows[sessionId] = nil
          cursors[sessionId] = nil
          closeTail()
          openSession(sessionId)
          return
        }
        refused(error)
      }
    }
  }

  private func rebuildDocument(_ sessionId: String) {
    guard let header = headers[sessionId] else { return }
    let clock = now()
    let document = FieldHistoryModel.document(
      header: header, rows: Array((rows[sessionId] ?? [:]).values), desktop: name,
      agentLabel: agentLabel(header.provider ?? "agent"), nextCursor: cursors[sessionId],
      watermark: watermarks[sessionId], liveSince: liveSince[sessionId], now: clock)
    corpus.documents[sessionId] = document
    cache?.keep(
      document, key: HistoryCache.Key(device: deviceId, session: sessionId, stamp: stampOf(header)),
      readAt: clock)
  }

  // MARK: The tail

  private func openTail(_ sessionId: String) {
    guard let door, !closed, !paused, tail?.session != sessionId, tasks["tail/\(sessionId)"] == nil else { return }
    closeTail()
    tasks["tail/\(sessionId)"] = Task { [weak self] in
      guard let self else { return }
      defer { tasks["tail/\(sessionId)"] = nil }
      do {
        let handle = try await door.tail(
          "index.session.subscribe",
          params: .object(["sessionId": .string(sessionId)]),
          shape: .rows(minIntervalMs: HistoryReads.tailIntervalMs),
          onSnapshot: { [weak self] payload in self?.tailSnapshot(sessionId, payload) },
          onDelta: { [weak self] payload in self?.tailDelta(sessionId, payload) })
        guard !Task.isCancelled, tailWanted == sessionId, !paused else {
          handle.cancel()
          return
        }
        tail = (sessionId, handle)
        liveSince[sessionId] = FieldHistoryModel.clock(Int64(now().timeIntervalSince1970 * 1000))
        rebuildDocument(sessionId)
      } catch {
        refused(error)
      }
    }
  }

  private func closeTail() {
    if let tail {
      tail.handle.cancel()
      liveSince[tail.session] = nil
      self.tail = nil
    }
  }

  private func tailSnapshot(_ sessionId: String, _ payload: JSONValue) {
    guard let snapshot = try? IndexSessionTailSnapshot(json: payload) else { return }
    var held = rows[sessionId] ?? [:]
    let before = held.values.map(\.ordinal).max() ?? -1
    // the snapshot is the newest rows; what the pages read before it stays
    let oldest = snapshot.rows.map(\.ordinal).min() ?? 0
    for (id, row) in held where row.ordinal >= oldest { held[id] = nil }
    for row in snapshot.rows { held[row.timelineId] = row }
    rows[sessionId] = held
    let appended = snapshot.rows.filter { $0.ordinal > before }.count
    if appended > 0, before >= 0 { arrivals[sessionId, default: 0] += appended }
    rebuildDocument(sessionId)
  }

  private func tailDelta(_ sessionId: String, _ payload: JSONValue) {
    guard let delta = try? IndexSessionTailDelta(json: payload) else { return }
    var held = rows[sessionId] ?? [:]
    let before = held.values.map(\.ordinal).max() ?? -1
    var appended = 0
    for row in delta.upserts {
      if held[row.timelineId] == nil, row.ordinal > before { appended += 1 }
      held[row.timelineId] = row
    }
    for key in delta.removed { held[key] = nil }
    rows[sessionId] = held
    if appended > 0 { arrivals[sessionId, default: 0] += appended }
    rebuildDocument(sessionId)
  }

  // MARK: Search

  /// One question to this desktop's index; the hits land in the corpus under
  /// the query, and the local filter stands aside for them.
  public func search(_ query: String, kind: FieldHistoryModel.SearchKind) async {
    let words = query.trimmingCharacters(in: .whitespaces)
    guard let door, !closed, !words.isEmpty else { return }
    var params: [String: JSONValue] = [
      "q": .string(words), "limit": .int(Int64(HistoryReads.listRows)),
    ]
    switch kind {
    case .prompts: params["kind"] = .string("user")
    case .replies: params["kind"] = .string("agent")
    case .any: break
    }
    do {
      let answer = try await door.call("index.search", params: .object(params)).decode(IndexSearchResult.self)
      guard !closed else { return }
      if answer.answered {
        corpus.hits = FieldHistoryModel.hitGroups(answer, now: now())
        corpus.searchedQuery = words
        remember(words)
      } else {
        // the index had no answer: what was last shown stands (H-D7)
        failure = answer.detail ?? "the index did not answer the search"
      }
    } catch {
      refused(error)
    }
  }

  private func remember(_ words: String) {
    var recent = corpus.recentSearches.filter { $0 != words }
    recent.insert(words, at: 0)
    corpus.recentSearches = Array(recent.prefix(HistoryReads.recentSearches))
  }

  // MARK: Refusals

  /// The door's refusal, as the standing and a line for the record: a door
  /// that cannot answer leaves what was read standing and dims it; another
  /// contracts version names both numbers.
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
      // the ask was wrong or refused, the desktop is awake: the standing stands
      break
    default:
      standing = .asleep
    }
  }
}
