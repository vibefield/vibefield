import FieldAgents
import FieldHistory
import FieldMesh
import FieldProduct
import Foundation

/// SE-2 — search's own state while the sheet stands: the scope (it opens on Live now, every time), and Everything's
/// kind and project. The profile and the desktop are the lens's (`ProfileLens`), never search's own.
struct SearchState: Equatable {
  var scope: PhoneSearch.Scope = .live
  var kind: FieldHistoryModel.SearchKind = .any
  var project: PhoneSearch.Project?
}

/// SE-2 (SE-D2, SE-D4, SE-D5 A, UM-D28 A; DESIGN.md §8 "The phone's search") — THE HOME'S WORLD AS SEARCH READS IT:
/// the window's drawn rows (`FieldLink.rows`, the home's cut over the mesh) as Live now's sessions, the desktops it
/// names, the lens's profiles while it offers them, the live ask's runs, and the sheet's content composed by
/// `PhoneSearch`'s decisions. What a chip, a token's ×, an offer and an empty list's act change is here too, so
/// HomeScreen only routes. `PhoneSearchWorldTests` reads every one.
enum PhoneSearchWorld {
  /// One drawn row as search reads it: its body's visual id (the card a tap opens), its title (the body's own line as
  /// the home says it — a peer's desktop is its pill's, never its title's; the folder when it says none), its folder,
  /// its agent ("shell" for a bare terminal), its state, the home's profile only on the home's runs (the lens is
  /// self-only), where it runs, and its conversation's native id (the live ask's join).
  static func session(_ row: RemoteFieldRow, desks: [PhoneSearch.Desk]) -> PhoneSearch.LiveSession {
    let monitor = row.row.monitor
    let line = MonitorWords.detailLine(monitor, isSelf: true)
    let terminal = monitor.kind == .terminal
    let label = monitor.provider?.label ?? ""
    let named = desks.first { $0.id == row.device }
    return PhoneSearch.LiveSession(
      id: row.visualId, title: line.isEmpty ? MonitorWords.projectName(monitor) : line,
      folder: monitor.project.name.isEmpty ? nil : monitor.project.name,
      agent: terminal ? "shell" : label.isEmpty ? nil : label, state: terminal ? .shell : Self.state(monitor.status),
      profileSet: row.isSelf ? monitor.profileSet : nil, device: row.device, deviceName: monitor.device.name,
      platform: named?.platform ?? Self.platform(monitor.device.os), isHome: row.isSelf,
      nativeSessionId: row.board.nativeSessionId)
  }

  /// An agent's state as its dot and its word say it.
  static func state(_ status: MonitorRowStatus) -> PhoneSearch.LiveState {
    switch status {
    case .blocked: .blocked
    case .working: .working
    case .idle: .idle
    }
  }

  /// The OS mark's word for a desktop the roster does not name (`DeviceMark.OS(platform:)` reads it).
  static func platform(_ os: MonitorDeviceOS?) -> String? {
    switch os {
    case .mac: "macos"
    case .windows: "windows"
    case .linux: "linux"
    case .ios, .android, .unrecognized, nil: nil
    }
  }

  /// The desktops search names: the link's roster, in its order, asleep while its door does not answer.
  static func desks(_ desktops: [FieldDesktop], home: String?) -> [PhoneSearch.Desk] {
    desktops.map { desktop in
      PhoneSearch.Desk(
        id: desktop.deviceId, name: desktop.name, platform: desktop.platform, asleep: desktop.state != .ready,
        isHome: desktop.deviceId == home)
    }
  }

  /// The desktops the rows run on, in the rows' order: a world with no roster (the mock's). A peer whose every row
  /// greys is asleep (a peer's `stale` is its desktop's standing).
  static func desks(rows: [RemoteFieldRow]) -> [PhoneSearch.Desk] {
    var desks: [PhoneSearch.Desk] = []
    for row in rows where !desks.contains(where: { $0.id == row.device }) {
      let mine = rows.filter { $0.device == row.device }
      let device = row.row.monitor.device
      desks.append(
        PhoneSearch.Desk(
          id: row.device, name: device.name, platform: Self.platform(device.os),
          asleep: !row.isSelf && mine.allSatisfy { $0.stale }, isHome: row.isSelf))
    }
    return desks
  }

  /// Live now's world: the drawn rows as sessions, the desktops, the lens's profiles while it offers them (UM-D12),
  /// and the live ask's lines.
  static func live(
    rows: [RemoteFieldRow], desks: [PhoneSearch.Desk], lens: ProfileLens, lines: [String: [HistoryHit]]
  ) -> PhoneSearch.Live {
    PhoneSearch.Live(
      sessions: rows.map { session($0, desks: desks) }, desks: desks,
      profiles: lens.offersProfiles ? lens.profiles : [], lines: lines)
  }

  /// The live ask (`HistoryDesktops.searchLive`): each desktop's runs that hold a conversation, by its native id.
  static func runs(_ live: PhoneSearch.Live) -> [String: [String]] {
    var runs: [String: [String]] = [:]
    for session in live.sessions {
      guard let id = session.nativeSessionId else { continue }
      runs[session.device, default: []].append(id)
    }
    return runs
  }

  /// SE-2l (the S2 review's finding 7) — an agent as Everything's rows name it ("folder · agent", §8): the catalog's
  /// label (AC-D4; `FieldLink.catalog`, every desktop's answer merged), and its id while no catalog names it (the
  /// tolerant reader, R4: an older desktop, a newer peer's agent).
  static func agentLabel(_ catalog: AgentCatalog) -> (String) -> String {
    { provider in catalog.entry(for: AgentProvider(rawValue: provider))?.label ?? provider }
  }

  // MARK: - SE-2i: what was answered (the S2 review's finding 4)

  /// One desktop as search's answer state reads it: its name, whether it can be asked now (its door answers),
  /// whether it has a door to ask at all (one with none, the mock's corpus, is matched on the phone, so it has always
  /// answered), and the words its index last answered for the scope.
  struct Answerer: Equatable {
    var name: String
    var awake: Bool
    var asks: Bool
    var answered: String?
  }

  /// Live now's world as it stands: the home's live board (`FieldLink.fieldIsLive`); else the home's refusal of its
  /// board in its own words (`fieldRefusal`, or its door's), the home asleep by its name while nothing answers at its
  /// door, or asking while it connects (and while there is no home yet).
  static func feed(isLive: Bool, home: FieldDesktop?) -> PhoneSearch.Feed {
    if isLive { return .live }
    guard let home else { return .asking }
    if let refusal = home.fieldRefusal { return .refused(refusal) }
    switch home.state {
    case .failed(let reason), .refusedDoor(let reason): return .refused(reason)
    case .noDoor: return .asleep(home.name)
    case .connecting, .ready, .reconnecting: return .asking
    }
  }

  /// Everything's answer to `query`: answered when every desktop awake answered these words and at least one is
  /// awake (none awake, nobody could answer); a desktop with no door is matched on the phone; the asleep, by name.
  static func pastAsked(_ answerers: [Answerer], query: String, asking: Bool) -> PhoneSearch.Asked {
    let words = query.trimmingCharacters(in: .whitespaces)
    let awake = answerers.filter { $0.awake }
    return PhoneSearch.Asked(
      asking: asking, answered: !awake.isEmpty && awake.allSatisfy { !$0.asks || $0.answered == words },
      asleep: answerers.filter { !$0.awake }.map { $0.name })
  }

  /// Live now's answer to `query`: answered when every desktop awake that it asks answered these words. With none to
  /// ask, the runs match on their facts alone, which is the whole answer; an asleep desktop is not asked (its runs
  /// match on their facts, and its chip says it sleeps).
  static func liveAsked(_ answerers: [Answerer], query: String, asking: Bool) -> PhoneSearch.Asked {
    let words = query.trimmingCharacters(in: .whitespaces)
    return PhoneSearch.Asked(
      asking: asking, answered: answerers.allSatisfy { !$0.awake || !$0.asks || $0.answered == words })
  }

  /// Every desktop as Everything's answer reads it: awake while its standing is, asked while it has a door that
  /// answers (`isReplaying` is false), and the words its index last answered for the kind asked
  /// (`HistoryDesktopReader.answered(kind:)`, SE-2j: Prompts' answer never answers every kind).
  @MainActor static func pastAnswerers(
    _ readers: [HistoryDesktopReader], kind: FieldHistoryModel.SearchKind
  ) -> [Answerer] {
    readers.map { reader in
      Answerer(
        name: reader.name, awake: reader.standing.isAwake, asks: !reader.isReplaying,
        answered: reader.answered(kind: kind))
    }
  }

  /// The desktops Live now asks — those that own a run with a conversation (`runs`, `HistoryDesktops.searchLive`'s
  /// own rule) — with the words their index last answered over those runs (`live.query`).
  @MainActor static func liveAnswerers(_ readers: [HistoryDesktopReader], runs: [String: [String]]) -> [Answerer] {
    readers.filter { !(runs[$0.deviceId] ?? []).isEmpty }.map { reader in
      Answerer(
        name: reader.name, awake: reader.standing.isAwake, asks: !reader.isReplaying, answered: reader.live?.query)
    }
  }

  /// The sheet's content. Live now: the lens's profile and desktop narrow the rows and stand as tokens. Everything:
  /// no profile (UM-D28), the kind and the project as tokens, each desktop's answer with words and the ledger's
  /// latest sessions before one. `feed` is Live now's world as it stands, `asked` the scope's answer to the words:
  /// together they keep every foot and empty list honest (SE-2i).
  static func content(
    _ state: SearchState, query: String, lens: ProfileLens, live: PhoneSearch.Live,
    answers: [(corpus: HistoryCorpus, groups: [HistoryHitGroup])], latest: HistoryCorpus?,
    agentLabel: (String) -> String, feed: PhoneSearch.Feed, asked: PhoneSearch.Asked
  ) -> SearchSheetContent {
    let terms = PhoneSearch.words(query)
    switch state.scope {
    case .live:
      let profile = lens.chosen?.id
      let desk = lens.desk
      let rows = PhoneSearch.liveRows(live, query: query, profile: profile, desk: desk)
      let deskName = desk.flatMap { id in live.desks.first { $0.id == id }?.name }
      return SearchSheetContent(
        scope: .live, terms: terms, tokens: PhoneSearch.liveTokens(live, profile: profile, desk: desk),
        chips: PhoneSearch.liveChips(live, profile: profile, desk: desk),
        offer: PhoneSearch.liveOffer(live, query: query, profile: profile, desk: desk), rows: .live(rows),
        empty: rows.isEmpty
          ? PhoneSearch.liveEmpty(
            query: query, profile: lens.chosen?.label, desk: deskName ?? desk, feed: feed, asked: asked) : nil,
        foot: PhoneSearch.liveFoot(
          rows, total: live.sessions.count, query: query, narrowed: profile != nil || desk != nil, feed: feed,
          asked: asked),
        profiles: live.profiles)
    case .everything:
      let key = state.project?.key
      let rows =
        terms.isEmpty
        ? latest.map { PhoneSearch.latestRows($0, project: key, agentLabel: agentLabel) } ?? []
        : PhoneSearch.pastRows(answers, kind: state.kind, project: key, agentLabel: agentLabel)
      let projects = PhoneSearch.projects(rows)
      return SearchSheetContent(
        scope: .everything, terms: terms, tokens: PhoneSearch.pastTokens(kind: state.kind, project: state.project),
        chips: PhoneSearch.pastChips(projects: projects, kind: state.kind, project: key),
        offer: PhoneSearch.pastOffer(query: query, projects: projects, project: key), rows: .past(rows),
        empty: rows.isEmpty ? PhoneSearch.pastEmpty(query: query, asked: asked) : nil,
        foot: PhoneSearch.pastFoot(
          rows: rows.count, query: query, project: state.project, kind: state.kind, lens: lens.chosen?.label,
          asked: asked),
        profiles: [])
    }
  }

  /// A chip, or an offer's Filter: the profile and the desktop are the lens's, the kind and the project search's.
  /// `label` is the name the chip or the offer said, which a project's token keeps.
  static func apply(_ filter: PhoneSearch.Filter, label: String, state: inout SearchState, lens: inout ProfileLens) {
    switch filter {
    case .profile(let id): lens.show(id)
    case .desk(let id): lens.keep(desk: id)
    case .kind(let kind): state.kind = kind
    case .project(let key): state.project = PhoneSearch.Project(key: key, name: label)
    }
  }

  /// A token's ×: its filter goes; the profile's goes from the field too (one lens).
  static func remove(_ filter: PhoneSearch.Filter, state: inout SearchState, lens: inout ProfileLens) {
    switch filter {
    case .profile: lens.show(nil)
    case .desk: lens.keep(desk: nil)
    case .kind: state.kind = .any
    case .project: state.project = nil
    }
  }

  /// An empty list's one way out: Clear the filters (the profile and the desktop), or Search everything.
  static func act(_ act: PhoneSearch.EmptyAct, state: inout SearchState, lens: inout ProfileLens) {
    switch act {
    case .clearFilters:
      lens.show(nil)
      lens.keep(desk: nil)
    case .searchEverything:
      state.scope = .everything
    }
  }

  /// The mock's doors (`-vf-mock`, DEBUG): `-vf-mock-lens=<profile>` chooses a profile, `-vf-mock-search-scope=
  /// everything` opens on Everything, `-vf-mock-search-filter=desk:<device>` keeps search to a desktop. A word it
  /// does not know is no door.
  struct Doors: Equatable {
    var lens: String?
    var scope: PhoneSearch.Scope?
    var desk: String?

    static func read(_ arguments: [String]) -> Doors {
      func value(_ prefix: String) -> String? {
        arguments.first { $0.hasPrefix(prefix) }.map { String($0.dropFirst(prefix.count)) }
      }
      let filter = value("-vf-mock-search-filter=")
      return Doors(
        lens: value("-vf-mock-lens="),
        scope: value("-vf-mock-search-scope=").flatMap { word in
          PhoneSearch.Scope.allCases.first { $0.rawValue == word }
        },
        desk: filter.flatMap { $0.hasPrefix("desk:") ? String($0.dropFirst("desk:".count)) : nil })
    }
  }
}
