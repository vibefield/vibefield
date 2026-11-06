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
  // SE-P2 (red): the values are whole; every decision below is a STUB that lists, offers and says nothing.

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
    public func sessions(of profile: String) -> [LiveSession] { [] }

    /// The sessions a desktop's chip counts: the runs it owns.
    public func sessions(on desk: String) -> [LiveSession] { [] }
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
    /// its sessions ("4"), "asleep", or nothing (who said it, a project)
    public let note: String?
    /// a session under it waits on you: the 6 orange dot before its count
    public let waiting: Bool
    public var id: Filter { filter }
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
  static func plural(_ count: Int, _ noun: String) -> String { "\(count) \(noun)\(count == 1 ? "" : "s")" }

  /// The query with its last word dropped: an offer's filter takes the word it was typed as.
  public static func droppingLastWord(_ query: String) -> String { query }

  /// A word starts one of `label`'s words (split on spaces and hyphens), as the drawing's `starts` reads.
  static func starts(_ label: String, with word: String) -> Bool {
    label.lowercased().split(whereSeparator: { $0.isWhitespace || $0 == "-" }).contains { $0.hasPrefix(word) }
  }

  /// The field's placeholder: **Search** (MA-D7's word) with fewer than two tokens, none with two (§8).
  public static func placeholder(tokens: Int) -> String? { nil }

  // MARK: - Live now

  /// The rows, filtered by the lens's profile and desktop: without words every session, waiting first; with words
  /// the sessions whose facts (title, folder, agent) or matched lines hold every word, the most lines first, then
  /// waiting → working → idle → a shell, the field's order breaking the rest (`peekLiveRows`, a stable sort).
  public static func liveRows(_ live: Live, query: String, profile: String?, desk: String?) -> [LiveRow] { [] }

  /// A profile as search names it: the lens's chosen one, from the profiles search may name.
  static func profile(_ id: String?, in live: Live) -> AgentProfileSet? {
    id.flatMap { id in live.profiles.first { $0.id == id } }
  }

  static func lead(_ profile: AgentProfileSet) -> Lead { .profile(glyph: profile.glyph, native: profile.kind == "native") }

  /// Live now's chips (SE-D5): the profiles, less the one chosen, each with its sessions and the waiting dot; then
  /// the desktops, less the one chosen, each with its sessions or "asleep". Counts are every session's, unfiltered.
  public static func liveChips(_ live: Live, profile: String?, desk: String?) -> [[Chip]] { [] }

  /// Live now's tokens: the profile, then the desktop.
  public static func liveTokens(_ live: Live, profile: String?, desk: String?) -> [Token] { [] }

  /// A typed name's offer in Live now: the first profile with a word starting so, while there are several and none is
  /// chosen; else the first desktop, while none is chosen. From `offerLetters` letters.
  public static func liveOffer(_ live: Live, query: String, profile: String?, desk: String?) -> Offer? { nil }

  /// Live now's foot (§9 "The phone's feet").
  public static func liveFoot(_ rows: [LiveRow], total: Int, query: String, narrowed: Bool) -> String { "" }

  /// Live now's empty list (§9 "The phone's empty lists"): a filter and no words, with Clear the filters; words, with
  /// Search everything; else nothing runs.
  public static func liveEmpty(query: String, profile: String?, desk: String?) -> Empty { Empty(sentence: "", act: nil) }

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
  ) -> [PastRow] { [] }

  /// Everything before a word: **Your latest sessions** (DESIGN.md §8, PLAN §4 (g)) — the sessions the phone holds
  /// (`HistoryCorpus.sessions`, the ledger's across every desktop), merged by recency: newest first by when each last
  /// moved, a session the index stamped none for after them in the ledger's order; the project's alone while one is
  /// chosen; at most `latestLimit`.
  public static func latestRows(_ corpus: HistoryCorpus, project: String?, agentLabel: (String) -> String) -> [PastRow] { [] }

  /// The projects Everything's rows name, in their order: the chips', and a typed name's offer's.
  public static func projects(_ rows: [PastRow]) -> [Project] { [] }

  /// Everything's chips: **Prompts** and **Replies** while every kind is asked for, then the projects, less the one
  /// chosen.
  public static func pastChips(projects: [Project], kind: FieldHistoryModel.SearchKind, project: String?) -> [[Chip]] { [] }

  /// Everything's tokens: who said it, then the project. No profile: Everything looks through every one (UM-D28).
  public static func pastTokens(kind: FieldHistoryModel.SearchKind, project: Project?) -> [Token] { [] }

  /// A typed name's offer in Everything: the first project with a word starting so, while none is chosen.
  public static func pastOffer(query: String, projects: [Project], project: String?) -> Offer? { nil }

  /// Everything's foot (§9 "The phone's feet"; UM-D28): the sessions matched, or **Your latest sessions**; " in
  /// ‹folder›" while a project is chosen; with words and a kind, ", in your prompts" or ", in their replies"; and
  /// while the lens stands, " · every profile; ‹profile› comes back on Field".
  public static func pastFoot(
    rows: Int, query: String, project: Project?, kind: FieldHistoryModel.SearchKind, lens: String?
  ) -> String { "" }

  /// Everything's empty list with words; before a word its words are James's (§9), so none is said here.
  public static func pastEmpty(query: String) -> Empty? { nil }

  // MARK: - Where a tap goes

  /// A live row: its body's card on Field.
  public static func target(_ row: LiveRow) -> OpenTarget { .card("") }

  /// A past row: History at its first matched line (the corpus that holds it decides the landing, as History's own
  /// search's did), or, for a latest session, the session itself.
  public static func target(_ row: PastRow, corpus: HistoryCorpus, query: String) -> OpenTarget { .session(device: "", projectId: nil, id: "") }
}
