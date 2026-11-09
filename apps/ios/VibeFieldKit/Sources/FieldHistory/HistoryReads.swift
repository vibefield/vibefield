import FieldProduct
import Foundation
import Observation
import os

// SP-6 (2026-10-04) — the History tab's READS over one desktop's door (H-1/
// H-2/H-4/H-5 as built; thinking-sync-planes.md §5.4 "Catalogs on L1",
// "Until RO-1"): `index.status` for the standing, `index.projects` for the
// ledger, `index.sessions` for the rows and the live ones, `index.project`
// for a project's figures, `index.session` + `index.timeline` for a document
// and `index.session.subscribe` for its tail, `index.search` for the hits.
// Every answer fills the same VALUES the mock fills (`HistoryCorpus`), one
// corpus per desktop; the views never learn which filled them.
//
// PJ-7 (2026-10-14): the LEDGER left this reader for `HistoryProjects`
// (`project.*` over one door — every desktop's projects grouped alike). What
// stays per desktop is what only that desktop can answer: its standing, a
// session's document and its tail (the row's `device` names the door), and
// search over its own index.
//
// Honest states (H-D7, SP-L8): a door that stops answering leaves the corpus
// as it was read, stamped (`readAt`), with the standing `asleep` — figures
// dim, green withheld — and the cache replays the last read while the
// desktop cannot answer. Nothing here guesses; nothing is blank.
//
// SP-7b's 7b-2b: with a plane given, a session's pages and tail come directly from rosetta (`HistoryDirectRead`) and
// land in the same `rows`, so everything above them is unchanged. A session the plane cannot serve reads through the
// door as before, and says why in `failure`. The header, the lists and search stay on the door.

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
  /// fix7 — while the ledger's index is not ready (starting, rebuilding,
  /// failed), how often the ledger and its index are read again: nothing pings
  /// when it becomes ready, and two cheap reads every few seconds is a
  /// phone's pace for a state a person is watching.
  public static let indexRecheckSeconds: Int64 = 5
  /// ITEM 109 (VF-PM's (a), N = 6, 2026-11-05) — how many pages of `pageRows` a tail reset's fill reads from
  /// the head: 240 rows, so a reset's newest `INDEX_TAILNET_LIMITS.MAX_ROWS` (100) and a hole of up to 140
  /// rows below them close. Past them the rows below the last page read are dropped, and the log says so.
  public static let fillPages = 6
  /// SE-P1 — the most live runs one Live now ask names: the contract's own bound on `nativeSessionIds`
  /// (`IndexSearchParams`, `.max(256)`); a field past it is asked for its first runs, in the field's order.
  public static let liveRuns = 256
  /// SP-7b's 7b-2b — how long a direct read holds a ticket before it asks a fresh one: four fifths of the grant's life
  /// (`IndexTicketLimits.ttlMs`), so a reconnect always has a grant in date.
  public static let directRenewMs: Int64 = IndexTicketLimits.ttlMs * 4 / 5
  /// SP-7b's 7b-2b — how long a direct socket may go without answering (a hello, or a reconnect's) before the session
  /// is read through the door: rosetta's client redials four times inside it, and a phone reader is waiting.
  public static let directOpenSeconds: Int64 = 8

  static let logger = Logger(subsystem: "com.jamesyong.vibefield.kit", category: "history")

  /// A reader's line on the device: the unified log at the default level, every argument public (a count and
  /// ordinals, never a row's text), so Console shows it without Include Info.
  public static func log(_ line: String) {
    logger.notice("\(line, privacy: .public)")
  }
}

/// SE-P1 (SE-D4 A) — one desktop's answer to Live now's words: the lines its index matched in its live runs'
/// conversations, filed under each run's native id (`AgentRemoteRow.nativeSessionId`, the join to the field's row),
/// newest first as the index answered them.
public struct HistoryLiveAnswer: Equatable, Sendable {
  public let query: String
  public let lines: [String: [HistoryHit]]

  public init(query: String, lines: [String: [HistoryHit]]) {
    self.query = query
    self.lines = lines
  }
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
  /// SE-P1 (SE-D4 A) — Live now's last answer from this desktop's index: the words asked over its live runs' own
  /// conversations. Never cached (a live run's lines are the moment's) and never Everything's (`corpus.hits`).
  public private(set) var live: HistoryLiveAnswer?
  /// SE-2j — the kind Everything's last answer was asked with (`corpus.searchedQuery`'s), this launch's only: a
  /// corpus replayed from the cache answers no kind until it is asked again.
  private var searchedKind: FieldHistoryModel.SearchKind?
  /// Whether this reader replays the cache (no door, or a door that stopped).
  public var isReplaying: Bool { door == nil || !standing.isAwake }

  /// SE-2j (the S2 review's finding 5) — the words this desktop's index last answered for Everything with `kind`: an
  /// answer is its words' and its kind's (Prompts' answer holds prompts alone, so it never answers every kind).
  public func answered(kind: FieldHistoryModel.SearchKind) -> String? {
    searchedKind == kind ? corpus.searchedQuery : nil
  }

  /// PJ-7 — the door this reader asks, which the ledger may ask too (one door
  /// per desktop, the phone's budget): nil while it replays the cache.
  var openDoor: (any HistoryDoor)? { closed ? nil : door }

  public nonisolated var id: String { deviceId }

  @ObservationIgnored private let door: (any HistoryDoor)?
  @ObservationIgnored private let ownsDoor: Bool
  @ObservationIgnored private let cache: HistoryCache?
  @ObservationIgnored private let agentLabel: @MainActor (String) -> String
  @ObservationIgnored private let now: @MainActor () -> Date
  @ObservationIgnored private let log: @MainActor (String) -> Void
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
  @ObservationIgnored private var paused = false
  @ObservationIgnored private var closed = false
  /// ITEM 109 — per session, the running fill's number (a newer reset's fill supersedes it) and the newest held
  /// ordinal it reads down to
  @ObservationIgnored private var fillNumbers: [String: Int] = [:]
  @ObservationIgnored private var fillTargets: [String: Double] = [:]
  /// SP-7b's 7b-2b — the composition's road to this desktop's sessions; nil reads everything through the door
  @ObservationIgnored private let directPlane: HistoryDirectPlane?
  /// the one direct read, opening or live; at most one, as there is one tail
  @ObservationIgnored private var directRead: (session: String, read: HistoryDirectRead)?
  /// sessions the door reads until the app next comes back: a road that failed once is not retried per page
  @ObservationIgnored private var directDeclined: Set<String> = []
  /// this desktop's daemon does not serve the direct read: nothing a retry changes
  @ObservationIgnored private var directOff = false

  public init(
    deviceId: String, name: String, isHome: Bool = false, door: (any HistoryDoor)?, ownsDoor: Bool = false,
    cache: HistoryCache? = nil, agentLabel: @escaping @MainActor (String) -> String = { $0 },
    now: @escaping @MainActor () -> Date = { Date() }, direct: HistoryDirectPlane? = nil,
    log: @escaping @MainActor (String) -> Void = { HistoryReads.log($0) }
  ) {
    self.deviceId = deviceId
    self.name = name
    self.isHome = isHome
    self.door = door
    self.ownsDoor = ownsDoor
    self.cache = cache
    self.agentLabel = agentLabel
    self.now = now
    self.directPlane = direct
    self.log = log
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

  /// Replay what the cache holds for this desktop, then read its standing.
  public func start() {
    replayCache()
    guard door != nil else { return }
    readStanding()
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
    directDeclined.removeAll()
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
    case .project: break
    case .session(_, let id): openSession(id)
    case .older(_, let session): readOlder(session)
    case .seen(_, let session): arrivals[session] = nil
    }
  }

  // MARK: The cache

  /// The cache's stamp for this desktop: when this phone last read it (its
  /// documents replay on open, `replayDocument`).
  func replayCache() {
    guard let cache, let kept = cache.ledger(device: deviceId) else { return }
    corpus.readAt = FieldHistoryModel.clock(Int64(kept.readAt.timeIntervalSince1970 * 1000))
  }

  /// A cached document for a session this reader cannot read right now.
  public func replayDocument(_ sessionId: String) {
    guard corpus.documents[sessionId] == nil, let cache,
      let kept = cache.latestDocument(device: deviceId, session: sessionId)
    else { return }
    corpus.documents[sessionId] = kept.document
  }

  private func keepStamp() {
    cache?.keepLedger(.empty(desktop: name, deviceId: deviceId), device: deviceId, readAt: now())
  }

  private func stampOf(_ header: IndexSessionRow) -> String {
    "\(header.updatedAt ?? 0)"
  }

  // MARK: The standing

  /// PJ-7 — the ledger is `HistoryProjects`' now (one door, every desktop's
  /// projects); this reader asks its desktop only what is its own to answer:
  /// its standing (`index.status`), a document and its tail, and search.
  private func readStanding() {
    guard let door, !closed else { return }
    ledgerTask?.cancel()
    ledgerTask = Task { [weak self] in
      guard let self else { return }
      do {
        let status = try await door.call("index.status", params: nil).decode(IndexStatusResult.self)
        guard !Task.isCancelled else { return }
        standing = FieldHistoryModel.standing(status: status)
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
        // SP-7b's 7b-2b — the direct read fills the rows; only if it declines does the door read a page
        headers[sessionId] = header
        if await openDirect(sessionId) { return }
        headers[sessionId] = nil
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
    if let direct = directRead, direct.session == sessionId {
      readOlderDirectly(sessionId, cursor: cursor, through: direct.read)
      return
    }
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
          reopen(sessionId)
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
    keepStamp()
    cache?.keep(
      document, key: HistoryCache.Key(device: deviceId, session: sessionId, stamp: stampOf(header)),
      readAt: clock)
  }

  // MARK: The tail

  private func openTail(_ sessionId: String) {
    guard let door, !closed, !paused, tail?.session != sessionId, directRead?.session != sessionId,
      tasks["tail/\(sessionId)"] == nil
    else { return }
    closeTail()
    tasks["tail/\(sessionId)"] = Task { [weak self] in
      guard let self else { return }
      defer { tasks["tail/\(sessionId)"] = nil }
      if await openDirect(sessionId) { return }
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
    directRead?.read.close()
    directRead = nil
  }

  private func tailSnapshot(_ sessionId: String, _ payload: JSONValue) {
    guard let snapshot = try? IndexSessionTailSnapshot(json: payload) else { return }
    var held = rows[sessionId] ?? [:]
    let before = held.values.map(\.ordinal).max() ?? -1
    // the snapshot is the newest rows; what the pages read before it stays, and a hole between is filled
    let oldest = snapshot.rows.map(\.ordinal).min() ?? 0
    for (id, row) in held where row.ordinal >= oldest { held[id] = nil }
    for row in snapshot.rows { held[row.timelineId] = row }
    rows[sessionId] = held
    let appended = snapshot.rows.filter { $0.ordinal > before }.count
    if appended > 0, before >= 0 { arrivals[sessionId, default: 0] += appended }
    rebuildDocument(sessionId)
    if before >= 0, oldest > before { fillHole(sessionId, below: oldest, reaching: before) }
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

  // MARK: The direct read (SP-7b's 7b-2b)

  /// Reads `sessionId` directly when this desktop's road allows it. False: the door reads it, and `failure` says why.
  private func openDirect(_ sessionId: String) async -> Bool {
    guard let directPlane, !directOff, !directDeclined.contains(sessionId), !closed, !paused else { return false }
    closeTail()
    let sink = HistoryDirectRead.Sink(
      page: { [weak self] cursor, watermark in self?.directPage(sessionId, cursor: cursor, watermark: watermark) },
      rows: { [weak self] rows in self?.directRows(sessionId, rows) },
      lost: { [weak self] reason in self?.directLost(sessionId, reason) })
    let read = HistoryDirectRead(sessionId: sessionId, plane: directPlane, sink: sink, log: log)
    directRead = (sessionId, read)
    switch await read.open() {
    case .closed:
      return true
    case .live:
      guard directRead?.read === read, !closed, !paused, tailWanted == sessionId else {
        read.close()
        if directRead?.read === read { directRead = nil }
        return true
      }
      tail = (sessionId, HistoryTailHandle { read.close() })
      liveSince[sessionId] = FieldHistoryModel.clock(Int64(now().timeIntervalSince1970 * 1000))
      rebuildDocument(sessionId)
      return true
    case .door(let reason):
      if directRead?.read === read { directRead = nil }
      declineDirect(sessionId, reason)
      return false
    }
  }

  private func declineDirect(_ sessionId: String, _ reason: HistoryDirectFallback) {
    directDeclined.insert(sessionId)
    if reason.endsThePlane { directOff = true }
    failure = reason.said
    log("history[\(deviceId)] \(sessionId): \(reason.said)")
  }

  private func directPage(_ sessionId: String, cursor: String?, watermark: String) {
    cursors[sessionId] = cursor
    watermarks[sessionId] = watermark
  }

  /// The subscription's whole visible list: what it shows is what is held.
  private func directRows(_ sessionId: String, _ visible: [IndexTimelineRow]) {
    let before = (rows[sessionId] ?? [:]).values.map(\.ordinal).max() ?? -1
    var held: [String: IndexTimelineRow] = [:]
    for row in visible { held[row.timelineId] = row }
    rows[sessionId] = held
    let appended = visible.filter { $0.ordinal > before }.count
    if appended > 0, before >= 0 { arrivals[sessionId, default: 0] += appended }
    rebuildDocument(sessionId)
  }

  private func readOlderDirectly(_ sessionId: String, cursor: String, through read: HistoryDirectRead) {
    tasks["older/\(sessionId)"] = Task { [weak self] in
      let revealed = await read.older(cursor: cursor)
      guard let self else { return }
      tasks["older/\(sessionId)"] = nil
      // the revealed rows landed before the page's cursor was the document's
      if revealed { rebuildDocument(sessionId) }
    }
  }

  /// A live direct read gave up: its cursors are rosetta's, so the door starts the session again from the head.
  private func directLost(_ sessionId: String, _ reason: HistoryDirectFallback) {
    guard directRead?.session == sessionId else { return }
    directRead = nil
    if tail?.session == sessionId {
      tail = nil
      liveSince[sessionId] = nil
    }
    declineDirect(sessionId, reason)
    reopen(sessionId)
  }

  // MARK: The hole (item 109)

  /// ITEM 109 — a tail reset (the tail re-opened after a pause, rosetta's resync, a rewrite, fieldd's restart)
  /// carries a tailnet caller's newest `INDEX_TAILNET_LIMITS.MAX_ROWS` rows. When more than those arrived after the
  /// newest row held, the rows between are in no page a cursor reaches: the older cursor points below the first
  /// page read.
  ///
  /// The head is read again by `index.timeline`, page after page, until a page holds a row at or below the newest
  /// held ordinal, or the session's top, at most `HistoryReads.fillPages` pages. The pages' rows land by timeline id
  /// below the reset's oldest (the tail's own rows above it are newer). A fill that meets no held row drops the held
  /// rows below its last page, says so in the log, and re-seats the cursor on that page's, so the copy is contiguous
  /// and the older pages read on as after a fresh open. Overlap is read by ordinal alone, never by its density. A
  /// reset during a fill restarts it, reading down to the lower of the two; a rewrite under its cursor re-opens the
  /// session as the older pages do.
  private func fillHole(_ sessionId: String, below oldest: Double, reaching newestHeld: Double) {
    guard let door, !closed else { return }
    let target = min(newestHeld, fillTargets[sessionId] ?? newestHeld)
    let number = (fillNumbers[sessionId] ?? 0) + 1
    fillTargets[sessionId] = target
    fillNumbers[sessionId] = number
    tasks["fill/\(sessionId)"]?.cancel()
    tasks["fill/\(sessionId)"] = Task { [weak self] in
      guard let self else { return }
      var cursor: String?
      var read: [IndexTimelineRow] = []
      var met = false
      var pagesRead = 0
      do {
        while pagesRead < HistoryReads.fillPages {
          var params: [String: JSONValue] = [
            "sessionId": .string(sessionId), "limit": .int(Int64(HistoryReads.pageRows)),
          ]
          if let cursor { params["cursor"] = .string(cursor) }
          let page = try await door.call("index.timeline", params: .object(params)).decode(IndexTimelineResult.self)
          guard !Task.isCancelled, fillNumbers[sessionId] == number else { return }
          pagesRead += 1
          read += page.entries
          cursor = page.nextCursor
          if page.entries.contains(where: { $0.ordinal <= target }) {
            met = true
            break
          }
          if cursor == nil { break }
        }
      } catch {
        guard !Task.isCancelled, fillNumbers[sessionId] == number else { return }
        endFill(sessionId)
        if let refusal = error as? FieldProductError, refusal.kind == "PRECONDITION_FAILED" {
          reopen(sessionId)
          return
        }
        refused(error)
        return
      }
      endFill(sessionId)
      var held = rows[sessionId] ?? [:]
      for row in read where row.ordinal < oldest { held[row.timelineId] = row }
      if !met, let lastPageOldest = read.map(\.ordinal).min() {
        let dropped = held.values.map(\.ordinal).filter { $0 < lastPageOldest }
        for (id, row) in held where row.ordinal < lastPageOldest { held[id] = nil }
        cursors[sessionId] = cursor
        if let low = dropped.min(), let high = dropped.max() {
          let reason =
            cursor == nil
            ? "the session's pages hold no row at or below it, and its top is \(ordinalText(lastPageOldest))"
            : "the fill did not reach it in \(pagesRead) pages; the older pages read on from "
              + ordinalText(lastPageOldest)
          self.log(
            "history[\(deviceId)] \(sessionId): a tail reset left a hole above ordinal \(ordinalText(target)); "
              + "dropped \(dropped.count) rows, ordinals \(ordinalText(low))–\(ordinalText(high)); \(reason)")
        }
      }
      rows[sessionId] = held
      rebuildDocument(sessionId)
    }
  }

  private func endFill(_ sessionId: String) {
    tasks["fill/\(sessionId)"] = nil
    fillTargets[sessionId] = nil
  }

  /// A session rewritten under a cursor: what was held goes, and the head is read again.
  private func reopen(_ sessionId: String) {
    headers[sessionId] = nil
    rows[sessionId] = nil
    cursors[sessionId] = nil
    closeTail()
    openSession(sessionId)
  }

  // MARK: Search

  /// One question to this desktop's index; the hits land in the corpus under
  /// the query, and the local filter stands aside for them. SE-2j — the answer
  /// is the words' and the kind's (`answered(kind:)`), and an ask whose task was
  /// cancelled (newer words took over) lands nothing and refuses nothing.
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
      guard !closed, !Task.isCancelled else { return }
      if answer.answered {
        corpus.hits = FieldHistoryModel.hitGroups(answer, now: now())
        corpus.searchedQuery = words
        searchedKind = kind
      } else {
        // the index had no answer: what was last shown stands (H-D7)
        failure = answer.detail ?? "the index did not answer the search"
      }
    } catch {
      guard !Task.isCancelled else { return }
      refused(error)
    }
  }

  /// SE-P1 (SE-D4 A) — Live now's ask: the words over THIS desktop's live runs alone (`nativeSessionIds`, the
  /// contract's scope for "the live runs a reader can jump to"), at the tailnet's page. The lines land in `live`, by
  /// the run's native id; Everything's hits and its query are not touched. An unanswered ask
  /// keeps what was last shown (H-D7); a refusal dims as every read's does. Lines are kept only for the runs asked
  /// about: an answer is filed under the runs this desktop owns, never another's. SE-2j — an ask whose task was
  /// cancelled (newer words took over) lands nothing and refuses nothing: an older answer arriving after a newer one
  /// would put the older words' lines back.
  public func searchLive(_ query: String, nativeSessionIds: [String]) async {
    let words = query.trimmingCharacters(in: .whitespaces)
    let runs = Array(nativeSessionIds.prefix(HistoryReads.liveRuns))
    guard let door, !closed, !words.isEmpty, !runs.isEmpty else { return }
    let params: [String: JSONValue] = [
      "q": .string(words), "nativeSessionIds": .array(runs.map { .string($0) }),
      "limit": .int(Int64(HistoryReads.listRows)),
    ]
    do {
      let answer = try await door.call("index.search", params: .object(params)).decode(IndexSearchResult.self)
      guard !closed, !Task.isCancelled else { return }
      guard answer.answered else {
        failure = answer.detail ?? "the index did not answer the search"
        return
      }
      let asked = Set(runs)
      var lines: [String: [HistoryHit]] = [:]
      for group in FieldHistoryModel.hitGroups(answer, now: now()) {
        guard let run = group.nativeSessionId, asked.contains(run) else { continue }
        lines[run, default: []] += group.rows
      }
      live = HistoryLiveAnswer(query: words, lines: lines)
    } catch {
      guard !Task.isCancelled else { return }
      refused(error)
    }
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

/// An ordinal as a log line says it: rosetta's are whole numbers.
private func ordinalText(_ ordinal: Double) -> String {
  ordinal.rounded() == ordinal && abs(ordinal) < 1e15 ? String(Int64(ordinal)) : String(ordinal)
}
