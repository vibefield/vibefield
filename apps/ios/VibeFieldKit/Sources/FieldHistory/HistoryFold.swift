import FieldProduct
import Foundation

// SP-6 (2026-10-04) — the door's answers folded into the tab's VALUES (H-D4:
// every decision a pure function, pinned by `FieldHistoryTests`): a catalog
// row into a ledger row, a project's figures into its four numbers and its
// ribbon, a listing into session rows under their days, a session's timeline
// rows into the document — turns, response heads, runs folded to a sentence
// of nouns with the failed count, the day pill — the search's hits into
// groups, and `index.status` into the desktop's standing. The vocabulary of
// the folds is rosetta's room's (`clients/room/src/lib/transcript/`), kept to
// what a phone's ladder draws; what the room decides by the row's full body
// is decided here by the row's projected facts.

extension FieldHistoryModel {
  // MARK: - Numbers the reads hold to (each with its reason)

  /// A session is "live now" when its conversation moved within this many
  /// minutes: the index reports activity, not a running process (that join is
  /// the field's, H-D6 — owed), and ten minutes is the pause a person takes
  /// between two prompts rather than the end of a session.
  public static let liveWithinMinutes = 10
  /// The ledger's token figure is the last thirty days (the record's "Spend
  /// over 30 days"), asked of `index.project` as its window.
  public static let figureWindowDays = 30
  /// The sparkline's bars: one per day, the last fifteen (the record's own).
  public static let sparkDays = 15
  /// A turn whose prompt came this long after the previous turn ended wears a
  /// day pill (`11:31 · after 1h 19m`), the record's gap.
  public static let dayPillAfterMinutes = 60

  // MARK: - Words

  private static let calendar = Calendar.autoupdatingCurrent

  private static func date(_ ms: Int64) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }

  /// `10:02` — the clock, 24-hour, as the record writes it.
  public static func clock(_ ms: Int64?) -> String {
    guard let ms else { return "—" }
    let parts = calendar.dateComponents([.hour, .minute], from: date(ms))
    return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
  }

  /// `10:02:14` — the prompt's own stamp.
  public static func clockSeconds(_ ms: Int64?) -> String {
    guard let ms else { return "—" }
    let parts = calendar.dateComponents([.hour, .minute, .second], from: date(ms))
    return String(format: "%02d:%02d:%02d", parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0)
  }

  /// `Sat 12 Sep` — a day, named.
  public static func dayWords(_ ms: Int64?) -> String {
    guard let ms else { return "—" }
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "EEE d MMM"
    return formatter.string(from: date(ms))
  }

  /// `Today` · `Yesterday` · `Thu 10 Sep` — the day header a session list turns on.
  public static func dayHeader(_ ms: Int64, now: Date) -> String {
    let day = date(ms)
    if calendar.isDate(day, inSameDayAs: now) { return "Today" }
    if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
      calendar.isDate(day, inSameDayAs: yesterday)
    {
      return "Yesterday"
    }
    return dayWords(ms)
  }

  /// How many minutes ago `ms` was; a stamp in the future is now.
  public static func recencyMinutes(_ ms: Int64?, now: Date) -> Int {
    guard let ms else { return Int.max / 2 }
    return max(0, Int((now.timeIntervalSince(date(ms))) / 60))
  }

  /// `now` · `40m` · `2h` · `yesterday` · `12d` — the last activity's word.
  public static func lastWord(_ ms: Int64?, now: Date) -> String {
    guard let ms else { return "—" }
    let minutes = recencyMinutes(ms, now: now)
    if minutes < 2 { return "now" }
    if minutes < 60 { return "\(minutes)m" }
    let hours = minutes / 60
    if hours < 24, calendar.isDate(date(ms), inSameDayAs: now) { return "\(hours)h" }
    if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
      calendar.isDate(date(ms), inSameDayAs: yesterday)
    {
      return "yesterday"
    }
    return "\(max(1, minutes / (60 * 24)))d"
  }

  /// `48s` · `2m 41s` · `1h 02m` — a span, the record's own spelling.
  public static func spanText(_ ms: Int64) -> String {
    let seconds = max(0, Int(ms / 1000))
    if seconds < 60 { return "\(seconds)s" }
    let minutes = seconds / 60
    if minutes < 60 { return "\(minutes)m \(String(format: "%02d", seconds % 60))s" }
    let hours = minutes / 60
    return "\(hours)h \(String(format: "%02d", minutes % 60))m"
  }

  /// `21.4` `K` · `1.24` `B` · `386` `M` — tokens as a figure and its unit.
  public static func tokensWord(_ tokens: Double) -> (figure: String, unit: String) {
    func figure(_ value: Double) -> String {
      if value >= 100 { return String(format: "%.0f", value) }
      if value >= 10 { return String(format: "%.1f", value) }
      return String(format: "%.2f", value)
    }
    if tokens >= 1e9 { return (figure(tokens / 1e9), "B") }
    if tokens >= 1e6 { return (figure(tokens / 1e6), "M") }
    if tokens >= 1e3 { return (figure(tokens / 1e3), "K") }
    return (String(format: "%.0f", tokens), "")
  }

  /// The ledger's figure as the wash reads it: millions of tokens.
  static func millions(_ tokens: Double) -> Double { tokens / 1e6 }

  /// `~/Projects/vibe-field` — a root on the desktop, home-abbreviated the way
  /// the record writes a path. The desktop's home is not known here, so the
  /// first `/Users/<name>/` or `/home/<name>/` is the one folded.
  public static func homeAbbreviated(_ path: String) -> String {
    let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    if parts.count >= 3, parts[0].isEmpty, parts[1] == "Users" || parts[1] == "home" {
      return (["~"] + parts.dropFirst(3)).joined(separator: "/")
    }
    return path
  }

  // MARK: - The ledger

  /// A catalog row as a ledger row: identity, location, the session count as
  /// the figure until the project's own figures land (`withFigures`). The
  /// wash and the spend rank read `spend`, which stays 0 — unread — so a
  /// project whose tokens are not read yet sorts under those whose are.
  public static func ledgerProject(_ row: IndexProjectRow, seq: Int, now: Date) -> HistoryProject {
    HistoryProject(
      id: row.projectId, name: row.name.isEmpty ? "untitled project" : row.name, seq: seq,
      path: homeAbbreviated(row.rootPaths.first ?? ""), figure: figure(Int(row.sessionCount)),
      unit: "", spend: 0, last: lastWord(row.lastActivityAt, now: now),
      recencyMinutes: recencyMinutes(row.lastActivityAt, now: now), agents: [], spark: [])
  }

  /// The project's figures from `index.project` and its sessions: tokens over
  /// the window as the figure, the last fifteen days as the sparkline, the
  /// four numbers, the 53-week ribbon as the index counted it, and the agents
  /// by share of the sessions listed.
  public static func withFigures(
    _ project: HistoryProject, _ result: IndexProjectResult, sessions: [IndexSessionRow], now: Date
  ) -> HistoryProject {
    let total = result.heatmap.reduce(0) { $0 + $1.tokens }
    let word = tokensWord(total)
    let byDay = Dictionary(result.heatmap.map { ($0.day, $0.tokens) }, uniquingKeysWith: +)
    let spark = lastDays(sparkDays, now: now).map { byDay[$0] ?? 0 }
    let peak = max(spark.max() ?? 0, 1)
    let messages = result.contribution.reduce(0) { $0 + $1.messages }
    let activeDays = result.heatmap.filter { $0.tokens > 0 }.count
    var modelTokens: [String: Double] = [:]
    for day in result.models { modelTokens[day.model, default: 0] += day.tokens }
    let mostly = modelTokens.max { $0.value < $1.value }?.key
    let facts = [
      "\(activeDays) active \(activeDays == 1 ? "day" : "days")",
      mostly.map { "mostly \($0)" },
    ].compactMap { $0 }.joined(separator: " · ")
    let stats = HistoryProjectStats(
      sessions: figure(sessions.isEmpty ? Int(project.figure.filter(\.isNumber)) ?? 0 : sessions.count),
      messages: figure(Int(messages)),
      tokens: word.figure, tokensUnit: word.unit, activeDays: figure(activeDays), facts: facts)
    return HistoryProject(
      id: project.id, name: project.name, seq: project.seq, path: project.path, missing: project.missing,
      figure: word.figure, unit: word.unit, spend: millions(total), last: project.last,
      recencyMinutes: project.recencyMinutes, agents: agentShares(sessions),
      moreAgents: max(0, Set(sessions.compactMap(\.provider)).count - 3),
      spark: spark.map { Int(($0 / peak * 12).rounded()) }, stats: stats,
      ribbon: ribbon(from: result.heatmap, now: now))
  }

  /// The last `count` calendar days, oldest first, as `YYYY-MM-DD`.
  static func lastDays(_ count: Int, now: Date) -> [String] {
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    return (0..<count).reversed().compactMap { back in
      calendar.date(byAdding: .day, value: -back, to: now).map(formatter.string)
    }
  }

  /// The 53 weeks of 7 ending today, each day 0…4 by its share of the busiest
  /// day — the index's own count in the record's levels.
  static func ribbon(from heatmap: [IndexHeatmapDay], now: Date) -> [[Int]] {
    let byDay = Dictionary(heatmap.map { ($0.day, $0.tokens) }, uniquingKeysWith: +)
    let peak = max(heatmap.map(\.tokens).max() ?? 0, 1)
    let days = lastDays(53 * 7, now: now)
    return stride(from: 0, to: days.count, by: 7).map { start in
      days[start..<min(start + 7, days.count)].map { day in
        let tokens = byDay[day] ?? 0
        return tokens <= 0 ? 0 : max(1, min(4, Int((tokens / peak * 4).rounded(.up))))
      }
    }
  }

  /// The agents of a project by their share of its sessions, the lead first,
  /// at most three (the rest are `+N`).
  static func agentShares(_ sessions: [IndexSessionRow]) -> [HistoryAgentShare] {
    var counts: [String: Int] = [:]
    for session in sessions { counts[session.provider ?? "agent", default: 0] += 1 }
    let total = max(sessions.count, 1)
    return counts.sorted { $0.value > $1.value || ($0.value == $1.value && $0.key < $1.key) }
      .prefix(3)
      .map { HistoryAgentShare($0.key, Int((Double($0.value) / Double(total) * 100).rounded())) }
  }

  /// A listing's rows under their days, newest first: the title (else the
  /// summary, else the honest "untitled session"), the agent, the span and
  /// the start as the meta line, the last activity's word.
  public static func sessionRows(_ rows: [IndexSessionRow], projectId: String, now: Date) -> [HistorySession] {
    let ordered = rows.sorted { (lastAt($0) ?? -1) > (lastAt($1) ?? -1) }
    var previousDay: String?
    return ordered.map { row in
      // a row the index has no stamp for at all is "undated", never 1970's
      let header = (row.startedAt ?? row.activity?.firstAt ?? lastAt(row)).map { dayHeader($0, now: now) } ?? "Undated"
      let day = header == previousDay ? nil : header
      previousDay = header
      return sessionRow(row, projectId: projectId, day: day, now: now)
    }
  }

  /// When the session last moved: its activity, else its source's freshness,
  /// else its start; nil when the index carries no stamp at all.
  static func lastAt(_ row: IndexSessionRow) -> Int64? {
    row.activity?.lastAt ?? row.updatedAt ?? row.startedAt
  }

  static func sessionRow(_ row: IndexSessionRow, projectId: String, day: String?, now: Date) -> HistorySession {
    let span = (row.activity.map { $0.lastAt - $0.firstAt }).map(spanText)
    let meta = [
      span,
      "started \(clock(row.startedAt ?? row.activity?.firstAt))",
      row.streamState == "pending" ? "not read yet" : nil,
    ].compactMap { $0 }.joined(separator: " · ")
    return HistorySession(
      id: row.sessionId, projectId: projectId, day: day,
      title: row.title ?? row.summary ?? "untitled session", agent: row.provider ?? "agent",
      meta: meta, branch: "", last: lastWord(lastAt(row), now: now),
      tone: row.streamState == "pending" ? .orange : nil)
  }

  /// The sessions that moved within `liveWithinMinutes`: a tap opens the
  /// document. The field's own join (H-D6) is owed; recency is the index's
  /// honest word for "live".
  public static func liveRows(_ rows: [IndexSessionRow], now: Date) -> [HistoryLive] {
    rows.filter { recencyMinutes($0.activity?.lastAt, now: now) < liveWithinMinutes }
      .sorted { (lastAt($0) ?? -1) > (lastAt($1) ?? -1) }
      .map { row in
        HistoryLive(
          id: "live-\(row.sessionId)", projectId: row.projectId ?? "",
          title: row.title ?? row.summary ?? "untitled session", agent: row.provider ?? "agent",
          running: row.summary ?? "active \(lastWord(row.activity?.lastAt, now: now))",
          destination: .session(row.sessionId))
      }
  }

  /// The scope line's counts: sessions across the catalog's projects, agents
  /// across the sessions listed.
  public static func counts(projects: [IndexProjectRow], sessions: [IndexSessionRow]) -> (sessions: Int, agents: Int) {
    (projects.reduce(0) { $0 + Int($1.sessionCount) }, Set(sessions.compactMap(\.provider)).count)
  }

  // MARK: - The document

  /// The room's run vocabulary, transcribed: which families are LOOKS (the
  /// rest are acts; acts lead the sentence), the noun per family (one, many),
  /// and the verb a ladder line opens with.
  static let lookFamilies: Set<String> = [
    "file_read", "file_list", "file_search", "code_lookup", "web_search", "web_fetch", "web_navigate",
    "tool_discovery",
  ]
  static let familyNoun: [String: (String, String)] = [
    "file_read": ("read", "reads"), "file_list": ("listing", "listings"),
    "file_search": ("search", "searches"), "code_lookup": ("lookup", "lookups"),
    "web_search": ("web search", "web searches"), "web_fetch": ("fetch", "fetches"),
    "web_navigate": ("page", "pages"), "tool_discovery": ("tool search", "tool searches"),
    "shell": ("command", "commands"), "code_execute": ("run", "runs"),
    "file_change": ("edit", "edits"), "process": ("process", "processes"),
    "orchestration": ("tool batch", "tool batches"), "delegate": ("delegation", "delegations"),
    "collaborate": ("message", "messages"), "question": ("question", "questions"),
    "skill": ("skill", "skills"), "workflow": ("workflow", "workflows"),
    "schedule": ("schedule", "schedules"), "artifact": ("artifact", "artifacts"),
    "notification": ("notification", "notifications"), "mode": ("mode change", "mode changes"),
    "task": ("task", "tasks"), "plan": ("plan", "plans"), "finding": ("report", "reports"),
    "structured_output": ("document", "documents"), "external": ("call", "calls"),
  ]
  static let familyVerb: [String: String] = [
    "file_read": "Read", "file_list": "Listed", "file_search": "Searched", "code_lookup": "Looked up",
    "shell": "Ran", "code_execute": "Ran", "file_change": "Edited", "web_search": "Searched",
    "web_fetch": "Fetched", "web_navigate": "Opened", "delegate": "Delegated", "task": "Task",
    "plan": "Planned", "collaborate": "Messaged", "question": "Asked", "skill": "Skill",
    "workflow": "Workflow", "schedule": "Scheduled", "artifact": "Made", "tool_discovery": "Found tools",
    "mode": "Mode", "finding": "Reported", "notification": "Notified", "structured_output": "Wrote",
    "external": "Called", "process": "Process", "orchestration": "Batched",
  ]

  /// `1 read` · `4 reads` — the count stated, the noun agreeing.
  static func noun(_ family: String, _ count: Int) -> String {
    let (one, many) = familyNoun[family] ?? ("call", "calls")
    return "\(count) \(count == 1 ? one : many)"
  }

  /// A tool row as a ladder line: the verb, the object split into its folder
  /// and its name when it is a path, the result, the state.
  public static func ledgerLine(_ row: IndexTimelineRow, tool: IndexTimelineTool) -> HistoryLedgerLine {
    let verb = tool.status == "running" || tool.status == "pending" ? runningVerb(tool.family) : familyVerb[tool.family] ?? "Called"
    let state: HistoryLedgerLine.State = tool.failed ? .failed : (tool.status == "running" || tool.status == "pending") ? .running : .ok
    let object = tool.object ?? tool.name
    let (dir, name) = splitPath(object, family: tool.family)
    let result = tool.result ?? (tool.failed ? (tool.failure ?? "failed") : "")
    return HistoryLedgerLine(id: row.timelineId, verb: verb, object: name, dir: dir, result: result, state: state)
  }

  static func runningVerb(_ family: String) -> String {
    switch family {
    case "shell", "code_execute": "Running"
    case "file_read": "Reading"
    case "file_search", "web_search": "Searching"
    case "file_change": "Editing"
    default: "Working"
    }
  }

  /// A path's folder and name: `design-kit/src/icons/` + `vibefield.ts` (the
  /// last two folders, the record's touch); a command or a query stays whole.
  static func splitPath(_ object: String, family: String) -> (dir: String?, name: String) {
    let pathFamilies: Set<String> = ["file_read", "file_list", "file_change"]
    guard pathFamilies.contains(family), object.contains("/") else { return (nil, object) }
    let parts = object.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
    guard let name = parts.last, parts.count > 1 else { return (nil, object) }
    let folders = parts.dropLast().suffix(2)
    return ("\(folders.joined(separator: "/"))/", name)
  }

  /// The run's closing sentence: nouns, never verbs — acts first, then looks,
  /// each family by count, the edited files named after the edits (at most
  /// four), and `N thoughts` only when thoughts are all the run holds.
  public static func runSummary(lines: [(family: String, object: String)], thoughts: Int) -> String {
    var order: [String] = []
    var counts: [String: Int] = [:]
    var edited: [String] = []
    for line in lines {
      if counts[line.family] == nil { order.append(line.family) }
      counts[line.family, default: 0] += 1
      if line.family == "file_change", !edited.contains(line.object) { edited.append(line.object) }
    }
    let acts = order.filter { !lookFamilies.contains($0) }
    let looks = order.filter { lookFamilies.contains($0) }
    let ranked = { (families: [String]) in
      families.sorted { (counts[$0] ?? 0) > (counts[$1] ?? 0) || ((counts[$0] ?? 0) == (counts[$1] ?? 0) && order.firstIndex(of: $0)! < order.firstIndex(of: $1)!) }
    }
    var words: [String] = []
    for family in ranked(acts) + ranked(looks) {
      words.append(noun(family, counts[family] ?? 0))
      if family == "file_change", !edited.isEmpty {
        let shown = edited.prefix(4).joined(separator: ", ")
        words.append(edited.count > 4 ? "\(shown) +\(edited.count - 4)" : shown)
      }
    }
    if words.isEmpty, thoughts > 0 { words.append("\(thoughts) \(thoughts == 1 ? "thought" : "thoughts")") }
    return words.joined(separator: " · ")
  }

  /// The document from a session's header and its rows (oldest first): a
  /// `user` row opens a turn; what follows until the next is the reply — prose
  /// rows as paragraphs, every other row folded into a run, with the response
  /// head's model, span and tokens. Rows before the first prompt are a turn
  /// with no prompt (a transcript that opens on a reply — the ground truth's
  /// own shape — draws its reply without an empty panel).
  public static func document(
    header: IndexSessionRow, rows: [IndexTimelineRow], desktop: String, agentLabel: String,
    nextCursor: String?, watermark: String?, liveSince: String?, now: Date
  ) -> HistoryDocument {
    let ordered = rows.sorted { $0.ordinal < $1.ordinal || ($0.ordinal == $1.ordinal && $0.timelineId < $1.timelineId) }
    var groups: [(prompt: IndexTimelineRow?, body: [IndexTimelineRow])] = []
    for row in ordered {
      if row.kind == "user" {
        groups.append((row, []))
      } else if groups.isEmpty {
        groups.append((nil, [row]))
      } else {
        groups[groups.count - 1].body.append(row)
      }
    }
    var turns: [HistoryTurn] = []
    var previousEnd: Int64?
    for (index, group) in groups.enumerated() {
      let at = group.prompt?.at ?? group.body.first?.at
      var pill: HistoryDayPill?
      if let at, let previousEnd, at - previousEnd >= Int64(dayPillAfterMinutes) * 60_000 {
        pill = HistoryDayPill(time: clock(at), after: "after \(gapText(at - previousEnd))")
      }
      let segments = self.segments(group.body, desktop: desktop)
      let agentRows = group.body.filter { $0.kind != "user" }
      let model = agentRows.compactMap(\.model).first ?? ""
      let effort = agentRows.compactMap(\.effort).first
      let tokens = agentRows.compactMap { $0.usage?.total }.reduce(0, +)
      let stamps = group.body.compactMap(\.at)
      let span = stamps.isEmpty ? nil : (stamps.max()! - stamps.min()!)
      let isLive = group.body.contains { $0.tool?.status == "running" || $0.tool?.status == "pending" }
      let facts = [
        span.map { isLive ? "\(spanText($0)) → …" : spanText($0) },
        tokens > 0 ? tokensWord(tokens).figure + tokensWord(tokens).unit : nil,
      ].compactMap { $0 }.joined(separator: " · ")
      let promptAttachments = group.prompt?.attachments.map { attachmentWords($0, desktop: desktop) } ?? []
      turns.append(
        HistoryTurn(
          id: group.prompt?.timelineId ?? group.body.first?.timelineId ?? "turn-\(index)",
          at: clockSeconds(at), dayPill: pill, prompt: group.prompt?.text ?? "",
          promptAnchor: group.prompt?.timelineId,
          model: [model.isEmpty ? nil : model, effort].compactMap { $0 }.joined(separator: " · "),
          facts: facts, isLive: isLive, segments: segments, promptAttachments: promptAttachments))
      previousEnd = stamps.max() ?? at ?? previousEnd
    }
    return HistoryDocument(
      id: header.sessionId, projectId: header.projectId ?? "",
      title: header.title ?? header.summary ?? "untitled session", agentName: agentLabel,
      agent: header.provider ?? "agent", branch: "",
      startedAt: clock(header.startedAt ?? header.activity?.firstAt),
      startDay: dayWords(header.startedAt ?? header.activity?.firstAt), turns: turns,
      liveSince: liveSince, nextCursor: nextCursor, watermark: watermark)
  }

  /// `1h 19m` · `3h` · `2d` — the day pill's gap.
  static func gapText(_ ms: Int64) -> String {
    let minutes = Int(ms / 60_000)
    if minutes < 60 { return "\(minutes)m" }
    let hours = minutes / 60
    if hours < 24 { return minutes % 60 == 0 ? "\(hours)h" : "\(hours)h \(String(format: "%02d", minutes % 60))m" }
    return "\(hours / 24)d"
  }

  /// `image on studio` — the placeholder's words (H-D9: not relayed).
  static func attachmentWords(_ attachment: IndexTimelineAttachment, desktop: String) -> String {
    let what = attachment.name.map { "\(attachment.kind) \($0)" } ?? attachment.kind
    return attachment.available ? "\(what) on \(desktop)" : "\(what) · not recorded"
  }

  /// A reply's rows as segments: prose paragraphs, attachments as placeholders,
  /// and everything else folded into runs between them.
  static func segments(_ body: [IndexTimelineRow], desktop: String) -> [HistorySegment] {
    var out: [HistorySegment] = []
    var run: [IndexTimelineRow] = []
    func flush() {
      guard !run.isEmpty else { return }
      out.append(ledger(run))
      run.removeAll()
    }
    for row in body {
      switch row.kind {
      case "agent":
        flush()
        out.append(.prose(id: row.timelineId, at: clockSeconds(row.at), text: row.text ?? "", anchor: row.timelineId))
        for attachment in row.attachments {
          out.append(.attachment(id: "\(row.timelineId)/\(attachment.id)", kind: attachment.kind, label: attachmentWords(attachment, desktop: desktop)))
        }
      case "user":
        // a second prompt inside a turn cannot happen (it opens a turn); kept
        // as prose so nothing is dropped
        flush()
        out.append(.prose(id: row.timelineId, at: clockSeconds(row.at), text: row.text ?? "", anchor: row.timelineId))
      default:
        run.append(row)
      }
    }
    flush()
    return out
  }

  /// A run of tool, thought, notice, summary and collaboration rows, folded.
  static func ledger(_ rows: [IndexTimelineRow]) -> HistorySegment {
    var lines: [HistoryLedgerLine] = []
    var summaryLines: [(family: String, object: String)] = []
    var thoughts = 0
    var failed = 0
    var isLive = false
    for row in rows {
      switch row.kind {
      case "tool_use":
        guard let tool = row.tool else { continue }
        let line = ledgerLine(row, tool: tool)
        lines.append(line)
        summaryLines.append((tool.family, line.object))
        if tool.failed { failed += 1 }
        if line.state == .running { isLive = true }
      case "thinking":
        thoughts += 1
      case "notice":
        lines.append(HistoryLedgerLine(id: row.timelineId, verb: "Note", object: noticeWords(row), result: "", state: .ok))
      case "summary":
        lines.append(HistoryLedgerLine(id: row.timelineId, verb: "Summary", object: row.summaryPurpose ?? "summary", result: "", state: .ok))
      case "collaboration":
        lines.append(HistoryLedgerLine(id: row.timelineId, verb: "Message", object: row.text ?? "", result: "", state: .ok))
      default:
        lines.append(HistoryLedgerLine(id: row.timelineId, verb: row.kind, object: row.text ?? "", result: "", state: .ok))
      }
    }
    let stamps = rows.compactMap(\.at)
    let span = stamps.isEmpty ? 0 : stamps.max()! - stamps.min()!
    let duration = isLive ? "\(spanText(span)) → …" : spanText(span)
    var summary = runSummary(lines: summaryLines, thoughts: thoughts)
    if summary.isEmpty { summary = lines.first.map { "\($0.verb.lowercased()) · \($0.object)" } ?? "a run" }
    return .ledger(id: rows.first?.timelineId ?? "run", summary: summary, duration: duration, failed: failed, isLive: isLive, lines: lines)
  }

  /// A notice's words: its type as a sentence, its text when it has one.
  static func noticeWords(_ row: IndexTimelineRow) -> String {
    let type = (row.notice ?? "notice").replacingOccurrences(of: "_", with: " ")
    return row.text.map { "\(type): \($0)" } ?? type
  }

  // MARK: - Search

  /// The index's hits grouped under the session they land in (the root the
  /// hit rolls up to), rosetta's `[`/`]` marks stripped (the row marks the
  /// terms itself); `anchor` is the row's timelineId, which the document's
  /// rows carry as their ids — a landing scrolls to it when the page holds it.
  public static func hitGroups(_ result: IndexSearchResult, now: Date) -> [HistoryHitGroup] {
    var order: [String] = []
    var groups: [String: [HistoryHit]] = [:]
    var facts: [String: (title: String, kind: String, at: Int64?)] = [:]
    for hit in result.hits {
      let key = hit.rootSessionId ?? hit.sessionId
      if groups[key] == nil {
        order.append(key)
        facts[key] = (hit.title ?? "untitled session", hit.kind, hit.at)
      }
      let text = hit.snippet.replacingOccurrences(of: "[", with: "").replacingOccurrences(of: "]", with: "")
      groups[key, default: []].append(
        HistoryHit(id: "\(hit.sessionId)/\(hit.timelineId)", anchor: hit.timelineId, who: hit.kind == "user" ? .you : .agent, text: text, at: clock(hit.at)))
    }
    return order.map { key in
      let fact = facts[key]!
      let rows = groups[key] ?? []
      return HistoryHitGroup(
        id: "g-\(key)", projectId: "", sessionId: key, sessionTitle: fact.title, agent: "agent",
        day: fact.at.map { dayHeader($0, now: now) } ?? "—", rows: rows)
    }
  }

  /// The hits a search screen draws: the index's own answer when the corpus
  /// holds one for this query (no second filter — the index widened word
  /// fragments and a hit it found is a hit), else the local match over the
  /// corpus's hits (the mock's path).
  public static func visibleHits(query: String, kind: SearchKind, in corpus: HistoryCorpus) -> [HistoryHitGroup] {
    if let searched = corpus.searchedQuery, searched == query.trimmingCharacters(in: .whitespaces) {
      return corpus.hits.compactMap { group in
        let rows = group.rows.filter { kind.admitsHit($0.who) }
        return rows.isEmpty ? nil : HistoryHitGroup(id: group.id, projectId: group.projectId, sessionId: group.sessionId, sessionTitle: group.sessionTitle, agent: group.agent, day: group.day, rows: rows)
      }
    }
    return hits(for: query, kind: kind, in: corpus)
  }

  // MARK: - The standing

  /// `index.status` as the desktop's standing: indexing while rosetta's
  /// ingest is still reading (its phases, with the search build's counters
  /// when it has them), connected otherwise; no answer is asleep.
  public static func standing(status: IndexStatusResult?) -> DesktopStanding {
    guard let status else { return .asleep }
    let reading: Set<String> = ["discovering", "backfilling", "metadata_ready", "restoring", "finalizing", "publishing"]
    if reading.contains(status.phase) || reading.contains(status.daemonPhase ?? "") {
      let done = status.searchDone ?? 0
      let total = status.searchTotal ?? 0
      let percent = total > 0 ? Int((done / total * 100).rounded()) : 0
      return .indexing(percent: percent, done: figure(Int(done)), total: figure(Int(total)))
    }
    return .connected
  }
}

extension FieldHistoryModel.SearchKind {
  /// Whether a hit of `who` is in this kind (the public twin of the private
  /// filter the local match uses).
  func admitsHit(_ who: HistoryHit.Who) -> Bool {
    switch self {
    case .any: true
    case .prompts: who == .you
    case .replies: who == .agent
    }
  }
}
