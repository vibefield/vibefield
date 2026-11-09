import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// MA-6e — the shelf's standing on the door's model: open and closed, the folder, the zoom, what is seen and what is not
/// yet opened (DESIGN.md §8 "The phone's Apps"). How any of it looks and feels is the stills' and James's (P6).
///
/// No key path, no `try` and no `mutating` call inside an #expect/#require argument: hoisted into a `let` first.
@MainActor
@Suite("MA-6e — the shelf's standing: open, the folder, the zoom, seen and unopened")
struct AppsShelfStandingTests {
  private static let me = "me@tailnet"

  private static func rows(_ names: [String]) throws -> [IndexAppRow] {
    try names.map { try IndexAppRow(json: AppsWire.row($0)) }
  }

  private static func reading(_ names: [String]) throws -> AppsFeed.Reading {
    var reading = AppsFeed.Reading()
    reading.phase = .live
    reading.apps = try rows(names)
    return reading
  }

  /// A model that has had its first reading, so what comes next is news.
  private static func primed(_ names: [String]) throws -> AppsDoorModel {
    let model = AppsDoorModel(store: nil)
    model.adopt(account: me)
    model.land(try reading(names), account: me, blocked: false, calm: false)
    return model
  }

  private static func land(_ model: AppsDoorModel, _ names: [String]) throws {
    model.land(try reading(names), account: me, blocked: false, calm: false)
  }

  // MARK: - Open and closed

  @Test("the open shelf has shown what it holds: the dot goes")
  func shelfIsSeeing() throws {
    let model = try Self.primed(["a"])
    try Self.land(model, ["a", "b"])
    #expect(model.cues.dot)
    model.openShelf(showing: ["app:a", "app:b"])
    #expect(model.shelfOpen)
    #expect(model.cues.dot == false)
  }

  @Test("an app that arrives while the shelf stands is seen at once")
  func arrivesWhileOpen() throws {
    let model = try Self.primed(["a"])
    model.openShelf(showing: ["app:a"])
    #expect(model.shelfOpen)
    try Self.land(model, ["a", "b"])
    #expect(model.cues.dot == false)
  }

  @Test("a folder opens in place and closes")
  func folderInPlace() throws {
    let model = try Self.primed(["a"])
    model.openFolder("project-1")
    #expect(model.folder == "project-1")
    model.closeFolder()
    #expect(model.folder == nil)
  }

  @Test("closing the shelf closes its folder")
  func closingClosesTheFolder() throws {
    let model = try Self.primed(["a"])
    model.openShelf(showing: ["app:a"])
    model.openFolder("project-1")
    #expect(model.folder == "project-1")
    model.closeShelf()
    #expect(model.shelfOpen == false)
    #expect(model.folder == nil)
  }

  // MARK: - The zoom

  @Test("a zoom is an open: it stands, heads the ledger and clears the dot")
  func zoomIsAnOpen() throws {
    let model = try Self.primed(["a"])
    try Self.land(model, ["a", "b"])
    model.zoom("app:b")
    #expect(model.zoomKey == "app:b")
    let opened = model.cues.opened
    #expect(opened == ["app:b"])
    #expect(model.cues.dot == false)
  }

  @Test("coming back from a zoom leaves the ledger")
  func unzoomKeeps() throws {
    let model = try Self.primed(["a"])
    model.zoom("app:a")
    #expect(model.zoomKey == "app:a")
    model.unzoom()
    #expect(model.zoomKey == nil)
    let opened = model.cues.opened
    #expect(opened == ["app:a"])
  }

  @Test("sign-out takes the shelf, its folder and the zoom down")
  func signOutCloses() throws {
    let model = try Self.primed(["a"])
    model.openShelf(showing: ["app:a"])
    model.openFolder("project-1")
    model.zoom("app:a")
    #expect(model.shelfOpen)
    model.signedOut()
    #expect(model.shelfOpen == false)
    #expect(model.folder == nil)
    #expect(model.zoomKey == nil)
  }

  // MARK: - Not yet opened

  @Test("only news is unopened: the first reading's apps are not")
  func onlyNewsIsUnopened() {
    var cues = AppsCues()
    _ = cues.read(["app:a"])
    _ = cues.read(["app:a", "app:b"])
    let unopened = cues.unopened
    #expect(unopened == ["app:b"])
  }

  @Test("the shelf showing it does not open it; an open does")
  func seenIsNotOpened() {
    var cues = AppsCues()
    _ = cues.read(["app:a"])
    _ = cues.read(["app:a", "app:b"])
    cues.seen(["app:b"])
    let afterSeen = cues.unopened
    #expect(afterSeen == ["app:b"])
    cues.open("app:b")
    let afterOpen = cues.unopened
    #expect(afterOpen.isEmpty)
  }

  // MARK: - What the shelf lists

  @Test("the shelf's words match titles in any case, and no words are no list")
  func shelfWords() throws {
    let apps = try Self.rows(["Notes", "Budget"])
    let matched = AppsShelf.matching("NOT", in: apps).map(\.title)
    #expect(matched == ["Notes"])
    let blank = AppsShelf.matching("   ", in: apps)
    #expect(blank.isEmpty)
  }

  @Test("a shelf with no apps says why, in the home's words and the interim ones")
  func emptyWords() {
    let off = AppsShelf.emptyLine(phase: .off, here: "studio")
    #expect(off == "This phone isn't connected to its home desktop")
    let unreachable = AppsShelf.emptyLine(phase: .unavailable, here: "studio")
    #expect(unreachable == "Can't reach studio")
    let waiting = AppsShelf.emptyLine(phase: .waiting, here: "studio")
    #expect(waiting == "Reading your apps")
    let live = AppsShelf.emptyLine(phase: .live, here: "studio")
    #expect(live == "Your agents haven't made an app yet")
    let reading = AppsShelf.emptyLine(phase: .reading(device: nil), here: "studio")
    #expect(reading == nil)
  }

  @Test("a folder shows three large and the next four small")
  func folderTile() throws {
    let apps = try Self.rows(["1", "2", "3", "4", "5", "6", "7", "8", "9"])
    let folder = AppsShelf.Folder(key: "project-1", name: "One", ink: nil, apps: apps)
    let big = folder.big.map(\.title)
    let small = folder.small.map(\.title)
    #expect(big == ["1", "2", "3"])
    #expect(small == ["4", "5", "6", "7"])
  }
}
