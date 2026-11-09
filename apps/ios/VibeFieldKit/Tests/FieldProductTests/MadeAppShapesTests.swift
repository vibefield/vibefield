import Foundation
import Testing

@testable import FieldProduct

/// MA-6a (absorbing MA-1b) — the phone reads the apps doors as the contracts write them: `index.apps.list`'s three
/// pages and the apps refusals, each the contracts' own bytes (`pnpm check:ios-fixtures`).
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("MA-6a — the apps doors, as the phone reads them")
struct MadeAppShapesTests {
  @Test("one desktop's page: the rows, what the door joined, the source's standing")
  func validPage() throws {
    let page = try IndexAppsResult(json: try Fixture.json("index-apps.valid"))
    #expect(page.rows.count == 2)
    #expect(page.droppedRows.isEmpty)
    #expect(page.clipped == false)
    #expect(page.cursor == nil)
    let first = try #require(page.rows.first)
    #expect(first.foldKey == "native:claude-code:review")
    #expect(first.title == "Checkout design review")
    #expect(first.publishedAt == 1_793_836_800_000)
    #expect(first.availability == .captured)
    #expect(first.hostedUrl == "https://claude.ai/code/artifact/review")
    #expect(first.preview?.id == "01JC4MA0PV0000000000000001")
    #expect(first.projectKey == "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8")
    #expect(first.ink == 3)
    #expect(first.openable)
    #expect(first.unknownFields.isEmpty)
    let second = try #require(page.rows.last)
    #expect(second.preview == nil)
    #expect(second.hostedUrl == nil)
    let source = try #require(page.sources.first)
    #expect(page.sources.count == 1)
    #expect(source.name == "studio")
    #expect(source.isSelf)
    #expect(source.state == .live)
    #expect(source.rows == 2)
    #expect(source.libraryReady == true)
    #expect(source.previewsBase == "https://studio.tail1234.ts.net:14211/")
  }

  @Test("the phone's page: cut at the tailnet's bound, `clipped` and `cursor` saying so")
  func tailnetPage() throws {
    let page = try IndexAppsResult(json: try Fixture.json("index-apps.tailnet"))
    #expect(page.rows.count == 1)
    #expect(page.clipped)
    #expect(page.cursor != nil)
    let source = try #require(page.sources.first)
    #expect(source.rows == 142)
  }

  @Test("the mesh while a laptop sleeps: its app listed, its source asleep, no base")
  func meshPage() throws {
    let page = try IndexAppsResult(json: try Fixture.json("index-apps.mesh"))
    #expect(page.rows.count == 2)
    #expect(page.sources.count == 2)
    let laptop = try #require(page.sources.last)
    #expect(laptop.name == "laptop")
    #expect(laptop.isSelf == false)
    #expect(laptop.state == .asleep)
    #expect(laptop.libraryReady == false)
    #expect(laptop.previewsBase == nil)
    let asleep = try #require(page.rows.last)
    #expect(asleep.openable == false)
  }

  @Test("an unknown field is named, never refused")
  func unknownFields() throws {
    let page = try IndexAppsResult(
      json: try Self.page(row: ["futureFact": .string("from a newer desktop")]))
    let row = try #require(page.rows.first)
    #expect(row.unknownFields == ["futureFact"])
  }

  @Test("an unknown availability, state or previewsBase degrades; a row with no identity is dropped, named")
  func degrades() throws {
    let page = try IndexAppsResult(
      json: try Self.page(
        row: ["availability": .string("a-word-from-later")],
        source: ["state": .string("a-state-from-later"), "previewsBase": .string("http://studio:1/")],
        extraRow: .object(["title": .string("no identity")])))
    #expect(page.rows.count == 1)
    #expect(page.droppedRows.count == 1)
    let row = try #require(page.rows.first)
    #expect(row.availability == .unknown)
    let source = try #require(page.sources.first)
    #expect(source.state == .unrecognized("a-state-from-later"))
    #expect(source.previewsBase == nil)
  }

  @Test("the apps refusals read; another service's does not")
  func refusals() throws {
    let unbuilt = MadeAppRefusal(details: try Fixture.json("error-data.apps-export-unbuilt")["details"])
    #expect(unbuilt?.state == .exportUnbuilt)
    #expect(unbuilt?.device == "01J9ZK3M5Q8XR2V7N4B6C1D0EF")
    let notKept = MadeAppRefusal(details: try Fixture.json("error-data.apps-not-kept")["details"])
    #expect(notKept?.state == .notKept)
    let reading = MadeAppRefusal(details: try Fixture.json("error-data.apps-reading")["details"])
    #expect(reading?.state == .reading)
    #expect(reading?.device == "01J9ZM0PQ7W3E6R8T2Y4U1I5O9")
    let other = MadeAppRefusal(
      details: .object(["service": .string("product"), "state": .string("library-reading")]))
    #expect(other == nil)
  }

  /// `index-apps.valid`, its first row and only source overlaid with `row` and `source`, its rows cut to that one and
  /// `extraRow` after it.
  static func page(
    row: [String: JSONValue] = [:], source: [String: JSONValue] = [:], extraRow: JSONValue? = nil
  ) throws -> JSONValue {
    let page = try Fixture.json("index-apps.valid")
    var rowFields = try #require(page["rows"]?.arrayValue?.first?.objectValue)
    rowFields.merge(row) { _, new in new }
    var sourceFields = try #require(page["sources"]?.arrayValue?.first?.objectValue)
    sourceFields.merge(source) { _, new in new }
    var rows: [JSONValue] = [.object(rowFields)]
    if let extraRow { rows.append(extraRow) }
    return .object(["rows": .array(rows), "sources": .array([.object(sourceFields)])])
  }
}
