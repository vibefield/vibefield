import Foundation
import Testing

@testable import FieldMesh

// EL7 M1 — a published dial target is somebody else's string until the mesh
// vouches for it.

private let studioAddresses = ["studio", "100.64.0.2"]

@Suite struct ProductEndpointCheckTests {
  @Test func theDesktopsOwnDoorIsAccepted() {
    for host in ["studio", "studio.tail.ts.net", "100.64.0.2"] {
      let verdict = verifyProductEndpoint(
        "http://\(host):443/t/3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM",
        from: studioAddresses, magicDNSSuffix: "tail.ts.net")
      #expect(verdict.url != nil, "\(host) is this desktop")
    }
  }

  /// THE attack: a peer publishes a slice naming a door on a machine it
  /// controls, and the phone dials it carrying its WhoIs-granted `self` scopes.
  @Test func aDoorSomewhereElseIsRefused() {
    let verdict = verifyProductEndpoint(
      "ws://attacker.example/t/secret", from: studioAddresses, magicDNSSuffix: "tail.ts.net")
    #expect(verdict.url == nil)
    #expect(verdict.reason == "the published door points somewhere this desktop is not")
  }

  /// The reason the match is an EQUALITY and not a prefix: MagicDNS forwards
  /// names it does not own to the upstream resolver, so `studio.attacker.example`
  /// resolves — and a `hasPrefix("studio.")` would have welcomed it.
  @Test func aNameThatMerelyStartsWithTheSlugIsRefused() {
    let verdict = verifyProductEndpoint(
      "ws://studio.attacker.example/t/secret", from: studioAddresses,
      magicDNSSuffix: "tail.ts.net")
    #expect(verdict.url == nil)
  }

  /// Without the tailnet's own suffix the FQDN cannot be built, so only the
  /// bare forms are vouched for. Refusing is the honest answer: the phone has
  /// nothing to check the name against.
  @Test func withoutTheSuffixOnlyTheBareAddressesAreVouchedFor() {
    #expect(verifyProductEndpoint("ws://studio/t/x", from: studioAddresses).url != nil)
    #expect(
      verifyProductEndpoint("ws://studio.tail.ts.net/t/x", from: studioAddresses).url == nil)
  }

  @Test func aSchemeThatIsNotASocketIsRefused() {
    for raw in ["file:///etc/passwd", "vibefield://studio/t/x", "javascript:alert(1)"] {
      let verdict = verifyProductEndpoint(
        raw, from: studioAddresses, magicDNSSuffix: "tail.ts.net")
      #expect(verdict.url == nil, "\(raw) is not a socket")
    }
  }

  /// C3 — the door IS the secret path. A URL on the right machine that is not
  /// one is not this door.
  @Test func aUrlThatIsNotACapabilityPathIsRefused() {
    let verdict = verifyProductEndpoint(
      "ws://studio/admin", from: studioAddresses, magicDNSSuffix: "tail.ts.net")
    #expect(verdict.url == nil)
    #expect(verdict.reason == "the published door is not a capability path")
  }

  /// A desktop the mesh can say nothing about cannot be dialed. Silence is not
  /// permission.
  @Test func aDesktopWithNoVouchedAddressIsRefused() {
    let verdict = verifyProductEndpoint("ws://studio/t/x", from: [])
    #expect(verdict.url == nil)
    #expect(verdict.reason == "this desktop has no address the mesh will vouch for")
  }

  @Test func anAbsentOrUnparseableDoorIsAStateAndNotAnAlarm() {
    #expect(verifyProductEndpoint(nil, from: studioAddresses).reason?.contains("not serving") == true)
    #expect(verifyProductEndpoint("", from: studioAddresses).url == nil)
    #expect(verifyProductEndpoint("not a url at all", from: studioAddresses).url == nil)
  }

  /// The golden's own spelling parses: the contracts publish `http://…:443/t/…`
  /// (fieldd builds it from truffle's serve URL), which is why this check does
  /// not pin `wss` the way the review asked.
  @Test func theContractsOwnSpellingIsAccepted() {
    let verdict = verifyProductEndpoint(
      "http://mac.tail1234.ts.net:443/t/3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM",
      from: ["mac"], magicDNSSuffix: "tail1234.ts.net")
    #expect(verdict.url != nil)
  }
}
