import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// MA-6c — what MA-D7's two slots hold: the strip before any word and the group once one is typed.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@MainActor
@Suite("MA-6c — the Apps strip and Everything's Apps group")
struct AppsStripTests {
  private static func rows(_ names: [String], device: String = "desk") throws -> [IndexAppRow] {
    try names.enumerated().map { index, name in
      try IndexAppRow(json: AppsWire.row(name, at: Int64(1000 - index), device: device))
    }
  }

  private static func reading(_ apps: [IndexAppRow] = []) throws -> AppsFeed.Reading {
    var reading = AppsFeed.Reading()
    reading.phase = .live
    reading.apps = apps
    reading.sources = [
      try IndexAppsSource(json: AppsWire.source()),
      try IndexAppsSource(json: AppsWire.source("mini", name: "mini", state: "asleep")),
    ]
    return reading
  }

  @Test("the strip is absent at zero apps, and stands at one")
  func stripAbsent() throws {
    let none = AppsStripContent.of(reading: try Self.reading(), opened: [], here: "This desktop")
    #expect(none == nil)
    let one = AppsStripContent.of(reading: try Self.reading(try Self.rows(["a"])), opened: [], here: "This desktop")
    #expect(one != nil)
  }

  @Test("the strip says Apps and All apps over Recent's four, an app opened here heading them")
  func stripHolds() throws {
    let apps = try Self.rows(["a", "b", "c", "d", "e"])
    let content = try #require(
      AppsStripContent.of(reading: try Self.reading(apps), opened: ["app:e"], here: "This desktop"))
    #expect(content.head == "Apps")
    #expect(content.all == "All apps")
    let titles = content.recent.map(\.title)
    #expect(titles == ["e", "a", "b", "c"])
  }

  @Test("the group is absent with no matches and while the words are not yet the ones answered, and stands once they are")
  func groupAbsent() throws {
    var reading = try Self.reading()
    reading.matchWords = "notes"
    let noMatches = AppsSearchGroup.of(reading: reading, words: "notes", here: "This desktop")
    #expect(noMatches == nil)
    reading.matches = try Self.rows(["release notes"])
    let otherWords = AppsSearchGroup.of(reading: reading, words: "note", here: "This desktop")
    #expect(otherWords == nil)
    let answered = AppsSearchGroup.of(reading: reading, words: "notes", here: "This desktop")
    #expect(answered != nil)
  }

  @Test("the group says Apps over each match, its desktop named and an asleep one's marked away")
  func groupHolds() throws {
    var reading = try Self.reading()
    reading.matchWords = "notes"
    reading.matches = try Self.rows(["desk notes"]) + (try Self.rows(["mini notes"], device: "mini"))
    let group = try #require(AppsSearchGroup.of(reading: reading, words: "notes", here: "This desktop"))
    #expect(group.head == "Apps")
    let desktops = group.rows.map(\.desktop)
    #expect(desktops == ["studio", "mini"])
    let away = group.rows.map(\.away)
    #expect(away == [false, true])
  }
}
