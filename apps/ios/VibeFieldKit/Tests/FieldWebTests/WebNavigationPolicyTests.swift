import Foundation
import Testing

@testable import FieldWeb

/// SP-4b — where a page in an app's web view may go: its own origin, a public link outside, a declared host in a
/// frame, and never a tailnet address off the origin. The origin and hosts are `artifact-open.serving.json`'s.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("SP-4b — where an app's page may go")
struct WebNavigationPolicyTests {
  static let root = "https://studio.tail1234.ts.net:13377"
  static let reach = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com"]

  private func policy() throws -> WebNavigationPolicy {
    let origin = try #require(WebOrigin(claim: Self.root))
    return WebNavigationPolicy(origin: origin, reach: Self.reach)
  }

  private func decide(_ raw: String, mainFrame: Bool) throws -> WebNavigation {
    let url = try #require(URL(string: raw))
    return try policy().decide(url, mainFrame: mainFrame)
  }

  @Test("the root claim is the origin: https, its host, its port")
  func origin() throws {
    let origin = try #require(WebOrigin(claim: Self.root))
    #expect(origin.scheme == "https")
    #expect(origin.host == "studio.tail1234.ts.net")
    #expect(origin.port == 13377)
  }

  @Test("anything but a root claim has no origin")
  func notClaims() {
    for raw in [
      "http://studio.tail1234.ts.net:13377", "https://studio.tail1234.ts.net",
      "https://studio.tail1234.ts.net:13377/x?y=1", "https://studio.tail1234.ts.net:80", "not a url",
    ] {
      let origin = WebOrigin(claim: raw)
      #expect(origin == nil, "\(raw)")
    }
  }

  @Test("the app's own origin loads: its paths, its query, its socket, at the top and in a frame")
  func ownOrigin() throws {
    for raw in [
      "https://studio.tail1234.ts.net:13377/", "https://STUDIO.tail1234.ts.net:13377/a/b.js?v=2#top",
      "wss://studio.tail1234.ts.net:13377/hmr",
    ] {
      for mainFrame in [true, false] {
        let decision = try decide(raw, mainFrame: mainFrame)
        #expect(decision == .allow, "\(raw) mainFrame=\(mainFrame)")
      }
    }
  }

  @Test("a tailnet address off the origin is refused, at the top too: Safari's sheet cannot reach it")
  func tailnetOffOrigin() throws {
    for raw in [
      "https://studio.tail1234.ts.net:13378/", "http://studio.tail1234.ts.net:13377/",
      "ws://studio.tail1234.ts.net:13377/", "https://mini.tail1234.ts.net:13377/", "https://ts.net/",
      "wss://mini.tail1234.ts.net:13377/", "https://MINI.Tail1234.TS.NET/",
      "http://100.64.0.1/", "https://100.101.102.103:13377/", "http://100.127.255.254/",
      "http://[fd7a:115c:a1e0::1]:13377/",
    ] {
      for mainFrame in [true, false] {
        let decision = try decide(raw, mainFrame: mainFrame)
        #expect(decision == .refuse(.tailnetOffOrigin), "\(raw) mainFrame=\(mainFrame)")
      }
    }
  }

  @Test("an address beside Tailscale's range is not the tailnet")
  func besideTheRange() throws {
    for raw in ["http://100.63.255.255/", "http://100.128.0.1/", "https://fd7a.example.com/"] {
      let decision = try decide(raw, mainFrame: true)
      #expect(decision == .outside, "\(raw)")
    }
  }

  @Test("a public link at the top opens outside, a declared host's too")
  func outside() throws {
    for raw in ["https://example.com/", "http://example.com/page", "https://cdn.jsdelivr.net/npm/x@1/"] {
      let decision = try decide(raw, mainFrame: true)
      #expect(decision == .outside, "\(raw)")
    }
    let socket = try decide("wss://example.com/", mainFrame: true)
    #expect(socket == .refuse(.scheme))
  }

  @Test("a frame or a load reaches the declared hosts over TLS, and nothing else")
  func frames() throws {
    for raw in ["https://cdn.jsdelivr.net/npm/x@1/x.js", "wss://unpkg.com/", "https://CDNJS.cloudflare.com:8443/a"] {
      let decision = try decide(raw, mainFrame: false)
      #expect(decision == .allow, "\(raw)")
    }
    for raw in ["http://cdn.jsdelivr.net/x.js", "https://example.com/", "https://cdn.jsdelivr.net.example.com/"] {
      let decision = try decide(raw, mainFrame: false)
      #expect(decision == .refuse(.undeclaredHost), "\(raw)")
    }
  }

  @Test("schemes: about:blank and srcdoc load; data and the origin's blob only in a frame; the rest are refused")
  func schemes() throws {
    for mainFrame in [true, false] {
      let blank = try decide("about:blank", mainFrame: mainFrame)
      #expect(blank == .allow)
      let srcdoc = try decide("about:srcdoc", mainFrame: mainFrame)
      #expect(srcdoc == .allow)
    }
    let frameData = try decide("data:text/html,hi", mainFrame: false)
    #expect(frameData == .allow)
    let topData = try decide("data:text/html,hi", mainFrame: true)
    #expect(topData == .refuse(.scheme))
    let ownBlob = try decide("blob:https://studio.tail1234.ts.net:13377/0b5c2d1e", mainFrame: false)
    #expect(ownBlob == .allow)
    let otherBlob = try decide("blob:https://example.com/0b5c2d1e", mainFrame: false)
    #expect(otherBlob == .refuse(.scheme))
    for raw in ["about:config", "mailto:a@example.com", "tel:123", "file:///etc/hosts", "vibefield://x"] {
      let decision = try decide(raw, mainFrame: true)
      #expect(decision == .refuse(.scheme), "\(raw)")
    }
  }
}
