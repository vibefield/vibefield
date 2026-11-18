import Foundation
import Testing

@testable import FieldHome

/// Item 523 — a made app's link out asks the person first, and only after their touch: one ask per touch, whatever its
/// answer; none without a touch; the ask's words; ‹site› as the ask names it; and the touch watcher built never to take
/// a touch.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@MainActor
@Suite("523 — an app's link out asks first, after your touch")
struct AppsLinkOutTests {
  static let start = ContinuousClock().now

  static func at(_ milliseconds: Int) -> ContinuousClock.Instant { start + .milliseconds(milliseconds) }

  @Test("no touch since the page opened: a link out asks nothing")
  func noTouch() {
    var linkOut = AppsLinkOut()
    let asks = linkOut.asks(at: Self.at(0))
    #expect(!asks)
  }

  @Test("a touch, then a link out within the second: one ask")
  func touchThenLink() {
    var linkOut = AppsLinkOut()
    linkOut.began()
    linkOut.lifted(at: Self.at(0))
    let asks = linkOut.asks(at: Self.at(300))
    #expect(asks)
  }

  @Test("a finger still down: the link out asks")
  func stillDown() {
    var linkOut = AppsLinkOut()
    linkOut.began()
    let asks = linkOut.asks(at: Self.at(5000))
    #expect(asks)
  }

  @Test("a link out past the second after the lift asks nothing")
  func pastTheSecond() {
    var linkOut = AppsLinkOut()
    linkOut.began()
    linkOut.lifted(at: Self.at(0))
    let asks = linkOut.asks(at: Self.at(1000))
    #expect(!asks)
  }

  @Test("one touch brings one ask: after Cancel or Open, the page's next link out asks nothing until a new touch")
  func oneAskPerTouch() {
    var linkOut = AppsLinkOut()
    linkOut.began()
    linkOut.lifted(at: Self.at(0))
    let first = linkOut.asks(at: Self.at(100))
    linkOut.answered()
    let again = linkOut.asks(at: Self.at(200))
    linkOut.began()
    linkOut.lifted(at: Self.at(300))
    let afterTouch = linkOut.asks(at: Self.at(400))
    #expect(first)
    #expect(!again)
    #expect(afterTouch)
  }

  @Test("while an ask stands, the page raises no other, even on a new touch")
  func whileAsking() {
    var linkOut = AppsLinkOut()
    linkOut.began()
    let first = linkOut.asks(at: Self.at(0))
    linkOut.began()
    let second = linkOut.asks(at: Self.at(100))
    #expect(first)
    #expect(!second)
  }

  @Test("the ask's words are DESIGN.md's, as picked")
  func words() {
    let title = AppsLinkOut.title(site: "github.com")
    let line = AppsLinkOut.line(app: "Launch checklist")
    #expect(title == "Open github.com in Safari?")
    #expect(line == "Launch checklist is opening a page outside VibeField.")
    #expect(AppsLinkOut.open == "Open in Safari")
    #expect(AppsLinkOut.cancel == "Cancel")
  }

  @Test("‹site›: the registrable domain by the list; a name not plain ASCII in its xn-- form; an address as written")
  func site() {
    let cases: [(String, String)] = [
      ("docs.github.com", "github.com"),
      ("shop.example.co.uk", "example.co.uk"),
      ("bücher.de", "xn--bcher-kva.de"),
      ("\u{0430}pple.com", "xn--pple-43d.com"),
      ("192.0.2.1", "192.0.2.1"),
      ("x.github.io", "x.github.io"),
      ("github.com.evil.example", "evil.example"),
      ("a.b.ck", "a.b.ck"),
      ("www.ck", "www.ck"),
      ("shop.example.公司.cn", "example.xn--55qx5d.cn"),
      ("Docs.GitHub.com.", "github.com"),
    ]
    for (host, want) in cases {
      let got = AppsSite.of(host: host)
      #expect(got == want, "\(host)")
    }
  }

  @Test("‹site› from a link's URL")
  func siteOfURL() throws {
    let url = try #require(URL(string: "https://docs.github.com/a/b?c=d"))
    let got = AppsSite.of(url)
    #expect(got == "github.com")
  }

  @Test("‹site›: an uppercase host, a trailing dot, and a URL with userinfo read as the site they reach")
  func siteForms() throws {
    let upper = AppsSite.of(host: "GITHUB.COM")
    let dot = AppsSite.of(host: "github.com.")
    let url = try #require(URL(string: "https://github.com@evil.example/"))
    let userinfo = AppsSite.of(url)
    #expect(upper == "github.com")
    #expect(dot == "github.com")
    #expect(userinfo == "evil.example")
  }

  @Test("‹site› never guesses: a name the encoder cannot write is no site, so the link out is dropped")
  func siteUnwritable() {
    let site = AppsSite.of(host: "bücher.de", encode: { _ in nil })
    #expect(site == nil)
  }

  @Test("‹site› with no list loaded is the whole host in its ASCII form, never its last two labels")
  func siteNoList() {
    let none = AppsSite.Rules(list: "")
    let plain = AppsSite.of(host: "evil.co.uk", rules: none)
    let unicode = AppsSite.of(host: "shop.bücher.de", rules: none)
    #expect(plain == "evil.co.uk")
    #expect(unicode == "shop.xn--bcher-kva.de")
  }

  #if DEBUG || VF_WEB_RELAY
    @Test("the touch watcher takes no touch, delays none, and stands beside every other recognizer")
    func watcher() {
      let watcher = AppsTouchWatcher.make(began: {}, lifted: {})
      let cancels = watcher.cancelsTouchesInView
      let delaysBegan = watcher.delaysTouchesBegan
      let delaysEnded = watcher.delaysTouchesEnded
      let beside = watcher.delegate === watcher
      #expect(!cancels)
      #expect(!delaysBegan)
      #expect(!delaysEnded)
      #expect(beside)
    }
  #endif
}
