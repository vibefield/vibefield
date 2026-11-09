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

    /// RED: stubs.
    var big: [IndexAppRow] { [] }
    var small: [IndexAppRow] { [] }
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

  /// RED: a stub.
  static func emptyLine(phase: AppsFeed.Phase, here: String) -> String? { nil }

  /// RED: a stub.
  static func matching(_ words: String, in apps: [IndexAppRow]) -> [IndexAppRow] { [] }

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
