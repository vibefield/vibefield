import Foundation
import Testing

@testable import FieldMesh

/// TS-7 — the login page's rules, with no node: who puts a page in front of
/// the person, when it goes, and the two defects the reducer exists to close
/// (a Cancel re-opening the sheet; a dead node's page standing after it).
@Suite("the login page goes in front of the person only when they asked")
struct LoginPresentationTests {
  let first = URL(string: "https://login.tailscale.com/a/1a2b3c4d5e6f")!
  let second = URL(string: "https://login.tailscale.com/a/6f5e4d3c2b1a")!

  private func run(_ events: [LoginPresentation.Event]) -> LoginPresentation {
    var sheet = LoginPresentation()
    for event in events { sheet.apply(event) }
    return sheet
  }

  @Test("the person's own start presents the page the node mints")
  func personStarts() {
    let sheet = run([.runtimeGone, .personAsked, .urlArrived(first)])
    #expect(sheet.page == first)
  }

  @Test("keepUp's start only records the page; the person's ask presents it")
  func keepUpRecords() {
    var sheet = run([.runtimeGone, .urlArrived(first)])
    #expect(sheet.page == nil)
    #expect(sheet.lastURL == first)
    sheet.apply(.personAsked)
    #expect(sheet.page == first)
  }

  @Test("D1 — a Cancel stays a Cancel: the refresh after it re-mints the URL, and nothing rises")
  func cancelStays() {
    let sheet = run([.personAsked, .urlArrived(first), .personCancelled, .urlArrived(first), .urlArrived(second)])
    #expect(sheet.page == nil)
    #expect(sheet.lastURL == second)
    #expect(!sheet.presents)
  }

  @Test("D2 — signed in, the page is spent: the re-gate's replacement node boots without a page in front")
  func signedInSpends() {
    var sheet = run([.personAsked, .urlArrived(first), .signedIn])
    #expect(sheet == LoginPresentation())
    sheet.apply(.urlArrived(second))
    #expect(sheet.page == nil)
  }

  @Test("D2 — a node that drops takes its page with it: the restart after it presents nothing")
  func dropTakesThePage() {
    let sheet = run([.personAsked, .urlArrived(first), .runtimeGone, .runtimeGone, .urlArrived(second)])
    #expect(sheet.page == nil)
    #expect(sheet.lastURL == second)
  }

  @Test("a new page while one is presenting replaces it")
  func replaced() {
    let sheet = run([.personAsked, .urlArrived(first), .urlArrived(second)])
    #expect(sheet.page == second)
  }

  @Test("an ask before any page waits for the node's first")
  func askBeforePage() {
    var sheet = run([.personAsked])
    #expect(sheet.page == nil)
    #expect(sheet.presents)
    sheet.apply(.urlArrived(first))
    #expect(sheet.page == first)
  }
}
