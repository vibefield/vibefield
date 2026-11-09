import FieldProduct
import Foundation

// MA-6a — the phone's shelf as a value (DESIGN.md §8 "The phone's Apps", MA-D9 A; VF-PM's rulings 2026-11-09 04:46Z):
// Recent, Kept, then the projects as folders, then the apps with no project. RED: the shelf below is empty.

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
  }

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
    recent = []
    kept = []
    folders = []
    noProject = []
    foot = ""
    readingLines = []
    clipped = false
    away = []
  }
}
