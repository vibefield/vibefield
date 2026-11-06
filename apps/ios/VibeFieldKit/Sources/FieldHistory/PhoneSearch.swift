import FieldProduct
import Foundation

// SE-2 (track SE; SE-D3, SE-D4 and SE-D5 A, UM-D28 A, ruled 2026-11-06 on the page *The Bands Meter*; DESIGN.md §8
// "The phone's search", §9 "Search's words") — THE PHONE'S SEARCH, PURE. What the glass sheet lists, filters, offers
// and says: Live now over the field's live sessions (the home's cut over the mesh, through FieldHome's adapter from
// `RemoteFieldRow`) joined to their matched lines (`HistoryDesktops.liveLines`), and Everything over History's search
// (`index.search` per desktop, `HistoryHitGroup`) or, before a word, the sessions the phone holds. Transcribed from the
// drawing (`draft/profile-meters/round4/src/p6-psearch.js`: psActive, psChips, psSuggest, psNone, psSheet's foot; its
// rows `p5-peek.js` pkLiveRows / pkPastRows) and the desktop's shipping Peek where the drawing leaves a number
// (`peek-live.ts`, `peek-model.ts`). Every decision is a function of values, and `PhoneSearchTests` reads them; the
// sheet (FieldHome) draws what these return.
//
// The profile is the phone's ONE lens (`ProfileLens`, UM-4's seam): Live now's profile token IS the lens, the desktop
// token is the lens's `desk`, and the profiles named here are the lens's while it offers them (UM-D12: with one
// profile nothing names a profile, so callers hand none). The lens is self-only (the lead's rulings 16 and 17): a
// profile id is the home's, so only the home's runs carry one, and a peer's run leaves Live now under a profile.

public enum PhoneSearch {
  // MARK: - Numbers (each with its reason)

  /// A row's matched lines: the desktop Peek's own (`PEEK_ROW_LINES`).
  public static let rowLines = 3
  /// How many of your latest sessions Everything lists before a word: the desktop Peek's (`PEEK_LATEST_LIMIT`).
  public static let latestLimit = 40
  /// A typed word offers its filter from this many letters (the drawing's `last.length < 2`).
  public static let offerLetters = 2

  // MARK: - The values

  public enum Scope: String, Sendable, CaseIterable {
    case live
    case everything

    public var label: String {
      switch self {
      case .live: "Live now"
      case .everything: "Everything"
      }
    }
  }

  /// A live run's state, as its dot and its word say it: a bare terminal is a shell (`peek-live.ts` `LiveState`).
  public enum LiveState: Sendable, Equatable {
    case blocked
    case working
    case idle
    case shell

    /// The word at a live row's end (§9; `LIVE_STATE_WORDS`).
    public var word: String {
      switch self {
      case .blocked: "waiting"
      case .working: "working"
      case .idle: "idle"
      case .shell: "a shell"
      }
    }

    /// Waiting first, a shell last (`STATE_ORDER`).
    public var rank: Int {
      switch self {
      case .blocked: 0
      case .working: 1
      case .idle: 2
      case .shell: 3
      }
    }
  }

  /// A desktop as search names it: a chip, a token, a row's pill.
  public struct Desk: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    /// `darwin` · `win32` · `linux`, the OS mark's word; nil draws the plain screen
    public let platform: String?
    public let asleep: Bool
    public let isHome: Bool

    public init(id: String, name: String, platform: String?, asleep: Bool, isHome: Bool) {
      self.id = id
      self.name = name
      self.platform = platform
      self.asleep = asleep
      self.isHome = isHome
    }
  }

  /// One live session: a drawn row of the field, as search reads it.
  public struct LiveSession: Equatable, Sendable, Identifiable {
    /// The body's VISUAL id: the card a tap opens on Field.
    public let id: String
    /// The words the row's title says: the body's own detail line (its folder when it says none).
    public let title: String
    /// The folder it runs in, by its name; nil for a shell in no project.
    public let folder: String?
    /// The agent's label, or "shell" for a bare terminal.
    public let agent: String?
    public let state: LiveState
    /// The home's profile it runs under: only on the home's runs (the lens is self-only).
    public let profileSet: String?
    /// The desktop it runs on (its owner), its name and its OS mark's word.
    public let device: String
    public let deviceName: String
    public let platform: String?
    public let isHome: Bool
    /// The agent's own id for the conversation: the join to its matched lines.
    public let nativeSessionId: String?

    public init(
      id: String, title: String, folder: String?, agent: String?, state: LiveState, profileSet: String?,
      device: String, deviceName: String, platform: String?, isHome: Bool, nativeSessionId: String?
    ) {
      self.id = id
      self.title = title
      self.folder = folder
      self.agent = agent
      self.state = state
      self.profileSet = profileSet
      self.device = device
      self.deviceName = deviceName
      self.platform = platform
      self.isHome = isHome
      self.nativeSessionId = nativeSessionId
    }
  }

  /// Live now's world: the field's sessions, the desktops, the profiles search may name and the live ask's lines.
  public struct Live: Equatable, Sendable {
    public var sessions: [LiveSession]
    public var desks: [Desk]
    /// The home's profiles while the lens offers them (`ProfileLens.offersProfiles`); none with one profile (UM-D12).
    public var profiles: [AgentProfileSet]
    /// The lines the live ask matched, by the run's native id (`HistoryDesktops.liveLines`).
    public var lines: [String: [HistoryHit]]

    public init(
      sessions: [LiveSession], desks: [Desk], profiles: [AgentProfileSet], lines: [String: [HistoryHit]] = [:]
    ) {
      self.sessions = sessions
      self.desks = desks
      self.profiles = profiles
      self.lines = lines
    }

    /// The sessions a profile's chip and the lens's menu count: the home's runs under it.
    public func sessions(of profile: String) -> [LiveSession] {
      sessions.filter { $0.isHome && $0.profileSet == profile }
    }

    /// The sessions a desktop's chip counts: the runs it owns.
    public func sessions(on desk: String) -> [LiveSession] { sessions.filter { $0.device == desk } }
  }

  /// A live row: the session, and its matched lines (newest first, at most `rowLines`).
  public struct LiveRow: Equatable, Sendable, Identifiable {
    public let session: LiveSession
    public let lines: [HistoryHit]
    public var id: String { session.id }
  }

  /// A past row: one session, its matched lines under it, and where a tap lands.
  public struct PastRow: Equatable, Sendable, Identifiable {
    /// The desktop whose index (or corpus) holds it, and the session there.
    public let device: String
    public let sessionId: String
    public let title: String
    public let folder: String?
    public let agent: String?
    /// The project a filter narrows by (the PJ key), and its name.
    public let project: Project?
    /// The day it was found on, or how long since it moved ("2h", "yesterday").
    public let when: String
    public let lines: [HistoryHit]
    /// The index's group it came from: a matched line lands at its anchor. nil for a latest session.
    public let group: HistoryHitGroup?

    public var id: String { "\(device)/\(sessionId)" }
  }

  /// A project as Everything's filter names it: its key and its folder's name.
  public struct Project: Equatable, Sendable, Hashable {
    public let key: String
    public let name: String

    public init(key: String, name: String) {
      self.key = key
      self.name = name
    }
  }

  /// One filter: a profile (the lens), a desktop, who said it, or a project.
  public enum Filter: Equatable, Sendable, Hashable {
    case profile(String)
    case desk(String)
    case kind(FieldHistoryModel.SearchKind)
    case project(String)
  }

  /// What leads a chip, a token or an offer: the drawing's glyph, the view's to draw.
  public enum Lead: Equatable, Sendable {
    /// a profile's own glyph word, and whether it is the agents' own folders (This Mac's)
    case profile(glyph: String?, native: Bool)
    /// a desktop's OS mark (`platform`)
    case desk(platform: String?)
    /// who said it (§13's `message`)
    case said
    /// a project (§13's `folder`)
    case folder
  }

  /// A chip under the switch: tapped, it becomes a token.
  public struct Chip: Equatable, Sendable, Identifiable {
    public let filter: Filter
    public let lead: Lead
    public let label: String
    /// its sessions; nil for who said it and a project, which count none
    public let sessions: Int?
    /// a desktop that cannot be asked: "asleep" stands in its count's place
    public let asleep: Bool
    /// a session under it waits on you: the 6 orange dot before its count
    public let waiting: Bool
    public var id: Filter { filter }

    /// What its count says: its sessions ("4"), "asleep", or nothing.
    public var note: String? { asleep ? "asleep" : sessions.map { "\($0)" } }

    /// What VoiceOver says for it (SE-2l, the S2 review's finding 11). STUB (SE-2l red): its name alone.
    public var spoken: String { label }
  }

  /// A token in the field: a chosen filter, its × removes it.
  public struct Token: Equatable, Sendable, Identifiable {
    public let filter: Filter
    public let lead: Lead
    public let label: String
    public var id: Filter { filter }
  }

  /// A typed name's offer at the list's top.
  public struct Offer: Equatable, Sendable {
    public let filter: Filter
    public let lead: Lead
    public let title: String
    public let note: String
  }

  /// An empty list's one way out.
  public enum EmptyAct: Equatable, Sendable {
    /// Clear the filters: the profile and the desktop
    case clearFilters
    /// Search everything: the scope switches
    case searchEverything
  }

  /// An empty list: its sentence, and its act when it has one.
  public struct Empty: Equatable, Sendable {
    public let sentence: String
    public let act: EmptyAct?
  }

  /// SE-2i (the S2 review's finding 4) — where Live now's world stands: the home's board is what runs, so until it
  /// answers nothing may say what runs (§8 "Search — the Peek": "Until it answers the foot says 'Asking what runs…';
  /// refused, 'What runs could not be read — ‹fieldd's words›'").
  public enum Feed: Equatable, Sendable {
    /// the home's board answers: its rows are what runs
    case live
    /// no live board yet: what runs is being asked
    case asking
    /// the home's board refused, in its own words
    case refused(String)
    /// the home is asleep, by its name: what runs is read when it wakes
    case asleep(String)
  }

  /// SE-2i — what the desktops have said of the words typed: never "no matches" for a question nobody answered (§8
  /// "Search — the Peek"). Read only with words; before a word nothing is asked.
  public struct Asked: Equatable, Sendable {
    /// The newest words are out: the pause in typing, or the ask itself.
    public var asking: Bool
    /// Every desktop that could be asked has answered these words (for Everything, at least one could).
    public var answered: Bool
    /// The desktops that cannot be asked now, by name: their part of the answer waits for them.
    public var asleep: [String]

    public init(asking: Bool, answered: Bool, asleep: [String] = []) {
      self.asking = asking
      self.answered = answered
      self.asleep = asleep
    }

    /// Nothing out, every desktop answered, none asleep: a world with nothing left to ask.
    public static let settled = Asked(asking: false, answered: true)
  }

  /// Where a tap (or Return, on the first row) goes.
  public enum OpenTarget: Equatable, Sendable {
    /// a live row: search closes and its body's card opens on Field (by visual id)
    case card(String)
    /// a matched line: History, landed at the line, its stepper holding the words
    case landing(FieldHistoryModel.Landing, query: String)
    /// a latest session: History opens it
    case session(device: String, projectId: String?, id: String)
  }

  // MARK: - Words and matching

  /// The words typed, lowercased: every one must be held.
  public static func words(_ query: String) -> [String] { FieldHistoryModel.terms(query) }

  /// Every word is in `text` (the drawing's `holds`).
  static func holds(_ text: String, _ words: [String]) -> Bool {
    let lower = text.lowercased()
    return words.allSatisfy { lower.contains($0) }
  }

  /// `count` and its noun, made plural past one ("1 session", "2 sessions").
  public static func plural(_ count: Int, _ noun: String) -> String { "\(count) \(noun)\(count == 1 ? "" : "s")" }

  /// The query with its last word dropped: an offer's filter takes the word it was typed as.
  public static func droppingLastWord(_ query: String) -> String {
    var words = query.split(whereSeparator: \.isWhitespace).map(String.init)
    if !words.isEmpty { words.removeLast() }
    return words.joined(separator: " ")
  }

  /// A word starts one of `label`'s words (split on spaces and hyphens), as the drawing's `starts` reads.
  static func starts(_ label: String, with word: String) -> Bool {
    label.lowercased().split(whereSeparator: { $0.isWhitespace || $0 == "-" }).contains { $0.hasPrefix(word) }
  }

  /// The field's placeholder: **Search** (MA-D7's word) with fewer than two tokens, none with two (§8).
  public static func placeholder(tokens: Int) -> String? { tokens >= 2 ? nil : "Search" }

  // MARK: - Live now

  /// The rows, filtered by the lens's profile and desktop: without words every session, waiting first; with words
  /// the sessions whose facts (title, folder, agent) or matched lines hold every word, the most lines first, then
  /// waiting → working → idle → a shell, the field's order breaking the rest (`peekLiveRows`, a stable sort).
  public static func liveRows(_ live: Live, query: String, profile: String?, desk: String?) -> [LiveRow] {
    let terms = words(query)
    var rows: [(row: LiveRow, index: Int)] = []
    for (index, session) in live.sessions.enumerated() {
      if let profile, !(session.isHome && session.profileSet == profile) { continue }
      if let desk, session.device != desk { continue }
      let lines: [HistoryHit] = terms.isEmpty ? [] : session.nativeSessionId.flatMap { live.lines[$0] } ?? []
      if !terms.isEmpty {
        let facts = [session.title, session.folder ?? "", session.agent ?? ""].joined(separator: " ")
        guard !lines.isEmpty || holds(facts, terms) else { continue }
      }
      rows.append((LiveRow(session: session, lines: Array(lines.prefix(rowLines))), index))
    }
    return rows.sorted { left, right in
      if left.row.lines.count != right.row.lines.count { return left.row.lines.count > right.row.lines.count }
      if left.row.session.state.rank != right.row.session.state.rank {
        return left.row.session.state.rank < right.row.session.state.rank
      }
      return left.index < right.index
    }.map { $0.row }
  }

  /// A profile as search names it: the lens's chosen one, from the profiles search may name.
  static func profile(_ id: String?, in live: Live) -> AgentProfileSet? {
    id.flatMap { id in live.profiles.first { $0.id == id } }
  }

  /// What leads a profile wherever search names it: a chip, a token, an offer, a live row's pill.
  public static func lead(_ profile: AgentProfileSet) -> Lead {
    .profile(glyph: profile.glyph, native: profile.kind == "native")
  }

  /// Live now's chips (SE-D5): the profiles, less the one chosen, each with its sessions and the waiting dot; then
  /// the desktops, less the one chosen, each with its sessions or "asleep". Counts are every session's, unfiltered.
  public static func liveChips(_ live: Live, profile: String?, desk: String?) -> [[Chip]] {
    let profiles = live.profiles.filter { $0.id != profile }.map { set in
      let under = live.sessions(of: set.id)
      return Chip(
        filter: .profile(set.id), lead: lead(set), label: set.label, sessions: under.count, asleep: false,
        waiting: under.contains { $0.state == .blocked })
    }
    let desks = live.desks.filter { $0.id != desk }.map { found in
      Chip(
        filter: .desk(found.id), lead: .desk(platform: found.platform), label: found.name,
        sessions: found.asleep ? nil : live.sessions(on: found.id).count, asleep: found.asleep, waiting: false)
    }
    return [profiles, desks].filter { !$0.isEmpty }
  }

  /// Live now's tokens: the profile, then the desktop.
  public static func liveTokens(_ live: Live, profile: String?, desk: String?) -> [Token] {
    var tokens: [Token] = []
    if let set = Self.profile(profile, in: live) {
      tokens.append(Token(filter: .profile(set.id), lead: lead(set), label: set.label))
    }
    if let found = live.desks.first(where: { $0.id == desk }) {
      tokens.append(Token(filter: .desk(found.id), lead: .desk(platform: found.platform), label: found.name))
    }
    return tokens
  }

  /// A typed name's offer in Live now: the first profile with a word starting so, while there are several and none is
  /// chosen; else the first desktop, while none is chosen. From `offerLetters` letters.
  public static func liveOffer(_ live: Live, query: String, profile: String?, desk: String?) -> Offer? {
    guard let last = words(query).last, last.count >= offerLetters else { return nil }
    if profile == nil, let set = live.profiles.first(where: { starts($0.label, with: last) }) {
      return Offer(
        filter: .profile(set.id), lead: lead(set), title: "Show only \(set.label)'s sessions",
        note: "a filter · \(plural(live.sessions(of: set.id).count, "session"))")
    }
    if desk == nil, let found = live.desks.first(where: { starts($0.name, with: last) }) {
      return Offer(
        filter: .desk(found.id), lead: .desk(platform: found.platform), title: "Show only what runs on \(found.name)",
        note: found.asleep ? "a filter · asleep" : "a filter · \(plural(live.sessions(on: found.id).count, "session"))")
    }
    return nil
  }

  /// Live now's foot (§9 "The phone's feet"), honest about its world (§8 "Search — the Peek"): "Asking what runs…"
  /// until the home's board answers, its refusal in its own words, the home asleep by name; with words, the matches
  /// and what is still unanswered (`unanswered`).
  public static func liveFoot(
    _ rows: [LiveRow], total: Int, query: String, narrowed: Bool, feed: Feed, asked: Asked
  ) -> String {
    switch feed {
    case .live: break
    case .asking: return "Asking what runs…"
    case .refused(let reason): return "What runs could not be read — \(reason)"
    case .asleep(let desk): return "\(desk) is asleep"
    }
    if !words(query).isEmpty {
      let lines = rows.reduce(0) { $0 + $1.lines.count }
      return "\(plural(rows.count, "session")) · \(plural(lines, "line")) matched" + unanswered(asked)
    }
    if narrowed { return "\(rows.count) of \(plural(total, "live session")), waiting first" }
    return "\(plural(rows.count, "live session")), waiting first"
  }

  /// What a foot adds with words not answered yet (§8 "Search — the Peek", Live now's foot): " · searching" while the
  /// newest ask is out, " · the words were not searched" once it came back unanswered (the last answer's lines
  /// stand); nothing once every desktop asked has answered.
  static func unanswered(_ asked: Asked) -> String {
    guard !asked.answered else { return "" }
    return asked.asking ? " · searching" : " · the words were not searched"
  }

  /// Live now's empty list (§9 "The phone's empty lists"): a filter and no words, with Clear the filters; words, with
  /// Search everything; else nothing runs. Never a claim nobody answered (§8 "Search — the Peek"): nothing while what
  /// runs is asked or the home sleeps (the foot says which), the refusal's short sentence (`peek-live.ts` `liveNone`),
  /// and no "holds every word" until the words are answered.
  public static func liveEmpty(query: String, profile: String?, desk: String?, feed: Feed, asked: Asked) -> Empty? {
    switch feed {
    case .live: break
    case .asking, .asleep: return nil
    case .refused: return Empty(sentence: "What runs could not be read.", act: nil)
    }
    let words = query.trimmingCharacters(in: .whitespaces)
    if words.isEmpty, profile != nil || desk != nil {
      let under = profile.map { " in \($0)" } ?? ""
      let on = desk.map { "on \($0)" } ?? "right now"
      return Empty(sentence: "No live session\(under) runs \(on).", act: .clearFilters)
    }
    if !words.isEmpty {
      guard asked.answered else { return nil }
      return Empty(sentence: "No live session holds every word of “\(words)”.", act: .searchEverything)
    }
    return Empty(sentence: "Nothing runs right now.", act: nil)
  }

  // MARK: - Everything

  /// A past row's project: the PJ key the index named, else the corpus's own project id (the mock's), named by the
  /// corpus's project, else by the folder.
  static func project(key: String?, folder: String?, in corpus: HistoryCorpus) -> Project? {
    guard let key, !key.isEmpty else { return nil }
    guard let name = corpus.project(key)?.name ?? folder else { return nil }
    return Project(key: key, name: name)
  }

  /// Everything with words: each desktop's answer, the desktops in their order and each answer's own, one row per
  /// session with its matched lines — the kind's lines only, the project's sessions only.
  public static func pastRows(
    _ answers: [(corpus: HistoryCorpus, groups: [HistoryHitGroup])], kind: FieldHistoryModel.SearchKind,
    project: String?, agentLabel: (String) -> String
  ) -> [PastRow] {
    var rows: [PastRow] = []
    for (corpus, groups) in answers {
      for group in groups {
        let lines = group.rows.filter { kind.admitsHit($0.who) }
        guard !lines.isEmpty else { continue }
        let key = group.projectKey ?? (group.projectId.isEmpty ? nil : group.projectId)
        let found = Self.project(key: key, folder: group.folder, in: corpus)
        if let project, found?.key != project { continue }
        rows.append(
          PastRow(
            device: corpus.deviceId, sessionId: group.sessionId, title: group.sessionTitle, folder: group.folder,
            agent: group.provider.map(agentLabel), project: found, when: group.day,
            lines: Array(lines.prefix(rowLines)), group: group.keeping(lines)))
      }
    }
    return rows
  }

  /// Everything before a word: **Your latest sessions** (DESIGN.md §8, PLAN §4 (g)) — the sessions the phone holds
  /// (`HistoryCorpus.sessions`, the ledger's across every desktop), merged by recency: newest first by when each last
  /// moved, a session the index stamped none for after them in the ledger's order; the project's alone while one is
  /// chosen; at most `latestLimit`.
  public static func latestRows(_ corpus: HistoryCorpus, project: String?, agentLabel: (String) -> String) -> [PastRow] {
    var held: [(row: PastRow, lastAt: Int64?, index: Int)] = []
    for found in corpus.projects {
      if let project, found.id != project { continue }
      for session in corpus.sessions(of: found.id) {
        let agent = session.provider ?? session.agent
        let row = PastRow(
          device: session.device ?? corpus.deviceId, sessionId: session.id, title: session.title,
          folder: session.folder ?? found.name, agent: agentLabel(agent),
          project: Project(key: found.id, name: found.name), when: session.last, lines: [], group: nil)
        held.append((row, session.lastAt, held.count))
      }
    }
    let ordered = held.sorted { left, right in
      switch (left.lastAt, right.lastAt) {
      case let (a?, b?) where a != b: return a > b
      case (.some, nil): return true
      case (nil, .some): return false
      default: return left.index < right.index
      }
    }
    return ordered.prefix(latestLimit).map { $0.row }
  }

  /// The projects Everything's rows name, in their order: the chips', and a typed name's offer's.
  public static func projects(_ rows: [PastRow]) -> [Project] {
    var seen: [Project] = []
    for row in rows {
      if let project = row.project, !seen.contains(project) { seen.append(project) }
    }
    return seen
  }

  /// Everything's chips: **Prompts** and **Replies** while every kind is asked for, then the projects, less the one
  /// chosen.
  public static func pastChips(projects: [Project], kind: FieldHistoryModel.SearchKind, project: String?) -> [[Chip]] {
    let kinds: [Chip] =
      kind == .any
      ? [FieldHistoryModel.SearchKind.prompts, .replies].map {
        Chip(filter: .kind($0), lead: .said, label: $0.label, sessions: nil, asleep: false, waiting: false)
      } : []
    let folders = projects.filter { $0.key != project }.map {
      Chip(filter: .project($0.key), lead: .folder, label: $0.name, sessions: nil, asleep: false, waiting: false)
    }
    return [kinds, folders].filter { !$0.isEmpty }
  }

  /// Everything's tokens: who said it, then the project. No profile: Everything looks through every one (UM-D28).
  public static func pastTokens(kind: FieldHistoryModel.SearchKind, project: Project?) -> [Token] {
    var tokens: [Token] = []
    if kind != .any { tokens.append(Token(filter: .kind(kind), lead: .said, label: kind.label)) }
    if let project { tokens.append(Token(filter: .project(project.key), lead: .folder, label: project.name)) }
    return tokens
  }

  /// A typed name's offer in Everything: the first project with a word starting so, while none is chosen.
  public static func pastOffer(query: String, projects: [Project], project: String?) -> Offer? {
    guard project == nil, let last = words(query).last, last.count >= offerLetters,
      let found = projects.first(where: { starts($0.name, with: last) })
    else { return nil }
    return Offer(filter: .project(found.key), lead: .folder, title: "Only in \(found.name)", note: "a filter")
  }

  /// Everything's foot (§9 "The phone's feet"; UM-D28): the sessions matched, or **Your latest sessions**; " in
  /// ‹folder›" while a project is chosen; with words and a kind, ", in your prompts" or ", in their replies"; and
  /// while the lens stands, " · every profile; ‹profile› comes back on Field". With words it is honest as Live now's
  /// is: what is still unanswered (`unanswered`), then each desktop that could not be asked, " · ‹desktop› is asleep"
  /// (History's search said "‹desktop› is asleep" for one; the list keeps what the cache matched).
  public static func pastFoot(
    rows: Int, query: String, project: Project?, kind: FieldHistoryModel.SearchKind, lens: String?, asked: Asked
  ) -> String {
    let typed = !words(query).isEmpty
    var foot = typed ? "\(plural(rows, "session")) matched" : "Your latest sessions"
    if let project { foot += " in \(project.name)" }
    if typed {
      switch kind {
      case .prompts: foot += ", in your prompts"
      case .replies: foot += ", in their replies"
      case .any: break
      }
      foot += unanswered(asked)
      for desk in asked.asleep { foot += " · \(desk) is asleep" }
    }
    if let lens { foot += " · every profile; \(lens) comes back on Field" }
    return foot
  }

  /// Everything's empty list with words, only once they are answered: never "no matches" for a question nobody
  /// answered (§8 "Search — the Peek"; the foot says why). Before a word its words are James's (§9), so none is said
  /// here.
  public static func pastEmpty(query: String, asked: Asked) -> Empty? {
    let words = query.trimmingCharacters(in: .whitespaces)
    guard !words.isEmpty, asked.answered else { return nil }
    return Empty(sentence: "Nothing in your past holds every word of “\(words)”. Try fewer words.", act: nil)
  }

  // MARK: - Where a tap goes

  /// A live row: its body's card on Field.
  public static func target(_ row: LiveRow) -> OpenTarget { .card(row.session.id) }

  /// A past row: History at its first matched line (the corpus that holds it decides the landing, as History's own
  /// search's did), or, for a latest session, the session itself.
  public static func target(_ row: PastRow, corpus: HistoryCorpus, query: String) -> OpenTarget {
    guard let group = row.group, let line = group.rows.first else {
      return .session(device: row.device, projectId: row.project?.key, id: row.sessionId)
    }
    return .landing(
      FieldHistoryModel.landing(for: line, in: group, corpus: corpus),
      query: query.trimmingCharacters(in: .whitespaces))
  }
}
