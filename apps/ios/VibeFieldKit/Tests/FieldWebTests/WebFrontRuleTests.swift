import Foundation
import Testing

@testable import FieldWeb

/// Item 522 — the filtering front's rule, pure: what the page's only proxy does with one CONNECT, before any dial, and
/// which spelling of the name a dial is handed (the policy's own, never the page's).
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("522 — the front's rule at one CONNECT")
struct WebFrontRuleTests {
  static let root = "https://studio.tail1234.ts.net:13377"
  static let rule = WebFrontRule(
    policy: WebNavigationPolicy(origin: WebOrigin(claim: root)!, reach: ["declared.example"]))

  @Test("the origin at its own port is carried over the mesh; at another port it is refused")
  func origin() {
    let own = Self.rule.admit(name: "studio.tail1234.ts.net", port: 13377, isName: true)
    let other = Self.rule.admit(name: "studio.tail1234.ts.net", port: 443, isName: true)
    #expect(own == .origin)
    #expect(other == .refused(.port))
  }

  @Test("a declared host is carried by the system's own connection, at any port, as the rule list admits it")
  func declared() {
    let at443 = Self.rule.admit(name: "declared.example", port: 443, isName: true)
    let at8443 = Self.rule.admit(name: "declared.example", port: 8443, isName: true)
    #expect(at443 == .declared("declared.example"))
    #expect(at8443 == .declared("declared.example"))
  }

  @Test("a name the page did not declare is refused")
  func undeclared() {
    let admit = Self.rule.admit(name: "undeclared.example.org", port: 443, isName: true)
    #expect(admit == .refused(.undeclared))
  }

  @Test("a tailnet name off the origin is refused, declared or not")
  func tailnet() {
    let other = Self.rule.admit(name: "other.tail1234.ts.net", port: 13377, isName: true)
    let declaredTailnet = WebFrontRule(
      policy: WebNavigationPolicy(origin: WebOrigin(claim: Self.root)!, reach: ["x.tail1234.ts.net"]))
    let declared = declaredTailnet.admit(name: "x.tail1234.ts.net", port: 443, isName: true)
    #expect(other == .refused(.tailnet))
    #expect(declared == .refused(.tailnet))
  }

  @Test("an address is refused, asked as an address or written as a name")
  func address() {
    let asked = Self.rule.admit(name: "100.101.102.103", port: 13377, isName: false)
    let cases = ["100.101.102.103", "127.0.0.1", "::1", "[::1]", "::ffff:127.0.0.1"]
    for name in cases {
      let admit = Self.rule.admit(name: name, port: 443, isName: true)
      #expect(admit == .refused(.address), "\(name)")
    }
    #expect(asked == .refused(.address))
  }

  @Test("an address in any of a resolver's forms is refused, even one the page declares")
  func addressForms() {
    let hex = WebFrontRule(
      policy: WebNavigationPolicy(
        origin: WebOrigin(claim: Self.root)!, reach: ["0x64.0x65.0x66.0x67", "0x7f.0x1", "declared.example"]))
    for name in ["0x7f.0x1", "0x64.0x65.0x66.0x67", "2130706433", "127.1", "0X7F.0X1", "1.0x"] {
      let admit = hex.admit(name: name, port: 443, isName: true)
      #expect(admit == .refused(.address), "\(name)")
    }
  }

  @Test("one root dot and a name's case make no other name, and the dial gets the policy's spelling; no more dots")
  func spelling() {
    let origin = Self.rule.admit(name: "STUDIO.Tail1234.ts.net.", port: 13377, isName: true)
    let declared = Self.rule.admit(name: "Declared.Example.", port: 443, isName: true)
    let leading = Self.rule.admit(name: ".declared.example", port: 443, isName: true)
    let twice = Self.rule.admit(name: "declared.example..", port: 443, isName: true)
    #expect(origin == .origin)
    #expect(declared == .declared("declared.example"))
    #expect(leading == .refused(.undeclared))
    #expect(twice == .refused(.undeclared))
  }
}
