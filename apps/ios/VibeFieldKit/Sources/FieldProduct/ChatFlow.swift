import Foundation

// IOS-12c (M-c1; PC-L1, one Chat; DESIGN.md §8 "Chat's thread", §9 "Chat's words") — THE FLOW, AS DATA, on the phone:
// field-app's `transcriptItemsOf` (`packages/field-app/src/chat/transcript-items.ts`), ported line for line and held
// to the goldens that fold writes (`packages/field-app/test/fixtures/chat-flow/`, ChatFlowGoldenTests). Pure: Chat's
// reading of the spark, its record as the reader holds it (`SparkTranscriptReading`, SP-7a's M-b) and this phone's own
// sends the record does not show yet, in; the flow's rows, top to bottom, out. The latest conversation (its runs
// joined) is drawn, the earlier ones behind one row until asked for; your words with their chips and their receipt,
// its replies whole, its tools one line a turn by kind, VibeField's own acts, the hello while the spark is new and its
// conversation empty, Thinking… while its own run works, day lines, and the three honest lines. A word this build does
// not know draws no word of its own (the tolerant reader).
//
// The fold reads a spark as `ChatFlowSpark`: the nine facts the Mac's fold reads of its entry, and nothing else. Each
// plane derives them from its own entry; the phone's derivation is `ChatFlowSpark(entry:)`, below, with its one
// departure stated there.

/// What the flow reads of a spark (the Mac's `SparkEntry`, as `transcriptItemsOf` reads it).
public struct ChatFlowSpark: Sendable, Equatable {
  public let name: String
  public let seed: UInt32
  public let status: SparkStatus
  /// When its record says it first worked; nil when it says never, or nothing.
  public let turnedAt: String?
  /// NS-D4's "a new spark" (`sparkIsNew`): the hello stands while it is new and its conversation empty.
  public let isNew: Bool
  public let awake: Bool
  /// Its own run waits on you in its pane.
  public let blocked: Bool
  /// The needs-you queue holds an item of it.
  public let waiting: Bool
  /// Its own run is on the board, alive and at work.
  public let working: Bool

  public init(
    name: String, seed: UInt32, status: SparkStatus, turnedAt: String?, isNew: Bool, awake: Bool, blocked: Bool,
    waiting: Bool, working: Bool
  ) {
    self.name = name
    self.seed = seed
    self.status = status
    self.turnedAt = turnedAt
    self.isNew = isNew
    self.awake = awake
    self.blocked = blocked
    self.waiting = waiting
    self.working = working
  }

  /// The phone's reading of its own entry. `isNew` is `sparkIsNew` (`thread-items.ts`) on the remote cut, which
  /// carries no run `turnedAt`: with its own run on the board, the phone reads the record alone, where the Mac also
  /// takes the run's own word that it turned. The phone's hello stands until the record says it turned; the list is
  /// read again as the run's row appears, so the two agree once it is.
  public init(entry: SparkEntry) {
    let spark = entry.spark
    let isNew: Bool
    if let session = spark.session {
      if let run = entry.run {
        isNew = run.monitorRow.pending == nil && spark.turned == .never
      } else {
        isNew = !session.live && spark.turned == .never
      }
    } else {
      isNew = true
    }
    let turnedAt: String?
    if case .at(let at) = spark.turned { turnedAt = at } else { turnedAt = nil }
    let row = entry.run?.monitorRow
    self.init(
      name: spark.name, seed: spark.seed, status: entry.status, turnedAt: turnedAt, isNew: isNew, awake: entry.awake,
      blocked: entry.blocked, waiting: !entry.items.isEmpty,
      working: row?.alive == true && row?.status == .working)
  }
}

/// A send this phone made that the record does not show yet: drawn at the press, matched to its `you` line by its
/// request id. `state` is the say's receipt, nil until fieldd answers.
public struct ChatPendingSay: Sendable, Equatable {
  public let requestId: String
  public let text: String
  public let chips: [SparkTranscriptChip]
  /// When it was pressed (ISO).
  public let at: String
  public let state: String?

  public init(requestId: String, text: String, chips: [SparkTranscriptChip], at: String, state: String? = nil) {
    self.requestId = requestId
    self.text = text
    self.chips = chips
    self.at = at
    self.state = state
  }
}

/// A receipt under your bubble, in the phone's words (§9 "Chat on the phone"); `attention` draws it in the attention
/// ink.
public struct ChatReceipt: Sendable, Equatable {
  public let words: String
  public let attention: Bool

  public init(_ words: String, attention: Bool = false) {
    self.words = words
    self.attention = attention
  }
}

/// One tool of a turn's folded line: its kind's words and what it touched.
public struct ChatToolRow: Sendable, Equatable {
  public let words: String
  public let detail: String?
}

/// One starter of the hello: a job it offers, pressed to be sent as Send sends.
public struct ChatStarter: Sendable, Equatable {
  public enum Glyph: String, Sendable, Equatable {
    case agents, panes, duplicate
  }

  public let glyph: Glyph
  public let words: String
}

/// Which honest line: the record began after the spark first worked, a part written while VibeField restarted, or a
/// part the worker could not check.
public enum ChatHonest: String, Sendable, Equatable {
  case before, gap, dropped
}

/// One row of the flow (`FlowItem`). `lead`: its face leads the row (once per run of its rows).
public enum ChatFlowItem: Sendable, Equatable, Identifiable {
  case earlier(key: String, count: Int)
  case day(key: String, words: String)
  case honest(key: String, which: ChatHonest, words: String)
  case hello(key: String, seed: UInt32, status: SparkStatus, words: String, starters: [ChatStarter])
  case you(key: String, text: String, chips: [SparkTranscriptChip], receipt: ChatReceipt?)
  case reply(key: String, text: String, lead: Bool)
  case tools(key: String, words: String, rows: [ChatToolRow], lead: Bool)
  /// SP-1e2 — a crew's line names its crew: its card hangs under it, and a later line of the crew replaces it.
  case act(key: String, what: String, words: String, lead: Bool, crew: String?)
  case thinking(key: String, lead: Bool)

  public var id: String { key }

  public var key: String {
    switch self {
    case .earlier(let key, _), .day(let key, _), .honest(let key, _, _), .hello(let key, _, _, _, _),
      .you(let key, _, _, _), .reply(let key, _, _), .tools(let key, _, _, _), .act(let key, _, _, _, _),
      .thinking(let key, _):
      key
    }
  }

  /// Its face's rows: a reply, a quiet line or Thinking….
  var isTheSpark: Bool {
    switch self {
    case .reply, .tools, .act, .thinking: true
    default: false
    }
  }

  /// The row with its face leading or not.
  func leading(_ lead: Bool) -> ChatFlowItem {
    switch self {
    case .reply(let key, let text, _): .reply(key: key, text: text, lead: lead)
    case .tools(let key, let words, let rows, _): .tools(key: key, words: words, rows: rows, lead: lead)
    case .act(let key, let what, let words, _, let crew):
      .act(key: key, what: what, words: words, lead: lead, crew: crew)
    case .thinking(let key, _): .thinking(key: key, lead: lead)
    default: self
    }
  }
}

/// What the flow draws: its rows, or why there are none to draw yet.
public enum ChatFlow: Sendable, Equatable {
  case reading
  /// fieldd's words, and the desktop that said them when it named one.
  case unreadable(reason: String, device: String?)
  case ready([ChatFlowItem])
}

// MARK: - The words (§9 "Chat's words")

public enum ChatFlowWords {
  public static func reading(_ name: String) -> String { "Reading \(name)'s conversation…" }
  public static func unreadable(_ name: String, _ reason: String) -> String {
    "Couldn't read \(name)'s conversation: \(reason)"
  }
  public static func earlier(_ count: Int) -> String { "Earlier conversations (\(count))" }
  public static func conversation(_ date: String) -> String { "A new conversation · \(date)" }
  public static let thinking = "Thinking…"
  public static func tools(_ count: Int) -> String { "Used \(count) \(count == 1 ? "tool" : "tools")" }
  public static func before(_ name: String) -> String { "Earlier messages are in \(name)'s terminal" }
  public static func gap(_ name: String) -> String {
    "Part of this conversation happened while VibeField restarted — it's in \(name)'s terminal"
  }
  public static let dropped = "Part of this conversation couldn't be checked, so it isn't shown"

  /// Each of the agent runtime's seven tool kinds in VibeField's words, never a tool's own name (AR-L1), in the Mac's
  /// order.
  public static let toolKinds: [(kind: String, words: String)] = [
    ("command", "Ran a command"),
    ("web-search", "Searched the web"),
    ("file-read", "Read a file"),
    ("file-edit", "Edited a file"),
    ("browser", "Used the browser"),
    ("mcp", "Used a tool"),
    ("other", "Used a tool"),
  ]

  /// A tool's kind in VibeField's words; a kind this build does not know is a tool.
  public static func tool(_ kind: String) -> String {
    toolKinds.first { $0.kind == kind }?.words ?? "Used a tool"
  }

  /// VibeField's own act, in its words (TH-Q12 (a), CO-Q1 (b)); one this build does not know, in its own.
  public static func act(_ what: String, _ text: String, _ name: String) -> String {
    switch what {
    case "wake": "VibeField told \(name): \(text)"
    case "answer": "You answered \(name): \(text)"
    case "notify": "\(name) told you: \(text)"
    default: text
    }
  }

  /// A chip's words in your bubble: its span of your words (UTF-16 units, as the window counts), and for a session
  /// the words before the run id it carries for the spark's tools, which is never drawn ("Claude Code in
  /// vibe-field").
  public static func chip(_ text: String, _ chip: SparkTranscriptChip) -> String {
    let units = Array(text.utf16)
    let start = min(max(chip.start, 0), units.count)
    let end = min(start + max(chip.length, 0), units.count)
    let words = String(decoding: units[start..<end], as: UTF16.self)
    guard chip.kind == "session" else { return words }
    return words.replacingOccurrences(of: #"\s*\(session [^)]*\)\z"#, with: "", options: .regularExpression)
  }

  /// NS-D4's hello: what a new spark does, as its first words, in its voice. VibeField's words: never sent to the
  /// session, never in its transcript.
  public static func hello(_ name: String) -> String {
    "Hi, I'm \(name). I can start agents for you, keep track of the ones you run, and carry work between them. "
      + "What first?"
  }

  /// NS-D4's three starters, one per job, in the Sparks page's words as ruled, with straight apostrophes.
  public static let starters: [ChatStarter] = [
    ChatStarter(glyph: .agents, words: "Spawn 4 Grok agents to research a topic each"),
    ChatStarter(glyph: .panes, words: "Keep track of my agents in vibe-field"),
    ChatStarter(glyph: .duplicate, words: "Have Codex review claude·2's work until it's clean"),
  ]

  /// A day line's words: "Today", "Yesterday", else the weekday and the date ("Mon, Nov 2"), by the phone's clock in
  /// its zone.
  public static func day(at: Int64, now: Int64, locale: Locale, timeZone: TimeZone) -> String {
    let calendar = ChatFlows.calendar(locale, timeZone)
    let when = ChatFlows.date(at)
    let today = ChatFlows.date(now)
    if calendar.isDate(when, inSameDayAs: today) { return "Today" }
    if let yesterday = calendar.date(byAdding: .day, value: -1, to: today),
      calendar.isDate(when, inSameDayAs: yesterday)
    {
      return "Yesterday"
    }
    return ChatFlows.format(when, "EEEMMMd", locale, timeZone)
  }

  /// A conversation's date, as its opening line says it ("Nov 3").
  static func date(at: Int64, locale: Locale, timeZone: TimeZone) -> String {
    ChatFlows.format(ChatFlows.date(at), "MMMd", locale, timeZone)
  }
}

// MARK: - The receipt

extension ChatFlows {
  /// A say's states as this build names them (`COMPOSE_SAY_STATES`); any other is said as nothing.
  public static let sayStates = ["queued", "waking", "waiting", "delivered", "uncertain", "dropped"]

  /// Your bubble's receipt (TH-Q4 (a); PC-L1): the state fieldd last said, read with the spark as Chat reads it now,
  /// busy or waiting on you. "Delivered" is said under your last bubble alone. A state this build does not know, or
  /// none yet, says nothing.
  public static func receipt(_ state: String?, _ spark: ChatFlowSpark, last: Bool) -> ChatReceipt? {
    let name = spark.name
    switch state {
    case "waking":
      return ChatReceipt("Waking \(name)…")
    case "queued", "waiting":
      if spark.blocked || spark.waiting { return ChatReceipt("Queued · it lands after you answer \(name)") }
      if spark.working { return ChatReceipt("Queued · \(name) is busy; it lands when it's done") }
      return ChatReceipt("Queued")
    case "delivered":
      return last ? ChatReceipt("Delivered") : nil
    case "dropped":
      return ChatReceipt("Not delivered: \(name)'s session ended")
    case "uncertain":
      return ChatReceipt("\(name) may not have it: look in its pane", attention: true)
    default:
      return nil
    }
  }
}

// MARK: - The projection

public enum ChatFlows {
  /// The flow's rows, top to bottom (`transcriptItemsOf`). `now` is the phone's clock (epoch ms); the day lines read
  /// it in `timeZone`.
  public static func flow(
    spark: ChatFlowSpark, reading: SparkTranscriptReading, pending: [ChatPendingSay] = [], earlier: Bool = false,
    now: Int64, locale: Locale = .current, timeZone: TimeZone = .current
  ) -> ChatFlow {
    let runs: [SparkTranscriptRun]
    let held: [String: [SparkTranscriptKnownLine]]
    let dropped: Int
    switch reading {
    case .reading:
      return .reading
    case .unreadable(let reason, let device):
      return .unreadable(reason: reason, device: device)
    case .ready(let readRuns, let lines, let readDropped, _):
      runs = readRuns
      held = lines
      dropped = readDropped
    }
    let clock = Clock(now: now, locale: locale, timeZone: timeZone)
    let name = spark.name
    let conversations = Self.conversations(of: runs)
    let shown = earlier ? conversations : Array(conversations.suffix(1))
    let hidden = conversations.count - shown.count
    let lines = runs.flatMap { held[$0.runtimeRunId] ?? [] }
    var items: [ChatFlowItem] = []
    if hidden > 0 { items.append(.earlier(key: "earlier", count: hidden)) }
    if dropped > 0 { items.append(.honest(key: "dropped", which: .dropped, words: ChatFlowWords.dropped)) }

    // the record began after the spark first worked: those turns are in its terminal only, said at the top of the
    // first conversation, once it is drawn
    if let turnedAt = spark.turnedAt, hidden == 0,
      runs.first.map({ time($0.startedAt) > time(turnedAt) }) ?? true
    {
      items.append(.honest(key: "before", which: .before, words: ChatFlowWords.before(name)))
    }

    let said = saidRequests(runs: runs, lines: held)
    var latest: [Row] = []
    var latestSince: Int64?
    for (index, conversation) in shown.enumerated() {
      let opening = conversation.first
      var since: Int64?
      if earlier, conversations.count > 1, let opening {
        let at = time(opening.startedAt)
        since = at
        items.append(
          .day(
            key: "conversation:\(opening.runtimeRunId)",
            words: ChatFlowWords.conversation(ChatFlowWords.date(at: at, locale: locale, timeZone: timeZone))))
      }
      let rows = Self.rows(
        of: conversation.flatMap { held[$0.runtimeRunId] ?? [] }, name: name, key: opening?.runtimeRunId ?? "none")
      if index < shown.count - 1 {
        items += withDays(receipted(rows, spark, lines), since: since, clock)
      } else {
        latest += rows
        latestSince = since
      }
    }

    // this phone's sends the record does not show yet, newest last
    let waiting = pending.filter { !said.contains($0.requestId) }
    for say in waiting {
      latest.append(
        Row(
          at: time(say.at),
          item: .draft(
            YouDraft(
              key: "pending:\(say.requestId)", text: say.text, chips: say.chips, input: nil, state: say.state,
              terminal: false))))
    }

    // the hello: the first row, while the spark is new and its conversation holds no words of yours or its own
    let empty = waiting.isEmpty && !lines.contains { $0.kind == "you" || $0.kind == "reply" }
    if empty, spark.isNew {
      items.append(
        .hello(
          key: "hello", seed: spark.seed, status: spark.status, words: ChatFlowWords.hello(name),
          starters: ChatFlowWords.starters))
    }
    items += withDays(receipted(latest, spark, lines), since: latestSince, clock)
    // Thinking… at the foot while its own run works, from its board row; it carries no text
    if spark.awake, spark.working { items.append(.thinking(key: "thinking", lead: true)) }
    return .ready(leads(items))
  }

  /// The request ids of your sends the record shows (its `you` lines that carry one): their bubbles are the record's,
  /// and this phone's own are let go.
  public static func saidRequests(_ reading: SparkTranscriptReading) -> Set<String> {
    guard case .ready(let runs, let lines, _, _) = reading else { return [] }
    return saidRequests(runs: runs, lines: lines)
  }

  static func saidRequests(runs: [SparkTranscriptRun], lines: [String: [SparkTranscriptKnownLine]]) -> Set<String> {
    var said = Set<String>()
    for run in runs {
      for line in lines[run.runtimeRunId] ?? [] {
        if case .you(let you) = line.body, let id = you.requestId, !id.isEmpty { said.insert(id) }
      }
    }
    return said
  }

  /// One conversation: its runs, joined, oldest first.
  static func conversations(of runs: [SparkTranscriptRun]) -> [[SparkTranscriptRun]] {
    var out: [[SparkTranscriptRun]] = []
    for run in runs {
      if out.isEmpty || run.fresh { out.append([run]) } else { out[out.count - 1].append(run) }
    }
    return out
  }

  // MARK: The rows

  /// Your words before their receipt is laid: the input they were queued as, the state they were queued with, and
  /// where they came from.
  struct YouDraft {
    let key: String
    let text: String
    let chips: [SparkTranscriptChip]
    let input: String?
    let state: String?
    let terminal: Bool
  }

  enum RowItem {
    case item(ChatFlowItem)
    case draft(YouDraft)

    var key: String {
      switch self {
      case .item(let item): item.key
      case .draft(let draft): draft.key
      }
    }
  }

  /// A row with its receipt laid, before its day line and its lead are.
  typealias Laid = (at: Int64, item: ChatFlowItem)

  /// A row before its day line and its lead are laid.
  struct Row {
    let at: Int64
    let item: RowItem
  }

  /// A conversation's lines as rows: replies (the latest for a message id, where it first stood), tools folded one
  /// line a turn (VibeField's own left out), your words with what their receipt needs, VibeField's acts, and the gap
  /// line. Turn edges and run lines are read for grouping and draw nothing; an outcome is read into its bubble's
  /// receipt.
  static func rows(of lines: [SparkTranscriptKnownLine], name: String, key: String) -> [Row] {
    var rows: [Row] = []
    var replies: [String: Int] = [:]
    // SP-1e2 (SPE-Q39 (a)) — a crew's act line, where it first stood: a later line of the crew says its latest words
    var crews: [String: Int] = [:]
    var toolsAt: Int64 = 0
    var toolsTurn: String?
    var toolsKey = ""
    var toolRows: [ChatToolRow]?
    func closeTools() {
      if let held = toolRows, !held.isEmpty {
        rows.append(
          Row(
            at: toolsAt,
            item: .item(.tools(key: toolsKey, words: ChatFlowWords.tools(held.count), rows: held, lead: false))))
      }
      toolRows = nil
    }
    for line in lines {
      let at = time(line.at)
      switch line.body {
      case .tool(let tool):
        if toolRows == nil || toolsTurn != tool.turn {
          closeTools()
          toolRows = []
          toolsAt = at
          toolsTurn = tool.turn
          toolsKey = "tools:\(key):\(line.seq)"
        }
        if !tool.ours { toolRows?.append(ChatToolRow(words: ChatFlowWords.tool(tool.toolKind), detail: tool.detail)) }
      case .turn(let edge, _):
        if edge != "start" { closeTools() }
      case .run, .outcome:
        break
      case .reply(let messageId, _, let text):
        closeTools()
        let item = ChatFlowItem.reply(key: "reply:\(messageId)", text: text, lead: false)
        if let held = replies[messageId], rows.indices.contains(held) {
          rows[held] = Row(at: rows[held].at, item: .item(item))
        } else {
          replies[messageId] = rows.count
          rows.append(Row(at: at, item: .item(item)))
        }
      case .you(let you):
        closeTools()
        rows.append(
          Row(
            at: at,
            item: .draft(
              YouDraft(
                key: "you:\(key):\(line.seq)", text: you.text, chips: you.chips ?? [], input: you.input,
                state: you.state, terminal: you.via == "terminal"))))
      case .act(let what, let text, let lineCrew):
        closeTools()
        let crew = what == "crew" ? lineCrew : nil
        let item = ChatFlowItem.act(
          key: crew.map { "act:crew:\($0)" } ?? "act:\(key):\(line.seq)", what: what,
          words: ChatFlowWords.act(what, text, name), lead: false, crew: crew)
        if let crew, let held = crews[crew], rows.indices.contains(held) {
          rows[held] = Row(at: rows[held].at, item: .item(item))
        } else {
          if let crew { crews[crew] = rows.count }
          rows.append(Row(at: at, item: .item(item)))
        }
      case .gap:
        closeTools()
        rows.append(
          Row(
            at: at,
            item: .item(.honest(key: "gap:\(key):\(line.seq)", which: .gap, words: ChatFlowWords.gap(name)))))
      }
    }
    closeTools()
    return rows
  }

  /// Your bubbles' receipts, laid once every bubble of the conversation is known: the record's latest outcome for its
  /// input over the state it was queued with, a pending send's own receipt, and "Delivered" under the last bubble
  /// alone. Words typed into the terminal have none.
  static func receipted(_ rows: [Row], _ spark: ChatFlowSpark, _ lines: [SparkTranscriptKnownLine]) -> [Laid] {
    var outcomes: [String: String] = [:]
    for line in lines {
      if case .outcome(let of, let state, _) = line.body { outcomes[of] = state }
    }
    let lastYou =
      rows.lastIndex { row in
        if case .draft(let draft) = row.item { return !draft.terminal }
        return false
      } ?? -1
    return rows.enumerated().map { index, row in
      switch row.item {
      case .item(let item):
        return (row.at, item)
      case .draft(let draft):
        let state = draft.input.flatMap { outcomes[$0] } ?? draft.state
        return (
          row.at,
          .you(
            key: draft.key, text: draft.text, chips: draft.chips,
            receipt: draft.terminal ? nil : receipt(state, spark, last: index == lastYou))
        )
      }
    }
  }

  /// The phone's clock and how it reads a day.
  struct Clock {
    let now: Int64
    let locale: Locale
    let timeZone: TimeZone
  }

  /// Day lines laid where the day changes: before the first row, unless the line above it (a conversation's opening)
  /// already said that day.
  static func withDays(_ rows: [Laid], since: Int64?, _ clock: Clock) -> [ChatFlowItem] {
    let calendar = Self.calendar(clock.locale, clock.timeZone)
    var out: [ChatFlowItem] = []
    var day = since.map { calendar.dateComponents([.year, .month, .day], from: date($0)) }
    for row in rows {
      let here = calendar.dateComponents([.year, .month, .day], from: date(row.at))
      if here != day {
        out.append(
          .day(
            key: "day:\(row.item.key)",
            words: ChatFlowWords.day(at: row.at, now: clock.now, locale: clock.locale, timeZone: clock.timeZone)))
      }
      day = here
      out.append(row.item)
    }
    return out
  }

  /// Its face leads once per run of its rows: a reply, a quiet line or Thinking… right after another of its rows does
  /// not repeat it.
  static func leads(_ items: [ChatFlowItem]) -> [ChatFlowItem] {
    items.enumerated().map { index, item in
      guard item.isTheSpark else { return item }
      return item.leading(index == 0 || !items[index - 1].isTheSpark)
    }
  }

  // MARK: Time

  /// An ISO time as epoch ms; 0 for one it cannot read (the Mac's `Date.parse` NaN, read as 0).
  static func time(_ iso: String) -> Int64 { SparkEntries.time(iso) }

  static func date(_ ms: Int64) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }

  static func calendar(_ locale: Locale, _ timeZone: TimeZone) -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = locale
    calendar.timeZone = timeZone
    return calendar
  }

  static func format(_ date: Date, _ template: String, _ locale: Locale, _ timeZone: TimeZone) -> String {
    let formatter = DateFormatter()
    formatter.locale = locale
    formatter.timeZone = timeZone
    formatter.calendar = calendar(locale, timeZone)
    formatter.setLocalizedDateFormatFromTemplate(template)
    return formatter.string(from: date)
  }
}
