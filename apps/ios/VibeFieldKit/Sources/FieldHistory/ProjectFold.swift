import FieldDesign
import FieldProduct
import Foundation

// PJ-7 (2026-10-14) — the `project.*` answers folded into the tab's VALUES
// (H-D4: every decision a pure function, pinned by `FieldHistoryTests`): the
// ledger's desktops from the answer's `sources` in the roster's order, a
// project into a ledger row whose location is its desktops' marks, its places
// as the phone draws them (a folder's name, never its path), its sessions with
// where each ran, and the live rows. DESIGN.md §8 "The phone's History is one
// ledger of projects" is the drawing these feed.

extension FieldHistoryModel {
  /// A desktop as the phone's roster knows it: what the answer's `sources`
  /// cannot say — its platform (the mark), whether this phone hears it, and
  /// which is the home.
  public struct RosterDesktop: Equatable, Sendable {
    public let id: String
    public let name: String
    public let platform: String?
    public let awake: Bool
    public let isHome: Bool

    public init(id: String, name: String, platform: String?, awake: Bool, isHome: Bool) {
      self.id = id
      self.name = name
      self.platform = platform
      self.awake = awake
      self.isHome = isHome
    }
  }

  /// An ISO stamp (`asOf`) as epoch ms; nil when it does not parse.
  static func epochMs(_ iso: String?) -> Int64? {
    guard let iso else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: iso) { return Int64(date.timeIntervalSince1970 * 1000) }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: iso).map { Int64($0.timeIntervalSince1970 * 1000) }
  }

  /// The ledger's desktops: every desktop the answer read, the home first and
  /// then the roster's order (one it does not list goes last, in the answer's
  /// order). A
  /// desktop is asleep when the answer says so or this phone does not hear it.
  public static func desktops(sources: [CatalogSource], roster: [RosterDesktop], now: Date) -> [HistoryDevice] {
    let order = roster.sorted { $0.isHome && !$1.isHome }
    let rank = Dictionary(order.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { a, _ in a })
    // the roster's order, then the answer's own (a sort that keeps ties stable)
    let ordered = sources.enumerated().sorted { a, b in
      switch (rank[a.element.device], rank[b.element.device]) {
      case let (x?, y?): x < y
      case (.some, nil): true
      case (nil, .some): false
      case (nil, nil): a.offset < b.offset
      }
    }.map(\.element)
    return ordered.map { source in
      let known = roster.first { $0.id == source.device }
      let asOf = epochMs(source.asOf)
      return HistoryDevice(
        id: source.device, name: known?.name ?? source.name ?? "a desktop", platform: known?.platform,
        asleep: source.state == "asleep" || known?.awake == false, readAt: clock(asOf),
        since: lastWord(asOf, now: now), isHome: known?.isHome ?? false)
    }
  }

  /// `mini is asleep · read 11:42` — a sleeping desktop's honest sentence (its
  /// mark leads it on screen).
  public static func asleepSentence(_ desktop: HistoryDevice) -> String {
    "\(desktop.name) is asleep · read \(desktop.readAt)"
  }

  // MARK: - The index's own standing (fix7, PJ-7's first phone run)

  /// The ledger's door's INDEX (`index.status` beside `project.list`), apart
  /// from whether the door answers: a door can answer an empty `project.list`
  /// while its index is starting, rebuilding or failed, and "no project" is
  /// only true of an index that is ready. SP-6's reader asked it; PJ-7's
  /// projects reader had dropped it.
  public enum IndexStanding: Equatable, Sendable {
    /// live, or waiting for consent — what it lists is what there is
    case ready
    /// starting, or starting again after its daemon stopped (fieldd's words)
    case starting(detail: String?)
    /// DEBTS — a projection of another schema, rebuilt from its ledger before
    /// it serves; rosetta's rebuild reports no progress, so none is said
    case rebuilding(detail: String?)
    /// reading its history (the search build's counters)
    case indexing(percent: Int, done: String, total: String)
    /// stopped trying, in fieldd's words
    case failed(reason: String)
    /// this desktop runs no index
    case unconfigured(reason: String?)
    /// shut down with its desktop's field service
    case stopped

    public var isReady: Bool { self == .ready }
  }

  /// `index.status` as the index's standing: the folded phase first (fieldd's
  /// supervisor phases, then rosetta's reading phases), its detail kept.
  public static func indexStanding(status: IndexStatusResult) -> IndexStanding {
    let detail = status.daemonDetail.flatMap { $0.isEmpty ? nil : $0 }
    switch status.phase {
    case "starting", "restarting": return .starting(detail: detail)
    case "rebuilding": return .rebuilding(detail: detail)
    case "failed": return .failed(reason: detail ?? "the index failed")
    case "unconfigured": return .unconfigured(reason: detail)
    case "stopped": return .stopped
    default:
      if case .indexing(let percent, let done, let total) = standing(status: status) {
        return .indexing(percent: percent, done: done, total: total)
      }
      return .ready
    }
  }

  /// The index's sentence under the ledger's scope line (and a project's
  /// head), led by its desktop's mark on screen; nil while it is ready.
  public static func indexSentence(_ index: IndexStanding?, desktop: String) -> String? {
    switch index {
    case nil, .ready?: nil
    case .starting?: "History on \(desktop) is opening"
    case .rebuilding?: "History on \(desktop) is updating"
    case .indexing(let percent, _, _)?: "\(desktop) is reading its history · \(percent)%"
    case .failed?: "History on \(desktop) has stopped"
    case .unconfigured?: "\(desktop) keeps no history"
    case .stopped?: "History on \(desktop) is stopped"
    }
  }

  /// What an EMPTY ledger says, in this order: nothing read and no desktop
  /// answering; History not ready, in its own words (never "no project"
  /// while it is not); then its honest emptiness. The device is named
  /// as its platform names it (`DeviceWord`; L4's word pass).
  ///
  /// Item 505 (DESIGN.md §9, IS-282-3 and IS-282-7) — History speaks as History: it opens, updates, reads or has
  /// stopped, and its index is History. fieldd's detail and reason are insides and are not said here.
  public static func emptyLedger(
    standing: DesktopStanding, index: IndexStanding?, desktop: String, device: DeviceWord
  ) -> (title: String, text: String) {
    if !standing.isAwake {
      return (
        "Your projects have not been read yet",
        "Nothing of your history is on \(device.this) yet; your projects arrive when one of your desktops answers."
      )
    }
    switch index {
    case .starting?:
      return ("History on \(desktop) is opening", "Its projects arrive when it is open.")
    case .rebuilding?:
      return ("History on \(desktop) is updating", "Its projects arrive when the update ends.")
    case .indexing(_, let done, let total)?:
      return ("\(desktop) is reading its history", "\(done) of \(total) sessions read; its projects arrive as it reads.")
    case .failed?:
      return (
        "History on \(desktop) has stopped",
        "Nothing new arrives on \(device.this) until it runs again. Try again from History on \(desktop).")
    case .unconfigured?:
      return ("\(desktop) keeps no history", "History is off on \(desktop).")
    case .stopped?:
      return ("History on \(desktop) is stopped", "Its projects arrive when it runs again.")
    case nil, .ready?:
      return (
        "No projects yet",
        "Your desktops have recorded none. Choose whose history they keep on a desktop (Settings → Agents)."
      )
    }
  }

  // History's three missing notes, each where nothing was read for it on this device (L4's word pass, 2026-11-06:
  // HistoryLedgerView said them by hand). The device is named as its platform names it (`DeviceWord`).

  /// A project the ledger does not hold.
  public static func projectNotRead(device: DeviceWord) -> (title: String, text: String) {
    ("This project has not been read here", "Nothing was read for it on \(device.this).")
  }

  /// A session whose desktop does not answer and whose document was never read here.
  public static func sessionNotRead(device: DeviceWord) -> (title: String, text: String) {
    (
      "This session has no document here",
      "Its desktop does not answer, and \(device.this) has not read its turns before."
    )
  }

  /// Item 505 — a project's session list while none has arrived: reading while its desktop answers, else waiting
  /// for it to. Its desktop is named as the person named it.
  public static func projectSessionsNote(awake: Bool, desktop: String) -> (title: String, text: String) {
    awake
      ? ("Reading the sessions…", "They arrive as \(desktop) answers.")
      : ("No sessions read for this project", "They arrive once \(desktop) answers.")
  }

  /// No desktop answers and nothing is cached.
  public static func noDesktopRead(device: DeviceWord) -> (title: String, text: String) {
    (
      "History comes from your desktops",
      "None of them is answering right now, and \(device.this) has read none before. Your projects and sessions "
        + "arrive from the first one that answers."
    )
  }

  // RETIRED 2026-11-13 (item 390): `ledgerScope`, the scope line over the ledger before the desktops' marks (`12
  // projects · 1,405 sessions across 9 agents on`). James removed the line; the root's head says how many projects
  // in its bubble (`rootHead`).

  /// Item 352 — the ledger's last line when the listing went on past the phone's bound of pages.
  public static func cutLedger(_ count: Int, desktop: String) -> String {
    "The \(figure(count)) most recently active projects are listed · \(desktop) holds more"
  }

  /// A project's place as the phone draws it: the folder's name, a branch that
  /// says more than the folder, the last use, and why a launch cannot land.
  public static func place(_ place: ProjectPlace, now: Date) -> HistoryPlace {
    let branch = place.branch.flatMap { $0 == place.name || $0 == "main" || $0 == "master" ? nil : $0 }
    let reason: String? = !place.exists ? "folder gone" : !place.mounted ? "not connected" : nil
    return HistoryPlace(
      ref: place.ref, name: place.name.isEmpty ? "untitled folder" : place.name, branch: branch,
      last: lastWord(place.lastAt, now: now), lastAt: place.lastAt, reason: reason)
  }

  /// A project as a ledger row: its name (a desktop's Home reads `Home`), its
  /// ink, the desktops it lives on as marks in the ledger's order, its places,
  /// the session count as the figure until its figures land (`withFigures`).
  public static func ledgerProject(_ summary: ProjectSummary, desktops: [HistoryDevice], now: Date) -> HistoryProject {
    let order = desktops.map(\.id)
    let devices = summary.devices.sorted { (order.firstIndex(of: $0) ?? .max) < (order.firstIndex(of: $1) ?? .max) }
    let name = summary.name.isEmpty ? "untitled project" : summary.name
    return HistoryProject(
      id: summary.key, name: summary.disambiguation.map { "\(name) · \($0)" } ?? name, seq: 0, path: "",
      missing: summary.allGone, figure: figure(Int(summary.sessions)), unit: "", spend: 0,
      last: lastWord(summary.lastAt, now: now), recencyMinutes: recencyMinutes(summary.lastAt, now: now), agents: [],
      spark: [], ink: summary.ink, devices: devices, places: summary.places.map { place($0, now: now) })
  }

  /// Whether the ledger lists a project: Temporary is a bucket, not a project
  /// (PJ-L4), and a hidden one is the desktop window's to fold (PJ-4 H4).
  public static func listed(_ summary: ProjectSummary) -> Bool {
    summary.bucket == nil && !summary.hidden
  }

  /// A project's sessions under their days, each naming where it ran — its
  /// desktop and its folder's name — and the agent's own id Resume asks by.
  ///
  /// Item 393 — `contribution` is the project's (`project.figures`; none until it is read): a session whose row it
  /// holds wears its figures, in its fields and in its line (`sessionFigures`, `figuresLine`). A session it holds
  /// no row for is as it was.
  public static func projectSessionRows(
    _ rows: [IndexSessionRow], key: String, places: [ProjectPlace], desktops: [HistoryDevice], now: Date,
    contribution: [IndexContribution] = []
  ) -> [HistorySession] {
    let ordered = rows.sorted { (lastAt($0) ?? -1) > (lastAt($1) ?? -1) }
    let held = figuresBySession(contribution)
    var previousDay: String?
    return ordered.map { row in
      let header = (row.startedAt ?? row.activity?.firstAt ?? lastAt(row)).map { dayHeader($0, now: now) } ?? "Undated"
      let day = header == previousDay ? nil : header
      previousDay = header
      let plain = sessionRow(row, projectId: key, day: day, now: now, figures: sessionFigures(row, in: held))
      let folder = row.place.flatMap { ref in places.first { $0.ref == ref }?.name }
      return HistorySession(
        id: plain.id, projectId: key, day: plain.day, title: plain.title, agent: plain.agent, meta: plain.meta,
        branch: "", last: plain.last, tone: plain.tone, device: row.device,
        deviceName: row.device.flatMap { device in desktops.first { $0.id == device }?.name },
        folder: folder, provider: row.provider, nativeSessionId: row.nativeSessionId.isEmpty ? nil : row.nativeSessionId,
        lastAt: plain.lastAt, messages: plain.messages, tokens: plain.tokens, spend: plain.spend)
    }
  }

  /// The sessions that moved within `liveWithinMinutes`, across the projects
  /// read, newest first: a tap opens the document on its own desktop.
  public static func projectLiveRows(_ rows: [(key: String, row: IndexSessionRow)], now: Date) -> [HistoryLive] {
    rows.filter { recencyMinutes($0.row.activity?.lastAt, now: now) < liveWithinMinutes }
      .sorted { (lastAt($0.row) ?? -1) > (lastAt($1.row) ?? -1) }
      .map { key, row in
        HistoryLive(
          id: "live-\(row.device ?? "")-\(row.sessionId)", projectId: key,
          title: row.title ?? row.summary ?? "untitled session", agent: row.provider ?? "agent",
          running: row.summary ?? "active \(lastWord(row.activity?.lastAt, now: now))",
          destination: .session(row.sessionId), device: row.device,
          nativeSessionId: row.nativeSessionId.isEmpty ? nil : row.nativeSessionId)
      }
  }

  /// One desktop's row on a project screen: its places, how many sessions run
  /// there now, and the row's words — `1 working`, `asleep · 2h`, `2 places`.
  public struct DesktopPlaces: Equatable, Sendable {
    public let desktop: String
    public let places: [HistoryPlace]
    public let working: Int
    public let words: String
  }

  /// A project's places by desktop, in the order of the desktops it lives on.
  public static func placesByDesktop(
    _ project: HistoryProject, desktops: [HistoryDevice], live: [HistoryLive]
  ) -> [DesktopPlaces] {
    var order = project.devices
    for place in project.places where !order.contains(place.device) { order.append(place.device) }
    return order.compactMap { id in
      let places = project.places.filter { $0.device == id }
      guard !places.isEmpty else { return nil }
      let working = live.filter { $0.device == id }.count
      let desktop = desktops.first { $0.id == id }
      let words: String =
        if desktop?.asleep == true { "asleep · \(desktop?.since ?? "—")" }
        else if working > 0 { "\(working) working" }
        else { "\(places.count) \(places.count == 1 ? "place" : "places")" }
      return DesktopPlaces(desktop: id, places: places, working: working, words: words)
    }
  }

  /// A project's merged figures (`project.figures`) on its ledger row.
  ///
  /// Item 353 — the door is asked over every recorded day, so one answer carries the lifetime the ledger's figures
  /// sum (`lifetime`) and the window the row and the project's screen have always drawn: the days from
  /// `figureWindowDays` ago, cut here from the same answer (the row's 30-day tokens, its sparkline, the screen's
  /// four numbers and its ribbon are computed over those days alone, as they were when the door was asked for them).
  public static func withFigures(
    _ project: HistoryProject, _ result: ProjectFiguresResult, sessions: [IndexSessionRow], now: Date
  ) -> HistoryProject {
    let first = lastDays(figureWindowDays + 1, now: now).first ?? ""
    let windowed = withFigures(
      project, heatmap: result.heatmap.filter { $0.day >= first }, models: result.models.filter { $0.day >= first },
      contribution: result.contribution, sessions: sessions, now: now)
    return windowed.with(lifetime: lifetime(result))
  }
}

extension FieldHistoryModel {
  /// Item 353 — a project's agents from the count of its top-level sessions by agent, as the desktop's row marks
  /// them: by share, the lead first, at most three, and how many more there are.
  public static func agentShares(counts: [String: Int]) -> (shares: [HistoryAgentShare], more: Int) {
    let total = max(counts.values.reduce(0, +), 1)
    let ranked = counts.sorted { $0.value > $1.value || ($0.value == $1.value && $0.key < $1.key) }
    return (
      ranked.prefix(3).map { HistoryAgentShare($0.key, Int((Double($0.value) / Double(total) * 100).rounded())) },
      max(0, ranked.count - 3)
    )
  }
}

// Item 393 (James, 2026-11-13 23:28:32Z, session qa-01, of a project's page on his phone: "for session entry item,
// they should also show the message count, token count, cost, etc,just like as how desktop session entry is
// designed, align it") — A SESSION ENTRY'S FIGURES. The desktop's entry (rosetta's room, `SessionListItem`) prints
// `N msgs · span · tokens · cost`, and its figures are the session's row in its project's `contribution`
// (`HistoryRoom.tsx`: "Per-session facts (tokens + messages) from every loaded contribution."). The phone reads the
// same rows with `project.figures` and summed them for the project's messages alone; these rules join them to the
// listing.
//
// What the phone holds, and what it does not (DESIGN.md §8 says it): a desktop answers a phone a hundred of a
// project's rows, the heaviest by tokens first. A project of up to a hundred sessions has a row for each; a project
// past a hundred has rows for its hundred heaviest, and the door that would answer the rest is item 398.

extension FieldHistoryModel {
  /// What a session's figures are joined by: the desktop that recorded it and its id there, the listing's own row
  /// identity (`HistoryProjects.sessionKey`). An id alone is not one: each desktop gives its own.
  static func figuresKey(device: String?, sessionId: String) -> String {
    "\(device ?? "")\u{0}\(sessionId)"
  }

  /// A project's `contribution` rows by the session each is of. The door gives one row a conversation, and the
  /// first given for a session stands.
  static func figuresBySession(_ contribution: [IndexContribution]) -> [String: IndexContribution] {
    Dictionary(
      contribution.map { (figuresKey(device: $0.device, sessionId: $0.sessionId), $0) },
      uniquingKeysWith: { first, _ in first })
  }

  /// A session's figures: its row in its project's `contribution`, or nil when the phone holds none for it (a
  /// session past the door's hundred, a subagent's own row, a conversation whose row is another desktop's copy's).
  ///
  /// A row that counts no message while its session is still being read has not landed (the room's `landedFacts`,
  /// `SessionListItem.tsx`: "a cooking session still counting from zero — is not a claim"): nil, where the desktop
  /// shimmers. Read to its end, the index's own zero is a count and is said.
  static func sessionFigures(_ row: IndexSessionRow, in held: [String: IndexContribution]) -> IndexContribution? {
    guard let figures = held[figuresKey(device: row.device, sessionId: row.sessionId)] else { return nil }
    return figures.messages > 0 || row.streamState == "indexed" ? figures : nil
  }

  /// `214 msgs · 3h 12m · 48.2M · $31.40` — the figures of a session's entry, in the desktop's order (the room's
  /// `SessionListItem`: messages, the span, tokens, cost) and in the phone's own words: the count as `figure`
  /// writes it, tokens as `tokensWord`, cost as `spendWord` (`+` on a lower bound, `n/p` with no list price).
  ///
  /// A figure the phone does not hold leaves its place out, and is never a 0 or a dash. Tokens and a cost stand
  /// only where tokens were counted (the room's rule), and a spend that says nothing has no place. nil when the
  /// session has no figure at all: its entry keeps the line it had.
  public static func figuresLine(messages: Int?, span: String?, tokens: Double?, spend: HistorySpend?) -> String? {
    guard messages != nil || tokens != nil || spend != nil else { return nil }
    var parts: [String] = []
    if let messages { parts.append("\(figure(messages)) msgs") }
    if let span { parts.append(span) }
    if let tokens, tokens > 0 {
      let word = tokensWord(tokens)
      parts.append(word.figure + word.unit)
      if let spend, spend.coverage != .none {
        let cost = spendWord(spend)
        parts.append(cost.figure + cost.unit)
      }
    }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }
}

extension HistoryProject {
  /// The same project with its agents counted over the sessions' listing.
  func with(agents: [HistoryAgentShare], more: Int) -> HistoryProject {
    HistoryProject(
      id: id, name: name, seq: seq, path: path, missing: missing, figure: figure, unit: unit, spend: spend, last: last,
      recencyMinutes: recencyMinutes, agents: agents, moreAgents: more, spark: spark, stats: stats, ribbon: ribbon,
      ink: ink, devices: devices, places: places, lifetime: lifetime)
  }

  /// The same project with its lifetime read.
  func with(lifetime: HistoryLifetime?) -> HistoryProject {
    HistoryProject(
      id: id, name: name, seq: seq, path: path, missing: missing, figure: figure, unit: unit, spend: spend, last: last,
      recencyMinutes: recencyMinutes, agents: agents, moreAgents: moreAgents, spark: spark, stats: stats, ribbon: ribbon,
      ink: ink, devices: devices, places: places, lifetime: lifetime)
  }
}
