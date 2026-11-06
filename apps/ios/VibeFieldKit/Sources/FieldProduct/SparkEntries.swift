import Foundation

// IOS-12b — CHAT'S READING OF A SPARK, on the phone: SP-1b's rule (`packages/field-app/src/chat/spark-status.ts`) and
// SP-1d's thread marks (`thread-marks.ts`), on the phone's own inputs (DESIGN.md §8 "Chat's list", §2.10; CH-D1,
// CH-D3, CH-D4, CP3-D7; PC-D5 A). Pure: the home's merged sparks (`compose.sparks.list`), the remote cut's rows (which
// carry `spark` and `origin` since IOS-12a) and the merged needs-you queue in; the list Chat draws out.
//
// The board row's words, read on the remote cut (`MonitorAgentRow`):
//   · a blocker is the row's `wait`, and its kind is the wait's (`permission`, `question`, any other: Stuck);
//   · a status the board says is `unknown` (nothing observes the run yet) is a row not `observed`: it says nothing;
//   · a run's last activity is its activity's `since`, else its status's (`statusSince`), as epoch ms;
//   · `pending` is the row's own flag.
// And one rule the Mac's single board never needed: a spark lives where it hatched, so its own run and the agents it
// started are the rows of its desktop (`device`), and its items those its desktop's queue holds. A row or an item from
// a daemon before IOS-12a names no desktop and is taken as the spark's, as the doors take it.
// *Amended 2026-11-06 (IOS-12d, Found 1; TH-1's TH-Q29 (a), ER-C2):* the asks of a spark's own run were left out of its
// items, since its row's wait said them and the thread was that run's pane. The Mac's pane left Chat at TH-1, so its
// own run's ask is its item and draws its card; its row's wait and that item are one need, read once (`ChatNotes`).

/// A spark's nineteen statuses and their words (DESIGN.md §2.10's table; design-kit's `statuses.ts`, in its order).
public enum SparkStatus: String, Sendable, Equatable, CaseIterable {
  case hello, ready, listening, thinking, planning, searching, reviewing, running, focus
  case asking, approval, stuck, limited
  case success, shipped, failed, thanked, sleeping, offline

  /// The word beside the face, and in its accessible name where there is no room (S-3).
  public var word: String {
    switch self {
    case .hello: "Hello"
    case .ready: "Ready"
    case .listening: "Listening"
    case .thinking: "Thinking"
    case .planning: "Planning"
    case .searching: "Searching"
    case .reviewing: "Reading"
    case .running: "Running"
    case .focus: "Watching"
    case .asking: "Asking you"
    case .approval: "Needs your OK"
    case .stuck: "Stuck"
    case .limited: "Rate limited"
    case .success: "Done"
    case .shipped: "Shipped"
    case .failed: "Failed"
    case .thanked: "Thanked"
    case .sleeping: "Asleep"
    case .offline: "Offline"
    }
  }

  /// S-4 (CH-D4): the four that need you — the row's word in the attention ink, never the face.
  public var needsYou: Bool { self == .asking || self == .approval || self == .stuck || self == .limited }
}

/// One spark, as Chat's list and its tab draw it (`SparkEntry`).
public struct SparkEntry: Sendable, Equatable, Identifiable {
  public let spark: SparkSummary
  /// Its own session's row, while the board shows one.
  public let run: AgentRemoteRow?
  public let status: SparkStatus
  /// S-4: Asking you, Needs your OK or Stuck (Rate limited has no signal yet) — its own run's wait, or an item.
  public let needsYou: Bool
  /// Its session runs: its own run alive on the board, else its record says so. Wake and the thread key on this,
  /// never on the word (an item's word stands over Asleep: CP3-D7).
  public let awake: Bool
  /// Its own run waits on you in its pane, while its session runs.
  public let blocked: Bool
  /// Its own run's row is on the board, alive, not pending, and says how the run stands.
  public let heard: Bool
  /// The needs-you queue's open items for it, oldest first: its question, its held send or spawn, an ask from an
  /// agent it started, and (TH-1) the ask of its own run.
  public let items: [NeedsItem]
  /// The runs that are its own session: the one its record names, and any the board says is its own. An agent's ask
  /// from one of them is its own run's (`NeedsCards.isOwnAsk`).
  public let ownRuns: [String]
  /// When it last did anything, as epoch ms: its own run, the agents it started, or its record.
  public let activityAt: Int64

  public var id: String { spark.id }
}

public enum SparkEntries {
  // MARK: Whose

  /// The spark's own session on the board: the run its record names, else a live one, else the newest.
  public static func ownRun(of spark: SparkSummary, in rows: [AgentRemoteRow]) -> AgentRemoteRow? {
    let own = rows.filter { $0.spark == spark.id && onItsDesktop($0.device, spark) }
    if let session = spark.session, let named = own.first(where: { $0.runtimeRunId == session.runtimeRunId }) {
      return named
    }
    let live = own.filter { $0.monitorRow.alive }
    let pool = live.isEmpty ? own : live
    return pool.reduce(nil as AgentRemoteRow?) { newest, row in
      guard let newest else { return row }
      return row.monitorRow.createdAt > newest.monitorRow.createdAt ? row : newest
    }
  }

  /// The runs the spark started (CP-D15's `origin`), which its face works with (CH-D3).
  public static func agentRuns(of spark: SparkSummary, in rows: [AgentRemoteRow]) -> [AgentRemoteRow] {
    rows.filter { $0.origin?.by == "spark" && $0.origin?.spark == spark.id && onItsDesktop($0.device, spark) }
  }

  /// The spark's items, oldest first as fieldd lists them: those whose `spark` is it, of its desktop. *Amended at
  /// IOS-12d (TH-1):* its own run's asks among them.
  public static func items(of spark: SparkSummary, items: [NeedsItem]) -> [NeedsItem] {
    items.filter { item in
      item.spark == spark.id && (item.device.map { onItsDesktop($0, spark) } ?? true)
    }
  }

  /// The runs that are the spark's own session: those the board says are its own on its desktop, in the board's
  /// order, then the run its record names.
  public static func ownRuns(of spark: SparkSummary, in rows: [AgentRemoteRow]) -> [String] {
    var runs: [String] = []
    let named = rows.filter { $0.spark == spark.id && onItsDesktop($0.device, spark) }.map { $0.runtimeRunId }
    for run in named + [spark.session?.runtimeRunId].compactMap({ $0 }) where !runs.contains(run) {
      runs.append(run)
    }
    return runs
  }

  /// A row or an item of the spark's desktop; a spark from a daemon before IOS-12a names none and takes any.
  static func onItsDesktop(_ device: String, _ spark: SparkSummary) -> Bool {
    spark.device.map { $0 == device } ?? true
  }

  // MARK: The status

  /// An item's word: a question, its own or an agent's, is Asking you; a held send, a held spawn, an agent's
  /// permission, or a kind this build does not know is Needs your OK — the need is real, and that word is the safe one.
  public static func status(ofItem item: NeedsItem) -> SparkStatus {
    item.knownKind == .question || (item.knownKind == .agentAsk && item.ask == "question") ? .asking : .approval
  }

  /// The first that holds is the word (DESIGN.md §8 "Chat's list", SP-1b as amended at CP-3). `items` are the
  /// spark's own (`items(of:items:)`), oldest first.
  public static func status(
    of spark: SparkSummary, own: AgentRemoteRow?, agents: [AgentRemoteRow], items: [NeedsItem]
  ) -> SparkStatus {
    let item = items.first
    if own == nil, spark.session == nil, item == nil { return .hello }
    let awake = Self.awake(spark, own)
    // a wait counts only while its session runs: a run that has stopped waits on no one
    if awake, let row = own, waits(row) {
      switch row.monitorRow.wait?.kind {
      case "permission": return .approval
      case "question": return .asking
      default: return .stuck
      }
    }
    // before Asleep: an answer wakes it (CP3-D7)
    if let item { return status(ofItem: item) }
    if !awake { return .sleeping }
    if agents.contains(where: { works($0) }) { return .running }
    if let row = own?.monitorRow, row.observed {
      if row.status == .working { return .thinking }
      if row.status == .idle { return .ready }
    }
    // live by its record, but its run has not been heard from yet
    return .hello
  }

  /// Its session runs: its own run alive on the board, else its record says so.
  static func awake(_ spark: SparkSummary, _ own: AgentRemoteRow?) -> Bool {
    own?.monitorRow.alive ?? spark.session?.live ?? false
  }

  /// Its own row waits on someone: a wait on it, or the row blocked with none named — once the runtime has reported.
  static func waits(_ own: AgentRemoteRow?) -> Bool {
    guard let row = own?.monitorRow, row.observed else { return false }
    return row.wait != nil || row.status == .blocked
  }

  /// Heard: alive, not pending, and the runtime has said how the run stands.
  static func heard(_ own: AgentRemoteRow?) -> Bool {
    guard let row = own?.monitorRow, row.alive, row.pending != true else { return false }
    return row.observed
  }

  /// A run at work: alive, reported, working.
  static func works(_ row: AgentRemoteRow) -> Bool {
    row.monitorRow.alive && row.monitorRow.observed && row.monitorRow.status == .working
  }

  // MARK: The list

  /// Chat's list: one entry per spark, newest activity first (CH-D1), a tie by name.
  public static func entries(sparks: [SparkSummary], rows: [AgentRemoteRow], items: [NeedsItem]) -> [SparkEntry] {
    sparks.map { spark -> SparkEntry in
      let run = ownRun(of: spark, in: rows)
      let agents = agentRuns(of: spark, in: rows)
      let mine = Self.items(of: spark, items: items)
      let status = Self.status(of: spark, own: run, agents: agents, items: mine)
      let awake = Self.awake(spark, run)
      let times = [time(spark.updatedAt)] + ([run].compactMap { $0 } + agents).map(Self.activity)
      return SparkEntry(
        spark: spark, run: run, status: status, needsYou: status.needsYou, awake: awake,
        blocked: awake && waits(run), heard: heard(run), items: mine, ownRuns: ownRuns(of: spark, in: rows),
        activityAt: times.max() ?? 0)
    }
    .sorted { a, b in
      a.activityAt != b.activityAt
        ? a.activityAt > b.activityAt : a.spark.name.localizedCompare(b.spark.name) == .orderedAscending
    }
  }

  /// PC-D5 A, one need, one count: the sparks that need you, theirs and their agents' asks, each spark once.
  public static func needing(_ entries: [SparkEntry]) -> Int {
    entries.filter { $0.needsYou }.count
  }

  /// A run's last activity, epoch ms.
  static func activity(_ row: AgentRemoteRow) -> Int64 {
    row.monitorRow.activity?.since ?? row.monitorRow.statusSince
  }

  /// An ISO time as epoch ms; 0 for one it cannot read (the Mac's `Date.parse` NaN, read as 0).
  public static func time(_ iso: String) -> Int64 {
    let date =
      (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(iso))
      ?? (try? Date.ISO8601FormatStyle().parse(iso))
    guard let date else { return 0 }
    return Int64((date.timeIntervalSince1970 * 1000).rounded())
  }

  // MARK: The time

  /// A row's time as the list says it: "now", a time today ("9:41 AM"), a weekday this week ("Tue"), else the date
  /// ("Oct 12") — the Mac's `activityWords`, in the phone's own locale and zone.
  public static func activityWords(
    at: Int64, now: Int64, locale: Locale = .current, timeZone: TimeZone = .current
  ) -> String {
    let ago = now - at
    if ago < 60_000 { return "now" }
    let when = Date(timeIntervalSince1970: Double(at) / 1000)
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    calendar.locale = locale
    let formatter = DateFormatter()
    formatter.locale = locale
    formatter.timeZone = timeZone
    if calendar.isDate(when, inSameDayAs: Date(timeIntervalSince1970: Double(now) / 1000)) {
      formatter.setLocalizedDateFormatFromTemplate("jmm")
    } else if ago < 6 * 86_400_000 {
      formatter.setLocalizedDateFormatFromTemplate("EEE")
    } else {
      formatter.setLocalizedDateFormatFromTemplate("MMMd")
    }
    return formatter.string(from: when)
  }
}

// MARK: - The thread marks (SP-1d)

/// A thread's dot: a need's (`--vf-orange`), or unread (`--vf-cyan`). A need outranks unread.
public enum ThreadMark: Sendable, Equatable {
  case needs
  case unread
}

/// What the phone has latched since each thread was last on screen (`ThreadLedger`): a need there keeps its orange
/// dot until the thread is opened, even after the need ends; the spark's own turn ending there marks it unread. A
/// thread is on screen while Chat is the page and it is the one shown, and opening it reads it. Held for the app's
/// life and written nowhere (HN-D9's rule).
public struct ThreadLedger: Sendable, Equatable {
  /// The threads that needed you while not on screen.
  public private(set) var needs: Set<String> = []
  /// The threads whose spark's own turn ended while not on screen.
  public private(set) var unread: Set<String> = []
  /// Each spark's own turn under way on the last reading; none before the first, so a turn the phone never saw end is
  /// no news (a need it finds is: its dot stands, as any need's does).
  private var turns: [String: Bool] = [:]
  private var onScreen: String?

  public init() {}

  /// A thread's mark: a need standing now or latched since it was last on screen, else unread, else none.
  public func mark(of entry: SparkEntry) -> ThreadMark? {
    let spark = entry.spark.id
    if entry.needsYou || needs.contains(spark) { return .needs }
    return unread.contains(spark) ? .unread : nil
  }

  /// One reading of the feed: a need, or a turn's end, in a thread not on screen is latched there. A spark the list
  /// no longer holds takes its marks with it.
  public mutating func read(_ entries: [SparkEntry]) {
    let before = turns
    let now = Dictionary(entries.map { ($0.spark.id, Self.turnRuns($0)) }, uniquingKeysWith: { first, _ in first })
    turns = now
    needs = needs.filter { now[$0] != nil }
    unread = unread.filter { now[$0] != nil }
    for entry in entries where entry.spark.id != onScreen {
      let spark = entry.spark.id
      if entry.needsYou { needs.insert(spark) }
      if before[spark] == true, !Self.turnRuns(entry) { unread.insert(spark) }
    }
  }

  /// The thread on screen now (nil: none), on the feed's last reading. Opening it reads it; a thread that leaves the
  /// screen while it needs you keeps the need's dot.
  public mutating func show(_ spark: String?, _ entries: [SparkEntry]) {
    onScreen = spark
    for entry in entries where entry.needsYou && entry.spark.id != spark { needs.insert(entry.spark.id) }
    guard let spark else { return }
    needs.remove(spark)
    unread.remove(spark)
  }

  /// The spark's own turn is under way: its own run alive and at work.
  static func turnRuns(_ entry: SparkEntry) -> Bool {
    entry.run.map(SparkEntries.works) ?? false
  }
}
