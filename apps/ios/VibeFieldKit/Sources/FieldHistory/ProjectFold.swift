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
    case .starting?: "\(desktop)'s index is starting"
    case .rebuilding?: "\(desktop) is rebuilding its index"
    case .indexing(let percent, _, _)?: "\(desktop) is indexing · \(percent)%"
    case .failed?: "\(desktop)'s index has stopped"
    case .unconfigured?: "\(desktop) runs no history index"
    case .stopped?: "\(desktop)'s index is stopped"
    }
  }

  /// What an EMPTY ledger says, in this order: nothing read and no door
  /// answering; the index not ready, in its own words (never "no project"
  /// while it is not); then the index's honest emptiness.
  public static func emptyLedger(
    standing: DesktopStanding, index: IndexStanding?, desktop: String
  ) -> (title: String, text: String) {
    if !standing.isAwake {
      return (
        "Your projects have not been read yet",
        "Nothing of your history is on this phone; the ledger arrives when a desktop's door answers."
      )
    }
    switch index {
    case .starting(let detail)?:
      return (
        "\(desktop)'s index is starting",
        detail.map { "Its projects arrive when it is ready. \(sentence($0))" }
          ?? "Its projects arrive when it is ready.")
    case .rebuilding(let detail)?:
      return (
        "\(desktop) is rebuilding its index",
        "\(desktop)'s VibeField reads history in a newer form, so it is rebuilding its index from what it recorded; its projects arrive when that ends."
          + (detail.map { " \(sentence($0))" } ?? ""))
    case .indexing(_, let done, let total)?:
      return ("\(desktop) is reading its history", "\(done) of \(total) sessions read; its projects arrive as it reads.")
    case .failed(let reason)?:
      return (
        "\(desktop)'s index has stopped",
        "\(sentence(reason)) History on this phone reads nothing from it until it runs again; its restart is in History on \(desktop).")
    case .unconfigured(let reason)?:
      return ("\(desktop) runs no history index", reason.map(sentence) ?? "Its desktop was started without one.")
    case .stopped?:
      return ("\(desktop)'s index is stopped", "Its projects arrive when it runs again.")
    case nil, .ready?:
      return (
        "No project in your desktops' index yet",
        "The index lists no project. Choose whose history it reads on a desktop (Settings → Agents)."
      )
    }
  }

  /// fieldd's words as a sentence: the first letter up, a full stop at the end.
  static func sentence(_ words: String) -> String {
    let trimmed = words.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let first = trimmed.first else { return trimmed }
    let capitalized = first.uppercased() + trimmed.dropFirst()
    return capitalized.hasSuffix(".") ? capitalized : capitalized + "."
  }

  /// The scope line over the ledger, before the desktops' marks: `12 projects
  /// · 1,405 sessions across 9 agents on`.
  public static func ledgerScope(_ corpus: HistoryCorpus) -> String {
    let base = "\(corpus.projects.count) projects · \(figure(corpus.sessionCount)) sessions across \(corpus.agentCount) agents"
    return corpus.desktops.isEmpty ? base : "\(base) on"
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
  public static func projectSessionRows(
    _ rows: [IndexSessionRow], key: String, places: [ProjectPlace], desktops: [HistoryDevice], now: Date
  ) -> [HistorySession] {
    let ordered = rows.sorted { (lastAt($0) ?? -1) > (lastAt($1) ?? -1) }
    var previousDay: String?
    return ordered.map { row in
      let header = (row.startedAt ?? row.activity?.firstAt ?? lastAt(row)).map { dayHeader($0, now: now) } ?? "Undated"
      let day = header == previousDay ? nil : header
      previousDay = header
      let plain = sessionRow(row, projectId: key, day: day, now: now)
      let folder = row.place.flatMap { ref in places.first { $0.ref == ref }?.name }
      return HistorySession(
        id: plain.id, projectId: key, day: plain.day, title: plain.title, agent: plain.agent, meta: plain.meta,
        branch: "", last: plain.last, tone: plain.tone, device: row.device,
        deviceName: row.device.flatMap { device in desktops.first { $0.id == device }?.name },
        folder: folder, provider: row.provider, nativeSessionId: row.nativeSessionId.isEmpty ? nil : row.nativeSessionId)
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
  public static func withFigures(
    _ project: HistoryProject, _ result: ProjectFiguresResult, sessions: [IndexSessionRow], now: Date
  ) -> HistoryProject {
    withFigures(
      project, heatmap: result.heatmap, models: result.models, contribution: result.contribution, sessions: sessions,
      now: now)
  }
}
