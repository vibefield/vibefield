import Foundation
import Testing

@testable import FieldHome

/// MA-6e — the apps this account opened on this phone, which head Recent (VF-PM's Q2, 2026-11-09): the ledger's newest
/// four, and an open is also a seeing (DESIGN.md §8: "An app is seen once it has shown on the open shelf, or been
/// opened").
///
/// No key path, no `try` and no `mutating` call inside an #expect/#require argument: hoisted into a `let` first.
@MainActor
@Suite("MA-6e — the opened ledger: newest first, four of them, and an open is a seeing")
struct AppsOpenedLedgerTests {
  private static let me = "me@tailnet"

  private static func ledger(_ extra: String = "") throws -> AppsCues {
    let json = #"{"known":["app:a","app:b"],"unseen":["app:b"],"primed":true,"peeked":true\#(extra)}"#
    return try JSONDecoder().decode(AppsCues.self, from: Data(json.utf8))
  }

  @Test("an open heads the ledger, and opening it again moves it back up")
  func headsTheLedger() {
    var cues = AppsCues()
    cues.open("app:a")
    cues.open("app:b")
    cues.open("app:a")
    let opened = cues.opened
    #expect(opened == ["app:a", "app:b"])
  }

  @Test("the ledger holds the newest four")
  func holdsFour() {
    var cues = AppsCues()
    for key in ["app:a", "app:b", "app:c", "app:d", "app:e"] { cues.open(key) }
    let opened = cues.opened
    #expect(opened == ["app:e", "app:d", "app:c", "app:b"])
  }

  @Test("an open is also a seeing: the dot goes")
  func openIsSeeing() throws {
    var cues = try Self.ledger()
    cues.open("app:b")
    let dot = cues.dot
    #expect(dot == false)
  }

  @Test("a ledger written before the opens reads as none, and one written after reads its own")
  func oldLedgerReads() throws {
    let old = try Self.ledger().opened
    #expect(old.isEmpty)
    let new = try Self.ledger(#","openedKeys":["app:a"]"#).opened
    #expect(new == ["app:a"])
  }

  @Test("an open is on the phone, read back for the account")
  func kept() throws {
    let defaults = try #require(UserDefaults(suiteName: "ma6e-\(UUID().uuidString)"))
    let store = AppsCuesStore(defaults: defaults)
    let model = AppsDoorModel(store: store)
    model.adopt(account: Self.me)
    model.opened("app:a")
    let next = AppsDoorModel(store: store)
    next.adopt(account: Self.me)
    let opened = next.cues.opened
    #expect(opened == ["app:a"])
  }
}
