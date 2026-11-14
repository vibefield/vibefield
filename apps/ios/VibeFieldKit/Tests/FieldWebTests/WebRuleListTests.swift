import Foundation
import Testing

@testable import FieldWeb

/// SP-4b — MA-L7 as a content rule list: block everything, then the origin at its own port and the declared hosts
/// over TLS. Each filter is read here as the regular expression it is (WebKit's own language is a subset of it, with
/// no alternation), against URLs that must and must not pass.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("SP-4b — MA-L7 as a content rule list")
struct WebRuleListTests {
  static let root = "https://studio.tail1234.ts.net:13377"
  static let reach = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com"]

  private func origin() throws -> WebOrigin {
    try #require(WebOrigin(claim: Self.root))
  }

  /// Whether `url` gets through: WebKit's order, the last matching rule deciding.
  private func admits(_ rules: [WebRuleList.Rule], _ url: String) throws -> Bool {
    var blocked = false
    for rule in rules {
      let regex = try NSRegularExpression(pattern: rule.filter, options: [.caseInsensitive])
      let range = NSRange(url.startIndex..., in: url)
      if regex.firstMatch(in: url, range: range) != nil { blocked = rule.block }
    }
    return !blocked
  }

  @Test("the rules, in order: block all, the origin at its port, each declared host over TLS, then the inline schemes")
  func rules() throws {
    let rules = try WebRuleList.rules(origin: origin(), reach: Self.reach)
    let filters = rules.map(\.filter)
    #expect(
      filters == [
        ".*",
        "^https://studio\\.tail1234\\.ts\\.net:13377/", "^wss://studio\\.tail1234\\.ts\\.net:13377/",
        "^https://cdn\\.jsdelivr\\.net[:/]", "^wss://cdn\\.jsdelivr\\.net[:/]",
        "^https://cdnjs\\.cloudflare\\.com[:/]", "^wss://cdnjs\\.cloudflare\\.com[:/]",
        "^https://unpkg\\.com[:/]", "^wss://unpkg\\.com[:/]",
        "^about:", "^data:", "^blob:",
      ])
    let blocks = rules.map(\.block)
    #expect(blocks == [true] + Array(repeating: false, count: 11))
    #expect(filters.allSatisfy { !$0.contains("|") })
  }

  @Test("what passes and what does not")
  func passes() throws {
    let rules = try WebRuleList.rules(origin: origin(), reach: Self.reach)
    for url in [
      "https://studio.tail1234.ts.net:13377/", "https://studio.tail1234.ts.net:13377/assets/a.js",
      "wss://studio.tail1234.ts.net:13377/hmr", "https://cdn.jsdelivr.net/npm/x@1/x.js",
      "https://cdnjs.cloudflare.com:443/ajax/libs/x.js", "wss://unpkg.com/", "data:image/png;base64,AA==",
      "blob:https://studio.tail1234.ts.net:13377/0b5c", "about:blank",
    ] {
      let passes = try admits(rules, url)
      #expect(passes, "\(url)")
    }
    for url in [
      "https://studio.tail1234.ts.net:13378/", "http://studio.tail1234.ts.net:13377/",
      "https://mini.tail1234.ts.net:13377/", "http://cdn.jsdelivr.net/x.js", "https://cdn.jsdelivr.net.example.com/",
      "https://evilcdn.jsdelivr.net/", "https://example.com/", "https://100.101.102.103:13377/",
      "wss://mini.tail1234.ts.net:13377/", "wss://studio.tail1234.ts.net:13378/", "ws://studio.tail1234.ts.net:13377/",
      "https://[fd7a:115c:a1e0::1]:13377/", "http://100.64.0.1/",
    ] {
      let passes = try admits(rules, url)
      #expect(!passes, "\(url)")
    }
  }

  @Test("the declared hosts it admits: lowercased, deduplicated, sorted, public, never a tailnet or private name")
  func admitted() {
    let hosts = WebRuleList.admitted([
      "unpkg.com", "CDN.jsdelivr.net", "cdn.jsdelivr.net", "studio.tail1234.ts.net", "1.2.3.4", "localhost",
      "printer.local", "nas.home.arpa", "svc.internal", "a.localhost",
    ])
    #expect(hosts == ["cdn.jsdelivr.net", "unpkg.com"])
  }

  @Test("the JSON WebKit compiles: one trigger and one action per rule, slashes unescaped")
  func json() throws {
    let text = try WebRuleList.json(origin: origin(), reach: ["unpkg.com"])
    let data = try #require(text.data(using: .utf8))
    let parsed = try JSONSerialization.jsonObject(with: data)
    let array = try #require(parsed as? [[String: [String: String]]])
    #expect(array.count == 8)
    #expect(array.first?["action"]?["type"] == "block")
    #expect(array.first?["trigger"]?["url-filter"] == ".*")
    let types = array.dropFirst().compactMap { $0["action"]?["type"] }
    #expect(types == Array(repeating: "ignore-previous-rules", count: 7))
    #expect(!text.contains("\\/"))
  }

  @Test("one name per list: the same rules give the same name, in any order of hosts; other rules another")
  func identifier() throws {
    let origin = try origin()
    let one = WebRuleList.identifier(origin: origin, reach: Self.reach)
    let shuffled = WebRuleList.identifier(origin: origin, reach: Self.reach.reversed())
    let fewer = WebRuleList.identifier(origin: origin, reach: ["unpkg.com"])
    #expect(one == shuffled)
    #expect(one != fewer)
    #expect(one.hasPrefix("vf-app-"))
    #expect(one.count == "vf-app-".count + 16)
  }
}
