import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// MA-6a — the phone's shelf (DESIGN.md §8 "The phone's Apps", MA-D9 A; VF-PM's rulings Q2, Q3 and Q6, 2026-11-09):
/// Recent, Kept, the project folders and the last group, from what the door answered. The door has folded already, so
/// nothing here folds. The grouping has no owner in field-app (the desk groups by day), so these rows are its witness.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("MA-6a — the shelf: Recent, Kept, the folders, the foot")
struct AppsShelfTests {
  private static let projects = ["p-a": "Alpha", "p-b": "Beta"]

  private static func row(
    _ name: String, at: Int64, device: String = "desk", projectKey: String? = nil, ink: Int64? = nil,
    kept: Bool = false, foldKey: String? = nil
  ) throws -> IndexAppRow {
    var fields: [String: JSONValue] = [
      "appKey": .string("\(device):\(name)"),
      "foldKey": .string(foldKey ?? "app:\(name)"),
      "device": .string(device),
      "appId": .string(name),
      "devices": .array([.string(device)]),
      "presentationId": .string("p-\(name)"),
      "title": .string(name),
      "filename": .string("\(name).html"),
      "sessionId": .string("s-\(name)"),
      "timelineId": .string("t-\(name)"),
      "versions": .int(1),
      "publishedAt": .int(at),
      "availability": .string("captured"),
      "openable": .bool(true),
    ]
    if let projectKey { fields["projectKey"] = .string(projectKey) }
    if let ink { fields["ink"] = .int(ink) }
    if kept { fields["kept"] = .bool(true) }
    return try IndexAppRow(json: .object(fields))
  }

  private static func source(
    _ device: String = "desk", name: String = "studio", state: String = "live", rows: Int64 = 0, isSelf: Bool = true,
    libraryReady: Bool? = true
  ) throws -> IndexAppsSource {
    var fields: [String: JSONValue] = [
      "device": .string(device),
      "name": .string(name),
      "self": .bool(isSelf),
      "state": .string(state),
      "rows": .int(rows),
    ]
    if let libraryReady { fields["libraryReady"] = .bool(libraryReady) }
    return try IndexAppsSource(json: .object(fields))
  }

  private static func shelf(
    _ apps: [IndexAppRow], sources: [IndexAppsSource]? = nil, opened: [String] = []
  ) throws -> AppsShelf {
    AppsShelf(
      reading: .init(apps: apps, sources: try sources ?? [source()], clipped: false),
      projects: projects, opened: opened, here: "This desktop")
  }

  @Test("Recent is the newest four, the door's order breaking a tie")
  func recentNewestFour() throws {
    let shelf = try Self.shelf([
      try Self.row("old", at: 100),
      try Self.row("tie-first", at: 500),
      try Self.row("tie-second", at: 500),
      try Self.row("newest", at: 900),
      try Self.row("older", at: 300),
      try Self.row("oldest", at: 50),
    ])
    let titles = shelf.recent.map(\.title)
    #expect(titles == ["newest", "tie-first", "tie-second", "older"])
  }

  @Test("an app opened on this phone heads Recent, capped at four; a fold key no row holds is passed over")
  func openedHeadsRecent() throws {
    let shelf = try Self.shelf(
      [
        try Self.row("a", at: 900),
        try Self.row("b", at: 800),
        try Self.row("c", at: 700),
        try Self.row("d", at: 600),
        try Self.row("e", at: 500),
      ],
      opened: ["app:e", "app:gone", "app:c"])
    let titles = shelf.recent.map(\.title)
    #expect(titles == ["e", "c", "a", "b"])
  }

  @Test("Kept holds only the kept apps, and is absent when none is")
  func keptHoldsOnlyKept() throws {
    let some = try Self.shelf([
      try Self.row("plain", at: 900),
      try Self.row("kept", at: 800, kept: true),
    ])
    let keptTitles = some.kept.map(\.title)
    #expect(keptTitles == ["kept"])
    let none = try Self.shelf([try Self.row("plain", at: 900)])
    #expect(none.kept.isEmpty)
    let recentTitles = none.recent.map(\.title)
    #expect(recentTitles == ["plain"])
  }

  @Test("the folders: by project, the newest project first, each named and inked, its apps newest first")
  func folders() throws {
    let shelf = try Self.shelf([
      try Self.row("a-old", at: 100, projectKey: "p-a", ink: 1),
      try Self.row("b-new", at: 900, projectKey: "p-b", ink: 2),
      try Self.row("a-new", at: 500, projectKey: "p-a", ink: 1),
    ])
    let keys = shelf.folders.map(\.key)
    #expect(keys == ["p-b", "p-a"])
    let alpha = try #require(shelf.folders.last)
    #expect(alpha.name == "Alpha")
    #expect(alpha.ink == 1)
    let titles = alpha.apps.map(\.title)
    #expect(titles == ["a-new", "a-old"])
  }

  @Test("an app with no project, or a project with no name here, stands in the last group")
  func noProject() throws {
    let shelf = try Self.shelf([
      try Self.row("loose", at: 900),
      try Self.row("nameless", at: 800, projectKey: "p-unlisted"),
      try Self.row("filed", at: 700, projectKey: "p-a"),
    ])
    let titles = shelf.noProject.map(\.title)
    #expect(titles == ["loose", "nameless"])
    let keys = shelf.folders.map(\.key)
    #expect(keys == ["p-a"])
  }

  @Test("one appKey across pages counts once; two rows sharing a fold key both stand, the door's fold is not redone")
  func neverRefolds() throws {
    let repeated = try Self.row("twice", at: 900)
    let shelf = try Self.shelf([
      repeated, repeated,
      try Self.row("x", at: 800, foldKey: "shared"),
      try Self.row("y", at: 700, foldKey: "shared"),
    ])
    let titles = shelf.recent.map(\.title)
    #expect(titles == ["twice", "x", "y"])
  }

  @Test("an asleep desktop's apps stay on the shelf, marked away")
  func asleepStays() throws {
    let shelf = try Self.shelf(
      [
        try Self.row("awake", at: 900),
        try Self.row("sleeping", at: 800, device: "mini"),
      ],
      sources: [
        try Self.source(),
        try Self.source("mini", name: "mini", state: "asleep", isSelf: false),
      ])
    let titles = shelf.recent.map(\.title)
    #expect(titles == ["awake", "sleeping"])
    #expect(shelf.away == ["mini:sleeping"])
  }

  @Test("a desktop still reading is said, never an empty shelf")
  func readingIsSaid() throws {
    let shelf = try Self.shelf(
      [],
      sources: [
        try Self.source(state: "stale"),
        try Self.source("mini", name: "mini", isSelf: false, libraryReady: false),
      ])
    #expect(
      shelf.readingLines == [
        "studio is still reading its history",
        "mini is still reading its history",
      ])
  }

  @Test("the foot counts the fold's apps, and the sources' desktops and who is asleep")
  func foot() throws {
    let two = try Self.shelf(
      [
        try Self.row("a", at: 900),
        try Self.row("b", at: 800, device: "mini"),
        try Self.row("c", at: 700, device: "mini"),
      ],
      sources: [
        try Self.source(rows: 9),
        try Self.source("mini", name: "mini", state: "asleep", rows: 9, isSelf: false),
      ])
    #expect(two.foot == "3 apps on 2 desktops · mini is asleep — 2 of its apps wait for it")
    let one = try Self.shelf(
      [try Self.row("b", at: 800, device: "mini")],
      sources: [try Self.source("mini", name: "mini", state: "asleep", isSelf: false)])
    #expect(one.foot == "1 app on 1 desktop · mini is asleep — 1 of its apps waits for it")
  }
}
