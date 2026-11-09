import FieldProduct
import Foundation

// MA-6a — the phone's shelf as a value (DESIGN.md §8 "The phone's Apps", MA-D9 A; VF-PM's rulings 2026-11-09 04:46Z):
// Recent, Kept, then the projects as folders, then the apps with no project. The door has folded already (MA-D4), so
// nothing here folds; a row seen on two pages counts once. An app stands in Recent and in its folder both, as App
// Library's do.

struct AppsShelf: Equatable {
  /// What the door answered, every page walked.
  struct Reading: Equatable {
    let apps: [IndexAppRow]
    let sources: [IndexAppsSource]
    let clipped: Bool
  }

  /// One project's folder.
  struct Folder: Equatable, Identifiable {
    let key: String
    let name: String
    let ink: Int64?
    let apps: [IndexAppRow]

    var id: String { key }

    /// The tile's three large icons, then the cluster of the next four (§8).
    var big: [IndexAppRow] { Array(apps.prefix(AppsShelfChrome.folderBigCount)) }
    var small: [IndexAppRow] {
      Array(apps.dropFirst(AppsShelfChrome.folderBigCount).prefix(AppsShelfChrome.folderSmallCount))
    }
  }

  /// Recent's four across (§8: "the four Recent icons").
  static let recentCount = 4

  /// The newest four by the door, an app opened on this phone heading them.
  let recent: [IndexAppRow]
  /// Empty until `artifact.mark`'s handler lands (3h, DR-2): the door sends no `kept`.
  let kept: [IndexAppRow]
  let folders: [Folder]
  /// Apps with no project, or a project this phone has no name for: the last group.
  let noProject: [IndexAppRow]
  /// §9's foot.
  let foot: String
  /// "‹desktop› is still reading its history", one per desktop, never an empty shelf.
  let readingLines: [String]
  let clipped: Bool
  /// The `appKey`s of apps whose desktop is away: listed and greyed, never dropped (DS-L8).
  let away: Set<String>

  /// - Parameters:
  ///   - projects: project names by key, from `project.list`.
  ///   - opened: fold keys this account opened on this phone, newest first.
  ///   - here: the word for the answering desktop when the roster names none.
  init(reading: Reading, projects: [String: String], opened: [String], here: String) {
    var seen = Set<String>()
    let newest = Self.newestFirst(reading.apps.filter { seen.insert($0.appKey).inserted })
    let sources = reading.sources

    var byProject: [String: [IndexAppRow]] = [:]
    var projectOrder: [String] = []
    var loose: [IndexAppRow] = []
    for app in newest {
      guard let key = app.projectKey, projects[key] != nil else {
        loose.append(app)
        continue
      }
      if byProject[key] == nil { projectOrder.append(key) }
      byProject[key, default: []].append(app)
    }

    recent = Self.recent(newest: newest, opened: opened)
    kept = newest.filter(\.kept)
    folders = projectOrder.map { key in
      let apps = byProject[key] ?? []
      return Folder(key: key, name: projects[key] ?? "", ink: apps.compactMap(\.ink).first, apps: apps)
    }
    noProject = loose
    foot = Self.foot(apps: newest, sources: sources, here: here)
    readingLines = sources.filter { $0.libraryReady == false || MadeAppFacts.selfUnread($0) }.map {
      "\(MadeAppFacts.desktop($0, here: here)) is still reading its history"
    }
    clipped = reading.clipped
    away = Set(newest.filter { MadeAppFacts.away(MadeAppFacts.source(of: $0, in: sources)) }.map(\.appKey))
  }

  /// The last group's head, interim, ‹for James›: §9 has no word for it.
  static let noProjectHead = "No project"
  /// What the shelf says when the walk stopped at the phone's bound, interim, ‹for James›.
  static let clippedLine = "Not every app is shown here"

  /// What a shelf with no apps says. Off is the home's own words (§9); the waiting line and the empty one are interim,
  /// ‹for James›. A library still reading says so per desktop (`readingLines`).
  static func emptyLine(phase: AppsFeed.Phase, here: String) -> String? {
    switch phase {
    case .off: "This phone isn't connected to its home desktop"
    case .unavailable: "Can't reach \(here)"
    case .waiting: "Reading your apps"
    case .live: "Your agents haven't made an app yet"
    case .reading: nil
    }
  }

  /// The shelf's own field: titles that hold the words. Blank words list nothing, and the shelf stands as it was.
  static func matching(_ words: String, in apps: [IndexAppRow]) -> [IndexAppRow] {
    let words = words.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !words.isEmpty else { return [] }
    return apps.filter { $0.title.localizedCaseInsensitiveContains(words) }
  }

  /// Newest first, the door's own order breaking a tie.
  private static func newestFirst(_ apps: [IndexAppRow]) -> [IndexAppRow] {
    apps.enumerated().sorted { first, second in
      let (a, b) = (MadeAppFacts.at(first.element), MadeAppFacts.at(second.element))
      return a != b ? a > b : first.offset < second.offset
    }.map(\.element)
  }

  private static func recent(newest: [IndexAppRow], opened: [String]) -> [IndexAppRow] {
    var byFold: [String: IndexAppRow] = [:]
    for app in newest where byFold[app.foldKey] == nil { byFold[app.foldKey] = app }
    var shown = Set<String>()
    let headed = opened.compactMap { byFold[$0] }.filter { shown.insert($0.appKey).inserted }
    let rest = newest.filter { shown.insert($0.appKey).inserted }
    return Array((headed + rest).prefix(recentCount))
  }

  /// §9: "142 apps on 2 desktops · mini is asleep — 23 of its apps wait for it". The counts are the fold's apps this
  /// phone holds: a source's `rows` counts its desktop's rows before the fold, so a sum would count a shared app twice.
  private static func foot(apps: [IndexAppRow], sources: [IndexAppsSource], here: String) -> String {
    var parts = ["\(counted(apps.count, "app")) on \(counted(sources.count, "desktop"))"]
    for source in sources where source.state == .asleep {
      let waiting = apps.filter { $0.device == source.device }.count
      guard waiting > 0 else { continue }
      let desktop = MadeAppFacts.desktop(source, here: here)
      parts.append("\(desktop) is asleep — \(waiting) of its apps \(waiting == 1 ? "waits" : "wait") for it")
    }
    return parts.joined(separator: " · ")
  }

  private static func counted(_ count: Int, _ noun: String) -> String {
    count == 1 ? "1 \(noun)" : "\(count) \(noun)s"
  }
}
